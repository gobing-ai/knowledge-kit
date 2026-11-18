import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
    buildCoverSvg,
    COVER_HEIGHT,
    COVER_WIDTH,
    centerCropRect,
    DEFAULT_LOGO_PATH,
    LOGO_HEIGHT,
    LOGO_WIDTH,
    layoutHeadline,
    logoRect,
    referenceBlendRect,
    SAFE_MARGIN,
    safeAreaRect,
    TARGET_CROPS,
    writeCoverPreviews,
} from '../scripts/cover-compositor';

/**
 * 0387 R1 / AC R8 — 新闻封面兼容中心裁切.
 *
 * The executable evidence for this requirement is geometry + pixels, not prose:
 *  - both target platforms center-crop the 1344x576 cover (`centerCropRect` = WeChat's own
 *    `crop_multi` geometry, 0289 R2), and the headline block sits inside the INTERSECTION of
 *    those crops inset by SAFE_MARGIN — asserted for a short and a maximal (25-char) point;
 *  - the full cover draws the scaled-down emblem in the top-right corner with its own alpha
 *    (no opaque plate), and the reference blend artifact is rendered from the CHECKED-IN
 *    transparent fixture (the operator banner is absent locally — never fabricated);
 *  - the artifacts are real PNGs on disk with asserted dimensions and asserted pixel content
 *    (mean colour probes inside/outside the headline and emblem regions).
 * Pixel probes need `sips`; the geometry half runs on every platform.
 */

const FIXTURE = join(import.meta.dir, '../tests/fixtures/alpha-logo.svg');
const ARTIFACT_DIR = join(import.meta.dir, '../../..', '.spur/run/0387-cover-previews');
const SHORT = '量子芯片算力暴涨千倍？';
const LONG = '重大突破下一代AI深度推理时代正式开启全球科技巨头底层暗战';
const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);
const itMacOnly = it.skipIf(process.platform !== 'darwin');

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'cover-crop-0387-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** A flat, deterministic 1344x576 background (1x1 PNG upscaled by the compositor's `<image>`). */
function background(dir: string): string {
    const path = join(dir, 'bg.png');
    writeFileSync(path, PNG_BYTES);
    return path;
}

/** Mean RGBA of one region: sips crops the region, resamples to 1x1, and a 1x1 PNG unfilters to raw. */
function meanColor(pngPath: string, rect: { x: number; y: number; width: number; height: number }, dir: string) {
    const region = join(dir, 'region.png');
    const pixel = join(dir, 'region-1x1.png');
    const crop = spawnSync(
        'sips',
        [
            '-c',
            String(rect.height),
            String(rect.width),
            '--cropOffset',
            String(rect.y),
            String(rect.x),
            pngPath,
            '--out',
            region,
        ],
        { stdio: 'ignore' },
    );
    expect(crop.status).toBe(0);
    const shrink = spawnSync('sips', ['--resampleHeightWidth', '1', '1', region, '--out', pixel], { stdio: 'ignore' });
    expect(shrink.status).toBe(0);
    const bytes = readFileSync(pixel);
    let offset = 8;
    const idat: Buffer[] = [];
    while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
        offset += 12 + length;
    }
    // 1x1: the filter byte is 0 and the four following bytes are the pixel, whatever the filter.
    const raw = inflateSync(Buffer.concat(idat));
    return { r: raw[1], g: raw[2], b: raw[3], a: raw[4] };
}

/** Summed absolute channel difference between two mean colours. */
function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

let consoleErrorSpy: { mockRestore(): void };
beforeEach(() => {
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleErrorSpy.mockRestore());

describe('target crops (R8 geometry)', () => {
    it('declares exactly the two target platforms with their real center-crop aspects', () => {
        expect(TARGET_CROPS.map((crop) => crop.platform)).toEqual(['wechat-mp', 'podcast-site']);
        expect(TARGET_CROPS[0].aspect).toBe(2.35);
        expect(TARGET_CROPS[1].aspect).toBe(1);
    });

    it('computes both center crops from the actual cover dimensions', () => {
        expect(centerCropRect(COVER_WIDTH, COVER_HEIGHT, 2.35)).toEqual({ x: 0, y: 2, width: 1344, height: 572 });
        expect(centerCropRect(COVER_WIDTH, COVER_HEIGHT, 1)).toEqual({ x: 384, y: 0, width: 576, height: 576 });
        // no hard-coded pixels: the same aspects on a different frame scale
        expect(centerCropRect(1400, 1400, 2.35)).toEqual({ x: 0, y: 402, width: 1400, height: 596 });
    });

    it('rejects impossible dimensions instead of guessing a crop', () => {
        expect(() => centerCropRect(0, 576, 1)).toThrow(/dimensions must be positive/);
        expect(() => centerCropRect(1344, 576, 0)).toThrow(/aspect must be positive/);
        expect(() => safeAreaRect(COVER_WIDTH, COVER_HEIGHT, [])).toThrow(/at least one target crop/);
    });

    it('keeps the safe area inside BOTH platform crops, inset by the margin', () => {
        const safe = safeAreaRect();
        expect(safe).toEqual({ x: 416, y: 34, width: 512, height: 508 });
        for (const crop of TARGET_CROPS) {
            const rect = centerCropRect(COVER_WIDTH, COVER_HEIGHT, crop.aspect);
            expect(safe.x).toBeGreaterThanOrEqual(rect.x + SAFE_MARGIN - 1);
            expect(safe.y).toBeGreaterThanOrEqual(rect.y + SAFE_MARGIN - 1);
            expect(safe.x + safe.width).toBeLessThanOrEqual(rect.x + rect.width);
            expect(safe.y + safe.height).toBeLessThanOrEqual(rect.y + rect.height);
        }
    });

    for (const [name, headline] of [
        ['short', SHORT],
        ['maximal 25-char', LONG],
        ['wrapped two-line', `${SHORT}\n全球科技巨头底层暗战打响！`],
        ['over-long (truncating)', '一'.repeat(80)],
    ] as const) {
        it(`keeps the ${name} headline inside the shared crop intersection`, () => {
            const layout = layoutHeadline(headline);
            const safe = layout.safe;
            expect(layout.rows.length).toBeGreaterThan(0);
            expect(layout.rows.length).toBeLessThanOrEqual(3);
            // every drawn row's estimated box is inside the safe area
            for (const row of layout.rows) {
                expect(row.x - row.width / 2).toBeGreaterThanOrEqual(safe.x);
                expect(row.x + row.width / 2).toBeLessThanOrEqual(safe.x + safe.width);
                expect(row.x).toBe(Math.round(COVER_WIDTH / 2));
            }
            // the block is inside the safe area, hence inside both center crops
            expect(layout.block.x).toBeGreaterThanOrEqual(safe.x);
            expect(layout.block.y).toBeGreaterThanOrEqual(safe.y);
            expect(layout.block.x + layout.block.width).toBeLessThanOrEqual(safe.x + safe.width);
            expect(layout.block.y + layout.block.height).toBeLessThanOrEqual(safe.y + safe.height);
            for (const crop of TARGET_CROPS) {
                const rect = centerCropRect(COVER_WIDTH, COVER_HEIGHT, crop.aspect);
                expect(layout.block.x).toBeGreaterThanOrEqual(rect.x);
                expect(layout.block.y).toBeGreaterThanOrEqual(rect.y);
                expect(layout.block.x + layout.block.width).toBeLessThanOrEqual(rect.x + rect.width);
                expect(layout.block.y + layout.block.height).toBeLessThanOrEqual(rect.y + rect.height);
            }
            // a maximal point needs more than one row at the 1:1-safe width — that is the design
            expect(layout.size).toBeGreaterThanOrEqual(26);
        });
    }

    it('shrinks instead of clipping: the maximal point stays legible and ellipsizes only past 3 rows', () => {
        const maximal = layoutHeadline(LONG);
        expect(maximal.truncated).toBe(false);
        // the shipped 1344x576 frame always fits the ≤2x25 style contract in 3 rows at the floor size
        expect(layoutHeadline('一'.repeat(80)).truncated).toBe(false);
        // a frame whose safe column cannot hold 3 rows of the floor size must ellipsize, never clip
        const cramped = layoutHeadline('一'.repeat(49), 200, 576);
        expect(cramped.truncated).toBe(true);
        expect(cramped.rows[cramped.rows.length - 1].text.endsWith('…')).toBe(true);
        expect(cramped.rows).toHaveLength(3);
        for (const row of cramped.rows) {
            expect(row.x - row.width / 2).toBeGreaterThanOrEqual(cramped.safe.x);
            expect(row.x + row.width / 2).toBeLessThanOrEqual(cramped.safe.x + cramped.safe.width);
        }
    });
});

describe('withheld headline (0385 `coverHeadline: null`)', () => {
    it('lays out no rows and draws no headline text instead of inventing one', () => {
        const layout = layoutHeadline('');
        expect(layout.rows).toEqual([]);
        expect(layout.block).toEqual({ x: layout.safe.x, y: layout.safe.y, width: 0, height: 0 });
        expect(layout.truncated).toBe(false);
        const svg = buildCoverSvg({ backgroundImagePath: '/tmp/bg.png', headline: '' });
        expect(svg).not.toContain('fill-opacity="0.72"'); // no shadow → no headline rows
        expect(svg).toContain('DAILY AI PODCAST');
    });
});

describe('emblem placement (R8 transparency + top-right)', () => {
    it('scales the emblem down and anchors it in the top-right corner', () => {
        const badge = logoRect();
        expect(badge.width).toBe(LOGO_WIDTH);
        expect(badge.height).toBe(LOGO_HEIGHT);
        expect(badge.width).toBeLessThan(72); // the pre-0387 72x50 badge
        expect(badge.x).toBeGreaterThan(COVER_WIDTH / 2);
        expect(badge.x + badge.width).toBe(COVER_WIDTH - badge.y); // symmetric corner margin
        expect(badge.y).toBeLessThan(COVER_HEIGHT / 4);
    });

    it('ships a checked-in transparent emblem fixture (no opaque canvas, per-shape alpha)', () => {
        const svg = readFileSync(FIXTURE, 'utf-8');
        expect(svg).toContain('viewBox="0 0 1095 760"');
        expect(svg).toContain('fill-opacity');
        expect(svg).not.toContain('<rect width="100%"');
        // every shape carries its own alpha (opacity / fill-opacity), none is a solid opaque fill
        expect(svg).not.toMatch(/fill="#[0-9a-fA-F]{6}"\s*\/>/);
    });

    it('defines the reference-blend window around the emblem', () => {
        const blend = referenceBlendRect();
        const badge = logoRect();
        expect(blend.x).toBeLessThanOrEqual(badge.x);
        expect(blend.y).toBeLessThanOrEqual(badge.y);
        expect(blend.x + blend.width).toBe(COVER_WIDTH);
        expect(blend.y + blend.height).toBeLessThanOrEqual(COVER_HEIGHT);
    });
});

describe('preview artifacts (R8 verification products)', () => {
    itMacOnly('writes the full cover, both platform crop previews, the reference blend and a manifest', () => {
        withTempDir((dir) => {
            const manifest = writeCoverPreviews({
                backgroundImagePath: background(dir),
                headline: SHORT,
                outputPath: join(dir, 'cover.png'),
                previewDir: join(dir, 'previews'),
                referenceLogoPath: FIXTURE,
            });
            expect(existsSync(manifest.coverPath)).toBe(true);
            expect(manifest.crops).toHaveLength(2);
            for (const crop of manifest.crops) {
                expect(existsSync(crop.path)).toBe(true);
                const probe = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', crop.path], {
                    encoding: 'utf-8',
                });
                expect(probe.stdout).toContain(`pixelWidth: ${crop.rect.width}`);
                expect(probe.stdout).toContain(`pixelHeight: ${crop.rect.height}`);
            }
            expect(manifest.crops[0].rect).toEqual({ x: 0, y: 2, width: 1344, height: 572 });
            expect(manifest.crops[1].rect).toEqual({ x: 384, y: 0, width: 576, height: 576 });
            expect(existsSync(manifest.referenceCoverPath)).toBe(true);
            expect(existsSync(manifest.referenceBlendPath)).toBe(true);
            expect(manifest.referenceLogoPath).toBe(FIXTURE);
            const written = JSON.parse(readFileSync(join(dir, 'previews', 'manifest.json'), 'utf-8'));
            expect(written.crops).toHaveLength(2);
            expect(written.safeArea).toEqual(safeAreaRect());
        });
    });

    itMacOnly('fails loud when sips cannot write a crop preview', () => {
        withTempDir((dir) => {
            const bg = background(dir);
            const real = childProcess.spawnSync;
            let calls = 0;
            const spy = spyOn(childProcess, 'spawnSync').mockImplementation(((file: string, args: string[]) => {
                calls += 1;
                // the first call is compositeCover's own render; the crop call is faked to fail
                if (calls === 1) return real(file, args);
                return { status: 1, error: undefined } as unknown as childProcess.SpawnSyncReturns<Buffer>;
            }) as typeof childProcess.spawnSync);
            try {
                expect(() =>
                    writeCoverPreviews({
                        backgroundImagePath: bg,
                        headline: SHORT,
                        outputPath: join(dir, 'cover.png'),
                        previewDir: join(dir, 'previews'),
                    }),
                ).toThrow(/sips crop failed \(status 1\)/);
            } finally {
                spy.mockRestore();
            }
        });
    });

    itMacOnly('fails loud when sips reports success without writing the preview', () => {
        withTempDir((dir) => {
            const bg = background(dir);
            const real = childProcess.spawnSync;
            let calls = 0;
            const spy = spyOn(childProcess, 'spawnSync').mockImplementation(((file: string, args: string[]) => {
                calls += 1;
                if (calls === 1) return real(file, args);
                return { status: 0, error: undefined } as unknown as childProcess.SpawnSyncReturns<Buffer>;
            }) as typeof childProcess.spawnSync);
            try {
                expect(() =>
                    writeCoverPreviews({
                        backgroundImagePath: bg,
                        headline: SHORT,
                        outputPath: join(dir, 'cover.png'),
                        previewDir: join(dir, 'previews'),
                    }),
                ).toThrow(/crop preview .* is missing/);
            } finally {
                spy.mockRestore();
            }
        });
    });

    itMacOnly('fails loud when the sips binary is missing mid-way', () => {
        withTempDir((dir) => {
            const bg = background(dir);
            const real = childProcess.spawnSync;
            let calls = 0;
            const spy = spyOn(childProcess, 'spawnSync').mockImplementation(((file: string, args: string[]) => {
                calls += 1;
                if (calls === 1) return real(file, args);
                return { status: null, error: new Error('ENOENT') } as unknown as childProcess.SpawnSyncReturns<Buffer>;
            }) as typeof childProcess.spawnSync);
            try {
                expect(() =>
                    writeCoverPreviews({
                        backgroundImagePath: bg,
                        headline: SHORT,
                        outputPath: join(dir, 'cover.png'),
                        previewDir: join(dir, 'previews'),
                    }),
                ).toThrow(/sips not found; cannot write the crop previews/);
            } finally {
                spy.mockRestore();
            }
        });
    });

    itMacOnly('refuses to claim a reference blend when the emblem is missing', () => {
        withTempDir((dir) => {
            expect(() =>
                writeCoverPreviews({
                    backgroundImagePath: background(dir),
                    headline: SHORT,
                    outputPath: join(dir, 'cover.png'),
                    previewDir: join(dir, 'previews'),
                    referenceLogoPath: join(dir, 'absent-banner.svg'),
                }),
            ).toThrow(/refuse to fake the blend/);
        });
    });

    itMacOnly('the rendered emblem carries real alpha', () => {
        withTempDir((dir) => {
            const png = join(dir, 'emblem.png');
            const rendered = spawnSync('sips', ['-s', 'format', 'png', FIXTURE, '--out', png], { stdio: 'ignore' });
            expect(rendered.status).toBe(0);
            const probe = spawnSync('sips', ['-g', 'hasAlpha', png], { encoding: 'utf-8' });
            expect(probe.stdout).toContain('hasAlpha: yes');
        });
    });

    itMacOnly('draws the headline and the emblem as PIXELS inside the crop-safe regions (short title)', () => {
        withTempDir((dir) => {
            const bg = background(dir);
            const layout = layoutHeadline(SHORT);
            const previewDir = join(dir, 'previews');
            const manifest = writeCoverPreviews({
                backgroundImagePath: bg,
                headline: SHORT,
                outputPath: join(dir, 'cover.png'),
                previewDir,
                referenceLogoPath: FIXTURE,
            });
            // the podcast-site crop (the tight one) must actually contain the headline pixels
            const squareCrop = manifest.crops[1];
            const inCrop = {
                x: Math.round(layout.block.x - squareCrop.rect.x),
                y: layout.block.y,
                width: layout.block.width,
                height: layout.block.height,
            };
            const cropText = meanColor(squareCrop.path, inCrop, dir);
            const cropBackdrop = meanColor(squareCrop.path, { x: 0, y: 0, width: 120, height: 90 }, dir);
            expect(colorDistance(cropText, cropBackdrop)).toBeGreaterThan(30);

            // the emblem only exists on the full cover, top-right, and its alpha blends with the bg
            // SAME BAND as the badge (above the scrim, which starts at 20% height) and beside it: a rect
            // lower down crosses the scrim gradient, whose colour delta alone clears the threshold and made
            // the probe pass on an emblemless cover (0387 review P2, third try).
            const BARE_REGION = { x: 1100, y: 24, width: 56, height: 38 };
            const badge = logoRect();
            const fullEmblem = meanColor(manifest.coverPath, badge, dir);
            const referenceEmblem = meanColor(manifest.referenceCoverPath, badge, dir);
            // The shipped cover must actually CARRY the badge. Probe a genuinely BARE region: `sips
            // --cropOffset 0 0` means "no offset" (a CENTRE crop), so a {0,0} rect samples the headline
            // band and the distance is large even on an emblemless cover — that is why the previous
            // probe passed vacuously (0387 review P2, second clause).
            const coverBackdrop = meanColor(manifest.coverPath, BARE_REGION, dir);
            expect(colorDistance(fullEmblem, coverBackdrop)).toBeGreaterThan(12);
            // …and the reference cover drew the checked-in fixture emblem at the same geometry
            expect(colorDistance(fullEmblem, referenceEmblem)).toBeGreaterThan(0);
            // …and the zoomed blend preview shows it fused over the background
            const window = referenceBlendRect();
            const blend = meanColor(
                manifest.referenceBlendPath,
                { x: badge.x - window.x, y: badge.y - window.y, width: badge.width, height: badge.height },
                dir,
            );
            const blendBackdrop = meanColor(manifest.referenceBlendPath, { x: 0, y: 0, width: 120, height: 90 }, dir);
            expect(colorDistance(blend, blendBackdrop)).toBeGreaterThan(30);

            // nothing of the emblem leaks into the 1:1 crop's left edge (it is full-cover chrome)
            expect(badge.x).toBeGreaterThan(squareCrop.rect.x + squareCrop.rect.width);
        });
    });

    itMacOnly('exports the long-title and short-title previews to the run evidence dir', () => {
        const dir = ARTIFACT_DIR;
        const bgDir = mkdtempSync(join(tmpdir(), 'cover-crop-bg-'));
        try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(bgDir, 'bg.png'), PNG_BYTES);
            const written: string[] = [];
            for (const [name, headline] of [
                ['short', SHORT],
                ['long', LONG],
            ] as const) {
                const previewDir = join(dir, name);
                const manifest = writeCoverPreviews({
                    backgroundImagePath: join(bgDir, 'bg.png'),
                    headline,
                    outputPath: join(dir, `${name}-cover.png`),
                    previewDir,
                    referenceLogoPath: FIXTURE,
                });
                for (const crop of manifest.crops) written.push(crop.path);
                written.push(manifest.coverPath, manifest.referenceCoverPath, manifest.referenceBlendPath);
                expect(manifest.truncated).toBe(false);
            }
            for (const path of written) expect(existsSync(path)).toBe(true);
        } finally {
            rmSync(bgDir, { recursive: true, force: true });
        }
    });
});

describe('0387 P2 — the shipped badge never depends on the process CWD', () => {
    it('resolves the default emblem from the module and draws it without an explicit logoPath', () => {
        // The original defect: the default was the CWD-relative 'assets/general/xhxs.svg', so the
        // production caller (which passes no path) shipped covers with no emblem at all. Guard the
        // default itself, not just a caller that happens to pass one.
        expect(DEFAULT_LOGO_PATH.startsWith('/')).toBe(true);
        expect(existsSync(DEFAULT_LOGO_PATH)).toBe(true);

        const svg = buildCoverSvg({ backgroundImagePath: 'unused.png', headline: '回归守卫' });
        expect(svg).toContain('<title>XHS icon</title>');
    });
});
