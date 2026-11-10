import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 0348 / ADR-046 layer 2 — deterministic typography and branding compositor for the quasi-news
 * podcast cover. AI diffusion renders the background only (strict negative text prompt, 0347);
 * this module renders the Chinese headline and the podcast emblem as real vector layers, so no
 * glyph ever passes through the model. Output is a 1344x576 PNG composited via macOS `sips`.
 */

export interface CoverCompositorOptions {
    backgroundImagePath: string;
    headline: string;
    leadStoryTitle?: string;
    /** Defaults to the repo `assets/general/xhxs.svg`; a missing asset omits the badge. */
    logoPath?: string;
    outputPath: string;
    width?: number; // default 1344
    height?: number; // default 576
}

export const COVER_WIDTH = 1344;
export const COVER_HEIGHT = 576;
/** Max Chinese characters per headline line (news-editorial style contract, 0347). */
export const HEADLINE_LINE_CAP = 25;
const FONT_STACK = `PingFang SC, Hiragino Sans GB, 'Noto Sans CJK SC', sans-serif`;

/** XML-escape a text node or attribute value (headlines are model-authored, so assume the worst). */
function esc(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * Split a headline into at most two lines: explicit `\n` wins, otherwise chunk at
 * HEADLINE_LINE_CAP characters. Anything past two lines truncates with an ellipsis —
 * the style contract caps headlines at 2 x 25 chars, so this is a last-resort guard.
 */
export function wrapHeadline(headline: string): string[] {
    const hasBreaks = headline.includes('\n');
    const source = hasBreaks
        ? headline
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
        : chunk(headline.replaceAll('\n', ' ').trim());
    if (source.length <= 2) return source;
    // >2 lines: keep line 1 whole, squeeze the rest into one ellipsized line.
    const rest = source.slice(1).join(' ');
    const second = chunk(rest)[0] ?? '';
    if (rest.length <= second.length) return [source[0], second];
    return [source[0], `${second.slice(0, HEADLINE_LINE_CAP - 1)}…`];
}

/** Fixed-width chunker for CJK headlines — code points, not UTF-16 units. */
function chunk(text: string): string[] {
    const chars = Array.from(text);
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += HEADLINE_LINE_CAP)
        lines.push(chars.slice(i, i + HEADLINE_LINE_CAP).join(''));
    return lines;
}

/**
 * Inline the logo SVG with its lower text band (`SALTY CLUB`, y >= 780 of the 1095-tall
 * viewBox) cropped away by re-clipping to `0 0 1095 760`. Returns '' when the asset is
 * absent — the badge is branding, not content, so a missing file degrades instead of failing.
 */
export function logoBadgeSvg(logoPath: string, x: number, y: number, width: number, height: number): string {
    if (!existsSync(logoPath)) {
        console.error(`cover compositor: logo asset missing, badge omitted (${logoPath})`);
        return '';
    }
    const raw = readFileSync(logoPath, 'utf-8');
    const open = raw.indexOf('>', raw.indexOf('<svg'));
    const close = raw.lastIndexOf('</svg>');
    if (open === -1 || close === -1) {
        console.error('cover compositor: logo asset is not a parseable svg, badge omitted');
        return '';
    }
    const inner = raw.slice(open + 1, close);
    return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 1095 760" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

/** Deterministic SVG overlay: background image, bottom scrim, logo badge, headline, podcast tag. */
export function buildCoverSvg(options: CoverCompositorOptions): string {
    const width = options.width ?? COVER_WIDTH;
    const height = options.height ?? COVER_HEIGHT;
    const lines = wrapHeadline(options.headline);
    const logo = logoBadgeSvg(options.logoPath ?? 'assets/general/xhxs.svg', 48, 40, 72, 50);

    const typography =
        lines.length === 1
            ? `<text x="48" y="500" font-family="${FONT_STACK}" font-size="46" font-weight="800" fill="#FFFFFF" filter="url(#textShadow)">${esc(lines[0])}</text>`
            : `<text x="48" y="472" font-family="${FONT_STACK}" font-size="46" font-weight="800" fill="#FFFFFF" filter="url(#textShadow)">${esc(lines[0])}</text>
  <text x="48" y="532" font-family="${FONT_STACK}" font-size="32" font-weight="700" fill="#FFB800" filter="url(#textShadow)">${esc(lines[1])}</text>`;

    const badge =
        logo !== ''
            ? `<rect x="36" y="30" width="96" height="70" rx="12" fill="#0a1424" fill-opacity="0.7" />
  ${logo}`
            : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${encodeURI(`file://${resolve(options.backgroundImagePath)}`)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
  <defs>
    <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a1424" stop-opacity="0" />
      <stop offset="1" stop-color="#0a1424" stop-opacity="0.92" />
    </linearGradient>
    <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.85" />
    </filter>
  </defs>
  <rect x="0" y="${Math.round(height * 0.45)}" width="${width}" height="${height - Math.round(height * 0.45)}" fill="url(#bottomScrim)" />
  ${badge}
  ${typography}
  <text x="${width - 48}" y="${height - 40}" text-anchor="end" font-family="${FONT_STACK}" font-size="18" font-weight="600" letter-spacing="2" fill="#FFFFFF" fill-opacity="0.85">DAILY AI PODCAST</text>
</svg>
`;
}

/**
 * Render `buildCoverSvg` to a PNG at `outputPath` via macOS `sips` (ships with the OS; no
 * native image dependency). Fail-fast: a missing `sips` or nonzero transcode throws with an
 * actionable message — the daily run must not publish a half-composited cover.
 */
export function compositeCover(options: CoverCompositorOptions): string {
    const svgPath = join(tmpdir(), `cover-composite-${Date.now()}.svg`);
    writeFileSync(svgPath, buildCoverSvg(options), 'utf-8');
    try {
        const sips = spawnSync('sips', ['-s', 'format', 'png', svgPath, '--out', options.outputPath], {
            stdio: 'ignore',
        });
        // Bun reports a missing binary as `status: undefined` plus an `error` object.
        if (sips.error !== undefined || typeof sips.status !== 'number') {
            throw new Error('cover compositor: sips not found; cannot render the cover overlay (macOS required)');
        }
        if (sips.status !== 0) {
            throw new Error(`cover compositor: sips failed (status ${sips.status}); overlay did not render`);
        }
        // sips exits 0 even when it silently fails to place the output (missing parent dir) —
        // a render that claims success without a file would leave a stale cover downstream.
        if (!existsSync(options.outputPath)) {
            throw new Error(`cover compositor: sips reported success but ${options.outputPath} is missing`);
        }
    } finally {
        rmSync(svgPath, { force: true });
    }
    return options.outputPath;
}
