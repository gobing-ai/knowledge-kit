#!/usr/bin/env bun
/**
 * daily-* stage bodies for the kk-daily-ai-voice2 DAG (task 0211, R7).
 *
 * Moved out of kk-workflow-stages.ts: every stage the voice2 graph touches is owned here so the
 * plugin ships its stages beside the runner. kk-workflow-stages.ts lazy-loads this module through
 * loadDailyStages() and keeps the same `kk stage <name>` surface; the old-voice-only stages stay
 * in the runner until the legacy workflow retires.
 *
 * Shared helpers, sidecar paths and constants still live in kk-workflow-stages.ts and are
 * imported from there — the lazy load keeps the module cycle safe.
 */
/**
 * Deterministic stage runner shared by the kk product workflows (ADR-115 composition owner).
 *
 * Each YAML action keeps one short package-root resolution block and delegates its multi-command
 * body here, so a shell action stays a single logical call:
 *
 *   prepare-itc   <work_dir> <topic> <input_file> <force>
 *   prepare-solo  <work_dir> <topic> <input_file> <voice_profile> <force>
 *   prepare-storm <work_dir> <topic> <input_file> <max_results> <fixture>
 *   validate      [<override>] --in <voicescript.yaml>
 *   wrap          [<override>] --in <voicescript.yaml> --out <docs.json> [--profile <name>]
 *   duration      <work_dir> <target_duration_min>
 *   render-storm  [<override>] --in <content.json> --out <content.md>
 *   itc-outline-pick <work_dir>          (0149, body in the sibling itc-stages.ts)
 *   itc-report       <work_dir> [max_revisions]  (0149, body in the sibling itc-stages.ts)
 *   itc-materialize  <work_dir> <publish_live>   (0150, sibling)
 *   itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>  (0150, sibling)
 *   itc-publish-fanout <work_dir> [--retry]   (0151, sibling)
 *   itc-publish-next  <work_dir>              (0151, sibling)
 *
 * `validate` / `wrap` / `render-storm` resolve the shipped sibling sidecars and delegate to them;
 * nothing about those sidecars changed. The `prepare-*` verbs and `duration` keep the logic that
 * used to live inline in `plugins/kk/workflows/*.yaml`, message-for-message.
 *
 * Node/Bun builtins only — no @gobing-ai/* and no cross-directory relative imports (the file is
 * resolved from the installed package or from a checkout). The itc-* stages delegate to their
 * same-directory sibling `itc-stages.ts`, imported lazily so a runner copy without the sibling
 * still loads and fails loud with the remediation path.
 *
 * The YAML prelude resolves this file as `$pkg/plugins/kk/scripts/kk-workflow-stages.ts` where `pkg`
 * comes from `realpath "$(command -v kk)"` (the installed package root), and falls back to the
 * cwd-relative `plugins/kk/scripts/kk-workflow-stages.ts` when that copy is absent — the checkout
 * tier kk-storm-research's render has always relied on, preserved on purpose. The daily-voice
 * workflow reaches the same script through `kk stage` (apps/cli/src/stage.ts), which resolves a
 * recognized checkout entry to this checked-in copy (never a stale `apps/cli/plugins/` stage) and an
 * installed entry to its own package-shipped copy.
 *
 * SYNC: plugins/kk/workflows/{kk-solo-podcast,kk-itc,kk-storm-research}.yaml shell this script
 * (kk-daily-ai-voice goes through `kk stage`). Keep message substrings stable —
 * apps/cli/tests/kk-workflow-stages.test.ts and the four workflow static tests match them.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
    ADMISSION_CRITERIA,
    applyTopicBoundary,
    assertScriptContent,
    COVER_FORMAT,
    COVER_STYLE,
    coverBrief,
    coverNormalizeBody,
    dedupPlanByTitle,
    expandHome,
    fail,
    failWith,
    firstArtifact,
    firstPostPath,
    firstTargetUrl,
    isFile,
    kk,
    kkCaptured,
    metadataOf,
    NESTED_SPUR_UNSET,
    PII_FINDING_CATEGORY,
    pluginsArgs,
    readJson,
    readSafetyReviseCount,
    readTopicBoundary,
    requireJson,
    requireSidecar,
    resolveSidecar,
    resultPublishStatus,
    SAFETY_PLATFORM_DECISIONS,
    SAFETY_REVISE_COUNT,
    STYLE_SIDECAR,
    StageFailure,
    safetyDigest,
    safetyDraftPaths,
    safetyPath,
    stampId3Tags,
    sted,
    targetPublished,
    timed,
    writeJqText,
    writeJsonText,
    writeRaw,
    XHS_BODY_CAP,
    XHS_FORMAT,
    XHS_MAX_CARDS,
    type XhsCard,
    xhsPlan,
} from './kk-workflow-stages.ts';
import { splitSentences } from './sentences.ts';
import { normalizeSeriesNames } from './series-names.ts';

export function dailyQcContent(args: string[]): void {
    const [
        workDir = '',
        runDate = '',
        pluginsPath = '',
        qcCategories = '',
        minQuality = '',
        minImportance = '',
        minUrgency = '',
        minImpact = '',
        minEpisodeItems = '',
        minMinutes = '',
        vdriver = '',
    ] = args;
    const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const annotated = join(workDir, '21-plan', `${runDate}_04_quality-control-content_annotated.json`);
    const exclusions = join(workDir, '21-plan', `${runDate}_04_quality-control-content_exclusions.json`);
    const planContent = join(workDir, '21-plan', `${runDate}_03_plan_content.json`);
    const cachePath = `${candidates}.cache.json`;
    const fingerprint = stageCacheFingerprint(planContent, {
        qcCategories,
        minQuality,
        minImportance,
        minUrgency,
        minImpact,
        minEpisodeItems,
        minMinutes,
        vdriver,
    });
    let recomputed = false;
    timed(workDir, 'quality-control-content', () => {
        // Voice1's standalone QC tests and old workspaces may carry a candidates artifact without
        // the newer plan input or sidecar. Preserve that explicitly cache-only surface; voice2
        // always has planContent, so its stale/malformed cache is recomputed below.
        const legacyCandidatesCache = isFile(candidates) && !isFile(planContent) && !isFile(cachePath);
        if (stageCacheMatches(candidates, cachePath, fingerprint) || legacyCandidatesCache) {
            console.log(`candidates cached: ${candidates}`);
            return;
        }
        if (isFile(candidates)) {
            const descendants = authoredPlanDescendants(workDir, runDate);
            if (descendants.length > 0) {
                failWith(
                    1,
                    `QC cache changed after downstream artifacts were authored; refusing to pair new candidates with stale outputs (${descendants.join(', ')})`,
                );
            }
            console.log(`candidates cache stale: ${candidates}`);
        }
        for (const stale of [exclusions, `${runDate}_04_quality-control-content_floor-refusal.json`].map((name) =>
            name.startsWith('/') ? name : join(workDir, '21-plan', name),
        )) {
            if (isFile(stale)) unlinkSync(stale);
        }
        sted('write', annotated, () => writeJqText(annotated, metadataOf(readJson(planContent)).docs ?? null));
        kk(
            [
                'executor',
                'run',
                'episode-plan-gen',
                '--in',
                annotated,
                '--out',
                candidates,
                ...pluginsArgs(pluginsPath),
            ],
            {
                env: {
                    EPISODE_PLAN_MODE: 'filter',
                    QC_CATEGORIES: qcCategories,
                    QC_MIN_QUALITY: minQuality,
                    QC_MIN_IMPORTANCE: minImportance,
                    QC_MIN_URGENCY: minUrgency,
                    QC_MIN_IMPACT: minImpact,
                    QC_MIN_EPISODE_ITEMS: minEpisodeItems,
                },
            },
        );
        if (!isFile(candidates)) failWith(1, `quality-control-content: ${candidates} not written`);
        sted('write', cachePath, () => writeStageCache(cachePath, fingerprint));
        recomputed = true;
    });
    // Topic boundary (task 0189 R2) runs on every invocation — re-applying to already-filtered
    // candidates is a no-op, so cached reruns stay idempotent while a crash between the candidates
    // write and the exclusions write still converges on the next run. Zero kept docs leaves the
    // candidates file empty for the workflow's existing done-no-content edge.
    const boundaryDocs = metadataOf(readJson(candidates)).docs;
    if (!Array.isArray(boundaryDocs)) return;
    const { kept, excluded } = applyTopicBoundary(boundaryDocs, runDate, readTopicBoundary());
    // A no-op boundary must not rewrite the file: the idempotent-rerun test compares bytes.
    if (excluded.length > 0) {
        sted('write', exclusions, () =>
            writeJsonText(exclusions, {
                version: 1,
                runDate,
                excluded,
                kept: kept.map((doc) => (doc as { id: string }).id),
            }),
        );
        const content = requireJson(candidates, 'topic-boundary');
        const meta = content.metadata;
        if (meta === null || typeof meta !== 'object') {
            failWith(1, 'topic-boundary: candidates content carries no metadata object');
        }
        (meta as Record<string, unknown>).docs = kept;
        sted('write', candidates, () => writeJsonText(candidates, content));
        console.log(
            `topic-boundary: excluded ${excluded.length} item(s): ${excluded.map((entry) => `${entry.id}(${entry.rule})`).join(', ')}`,
        );
    }
    // Title dedup before plan-translate / script-write. dailyArticle repeats this on plan.json, but
    // that runs in parallel with script-write: an id dropped after the script plan is authored is
    // `unknown-id`, the whole plan is rejected, and generate then sees a template with fewer sections.
    const currentDocs = excluded.length > 0 ? kept : boundaryDocs;
    const { kept: deduped, dropped } = dedupPlanByTitle(currentDocs as Array<{ id?: unknown; title?: unknown }>);
    if (dropped.length > 0) {
        const dedupedContent = requireJson(candidates, 'qc-dedup');
        const dedupedMeta = dedupedContent.metadata;
        if (dedupedMeta === null || typeof dedupedMeta !== 'object') {
            failWith(1, 'qc-dedup: candidates content carries no metadata object');
        }
        (dedupedMeta as Record<string, unknown>).docs = deduped;
        sted('write', candidates, () => writeJsonText(candidates, dedupedContent));
        console.error(`qc: dropped ${dropped.length} near-duplicate candidate(s): ${dropped.join(', ')}`);
    }
    // Last, not inside the timed block above: the estimate must see the pool every shrink pass has
    // already produced. 2026-10-22 cleared the floor on a 4-item pool (21.0 min estimated) that the
    // topic boundary then cut to 3 (14.4 min), so the run paid for a full synthesis the measured
    // gate refused. Covered here it also re-runs on a cached-rerun, which the timed block skipped.
    applyFloorGate(candidates, workDir, runDate, minMinutes, vdriver, recomputed);
}

/**
 * Cache only deterministic stage inputs. The source bytes are part of the key so a new collect
 * pool or translated plan cannot inherit a prior run's refusal; the invocation parameters cover
 * every threshold that changes the QC/floor result.
 */
function stageCacheFingerprint(sourcePath: string, inputs: Record<string, unknown>): string {
    const source = isFile(sourcePath) ? readFileSync(sourcePath, 'utf-8') : '<missing>';
    return createHash('sha256')
        .update(JSON.stringify({ version: 1, source, inputs }))
        .digest('hex');
}

function stageCacheMatches(outputPath: string, cachePath: string, fingerprint: string): boolean {
    if (!isFile(outputPath) || !isFile(cachePath)) return false;
    try {
        const cache = JSON.parse(readFileSync(cachePath, 'utf-8')) as { version?: unknown; fingerprint?: unknown };
        return cache.version === 1 && cache.fingerprint === fingerprint;
    } catch {
        return false;
    }
}

function writeStageCache(path: string, fingerprint: string): void {
    writeJsonText(path, { version: 1, fingerprint });
}

function authoredPlanDescendants(workDir: string, runDate: string): string[] {
    const descendants: string[] = [];
    for (const directory of ['22-article', '23-cover', '24-script', '30-audio', '31-publish']) {
        const root = join(workDir, directory);
        if (!existsSync(root)) continue;
        // The directory contents are stage-owned artifacts. A date-prefixed file means that a
        // previous non-empty run already authored downstream material that must not be silently
        // paired with a newly generated plan.
        for (const entry of readdirSync(root)) {
            if (entry.startsWith(`${runDate}_`)) descendants.push(join(root, entry));
        }
    }
    return descendants;
}

/**
 * Character-bigram Jaccard over whitespace-normalized, lowercased titles — the twin of
 * episode-plan-gen's `titleSimilarity`. Duplicated on purpose: this file is node-builtins-only
 * (no workspace imports), so it cannot reach that module.
 */
/**
 * The factor between a candidate's raw body characters and the characters the episode actually
 * speaks, calibrated on the two 2026-10-11 runs: 3 thin candidates (1.8k chars) scripted to 1270
 * spoken characters (4.0 min, failed the 15-min gate) and 7 candidates (4.3k chars) scripted to 5925
 * (16.8 min, shipped). The agent expands the news register, so the raw count under-predicts by ~1.4x;
 * with it, both runs land on the right side of the floor.
 */
const SPEAK_CHAR_EXPANSION = 1.4;

/**
 * The calibrated pre-spend estimate over a kept pool (title+body characters × the 1.4 expansion,
 * over the driver's measured char rate, plus the 8 s intro sting) — shared by the pre-spend floor
 * gate (applyFloorGate) and the post-spend duration refusal (dailyEpisodeDuration, 0266), so both
 * artifacts report the same arithmetic. `seconds` is unrounded: the floor gate compares seconds.
 */
function estimateSpokenMinutes(docs: unknown[], vdriver: string): { minutes: number; seconds: number; chars: number } {
    const chars = docs.reduce((sum, doc) => {
        const entry = (doc ?? {}) as Record<string, unknown>;
        return sum + `${String(entry.title ?? '')}`.length + String(entry.body ?? '').length;
    }, 0);
    const seconds = 8 + (chars * SPEAK_CHAR_EXPANSION) / spokenCharRate(vdriver);
    return { minutes: Math.round((seconds / 60) * 10) / 10, seconds, chars };
}

/**
 * Pre-spend floor gate (2026-10-12). `daily-episode-duration` also refuses a final episode below
 * the floor, but it runs after the TTS spend — a thin pool would still pay for a full synthesis
 * pass (the 04:30 tick of 2026-10-11: 3 candidates → 4.0 min episode, nothing published; since
 * 0266 that post-spend refusal closes as no-content instead of aborting, but the spend is gone).
 * This estimates the spoken length from the kept
 * candidates and, when it cannot reach the floor, empties the candidate list: every downstream
 * `pool-count --min 1` guard then skips the content, audio, publish and XHS subtrees, and the run
 * closes through run-report and the ledger exactly like an empty pool. The estimate and its inputs
 * land in a refusal artifact next to the candidates.
 */
function applyFloorGate(
    candidates: string,
    workDir: string,
    runDate: string,
    minMinutes: string,
    vdriver: string,
    clearStaleRefusal = false,
): void {
    const refusal = join(workDir, '21-plan', `${runDate}_04_quality-control-content_floor-refusal.json`);
    const floor = Number(minMinutes);
    if (minMinutes === '' || !Number.isFinite(floor) || floor <= 0) {
        if (clearStaleRefusal && isFile(refusal)) unlinkSync(refusal);
        return;
    }
    const content = readJson(candidates);
    const docs = metadataOf(content).docs;
    if (!Array.isArray(docs) || docs.length === 0) {
        if (clearStaleRefusal && isFile(refusal)) unlinkSync(refusal);
        return;
    }
    const { minutes: estimatedMinutes, seconds: estimatedSeconds, chars } = estimateSpokenMinutes(docs, vdriver);
    if (estimatedSeconds >= floor * 60) {
        if (clearStaleRefusal && isFile(refusal)) unlinkSync(refusal);
        console.log(`floor gate: estimated ${estimatedMinutes} min from ${chars} chars — above the ${floor} min floor`);
        return;
    }
    const ids = docs.map((doc) => String((doc as Record<string, unknown> | null)?.id ?? ''));
    sted('write', refusal, () =>
        writeJqText(refusal, {
            estimatedMinutes,
            minMinutes: floor,
            candidateChars: chars,
            expansion: SPEAK_CHAR_EXPANSION,
            charRate: spokenCharRate(vdriver),
            ids,
            reason: `a ${docs.length}-item pool estimates ${estimatedMinutes} min of speech, below the ${floor} min floor — refusing before any TTS spend`,
        }),
    );
    sted('write', candidates, () =>
        writeJsonText(candidates, { ...(content ?? {}), metadata: { ...metadataOf(content), docs: [] } }),
    );
    console.error(
        `floor gate: ${docs.length} candidates estimate ${estimatedMinutes} min < ${floor} min — candidates emptied, the run closes as no-content (see ${refusal})`,
    );
}

/** Widest window the extract ladder may reach; a "daily" show must not import a week-old story. */
const LADDER_MAX_MS = 168 * 3_600_000;

const WINDOW_UNIT_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `'24h'` → milliseconds, mirroring `kk store extract --window`'s grammar. null when unparsable. */
function parseWindowMs(window: string): number | null {
    const match = /^(\d+)([smhd])$/.exec(window.trim());
    if (match === null) return null;
    const unit = WINDOW_UNIT_MS[match[2] as string];
    const ms = Number(match[1]) * (unit ?? 0);
    return ms > 0 ? ms : null;
}

/** Milliseconds → the hour form the store CLI takes. Whole hours only: every ladder step is ×2/×3. */
function formatWindowMs(ms: number): string {
    return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
}

/**
 * Pool extraction with a conditional window ladder (2026-10-19 operator decision, superseding the
 * 0266 D1 blanket rejection; extended ×7/168h 2026-10-23 when upstream supply collapsed and the
 * 72h ceiling again closed a day as no-content while a week of older unselected items sat in the
 * store). `kk store extract` reads one first_seen window and `applyFloorGate`
 * then refuses a pool that cannot reach `episode_min_minutes`. Together they ate whole days: an
 * episode consumes 6-12 stories while a day of collection adds ~3-13 qualifying ones, so the 04:30
 * runs of 2026-10-18 and 2026-10-19 saw 2- and 3-item pools and closed as no-content while older
 * unselected items sat in the store. The ladder keeps the configured window as the first choice and
 * widens (×2, ×3, ×7, capped at 168h) ONLY when that pool's estimate misses the floor — a rich day is
 * extracted exactly once, and a thin one is filled from the backlog instead of dropped. The store's
 * QC gates still read the aged items' decayed urgency, so a widened pool does not force stale stories
 * into an episode by itself.
 *
 * The store's `selections` ledger still excludes every story a previous run took, so a widened
 * window can only add items no episode has used. The estimate here runs on the raw pool (before QC
 * and dedup), so it is an upper bound: the ladder can stop one step early, never one late.
 */
export function dailyExtract(args: string[]): void {
    const [workDir = '', topic = '', window = '', minMinutes = '', vdriver = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!topic) fail('missing topic');
    const poolPath = join(workDir, '10-collect', 'pool.json');
    const base = parseWindowMs(window === '' ? '24h' : window);
    if (base === null) fail(`extract: invalid window: ${window || '(empty)'}`);
    const floor = Number(minMinutes);
    const gated = minMinutes !== '' && Number.isFinite(floor) && floor > 0;
    const windows: number[] = [base];
    for (const factor of gated ? [2, 3, 7] : []) {
        const ms = base * factor;
        if (ms > LADDER_MAX_MS) break;
        windows.push(ms);
    }
    timed(workDir, 'extract', () => {
        mkdirSync(join(workDir, '10-collect'), { recursive: true });
        let chosen: { window: string; docs: unknown[] } | null = null;
        for (const ms of windows) {
            const label = formatWindowMs(ms);
            const attempt = join(workDir, '10-collect', `.pool-${label}.json`);
            kk(['store', 'extract', '--topic', topic, '--window', label, '--out', attempt]);
            const parsed = readJson(attempt);
            const docs = Array.isArray(parsed) ? (parsed as unknown[]) : [];
            const estimate = estimateSpokenMinutes(docs, vdriver);
            chosen = { window: label, docs };
            const verdict = gated
                ? `estimated ${estimate.minutes} min — ${estimate.seconds >= floor * 60 ? 'clears' : 'below'} the ${floor} min floor`
                : 'floor gate off';
            console.error(`extract: ${label} pool ${docs.length} item(s), ${verdict}`);
            if (!gated || estimate.seconds >= floor * 60) break;
            rmSync(attempt, { force: true });
        }
        const picked = chosen ?? { window: formatWindowMs(base), docs: [] as unknown[] };
        sted('write', poolPath, () => writeJsonText(poolPath, picked.docs));
        for (const ms of windows)
            rmSync(join(workDir, '10-collect', `.pool-${formatWindowMs(ms)}.json`), { force: true });
    });
}

export function dailyArticle(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const articleMd = join(workDir, '22-article', `${runDate}_06_article_article.md`);
    const articleContent = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    const planIn = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    timed(workDir, 'article', () => {
        let planUsable = true;
        const raw = isFile(planIn) ? readFileSync(planIn, 'utf-8') : '';
        // The plan file is canonically the plan `Doc[]` — `dailyPlan` writes the generator's
        // `metadata.docs` — and every downstream stage reads it as one. `plan-translate`'s executor
        // has been observed writing the generator's Content ENVELOPE back instead: valid JSON of the
        // wrong shape, which the article generator then refuses with `expected array, received
        // object`. Unwrap that envelope rather than discard the translation; anything else unusable
        // still falls back to the untranslated candidates.
        let planShape: unknown;
        try {
            planShape = JSON.parse(raw);
        } catch (error) {
            console.error(
                `article: plan.json invalid JSON — replacing with untranslated plan (downstream states read this file): ${(error as Error).message}`,
            );
        }
        if (planShape !== undefined && !Array.isArray(planShape)) {
            const enveloped = metadataOf(planShape as Record<string, unknown>).docs;
            if (Array.isArray(enveloped) && enveloped.length > 0) {
                console.error(
                    `article: plan.json carries the Content envelope, not the Doc[] — unwrapping metadata.docs (${enveloped.length} doc(s))`,
                );
                sted('write', planIn, () => writeJsonText(planIn, enveloped));
                planShape = enveloped;
            }
        }
        if (!Array.isArray(planShape)) {
            const docs = metadataOf(readJson(candidates)).docs;
            if (!Array.isArray(docs) || docs.length === 0) {
                console.error('article: candidates.json metadata.docs missing');
                planUsable = false;
            } else {
                sted('write', planIn, () => writeJsonText(planIn, docs));
            }
        }
        if (!planUsable) failWith(1, 'article: no usable plan input');
        // R3 (task 0138): dedup runs BEFORE the cache early-return — the script stage reads this same
        // plan.json and must see one survivor even when the article is already cached. Idempotent:
        // a no-op once the plan is deduped.
        const planParsed: unknown = readJson(planIn);
        if (Array.isArray(planParsed)) {
            const { kept, dropped } = dedupPlanByTitle(planParsed as Record<string, unknown>[]);
            if (dropped.length > 0) {
                sted('write', planIn, () => writeJsonText(planIn, kept));
                console.error(`article: dropped ${dropped.length} near-duplicate plan item(s): ${dropped.join(', ')}`);
            }
        }
        // The cache pair must be COMPLETE: markdown without its content.json means the generator
        // half-ran (or the json was pruned), and returning here starves every downstream stage
        // that reads content.json — publish-prep refuses to merge a draft it cannot read. Requiring
        // both artifacts makes the pair self-healing instead of permanently stuck.
        if (isFile(articleMd) && isFile(articleContent)) {
            console.log(`article cached: ${articleMd}`);
            return;
        }
        // Agent-written prose body (workflow `article-write` state) replaces the mechanical
        // per-item render when present — the 3-format split: surfdash gets an article,
        // not a news list (2026-09-16 feedback).
        const proseBody = join(workDir, '22-article', `${runDate}_06_article-write_body.md`);
        kk(
            [
                'executor',
                'run',
                'daily-article-gen',
                '--in',
                planIn,
                '--out',
                articleContent,
                ...pluginsArgs(pluginsPath),
            ],
            {
                env: {
                    ARTICLE_DATE: runDate,
                    // Plugin entries run with cwd = plugin dir (invoke.ts), so relative
                    // paths in env must be resolved or the plugin sees ENOENT.
                    ...(isFile(proseBody) ? { ARTICLE_BODY_FILE: resolve(proseBody) } : {}),
                },
            },
        );
        const body = readJson(articleContent)?.body;
        if (typeof body !== 'string') failWith(1, `article: ${articleContent} has no string body`);
        sted('write', articleMd, () => writeRaw(articleMd, body));
    });
}

// Shared opt-in fallback parse (D6 0166 R7; 0219 R1): '' keeps strict fail-fast (the caller
// omits the key), 'true' retries down image-gen's AUTO_ORDER, anything else is a comma-split,
// trimmed candidate list. Unknown names are rejected by image-gen, not here.
function imageFallback(fallback: string): true | string[] {
    return fallback === 'true'
        ? true
        : fallback
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
}

/**
 * F614 R2/R4: validate the agent-written cover brief in the order R4 names — the first failing
 * check is the fallback reason; `reason: null` carries the trimmed subject.
 */
/**
 * F614 R3: build the image-gen envelope from the day's cover brief and render it. The subject is
 * the only model-authored input (the workflow's brief agent.run wrote it); format, style,
 * provider and model are pinned by this stage so no caller can drift the look. A missing or
 * invalid brief degrades to the format's default subject (R4) — a plugin failure still fails
 * the stage, matching the pre-F614 cover behavior.
 */
export function dailyCover(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', provider = '', model = '', fallback = ''] = args;
    const briefPath = join(workDir, '23-cover', `${runDate}_07_cover-brief.json`);
    const envPath = join(workDir, '23-cover', `${runDate}_07_cover_image-gen-in.json`);
    const contentOut = join(workDir, '23-cover', 'content.json');
    timed(workDir, 'cover', () => {
        const brief = coverBrief(briefPath);
        const vars: Record<string, string> = {};
        if (brief.reason !== null) {
            console.error(`cover brief: fallback (${brief.reason})`);
        } else {
            vars.subject = brief.subject;
        }
        const imageGen: Record<string, unknown> = {
            job: 'cover',
            format: COVER_FORMAT,
            style: COVER_STYLE,
            vars,
            maxImages: 1,
        };
        if (provider !== '') imageGen.provider = provider;
        if (model !== '') imageGen.model = model;
        // D6 0166 R7: runtime-fallback opt-in. '' (the shipped var default) keeps strict fail-fast —
        // F614's pinned look stays the default; 'true' = retry down AUTO_ORDER; anything else is a
        // comma-split, trimmed candidate list. Unknown names are rejected by image-gen, not here.
        if (fallback !== '') imageGen.fallback = imageFallback(fallback);
        sted('write', envPath, () =>
            writeJsonText(envPath, [{ id: 'daily-cover', title: runDate, body: '', metadata: { imageGen } }]),
        );
        kk(['executor', 'run', 'image-gen', '--in', envPath, '--out', contentOut, ...pluginsArgs(pluginsPath)]);
    });
}

export function dailyCoverNormalize(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    // The pre-0133 shell had no timing trap, so this stage is not `timed`; it still fails through
    // `failWith`, which needs the named-failure handling `timed` gives the other stages.
    try {
        coverNormalizeBody(workDir, runDate);
    } catch (error) {
        if (error instanceof StageFailure) {
            if (error.named) console.error(error.message);
            process.exit(error.status);
        }
        console.error((error as Error).message);
        process.exit(1);
    }
}

/**
 * 20260917 review #7: prepend the show's 8s intro sting to the generated audio.
 * `intro_music` empty -> skip. Writes `<stem>.intro.wav` (original render kept), points
 * `audioPath` at the merged file, extends `duration`, marks `introMerged` (idempotent).
 */
/**
 * Episode duration gate (standing requirement, 20261002): a daily episode must run 15–20 minutes
 * (duration is authoritative; the 8–10-item figure is only an estimate). Reads the final audio
 * content's `metadata.duration` — after the intro sting merged, this is the true episode length —
 * and fails loud outside `[min, max]` seconds-worth of minutes. A missing duration is a failure,
 * not a pass: the gate must never silently let an under-length episode through again.
 *
 * 0266 (policy (c), 2026-10-13): an under-minutes episode is a thin day, not a broken run — the
 * gate refuses it like the pre-spend floor gate does instead of aborting before run-report/ledger:
 * write `_11_generate_content_duration-refusal.json` beside the content, empty the candidates
 * file (every pool-count-gated node downstream then skips) and exit 0, so the run closes as
 * no-content with the measured vs estimated minutes recorded. Over-max still fails loud — trimming
 * is a different problem.
 */
/**
 * Advisory speaker-consistency audit of a finished episode.
 *
 * Exists because an unanchored voice profile (voxcpm's `instruct` mode pins no speaker) shipped 59
 * different speakers in the 20261015 episode and nothing but a human listening caught it. This runs
 * the plugin's F0 audit and reports; it NEVER fails the run — a regression, a missing venv or a
 * broken script must not stop publishing. A non-zero audit exit prints one WARNING line instead.
 */
export function dailyVoiceAudit(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!runDate) fail('missing run_date');
    const contentPath = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    if (!isFile(contentPath)) {
        console.log(`voice-audit: no episode content at ${contentPath}; skipping`);
        return;
    }
    const plugin = join(pluginsPath || 'plugins', 'generations', 'voxcpm-tts');
    const python = join(plugin, '.venv', 'bin', 'python');
    const script = join(plugin, 'scripts', 'audit-speaker-consistency.py');
    if (!isFile(python) || !isFile(script)) {
        console.log(`voice-audit: skipping (needs ${python} and ${script})`);
        return;
    }
    const audit = spawnSync(python, [script, contentPath], { encoding: 'utf-8' });
    const out = `${audit.stdout ?? ''}${audit.stderr ?? ''}`.trim();
    if (out) console.log(out);
    if (audit.status !== 0) {
        console.log('voice-audit: WARNING — the speaker-consistency audit flagged this episode (advisory)');
    }
}

/**
 * Empty the QC candidates file so every downstream `pool-count --min 1` guard skips the content,
 * audio, publish and XHS subtrees — the one mechanism both refusal paths use to close a run as
 * no-content without aborting it (0266).
 */
function emptyCandidates(workDir: string, runDate: string): void {
    const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const content = readJson(candidates);
    if (content === null) return;
    sted('write', candidates, () =>
        writeJsonText(candidates, { ...content, metadata: { ...metadataOf(content), docs: [] } }),
    );
}

/**
 * The pre-spend refusal of `daily-generate`'s script gate: same artifact and the same candidate
 * emptying as the measured gate, plus `stage: "script"` so the run report can name which gate
 * closed the day. Nothing was synthesized, so there is no measured duration to record.
 */
function refuseScriptBelowFloor(
    workDir: string,
    runDate: string,
    gate: { chars: number; charRate: number; seconds: number; minMinutes: number },
): void {
    const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const candidateDocs = metadataOf(readJson(candidates)).docs;
    const keptCount = Array.isArray(candidateDocs) ? candidateDocs.length : 0;
    const refusal = join(workDir, '30-audio', `${runDate}_11_generate_content_duration-refusal.json`);
    const shown = (gate.seconds / 60).toFixed(1);
    sted('write', refusal, () =>
        writeJqText(refusal, {
            stage: 'script',
            estimatedMinutes: Math.round((gate.seconds / 60) * 10) / 10,
            minMinutes: gate.minMinutes,
            keptCount,
            scriptChars: gate.chars,
            charRate: gate.charRate,
            reason: `the authored script estimates ${shown} min of speech, below the ${gate.minMinutes} min floor — refusing before the TTS spend`,
        }),
    );
    emptyCandidates(workDir, runDate);
    console.error(
        `generate: script estimates ${shown} min (${gate.chars} chars at ${gate.charRate}/s), below the ${gate.minMinutes} min floor — candidates emptied, the run closes as no-content before any TTS spend (see ${refusal})`,
    );
}

export function dailyEpisodeDuration(args: string[]): void {
    const [workDir = '', runDate = '', minArg = '', maxArg = '', vdriver = '', runId = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!runDate) fail('missing run_date');
    const minMinutes = Number(minArg);
    const maxMinutes = Number(maxArg);
    if (!Number.isFinite(minMinutes) || minMinutes <= 0) fail(`invalid min_minutes: ${minArg || '(empty)'}`);
    if (!Number.isFinite(maxMinutes) || maxMinutes < minMinutes) fail(`invalid max_minutes: ${maxArg || '(empty)'}`);
    // 0329 F06: the publish path must not survive a refusal. The pool-gate token flips to EMPTY so
    // this run's own remaining fan-out skips, and a stale bundle.json from an earlier run (whose
    // runs[] a publish window could still consume) is dropped.
    const invalidatePublishPath = (): void => {
        if (runId !== '') {
            const token = join('.spur', 'run', `${runId}-pool-gate.status`);
            if (isFile(token)) sted('write', token, () => writeRaw(token, 'EMPTY\n'));
        }
        rmSync(join(workDir, 'bundle.json'), { force: true });
    };
    const contentPath = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    if (!isFile(contentPath)) failWith(1, `episode-duration: audio content not found: ${contentPath}`);
    let raw: unknown;
    try {
        const parsed = JSON.parse(readFileSync(contentPath, 'utf-8')) as { metadata?: { duration?: unknown } };
        raw = parsed.metadata?.duration;
    } catch (error) {
        if ((error as { code?: string }).code !== undefined) {
            sted('read', contentPath, () => readFileSync(contentPath, 'utf-8'));
        }
        raw = undefined;
    }
    const seconds = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) {
        failWith(1, `episode-duration: audio metadata.duration missing or not a number in ${contentPath}`);
    }
    const minutes = seconds / 60;
    const shown = minutes.toFixed(1);
    if (minutes < minMinutes) {
        const refusal = join(workDir, '30-audio', `${runDate}_11_generate_content_duration-refusal.json`);
        const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
        const content = readJson(candidates);
        const docs = Array.isArray(metadataOf(content).docs) ? (metadataOf(content).docs as unknown[]) : [];
        // Idempotency first: a rerun must not recompute an estimate from the already-emptied candidates.
        // A kill between the two writes below leaves the refusal beside non-empty candidates, which would
        // let the pool-gated publish fan package a sub-floor episode — so finish the emptying here.
        if (isFile(refusal)) {
            if (docs.length > 0) emptyCandidates(workDir, runDate);
            invalidatePublishPath();
            console.error(`episode-duration: duration refusal already recorded (${refusal}) — nothing to do`);
            return;
        }
        const estimated = estimateSpokenMinutes(docs, vdriver);
        const measuredMinutes = Math.round(minutes * 10) / 10;
        sted('write', refusal, () =>
            writeJqText(refusal, {
                measuredMinutes,
                estimatedMinutes: estimated.minutes,
                minMinutes,
                keptCount: docs.length,
                candidateChars: estimated.chars,
                reason: `the episode ran ${shown} min of speech, below the ${minMinutes} min floor (pre-spend estimate ${estimated.minutes} min) — refusing after synthesis`,
            }),
        );
        emptyCandidates(workDir, runDate);
        invalidatePublishPath();
        console.error(
            `episode-duration: episode ran ${shown} min (estimate ${estimated.minutes} min), below the ${minMinutes}–${maxMinutes} min requirement — candidates emptied, the run closes as no-content (see ${refusal})`,
        );
        return;
    }
    if (minutes > maxMinutes) {
        failWith(
            1,
            `episode-duration: episode runs ${shown} min, above the ${minMinutes}–${maxMinutes} min requirement. Trim items or per-item treatment.`,
        );
    }
    // A passing gate leaves this artifact behind only: the 2026-10-20 run published an 8.4-min
    // episode with nothing on disk to say whether the gate ran, passed, or was stale (2026-10-22).
    const verdict = join(workDir, '30-audio', `${runDate}_11_generate_content_duration.json`);
    sted('write', verdict, () =>
        writeJqText(verdict, {
            measuredMinutes: Math.round(minutes * 10) / 10,
            minMinutes,
            maxMinutes,
            ok: true,
        }),
    );
    console.log(`episode-duration ok: ${shown} min within ${minMinutes}–${maxMinutes} min`);
}

/** Ceiling for the pre-spend estimate when the caller passes no `episode_max_minutes`. */
const DEFAULT_EPISODE_MAX_MINUTES = 20;

/** `kk executor run` argv shared by the quota probe, the voice1 one-shot, and each section. */
function voiceExecutorArgs(generator: string, input: string, output: string, pluginsPath: string): string[] {
    return ['executor', 'run', generator, '--in', input, '--out', output, ...pluginsArgs(pluginsPath)];
}

/**
 * One tiny gemini-tts render before any episode speech. A non-zero exit (quota, key, network)
 * means this run should use voicebox. Probe files are removed either way.
 * Returns false when the caller should fall back.
 */
function geminiQuotaProbeOk(workDir: string, pluginsPath: string, transcodeMp3: string, probeDocs: unknown): boolean {
    const probeDir = join(workDir, '30-audio');
    const probeIn = join(probeDir, '.gemini-probe-in.json');
    const probeOut = join(probeDir, '.gemini-probe-out.json');
    writeJsonText(probeIn, probeDocs);
    const probe = spawnSync('kk', voiceExecutorArgs('gemini-tts', probeIn, probeOut, pluginsPath), {
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, VOICE_GEN_MP3: transcodeMp3 },
    });
    for (const stale of [probeIn, probeOut, probeOut.replace(/\.json$/, '.wav'), probeOut.replace(/\.json$/, '.mp3')]) {
        rmSync(stale, { force: true });
    }
    if (probe.status !== 0) {
        const reason = (probe.stderr ?? '').trim().split('\n').slice(-1)[0] || `exit ${probe.status}`;
        console.log(`generate: gemini quota probe failed (${reason}) — falling back to voicebox for this run`);
        return false;
    }
    console.log('generate: gemini quota probe ok');
    return true;
}

/** `VOICE_GEN_MP3` truthiness, matching voice-gen's own parse (`plugins/generations/voice-gen/src/mp3.ts`). */
const MP3_TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * `transcode_mp3=true` is a workflow contract, not a driver hint: the run publishes an MP3
 * enclosure and `daily-publish-prep` refuses a WAV (0171 R2). Only voice-gen honours
 * `VOICE_GEN_MP3`; gemini-tts and omni-voice-gen write WAV only, so `metadata.mp3Path` stayed
 * unset for them and every publishing run died at publish-prep. Derive the sibling MP3 here —
 * the one place that knows both the requested transcode and what the driver actually wrote —
 * so `daily-intro` re-transcodes the intro-merged audio to the same recorded path.
 */
function ensurePublishMp3(contentPath: string, transcodeMp3: string): void {
    if (!MP3_TRUTHY.has(transcodeMp3.trim().toLowerCase())) return;
    const content = readJson(contentPath);
    if (content === null) return;
    const meta = (content.metadata ?? {}) as Record<string, unknown>;
    const recorded = meta.mp3Path;
    if (typeof recorded === 'string' && recorded !== '' && existsSync(resolve(recorded))) return;
    const wav = [meta.audioPath, content.audioPath].find(
        (candidate): candidate is string =>
            typeof candidate === 'string' && candidate.endsWith('.wav') && existsSync(resolve(candidate)),
    );
    if (wav === undefined) return;
    const wavPath = resolve(wav);
    const mp3Path = wavPath.replace(/\.wav$/i, '.mp3');
    const proc = spawnSync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        wavPath,
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        mp3Path,
    ]);
    if (proc.status !== 0 || !existsSync(mp3Path)) {
        const detail = (proc.stderr?.toString() ?? '').trim() || `exit ${String(proc.status)}`;
        failWith(1, `generate: publish MP3 transcode failed: ${detail}`);
    }
    meta.mp3Path = mp3Path;
    content.metadata = meta;
    sted('write', contentPath, () => writeJsonText(contentPath, content));
    console.log(`generate: wrote publish MP3 ${mp3Path}`);
}

/** ffprobe one audio attribute; empty string when the file is absent/unreadable. */
function probeAudio(file: string, entries: string): string {
    return (
        spawnSync('ffprobe', [
            '-v',
            'error',
            '-select_streams',
            'a:0',
            '-show_entries',
            entries,
            '-of',
            'csv=p=0',
            file,
        ])
            .stdout?.toString()
            .trim() ?? ''
    );
}

/** A playable local audio artifact: present, positive native sample rate and positive duration. */
function validNativeAudio(path: unknown): boolean {
    if (typeof path !== 'string' || path === '' || !existsSync(resolve(path))) return false;
    const rate = Number.parseFloat(probeAudio(resolve(path), 'stream=sample_rate'));
    const duration = Number.parseFloat(probeAudio(resolve(path), 'format=duration'));
    return Number.isFinite(rate) && rate > 0 && Number.isFinite(duration) && duration > 0;
}

/**
 * Whole-document speech cache hit (0105 R2 / 0257 R2): the recorded Content must carry THIS run's
 * generator identity (`kk:<plugin>`), a passing QC report and a playable native-rate WAV. Foreign,
 * legacy or corrupt output is a miss — never relabel another driver's audio. A valid cache missing
 * only the requested MP3 is repaired in place from the already-rendered speech (no resynthesis).
 */
function wholeDocCache(contentPath: string, plugin: string, transcodeMp3: string): boolean {
    const content = readJson(contentPath);
    if (content === null) return false;
    const meta = metadataOf(content);
    const qc = meta.qc as Record<string, unknown> | undefined;
    if (meta.generator !== `kk:${plugin}`) return false;
    if (qc?.passed === true && validNativeAudio(meta.audioPath)) {
        ensurePublishMp3(contentPath, transcodeMp3);
        return true;
    }
    return false;
}

/**
 * Joined-final cache identity (0257 R3): exact ordered `metadata.sectionHashes` equality, matching
 * generator, passing QC and a playable WAV. A stale or legacy final is a miss even when every
 * section still hits — the caller rejoins the cached sections without model calls. The requested
 * MP3 is repaired from the valid joined WAV; a failed derivative fails loud.
 */
function joinedFinalFresh(contentPath: string, plugin: string, hashes: string[], transcodeMp3: string): boolean {
    const content = readJson(contentPath);
    if (content === null) return false;
    const meta = metadataOf(content);
    if (meta.generator !== `kk:${plugin}`) return false;
    const frozen = meta.sectionHashes;
    if (!Array.isArray(frozen) || frozen.length !== hashes.length || !frozen.every((h, i) => h === hashes[i])) {
        return false;
    }
    const qc = meta.qc as Record<string, unknown> | undefined;
    if (qc?.passed !== true || !validNativeAudio(meta.audioPath)) return false;
    ensurePublishMp3(contentPath, transcodeMp3);
    return true;
}

/**
 * Aggregate the current sections' QC into the shared VoiceQualityReport names (0257 R3): passed
 * iff every section passed; overallScore is the minimum when every section reports a finite one
 * (absent evidence stays unavailable, never an invented zero); segmentAudits are concatenated with
 * globally ordered segmentIndex; criticalIssues are flattened with section labels.
 */
function aggregateSectionQc(
    plans: Array<{ def: { name: string }; jsonPath: string }>,
    totalDuration: number,
): Record<string, unknown> {
    const segmentAudits: Array<Record<string, unknown>> = [];
    const criticalIssues: string[] = [];
    const scores: number[] = [];
    let allPassed = true;
    let allScored = true;
    for (const plan of plans) {
        const report = metadataOf(readJson(plan.jsonPath)).qc;
        const qc = report !== null && typeof report === 'object' ? (report as Record<string, unknown>) : {};
        if (qc.passed !== true) allPassed = false;
        if (typeof qc.overallScore === 'number' && Number.isFinite(qc.overallScore)) scores.push(qc.overallScore);
        else allScored = false;
        if (Array.isArray(qc.segmentAudits)) {
            for (const audit of qc.segmentAudits) {
                if (audit !== null && typeof audit === 'object') {
                    segmentAudits.push({ ...(audit as Record<string, unknown>), segmentIndex: segmentAudits.length });
                }
            }
        }
        if (Array.isArray(qc.criticalIssues)) {
            for (const issue of qc.criticalIssues) criticalIssues.push(`${plan.def.name}: ${String(issue)}`);
        }
    }
    const aggregate: Record<string, unknown> = { passed: allPassed, totalDuration, segmentAudits, criticalIssues };
    if (allScored && scores.length > 0) aggregate.overallScore = Math.min(...scores);
    return aggregate;
}

export function dailyGenerate(args: string[]): void {
    const [
        workDir = '',
        runDate = '',
        pluginsPath = '',
        transcodeMp3 = '',
        vdriver = '',
        sectionConcurrency = '',
        episodeMaxMinutes = '',
        episodeMinMinutes = '',
    ] = args;
    // 20260917 review: the workflow picks a voice driver by short name; both drivers' envs are
    // passed unconditionally so switching `vdriver` needs no shell changes. Unknown -> fail loud.
    const VOICE_DRIVERS: Record<string, string> = {
        ominivoice: 'omni-voice-gen',
        voicebox: 'voice-gen',
        gemini: 'gemini-tts',
        voxcpm: 'voxcpm-tts',
    };
    let voiceGenerator = VOICE_DRIVERS[vdriver];
    if (!voiceGenerator) {
        failWith(
            1,
            `generate: unknown vdriver '${vdriver}' (expected one of: ${Object.keys(VOICE_DRIVERS).join(', ')})`,
        );
    }
    // Strict `Number`, not `parseFloat`: a typo'd var ('2O') must refuse, not cap the episode at 2 min.
    const maxMinutes = episodeMaxMinutes === '' ? DEFAULT_EPISODE_MAX_MINUTES : Number(episodeMaxMinutes);
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) {
        failWith(1, `generate: invalid episode_max_minutes: ${episodeMaxMinutes}`);
    }
    const docs = join(workDir, '30-audio', `${runDate}_10_wrap-docs_docs.json`);
    const content = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);

    // Pre-spend script floor gate (2026-10-22). QC's candidate-text estimate does not predict the
    // spoken length — 20261020 planned 3968 chars and rendered 8.4 min, 20261021 planned 4548 and
    // rendered 17.9 — but the authored VoiceScript IS the spoken text, and 14 measured episodes
    // deliver it at 5.24-5.94 chars/s. Reusing `spokenCharRate` (the slowest measured band) makes the
    // estimate over-predict slightly, which is the safe direction here: a thin day is refused before
    // the 1-2 h synthesis, and one that would have cleared the floor is never refused.
    const minMinutes = episodeMinMinutes === '' ? 0 : Number(episodeMinMinutes);
    if (!Number.isFinite(minMinutes) || minMinutes < 0) {
        failWith(1, `generate: invalid episode_min_minutes: ${episodeMinMinutes}`);
    }
    if (minMinutes > 0 && !wholeDocCache(content, voiceGenerator, transcodeMp3)) {
        const scriptPath = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
        if (isFile(scriptPath)) {
            const script = Bun.YAML.parse(readFileSync(scriptPath, 'utf8')) as {
                segments?: Array<{ text?: unknown }>;
            };
            const segments = Array.isArray(script.segments) ? script.segments : [];
            const chars = segments.reduce(
                (sum, segment) => sum + (typeof segment.text === 'string' ? segment.text.length : 0),
                0,
            );
            const charRate = spokenCharRate(vdriver);
            const seconds = 8 + chars / charRate;
            if (seconds < minMinutes * 60) {
                refuseScriptBelowFloor(workDir, runDate, { chars, charRate, seconds, minMinutes });
                return;
            }
            console.log(`script floor ok: ${chars} script chars ≈ ${(seconds / 60).toFixed(1)} min`);
        }
    }

    if (!sectionConcurrency) {
        timed(workDir, 'generate', () => {
            if (wholeDocCache(content, voiceGenerator, transcodeMp3)) {
                console.log(`audio cached: ${content} (QC passed)`);
                return;
            }
            // Gemini quota probe (20261006): the 06:00 cron hit gemini-3.8-flash-tts 429 with a
            // multi-hour retry-after after the shared key's window drained overnight. One tiny
            // render (~1 request) before the real episode; ANY probe failure (quota, key, network)
            // flips this run to the local voicebox driver instead of dying mid-episode — voicebox
            // needs no key. Operator decision 20261006: keep the gemini default + auto-fallback.
            if (vdriver === 'gemini') {
                const docsList = readJson(docs) as Array<Record<string, unknown>>;
                if (
                    docsList.length > 0 &&
                    !geminiQuotaProbeOk(workDir, pluginsPath, transcodeMp3, [{ ...docsList[0], body: 'Hello.' }])
                ) {
                    voiceGenerator = VOICE_DRIVERS.voicebox;
                    // The fallback driver's own cache may already hold this episode (0257 R2) —
                    // reuse it instead of paying for a second local render. VoxCPM never probes
                    // Gemini and never falls back, so this branch is Gemini-only.
                    if (wholeDocCache(content, voiceGenerator, transcodeMp3)) {
                        console.log(`audio cached: ${content} (QC passed)`);
                        return;
                    }
                }
            }
            kk(voiceExecutorArgs(voiceGenerator, docs, content, pluginsPath), {
                env: { VOICE_GEN_MP3: transcodeMp3 },
            });
            ensurePublishMp3(content, transcodeMp3);
        });
        return;
    }

    if (sectionConcurrency !== '1') {
        failWith(1, `generate: section_concurrency '${sectionConcurrency}' not supported (must be 1)`);
    }

    timed(workDir, 'generate', () => {
        const scriptPath = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
        if (!existsSync(scriptPath)) {
            failWith(1, `generate: voicescript not found: ${scriptPath}`);
        }
        const scriptRaw = readFileSync(scriptPath, 'utf8');
        const script = Bun.YAML.parse(scriptRaw) as Record<string, unknown>;
        const segments = (script.segments ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(segments) || segments.length < 2) {
            failWith(1, 'generate: invalid voicescript (expected at least opening and closing segments)');
        }

        // Grouping: first is opening, last is closing, middle segments split after gap_ms: 1200
        const middleSegments = segments.slice(1, -1);
        const itemSections: Array<Array<Record<string, unknown>>> = [];
        let currentItem: Array<Record<string, unknown>> = [];
        for (const seg of middleSegments) {
            currentItem.push(seg);
            if (seg.gap_ms === 1200) {
                itemSections.push(currentItem);
                currentItem = [];
            }
        }
        if (currentItem.length > 0) {
            itemSections.push(currentItem);
        }

        const planPath = join(workDir, '24-script', `${runDate}_08_script-write_plan.json`);
        if (existsSync(planPath)) {
            try {
                const plan = readJson(planPath) as { items?: unknown[] };
                if (Array.isArray(plan.items)) {
                    const expected = expectedItemSections(workDir, runDate, plan.items);
                    if (expected !== itemSections.length) {
                        failWith(
                            1,
                            `generate: plan item count (${plan.items.length}, ${plan.items.length - expected} recorded as excluded) does not match script item sections (${itemSections.length})`,
                        );
                    }
                }
            } catch (e: unknown) {
                if (e instanceof StageFailure) throw e;
            }
        }

        interface SectionDef {
            index: number;
            role: string;
            stem: string;
            name: string;
            segments: Array<Record<string, unknown>>;
            characters: number;
            gap_ms: number;
            text: string;
        }

        const sectionDefs: SectionDef[] = [];
        // 00-opening
        const openSegs = [segments[0]];
        const openText = openSegs.map((s) => String(s.text ?? '')).join('');
        sectionDefs.push({
            index: 0,
            role: 'opening',
            stem: '00-opening',
            name: '00-opening',
            segments: openSegs,
            characters: [...openText].length,
            gap_ms:
                typeof openSegs[openSegs.length - 1].gap_ms === 'number'
                    ? (openSegs[openSegs.length - 1].gap_ms as number)
                    : 1200,
            text: openText,
        });

        // 01-item ...
        itemSections.forEach((segs, idx) => {
            const itemIdx = idx + 1;
            const pad = String(itemIdx).padStart(2, '0');
            const stem = `${pad}-item`;
            const itemText = segs.map((s) => String(s.text ?? '')).join('');
            const lastSeg = segs[segs.length - 1];
            sectionDefs.push({
                index: itemIdx,
                role: 'item',
                stem,
                name: stem,
                segments: segs,
                characters: [...itemText].length,
                gap_ms: typeof lastSeg?.gap_ms === 'number' ? (lastSeg.gap_ms as number) : 1200,
                text: itemText,
            });
        });

        // closing
        const closeIdx = sectionDefs.length;
        const closePad = String(closeIdx).padStart(2, '0');
        const closeSegs = [segments[segments.length - 1]];
        const closeText = closeSegs.map((s) => String(s.text ?? '')).join('');
        sectionDefs.push({
            index: closeIdx,
            role: 'closing',
            stem: `${closePad}-closing`,
            name: `${closePad}-closing`,
            segments: closeSegs,
            characters: [...closeText].length,
            gap_ms:
                typeof closeSegs[closeSegs.length - 1].gap_ms === 'number'
                    ? (closeSegs[closeSegs.length - 1].gap_ms as number)
                    : 300,
            text: closeText,
        });

        // Character-rate estimate: section characters / driver rate + 8 s sting > the workflow's
        // ceiling (`episode_max_minutes`, arg 8; default 20 for a bare five/six-argument call).
        // The rates are MEASURED from shipped renders, not the style contract's prose. gemini-tts:
        // 20261004 5466 chars / 1026 s = 5.33, 20261007 5970 / 1096 = 5.45, and the 0237 live dry run
        // 4645 / 789.9 s of section speech = 5.88 — a 5.3–5.9 range, so 5.4 deliberately errs low (a
        // slightly early refusal is cheaper than a rendered episode the duration gate then rejects).
        // voice-gen: 20261006 6376 / 1135 = 5.62. A 20-minute ceiling is therefore ~6400 characters.
        // VoxCPM (voxcpm-tts) shares the 5.6 voicebox estimate — PROVISIONAL: no measured VoxCPM
        // episode exists yet (0258 supplies the evidence); the measured duration stays authoritative.
        // The style sidecar's 3.3 / 6.3 figures are stale and mutually inconsistent with its own
        // 4300–5800 字 budget (which is 13–29 min at 3.3); using them refused a script that really
        // renders in 17 min. Recalibrate from a fresh pair of `metadata.duration` readings when a
        // driver changes model or speed.
        const charRate = voiceGenerator === 'gemini-tts' ? 5.4 : 5.6;
        const totalChars = sectionDefs.reduce((acc, s) => acc + s.characters, 0);
        const estimatedSeconds = 8 + totalChars / charRate;
        if (estimatedSeconds > maxMinutes * 60) {
            const longest3 = [...sectionDefs].sort((a, b) => b.characters - a.characters).slice(0, 3);
            failWith(
                1,
                `generate: character-rate estimate ${Math.round(estimatedSeconds / 60)} min exceeds ${maxMinutes} min limit (longest sections: ${longest3.map((s) => s.name).join(', ')})`,
            );
        }

        const voiceProfile =
            (typeof script.default_profile_id === 'string' && script.default_profile_id) ||
            (typeof script.default_profile === 'string' && script.default_profile) ||
            process.env.VOICEBOX_DEFAULT_PROFILE ||
            'robin-news';

        const secDir = join(workDir, '30-audio', 'sections', runDate);
        mkdirSync(secDir, { recursive: true });

        const joinedWavPath = join(workDir, '30-audio', `${runDate}_11_generate_content.wav`);
        const joinedContentPath = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);

        interface SectionPlan {
            def: SectionDef;
            hash: string;
            wavPath: string;
            jsonPath: string;
            needsSynthesis: boolean;
        }

        const computePlans = (driver: string): SectionPlan[] => {
            return sectionDefs.map((def) => {
                const hash = createHash('sha256').update(`${def.text}\0${voiceProfile}\0${driver}`).digest('hex');
                const wavPath = join(secDir, `${def.stem}.wav`);
                const jsonPath = join(secDir, `${def.stem}.json`);
                let cached = false;
                if (existsSync(wavPath) && existsSync(jsonPath)) {
                    try {
                        const sidecar = readJson(jsonPath) as Record<string, unknown>;
                        const sidecarMeta = metadataOf(sidecar) as Record<string, unknown>;
                        const sidecarQc = sidecarMeta.qc as Record<string, unknown> | undefined;
                        // A completed section is reusable only when its provenance, QC and audio
                        // all belong to this driver/text/profile — a foreign or half-written
                        // sidecar re-renders (0257 R2). The hash already folds in the driver.
                        if (
                            (sidecar.hash === hash || sidecarMeta.hash === hash) &&
                            sidecarMeta.generator === `kk:${driver}` &&
                            sidecarQc?.passed === true &&
                            validNativeAudio(wavPath)
                        ) {
                            cached = true;
                        }
                    } catch {}
                }
                return {
                    def,
                    hash,
                    wavPath,
                    jsonPath,
                    needsSynthesis: !cached,
                };
            });
        };

        let plans = computePlans(voiceGenerator);
        const anySynthesisNeeded = plans.some((p) => p.needsSynthesis);

        // All sections hit, but the joined final is reusable only when its frozen identity matches
        // this run's ordered section hashes (0257 R3). A stale or legacy final — e.g. a previous
        // join failed — falls through and rejoins the cached sections below, with no model calls.
        if (
            !anySynthesisNeeded &&
            joinedFinalFresh(
                joinedContentPath,
                voiceGenerator,
                plans.map((p) => p.hash),
                transcodeMp3,
            )
        ) {
            console.log('generate: all sections cached, joined speech reused');
            return;
        }

        // Same quota probe as the one-shot path, before any section request. A fallback changes
        // the cache key, so plans are recomputed and no Gemini file is played as voicebox speech.
        if (
            anySynthesisNeeded &&
            vdriver === 'gemini' &&
            !geminiQuotaProbeOk(workDir, pluginsPath, transcodeMp3, [
                {
                    id: 'probe',
                    title: 'Probe',
                    body: Bun.YAML.stringify({
                        title: 'Probe',
                        segments: [{ text: 'Hello.' }],
                    }),
                    sourceUri: 'file://probe',
                    mediaType: 'application/yaml',
                    metadata: { voiceProfile },
                },
            ])
        ) {
            voiceGenerator = VOICE_DRIVERS.voicebox;
            plans = computePlans(voiceGenerator);
        }

        // Synthesize sections sequentially (concurrency 1)
        for (const plan of plans) {
            if (!plan.needsSynthesis) {
                console.log(`generate: section cached: ${plan.def.stem}`);
                continue;
            }
            console.log(`generate: synthesizing section: ${plan.def.stem}`);
            const secScript = { ...script, segments: plan.def.segments };
            const secDocIn = join(secDir, `.${plan.def.stem}_in.json`);
            const doc = {
                id: createHash('sha256').update(`section-${plan.def.stem}`).digest('hex').slice(0, 16),
                title: `Daily AI News VoiceScript - ${plan.def.stem}`,
                sourceUri: `file://${resolve(scriptPath)}#${plan.def.stem}`,
                body: Bun.YAML.stringify(secScript),
                mediaType: 'application/yaml',
                metadata: { voiceProfile },
            };
            writeJsonText(secDocIn, [doc]);
            try {
                // 0269-shaped hardening (20261012): one retry for a failed section. The design already
                // bounds the episode's risk with the pre-flight quota probe and the per-section cache,
                // but a failure that arrives MID-render (a 429 once the window drains, a network blip)
                // still cost the whole episode — the one step nothing can publish without. The retry is
                // cheap and bounded: the successful sections are cache hits, so at most one extra
                // request per failed section is issued, and a persistent failure still fails loud.
                let status = kk(voiceExecutorArgs(voiceGenerator, secDocIn, plan.jsonPath, pluginsPath), {
                    env: { VOICE_GEN_MP3: transcodeMp3 },
                    soft: true,
                });
                if (status !== 0) {
                    console.log(
                        `generate: section ${plan.def.stem} synthesis failed (exit ${status}) — retrying it once`,
                    );
                    status = kk(voiceExecutorArgs(voiceGenerator, secDocIn, plan.jsonPath, pluginsPath), {
                        env: { VOICE_GEN_MP3: transcodeMp3 },
                        soft: true,
                    });
                }
                if (status !== 0) {
                    failWith(status, `generate: section synthesis failed for ${plan.def.stem}`);
                }
            } finally {
                rmSync(secDocIn, { force: true });
            }
            try {
                const sidecar = readJson(plan.jsonPath) as Record<string, unknown>;
                sidecar.hash = plan.hash;
                if (sidecar.metadata && typeof sidecar.metadata === 'object') {
                    (sidecar.metadata as Record<string, unknown>).hash = plan.hash;
                }
                writeJsonText(plan.jsonPath, sidecar);
            } catch {}
        }

        // Join sections with ffmpeg
        const probeHelper = (file: string, entries: string): string =>
            spawnSync('ffprobe', [
                '-v',
                'error',
                '-select_streams',
                'a:0',
                '-show_entries',
                entries,
                '-of',
                'csv=p=0',
                file,
            ])
                .stdout?.toString()
                .trim() ?? '';

        const sampleRate = probeHelper(plans[0].wavPath, 'stream=sample_rate') || '24000';
        const ffmpegArgs = ['-y', '-hide_banner', '-loglevel', 'error'];
        const filterParts: string[] = [];
        const concatInputs: string[] = [];

        plans.forEach((plan, i) => {
            ffmpegArgs.push('-i', plan.wavPath);
            filterParts.push(`[${i}:a]aresample=${sampleRate},aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`);
            concatInputs.push(`[a${i}]`);
            if (i < plans.length - 1) {
                const gapMs = plan.def.gap_ms;
                const gapS = gapMs > 0 ? (gapMs / 1000).toFixed(4) : '0';
                filterParts.push(`anullsrc=r=${sampleRate}:cl=mono,atrim=duration=${gapS}[sil${i}]`);
                concatInputs.push(`[sil${i}]`);
            }
        });

        const filterComplex = `${filterParts.join(';')};${concatInputs.join('')}concat=n=${concatInputs.length}:v=0:a=1[out]`;
        ffmpegArgs.push('-filter_complex', filterComplex, '-map', '[out]', '-c:a', 'pcm_s16le', joinedWavPath);

        const conv = spawnSync('ffmpeg', ffmpegArgs);
        if (conv.status !== 0 || !existsSync(joinedWavPath)) {
            failWith(1, `generate: ffmpeg join failed: ${conv.stderr?.toString().trim()}`);
        }

        const joinedDuration = Number.parseFloat(probeHelper(joinedWavPath, 'format=duration'));
        if (!validNativeAudio(joinedWavPath) || !Number.isFinite(joinedDuration)) {
            failWith(1, `generate: joined audio is not a playable native-rate WAV: ${joinedWavPath}`);
        }

        // podcast-pub renders the show-notes timeline from `metadata.segments[]` (per-segment
        // duration + ASR transcription). The one-shot path receives them from the voice plugin, but
        // this sectioned path synthesizes one sidecar per section and dropped them at the join — every
        // timeline row rendered 0:00 (2026-10-11). Rebuild the list in section order from the CURRENT
        // sidecars, never inherit the previous final's list (0257 R3).
        const joinedSegments: Array<Record<string, unknown>> = [];
        for (const plan of plans) {
            const sectionSegments = metadataOf(readJson(plan.jsonPath)).segments;
            if (Array.isArray(sectionSegments)) {
                joinedSegments.push(...(sectionSegments as Array<Record<string, unknown>>));
            }
        }
        // Rebuild the Content envelope from the current script/sections. The previous final's
        // generator/QC/mp3Path/sectionHashes must never survive a fresh join, and mp3Path is
        // deliberately absent so ensurePublishMp3 regenerates the requested derivative (0257 R3).
        const baseMeta: Record<string, unknown> = {
            generator: `kk:${voiceGenerator}`,
            audioPath: joinedWavPath,
            duration: joinedDuration,
        };
        if (joinedSegments.length > 0) baseMeta.segments = joinedSegments;
        const contentObj: Record<string, unknown> = {
            title: typeof script.title === 'string' && script.title !== '' ? script.title : 'Daily AI News',
            body: scriptRaw,
            format: 'audio',
            references: [],
            audioPath: joinedWavPath,
            mediaType: 'audio/wav',
            metadata: baseMeta,
        };
        writeJsonText(joinedContentPath, contentObj);
        // Transcode the requested MP3 before any success claim is written: a failed conversion
        // fails loud with no qc.passed on disk, so the next run rejoins the cached sections rather
        // than trusting a broken final (0257 R3).
        ensurePublishMp3(joinedContentPath, transcodeMp3);
        // Join and derivative are proven; only now record the frozen identity and aggregated QC.
        const finalized = readJson(joinedContentPath) ?? contentObj;
        const finalMeta = metadataOf(finalized);
        finalMeta.qc = aggregateSectionQc(plans, joinedDuration);
        finalMeta.sectionHashes = plans.map((p) => p.hash);
        finalized.metadata = finalMeta;
        writeJsonText(joinedContentPath, finalized);
    });
}

/**
 * 20260917 review #7: prepend the show's 8s intro sting to the generated audio.
 * `intro_music` empty -> skip. Writes `<stem>.intro.wav` (original render kept), points
 * `audioPath` at the merged file, extends `duration`, marks `introMerged` (idempotent).
 */
/**
 * Episode duration gate (standing requirement, 20261002): a daily episode must run 15–20 minutes
 * (duration is authoritative; the 8–10-item figure is only an estimate). Reads the final audio
 * content's `metadata.duration` — after the intro sting merged, this is the true episode length —
 * and fails loud outside `[min, max]` seconds-worth of minutes. A missing duration is a failure,
 * not a pass: the gate must never silently let an under-length episode through again.
 */
export function dailyIntro(args: string[]): void {
    const [workDir = '', runDate = '', introSrc = ''] = args;
    if (!introSrc || introSrc.trim() === '') {
        console.log('intro-music: intro_music var empty — skip');
        return;
    }
    const contentPath = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'intro-music', () => {
        const content = requireJson(contentPath, 'intro-music');
        const meta = metadataOf(content);
        if (meta.introMerged === true) {
            console.log(`intro-music cached: ${contentPath}`);
            return;
        }
        // Merge from the raw lossless render; mp3Path is the derived publish artifact.
        // Preferring mp3Path here made `<stem>.mp3` the concat input while the output
        // suffix rewrite (`.wav` -> `.intro.wav`) no longer matched, so ffmpeg saw one
        // path as both input #1 and output and aborted with "same as Input #1".
        const candidates = [meta.audioPath, meta.mp3Path].filter(
            (candidate): candidate is string => typeof candidate === 'string' && candidate !== '',
        );
        const rawFile = candidates.find((candidate) => existsSync(resolve(candidate))) ?? candidates[0];
        if (rawFile === undefined) {
            failWith(1, 'intro-music: voice content carries no mp3Path/audioPath');
        }
        // The sting is an operator asset under the config root (ADR-042), not a works artifact:
        // workflow vars carry it as `~/.config/kk/voices/…`, and a shell does not expand `~` inside
        // the quoted "${vars.intro_music}" argument, so expansion happens here.
        const introPath = resolve(expandHome(introSrc));
        if (!existsSync(introPath)) failWith(1, `intro-music: intro file not found: ${introPath}`);
        const mainPath = resolve(rawFile);
        if (!existsSync(mainPath)) failWith(1, `intro-music: generated audio not found: ${mainPath}`);
        const mergedPath = `${mainPath.replace(/\.(wav|mp3)$/i, '')}.intro.wav`;
        const probe = (file: string, entries: string): string =>
            spawnSync('ffprobe', [
                '-v',
                'error',
                '-select_streams',
                'a:0',
                '-show_entries',
                entries,
                '-of',
                'csv=p=0',
                file,
            ])
                .stdout?.toString()
                .trim() ?? '';
        const mainDur = Number.parseFloat(probe(mainPath, 'format=duration'));
        const introDur = Number.parseFloat(probe(introPath, 'format=duration'));
        if (!Number.isFinite(mainDur) || !Number.isFinite(introDur)) {
            failWith(1, `intro-music: ffprobe could not read durations (main=${mainDur} intro=${introDur})`);
        }
        const rate = probe(mainPath, 'stream=sample_rate') || '24000'; // match the generated audio's rate; mono s16 both sides
        const norm = (label: string): string =>
            `[${label}:a]aresample=${rate},aformat=sample_fmts=s16:channel_layouts=mono[${label}]`;
        const fc = `${norm('0')};${norm('1')};[0][1]concat=n=2:v=0:a=1[out]`;
        const conv = spawnSync('ffmpeg', [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            introPath,
            '-i',
            mainPath,
            '-filter_complex',
            fc,
            '-map',
            '[out]',
            '-c:a',
            'pcm_s16le',
            mergedPath,
        ]);
        if (conv.status !== 0 || !existsSync(mergedPath)) {
            failWith(1, `intro-music: ffmpeg concat failed: ${conv.stderr?.toString().trim()}`);
        }
        if (meta.mp3Path && typeof meta.mp3Path === 'string') {
            // transcode_mp3=true: keep the mp3 path honest by re-transcoding the merged wav.
            const mp3 = spawnSync('ffmpeg', [
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                mergedPath,
                '-codec:a',
                'libmp3lame',
                '-qscale:a',
                '2',
                resolve(meta.mp3Path),
            ]);
            if (mp3.status !== 0) failWith(1, `intro-music: mp3 re-transcode failed: ${mp3.stderr?.toString().trim()}`);
        }
        const mergedDur = Number.parseFloat(probe(mergedPath, 'format=duration')) || mainDur + introDur;
        const updated = {
            ...content,
            metadata: {
                ...meta,
                audioPath: mergedPath,
                duration: mergedDur,
                introMerged: true,
            },
        };
        sted('write', contentPath, () => writeJsonText(contentPath, updated));
        console.log(
            `intro-music: merged ${introDur.toFixed(1)}s intro -> ${mergedPath} (${mergedDur.toFixed(1)}s total)`,
        );
    });
}

export function dailyPlan(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', planMaxItems = '', deferPlanDocs = ''] = args;
    const planContent = join(workDir, '21-plan', `${runDate}_03_plan_content.json`);
    const planDocs = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    // voice2's extract node writes 10-collect/pool.json; voice1's fan-in still writes the blended
    // file. Prefer the pool when it exists so both DAGs share this stage (0212 dogfood finding).
    const pool = join(workDir, '10-collect', 'pool.json');
    const blended = isFile(pool) ? pool : join(workDir, '10-ingest', `${runDate}_02_collect_blended.json`);
    // voice2 passes plan_translate_enabled. When it is true, plan-translate owns plan.json: its
    // `! test -s` guard is also the first-run gate, so writing the English docs here skips the
    // translation. Voice1 omits the arg and still materializes the file (its translate node has no
    // skip guard and overwrites it).
    const deferDocs = deferPlanDocs === 'true';
    const target = deferDocs ? planContent : planDocs;
    const targetCache = `${target}.cache.json`;
    const fingerprint = stageCacheFingerprint(blended, {
        runDate,
        planMaxItems,
        deferPlanDocs,
    });
    timed(workDir, 'plan', () => {
        if (stageCacheMatches(target, targetCache, fingerprint)) {
            console.log(`plan cached: ${deferDocs ? planContent : planDocs}`);
            return;
        }
        if (isFile(target)) {
            const descendants = authoredPlanDescendants(workDir, runDate);
            if (descendants.length > 0) {
                failWith(
                    1,
                    `plan cache changed after downstream artifacts were authored; refusing to pair a new plan with stale outputs (${descendants.join(', ')})`,
                );
            }
            console.log(`plan cache stale: ${target}`);
        }
        kk(
            ['executor', 'run', 'episode-plan-gen', '--in', blended, '--out', planContent, ...pluginsArgs(pluginsPath)],
            {
                env: { EPISODE_PLAN_MAX_ITEMS: planMaxItems, EPISODE_PLAN_DATE: runDate },
            },
        );
        const docs = metadataOf(readJson(planContent)).docs;
        if (!Array.isArray(docs) || docs.length === 0) failWith(1, 'plan: content.metadata.docs missing or empty');
        if (deferDocs) {
            // A translated plan is a descendant of this content plan. Remove only the stale
            // translation when no authored downstream artifact exists; otherwise the guard above
            // fails closed and leaves the operator a reviewable workspace.
            if (isFile(planDocs)) unlinkSync(planDocs);
            if (isFile(`${planDocs}.cache.json`)) unlinkSync(`${planDocs}.cache.json`);
        } else {
            sted('write', planDocs, () => writeJsonText(planDocs, docs));
            if (!isFile(planDocs)) failWith(1, `plan: ${planDocs} not written after episode-plan-gen`);
        }
        sted('write', targetCache, () => writeStageCache(targetCache, fingerprint));
    });
}

/**
 * The two public URLs every downstream channel links to (task 0327 R1).
 *
 * voice2 passes the real urls its tier-0 stages just produced; the variant stage passes
 * `{{article_url}}` / `{{podcast_url}}` so a generate-side bundle can be frozen before anything is
 * published, and `publish-matrix-send` resolves them from the tier-0 receipts at send time.
 */
export interface PublishLinks {
    articleUrl: string;
    podcastUrl: string;
}

/** Placeholder links: the variant contract publish-matrix-send resolves. */
export const PLACEHOLDER_LINKS: PublishLinks = {
    articleUrl: '{{article_url}}',
    podcastUrl: '{{podcast_url}}',
};

/** The wechatmp-only closing line (operator request 2026-09-29). */
const WECHAT_OUTRO = '\n\n欲听往期节目，可至小宇宙、Apple Podcast、YouTube 等平台搜索【咸话咸说】。';

/** The brand strings this daily show pins on every 公众号 draft. */
const WECHAT_BRAND = {
    author: '冰原奔狼',
    claimSource: '个人观点，仅供参考',
    coverSource: 'library',
} as const;

/**
 * The 公众号 article payload (task 0327 R1): the article Content plus MP draft enrichment.
 *
 * Every field is consumed by `wechatmp-pub`'s flow; the only link it needs is the 原文链接, which is
 * the surfdash post — hence `links.articleUrl` rather than a path read.
 */
export function buildWechatArticleContent(
    article: Record<string, unknown>,
    options: {
        links: PublishLinks;
        publishStatus: 'draft' | 'public';
        collection: string;
        coverPath?: string;
        audioPath?: string;
        audioTitle?: string;
        /**
         * The 咸话咸说 closer is an article-only sign-post (operator request 2026-09-29: "appended
         * to the wechat input body only, never the master article"). An audio-first 公众号 播客 post
         * carries the episode body, so it passes `false`.
         */
        appendOutro?: boolean;
    },
): Record<string, unknown> {
    const wechatmp: Record<string, unknown> = {
        original: true,
        // 赞赏 is enabled per episode; the plugin fills the 赞赏账户 only when the platform leaves it
        // empty (it defaults from 作者, operator walk 2026-10-10).
        reward: true,
        author: WECHAT_BRAND.author,
        collection: options.collection,
        // 创作来源 is the column's own stance, not an AI-declaration label (2026-10-10).
        claimSource: WECHAT_BRAND.claimSource,
        // 封面 comes from 图片库: the episode cover is uploaded there as the audio material's cover.
        coverSource: WECHAT_BRAND.coverSource,
        ...(options.links.articleUrl !== '' ? { originalUrl: options.links.articleUrl } : {}),
        ...(options.coverPath === undefined ? {} : { coverPath: options.coverPath }),
        ...(options.audioPath === undefined
            ? {}
            : {
                  audioPath: options.audioPath,
                  audioTitle: options.audioTitle ?? '',
                  audioCoverPath: options.coverPath ?? '',
              }),
    };
    const body = typeof article.body === 'string' ? article.body : '';
    return {
        ...article,
        body: options.appendOutro === false ? body : `${body}${WECHAT_OUTRO}`,
        metadata: { ...metadataOf(article), publishStatus: options.publishStatus, wechatmp },
    };
}

/**
 * The 小红书 发播客 payload (task 0327 R1, extracted from `xhsPodcastNote`).
 *
 * The run's publish-prep Content carries the final mp3, the cover and the body; this only restates
 * `metadata.audio` under the key the channel's 发播客 mode reads.
 */
export function buildXhsEpisodeContent(
    prep: Record<string, unknown>,
    options: { publishStatus: 'draft' | 'public'; links?: PublishLinks },
): Record<string, unknown> {
    const metadata = metadataOf(prep);
    return {
        ...prep,
        metadata: {
            ...metadata,
            operation: '发播客',
            audio: metadata.audioFile,
            publishStatus: options.publishStatus,
        },
    };
}

/** The 小红书 写长文 payload (task 0327 R1): the article Content with its publish status. */
export function buildXhsArticleContent(
    article: Record<string, unknown>,
    options: { publishStatus: 'draft' | 'public' },
): Record<string, unknown> {
    return {
        ...article,
        metadata: { ...metadataOf(article), publishStatus: options.publishStatus },
    };
}

/** The 小红书 上传图文 payload (task 0327 R1): the rendered card series plus its status. */
export function buildXhsCardsContent(
    cards: Record<string, unknown>,
    options: { publishStatus: 'draft' | 'public'; followUps?: unknown[] },
): Record<string, unknown> {
    return {
        ...cards,
        metadata: {
            ...metadataOf(cards),
            publishStatus: options.publishStatus,
            ...(options.followUps === undefined ? {} : { followUps: options.followUps }),
        },
    };
}

/** The podcast payload (task 0327 R1): publish-prep Content plus the episode's show notes. */
export function buildPodcastContent(
    prep: Record<string, unknown>,
    options: { showNotes: string; podcast?: Record<string, unknown> },
): Record<string, unknown> {
    return {
        ...prep,
        metadata: {
            ...metadataOf(prep),
            showNotes: options.showNotes,
            // Podcast-specific SEO metadata (refined title/description, per-item plan) rides under
            // one key so a channel payload cannot leak it into another channel's fields.
            ...(options.podcast === undefined ? {} : { podcast: options.podcast }),
        },
    };
}

/**
 * The surfdash payload (task 0327 R1): the article Content, unchanged.
 *
 * surfdash is the article's own publisher, so it consumes what `22-article` already composed — the
 * builder exists so the variant set is uniform, not because it reshapes anything.
 */
export function buildSurfdashContent(article: Record<string, unknown>, _links: PublishLinks): Record<string, unknown> {
    return { ...article };
}

/**
 * One channel's short copy as a Content (task 0327 R3): the body is the authored post text and the
 * episode cover rides along as `metadata.coverImage`.
 */
/**
 * A channel's length budget: `max` in that channel's own counting unit.
 *
 * `weighted` is X's rule (CJK counts 2, a Latin letter 1) — the design's "280 weighted chars". Counting
 * code points instead let a 280-character Chinese post through at ~560 of X's units, which is exactly
 * the over-length draft the backstop exists to catch.
 */
interface SocialLimit {
    max: number;
    weighted?: boolean;
}

/** Weight of one code point in X's unit system: CJK ideographs and fullwidth forms count 2. */
function weightedCharWeight(char: string): number {
    const code = char.codePointAt(0) ?? 0;
    const wide =
        (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
        (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals … Yi
        (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
        (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
        (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
        (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
        (code >= 0xffe0 && code <= 0xffe6);
    return wide ? 2 : 1;
}

/** Weighted length of `text` (code-point based, so an emoji counts once before its weight). */
function weightedLength(text: string): number {
    let total = 0;
    for (const char of text) total += weightedCharWeight(char);
    return total;
}

/**
 * One channel's short copy as a Content (task 0327 R3): the body is the authored post text and the
 * episode cover rides along as `metadata.coverImage`.
 *
 * The cap is a backstop, not the author: the prompt owns the limit, so an over-length draft is
 * truncated rather than rejected, and `truncatedFrom` records what was cut. Truncation respects the
 * channel's own unit — see {@link SocialLimit}.
 */
export function buildSocialContent(
    copy: string,
    options: { platform: string; coverPath?: string; limit: SocialLimit },
): Record<string, unknown> {
    const trimmed = copy.trim();
    const measure = (text: string): number => (options.limit.weighted === true ? weightedLength(text) : text.length);
    let body = trimmed;
    if (measure(trimmed) > options.limit.max) {
        // Walk code points, adding while the budget holds: a slice by code units could split a
        // surrogate pair or bust the weighted budget on CJK text.
        let kept = '';
        let used = 0;
        for (const char of trimmed) {
            const weight = options.limit.weighted === true ? weightedCharWeight(char) : 1;
            if (used + weight > options.limit.max) break;
            kept += char;
            used += weight;
        }
        body = kept;
    }
    return {
        title: `${options.platform} · 每日AI乱炖`,
        format: 'text',
        body,
        metadata: {
            platform: options.platform,
            ...(body === trimmed
                ? {}
                : {
                      truncatedFrom: measure(trimmed),
                      truncatedUnit: options.limit.weighted === true ? 'weighted' : 'code_units',
                  }),
            ...(options.coverPath === undefined ? {} : { coverImage: options.coverPath }),
        },
    };
}

/**
 * Length budgets the social authoring prompt targets, enforced here as a backstop (task 0327 R3).
 * X counts CJK at 2 (`weighted`); weibo and threads count characters.
 */
const SOCIAL_LIMITS: Record<string, SocialLimit> = {
    x: { max: 280, weighted: true },
    weibo: { max: 2000 },
    threads: { max: 500 },
};

/** Variant key → file name: `social:x` becomes `social_x.content.json`. */
function variantFileName(key: string): string {
    return `${key.replaceAll(':', '_')}.content.json`;
}

/**
 * `daily-bundle-variants <workDir> <runDate> <pluginsPath> [cardsEnabled] [coverEnabled]` — the
 * generate-side payload builder (task 0327 R2/R3).
 *
 * Everything the publish side used to assemble inline is produced here instead, once, as bundle
 * variants under `30-variants/`. Links are the `{{article_url}}` / `{{podcast_url}}` placeholders,
 * because at generate time nothing is published yet; `publish-matrix-send` resolves them from the
 * tier-0 receipts. A variant whose source artifact is absent (channel disabled, cards never
 * rendered, social copy not authored) is skipped with a log line, never invented.
 *
 * 0329 F16: the caller forwards the run's `cards_enabled` / `cover_enabled` switches — a disabled
 * producer's variant is a skip, not a stale re-read of a previous run's file — and every stale
 * variant file is wiped before writing, so `30-variants/` after this stage contains only what
 * THIS pass produced.
 */
export function dailyBundleVariants(args: string[]): void {
    const [workDir = '', runDate = '', _pluginsPath = '', cardsEnabledArg = '', coverEnabledArg = ''] = args;
    timed(workDir, 'bundle-variants', () => {
        const outDir = join(workDir, '30-variants');
        sted('mkdir', outDir, () => mkdirSync(outDir, { recursive: true }));
        // 0329 F16: a rerun after a thinner day must not leave yesterday's variants behind.
        for (const entry of readdirSync(outDir)) {
            if (entry.endsWith('.content.json')) rmSync(join(outDir, entry), { force: true });
        }
        const articlePath = join(workDir, '22-article', `${runDate}_06_article_content.json`);
        const prepPath = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
        const notesPath = join(workDir, '31-publish', `${runDate}_15_show-notes_show-notes.md`);
        const cardsPath = join(workDir, '25-xhs', 'content.json');
        const coverPath = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
        const socialDir = join(workDir, '26-social');
        const cover = coverEnabledArg !== 'false' && isFile(coverPath) ? coverPath : undefined;
        const links = PLACEHOLDER_LINKS;
        const written: string[] = [];
        const skipped: string[] = [];

        const article = readJson(articlePath);
        const prep = readJson(prepPath);
        const write = (key: string, content: Record<string, unknown>): void => {
            const file = join(outDir, variantFileName(key));
            sted('write', file, () => writeJsonText(file, content));
            written.push(key);
        };

        // Generic variants first: a channel-specific variant wins over the shared one, so the
        // shared copy must exist for the channels the preset does not specialise.
        if (article === null) skipped.push('article (no 22-article content)');
        else {
            write('article', buildSurfdashContent(article, links));
            write('article@surfdash-pub', buildSurfdashContent(article, links));
            write('article@xhs-pub', buildXhsArticleContent(article, { publishStatus: 'draft' }));
            write(
                'article@wechatmp-pub',
                buildWechatArticleContent(article, {
                    links,
                    publishStatus: 'draft',
                    collection: '每日AI资讯',
                    ...(cover === undefined ? {} : { coverPath: cover }),
                }),
            );
        }

        if (prep === null) skipped.push('episode (no publish-prep content)');
        else {
            const showNotes = isFile(notesPath) ? readFileSync(notesPath, 'utf-8') : '';
            write('episode', buildPodcastContent(prep, { showNotes }));
            write('episode@podcast-pub', buildPodcastContent(prep, { showNotes }));
            write('episode@xhs-pub', buildXhsEpisodeContent(prep, { publishStatus: 'draft', links }));
            // 公众号 播客 shares the episode with podcast-pub: same audio, same cover, no article body.
            write(
                'episode@wechatmp-pub',
                buildWechatArticleContent(prep, {
                    links,
                    publishStatus: 'draft',
                    collection: '每日AI资讯',
                    // Audio-first post: it carries the episode body, so no article closer.
                    appendOutro: false,
                    ...(cover === undefined ? {} : { coverPath: cover }),
                    ...(typeof metadataOf(prep).audioFile === 'string'
                        ? { audioPath: String(metadataOf(prep).audioFile) }
                        : {}),
                }),
            );
        }

        if (cardsEnabledArg === 'false') skipped.push('cards (cards_enabled=false)');
        else {
            const cards = readJson(cardsPath);
            if (cards === null) skipped.push('cards (no rendered card series)');
            else write('cards@xhs-pub', buildXhsCardsContent(cards, { publishStatus: 'draft' }));
        }

        for (const platform of Object.keys(SOCIAL_LIMITS)) {
            const copyPath = join(socialDir, `${platform}.md`);
            if (!isFile(copyPath)) {
                skipped.push(`social:${platform} (no 26-social/${platform}.md)`);
                continue;
            }
            const limit = SOCIAL_LIMITS[platform] ?? { max: 500 };
            write(
                `social:${platform}`,
                buildSocialContent(readFileSync(copyPath, 'utf-8'), {
                    platform,
                    limit,
                    ...(cover === undefined ? {} : { coverPath: cover }),
                }),
            );
        }

        console.log(`bundle-variants: ${written.length} variant(s) in ${outDir}: ${written.join(', ')}`);
        if (skipped.length > 0) console.log(`bundle-variants: skipped ${skipped.join('; ')}`);
    });
}

/**
 * Topic-boundary sidecar (task 0189 R2). Sibling of this file; node-builtins-only read.
 */
/** Surfing frontmatter scalar. Inline on purpose: this file cannot import `@gobing-ai/*`. */
function readFrontmatterScalar(filePath: string, key: string): string | undefined {
    if (!isFile(filePath)) return undefined;
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    const matter = block?.[1];
    if (!matter) return undefined;
    const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(matter);
    if (!match?.[1]) return undefined;
    const value = match[1].trim().replace(/^["']|["']$/g, '');
    return value.length > 0 ? value : undefined;
}

/** The `key_points` item texts of a Surfing post's frontmatter; undefined when absent/unreadable. */
export function readKeyPointItems(filePath: string): string[] | undefined {
    if (!isFile(filePath)) return undefined;
    let raw: string;
    try {
        raw = readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1];
    if (!block) return undefined;
    // Slice from `key_points` to the first top-level key (or block end), then read the item lines
    // (`- `). Folded (`>-`) YAML items need their indented continuation lines joined before the
    // strict scheduled validator can check the `Label — sentence` contract.
    const head = /^key_points:\n/m.exec(block);
    if (!head) return undefined;
    const body = block.slice(head.index + head[0].length);
    const endMatch = /^\S/m.exec(body);
    const list = endMatch ? body.slice(0, endMatch.index) : body;
    const items: string[] = [];
    let current: string | undefined;
    let folded = false;
    const flush = (): void => {
        if (current === undefined) return;
        // A quoted scalar's quotes are YAML syntax, not text — strip them so label lengths are real.
        items.push(current.replace(/^(['"])(.*)\1$/, '$2').trim());
        current = undefined;
        folded = false;
    };
    for (const line of list.split('\n')) {
        const item = /^[ \t]+- (.*)$/.exec(line);
        if (item !== null) {
            flush();
            current = item[1].trim();
            folded = current === '>' || current === '>-' || current === '|-' || current === '|';
            continue;
        }
        if (current === undefined || !folded) continue;
        const continuation = line.trim();
        if (continuation !== '') current = `${current} ${continuation}`;
    }
    flush();
    return items;
}

/** Count `key_points` list items in a Surfing post's frontmatter; undefined when absent/unreadable. */
export function countKeyPoints(filePath: string): number | undefined {
    return readKeyPointItems(filePath)?.length;
}

function firstRefinedTitle(parsed: Record<string, unknown> | null): string {
    const targets = parsed?.targets;
    if (!Array.isArray(targets)) return '';
    for (const entry of targets) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        if (record.target !== 'surfdash-pub' || record.ok !== true) continue;
        const title = metadataOf(record).refinedTitle;
        if (typeof title === 'string' && title.trim() !== '') return title.trim();
    }
    return '';
}

/** Plan titles and briefs in audio order. The show-notes filter wins when it dropped boundary items. */
function planItemsForPodcast(workDir: string, runDate: string): Array<{ title: string; brief?: string }> {
    const filtered = join(workDir, '21-plan', `${runDate}_03_plan_plan-shownotes.json`);
    const full = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    const path = isFile(filtered) ? filtered : full;
    if (!isFile(path)) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const items: Array<{ title: string; brief?: string }> = [];
    for (const entry of parsed) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        if (title === '') continue;
        const meta = record.metadata;
        const metaBrief =
            meta !== null && typeof meta === 'object' && typeof (meta as Record<string, unknown>).brief === 'string'
                ? String((meta as Record<string, unknown>).brief).trim()
                : '';
        const body = typeof record.body === 'string' ? record.body.trim() : '';
        const brief = metaBrief || (splitSentences(body, { cjkOnly: true })[0] ?? '').trim();
        items.push(brief.length > 0 ? { title, brief } : { title });
    }
    return items;
}

export function dailyPublishPodcast(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const prep = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const notes = join(workDir, '31-publish', `${runDate}_15_show-notes_show-notes.md`);
    const result = join(workDir, '31-publish', `${runDate}_16_publish-podcast_result.json`);
    timed(workDir, 'publish-podcast', () => {
        if (targetPublished(result, 'podcast-pub')) {
            console.log(`publish-podcast cached: podcast target ok in ${result}`);
            return;
        }
        try {
            const content = requireJson(prep, 'publish-podcast');
            const showNotes = readFileSync(notes, 'utf-8');
            const surfdash = readJson(join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`));
            const postPath = firstPostPath(surfdash, 'surfdash-pub');
            const refinedTitle = firstRefinedTitle(surfdash);
            const refinedDescription = postPath !== '' ? readFrontmatterScalar(postPath, 'description') : undefined;
            const planItems = planItemsForPodcast(workDir, runDate);
            const prior = metadataOf(content).podcast;
            const podcast: Record<string, unknown> =
                prior !== null && typeof prior === 'object' && !Array.isArray(prior)
                    ? { ...(prior as Record<string, unknown>) }
                    : {};
            if (refinedTitle !== '') podcast.refinedTitle = refinedTitle;
            if (refinedDescription) podcast.refinedDescription = refinedDescription;
            if (planItems.length > 0) podcast.planItems = planItems;
            const merged = buildPodcastContent(content, {
                showNotes,
                ...(Object.keys(podcast).length > 0 ? { podcast } : {}),
            });
            sted('write', prep, () => writeJsonText(prep, merged));
            kk(
                [
                    'executor',
                    'fan-out',
                    '--content',
                    prep,
                    '--target',
                    'podcast-pub',
                    '--out',
                    result,
                    ...pluginsArgs(pluginsPath),
                ],
                {
                    unset: ['SPUR_WORKFLOW_RUN_ACTIVE'],
                    soft: true,
                },
            );
        } catch (error) {
            // The shell's `… && … || true` swallowed both steps' failures — but an unusable `kk`
            // (exit 127) is an environment failure, not a tolerated plugin failure.
            if (error instanceof StageFailure && error.status === 127) throw error;
            console.error((error as Error).message);
        }
        console.log('publish-podcast: podcast target dispatched');
    });
}

export function dailyPublishPrep(args: string[]): void {
    const [workDir = '', runDate = '', artist = '', album = ''] = args;
    const articlePath = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    const audioPath = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    const prepPath = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const coverPath = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
    timed(workDir, 'publish-prep', () => {
        const article = requireJson(articlePath, 'publish-prep');
        const audioMeta = metadataOf(readJson(audioPath));
        const rawFile = audioMeta.mp3Path ?? audioMeta.audioPath;
        if (typeof rawFile !== 'string' || rawFile === '') {
            failWith(1, 'publish-prep: voice content carries no mp3Path/audioPath');
        }
        const audioFile = resolve(rawFile);
        // 0171 R2: publish-prep publishes metadata.mp3Path ?? audioPath, so a WAV here means
        // transcode_mp3 was turned off — the run would ship an enclosure Apple Podcasts rejects.
        if (!audioFile.endsWith('.mp3')) {
            failWith(1, `publish-prep: resolved audio is not an MP3 (transcode_mp3 must be "true"): ${audioFile}`);
        }
        stampId3Tags(audioFile, typeof article.title === 'string' ? article.title : '', runDate, artist, album);
        const resolvedCover = resolve(coverPath);
        const hasCover = existsSync(resolvedCover);
        // Daily-show itunes convention: season = year, episode = day-of-year. run_date arrives
        // dashed (`$(date +%F)`) or digits-only (formatRunDate); map.ts forwards numbers only,
        // so a malformed run_date omits both tags instead of failing the publish.
        const digits = runDate.replaceAll(/\D/g, '');
        const season = Number(digits.slice(0, 4));
        const month = Number(digits.slice(4, 6));
        const day = Number(digits.slice(6, 8));
        const episode =
            digits.length === 8 && month >= 1 && month <= 12 && day >= 1 && day <= 31
                ? Math.round((Date.UTC(season, month - 1, day) - Date.UTC(season, 0, 1)) / 86_400_000) + 1
                : 0;
        // podcast-pub's documented contract reads metadata.coverImage (map.ts); options.coverPath
        // alone was silently dropped by the mapper — episodes published without a cover.
        const merged = {
            ...article,
            metadata: {
                ...metadataOf(article),
                audioFile,
                runDate,
                ...(hasCover ? { coverImage: resolvedCover } : {}),
                ...(episode > 0 ? { itunes: { season, episode } } : {}),
            },
            options: {
                audioFile,
                durationSec: audioMeta.duration,
                coverPath: hasCover ? resolvedCover : undefined,
            },
        };
        // Task 0189 R10: the last program seam before anything is dispatched. No stamp, or a
        // stamp issued on different bytes (edited after PASS, or an older draft), never publishes.
        const stamp = readJson(safetyPath(workDir, runDate, 'safety-judge_stamp.json'));
        if (stamp === null) failWith(1, 'publish-prep: no content-safety verdict stamp for this run — not publishing');
        // 20261005: pass/escalate/exclude all stamp the drafts as publishable; only `block` (draft
        // integrity) has no stamp. An `exclude` stamp carries the admission-blocked platforms so
        // the per-target stages can skip those targets instead of failing the run.
        if (stamp.status !== 'pass' && stamp.status !== 'escalate' && stamp.status !== 'exclude') {
            failWith(1, `publish-prep: content-safety status ${String(stamp.status)} does not publish`);
        }
        if (stamp.digest !== safetyDigest(workDir, runDate)) {
            failWith(1, 'publish-prep: drafts changed after the content-safety verdict — re-run the review');
        }
        const excludedPlatforms = Array.isArray(stamp.excludedPlatforms) ? (stamp.excludedPlatforms as string[]) : [];
        if (excludedPlatforms.length > 0) {
            console.log(`publish-prep: content-safety excluded platforms: ${excludedPlatforms.join(', ')}`);
        }
        sted('write', prepPath, () =>
            writeJsonText(prepPath, {
                ...merged,
                metadata: { ...metadataOf(merged), safetyExcludedPlatforms: excludedPlatforms },
            }),
        );
    });
}

type SurfdashDeliveryState = 'missing' | 'success' | 'failure' | 'uncertain';

interface SurfdashSendIntent {
    version: 1;
    target: 'surfdash-pub';
    runDate: string;
    payloadPath: string;
    payloadSha256: string;
    createdAt: string;
}

function surfdashPayloadSha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function surfdashNotSentReceipt(resultPath: string, intentPath: string, runDate: string, reason: string): void {
    const error = `surfdash publish was not sent: ${reason}`;
    sted('write', resultPath, () =>
        writeJsonText(resultPath, {
            ok: false,
            summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
            targets: [
                {
                    target: 'surfdash-pub',
                    ok: false,
                    status: 'failed',
                    error,
                    metadata: { deliveryState: 'not-sent', runDate, intentPath },
                },
            ],
        }),
    );
    console.error(error);
}

function readSurfdashSendIntent(
    path: string,
): { kind: 'missing' } | { kind: 'valid'; value: SurfdashSendIntent } | { kind: 'invalid'; reason: string } {
    if (!isFile(path)) return { kind: 'missing' };
    const parsed = readJson(path);
    if (parsed === null) return { kind: 'invalid', reason: 'send intent is unreadable or invalid JSON' };
    if (
        parsed.version !== 1 ||
        parsed.target !== 'surfdash-pub' ||
        typeof parsed.runDate !== 'string' ||
        typeof parsed.payloadPath !== 'string' ||
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.payloadSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(parsed.payloadSha256)
    ) {
        return { kind: 'invalid', reason: 'send intent is malformed' };
    }
    return { kind: 'valid', value: parsed as unknown as SurfdashSendIntent };
}

function surfdashTargetEntries(result: Record<string, unknown> | null): Record<string, unknown>[] {
    const targets = result?.targets;
    if (!Array.isArray(targets)) return [];
    return targets.filter(
        (entry): entry is Record<string, unknown> =>
            entry !== null && typeof entry === 'object' && (entry as Record<string, unknown>).target === 'surfdash-pub',
    );
}

/** A push can have reached the remote even when the publisher reports a failed receipt. */
function surfdashFailureMayHaveRemoteEffect(entry: Record<string, unknown>): boolean {
    return (
        entry.ok === false &&
        entry.status === 'failed' &&
        (entry.metadata as Record<string, unknown> | undefined)?.deliveryState !== 'not-sent'
    );
}

function surfdashTargetState(result: Record<string, unknown> | null): SurfdashDeliveryState {
    const matches = surfdashTargetEntries(result);
    if (matches.length === 0) return 'missing';
    // More than one receipt for the same target is ambiguous even when every row says success:
    // retrying could duplicate a remote post. Preserve the uncertainty until reconciliation.
    if (matches.length > 1) return 'uncertain';
    if (
        matches.some(
            (entry) =>
                (entry.metadata as Record<string, unknown> | undefined)?.deliveryState === 'uncertain' ||
                surfdashFailureMayHaveRemoteEffect(entry),
        )
    ) {
        return 'uncertain';
    }
    const target = matches[0];
    if (target.ok === true && target.status === 'published') return 'success';
    if (target.ok === false && target.status === 'failed') return 'failure';
    return 'missing';
}

function writeSurfdashUncertainReceipt(
    resultPath: string,
    intentPath: string,
    runDate: string,
    payloadSha256: string | undefined,
    currentPayloadSha256: string | undefined,
    reason: string,
    identity: { postPath?: string; localeFingerprint?: string } = {},
): void {
    const metadata: Record<string, unknown> = {
        deliveryState: 'uncertain',
        runDate,
        intentPath,
        ...(payloadSha256 ? { payloadSha256 } : {}),
        ...(currentPayloadSha256 ? { currentPayloadSha256 } : {}),
        ...(identity.postPath ? { postPath: identity.postPath } : {}),
        ...(identity.localeFingerprint ? { localeFingerprint: identity.localeFingerprint } : {}),
    };
    const error = `surfdash delivery is uncertain: ${reason}; reconcile the dated remote post/commit before clearing this uncertainty and retrying`;
    sted('write', resultPath, () =>
        writeJsonText(resultPath, {
            ok: false,
            summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
            targets: [
                {
                    target: 'surfdash-pub',
                    ok: false,
                    status: 'failed',
                    error,
                    metadata,
                },
            ],
        }),
    );
    console.error(error);
}

const SURFDASH_LOCALES = ['zh', 'en', 'ja'] as const;
type SurfdashLocale = (typeof SURFDASH_LOCALES)[number];

interface SurfdashLocaleValidationEvidence {
    runDate: string;
    postPath: string;
    localePaths: Record<SurfdashLocale, string>;
    localeDigests: Record<SurfdashLocale, string>;
    fingerprint: string;
}

interface SurfdashPublishIdentity {
    postPath: string;
    payloadSha256: string;
    localeFingerprint: string;
}

function surfdashPublishIdentity(entry: Record<string, unknown> | undefined): SurfdashPublishIdentity | undefined {
    if (entry === undefined) return undefined;
    const metadata = metadataOf(entry);
    if (
        typeof metadata.postPath !== 'string' ||
        typeof metadata.payloadSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(metadata.payloadSha256) ||
        typeof metadata.localeFingerprint !== 'string' ||
        !/^[0-9a-f]{64}$/.test(metadata.localeFingerprint)
    ) {
        return undefined;
    }
    return {
        postPath: metadata.postPath,
        payloadSha256: metadata.payloadSha256,
        localeFingerprint: metadata.localeFingerprint,
    };
}

function localeSiblingPaths(zhPostPath: string): Record<SurfdashLocale, string> | undefined {
    if (!zhPostPath.includes('/zh/')) return undefined;
    const en = zhPostPath.replace('/zh/', '/en/');
    const ja = zhPostPath.replace('/zh/', '/ja/');
    if (en === zhPostPath || ja === zhPostPath) return undefined;
    return { zh: zhPostPath, en, ja };
}

function validateLocaleMarkers(workDir: string, runDate: string, zhPostPath: string, step: string): void {
    const localePaths = localeSiblingPaths(zhPostPath);
    if (localePaths === undefined) {
        failWith(1, `${step}: zh post path does not contain a /zh/ locale segment: ${zhPostPath}`);
    }
    for (const locale of ['en', 'ja'] as const) {
        const marker = join(workDir, '31-publish', `${runDate}_20_translate-localize_${locale}-post-path.txt`);
        const markerPath = isFile(marker) ? readFileSync(marker, 'utf-8').trim() : '';
        const expectedPath = localePaths[locale];
        if (markerPath === '' || !isAbsolute(markerPath) || markerPath !== expectedPath || !isFile(expectedPath)) {
            failWith(1, `${step}: ${locale} marker must name the absolute derived sibling ${expectedPath}: ${marker}`);
        }
    }
}

function surfdashLocaleValidationEvidence(
    zhPostPath: string,
    runDate: string,
): { ok: true; evidence: SurfdashLocaleValidationEvidence } | { ok: false; reason: string } {
    const localePaths = localeSiblingPaths(zhPostPath);
    if (localePaths === undefined) {
        return { ok: false, reason: `zh post path does not contain a /zh/ locale segment: ${zhPostPath}` };
    }
    const localeDigests = {} as Record<SurfdashLocale, string>;
    for (const locale of SURFDASH_LOCALES) {
        const path = localePaths[locale];
        if (!isFile(path)) return { ok: false, reason: `${locale} locale file is missing: ${path}` };
        try {
            localeDigests[locale] = createHash('sha256').update(readFileSync(path)).digest('hex');
        } catch (error: unknown) {
            return {
                ok: false,
                reason: `${locale} locale file cannot be fingerprinted: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    const identity = { runDate, postPath: zhPostPath, localePaths, localeDigests };
    return {
        ok: true,
        evidence: {
            ...identity,
            fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
        },
    };
}

function validateSurfdashLocaleGate(
    validationPath: string,
    prepareResultPath: string,
    runDate: string,
): { ok: true; evidence: SurfdashLocaleValidationEvidence } | { ok: false; reason: string } {
    const validation = isFile(validationPath) ? readJson(validationPath) : null;
    if (validation?.ok !== true || validation.target !== 'surfdash-pub' || validation.status !== 'validated') {
        return { ok: false, reason: `missing or invalid validation receipt: ${validationPath}` };
    }
    const metadata = metadataOf(validation);
    if (metadata.runDate !== runDate || typeof metadata.postPath !== 'string') {
        return { ok: false, reason: `validation receipt date/path does not match run ${runDate}` };
    }
    const prepared = isFile(prepareResultPath) ? readJson(prepareResultPath) : null;
    const preparedTargets = Array.isArray(prepared?.targets)
        ? prepared.targets.filter(
              (entry): entry is Record<string, unknown> =>
                  entry !== null &&
                  typeof entry === 'object' &&
                  (entry as Record<string, unknown>).target === 'surfdash-pub',
          )
        : [];
    if (
        preparedTargets.length !== 1 ||
        preparedTargets[0].ok !== true ||
        preparedTargets[0].status !== 'prepared' ||
        metadataOf(preparedTargets[0]).postPath !== metadata.postPath
    ) {
        return { ok: false, reason: `current Surfdash prepare receipt is missing or does not match ${validationPath}` };
    }
    const current = surfdashLocaleValidationEvidence(metadata.postPath, runDate);
    if (!current.ok) return current;
    const recordedPaths = metadata.localePaths;
    const recordedDigests = metadata.localeDigests;
    if (
        recordedPaths === null ||
        typeof recordedPaths !== 'object' ||
        recordedDigests === null ||
        typeof recordedDigests !== 'object' ||
        typeof metadata.fingerprint !== 'string'
    ) {
        return { ok: false, reason: `validation receipt fingerprint is missing or malformed: ${validationPath}` };
    }
    if (
        JSON.stringify(recordedPaths) !== JSON.stringify(current.evidence.localePaths) ||
        JSON.stringify(recordedDigests) !== JSON.stringify(current.evidence.localeDigests) ||
        metadata.fingerprint !== current.evidence.fingerprint
    ) {
        return { ok: false, reason: `locale files changed after validation; refresh ${validationPath}` };
    }
    return current;
}

export function dailyPublishSurfdash(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', requireLocaleValidation = 'false'] = args;
    const prep = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const result = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
    const intentPath = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_intent.json`);
    const prepareResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash-prepare_result.json`);
    const validationPath = join(workDir, '31-publish', `${runDate}_24_translate-validate_result.json`);
    const preparedInput = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_prepared_content.json`);
    const transportResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_transport_result.json`);
    timed(workDir, 'publish-surfdash', () => {
        const priorResult = readJson(result);
        const priorTargets = surfdashTargetEntries(priorResult);
        const priorState = surfdashTargetState(priorResult);
        if (priorState === 'uncertain') {
            const priorTarget = priorTargets[0];
            if (
                priorTarget !== undefined &&
                (priorTarget.metadata as Record<string, unknown> | undefined)?.deliveryState !== 'uncertain'
            ) {
                const priorError =
                    typeof priorTarget.error === 'string'
                        ? priorTarget.error
                        : 'publisher reported an ambiguous delivery failure';
                writeSurfdashUncertainReceipt(result, intentPath, runDate, undefined, undefined, priorError);
            }
            console.log(`publish-surfdash blocked: uncertain delivery is sticky in ${result}`);
            return;
        }

        // The two-phase voice2 workflow explicitly requires a successful local locale gate before
        // the publisher can invoke refine/CMS/git. Legacy voice1/manual callers omit the fourth
        // argument and retain their historical publish behavior.
        let currentIdentity: SurfdashPublishIdentity | undefined;
        let currentLocaleEvidence: SurfdashLocaleValidationEvidence | undefined;
        if (requireLocaleValidation === 'true') {
            const validation = validateSurfdashLocaleGate(validationPath, prepareResult, runDate);
            if (!validation.ok) {
                const detail = validation.reason;
                if (priorState === 'success') {
                    writeSurfdashUncertainReceipt(
                        result,
                        intentPath,
                        runDate,
                        undefined,
                        undefined,
                        `current locale validation is not the one used for the cached success: ${detail}`,
                    );
                } else {
                    surfdashNotSentReceipt(result, intentPath, runDate, `blocked by locale validation: ${detail}`);
                }
                return;
            }
            currentLocaleEvidence = validation.evidence;
            if (!isFile(prep)) {
                const detail = `prepared payload is missing: ${prep}`;
                if (priorState === 'success') {
                    writeSurfdashUncertainReceipt(result, intentPath, runDate, undefined, undefined, detail);
                } else {
                    surfdashNotSentReceipt(result, intentPath, runDate, detail);
                }
                return;
            }
            currentIdentity = {
                postPath: validation.evidence.postPath,
                payloadSha256: surfdashPayloadSha256(prep),
                localeFingerprint: validation.evidence.fingerprint,
            };
        }

        if (priorState === 'success') {
            // Voice1 and manual callers omit the locale-validation argument and historically
            // treated a recorded success as a resume-safe cache hit. Voice2 supplies `true` and
            // must keep the exact identity binding below; do not make the legacy surface depend
            // on the new locale fingerprint receipt.
            if (requireLocaleValidation !== 'true') {
                console.log(`publish-surfdash cached: surfdash target ok in ${result}`);
                return;
            }
            const cachedIdentity = surfdashPublishIdentity(priorTargets[0]);
            if (
                currentIdentity === undefined ||
                cachedIdentity === undefined ||
                cachedIdentity.postPath !== currentIdentity.postPath ||
                cachedIdentity.payloadSha256 !== currentIdentity.payloadSha256 ||
                cachedIdentity.localeFingerprint !== currentIdentity.localeFingerprint
            ) {
                writeSurfdashUncertainReceipt(
                    result,
                    intentPath,
                    runDate,
                    cachedIdentity?.payloadSha256,
                    currentIdentity?.payloadSha256,
                    'cached success has no exact postPath/payloadSha256/localeFingerprint identity for the current material',
                    currentIdentity,
                );
                return;
            }
            console.log(`publish-surfdash cached: surfdash target ok in ${result}`);
            return;
        }

        const intent = readSurfdashSendIntent(intentPath);
        if (intent.kind === 'invalid') {
            writeSurfdashUncertainReceipt(result, intentPath, runDate, undefined, undefined, intent.reason);
            return;
        }

        let payloadSha256: string | undefined = currentIdentity?.payloadSha256;
        if (intent.kind === 'valid') {
            if (intent.value.runDate !== runDate) {
                writeSurfdashUncertainReceipt(
                    result,
                    intentPath,
                    runDate,
                    intent.value.payloadSha256,
                    undefined,
                    `send intent run date ${intent.value.runDate} does not match requested run date ${runDate}`,
                );
                return;
            }
            // An existing intent binds this dated post to the original bytes. A changed payload is
            // never allowed to overwrite the same slug after an interrupted remote send.
            if (isFile(prep)) payloadSha256 = surfdashPayloadSha256(prep);
            if (payloadSha256 !== undefined && payloadSha256 !== intent.value.payloadSha256) {
                writeSurfdashUncertainReceipt(
                    result,
                    intentPath,
                    runDate,
                    intent.value.payloadSha256,
                    payloadSha256,
                    'prepared payload changed after the send intent',
                );
                return;
            }
            if (priorState === 'missing') {
                writeSurfdashUncertainReceipt(
                    result,
                    intentPath,
                    runDate,
                    intent.value.payloadSha256,
                    payloadSha256,
                    'no publish result was recorded after the prior send intent',
                );
                return;
            }
            if (payloadSha256 === undefined) {
                writeSurfdashUncertainReceipt(
                    result,
                    intentPath,
                    runDate,
                    intent.value.payloadSha256,
                    undefined,
                    'prepared payload is missing, so the original request cannot be replayed safely',
                );
                return;
            }
        } else {
            if (!isFile(prep)) failWith(1, `publish-surfdash: required input not found: ${prep}`);
            payloadSha256 = surfdashPayloadSha256(prep);
            const sendIntent: SurfdashSendIntent = {
                version: 1,
                target: 'surfdash-pub',
                runDate,
                payloadPath: prep,
                payloadSha256,
                createdAt: new Date().toISOString(),
            };
            sted('write', intentPath, () => writeJsonText(intentPath, sendIntent));
        }

        if (requireLocaleValidation === 'true' && currentIdentity !== undefined) {
            const prepared = requireJson(prep, 'publish-surfdash');
            sted('write', preparedInput, () =>
                writeJqText(preparedInput, {
                    ...prepared,
                    options: {
                        operation: 'publish-prepared',
                        postPath: currentIdentity.postPath,
                        runDate,
                        expectedPostSha256: currentLocaleEvidence.localeDigests.zh,
                        expectedLocaleFingerprint: currentIdentity.localeFingerprint,
                    },
                }),
            );
            // `kk executor run` normally clears --out itself, but a discovery failure can return
            // before the executor owns that path. Remove any previous transport receipt here so a
            // stale success can never be promoted into this invocation's publish result.
            rmSync(transportResult, { force: true });
            kk(
                [
                    'executor',
                    'run',
                    'surfdash-pub',
                    '--in',
                    preparedInput,
                    '--out',
                    transportResult,
                    ...pluginsArgs(pluginsPath),
                ],
                {
                    unset: NESTED_SPUR_UNSET,
                    env: { SURFDASH_LOCALE: 'zh' },
                    soft: true,
                },
            );
            const transported = readJson(transportResult);
            const identityMetadata = {
                postPath: currentIdentity.postPath,
                payloadSha256: currentIdentity.payloadSha256,
                localeFingerprint: currentIdentity.localeFingerprint,
                runDate,
            };
            if (transported?.ok === true) {
                sted('write', result, () =>
                    writeJsonText(result, {
                        ok: true,
                        summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                        targets: [
                            {
                                target: 'surfdash-pub',
                                ok: true,
                                status: 'published',
                                ...(typeof transported.url === 'string' ? { url: transported.url } : {}),
                                metadata: { ...metadataOf(transported), ...identityMetadata },
                            },
                        ],
                    }),
                );
            } else if (transported?.ok === false && metadataOf(transported).deliveryState === 'not-sent') {
                sted('write', result, () =>
                    writeJsonText(result, {
                        ok: false,
                        summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
                        targets: [
                            {
                                target: 'surfdash-pub',
                                ok: false,
                                status: 'failed',
                                error:
                                    typeof transported.error === 'string'
                                        ? transported.error
                                        : 'publisher rejected the prepared post',
                                metadata: {
                                    ...metadataOf(transported),
                                    ...identityMetadata,
                                    deliveryState: 'not-sent',
                                },
                            },
                        ],
                    }),
                );
            } else {
                writeSurfdashUncertainReceipt(
                    result,
                    intentPath,
                    runDate,
                    payloadSha256,
                    payloadSha256,
                    typeof transported?.error === 'string'
                        ? `publisher reported an ambiguous delivery failure: ${transported.error}`
                        : 'no publish result was recorded after prepared dispatch',
                    currentIdentity,
                );
            }
        } else {
            kk(
                [
                    'executor',
                    'fan-out',
                    '--content',
                    prep,
                    '--target',
                    'surfdash-pub',
                    '--out',
                    result,
                    ...pluginsArgs(pluginsPath),
                ],
                {
                    unset: NESTED_SPUR_UNSET,
                    env: { SURFDASH_LOCALE: 'zh' },
                    soft: true,
                },
            );
        }

        // A killed or unusable child can leave a real remote commit with no aggregate receipt. The
        // intent now makes that state explicit; the next invocation will refuse to dispatch again.
        const afterState = surfdashTargetState(readJson(result));
        if (afterState === 'missing' || afterState === 'uncertain') {
            const afterTarget = surfdashTargetEntries(readJson(result))[0];
            const afterError =
                afterState === 'uncertain' && afterTarget !== undefined && typeof afterTarget.error === 'string'
                    ? `publisher reported an ambiguous delivery failure: ${afterTarget.error}`
                    : 'no publish result was recorded after dispatch';
            writeSurfdashUncertainReceipt(
                result,
                intentPath,
                runDate,
                payloadSha256,
                payloadSha256,
                afterError,
                currentIdentity,
            );
        }
        console.log('publish-surfdash: surfdash target dispatched; classification happens after podcast publish');
    });
}

/**
 * Prepare the local zh post before locale scaffolding/translation. This stage deliberately stops
 * at the publisher's file-materialization seam; the normal `publish-surfdash` stage remains the
 * only operation allowed to invoke Surfdash's refine/CMS/git publishing path.
 */
export function dailyPrepareSurfdash(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const prep = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const input = join(workDir, '31-publish', `${runDate}_14_publish-surfdash-prepare_content.json`);
    const result = join(workDir, '31-publish', `${runDate}_14_publish-surfdash-prepare_result.json`);
    const transportResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash-prepare-transport_result.json`);
    timed(workDir, 'prepare-surfdash', () => {
        try {
            if (!isFile(prep)) failWith(1, `prepare-surfdash: required input not found: ${prep}`);
            const content = requireJson(prep, 'prepare-surfdash');
            sted('write', input, () => writeJqText(input, { ...content, options: { operation: 'prepare' } }));
            kk(
                [
                    'executor',
                    'run',
                    'surfdash-pub',
                    '--in',
                    input,
                    '--out',
                    transportResult,
                    ...pluginsArgs(pluginsPath),
                ],
                {
                    unset: NESTED_SPUR_UNSET,
                    // The scheduled source post is always zh. Do not let a caller's inherited
                    // locale select an en/ja materialization and then make the sibling gate
                    // compare the wrong source tree.
                    env: { SURFDASH_LOCALE: 'zh' },
                },
            );
            const prepared = readJson(transportResult);
            const postPath = metadataOf(prepared).postPath;
            if (prepared?.ok !== true || typeof postPath !== 'string') {
                failWith(1, `prepare-surfdash: publisher did not return a prepared zh post path: ${transportResult}`);
            }
            if (postPath === '' || !isFile(postPath)) {
                failWith(1, `prepare-surfdash: publisher did not return a prepared zh post path: ${result}`);
            }
            sted('write', result, () =>
                writeJqText(result, {
                    ok: true,
                    summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                    targets: [
                        {
                            target: 'surfdash-pub',
                            ok: true,
                            status: 'prepared',
                            ...(typeof prepared?.url === 'string' ? { url: prepared.url } : {}),
                            metadata: metadataOf(prepared),
                        },
                    ],
                }),
            );
            console.log(`prepare-surfdash: prepared zh post ${postPath}`);
        } catch (error: unknown) {
            if (error instanceof StageFailure && error.status === 127) throw error;
            const message = error instanceof Error ? error.message : String(error);
            sted('write', result, () =>
                writeJqText(result, {
                    ok: false,
                    summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
                    targets: [{ target: 'surfdash-pub', ok: false, status: 'failed', error: message }],
                }),
            );
            console.error(message);
        }
    });
}

/**
 * WeChat MP: drive the console via `wechatmp-pub`'s browser transport and save the article to the
 * draft box (草稿箱). Draft by default; the 发表 flow runs only on an explicit launch-time
 * `wechat_live=true` (ADR-022 rail, same as xhs). Independent and non-blocking like XHS: the
 * outcome never enters `publish_status` (surfdash + podcast remain the publication contract).
 */
export function dailyPublishWechat(args: string[]): void {
    const [workDirRaw = '', runDate = '', pluginsPath = '', live = 'false', collectionArg = ''] = args;
    // Metadata carries file paths consumed by the plugin child process (cwd = plugin dir) - never emit relatives.
    const workDir = resolve(workDirRaw);
    const article = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    const input = join(workDir, '31-publish', `${runDate}_20_publish-wechat_content.json`);
    const result = join(workDir, '31-publish', `${runDate}_20_publish-wechat_result.json`);
    const want = live === 'true' ? 'public' : 'draft';
    timed(workDir, 'publish-wechat', () => {
        // Cache on the *requested* status: a cached draft must not silently satisfy a later
        // wechat_live=true re-run (that would report a live post that never happened).
        if (resultPublishStatus(result) === want) {
            console.log(`publish-wechat cached: ${want} already recorded in ${result}`);
            return;
        }
        // 20261005: a platform the content-safety gate excluded never gets a draft. Skipping here
        // keeps the run alive for the targets that did pass, which is the point of the gate.
        const safety = readJson(safetyPath(workDir, runDate, 'safety-judge_stamp.json'));
        const excluded = Array.isArray(safety?.excludedPlatforms) ? (safety.excludedPlatforms as string[]) : [];
        if (excluded.includes('wechatmp')) {
            console.log(`publish-wechat: SKIPPED — content-safety excluded wechatmp for this run`);
            return;
        }
        if (!isFile(article)) {
            console.log(`publish-wechat: no article at ${article} — skip`);
            return;
        }
        const packaged = requireJson(article, 'publish-wechat');
        // MP draft enrichment (operator preferences 2026-09-29, completed 2026-10-10) lives in the
        // builder so a generate-side bundle can produce the same payload without publishing.
        const cover = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
        const audio = join(workDir, '30-audio', `${runDate}_11_generate_content.mp3`);
        const surfdashResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
        const originalUrl = isFile(surfdashResult) ? firstTargetUrl(readJson(surfdashResult), 'surfdash-pub') : '';
        const hasCover = isFile(cover);
        const hasAudio = isFile(audio);
        const firstLine = typeof packaged.title === 'string' ? packaged.title : '';
        sted('write', input, () =>
            writeJsonText(
                input,
                buildWechatArticleContent(packaged, {
                    links: { articleUrl: originalUrl, podcastUrl: '' },
                    publishStatus: want,
                    collection: collectionArg || '每日AI资讯',
                    ...(hasCover ? { coverPath: cover } : {}),
                    ...(hasAudio ? { audioPath: audio, audioTitle: firstLine } : {}),
                }),
            ),
        );
        // `soft` keeps the WeChat target non-blocking: the plugin still writes its own failed Result
        // and prints the failing step (session preflight, editor paste, save control), which is what
        // the operator needs to re-run — never a silent skip.
        const status = kk(
            ['executor', 'run', 'wechatmp-pub', '--in', input, '--out', result, ...pluginsArgs(pluginsPath)],
            {
                soft: true,
            },
        );
        console.log(
            status === 0
                ? `publish-wechat: ${want} dispatched; outcome recorded in ${result}`
                : `WARNING: publish-wechat — wechatmp-pub exited ${status}; WeChat target skipped (run continues, see ${result})`,
        );
    });
}

/**
 * F613 R1: snapshot the shipped style contract into the run's work dir. Spur workflows have no
 * workflow-dir var, so the script-write prompt reads this copy — and the snapshot freezes the
 * exact contract the run's plan was written against. Idempotent (an existing snapshot is kept);
 * a missing sidecar is a broken install, so `requireSidecar` fails loud.
 */
/**
 * E8: publish the packaged card series through `xhs-pub`'s script driver. Draft by default; live
 * only on an explicit launch-time `xhs_live=true` (ADR-022 — an unattended run never posts live on
 * its own). Non-blocking by operator decision: a missing/expired XHS session or a changed console
 * logs a loud failure and leaves the run alive, and the outcome never enters `publish_status`
 * (surfdash + podcast remain the episode's publication contract).
 *
 * 0236: the optional trailing `<podcast>` arg (`'true'` from voice2 only) attaches the episode's
 * 发播客 note to the same visit as `metadata.followUps` — one console visit, two notes, one cap entry
 * (ADR-025 amendment 2026-10-09).
 */
export function dailyPublishXhs(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', live = 'false', podcast = ''] = args;
    const content = join(workDir, '25-xhs', 'content.json');
    const prep = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const input = join(workDir, '31-publish', `${runDate}_19_publish-xhs_content.json`);
    const result = join(workDir, '31-publish', `${runDate}_19_publish-xhs_result.json`);
    const want = live === 'true' ? 'public' : 'draft';
    timed(workDir, 'publish-xhs', () => {
        // Cache on the *requested* status: a cached draft must not silently satisfy a later
        // xhs_live=true re-run (that would report a live post that never happened).
        if (resultPublishStatus(result) === want) {
            console.log(`publish-xhs cached: ${want} already recorded in ${result}`);
            // 0236: the cache keys on the visit's primary note, so a 发播客 follow-up that failed in
            // that visit is named here instead of hidden. It is not retried: a re-visit would post
            // a second 图文 draft (the console has no idempotency key).
            const followUps = metadataOf(readJson(result)).followUps;
            for (const entry of Array.isArray(followUps) ? followUps : []) {
                const step = (entry ?? {}) as Record<string, unknown>;
                if (step.ok === true) continue;
                console.log(
                    `publish-xhs cached: follow-up ${String(metadataOf(step).operation ?? '?')} did not complete: ${String(step.error ?? 'no error recorded')}`,
                );
            }
            return;
        }
        if (!isFile(content)) {
            console.log(`publish-xhs: no card series at ${content} (render packaged none) — skip`);
            return;
        }
        const packaged = requireJson(content, 'publish-xhs');
        const followUp = podcast === 'true' ? xhsPodcastNote(prep, want) : undefined;
        sted('write', input, () =>
            writeJsonText(
                input,
                buildXhsCardsContent(packaged, {
                    publishStatus: want,
                    ...(followUp === undefined ? {} : { followUps: [followUp] }),
                }),
            ),
        );
        // `soft` keeps the XHS target non-blocking: the plugin still writes its own failed Result
        // and prints the failing step (login gate, upload, body, submit control), which is what the
        // operator needs to re-run — never a silent skip.
        const status = kk(['executor', 'run', 'xhs-pub', '--in', input, '--out', result, ...pluginsArgs(pluginsPath)], {
            soft: true,
        });
        console.log(
            status === 0
                ? `publish-xhs: ${want} dispatched; outcome recorded in ${result}`
                : `WARNING: publish-xhs — xhs-pub exited ${status}; XHS target skipped (run continues, see ${result})`,
        );
    });
}

/**
 * 0236 R1: the 发播客 Content for the same episode — the run's publish-prep Content (the final mp3
 * with the intro, `23-cover`'s PNG, title and body) plus `metadata.operation` and the run's own
 * `publishStatus`. No artifact is produced here: both files already exist.
 *
 * `metadata.audio` repeats the prep's `metadata.audioFile` under the key the xhs channel's 发播客 mode
 * reads (`xhs-pub/src/modes.ts`); `metadata.coverImage` is already the shared spelling. A run with no
 * publish-prep output names the missing episode drafts and carries the 图文 note alone — the 发播客
 * note is never invented.
 */
function xhsPodcastNote(prepPath: string, publishStatus: 'draft' | 'public'): Record<string, unknown> | undefined {
    const prep = readJson(prepPath);
    if (prep === null) {
        console.log(`publish-xhs: no publish-prep Content at ${prepPath} — the 发播客 note is skipped`);
        return undefined;
    }
    return buildXhsEpisodeContent(prep, { publishStatus });
}

/**
 * WeChat MP: drive the console via `wechatmp-pub`'s browser transport and save the article to the
 * draft box (草稿箱). Draft by default; the 发表 flow runs only on an explicit launch-time
 * `wechat_live=true` (ADR-022 rail, same as xhs). Independent and non-blocking like XHS: the
 * outcome never enters `publish_status` (surfdash + podcast remain the publication contract).
 */
export function dailyQualityReport(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const content = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'quality-control', () => {
        const qc = metadataOf(readJson(content)).qc as Record<string, unknown> | undefined;
        console.log('=== Voice Quality Control Report ===');
        console.log(`Overall Score: ${qc ? qc.overallScore : 100}/100 | Passed: ${qc ? qc.passed : true}`);
        const issues = qc?.criticalIssues;
        if (Array.isArray(issues) && issues.length > 0) {
            console.warn(`QC Issues:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
        } else {
            console.log('All audio segments passed quality control checks cleanly.');
        }
    });
}

/**
 * 0329 F23 — the verdict half of `quality`. The report only printed, so a failed audio qc sailed
 * on into show-notes, the bundle and the publish windows (2026-10-25: an episode at 41/100 was
 * packaged and queued for tier-0 sends). Reads the same `metadata.qc` as `daily-quality-report`
 * and fails loud when the verdict is missing or `passed` is false.
 */
export function dailyQualityVerdict(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const content = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'quality-verdict', () => {
        if (!isFile(content)) failWith(1, `quality-verdict: no audio content: ${content}`);
        const qc = metadataOf(readJson(content)).qc as Record<string, unknown> | undefined;
        if (qc === undefined) failWith(1, `quality-verdict: no qc verdict in ${content}`);
        if (qc.passed !== true) {
            const issues = Array.isArray(qc.criticalIssues) ? qc.criticalIssues : [];
            failWith(
                1,
                `quality-verdict: audio qc failed (overallScore ${String(qc.overallScore ?? '?')}) — ${issues.map(String).join('; ') || 'no issue detail on the verdict'}`,
            );
        }
        console.log(`quality-verdict: audio qc passed (overallScore ${String(qc.overallScore ?? '?')})`);
    });
}

/**
 * 0171 R3: Apple Podcasts reads the enclosure's ID3 tags, so the published MP3 carries
 * title/artist/album/date. `-c copy` moves the audio frames without a re-encode, and the temp
 * file + rename keeps a failed ffmpeg from truncating the episode in place. An empty value
 * omits that tag rather than failing. The caller runs this after intro-music, whose mp3
 * re-transcode would otherwise strip tags stamped earlier.
 */
/**
 * Consume the content-safety report and the content-judge verdict into a publish decision (exit 0 in
 * every case — routing is transition-owned). The gate's job is to *adjust*, not to kill the run
 * (20261005 operator decision): a non-PASS verdict first routes back through one bounded
 * draft-remediation loop (`revise`), and what survives the loop is classified by what it is:
 *
 * - `revise`  — non-PASS and the remediation budget is not spent: re-review after the drafts change.
 * - `exclude` — admission-only residue (the CN 资质口径 / 播报形态 findings): the platforms that
 *               BLOCKed are dropped from this run and every other target publishes normally. Also
 *               the 20261007 narrowing: RISK whose findings are all gap/note/fix publishes at
 *               recorded risk with nothing dropped (empty `excludedPlatforms`).
 * - `escalate` — a finding the reviewer marked `disposition: "escalate"` on an otherwise clean
 *               pass: human review. Legacy reports (no `disposition` field anywhere) keep the old
 *               rule — any RISK decision or report-level `escalate: true` pauses (20261007 ADR).
 * - `pass`    — explicit PASS verdict, unchanged drafts, no BLOCK and no RISK finding at all.
 * - `block`   — draft integrity: PII reported on a blocked platform, or a judge must-pass `fail`
 *               outside `jurisdictional-rules` (prohibited claims / disclosure / data-handling);
 *               also an unreadable or out-of-contract report/verdict, a non-PASS that documents
 *               nothing, or drafts edited after the review. Never published.
 *
 * Fail-closed where it matters: a missing report, verdict or confidence still blocks.
 */
export function dailySafetyGate(args: string[]): void {
    const [workDir = '', runDate = '', maxReviseArg = '0'] = args;
    const maxRevise = Number.parseInt(maxReviseArg, 10);
    const statusFile = safetyPath(workDir, runDate, 'safety-judge_status.txt');
    const stampFile = safetyPath(workDir, runDate, 'safety-judge_stamp.json');
    timed(workDir, 'safety-judge', () => {
        const request = readJson(safetyPath(workDir, runDate, 'safety-review_request.json'));
        const report = readJson(safetyPath(workDir, runDate, 'safety-review_report.json'));
        const verdict = readJson(safetyPath(workDir, runDate, 'safety-judge_verdict.json'));
        const platforms = Array.isArray(report?.platforms) ? (report.platforms as Record<string, unknown>[]) : [];
        const decisions = platforms.map((platform) => platform?.decision);
        const digest = safetyDigest(workDir, runDate);
        const revisions = readSafetyReviseCount(workDir);
        const platformFindings = (platform: Record<string, unknown>): Record<string, unknown>[] =>
            Array.isArray(platform?.findings) ? (platform.findings as Record<string, unknown>[]) : [];
        // 20261007 narrowing (operator decision): on a clean pass, only a finding the reviewer
        // explicitly marked `disposition: "escalate"` is a human decision. Evidence gaps, note-class
        // and fix-class RISK are recorded but route to `exclude` at recorded risk instead of pausing
        // an unattended run. Back-compat, fail-closed: a report with no `disposition` field keeps the
        // legacy rule — any RISK decision or report-level escalate pauses.
        const allFindings = platforms.flatMap(platformFindings);
        const usesDisposition = allFindings.some((finding) => typeof finding?.disposition === 'string');
        const escalatedFindings = allFindings.filter((finding) => finding?.disposition === 'escalate');
        const risky = usesDisposition
            ? escalatedFindings.length > 0
            : decisions.includes('RISK') || report?.escalate === true;
        // 20261007 amendment: a report that self-classifies with dispositions must also self-grade
        // its confidence (HIGH|MEDIUM|LOW), mirroring the 20261003 verdict-confidence hardening.
        // Legacy reports (no disposition field) stay exempt — R3 back-compat unchanged.
        const reportConfidence = report?.confidence;
        const reportConfidenceOk =
            reportConfidence === 'HIGH' || reportConfidence === 'MEDIUM' || reportConfidence === 'LOW';
        const verdictFindings = Array.isArray(verdict?.findings) ? (verdict.findings as Record<string, unknown>[]) : [];
        const verdictFails = verdictFindings.filter((finding) => finding?.status === 'fail');
        // What a BLOCK *is* decides who can answer it. Dropping a blocked platform answers the
        // platform's own admission rules (资质口径/播报形态 …) — but the drafts' bytes ship to every
        // other target too, so a *draft* defect reported on that platform survives the drop. The
        // one finding class that is unambiguously a draft property is category 3 (可识别个人信息):
        // PII cannot be answered by choosing targets. The rest of the draft-integrity class is owned
        // by the judge's must-pass criteria below (no-prohibited-claims / disclosure-presence /
        // data-handling), which is where an independent reviewer can grade it.
        const blockedPlatforms = platforms.filter((platform) => platform?.decision === 'BLOCK');
        const excludedPlatforms = blockedPlatforms.map((platform) => String(platform?.platform ?? '')).filter(Boolean);
        const piiBlock = blockedPlatforms.some((platform) =>
            platformFindings(platform).some((finding) => Number(finding?.category) === PII_FINDING_CATEGORY),
        );
        // A BLOCK that names no finding is a contract violation, not a signal: there is nothing to
        // remediate and nothing to exclude, so it blocks (fail-closed).
        const unnamedBlock =
            blockedPlatforms.length > 0 && blockedPlatforms.every((p) => platformFindings(p).length === 0);
        const malformed =
            decisions.length === 0 || decisions.some((decision) => !SAFETY_PLATFORM_DECISIONS.has(String(decision)));
        const confidence = verdict?.confidence;
        const confidenceOk = confidence === 'HIGH' || confidence === 'MEDIUM' || confidence === 'LOW';
        const verdictValue = String(verdict?.verdict ?? '');
        const outOfContract =
            (verdictValue !== 'PASS' && verdictValue !== 'FAIL' && verdictValue !== 'NEEDS_REVISION') ||
            !confidenceOk ||
            (usesDisposition && !reportConfidenceOk);
        const nonPass = verdictValue !== 'PASS' || !confidenceOk;
        // Integrity = the finding survives any target choice: PII reported on a blocked platform, an
        // out-of-contract verdict, a non-PASS that documents nothing, or a `fail` outside the
        // admission criteria.
        const integrity =
            piiBlock ||
            unnamedBlock ||
            (nonPass && verdictFindings.length === 0) ||
            verdictFails.some((finding) => !ADMISSION_CRITERIA.has(String(finding?.criterion ?? '')));
        let status = 'block';
        let reason = 'verdict PASS on unchanged drafts, no BLOCK/RISK';
        // A digest-mismatch block means the drafts were deliberately edited (HITL): keep them so
        // a re-run of safety-prep re-reviews the edited version. Any other block means the
        // content itself is rejected — quarantine the drafts below.
        let edited = false;
        if (request?.digest !== digest) {
            reason = 'drafts changed after the review was requested';
            edited = true;
        } else if (malformed) {
            reason = 'content-safety report missing or malformed';
        } else if (outOfContract) {
            // 20261003 hardening (verdict) + 20261007 amendment (report): a verdict outside
            // PASS|FAIL|NEEDS_REVISION, any verdict without a HIGH/MEDIUM/LOW confidence, or a
            // disposition-contract report without one, is not reviewable — block, never revise
            // against it (there is no contract to read findings from).
            reason = `content contract violation: ${[
                verdictValue !== 'PASS' && verdictValue !== 'FAIL' && verdictValue !== 'NEEDS_REVISION'
                    ? `verdict ${verdictValue || 'missing'}`
                    : '',
                !confidenceOk
                    ? `verdict confidence ${String(confidence ?? 'missing')} (no confidence contract: need HIGH/MEDIUM/LOW)`
                    : '',
                usesDisposition && !reportConfidenceOk
                    ? `report confidence ${String(reportConfidence ?? 'missing')} (need HIGH/MEDIUM/LOW)`
                    : '',
            ]
                .filter(Boolean)
                .join(', ')}`;
        } else if (nonPass || blockedPlatforms.length > 0) {
            const trigger =
                blockedPlatforms.length > 0
                    ? `content-safety BLOCK on ${blockedPlatforms.map((p) => String(p?.platform ?? '')).join(', ')}`
                    : `content-judge verdict ${verdictValue}`;
            if (revisions < maxRevise) {
                status = 'revise';
                reason = `${trigger} — remediation pass ${revisions + 1}/${maxRevise} (drafts re-reviewed after the edit)`;
            } else if (integrity) {
                status = 'block';
                const named = blockedPlatforms
                    .flatMap((platform) => platformFindings(platform))
                    .filter((finding) => Number(finding?.category) === PII_FINDING_CATEGORY)
                    .map((finding) => `${String(finding?.item ?? '?')}(category ${String(finding?.category)})`)
                    .join(', ');
                const criteria = verdictFails.map((finding) => String(finding?.criterion)).join(', ');
                reason = `${trigger} — draft-integrity findings survive ${revisions} remediation passes (${named || criteria || 'the verdict names no criterion'}); exclusion cannot fix these`;
            } else {
                status = 'exclude';
                reason =
                    excludedPlatforms.length > 0
                        ? `${trigger} — admission-only, ${revisions} remediation passes spent: ${excludedPlatforms.join(', ')} dropped from this run, other targets publish${risky ? ' (RISK/escalation recorded)' : ''}`
                        : `${trigger} — admission-only, no platform BLOCK: submitting to the remaining targets at recorded risk`;
            }
        } else if (risky) {
            status = 'escalate';
            reason = usesDisposition
                ? `a finding is marked disposition:"escalate" (${escalatedFindings.map((f) => String(f?.item ?? '?')).join(', ')}) — human review required`
                : 'RISK decision or escalation — human review required';
        } else if (usesDisposition && decisions.includes('RISK')) {
            // 20261007 narrowing: RISK whose findings are all gap/note/fix publishes at recorded
            // risk instead of pausing an unattended run; the exclude stamp keeps the residual-risk
            // record and the FSM routes it to wrap-docs like any admission-only exclusion.
            status = 'exclude';
            reason = 'RISK decisions carry only gap/note/fix dispositions — recorded, publishing at recorded risk';
        } else status = 'pass';
        if (status === 'pass' || status === 'escalate' || status === 'exclude') {
            sted('write', stampFile, () => writeJsonText(stampFile, { digest, status, excludedPlatforms }));
        }
        if (status === 'block' && !edited) {
            // A quality block poisons the isFile() draft cache: every same-day retry would
            // re-fail on unchanged bytes (20261002 dogfood — two judge-fail runs replayed until
            // the drafts were moved by hand). Quarantine (mv, never rm) so the next run
            // regenerates from scratch; the 09_* verdict artifacts stay in 24-script for audit.
            const q = join(workDir, '24-script', `.quarantine-${runDate}-judge-block`);
            mkdirSync(q, { recursive: true });
            for (const path of safetyDraftPaths(workDir, runDate)) {
                if (!isFile(path)) continue;
                let dest = join(q, basename(path));
                for (let n = 2; isFile(dest); n += 1) dest = join(q, `${n}-${basename(path)}`);
                renameSync(path, dest);
            }
        }
        sted('write', statusFile, () => writeRaw(statusFile, status));
        console.log(`safety: status=${status} (${reason}); routing is transition-owned`);
    });
}

/**
 * `daily-preflight <workflow.yaml>…` — assert the stage runner that `kk stage` just loaded
 * advertises every `kk stage <name>` these workflow definitions invoke.
 *
 * WHY (2026-10-20): the scheduler runs the CHECKOUT's workflow YAML while `kk stage` resolves the
 * runner from the INSTALLED package (`apps/cli/src/stage.ts`). A commit that adds a stage therefore
 * outruns the global install silently, and the mismatch only surfaces where the new stage is first
 * reached. That day's 04:30 run died 29 minutes in at `safety` with `unknown stage:
 * daily-safety-verdict` (present in the checkout, absent from the installed 0.1.4) and published
 * nothing. This runs as the first command of the run's `prepare` node, so the same skew costs one
 * cheap step and names both the missing stages and the refresh command.
 *
 * The known-name set is the dispatch switch of the sibling `kk-workflow-stages.ts` — the file beside
 * this one, i.e. the copy actually in force, never a checkout-vs-install guess.
 */
export function dailyPreflight(args: string[]): void {
    const files = args.filter((arg) => arg !== '');
    timed('', 'preflight', () => {
        if (files.length === 0) failWith(2, 'daily-preflight: pass at least one workflow YAML path');
        const runner = join(import.meta.dir, 'kk-workflow-stages.ts');
        if (!isFile(runner)) failWith(1, `daily-preflight.runner-missing: ${runner} is not beside this stage body`);
        const known = new Set(
            [...readFileSync(runner, 'utf-8').matchAll(/^\s*case '([a-z][a-z0-9-]*)':/gm)].map((match) =>
                String(match[1]),
            ),
        );
        // 0329 F21: the `publish-matrix-*` stages never appear in kk-workflow-stages' switch —
        // `kk stage` routes them through apps/cli's publish-matrix-stage.ts — so without this
        // roster every workflow invoking them died as runner-stale.
        const PUBLISH_MATRIX_STAGES = [
            'publish-matrix-plan',
            'publish-matrix-check',
            'publish-matrix-send',
            'publish-matrix-classify',
            'publish-matrix-bundle',
            'publish-matrix-rss-gate',
            'publish-matrix-wait-until',
        ] as const;
        for (const name of PUBLISH_MATRIX_STAGES) known.add(name);
        const missing: string[] = [];
        for (const file of files) {
            if (!isFile(file)) failWith(1, `daily-preflight.workflow-missing: ${file}`);
            // 0329 F21: accept both spellings — `kk stage <name>` and the ADR-037 canonical
            // `kk stage run <name>`.
            for (const match of readFileSync(file, 'utf-8').matchAll(/\bkk stage (?:run )?([a-z][a-z0-9-]*)/g)) {
                const name = String(match[1]);
                if (!known.has(name)) missing.push(`${name} (needed by ${basename(file)})`);
            }
        }
        if (missing.length > 0) {
            failWith(
                1,
                `daily-preflight.runner-stale: the installed stage runner ${runner} does not know ${missing.join(', ')} — refresh it (install the released kk package, or rsync plugins/kk/scripts/ per AGENTS.md) before the scheduled run`,
            );
        }
        console.log(
            `preflight: stage runner advertises every stage ${files.map((file) => basename(file)).join(' + ')} invokes`,
        );
    });
}

/**
 * Task 0317 R6 — fold the gate's own classification, its stamp and the `kk-safety-verdict` catalog
 * decision into ONE accept/refuse token the `judge -> clean` guard reads as a single predicate
 * (ADR-115 caps that guard at 5 logical commands, so the logic lives here).
 *
 * The gate stays authoritative on `block`/`revise`; the decision can only refuse an outcome the gate
 * already admitted. The decision replaced the judge's self-reported `confidence` field, which the
 * accept guard used to re-parse in shell: its fallback is `escalate`, so missing or garbled evidence
 * lands on a recorded human decision instead of a silent publish.
 *
 * Writes `24-script/<date>_09_safety-verdict.status` = `accept`, or `refuse` after naming the
 * offending value on stderr. Never exits non-zero: routing belongs to the transitions.
 */
export function dailySafetyVerdict(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const statusFile = safetyPath(workDir, runDate, 'safety-judge_status.txt');
    const stampFile = safetyPath(workDir, runDate, 'safety-judge_stamp.json');
    const decisionFile = safetyPath(workDir, runDate, 'safety-verdict.decision');
    const token = safetyPath(workDir, runDate, 'safety-verdict.status');
    const ADMITTED = new Set(['pass', 'escalate', 'exclude']);
    timed(workDir, 'safety-verdict-check', () => {
        const status = isFile(statusFile) ? readFileSync(statusFile, 'utf-8').trim() : '';
        const stamp = isFile(stampFile) ? statSync(stampFile).size : 0;
        // A missing/unreadable decision row is a refusal, never an approval: `onError: continue` on
        // the decide action is what can leave it absent.
        let verdict = '';
        if (isFile(decisionFile)) {
            const row = JSON.parse(readFileSync(decisionFile, 'utf-8')) as { value?: unknown };
            verdict = String(row.value ?? '');
        }
        let refusal = '';
        if (!ADMITTED.has(status)) {
            refusal = `kk-daily-safety.judge.verdict-refused: gate status [${status}] is not an admitted outcome, so these drafts must not publish`;
        } else if (stamp === 0) {
            refusal = `kk-daily-safety.judge.verdict-refused: gate stamp missing for status ${status}, so these drafts must not publish`;
        } else if (!ADMITTED.has(verdict)) {
            refusal = `kk-daily-safety.judge.decision-refused: kk-safety-verdict [${verdict}] must admit pass|escalate|exclude, so these drafts must not publish`;
        }
        if (refusal !== '') console.error(refusal);
        sted('write', token, () => writeRaw(token, refusal === '' ? 'accept' : 'refuse'));
    });
}

/**
 * Post-remediation bookkeeping for the `safety-revise` state: the agent edited the drafts, this
 * stage checks they are still the artifacts the rest of the pipeline consumes and spends one unit
 * of the remediation budget (`daily-safety-gate` reads it to choose revise-vs-exclude). Validating
 * here fails inside the loop instead of at `wrap-docs`, after the run has moved on. A broken
 * revision spends the budget too: an unparsable draft must not be retried forever.
 */
/**
 * Open a content-safety review of the current drafts: drop every artifact of an earlier review
 * (a retry must be re-reviewed on its final version) and write the request the two agent.run
 * steps read. The program passes context only — platform policy lives in the kk:content-safety
 * skill's reference files, never here.
 */
export function dailySafetyPrep(args: string[]): void {
    const [workDir = '', runDate = '', platforms = ''] = args;
    timed(workDir, 'safety-review', () => {
        const digest = safetyDigest(workDir, runDate);
        // Structural snapshot of the VoiceScript BEFORE any remediation edit. `daily-safety-revise`
        // restores it when the remediation pass changes the item-section structure without a recorded
        // exclusion: the agent is allowed to drop a 播报形态 line, not an item the article kept,
        // because `daily-wrap-docs` derives the spoken item sections from `gap_ms: 1200` and fails the
        // run when they no longer match the episode's included items (2026-10-21 04:30 run: 3
        // segments removed → 5 sections vs a 6-item plan → `generate` refused at 05:03 and the whole
        // day published nothing).
        const [, scriptPath] = safetyDraftPaths(workDir, runDate);
        const snapshot = safetyPath(workDir, runDate, 'safety-prep_script-snapshot.yaml');
        if (isFile(scriptPath)) sted('write', snapshot, () => writeRaw(snapshot, readFileSync(scriptPath, 'utf-8')));
        for (const name of [
            'safety-review_report.json',
            'safety-judge_verdict.json',
            'safety-judge_status.txt',
            'safety-judge_stamp.json',
        ]) {
            const stale = safetyPath(workDir, runDate, name);
            if (isFile(stale)) unlinkSync(stale);
        }
        const request = safetyPath(workDir, runDate, 'safety-review_request.json');
        const targets = platforms
            .split(',')
            .map((platform) => platform.trim())
            .filter(Boolean);
        sted('write', request, () => writeJsonText(request, { digest, platforms: targets, mode: 'detect-only' }));
    });
}

/**
 * Consume the content-safety report and the content-judge verdict into a publish decision (exit 0 in
 * every case — routing is transition-owned). The gate's job is to *adjust*, not to kill the run
 * (20261005 operator decision): a non-PASS verdict first routes back through one bounded
 * draft-remediation loop (`revise`), and what survives the loop is classified by what it is:
 *
 * - `revise`  — non-PASS and the remediation budget is not spent: re-review after the drafts change.
 * - `exclude` — admission-only residue (the CN 资质口径 / 播报形态 findings): the platforms that
 *               BLOCKed are dropped from this run and every other target publishes normally. Also
 *               the 20261007 narrowing: RISK whose findings are all gap/note/fix publishes at
 *               recorded risk with nothing dropped (empty `excludedPlatforms`).
 * - `escalate` — a finding the reviewer marked `disposition: "escalate"` on an otherwise clean
 *               pass: human review. Legacy reports (no `disposition` field anywhere) keep the old
 *               rule — any RISK decision or report-level `escalate: true` pauses (20261007 ADR).
 * - `pass`    — explicit PASS verdict, unchanged drafts, no BLOCK and no RISK finding at all.
 * - `block`   — draft integrity: PII reported on a blocked platform, or a judge must-pass `fail`
 *               outside `jurisdictional-rules` (prohibited claims / disclosure / data-handling);
 *               also an unreadable or out-of-contract report/verdict, a non-PASS that documents
 *               nothing, or drafts edited after the review. Never published.
 *
 * Fail-closed where it matters: a missing report, verdict or confidence still blocks.
 */
/**
 * Post-remediation bookkeeping for the `safety-revise` state: the agent edited the drafts, this
 * stage checks they are still the artifacts the rest of the pipeline consumes and spends one unit
 * of the remediation budget (`daily-safety-gate` reads it to choose revise-vs-exclude). Validating
 * here fails inside the loop instead of at `wrap-docs`, after the run has moved on. A broken
 * revision spends the budget too: an unparsable draft must not be retried forever.
 */
export function dailySafetyRevise(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    timed(workDir, 'safety-revise', () => {
        const [articlePath, scriptPath] = safetyDraftPaths(workDir, runDate);
        const article = requireJson(articlePath, 'safety-revise');
        for (const field of ['title', 'body'] as const) {
            const value = article[field];
            if (typeof value !== 'string' || value.trim() === '') {
                failWith(1, `safety-revise: article ${field} must be a non-empty string in ${articlePath}`);
            }
        }
        assertScriptContent(scriptPath);
        restoreStructureIfBroken(workDir, runDate, scriptPath);
        const path = join(workDir, SAFETY_REVISE_COUNT);
        const next = readSafetyReviseCount(workDir) + 1;
        sted('write', path, () => writeFileSync(path, `${next}\n`));
        console.log(`safety-revise: remediation pass ${next} applied; drafts re-validated`);
    });
}

/**
 * The spoken item-section count the episode is contracted to carry: the script plan's items minus the
 * ones the article boundary recorded in `metadata.excludedIds`.
 *
 * The article drops boundary docs at its own stage, the safety gate aligns the VoiceScript with the
 * article it reviews, and `daily-show-notes` already filters the plan copy by the same ids — but
 * `daily-generate` compared the sections against the raw plan length, so the 2026-10-21 run refused a
 * 5-section script against a 6-item plan (the 6th was the article-excluded 通用汽车 buyback) after two
 * hours of safety review and rendered nothing. Every consumer must count the same set.
 */
export function expectedItemSections(workDir: string, runDate: string, planItems: unknown[]): number {
    const excluded = metadataOf(
        readJson(join(workDir, '22-article', `${runDate}_06_article_content.json`)),
    ).excludedIds;
    if (!Array.isArray(excluded)) return planItems.length;
    const dropped = new Set(excluded.filter((id): id is string => typeof id === 'string' && id !== ''));
    if (dropped.size === 0) return planItems.length;
    return planItems.filter(
        (item) => !(item !== null && typeof item === 'object' && dropped.has(String((item as { id?: unknown }).id))),
    ).length;
}

/**
 * Repair a remediation pass that changed the VoiceScript's item-section structure.
 *
 * `daily-wrap-docs` (and `daily-generate`) derive the spoken item sections from `gap_ms: 1200` and
 * refuse the run when they disagree with the episode's included items. The safety agent is allowed
 * to reshape lines, and to drop an item the article boundary already excluded (that drop is the
 * contract, and `expectedItemSections` counts it out), but an unrecorded drop breaks the one-to-one
 * audio/notes/plan relation — and on 2026-10-21 one killed the 04:30 run at `generate` after two
 * hours of safety review. The pre-revise bytes are snapshotted by `daily-safety-prep`, so an
 * unaccounted structural change is undone here, inside the budget loop, and named for the operator.
 * The budget is still spent, so the loop still converges (the re-review sees the unchanged script and
 * the gate classifies the residue) instead of the day failing hours later at the TTS seam.
 */
function restoreStructureIfBroken(workDir: string, runDate: string, scriptPath: string): void {
    const planPath = join(workDir, '24-script', `${runDate}_08_script-write_plan.json`);
    const plan = readJson(planPath) as { items?: unknown[] } | null;
    if (plan === null || !Array.isArray(plan.items)) return;
    const snapshot = safetyPath(workDir, runDate, 'safety-prep_script-snapshot.yaml');
    if (!isFile(snapshot)) return;
    const sections = (path: string): number => {
        const parsed = Bun.YAML.parse(readFileSync(path, 'utf-8')) as { segments?: Array<Record<string, unknown>> };
        const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
        let count = 0;
        let pending = false;
        for (const segment of segments.slice(1, -1)) {
            pending = true;
            if (segment.gap_ms === 1200) {
                count += 1;
                pending = false;
            }
        }
        return count + (pending ? 1 : 0);
    };
    const expected = expectedItemSections(workDir, runDate, plan.items);
    const actual = sections(scriptPath);
    if (actual === expected) return;
    const original = sections(snapshot);
    sted('write', scriptPath, () => writeRaw(scriptPath, readFileSync(snapshot, 'utf-8')));
    console.error(
        `safety-revise: the edit changed the VoiceScript item sections (${expected} included plan items, ${original} before, ${actual} after) — restored the pre-revision structure from ${basename(snapshot)}; audio/notes stay one-to-one with the plan`,
    );
}

/** Block YAML for the fields a fitted VoiceScript actually carries. Strings use JSON quoting. */
function voicescriptToBlockYaml(script: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const key of [
        'title',
        'language',
        'default_profile',
        'default_profile_id',
        'default_engine',
        'default_emotion',
        'default_effect_preset',
    ]) {
        const value = script[key];
        if (typeof value === 'string' && value !== '') lines.push(`${key}: ${JSON.stringify(value)}`);
    }
    const segments = script.segments;
    if (!Array.isArray(segments)) return lines.join('\n');
    lines.push('segments:');
    for (const entry of segments) {
        const segment = entry as Record<string, unknown>;
        lines.push(`  - text: ${JSON.stringify(segment.text ?? '')}`);
        for (const key of ['speaker', 'profile', 'profile_id', 'emotion', 'instruct', 'effect_preset']) {
            if (typeof segment[key] === 'string') lines.push(`    ${key}: ${JSON.stringify(segment[key])}`);
        }
        for (const key of ['gap_ms', 'speed', 'seed', 'personality']) {
            if (typeof segment[key] === 'number') lines.push(`    ${key}: ${segment[key]}`);
        }
    }
    return lines.join('\n');
}

/** Measured driver rates from dailyGenerate. Unknown drivers reuse the voicebox rate. */
function spokenCharRate(vdriver: string): number {
    // Recalibrated 2026-10-15: episode measured 7,395 spoken chars / 1,490.9 s across 12 sections
    // (4.96 字/秒) — the effective gemini rate dropped ~8% below the 5.33-5.62 band calibrated
    // 2026-10-04/07, which consumed the fit's 2-min margin and tripped the 25-min gate at 25.2 min.
    if (vdriver === 'gemini') return 4.95;
    // voxcpm measured the same day on a 12-section zh+en episode: 6,772 chars / 1,297.7 s speech
    // (5.19 字/秒). The provisional 5.6 borrowed from voicebox let the fit budget reach 7,683 chars
    // — 24.6 min of audio, 18 s inside the 25-min gate. 5.2 puts a full-budget script at ~22.9 min.
    if (vdriver === 'voxcpm') return 5.2;
    return 5.6;
}

/**
 * Shorten one fact/insight at 。！？ so the cut removes at least `removeAtLeast` characters when a
 * boundary allows it, otherwise drop the last sentence. Returns null when the text is one sentence.
 */
function shrinkFactText(text: string, removeAtLeast: number): string | null {
    const ends: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '。' || ch === '！' || ch === '？') ends.push(i + 1);
    }
    if (ends.length === 0) return null;
    const limit = text.length - Math.max(removeAtLeast, 1);
    let chosen: number | null = null;
    for (const end of ends) {
        if (end <= limit && end < text.length && end > 0) chosen = end;
    }
    if (chosen !== null) return text.slice(0, chosen);
    const shorter = ends.filter((end) => end < text.length && end > 0);
    const tail = shorter[shorter.length - 1];
    if (tail === undefined) return null;
    return text.slice(0, tail);
}

/**
 * The pre-spend gate in dailyGenerate refuses before any TTS when the spoken character estimate
 * exceeds `episode_max_minutes`. Optional args (voice2 only) fit the fresh VoiceScript down to that
 * budget by shortening the longest fact segments, then insights. Absent args leave the file untouched.
 */
function fitVoicescriptToBudget(yamlOut: string, contentOut: string, episodeMaxMinutes: string, vdriver: string): void {
    if (episodeMaxMinutes === '') return;
    const maxMinutes = Number(episodeMaxMinutes);
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) return;
    // Two minutes under the hard duration gate. The character rate is a past measurement; fitting
    // flush to the ceiling renders an episode the gate then rejects.
    const maxChars = Math.floor((maxMinutes * 60 - 8 - 120) * spokenCharRate(vdriver));
    const original = readFileSync(yamlOut, 'utf8');
    const script = Bun.YAML.parse(original) as { segments?: Array<Record<string, unknown>> };
    const segments = script.segments;
    if (!Array.isArray(segments) || segments.length < 3) return;
    const totalOf = (): number => segments.reduce((sum, seg) => sum + [...String(seg.text ?? '')].length, 0);
    const before = totalOf();
    if (before <= maxChars) return;
    const unsplittable = new Set<number>();
    for (const factsOnly of [true, false]) {
        while (totalOf() > maxChars) {
            let best = -1;
            let bestLen = 0;
            for (let i = 1; i < segments.length - 1; i++) {
                if (unsplittable.has(i)) continue;
                if (factsOnly && segments[i]?.speed === 1.12) continue;
                const len = [...String(segments[i]?.text ?? '')].length;
                if (len > bestLen) {
                    best = i;
                    bestLen = len;
                }
            }
            if (best < 0) break;
            const text = String(segments[best]?.text ?? '');
            const next = shrinkFactText(text, totalOf() - maxChars);
            if (next === null || next.length >= text.length) {
                unsplittable.add(best);
                continue;
            }
            const segment = segments[best];
            if (segment) segment.text = next;
        }
    }
    const after = totalOf();
    if (after === before) return;
    // Block YAML, same shape as dailynews-gen's formatter. Bun.YAML.stringify emits a `{...}` flow
    // document, and the VoiceScript checker JSON-parses anything that starts with `{`.
    const fitted = `${voicescriptToBlockYaml(script)}\n`;
    sted('write', yamlOut, () => writeRaw(yamlOut, fitted));
    if (isFile(contentOut)) {
        const content = readJson(contentOut);
        if (content && typeof content.body === 'string') {
            content.body = fitted;
            sted('write', contentOut, () => writeJsonText(contentOut, content));
        }
    }
    console.log(`script: fitted voicescript ${before} -> ${after} chars (budget ${maxChars})`);
    if (after > maxChars) {
        console.error(
            `script: voicescript still ${after - maxChars} chars over the ${maxChars} budget after sentence cuts`,
        );
    }
}

export function dailyScript(args: string[]): void {
    const [
        workDir = '',
        runDate = '',
        pluginsPath = '',
        language = '',
        title = '',
        voiceProfile = '',
        episodeMaxMinutes = '',
        vdriver = '',
    ] = args;
    const yamlOut = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
    const contentOut = join(workDir, '24-script', `${runDate}_08_script_content.json`);
    const planIn = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    timed(workDir, 'script', () => {
        if (isFile(yamlOut)) {
            console.log(`voicescript capped by plan: ${yamlOut}`);
            return;
        }
        kk(['executor', 'run', 'dailynews-gen', '--in', planIn, '--out', contentOut, ...pluginsArgs(pluginsPath)], {
            env: {
                DAILYNEWS_LANGUAGE: language,
                DAILYNEWS_TITLE: title,
                // Task 0189: the broadcast greeting carries the episode's run date, not the render
                // date — a backfilled/retried run must not greet "today".
                DAILYNEWS_DATE: runDate,
                VOICEBOX_DEFAULT_PROFILE: voiceProfile,
                // F613 R4: always passed as absolute paths — spawnPluginEntry runs plugins with
                // cwd = the plugin package dir, so a relative workDir would silently miss the
                // plan; a plan file absent at build time reports missing-plan (template fallback).
                DAILYNEWS_SCRIPT_PLAN: resolve(join(workDir, '24-script', `${runDate}_08_script-write_plan.json`)),
                DAILYNEWS_STYLE_FILE: resolve(resolveSidecar('', STYLE_SIDECAR)),
            },
        });
        const body = readJson(contentOut)?.body;
        if (typeof body !== 'string') failWith(1, `script: ${contentOut} has no string body`);
        sted('write', yamlOut, () => writeRaw(yamlOut, body));
        fitVoicescriptToBudget(yamlOut, contentOut, episodeMaxMinutes, vdriver);
        // R3 (task 0139): fresh writes are validated here; the script cache path is covered by
        // wrap-docs, which runs on every path that reaches audio.
        try {
            assertScriptContent(yamlOut);
        } catch (err) {
            // A rejected fresh write would otherwise poison the isFile(yamlOut) cache: every
            // resume skips regeneration and re-fails at wrap-docs. Drop it so retry regenerates.
            unlinkSync(yamlOut);
            throw err;
        }
    });
}

/** Task 0189 R10 artifacts of the content-safety verdict gate (24-script, step 09). */
/**
 * F613 R1: snapshot the shipped style contract into the run's work dir. Spur workflows have no
 * workflow-dir var, so the script-write prompt reads this copy — and the snapshot freezes the
 * exact contract the run's plan was written against. Idempotent (an existing snapshot is kept);
 * a missing sidecar is a broken install, so `requireSidecar` fails loud.
 */
export function dailyScriptStyle(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const snapshot = join(workDir, '24-script', `${runDate}_08_script-write_style.md`);
    if (isFile(snapshot)) {
        console.log(`script style cached: ${snapshot}`);
        return;
    }
    const sidecar = requireSidecar('', STYLE_SIDECAR, 'daily-voice-style');
    const scriptDir = join(workDir, '24-script');
    sted('mkdir', scriptDir, () => mkdirSync(scriptDir, { recursive: true }));
    sted('cp', snapshot, () => copyFileSync(sidecar, snapshot));
    console.log(`script style snapshot: ${snapshot}`);
}

export function dailyShowNotes(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', title = ''] = args;
    const article = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    // The preceding `publish-surfdash` state writes this artifact; `_17_publish_result.json` does
    // not exist yet at `show-notes` time (the later `publish` state merges it), so reading it left
    // PODCAST_PUB_ARTICLE_POST_PATH permanently empty (task 0137).
    const result = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
    const out = join(workDir, '31-publish', `${runDate}_15_show-notes_show-notes.md`);
    const plan = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    // Generated-episode content carries `metadata.segments[]` — the source of real
    // audio offsets for the show-notes timeline (jump-to-item timestamps).
    const audioContent = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'show-notes', () => {
        const effective = readJson(article)?.title;
        const titleArg = title !== '' ? title : typeof effective === 'string' ? effective : '';
        // Boundary-excluded docs must not render into show notes (judge finding 2026-10-02): the
        // article body's 未写入 note names the dropped ids; filter the plan copy podcast-pub sees.
        // Inlined parse — this file must not import @gobing-ai/* (header contract); the same note
        // grammar lives in daily-article-gen's excludedIdsFromNote.
        const postPath = firstPostPath(readJson(result), 'surfdash-pub');
        if (postPath === '') {
            console.error('WARN podcast-pub: brief mode requested but ARTICLE_POST_PATH is empty; using legacy layout');
        }
        const articleContent = readJson(article);
        const articleBody = articleContent?.body;
        const excluded = new Set<string>();
        // Article Content carries the dropped ids as `metadata.excludedIds` (2026-10-10): the boundary
        // note is stripped from the published body, so re-parsing the body alone would silently stop
        // filtering and leak excluded docs into the show notes. The note parse below stays as the
        // fallback for Content produced before the field existed.
        const metaExcluded = metadataOf(articleContent)?.excludedIds;
        if (Array.isArray(metaExcluded)) {
            for (const id of metaExcluded) {
                if (typeof id === 'string' && id !== '') excluded.add(id);
            }
        }
        // Script-plan exclusions are the prompt-layer topic boundary (foreign public affairs the
        // keyword floor deliberately leaves in the plan). Show notes must match what was spoken.
        const scriptPlan = readJson(join(workDir, '24-script', `${runDate}_08_script-write_plan.json`));
        const scriptExcluded = scriptPlan?.excluded;
        if (Array.isArray(scriptExcluded)) {
            for (const entry of scriptExcluded) {
                if (entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
                    excluded.add((entry as { id: string }).id);
                }
            }
        }
        if (typeof articleBody === 'string') {
            for (const note of articleBody.matchAll(/未写入[：:](.*)/g)) {
                for (const id of note[1].matchAll(/(?:[a-zA-Z0-9_-]+:)?[0-9a-f]{16,64}/g)) {
                    excluded.add(id[0]);
                    const colon = id[0].indexOf(':');
                    if (colon !== -1) excluded.add(id[0].slice(colon + 1));
                }
            }
        }
        let planIn = plan;
        if (excluded.size > 0) {
            const parsed: unknown = readJson(plan);
            if (Array.isArray(parsed)) {
                const kept = parsed.filter(
                    (d) =>
                        !(
                            d !== null &&
                            typeof d === 'object' &&
                            (excluded.has(String((d as Record<string, unknown>).id)) ||
                                (String((d as Record<string, unknown>).id).includes(':') &&
                                    excluded.has(
                                        String((d as Record<string, unknown>).id).slice(
                                            String((d as Record<string, unknown>).id).indexOf(':') + 1,
                                        ),
                                    )))
                        ),
                );
                if (kept.length !== parsed.length) {
                    planIn = plan.replace(/\.json$/, '-shownotes.json');
                    writeJsonText(planIn, kept);
                }
            }
        }
        kk(['executor', 'run', 'podcast-pub', '--in', planIn, '--out', out, ...pluginsArgs(pluginsPath)], {
            env: {
                PODCAST_PUB_TITLE: titleArg,
                PODCAST_PUB_RUN_DATE: runDate,
                PODCAST_PUB_BRIEF_MODE: 'true',
                PODCAST_PUB_ARTICLE_POST_PATH: postPath,
                // 2026-10-08: the column settings carry the AI-production note. Do not append the
                // stock closer to show notes (or the article, or the spoken sign-off).
                ...(isFile(audioContent) ? { PODCAST_PUB_AUDIO_CONTENT: audioContent } : {}),
            },
        });
    });
}

/** `jq -r '[…select(.target == t and .ok == true) | .metadata.postPath // empty] | first // ""'`. */
/**
 * Collapsed translate scaffolding (2026-09-16 feedback): surfdash-pub owns the
 * deterministic mechanics — `scaffold-locale` for both target locales — while the
 * workflow `translate` state's agent step owns the LLM translation of the drafts.
 * Writes one marker file per locale (zh post path + en/ja draft paths); empty
 * marker = locale absent (callers skip). Reuses an existing on-disk draft only when its
 * source-hash sidecar matches the current zh post — a changed source must invalidate the
 * translation cache before the next unattended run.
 */
export function dailyTranslateLocalize(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    // The prepare result is available before translation; the final publish result is retained as
    // a compatibility fallback for manual recovery of pre-two-phase workspaces.
    const prepareResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash-prepare_result.json`);
    const result = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
    const zhFile = join(workDir, '31-publish', `${runDate}_20_translate-localize_zh-post-path.txt`);
    timed(workDir, 'translate-localize', () => {
        const postPath =
            firstPostPath(readJson(prepareResult), 'surfdash-pub') || firstPostPath(readJson(result), 'surfdash-pub');
        const zh = postPath.endsWith('index.md') ? postPath : '';
        sted('write', zhFile, () => writeRaw(zhFile, zh));
        if (zh === '') {
            for (const target of ['en', 'ja'] as const) {
                const sourceHashFile = join(
                    workDir,
                    '31-publish',
                    `${runDate}_20_translate-localize_${target}-source-sha256.txt`,
                );
                sted(
                    'write',
                    join(workDir, '31-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`),
                    () =>
                        writeRaw(
                            join(workDir, '31-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`),
                            '',
                        ),
                );
                sted('remove', sourceHashFile, () => rmSync(sourceHashFile, { force: true }));
            }
            console.log('no zh post path — skip localize');
            return;
        }
        let sourceHash: string;
        try {
            sourceHash = createHash('sha256').update(readFileSync(zh)).digest('hex');
        } catch (error: unknown) {
            failWith(
                1,
                `translate-localize: cannot fingerprint zh source ${zh}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        for (const target of ['en', 'ja'] as const) {
            const markerFile = join(workDir, '31-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`);
            const existing = zh.replace('/zh/', `/${target}/`);
            const sourceHashFile = join(
                workDir,
                '31-publish',
                `${runDate}_20_translate-localize_${target}-source-sha256.txt`,
            );
            const cachedSourceHash = isFile(sourceHashFile) ? readFileSync(sourceHashFile, 'utf-8').trim() : '';
            if (isFile(existing) && cachedSourceHash === sourceHash) {
                sted('write', markerFile, () => writeRaw(markerFile, existing));
                console.log(`${target} draft cached: ${existing}`);
                continue;
            }
            if (isFile(existing)) {
                console.log(`${target} draft invalidated: zh source fingerprint changed or is missing`);
            }
            const scaffold = join(workDir, '31-publish', `${runDate}_20_translate-localize_scaffold-${target}.json`);
            const scaffoldResult = join(
                workDir,
                '31-publish',
                `${runDate}_20_translate-localize_scaffold-${target}-result.json`,
            );
            sted('write', scaffold, () =>
                writeJqText(scaffold, {
                    body: '',
                    options: {
                        operation: 'scaffold-locale',
                        postPath: zh,
                        target,
                        ...(isFile(existing) ? { force: true } : {}),
                    },
                }),
            );
            try {
                kk([
                    'executor',
                    'run',
                    'surfdash-pub',
                    '--in',
                    scaffold,
                    '--out',
                    scaffoldResult,
                    ...pluginsArgs(pluginsPath),
                ]);
                const draftPath = metadataOf(readJson(scaffoldResult)).draftPath;
                const draft = typeof draftPath === 'string' ? draftPath : '';
                sted('write', markerFile, () => writeRaw(markerFile, draft));
                if (draft !== '') {
                    sted('write', sourceHashFile, () => writeRaw(sourceHashFile, sourceHash));
                } else {
                    sted('remove', sourceHashFile, () => rmSync(sourceHashFile, { force: true }));
                }
            } catch (error: unknown) {
                if (error instanceof StageFailure && error.status === 127) throw error;
                const message = error instanceof Error ? error.message : String(error);
                sted('write', markerFile, () => writeRaw(markerFile, ''));
                sted('remove', sourceHashFile, () => rmSync(sourceHashFile, { force: true }));
                console.error(`translate-localize: ${target} scaffold failed: ${message}`);
            }
        }
    });
}

/**
 * Run Surfdash's own refine command over the complete locale set before the validation fingerprint
 * is written. This is deliberately a separate local-only phase: the final publish FSM also runs
 * refine, but it must be idempotent by the time any CMS/git side effect is reachable.
 */
function normalizeTranslatedLocales(zhPostPath: string, failUnsafe = true): void {
    for (const locale of ['zh', 'en', 'ja'] as const) {
        const sibling = locale === 'zh' ? zhPostPath : zhPostPath.replace('/zh/', `/${locale}/`);
        if (!isFile(sibling)) continue;
        const raw = readFileSync(sibling, 'utf-8');
        const { markdown, remaining } = normalizeSeriesNames(raw, locale);
        if (failUnsafe && remaining.length > 0) {
            failWith(1, `series-name normalization left unsafe names in ${locale}: ${remaining.join(' / ')}`);
        }
        if (markdown !== raw) sted('write', sibling, () => writeRaw(sibling, markdown));
    }
}

export function dailySurfdashRefine(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const marker = join(workDir, '31-publish', `${runDate}_20_translate-localize_zh-post-path.txt`);
    const input = join(workDir, '31-publish', `${runDate}_24_surfdash-refine_content.json`);
    const result = join(workDir, '31-publish', `${runDate}_24_surfdash-refine_result.json`);
    timed(workDir, 'surfdash-refine', () => {
        try {
            const zhPostPath = isFile(marker) ? readFileSync(marker, 'utf-8').trim() : '';
            if (zhPostPath === '' || !zhPostPath.startsWith('/') || !isFile(zhPostPath)) {
                failWith(1, `surfdash-refine: zh marker must name an existing post: ${marker}`);
            }
            validateLocaleMarkers(workDir, runDate, zhPostPath, 'surfdash-refine');
            // The validator is intentionally read-only. Repair known series spellings before
            // site-owned refine computes managed fields, otherwise the final publisher would
            // rewrite the refined bytes after the locale fingerprint was admitted.
            normalizeTranslatedLocales(zhPostPath);
            sted('write', input, () =>
                writeJqText(input, {
                    body: '',
                    format: 'markdown',
                    options: { operation: 'refine-prepared', postPath: zhPostPath, runDate },
                }),
            );
            rmSync(result, { force: true });
            kk(['executor', 'run', 'surfdash-pub', '--in', input, '--out', result, ...pluginsArgs(pluginsPath)], {
                unset: NESTED_SPUR_UNSET,
                env: { SURFDASH_LOCALE: 'zh' },
            });
            const refined = readJson(result);
            if (refined?.ok !== true) {
                failWith(1, `surfdash-refine: publisher did not return a successful refine receipt: ${result}`);
            }
            sted('write', result, () =>
                writeJqText(result, {
                    ok: true,
                    summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                    targets: [
                        {
                            target: 'surfdash-pub',
                            ok: true,
                            status: 'refined',
                            metadata: metadataOf(refined),
                        },
                    ],
                }),
            );
            console.log(`surfdash-refine: site-owned refine completed for ${zhPostPath}`);
        } catch (error: unknown) {
            if (error instanceof StageFailure && error.status === 127) throw error;
            const message = error instanceof Error ? error.message : String(error);
            sted('write', result, () =>
                writeJqText(result, {
                    ok: false,
                    summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
                    targets: [{ target: 'surfdash-pub', ok: false, status: 'failed', error: message }],
                }),
            );
            console.error(`surfdash-refine: ${message}`);
        }
    });
}

/** Validates locale siblings without contacting Surfdash or mutating their bytes. */
function validateTranslatedLocales(zhPostPath: string, step: 'translate-validate' | 'translate-sync'): void {
    const zhPoints = countKeyPoints(zhPostPath);
    for (const locale of ['zh', 'en', 'ja'] as const) {
        const sibling = locale === 'zh' ? zhPostPath : zhPostPath.replace('/zh/', `/${locale}/`);
        if (!isFile(sibling)) {
            if (locale !== 'zh' && step === 'translate-validate') {
                failWith(1, `${step}: ${locale} draft is missing: ${sibling}`);
            }
            continue;
        }
        const problems: string[] = [];
        const raw = readFileSync(sibling, 'utf-8');
        const { markdown, remaining } = normalizeSeriesNames(raw, locale);
        if (markdown !== raw) problems.push('series-name normalization is pending; run the refine preparation first');
        if (remaining.length > 0) {
            problems.push(`retired series names left after rewrite: ${remaining.join(' / ')}`);
        }
        const items = readKeyPointItems(sibling);
        if (step === 'translate-validate') {
            if (readFrontmatterScalar(sibling, 'refined') !== 'true') {
                problems.push('site-owned refine has not completed (refined: true is required)');
            }
            if (items === undefined || items.length === 0) {
                problems.push('key_points missing or malformed');
            } else {
                const malformed = items.filter((item) => {
                    const separator = item.indexOf(' — ');
                    return separator <= 0 || item.slice(separator + 3).trim() === '';
                });
                if (malformed.length > 0) problems.push('key_points missing or malformed');
            }
        }
        if (locale !== 'zh') {
            if (readFrontmatterScalar(sibling, 'description') === undefined) {
                problems.push('description missing/empty');
            }
            const points = countKeyPoints(sibling);
            if (zhPoints !== undefined && points !== undefined && points !== zhPoints) {
                problems.push(`key_points count ${points} != zh ${zhPoints} (spliced or merged items)`);
            }
            // The scheduled path must not let an untranslated scaffold reach the strict CMS sync.
            if (step === 'translate-validate' && readFrontmatterScalar(sibling, 'draft') !== 'false') {
                problems.push('draft is still true — locale was scaffolded but not translated');
            }
            // Label discipline (same 2026-10-23 audit): a key_points item is `Label — sentence`
            // and the label is a short phrase — ≤14 chars for ja, ≤28 for en — never a
            // sentence and never an ellipsis-truncated fragment.
            if (items !== undefined) {
                const cap = locale === 'en' ? 28 : 14;
                const overLimit = items.filter((item) => {
                    const separator = item.indexOf(' — ');
                    if (separator < 0) return false;
                    const label = item.slice(0, separator);
                    return label.includes('…') || Array.from(label).length > cap;
                });
                if (overLimit.length > 0) {
                    problems.push(
                        `key_points label over ${cap} chars or …-truncated: ${overLimit.length} of ${items.length} items`,
                    );
                }
            }
        }
        if (problems.length > 0) {
            failWith(
                1,
                `${step}: ${locale} draft failed the pre-sync structural check (${problems.join('; ')}) — repair ${sibling} per the translate stage contract before syncing`,
            );
        }
    }
}

/** Local pre-CMS gate for the scheduled two-phase Surfdash flow. */
export function dailyTranslateValidate(args: string[]): void {
    const [workDir = '', runDate = '', _pluginsPath = '', zhPathFile = ''] = args;
    const validationResult = join(workDir, '31-publish', `${runDate}_24_translate-validate_result.json`);
    timed(workDir, 'translate-validate', () => {
        const zhPostPath = isFile(zhPathFile) ? readFileSync(zhPathFile, 'utf-8').trim() : '';
        try {
            if (zhPathFile.endsWith('.md') || zhPostPath === '' || !zhPostPath.startsWith('/') || !isFile(zhPostPath)) {
                failWith(
                    1,
                    `translate-validate: 4th argument must name an existing zh marker file (${runDate}_20_translate-localize_zh-post-path.txt)`,
                );
            }
            validateLocaleMarkers(workDir, runDate, zhPostPath, 'translate-validate');
            validateTranslatedLocales(zhPostPath, 'translate-validate');
            const evidence = surfdashLocaleValidationEvidence(zhPostPath, runDate);
            if (!evidence.ok) failWith(1, `translate-validate: ${evidence.reason}`);
            sted('write', validationResult, () =>
                writeJqText(validationResult, {
                    ok: true,
                    target: 'surfdash-pub',
                    status: 'validated',
                    metadata: evidence.evidence,
                }),
            );
            console.log(`translate-validate: locale files ready for final Surfdash publish (${zhPostPath})`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            sted('write', validationResult, () =>
                writeJqText(validationResult, {
                    ok: false,
                    target: 'surfdash-pub',
                    status: 'rejected',
                    error: message,
                    metadata: { postPath: zhPostPath },
                }),
            );
            console.error(`translate-validate: ${message}`);
        }
    });
}

export function dailyTranslateSync(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', zhPathFile = ''] = args;
    const sync = join(workDir, '31-publish', `${runDate}_24_translate-sync_sync.json`);
    const syncResult = join(workDir, '31-publish', `${runDate}_24_translate-sync_sync-result.json`);
    timed(workDir, 'translate-sync', () => {
        // Reads the marker file itself — the collapsed `translate` state has no
        // cross-state var to hand the path through.
        const zhPostPath = isFile(zhPathFile) ? readFileSync(zhPathFile, 'utf-8').trim() : '';
        if (zhPostPath === '') {
            console.log('no zh post path — skip translate-sync');
            return;
        }
        // The 4th argument is the MARKER file, not the post (2026-10-22). Passing the post made the
        // plugin read the whole article as `postPath` and echo it back inside its error, which cost a
        // confusing round trip on a manual recovery run.
        if (zhPathFile.endsWith('.md') || !zhPostPath.startsWith('/') || !isFile(zhPostPath)) {
            failWith(
                1,
                `translate-sync: 4th argument must be the zh marker file (${runDate}_20_translate-localize_zh-post-path.txt), not the post itself — '${zhPathFile}' holds ${zhPostPath.includes('\n') ? 'a multi-line document' : `'${zhPostPath}'`}`,
            );
        }
        // Preserve the legacy explicit sync repair behavior before the shared read-only gate.
        normalizeTranslatedLocales(zhPostPath, false);
        // The 2026-10-23 locale structural gate is shared with the scheduled two-phase validator.
        // This explicit recovery command still performs the real CMS sync after validation.
        validateTranslatedLocales(zhPostPath, 'translate-sync');
        sted('write', sync, () =>
            writeJqText(sync, { body: '', options: { operation: 'sync', postPath: zhPostPath } }),
        );
        kk(['executor', 'run', 'surfdash-pub', '--in', sync, '--out', syncResult, ...pluginsArgs(pluginsPath)], {
            unset: NESTED_SPUR_UNSET,
        });
    });
}

export function dailyWrapDocs(args: string[]): void {
    const [workDir = '', runDate = '', voiceProfile = ''] = args;
    const scriptPath = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
    const docsPath = join(workDir, '30-audio', `${runDate}_10_wrap-docs_docs.json`);
    timed(workDir, 'wrap-docs', () => {
        // R3 (task 0139): the second validator placement — covers a HITL-edited YAML and the
        // script-stage cache path, neither of which re-enters dailyScript's fresh-write branch.
        assertScriptContent(scriptPath);
        const url = new URL(scriptPath, `file://${process.cwd()}/`);
        const body = readFileSync(decodeURIComponent(url.pathname), 'utf-8');
        const profile = voiceProfile || process.env.VOICEBOX_DEFAULT_PROFILE || 'robin-news';
        const doc = {
            id: createHash('sha256').update(url.href).digest('hex').slice(0, 16),
            title: 'Daily AI News VoiceScript',
            sourceUri: url.href,
            body,
            mediaType: 'application/yaml',
            metadata: { voiceProfile: profile },
        };
        sted('write', docsPath, () => writeJsonText(docsPath, [doc]));
    });
}

/** 0235 R4: `note_scope`'s one opt-in value. Anything else — absent included — is today's path. */
const XHS_NOTE_SCOPE_EPISODE = 'episode';

/**
 * 0235 R2: `①` — the circled digits ①…⑳ are contiguous from here, and the episode note attaches
 * `XHS_MAX_CARDS` cards plus at most one cover, so no bare number can ever be needed.
 */
const CIRCLED_DIGIT_ONE = 0x2460;

/** The attach-order marker of line `position` (0-based). */
const markerFor = (position: number): string => String.fromCodePoint(CIRCLED_DIGIT_ONE + position);

/**
 * 0235 R2: split the agent's note body into its lead paragraph and its trailing hashtag run. The
 * prompt asks for 3-5 hashtags at the end, so the run is read off the end of the body; a body
 * without hashtags is entirely lead.
 */
function splitNoteBody(body: string): { lead: string; hashtags: string } {
    const trimmed = body.trim();
    const match = /(?:^|\s)(#\S+(?:\s+#\S+)*)\s*$/.exec(trimmed);
    if (match === null) return { lead: trimmed, hashtags: '' };
    return { lead: trimmed.slice(0, match.index).trimEnd(), hashtags: match[1] ?? '' };
}

/**
 * 0235 R2: the episode note body — the agent's lead paragraph, then one numbered line per attached
 * image in attach order, then the plan's hashtags. `cap` is the console's own note limit
 * (`XHS_NOTE_BODY_MAX`): only the lead is trimmed to fit, so an image never loses its line. A body
 * that overflows even without a lead fails loud rather than shipping a note the editor would cut.
 */
function episodeNoteBody(body: string, lines: string[], cap: number): string {
    const { lead, hashtags } = splitNoteBody(body);
    const tail = [lines.join('\n'), hashtags].filter((part) => part !== '').join('\n\n');
    // `\n\n` joins the lead to the tail; a lead trimmed away drops the separator with it.
    const budget = cap - tail.length - (lead === '' ? 0 : 2);
    const head = budget >= lead.length ? lead : lead.slice(0, Math.max(budget, 0)).trimEnd();
    const note = head === '' ? tail : `${head}\n\n${tail}`;
    if (note.length > cap) {
        failWith(
            1,
            `xhs render: episode note body is ${note.length} chars for ${lines.length} image lines — the cap is ${cap} and a line is never dropped`,
        );
    }
    return note;
}

/**
 * 0251 R1: parse the composer's safe-area overflow sentence
 * (`text overflows the safe area for field(s): <fields> (safe area: …)`, chromium.ts) into the
 * named `points[n]` indexes — or null when the failure is anything else: no marker, a non-points
 * field (e.g. `headline`), or an index outside `card.points`. Null means no retry.
 */
export function xhsOverflowPoints(stderr: string, card: XhsCard): number[] | null {
    const marker = 'text overflows the safe area for field(s):';
    const at = stderr.indexOf(marker);
    if (at < 0) return null;
    const list = stderr.slice(at + marker.length).split('(')[0] ?? '';
    const fields = list.split(',').map((name) => /^points\[(\d+)\]$/.exec(name.trim())?.[1]);
    if (fields.length === 0 || fields.some((field) => field === undefined)) return null;
    const indexes = fields.map((field) => Number(field));
    if (indexes.some((n) => n >= card.points.length)) return null;
    return indexes;
}

/** The sentence-ending marks the shorten rule cuts at. */
const POINT_SENTENCE_MARKS = new Set(['。', '！', '？']);

/** Fewest bullets a card keeps: below two, the block stops reading as a list. */
const XHS_MIN_POINTS = 2;

/** How many rewrites a refused card gets; each attempt re-bills one illustration. */
const XHS_OVERFLOW_ATTEMPTS = 3;

/**
 * 0251 R1 + 2026-10-12: reduce the points of a card the composer refused, so the next compose pass
 * can fit them. Rule 1 shortens each point the composer named ({@link shortenOverflowedPoint}). When
 * no point can get shorter the block itself is over budget — measured on 20261011-ai-2026-10-11, whose
 * cover points are 12–16 code-point single sentences that both shortening rules leave untouched, so
 * the old single-shot retry never fired and the whole series was lost — so rule 2 drops the trailing
 * point. Returns whether the card changed, the caller's signal to retry.
 */
export function reduceOverflowingPoints(points: string[], named: readonly number[]): boolean {
    let changed = false;
    for (const n of named) {
        const point = points[n] ?? '';
        const next = shortenOverflowedPoint(point);
        if (next !== point) {
            points[n] = next;
            changed = true;
        }
    }
    if (!changed && points.length > XHS_MIN_POINTS) {
        points.pop();
        changed = true;
    }
    return changed;
}

/**
 * 0251 R1: shorten one overflowing card point — drop its last sentence (cut at the last
 * 。/！/？ that is not the final character, inclusive); a one-sentence point longer than 36
 * code points keeps its first 36 plus `…`. Returns the input unchanged when neither rule
 * shortens it, which the caller reads as "nothing got shorter — do not retry".
 */
export function shortenOverflowedPoint(point: string): string {
    const chars = [...point];
    for (let i = chars.length - 2; i >= 0; i--) {
        if (POINT_SENTENCE_MARKS.has(chars[i] ?? '')) return chars.slice(0, i + 1).join('');
    }
    if (chars.length > 36) return `${chars.slice(0, 36).join('')}…`;
    return point;
}

/**
 * E8: build one `image-gen` envelope per planned card, render them sequentially, and package the
 * ordered card manifest + `Content` that `xhs-pub` consumes. Format, style, provider and model
 * are pinned here (never model-authored), so the series cannot drift from its preset. Card copy
 * is typeset by image-gen's composer; the provider prompt stays text-free (0181). Resume-safe:
 * a card whose recorded artifact is still on disk is not re-rendered — and not re-billed.
 *
 * `note_scope` (`episode`, 0235) opts into the episode note for voice2: the packaged set then also
 * attaches the episode cover last, and the body is rebuilt as the lead paragraph plus one numbered
 * line per attached image. Absent or any other value: the lead-item series and the agent's body are
 * packaged verbatim (voice1's contract).
 */
export function dailyXhsRender(args: string[]): void {
    const [
        workDir = '',
        runDate = '',
        pluginsPath = '',
        countArg = '',
        style = '',
        provider = '',
        model = '',
        fallback = '',
        noteScope = '',
    ] = args;
    const count = Number.parseInt(countArg, 10);
    const episode = noteScope === XHS_NOTE_SCOPE_EPISODE;
    const planPath = join(workDir, '25-xhs', `${runDate}_18_xhs_plan.json`);
    const coverPath = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
    const cardsDir = join(workDir, '25-xhs', 'cards');
    const manifestPath = join(workDir, '25-xhs', 'cards.json');
    const contentPath = join(workDir, '25-xhs', 'content.json');
    timed(workDir, 'xhs-render', () => {
        if (!Number.isInteger(count) || count < 1 || count > XHS_MAX_CARDS) {
            failWith(1, `xhs render: xhs_cards must be 1..${XHS_MAX_CARDS}, got '${countArg}'`);
        }
        const plan = xhsPlan(planPath, count);
        sted('mkdir', cardsDir, () => mkdirSync(cardsDir, { recursive: true }));
        const images: Record<string, unknown>[] = [];
        const cards: Record<string, unknown>[] = [];
        // 0235 R2: the numbered lines are a pure function of the plan and the cover, in attach order
        // (cards in plan order, the cover last), so the note — and its cap — is settled before the
        // first card is billed: an over-cap tail fails here with nothing rendered.
        const withCover = episode && isFile(coverPath);
        const lines = plan.cards.map((card, i) => `${markerFor(i)} ${card.copy}：${card.points[0] ?? ''}`);
        if (withCover) lines.push(`${markerFor(lines.length)} 每日AI乱炖 ${runDate} 本期封面`);
        const body = episode ? episodeNoteBody(plan.body, lines, XHS_BODY_CAP) : plan.body;
        for (const card of plan.cards) {
            const out = join(cardsDir, `card-${card.index}.json`);
            const promptPath = join(cardsDir, `card-${card.index}.prompt.txt`);
            let artifact = firstArtifact(readJson(out));
            if (artifact === null || !isFile(typeof artifact.path === 'string' ? artifact.path : '')) {
                const envPath = join(cardsDir, `card-${card.index}.in.json`);
                const imageGen: Record<string, unknown> = {
                    job: 'free',
                    format: XHS_FORMAT,
                    style,
                    vars: {
                        role: card.role,
                        layout: card.layout,
                        headline: card.copy,
                        points: card.points.join('\n'),
                        subject: card.subject,
                        index: card.index,
                    },
                    maxImages: 1,
                };
                if (provider !== '') imageGen.provider = provider;
                if (model !== '') imageGen.model = model;
                // 0219 R1: same opt-in as the cover stage — '' keeps strict fail-fast.
                if (fallback !== '') imageGen.fallback = imageFallback(fallback);
                sted('write', envPath, () =>
                    writeJsonText(envPath, [
                        { id: `xhs-card-${card.index}`, title: runDate, body: '', metadata: { imageGen } },
                    ]),
                );
                // Sequential on purpose: one provider call per card (illustration only —
                // card copy is typeset by image-gen's composer, never prompted), and the
                // first failure stops the spend — later cards stay unrendered for a resume
                // run to pick up. 0251: the one captured call — the overflow retry branches
                // on the composer's stderr, which kk()'s inherit stdio cannot return.
                const imageGenArgs = [
                    'executor',
                    'run',
                    'image-gen',
                    '--in',
                    envPath,
                    '--out',
                    out,
                    ...pluginsArgs(pluginsPath),
                ];
                // 0219 R2: name the failed card so a hand re-run resumes without re-billing.
                const resumeLine = (status: number): string =>
                    `xhs render: card ${card.index} failed (image-gen exit ${status}); cards before it are kept — re-run daily-xhs-render to resume from card ${card.index}`;
                let result = kkCaptured(imageGenArgs, { soft: true });
                // 0269: a failure the composer's overflow sentence does NOT explain is retried once with
                // the SAME envelope, because the observed cause of those is the provider, not the input:
                // on 2026-10-12 card 02 was rewritten for a points[3] overflow and the second call then
                // failed with only a vendor-fallback warning (minimax flaked); re-running that exact
                // saved envelope by hand rendered on the first try. 0251 R2 read "not an overflow ⇒ do not
                // retry" as fail-fast, which is what lost the whole series that day (and every day since
                // 10-08). The budget stays bounded: overflow rewrites keep their 3, a provider failure
                // gets exactly 1, so a permanently broken card costs one extra illustration and not four.
                let transientRetryUsed = false;
                for (let attempt = 0; result.status !== 0 && attempt < XHS_OVERFLOW_ATTEMPTS; attempt += 1) {
                    // 0251 R1 (+ the block-level rule 2): a points[n] safe-area overflow is rewritable —
                    // shorten the named points, then drop the trailing one. The envelope is rewritten in
                    // the same shape and image-gen is called again.
                    const named = xhsOverflowPoints(result.stderr, card);
                    if (named === null) {
                        if (transientRetryUsed) break;
                        transientRetryUsed = true;
                        console.log(
                            `xhs render: card ${card.index} failed without a safe-area overflow — retrying the same envelope once (exit ${result.status})`,
                        );
                        result = kkCaptured(imageGenArgs, { soft: true });
                        continue;
                    }
                    if (!reduceOverflowingPoints(card.points, named)) break;
                    (imageGen.vars as Record<string, unknown>).points = card.points.join('\n');
                    sted('write', envPath, () =>
                        writeJsonText(envPath, [
                            { id: `xhs-card-${card.index}`, title: runDate, body: '', metadata: { imageGen } },
                        ]),
                    );
                    result = kkCaptured(imageGenArgs, { soft: true });
                }
                if (result.status !== 0) failWith(result.status, resumeLine(result.status));
                artifact = firstArtifact(requireJson(out, 'xhs render'));
            }
            if (artifact === null) failWith(1, `xhs render: card ${card.index} recorded no image artifact (${out})`);
            const recorded = artifact.path;
            if (typeof recorded !== 'string' || !isFile(recorded)) {
                failWith(1, `xhs render: card ${card.index} image artifact is not on disk: '${String(recorded)}'`);
            }
            // `image-gen` writes the artifact beside `--out`; the publisher requires absolute paths.
            const imagePath = resolve(recorded);
            // 0181: a composed card may also carry the text-free illustration layer; keep
            // its recorded path so the manifest shows both layers.
            const rawIllustration: unknown = artifact.illustration;
            const illustrationPath =
                typeof rawIllustration === 'object' &&
                rawIllustration !== null &&
                typeof (rawIllustration as Record<string, unknown>).path === 'string'
                    ? resolve((rawIllustration as Record<string, unknown>).path as string)
                    : undefined;
            sted('write', promptPath, () =>
                writeRaw(promptPath, typeof artifact.prompt === 'string' ? artifact.prompt : ''),
            );
            images.push({ ...artifact, path: imagePath });
            cards.push({
                index: card.index,
                role: card.role,
                sourcePoint: card.sourcePoint,
                copy: card.copy,
                layout: card.layout,
                promptPath,
                imagePath,
                illustrationPath,
                ...(card.itemId === undefined ? {} : { itemId: card.itemId }),
                status: 'rendered',
            });
        }
        // 0235 R1: the episode cover closes the set — it is ultrawide, and image 1 (card 01) is what
        // sets the note's grid ratio. It is `daily-cover`'s own artifact (no new image kind), and
        // the set is ≤ XHS_MAX_CARDS + 1 = 11, inside `xhs-pub`'s XHS_IMAGE_MAX (18).
        if (withCover) {
            images.push({ path: resolve(coverPath) });
        } else if (episode) {
            console.log(
                `xhs render: no episode cover at ${coverPath} — the note carries the ${cards.length} cards only`,
            );
        }
        sted('write', manifestPath, () => writeJsonText(manifestPath, { source: planPath, cards }));
        sted('write', contentPath, () =>
            writeJsonText(contentPath, {
                title: plan.title,
                body,
                format: 'text',
                metadata: { images, publishStatus: 'draft' },
            }),
        );
        console.log(
            episode
                ? `xhs render: ${images.length} images packaged in image order (${contentPath})`
                : `xhs render: ${cards.length} cards packaged in card order (${contentPath})`,
        );
    });
}

/** A single-target publish Result, not the fan-out aggregate: `ok` plus `metadata.publishStatus`. */
