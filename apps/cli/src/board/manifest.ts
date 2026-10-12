import { isAbsolute, relative, resolve } from 'node:path';
import type { ArtifactDescriptor, Availability, WorkflowName } from '@gobing-ai/kk-board/contracts';

/**
 * The fixed per-workflow artifact manifests, the capture settings allowlists and the pure
 * availability/path rules the reader and the Collect projection share.
 *
 * Everything here is data + pure functions: an artifact id never becomes a client-supplied
 * path, and a file is never `available` without the selected run's own recorded producer
 * success (docs/design/workflow-board-modules.md §9).
 */

/** The three workflow definitions this reader may inspect. */
export const WORKFLOW_NAMES: readonly WorkflowName[] = ['kk-collect', 'kk-daily-ai-voice2', 'kk-itc'];

/** How one allowlisted setting value is validated at capture time. */
export type SettingRule =
    | { kind: 'integer' }
    | { kind: 'number' }
    | { kind: 'boolean' }
    | { kind: 'duration' }
    | { kind: 'choice'; values: readonly string[] };

/**
 * The per-workflow allowlisted settings (§9). Every key absent from this table — free text,
 * provider blocks, paths, prompts — is uncapturable by construction.
 */
export const WORKFLOW_SETTINGS: Readonly<Record<WorkflowName, Readonly<Record<string, SettingRule>>>> = {
    'kk-collect': {
        limit: { kind: 'integer' },
        horizon_hours: { kind: 'integer' },
    },
    'kk-daily-ai-voice2': {
        window: { kind: 'duration' },
        language: { kind: 'choice', values: ['en', 'zh', 'ja'] },
        vdriver: { kind: 'choice', values: ['voicebox', 'ominivoice', 'gemini'] },
        skip_review: { kind: 'boolean' },
        transcode_mp3: { kind: 'boolean' },
        cover_enabled: { kind: 'boolean' },
        xhs_enabled: { kind: 'boolean' },
        xhs_live: { kind: 'boolean' },
        wechat_enabled: { kind: 'boolean' },
        wechat_live: { kind: 'boolean' },
        plan_translate_enabled: { kind: 'boolean' },
        article_write_enabled: { kind: 'boolean' },
        script_write_enabled: { kind: 'boolean' },
        publish_enabled: { kind: 'boolean' },
        xhs_cards: { kind: 'integer' },
        plan_max_items: { kind: 'integer' },
        safety_max_revise: { kind: 'integer' },
        qc_min_quality: { kind: 'number' },
        qc_min_importance: { kind: 'number' },
        qc_min_urgency: { kind: 'number' },
        qc_min_impact: { kind: 'number' },
        qc_min_episode_items: { kind: 'number' },
        episode_min_minutes: { kind: 'number' },
        episode_max_minutes: { kind: 'number' },
    },
    'kk-itc': {
        research: { kind: 'boolean' },
        judge: { kind: 'boolean' },
        auto: { kind: 'boolean' },
        unslop: { kind: 'boolean' },
        force: { kind: 'boolean' },
        publish_live: { kind: 'boolean' },
        cover_enabled: { kind: 'boolean' },
        inline_images: { kind: 'boolean' },
        max_revisions: { kind: 'integer' },
        source_locale: { kind: 'choice', values: ['en', 'zh', 'ja'] },
    },
};

/** One fixed artifact an allowlisted relative pattern maps to, with its producer identity. */
/**
 * The confidence vocabulary a judge verdict must carry.
 *
 * The nested `kk-daily-safety` / content-judge gate refuses a verdict whose `confidence` is not one
 * of these three spellings, so anything reading such a verdict — the daily projection, and this
 * manifest's judge-verdict artifact declaration — recognizes exactly this vocabulary and reports
 * anything else as an explicit unknown rather than echoing it.
 */
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** One recognized content-judge confidence level. */
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** True when `value` is one of the recognized confidence levels. */
export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
    return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}

/** One declared artifact: a run-workspace-relative pattern plus the producer evidence it needs. */
export interface ArtifactSpec {
    /** Opaque id the client may use; never a path. */
    id: string;
    label: string;
    kind: ArtifactDescriptor['kind'];
    /** Run-workspace-relative pattern; `{stamp}` expands to the captured run stamp. */
    pattern: string;
    /** The state/node that must have recorded a successful attempt. */
    producerNode: string;
    /** The `actionKey` a state-machine action must record. */
    producerActionKey?: string;
    /** Declared media type for image/audio kinds; the kind is the fallback. */
    mime?: string;
    /**
     * Judge-verdict artifacts only: the levels a PASS may carry. Its presence marks the artifact as
     * a verdict whose recorded `confidence` must be validated against this vocabulary.
     */
    confidenceVocabulary?: readonly ConfidenceLevel[];
}

/** kk-collect's fixed artifact manifest (producer action keys per §9). */
export const COLLECT_ARTIFACTS: readonly ArtifactSpec[] = [
    {
        id: 'blended',
        label: 'Blended sources',
        kind: 'json',
        pattern: '10-ingest/{stamp}_02_collect_blended.json',
        producerNode: 'collect',
        producerActionKey: 'collect:onEnter:0',
    },
    {
        id: 'facts',
        label: 'Core facts',
        kind: 'text',
        pattern: '20-facts/{stamp}_02_collect_core-facts.md',
        producerNode: 'collect',
        producerActionKey: 'collect:onEnter:1',
    },
    {
        id: 'store-result',
        label: 'Store ingest counts',
        kind: 'json',
        pattern: 'store-result.json',
        producerNode: 'store',
        producerActionKey: 'store:onEnter:0',
    },
    {
        id: 'label-result',
        label: 'Label pass result',
        kind: 'text',
        pattern: 'label-result.txt',
        producerNode: 'label',
        producerActionKey: 'label:onEnter:0',
    },
];

/**
 * kk-daily-ai-voice2's fixed artifact manifest (producer nodes per §9). The daily workflow is a
 * DAG, so a producer is identified by its node id and the recorded run-detail action row — never by
 * a state-machine `actionKey`. Patterns use the run's digits-only date as `{stamp}`.
 */
export const DAILY_VOICE_ARTIFACTS: readonly ArtifactSpec[] = [
    {
        id: 'article-body',
        label: 'Article body',
        kind: 'text',
        pattern: '22-article/{stamp}_06_article_article.md',
        producerNode: 'article',
    },
    {
        id: 'article-content',
        label: 'Article content',
        kind: 'json',
        pattern: '22-article/{stamp}_06_article_content.json',
        producerNode: 'article',
    },
    {
        id: 'cover',
        label: 'Cover image',
        kind: 'image',
        pattern: '23-cover/{stamp}_07_cover_cover.png',
        producerNode: 'cover-normalize',
        mime: 'image/png',
    },
    {
        id: 'script',
        label: 'VoiceScript',
        kind: 'text',
        pattern: '24-script/{stamp}_08_script_voicescript.yaml',
        producerNode: 'script',
    },
    {
        id: 'safety-verdict',
        label: 'Content safety verdict',
        kind: 'json',
        pattern: '24-script/{stamp}_09_safety-judge_verdict.json',
        producerNode: 'safety',
        // A PASS here is only usable with one of these levels; the projection nulls anything else.
        confidenceVocabulary: CONFIDENCE_LEVELS,
    },
    {
        id: 'safety-report',
        label: 'Content safety review',
        kind: 'json',
        pattern: '24-script/{stamp}_09_safety-review_report.json',
        producerNode: 'safety',
    },
    {
        id: 'audio',
        label: 'Episode audio',
        kind: 'audio',
        pattern: '30-audio/{stamp}_11_generate_content.mp3',
        producerNode: 'generate',
        mime: 'audio/mpeg',
    },
    {
        id: 'audio-record',
        label: 'Audio generation record',
        kind: 'json',
        pattern: '30-audio/{stamp}_11_generate_content.json',
        producerNode: 'generate',
    },
    {
        id: 'surfdash-result',
        label: 'SurfDash result',
        kind: 'json',
        pattern: '31-publish/{stamp}_14_publish-surfdash_result.json',
        producerNode: 'publish-surfdash',
    },
    {
        id: 'show-notes',
        label: 'Show notes',
        kind: 'text',
        pattern: '31-publish/{stamp}_15_show-notes_show-notes.md',
        producerNode: 'show-notes',
    },
    {
        id: 'podcast-result',
        label: 'Podcast result',
        kind: 'json',
        pattern: '31-publish/{stamp}_16_publish-podcast_result.json',
        producerNode: 'publish-podcast',
    },
    {
        id: 'publish-status',
        label: 'Publish status',
        kind: 'text',
        pattern: '31-publish/{stamp}_17_publish_publish-status.txt',
        producerNode: 'publish-classify',
    },
    {
        id: 'xhs-result',
        label: 'Xiaohongshu result',
        kind: 'json',
        pattern: '31-publish/{stamp}_19_publish-xhs_result.json',
        producerNode: 'xhs-publish',
    },
    {
        id: 'wechat-result',
        label: 'WeChat MP result',
        kind: 'json',
        pattern: '31-publish/{stamp}_20_publish-wechat_result.json',
        producerNode: 'wechat-publish',
    },
    {
        id: 'locales-result',
        label: 'Locale sync result',
        kind: 'json',
        pattern: '31-publish/{stamp}_24_translate-sync_sync-result.json',
        producerNode: 'translate-sync',
    },
    {
        id: 'report',
        label: 'Run report',
        kind: 'text',
        pattern: '{stamp}_19_run-report_report.md',
        producerNode: 'run-report',
    },
];

/** The fixed artifact manifest for a workflow (empty until 0253/0254 register their entries). */
export function artifactsFor(workflow: WorkflowName): readonly ArtifactSpec[] {
    if (workflow === 'kk-collect') return COLLECT_ARTIFACTS;
    if (workflow === 'kk-daily-ai-voice2') return DAILY_VOICE_ARTIFACTS;
    return [];
}

/** Look one artifact spec up by its opaque id. */
export function artifactById(workflow: WorkflowName, id: string): ArtifactSpec | undefined {
    return artifactsFor(workflow).find((spec) => spec.id === id);
}

/** Expand a manifest pattern's `{stamp}` placeholder. */
export function expandPattern(pattern: string, stamp: string): string {
    return pattern.replaceAll('{stamp}', stamp);
}

/**
 * Resolve a workspace-relative path, refusing anything that escapes `root` (traversal, an
 * absolute pattern, a null byte). This is the pure string-level gate; the reader re-resolves the
 * canonical path and re-checks containment before AND after each bounded read.
 */
export function resolveWithin(root: string, relativePath: string): string | null {
    if (relativePath.includes('\0')) return null;
    const target = resolve(root, relativePath);
    const rel = relative(root, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    return target;
}

/** How the workspace ownership marker relates to the selected run. */
export type MarkerState = 'owned' | 'foreign' | 'absent' | 'invalid';

/** What the selected run recorded for an artifact's producer. */
export type ProducerState = 'success' | 'failure' | 'pending' | 'unknown';

/** The observed state of the artifact file itself. */
export type FileState = 'present' | 'absent' | 'too-large' | 'unreadable';

/** The pure availability decision: the ONE place a state may become `available`. */
export function resolveAvailability(
    marker: MarkerState,
    producer: ProducerState,
    file: FileState,
    runTerminal: boolean,
): Availability {
    if (marker === 'invalid') return 'invalid';
    if (marker !== 'owned') return marker === 'foreign' ? 'superseded' : 'unverified';
    if (producer === 'unknown') return 'unverified';
    if (producer === 'pending') return runTerminal ? 'missing' : 'pending';
    if (producer === 'failure') return 'missing';
    switch (file) {
        case 'present':
            return 'available';
        case 'absent':
            return 'missing';
        case 'too-large':
            return 'oversized';
        case 'unreadable':
            return 'invalid';
    }
}

/** The allowlisted keys for a workflow (the "uncaptured" set a RunConfig reports). */
export function allowlistedKeys(workflow: WorkflowName): string[] {
    return Object.keys(WORKFLOW_SETTINGS[workflow]);
}
