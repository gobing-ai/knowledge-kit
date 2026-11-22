import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildCoverSvg,
    COVER_HEIGHT,
    COVER_WIDTH,
    compositeCover,
    compositeSocialCover,
    deriveSocialCoverFromImage,
    layoutHeadline,
    logoBadgeSvg,
    logoRect,
    wrapHeadline,
} from '../scripts/cover-compositor';

/**
 * 0348 R6 — deterministic cover compositor. Pure template probes run in-process (the module
 * imports only node builtins); the real sips render is mac-only, and its failure path stays
 * platform-neutral (ubuntu has no sips and Bun reports the missing binary the same way).
 */
const HEADLINE = '量子芯片算力暴涨千倍？';
/** The shipped emblem, resolved from this file so the badge probes do not depend on cwd. */
const SHIPPED_LOGO = join(import.meta.dir, '../../../assets/general/xhxs.svg');

const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'cover-compositor-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function pixelSize(pngPath: string): { width: string; height: string } {
    const probe = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', pngPath], { encoding: 'utf-8' });
    expect(probe.status).toBe(0);
    const width = /pixelWidth: (\d+)/.exec(probe.stdout)?.[1] ?? '';
    const height = /pixelHeight: (\d+)/.exec(probe.stdout)?.[1] ?? '';
    return { width, height };
}

let consoleErrorSpy: { mockRestore(): void };
beforeEach(() => {
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleErrorSpy.mockRestore());

describe('wrapHeadline', () => {
    it('keeps an explicit two-line headline', () => {
        expect(wrapHeadline('量子芯片算力暴涨千倍？\n全球科技巨头底层暗战打响！')).toEqual([
            '量子芯片算力暴涨千倍？',
            '全球科技巨头底层暗战打响！',
        ]);
    });

    it('chunks a long single-line headline at 25 code points per line', () => {
        const line = '一'.repeat(30);
        const wrapped = wrapHeadline(line);
        expect(wrapped).toHaveLength(2);
        expect(Array.from(wrapped[0])).toHaveLength(25);
        expect(wrapped[1]).toBe('一'.repeat(5));
    });

    it('truncates past two lines with an ellipsis', () => {
        const wrapped = wrapHeadline('一'.repeat(60));
        expect(wrapped).toHaveLength(2);
        expect(wrapped[1].endsWith('…')).toBe(true);
        expect(Array.from(wrapped[1]).length).toBeLessThanOrEqual(25);
    });

    it('drops blank explicit lines and returns a single line untouched', () => {
        expect(wrapHeadline('头条')).toEqual(['头条']);
        expect(wrapHeadline('头条\n\n\n次条')).toEqual(['头条', '次条']);
    });
});

describe('logoBadgeSvg', () => {
    it('inlines the real emblem re-clipped to viewBox 0 0 1095 760 at the badge geometry', () => {
        const badge = logoBadgeSvg(SHIPPED_LOGO, 48, 40, 72, 50);
        expect(badge).toContain('viewBox="0 0 1095 760"');
        expect(badge).toContain('x="48" y="40" width="72" height="50"');
        expect(badge).toContain('<path d="M0.25 0.25');
    });

    it('omits the badge when the logo asset is missing', () => {
        expect(logoBadgeSvg('/nonexistent/xhxs.svg', 48, 40, 72, 50)).toBe('');
    });

    it('omits the badge when the asset is not a parseable svg', () => {
        const dir = mkdtempSync(join(tmpdir(), 'cover-compositor-'));
        try {
            const fake = join(dir, 'fake.svg');
            writeFileSync(fake, 'definitely not svg');
            expect(logoBadgeSvg(fake, 48, 40, 72, 50)).toBe('');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('buildCoverSvg', () => {
    const base = { backgroundImagePath: '/tmp/bg.png', headline: HEADLINE };

    it('embeds the background, scrim, a filter-free text shadow and the podcast tag on the 1344x576 canvas', () => {
        const svg = buildCoverSvg(base);
        expect(svg).toContain(`width="${COVER_WIDTH}" height="${COVER_HEIGHT}"`);
        expect(svg).toContain(`href="file://${encodeURI('/tmp/bg.png')}"`);
        expect(svg).toContain('url(#bottomScrim)');
        // 2026-11-12 regression: `sips` drops every `<text>` carrying an SVG filter, so the
        // headline (the only journalistic content on the cover) silently disappeared. The shadow
        // must stay pure geometry: no filter attribute anywhere in the document.
        expect(svg).not.toContain('<filter');
        expect(svg).not.toContain('filter=');
        expect(svg).toContain('fill-opacity="0.72"');
        expect(svg).toContain('DAILY AI PODCAST');
    });

    it('draws each headline row twice — dark offset behind the visible line — without a filter', () => {
        const headline = `${HEADLINE}\n全球科技巨头底层暗战打响！`;
        const svg = buildCoverSvg({ ...base, headline });
        const layout = layoutHeadline(headline);
        expect(layout.rows.length).toBeGreaterThan(1);
        for (const row of layout.rows) {
            // visible line + its 3px dark offset, both centered on the canvas midline (0387 R1)
            expect(svg).toContain(`y="${row.y}" text-anchor="middle"`);
            expect(svg).toContain(`y="${row.y + 3}" text-anchor="middle"`);
        }
        expect(svg.match(/DAILY AI PODCAST/g) ?? []).toHaveLength(1);
    });

    // 2026-11-11 regression: `sips` cannot fetch an SVG `<image href="file://…">`, so the real
    // render dropped the AI background and shipped only the overlay chrome as the cover.
    it('embeds a data-URI background when one is supplied (sips cannot read file URLs)', () => {
        const svg = buildCoverSvg({
            backgroundImagePath: '/tmp/bg.png',
            backgroundUri: `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
            headline: HEADLINE,
            logoPath: '/tmp/missing.svg',
        });
        expect(svg).toContain(`href="data:image/png;base64,${PNG_BYTES.toString('base64')}"`);
        expect(svg).not.toContain('file://');
    });

    it('styles the first row white/heavy and every later row signal yellow', () => {
        const single = buildCoverSvg(base);
        const singleLayout = layoutHeadline(HEADLINE);
        expect(singleLayout.rows).toHaveLength(1);
        expect(single).toContain(`font-size="${singleLayout.rows[0].size}" font-weight="800" fill="#FFFFFF"`);
        expect(single).not.toContain('#FFB800');

        const headline = `${HEADLINE}\n全球科技巨头底层暗战打响！`;
        const two = buildCoverSvg({ ...base, headline });
        for (const row of layoutHeadline(headline).rows.slice(1)) {
            expect(two).toContain(`font-size="${row.size}" font-weight="700" fill="#FFB800"`);
        }
    });

    it('XML-escapes model-authored headline text', () => {
        const svg = buildCoverSvg({ ...base, headline: 'A & B <C>' });
        expect(svg).toContain('A &amp; B &lt;C&gt;');
        expect(svg).not.toContain('A & B <C>');
    });

    it('renders without the badge when the logo asset is absent', () => {
        const svg = buildCoverSvg({ ...base, logoPath: '/nonexistent/xhxs.svg' });
        expect(svg).not.toContain('viewBox="0 0 1095 760"');
    });

    it('places the scaled-down emblem in the top-right corner with no opaque plate (0387 R1)', () => {
        const svg = buildCoverSvg({ ...base, logoPath: SHIPPED_LOGO });
        const badge = logoRect();
        expect(svg).toContain(`x="${badge.x}" y="${badge.y}" width="${badge.width}" height="${badge.height}"`);
        expect(badge.x + badge.width).toBeLessThanOrEqual(COVER_WIDTH - badge.y);
        // transparency: the old `<rect ... fill-opacity="0.7">` badge plate is gone
        expect(svg).not.toContain('fill-opacity="0.7"');
    });
});

describe('compositeCover', () => {
    const itMacOnly = it.skipIf(process.platform !== 'darwin');

    itMacOnly('renders a 1344x576 PNG from the svg overlay', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            const out = join(dir, 'cover.png');
            writeFileSync(bg, PNG_BYTES);
            const result = compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: out });
            expect(result).toBe(out);
            expect(existsSync(out)).toBe(true);
            const { width, height } = pixelSize(out);
            expect(width).toBe('1344');
            expect(height).toBe('576');
        });
    });

    it('fails loud when the render cannot produce the output', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            writeFileSync(bg, PNG_BYTES);
            const doomed = join(dir, 'missing-dir', 'cover.png');
            expect(() => compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: doomed })).toThrow(
                /cover compositor/,
            );
            expect(existsSync(doomed)).toBe(false);
        });
    });

    it('throws when sips binary is missing or invocation errors', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            writeFileSync(bg, PNG_BYTES);
            const spy = spyOn(childProcess, 'spawnSync').mockReturnValue({
                status: null,
                error: new Error('ENOENT'),
            } as unknown as childProcess.SpawnSyncReturns<Buffer>);
            try {
                expect(() =>
                    compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: join(dir, 'cover.png') }),
                ).toThrow(/sips not found; cannot render the cover overlay \(macOS required\)/);
            } finally {
                spy.mockRestore();
            }
        });
    });

    it('throws when sips exits with non-zero status', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            writeFileSync(bg, PNG_BYTES);
            const spy = spyOn(childProcess, 'spawnSync').mockReturnValue({
                status: 1,
                error: undefined,
            } as unknown as childProcess.SpawnSyncReturns<Buffer>);
            try {
                expect(() =>
                    compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: join(dir, 'cover.png') }),
                ).toThrow(/sips failed \(status 1\); overlay did not render/);
            } finally {
                spy.mockRestore();
            }
        });
    });

    itMacOnly('does not leave the intermediate svg behind', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            writeFileSync(bg, PNG_BYTES);
            compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: join(dir, 'cover.png') });
            const leftovers = readdirSync(tmpdir()).filter((f) => f.startsWith('cover-composite-'));
            expect(leftovers).toHaveLength(0);
        });
    });

    itMacOnly('compositeSocialCover and deriveSocialCoverFromImage emit 1200x630 JPEG cards', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            const cover = join(dir, 'cover.png');
            const directSocial = join(dir, 'social-direct.jpg');
            const derivedSocial = join(dir, 'social-derived.jpg');
            writeFileSync(bg, PNG_BYTES);

            compositeSocialCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: directSocial });
            expect(pixelSize(directSocial)).toEqual({ width: '1200', height: '630' });

            compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: cover });
            deriveSocialCoverFromImage(cover, derivedSocial);
            expect(pixelSize(derivedSocial)).toEqual({ width: '1200', height: '630' });
        });
    });

    it('deriveSocialCoverFromImage fails loud when sips cannot probe source dimensions', () => {
        expect(() => deriveSocialCoverFromImage('/nonexistent/cover.png', '/tmp/out.jpg')).toThrow(
            /cannot probe dimensions/,
        );
    });
});
