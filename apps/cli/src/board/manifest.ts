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

/** The fixed artifact manifest for a workflow (empty until 0253/0254 register their entries). */
export function artifactsFor(workflow: WorkflowName): readonly ArtifactSpec[] {
    return workflow === 'kk-collect' ? COLLECT_ARTIFACTS : [];
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
