import type { Content } from '@gobing-ai/kk-core';
import type { UnclaimedTake } from './adapter/instance';
import type { AudioFormat } from './brief';
import type { MusicDigestInput } from './digest';

/**
 * Content mapping (task 0398 R5): a resolved + generated job becomes the
 * generator contract's `Content`.
 *
 * - `format: 'audio'` — the `voice-gen` precedent (`plugins/generations/voice-gen/src/index.ts`)
 *   proves audio is a legal generator result.
 * - **body = liner notes**: the kk prompt text, the lyrics, the duration target,
 *   the model, the instance provider, the instance generation id and the analysis
 *   summary when one exists. A person reading `content.json` should never have to
 *   open the sidecar to know what was bought.
 * - **references = the instance audio URL + the kk sidecar path**: the two things
 *   a downstream judge or the operator needs, and no copy of the instance library.
 * - **metadata = the echo**: `language`, `durationTarget` and `batchCount` survive
 *   exactly as the instance recorded them, and are *absent* (never defaulted) when
 *   the manifest lacked them — a defaulted `EN` would deny the instance said nothing.
 */

/** The generator contract's audio format value. */
export const MUSIC_CONTENT_FORMAT = 'audio';

/** What the liner notes need for one take. */
export interface LinerTake {
    takeIndex: number;
    instanceId: string;
    model: string;
    format: AudioFormat;
    language?: string;
    durationTarget?: string;
    batchCount?: number;
    audioUrl?: string;
    /** The kk-owned prompt text, byte for byte what the instance received. */
    prompt: string;
    lyrics?: string;
    /** `analysis.summary` when the instance carried one. */
    analysisSummary?: string;
    adoptedByReconciliation: boolean;
    unclaimed: UnclaimedTake[];
}

/** What the liner notes need for the whole job. */
export interface LinerNotesInput {
    title: string;
    provider: string;
    dryRun: boolean;
    takes: LinerTake[];
}

/** Read `analysis.summary` without trusting the instance's analysis shape. */
export function analysisSummary(analysis: Record<string, unknown> | undefined): string | undefined {
    if (analysis === undefined) {
        return undefined;
    }
    const summary = analysis.summary;
    if (typeof summary === 'string' && summary.trim() !== '') {
        return summary.trim();
    }
    return undefined;
}

/** Render one take's liner-notes block. Deterministic: same take, same lines. */
function renderTakeBlock(take: LinerTake): string[] {
    const lines: string[] = [`## Take ${String(take.takeIndex + 1)}`, ''];
    lines.push(`- instance id: \`${take.instanceId}\``);
    lines.push(`- model: \`${take.model}\``);
    lines.push(`- delivered format: \`${take.format}\``);
    if (take.language !== undefined) {
        lines.push(`- language: \`${take.language}\``);
    }
    if (take.durationTarget !== undefined) {
        lines.push(`- duration target: \`${take.durationTarget}\``);
    }
    if (take.batchCount !== undefined) {
        lines.push(`- batch count: \`${String(take.batchCount)}\``);
    }
    if (take.audioUrl !== undefined) {
        lines.push(`- audio: ${take.audioUrl}`);
    }
    if (take.adoptedByReconciliation) {
        lines.push('- provenance: adopted from `GET /api/generations` after an ambiguous send');
    }
    if (take.unclaimed.length > 0) {
        lines.push(
            `- unclaimed extra takes: ${take.unclaimed.map((entry) => `\`${entry.id}\``).join(', ')} (billed, not adopted)`,
        );
    }
    lines.push('', '### Prompt', '', take.prompt, '');
    lines.push('### Lyrics', '');
    lines.push(
        take.lyrics === undefined
            ? '(none — the model writes its own)'
            : take.lyrics === ''
              ? '(instrumental)'
              : take.lyrics,
    );
    lines.push('');
    lines.push('### Analysis', '');
    lines.push(take.analysisSummary ?? '(no analysis cached on the instance)');
    return lines;
}

/** Render the whole liner-notes body. */
export function renderLinerNotes(input: LinerNotesInput): string {
    const delivered = input.takes.map((take) => take.format);
    const formats = [...new Set(delivered)].join(', ');
    const models = [...new Set(input.takes.map((take) => take.model))].join(', ');
    const header = [
        `# ${input.title}`,
        '',
        `Generated through the \`${input.provider}\` adapter${input.dryRun ? ' (dry run — no instance was called)' : ''}.`,
        '',
        `- provider: \`${input.provider}\``,
        `- model: \`${models}\``,
        `- delivered format: \`${formats}\``,
        `- takes: ${String(input.takes.length)}`,
        '',
    ];
    const blocks = input.takes.flatMap((take) => [...renderTakeBlock(take), '']);
    return [...header, ...blocks].join('\n').replace(/\n+$/, '\n');
}

/** One take as it lands in `Content.metadata.takes[]`. */
export interface ContentTakeRecord {
    takeIndex: number;
    instanceId: string;
    model: string;
    format: AudioFormat;
    requestedFormat: AudioFormat;
    digest: string;
    digestInput: MusicDigestInput;
    artifactPath: string;
    sidecarPath: string;
    unitPrice: number | null;
    adoptedByReconciliation: boolean;
    unclaimed: UnclaimedTake[];
    language?: string;
    durationTarget?: string;
    batchCount?: number;
    audioUrl?: string;
    generatedAt?: string;
    analysisSummary?: string;
}

/**
 * This plugin's `Content.metadata` shape. A type alias, not an interface, so it
 * stays assignable to the contract's `Record<string, unknown>` metadata slot.
 */
export type MusicGenMetadata = {
    generator: 'kk:music-gen';
    provider: string;
    dryRun?: true;
    takes: ContentTakeRecord[];
};

/** What {@link buildMusicContent} needs. */
export interface BuildMusicContentInput {
    title: string;
    provider: string;
    dryRun: boolean;
    liner: LinerTake[];
    takes: ContentTakeRecord[];
}

/**
 * Build the generator `Content`: `format: 'audio'`, liner-notes body, references
 * to the instance audio plus the kk sidecar, and the take records in metadata.
 */
export function buildMusicContent(input: BuildMusicContentInput): Content {
    const references = input.liner.flatMap((take) => {
        const audio =
            take.audioUrl === undefined ? [] : [{ url: take.audioUrl, title: `instance audio — ${take.instanceId}` }];
        const sidecarPath = input.takes.find((record) => record.takeIndex === take.takeIndex)?.sidecarPath;
        const sidecar =
            sidecarPath === undefined ? [] : [{ url: sidecarPath, title: `kk take sidecar — ${take.instanceId}` }];
        return [...audio, ...sidecar];
    });
    const metadata: MusicGenMetadata = {
        generator: 'kk:music-gen',
        provider: input.provider,
        ...(input.dryRun ? { dryRun: true as const } : {}),
        takes: input.takes,
    };
    return {
        title: input.title,
        format: MUSIC_CONTENT_FORMAT,
        body: renderLinerNotes({
            title: input.title,
            provider: input.provider,
            dryRun: input.dryRun,
            takes: input.liner,
        }),
        references,
        metadata,
    };
}
