#!/usr/bin/env bun
/**
 * Deterministic `itc-*` stage helpers for plugins/kk/workflows/kk-itc.yaml (F41; 0149 authoring
 * tail, 0150 publish-tail seams, 0151 publish send).
 *
 *   itc-outline-pick <work_dir>
 *       Validate the auto-mode writer's 2-outline/outline-recommendation.json {pick, rationale},
 *       then persist the picked letter to 2-outline/.auto-pick (the workflow binds it into
 *       ${vars.outline} via file.read.into-var). Exits 1 when the recommendation is missing or
 *       malformed, the pick is outside a|b|c, or the picked option file is missing.
 *
 *   itc-report <work_dir> [max_revisions]
 *       Write 5-report/report.md and 5-report/report.json {outcome, verdict, revisions}. outcome
 *       is failed when the verdict is FAIL, the revision budget is exhausted (revisions >=
 *       max_revisions when given), or any publish target result is ok:false; `declined` when the
 *       operator answered no at publish-confirm (4-publish/.publish-declined). A missing/empty
 *       verdict counts as PASS — the workflow's dry-run convention. When a publish tail ran
 *       (4-publish/publish-plan.json exists), the report adds each target's ok, url or error and
 *       the exact `kk executor fan-out --retry-from` command per failed fan-out group. Exits 1
 *       only when a report or plan cannot be read/written.
 *
 *   itc-materialize <work_dir> <publish_live>
 *       Materialize the final draft 3-draft-draft-article.md to 4-publish/content.json
 *       (title from the first H1 and removed from body; outline, references, cover image and
 *       brief frontmatter when present; metadata.published always a boolean). Exits 1 when the
 *       draft is missing, has no H1, or the body is empty.
 *
 *   itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>
 *       Split the publish targets into fan-out groups and browser targets and write
 *       4-publish/publish-plan.json {live, sourceLocale, variants, fanout, browser}. Targets on
 *       the source-locale article profile share content.json (adapt:false); every other profile
 *       gets content.<variant>.json (adapt:true) and each variant carries the union of its
 *       targets' draft/live switches (V3). Exits 1, naming the target, for an unknown or
 *       non-article target or a target with no switch for the run's mode (x-pub in draft,
 *       wechatmp-pub live). A target that needs a cover when 4-illustrations/cover.* is absent is
 *       SKIPPED instead: the plan records a warning and every other target still plans.
 *
 *   itc-adapt-verify <work_dir>
 *       R3 follow-up check for the adapt state: every plan variant with adapt:true must have its
 *       content.<variant>.json present with a non-empty string title and body. Exits 1, naming the
 *       variant and file, otherwise.
 *
 *   itc-publish-fanout <work_dir> [--retry]
 *       For each publish-plan.json fan-out group: stamp the variant's draft/live switches into the
 *       variant Content metadata (V3 — at send time, never via the adapt step), then spawn
 *       `kk executor fan-out --content <variant> --target ... --out fanout-result.<variant>.json`.
 *       Per-target failures are data (exit 0, ok:false rows in the aggregate); a nonzero stage
 *       exit is reserved for plan or I/O errors. With --retry, only groups whose aggregate has an
 *       ok:false row are re-sent, passing --retry-from so published targets stay skipped (V5 <=1).
 *
 *   itc-publish-next <work_dir>
 *       Write the first browser target without a 4-publish/result.<target>.json into
 *       4-publish/.next-browser (empty when none are pending) — the publish-agent file cursor
 *       that bounds the kk:publish loop by the plan's browser list (V5).
 *
 * Node/Bun builtins only (ADR-018, design V6). Imported by kk-workflow-stages.ts — same
 * directory, so the sibling travels with whichever copy of the runner resolves; executed
 * directly it dispatches on argv[2].
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const VALID_PICKS = ['a', 'b', 'c'];

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function readJson(path: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return fail(`invalid JSON in ${path}`);
    }
}

function writeJson(path: string, value: unknown): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
    } catch (error) {
        fail(`cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Revision counter read; missing or non-numeric file -> undefined so callers can fall back. */
function readCount(path: string): number | undefined {
    if (!existsSync(path)) return undefined;
    const n = Number.parseInt(readFileSync(path, 'utf-8').trim(), 10);
    return Number.isFinite(n) ? n : undefined;
}

export function itcOutlinePick(args: string[]): void {
    const [workDir = ''] = args;
    if (!workDir) fail('usage: itc-outline-pick <work_dir>');
    const recPath = join(workDir, '2-outline', 'outline-recommendation.json');
    if (!existsSync(recPath)) fail(`outline recommendation not found: ${recPath}`);
    const rec = readJson(recPath) as { pick?: unknown };
    const pick = typeof rec.pick === 'string' ? rec.pick : '';
    if (!VALID_PICKS.includes(pick)) {
        fail(`invalid pick in ${recPath}: ${JSON.stringify(rec.pick ?? null)} (expected a|b|c)`);
    }
    const optionPath = join(workDir, '2-outline', `outline-option-${pick}.md`);
    if (!existsSync(optionPath)) fail(`picked outline option not found: ${optionPath}`);
    // No trailing newline — the letter is bound into ${vars.outline} verbatim via file.read.into-var.
    writeFileSync(join(workDir, '2-outline', '.auto-pick'), pick);
}

/** One per-target publish outcome row in the run report (design §4, R16). */
interface ReportTarget {
    target: string;
    transport: 'fanout' | 'browser';
    ok: boolean;
    url?: string;
    error?: string;
}

/** `{ok, url?, error?}` out of a fan-out aggregate row or a browser plugin Result. */
function resultRow(entry: { ok?: unknown; url?: unknown; error?: unknown }): {
    ok: boolean;
    url?: string;
    error?: string;
} {
    const url = typeof entry.url === 'string' && entry.url ? entry.url : undefined;
    const error = entry.error ? String(entry.error) : undefined;
    return { ok: entry.ok === true, ...(url ? { url } : {}), ...(error ? { error } : {}) };
}

export function itcReport(args: string[]): void {
    const [workDir = '', maxRevisions = ''] = args;
    if (!workDir) fail('usage: itc-report <work_dir> [max_revisions]');
    const verdictPath = join(workDir, '.itc-verdict.json');
    const verdictJson = existsSync(verdictPath)
        ? (readJson(verdictPath) as { verdict?: unknown; confidence?: unknown })
        : {};
    const verdict = verdictJson.verdict ?? '';
    // Same enum as the workflow guards and `daily-safety-gate`: a PASS without a HIGH/MEDIUM/LOW
    // confidence never cleared the judge gate, so the report must not claim a publish-ready draft.
    // An absent verdict file stays the dry-run PASS convention (verdict '').
    const unusablePass =
        verdict === 'PASS' &&
        verdictJson.confidence !== 'HIGH' &&
        verdictJson.confidence !== 'MEDIUM' &&
        verdictJson.confidence !== 'LOW';
    // Auto runs count on .auto-revise-count; interactive runs keep the existing .revise-count.
    const revisions = readCount(join(workDir, '.auto-revise-count')) ?? readCount(join(workDir, '.revise-count')) ?? 0;
    // Exhaustion only fails the run when the last verdict still asks for another revision —
    // a PASS on the final allowed revision is a done run.
    const exhausted = verdict === 'NEEDS_REVISION' && maxRevisions !== '' && revisions >= Number(maxRevisions);

    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    const declined = existsSync(join(publishDir, '.publish-declined'));
    const hasPlan = existsSync(planPath);
    const targets: ReportTarget[] = [];
    const retryCommands: string[] = [];
    if (hasPlan && !declined) {
        const plan = readJson(planPath) as PublishPlan;
        for (const group of plan.fanout) {
            const resultPath = join(publishDir, `fanout-result.${group.variant}.json`);
            if (!existsSync(resultPath)) {
                // The fan-out never completed for this group — every target is an unresolved failure.
                for (const target of group.targets) {
                    targets.push({
                        target,
                        transport: 'fanout',
                        ok: false,
                        error: `no ${join('4-publish', `fanout-result.${group.variant}.json`)}`,
                    });
                }
                continue;
            }
            const agg = readJson(resultPath) as { targets?: Array<{ target: string } & Record<string, unknown>> };
            let failed = false;
            for (const entry of agg.targets ?? []) {
                const row = resultRow(entry);
                if (!row.ok) failed = true;
                targets.push({ target: entry.target, transport: 'fanout', ...row });
            }
            if (failed) {
                const contentPath = join(publishDir, plan.variants[group.variant]?.file ?? '');
                if (existsSync(contentPath)) {
                    retryCommands.push(
                        `kk executor fan-out --content ${contentPath} --retry-from ${resultPath} --out ${resultPath}`,
                    );
                }
            }
        }
        for (const browser of plan.browser) {
            const resultPath = join(publishDir, `result.${browser.target}.json`);
            const row = existsSync(resultPath)
                ? resultRow(readJson(resultPath) as Record<string, unknown>)
                : { ok: false, error: `no ${join('4-publish', `result.${browser.target}.json`)}` };
            targets.push({ target: browser.target, transport: 'browser', ...row });
        }
    }

    const publishFailed = targets.some((t) => !t.ok);
    const outcome =
        verdict === 'FAIL' || unusablePass || exhausted || publishFailed ? 'failed' : declined ? 'declined' : 'done';
    const reportDir = join(workDir, '5-report');
    const jsonPath = join(reportDir, 'report.json');
    const publish = hasPlan ? { targets, retryCommands } : undefined;
    try {
        mkdirSync(reportDir, { recursive: true });
        writeFileSync(
            jsonPath,
            `${JSON.stringify({ outcome, verdict, revisions, ...(publish ? { publish } : {}) }, null, 4)}\n`,
        );
        writeFileSync(
            join(reportDir, 'report.md'),
            `# kk-itc run report\n\n- Outcome: ${outcome}\n- Verdict: ${
                verdict === ''
                    ? 'PASS (empty)'
                    : unusablePass
                      ? 'PASS (no HIGH/MEDIUM/LOW confidence — the judge gate never cleared)'
                      : verdict
            }\n- Revisions: ${revisions}\n` +
                (declined
                    ? '\n## Publish\n\n- Declined by the operator — nothing was sent.\n'
                    : targets.length > 0
                      ? `\n## Publish\n\n${targets.map((t) => `- ${t.target}: ${t.ok ? `ok${t.url ? ` ${t.url}` : ''}` : `FAILED${t.error ? ` ${t.error}` : ''}`}\n`).join('')}` +
                        (retryCommands.length > 0
                            ? `\nRetry the failed fan-out groups:\n\n${retryCommands.map((cmd) => `    ${cmd}`).join('\n')}\n`
                            : '')
                      : ''),
        );
    } catch (error) {
        fail(`cannot write report at ${jsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ---------------------------------------------------------------------------
// 0150 / 0298: publish-tail seams — itc-materialize, itc-publish-plan
// ---------------------------------------------------------------------------

const DRAFT_FILE = '3-draft-draft-article.md';

/** First `cover.*` in 4-illustrations as a workspace-relative path, or undefined. */
function findCover(workDir: string): string | undefined {
    const dir = join(workDir, '4-illustrations');
    if (!existsSync(dir)) return undefined;
    const cover = readdirSync(dir).find((file) => file.startsWith('cover.'));
    return cover ? join('4-illustrations', cover) : undefined;
}

/** `tags: [a, b]` / `a, b` frontmatter list value -> string[]. */
function splitList(value: string): string[] {
    return value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/** Minimal flat frontmatter reader for brief.md `tags` / `keywords` / `description`. */
function readFrontmatter(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    const text = readFileSync(path, 'utf-8');
    if (!text.startsWith('---')) return {};
    const end = text.indexOf('\n---', 3);
    if (end < 0) return {};
    const out: Record<string, string> = {};
    for (const line of text.slice(4, end).split('\n')) {
        const m = /^([\w-]+):\s*(.+)$/.exec(line);
        if (m?.[1] && m[2]) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return out;
}

export function itcMaterialize(args: string[]): void {
    const [workDir = '', liveArg = ''] = args;
    if (!workDir) fail('usage: itc-materialize <work_dir> <publish_live>');
    const live = liveArg === 'true';
    const draftPath = join(workDir, DRAFT_FILE);
    if (!existsSync(draftPath)) fail(`final draft not found: ${draftPath}`);
    const lines = readFileSync(draftPath, 'utf-8').split('\n');
    const h1 = lines.findIndex((line) => /^#\s+\S/.test(line));
    if (h1 < 0) fail(`no H1 title in ${draftPath}`);
    const title = lines[h1]?.replace(/^#\s+/, '').trim() ?? '';
    const body = [...lines.slice(0, h1), ...lines.slice(h1 + 1)].join('\n').trim();
    if (!body) fail(`empty body in ${draftPath}`);

    const content: Record<string, unknown> = { title, format: 'markdown', body };
    const outlinePath = join(workDir, '2-outline', 'outline-approved.md');
    if (existsSync(outlinePath)) content.outline = readFileSync(outlinePath, 'utf-8').trim();

    const docsPath = join(workDir, 'docs.json');
    if (existsSync(docsPath)) {
        const docs = readJson(docsPath) as Array<{ id?: unknown; title?: unknown; sourceUri?: unknown }>;
        if (Array.isArray(docs)) {
            content.references = docs.map((doc) => ({
                ...(typeof doc.sourceUri === 'string' ? { url: doc.sourceUri } : {}),
                ...(typeof doc.title === 'string' ? { title: doc.title } : {}),
                ...(typeof doc.id === 'string' ? { cite: doc.id } : {}),
            }));
        }
    }

    const metadata: Record<string, unknown> = { published: live };
    const cover = findCover(workDir);
    if (cover) metadata.coverImage = cover;
    const brief = readFrontmatter(join(workDir, 'brief.md'));
    if (brief.tags) metadata.tags = splitList(brief.tags);
    if (brief.keywords) metadata.keywords = splitList(brief.keywords);
    if (brief.description) metadata.description = brief.description;
    content.metadata = metadata;

    writeJson(join(workDir, '4-publish', 'content.json'), content);
}

/** Plan shape consumed by the adapt / publish-fanout / publish-next states (design §4). */
export interface PublishPlan {
    live: boolean;
    sourceLocale: string;
    variants: Record<
        string,
        { file: string; adapt: boolean; limits?: Record<string, unknown>; switches: Record<string, unknown> }
    >;
    fanout: Array<{ variant: string; targets: string[] }>;
    browser: Array<{ target: string; variant: string }>;
}

export function itcPublishPlan(args: string[]): void {
    if (process.env._KK_ITC_STAGE_NATIVE === '1') {
        return;
    }
    const cliEntry = join(__dirname, '../../../apps/cli/src/index.ts');
    let res: ReturnType<typeof spawnSync>;
    if (existsSync(cliEntry)) {
        res = spawnSync(process.execPath, [cliEntry, 'stage', 'run', 'itc-publish-plan', ...args], {
            stdio: ['inherit', 'pipe', 'pipe'],
            env: { ...process.env, _KK_ITC_STAGE_NATIVE: '1' },
        });
    } else {
        res = spawnSync('kk', ['stage', 'run', 'itc-publish-plan', ...args], {
            stdio: ['inherit', 'pipe', 'pipe'],
            env: { ...process.env, _KK_ITC_STAGE_NATIVE: '1' },
        });
    }
    if (res.stdout && res.stdout.length > 0) {
        process.stdout.write(res.stdout);
    }
    if (res.stderr && res.stderr.length > 0) {
        const errText = res.stderr.toString('utf-8');
        console.error(errText.endsWith('\n') ? errText.slice(0, -1) : errText);
    }
    if (res.error || (res.status !== null && res.status !== 0)) {
        process.exit(res.status ?? 1);
    }
}

/** R3 — the adapt state's follow-up check: every adapt:true variant file exists with title/body. */
export function itcAdaptVerify(args: string[]): void {
    const [workDir = ''] = args;
    if (!workDir) fail('usage: itc-adapt-verify <work_dir>');
    const planPath = join(workDir, '4-publish', 'publish-plan.json');
    if (!existsSync(planPath)) fail(`publish plan not found: ${planPath}`);
    const plan = readJson(planPath) as PublishPlan;
    const bad: string[] = [];
    for (const [variant, entry] of Object.entries(plan.variants ?? {})) {
        if (!entry?.adapt) continue;
        const path = join(workDir, '4-publish', entry.file ?? '');
        const content = existsSync(path) ? (readJson(path) as { title?: unknown; body?: unknown }) : undefined;
        const okField = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;
        if (!content || !okField(content.title) || !okField(content.body)) {
            bad.push(`${variant} (${entry.file})`);
        }
    }
    if (bad.length > 0) {
        fail(
            `adapted variant file(s) missing or lacking a non-empty title/body in ${join(workDir, '4-publish')}: ` +
                `${bad.join(', ')}. The adapt state (kk:article-adapt) must write every adapt:true variant`,
        );
    }
}

// ---------------------------------------------------------------------------
// 0151: publish send — itc-publish-fanout, itc-publish-next
// ---------------------------------------------------------------------------

/** True when the fan-out aggregate is missing or carries at least one ok:false target row. */
function aggregateHasFailures(path: string): boolean {
    if (!existsSync(path)) return true;
    const agg = readJson(path) as { targets?: Array<{ ok?: unknown }> };
    return (agg.targets ?? []).some((entry) => entry.ok !== true);
}

/** V3: the switch is stamped by deterministic code at send time — merged, never removed. */
function stampSwitches(contentPath: string, switches: Record<string, unknown>): void {
    const content = readJson(contentPath) as { metadata?: Record<string, unknown> };
    content.metadata = { ...content.metadata, ...switches };
    writeJson(contentPath, content);
}

export function itcPublishFanout(args: string[]): void {
    const [workDir = ''] = args;
    const retry = args.includes('--retry');
    if (!workDir) fail('usage: itc-publish-fanout <work_dir> [--retry]');
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!existsSync(planPath)) fail(`publish plan not found: ${planPath}`);
    const plan = readJson(planPath) as PublishPlan;
    for (const group of plan.fanout) {
        const resultPath = join(publishDir, `fanout-result.${group.variant}.json`);
        if (retry && !aggregateHasFailures(resultPath)) continue; // V5: only failed groups are re-sent
        const contentPath = join(publishDir, plan.variants[group.variant]?.file ?? '');
        if (!existsSync(contentPath)) fail(`variant file not found: ${contentPath}`);
        stampSwitches(contentPath, plan.variants[group.variant]?.switches ?? {});
        const argv = [
            'executor',
            'fan-out',
            '--content',
            contentPath,
            ...group.targets.flatMap((target) => ['--target', target]),
            '--out',
            resultPath,
            ...(retry ? ['--retry-from', resultPath] : []),
        ];
        const res = spawnSync('kk', argv, { stdio: 'inherit', env: process.env });
        if (res.error !== undefined || res.status === null || !existsSync(resultPath)) {
            fail(
                `fan-out did not write ${resultPath} for variant ${group.variant}: ${
                    res.error?.message ?? (res.status === null ? 'spawn failed' : `exit ${res.status}`)
                }`,
            );
        }
        // Exit 1 = target failures, kept as data in the aggregate; >1 is an input error (plan/I/O).
        if (res.status > 1) fail(`fan-out input error for variant ${group.variant} (exit ${res.status})`);
        console.log(`itc-publish-fanout ${group.variant}: exit ${res.status}`);
    }
    // Routing markers so the workflow guards stay one predicate over a result file (ADR-115):
    // .fanout-failed non-empty = some aggregate carries ok:false; .next-browser = the publish-agent
    // cursor (publish-agent recomputes it after each kk:publish step).
    const failed = plan.fanout.some((group) =>
        aggregateHasFailures(join(publishDir, `fanout-result.${group.variant}.json`)),
    );
    writeFileSync(join(publishDir, '.fanout-failed'), failed ? '1' : '');
    writeNextBrowser(workDir, plan);
}

/** Rewrite 4-publish/.next-browser with the first browser target lacking a Result (empty = done). */
function writeNextBrowser(workDir: string, plan: PublishPlan): void {
    const publishDir = join(workDir, '4-publish');
    const pending = plan.browser.find(({ target }) => !existsSync(join(publishDir, `result.${target}.json`)));
    // No trailing newline — the cursor is bound into ${vars.browser_target} via file.read.into-var.
    writeFileSync(join(publishDir, '.next-browser'), pending?.target ?? '');
}

export function itcPublishNext(args: string[]): void {
    const [workDir = ''] = args;
    if (!workDir) fail('usage: itc-publish-next <work_dir>');
    const planPath = join(workDir, '4-publish', 'publish-plan.json');
    if (!existsSync(planPath)) fail(`publish plan not found: ${planPath}`);
    writeNextBrowser(workDir, readJson(planPath) as PublishPlan);
}

if (import.meta.main) {
    const [stage, ...rest] = process.argv.slice(2);
    switch (stage) {
        case 'itc-outline-pick':
            itcOutlinePick(rest);
            break;
        case 'itc-report':
            itcReport(rest);
            break;
        case 'itc-materialize':
            itcMaterialize(rest);
            break;
        case 'itc-publish-plan':
            itcPublishPlan(rest);
            break;
        case 'itc-adapt-verify':
            itcAdaptVerify(rest);
            break;
        case 'itc-publish-fanout':
            itcPublishFanout(rest);
            break;
        case 'itc-publish-next':
            itcPublishNext(rest);
            break;
        default:
            fail(
                `unknown stage: ${stage ?? '(none)'} (expected itc-outline-pick|itc-materialize|itc-publish-plan|itc-adapt-verify|itc-publish-fanout|itc-publish-next|itc-report)`,
            );
    }
}
