/**
 * Task 0286 — installed Smart SEO acceptance (G9, R2/AC2).
 *
 * Packs `@gobing-ai/knowledge-kit` exactly as an install would, extracts the tarball into a
 * throwaway consumer project in an unrelated directory, and then drives the REAL shipped workflow
 * (`plugins/kk/workflows/kk-smart-seo.yaml`) with the REAL shipped stages resolved from that
 * installation alone:
 *
 *   1. the workflow, stage helpers, decision catalogs, skill and skill references must all be
 *      present in the installation — `tests/` is deliberately pruned, so the fixture INPUT is
 *      copied into the consumer project instead of read from the checkout;
 *   2. preflight must fail with the documented `decisions.paths` registration pointer first, then
 *      succeed after the documented append, which preserves every existing entry and maker setting;
 *   3. the fixture workflow must run offline — no network, no real maker, no agent dispatch — and
 *      reach its terminal state with the audit/report artifacts on disk.
 *
 * Isolation is asserted, not assumed: the consumer project's `node_modules` holds only the packed
 * package, every `kk`/`spur` child is spawned from that project's own bin directory, `HOME` is empty
 * (so no machine-level agent/decision config leaks in), provider keys are stripped, and the produced
 * artifacts are checked for any reference back to this checkout or to `vendors/`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(import.meta.dir, '../../..');
const CLI_DIR = join(REPO, 'apps/cli');
const INSTALLED = '@gobing-ai/knowledge-kit';
const PROJECT_NAME = 'kk-installed-smart-seo-fixture';
/** The fixture INPUT is test data: `bundle-plugins.ts` prunes `tests/`, so it ships nowhere. */
const FIXTURE_INPUT = join(REPO, 'plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');
const SEO_STAGES = [
    'seo-stages.ts',
    'seo-fetch.ts',
    'seo-facts.ts',
    'seo-rules.ts',
    'seo-decisions.ts',
    'seo-enrich.ts',
    'seo-report.ts',
] as const;
const SEO_CATALOGS = ['kk-seo-site.yaml', 'kk-seo-page.yaml', 'kk-seo-pair.yaml', 'kk-seo-keyword.yaml'] as const;
const SEO_REFERENCES = ['operations.md', 'method.md', 'seo-geo-sources.md', 'narrative.md'] as const;
const REQUIRED_SEO_DECISIONS = 22;
/** Skill body budget (repo rule R44): 20,000 bytes for `SKILL.md`. */
const SKILL_BODY_BUDGET = 20_000;

/**
 * `bun pm pack` runs the CLI `prepack` hook, which builds the SHARED `apps/cli/dist` +
 * `apps/board/dist` trees; the board acceptance suite packs the same trees. Same lock file as
 * `apps/board/tests/installed-board.test.ts`, so the two suites serialize instead of racing.
 */
const BUILD_LOCK = join(tmpdir(), 'kk-board-shared-build.lock');
const BUILD_LOCK_DEADLINE_MS = 300_000;
const BUILD_LOCK_STALE_MS = 120_000;

const tempDirs: string[] = [];
let project = '';
let installedPkg = '';
let cliEntry = '';
let binDir = '';
let homeDir = '';
let spurArgv: string[] = [];
let projectPathEnv = '';
let fixtureDir = '';
let optionsPath = '';
let runId = '';
let workDir = '';
let configBeforeAppend = '';
let configAfterAppend = '';
let preAppendRun: { status: number; output: string } = { status: -1, output: '' };
let preAppendStage: { status: number; output: string } = { status: -1, output: '' };

/** Resolve the globally installed Spur package when Bun's test resolver cannot see NODE_PATH. */
function resolveSpurPackageRoot(): string {
    try {
        return dirname(fileURLToPath(import.meta.resolve('@gobing-ai/spur/package.json')));
    } catch {
        const which = Bun.which('spur');
        if (which === null) throw new Error('cannot resolve the installed spur CLI; set SPUR_BIN to spur.js');
        let current = dirname(realpathSync(which));
        while (current !== dirname(current)) {
            if (basename(current) === 'spur' && basename(dirname(current)) === '@gobing-ai') return current;
            current = dirname(current);
        }
        throw new Error(`cannot locate the @gobing-ai/spur package behind ${which}`);
    }
}

/** A fresh realpath'd temp dir the suite removes afterwards. */
function realTempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

/**
 * Child environment for every spawned process: an empty `HOME` (no machine-level spur config, so no
 * agent executor and no provider-backed maker resolves), the project's own bin directory ahead of
 * anything else, and no SEO/provider credentials. The point is not to hide the machine from the run
 * but to prove the run needs nothing from it.
 */
function childEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) continue;
        // The active-run markers leak in when this suite runs under an outer `spur workflow run`
        // (feature verification); the nested run would refuse to start.
        if (/^(HOME|PATH|KK_SPUR_BIN|SPUR_BIN|SPUR_WORKFLOW_RUN_ACTIVE|SPUR_EXPECTED_DEFINITION_DIGEST)$/.test(key))
            continue;
        if (/API_KEY$|_TOKEN$|^CLOUDFLARE_/.test(key)) continue;
        env[key] = value;
    }
    env.HOME = homeDir;
    env.PATH = projectPathEnv;
    // The stages' internal `spur decision` dispatch resolves this absolute shim, never a PATH guess.
    env.KK_SPUR_BIN = join(binDir, 'spur');
    return env;
}

/** Run a short command to completion; a non-zero exit is a loud setup failure unless tolerated. */
function shell(command: string, args: string[], cwd: string): { status: number; output: string; stdout: string } {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        env: childEnv(),
        maxBuffer: 64 * 1024 * 1024,
    });
    return {
        status: result.status ?? -1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        stdout: result.stdout ?? '',
    };
}

/** Run a command that must succeed, returning its combined output for evidence. */
function shellOk(command: string, args: string[], cwd: string): string {
    const { status, output } = shell(command, args, cwd);
    if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${status}): ${output}`);
    return output;
}

/** Run the installed spur CLI (`spur.js` under the current Bun) with `args` in the consumer project. */
function spur(args: string[], cwd = project): { status: number; output: string; stdout: string } {
    const [command = process.execPath, ...rest] = spurArgv;
    return shell(command, [...rest, '--no-logo', ...args], cwd);
}

/**
 * Serialize the shared workspace build against other packers. A crashed holder's lock is reclaimed
 * after a grace period shorter than the waiter deadline, so a killed pack never wedges the suite.
 */
function withBuildLock<T>(fn: () => T): T {
    const deadline = Date.now() + BUILD_LOCK_DEADLINE_MS;
    let fd: number | null = null;
    while (fd === null) {
        try {
            fd = openSync(BUILD_LOCK, 'wx');
        } catch {
            try {
                if (Date.now() - statSync(BUILD_LOCK).mtimeMs > BUILD_LOCK_STALE_MS)
                    rmSync(BUILD_LOCK, { force: true });
            } catch {
                // the lock vanished between attempts — just retry
            }
            if (Date.now() > deadline) throw new Error('timed out acquiring the shared build/pack lock');
            spawnSync('sleep', ['0.2']);
        }
    }
    try {
        return fn();
    } finally {
        closeSync(fd);
        rmSync(BUILD_LOCK, { force: true });
    }
}

/** Resolve the installed spur CLI: `$SPUR_BIN`, then the workspace dependency, then the PATH. */
function resolveSpur(): string[] {
    const override = process.env.SPUR_BIN;
    if (override !== undefined && override !== '') return [process.execPath, override];
    return [process.execPath, join(resolveSpurPackageRoot(), 'spur.js')];
}

/**
 * Place the orchestrator beside the packed package, as a global install does.
 *
 * The shipped SEO catalogs declare `$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"`,
 * and Spur resolves a catalog's declared schema through the module tree above that catalog's own
 * directory. A consumer therefore needs `spur` resolvable from the installed KK package — true by
 * construction for `bun add -g` (both packages are siblings in the global tree) and needed
 * explicitly for a project-local install. Without it the catalogs load-fail with a
 * `Cannot resolve package schema` error, which is what the documented setup must prevent.
 */
function linkOrchestratorPackage(): void {
    const target = resolveSpurPackageRoot();
    const link = join(project, 'node_modules/@gobing-ai/spur');
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, 'dir');
}

/** The workflow var object (the options file path is data, never shell source). */
function workflowVars(): string {
    return JSON.stringify({ options_file: optionsPath });
}

/**
 * The documented consumer project config: a pre-existing local catalog directory and an explicit
 * maker setting, which the SEO registration step must preserve.
 */
function writeConsumerConfig(paths: string[]): void {
    writeFileSync(
        join(project, '.spur/config.yaml'),
        [
            '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
            'version: "1.2"',
            `name: ${PROJECT_NAME}`,
            'bootstrap:',
            '  database: { enabled: true, driver: bun-sqlite, url: .spur/spur.db }',
            '  scheduler: { enabled: false }',
            'decisions:',
            '  paths:',
            ...paths.map((path) => `    - ${path}`),
            '  maker: typesafe',
            '  makers:',
            '    consumer-demo-verdict: typesafe',
            '',
        ].join('\n'),
        'utf-8',
    );
}

/** The consumer-owned catalog that must keep working after the SEO path is appended. */
function writeConsumerCatalog(): string {
    const dir = join(project, 'catalogs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'consumer-demo.yaml'),
        [
            '$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"',
            'version: 1',
            'defaults:',
            '  minConfidence: 0',
            'decisions:',
            '  consumer-demo-verdict:',
            '    type: choice',
            '    description: Consumer-local demonstration decision that the SEO registration must not disturb.',
            '    parameters:',
            '      subject_id:',
            '        type: string',
            '        description: Subject identifier.',
            '    criteria:',
            '      yes: The evidence supports the consumer decision.',
            '      no: The evidence contradicts the consumer decision.',
            '    fallback: no',
            '',
        ].join('\n'),
        'utf-8',
    );
    return dir;
}

/**
 * The documented catalog registration: APPEND `<package-root>/plugins/kk/decisions` to the project's
 * `decisions.paths` and change nothing else. Written as a text append on purpose — a YAML
 * round-trip would silently reorder or drop the operator's maker settings.
 */
function appendInstalledCatalogPath(configPath: string): void {
    const source = readFileSync(configPath, 'utf-8');
    const lines = source.split('\n');
    const pathsIndex = lines.findIndex((line) => /^ {2}paths:$/.test(line));
    if (pathsIndex < 0) throw new Error(`consumer config has no decisions.paths block: ${configPath}`);
    let last = pathsIndex;
    while (last + 1 < lines.length && /^ {4}- /.test(lines[last + 1] ?? '')) last += 1;
    lines.splice(last + 1, 0, `    - ${join(installedPkg, 'plugins/kk/decisions')}`);
    writeFileSync(configPath, lines.join('\n'), 'utf-8');
}

/** Options JSON for the offline fixture run, with the fixture input copied into this project. */
function writeOptions(): { path: string; fixture: string } {
    const fixture = join(project, 'seo-fixture-input');
    mkdirSync(fixture, { recursive: true });
    writeFileSync(join(fixture, 'smart-seo-minimal-crawl.json'), readFileSync(FIXTURE_INPUT, 'utf-8'), 'utf-8');
    const path = join(project, 'options.json');
    writeFileSync(
        path,
        JSON.stringify({
            url: 'https://example.com',
            locale: 'en-US',
            business_context: '',
            max_pages: 60,
            max_depth: 5,
            max_requests: 200,
            deadline_seconds: 600,
            semantic_pages: 20,
            max_pairs: 10,
            max_keywords: 10,
            max_decision_calls: 320,
            performance: false,
            visibility_file: '',
            fixture,
        }),
        'utf-8',
    );
    return { path, fixture };
}

/** Write the consumer project's own `kk`/`spur` shims — both anchored on the packed installation. */
function writeBinShims(installedEntry: string): void {
    mkdirSync(binDir, { recursive: true });
    const kk = join(binDir, 'kk');
    writeFileSync(
        kk,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(installedEntry)} "$@"\n`,
        'utf-8',
    );
    chmodSync(kk, 0o755);
    const [spurCommand = process.execPath, ...spurArgs] = spurArgv;
    const spurPath = join(binDir, 'spur');
    writeFileSync(
        spurPath,
        `#!/bin/sh\nexec ${JSON.stringify(spurCommand)} ${[...spurArgs, '--no-logo'].map((a) => JSON.stringify(a)).join(' ')} "$@"\n`,
        'utf-8',
    );
    chmodSync(spurPath, 0o755);
}

/** Pack the CLI (honoring `prepack`) and extract the tarball into `<project>/node_modules`. */
function installPackedPackage(): { installedPkg: string; entry: string } {
    const packDir = realTempDir('kk-installed-smart-seo-pack-');
    const packed = withBuildLock(() => shell('bun', ['pm', 'pack', '--destination', packDir, '--quiet'], CLI_DIR));
    // `bun pm pack --quiet` prints the tarball path as the last stdout line; the prepack build log
    // rides stderr, so the two streams are never concatenated here.
    const tarball = packed.stdout.trim().split('\n').pop()?.trim() ?? '';
    if (packed.status !== 0 || !tarball.endsWith('.tgz') || !existsSync(tarball)) {
        throw new Error(`bun pm pack produced an unexpected artifact: ${tarball} (${packed.status}): ${packed.output}`);
    }
    const target = join(project, 'node_modules', INSTALLED);
    mkdirSync(target, { recursive: true });
    shellOk('tar', ['-xzf', tarball, '-C', target, '--strip-components=1'], project);
    const entry = join(target, 'dist/index.js');
    if (!existsSync(entry)) throw new Error(`the packed install does not carry the kk binary: ${entry}`);
    return { installedPkg: target, entry };
}

/** Setup: pack, install, prepare the consumer project, prove the missing-catalog failure first. */
async function setup(): Promise<void> {
    spurArgv = resolveSpur();
    project = realTempDir('kk-installed-smart-seo-project-');
    homeDir = realTempDir('kk-installed-smart-seo-home-');
    binDir = join(project, 'bin');
    mkdirSync(join(project, '.spur'), { recursive: true });
    mkdirSync(join(homeDir, '.config'), { recursive: true });
    // The child PATH exists before the shims do: the pack itself runs under this environment.
    projectPathEnv = [
        binDir,
        ...(process.env.PATH ?? '').split(':').filter((part) => part !== '' && !part.startsWith(REPO)),
    ].join(':');

    const installed = installPackedPackage();
    installedPkg = installed.installedPkg;
    cliEntry = installed.entry;
    linkOrchestratorPackage();
    writeBinShims(cliEntry);

    const catalogsDir = writeConsumerCatalog();
    writeConsumerConfig([catalogsDir]);
    const written = writeOptions();
    optionsPath = written.path;
    fixtureDir = written.fixture;
    configBeforeAppend = readFileSync(join(project, '.spur/config.yaml'), 'utf-8');

    // 1. Before the documented registration the integrated workflow must fail loudly, naming both
    //    the missing contracts and the registration fix — a silent pass here would be the defect.
    const run = spur([
        'workflow',
        'run',
        join(installedPkg, 'plugins/kk/workflows/kk-smart-seo.yaml'),
        '--run-id',
        'seo-before-registration',
        '--vars',
        workflowVars(),
        '--quiet',
    ]);
    preAppendRun = { status: run.status, output: run.output };
    // The workflow engine routes action output through its own reporter, so the registration text
    // is asserted at the stage boundary the workflow calls (same installed CLI, same arguments).
    preAppendStage = shell(
        join(binDir, 'kk'),
        ['stage', 'run', 'seo-preflight', '', optionsPath, 'seo-preflight-before-registration', 'true'],
        project,
    );

    // 2. The documented setup, then the real run.
    appendInstalledCatalogPath(join(project, '.spur/config.yaml'));
    configAfterAppend = readFileSync(join(project, '.spur/config.yaml'), 'utf-8');
    runId = `seo-installed-${Date.now()}`;
    const auditRun = spur([
        'workflow',
        'run',
        join(installedPkg, 'plugins/kk/workflows/kk-smart-seo.yaml'),
        '--run-id',
        runId,
        '--vars',
        workflowVars(),
        '--quiet',
    ]);
    if (auditRun.status !== 0) {
        throw new Error(`installed kk-smart-seo run failed (${auditRun.status}): ${auditRun.output}`);
    }
    if (!auditRun.output.includes('workflow done')) {
        throw new Error(`the installed workflow did not report a terminal state: ${auditRun.output}`);
    }
    const workDirFile = join(project, '.spur/run', `${runId}-seo-work-dir.txt`);
    if (!existsSync(workDirFile)) throw new Error(`the run did not bind its work dir: ${workDirFile}`);
    workDir = readFileSync(workDirFile, 'utf-8').trim();
}

beforeAll(async () => {
    await setup();
}, 600_000);

afterAll(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('installed smart-seo installation — self-contained runtime assets (R2/AC2)', () => {
    it('ships the workflow, every stage helper, the catalogs, the skill and its references', () => {
        expect(existsSync(join(installedPkg, 'plugins/kk/workflows/kk-smart-seo.yaml'))).toBe(true);
        expect(existsSync(join(installedPkg, 'plugins/kk/scripts/kk-workflow-stages.ts'))).toBe(true);
        for (const helper of SEO_STAGES) {
            expect(existsSync(join(installedPkg, 'plugins/kk/scripts', helper)), helper).toBe(true);
        }
        for (const catalog of SEO_CATALOGS) {
            expect(existsSync(join(installedPkg, 'plugins/kk/decisions', catalog)), catalog).toBe(true);
        }
        expect(existsSync(join(installedPkg, 'plugins/kk/skills/smart-seo/SKILL.md'))).toBe(true);
        for (const reference of SEO_REFERENCES) {
            expect(existsSync(join(installedPkg, 'plugins/kk/skills/smart-seo/references', reference)), reference).toBe(
                true,
            );
        }
        expect(existsSync(join(installedPkg, 'plugins/kk/references/smart-seo-attribution.md'))).toBe(true);
    });

    it('resolves its helpers from node/bun builtins only — no ancestor node_modules dependency', () => {
        // The packed tree has no node_modules at all, so a bare specifier here (the ancestor-resolved
        // `linkedom` / `fast-xml-parser` class this task was told not to rely on) would only fail at
        // run time, far from the change that introduced it.
        const files = [
            join(installedPkg, 'plugins/kk/scripts/kk-workflow-stages.ts'),
            ...SEO_STAGES.map((helper) => join(installedPkg, 'plugins/kk/scripts', helper)),
        ];
        for (const file of files) {
            for (const line of readFileSync(file, 'utf-8').split('\n')) {
                const match = /^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/.exec(line);
                if (match === null) continue;
                const specifier = match[1] ?? '';
                expect(specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../')).toBe(
                    true,
                );
            }
        }
    });

    it('does not ship the test-only fixture input or any test file', () => {
        expect(existsSync(join(installedPkg, 'plugins/kk/tests'))).toBe(false);
        const staged = spawnSync(
            'sh',
            [
                '-c',
                `find ${JSON.stringify(join(installedPkg, 'plugins'))} -name '*.test.ts' -o -name 'smart-seo-minimal-crawl.json'`,
            ],
            { encoding: 'utf-8' },
        );
        expect(staged.stdout.trim()).toBe('');
        // The input the run consumed is the copy made inside the consumer project (see the run test).
        expect(existsSync(join(fixtureDir, 'smart-seo-minimal-crawl.json'))).toBe(true);
    });

    it('keeps the skill body inside the 20,000-byte budget with its label, crawler and no-promise contract', () => {
        const skill = readFileSync(join(installedPkg, 'plugins/kk/skills/smart-seo/SKILL.md'), 'utf-8');
        expect(Buffer.byteLength(skill, 'utf-8')).toBeLessThanOrEqual(SKILL_BODY_BUDGET);
        // R1's contract must survive packaging, so assert the sentinels rather than the prose.
        for (const sentinel of [
            'heuristic',
            'vendors/',
            'user-triggered',
            'no ranking, citation, traffic or revenue promise',
            'consultation',
            'Offline rescoring',
        ]) {
            expect(skill.toLowerCase()).toContain(sentinel.toLowerCase());
        }
        expect(skill).toContain('references/method.md');
        expect(skill).toContain('references/seo-geo-sources.md');
        expect(skill).toContain('references/narrative.md');
        expect(skill).toContain('references/operations.md');
    });
});

describe('installed smart-seo catalog registration (R2/AC2)', () => {
    it('fails the integrated preflight before registration, naming the contracts and the fix', () => {
        expect(preAppendRun.status).not.toBe(0);
        expect(preAppendRun.output).toContain('workflow failed: kk-smart-seo -> preflight');
        expect(preAppendStage.status).not.toBe(0);
        expect(preAppendStage.output).toContain('SEO decision catalogs are not served');
        expect(preAppendStage.output).toContain('kk-seo-site.yaml');
        expect(preAppendStage.output).toContain('decisions.paths');
        expect(preAppendStage.output).toContain('preserving every existing entry and maker setting');
    });

    it('appends the installed catalog path without replacing an existing path or maker setting', () => {
        const appended = join(installedPkg, 'plugins/kk/decisions');
        expect(configAfterAppend).toContain(appended);
        for (const line of configBeforeAppend.split('\n')) {
            if (line.trim() === '') continue;
            expect(configAfterAppend).toContain(line);
        }
        expect(configAfterAppend).toContain('consumer-demo-verdict: typesafe');
    });

    it('serves the consumer catalog and all 22 SEO decisions under an offline maker', () => {
        const status = spur(['decision', 'status', '--json']);
        expect(status.status).toBe(0);
        const parsed = JSON.parse(status.stdout) as {
            loadErrors: unknown[];
            duplicateIds: unknown[];
            configDefaultMaker: string;
            perDecision: { id: string; maker: string; layer: string }[];
        };
        expect(parsed.loadErrors).toEqual([]);
        expect(parsed.duplicateIds).toEqual([]);
        expect(parsed.configDefaultMaker).toBe('typesafe');
        const ids = parsed.perDecision.map((row) => row.id);
        expect(ids).toContain('consumer-demo-verdict');
        expect(ids.filter((id) => id.startsWith('kk-seo-')).length).toBe(REQUIRED_SEO_DECISIONS);
        expect(parsed.loadErrors).toEqual([]);
        const consumerRow = parsed.perDecision.find((row) => row.id === 'consumer-demo-verdict');
        expect(consumerRow?.maker).toBe('typesafe');

        const shown = spur(['decision', 'show', 'kk-seo-page-type', '--json']);
        expect(shown.status).toBe(0);
        const detail = JSON.parse(shown.stdout) as {
            catalog: string;
            layer: string;
            effectiveMaker: { name: string; source: string };
        };
        // The catalog must resolve inside the INSTALLATION, not in this checkout or an ancestor.
        expect(detail.catalog.startsWith(installedPkg)).toBe(true);
        expect(detail.catalog.startsWith(REPO)).toBe(false);
        expect(detail.layer).toBe('registered');
        expect(detail.effectiveMaker).toEqual({ name: 'typesafe', source: 'config-default' });

        const listed = spur(['decision', 'list', '--json']);
        expect(listed.status).toBe(0);
        const rows = JSON.parse(listed.stdout) as { id: string; source?: string }[];
        const consumerEntry = rows.find((row) => row.id === 'consumer-demo-verdict');
        expect(consumerEntry?.source?.startsWith(project)).toBe(true);
    });

    it('dispatches an offline maker to its declared fallback instead of reaching a provider', () => {
        const run = spur([
            'decision',
            'run',
            'kk-seo-importance',
            '--param',
            'subject_id=https://example.com',
            '--param',
            'locale=en-US',
            '--json',
        ]);
        expect(run.status).toBe(0);
        const result = JSON.parse(run.stdout) as { maker: string; source: string; reason: string; value: number };
        expect(result.maker).toBe('typesafe');
        expect(result.source).toBe('default');
        expect(result.reason).toBe('no-backend');
        expect(result.value).toBe(0);
    });
});

describe('installed smart-seo fixture workflow — offline execution (R2/AC2)', () => {
    it('binds a run workspace inside the unrelated consumer project', () => {
        expect(workDir.startsWith(project)).toBe(true);
        expect(workDir).toContain('.works/kk-smart-seo');
        expect(workDir.startsWith(REPO)).toBe(false);
    });

    it('collects the copied fixture input, not any checkout fixture', () => {
        const crawl = JSON.parse(readFileSync(join(workDir, 'crawl.json'), 'utf-8')) as {
            pages: { url: string }[];
            limits: { requestsMade: number };
            requests: { url: string }[];
        };
        expect(crawl.pages.map((page) => page.url)).toEqual(['https://example.com/']);
        expect(crawl.limits.requestsMade).toBe(2);
        // A fixture run performs no live request: every recorded request URL is the fixture's own.
        expect(crawl.requests.every((request) => request.url.startsWith('https://example.com'))).toBe(true);
    });

    it('reaches the terminal state with the audit, report and coverage artifacts', () => {
        for (const artifact of [
            'options.json',
            'manifest.json',
            'crawl.json',
            'checks.json',
            'judgments.json',
            'audit.json',
            'report.json',
            'report.md',
        ]) {
            expect(existsSync(join(workDir, artifact)), artifact).toBe(true);
        }
        const report = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf-8')) as {
            status: string;
            narrativeStatus: string;
            runId: string;
            actionsCount: number;
            coverage: { assessed: number; totalRules: number };
        };
        expect(report.status).toBe('done');
        expect(report.runId).toBe(runId);
        expect(report.coverage.totalRules).toBe(52);
        expect(report.coverage.assessed).toBeGreaterThan(0);
        // No agent executor resolves under the empty HOME, so the OPTIONAL narrative settles as
        // absent/rejected and the deterministic summary is delivered — never an audit failure.
        expect(['omitted', 'rejected']).toContain(report.narrativeStatus);
        const markdown = readFileSync(join(workDir, 'report.md'), 'utf-8');
        expect(markdown).toContain('- Coverage:');
        expect(markdown).toContain('- Crawl limits:');
        expect(/Narrative (omitted|rejected)/.test(markdown)).toBe(true);

        const audit = JSON.parse(readFileSync(join(workDir, 'audit.json'), 'utf-8')) as {
            runId: string;
            status: string;
            limits: { pagesVisited: number };
            judgments: { status: string };
        };
        expect(audit.runId).toBe(runId);
        expect(audit.limits.pagesVisited).toBe(1);
        // Every decision dispatch fell back offline: the judgments stay `not-assessed`, never a guess.
        expect(audit.judgments.status).toBe('not-assessed');
    });

    it('keeps unrelated KK workflows and decision catalogs working from the same installation', () => {
        for (const workflow of ['kk-smart-seo.yaml', 'kk-collect.yaml']) {
            const validated = spur(['workflow', 'validate', join(installedPkg, 'plugins/kk/workflows', workflow)]);
            expect(validated.status, validated.output).toBe(0);
        }
        const consumer = spur(['decision', 'show', 'consumer-demo-verdict', '--json']);
        expect(consumer.status).toBe(0);
        const detail = JSON.parse(consumer.stdout) as { catalog: string; effectiveMaker: { name: string } };
        expect(detail.catalog.startsWith(project)).toBe(true);
        expect(detail.effectiveMaker.name).toBe('typesafe');
    });

    it('resolves every runtime asset from the installation — no checkout, vendor or ancestor dependency', () => {
        // Only the packed package lives in the consumer project's node_modules; there is no ancestor
        // module tree to fall back to (the project is a bare temp directory).
        expect(readdirSync(join(project, 'node_modules')).sort()).toEqual(['@gobing-ai']);
        expect(readdirSync(join(project, 'node_modules/@gobing-ai')).sort()).toEqual(['knowledge-kit', 'spur']);
        expect(existsSync(join(project, 'vendors'))).toBe(false);

        // No artifact may carry a developer path back to this checkout or to the reference-only
        // vendor snapshot — a pass here is what makes the run relocatable.
        for (const artifact of ['manifest.json', 'report.json', 'report.md', 'audit.json', 'crawl.json']) {
            const text = readFileSync(join(workDir, artifact), 'utf-8');
            expect(text.includes(REPO), artifact).toBe(false);
            expect(text.includes('vendors/'), artifact).toBe(false);
        }
        const options = JSON.parse(readFileSync(join(workDir, 'options.json'), 'utf-8')) as { fixture: string };
        expect(options.fixture).toBe(fixtureDir);
        expect(options.fixture.startsWith(project)).toBe(true);
    });
});
