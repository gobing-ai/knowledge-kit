import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main';
import { captureOutput } from './capture';

/**
 * 0435 — `kk news status` must read a run's bundle through the same precedence every other reader
 * uses (`resolveBundlePath`: run root first, `4-publish/` fallback).
 *
 * The 2026-11-24 dogfood run reported `"bundle": null` for a run whose bundle was frozen at the run
 * root (0382) and had already published from it: the status surface hard-coded
 * `4-publish/bundle.json`, so it said "nothing shipped" exactly when the news freeze had written one.
 * AC1 pins the root layout, AC2 pins the article layout as a no-change contract.
 */

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: capture.read(), stderr: capture.readErr() };
    } finally {
        capture.restore();
    }
}

interface Fixture {
    root: string;
    workDir: string;
    write: (relPath: string, body: string) => void;
    status: (extra?: string[]) => Promise<{ code: number; payload: Record<string, unknown> }>;
    cleanup: () => void;
}

/** One news run directory; `--work-dir` pins it, so no config or works root is needed. */
function fixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-status-bundle-0435-'));
    const workDir = join(root, '20261124');
    mkdirSync(workDir, { recursive: true });
    const write = (relPath: string, body: string): void => {
        const path = join(workDir, relPath);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, body);
    };
    return {
        root,
        workDir,
        write,
        status: async (extra = []) => {
            const result = await run(['news', 'status', '--run-date', '20261124', '--work-dir', workDir, ...extra]);
            return { code: result.code, payload: JSON.parse(result.stdout) as Record<string, unknown> };
        },
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

/** The bytes `publish-matrix-bundle` freezes: no `frozen` boolean, `contentType` is the freeze mark. */
function frozenNewsBundle(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        runId: '20261124-gen-1',
        runDate: '2026-11-24',
        contentType: 'news',
        parentRunId: 'gen-1',
        runs: ['gen-1'],
        episode: { title: '每日AI乱炖 · 2026-11-24' },
        variants: {
            episode: { path: '30-variants/episode.content.json', sha256: 'a'.repeat(64) },
            article: { path: '30-variants/article.content.json', sha256: 'b'.repeat(64) },
        },
    };
}

describe('kk news status reads the bundle through resolveBundlePath (0435)', () => {
    it('reports a frozen root bundle instead of null (AC1, R1/R2)', async () => {
        const fx = fixture();
        fx.write('bundle.json', JSON.stringify(frozenNewsBundle(), null, 2));
        const { code, payload } = await fx.status();
        expect(code).toBe(0);
        const bundle = payload.bundle as Record<string, unknown>;
        expect(bundle).not.toBeNull();
        expect(bundle.frozen).toBe(true);
        expect(bundle.runId).toBe('20261124-gen-1');
        expect(bundle.variants).not.toBeNull();
        expect(Object.keys(bundle.variants as Record<string, unknown>).sort()).toEqual(['article', 'episode']);
        expect(bundle.variantCount).toBe(2);
        fx.cleanup();
    });

    it('prefers the root bundle over a leftover 4-publish copy (AC1, R1)', async () => {
        const fx = fixture();
        fx.write('bundle.json', JSON.stringify(frozenNewsBundle(), null, 2));
        fx.write(
            '4-publish/bundle.json',
            JSON.stringify({ frozen: true, runId: '20261124-stale', variants: { zh: { path: 'zh.json' } } }),
        );
        const { payload } = await fx.status();
        expect((payload.bundle as Record<string, unknown>).runId).toBe('20261124-gen-1');
        fx.cleanup();
    });

    it('keeps the article layout reporting exactly what it reported before (AC2, R3)', async () => {
        const fx = fixture();
        fx.write(
            '4-publish/bundle.json',
            JSON.stringify({ frozen: true, runId: 'article-1', variants: { article: { path: 'content.json' } } }),
        );
        const { code, payload } = await fx.status();
        expect(code).toBe(0);
        // Byte-for-byte the pre-0435 summary: frozen/runId/variants, and no root-layout additions.
        expect(payload.bundle).toEqual({
            frozen: true,
            runId: 'article-1',
            variants: { article: { path: 'content.json' } },
        });
        fx.cleanup();
    });

    it('keeps the article layout `frozen: null` when the bundle carries no frozen boolean (AC2, R3)', async () => {
        const fx = fixture();
        fx.write('4-publish/bundle.json', JSON.stringify({ runId: 'article-2', variants: {} }));
        const { payload } = await fx.status();
        expect(payload.bundle).toEqual({ frozen: null, runId: 'article-2', variants: {} });
        fx.cleanup();
    });
});
