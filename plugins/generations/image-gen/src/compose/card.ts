/**
 * Task 0180 (F616) — card HTML builder and coverage asserter.
 *
 * `CardComposer` is the seam: tests inject a stub; `chromium.ts` is the default.
 * `cardHtml` builds a self-contained HTML document with @font-face data: URLs
 * and [data-field] attributes on every text element so the Chromium composer can
 * measure overflow. No external requests, no system fonts.
 */

/** The compose block declared in a format preset's YAML. */
export interface ComposeBlock {
    engine: 'text-card';
    safeArea: number;
    headlineMinPx: number;
    bodyMinPx: number;
    illustrationHeight: number;
    palette: { background: string; text: string; accent: string };
    fonts: { headline: string; body: string };
}

/** The full input to one compose call. */
export interface CardInput {
    headline: string;
    points: string[];
    role: string;
    compose: ComposeBlock;
    width: number;
    height: number;
    /** Raw provider illustration, if available; absent on the pre-spend probe. */
    illustration?: { bytes: Uint8Array; mime: string };
}

/** Injectable seam: compose one card PNG from the input. */
export interface CardComposer {
    compose(input: CardInput): Promise<Uint8Array>;
}

/**
 * R4 — check every character of headline and points against the font's cmap.
 * Whitespace and line breaks are exempt. Throws loud on the first uncovered
 * character, naming the field, the code point (U+HHHH form), and the glyph char.
 *
 * @param input  The card input whose text is checked.
 * @param fonts  Map from font filename → coverage predicate. Keys must include
 *               `compose.fonts.headline` and `compose.fonts.body`.
 */
export function assertCoverage(input: CardInput, fonts: Map<string, (cp: number) => boolean>): void {
    const headlineCover = fonts.get(input.compose.fonts.headline);
    const bodyCover = fonts.get(input.compose.fonts.body);

    if (headlineCover === undefined) {
        throw new Error(`compose: headline font '${input.compose.fonts.headline}' not loaded`);
    }
    if (bodyCover === undefined) {
        throw new Error(`compose: body font '${input.compose.fonts.body}' not loaded`);
    }

    const checkField = (text: string, fieldName: string, covers: (cp: number) => boolean): void => {
        for (const ch of text) {
            const cp = ch.codePointAt(0);
            if (cp === undefined) continue;
            // Exempt whitespace and newlines (U+0000–U+0020, U+00A0, U+2000–U+200F, etc.)
            if (cp <= 0x20 || cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200f) || cp === 0x3000) {
                continue;
            }
            if (!covers(cp)) {
                const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
                const fontName = fieldName.startsWith('points')
                    ? input.compose.fonts.body
                    : input.compose.fonts.headline;
                throw new Error(`compose: ${fieldName} has ${hex} '${ch}' not covered by ${fontName}`);
            }
        }
    };

    checkField(input.headline, 'headline', headlineCover);
    for (const [i, point] of input.points.entries()) {
        checkField(point, `points[${i}]`, bodyCover);
    }
}

/** One named segment that contributed to the composed prompt, for source-naming. */
export interface TextFreeSource {
    source: string;
    text: string;
}

/**
 * Task 0181 (F616 R1) — a compose format's illustration prompt must stay
 * text-free: no Han character anywhere, and never the headline or any point as
 * a literal substring (trimmed, length >= 2, so Latin-script card copy is
 * caught too). Numerals and ordinary Latin words are fine: the negative prompt
 * tells the model what to draw, not what it may contain.
 *
 * `sources` are checked in call order so a violation is attributed to the
 * offending contributor (template, style preset, extra, a named var); when no
 * single segment explains the hit, the composed `prompt` itself is named.
 * Call this BEFORE any font IO, compose, or provider spend.
 */
export function assertTextFreePrompt(
    prompt: string,
    copy: { headline: string; points: string[] },
    sources: TextFreeSource[],
): void {
    const hit = (text: string): string | null => {
        const headline = copy.headline.trim();
        if (headline.length >= 2 && text.includes(headline)) return `the headline '${headline}'`;
        for (const point of copy.points) {
            const trimmed = point.trim();
            if (trimmed.length >= 2 && text.includes(trimmed)) return `point '${trimmed}'`;
        }
        const han = /\p{Script=Han}/u.exec(text);
        if (han !== null) {
            const cp = (han[0]?.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
            return `Han character '${han[0]}' (U+${cp})`;
        }
        return null;
    };
    const fail = (source: string, what: string): never => {
        throw new Error(
            `compose: the illustration prompt must stay text-free — ${source} contributes ${what} (card copy is typeset, never prompted)`,
        );
    };
    for (const { source, text } of sources) {
        const what = hit(text);
        if (what !== null) fail(source, what);
    }
    const what = hit(prompt);
    if (what !== null) fail('the composed prompt', what);
}

/**
 * Build the self-contained HTML card document.
 *
 * Layout: illustration band (top, `object-fit: cover`) + text panel (below).
 * All text is in fixed px inside the safe-area inset. @font-face references fonts
 * by the URLs in `fontUrls` (data: URLs, local file:// URLs, or route URLs).
 *
 * Fit rule for headline: starts at `headlineMinPx * 1.5`, steps down 4px until
 * it fits the safe-area width, never below `headlineMinPx`. Bullets use `bodyMinPx`.
 *
 * @param input     Card input.
 * @param fontUrls  Map from font filename → URL string (any scheme accepted by the browser).
 */
export function cardHtml(input: CardInput, fontUrls: Map<string, string>): string {
    const { compose: cfg, width, height, illustration } = input;
    const { safeArea, headlineMinPx, bodyMinPx, illustrationHeight, palette } = cfg;

    const headlineFont = fontUrls.get(cfg.fonts.headline) ?? '';
    const bodyFont = fontUrls.get(cfg.fonts.body) ?? '';

    // Headline starts at 1.5x the minimum and steps down by 4px.
    const headlineStartPx = headlineMinPx * 1.5;

    const textPanelHeight = height - illustrationHeight;
    const safeWidth = width - safeArea * 2;

    const illustrationSrc = illustration
        ? `data:${illustration.mime};base64,${Buffer.from(illustration.bytes).toString('base64')}`
        : '';

    const pointsHtml = input.points
        .map(
            (pt, i) =>
                `<div class="point" data-field="points[${i}]" style="font-size:${bodyMinPx}px;">${escHtml(pt)}</div>`,
        )
        .join('\n');

    return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<style>
@font-face {
  font-family: 'NotoSansSC-Bold';
  src: url('${headlineFont}') format('opentype');
  font-weight: bold;
  font-style: normal;
}
@font-face {
  font-family: 'NotoSansSC-Regular';
  src: url('${bodyFont}') format('opentype');
  font-weight: normal;
  font-style: normal;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: ${palette.background};
}
.card {
  width: ${width}px;
  height: ${height}px;
  display: flex;
  flex-direction: column;
  background: ${palette.background};
}
.illustration-band {
  width: ${width}px;
  height: ${illustrationHeight}px;
  flex-shrink: 0;
  overflow: hidden;
  background: ${palette.background};
}
.illustration-band img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.text-panel {
  width: ${width}px;
  height: ${textPanelHeight}px;
  flex-shrink: 0;
  padding: ${safeArea}px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  overflow: hidden;
  background: ${palette.background};
}
.headline {
  font-family: 'NotoSansSC-Bold', sans-serif;
  font-weight: bold;
  color: ${palette.text};
  line-height: 1.3;
  margin-bottom: ${Math.round(safeArea / 2)}px;
  word-break: break-all;
  white-space: normal;
  /* font-size is set inline with JS fit-step */
  font-size: ${headlineStartPx}px;
}
.points-container {
  display: flex;
  flex-direction: column;
  gap: ${Math.round(bodyMinPx * 0.5)}px;
}
.point {
  font-family: 'NotoSansSC-Regular', sans-serif;
  font-weight: normal;
  color: ${palette.text};
  line-height: 1.5;
  word-break: break-all;
  white-space: normal;
}
.safe-area-sentinel {
  position: absolute;
  top: ${illustrationHeight + safeArea}px;
  left: ${safeArea}px;
  width: ${safeWidth}px;
  height: ${textPanelHeight - safeArea * 2}px;
  pointer-events: none;
}
</style>
</head>
<body>
<div class="card">
  <div class="illustration-band">
    ${illustrationSrc ? `<img src="${illustrationSrc}" alt="">` : `<div style="width:100%;height:100%;background:${palette.background};"></div>`}
  </div>
  <div class="text-panel">
    <div class="headline" data-field="headline" id="headline">${escHtml(input.headline)}</div>
    <div class="points-container">
      ${pointsHtml}
    </div>
  </div>
</div>
<div class="safe-area-sentinel" id="safe-area-sentinel"></div>
<script>
(function () {
  // Step headline font down from start until it fits, never below floor.
  var headline = document.getElementById('headline');
  var headlineMinPx = ${headlineMinPx};
  var headlineStartPx = ${headlineStartPx};
  var safeWidth = ${safeWidth};
  var panelHeight = ${textPanelHeight - safeArea * 2};
  var size = headlineStartPx;
  while (size > headlineMinPx) {
    headline.style.fontSize = size + 'px';
    if (headline.scrollWidth <= safeWidth && headline.scrollHeight <= panelHeight) break;
    size -= 4;
  }
  headline.style.fontSize = Math.max(size, headlineMinPx) + 'px';
})();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
