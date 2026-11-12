#!/usr/bin/env bun
/**
 * Publish an already-written article through the kk-itc publish tail.
 *
 * The tail (`plugins/kk/workflows/kk-itc-publish-tail.yaml`) starts at `check-targets`, so it needs
 * a work_dir that already carries a frozen `itc-options.json` (itc-send-targets refuses without a
 * parentRunId) and a `4-publish/publish-plan.json`. This script seeds that state from a Markdown
 * file, then drives the tail: authoring is never re-run.
 *
 * usage:
 *   bun run publish:article -- <article.md> [flags]
 *
 *   --slug <slug>        work_dir leaf under <works_dir>/kk-itc (default: file stem)
 *   --locale en|zh|ja    source locale (default: detected from the text)
 *   --preset <slug>      publish preset (default: config workflows.kk-itc.publish_preset)
 *   --targets <a,b>      explicit publish plugins (overrides the preset)
 *   --variant <name>=<path>  supply content.<name>.json from a translated Markdown file
 *                             (repeatable; e.g. --variant ja-article=./ja.md)
 *   --tags <a,b>         frontmatter tags (brief.md) — channels with a strict site schema
 *                             (surfdash-pub) refuse a post without them
 *   --description <text> excerpt / SEO description (brief.md); defaults to the draft's opening sentence
 *   --cover <path>       copy into 4-illustrations/cover.<ext> (wechatmp-pub requires one)
 *   --title <text>       title override (default: the draft's first H1)
 *   --work-dir <dir>     reuse an existing work_dir instead of seeding a fresh one
 *   --live               publish_live=true (default: draft — real remote drafts, not live posts)
 *   --plan-only          materialize and check the plan, never send
 *   --copy-source        let cross-locale variants fall back to the source content
 *   --yes                approve the send-confirm pause without asking
 *   --dry-run            seed + plan, print, exit (no workflow run)
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..');
const TAIL = join(REPO, 'plugins/kk/workflows/kk-itc-publish-tail.yaml');
const DRAFT = '3-draft-draft-article.md';

interface Flags {
    article: string;
    slug: string;
    locale: 'en' | 'zh' | 'ja' | '';
    preset: string;
    targets: string;
    variants: string[];
    tags: string;
    description: string;
    cover: string;
    title: string;
    workDir: string;
    live: boolean;
    planOnly: boolean;
    copySource: boolean;
    yes: boolean;
    dryRun: boolean;
}

interface Plan {
    live: boolean;
    sourceLocale: string;
    variants: Record<string, { file: string; adapt: boolean; limits?: Record<string, { max: number }> }>;
    fanout: { variant: string; targets: string[] }[];
    browser: { target: string; variant: string }[];
    targets?: { target: string; variant: string; transport: string; mode: string }[];
}

const USAGE =
    'usage: bun run publish:article -- <article.md> [--slug s] [--locale en|zh|ja] [--preset s]\n' +
    '       [--targets a,b] [--variant name=path.md ...] [--tags a,b] [--description text]\n' +
    '       [--cover p] [--title t] [--work-dir d] [--live] [--plan-only] [--copy-source] [--yes] [--dry-run]';

function fail(message: string): never {
    process.stderr.write(`publish-article: ${message}\n`);
    process.exit(1);
}

function parseArgs(argv: string[]): Flags {
    const flags: Flags = {
        article: '',
        slug: '',
        locale: '',
        preset: '',
        targets: '',
        variants: [],
        tags: '',
        description: '',
        cover: '',
        title: '',
        workDir: '',
        live: false,
        planOnly: false,
        copySource: false,
        yes: false,
        dryRun: false,
    };
    const valued = new Set([
        '--slug',
        '--locale',
        '--preset',
        '--targets',
        '--variant',
        '--tags',
        '--description',
        '--cover',
        '--title',
        '--work-dir',
    ]);
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] ?? '';
        if (valued.has(arg)) {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
            i += 1;
            switch (arg) {
                case '--slug':
                    flags.slug = value;
                    break;
                case '--locale':
                    if (!['en', 'zh', 'ja'].includes(value)) fail('--locale must be en|zh|ja');
                    flags.locale = value as Flags['locale'];
                    break;
                case '--preset':
                    flags.preset = value;
                    break;
                case '--targets':
                    flags.targets = value;
                    break;
                case '--variant':
                    flags.variants.push(value);
                    break;
                case '--tags':
                    flags.tags = value;
                    break;
                case '--description':
                    flags.description = value;
                    break;
                case '--cover':
                    flags.cover = value;
                    break;
                case '--title':
                    flags.title = value;
                    break;
                case '--work-dir':
                    flags.workDir = value;
                    break;
                default:
                    break;
            }
            continue;
        }
        if (arg === '--live') flags.live = true;
        else if (arg === '--plan-only') flags.planOnly = true;
        else if (arg === '--copy-source') flags.copySource = true;
        else if (arg === '--yes') flags.yes = true;
        else if (arg === '--dry-run') flags.dryRun = true;
        else if (arg === '-h' || arg === '--help') {
            process.stdout.write(`${USAGE}\n`);
            process.exit(0);
        } else if (arg.startsWith('-')) fail(`unknown flag ${arg}`);
        else if (flags.article === '') flags.article = arg;
        else fail(`unexpected argument ${arg}`);
    }
    return flags;
}

function readConfig(): Record<string, unknown> {
    const path = process.env.KK_CONFIG || join(homedir(), '.config/kk/config.yaml');
    if (!existsSync(path)) return {};
    const parsed: unknown = Bun.YAML.parse(readFileSync(path, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${path} is not a YAML mapping`);
    return parsed as Record<string, unknown>;
}

function kebab(value: string): string {
    return value
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

/** CJK text defaults to zh; kana to ja; otherwise en. */
function detectLocale(text: string): 'en' | 'zh' | 'ja' {
    if (/[\u3040-\u30ff]/.test(text)) return 'ja';
    const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return cjk > 40 ? 'zh' : 'en';
}

function run(command: string, args: string[], label: string): void {
    const res = spawnSync(command, args, { stdio: 'inherit', cwd: REPO });
    if (res.error) fail(`${label}: ${res.error.message}`);
    if (res.status !== 0) fail(`${label} failed (exit ${res.status ?? 'signal'})`);
}

function main(): void {
    const flags = parseArgs(process.argv.slice(2));
    if (flags.article === '') {
        process.stderr.write(`${USAGE}\n`);
        process.exit(1);
    }
    const articlePath = resolve(process.cwd(), flags.article.replace(/^~(?=\/)/, homedir()));
    if (!existsSync(articlePath)) fail(`article not found: ${articlePath}`);

    const config = readConfig();
    const workflows = (config.workflows ?? {}) as Record<string, { publish_preset?: string } | undefined>;
    const worksRoot = resolve(process.cwd(), String((config.works_dir as string | undefined) ?? join(REPO, '.works')));

    const raw = readFileSync(articlePath, 'utf-8');
    const stem = basename(articlePath, extname(articlePath));
    const slug = kebab(flags.slug || stem) || 'itc-run';
    const locale = flags.locale || detectLocale(raw);
    const runId = `${flags.planOnly ? 'publish-plan' : 'publish'}-${slug}-${Date.now()}`;

    // --- seed the work_dir -------------------------------------------------
    const workDir = flags.workDir ? resolve(process.cwd(), flags.workDir) : join(worksRoot, 'kk-itc', slug);
    mkdirSync(join(workDir, '4-illustrations'), { recursive: true });

    if (!flags.workDir) {
        // Frontmatter feeds materialize's brief.md reader (tags / keywords / description).
        let body = raw;
        const brief: string[] = [];
        const front = /^---\n([\s\S]*?)\n---\n/.exec(raw);
        if (front) {
            body = raw.slice(front[0].length);
            const meta: Record<string, unknown> = (Bun.YAML.parse(front[1] ?? '') ?? {}) as Record<string, unknown>;
            for (const key of ['title', 'tags', 'keywords', 'description']) {
                const value = meta[key];
                if (value === undefined) continue;
                brief.push(`${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}`);
            }
        }
        if (flags.tags !== '')
            brief.push(
                `tags: [${flags.tags
                    .split(',')
                    .map((t) => t.trim())
                    .join(', ')}]`,
            );
        if (flags.description !== '') brief.push(`description: ${flags.description}`);
        if (brief.length > 0) writeFileSync(join(workDir, 'brief.md'), `---\n${brief.join('\n')}\n---\n`);
        // materialize takes the title from the first H1 and removes that line from the body.
        if (!/^#\s+\S/m.test(body)) {
            const title = flags.title || stem.replace(/[-_]+/g, ' ');
            body = `# ${title}\n\n${body.trimStart()}`;
        }
        writeFileSync(join(workDir, DRAFT), body);
        process.stdout.write(`seed   ${workDir}/${DRAFT}\n`);
    } else {
        if (!existsSync(join(workDir, DRAFT))) fail(`${workDir} has no ${DRAFT}; drop the article there first`);
        process.stdout.write(`reuse  ${workDir}\n`);
    }

    if (flags.cover !== '') {
        const coverPath = resolve(process.cwd(), flags.cover.replace(/^~(?=\/)/, homedir()));
        if (!existsSync(coverPath)) fail(`cover not found: ${coverPath}`);
        const dest = join(workDir, '4-illustrations', `cover${extname(coverPath) || '.png'}`);
        copyFileSync(coverPath, dest);
        process.stdout.write(`cover  ${dest}\n`);
    }

    // --- freeze the effective options -------------------------------------
    // The tail's send/report stages read parentRunId from here; a snapshot from another run is
    // refused unless force, so the script owns its own run id and freezes that.
    const launchPath = join(workDir, '.publish-launch.json');
    const launch: Record<string, unknown> = {
        topic: slug,
        workDir,
        sourceLocale: locale,
        publishLive: flags.live,
        parentRunId: runId,
        projectRoot: REPO,
        force: true,
    };
    if (flags.preset !== '') launch.publishPreset = flags.preset;
    if (flags.targets !== '') launch.publishTargets = flags.targets;
    writeFileSync(launchPath, `${JSON.stringify(launch, null, 2)}\n`);
    run('kk', ['stage', 'run', 'itc-prepare', '--request', launchPath], 'itc-prepare');

    // --- materialize content.json + publish-plan.json ----------------------
    // The plan names the variants each target needs (and their profile limits).
    run('kk', ['stage', 'run', 'itc-materialize-plan', workDir], 'itc-materialize-plan');
    const planPath = join(workDir, '4-publish/publish-plan.json');
    if (!existsSync(planPath)) fail(`plan not written: ${planPath}`);
    const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as Plan;

    if (!plan.targets || plan.targets.length === 0) {
        const configured = workflows['kk-itc']?.publish_preset;
        fail(
            'plan resolved zero targets: pass --targets or --preset, or set workflows.kk-itc.publish_preset' +
                ` in the config (currently: ${configured ?? 'unset'})`,
        );
    }

    // --- variant files ----------------------------------------------------
    // The tail never adapts: it only verifies. Same-locale variants share the source article, so
    // they are filled by copy; a cross-locale variant needs a translated file or the target would
    // silently receive source-locale text.
    const sourceContent = join(workDir, '4-publish/content.json');
    const supplied = new Map<string, string>();
    for (const spec of flags.variants) {
        const eq = spec.indexOf('=');
        if (eq <= 0) fail(`--variant needs name=path, got ${spec}`);
        supplied.set(spec.slice(0, eq), spec.slice(eq + 1));
    }
    for (const name of [...supplied.keys()]) {
        // A translation for a variant this plan does not use is not an error (a narrower
        // --targets run still gets the same command line); it is just unused.
        if (plan.variants[name] === undefined) {
            process.stdout.write(`skip   --variant ${name} (not in this plan)\n`);
            supplied.delete(name);
        }
    }

    for (const [variant, entry] of Object.entries(plan.variants)) {
        if (!entry.adapt) continue;
        const target = join(workDir, '4-publish', entry.file);
        const translated = supplied.get(variant);
        if (translated !== undefined) {
            const mdPath = resolve(process.cwd(), translated.replace(/^~(?=\/)/, homedir()));
            if (!existsSync(mdPath)) fail(`variant source not found: ${mdPath}`);
            const md = readFileSync(mdPath, 'utf-8');
            const h1 = /^#\s+(\S.*)$/m.exec(md);
            if (!h1) fail(`${mdPath} has no H1 title`);
            const body = md.replace(h1[0], '').trim();
            const baseMetadata = (
                JSON.parse(readFileSync(sourceContent, 'utf-8')) as { metadata?: Record<string, unknown> }
            ).metadata;
            writeFileSync(
                target,
                `${JSON.stringify(
                    { title: h1[1]?.trim(), format: 'markdown', body, metadata: { ...(baseMetadata ?? {}) } },
                    null,
                    2,
                )}\n`,
            );
            process.stdout.write(`adapt  ${entry.file} (from ${mdPath})\n`);
            continue;
        }
        if (existsSync(target)) {
            process.stdout.write(`adapt  ${entry.file} (present)\n`);
            continue;
        }
        if (variant.startsWith(`${plan.sourceLocale}-`) || flags.copySource) {
            copyFileSync(sourceContent, target);
            process.stdout.write(`adapt  ${entry.file} (copied from source locale)\n`);
            continue;
        }
        fail(
            `variant ${variant} needs a translation: pass --variant ${variant}=<file.md>,` +
                ` or --copy-source to send the source-locale text`,
        );
    }

    // Per-target payloads are re-derived from these variant files by `itc-send-targets` itself, so
    // no second plan pass is needed here (itc-publish.ts: the send refreshes before dispatch).

    // --- the plan ---------------------------------------------------------
    const rows = plan.targets.map((t) => `  ${t.mode.padEnd(5)} ${t.transport.padEnd(7)} ${t.target} -> ${t.variant}`);
    process.stdout.write(`\nplan   ${plan.targets.length} target(s), live=${plan.live}, source=${plan.sourceLocale}\n`);
    process.stdout.write(`${rows.join('\n')}\n`);
    for (const group of plan.fanout) {
        process.stdout.write(`fanout ${group.variant}: ${group.targets.join(', ')}\n`);
    }

    if (flags.dryRun) {
        process.stdout.write(`\ndry-run: plan at ${planPath}; no workflow run\n`);
        return;
    }

    // --- drive the tail ---------------------------------------------------
    const vars: Record<string, string> = { work_dir: workDir };
    if (flags.planOnly) vars.plan_only = 'true';
    const tailRun = spawnSync('spur', ['workflow', 'run', TAIL, '--run-id', runId, '--vars', JSON.stringify(vars)], {
        stdio: 'inherit',
        cwd: REPO,
    });
    if (tailRun.error) fail(`spur workflow run: ${tailRun.error.message}`);

    // send-confirm pauses on any non-empty plan: resuming IS the approval.
    const trace = spawnSync('spur', ['workflow', 'trace', runId, '--json'], { cwd: REPO, encoding: 'utf-8' });
    const status = (() => {
        try {
            return (JSON.parse(trace.stdout) as { run?: { status?: string } }).run?.status ?? '';
        } catch {
            return '';
        }
    })();
    if (status === 'paused') {
        if (!flags.yes) fail(`run ${runId} is paused at send-confirm; re-run with --yes to approve the send`);
        // --answer is the persisted HITL answer; --yes alone only skips the CLI prompt.
        run('spur', ['workflow', 'continue', runId, '--yes', '--answer', 'yes'], 'spur workflow continue');
    }

    // --- outcome ----------------------------------------------------------
    const reportPath = join(workDir, '5-report/report.json');
    const report = existsSync(reportPath)
        ? (JSON.parse(readFileSync(reportPath, 'utf-8')) as {
              outcome?: string;
              receipts?: { plugin: string; status: string; url?: string; error?: string }[];
          })
        : undefined;
    const results = (report?.receipts ?? []).map((r) => ({
        target: r.plugin,
        ok: r.status === 'succeeded',
        url: r.url,
        error: r.error,
    }));
    process.stdout.write(`\noutcome ${report?.outcome ?? 'unknown'} (run ${runId})\n`);
    for (const t of results) {
        process.stdout.write(
            `  ${t.ok ? 'ok    ' : 'FAILED'} ${t.target}${t.url ? ` ${t.url}` : ''}${t.error ? ` ${t.error}` : ''}\n`,
        );
    }
    if (flags.planOnly) return;
    if (results.length === 0)
        fail(`no target receipts in ${reportPath}; inspect the run with spur workflow trace ${runId}`);
    const failed = results.filter((t) => !t.ok);
    if (failed.length > 0) {
        process.stderr.write(`publish-article: ${failed.length}/${results.length} target(s) failed\n`);
        process.exit(1);
    }
}

main();
