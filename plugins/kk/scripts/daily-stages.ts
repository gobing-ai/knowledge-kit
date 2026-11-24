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
    cpSync,
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
    EPISODE_IDENTITY_KEY,
    type EpisodeIdentity,
    freezeEpisodeIdentity,
    identityFromMetadata,
} from './episode-identity.ts';
import {
    ADMISSION_CRITERIA,
    applyTopicBoundary,
    assertScriptContent,
    COVER_FORMAT,
    COVER_STYLE,
    coverBrief,
    coverNormalizeBody,
    dedupPlanByTitle,
    EDITORIAL_SKILL_DIR,
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
    readTopicBoundary,
    requireJson,
    resultPublishStatus,
    SAFETY_PLATFORM_DECISIONS,
    SAFETY_REVISE_COUNT,
    STYLE_CONTRACT,
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
import {
    type AlignmentProposal,
    commitAlignment,
    dropReselectedJudgments,
    type LockPort,
} from './news-editorial-ledger.ts';
import { splitSentences } from './sentences.ts';
import { normalizeSeriesNames } from './series-names.ts';
import { resolveSourceCitation } from './source-citation.ts';
import {
    readSelectionAttempts,
    recordSelectionAttempt,
    recordSelectionStage,
    selectionAttemptsPath,
} from './topic-selection-attempts.ts';

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
    const floorMinutes = Number(minMinutes);
    const qcMinChars =
        minMinutes !== '' && Number.isFinite(floorMinutes) && floorMinutes > 0
            ? String(
                  Math.max(
                      0,
                      Math.ceil(((floorMinutes * 60 - 8) * spokenCharRate(vdriver)) / readKeptRatio(workDir).ratio),
                  ),
              )
            : '';
    const fingerprint = stageCacheFingerprint(planContent, {
        qcCategories,
        minQuality,
        minImportance,
        minUrgency,
        minImpact,
        minEpisodeItems,
        minMinutes,
        vdriver,
        qcMinChars,
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
                    ...(qcMinChars ? { QC_MIN_CHARS: qcMinChars } : {}),
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
    // Task 0392 R2: the raw pool entering QC, captured OUTSIDE the timed block so a cached rerun
    // still records it (`10-collect/pool.json` is a different artifact — this is the plan snapshot
    // the QC filter actually reads). The QC drops are named by ID difference, so the stage's own
    // arithmetic holds instead of being inferred.
    const poolDocs = metadataOf(readJson(planContent)).docs;
    const poolIds = (Array.isArray(poolDocs) ? poolDocs : []).map((doc) => String((doc as { id?: unknown }).id ?? ''));
    const boundaryIds = new Set(boundaryDocs.map((doc) => String((doc as { id?: unknown }).id ?? '')));
    const qcDropped = poolIds.filter((id) => !boundaryIds.has(id));
    // Task 0392 R2: one record per stage that ran, so each stage is provable on its own
    // (`input === kept + dropped`) instead of being inferred from one cross-stage sum.
    const selectionPath = selectionAttemptsPath(workDir);
    sted('write', selectionPath, () => {
        const attemptOrdinal = (readSelectionAttempts(workDir)?.attempts.length ?? 0) + 1;
        const keptDocs = dropped.length > 0 ? deduped : currentDocs;
        recordSelectionAttempt(workDir, {
            runDate,
            attemptId: `${runDate}#${attemptOrdinal}`,
            spec: readTopicBoundary(),
            stages: [
                { stage: 'qc', input: poolIds.length, kept: boundaryDocs.length, dropped: qcDropped },
                // The boundary's drops are rule-tagged, not just counted: the exclusions carry them.
                {
                    stage: 'topicBoundary',
                    input: boundaryDocs.length,
                    kept: currentDocs.length,
                    dropped: excluded.map((entry) => entry.id),
                },
                { stage: 'dedup', input: currentDocs.length, kept: keptDocs.length, dropped },
            ],
            // Post-dedup survivors, so the recorded kept set is what later stages actually receive.
            keptIds: keptDocs.map((doc) => String((doc as { id?: unknown }).id ?? '')),
            excluded,
        });
    });
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
 * The cold-start ratio the PRE-SPEND widen decision uses, and it is deliberately not 1.4.
 *
 * The consumers need opposite safe directions (the same argument `scriptFloorCharRate` makes about
 * the char rate): the reported arithmetic wants the typical ratio, while the pre-spend gates want
 * the *worst measured* ratio, because a cheap error is a rung too many and the expensive one is an
 * authoring pass the TTS gate then refuses.
 *
 * Measured spoken/kept-candidate ratios: 2026-10-11 1,270/1,800 = 0.71 and 5,925/4,300 = 1.38;
 * 2026-11-15 run `kk-news-generate-20261115-1794773860762` 2,053/7,244 = 0.28. Treating 1.4 as the
 * floor ratio let that day pass the gate at 32.6 min, spend a full authoring pass, then refuse at
 * 6.2 min — and the ladder that exists to fill a thin day from the backlog never climbed a rung
 * (0377).
 *
 * This constant is only the fallback: both gates prefer the ratio a previous run recorded, and the
 * two records carry DIFFERENT denominators (see `readKeptRatio` — using one ratio for both was the
 * 2026-11-16 refusal of a 23-min episode).
 */
const SPEAK_CHAR_EXPANSION_FLOOR = 0.28;

/**
 * Where a run records the ratios it actually delivered (0377 R2/R3). Two denominators, because the
 * two pre-spend consumers measure different sets: `ratio` is spoken/pool (the ladder, which judges
 * the raw extracted pool) and `keptRatio` is spoken/kept-candidate chars (the floor gate, which
 * judges what QC actually admitted). The gates read the newest record from the sibling run
 * directories, so they judge today's material by what the writer really produced last time instead
 * of a constant that was calibrated once.
 */
const SPOKEN_RATIO_SUFFIX = '_09_spoken-ratio.json';

/** The measured ratio one run delivered, and where it came from. */
interface SpokenRatio {
    ratio: number;
    source: string;
}

/** Clamp a recorded ratio into a plausible band: a corrupt file must not freeze or flood the ladder. */
function clampRatio(value: number): number {
    return Math.min(2, Math.max(0.05, value));
}

/**
 * The newest recorded spoken/raw ratio across this workflow's run directories, or the calibrated
 * floor constant when no run has recorded one yet. `workDir` is one run directory, so its parent is
 * the workflow directory the sibling runs live in.
 */
function readSpokenRatio(workDir: string): SpokenRatio {
    const base = resolve(workDir, '..');
    let newest: { at: number; ratio: number; from: string } | null = null;
    let entries: string[] = [];
    try {
        entries = readdirSync(base);
    } catch {
        return { ratio: SPEAK_CHAR_EXPANSION_FLOOR, source: 'default 0.28 (no sibling runs)' };
    }
    // Best-effort calibration only: a test workdir or an operator scratch dir may sit directly in a
    // shared temp parent with hundreds of thousands of entries. Scanning each one took 20–40s per QC
    // stage (measured 2026-11-23 on a 556k-entry tempdir), so skip the sibling calibration instead of
    // blocking the run. Normal works roots have far fewer runs and keep the newest-ratio behavior.
    if (entries.length > 5_000)
        return {
            ratio: SPEAK_CHAR_EXPANSION_FLOOR,
            source: `default 0.28 (sibling scan skipped: ${entries.length} entries)`,
        };
    for (const entry of entries) {
        const dir = join(base, entry, '21-plan');
        let files: string[] = [];
        try {
            files = readdirSync(dir).filter((file) => file.endsWith(SPOKEN_RATIO_SUFFIX));
        } catch {
            continue;
        }
        for (const file of files) {
            const path = join(dir, file);
            try {
                const parsed = readJson(path) as Record<string, unknown> | null;
                const ratio = Number(parsed?.ratio);
                if (!Number.isFinite(ratio) || ratio <= 0) continue;
                const at = statSync(path).mtimeMs;
                if (newest === null || at > newest.at) newest = { at, ratio, from: path };
            } catch {
                // A malformed record is not evidence; the next run overwrites it.
            }
        }
    }
    if (newest === null) return { ratio: SPEAK_CHAR_EXPANSION_FLOOR, source: 'default 0.28 (no recorded run)' };
    return { ratio: clampRatio(newest.ratio), source: `${newest.from} (${newest.ratio.toFixed(2)}x)` };
}

/**
 * The newest recorded spoken/KEPT ratio across sibling runs, or the cold-start constant.
 *
 * WHY this is separate from `readSpokenRatio` (2026-11-16): one constant was applied to two
 * different denominators. The ladder multiplies the raw pool (38,241 chars that day) while this gate
 * multiplies the kept candidates (13,963 chars — planning admitted 37% of the pool), so the same
 * 0.28 read as a 34.5 min "clears" in the ladder and a 12.7 min "refusing" at the gate, and the run
 * paid for the planning pass to discover it. The writer then delivered 7,194 spoken chars ≈ 23 min:
 * the refusal discounted the planning shrink twice. `keptRatio` for that run is 0.515.
 */
function readKeptRatio(workDir: string): SpokenRatio {
    const base = resolve(workDir, '..');
    let newest: { at: number; ratio: number; from: string } | null = null;
    let entries: string[] = [];
    try {
        // A shared temp parent can hold hundreds of thousands of directories. Read names once and
        // open only run-shaped candidates past the small-workspace threshold; opening every one took
        // 20–40s per QC stage (556k entries measured 2026-11-23).
        entries = readdirSync(base);
    } catch {
        return { ratio: SPEAK_CHAR_EXPANSION_FLOOR, source: 'default 0.28 (no sibling runs)' };
    }
    const ratioFiles: string[] = [];
    if (entries.length > 5_000) {
        // Native globbing skips the non-run directories instead of opening each of them in JS. The
        // `kk-*` form measured ~2s on that same parent; a bare `*` can hit broken symlinks.
        for (const pattern of [`kk-*/21-plan/*${SPOKEN_RATIO_SUFFIX}`, `20??????/21-plan/*${SPOKEN_RATIO_SUFFIX}`]) {
            try {
                ratioFiles.push(...new Bun.Glob(pattern).scanSync({ cwd: base, onlyFiles: true, absolute: true }));
            } catch {
                // Best-effort calibration: a shared temp parent holds dangling symlinks and dirs that
                // vanish mid-scan (ENOENT from the glob walk), which must never fail the QC stage.
            }
        }
    } else {
        for (const entry of entries) {
            const dir = join(base, entry, '21-plan');
            try {
                ratioFiles.push(
                    ...readdirSync(dir)
                        .filter((file) => file.endsWith(SPOKEN_RATIO_SUFFIX))
                        .map((file) => join(dir, file)),
                );
            } catch {
                // Not every sibling is a run directory.
            }
        }
    }
    for (const path of ratioFiles) {
        try {
            const parsed = readJson(path) as Record<string, unknown> | null;
            // A pre-2026-11-16 record carries no kept ratio at all: skip it rather than divide by
            // its pool figure, which is what produced the double discount.
            const ratio = Number(parsed?.keptRatio);
            if (!Number.isFinite(ratio) || ratio <= 0) continue;
            const at = statSync(path).mtimeMs;
            if (newest === null || at > newest.at) newest = { at, ratio, from: path };
        } catch {
            // A malformed record is not evidence; the next run overwrites it.
        }
    }
    if (newest === null) return { ratio: SPEAK_CHAR_EXPANSION_FLOOR, source: 'default 0.28 (no recorded kept ratio)' };
    return { ratio: clampRatio(newest.ratio), source: `${newest.from} (${newest.ratio.toFixed(2)}x)` };
}

/**
 * Record what this run delivered — spoken script chars over raw pool chars, and over the kept
 * candidates — and warn when it drifted from the ratio the widen decision used. A refused script
 * records too: a thin day teaches the ladder even though it produced no episode.
 */
function recordSpokenRatio(workDir: string, runDate: string, spokenChars: number): void {
    const poolPath = join(workDir, '10-collect', 'pool.json');
    if (!isFile(poolPath)) return;
    const pool = readJson(poolPath);
    const poolChars = rawChars(Array.isArray(pool) ? pool : []);
    if (poolChars <= 0) return;
    // The admitted set the floor gate measures, so the next pre-spend estimate discounts the planning
    // shrink once instead of twice (2026-11-16).
    const keptPath = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const keptChars = isFile(keptPath) ? rawChars(metadataOf(readJson(keptPath)).docs ?? []) : 0;
    const round3 = (value: number): number => Math.round(value * 1000) / 1000;
    const ratio = round3(spokenChars / poolChars);
    const out = join(workDir, '21-plan', `${runDate}${SPOKEN_RATIO_SUFFIX}`);
    mkdirSync(join(workDir, '21-plan'), { recursive: true });
    writeJsonText(out, {
        runDate,
        poolChars,
        ...(keptChars > 0 ? { keptChars, keptRatio: round3(spokenChars / keptChars) } : {}),
        spokenChars,
        ratio,
    });
    // Drift warning: the ladder judged this pool with some ratio; the writer just delivered a
    // different one. A wide gap means the next run's ladder is working from a stale measure.
    let used: number | null = null;
    try {
        const ladder = readJson(join(workDir, '10-collect', 'ladder.json')) as Record<string, unknown> | null;
        const candidate = Number(ladder?.ratioUsed);
        if (Number.isFinite(candidate) && candidate > 0) used = candidate;
    } catch {
        used = null;
    }
    if (used !== null && Math.abs(ratio / used - 1) > 0.25) {
        console.error(
            `spoken ratio drifted: this run delivered ${ratio.toFixed(2)}x of the pool, the ladder widened on ${used.toFixed(2)}x (see ${out})`,
        );
    }
}

/** Title+body characters of a Doc[] — the raw measure every spoken ratio here divides into. */
function rawChars(docs: unknown[]): number {
    return docs.reduce((sum, doc) => {
        const entry = (doc ?? {}) as Record<string, unknown>;
        return sum + `${String(entry.title ?? '')}`.length + String(entry.body ?? '').length;
    }, 0);
}

/**
 * The calibrated pre-spend estimate over a kept pool (title+body characters × the 1.4 expansion,
 * over the driver's measured char rate, plus the 8 s intro sting) — shared by the pre-spend floor
 * gate (applyFloorGate) and the post-spend duration refusal (dailyEpisodeDuration, 0266), so both
 * artifacts report the same arithmetic. `seconds` is unrounded: the floor gate compares seconds.
 */
function estimateSpokenMinutes(
    docs: unknown[],
    vdriver: string,
    expansion: number = SPEAK_CHAR_EXPANSION,
): { minutes: number; seconds: number; chars: number } {
    const chars = rawChars(docs);
    const seconds = 8 + (chars * expansion) / spokenCharRate(vdriver);
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
 *
 * The ratio comes from `readKeptRatio`, NOT the pool-denominated one the ladder uses: this gate
 * measures the admitted set, and applying the pool ratio to it discounted the planning shrink twice
 * (2026-11-16: estimated 12.7 min, the writer delivered 23).
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
    const keptRatio = readKeptRatio(workDir);
    const {
        minutes: estimatedMinutes,
        seconds: estimatedSeconds,
        chars,
    } = estimateSpokenMinutes(docs, vdriver, keptRatio.ratio);
    if (estimatedSeconds >= floor * 60) {
        if (clearStaleRefusal && isFile(refusal)) unlinkSync(refusal);
        // Task 0392 R2: the floor gate observed this pool and admitted it — a stage that ran and
        // dropped nothing is evidence, not silence.
        recordSelectionStage(workDir, runDate, {
            stages: [{ stage: 'floor', input: docs.length, kept: docs.length, dropped: [] }],
        });
        console.log(`floor gate: estimated ${estimatedMinutes} min from ${chars} chars — above the ${floor} min floor`);
        return;
    }
    const ids = docs.map((doc) => String((doc as Record<string, unknown> | null)?.id ?? ''));
    // A refusal drops the whole pool: recording it as `kept 0` keeps the stage identity true and
    // tells the report the day ended here rather than leaving the stage unknown.
    recordSelectionStage(workDir, runDate, {
        stages: [{ stage: 'floor', input: docs.length, kept: 0, dropped: ids }],
    });
    sted('write', refusal, () =>
        writeJqText(refusal, {
            estimatedMinutes,
            minMinutes: floor,
            candidateChars: chars,
            // The ratio this refusal actually used, and where it came from (0377; 2026-11-16): the
            // gate measures the KEPT set, so a pool-denominated ratio under-predicts it badly.
            expansion: keptRatio.ratio,
            expansionSource: keptRatio.source,
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
    const [workDir = '', topic = '', window = '', minMinutes = '', vdriver = '', limitArg = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!topic) fail('missing topic');
    // 2026-11-20: `kk store extract --limit` defaults to the profile's cap (else 20), and this stage
    // passed no `--limit` at all — so the plan cap (`plan_max_items`, 40) never reached the store and
    // the pool was pre-trimmed to the default before the quota existed. Measured on the production
    // store: 56 category-allowed, importance>=3, unpublished items sat in the 168h window, the
    // extract returned 24, QC admitted 13, the writer kept 3 and the day refused at the TTS gate;
    // at `--limit 40` the same window yields 30 items and 23 survive QC. The extract bound must be
    // at least the plan bound or the plan can never fill.
    const extractedLimit = Number(limitArg);
    const limit =
        limitArg !== '' && Number.isInteger(extractedLimit) && extractedLimit > 0
            ? ['--limit', String(extractedLimit)]
            : [];
    if (limitArg !== '' && limit.length === 0) fail(`extract: invalid limit: ${limitArg}`);
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
        // 0347 F6 (2026-11-10): extract re-reads the store on every rerun, so a next-day retry of a
        // failed episode saw overnight collects invalidate the plan fingerprint and the plan stage
        // fail-closed ("refusing to pair a new plan with stale outputs"). Once the plan has
        // authored its output, the episode is frozen: keep the pool byte-for-byte so a rerun
        // resumes the same material (work dirs are per-run-date, so the 21-plan prefix glob is
        // unambiguous). Removing the pool or the plan files re-extracts deliberately.
        const planAuthored = existsSync(join(workDir, '21-plan'))
            ? readdirSync(join(workDir, '21-plan')).some(
                  (entry) => entry.endsWith('_03_plan_content.json') || entry.endsWith('_03_plan_plan.json'),
              )
            : false;
        if (planAuthored && isFile(poolPath)) {
            console.error(`extract: plan already authored — keeping the frozen pool (${poolPath})`);
            return;
        }
        // 0377 R2: judge the pool by what the writer actually delivered last time. The calibrated
        // 0.28 constant is only the fallback for a workflow that has never recorded a ratio.
        const ratio = readSpokenRatio(workDir);
        let chosen: { window: string; docs: unknown[] } | null = null;
        const rungs: Array<{ window: string; items: number; chars: number; minutes: number; clears: boolean }> = [];
        for (const ms of windows) {
            const label = formatWindowMs(ms);
            const attempt = join(workDir, '10-collect', `.pool-${label}.json`);
            kk(['store', 'extract', '--topic', topic, '--window', label, '--out', attempt, ...limit]);
            const parsed = readJson(attempt);
            const docs = Array.isArray(parsed) ? (parsed as unknown[]) : [];
            const estimate = estimateSpokenMinutes(docs, vdriver, ratio.ratio);
            const clears = estimate.seconds >= floor * 60;
            rungs.push({ window: label, items: docs.length, chars: estimate.chars, minutes: estimate.minutes, clears });
            chosen = { window: label, docs };
            const verdict = gated
                ? `estimated ${estimate.minutes} min at ${ratio.ratio.toFixed(2)}x — ${clears ? 'clears' : 'below'} the ${floor} min floor`
                : 'floor gate off';
            console.error(`extract: ${label} pool ${docs.length} item(s), ${verdict}`);
            if (!gated || clears) break;
            rmSync(attempt, { force: true });
        }
        const picked = chosen ?? { window: formatWindowMs(base), docs: [] as unknown[] };
        // 0377 R3: the decision is an artifact, not just a stderr line — the run report and
        // `kk news status` read which measure drove it, the rung chosen and the estimate at each rung.
        sted('write', join(workDir, '10-collect', 'ladder.json'), () =>
            writeJsonText(join(workDir, '10-collect', 'ladder.json'), {
                floorMinutes: gated ? floor : null,
                ratioUsed: ratio.ratio,
                ratioSource: ratio.source,
                chosen: picked.window,
                rungs,
            }),
        );
        sted('write', poolPath, () => writeJsonText(poolPath, picked.docs));
        for (const ms of windows)
            rmSync(join(workDir, '10-collect', `.pool-${formatWindowMs(ms)}.json`), { force: true });
    });
}

/**
 * 0385 R4: the one frozen episode identity a bundle ships, read from the Content provenance first
 * (a retry or a replay republishes what the episode already carried) and from the slot
 * `daily-editorial-render` freezes second. `null` means "no identity recorded" — the caller leaves
 * whatever title the artifact already has.
 */
function episodeIdentityFor(workDir: string, runDate: string, content: unknown): EpisodeIdentity | null {
    return (
        identityFromMetadata(metadataOf(content)) ??
        identityFromMetadata({
            [EPISODE_IDENTITY_KEY]: readJson(join(workDir, '21-plan', `${runDate}_05_script_identity.json`)),
        })
    );
}

/**
 * 0385 R4: stamp the frozen title into one article Content — `title`, the H1 of the body, and the
 * `metadata.episodeIdentity` record every later target reads. A withheld identity (`title: null`)
 * leaves the Content untouched: there is no title to share, and inventing one is the bug.
 *
 * Both articles seams call this — `daily-article` after it derives (first run) and
 * `daily-editorial-render` after the body is rewritten (retry) — so the stamp cannot be a no-op on
 * one order and be wiped on the other.
 */
function stampEpisodeIdentity(articleContentPath: string, identity: EpisodeIdentity): boolean {
    if (identity.title === null) return false;
    const articleContent = readJson(articleContentPath);
    if (articleContent === null) return false;
    const priorBody = typeof articleContent.body === 'string' ? articleContent.body : '';
    const body = priorBody.replace(/^#(?!#)[^\n]*/u, `# ${identity.title}`);
    sted('write', articleContentPath, () =>
        writeJsonText(articleContentPath, {
            ...articleContent,
            title: identity.title,
            body,
            metadata: { ...metadataOf(articleContent), [EPISODE_IDENTITY_KEY]: identity },
        }),
    );
    return true;
}

/**
 * 0385 R4: the article seam's one entry point — read the bundle's frozen identity for this run and
 * stamp it into the article Content. `daily-article` calls it right after it derives the Content
 * (first run) and after a `proseStale` re-derivation (retry), which is the only thing that keeps the
 * stamp `daily-editorial-render` wrote from being wiped. Returns the identity it applied (or null).
 */
export function applyEpisodeIdentityToArticle(
    workDir: string,
    runDate: string,
    articleContentPath: string,
): EpisodeIdentity | null {
    const identity = episodeIdentityFor(workDir, runDate, readJson(articleContentPath));
    if (identity === null) return null;
    stampEpisodeIdentity(articleContentPath, identity);
    return identity;
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
        // The prose body is the generator's INPUT: when it is newer than content.json the pair
        // is stale (an operator or a retry edited the headings after the render), and serving it
        // ships last round's body to surfdash. Re-derive instead of returning.
        const proseBody = join(workDir, '22-article', `${runDate}_06_article-write_body.md`);
        const proseStale =
            isFile(proseBody) &&
            isFile(articleContent) &&
            statSync(proseBody).mtimeMs > statSync(articleContent).mtimeMs;
        if (isFile(articleMd) && isFile(articleContent) && !proseStale) {
            console.log(`article cached: ${articleMd}`);
            return;
        }
        if (proseStale) {
            console.error(`article: stale pair — ${proseBody} is newer than ${articleContent}, re-deriving`);
        }
        // Agent-written prose body (workflow `article-write` state) replaces the mechanical
        // per-item render when present — the 3-format split: surfdash gets an article,
        // not a news list (2026-09-16 feedback).
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
        // 0385 R4: `generate-render` order is script → editorial-render → article → cover, so this
        // is the FIRST seam where the Content exists; `daily-editorial-render`'s own stamp would be a
        // no-op here. Stamping now — and re-stamping here after a `proseStale` re-derivation — is what
        // keeps the article (surfdash) and the show notes on the same frozen title as podcast/ID3.
        applyEpisodeIdentityToArticle(workDir, runDate, articleContent);
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
        'vibe-voice': 'vibe-voice-tts',
        vibevoice: 'vibe-voice-tts',
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
    // deliver it at 5.24-5.94 chars/s. The floor estimate uses `scriptFloorCharRate`, NOT
    // `spokenCharRate`: the fit rate's slow calibration over-predicts minutes and passes a thin
    // script into the full synthesis, which the measured gate then refuses (20261111).
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
            const charRate = scriptFloorCharRate(vdriver);
            const seconds = 8 + chars / charRate;
            // Record what the writer delivered before judging it: a refused day still teaches the
            // next run's ladder what this pool really yielded (0377 R2/R3).
            recordSpokenRatio(workDir, runDate, chars);
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

        const stampSidecarHash = (plan: (typeof plans)[number]): void => {
            try {
                const sidecar = readJson(plan.jsonPath) as Record<string, unknown>;
                sidecar.hash = plan.hash;
                if (sidecar.metadata && typeof sidecar.metadata === 'object') {
                    (sidecar.metadata as Record<string, unknown>).hash = plan.hash;
                }
                writeJsonText(plan.jsonPath, sidecar);
            } catch {}
        };

        const buildSectionDocIn = (plan: (typeof plans)[number]): string => {
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
            return secDocIn;
        };

        const BATCH_MANIFEST_CONFIG: Record<string, { envKey: string; filename: string; label: string }> = {
            'voxcpm-tts': { envKey: 'VOXCPM_BATCH_MANIFEST', filename: '.voxcpm_batch.json', label: 'voxcpm' },
            'vibe-voice-tts': {
                envKey: 'VIBEVOICE_BATCH_MANIFEST',
                filename: '.vibe-voice_batch.json',
                label: 'vibe-voice',
            },
        };
        const batchConfig = BATCH_MANIFEST_CONFIG[voiceGenerator];
        if (batchConfig && anySynthesisNeeded) {
            const pendingPlans = plans.filter((p) => p.needsSynthesis);
            for (const plan of plans) {
                if (!plan.needsSynthesis) {
                    console.log(`generate: section cached: ${plan.def.stem}`);
                }
            }
            const secInputs = pendingPlans.map((p) => ({ plan: p, inPath: buildSectionDocIn(p) }));
            const batchManifestPath = join(secDir, batchConfig.filename);
            const runBatch = (items: typeof secInputs): number => {
                writeJsonText(
                    batchManifestPath,
                    items.map((item) => ({ in: item.inPath, out: item.plan.jsonPath })),
                );
                return kk(voiceExecutorArgs(voiceGenerator, items[0].inPath, items[0].plan.jsonPath, pluginsPath), {
                    env: { VOICE_GEN_MP3: transcodeMp3, [batchConfig.envKey]: batchManifestPath },
                    soft: true,
                });
            };
            try {
                console.log(
                    `generate: synthesizing ${secInputs.length} ${batchConfig.label} section(s) in single-worker batch: ${secInputs.map((i) => i.plan.def.stem).join(', ')}`,
                );
                let status = runBatch(secInputs);
                for (const item of secInputs) {
                    if (existsSync(item.plan.jsonPath) && validNativeAudio(item.plan.wavPath)) {
                        stampSidecarHash(item.plan);
                    }
                }
                if (status !== 0) {
                    const remaining = secInputs.filter(
                        (item) => !existsSync(item.plan.jsonPath) || !validNativeAudio(item.plan.wavPath),
                    );
                    if (remaining.length > 0) {
                        console.log(
                            `generate: ${batchConfig.label} batch failed (exit ${status}) — retrying ${remaining.length} remaining section(s) once`,
                        );
                        status = runBatch(remaining);
                        for (const item of remaining) {
                            if (existsSync(item.plan.jsonPath) && validNativeAudio(item.plan.wavPath)) {
                                stampSidecarHash(item.plan);
                            }
                        }
                    } else {
                        status = 0;
                    }
                }
                if (status !== 0) {
                    failWith(status, `generate: ${batchConfig.label} batch section synthesis failed`);
                }
            } finally {
                rmSync(batchManifestPath, { force: true });
                for (const item of secInputs) {
                    rmSync(item.inPath, { force: true });
                }
            }
        } else {
            // Synthesize sections sequentially (concurrency 1)
            for (const plan of plans) {
                if (!plan.needsSynthesis) {
                    console.log(`generate: section cached: ${plan.def.stem}`);
                    continue;
                }
                console.log(`generate: synthesizing section: ${plan.def.stem}`);
                const secDocIn = buildSectionDocIn(plan);
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
                stampSidecarHash(plan);
            }
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
 * Delete a published episode's lossless audio intermediates: every section render (the synthesis
 * cache `dailyGenerate` reads), the joined final, and the `<stem>.intro.wav` merge output.
 *
 * Measured 2026-11-20: 987 MB of WAV across six daily runs — 80% of `.works/kk-news-generate` — for
 * 13–20 MB of MP3 per day. Nothing outside the run reads them: the podcast enclosure, `publish-prep`
 * and every retry window read the MP3, and `daily-intro` merged its copy inside the run.
 *
 * Guarded on the delivered artifact, never on a run status: a missing MP3 means the transcode
 * failed, and pruning then would turn the rebuild into a paid re-synthesis. Re-entering
 * `daily-generate` after a prune re-synthesizes the sections — the intended trade, since a
 * published day is not regenerated.
 */
export function dailyAudioPrune(args: string[]): void {
    const [workDir = ''] = args;
    if (!workDir) fail('missing work_dir');
    const audioDir = join(workDir, '30-audio');
    if (!existsSync(audioDir)) {
        console.log(`audio-prune: no ${audioDir} — nothing to prune`);
        return;
    }
    const contentName = readdirSync(audioDir)
        .filter((entry) => /^\d{8}_11_generate_content\.json$/.test(entry))
        .sort()
        .at(-1);
    if (contentName === undefined) {
        console.log('audio-prune: no episode content in 30-audio — nothing to prune');
        return;
    }
    const content = readJson(join(audioDir, contentName));
    const recorded = [metadataOf(content).mp3Path, content?.mp3Path].find(
        (candidate): candidate is string => typeof candidate === 'string' && candidate !== '',
    );
    if (recorded === undefined || !isFile(resolve(recorded))) {
        console.log('audio-prune: publish MP3 not on disk — keeping the WAV intermediates');
        return;
    }
    const wavs: string[] = [];
    const collect = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) collect(path);
            else if (entry.name.endsWith('.wav')) wavs.push(path);
        }
    };
    collect(audioDir);
    let freed = 0;
    for (const wav of wavs) {
        freed += statSync(wav).size;
        sted('remove', wav, () => rmSync(wav, { force: true }));
    }
    console.log(
        `audio-prune: removed ${wavs.length} WAV intermediate${wavs.length === 1 ? '' : 's'} (${(freed / 1048576).toFixed(1)} MB), kept ${basename(resolve(recorded))}`,
    );
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
    const perSourceCap = String(Math.max(5, Math.ceil((Number(planMaxItems) || 20) / 4)));
    const fingerprint = stageCacheFingerprint(blended, {
        runDate,
        planMaxItems,
        perSourceCap,
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
                // 0347 F6 (2026-11-10): the pool can drift between the authoring day and a rerun
                // (overnight collects grow the store; extract-overwrite used to break the
                // fingerprint). Keeping the existing plan pairs old artifacts with the plan that
                // actually produced them — the pairing the old refusal guarded. Rebuilding from
                // the current pool is explicit: delete the 21-plan outputs and the descendants.
                console.error(
                    `plan: pool changed after authoring — keeping the existing plan and its ${descendants.length} downstream artifact(s) (delete 21-plan/${runDate}_03_plan_*.* and the descendants to rebuild)`,
                );
                return;
            }
            console.log(`plan cache stale: ${target}`);
        }
        kk(
            ['executor', 'run', 'episode-plan-gen', '--in', blended, '--out', planContent, ...pluginsArgs(pluginsPath)],
            {
                env: {
                    EPISODE_PLAN_MAX_ITEMS: planMaxItems,
                    EPISODE_PLAN_PER_SOURCE_CAP: perSourceCap,
                    EPISODE_PLAN_DATE: runDate,
                },
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
    // WX-03 (verified 2026-11-11): 《标识办法》第十条 + 微信 2025-08-31 公告 make the AI-generation
    // declaration a publish-time metadata duty, and 创作来源 is that declaration entry. The stance
    // label (`个人观点，仅供参考`, the 2026-10-10 choice) declares nothing about AI generation, so the
    // variants safety gate blocked every daily run (2026-11-19). The article is AI-drafted and the
    // audio is AI-synthesized; declare it. The field is single-select — one label per draft.
    claimSource: '内容由AI生成',
    coverSource: 'library',
} as const;

/** A concise key-point bullet injected into the top-of-article `## 今日要点` summary for 公众号. */
export interface WechatKeyPoint {
    label: string;
    text: string;
}

function stripLeadingH1Heading(body: string): string {
    return body.replace(/^\s*# +[^\n]+\n+/, '');
}

function wechatKeyPointLabel(title: string): string {
    const clean = title.replace(/^#+\s+/, '').trim();
    const firstClause = clean.split(/[：:，,。！？!?\-—|]/)[0]?.trim() ?? clean;
    const chars = Array.from(firstClause);
    if (chars.length > 0 && chars.length <= 28) return firstClause;
    return Array.from(clean).slice(0, 28).join('');
}

function extractWechatKeyPoints(
    planItems: ReadonlyArray<{ title: string; brief?: string }>,
    articleBody: string,
): WechatKeyPoint[] {
    const out: WechatKeyPoint[] = [];
    for (const item of planItems.slice(0, 5)) {
        const text = (item.brief ?? item.title).replace(/\s+/g, ' ').trim();
        const label = wechatKeyPointLabel(item.title);
        if (label !== '' && text !== '') out.push({ label, text });
    }
    if (out.length > 0) return out;
    const sections = stripLeadingH1Heading(articleBody).split(/\n(?=##\s+)/);
    for (const section of sections) {
        const match = section.match(/^##\s+(.+)\n+([\s\S]+)$/);
        if (!match?.[1] || !match[2]) continue;
        const firstPara = match[2]
            .split(/\n{2,}/)
            .map((p) => p.replace(/\s+/g, ' ').trim())
            .find((p) => p !== '' && !p.startsWith('#') && !p.startsWith('-'));
        if (!firstPara) continue;
        const firstSentence = (splitSentences(firstPara, { cjkOnly: true })[0] ?? firstPara).trim();
        const label = wechatKeyPointLabel(match[1]);
        if (label !== '' && firstSentence !== '') out.push({ label, text: firstSentence });
        if (out.length >= 5) break;
    }
    return out;
}

function cleanWechatDigest(body: string, keyPoints?: readonly WechatKeyPoint[]): string {
    const stripMd = (s: string): string =>
        s
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
    const paragraphs = stripLeadingH1Heading(body)
        .split(/\n{2,}/)
        .map((p) => stripMd(p))
        .filter((p) => p !== '' && !p.startsWith('今日要点') && !p.startsWith('- '));
    const candidate =
        paragraphs[0] ??
        (keyPoints ?? [])
            .slice(0, 2)
            .map((kp) => `${kp.label}：${kp.text}`)
            .join(' ');
    if (candidate === '') return '';
    return Array.from(candidate).slice(0, 120).join('');
}

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
        keyPoints?: readonly WechatKeyPoint[];
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
        // 2026-11-22 live check: 咸话咸说 is not yet authorized in 赞赏账户小程序 -> 可收款公众号,
        // so reward stays false until the operator authorizes it there.
        reward: false,
        author: WECHAT_BRAND.author,
        collection: options.collection,
        // 创作来源 is the platform's AI-declaration entry (WX-03); the label declares AI generation.
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
    const rawBody = typeof article.body === 'string' ? article.body : '';
    const existingMeta = metadataOf(article);
    if (options.appendOutro === false) {
        return {
            ...article,
            body: rawBody,
            metadata: {
                ...existingMeta,
                ...(options.audioPath === undefined ? {} : { audio: options.audioPath }),
                publishStatus: options.publishStatus,
                wechatmp,
            },
        };
    }
    let formattedBody = stripLeadingH1Heading(rawBody).trimStart();
    const keyPoints = (options.keyPoints ?? []).filter((kp) => kp.label.trim() !== '' && kp.text.trim() !== '');
    if (keyPoints.length > 0 && !/今日要点/.test(formattedBody.slice(0, 200))) {
        const bullets = keyPoints.map((kp) => `- ${kp.label.trim()}`).join('\n');
        const introMatch = formattedBody.match(/^([^\n]*咸话咸说[^\n]*)\n+/);
        if (introMatch?.[1]) {
            const rest = formattedBody.slice(introMatch[0].length).trimStart();
            formattedBody = `${introMatch[1].trimEnd()}今日要点如下：\n${bullets}\n\n下面请听详细内容。\n\n${rest}`;
        } else {
            formattedBody = `今日要点如下：\n${bullets}\n\n下面请听详细内容。\n\n${formattedBody}`;
        }
    }
    const existingDigest = typeof existingMeta.digest === 'string' ? existingMeta.digest.trim() : '';
    const derivedDigest = existingDigest !== '' ? existingDigest : cleanWechatDigest(rawBody, keyPoints);
    return {
        ...article,
        body: `${formattedBody}${WECHAT_OUTRO}`,
        metadata: {
            ...existingMeta,
            ...(derivedDigest !== '' ? { digest: derivedDigest } : {}),
            // wechatmp-pub's 播客 operation resolves the episode mp3 through the generic media key
            // `metadata.audio` (`modes.ts` resolveMediaPath), while the 文章 audio-embed rail keeps
            // reading `wechatmp.audioPath` — carry both spellings so one variant serves both rows.
            ...(options.audioPath === undefined ? {} : { audio: options.audioPath }),
            publishStatus: options.publishStatus,
            wechatmp,
        },
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
 *
 * surfdash-pub's `post` operation refuses a digest post without `metadata.coverImage`
 * (surfdash-pub/src/index.ts), so the run's cover rides along exactly as the episode/wechat
 * builders stamp it. voice2's prepare mode never exercised this gate; the frozen-bundle matrix
 * send surfaced it on 2026-11-05 (empty run → 'digest post has no cover image').
 *
 * 0409: `metadata.surfdash.locales` carries the en/ja translations the localize step wrote, so the
 * frozen variant — and therefore the safety review and the freeze digest — covers them. They are
 * read from the files at variant-build time so the variant is the single source the publisher reads.
 */
export function buildSurfdashContent(
    article: Record<string, unknown>,
    _links: PublishLinks,
    options: { coverPath?: string; locales?: Partial<Record<'en' | 'ja', { title: string; body: string }>> } = {},
): Record<string, unknown> {
    return {
        ...article,
        metadata: {
            ...metadataOf(article),
            ...(options.coverPath === undefined ? {} : { coverImage: options.coverPath }),
            ...(options.locales === undefined ? {} : { surfdash: { locales: options.locales } }),
        },
    };
}

/**
 * Reads `${workDir}/22-article/locales/{en,ja}.md` (first line `# <title>`, rest the body) into the
 * payload shape `surfdash-pub` consumes. A locale whose file is missing or untitled is simply
 * absent — `news-localize-validate` is the gate that refuses it, and the publisher refuses a digest
 * payload that lacks one, so silent partial data never reaches a live publish.
 */
function readArticleLocales(workDir: string): Partial<Record<'en' | 'ja', { title: string; body: string }>> {
    const locales: Partial<Record<'en' | 'ja', { title: string; body: string }>> = {};
    for (const locale of ['en', 'ja'] as const) {
        const file = join(workDir, '22-article', 'locales', `${locale}.md`);
        if (!isFile(file)) continue;
        const [firstLine = '', ...rest] = readFileSync(file, 'utf-8').split('\n');
        const title = firstLine.startsWith('# ') ? firstLine.slice(2).trim() : '';
        const body = rest.join('\n').trim();
        if (title === '' || body === '') continue;
        locales[locale] = { title, body };
    }
    return locales;
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
export function weightedLength(text: string): number {
    let total = 0;
    for (const char of text) total += weightedCharWeight(char);
    return total;
}

/** Platforms where attaching a native image suppresses the URL's clickable Open Graph preview card. */
const OG_CARD_PLATFORMS = new Set(['x', 'threads', 'linkedin', 'weibo']);

/**
 * One channel's short promo copy as a Content (task 0327 R3; task 0410 episode promo framing):
 * prepends the frozen episode title and appends the episode listen URL (`{{podcast_url}}`) when
 * supplied, reserving header/footer budget before truncating copy (X counts URLs at t.co weight 23).
 *
 * Platforms in `OG_CARD_PLATFORMS` (`x`, `threads`, `linkedin`, `weibo`) omit `coverImage` when linking a
 * podcast URL so their native Open Graph card renders cleanly instead of being suppressed by an
 * attached image; image-first rails (`jike`) keep `coverImage`.
 */
export function buildSocialContent(
    copy: string,
    options: {
        platform: string;
        limit: SocialLimit;
        coverPath?: string;
        cardPath?: string;
        episodeTitle?: string;
        listenUrl?: string;
    },
): Record<string, unknown> {
    const trimmed = copy.trim();
    const episodeTitle = options.episodeTitle?.trim() ?? '';
    const listenUrl = options.listenUrl?.trim() ?? '';
    const header = episodeTitle !== '' && !trimmed.startsWith(episodeTitle) ? `${episodeTitle}\n\n` : '';
    const footer =
        listenUrl !== '' && !trimmed.includes(listenUrl)
            ? options.platform === 'x'
                ? `\n\n🎧 ${listenUrl}`
                : `\n\n🎧 完整节目：${listenUrl}`
            : '';

    const measure = (text: string): number => {
        if (options.limit.weighted === true) {
            // X counts URLs via t.co (23 units); reserve 23 for placeholders and full URLs alike.
            const normalized = text.replace(/(?:https?:\/\/\S+|\{\{(?:podcast|article)_url\}\})/g, 'x'.repeat(23));
            return weightedLength(normalized);
        }
        return text.replace(/\{\{(?:podcast|article)_url\}\}/g, 'x'.repeat(60)).length;
    };

    const fullMeasure = measure(`${header}${trimmed}${footer}`);
    let keptCopy = trimmed;
    if (fullMeasure > options.limit.max) {
        const copyBudget = Math.max(0, options.limit.max - measure(header) - measure(footer));
        let kept = '';
        let used = 0;
        for (const char of trimmed) {
            const weight = options.limit.weighted === true ? weightedCharWeight(char) : 1;
            if (used + weight > copyBudget) break;
            kept += char;
            used += weight;
        }
        keptCopy = kept;
    }

    const body = `${header}${keptCopy}${footer}`;
    const attachCover = !(listenUrl !== '' && OG_CARD_PLATFORMS.has(options.platform));
    const attachedImage = attachCover ? (options.cardPath ?? options.coverPath) : undefined;
    return {
        title: episodeTitle !== '' ? episodeTitle : `${options.platform} · 每日AI乱炖`,
        format: 'text',
        body,
        metadata: {
            platform: options.platform,
            ...(keptCopy === trimmed
                ? {}
                : {
                      truncatedFrom: fullMeasure,
                      truncatedUnit: options.limit.weighted === true ? 'weighted' : 'code_units',
                  }),
            ...(attachedImage === undefined ? {} : { coverImage: attachedImage }),
        },
    };
}

/**
 * Length budgets the social authoring prompt targets, enforced here as a backstop (task 0327 R3).
 * X counts CJK at 2 (`weighted`); weibo, threads and linkedin count characters.
 */
const SOCIAL_LIMITS: Record<string, SocialLimit> = {
    x: { max: 280, weighted: true },
    weibo: { max: 2000 },
    threads: { max: 500 },
    // 即刻's 动态 composer accepts long text; the shared short notice fits far below this.
    jike: { max: 2000 },
    linkedin: { max: 3000 },
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
function cardsForPodcast(
    workDir: string,
    cardsEnabled: boolean,
): Array<{ index: string; copy: string; status?: string; imagePath?: string }> {
    if (!cardsEnabled) return [];
    const parsed = readJson(join(workDir, '25-xhs', 'cards.json'));
    const rawCards = (parsed as { cards?: unknown } | null)?.cards;
    if (!Array.isArray(rawCards)) return [];
    const out: Array<{ index: string; copy: string; status?: string; imagePath?: string }> = [];
    for (const entry of rawCards) {
        if (entry === null || typeof entry !== 'object') continue;
        const card = entry as Record<string, unknown>;
        const index = typeof card.index === 'string' ? card.index.trim() : String(card.index ?? '').trim();
        const copy = typeof card.copy === 'string' ? card.copy.trim() : '';
        if (index === '' || copy === '') continue;
        const status = typeof card.status === 'string' ? card.status.trim() : undefined;
        const rawPath = typeof card.imagePath === 'string' ? card.imagePath.trim() : '';
        const resolvedImg = rawPath !== '' ? (rawPath.startsWith('/') ? rawPath : resolve(workDir, rawPath)) : '';
        const validImg = resolvedImg !== '' && isFile(resolvedImg) ? resolvedImg : undefined;
        out.push({
            index,
            copy,
            ...(status === undefined ? {} : { status }),
            ...(validImg === undefined ? {} : { imagePath: validImg }),
        });
    }
    return out;
}

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
        const socialCoverPath = join(workDir, '23-cover', `${runDate}_07_cover_social.jpg`);
        const socialDir = join(workDir, '26-social');
        const cover = coverEnabledArg !== 'false' && isFile(coverPath) ? resolve(coverPath) : undefined;
        const socialCover =
            coverEnabledArg !== 'false' && isFile(socialCoverPath) ? resolve(socialCoverPath) : undefined;
        const links = PLACEHOLDER_LINKS;
        const written: string[] = [];
        const skipped: string[] = [];

        const article = readJson(articlePath);
        const prep = readJson(prepPath);
        const planItems = planItemsForPodcast(workDir, runDate);
        const write = (key: string, content: Record<string, unknown>): void => {
            const file = join(outDir, variantFileName(key));
            sted('write', file, () => writeJsonText(file, content));
            written.push(key);
        };

        // Generic variants first: a channel-specific variant wins over the shared one, so the
        // shared copy must exist for the channels the preset does not specialise.
        const firstArticleLine =
            article !== null && typeof (article as Record<string, unknown>).title === 'string'
                ? String((article as Record<string, unknown>).title)
                : '';
        if (article === null) skipped.push('article (no 22-article content)');
        else {
            // 0409: the frozen variant carries the en/ja translations, so the safety review and the
            // freeze digest cover them and the publisher writes what was reviewed.
            const articleLocales = readArticleLocales(workDir);
            const articleOptions = {
                coverPath: cover,
                ...(Object.keys(articleLocales).length > 0 ? { locales: articleLocales } : {}),
            };
            write('article', buildSurfdashContent(article, links, articleOptions));
            write('article@surfdash-pub', buildSurfdashContent(article, links, articleOptions));
            write('article@xhs-pub', buildXhsArticleContent(article, { publishStatus: 'draft' }));
            // The article carries the episode audio at the top (operator request 2026-11-15): the
            // 公众号 播客 row is off, so without this the MP draft had no player at all. Same source
            // as the episode variant — `publish-prep`'s rendered mp3 — so one episode has one audio.
            const articleAudio =
                prep !== null && typeof metadataOf(prep).audioFile === 'string'
                    ? String(metadataOf(prep).audioFile)
                    : undefined;
            const rawArticleBody =
                typeof (article as Record<string, unknown>).body === 'string'
                    ? String((article as Record<string, unknown>).body)
                    : '';
            const wechatKeyPoints = extractWechatKeyPoints(planItems, rawArticleBody);
            write(
                'article@wechatmp-pub',
                buildWechatArticleContent(article, {
                    links,
                    publishStatus: 'draft',
                    collection: '每日AI资讯',
                    keyPoints: wechatKeyPoints,
                    ...(cover === undefined ? {} : { coverPath: cover }),
                    ...(articleAudio === undefined ? {} : { audioPath: articleAudio, audioTitle: firstArticleLine }),
                }),
            );
        }

        if (prep === null) skipped.push('episode (no publish-prep content)');
        else {
            const showNotes = isFile(notesPath) ? readFileSync(notesPath, 'utf-8') : '';
            const podcastCards = cardsForPodcast(workDir, cardsEnabledArg !== 'false');
            const podcastMeta: Record<string, unknown> = {
                ...(planItems.length > 0 ? { planItems } : {}),
                ...(podcastCards.length > 0 ? { cards: podcastCards } : {}),
                ...(socialCover === undefined ? {} : { socialImage: socialCover, socialImageEnabled: true }),
            };
            const podcastOpts =
                Object.keys(podcastMeta).length > 0 ? { showNotes, podcast: podcastMeta } : { showNotes };
            write('episode', buildPodcastContent(prep, podcastOpts));
            write('episode@podcast-pub', buildPodcastContent(prep, podcastOpts));
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

        const cards = cardsEnabledArg !== 'false' ? readJson(cardsPath) : null;
        let cardImage: string | undefined;
        if (cards !== null && Array.isArray((cards.metadata as Record<string, unknown> | undefined)?.images)) {
            const rawImages = (cards.metadata as Record<string, unknown>).images as Array<{ path?: string }>;
            if (rawImages.length > 0 && typeof rawImages[0]?.path === 'string' && isFile(rawImages[0].path)) {
                cardImage = resolve(rawImages[0].path);
            }
        }

        if (cardsEnabledArg === 'false') skipped.push('cards (cards_enabled=false)');
        else {
            if (cards === null) skipped.push('cards (no rendered card series)');
            else {
                write('cards', buildXhsCardsContent(cards, { publishStatus: 'draft' }));
                write('cards@xhs-pub', buildXhsCardsContent(cards, { publishStatus: 'draft' }));
            }
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
                    ...(cardImage === undefined ? {} : { cardPath: cardImage }),
                    ...(firstArticleLine !== '' ? { episodeTitle: firstArticleLine } : {}),
                    ...(prep !== null ? { listenUrl: links.podcastUrl } : {}),
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
            // The block indicator is YAML syntax, not text: the item starts on the next line.
            if (folded) current = '';
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

/**
 * 0396 R2 — the other channels' dispatch rows, shaped for podcast-pub's delivery classifier.
 *
 * Read from the 0388 ledger (the authority on what was dispatched for this frozen date). Capability
 * is deliberately NOT asserted: an unknown content surface must surface as `unsupported` with its
 * documented reason rather than a delivery nobody verified.
 */
export function correctionTargetRows(ledgerPath: string): Array<Record<string, unknown>> {
    const ledger = readJson(ledgerPath);
    const entries =
        ledger !== null && Array.isArray((ledger as { entries?: unknown }).entries)
            ? ((ledger as { entries: unknown[] }).entries as Array<Record<string, unknown>>)
            : [];
    const rows: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
        // The 0388 ledger keys a row by `id` (`plugin[@operation]`) with `plugin` beside it — NOT by a
        // `target` field. Reading a non-existent field silently produced zero rows and made this whole
        // seam inert (0396 review), so the id is the identity here and `plugin` is the fallback.
        // The self row is identified by PLUGIN, not by id: the writer keys an entry as
        // `plugin.operation` (`podcast-pub.episode`), so comparing the id let the podcast's own row
        // through and the operator saw a "not delivered to podcast-pub.episode" warning for the target
        // that actually received it (0396 review).
        const plugin = typeof entry?.plugin === 'string' ? entry.plugin.trim() : '';
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        const target = id !== '' ? id : plugin;
        if (plugin === 'podcast-pub' || target === '' || target === 'podcast-pub') continue;
        const blockedBy = Array.isArray(entry.blockedBy) ? entry.blockedBy.filter((id) => typeof id === 'string') : [];
        rows.push({
            target,
            ...(typeof entry.state === 'string' ? { state: entry.state } : {}),
            ...(typeof entry.mode === 'string' ? { mode: entry.mode } : {}),
            ...(typeof entry.manualStep === 'string' ? { manualStep: entry.manualStep } : {}),
            ...(typeof entry.lastError === 'string' ? { lastError: entry.lastError } : {}),
            ...(blockedBy.length > 0 ? { blockedBy } : {}),
        });
    }
    return rows;
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
            // 0396 R2: the plugin records a delivery per TARGET, so the dispatch state of the other
            // channels has to reach it. The prep file's top-level `options` IS the channel the plugin
            // documents, and the 0388 ledger is the authority on those rows — no capability is
            // asserted here, so an unknown surface comes back as `unsupported` with its exact reason
            // instead of a claimed delivery.
            const siblingTargets = correctionTargetRows(join(workDir, '4-publish', 'dispatch-ledger.json'));
            if (siblingTargets.length > 0) {
                merged.options = {
                    ...((merged.options as Record<string, unknown>) ?? {}),
                    correctionTargets: siblingTargets,
                };
            }
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
                    // 0396 R1: the publish dispatch is where a correction's delivery is REAL, so the
                    // frozen snapshot rides with it too. Without this the per-target delivery record
                    // could never be written by a production run (only the show-notes render saw the
                    // snapshot). `kk executor fan-out` exposes no options channel, so the env is the
                    // seam the plugin already documents.
                    env: {
                        ...(isFile(join(workDir, '21-plan', `${runDate}_judgment-snapshot.json`))
                            ? {
                                  PODCAST_PUB_CORRECTIONS: join(
                                      workDir,
                                      '21-plan',
                                      `${runDate}_judgment-snapshot.json`,
                                  ),
                              }
                            : {}),
                    },
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
        // 0385 R4: the last seam before anything is dispatched is also the seam that proves the whole
        // run shares ONE episode identity. It is read from the bundle's metadata first (a retry or a
        // historical replay republishes the identity the episode already shipped), then from the slot
        // `editorial-render` froze; a bundle that carries neither keeps the title it already has.
        const identity =
            identityFromMetadata(metadataOf(article)) ??
            identityFromMetadata({
                [EPISODE_IDENTITY_KEY]: readJson(join(workDir, '21-plan', `${runDate}_05_script_identity.json`)),
            });
        if (identity !== null && identity.status === 'support-removed') {
            // The withhold path of R4: never publish a headline admission no longer backs, and never
            // silently publish the legacy title in its place — a human has to regenerate the point.
            failWith(
                1,
                `publish-prep: episode title withheld — admission dropped the headline's supporting source(s) (${identity.supportingSourceIds.join(', ')}); regenerate the headline from an admitted story before publishing`,
            );
        }
        const episodeTitle = identity?.title ?? (typeof article.title === 'string' ? article.title : '');
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
        stampId3Tags(audioFile, episodeTitle, runDate, artist, album);
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
            // Every publish target (podcast, ID3, show notes, surfdash) reads this one title.
            title: episodeTitle,
            metadata: {
                ...metadataOf(article),
                audioFile,
                runDate,
                ...(identity !== null
                    ? {
                          [EPISODE_IDENTITY_KEY]: identity,
                          ...(identity.coverHeadline !== null ? { coverHeadline: identity.coverHeadline } : {}),
                      }
                    : {}),
                ...(hasCover ? { coverImage: resolvedCover } : {}),
                ...(episode > 0 ? { itunes: { season, episode } } : {}),
                ...(typeof audioMeta.duration === 'number' &&
                Number.isFinite(audioMeta.duration) &&
                audioMeta.duration > 0
                    ? { durationSeconds: audioMeta.duration }
                    : {}),
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
    const [workDir = '', runDate = '', maxReviseArg = '0', scopeDir = ''] = args;
    const drafts = isDraftsScope(scopeDir);
    const maxRevise = Number.parseInt(maxReviseArg, 10);
    const statusFile = scopeArtifact(workDir, scopeDir, runDate, 'safety-judge_status.txt');
    const stampFile = scopeArtifact(workDir, scopeDir, runDate, 'safety-judge_stamp.json');
    timed(workDir, 'safety-judge', () => {
        const request = readJson(scopeArtifact(workDir, scopeDir, runDate, 'safety-review_request.json'));
        const report = readJson(scopeArtifact(workDir, scopeDir, runDate, 'safety-review_report.json'));
        const verdict = readJson(scopeArtifact(workDir, scopeDir, runDate, 'safety-judge_verdict.json'));
        const platforms = Array.isArray(report?.platforms) ? (report.platforms as Record<string, unknown>[]) : [];
        const decisions = platforms.map((platform) => platform?.decision);
        const digest = scopeDigest(workDir, scopeDir, runDate);
        const revisions = readScopeCounter(workDir, scopeDir);
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
        // 20261104: a category-3 `note` is the reviewer recording that it checked and found NO PII —
        // counting it turned an admission-only BLOCK into a whole-run block. Any other disposition,
        // or none (legacy reports), still counts: fail-closed.
        const isPiiFinding = (finding: Record<string, unknown>): boolean =>
            Number(finding?.category) === PII_FINDING_CATEGORY && finding?.disposition !== 'note';
        const piiBlock = blockedPlatforms.some((platform) => platformFindings(platform).some(isPiiFinding));
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
                    .filter(isPiiFinding)
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
        // 0347 F4 (2026-11-10): an executor outage must not masquerade as a content verdict. When
        // the final classification is block AND the evidence the gate grades is missing entirely
        // (request/report/verdict never appeared because a reviewer or judge agent died), record an
        // infra marker the `judge -> infra-fail` transition reads; `block` stays reserved for real
        // content verdicts. The caller contract is unchanged — both terminals are failureStates, so
        // "non-zero = never publish" holds; infra-fail only makes the death retryable-by-machine and
        // legible to daily-triage.
        const infraMarker = scopeArtifact(workDir, scopeDir, runDate, 'safety-infra.json');
        const infraMissing = [
            ...(request === null ? ['review-request'] : []),
            ...(report === null ? ['review-report'] : []),
            ...(verdict === null ? ['judge-verdict'] : []),
        ];
        if (status === 'block' && drafts && !edited && infraMissing.length === 0) {
            // A quality block poisons the isFile() draft cache: every same-day retry would
            // re-fail on unchanged bytes (20261002 dogfood — two judge-fail runs replayed until
            // the drafts were moved by hand). Quarantine (mv, never rm) so the next run
            // regenerates from scratch; the 09_* verdict artifacts stay in 24-script for audit.
            // Variants scope never quarantines: the bundle is regenerated, not hand-repaired.
            const q = join(workDir, '24-script', `.quarantine-${runDate}-judge-block`);
            mkdirSync(q, { recursive: true });
            for (const path of safetyDraftPaths(workDir, runDate)) {
                if (!isFile(path)) continue;
                let dest = join(q, basename(path));
                for (let n = 2; isFile(dest); n += 1) dest = join(q, `${n}-${basename(path)}`);
                renameSync(path, dest);
            }
        }
        if (status === 'pass' || status === 'escalate' || status === 'exclude') {
            sted('write', stampFile, () => writeJsonText(stampFile, { digest, status, excludedPlatforms }));
        }
        if (status === 'block' && infraMissing.length > 0) {
            sted('write', infraMarker, () =>
                writeJsonText(infraMarker, {
                    infra: true,
                    missing: infraMissing,
                    reason,
                    classifiedAt: new Date().toISOString(),
                }),
            );
            console.error(
                `safety: infra — refusal is due to missing evidence (${infraMissing.join(', ')}), not a content verdict`,
            );
        } else if (isFile(infraMarker)) {
            unlinkSync(infraMarker);
        }
        sted('write', statusFile, () => writeRaw(statusFile, status));
        // Task 0392 R2: the channel-admission decisions this run actually reached, keyed by target
        // and scope. A channel outcome is not a candidate drop — it never touches the totals.
        // Unobserved (no platforms array) leaves the stage unknown instead of claiming zero blocks.
        if (platforms.length > 0) {
            recordSelectionStage(workDir, runDate, {
                channelAdmission: [
                    {
                        scope: scopeDir === '' ? 'drafts' : scopeDir,
                        targets: platforms.map((platform) => ({
                            target: String(platform?.platform ?? ''),
                            decision: String(platform?.decision ?? ''),
                        })),
                        status,
                    },
                ],
            });
        }
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
            'publish-matrix-validate',
            'publish-matrix-settle',
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
 * accept guard used to re-parse in shell: a JUDGED `escalate` now needs a human (the accept guard
 * refuses it for an unattended run), while an ABSTAINED row (`source: "default"` — the maker failed
 * and nothing was judged) is named on stderr and leaves the gate's own verdict in charge.
 *
 * Writes `24-script/<date>_09_safety-verdict.status` = `accept`, or `refuse` after naming the
 * offending value on stderr. Never exits non-zero: routing belongs to the transitions.
 */
export function dailySafetyVerdict(args: string[]): void {
    const [workDir = '', runDate = '', scopeDir = ''] = args;
    const drafts = isDraftsScope(scopeDir);
    const statusFile = scopeArtifact(workDir, scopeDir, runDate, 'safety-judge_status.txt');
    const stampFile = scopeArtifact(workDir, scopeDir, runDate, 'safety-judge_stamp.json');
    const decisionFile = scopeArtifact(workDir, scopeDir, runDate, 'safety-verdict.decision');
    const token = scopeArtifact(workDir, scopeDir, runDate, 'safety-verdict.status');
    const ADMITTED = new Set(['pass', 'escalate', 'exclude']);
    timed(workDir, 'safety-verdict-check', () => {
        const status = isFile(statusFile) ? readFileSync(statusFile, 'utf-8').trim() : '';
        const stamp = isFile(stampFile) ? statSync(stampFile).size : 0;
        // A missing/unreadable decision row is a refusal, never an approval: `onError: continue` on
        // the decide action is what can leave it absent.
        let verdict = '';
        // A maker that cannot answer does not silently vanish: it lands on the catalog fallback with
        // `source: "default"`, so name the abstention where the run report and triage can see it.
        // (2026-11-20: fm-local refuses safety-report text, so this is the caveat, not an edge case.)
        let abstention = '';
        if (isFile(decisionFile)) {
            const row = JSON.parse(readFileSync(decisionFile, 'utf-8')) as {
                value?: unknown;
                source?: unknown;
                degraded?: unknown;
                backend?: unknown;
                reason?: unknown;
            };
            verdict = String(row.value ?? '');
            if (row.source === 'default' || row.degraded === true) {
                abstention = `kk-daily-safety.judge.decision-abstained: kk-safety-verdict fell back to [${verdict}] (${String(row.backend ?? 'maker')}: ${String(row.reason ?? 'unknown')}) — nothing was judged, so the gate's [${status}] verdict stands alone`;
            }
        }
        let refusal = '';
        if (!ADMITTED.has(status)) {
            refusal = `kk-daily-safety.judge.verdict-refused: gate status [${status}] is not an admitted outcome, so these drafts must not publish`;
        } else if (stamp === 0) {
            refusal = `kk-daily-safety.judge.verdict-refused: gate stamp missing for status ${status}, so these drafts must not publish`;
        } else if (!ADMITTED.has(verdict)) {
            refusal = `kk-daily-safety.judge.decision-refused: kk-safety-verdict [${verdict}] must admit pass|escalate|exclude, so these drafts must not publish`;
        }
        // 0331 variants scope: an admitted outcome also writes the evidence the publish matrix
        // freezes into the bundle — status, the exclusion record and the sha256 of every reviewed
        // variant's CURRENT bytes. Recomputed here (not copied from the stamp) so bytes edited
        // after the gate's verdict are caught at the last instant; a mismatch is a refusal, never
        // silently re-bound evidence.
        let evidence: Record<string, unknown> | null = null;
        if (refusal === '' && !drafts) {
            const stampJson = readJson(stampFile) as {
                digest?: unknown;
                status?: unknown;
                excludedPlatforms?: unknown;
            } | null;
            const manifest = readManifest(workDir);
            const hash = createHash('sha256');
            const variants: Record<string, string> = {};
            for (const key of Object.keys(manifest.variants).sort()) {
                const path = join(workDir, manifest.variants[key].path);
                if (!isFile(path)) {
                    refusal = `kk-daily-safety.judge.verdict-refused: registered variant file is missing: ${path} — re-run the review on a fresh manifest`;
                    break;
                }
                const sha = createHash('sha256').update(readFileSync(path)).digest('hex');
                variants[key] = sha;
                hash.update(key).update('\0').update(readFileSync(path)).update('\0');
            }
            const digest = hash.digest('hex');
            if (refusal === '' && stampJson?.digest !== digest) {
                refusal = `kk-daily-safety.judge.verdict-refused: variant bytes changed after the review (reviewed ${String(stampJson?.digest ?? 'missing')}, on disk ${digest}) — re-run the variants safety review`;
            }
            if (refusal === '') {
                evidence = {
                    status: stampJson?.status,
                    digest,
                    excludedPlatforms: Array.isArray(stampJson?.excludedPlatforms) ? stampJson.excludedPlatforms : [],
                    variants,
                };
            }
        }
        if (refusal !== '') console.error(refusal);
        else if (abstention !== '') console.error(abstention);
        sted('write', token, () => writeRaw(token, refusal === '' ? 'accept' : 'refuse'));
        if (evidence !== null) {
            const evidencePath = join(scopeDirOf(workDir, scopeDir), 'safety.json');
            sted('write', evidencePath, () => writeJsonText(evidencePath, evidence));
            console.log(`safety-verdict: evidence written to ${evidencePath}`);
        }
    });
}

/**
 * Post-remediation bookkeeping for the `safety-revise` state: the agent edited the drafts, this
 * stage checks they are still the artifacts the rest of the pipeline consumes and spends one unit
 * of the remediation budget (`daily-safety-gate` reads it to choose revise-vs-exclude). Validating
 * here fails inside the loop instead of at `wrap-docs`, after the run has moved on. A broken
 * revision spends the budget too: an unparsable draft must not be retried forever.
 */
// ---- 0331 scope machinery -------------------------------------------------
// The nested kk-daily-safety machine serves two review surfaces: the classic drafts scope
// (article + VoiceScript under 24-script) and the variants scope (final publish variants under
// 30-variants, registered by daily-safety-manifest, artifacts under 4-safety-variants). The scope
// is ONE trailing `scope_dir` argument: `24-script` (or empty) keeps every path byte-identical to
// the pre-0331 behavior, any other value re-roots the artifact set and switches the digest to the
// manifest-listed variant bytes.

export const SAFETY_VARIANTS_DIR = '4-safety-variants';

function isDraftsScope(scopeDir: string): boolean {
    const dir = scopeDir.trim();
    return dir === '' || dir === '24-script';
}

function scopeDirOf(workDir: string, scopeDir: string): string {
    return isDraftsScope(scopeDir) ? join(workDir, '24-script') : join(workDir, scopeDir.trim());
}

function scopeArtifact(workDir: string, scopeDir: string, runDate: string, name: string): string {
    return join(scopeDirOf(workDir, scopeDir), `${runDate}_09_${name}`);
}

/** The remediation budget is per scope: a variants review never inherits the drafts pass count. */
function scopeCounter(workDir: string, scopeDir: string): string {
    return isDraftsScope(scopeDir)
        ? join(workDir, SAFETY_REVISE_COUNT)
        : join(workDir, `${SAFETY_REVISE_COUNT}-${scopeDir.trim().replace(/[^\w-]/g, '_')}`);
}

function readScopeCounter(workDir: string, scopeDir: string): number {
    const path = scopeCounter(workDir, scopeDir);
    if (!isFile(path)) return 0;
    const value = Number.parseInt(readFileSync(path, 'utf-8'), 10);
    return Number.isNaN(value) ? 0 : value;
}

interface SafetyManifest {
    schemaVersion: number;
    runDate: string;
    variants: Record<string, { path: string; sha256: string }>;
}

function readManifest(workDir: string): SafetyManifest {
    const path = join(workDir, SAFETY_VARIANTS_DIR, 'manifest.json');
    const manifest = readJson(path) as SafetyManifest | null;
    if (manifest === null || !manifest.variants || typeof manifest.variants !== 'object') {
        failWith(
            1,
            `safety-variants: ${path} is missing or malformed — run "kk stage run daily-safety-manifest <work_dir> <run_date>" first`,
        );
    }
    return manifest;
}

/** Digest over the exact bytes under review: drafts = safetyDigest; variants = sorted manifest keys + current bytes. */
function scopeDigest(workDir: string, scopeDir: string, runDate: string): string {
    if (isDraftsScope(scopeDir)) return safetyDigest(workDir, runDate);
    const manifest = readManifest(workDir);
    const hash = createHash('sha256');
    for (const key of Object.keys(manifest.variants).sort()) {
        const path = join(workDir, manifest.variants[key].path);
        if (!isFile(path)) {
            failWith(
                1,
                `safety-variants: registered variant file is missing: ${path} — re-run daily-bundle-variants and the manifest`,
            );
        }
        hash.update(key).update('\0').update(readFileSync(path)).update('\0');
    }
    return hash.digest('hex');
}

/** The `content` array the review request hands the agents: what to read, per scope. */
function scopeContent(workDir: string, scopeDir: string, runDate: string): unknown[] {
    if (isDraftsScope(scopeDir)) return safetyDraftPaths(workDir, runDate);
    return Object.entries(readManifest(workDir).variants)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, entry]) => ({ key, path: entry.path, sha256: entry.sha256 }));
}

/**
 * Register the run's final publish variants for the variants-scope safety review (0331): every
 * `30-variants/*.content.json` becomes one manifest entry keyed by its file name with `_` read as
 * the plugin.operation separator. The manifest is the review contract — the request digest, the
 * gate's edit check and the bundle's frozen evidence all resolve through it, so an empty or
 * missing variants directory fails here, before any reviewer spends tokens.
 */
export function dailySafetyManifest(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    timed(workDir, 'safety-manifest', () => {
        const dir = join(workDir, '30-variants');
        if (!existsSync(dir)) {
            failWith(1, `safety-manifest: ${dir} does not exist — run the bundle-variants stage first`);
        }
        const files = readdirSync(dir)
            .filter((file) => file.endsWith('.content.json'))
            .sort();
        if (files.length === 0) {
            failWith(1, `safety-manifest: no *.content.json under ${dir} — nothing to review; was the bundle built?`);
        }
        const variants: Record<string, { path: string; sha256: string }> = {};
        for (const file of files) {
            const text = readFileSync(join(dir, file), 'utf-8');
            variants[file.replace(/\.content\.json$/, '').replace(/_/g, ':')] = {
                path: `30-variants/${file}`,
                sha256: createHash('sha256').update(text).digest('hex'),
            };
        }
        mkdirSync(join(workDir, SAFETY_VARIANTS_DIR), { recursive: true });
        const manifestPath = join(workDir, SAFETY_VARIANTS_DIR, 'manifest.json');
        sted('write', manifestPath, () => writeJsonText(manifestPath, { schemaVersion: 1, runDate, variants }));
        console.log(`safety-manifest: ${files.length} variant(s) registered for review`);
    });
}

/**
 * Open a content-safety review of the current drafts: drop every artifact of an earlier review
 * (a retry must be re-reviewed on its final version) and write the request the two agent.run
 * steps read. The program passes context only — platform policy lives in the kk:content-safety
 * skill's reference files, never here. 0331: an optional trailing scope_dir re-roots the whole
 * artifact set for the variants review (see the scope machinery above).
 */
function buildSafetyDigest(
    workDir: string,
    scopeDir: string,
    runDate: string,
    targets: string[],
    digest: string,
    content: unknown[],
): string {
    const drafts = isDraftsScope(scopeDir);
    const lines: string[] = [
        `# Safety Review Digest (${runDate})`,
        '',
        `- Scope: ${drafts ? 'drafts' : 'variants'}`,
        `- Platforms: ${targets.join(', ')}`,
        `- Digest: \`${digest}\``,
        '',
    ];
    const maxCharsPerItem = 4000;
    for (const entry of content) {
        if (typeof entry === 'string') {
            if (!isFile(entry)) continue;
            const raw = readFileSync(entry, 'utf-8');
            let body = raw;
            if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
                try {
                    const parsed = Bun.YAML.parse(raw) as {
                        title?: string;
                        segments?: Array<{ text?: string; speaker?: string }>;
                    };
                    const segs = Array.isArray(parsed?.segments)
                        ? parsed.segments.map((s, idx) => `${idx + 1}. ${s.text ?? ''}`).join('\n')
                        : raw;
                    body = `${parsed?.title ? `Title: ${parsed.title}\n\n` : ''}${segs}`;
                } catch {}
            }
            const truncated = body.length > maxCharsPerItem ? `${body.slice(0, maxCharsPerItem)}\n…[truncated]` : body;
            lines.push(`## ${entry} (${raw.length} chars)`, '', truncated, '');
        } else if (entry && typeof entry === 'object') {
            const item = entry as { key?: string; path?: string };
            const rel = item.path ?? '';
            const abs = rel ? join(workDir, rel) : '';
            if (!abs || !isFile(abs)) continue;
            const raw = readFileSync(abs, 'utf-8');
            let summary = raw;
            try {
                const parsed = JSON.parse(raw) as { title?: string; body?: string; format?: string };
                const text = typeof parsed.body === 'string' ? parsed.body : raw;
                summary = `Title: ${parsed.title ?? ''}\nFormat: ${parsed.format ?? ''}\n\n${text}`;
            } catch {}
            const truncated =
                summary.length > maxCharsPerItem ? `${summary.slice(0, maxCharsPerItem)}\n…[truncated]` : summary;
            lines.push(`## ${item.key ?? rel} (${rel}, ${raw.length} chars)`, '', truncated, '');
        }
    }
    return lines.join('\n');
}

export function dailySafetyPrep(args: string[]): void {
    const [workDir = '', runDate = '', platforms = '', scopeDir = ''] = args;
    const drafts = isDraftsScope(scopeDir);
    timed(workDir, 'safety-review', () => {
        const digest = scopeDigest(workDir, scopeDir, runDate);
        if (drafts) {
            // Structural snapshot of the VoiceScript BEFORE any remediation edit. `daily-safety-revise`
            // restores it when the remediation pass changes the item-section structure without a recorded
            // exclusion: the agent is allowed to drop a 播报形态 line, not an item the article kept,
            // because `daily-wrap-docs` derives the spoken item sections from `gap_ms: 1200` and fails the
            // run when they no longer match the episode's included items (2026-10-21 04:30 run: 3
            // segments removed → 5 sections vs a 6-item plan → `generate` refused at 05:03 and the whole
            // day published nothing).
            const [, scriptPath] = safetyDraftPaths(workDir, runDate);
            const snapshot = safetyPath(workDir, runDate, 'safety-prep_script-snapshot.yaml');
            if (isFile(scriptPath))
                sted('write', snapshot, () => writeRaw(snapshot, readFileSync(scriptPath, 'utf-8')));
        } else {
            // The remediation budget belongs to this scope's attempt, not to the day. The machine
            // re-enters this state once per remediation loop, so initializing unconditionally
            // reset the budget every cycle and the loop could never classify its residue
            // (20261105 dogfood: the nested variants review revised forever). Like the drafts
            // scope, only the FIRST entry initializes.
            const counter = scopeCounter(workDir, scopeDir);
            if (!isFile(counter)) sted('write', counter, () => writeFileSync(counter, '0\n'));
        }
        for (const name of [
            'safety-review_report.json',
            'safety-review_digest.md',
            'safety-judge_verdict.json',
            'safety-judge_status.txt',
            'safety-judge_stamp.json',
            'safety-verdict.decision',
            'safety-verdict.status',
            // A previous review's evidence must never survive into a new request: the bundle
            // freezes exactly what the current request's verdict admits. Evidence is the one
            // unprefixed artifact, so the runDate-prefixed sweep would miss it.
            'safety.json',
        ]) {
            const stale =
                name === 'safety.json' && !drafts
                    ? join(scopeDirOf(workDir, scopeDir), name)
                    : scopeArtifact(workDir, scopeDir, runDate, name);
            if (isFile(stale)) unlinkSync(stale);
        }
        const request = scopeArtifact(workDir, scopeDir, runDate, 'safety-review_request.json');
        const digestFile = scopeArtifact(workDir, scopeDir, runDate, 'safety-review_digest.md');
        const targets = platforms
            .split(',')
            .map((platform) => platform.trim())
            .filter(Boolean);
        const content = scopeContent(workDir, scopeDir, runDate);
        sted('write', digestFile, () =>
            writeRaw(digestFile, buildSafetyDigest(workDir, scopeDir, runDate, targets, digest, content)),
        );
        sted('write', request, () =>
            writeJsonText(request, {
                digest,
                digestFile,
                platforms: targets,
                mode: 'detect-only',
                scope: drafts ? 'drafts' : 'variants',
                content,
            }),
        );
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
    const [workDir = '', runDate = '', scopeDir = ''] = args;
    const drafts = isDraftsScope(scopeDir);
    timed(workDir, 'safety-revise', () => {
        if (!drafts) {
            // Variants scope: every manifest-listed file must stay parseable Content with the
            // fields the publish half reads; the structural VoiceScript machinery does not apply.
            // Refresh each entry's sha256 to the post-remediation bytes: the manifest is the
            // contract the request/digest/stamp resolve through, so leaving the pre-remediation
            // digests in place made every re-review report a request-integrity mismatch and the
            // loop spin (20261105 dogfood). Structural drift above the hash level stays owned by
            // daily-bundle-variants (never run here).
            const manifestPath = join(workDir, SAFETY_VARIANTS_DIR, 'manifest.json');
            const manifest = readManifest(workDir);
            for (const [key, entry] of Object.entries(manifest.variants)) {
                const path = join(workDir, entry.path);
                const value = requireJson(path, 'safety-revise') as {
                    title?: unknown;
                    body?: unknown;
                };
                for (const field of ['title', 'body'] as const) {
                    if (typeof value[field] !== 'string' || String(value[field]).trim() === '') {
                        failWith(1, `safety-revise: variant ${path} ${field} must be a non-empty string`);
                    }
                }
                entry.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
                manifest.variants[key] = entry;
            }
            sted('write', manifestPath, () =>
                writeJsonText(manifestPath, {
                    schemaVersion: manifest.schemaVersion,
                    runDate: manifest.runDate,
                    variants: manifest.variants,
                }),
            );
            const counter = scopeCounter(workDir, scopeDir);
            const next = readScopeCounter(workDir, scopeDir) + 1;
            sted('write', counter, () => writeFileSync(counter, `${next}\n`));
            console.log(`safety-revise: remediation pass ${next} applied to manifest variants; re-validated`);
            return;
        }
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
        const next = readScopeCounter(workDir, scopeDir) + 1;
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

/**
 * Floor-gate char rate — deliberately separate from `spokenCharRate` because the two consumers
 * need opposite safe directions. The fit/ceiling budget wants the slow rate (a too-big fit renders
 * an episode the ceiling then rejects — why gemini was recalibrated to 4.95 on 2026-10-15). The
 * pre-spend script floor gate wants the opposite: a slow rate over-predicts minutes and passes a
 * thin script into the 1-2 h synthesis, which the measured gate refuses after the spend
 * (20261111 a17: 4,805-char script estimated 16.3 min at 4.95, rendered 14.2 min at a measured
 * 5.64 chars/s; band 5.33-5.88 across 20261004/07 + the 0237 live dry run). 5.6 — the band center
 * and the voicebox default — refuses a17-class days before any spend; slow-mix days near the
 * floor may be refused early, the cheaper error per the ceiling gate's own economics.
 */
function scriptFloorCharRate(vdriver: string): number {
    if (vdriver === 'gemini') return 5.6;
    return spokenCharRate(vdriver);
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
    if (vdriver === 'voxcpm' || vdriver === 'vibe-voice' || vdriver === 'vibevoice') return 5.2;
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
                DAILYNEWS_STYLE_FILE: resolve(STYLE_CONTRACT),
                DAILYNEWS_CURATE_EXCLUDED: resolve(join(workDir, '21-plan', `${runDate}_03_curate_excluded.json`)),
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
 * F613 R1 / ADR-045: snapshot the shipped kk:news-editorial skill into the run's work dir. Spur
 * workflows have no workflow-dir var and kk skills are not installed for every executor, so the
 * writer prompts read this copy by path — and the snapshot freezes the exact policy the run's plan
 * was written against. `20-editorial/news-editorial/` holds SKILL.md + references; the
 * `_08_script-write_style.md` copy of the style contract stays the run's audit record.
 * Idempotent per artifact (an existing snapshot is kept); a missing skill is a broken install.
 */
export function dailyScriptStyle(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    if (!isFile(STYLE_CONTRACT)) {
        failWith(
            1,
            `news-editorial skill not found — no ${STYLE_CONTRACT}; install or refresh the kk package (bun link in a checkout)`,
        );
    }
    const skillSnapshot = join(workDir, '20-editorial', 'news-editorial');
    if (isFile(join(skillSnapshot, 'SKILL.md'))) {
        console.log(`editorial skill cached: ${skillSnapshot}`);
    } else {
        sted('cp', skillSnapshot, () => cpSync(EDITORIAL_SKILL_DIR, skillSnapshot, { recursive: true }));
        console.log(`editorial skill snapshot: ${skillSnapshot}`);
    }
    const snapshot = join(workDir, '24-script', `${runDate}_08_script-write_style.md`);
    if (isFile(snapshot)) {
        console.log(`script style cached: ${snapshot}`);
        return;
    }
    const scriptDir = join(workDir, '24-script');
    sted('mkdir', scriptDir, () => mkdirSync(scriptDir, { recursive: true }));
    sted('cp', snapshot, () => copyFileSync(STYLE_CONTRACT, snapshot));
    console.log(`script style snapshot: ${snapshot}`);
}

/**
 * 0345 R4: dry-run the dailynews-gen validator on the authored script plan so a rejected plan gets
 * one targeted `script-write-fix` pass instead of silently shipping the template fallback. Writes
 * `24-script/<date>_08_script-write_errors.json` ([{itemId, rule}]) when the plan is absent or
 * rejected, and removes it when the plan is accepted. The trial build goes to a scratch path so the
 * `script` stage's isFile cache is never primed by a check.
 *
 * 0385 AC R2/R3: an ACCEPTED plan can still carry advisory editorial findings
 * (`metadata.scriptPlanAdvisories` from the generator's `analyzeEditorialClaims`). Those are written
 * to `24-script/<date>_08_script-write_advisories.json` and logged — a separate file, because the
 * acceptance verdict they describe is not a rejection and must not trigger the fix pass.
 */
export function dailyScriptCheck(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const planOut = join(workDir, '24-script', `${runDate}_08_script-write_plan.json`);
    const errorsOut = join(workDir, '24-script', `${runDate}_08_script-write_errors.json`);
    const writeErrors = (errors: unknown[]) => {
        sted('write', errorsOut, () => writeJsonText(errorsOut, errors));
        console.log(`script plan rejected (${errors.length} error(s)): ${errorsOut}`);
    };
    if (!isFile(planOut)) {
        writeErrors([{ itemId: 'episode', rule: 'missing-plan' }]);
        return;
    }
    const trialOut = join(workDir, '24-script', `.${runDate}_08_script-check_content.json`);
    const planIn = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    try {
        kk(['executor', 'run', 'dailynews-gen', '--in', planIn, '--out', trialOut, ...pluginsArgs(pluginsPath)], {
            env: {
                DAILYNEWS_LANGUAGE: 'zh',
                DAILYNEWS_DATE: runDate,
                DAILYNEWS_SCRIPT_PLAN: resolve(planOut),
                DAILYNEWS_STYLE_FILE: resolve(STYLE_CONTRACT),
                DAILYNEWS_CURATE_EXCLUDED: resolve(join(workDir, '21-plan', `${runDate}_03_curate_excluded.json`)),
            },
        });
        const metadata = readJson(trialOut)?.metadata;
        const source = metadata?.scriptSource;
        if (source !== 'plan' && source !== 'template') {
            failWith(1, `script-check: ${trialOut} carries no scriptSource stamp`);
        }
        if (source === 'plan') {
            if (isFile(errorsOut)) unlinkSync(errorsOut);
            // 0385 AC R2/R3: the editorial findings are advisory — an accepted plan stays accepted,
            // so they land in their own file and never re-open the fix loop that `errorsOut` drives.
            const advisoriesOut = join(workDir, '24-script', `${runDate}_08_script-write_advisories.json`);
            const advisories = Array.isArray(metadata.scriptPlanAdvisories) ? metadata.scriptPlanAdvisories : [];
            if (advisories.length > 0) {
                sted('write', advisoriesOut, () => writeJsonText(advisoriesOut, advisories));
                console.log(
                    `script plan accepted by the validator (${advisories.length} advisory finding(s)): ${advisoriesOut}`,
                );
            } else {
                if (isFile(advisoriesOut)) unlinkSync(advisoriesOut);
                console.log('script plan accepted by the validator');
            }
            return;
        }
        writeErrors(Array.isArray(metadata.scriptPlanErrors) ? metadata.scriptPlanErrors : []);
    } finally {
        if (isFile(trialOut)) unlinkSync(trialOut);
    }
}

/**
 * 0345 R8: validate the `curate` agent output (`21-plan/<date>_03_plan_plan.json` +
 * `21-plan/<date>_03_curate_excluded.json`) against the QC candidates
 * (`21-plan/<date>_04_quality-control-content_candidates.json`). Unwraps a `Content` envelope and
 * dedups near-duplicate titles in place before `write` reads the plan. Writes
 * `21-plan/<date>_03_curate_errors.json` (`[{itemId, rule}]`) on failure and removes it on success.
 * With `--final`, falls back to the untranslated candidates and `[]` exclusions on failure.
 */
export function dailyCurateCheck(args: string[]): void {
    const [workDir = '', runDate = '', flag = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!runDate) fail('missing run_date');
    const isFinal = flag === '--final';
    const candidatesFile = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const planFile = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    const excludedFile = join(workDir, '21-plan', `${runDate}_03_curate_excluded.json`);
    const errFile = join(workDir, '21-plan', `${runDate}_03_curate_errors.json`);

    const candRaw = readJson(candidatesFile);
    const candidateDocs: Record<string, unknown>[] = Array.isArray(candRaw)
        ? (candRaw as Record<string, unknown>[])
        : Array.isArray(metadataOf(candRaw).docs)
          ? (metadataOf(candRaw).docs as Record<string, unknown>[])
          : [];
    const candidateIds = candidateDocs.map((doc) => (typeof doc?.id === 'string' ? doc.id.trim() : '')).filter(Boolean);
    const candidateIdSet = new Set(candidateIds);

    const handleErrors = (errors: { itemId: string; rule: string }[]): void => {
        if (isFinal) {
            const reason = errors.map((e) => `${e.itemId}:${e.rule}`).join(', ');
            console.error(
                `curate-check: final check failed (${reason}) — falling back to ${candidateDocs.length} untranslated candidate(s)`,
            );
            sted('write', planFile, () => writeJsonText(planFile, candidateDocs));
            sted('write', excludedFile, () => writeJsonText(excludedFile, []));
            if (isFile(errFile)) unlinkSync(errFile);
            // Task 0392 R2: the recorded fallback IS the curation evidence for this attempt — the
            // agent's split was rejected, so the plan is every candidate and nothing was excluded.
            recordSelectionStage(workDir, runDate, {
                stages: [
                    { stage: 'curation', input: candidateIds.length, kept: candidateDocs.length, dropped: [] },
                    { stage: 'plan', input: candidateDocs.length, kept: candidateDocs.length, dropped: [] },
                ],
            });
            return;
        }
        sted('write', errFile, () => writeJsonText(errFile, errors));
        console.log(`curate-check: rejected (${errors.length} error(s)): ${errFile}`);
    };

    if (!isFile(planFile)) {
        handleErrors([{ itemId: 'episode', rule: 'missing-plan' }]);
        return;
    }

    let planParsed: unknown;
    try {
        planParsed = JSON.parse(readFileSync(planFile, 'utf-8'));
    } catch {
        handleErrors([{ itemId: 'episode', rule: 'invalid-json' }]);
        return;
    }

    let planDocs: Record<string, unknown>[];
    if (Array.isArray(planParsed)) {
        planDocs = planParsed as Record<string, unknown>[];
    } else if (
        planParsed !== null &&
        typeof planParsed === 'object' &&
        Array.isArray(metadataOf(planParsed as Record<string, unknown>).docs)
    ) {
        planDocs = metadataOf(planParsed as Record<string, unknown>).docs as Record<string, unknown>[];
        sted('write', planFile, () => writeJsonText(planFile, planDocs));
        console.log(`curate-check: unwrapped Content envelope (${planDocs.length} doc(s)) in ${planFile}`);
    } else {
        handleErrors([{ itemId: 'episode', rule: 'invalid-json' }]);
        return;
    }

    for (const entry of planDocs) {
        if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.trim() === '') {
            handleErrors([{ itemId: 'episode', rule: 'invalid-json' }]);
            return;
        }
    }

    const excludedItems: { id: string; reason: string }[] = [];
    if (isFile(excludedFile)) {
        let exParsed: unknown;
        try {
            exParsed = JSON.parse(readFileSync(excludedFile, 'utf-8'));
        } catch {
            handleErrors([{ itemId: 'episode', rule: 'invalid-json' }]);
            return;
        }
        if (!Array.isArray(exParsed)) {
            handleErrors([{ itemId: 'episode', rule: 'invalid-json' }]);
            return;
        }
        for (const entry of exParsed) {
            if (
                entry === null ||
                typeof entry !== 'object' ||
                typeof (entry as { id?: unknown }).id !== 'string' ||
                (entry as { id: string }).id.trim() === '' ||
                typeof (entry as { reason?: unknown }).reason !== 'string' ||
                (entry as { reason: string }).reason.trim() === ''
            ) {
                handleErrors([{ itemId: 'episode', rule: 'invalid-json' }]);
                return;
            }
            excludedItems.push({
                id: (entry as { id: string }).id.trim(),
                reason: (entry as { reason: string }).reason.trim(),
            });
        }
    }

    const errors: { itemId: string; rule: string }[] = [];
    if (planDocs.length === 0) {
        errors.push({ itemId: 'episode', rule: 'empty-plan' });
    }

    const keptIds = new Set<string>();
    for (const doc of planDocs) {
        const id = (doc.id as string).trim();
        keptIds.add(id);
        if (candidateIdSet.size > 0 && !candidateIdSet.has(id)) {
            errors.push({ itemId: id, rule: 'unknown-id' });
        }
    }

    const excludedIds = new Set<string>();
    for (const ex of excludedItems) {
        excludedIds.add(ex.id);
        if (candidateIdSet.size > 0 && !candidateIdSet.has(ex.id)) {
            errors.push({ itemId: ex.id, rule: 'unknown-id' });
        }
        if (keptIds.has(ex.id)) {
            errors.push({ itemId: ex.id, rule: 'conflict-id' });
        }
    }

    for (const cid of candidateIds) {
        if (!keptIds.has(cid) && !excludedIds.has(cid)) {
            errors.push({ itemId: cid, rule: 'missing-item' });
        }
    }

    if (errors.length > 0) {
        handleErrors(errors);
        return;
    }

    // Captured before the check's own dedup pass: `curation` records what the AGENT handed over,
    // `plan` records what the validation then kept, so the two stages never double-count a drop.
    const agentExcluded = excludedItems.map((entry) => entry.id);
    const { kept, dropped } = dedupPlanByTitle(planDocs);
    if (dropped.length > 0) {
        sted('write', planFile, () => writeJsonText(planFile, kept));
        console.error(`curate-check: dropped ${dropped.length} near-duplicate plan item(s): ${dropped.join(', ')}`);
        for (const droppedId of dropped) {
            if (!excludedIds.has(droppedId)) {
                excludedIds.add(droppedId);
                excludedItems.push({ id: droppedId, reason: '标题近似重复自动去重' });
            }
        }
        sted('write', excludedFile, () => writeJsonText(excludedFile, excludedItems));
    } else if (!isFile(excludedFile)) {
        sted('write', excludedFile, () => writeJsonText(excludedFile, excludedItems));
    }

    if (isFile(errFile)) unlinkSync(errFile);
    // Task 0392 R2: curation is authoritative only after this validation passed — that is why the
    // evidence is written here and not by the agent. `curation` is the agent's split as handed over;
    // `plan` is the validated plan after the check's own near-duplicate pass, so the two stages
    // chain (`curation.kept` → `plan.input`) and each one's arithmetic holds.
    recordSelectionStage(workDir, runDate, {
        stages: [
            {
                stage: 'curation',
                input: candidateIds.length,
                kept: planDocs.length,
                dropped: agentExcluded,
            },
            { stage: 'plan', input: planDocs.length, kept: kept.length, dropped },
        ],
        curationExcluded: excludedItems.map((entry) => ({ id: entry.id, reason: entry.reason })),
    });
    console.log(`curate-check: accepted (${kept.length} kept, ${excludedItems.length} excluded)`);
}

/**
 * 0394 R1/R16 — the citation line for one curated item, or `''` when the doc carries no verifiable
 * link. Resolution (corroborated original → retrieval URL → explicit aggregator fallback) is owned
 * by `./source-citation.ts` so the same rule can serve the notes paths without a second convention.
 */
function sourceLineForDoc(doc: Record<string, unknown>, sourceUri: string): string {
    const citation = resolveSourceCitation(doc, sourceUri);
    return citation === null ? '' : `[来源：${citation.label}](${citation.url})`;
}

/**
 * What the `editorial-commit` stage reports instead of the ledger module's raw status: the two
 * "nothing to fix" outcomes collapse to `committed` / `reused`, the two refusals stay verbatim.
 */
export type EditorialCommitSummary = 'committed' | 'reused' | 'conflict' | 'stop';

/**
 * The existing kk store single-flight claim as the ledger's `LockPort` (ADR-054/0384 R10): the
 * same `kk lock acquire/release` the collect workflow shells, scoped to the ledger's own name. A
 * second locking mechanism is deliberately not invented — the store's `LocksDao` owns the claim,
 * its TTL and its re-entrancy.
 */
function kkLedgerLockPort(): LockPort {
    const kkLock = (argv: string[]): { status: number; stdout: string; stderr: string } => {
        const result = spawnSync('kk', argv, { encoding: 'utf-8' });
        if (result.error !== undefined) failWith(127, `kk: ${result.error.message}`);
        return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    };
    return {
        acquire: async (name: string, run: string) => {
            // stdout IS the lock contract: `{"acquired":true}` or `{"skipped":"locked",…}` (exit 0).
            const claimed = kkLock(['lock', 'acquire', '--name', name, '--run', run]);
            if (claimed.status !== 0) failWith(claimed.status, `lock acquire failed: ${claimed.stderr.trim()}`);
            return claimed.stdout.includes('"acquired":true');
        },
        release: async (name: string, run: string) => {
            const released = kkLock(['lock', 'release', '--name', name, '--run', run]);
            if (released.status !== 0) {
                console.error(`editorial-commit: lock release failed: ${released.stderr.trim()}`);
            }
        },
    };
}

/** Selected ids from the plan `curate-final` settled — the only ids a judgment may cite (0393). */
function selectedIdsOf(planRaw: unknown): Set<string> {
    const docs: Record<string, unknown>[] = Array.isArray(planRaw)
        ? (planRaw as Record<string, unknown>[])
        : Array.isArray(metadataOf(planRaw).docs)
          ? (metadataOf(planRaw).docs as Record<string, unknown>[])
          : [];
    const ids = new Set<string>();
    for (const doc of docs) {
        if (doc !== null && typeof doc === 'object' && typeof doc.id === 'string' && doc.id.trim() !== '') {
            ids.add(doc.id.trim());
        }
    }
    return ids;
}

/**
 * 0384 R4/R10 — the deterministic judgment commit between final selection and drafting: the
 * `align` agent's proposal in, a validated ledger commit and an immutable run snapshot out.
 *
 *   news-editorial-commit <work_dir> <run_date> <run_id> [proposal_file] [ledger_file]
 *
 * `<proposal_file>` defaults to `21-plan/<date>_judgment-proposal.json` (absent file = the documented
 * "nothing new" case, an empty proposal); `<ledger_file>` defaults to the run directory's parent
 * `<works_dir>/kk-news-generate/conclusion.md` (ADR-054). Outputs — both beside the plan:
 * `judgment-snapshot.json` (what 0385 drafts from and 0396 corrects from) and
 * `judgment-commit-receipt.json` (written on every exit path, including the refusals).
 *
 * Reselect tolerance: the proposal is authored in `curate`, but `curate-check`/`curate-fix`/`--final`
 * settle the plan afterwards, so a judgment may cite a selected id the settled plan no longer holds.
 * Such judgments are dropped *here* (never inside the ledger API, whose unknown-id refusal stays) and
 * the ids go into the receipt's `droppedByReselection` plus a printed line — the surviving judgments
 * still commit, and a proposal with nothing committable left behaves exactly like the documented
 * empty proposal (this run's legal snapshot is reused). Never silent, never a hard stop for reselection alone.
 *
 * Exit: `committed` / `reused` exit 0; `conflict` and `stop` print the recovery path and exit 1, so
 * a refused ledger commit can never be drafted against. `KK_EDITORIAL_COMMIT_OFFLINE=1` runs the
 * commit without the store claim (the documented `NULL_LOCK` seam; tests and offline replay).
 */
export async function newsEditorialCommit(args: string[]): Promise<void> {
    const [workDir = '', runDate = '', runId = '', proposalArg = '', ledgerArg = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!runDate) fail('missing run_date');
    if (!runId) fail('missing run_id');
    // 0384: judged artifacts live beside the plan, NOT under `20-editorial/` — that directory is the
    // per-run writer-skill snapshot (design §2.2 keeps the skill read in place, and the DAG contract
    // forbids agent prompts naming a copy there).
    const planDir = join(workDir, '21-plan');
    const proposalPath = proposalArg || join(planDir, `${runDate}_judgment-proposal.json`);
    const ledgerPath = ledgerArg || resolve(join(workDir, '..', 'conclusion.md'));
    const snapshotPath = join(planDir, `${runDate}_judgment-snapshot.json`);
    const receiptPath = join(planDir, `${runDate}_judgment-commit-receipt.json`);
    const planFile = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);

    const planRaw = readJson(planFile);
    if (planRaw === null) {
        failWith(1, `editorial-commit: no selected plan at ${planFile} — refusing to commit judgments`);
    }
    const selectedIds = selectedIdsOf(planRaw);

    let proposal: AlignmentProposal;
    if (isFile(proposalPath)) {
        try {
            const parsed = JSON.parse(readFileSync(proposalPath, 'utf-8')) as AlignmentProposal;
            if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.judgments)) {
                failWith(1, `editorial-commit: ${proposalPath} has no judgments array — re-run the align pass`);
            }
            proposal = parsed;
        } catch (error) {
            failWith(1, `editorial-commit: ${proposalPath} is not valid JSON: ${(error as Error).message}`);
        }
    } else {
        // An empty proposal is the normal case (skill `align` rule 4), not a failure.
        proposal = { version: 1, judgments: [] };
        console.log(`editorial-commit: no proposal at ${proposalPath} — committing this run's ledger as-is`);
    }

    // The plan is settled by now (`curate-check`/`curate-fix`/`--final`), so an id the proposal cited
    // from the pre-settlement plan may be gone: drop those judgments and record them (never silent).
    const reselected = dropReselectedJudgments(proposal, selectedIds);
    if (reselected.dropped.length > 0) {
        // Same stream as the sibling drop reports (`curate-check`, `qc`): a drop is loud, not fatal.
        console.error(
            `editorial-commit: dropped ${reselected.dropped.length} judgment(s) the settled plan no longer carries: ${reselected.dropped.join(', ')}`,
        );
    }

    sted('mkdir', planDir, () => mkdirSync(planDir, { recursive: true }));
    // Offline means NO lock port at all (the ledger's documented `NULL_LOCK` default), so the
    // receipt says `lock: none` — passing NULL_LOCK explicitly would report a claim it never took.
    const receipt = await commitAlignment({
        ledgerPath,
        snapshotPath,
        receiptPath,
        proposal: reselected.proposal,
        selectedIds,
        runDate,
        runId,
        now: new Date().toISOString(),
        droppedByReselection: reselected.dropped,
        ...(process.env.KK_EDITORIAL_COMMIT_OFFLINE === '1' ? {} : { lock: kkLedgerLockPort() }),
    });

    const summary: EditorialCommitSummary =
        receipt.status === 'applied'
            ? 'committed'
            : receipt.status === 'no-op'
              ? 'reused'
              : receipt.status === 'conflict'
                ? 'conflict'
                : 'stop';
    const counts = [
        `appended=${receipt.appended.length}`,
        `superseded=${receipt.superseded.length}`,
        `corrections=${receipt.correctionIds.length}`,
        `dropped=${receipt.droppedByReselection.length}`,
        `lock=${receipt.lock}`,
        `snapshot=${receipt.snapshotReused ? 'reused' : 'frozen'}`,
    ].join(' ');
    console.log(
        `editorial-commit: ${summary} — ${receipt.reason} (${counts}; ledger=${receipt.ledgerPath}; receipt=${receiptPath})`,
    );
    if (receipt.correctionIds.length > 0) {
        console.log(`editorial-commit: corrections owed by the draft: ${receipt.correctionIds.join(', ')}`);
    }
    if (summary === 'conflict' || summary === 'stop') {
        const recovery = receipt.recovery;
        const where = recovery?.backupPath ? ` backup=${recovery.backupPath}` : '';
        failWith(
            1,
            `editorial-commit: ${summary} — ${receipt.reason}${where} (${recovery?.action ?? 'see the receipt'})`,
        );
    }
}

/** Fixed column opening line of the rendered article body: house copy, not editorial judgement (0345). */
const EDITORIAL_ARTICLE_OPENING = '这里是由Robin为你带来的咸话咸说之每日AI乱炖。';

/**
 * 0345 R10: deterministically render the five sibling editorial artifacts from the master script
 * plan (`24-script/<date>_08_script-write_plan.json`) and the curated plan
 * (`21-plan/<date>_03_plan_plan.json`):
 *  1. `22-article/<date>_06_article-write_body.md`
 *  2. `23-cover/<date>_07_cover-brief.json`
 *  3. `25-xhs/<date>_18_xhs_plan.json` (only when `cards_enabled === 'true'`)
 *  4. `26-social/{x,threads,jike}.md` (`social.short`)
 *  5. `26-social/{weibo,linkedin}.md` (`social.long`)
 * Missing master field -> skip that one artifact with a logged reason, write the others.
 */
export function dailyEditorialRender(args: string[]): void {
    const [workDir = '', runDate = '', cardsEnabled = 'false', cardsRaw = '6'] = args;
    if (!workDir) fail('missing work_dir');
    if (!runDate) fail('missing run_date');
    const cardsCount = Math.max(2, Number.parseInt(cardsRaw, 10) || 6);
    const planFile = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    const masterFile = join(workDir, '24-script', `${runDate}_08_script-write_plan.json`);

    const master = readJson(masterFile);
    if (master === null) {
        console.log(`editorial-render: no master script plan at ${masterFile} — skipping all renders`);
        return;
    }

    const planRaw = readJson(planFile);
    const planDocs: Record<string, unknown>[] = Array.isArray(planRaw)
        ? (planRaw as Record<string, unknown>[])
        : Array.isArray(metadataOf(planRaw).docs)
          ? (metadataOf(planRaw).docs as Record<string, unknown>[])
          : [];
    const docById = new Map<string, Record<string, unknown>>();
    for (const doc of planDocs) {
        if (typeof doc?.id === 'string' && doc.id.trim() !== '') {
            docById.set(doc.id.trim(), doc);
        }
    }

    const rawItems = Array.isArray(master.items) ? (master.items as Record<string, unknown>[]) : [];
    const itemById = new Map<string, Record<string, unknown>>();
    for (const item of rawItems) {
        if (item !== null && typeof item === 'object' && typeof item.id === 'string' && item.id.trim() !== '') {
            itemById.set(item.id.trim(), item);
        }
    }
    const orderedIds =
        planDocs.length > 0
            ? planDocs
                  .map((d) => (typeof d.id === 'string' ? d.id.trim() : ''))
                  .filter((id) => id !== '' && itemById.has(id))
            : [...itemById.keys()];

    // 1. Article body: 22-article/<date>_06_article-write_body.md
    const outro = typeof master.outro === 'string' ? master.outro.trim() : '';
    const articleSections: string[] = [];
    for (const id of orderedIds) {
        const doc = docById.get(id);
        const item = itemById.get(id);
        const title = typeof doc?.title === 'string' ? doc.title.trim() : '';
        const body = typeof doc?.body === 'string' ? doc.body.trim() : '';
        const lead = typeof item?.lead === 'string' ? item.lead.trim() : '';
        // 0385 R3: a comment-free item is legal, so a blank insight drops the comment sentence
        // only — dropping the whole item would publish an episode the plan says to speak.
        const insight = typeof item?.insight === 'string' ? item.insight.trim() : '';
        if (!title || !body || !lead) continue;
        const sourceUri = typeof doc?.sourceUri === 'string' ? doc.sourceUri.trim() : '';
        const sourceLine = sourceUri ? sourceLineForDoc(doc ?? {}, sourceUri) : '';
        const parts = [
            `## ${title}`,
            lead,
            body,
            ...(insight !== '' ? [insight] : []),
            ...(sourceLine ? [sourceLine] : []),
        ];
        articleSections.push(parts.join('\n\n'));
    }
    if (articleSections.length > 0 && outro !== '') {
        const articleDir = join(workDir, '22-article');
        sted('mkdir', articleDir, () => mkdirSync(articleDir, { recursive: true }));
        const articleOut = join(articleDir, `${runDate}_06_article-write_body.md`);
        const articleText = `${[EDITORIAL_ARTICLE_OPENING, ...articleSections, outro].join('\n\n')}\n`;
        sted('write', articleOut, () => writeRaw(articleOut, articleText));
        console.log(`editorial-render: wrote article body (${articleSections.length} item(s)): ${articleOut}`);
    } else {
        console.log('editorial-render: skipping article body (missing items/doc fields or outro)');
    }

    // 2. Cover brief: 23-cover/<date>_07_cover-brief.json
    // 0347 R5: cover may be a legacy string (subject only) or `{ scene, headline }` — the
    // headline falls back to the lead story's title either way.
    const rawCover = master.cover;
    let coverSubject = '';
    let coverHeadline = '';
    if (typeof rawCover === 'string') {
        coverSubject = rawCover.trim();
    } else if (rawCover !== null && typeof rawCover === 'object') {
        const coverObj = rawCover as Record<string, unknown>;
        coverSubject = typeof coverObj.scene === 'string' ? coverObj.scene.trim() : '';
        coverHeadline = typeof coverObj.headline === 'string' ? coverObj.headline.trim() : '';
    }
    const leadId = orderedIds[0];
    const leadDoc = leadId !== undefined ? docById.get(leadId) : undefined;
    const leadStoryTitle = typeof leadDoc?.title === 'string' ? leadDoc.title.trim() : '';
    // 0385 R4: freeze ONE episode identity (run date + one point + the source ids the point rests
    // on) for every publishing surface. The point is the script plan's cover headline and the cover
    // reuses it verbatim, never a second wording. Two non-frozen outcomes are explicit: an existing
    // frozen record wins (a retry or a historical replay keeps the identity the bundle shipped), and
    // a point whose supporting sources admission dropped is WITHHELD — no title, no cover point, so
    // nothing downstream can publish a headline the settled plan no longer backs.
    const rawCoverSupport =
        rawCover !== null && typeof rawCover === 'object' ? (rawCover as Record<string, unknown>).sourceIds : undefined;
    // 0385 R4/P3: "admitted" means the episode actually covers the id — the plan docs MINUS the drop
    // signals downstream already honours (the article boundary drop `metadata.excludedIds` and the
    // script plan's own `excluded` list). Comparing against the raw plan set made the withhold
    // guarantee structurally unreachable: the lead is always in the plan it came from.
    const droppedIds = new Set<string>();
    const articleMetaExcluded = metadataOf(
        readJson(join(workDir, '22-article', `${runDate}_06_article_content.json`)),
    )?.excludedIds;
    if (Array.isArray(articleMetaExcluded)) {
        for (const id of articleMetaExcluded) if (typeof id === 'string' && id !== '') droppedIds.add(id);
    }
    if (Array.isArray(master.excluded)) {
        for (const entry of master.excluded as unknown[]) {
            const id = entry !== null && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined;
            if (typeof id === 'string' && id !== '') droppedIds.add(id);
        }
    }
    const admittedSourceIds = [...docById.keys()].filter((id) => !droppedIds.has(id));
    // The point's support is the cover's own `sourceIds` when the writer named them (the documented
    // producer, 0385 R4), otherwise the admitted lead — the story the point is about.
    const supportIds = Array.isArray(rawCoverSupport)
        ? rawCoverSupport.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
        : leadId !== undefined
          ? [leadId]
          : [];
    const identityPath = join(workDir, '21-plan', `${runDate}_05_script_identity.json`);
    const priorIdentity = identityFromMetadata({ [EPISODE_IDENTITY_KEY]: readJson(identityPath) });
    const identity =
        priorIdentity !== null && priorIdentity.status === 'frozen'
            ? priorIdentity
            : freezeEpisodeIdentity({
                  date: runDate,
                  headline: coverHeadline,
                  supportingSourceIds: supportIds,
                  admittedSourceIds,
                  legacyTitle: leadStoryTitle,
              });
    if (priorIdentity === null || priorIdentity.status !== 'frozen') {
        sted('mkdir', join(workDir, '21-plan'), () => mkdirSync(join(workDir, '21-plan'), { recursive: true }));
        sted('write', identityPath, () => writeJsonText(identityPath, identity));
    }
    if (identity.status === 'frozen') {
        console.log(`editorial-render: episode identity frozen: ${identity.title} (${identityPath})`);
    } else if (identity.status === 'support-removed') {
        // The point lost its support in admission: withhold it and its cover copy (never a fallback
        // title here — the fallback below would smuggle back a point the plan no longer admits).
        console.error(
            `editorial-render: WITHHELD episode identity — admission dropped the headline's support (${identity.supportingSourceIds.join(', ')}); the title and the cover point are withheld (see ${identityPath})`,
        );
        coverHeadline = '';
    }
    // Every target reads the frozen title from the bundle, so the article Content (surfdash, ID3,
    // show notes) carries the same one the podcast and the cover do. A withheld identity leaves the
    // article title untouched: there is no title to share. On a first run the Content does not exist
    // yet (this stage precedes `daily-article`) and the stamp is a no-op — `daily-article` re-applies
    // it after it derives, so both orders converge on one title.
    stampEpisodeIdentity(join(workDir, '22-article', `${runDate}_06_article_content.json`), identity);
    if (coverSubject !== '') {
        if (coverHeadline === '' && leadStoryTitle !== '' && identity.status !== 'support-removed') {
            coverHeadline = leadStoryTitle;
        }
        const coverDir = join(workDir, '23-cover');
        sted('mkdir', coverDir, () => mkdirSync(coverDir, { recursive: true }));
        const coverOut = join(coverDir, `${runDate}_07_cover-brief.json`);
        sted('write', coverOut, () =>
            writeJsonText(coverOut, {
                subject: coverSubject,
                // The cover reuses the frozen point verbatim (0385 R4); `episodeIdentity` carries the
                // title so a retry or a replay re-renders the same episode identity.
                headline: identity.coverHeadline ?? coverHeadline,
                leadStoryTitle,
                episodeIdentity: identity,
            }),
        );
        console.log(`editorial-render: wrote cover brief: ${coverOut}`);
    } else {
        console.log('editorial-render: skipping cover brief (missing cover in script plan)');
    }

    // 3. XHS card plan: 25-xhs/<date>_18_xhs_plan.json (only when cards_enabled === 'true')
    if (cardsEnabled === 'true') {
        const cardsMeta =
            master.cards !== null && typeof master.cards === 'object'
                ? (master.cards as Record<string, unknown>)
                : null;
        const cardTitle = typeof cardsMeta?.title === 'string' ? cardsMeta.title.trim() : '';
        const cardBody = typeof cardsMeta?.body === 'string' ? cardsMeta.body.trim() : '';
        const contentItems = orderedIds
            .map((id) => ({ id, item: itemById.get(id), doc: docById.get(id) }))
            .filter(({ item }) => {
                const c = item?.card as Record<string, unknown> | undefined;
                return (
                    c !== null &&
                    typeof c === 'object' &&
                    typeof c.copy === 'string' &&
                    c.copy.trim() !== '' &&
                    Array.isArray(c.points) &&
                    c.points.length >= 1 &&
                    typeof c.subject === 'string' &&
                    c.subject.trim() !== ''
                );
            });
        const maxContent = Math.max(1, cardsCount - 2);
        const chosenContent = contentItems.slice(0, maxContent);
        if (cardTitle !== '' && cardBody !== '' && chosenContent.length > 0) {
            const firstSubject =
                coverSubject ||
                ((chosenContent[0]?.item?.card as { subject?: string } | undefined)?.subject ?? '').trim() ||
                'Minimalist geometric light sculpture on a dark studio table';
            const introText =
                typeof master.intro === 'string' && master.intro.trim() !== '' ? master.intro.trim() : cardTitle;
            const coverPoints = chosenContent
                .slice(0, 4)
                .map(({ item }) => ((item?.card as { copy?: string } | undefined)?.copy || '').trim())
                .filter(Boolean);
            const renderedCards: Record<string, unknown>[] = [
                {
                    role: 'cover',
                    copy: cardTitle.slice(0, 12),
                    points: coverPoints.length >= 2 ? coverPoints : [cardTitle, introText.slice(0, 36)],
                    layout: 'hero',
                    subject: firstSubject,
                    sourcePoint: introText,
                },
                ...chosenContent.map(({ id, item, doc }) => {
                    const card = item?.card as { copy: string; points: string[]; subject: string };
                    const lead = typeof item?.lead === 'string' && item.lead.trim() !== '' ? item.lead.trim() : '';
                    const docTitle = typeof doc?.title === 'string' && doc.title.trim() !== '' ? doc.title.trim() : id;
                    return {
                        role: 'content',
                        copy: card.copy.trim(),
                        points: card.points
                            .map((p) => String(p).trim())
                            .filter(Boolean)
                            .slice(0, 4),
                        layout: 'split',
                        subject: card.subject.trim(),
                        sourcePoint: lead || docTitle,
                        itemId: id,
                    };
                }),
            ];
            // Pad content cards if chosenContent.length < maxContent so total length equals cardsCount
            while (renderedCards.length < cardsCount - 1) {
                const seed = renderedCards[renderedCards.length - 1] as Record<string, unknown>;
                renderedCards.push({ ...seed });
            }
            const closingPoints = [outro || introText, cardTitle].filter(Boolean);
            renderedCards.push({
                role: 'closing',
                copy: '本期小结',
                points: closingPoints.length >= 2 ? closingPoints : [outro || cardTitle, '感谢关注每日AI乱炖'],
                layout: 'summary',
                subject: firstSubject,
                sourcePoint: outro || introText,
            });
            const xhsDir = join(workDir, '25-xhs');
            sted('mkdir', xhsDir, () => mkdirSync(xhsDir, { recursive: true }));
            const xhsOut = join(xhsDir, `${runDate}_18_xhs_plan.json`);
            sted('write', xhsOut, () =>
                writeJsonText(xhsOut, {
                    title: cardTitle,
                    body: cardBody,
                    cards: renderedCards,
                }),
            );
            console.log(`editorial-render: wrote xhs card plan (${renderedCards.length} card(s)): ${xhsOut}`);
        } else {
            console.log('editorial-render: skipping xhs card plan (missing cards.title/body or items[].card)');
        }
    }

    // 4 & 5. Social posts: unified short notice for 26-social/{x,threads,weibo}.md; linkedin.md (and weibo fallback) long
    const social =
        master.social !== null && typeof master.social === 'object' ? (master.social as Record<string, unknown>) : null;
    const socialShort = typeof social?.short === 'string' ? social.short.trim() : '';
    const socialLong = typeof social?.long === 'string' ? social.long.trim() : '';
    const socialDir = join(workDir, '26-social');
    if (socialShort !== '') {
        sted('mkdir', socialDir, () => mkdirSync(socialDir, { recursive: true }));
        for (const name of ['x.md', 'threads.md', 'weibo.md', 'jike.md']) {
            const out = join(socialDir, name);
            sted('write', out, () => writeRaw(out, `${socialShort}\n`));
        }
        console.log('editorial-render: wrote 26-social/{x,threads,weibo,jike}.md');
    } else if (socialLong !== '') {
        sted('mkdir', socialDir, () => mkdirSync(socialDir, { recursive: true }));
        const out = join(socialDir, 'weibo.md');
        sted('write', out, () => writeRaw(out, `${socialLong}\n`));
        console.log('editorial-render: wrote 26-social/weibo.md from social.long');
    } else {
        console.log('editorial-render: skipping social short posts (missing social.short in script plan)');
    }
    if (socialLong !== '') {
        sted('mkdir', socialDir, () => mkdirSync(socialDir, { recursive: true }));
        const out = join(socialDir, 'linkedin.md');
        sted('write', out, () => writeRaw(out, `${socialLong}\n`));
        console.log('editorial-render: wrote 26-social/linkedin.md');
    } else {
        console.log('editorial-render: skipping social long posts (missing social.long in script plan)');
    }
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
        // 0386 R1 — the card manifest (already in published order) rides along as a file path, and
        // its problems are recorded beside the notes, never inside them. When no receipt exists yet
        // the render is explicitly allowed to run link-free: the notes are reviewable before the
        // article URL is known, and the article link is added only from a real receipt `postPath`.
        const cardsManifest = join(workDir, '25-xhs', 'cards.json');
        const cardsDiagnostics = join(workDir, '31-publish', `${runDate}_15_show-notes_cards-diagnostics.json`);
        kk(['executor', 'run', 'podcast-pub', '--in', planIn, '--out', out, ...pluginsArgs(pluginsPath)], {
            env: {
                PODCAST_PUB_TITLE: titleArg,
                PODCAST_PUB_RUN_DATE: runDate,
                PODCAST_PUB_BRIEF_MODE: 'true',
                ...(isFile(cardsManifest) ? { PODCAST_PUB_CARDS: cardsManifest } : {}),
                PODCAST_PUB_CARDS_DIAGNOSTICS: cardsDiagnostics,
                ...(postPath === '' ? { PODCAST_PUB_BRIEF_WITHOUT_RECEIPT: 'true' } : {}),
                PODCAST_PUB_ARTICLE_POST_PATH: postPath,
                // 0396 R1: the frozen 0384 judgment snapshot is what the correction block is read
                // from (stable correction id, prior-episode reference, evidence). Passing the path
                // only when the snapshot exists keeps a run without corrections byte-identical, and
                // a snapshot that cannot be read fails the render instead of dropping an owed
                // correction silently.
                ...(isFile(join(workDir, '21-plan', `${runDate}_judgment-snapshot.json`))
                    ? { PODCAST_PUB_CORRECTIONS: join(workDir, '21-plan', `${runDate}_judgment-snapshot.json`) }
                    : {}),
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

/**
 * The translate agents run with cwd = this repo, and both executor sandboxes (codex workspace-write,
 * claude acceptEdits) refuse writes into the Surfdash checkout — on 2026-11-04 both exited 0 with
 * en/ja untouched. So they write `<runDate>_21_translate_<locale>.md` under the work dir and this
 * installs each over its scaffold. The output is consumed (renamed) so a rerun never clobbers an
 * operator's later repair of the installed post.
 */
function installTranslatedLocales(workDir: string, runDate: string, zhPostPath: string): void {
    for (const locale of ['en', 'ja'] as const) {
        const translated = join(workDir, '31-publish', `${runDate}_21_translate_${locale}.md`);
        if (!isFile(translated)) continue;
        const target = zhPostPath.replace('/zh/', `/${locale}/`);
        sted('write', target, () => writeRaw(target, readFileSync(translated, 'utf-8')));
        renameSync(translated, `${translated}.installed`);
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
            installTranslatedLocales(workDir, runDate, zhPostPath);
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

/** CJK ideographs and kana: present in a zh draft, absent from a real en translation. */
const CJK_TEXT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/u;
/** Kana only: a ja translation always carries hiragana/katakana; a zh copy of the draft never does. */
const KANA_TEXT = /[\u3040-\u309f\u30a0-\u30ff]/u;

/**
 * `news-localize-validate <workDir>` — the pre-freeze gate on the news pipeline's en/ja translations
 * (task 0409 R1).
 *
 * The `localize` agent node writes `${workDir}/22-article/locales/{en,ja}.md` (first line
 * `# <title>`, rest the body) between `review` and `variants`. This stage refuses a locale that is
 * missing, empty, untitled, or still Chinese — an untranslated locale is not a locale — so no bundle
 * can freeze half-localized. Translating after the freeze would break ADR-053's "publish exactly what
 * was safety-reviewed and frozen", and translating inside the plugin would put a model call in a
 * deterministic step, so the gate lives here.
 */
export function newsLocalizeValidate(args: string[]): void {
    const [workDir = ''] = args;
    timed(workDir, 'localize-validate', () => {
        const localesDir = join(workDir, '22-article', 'locales');
        const accepted: string[] = [];
        const problems: string[] = [];
        for (const locale of ['en', 'ja'] as const) {
            const file = join(localesDir, `${locale}.md`);
            if (!isFile(file)) {
                problems.push(`${locale}: file missing (${file})`);
                continue;
            }
            const raw = readFileSync(file, 'utf-8');
            if (raw.trim() === '') {
                problems.push(`${locale}: file is empty`);
                continue;
            }
            const [firstLine = '', ...rest] = raw.split('\n');
            const title = firstLine.startsWith('# ') ? firstLine.slice(2).trim() : '';
            if (title === '') {
                problems.push(`${locale}: first line must be "# <title>", got "${firstLine.trim().slice(0, 60)}"`);
                continue;
            }
            if (rest.join('\n').trim() === '') {
                problems.push(`${locale}: body is empty after the title line`);
                continue;
            }
            const untranslated = locale === 'en' ? CJK_TEXT.test(raw) : !KANA_TEXT.test(raw);
            if (untranslated) {
                problems.push(
                    `${locale}: untranslated — ${locale === 'en' ? 'the document still carries CJK text' : 'the document has no kana, so it is not Japanese'}`,
                );
                continue;
            }
            // Rewrite safe compound retired/wrong-locale series brands before freezing and refuse
            // any unrewritable retired brand or wrong-language show name that check:seo rejects.
            const normalized = normalizeSeriesNames(raw, locale);
            const activeText = normalized.markdown;
            if (activeText !== raw) {
                sted('write', file, () => writeRaw(file, activeText));
            }
            if (normalized.remaining.length > 0) {
                problems.push(`${locale}: retired series name (${normalized.remaining.join(', ')})`);
                continue;
            }
            if (locale === 'ja' && /ごった煮|寄せ鍋|咸话咸说|Salty Talk/i.test(activeText)) {
                problems.push(`${locale}: retired series or wrong-language show name in translated body`);
                continue;
            }
            if (locale === 'en' && /咸话咸说|咸話咸説/.test(activeText)) {
                problems.push(`${locale}: wrong-language show name in translated body`);
                continue;
            }
            accepted.push(locale);
        }
        if (problems.length > 0) {
            failWith(1, `localize-validate: ${problems.join('; ')} — repair the translation before freezing`);
        }
        sted('write', join(localesDir, 'localize-validate.json'), () =>
            writeJsonText(join(localesDir, 'localize-validate.json'), { ok: true, locales: accepted }),
        );
        console.log(`localize-validate: ${accepted.join('/')} translations ready for the freeze`);
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
    // When a long earlier point pushes a short trailing point out of the safe area, the composer
    // names the trailing index. Shorten the longest shrinkable point so the block fits.
    if (!changed) {
        let bestIndex = -1;
        let bestLen = 0;
        for (let i = 0; i < points.length; i++) {
            const point = points[i] ?? '';
            const next = shortenOverflowedPoint(point);
            if (next !== point && point.length > bestLen) {
                bestIndex = i;
                bestLen = point.length;
            }
        }
        if (bestIndex >= 0) {
            const point = points[bestIndex] ?? '';
            points[bestIndex] = shortenOverflowedPoint(point);
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
