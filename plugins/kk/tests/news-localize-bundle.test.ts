import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0409 R1 (AC1) — the frozen `article` variant carries the en/ja translations.
 *
 * `kk news generate-bundle --stage variants` builds the surfdash payload from
 * `22-article/<date>_06_article_content.json`; the localize step leaves
 * `22-article/locales/{en,ja}.md` beside it. The variant must carry them as
 * `metadata.surfdash.locales.{en,ja}`, because the freeze digest covers the variant bytes and
 * `surfdash-pub` writes exactly what the payload names — translating after the freeze would publish
 * bytes the safety review never saw.
 *
 * Spawned out of process (daily-stages.ts is a stage runner; importing it registers its body with
 * coverage and breaks the bunfig threshold — see daily-publish-path-0329.test.ts).
 */
const runner = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const DATE = '20261119';

function seedWork(root: string, locales: { en?: string; ja?: string }): string {
    const work = join(root, 'work');
    mkdirSync(join(work, '22-article', 'locales'), { recursive: true });
    mkdirSync(join(work, '31-publish'), { recursive: true });
    writeFileSync(
        join(work, '22-article', `${DATE}_06_article_content.json`),
        JSON.stringify({
            title: '每日AI乱炖',
            format: 'markdown',
            body: '中文正文。',
            metadata: { date: '2026-11-19' },
        }),
    );
    for (const [locale, body] of Object.entries(locales)) {
        if (body === undefined) continue;
        writeFileSync(join(work, '22-article', 'locales', `${locale}.md`), body, 'utf-8');
    }
    return work;
}

function variant(work: string): {
    metadata?: { surfdash?: { locales?: Record<string, { title?: string; body?: string }> } };
} {
    return JSON.parse(readFileSync(join(work, '30-variants', 'article.content.json'), 'utf-8'));
}

const EN = '# Daily AI Stew · 2026-11-19\n\nDisney agreed to buy Character.AI.\n';
const JA = '# デイリーAIシチュー · 2026-11-19\n\nディズニーがCharacter.AIの買収を決めた。\n';

describe('the article variant carries the frozen locale set (0409 AC1)', () => {
    it('embeds metadata.surfdash.locales with the translated title and body', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-0409-locales-'));
        try {
            const work = seedWork(root, { en: EN, ja: JA });
            const result = spawnSync('bun', [runner, 'daily-bundle-variants', 'work', DATE, '', 'false', 'false'], {
                encoding: 'utf-8',
                cwd: root,
            });
            expect(result.status).toBe(0);
            const locales = variant(work).metadata?.surfdash?.locales;
            expect(locales?.en?.title).toBe('Daily AI Stew · 2026-11-19');
            expect(locales?.en?.body).toContain('Disney agreed to buy Character.AI.');
            expect(locales?.ja?.title).toBe('デイリーAIシチュー · 2026-11-19');
            expect(locales?.ja?.body).toContain('ディズニーがCharacter.AIの買収を決めた。');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves the payload without locales when the translations are absent (the R2 refusal then fires)', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-0409-nolocales-'));
        try {
            const work = seedWork(root, {});
            const result = spawnSync('bun', [runner, 'daily-bundle-variants', 'work', DATE, '', 'false', 'false'], {
                encoding: 'utf-8',
                cwd: root,
            });
            expect(result.status).toBe(0);
            expect(variant(work).metadata?.surfdash).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('carries a single present locale rather than inventing the other', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-0409-onelocale-'));
        try {
            const work = seedWork(root, { en: EN });
            const result = spawnSync('bun', [runner, 'daily-bundle-variants', 'work', DATE, '', 'false', 'false'], {
                encoding: 'utf-8',
                cwd: root,
            });
            expect(result.status).toBe(0);
            const locales = variant(work).metadata?.surfdash?.locales;
            expect(locales?.en?.title).toBe('Daily AI Stew · 2026-11-19');
            expect(locales?.ja).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
