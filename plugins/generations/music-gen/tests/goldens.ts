import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type MusicBrief, parseMusicBriefYaml } from '../src/brief';
import { type ResolvedJob, resolveJob } from '../src/presets';

/**
 * Golden-fixture access for the 0397 contract tests. Each fixture directory
 * pins one brief plus the bytes kk must produce from it:
 *
 * - `brief.yaml`   — the authored brief (the plugin README's authoring form)
 * - `prompt.txt`   — the exact kk-owned prompt text, plus one POSIX trailing newline
 * - `request.json` — the exact request body, 2-space JSON plus one trailing newline
 */

/** Fixture directory names, in a stable order. */
export const GOLDEN_NAMES = ['clip', 'instrumental', 'lyrics-free', 'pro-with-lyrics'] as const;

export type GoldenName = (typeof GOLDEN_NAMES)[number];

const FIXTURES = join(import.meta.dir, 'fixtures');

/** Absolute path of one fixture file. */
export function fixturePath(name: GoldenName, file: string): string {
    return join(FIXTURES, name, file);
}

/** Parse a fixture brief. */
export function loadGoldenBrief(name: GoldenName): MusicBrief {
    return parseMusicBriefYaml(readFileSync(fixturePath(name, 'brief.yaml'), 'utf8'));
}

/** Resolve a fixture brief with no preset layers (the goldens pin brief-only jobs). */
export function loadGoldenJob(name: GoldenName): ResolvedJob {
    return resolveJob(loadGoldenBrief(name));
}

/** Read the pinned prompt text, dropping the single POSIX trailing newline. */
export function readGoldenPrompt(name: GoldenName): string {
    const text = readFileSync(fixturePath(name, 'prompt.txt'), 'utf8');
    if (!text.endsWith('\n')) {
        throw new Error(`${name}/prompt.txt must end with a newline`);
    }
    return text.slice(0, -1);
}

/** Read the pinned request JSON verbatim (including its trailing newline). */
export function readGoldenRequestJson(name: GoldenName): string {
    return readFileSync(fixturePath(name, 'request.json'), 'utf8');
}
