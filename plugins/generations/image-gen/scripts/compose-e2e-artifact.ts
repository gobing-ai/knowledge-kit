/**
 * Standalone E2E compose evidence (task 0180 Plan item 9).
 *
 * Composes the fixed card twice per variant, asserts byte-identical SHA-256,
 * asserts 1080x1440, and writes the PNG artifacts to .spur/run/0180/.
 *
 * Usage:
 *   bun scripts/compose-e2e-artifact.ts            # all variants
 *   bun scripts/compose-e2e-artifact.ts without    # one variant (no illustration)
 *   bun scripts/compose-e2e-artifact.ts with       # one variant (fixture illustration)
 *   bun scripts/compose-e2e-artifact.ts r2         # 0181 R2: good card + overflow refusal
 *
 * All variants run in one process: the Bun 1.3.14 third-compose-cycle hang that
 * forced a subprocess per variant is gone on Bun 1.4.3 (re-measured 2026-11-04).
 */
import { join } from 'node:path';
import { imageDimensions } from '../src/bytes';
import { makeChromiumComposer } from '../src/compose/chromium';

const OUT_DIR = '.spur/run/0180';
const OUT_DIR_0181 = '.spur/run/0181';
const FIXTURE_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
    0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const COMPOSE_CFG = {
    engine: 'text-card' as const,
    safeArea: 72,
    headlineMinPx: 64,
    bodyMinPx: 36,
    illustrationHeight: 640,
    palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' },
    fonts: { headline: 'NotoSansSC-Bold.otf', body: 'NotoSansSC-Regular.otf' },
};

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function input(variant: 'without' | 'with') {
    const base = {
        headline: '微服务拆分的三个原则',
        points: ['先按业务边界划分服务', '再按团队规模调整粒度', '最后用网关收敛入口'],
        role: 'content' as const,
        compose: COMPOSE_CFG,
        width: 1080,
        height: 1440,
    };
    return variant === 'with' ? { ...base, illustration: { bytes: FIXTURE_PNG, mime: 'image/png' } } : base;
}

async function runPair(variant: 'without' | 'with'): Promise<void> {
    console.log(`[${variant}] composing (1/2)...`);
    const composer = makeChromiumComposer();
    const first = await composer.compose(input(variant));
    console.log(`[${variant}] composing (2/2)...`);
    const second = await composer.compose(input(variant));

    const dims = imageDimensions(first);
    if (dims?.width !== 1080 || dims?.height !== 1440) {
        throw new Error(`[${variant}] composed PNG is not 1080x1440: ${JSON.stringify(dims)}`);
    }
    const sha1 = await sha256(first);
    const sha2 = await sha256(second);
    if (sha1 !== sha2) {
        throw new Error(`[${variant}] SHA-256 mismatch across identical compose: ${sha1} vs ${sha2}`);
    }
    const outPath = join(OUT_DIR, `card-${variant}-illustration.png`);
    await Bun.write(outPath, first);
    console.log(`[${variant}] OK ${first.length}B ${dims.width}x${dims.height} sha256=${sha1} -> ${outPath}`);
}

async function runR2(): Promise<void> {
    // 0181 R2 evidence: the no-illustration compose is a real card (R2 makes the
    // illustration decoration, not a legibility dependency), and an overflowing
    // headline is refused by the live safe-area check before any PNG exists.
    const composer = makeChromiumComposer();
    console.log('[r2] composing the no-illustration card (1/2)...');
    const good = await composer.compose(input('without'));
    const dims = imageDimensions(good);
    if (dims?.width !== 1080 || dims?.height !== 1440) {
        throw new Error(`[r2] composed PNG is not 1080x1440: ${JSON.stringify(dims)}`);
    }
    console.log('[r2] composing an overflowing headline (2/2) — expecting a safe-area refusal...');
    let refusal = '';
    try {
        await composer.compose({ ...input('without'), headline: '拆'.repeat(200) });
    } catch (err: unknown) {
        refusal = err instanceof Error ? err.message : String(err);
    }
    if (!refusal.includes('overflows the safe area')) {
        throw new Error(`[r2] overflowing headline was not refused: ${refusal || 'composed without error'}`);
    }
    const outPath = join(OUT_DIR_0181, 'card-r2-no-illustration.png');
    await Bun.write(outPath, good);
    console.log(`[r2] OK ${good.length}B ${dims.width}x${dims.height}; overflow refused; -> ${outPath}`);
}

const variant = process.argv[2];
if (variant === 'without' || variant === 'with') {
    await runPair(variant);
} else if (variant === 'r2') {
    await runR2();
} else if (variant === undefined) {
    await runPair('without');
    await runPair('with');
    await runR2();
    console.log(
        'E2E compose artifacts written (.spur/run/0180 both variants, .spur/run/0181 R2) — SHA-256 deterministic.',
    );
} else {
    console.error(`Unknown variant: ${variant} (expected without|with)`);
    process.exit(1);
}
