# Quasi-News Podcast Cover System (准新闻播客封面系统)

Author: Robin Min / Agent
Date: 2026-11-10
Feature: L2 (`daily-ai-voice-quasi-news-podcast-cover`)
ADR: ADR-046

## 1. Context & Motivation

The existing Daily AI News cover generation pipeline (`daily-news-cover` format + `daily-news` style) renders flat, abstract vector illustrations with a strict negative text prompt (`negative: text, letters...`). While clean, it lacks the urgency, storytelling, and viral clickability of professional news podcasts, current-affairs journals, and investigative features (e.g., CommonWealth Magazine 天下雜誌, Focus 全球新聞, breakthrough automotive news).

To transform the Daily AI News cover into a **quasi-news podcast cover (准新闻类播客封面)**, the system must:
1. Ground both the visual imagery and the headline in the day's lead news item.
2. Formulate a high-impact, suspenseful, or provocative Chinese Hook headline (e.g., "核心事件定性 / 悬念转折提问").
3. Preserve established brand identity across episodes (consistent logo placement, brand color anchoring, without cluttering the frame with full title strings).
4. Strictly prevent Chinese character distortion/hallucination (抗乱码) by avoiding pure-diffusion text generation.
5. Maintain existing target dimensions (1344x576 at 21:9) and downstream compatibility.
6. Provide an isolated, mock-driven test runner to verify output instantly without waiting for daily cron runs.

## 2. Visual Reference Analysis

Deconstruction of the reference samples:
- **天下雜誌 Video Style**:
  - Upper-left red square logo badge.
  - Background: Authentic, dramatic news scene (photorealistic, documentary contrast).
  - Typography: Pure white, clean heavy sans-serif Chinese characters in lower-third, left-aligned, accompanied by a subtle red corner framing bracket.
  - Media cue: White headphone icon in lower-right indicating audio/podcast format.
- **Focus 全球新聞 Style**:
  - Upper-left program logo, upper-right pill badge.
  - Background: Subject cutout composite over thematic background (currency, protest, key figure).
  - Typography: High-contrast dual-color text with dark outlines (e.g., Yellow + White).
- **Breaking News / Viral Thumbnail Style**:
  - Bold, impactful 2-stage title hierarchy ("事件爆点 + 颠覆性结论").
  - Clear focal imagery with dramatic lighting and color contrast.

## 3. Two-Layer Architecture: Generation + Deterministic Typography

```
                  Curated Daily News Items
                             │
                  ┌──────────┴──────────┐
                  ▼                     ▼
          English Visual Scene    Chinese Headline Hook
             Prompt (≤240 chars)    (1-2 lines, ≤25 chars)
                  │                     │
                  ▼                     │
       Layer 1: AI Diffusion            │
      (minimax / FLUX / SD)             │
   Generates Clean Background           │
    (No text, cinematic lighting)       │
                  │                     │
                  └──────────┬──────────┘
                             ▼
              Layer 2: Deterministic Compositor
              (SVG/Canvas/Sharp Overlay Engine)
             ┌────────────────────────────────┐
             │ - Render Clean Chinese Fonts   │
             │ - Overlay Podcast Logo Badge   │
             │ - Apply Accent Frame & Shadows │
             └────────────────────────────────┘
                             │
                             ▼
              Final Composite Cover PNG
               (1344 x 576, 100% Crisp)
```

### Layer 1: AI Background Generation
- **Preset Format**: `daily-news-podcast-cover` (aspect ratio 21:9, 1344x576).
- **Preset Style**: `quasi-news-podcast` (editorial documentary photography, cinematic dramatic lighting, deep navy/slate shadows, bold subject focal point).
- **Negative Prompt**: `text, letters, words, numbers, watermark, logos, distorted typography, messy banners`.
- **Composition Guidance**: Leaves negative space in the lower-third or left-half with sufficient contrast for typography.

### Layer 2: Deterministic Typography & Branding Overlay
- **Typography Engine**: Deterministic SVG template rendered and composited over the AI-generated background.
  - Uses system sans-serif fonts (PingFang SC, Hiragino Sans GB, Noto Sans CJK SC).
  - High-contrast text styling: pure white (`#FFFFFF`) or signal yellow (`#FFE600`) with subtle drop shadows (`rgba(0,0,0,0.8)`) and optional dark gradient backing scrim.
- **Branding Badge**:
  - Asset: `assets/general/xhxs.svg` (vector) or `assets/general/xhxs.jpg`.
  - Placement: Anchored at the top-left or top-right corner.
  - Simplification rule: The lower text portion (`SALTY CLUB`) is omitted / cropped out to keep the badge compact, uncluttered, and focused on the core emblem, avoiding redundant text on wide landscape covers.
- **Accent Elements**:
  - Optional subtle editorial red/amber L-bracket or audio podcast symbol in the corner.

## 4. Pipeline & Workflow Integration

### Stage Updates in `kk-daily-ai-voice3.yaml`:
1. **`script-write` (via `kk:news-editorial`)**:
   - Master script plan schema extended:
     ```json
     {
       "cover": {
         "scene": "A glowing quantum computing processor encased in cryogenic frost inside an industrial research lab",
         "headline": "量子芯片算力暴涨千倍？\n全球科技巨头底层暗战打响！"
       }
     }
     ```
   - Fallback compatibility: If `cover` is a plain string, treated as `scene` with headline derived from the lead story title.
2. **`editorial-render`**:
   - Emits `23-cover/${runDate}_07_cover-brief.json` with `{ "scene": "...", "headline": "..." }`.
3. **`daily-cover`**:
   - Invokes `image-gen` to generate the clean background.
   - Executes deterministic compositor to overlay the Chinese headline and logo.
   - Emits `${runDate}_07_cover_cover.png`.
4. **`daily-cover-normalize`**:
   - Verifies the composited artifact dimensions and output contract.

## 5. Mock Testing & Standalone Execution

A standalone testing script and CLI verb:
```bash
kk cover render --mock --lead "OpenAI推出全新推理模型Strawberry" --out /tmp/test-cover.png
```
Enables immediate visual inspection of prompt synthesis, AI background generation, and typography compositing without triggering a full voice/audio run.
