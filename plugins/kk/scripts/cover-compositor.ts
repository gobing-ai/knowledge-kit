import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    /**
     * Background as a `data:` URI. `compositeCover` always sets it: `sips` cannot rasterize an
     * SVG `<image href="file://…">`, so the file-URL form silently rendered only the overlay
     * chrome (the placeholder-looking cover that shipped on 2026-11-11) plus a lost headline.
     * The field is optional only so the pure template probes can exercise the legacy form.
     */
    backgroundUri?: string;
    headline: string;
    leadStoryTitle?: string;
    /** Defaults to the repo `assets/general/xhxs.svg`; a missing asset omits the badge. */
    logoPath?: string;
    outputPath: string;
    width?: number; // default 1344
    height?: number; // default 576
    /** Raster output format passed to macOS `sips` (default `'png'`). */
    format?: 'png' | 'jpeg';
}

export const COVER_WIDTH = 1344;
export const COVER_HEIGHT = 576;
export const SOCIAL_COVER_WIDTH = 1200;
export const SOCIAL_COVER_HEIGHT = 630;
/** Max Chinese characters per headline line (news-editorial style contract, 0347). */
export const HEADLINE_LINE_CAP = 25;
const FONT_STACK = `PingFang SC, Hiragino Sans GB, 'Noto Sans CJK SC', sans-serif`;

/** 0387 R1 — inset (px) between the shared crop intersection and the headline block. */
export const SAFE_MARGIN = 32;
/** Rows the headline may occupy inside the safe area (a 25-char point needs 3 at the 1:1 width). */
export const HEADLINE_MAX_ROWS = 3;
/** First-row size cap and the legibility floor the fit loop may shrink to. */
export const HEADLINE_FIRST_SIZE = 46;
export const HEADLINE_MIN_SIZE = 26;
/**
 * 0387 R1 — the emblem is scaled down (was 72x50) and sits in the TOP-RIGHT corner. It keeps its
 * own alpha: the old dark plate behind it (`fill-opacity="0.7"`) is gone, so the transparent
 * emblem blends over the AI background instead of sitting on a chrome rectangle.
 */
export const LOGO_WIDTH = 56;
export const LOGO_HEIGHT = 38;
export const LOGO_MARGIN = 24;

/** An axis-aligned pixel rectangle, integer edges (the form `sips --cropOffset` and SVG take). */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One target platform's center crop of the full cover. */
export interface PlatformCrop {
    platform: 'wechat-mp' | 'podcast-site';
    label: string;
    aspect: number;
}

/**
 * 0387 R8 — the two platforms crop the 1344x576 cover at its CENTER, so the headline belongs in
 * the intersection of those crops, not in the full 21:9 frame:
 *  - WeChat MP re-crops the uploaded cover to a 2.35:1 header and a 1:1 feed image
 *    (`plugins/publishings/wechatmp-pub/src/cgi.ts:20` `WIDE_COVER_ASPECT`, `centerCropRect`).
 *  - the podcast site shows the episode artwork square (channel artwork ships 1400x1400,
 *    `docs/design/podcast-pub.md`), i.e. a 1:1 center crop of the same frame.
 * The 1:1 crop is the tight one: it keeps only x 384..960 of the 1344-wide canvas.
 */
export const TARGET_CROPS: readonly PlatformCrop[] = [
    { platform: 'wechat-mp', label: '微信公众号 2.35:1 头图', aspect: 2.35 },
    { platform: 'podcast-site', label: '播客站点 1:1 封面', aspect: 1 },
];

/**
 * Centered cover-fit rectangle for one target aspect ratio, from ACTUAL image dimensions. The
 * same geometry as WeChat's upload path (`wechatmp-pub/src/cgi.ts` `centerCropRect`, task 0289 R2)
 * — the publisher computes the `crop_multi` boxes from the real upload, so the safe area here and
 * the boxes there agree by construction instead of by hand-measured pixels.
 */
export function centerCropRect(width: number, height: number, aspect: number): Rect {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw new TypeError(`cover compositor: image dimensions must be positive, got ${width}x${height}`);
    }
    if (!Number.isFinite(aspect) || aspect <= 0) {
        throw new TypeError(`cover compositor: crop aspect must be positive, got ${aspect}`);
    }
    const cropWidth = width / height > aspect ? height * aspect : width;
    const cropHeight = width / height > aspect ? height : width / aspect;
    const x = Math.floor((width - cropWidth) / 2);
    const y = Math.floor((height - cropHeight) / 2);
    return {
        x,
        y,
        width: Math.min(width, Math.round(cropWidth)),
        height: Math.min(height, Math.round(cropHeight)),
    };
}

/**
 * The region EVERY target crop keeps, inset by `margin`: the only area the headline may occupy.
 * For the 1344x576 cover that is x 416..928 (512 wide) — a 25-char point needs ~1150px on one
 * line, which is why the headline is centered and wrapped to this width instead of left-aligned.
 */
export function safeAreaRect(
    width = COVER_WIDTH,
    height = COVER_HEIGHT,
    crops: readonly PlatformCrop[] = TARGET_CROPS,
    margin = SAFE_MARGIN,
): Rect {
    if (crops.length === 0) throw new TypeError('cover compositor: at least one target crop is required');
    const rects = crops.map((crop) => centerCropRect(width, height, crop.aspect));
    const left = Math.max(...rects.map((rect) => rect.x));
    const top = Math.max(...rects.map((rect) => rect.y));
    const right = Math.min(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.min(...rects.map((rect) => rect.y + rect.height));
    const inset = Math.max(0, Math.min(margin, Math.floor((right - left) / 4), Math.floor((bottom - top) / 4)));
    return { x: left + inset, y: top + inset, width: right - left - 2 * inset, height: bottom - top - 2 * inset };
}

/** Top-right emblem geometry on the full cover (outside the 1:1 crop by design — R1 names the
 * full cover for the badge, the crops for the headline point). */
export function logoRect(width = COVER_WIDTH): Rect {
    return { x: width - LOGO_MARGIN - LOGO_WIDTH, y: LOGO_MARGIN, width: LOGO_WIDTH, height: LOGO_HEIGHT };
}

/** One laid-out headline row: the text plus the exact baseline/anchor the SVG must draw. */
export interface HeadlineRow {
    text: string;
    x: number;
    y: number;
    size: number;
    weight: number;
    fill: string;
    /** Estimated rendered width in px — the same per-code-point estimate the fit loop uses. */
    width: number;
}

export interface HeadlineLayout {
    rows: HeadlineRow[];
    /** Bounding box of the drawn rows — asserted to sit inside `safe`. */
    block: Rect;
    safe: Rect;
    size: number;
    /** True when the row budget ran out before the text did (an ellipsis was appended). */
    truncated: boolean;
}

/** Greedy code-point wrap to `maxWidth`, at most `maxRows` rows; the tail is ellipsized on overflow. */
function wrapToRows(
    text: string,
    maxWidth: number,
    size: number,
    maxRows: number,
): { rows: string[]; truncated: boolean } {
    const chars = Array.from(text.replaceAll(/\s+/g, ' ').trim());
    const rows: string[] = [];
    let current = '';
    let index = 0;
    while (index < chars.length) {
        const candidate = current + chars[index];
        if (current === '' || estimateWidth(candidate, size) <= maxWidth) {
            current = candidate;
            index += 1;
            continue;
        }
        rows.push(current);
        current = chars[index] === ' ' ? '' : chars[index];
        index += 1;
        if (rows.length === maxRows) {
            const rest = (current + chars.slice(index).join('')).trim();
            let base = rows[maxRows - 1];
            while (base !== '' && estimateWidth(`${base}…`, size) > maxWidth)
                base = Array.from(base).slice(0, -1).join('');
            let keep = '';
            for (const ch of Array.from(rest)) {
                if (estimateWidth(`${base}${keep}${ch}…`, size) > maxWidth) break;
                keep += ch;
            }
            rows[maxRows - 1] = `${base}${keep}…`;
            return { rows, truncated: rest !== '' };
        }
    }
    if (current.trim() !== '') rows.push(current);
    return { rows, truncated: false };
}

/**
 * 0387 R1 — lay the headline out so both platform center crops keep the WHOLE point: rows are
 * centered on the canvas midline, wrapped to the safe-area width, and vertically centered inside
 * the safe area. `wrapHeadline` still owns the content contract (≤2 x 25 chars, explicit breaks);
 * this adds the geometric fit on top of it.
 */
export function layoutHeadline(headline: string, width = COVER_WIDTH, height = COVER_HEIGHT): HeadlineLayout {
    const safe = safeAreaRect(width, height);
    const source = wrapHeadline(headline).join(' ').trim();
    if (source === '') {
        return {
            rows: [],
            block: { x: safe.x, y: safe.y, width: 0, height: 0 },
            safe,
            size: HEADLINE_MIN_SIZE,
            truncated: false,
        };
    }
    let size = HEADLINE_FIRST_SIZE;
    let wrapped = wrapToRows(source, safe.width, size, HEADLINE_MAX_ROWS);
    while (wrapped.truncated && size > HEADLINE_MIN_SIZE) {
        size -= 2;
        wrapped = wrapToRows(source, safe.width, size, HEADLINE_MAX_ROWS);
    }
    const texts = wrapped.rows.filter((row) => row.trim() !== '');
    const sizes = texts.map((_row, index) =>
        index === 0 ? size : Math.max(HEADLINE_MIN_SIZE, Math.round(size * 0.8)),
    );
    const lineHeights = sizes.map((lineSize) => Math.round(lineSize * 1.28));
    const blockHeight = lineHeights.reduce((sum, lineHeight) => sum + lineHeight, 0);
    const top = safe.y + Math.round((safe.height - blockHeight) / 2);
    const centerX = Math.round(width / 2);
    let cursor = top;
    const rows: HeadlineRow[] = texts.map((text, index) => {
        const lineSize = sizes[index];
        const row: HeadlineRow = {
            text,
            x: centerX,
            y: cursor + Math.round(lineSize * 0.82),
            size: lineSize,
            weight: index === 0 ? 800 : 700,
            fill: index === 0 ? '#FFFFFF' : '#FFB800',
            width: Math.round(estimateWidth(text, lineSize)),
        };
        cursor += lineHeights[index];
        return row;
    });
    const blockWidth = Math.max(...rows.map((row) => row.width));
    return {
        rows,
        block: { x: Math.round(centerX - blockWidth / 2), y: top, width: blockWidth, height: blockHeight },
        safe,
        size,
        truncated: wrapped.truncated,
    };
}

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

/**
 * Estimated rendered width in px for the mixed CJK/Latin headline: `sips` has no text metrics we
 * can read back, so each code point is charged its rough advance (CJK ≈ 1em, Latin ≈ 0.55em,
 * space ≈ 0.28em). Used only to shrink a row until it fits the crop-safe width — a clipped
 * headline is worse than a smaller one (the 2026-11-12 regeneration clipped "Anthropic" at the
 * canvas edge).
 */
function estimateWidth(text: string, fontSize: number): number {
    let em = 0;
    for (const ch of text) {
        if (/\s/.test(ch)) em += 0.28;
        else if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\u3000-\u303F]/.test(ch)) em += 1;
        else em += 0.55;
    }
    return em * fontSize;
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

/**
 * The shipped emblem, resolved from THIS module (repo root is three levels up from `plugins/kk/scripts`)
 * so the badge renders no matter the process CWD. `existsSync` treats a relative path as CWD-relative,
 * which is exactly how the badge went missing from shipped covers.
 */
export const DEFAULT_LOGO_PATH = resolve(import.meta.dir, '..', '..', '..', 'assets', 'general', 'xhxs.svg');

/** Deterministic SVG overlay: background image, bottom scrim, top-right emblem, centered headline. */
export function buildCoverSvg(options: CoverCompositorOptions): string {
    const width = options.width ?? COVER_WIDTH;
    const height = options.height ?? COVER_HEIGHT;
    const layout = layoutHeadline(options.headline, width, height);
    const badge = logoRect(width);
    // Resolve the default emblem from this module, never the CWD: the production caller passes no
    // path, so a CWD-relative default silently omitted the badge from every shipped cover (0387 R1).
    const logo = logoBadgeSvg(options.logoPath ?? DEFAULT_LOGO_PATH, badge.x, badge.y, badge.width, badge.height);

    // 2026-11-12 regression: `sips` drops EVERY `<text>` that carries an SVG filter, so the
    // headline never rasterized (both the 11-11 and 11-12 covers shipped chrome with no headline).
    // Contrast comes from the scrim plus a geometric shadow — the same text drawn once in dark
    // behind the visible line — because that is plain geometry, not a filter.
    const row = (line: HeadlineRow): string =>
        `<text x="${line.x}" y="${line.y + 3}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${line.size}" font-weight="${line.weight}" fill="#000000" fill-opacity="0.72">${esc(line.text)}</text>
  <text x="${line.x}" y="${line.y}" text-anchor="middle" font-family="${FONT_STACK}" font-size="${line.size}" font-weight="${line.weight}" fill="${line.fill}">${esc(line.text)}</text>`;
    const typography = layout.rows.map(row).join('\n  ');
    // 0387 R1: the emblem is drawn straight onto the background — no plate behind it — so its own
    // alpha is what the audience sees (the old `rect fill-opacity="0.7"` chrome is gone).
    // 0387 R1: the scrim starts at 20% height because the headline now sits mid-frame (centered in
    // the crop-safe column) instead of in the lower third.
    const scrimTop = Math.round(height * 0.2);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${options.backgroundUri ?? encodeURI(`file://${resolve(options.backgroundImagePath)}`)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
  <defs>
    <linearGradient id="bottomScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a1424" stop-opacity="0" />
      <stop offset="1" stop-color="#0a1424" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#bottomScrim)" />
  ${logo}
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
/** Inline the background as a data URI so `sips` actually rasterizes it (see the option doc). */
function backgroundDataUri(path: string): string {
    const lower = path.toLowerCase();
    const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function runSips(
    args: string[],
    outputPath: string,
    messages: { notFound: string; failed: (status: number) => string; missingOutput: string },
): void {
    const sips = spawnSync('sips', args, { stdio: 'ignore' });
    // Bun reports a missing binary as `status: undefined` (older versions: `null`) plus an `error` object.
    if (sips.error !== undefined || typeof sips.status !== 'number') {
        throw new Error(messages.notFound);
    }
    if (sips.status !== 0) {
        throw new Error(messages.failed(sips.status));
    }
    // sips exits 0 even when it silently fails to place the output (missing parent dir).
    if (!existsSync(outputPath)) {
        throw new Error(messages.missingOutput);
    }
}

function sipsErrorMessages(noun: string, verb: string, outputPath: string) {
    return {
        notFound: `cover compositor: sips not found; cannot ${noun} (macOS required)`,
        failed: (status: number) => `cover compositor: sips ${verb} failed (status ${status}); ${outputPath} missing`,
        missingOutput: `cover compositor: sips reported success but ${outputPath} is missing`,
    };
}

export function compositeCover(options: CoverCompositorOptions): string {
    const svgPath = join(tmpdir(), `cover-composite-${Date.now()}.svg`);
    writeFileSync(
        svgPath,
        buildCoverSvg({ ...options, backgroundUri: backgroundDataUri(options.backgroundImagePath) }),
        'utf-8',
    );
    const sipsArgs =
        options.format === 'jpeg'
            ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', svgPath, '--out', options.outputPath]
            : ['-s', 'format', 'png', svgPath, '--out', options.outputPath];
    try {
        runSips(sipsArgs, options.outputPath, {
            notFound: 'cover compositor: sips not found; cannot render the cover overlay (macOS required)',
            failed: (status) => `cover compositor: sips failed (status ${status}); overlay did not render`,
            missingOutput: `cover compositor: sips reported success but ${options.outputPath} is missing`,
        });
    } finally {
        rmSync(svgPath, { force: true });
    }
    return options.outputPath;
}

/**
 * Render the 1200×630 JPEG Open Graph / Twitter social card derivative from the same raw background
 * and frozen Chinese headline so `podcast-pub` populates `_microfeed.seo.social_image`.
 */
export function compositeSocialCover(options: Omit<CoverCompositorOptions, 'width' | 'height' | 'format'>): string {
    return compositeCover({
        ...options,
        width: SOCIAL_COVER_WIDTH,
        height: SOCIAL_COVER_HEIGHT,
        format: 'jpeg',
    });
}

/**
 * Derive a 1200×630 JPEG social card from an already-rendered raster cover via centered aspect crop
 * + resize (used for backfilling historical episodes without regenerating raw diffusion backgrounds).
 */
export function deriveSocialCoverFromImage(sourcePath: string, outputPath: string): string {
    const probe = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', sourcePath], { encoding: 'utf-8' });
    const width = Number(/pixelWidth:\s*(\d+)/.exec(probe.stdout ?? '')?.[1] ?? '0');
    const height = Number(/pixelHeight:\s*(\d+)/.exec(probe.stdout ?? '')?.[1] ?? '0');
    if (
        probe.error !== undefined ||
        typeof probe.status !== 'number' ||
        probe.status !== 0 ||
        width < 1 ||
        height < 1
    ) {
        throw new Error(`cover compositor: cannot probe dimensions of ${sourcePath}`);
    }
    const rect = centerCropRect(width, height, SOCIAL_COVER_WIDTH / SOCIAL_COVER_HEIGHT);
    const croppedPng = join(tmpdir(), `cover-social-crop-${Date.now()}.png`);
    try {
        cropPng(sourcePath, rect, croppedPng);
        runSips(
            [
                '-z',
                String(SOCIAL_COVER_HEIGHT),
                String(SOCIAL_COVER_WIDTH),
                '-s',
                'format',
                'jpeg',
                '-s',
                'formatOptions',
                '88',
                croppedPng,
                '--out',
                outputPath,
            ],
            outputPath,
            sipsErrorMessages('transcode social cover', 'transcode', outputPath),
        );
    } finally {
        rmSync(croppedPng, { force: true });
    }
    return outputPath;
}

/** One platform crop preview written next to the full cover. */
export interface CoverCropPreview {
    platform: PlatformCrop['platform'];
    label: string;
    aspect: number;
    /** The rectangle this preview keeps of the full cover (centered, from the real dimensions). */
    rect: Rect;
    path: string;
}

export interface CoverPreviewManifest {
    coverPath: string;
    width: number;
    height: number;
    safeArea: Rect;
    headlineBlock: Rect;
    rows: number;
    truncated: boolean;
    crops: CoverCropPreview[];
    /** Full cover rendered with the reference emblem fused in ('' when no emblem was supplied). */
    referenceCoverPath: string;
    /** Zoomed top-right corner of the reference cover: the alpha blend an operator compares. */
    referenceBlendPath: string;
    /** The emblem the reference artifacts used — the checked-in alpha fixture, never a fake banner. */
    referenceLogoPath: string;
}

export interface CoverPreviewOptions extends CoverCompositorOptions {
    /** Directory the inspectable artifacts land in (created when missing). */
    previewDir: string;
    /**
     * 0387 R1 — the reference emblem. The operator's banner is absent on the build machine, so the
     * deterministic verification fuses the checked-in transparent fixture
     * (`plugins/kk/tests/fixtures/alpha-logo.svg`) and the REAL reference comparison stays a
     * separate operator check. Omitted ⇒ no reference artifacts are claimed.
     */
    referenceLogoPath?: string;
}

/** Center-crop a rendered PNG to `rect` via `sips` (macOS-only, same tool as the render itself). */
function cropPng(source: string, rect: Rect, outputPath: string): void {
    runSips(
        [
            '-c',
            String(rect.height),
            String(rect.width),
            '--cropOffset',
            String(rect.y),
            String(rect.x),
            source,
            '--out',
            outputPath,
        ],
        outputPath,
        {
            notFound: 'cover compositor: sips not found; cannot write the crop previews (macOS required)',
            failed: (status) => `cover compositor: sips crop failed (status ${status}); preview ${outputPath} missing`,
            missingOutput: `cover compositor: sips reported success but crop preview ${outputPath} is missing`,
        },
    );
}

/** The top-right corner window the reference-blend preview zooms into (emblem + its surroundings). */
export function referenceBlendRect(width = COVER_WIDTH, height = COVER_HEIGHT): Rect {
    const badge = logoRect(width);
    const x = Math.max(0, badge.x - 180);
    return {
        x,
        y: Math.max(0, badge.y - 16),
        width: Math.min(width - x, badge.width + 260),
        height: Math.min(height - Math.max(0, badge.y - 16), badge.height + 130),
    };
}

/**
 * 0387 R1 — write the inspectable verification artifacts: the full cover, one center-crop preview
 * per target platform (the exact rectangles `TARGET_CROPS`/`safeAreaRect` reason about), and the
 * reference blend (the full cover plus a zoom of the fused emblem). Every artifact is a real PNG
 * produced by the production compositor path — nothing here is a mock of the render.
 */
export function writeCoverPreviews(options: CoverPreviewOptions): CoverPreviewManifest {
    const width = options.width ?? COVER_WIDTH;
    const height = options.height ?? COVER_HEIGHT;
    const previewDir = resolve(options.previewDir);
    mkdirSync(previewDir, { recursive: true });

    const coverPath = join(previewDir, 'cover-full.png');
    compositeCover({ ...options, outputPath: coverPath });

    const crops: CoverCropPreview[] = TARGET_CROPS.map((crop) => {
        const rect = centerCropRect(width, height, crop.aspect);
        const path = join(previewDir, `crop-${crop.platform}.png`);
        cropPng(coverPath, rect, path);
        return { platform: crop.platform, label: crop.label, aspect: crop.aspect, rect, path };
    });

    let referenceCoverPath = '';
    let referenceBlendPath = '';
    let referenceLogoPath = '';
    if (options.referenceLogoPath !== undefined && options.referenceLogoPath !== '') {
        referenceLogoPath = resolve(options.referenceLogoPath);
        if (!existsSync(referenceLogoPath)) {
            throw new Error(
                `cover compositor: reference emblem missing (${referenceLogoPath}); refuse to fake the blend`,
            );
        }
        referenceCoverPath = join(previewDir, 'cover-reference.png');
        compositeCover({ ...options, outputPath: referenceCoverPath, logoPath: referenceLogoPath });
        referenceBlendPath = join(previewDir, 'reference-logo-blend.png');
        cropPng(referenceCoverPath, referenceBlendRect(width, height), referenceBlendPath);
    }

    const layout = layoutHeadline(options.headline, width, height);
    const manifest: CoverPreviewManifest = {
        coverPath,
        width,
        height,
        safeArea: layout.safe,
        headlineBlock: layout.block,
        rows: layout.rows.length,
        truncated: layout.truncated,
        crops,
        referenceCoverPath,
        referenceBlendPath,
        referenceLogoPath,
    };
    writeFileSync(join(previewDir, 'manifest.json'), `${JSON.stringify(manifest, null, 4)}\n`, 'utf-8');
    return manifest;
}
