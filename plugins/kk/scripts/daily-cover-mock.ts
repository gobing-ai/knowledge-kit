#!/usr/bin/env bun
/**
 * 0349 R2: standalone mock cover runner — end-to-end cover verification without a daily cron
 * run. `--mock-bg` renders a local 1344×576 gradient background via SVG→sips (zero tokens,
 * fully offline); otherwise the background is generated through `kk executor run image-gen`
 * with the pinned daily-news-podcast presets. Either way the headline is composited through
 * the same `compositeCover` the daily pipeline uses, then the output is dimension-verified.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { COVER_HEIGHT, COVER_WIDTH, compositeCover, writeCoverPreviews } from './cover-compositor';

interface MockOptions {
    headline: string;
    scene: string;
    out: string;
    provider: string;
    mockBg: boolean;
    /** 0387 R1: when set, the inspectable crop/reference previews are written into this directory. */
    previews: string;
}

/**
 * 0387 R1 — the checked-in TRANSPARENT emblem used as the reference for the blend previews. The
 * operator's banner is absent on the build machine, so verification fuses this fixture and the
 * real reference comparison stays a separate operator check (never a fabricated banner).
 */
export const REFERENCE_LOGO_FIXTURE = join(import.meta.dir, '../tests/fixtures/alpha-logo.svg');

const MOCK_BG_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d1e33"/>
      <stop offset="0.55" stop-color="#123252"/>
      <stop offset="1" stop-color="#0a1424"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.35" r="0.5">
      <stop offset="0" stop-color="#2f6da8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#2f6da8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <!-- scene placeholder: the live path puts diffusion imagery here -->
  <text x="24" y="${COVER_HEIGHT - 24}" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#5a7ea6">MOCK BACKGROUND — ${COVER_WIDTH}x${COVER_HEIGHT}</text>
</svg>`;

function parseMockArgs(args: string[]): MockOptions {
    const { values } = parseArgs({
        args,
        options: {
            headline: { type: 'string', default: '重大突破：下一代AI深度推理时代正式开启' },
            scene: { type: 'string', default: 'an illuminated advanced semiconductor wafer glowing in dark cleanroom' },
            out: { type: 'string', default: '/tmp/kk-cover-mock.png' },
            provider: { type: 'string', default: '' },
            'mock-bg': { type: 'boolean', default: false },
            previews: { type: 'string', default: '' },
        },
        strict: true,
    });
    return {
        headline: values.headline ?? '',
        scene: values.scene ?? '',
        out: resolve(values.out ?? ''),
        provider: values.provider ?? '',
        mockBg: values['mock-bg'] ?? false,
        previews: values.previews ?? '',
    };
}

/** Render the mock background SVG to PNG via sips (mac-only, ADR-046). */
function renderMockBg(svgPath: string, pngPath: string): void {
    const sips = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], { encoding: 'utf-8' });
    if (sips.error || sips.status !== 0 || !existsSync(pngPath)) {
        throw new Error(
            `daily-cover-mock: mock background render failed (sips status ${sips.status ?? 'n/a'}); stderr: ${(sips.stderr || '').trim()}`,
        );
    }
}

/** Live path: same envelope shape dailyCover writes, through the pinned presets. */
function generateLiveBg(options: MockOptions, envPath: string, contentOut: string): string {
    const kkBin = process.env.KK_BIN || 'kk';
    const envelope = [
        {
            id: 'daily-cover-mock',
            title: basename(options.out),
            body: '',
            metadata: {
                imageGen: {
                    job: 'cover',
                    format: 'daily-news-podcast-cover',
                    style: 'quasi-news-podcast',
                    vars: { subject: options.scene },
                    maxImages: 1,
                    ...(options.provider !== '' ? { provider: options.provider } : {}),
                },
            },
        },
    ];
    writeFileSync(envPath, JSON.stringify(envelope, null, 4));
    const run = spawnSync(kkBin, ['executor', 'run', 'image-gen', '--in', envPath, '--out', contentOut], {
        encoding: 'utf-8',
    });
    if (run.error || run.status !== 0) {
        throw new Error(
            `daily-cover-mock: image-gen failed (status ${run.status ?? 'n/a'}); stderr: ${(run.stderr || '').trim().slice(-400)}`,
        );
    }
    const content = JSON.parse(readFileSync(contentOut, 'utf-8')) as Array<{ metadata?: { image_path?: string } }>;
    const imagePath = content[0]?.metadata?.image_path;
    if (imagePath === undefined || !existsSync(imagePath)) {
        throw new Error('daily-cover-mock: image-gen produced no usable image_path');
    }
    return imagePath;
}

/** Verify the composited output is a real COVER_WIDTH×COVER_HEIGHT PNG. */
function verifyOutput(outPath: string): { width: number; height: number } {
    const probe = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', outPath], { encoding: 'utf-8' });
    const text = probe.stdout || '';
    const width = Number(/pixelWidth:\s*(\d+)/.exec(text)?.[1]);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(text)?.[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error(`daily-cover-mock: output verification failed — sips cannot read dimensions from ${outPath}`);
    }
    if (width !== COVER_WIDTH || height !== COVER_HEIGHT) {
        throw new Error(`daily-cover-mock: output is ${width}x${height}, expected ${COVER_WIDTH}x${COVER_HEIGHT}`);
    }
    return { width, height };
}

export function runMock(args: string[]): {
    out: string;
    width: number;
    height: number;
    background: string;
    previewDir: string;
} {
    const options = parseMockArgs(args);
    const parent = dirname(options.out);
    if (!existsSync(parent)) {
        // sips would silently no-op on a missing parent (0348 finding) — fail before compositing.
        throw new Error(`daily-cover-mock: output directory does not exist: ${parent}`);
    }
    const tmp = mkdtempSync(join(tmpdir(), 'kk-cover-mock-'));
    try {
        const envPath = join(tmp, 'mock-image-gen-in.json');
        const contentOut = join(tmp, 'content.json');
        const background = options.mockBg
            ? (() => {
                  const svgPath = join(tmp, 'mock-bg.svg');
                  const pngPath = join(tmp, 'mock-bg.png');
                  writeFileSync(svgPath, MOCK_BG_SVG);
                  renderMockBg(svgPath, pngPath);
                  return pngPath;
              })()
            : generateLiveBg(options, envPath, contentOut);
        compositeCover({
            backgroundImagePath: background,
            headline: options.headline,
            outputPath: options.out,
        });
        const { width, height } = verifyOutput(options.out);
        // 0387 R1: the crop previews + reference blend are the verification artifacts — rendered
        // from the SAME composite path, into an inspectable directory the operator can open.
        if (options.previews !== '') {
            const manifest = writeCoverPreviews({
                backgroundImagePath: background,
                headline: options.headline,
                outputPath: options.out,
                previewDir: options.previews,
                referenceLogoPath: REFERENCE_LOGO_FIXTURE,
            });
            console.error(
                `daily-cover-mock: previews ${manifest.coverPath} crops=${manifest.crops.map((crop) => `${crop.platform}:${crop.rect.width}x${crop.rect.height}`).join(',')} blend=${manifest.referenceBlendPath}`,
            );
        }
        console.error(
            `daily-cover-mock: composited ${options.out} (${width}x${height}, background=${options.mockBg ? 'mock' : options.provider || 'default'})`,
        );
        return {
            out: options.out,
            width,
            height,
            background: options.mockBg ? 'mock' : 'live',
            previewDir: options.previews === '' ? '' : resolve(options.previews),
        };
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

const invokedDirectly = process.argv[1] !== undefined && basename(process.argv[1]) === 'daily-cover-mock.ts';
if (invokedDirectly) {
    runMock(process.argv.slice(2));
}
