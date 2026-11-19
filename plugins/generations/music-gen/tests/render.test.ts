import { describe, expect, test } from 'bun:test';
import {
    AVOID_PREFIX,
    INSTANCE_OWNED_PROMPT_MARKERS,
    INSTRUMENTAL_DIRECTIVE,
    renderBriefPrompt,
    renderPromptText,
    renderStructureLine,
} from '../src/render';
import { renderGenerateRequest } from '../src/request';
import { GOLDEN_NAMES, loadGoldenJob, readGoldenPrompt } from './goldens';

/**
 * AC2 — kk renders only the PROMPT box, deterministically and in order (R2).
 * Four committed goldens (pro with lyrics, clip, instrumental, lyrics-free)
 * pin the exact bytes; the segment order and the two instance-owned segments
 * are asserted on the rendered text itself.
 */

describe('AC2 — deterministic prompt rendering', () => {
    for (const name of GOLDEN_NAMES) {
        test(`${name}: renders twice byte-identically and matches the golden`, () => {
            const job = loadGoldenJob(name);
            const first = renderBriefPrompt(job);
            const second = renderBriefPrompt(job);
            expect(second).toBe(first);
            expect(first).toBe(readGoldenPrompt(name));
        });

        test(`${name}: no instance-owned segment leaks into the prompt`, () => {
            const prompt = renderBriefPrompt(loadGoldenJob(name));
            for (const marker of INSTANCE_OWNED_PROMPT_MARKERS) {
                expect(prompt).not.toContain(marker);
            }
        });
    }

    test('segments appear in the documented order', () => {
        const prompt = renderBriefPrompt(loadGoldenJob('pro-with-lyrics'));
        const direction = prompt.indexOf('Warm analog synthwave');
        const avoid = prompt.indexOf(AVOID_PREFIX);
        const firstStructure = prompt.indexOf('[0:00] Intro');
        expect(direction).toBe(0);
        expect(avoid).toBeGreaterThan(direction);
        expect(firstStructure).toBeGreaterThan(avoid);
    });

    test('the instrumental directive is the last segment', () => {
        const prompt = renderBriefPrompt(loadGoldenJob('instrumental'));
        const avoid = prompt.indexOf(AVOID_PREFIX);
        const structure = prompt.indexOf('[0:00] Bed');
        const directive = prompt.indexOf(INSTRUMENTAL_DIRECTIVE);
        expect(avoid).toBeLessThan(structure);
        expect(structure).toBeLessThan(directive);
        expect(prompt.endsWith(INSTRUMENTAL_DIRECTIVE)).toBe(true);
        expect(INSTRUMENTAL_DIRECTIVE).toBe('Instrumental only — no vocals.');
    });

    test('an empty avoid list omits the segment entirely', () => {
        const prompt = renderBriefPrompt(loadGoldenJob('clip'));
        expect(prompt).not.toContain(AVOID_PREFIX);
        expect(prompt).not.toContain('[0:');
        expect(prompt).toBe(readGoldenPrompt('clip'));
    });

    test('the instrumental golden sends empty lyrics and carries the directive', () => {
        const job = loadGoldenJob('instrumental');
        expect(job.instrumental.value).toBe(true);
        expect(renderGenerateRequest(job).lyrics).toBe('');
        expect(renderBriefPrompt(job)).toContain(INSTRUMENTAL_DIRECTIVE);
    });

    test('authored lyrics never render into the prompt', () => {
        const job = loadGoldenJob('pro-with-lyrics');
        expect(job.lyrics).toContain('Midnight cable car');
        expect(renderBriefPrompt(job)).not.toContain('Midnight cable car');
    });

    test('a non-instrumental job omits the directive', () => {
        for (const name of ['clip', 'lyrics-free', 'pro-with-lyrics'] as const) {
            expect(renderBriefPrompt(loadGoldenJob(name))).not.toContain(INSTRUMENTAL_DIRECTIVE);
        }
    });

    test('structure lines render with and without a note', () => {
        expect(renderStructureLine({ at: '0:08', section: 'Verse' })).toBe('[0:08] Verse');
        expect(renderStructureLine({ at: '0:08', section: 'Verse', note: 'vocal enters' })).toBe(
            '[0:08] Verse — vocal enters',
        );
    });

    test('interior blank lines of the technical direction survive; edges are trimmed', () => {
        const prompt = renderPromptText({
            style: '\n\nLine one.\n\nLine two.   \n\n',
            avoid: [],
            structure: [],
            instrumental: false,
        });
        expect(prompt).toBe('Line one.\n\nLine two.');
    });

    test('a segment order change is caught by the pinned structure', () => {
        const prompt = renderPromptText({
            style: 'Direction.',
            avoid: ['a'],
            structure: [{ at: '0:10', section: 'Drop' }],
            instrumental: true,
        });
        expect(prompt.split('\n')).toEqual(['Direction.', 'Avoid: a', '[0:10] Drop', 'Instrumental only — no vocals.']);
    });
});
