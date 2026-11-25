/**
 * Task 0432 — a live surfdash page must never read as a failed target because its cover could not
 * be sourced. 2026-11-24 dogfood: `podcast-pub.episode` was held by the safety verdict
 * (`bundle.safety.excludedPlatforms`), so no podcast-media upload happened, `coverUrl` stayed empty
 * and the patch threw `zh post has no remote https:// cover` — while the page was live and its
 * og:image resolved.
 *
 *  P1  no https cover anywhere is a recorded `coverPatch: skipped` diagnostic with the page URL;
 *      the cross-link is still written and nothing throws (R2)
 *  P2  a surfdash-hosted cover patches as before and reports `coverPatch: applied` (R1)
 *  P3  a malformed cover is still a loud argument error — existing validation preserved
 *  P4  `publish` records the cover it uploaded to podcast-media in the result metadata, so the
 *      patch can source it from the surfdash side when the podcast row never ran (R1)
 */
import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { PostsurfingFileCliTransport } from '../src/index';
import { patchPostFiles } from '../src/patch';

// The publish tests run offline: auto-push targets the real surfdash checkout.
process.env.SURFDASH_AUTO_PUSH ??= '0';

const PAGE_URL = 'https://surfing.salty.vip/zh/posts/20261124-261124';

/** A checkout-shaped tree with the locale posts a daily episode leaves behind pre-patch. */
async function withTree<T>(fn: (root: string, postPath: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'sd-cover-0432-'));
    const postPath = join(root, 'content', 'posts', 'articles', 'zh', '20261124-post', 'index.md');
    for (const locale of ['zh', 'en'] as const) {
        const path = postPath.replace('/zh/', `/${locale}/`);
        await mkdir(dirname(path), { recursive: true });
        // The site's refine step leaves the relative asset path, which is exactly the shape the
        // deployed worker cannot serve — hence the patch, and hence this skip.
        await writeFile(path, "---\ntitle: T\npublishDate: '2026-11-24'\nimage: ./assets/cover.png\n---\n\n正文\n");
    }
    try {
        return await fn(root, postPath);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

describe('surfdash cover patch diagnostics (0432)', () => {
    test('P1: no https cover anywhere is a warning with the page URL, not a thrown failure', async () => {
        await withTree(async (root, postPath) => {
            const outcome = await patchPostFiles({
                postPath,
                coverUrl: '',
                showNotesUrl: 'https://podcast.salty.vip/i/ep-1/',
                localCover: join(root, 'no-such-cover.png'),
                dateIso: '2026-11-24',
                pageUrl: PAGE_URL,
            });
            expect(outcome.coverPatch.status).toBe('skipped');
            expect(outcome.coverPatch.skipped).toEqual(['zh', 'en']);
            expect(outcome.coverPatch.applied).toEqual([]);
            expect(outcome.coverPatch.reason).toContain('https:// cover');
            expect(outcome.coverPatch.pageUrl).toBe(PAGE_URL);
            // The skip is a cover-only degradation: the rest of the patch still landed.
            expect(await readFile(postPath, 'utf-8')).toContain('[点击收听《每日AI乱炖 · 2026-11-24》]');
        });
    });

    test('P2: a surfdash-hosted cover URL patches every locale and reports applied', async () => {
        const hosted = 'https://podcast-media.salty.vip/production/images/prepared-cover.png';
        await withTree(async (root, postPath) => {
            const outcome = await patchPostFiles({
                postPath,
                coverUrl: hosted,
                showNotesUrl: '',
                localCover: join(root, 'no-such-cover.png'),
                dateIso: '2026-11-24',
                pageUrl: PAGE_URL,
            });
            expect(outcome.coverPatch).toEqual({
                status: 'applied',
                applied: ['zh', 'en'],
                skipped: [],
                reason: '',
                pageUrl: PAGE_URL,
            });
            expect(outcome.images).toEqual({ zh: hosted, en: hosted });
            expect(await readFile(postPath, 'utf-8')).toContain(`image: '${hosted}'`);
        });
    });

    test('P3: a non-https coverUrl and a non-https upload result stay loud argument errors', async () => {
        await withTree(async (root, postPath) => {
            await expect(
                patchPostFiles({
                    postPath,
                    coverUrl: 'http://insecure.example/cover.png',
                    showNotesUrl: '',
                    localCover: '',
                    dateIso: '2026-11-24',
                }),
            ).rejects.toThrow('coverUrl must be an absolute https:// URL');

            const localCover = join(root, 'cover.png');
            await writeFile(localCover, 'png-bytes');
            await expect(
                patchPostFiles({
                    postPath,
                    coverUrl: '',
                    showNotesUrl: '',
                    localCover,
                    dateIso: '2026-11-24',
                    uploadLocalCover: async () => 'http://insecure.example/cover.png',
                }),
            ).rejects.toThrow('uploaded cover must be an absolute https:// URL');
        });
    });

    test('P5: a failing local-cover upload degrades to the skip warning, naming the upload error', async () => {
        // Review P3: the matrix stage now always passes `localCover`, so an environment failure in the
        // upload (missing base URL/key, presign rejection, network) must not turn a live page into a
        // failed target. The upload error rides the diagnostic so an operator can fix the cause.
        await withTree(async (root, postPath) => {
            const localCover = join(root, 'cover.png');
            await writeFile(localCover, 'png-bytes');
            const outcome = await patchPostFiles({
                postPath,
                coverUrl: '',
                showNotesUrl: '',
                localCover,
                dateIso: '2026-11-24',
                pageUrl: PAGE_URL,
                uploadLocalCover: async () => {
                    throw new Error('MICROFEED_BASE_URL is not set');
                },
            });
            expect(outcome.coverPatch.status).toBe('skipped');
            expect(outcome.coverPatch.skipped).toEqual(['zh', 'en']);
            expect(outcome.coverPatch.uploadError).toBe('MICROFEED_BASE_URL is not set');
            expect(outcome.coverPatch.reason).toContain('local cover upload failed: MICROFEED_BASE_URL is not set');
        });
    });
});

describe('surfdash publish reports the cover it hosted (0432 R1)', () => {
    test('P4: publish metadata carries the podcast-media cover URL it uploaded', async () => {
        const root = await mkdtemp(join(tmpdir(), 'sd-cover-meta-0432-'));
        const cover = join(root, 'cover.png');
        await writeFile(cover, 'png-bytes');
        // The site CLI the transport spawns; auto-push is off, so this only has to exit 0.
        const bin = join(root, 'postsurfing');
        await writeFile(bin, await readFile(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'));
        await chmod(bin, 0o755);
        process.env.SURFDASH_ROOT = root;
        process.env.POSTSURFING_BIN = bin;
        try {
            const content: Content = {
                title: 'Daily Cover Metadata',
                body: '正文',
                format: 'markdown',
                metadata: { coverImage: cover, runDate: '20261124' },
            };
            const result = await new PostsurfingFileCliTransport().publish({
                content,
                options: { dryRun: true },
            });
            expect(result.ok, result.error).toBe(true);
            // The patch's surfdash-side cover source: the URL this publish hosted for the post.
            expect(result.metadata?.coverUrl).toBe(
                'https://podcast-media.salty.vip/production/images/dry-run-cover.png',
            );
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(root, { recursive: true, force: true });
        }
    });
});
