/**
 * Task 0175 — repeatable installed-sp check.
 *
 * `--preflight` is the only flag. It records versions, Superskill stamps, the
 * before-deletion script-root probe, and the staged Bun fingerprint. It never
 * edits the workflow, never deletes the vendored tree, and never copies a
 * library or points at a source checkout.
 *
 * Without the flag, the same runtime checks run again and the migration
 * assertions (deletion, rule semantics, operational references, pinned
 * feature-verification, isolated replays) must hold. Any miss exits nonzero.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = join(repoRoot, '.spur', 'run', '0175-verification');
const workflowPath = join(repoRoot, '.spur', 'workflows', 'feature-verification.yaml');
const rulePaths = [
    '.spur/rules/boundary/shipped-script-isolation.yaml',
    '.spur/rules/typescript/output-boundaries.yaml',
] as const;
const presetPaths = ['.spur/rules/recommended-pre-check.yaml', '.spur/rules/recommended-post-check.yaml'] as const;
const twins = ['script-root.mjs', 'inline-run-setup.mjs', 'feature-verification-steps.mjs'] as const;
const digestRe = /^sha256:[0-9a-f]{64}$/;
const vendorScripts = ['plugins', 'sp', 'scripts'].join('/');
const vendorLib = ['plugins', 'sp', 'lib'].join('/');
const refPattern = `${['plugins', 'sp'].join('/')}/(scripts|lib)`;
const precheckNeedle = 'feature-dev-' + 'precheck';
const supersessionHeading = '2026-10-02 — 0175 supersedes the old sp vendoring recipe';
const passGuard = 'test "$(cat .spur/run/$__runId-feature-verification.status 2>/dev/null)" = PASS';
const productionCmd = 'verificationCmd: "bun run spur-check"';
const fixtureCmd = 'verificationCmd: "bun --version"';

const bootstrapAction = [
    'S="$(superskill script path sp script-root.mjs 2>/dev/null)" || S="";',
    'if [ -n "$S" ] && [ -f "$S" ]; then node "$S" --run-id "$__runId" --spur-bin "$spurBin";',
    'else echo "script-root failed closed — run \'superskill install sp --marketplace gobing-ai/spur\'" >&2;',
    'fi;',
    'exit 0',
].join(' ');

const verifierAction = [
    // ADR-115 shell-lines budget (error above 10 logical commands): &&/|| chains,
    // no if/then/fi, no eval (task Design bans a constructed-command eval). Each
    // onEnter action runs in a fresh shell, so an unset S reads as "".
    'mkdir -p .spur/run;',
    'DIR="$(jq -r \'select(.mode == "installed" and (.dir | type == "string") and .dir != "") | .dir\' ".spur/run/$__runId-script-root.json" 2>/dev/null)" || DIR="";',
    '[ -n "$DIR" ] && [ -f "$DIR/feature-verification-steps.mjs" ] && S="$DIR/feature-verification-steps.mjs";',
    '[ -f "$S" ] && bun "$S" verify --feature-id "$featureId" --run-id "$__runId" --spur-bin "$spurBin" || printf \'FAIL feature-verification failed closed — unresolved root or verifier failure\\n\' > ".spur/run/$__runId-feature-verification.status";',
    'exit 0',
].join(' ');

interface CommandResult {
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
}

interface Failure {
    id: string;
    detail: string;
}

interface ScriptDescriptor {
    rel: string;
    path: string;
    source: string;
    stamp: { upstreamVersion: string; installedAt: string } | null;
}

interface RuntimeReport {
    versions: {
        spurCli: string;
        spurPackage: string;
        spurPackageJson: string;
        superskill: string;
    };
    scripts: ScriptDescriptor[];
    scriptRoot: {
        runId: string;
        exitCode: number;
        stderr: string;
        artifact: Record<string, unknown> | null;
        vendorDirPresent: boolean;
        ignoredVendorWarnings: number;
        expectedVendorWarnings: number;
    };
    fingerprint: {
        command: string;
        entry: string;
        exitCode: number;
        stdout: string;
        stderr: string;
        digest: string | null;
    };
    library: {
        stagedPath: string;
        stagedSha256: string | null;
        packagedPath: string;
        packagedSha256: string | null;
    };
    inventoryTracked: number;
    mutationBefore: string;
    mutationAfter: string;
}

const failures: Failure[] = [];

function fail(id: string, detail: string): void {
    failures.push({ id, detail });
}

function run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): CommandResult {
    const cwd = options?.cwd ?? repoRoot;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
    }
    if (options?.env) {
        for (const [key, value] of Object.entries(options.env)) env[key] = value;
    }
    const result = spawnSync(command, args, {
        cwd,
        env,
        encoding: 'utf8',
        timeout: options?.timeoutMs ?? 60_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    const errorText = result.error ? `\n${result.error.message}` : '';
    return {
        command: [command, ...args].join(' '),
        cwd,
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: `${result.stderr ?? ''}${errorText}`,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
    const objectAt = text.indexOf('{');
    const arrayAt = text.indexOf('[');
    const start = objectAt < 0 ? arrayAt : arrayAt < 0 || objectAt < arrayAt ? objectAt : arrayAt;
    if (start < 0) throw new Error(`no JSON in: ${text.slice(0, 240)}`);
    return JSON.parse(text.slice(start)) as unknown;
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' ? value : null;
}

function versionOf(text: string, label: string): string {
    const match = text.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/);
    if (!match) {
        fail('version', `${label} did not report a version: ${text.slice(0, 240)}`);
        return '';
    }
    return match[0];
}

function writeText(path: string, body: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body.endsWith('\n') ? body : `${body}\n`);
}

function sha256File(path: string): string | null {
    if (!existsSync(path)) return null;
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function commandPath(binary: string): string {
    const found = run('sh', ['-c', `command -v ${binary}`]);
    return found.exitCode === 0 ? found.stdout.trim() : '';
}

function resolveSpurPackage(): { packageJson: string; version: string } {
    const bin = commandPath('spur');
    if (bin === '') {
        fail('version', 'spur is not on PATH');
        return { packageJson: '', version: '' };
    }
    let resolvedBin = bin;
    try {
        resolvedBin = realpathSync(bin);
    } catch (error) {
        fail('version', `could not realpath spur: ${String(error)}`);
        return { packageJson: '', version: '' };
    }
    let dir = dirname(resolvedBin);
    for (let i = 0; i < 6; i += 1) {
        const candidate = join(dir, 'package.json');
        if (existsSync(candidate)) {
            const parsed = parseJson(readFileSync(candidate, 'utf8'));
            if (isRecord(parsed) && parsed.name === '@gobing-ai/spur' && typeof parsed.version === 'string') {
                return { packageJson: candidate, version: parsed.version };
            }
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    fail('version', `could not resolve @gobing-ai/spur package.json from ${bin}`);
    return { packageJson: '', version: '' };
}

function mutationPorcelain(): string {
    const vendorRoot = vendorScripts.split('/').slice(0, 2).join('/');
    return run('git', [
        'status',
        '--porcelain',
        '--',
        vendorRoot,
        '.spur/workflows/feature-verification.yaml',
        ...rulePaths,
        '.spur/context/learnings.md',
    ]).stdout;
}

function trackedVendorCount(): number {
    const vendorRoot = vendorScripts.split('/').slice(0, 2).join('/');
    const listed = run('git', ['ls-files', '--', vendorRoot]);
    return listed.stdout.split('\n').filter((line) => line.trim() !== '').length;
}

function vendorWarningCount(stderr: string): number {
    return stderr.split(/\r?\n/).filter((line) => line.includes('ignoring vendored')).length;
}

function normalizeSpace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function foldedCommands(yaml: string): string[] {
    const lines = yaml.split(/\r?\n/);
    const commands: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
        const header = lines[i]?.match(/^(\s*)command:\s*>-\s*$/);
        if (!header) continue;
        const base = header[1]?.length ?? 0;
        const parts: string[] = [];
        for (let j = i + 1; j < lines.length; j += 1) {
            const line = lines[j] ?? '';
            if (line.trim() === '') break;
            const indent = line.match(/^\s*/)?.[0].length ?? 0;
            if (indent <= base) break;
            parts.push(line.trim());
        }
        commands.push(normalizeSpace(parts.join(' ')));
    }
    return commands;
}

function nonCommentText(text: string): string {
    return text
        .split(/\r?\n/)
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
        .replace(/\n+$/, '\n');
}

function resolveDescriptor(rel: string): ScriptDescriptor {
    const listed = run('superskill', ['script', 'path', 'sp', rel, '--json']);
    writeText(join(evidenceRoot, 'preflight', `path-${rel}.json`), listed.stdout);
    if (listed.exitCode !== 0) {
        fail('stamp', `superskill script path sp ${rel} exited ${listed.exitCode}: ${listed.stderr}`);
        return { rel, path: '', source: '', stamp: null };
    }
    let parsed: unknown;
    try {
        parsed = parseJson(listed.stdout);
    } catch (error) {
        fail('stamp', `superskill script path sp ${rel} was not JSON: ${String(error)}`);
        return { rel, path: '', source: '', stamp: null };
    }
    if (!isRecord(parsed)) {
        fail('stamp', `superskill script path sp ${rel} JSON was not an object`);
        return { rel, path: '', source: '', stamp: null };
    }
    const path = readString(parsed, 'path') ?? '';
    const source = readString(parsed, 'source') ?? '';
    const stampRaw = parsed.stamp;
    let stamp: ScriptDescriptor['stamp'] = null;
    if (isRecord(stampRaw)) {
        const upstreamVersion = readString(stampRaw, 'upstreamVersion');
        const installedAt = readString(stampRaw, 'installedAt');
        if (upstreamVersion && installedAt) stamp = { upstreamVersion, installedAt };
    }
    if (path === '' || !existsSync(path)) fail('stamp', `resolved ${rel} is missing on disk: ${path}`);
    if (source === '') fail('stamp', `resolved ${rel} has an empty source`);
    if (!stamp) fail('stamp', `resolved ${rel} has no upstreamVersion/installedAt stamp`);
    if (path.includes('spur-new')) fail('stamp', `resolved ${rel} points at a source checkout: ${path}`);
    return { rel, path, source, stamp };
}

function captureRuntime(runId: string): RuntimeReport {
    const cli = run('spur', ['--version', '--no-logo']);
    const superskill = run('superskill', ['--version']);
    const spurPackage = resolveSpurPackage();
    const versions = {
        spurCli: versionOf(`${cli.stdout}\n${cli.stderr}`, 'spur'),
        spurPackage: spurPackage.version,
        spurPackageJson: spurPackage.packageJson,
        superskill: versionOf(superskill.stdout || superskill.stderr, 'superskill'),
    };
    if (versions.spurCli !== '' && versions.spurPackage !== '' && versions.spurCli !== versions.spurPackage) {
        fail('version', `spur CLI ${versions.spurCli} != package ${versions.spurPackage}`);
    }
    const scripts = twins.map((rel) => resolveDescriptor(rel));
    const versionsSeen = scripts.map((script) => script.stamp?.upstreamVersion ?? '');
    if (versionsSeen.some((version) => version === '') || new Set(versionsSeen).size !== 1) {
        fail('stamp', `staged stamps disagree: ${versionsSeen.join(', ')}`);
    }
    const scriptRoot = scripts.find((script) => script.rel === 'script-root.mjs');
    const inline = scripts.find((script) => script.rel === 'inline-run-setup.mjs');
    const vendorDirPresent = existsSync(join(repoRoot, vendorScripts));
    const expectedVendorWarnings = vendorDirPresent ? 1 : 0;
    let rootResult: CommandResult = {
        command: '',
        cwd: repoRoot,
        exitCode: 1,
        stdout: '',
        stderr: 'script-root was not resolved',
    };
    let artifact: Record<string, unknown> | null = null;
    if (scriptRoot && scriptRoot.path !== '') {
        rootResult = run('node', [scriptRoot.path, '--run-id', runId, '--spur-bin', 'spur'], { timeoutMs: 60_000 });
        const artifactPath = join(repoRoot, '.spur', 'run', `${runId}-script-root.json`);
        if (rootResult.exitCode !== 0) fail('script-root', `node script-root exited ${rootResult.exitCode}`);
        if (!existsSync(artifactPath)) {
            fail('script-root', `script-root did not write ${artifactPath}`);
        } else {
            try {
                const parsed = parseJson(readFileSync(artifactPath, 'utf8'));
                artifact = isRecord(parsed) ? parsed : null;
            } catch (error) {
                fail('script-root', `script-root artifact was not JSON: ${String(error)}`);
            }
            writeText(join(evidenceRoot, 'preflight', `${runId}-script-root.json`), readFileSync(artifactPath, 'utf8'));
        }
        writeText(join(evidenceRoot, 'preflight', `${runId}-script-root.stderr`), rootResult.stderr);
        const warnings = vendorWarningCount(rootResult.stderr);
        if (warnings !== expectedVendorWarnings) {
            fail(
                'script-root',
                `ignored-vendor warnings=${warnings}, expected ${expectedVendorWarnings} (dir present=${vendorDirPresent})`,
            );
        }
        if (artifact) {
            if (readString(artifact, 'mode') !== 'installed') {
                fail('script-root', `mode=${String(artifact.mode)}, expected installed`);
            }
            if (readString(artifact, 'source') !== scriptRoot.source) {
                fail('script-root', `source=${String(artifact.source)} != superskill ${scriptRoot.source}`);
            }
            if (readString(artifact, 'dir') !== dirname(scriptRoot.path)) {
                fail('script-root', `dir=${String(artifact.dir)} != ${dirname(scriptRoot.path)}`);
            }
            const digest = readString(artifact, 'scriptSetDigest') ?? '';
            if (!digestRe.test(digest)) fail('script-root', `digest was not sha256:<64 hex>: ${digest}`);
        }
    }
    const taskFile = resolveTaskFile();
    let fingerprint: RuntimeReport['fingerprint'] = {
        command: '',
        entry: inline?.path ?? '',
        exitCode: 1,
        stdout: '',
        stderr: 'inline-run-setup was not resolved',
        digest: null,
    };
    if (inline && inline.path !== '' && taskFile !== '') {
        const args = ['--fingerprint', '--task-file', taskFile, '--spur-bin', 'spur'];
        const finger = run('bun', [inline.path, ...args], { timeoutMs: 90_000 });
        const digestLine = finger.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => digestRe.test(line));
        fingerprint = {
            command: finger.command,
            entry: inline.path,
            exitCode: finger.exitCode,
            stdout: finger.stdout,
            stderr: finger.stderr,
            digest: digestLine.length === 1 ? (digestLine[0] ?? null) : null,
        };
        writeText(join(evidenceRoot, 'preflight', `${runId}-fingerprint.stdout`), finger.stdout);
        writeText(join(evidenceRoot, 'preflight', `${runId}-fingerprint.stderr`), finger.stderr);
        if (finger.exitCode !== 0 || fingerprint.digest === null) {
            fail(
                'fingerprint',
                `staged fingerprint exited ${finger.exitCode}; digests=${digestLine.length}; stderr=${finger.stderr.slice(-2000)}`,
            );
        }
    } else if (taskFile === '') {
        fail('fingerprint', 'task file docs/tasks/0175_*.md was not found');
    }
    const stagedLib = inline?.path ? resolve(dirname(inline.path), '..', 'lib', 'inline-run.generated.mjs') : '';
    const packagedLib =
        spurPackage.packageJson === ''
            ? ''
            : join(dirname(spurPackage.packageJson), vendorLib, 'inline-run.generated.mjs');
    return {
        versions,
        scripts,
        scriptRoot: {
            runId,
            exitCode: rootResult.exitCode,
            stderr: rootResult.stderr,
            artifact,
            vendorDirPresent,
            ignoredVendorWarnings: vendorWarningCount(rootResult.stderr),
            expectedVendorWarnings,
        },
        fingerprint,
        library: {
            stagedPath: stagedLib,
            stagedSha256: stagedLib === '' ? null : sha256File(stagedLib),
            packagedPath: packagedLib,
            packagedSha256: packagedLib === '' ? null : sha256File(packagedLib),
        },
        inventoryTracked: trackedVendorCount(),
        mutationBefore: '',
        mutationAfter: '',
    };
}

function resolveTaskFile(): string {
    const listed = run('git', ['ls-files', '--', 'docs/tasks/0175_*.md']);
    const files = listed.stdout.split('\n').filter((line) => line.trim() !== '');
    if (files.length !== 1) {
        fail('fingerprint', `expected one docs/tasks/0175_*.md, found ${files.length}`);
        return '';
    }
    return join(repoRoot, files[0] ?? '');
}

function gitShow(path: string): string {
    const shown = run('git', ['show', `HEAD:${path}`]);
    if (shown.exitCode !== 0) {
        fail('rules', `git show HEAD:${path} failed: ${shown.stderr}`);
        return '';
    }
    return shown.stdout;
}

function checkRules(): void {
    for (const path of rulePaths) {
        const current = readFileSync(join(repoRoot, path), 'utf8');
        const previous = gitShow(path);
        if (previous !== '' && nonCommentText(current) !== nonCommentText(previous)) {
            fail('rules', `${path} semantic lines changed (comment-stripped text differs from HEAD)`);
        }
        const namesVendor =
            current.includes(`${['plugins', 'sp', 'scripts'].join('/')}`) ||
            current.includes(`${['plugins', 'sp', 'lib'].join('/')}`);
        if (namesVendor) fail('rules', `${path} still names the vendored script or lib tree`);
    }
    for (const path of presetPaths) {
        const current = readFileSync(join(repoRoot, path), 'utf8');
        const previous = gitShow(path);
        if (previous !== '' && current !== previous) fail('rules', `${path} preset membership changed`);
    }
}

function checkContext(): void {
    const text = readFileSync(join(repoRoot, '.spur', 'context', 'learnings.md'), 'utf8');
    if (!text.includes(supersessionHeading)) {
        fail('context', 'learnings.md is missing the 0175 supersession heading');
    }
    if (!text.includes('Never copy the `.mjs` twin')) {
        fail('context', 'learnings.md dropped the historical vendoring note it was supposed to retain');
    }
}

function trackedOperationalFiles(): string[] {
    const prefixes = ['.spur/workflows', '.spur/rules', 'scripts', 'apps', 'packages', 'plugins/kk'];
    const manifests = [
        'package.json',
        'biome.json',
        'bunfig.toml',
        'tsconfig.json',
        '.prototools',
        'lefthook.yml',
        'cog.toml',
        'AGENTS.md',
    ].filter((path) => existsSync(join(repoRoot, path)));
    const listed = run('git', ['ls-files', '--', ...prefixes, ...manifests]);
    return listed.stdout.split('\n').filter((line) => line.trim() !== '');
}

function scanOperational(): void {
    const files = trackedOperationalFiles();
    if (files.length === 0) {
        fail('scan', 'operational file list was empty');
        return;
    }
    const refHits = run('rg', ['-n', '--no-heading', '-e', refPattern, ...files]);
    if (refHits.exitCode === 0) fail('scan', `operational references remain:\n${refHits.stdout}`);
    else if (refHits.exitCode !== 1) fail('scan', `rg ref scan failed: ${refHits.stderr}`);
    const callerHits = run('rg', ['-n', '--no-heading', '-e', precheckNeedle, ...files]);
    if (callerHits.exitCode === 0) fail('scan', `${precheckNeedle} caller remains:\n${callerHits.stdout}`);
    else if (callerHits.exitCode !== 1) fail('scan', `rg caller scan failed: ${callerHits.stderr}`);
}

function checkDeletion(): void {
    const tracked = trackedVendorCount();
    if (tracked !== 0) fail('deletion', `tracked vendored files remain: ${tracked}`);
    const root = vendorScripts.split('/').slice(0, 2).join('/');
    if (existsSync(join(repoRoot, root))) fail('deletion', `${root} still exists on disk`);
}

function checkWorkflow(): boolean {
    if (!existsSync(workflowPath)) {
        fail('workflow', 'feature-verification.yaml is missing');
        return false;
    }
    const yaml = readFileSync(workflowPath, 'utf8');
    const commands = foldedCommands(yaml);
    let ok = true;
    const expect = (cond: boolean, detail: string) => {
        if (!cond) {
            fail('workflow', detail);
            ok = false;
        }
    };
    expect(yaml.includes(productionCmd), `missing ${productionCmd}`);
    expect(yaml.includes('terminalReason: failed-check'), 'missing terminalReason: failed-check');
    expect(yaml.includes(passGuard), 'PASS guard changed');
    expect(yaml.includes('initialState: verify'), 'initialState changed');
    expect(yaml.includes('iterationBound: 2'), 'iterationBound changed');
    expect(commands.length === 2, `expected 2 folded onEnter commands, found ${commands.length}`);
    expect(commands[0] === bootstrapAction, `bootstrap action mismatch:\n${commands[0] ?? ''}`);
    expect(commands[1] === verifierAction, `verifier action mismatch:\n${commands[1] ?? ''}`);
    expect(!commands.some((command) => command.includes('eval ')), 'action uses eval');
    expect(!yaml.includes('--cmd'), 'workflow passes --cmd');
    expect(!commands.some((command) => command.includes('source-repo')), 'action accepts source-repo');
    const validated = run('spur', ['workflow', 'validate', workflowPath, '--json', '--no-logo'], { timeoutMs: 60_000 });
    writeText(join(evidenceRoot, 'final', 'workflow-validate.json'), validated.stdout || validated.stderr);
    expect(validated.exitCode === 0, `workflow validate exited ${validated.exitCode}: ${validated.stderr}`);
    return ok;
}

function ensureGitIdentity(cwd: string): void {
    const name = run('git', ['config', 'user.name'], { cwd });
    if (name.exitCode !== 0 || name.stdout.trim() === '') {
        run('git', ['config', 'user.name', '0175-fixture'], { cwd });
        run('git', ['config', 'user.email', '0175-fixture@example.com'], { cwd });
    }
}

function commitAll(cwd: string, message: string): CommandResult {
    run('git', ['add', '-A'], { cwd });
    return run('git', ['commit', '-m', message], { cwd });
}

function prepareFixture(stamp: string): { dir: string; featureId: string } | null {
    const dir = join(evidenceRoot, 'fixtures', stamp);
    mkdirSync(join(dir, '.spur', 'workflows'), { recursive: true });
    const init = run('git', ['init', '-q'], { cwd: dir });
    if (init.exitCode !== 0) {
        fail('fixture', `git init failed: ${init.stderr}`);
        return null;
    }
    ensureGitIdentity(dir);
    writeText(join(dir, '.gitignore'), '.spur/\n');
    const yaml = readFileSync(workflowPath, 'utf8');
    if (!yaml.includes(productionCmd)) {
        fail('fixture', 'production verificationCmd was not in the workflow to copy');
        return null;
    }
    writeText(join(dir, '.spur', 'workflows', 'feature-verification.yaml'), yaml.replace(productionCmd, fixtureCmd));
    const baseline = commitAll(dir, 'test: 0175 fixture baseline');
    if (baseline.exitCode !== 0) {
        fail('fixture', `baseline commit failed: ${baseline.stderr}`);
        return null;
    }
    const created = run('spur', ['feature', 'create', '0175 fixture feature', '--json', '--no-logo'], {
        cwd: dir,
        timeoutMs: 60_000,
    });
    writeText(join(evidenceRoot, 'final', `${stamp}-feature-create.json`), created.stdout || created.stderr);
    if (created.exitCode !== 0) {
        fail('fixture', `feature create failed: ${created.stderr}`);
        return null;
    }
    let featureId = '';
    try {
        const parsed = parseJson(created.stdout);
        if (isRecord(parsed) && isRecord(parsed.ref)) featureId = readString(parsed.ref, 'id') ?? '';
    } catch (error) {
        fail('fixture', `feature create JSON: ${String(error)}`);
        return null;
    }
    if (featureId === '') {
        fail('fixture', 'feature create did not return an id');
        return null;
    }
    const featureCommit = commitAll(dir, 'test: 0175 fixture feature');
    if (featureCommit.exitCode !== 0) {
        fail('fixture', `feature commit failed: ${featureCommit.stderr}`);
        return null;
    }
    const toplevel = run('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    if (resolve(toplevel.stdout.trim()) !== resolve(dir)) {
        fail('fixture', `git toplevel ${toplevel.stdout.trim()} is not the fixture`);
        return null;
    }
    return { dir, featureId };
}

function startupCommand(file: string): string {
    const commands = foldedCommands(readFileSync(file, 'utf8'));
    const startup = commands.find(
        (command) =>
            command.includes('script-root.mjs') &&
            command.includes('--run-id "$__runId"') &&
            command.includes('script-root.ts'),
    );
    return startup ?? '';
}

function replayStartup(fixture: string, label: string, command: string, runId: string): void {
    if (command === '') {
        fail('startup', `${label} startup command was not found`);
        return;
    }
    const result = run('sh', ['-c', command], {
        cwd: fixture,
        env: { __runId: runId, spurBin: 'spur' },
        timeoutMs: 60_000,
    });
    writeText(join(evidenceRoot, 'final', `${runId}-${label}.stderr`), result.stderr);
    const artifactPath = join(fixture, '.spur', 'run', `${runId}-script-root.json`);
    if (result.exitCode !== 0) fail('startup', `${label} startup exited ${result.exitCode}`);
    if (vendorWarningCount(result.stderr) !== 0) fail('startup', `${label} emitted a vendor warning after deletion`);
    if (!existsSync(artifactPath)) {
        fail('startup', `${label} did not write a script-root artifact`);
        return;
    }
    const parsed = parseJson(readFileSync(artifactPath, 'utf8'));
    if (!isRecord(parsed) || readString(parsed, 'mode') !== 'installed') {
        fail('startup', `${label} root mode was not installed`);
        return;
    }
    const digest = readString(parsed, 'scriptSetDigest') ?? '';
    if (!digestRe.test(digest)) fail('startup', `${label} digest invalid: ${digest}`);
    writeText(join(evidenceRoot, 'final', `${runId}-${label}-script-root.json`), readFileSync(artifactPath, 'utf8'));
}

function pathWithout(binary: string): string {
    const dirs = new Set(['/bin', '/usr/bin', '/opt/homebrew/bin', '/usr/local/bin']);
    for (const name of ['node', 'bun', 'jq', 'git', 'sh']) {
        const found = commandPath(name);
        if (found !== '') dirs.add(dirname(found));
    }
    const blocked = commandPath(binary);
    const blockedDir = blocked === '' ? '' : dirname(blocked);
    return [...dirs].filter((dir) => dir !== blockedDir).join(':');
}

function readState(fixture: string, runId: string): Record<string, unknown> | null {
    const path = join(fixture, '.spur', 'memory', 'runs', `${runId}.state.json`);
    if (!existsSync(path)) return null;
    const parsed = parseJson(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : null;
}

function runWorkflow(fixture: string, runId: string, featureId: string, pathEnv: string | null): CommandResult {
    const spur = commandPath('spur');
    const env = pathEnv === null ? undefined : { PATH: pathEnv };
    return run(
        spur,
        [
            'workflow',
            'run',
            '.spur/workflows/feature-verification.yaml',
            '--run-id',
            runId,
            '--vars',
            JSON.stringify({ featureId, spurBin: 'spur' }),
            '--no-plan',
            '--quiet',
            '--json',
            '--no-logo',
        ],
        { cwd: fixture, env, timeoutMs: 180_000 },
    );
}

function assertTerminal(fixture: string, runId: string, featureId: string, expectPass: boolean): void {
    const state = readState(fixture, runId);
    const statePath = join(fixture, '.spur', 'memory', 'runs', `${runId}.state.json`);
    if (!state) {
        fail('workflow-run', `missing state ${statePath}`);
        return;
    }
    writeText(join(evidenceRoot, 'final', `${runId}.state.json`), JSON.stringify(state, null, 4));
    const status = readString(state, 'status');
    // 0.3.98 run-state schema carries `status` + `finalizedAt` (no `finalState` field).
    const finalized = readString(state, 'finalizedAt');
    const statusPath = join(fixture, '.spur', 'run', `${runId}-feature-verification.status`);
    const coarse = existsSync(statusPath) ? readFileSync(statusPath, 'utf8').trim() : '';
    if (expectPass) {
        if (status !== 'done' || !finalized) {
            fail('workflow-run', `${runId} terminal status=${status} finalizedAt=${finalized}`);
        }
        if (coarse !== 'PASS') fail('workflow-run', `${runId} coarse status ${coarse} != PASS`);
        const receiptPath = join(fixture, '.spur', 'memory', 'evidence', `${runId}-feature-verification.json`);
        if (!existsSync(receiptPath)) {
            fail('workflow-run', `missing receipt ${receiptPath}`);
            return;
        }
        const receipt = parseJson(readFileSync(receiptPath, 'utf8'));
        writeText(join(evidenceRoot, 'final', `${runId}-receipt.json`), readFileSync(receiptPath, 'utf8'));
        if (!isRecord(receipt)) {
            fail('workflow-run', 'receipt was not an object');
            return;
        }
        if (readString(receipt, 'status') !== 'PASS') fail('workflow-run', 'receipt status was not PASS');
        if (readString(receipt, 'featureId') !== featureId) fail('workflow-run', 'receipt featureId mismatch');
        if (readString(receipt, 'runId') !== runId) fail('workflow-run', 'receipt runId mismatch');
        if (readString(receipt, 'verificationCmd') !== 'bun --version') {
            fail('workflow-run', `receipt command was ${String(receipt.verificationCmd)}`);
        }
        const verifier = receipt.verifier;
        if (!isRecord(verifier) || readString(verifier, 'name') !== 'feature-verification') {
            fail('workflow-run', 'receipt verifier identity missing');
        }
    } else if (status !== 'failed' || !finalized || coarse === 'PASS') {
        fail(
            'workflow-run',
            `${runId} did not fail closed (status=${status} finalizedAt=${finalized} coarse=${coarse})`,
        );
    }
}

function writeMissingVerifierStub(dir: string): { bin: string; script: string } {
    const script = join(dir, 'script-root.mjs');
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const runSlot = '$' + '{runId}';
    const body = [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname, join } from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        'const here = dirname(fileURLToPath(import.meta.url));',
        "let runId = '';",
        'const argv = process.argv.slice(2);',
        'for (let i = 0; i < argv.length; i += 1) {',
        "    if (argv[i] === '--run-id') runId = argv[i + 1] ?? '';",
        '}',
        "const outDir = join(process.cwd(), '.spur', 'run');",
        'mkdirSync(outDir, { recursive: true });',
        "const digest = 'sha256:' + 'ab'.repeat(32);",
        'writeFileSync(join(outDir, `' +
            runSlot +
            "-script-root.json`), JSON.stringify({ mode: 'installed', source: 'global', dir: here, scriptSetDigest: digest }) + '\\n');",
        '',
    ].join('\n');
    writeText(script, body);
    const stub = join(binDir, 'superskill');
    writeText(
        stub,
        [
            '#!/bin/sh',
            'if [ "$1" = "script" ] && [ "$2" = "path" ] && [ "$3" = "sp" ] && [ "$4" = "script-root.mjs" ]; then',
            `  printf '%s\\n' '${script}'`,
            '  exit 0',
            'fi',
            "echo 'stub locator refused' >&2",
            'exit 1',
            '',
        ].join('\n'),
    );
    chmodSync(stub, 0o755);
    return { bin: binDir, script };
}

function runFixtures(runtime: RuntimeReport): void {
    const stamp = String(Date.now());
    const fixture = prepareFixture(stamp);
    if (!fixture) return;
    const index = run('spur', ['workflow', 'list', '--json', '--no-logo'], { timeoutMs: 60_000 });
    let taskFile = '';
    let wrapFile = '';
    try {
        const parsed = parseJson(index.stdout);
        if (!isRecord(parsed) || !Array.isArray(parsed.layers) || !Array.isArray(parsed.entries)) {
            fail('startup', 'workflow list JSON missing layers/entries');
        } else {
            const layers = new Map<string, string>();
            for (const layer of parsed.layers) {
                if (isRecord(layer) && typeof layer.id === 'string' && typeof layer.path === 'string') {
                    layers.set(layer.id, layer.path);
                }
            }
            for (const name of ['task-pipeline', 'wrapup-pipeline'] as const) {
                const entry = parsed.entries.find(
                    (item) =>
                        isRecord(item) &&
                        item.name === name &&
                        item.source === 'shared' &&
                        typeof item.path === 'string',
                );
                const root = layers.get('shared');
                const rel = isRecord(entry) ? readString(entry, 'path') : null;
                const abs = root && rel ? join(root, rel) : '';
                if (name === 'task-pipeline') taskFile = abs;
                else wrapFile = abs;
            }
        }
    } catch (error) {
        fail('startup', `workflow list parse: ${String(error)}`);
    }
    replayStartup(fixture.dir, 'task', taskFile === '' ? '' : startupCommand(taskFile), `t${stamp}`);
    replayStartup(fixture.dir, 'wrapup', wrapFile === '' ? '' : startupCommand(wrapFile), `w${stamp}`);
    const inline = runtime.scripts.find((script) => script.rel === 'inline-run-setup.mjs');
    const setupId = `s${stamp}`;
    if (!inline || inline.path === '') {
        fail('inline', 'inline-run-setup was not resolved');
    } else {
        const setup = run(
            'bun',
            [
                inline.path,
                '--run-id',
                setupId,
                '--file',
                '.spur/workflows/feature-verification.yaml',
                '--spur-bin',
                'spur',
            ],
            { cwd: fixture.dir, timeoutMs: 90_000 },
        );
        writeText(join(evidenceRoot, 'final', `${setupId}-inline.stderr`), setup.stderr);
        if (setup.exitCode !== 0) fail('inline', `inline setup exited ${setup.exitCode}: ${setup.stderr.slice(-1500)}`);
        // ADR-117 (task 0868): a `done` close is rejected with zero action_runs rows —
        // emit the run's trace row between setup and close, as the pipeline driver does.
        const action = run(
            'bun',
            [
                inline.path,
                '--action',
                '--run-id',
                setupId,
                '--node',
                'verify',
                '--kind',
                'shell',
                '--status',
                'done',
                '--ok',
                'true',
                '--duration-ms',
                '1',
                '--spur-bin',
                'spur',
            ],
            { cwd: fixture.dir, timeoutMs: 90_000 },
        );
        writeText(join(evidenceRoot, 'final', `${setupId}-inline-action.stderr`), action.stderr);
        if (action.exitCode !== 0)
            fail('inline', `inline action exited ${action.exitCode}: ${action.stderr.slice(-1500)}`);
        const close = run(
            'bun',
            [inline.path, '--close', '--run-id', setupId, '--status', 'done', '--spur-bin', 'spur'],
            { cwd: fixture.dir, timeoutMs: 90_000 },
        );
        writeText(join(evidenceRoot, 'final', `${setupId}-inline-close.stderr`), close.stderr);
        if (close.exitCode !== 0) fail('inline', `inline close exited ${close.exitCode}: ${close.stderr.slice(-1500)}`);
    }
    const passId = `p${stamp}`;
    const passed = runWorkflow(fixture.dir, passId, fixture.featureId, null);
    writeText(join(evidenceRoot, 'final', `${passId}-workflow.stdout`), passed.stdout);
    writeText(join(evidenceRoot, 'final', `${passId}-workflow.stderr`), passed.stderr);
    if (`${passed.stdout}\n${passed.stderr}`.includes('ignoring vendored')) {
        fail('workflow-run', 'positive workflow emitted an ignored-vendor warning');
    }
    assertTerminal(fixture.dir, passId, fixture.featureId, true);
    const rootArtifact = join(fixture.dir, '.spur', 'run', `${passId}-script-root.json`);
    if (existsSync(rootArtifact)) {
        writeText(join(evidenceRoot, 'final', `${passId}-script-root.json`), readFileSync(rootArtifact, 'utf8'));
        const parsed = parseJson(readFileSync(rootArtifact, 'utf8'));
        const expectedDir = dirname(runtime.scripts.find((script) => script.rel === 'script-root.mjs')?.path ?? '');
        if (
            !isRecord(parsed) ||
            readString(parsed, 'mode') !== 'installed' ||
            readString(parsed, 'dir') !== expectedDir
        ) {
            fail('workflow-run', 'positive run did not record the installed script-root directory');
        }
    } else {
        fail('workflow-run', 'positive run wrote no script-root artifact');
    }
    const limited = pathWithout('superskill');
    const unresolvedProbe = run('sh', ['-c', 'command -v superskill'], { env: { PATH: limited } });
    if (unresolvedProbe.exitCode === 0) fail('workflow-run', 'unresolved PATH still sees superskill');
    const unresolvedId = `u${stamp}`;
    const unresolved = runWorkflow(fixture.dir, unresolvedId, fixture.featureId, limited);
    writeText(join(evidenceRoot, 'final', `${unresolvedId}-workflow.stderr`), unresolved.stderr);
    assertTerminal(fixture.dir, unresolvedId, fixture.featureId, false);
    const stub = writeMissingVerifierStub(join(evidenceRoot, 'fixtures', `${stamp}-missing`));
    const missingId = `m${stamp}`;
    const missing = runWorkflow(fixture.dir, missingId, fixture.featureId, `${stub.bin}:${limited}`);
    writeText(join(evidenceRoot, 'final', `${missingId}-workflow.stderr`), missing.stderr);
    assertTerminal(fixture.dir, missingId, fixture.featureId, false);
}

function blockerFor(runtime: RuntimeReport): string | null {
    const fingerFailed = failures.some((failure) => failure.id === 'fingerprint');
    if (!fingerFailed) return null;
    const same =
        runtime.library.stagedSha256 !== null && runtime.library.stagedSha256 === runtime.library.packagedSha256;
    return [
        'R2 STOP: staged inline fingerprint failed, so workflow and vendor mutations were not started.',
        `entry=${runtime.fingerprint.entry}`,
        `exit=${runtime.fingerprint.exitCode}`,
        `stagedLib=${runtime.library.stagedSha256 ?? 'missing'}`,
        `packagedLib=${runtime.library.packagedSha256 ?? 'missing'}`,
        `librariesMatch=${same}`,
        'No hand-copy, symlink, or source-checkout import was used.',
        runtime.fingerprint.stderr.slice(-2000),
    ].join('\n');
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--preflight')) {
        console.error('usage: bun scripts/verify-sp-install.ts [--preflight]');
        process.exit(2);
    }
    const preflight = args.includes('--preflight');
    mkdirSync(evidenceRoot, { recursive: true });
    const before = mutationPorcelain();
    const runId = preflight ? `pre${Date.now()}` : `fin${Date.now()}`;
    const runtime = captureRuntime(runId);
    runtime.mutationBefore = before;
    runtime.mutationAfter = mutationPorcelain();
    if (runtime.mutationBefore !== runtime.mutationAfter) {
        fail('mutation', `runtime probe changed tracked migration targets:\n${runtime.mutationAfter}`);
    }
    const blocker = blockerFor(runtime);
    if (!preflight && blocker === null) {
        checkDeletion();
        checkRules();
        checkContext();
        scanOperational();
        if (checkWorkflow()) runFixtures(runtime);
        else fail('fixture', 'fixture replays skipped because the workflow contract did not match');
    } else if (!preflight && blocker !== null) {
        fail('mutation', 'final mode refused because the staged fingerprint failed');
    }
    const summary = {
        mode: preflight ? 'preflight' : 'final',
        ok: failures.length === 0,
        blocker,
        failures,
        runtime,
        evidenceRoot: '.spur/run/0175-verification',
        // AC5: the summary identifies every run and artifact. Run ids are embedded
        // in the final/ filenames (p/u/m/s<stamp>-*); fixtures stay unlisted (whole
        // git repos) — their receipts/states are copied into final/.
        artifacts: listArtifacts(),
    };
    writeText(join(evidenceRoot, 'summary.json'), JSON.stringify(summary, null, 4));
    if (failures.length > 0) {
        console.error(`verify-sp-install: FAIL (${failures.length})`);
        for (const failure of failures) console.error(`- ${failure.id}: ${failure.detail.split('\n')[0]}`);
        if (blocker) console.error(blocker);
        console.error(`evidence: ${join(evidenceRoot, 'summary.json')}`);
        process.exit(1);
    }
    console.log(`verify-sp-install: PASS (${preflight ? 'preflight' : 'final'})`);
    console.log(`evidence: ${join(evidenceRoot, 'summary.json')}`);
}

function listArtifacts(): string[] {
    const out: string[] = [];
    for (const sub of ['preflight', 'final']) {
        const dir = join(evidenceRoot, sub);
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
            out.push(`${sub}/${entry}`);
        }
    }
    return out.sort();
}

if (import.meta.main) main();
