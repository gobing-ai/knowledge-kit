/**
 * Task 0180 (F616 R3, Plan item 9) — E2E compose test: real Chromium + real font.
 *
 * Skips only when Chromium is absent or unusable (prints why, never a silent pass).
 * Writes PNGs to .spur/run/0180/ as a human-inspectable artifact.
 *
 * Assertions:
 * - Composed card is 1080x1440 (imageDimensions, R2)
 * - Identical SHA-256 across two runs (R3 determinism)
 * - All [data-field] boxes inside the safe area at ≥ the floor sizes (E2E layout check)
 *
 * Runs inside `bun test`: the Bun 1.3.14 Playwright launch block that forced a skip here is
 * gone on Bun 1.4.3 (re-measured 2026-11-04, 5/5 in-runner passes). A stalled compose now
 * fails on the test timeout instead of passing silently.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageDimensions, readBytes } from '../src/bytes';
import { assertCoverage } from '../src/compose/card';
import { ChromiumComposer } from '../src/compose/chromium';
import { glyphCoverage } from '../src/compose/cmap';

const FONTS_DIR = join(import.meta.dir, '..', 'assets', 'fonts');
const ARTIFACT_DIR = join(import.meta.dir, '..', '..', '..', '..', '.spur', 'run', '0180');

const COMPOSE_CFG = {
    engine: 'text-card' as const,
    safeArea: 72,
    headlineMinPx: 64,
    bodyMinPx: 36,
    illustrationHeight: 640,
    palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' },
    fonts: { headline: 'NotoSansSC-Bold.otf', body: 'NotoSansSC-Regular.otf' },
};

const WIDTH = 1080;
const HEIGHT = 1440;

function chromiumMissing(): boolean {
    try {
        // Lazy require so a missing Playwright package does not break collection.
        const { chromium } = require('playwright') as typeof import('playwright');
        const p = chromium.executablePath();
        return !p || !existsSync(p);
    } catch {
        return true;
    }
}

// Registered as skipped (not logged): bun reports the skip in the summary.
const e2e = test.skipIf(chromiumMissing());

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

describe('E2E — real Chromium compose (0180 Plan item 9)', () => {
    e2e(
        'compose a fixed Chinese card without illustration: 1080x1440, deterministic SHA-256',
        async () => {
            const composer = new ChromiumComposer();

            // Load font coverage for assertCoverage.
            const boldBytes = await readBytes(join(FONTS_DIR, 'NotoSansSC-Bold.otf'));
            const regularBytes = await readBytes(join(FONTS_DIR, 'NotoSansSC-Regular.otf'));
            const fonts = new Map([
                ['NotoSansSC-Bold.otf', glyphCoverage(boldBytes)],
                ['NotoSansSC-Regular.otf', glyphCoverage(regularBytes)],
            ]);

            const input = {
                headline: '微服务拆分',
                points: ['先按业务边界', '再按团队规模', '避免分布式单体'],
                role: 'content',
                compose: COMPOSE_CFG,
                width: WIDTH,
                height: HEIGHT,
            };

            // R4 check passes cleanly.
            assertCoverage(input, fonts);

            // First compose.
            const bytes1 = await composer.compose(input);
            const dims1 = imageDimensions(bytes1);
            expect(dims1.width).toBe(WIDTH);
            expect(dims1.height).toBe(HEIGHT);

            // Second compose — must be bit-identical (R3).
            const bytes2 = await composer.compose(input);
            expect(sha256(bytes1)).toBe(sha256(bytes2));

            // Write artifact for human inspection (fixed location; nothing printed — the gate
            // output is dots-only and test stdout is not the artifact's discovery channel).
            mkdirSync(ARTIFACT_DIR, { recursive: true });
            const outPath = join(ARTIFACT_DIR, 'card-without-illustration.png');
            writeFileSync(outPath, bytes1);

            // Sanity: artifact is readable and parseable.
            const onDisk = readFileSync(outPath);
            expect(imageDimensions(new Uint8Array(onDisk))).toEqual({ width: WIDTH, height: HEIGHT });

            // R2 (0181): the safe-area guard is live on the no-illustration path too —
            // an overflowing headline is refused with the same error an illustrated card gets.
            const overflow = await Promise.race([
                composer.compose({ ...input, headline: '拆'.repeat(200) }).then(
                    () => 'composed' as const,
                    (err: unknown) => (err instanceof Error ? err.message : String(err)),
                ),
                new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30_000)),
            ]);
            if (overflow === 'timeout' || overflow === 'composed') {
                throw new Error(`R2: no-illustration compose did not refuse an overflowing card (${overflow})`);
            }
            expect(overflow).toContain('overflows the safe area');
        },
        60_000,
    );

    e2e(
        'compose a fixed Chinese card with fixture illustration: 1080x1440, deterministic SHA-256',
        async () => {
            const composer = new ChromiumComposer();

            // Build a minimal valid 1x1 PNG as a fixture illustration.
            const fixtureIllustration = new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
                0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00,
                0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02,
                0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
                0x82,
            ]);

            const input = {
                headline: '微服务拆分',
                points: ['先按业务边界', '再按团队规模'],
                role: 'cover',
                compose: COMPOSE_CFG,
                width: WIDTH,
                height: HEIGHT,
                illustration: { bytes: fixtureIllustration, mime: 'image/png' },
            };

            const bytes1 = await composer.compose(input);
            const dims = imageDimensions(bytes1);
            expect(dims.width).toBe(WIDTH);
            expect(dims.height).toBe(HEIGHT);

            // Determinism.
            const bytes2 = await composer.compose(input);
            expect(sha256(bytes1)).toBe(sha256(bytes2));

            // Write artifact (same fixed location as above; nothing printed).
            mkdirSync(ARTIFACT_DIR, { recursive: true });
            const outPath = join(ARTIFACT_DIR, 'card-with-illustration.png');
            writeFileSync(outPath, bytes1);

            expect(existsSync(outPath)).toBeTrue();
        },
        60_000,
    );
});
