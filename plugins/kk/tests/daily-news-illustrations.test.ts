import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 0425 R1 / AC1 — the card series' artwork direction is one shipped skill, reached from every daily
 * card-authoring prompt. The prompts are YAML scalars, so the contract that matters is mechanical:
 * each one names the skill, keeps its own output path and guards, and stays inside the ADR-115
 * error tier. Card copy/points/order ownership is asserted separately by the workflow DAG tests.
 */
const REPO = join(import.meta.dir, '..', '..', '..');
const SKILL = join(import.meta.dir, '..', 'skills', 'daily-news-illustrations', 'SKILL.md');
const NEWS = join(REPO, 'plugins', 'kk', 'workflows', 'kk-news-generate.yaml');
const VOICE1 = join(REPO, 'plugins', 'kk', 'workflows', 'kk-daily-ai-voice.yaml');
const VOICE2 = join(REPO, 'plugins', 'kk', 'workflows', 'kk-daily-ai-voice2.yaml');
const EDITORIAL = join(REPO, 'plugins', 'kk', 'skills', 'news-editorial', 'SKILL.md');

const skill = readFileSync(SKILL, 'utf-8');
const visualRoot = '$' + '{vars.visual_skill_root}';

describe('daily-news-illustrations skill (0425 R1)', () => {
    it('declares the card mode and defers copy/order/pins to their owners', () => {
        expect(skill).toContain('name: daily-news-illustrations');
        expect(skill).toContain('## Mode: card');
        expect(skill).toContain('daily-visual-composition.md');
        // The scene is the whole deliverable; everything else is copied through unchanged.
        for (const owned of ['copy', 'points', 'sourcePoint', 'itemId', 'title', 'body']) {
            expect(skill).toContain(owned);
        }
        // The derived cards stay derived (no new episode-level field).
        expect(skill).toContain('fallback');
        expect(skill).toContain('240');
    });
});

describe('card direction pointers (0425 R1/R2)', () => {
    it('points both legacy xhs-write prompts at card mode, keeping their output path and cap', () => {
        for (const file of [VOICE1, VOICE2]) {
            const text = readFileSync(file, 'utf-8');
            expect(text, file).toContain(`${visualRoot}/daily-news-illustrations/SKILL.md`);
            expect(text, file).toContain('_18_xhs_plan.json');
            expect(text, file).toContain('allowAppend: false');
        }
    });

    it('points the canonical master-plan prompts at card mode beside the cover direction', () => {
        const text = readFileSync(NEWS, 'utf-8');
        expect(text).toContain(`${visualRoot}/daily-news-illustrations/SKILL.md`);
        expect(text).toContain(`${visualRoot}/daily-news-cover/SKILL.md`);
        // The writer skill keeps its own line: copy, points and the plan shape stay editorial.
        expect(text).toContain(`${'$'}{vars.skill_dir}/SKILL.md`);
    });

    it('hands items[].card.subject to the illustrations skill from news-editorial, keeping copy/points there', () => {
        const editorial = readFileSync(EDITORIAL, 'utf-8');
        expect(editorial).toContain('../daily-news-illustrations/SKILL.md');
        // The editorial skill still owns the card slot's copy and points.
        expect(editorial).toContain('`card`: optional per-item card slot');
        expect(editorial).toContain('`cards`: `{ "title"');
    });
});
