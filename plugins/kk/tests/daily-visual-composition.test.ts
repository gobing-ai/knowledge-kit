import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 0424 R1 / AC1 — the shipped daily visual direction. The reference is prose, so the contract that
 * makes it usable is structural: every worked example must name a sourced focal subject, a spatial
 * placement and the crop-safe region, and its scene string must satisfy the renderer's own limits.
 * The skill is the entry point the workflows point at, so its modes are pinned here too.
 */
const SKILLS = join(import.meta.dir, '..', 'skills');
const REFERENCE = join(SKILLS, 'news-editorial', 'references', 'daily-visual-composition.md');
const COVER_SKILL = join(SKILLS, 'daily-news-cover', 'SKILL.md');

const reference = readFileSync(REFERENCE, 'utf-8');
const skill = readFileSync(COVER_SKILL, 'utf-8');

/** The `### E<n> — …` example blocks, in declaration order. */
const examples = reference.split(/\n### /).filter((block) => block.startsWith('E'));

describe('daily visual composition reference (0424 R1)', () => {
    it('ships ten composition patterns with the three families named', () => {
        const patterns = [...reference.matchAll(/^\| (\d+) \| /gm)].map((match) => match[1]);
        expect(patterns).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
        for (const family of ['Product-led', 'Comparison', 'Metaphor']) {
            expect(reference).toContain(`**${family}**`);
        }
    });

    it('ships eight worked examples that each name a sourced subject, a placement and a crop-safe region', () => {
        expect(examples).toHaveLength(8);
        for (const example of examples) {
            const label = example.slice(0, 2);
            expect(example, label).toContain('- Source:');
            expect(example, label).toContain('- Focal subject:');
            expect(example, label).toContain('- Placement:');
            expect(example, label).toContain('- Crop-safe:');
            const scene = /- Scene: `([^`]+)`/.exec(example)?.[1];
            expect(scene, `${label} scene`).toBeString();
            // The renderer's own limits: ≤240 chars, English, and no lettering in the artwork.
            expect(scene?.length ?? 0, `${label} scene chars`).toBeLessThanOrEqual(240);
            expect(scene ?? '', `${label} scene digits`).not.toMatch(/[0-9]/);
            expect(scene ?? '', `${label} scene ASCII`).toMatch(/^[a-z][a-z0-9 ,.'-]*$/);
        }
    });

    it('records the canvas facts the compositor owns and the refusals it enforces', () => {
        for (const fact of ['1344 × 576', '1200 × 630', '32 px', 'x 384..960']) {
            expect(reference).toContain(fact);
        }
        expect(reference).toContain('## Refusals');
        for (const refusal of ['lettering', 'logo', 'recognizable real person', '240 characters']) {
            expect(reference).toContain(refusal);
        }
    });
});

describe('daily-news-cover skill (0424 R1/R2)', () => {
    it('declares the two modes the workflows invoke and points at the shared reference', () => {
        expect(skill).toContain('name: daily-news-cover');
        expect(skill).toContain('## Mode: scene');
        expect(skill).toContain('## Mode: brief');
        expect(skill).toContain('daily-visual-composition.md');
        // The skill owns the scene only: the headline and the pins stay with their owners.
        expect(skill).toContain('headline');
        expect(skill).toContain('cover-compositor.ts');
        expect(skill).toContain('240');
    });
});
