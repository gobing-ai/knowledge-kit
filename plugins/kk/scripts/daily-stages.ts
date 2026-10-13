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
    readFileSync,
    renameSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
    ADMISSION_CRITERIA,
    applyTopicBoundary,
    assertScriptContent,
    COVER_FORMAT,
    COVER_STYLE,
    coverBrief,
    coverNormalizeBody,
    dedupPlanByTitle,
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
    timed(workDir, 'quality-control-content', () => {
        if (isFile(candidates)) {
            console.log(`candidates cached: ${candidates}`);
            return;
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
        applyFloorGate(candidates, workDir, runDate, minMinutes, vdriver);
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
    if (dropped.length === 0) return;
    const dedupedContent = requireJson(candidates, 'qc-dedup');
    const dedupedMeta = dedupedContent.metadata;
    if (dedupedMeta === null || typeof dedupedMeta !== 'object') {
        failWith(1, 'qc-dedup: candidates content carries no metadata object');
    }
    (dedupedMeta as Record<string, unknown>).docs = deduped;
    sted('write', candidates, () => writeJsonText(candidates, dedupedContent));
    console.error(`qc: dropped ${dropped.length} near-duplicate candidate(s): ${dropped.join(', ')}`);
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
): void {
    const floor = Number(minMinutes);
    if (minMinutes === '' || !Number.isFinite(floor) || floor <= 0) return;
    const content = readJson(candidates);
    const docs = metadataOf(content).docs;
    if (!Array.isArray(docs) || docs.length === 0) return;
    const { minutes: estimatedMinutes, seconds: estimatedSeconds, chars } = estimateSpokenMinutes(docs, vdriver);
    if (estimatedSeconds >= floor * 60) {
        console.log(`floor gate: estimated ${estimatedMinutes} min from ${chars} chars — above the ${floor} min floor`);
        return;
    }
    const refusal = join(workDir, '21-plan', `${runDate}_04_quality-control-content_floor-refusal.json`);
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
export function dailyEpisodeDuration(args: string[]): void {
    const [workDir = '', runDate = '', minArg = '', maxArg = '', vdriver = ''] = args;
    if (!workDir) fail('missing work_dir');
    if (!runDate) fail('missing run_date');
    const minMinutes = Number(minArg);
    const maxMinutes = Number(maxArg);
    if (!Number.isFinite(minMinutes) || minMinutes <= 0) fail(`invalid min_minutes: ${minArg || '(empty)'}`);
    if (!Number.isFinite(maxMinutes) || maxMinutes < minMinutes) fail(`invalid max_minutes: ${maxArg || '(empty)'}`);
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
        // Idempotency first: a rerun must not recompute an estimate from the already-emptied candidates.
        if (isFile(refusal)) {
            console.log(`episode-duration: duration refusal already recorded (${refusal}) — nothing to do`);
            return;
        }
        const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
        const content = readJson(candidates);
        const docs = Array.isArray(metadataOf(content).docs) ? (metadataOf(content).docs as unknown[]) : [];
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
        if (content !== null) {
            sted('write', candidates, () =>
                writeJsonText(candidates, { ...content, metadata: { ...metadataOf(content), docs: [] } }),
            );
        }
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
                if (Array.isArray(plan.items) && plan.items.length !== itemSections.length) {
                    failWith(
                        1,
                        `generate: plan item count (${plan.items.length}) does not match script item sections (${itemSections.length})`,
                    );
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
                const status = kk(voiceExecutorArgs(voiceGenerator, secDocIn, plan.jsonPath, pluginsPath), {
                    env: { VOICE_GEN_MP3: transcodeMp3 },
                    soft: true,
                });
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
        const introPath = resolve(introSrc);
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
    timed(workDir, 'plan', () => {
        if (deferDocs ? isFile(planContent) : isFile(planDocs)) {
            console.log(`plan cached: ${deferDocs ? planContent : planDocs}`);
            return;
        }
        kk(
            ['executor', 'run', 'episode-plan-gen', '--in', blended, '--out', planContent, ...pluginsArgs(pluginsPath)],
            {
                env: { EPISODE_PLAN_MAX_ITEMS: planMaxItems, EPISODE_PLAN_DATE: runDate },
            },
        );
        const docs = metadataOf(readJson(planContent)).docs;
        if (!Array.isArray(docs) || docs.length === 0) failWith(1, 'plan: content.metadata.docs missing or empty');
        if (deferDocs) return;
        sted('write', planDocs, () => writeJsonText(planDocs, docs));
        if (!isFile(planDocs)) failWith(1, `plan: ${planDocs} not written after episode-plan-gen`);
    });
}

/**
 * Topic-boundary sidecar (task 0189 R2). Sibling of this file; node-builtins-only read.
 */
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
            const merged = { ...content, metadata: { ...metadataOf(content), showNotes } };
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

export function dailyPublishSurfdash(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const prep = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const result = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
    timed(workDir, 'publish-surfdash', () => {
        if (targetPublished(result, 'surfdash-pub')) {
            console.log(`publish-surfdash cached: surfdash target ok in ${result}`);
            return;
        }
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
                soft: true,
            },
        );
        console.log('publish-surfdash: surfdash target dispatched; classification happens after podcast publish');
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
        // MP draft enrichment (operator preferences 2026-09-29, completed 2026-10-10): 原创, 赞赏,
        // 作者, 合集, 原文链接 (the surfdash post), 创作来源, cover, audio material. The brand strings
        // are this daily show's constants; every field here is consumed by `wechatmp-pub`'s flow.
        const cover = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
        const audio = join(workDir, '30-audio', `${runDate}_11_generate_content.mp3`);
        const surfdashResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
        const originalUrl = isFile(surfdashResult) ? firstTargetUrl(readJson(surfdashResult), 'surfdash-pub') : '';
        const wechatmp: Record<string, unknown> = {
            original: true,
            // 赞赏 is enabled per episode; the plugin fills the 赞赏账户 only when the platform
            // leaves it empty (it defaults from 作者, operator walk 2026-10-10).
            reward: true,
            author: '冰原奔狼',
            collection: collectionArg || '每日AI资讯',
            // 创作来源 is the column's own stance, not an AI-declaration label — the operator owns
            // the wording (2026-10-10).
            claimSource: '个人观点，仅供参考',
            // 封面 comes from 图片库: the episode cover is uploaded there as the audio material's
            // cover, so the library's newest entry is the intended image.
            coverSource: 'library',
            ...(originalUrl !== '' ? { originalUrl } : {}),
            ...(isFile(cover) ? { coverPath: cover } : {}),
            // Audio block at the article top (operator request 2026-09-29; the plugin UPLOADS the
            // material when the 素材库 has no same-title entry, 2026-10-10).
            ...(isFile(audio)
                ? {
                      audioPath: audio,
                      audioTitle: typeof packaged.title === 'string' ? packaged.title : '',
                      audioCoverPath: isFile(cover) ? cover : '',
                  }
                : {}),
        };
        // WeChat-only closing line (operator request 2026-09-29): point readers/listeners back to
        // the show's platforms. Appended to the wechat input body only, never the master article.
        const outro = '\n\n欲听往期节目，可至小宇宙、Apple Podcast、YouTube 等平台搜索【咸话咸说】。';
        sted('write', input, () =>
            writeJsonText(input, {
                ...packaged,
                body: `${typeof packaged.body === 'string' ? packaged.body : ''}${outro}`,
                metadata: { ...metadataOf(packaged), publishStatus: want, wechatmp },
            }),
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
            writeJsonText(input, {
                ...packaged,
                metadata: {
                    ...metadataOf(packaged),
                    publishStatus: want,
                    ...(followUp === undefined ? {} : { followUps: [followUp] }),
                },
            }),
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
    const metadata = metadataOf(prep);
    return {
        ...prep,
        metadata: {
            ...metadata,
            operation: '发播客',
            audio: metadata.audioFile,
            publishStatus,
        },
    };
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
        const path = join(workDir, SAFETY_REVISE_COUNT);
        const next = readSafetyReviseCount(workDir) + 1;
        sted('write', path, () => writeFileSync(path, `${next}\n`));
        console.log(`safety-revise: remediation pass ${next} applied; drafts re-validated`);
    });
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

/** Measured driver rates from dailyGenerate. Unknown drivers (incl. voxcpm, provisionally) use the voicebox rate. */
function spokenCharRate(vdriver: string): number {
    return vdriver === 'gemini' ? 5.4 : 5.6;
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
 * marker = locale absent (callers skip). Reuses an existing on-disk draft as the
 * cache across run retries — re-scaffolding would erase the agent's translation.
 */
export function dailyTranslateLocalize(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    // Same seam as show-notes (task 0137): `_17_publish_result.json` is written later by
    // publish-classify, which depends on translate-sync. Reading it here always saw no zh
    // path, so en/ja were never scaffolded (2026-10-08 dogfood).
    const result = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
    const zhFile = join(workDir, '31-publish', `${runDate}_20_translate-localize_zh-post-path.txt`);
    timed(workDir, 'translate-localize', () => {
        const postPath = firstPostPath(readJson(result), 'surfdash-pub');
        const zh = postPath.endsWith('index.md') ? postPath : '';
        sted('write', zhFile, () => writeRaw(zhFile, zh));
        if (zh === '') {
            for (const target of ['en', 'ja'] as const) {
                sted(
                    'write',
                    join(workDir, '31-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`),
                    () =>
                        writeRaw(
                            join(workDir, '31-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`),
                            '',
                        ),
                );
            }
            console.log('no zh post path — skip localize');
            return;
        }
        for (const target of ['en', 'ja'] as const) {
            const markerFile = join(workDir, '31-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`);
            const existing = zh.replace('/zh/', `/${target}/`);
            if (isFile(existing)) {
                sted('write', markerFile, () => writeRaw(markerFile, existing));
                console.log(`${target} draft cached: ${existing}`);
                continue;
            }
            const scaffold = join(workDir, '31-publish', `${runDate}_20_translate-localize_scaffold-${target}.json`);
            const scaffoldResult = join(
                workDir,
                '31-publish',
                `${runDate}_20_translate-localize_scaffold-${target}-result.json`,
            );
            sted('write', scaffold, () =>
                writeJqText(scaffold, { body: '', options: { operation: 'scaffold-locale', postPath: zh, target } }),
            );
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
            sted('write', markerFile, () => writeRaw(markerFile, typeof draftPath === 'string' ? draftPath : ''));
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
        const zhPostPath = isFile(zhPathFile) ? readFileSync(zhPathFile, 'utf-8') : '';
        if (zhPostPath === '') {
            console.log('no zh post path — skip translate-sync');
            return;
        }
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
                for (let attempt = 0; result.status !== 0 && attempt < XHS_OVERFLOW_ATTEMPTS; attempt += 1) {
                    // 0251 R1 (+ the block-level rule 2): only a points[n] safe-area overflow is
                    // rewritable. The envelope is rewritten in the same shape and image-gen is called
                    // again; a failure that no rewrite addresses takes the resume line immediately.
                    const named = xhsOverflowPoints(result.stderr, card);
                    if (named === null || !reduceOverflowingPoints(card.points, named)) break;
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
