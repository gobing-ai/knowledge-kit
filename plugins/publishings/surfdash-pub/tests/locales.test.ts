import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { PostsurfingFileCliTransport } from '../src/index';

/**
 * Task 0409 R2: the daily digest needs zh/en/ja on disk before the site orchestrator runs, because
 * `discoverLocaleFiles` refuses a `sub-category:ai-daily` post whose locale set is incomplete
 * (`publish-orchestrator.ts` ~586-604). The article Content now carries the translations
 * (`metadata.surfdash.locales`), so `publish` materializes them and refuses early when one is absent
 * — never reaching the site's opaque `missing locale file(s)` failure.
 */

const ROOT = join(process.cwd(), '.tmp-surfdash-fixture-locales');
const SLUG = '20261119-ai-2026-11-19';

/** A surfdash checkout stub: the articles tree plus a postsurfing bin that logs one line per spawn. */
function writeStubRoot(root: string): { bin: string; spawnLog: string; coverUrl: string } {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const bin = join(root, 'postsurfing');
    const spawnLog = join(root, 'postsurfing-args.log');
    writeFileSync(
        bin,
        [
            '#!/usr/bin/env bun',
            "import { appendFileSync } from 'node:fs';",
            `appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
        ].join('\n'),
        'utf-8',
    );
    Bun.spawnSync(['chmod', '+x', bin]);
    return {
        bin,
        spawnLog,
        coverUrl: 'https://podcast-media.salty.vip/production/images/item-test.png',
    };
}

/** A digest article Content with zh plus the locales the localize step produced. */
function digestContent(coverPath: string, locales: Record<string, { title: string; body: string }>): Content {
    return {
        title: `每日AI乱炖 · 2026-11-19`,
        body: '# 每日AI乱炖\n\n中文正文。\n',
        format: 'markdown',
        metadata: {
            runDate: '20261119',
            tags: ['ai-news', 'sub-category:ai-daily'],
            coverImage: coverPath,
            surfdash: { locales },
        },
    };
}

const EN = { title: 'Daily AI Stew · 2026-11-19', body: '# Daily AI Stew\n\nEnglish body.\n' };
const JA = { title: 'デイリーAIシチュー · 2026-11-19', body: '# デイリーAIシチュー\n\n日本語の本文。\n' };

function localePath(locale: string): string {
    return join(ROOT, 'content', 'posts', 'articles', locale, SLUG, 'index.md');
}

const savedEnv = { root: process.env.SURFDASH_ROOT, bin: process.env.POSTSURFING_BIN };

afterEach(() => {
    if (savedEnv.root === undefined) delete process.env.SURFDASH_ROOT;
    else process.env.SURFDASH_ROOT = savedEnv.root;
    if (savedEnv.bin === undefined) delete process.env.POSTSURFING_BIN;
    else process.env.POSTSURFING_BIN = savedEnv.bin;
    rmSync(ROOT, { recursive: true, force: true });
});

describe('surfdash-pub locale set (0409 R2)', () => {
    test('AC3 — writes zh/en/ja with remote cover and spawns postsurfing once with the zh path', async () => {
        const { bin, spawnLog, coverUrl } = writeStubRoot(ROOT);
        process.env.SURFDASH_ROOT = ROOT;
        process.env.POSTSURFING_BIN = bin;

        const result = await new PostsurfingFileCliTransport().publish({
            content: digestContent(coverUrl, { en: EN, ja: JA }),
        });

        for (const locale of ['zh', 'en', 'ja']) {
            expect(existsSync(localePath(locale))).toBe(true);
            const md = readFileSync(localePath(locale), 'utf-8');
            expect(md).toContain(coverUrl);
            expect(existsSync(join(ROOT, 'content', 'posts', 'articles', locale, SLUG, 'assets', 'cover.png'))).toBe(
                false,
            );
        }
        const en = readFileSync(localePath('en'), 'utf-8');
        expect(en).toContain('Daily AI Stew');
        expect(en).toContain('English body.');
        expect(readFileSync(localePath('ja'), 'utf-8')).toContain('日本語の本文。');

        const spawns = readFileSync(spawnLog, 'utf-8').trim().split('\n');
        expect(spawns).toHaveLength(1);
        expect(JSON.parse(spawns[0] as string)).toEqual(['publish', localePath('zh')]);
        // The refusal did not fire: the run reached the site's own refine contract.
        expect(result.ok).toBe(false);
        expect(result.error).toContain('refine step did not run');
    });

    test('AC4 — a missing locale is refused before any spawn, effect none', async () => {
        const { bin, spawnLog, coverUrl } = writeStubRoot(ROOT);
        process.env.SURFDASH_ROOT = ROOT;
        process.env.POSTSURFING_BIN = bin;

        const result = await new PostsurfingFileCliTransport().publish({
            content: digestContent(coverUrl, { en: EN }),
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('ja');
        expect(result.error).toContain('missing');
        expect((result.metadata?.itcDelivery as { effect?: string } | undefined)?.effect).toBe('none');
        expect(existsSync(spawnLog)).toBe(false);
    });

    test('an empty locale body counts as missing (an untranslated locale is not a locale)', async () => {
        const { bin, spawnLog, coverUrl } = writeStubRoot(ROOT);
        process.env.SURFDASH_ROOT = ROOT;
        process.env.POSTSURFING_BIN = bin;

        const result = await new PostsurfingFileCliTransport().publish({
            content: digestContent(coverUrl, { en: EN, ja: { title: JA.title, body: '   ' } }),
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('ja');
        expect(existsSync(spawnLog)).toBe(false);
    });

    test('a refined non-primary locale is kept, not re-minted', async () => {
        const { bin, coverUrl } = writeStubRoot(ROOT);
        process.env.SURFDASH_ROOT = ROOT;
        process.env.POSTSURFING_BIN = bin;
        mkdirSync(join(ROOT, 'content', 'posts', 'articles', 'en', SLUG), { recursive: true });
        const refined = '---\ntitle: "site-owned"\nrefined: true\n---\n\nsite-owned body\n';
        writeFileSync(localePath('en'), refined, 'utf-8');

        await new PostsurfingFileCliTransport().publish({
            content: digestContent(coverUrl, { en: EN, ja: JA }),
        });

        expect(readFileSync(localePath('en'), 'utf-8')).toBe(refined);
        expect(readFileSync(localePath('ja'), 'utf-8')).toContain('日本語の本文。');
    });

    test('a non-digest post keeps writing zh only (the site requires locales for digests alone)', async () => {
        const { bin, spawnLog, coverUrl } = writeStubRoot(ROOT);
        process.env.SURFDASH_ROOT = ROOT;
        process.env.POSTSURFING_BIN = bin;

        const result = await new PostsurfingFileCliTransport().publish({
            content: {
                title: 'AI 2026-11-19',
                body: '# An IT article\n\nBody.\n',
                format: 'markdown',
                metadata: { runDate: '20261119', coverImage: coverUrl },
            },
        });

        expect(existsSync(localePath('zh'))).toBe(true);
        expect(existsSync(localePath('en'))).toBe(false);
        expect(readFileSync(spawnLog, 'utf-8').trim().split('\n')).toHaveLength(1);
        expect(result.error).toContain('refine step did not run');
    });
});
