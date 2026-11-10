import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildCoverSvg,
    COVER_HEIGHT,
    COVER_WIDTH,
    compositeCover,
    logoBadgeSvg,
    wrapHeadline,
} from '../scripts/cover-compositor';

/**
 * 0348 R6 — deterministic cover compositor. Pure template probes run in-process (the module
 * imports only node builtins); the real sips render is mac-only, and its failure path stays
 * platform-neutral (ubuntu has no sips and Bun reports the missing binary the same way).
 */
const HEADLINE = '量子芯片算力暴涨千倍？';

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
        const badge = logoBadgeSvg('assets/general/xhxs.svg', 48, 40, 72, 50);
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

    it('embeds the background, scrim, text shadow and podcast tag on the 1344x576 canvas', () => {
        const svg = buildCoverSvg(base);
        expect(svg).toContain(`width="${COVER_WIDTH}" height="${COVER_HEIGHT}"`);
        expect(svg).toContain(`href="file://${encodeURI('/tmp/bg.png')}"`);
        expect(svg).toContain('url(#bottomScrim)');
        expect(svg).toContain('url(#textShadow)');
        expect(svg).toContain('DAILY AI PODCAST');
    });

    it('styles a single headline white 46px and a second line signal yellow 32px', () => {
        const single = buildCoverSvg(base);
        expect(single).toContain('font-size="46" font-weight="800" fill="#FFFFFF"');
        expect(single).not.toContain('#FFB800');

        const two = buildCoverSvg({ ...base, headline: `${HEADLINE}\n全球科技巨头底层暗战打响！` });
        expect(two).toContain('font-size="32" font-weight="700" fill="#FFB800"');
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

    itMacOnly('does not leave the intermediate svg behind', () => {
        withTempDir((dir) => {
            const bg = join(dir, 'bg.png');
            writeFileSync(bg, PNG_BYTES);
            compositeCover({ backgroundImagePath: bg, headline: HEADLINE, outputPath: join(dir, 'cover.png') });
            const leftovers = readdirSync(tmpdir()).filter((f) => f.startsWith('cover-composite-'));
            expect(leftovers).toHaveLength(0);
        });
    });
});
