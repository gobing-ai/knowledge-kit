# Xiaohongshu image cards (feature E8, shipped — 0167 publisher, 0168 skill + presets, daily-pipeline target)

## Decision and boundary

`kk:xhs-images` is the content planner and operator surface. `image-gen` remains the only image renderer; `xhs-pub` remains the publish transport and `Result` owner. No new product generator or provider adapter is needed. The vendored `baoyu-xhs-images` skill informs card flow, layout, and prompt guidance; this feature keeps `kk:image-authoring`'s provider selection, preset roots, spend preview, and preference order. Adapt guidance rather than copying the vendor's backend and `EXTEND.md` lifecycle.

## Flow

1. Read article or note; propose 1–10 ordered cards with cover, content, and optional closing card. Record each card's source point, role, short Chinese copy, layout, and visual subject. The original source is never mutated.
2. Resolve `image-gen` format `xhs-card` (`job: free`, portrait `3:4`) and an existing or shipped XHS style. Save each card's `image-gen` envelope (`cards/NN.in.json`) and its exact composed prompt (the `KK_IMAGE_DRY_RUN=1` `Content.body`, `cards/NN.prompt.txt`) before spending. The cover is rendered first; when the selected provider supports reference images, subsequent cards use its artifact as their reference. Otherwise the plan keeps one style/palette and the preview discloses the weaker consistency path. Explicit user reference images keep the existing provider-capability refusal rule.
3. The series total N must not exceed the resolved `KK_IMAGE_MAX_IMAGES` / `image.max_images`. The skill enforces this, because `image-gen`'s cap is per invocation. After one series spend preview and the existing confirmation policy, invoke `kk executor run image-gen` once per card with `maxImages: 1` and a unique output stem. Each call retains its own output and cleanup boundary; the skill stops at the first failed card; rerunning on the same `--out` reuses the saved plan and envelopes and renders only cards without an image.
4. Write `cards.json` and a `Content` payload. `Content.title` and `body` are the XHS title and Chinese note. `Content.metadata.images` is an array of the existing `ImageArtifact` objects in card order; the publisher reads each `.path`. `Content.metadata.publishStatus` is `draft` by default or `public` only for an explicit live request. Prompt paths, source points, and layout stay in `cards.json`, not in the publish DTO.
5. The skill hands `content.json` to `kk:publish xhs`, which owns the live confirmation; the skill never spawns `xhs-pub` directly. `xhs-pub` validates the ordered paths and image files before opening the browser. Its default driver is `script` (ADR-024; `agent` fails loud for this channel). The script driver opens the persistent profile through `@gobing-ai/ts-browser-automation` (harness `kkBrowserLauncher` default since 0214; existing injectable launcher function and `OpenPage` seam, 0177), attaches files in order, fills the note, and saves a real draft or submits only when `publishStatus: public`. Browser-observed completion determines the `Result`; no synthetic draft ID or session-ready success. An ambiguous UI state yields `ok: false` with the action named. `Result.metadata.publishStatus` distinguishes `draft` from `public`; platform ID/URL appears only when observed.

### Profile reuse (dogfood recipe, 0177)

The publish run reuses the signed-in session from `~/.config/kk/browser-profiles/xhs`; no credentials are stored by kk. One-time setup and any session-expiry recovery:

```bash
# 1. Headed one-time login — sign in interactively in the opened window, then it exits.
bun plugins/publishings/xhs-pub/src/profile-check.ts login

# 2. Offline profile/expiry check — exit 0 = no known refusal, exit 1 = absent, expired or unreadable.
bun plugins/publishings/xhs-pub/src/profile-check.ts check
```

Both commands accept `--profile <dir>` and `--timeout <ms>`; profile dir precedence is `--profile` > `XHS_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/xhs`. Default `check` opens no browser; `check --headed` probes the saved session explicitly. Offline expiry is an estimate, and the publish visit still verifies readiness.

## Surface

- Agent entry: `kk:xhs-images <source> [--style <preset>] [--count <1..10>] [--out <dir>] [--live]`. The skill defaults to a draft and uses `kk:image-authoring`'s preview and payment controls. `--live` is an explicit operator instruction; unattended workflow mode still needs a separate launch-time live switch per ADR-022.
- Shipped presets: `image-gen/presets/formats/xhs-card.yaml` and `presets/styles/xhs-knowledge.yaml` (layout/typography/consistency guidance adapted from `baoyu-xhs-images`, MIT © Jim Liu, via `plugins/kk/skills/xhs-images/references/card-layouts.md`). Existing styles remain selectable. Format variables cover card role, layout, source-grounded copy, and scene; output is one image per call.
- `cards.json`: `{ source, cards: [{ index, role, sourcePoint, copy, layout, promptPath, imagePath, illustrationPath, status }] }` (`status: pending | rendered | failed`) in display order. `illustrationPath` is set when the card composed an illustration — the recorded absolute path of the raw provider image (0181). The authoring skill checks prompt and image existence before packaging.
- `Content.metadata.images[]`: existing `ImageArtifact` objects; `xhs-pub` requires non-empty ordered absolute paths. `Content.metadata.publishStatus`: `draft | public`, default `draft`. Unknown status fails before browser action.

## Daily pipeline integration

`plugins/kk/workflows/kk-daily-ai-voice.yaml` wires the same capability into the unattended daily
run as the `xhs-write` → `xhs-publish` pair, sitting between `publish-podcast` and the
`publish` classification state.

- **Source:** the lead plan item only (`21-plan/<run_date>_03_plan_plan.json` item 1) — the same
  source the daily cover's subject brief reads. One coherent story, not the whole digest.
- **Skill vs stage:** the daily run does **not** invoke `kk:xhs-images`. It follows F614's cover
  split instead — the agent authors copy only (`25-xhs/<run_date>_18_xhs_plan.json`), and
  `kk stage daily-xhs-render` owns format/style/provider/model plus the render loop. A second,
  skill-driven path into the same presets would let the card look drift.
- **Spend:** `${vars.xhs_cards}` (default 4) is the fixed series size, rendered unattended with no
  confirmation gate. The stage refuses a plan whose card count disagrees with it, refuses more than
  10, and reuses any card whose recorded artifact is still on disk — a resume after a failed card
  re-bills only the cards that are actually missing.
- **Draft by default:** `metadata.publishStatus` is `draft` unless the launch-time `xhs_live` switch
  is `true` (ADR-022). `kk stage daily-publish-xhs` runs `kk executor run xhs-pub` directly on its
  default `script` driver — the browser work is the plugin's, not an agent step.
- **Non-blocking:** the XHS outcome never enters `publish_status` (surfdash + podcast remain the
  episode's publication contract). Both stages carry `onError: continue`, and the publish stage is
  `soft` on the plugin call, so a missing profile, an expired session, or a changed creator console
  logs a loud failure and the run still finishes. `xhs_enabled: "false"` (a launch-time var)
  removes the target entirely; since 2026-09-29 the workflow ships it **on** (draft-only, see
  ADR-025 amendment in `docs/00_ADR.md`).
- **Platform automation risk (2026-09-28).** XHS warned the operator about automated login/publish
  activity, and this channel is the one target in the repo that drives an interactive creator
  console from a headed browser — so the exposure is account-level, not just a failed run. The
  resulting guard (ADR-025) is described under **Automation risk policy** below, and it applies to
  the workflow target too. ADR-025's original "must not be enabled on a scheduled run" clause is
  **superseded** by its 2026-09-29 amendment: the target ships **on**, draft-only, with those
  plugin-level guards as the accepted mitigation.
- The daily note is short-form (≤20-char title, ≤1000-char body, 2–4 bullets per card), so the
  series stays inside the legibility budget above.

## Automation risk policy (ADR-025, 2026-09-28)

XHS warned the operator about automated login/publish activity. `xhs-pub` is the only target in the
repo that drives an interactive creator console from a headed browser, so a runaway loop is an
account-level risk rather than a failed run. Four rules, enforced in the plugin so every surface
(workflow, skill, manual `kk executor run`) inherits them:

1. **One headed visit, readiness first.** Publish opens the console once and waits only for the
   authenticated mode bar within `PREFLIGHT_TIMEOUT_MS` (90 s across navigation and readiness).
   Failure returns an effect-free session refusal naming `kk bot login xhs`, without composing
   a note or waiting for interactive login. No plugin path launches headless.
2. **One headed publish cycle and one headed session check per 2 h.** Both are capped in
   `automation-guard.ts` (`~/.config/kk/xhs-automation.json`, override `KK_XHS_AUTOMATION_STATE`).
   The publish budget is consumed at the single launch, including a visit whose session refuses.
   Default `check` reads the profile and `bot.json` offline without consuming a budget: an absent
   profile, expired estimate or unreadable metadata refuses; other profiles report `offline:`
   with expiry or `expiry unknown`. Cookie expiry is only an estimate; the publish readiness gate
   is authoritative. `check --headed` opts into one real probe and consumes the check budget.
3. **`login` and `open` are operator-interactive and uncapped.** Both use `runProfileCli` with
   the XHS readiness predicate. A bot-mode login reports estimated cookie expiry for `kk bot list`;
   legacy profiles without expiry remain usable. A human signs in inside the opened window.
4. **A corrupt or unreadable state file fails closed.** The guard cannot prove the window is clean,
   so it refuses with an actionable message instead of silently granting a fresh budget. Delete the
   file to reset deliberately.

Also unchanged and load-bearing: a live `发布` submit is **single-click** (an unobserved publish is
never retried, because a retry risks a second public post), while draft saves keep a bounded retry
because drafts are cheap and deletable.

Operator recipe: run `bun plugins/publishings/xhs-pub/src/profile-check.ts check` offline before
publishing. If it refuses, use `kk bot login xhs`; use `check --headed` only for an explicit
console probe. A dead-session publish already spent its visit budget, so recovery does not permit
another publish until the next window. The channel remains off pending operator follow-up.

## Checks and limits

- Offline checks cover plan-to-card mapping, preset parsing, ordered artifact packaging, path validation, draft/public routing, and browser success/failure with a fake page/transport. One representative Chinese article should be rendered and inspected for legibility before calling the feature shippable.
- **Live creator-UI contract (measured 2026-09-25, task 0174).** The console does not match the selectors the first implementation assumed, and each mismatch is now an executed step: the page opens on the **video** tab, so the driver force-clicks the in-viewport `div.creator-tab` (图文) before anything else and treats that tab as the login gate; the image input is a **hidden** `input[type="file"][accept*=".jpg"]` (hidden inputs are normal for upload widgets, so attachment — not visibility — is what the driver probes); uploaded cards are counted as `img.preivew-image` (XHS's own spelling) inside `.content-center-image-container`; the note body is **TipTap ProseMirror** (`div.tiptap[contenteditable="true"]`) and must be **typed**, because setting the value does not register content and leaves the save with nothing to persist; and the submit bar is the custom element `<XHS-PUBLISH-BTN>`, whose shadow root is **closed**, so its `暂存离开` (draft) and `发布` (publish) controls are resolved through CDP (`DOM.getDocument {pierce:true}` + `DOM.getBoxModel`) and clicked at the measured centre — never a hardcoded coordinate (the live box moved between runs: 606,855 → 556,675). A driver without CDP access fails loud rather than clicking blind, and a submit click that lands while the note is still settling is retried a bounded number of times.
- **Verification state (2026-09-26).** Scenarios `R7` and `R1`–`R3` are verified from executed runs (dry-run capture, cap refusal, failure-path stop-spend, resume of a single missing card, and the operator-approved paid 4-card render). `R4` is verified against the live account: the driver created a real draft with the four ordered cards and the console's draft counter moved (18 → 19 on the confirming run, `draftControl: 暂存离开`, one click attempt). Draft confirmation requires a delta against the pre-entry baseline — XHS autosaves uploads, so a merely readable counter is not evidence of this save. `R5` (explicit live publication) was live verified on 2026-09-26 (`result.public3.json`: `ok: true`, live post confirmed on creator console, post observed then deleted) and `R6`'s failure paths are covered in unit and offline flow suites. All tasks (`0167`, `0168`, `0174`) and feature `E8` are `PASS` and `done`.
- Runtime prerequisite: `playwright` and Chromium are available to the kk install (the bundler keeps `playwright` external; since 0177 the xhs-pub bundle inlines `@gobing-ai/ts-browser-automation`). If either is missing, the result is `Result.ok: false` with the install hint.
- The live console contract above is measured, not contractual: XHS can change its DOM. The driver fails loud and names the failing step (login gate, tab, upload, thumbnail count, body, submit control, or draft confirmation) instead of reporting an outcome it did not observe.
- The submit bar holds both `暂存离开` (draft) and `发布` (live) in one closed shadow root, so the driver always reads the target's box before clicking and never clicks a fixed position. A bounded retry of a *draft* save can leave more than one draft on the console (drafts are cheap and deletable); the live `发布` path is never retried — an unobserved publish fails loud and tells the operator to check the note manager before retrying.
- **Live publish reliability (measured 2026-09-26).** A publish run reached the console's success page and created a real post (`.spur/run/xhs-live-preflight/result.public3.json`: `ok:true`, 4 ordered cards, `publishControl: 发布`), and the post was then removed through the note manager and verified absent. Two earlier attempts had the `发布` click dropped by the console (no post created; `ok:false` with the duplicate warning) on the same fixed settle — the publish path deliberately stays **single-click**: a dropped click fails loud instead of risking a second public post, so the operator re-runs once when that happens. Draft saves stay bounded-retry because drafts are cheap and deletable.
- **Text-free illustration contract (0181).** The composed provider prompt must stay text-free:
  no Han character anywhere and never the headline or any point as a literal substring (trimmed,
  length ≥ 2 — Latin card copy is caught too; numerals and ordinary Latin words are fine).
  `image-gen` refuses pre-spend (dry runs included) naming the offending segment — the format
  template, the style preset, `spec.extra`, or a named var — and the shipped `xhs-card` ×
  `xhs-knowledge` presets enforce it (the template states `no text, no letters, no numerals`; the
  style carries a text `negative`). MiniMax `image-01` has no negative-prompt field, so the
  positive prompt (template + keywords + modifiers) is the only instruction it sees. Keywords
  must not ask for an image-text or Xiaohongshu poster layout: that phrasing is what painted
  pseudo-Chinese into the saved illustration JPG while the composed PNG stayed legible (Noto
  Sans SC typesets the headline and points). A weak card is regenerated from an edited prompt;
  bitmap text repair is outside scope. Saved prompts preserve the reproduction path.

## Deterministic text typesetting (2026-10-01, ADR-028)

Card copy (headline + bullet points) is never sent to the image provider as prompt text. For
compose formats (any format preset carrying a `compose` block, e.g. `xhs-card`), the image-gen
plugin composes a text layer deterministically: pure TypeScript builds the card HTML from
`(headline, points, role, compose, font bytes)` and headless Chromium (Playwright, local, no
network) screenshots it at the declared canvas (1080x1440 for `xhs-card`). The provider renders
the illustration band only; the card PNG is `compose(illustrationBytes) | text-only`.

Boundary and guarantees:

- **Pure + byte-identical (R3):** same inputs → same PNG bytes; the artifact script
  (`bun plugins/generations/image-gen/scripts/compose-e2e-artifact.ts`) proves SHA-256
  determinism per variant and writes `.spur/run/0180/card-{without,with}-illustration.png`.
- **Fonts:** pinned Noto Sans SC SubsetOTF Regular+Bold ship in `assets/fonts/` (OFL license,
  `SOURCE.md` provenance). A pre-spend cmap check fails loud naming field + code point for any
  uncovered character (whitespace/line breaks exempt); `KK_IMAGE_DRY_RUN=1` runs the full
  pre-spend path without provider spend or Chromium.
- **Safe area (R2):** every `[data-field]` box is measured in-page against the 72px inset;
  overflow fails loud naming the field. Headline starts >=64px, bullets >=36px.
- **Artifact contract (R5, task 0182):** the job artifact `ImageArtifact` keeps `.path` (composed card)
  at the format's declared canvas, records `sizeRequest: 'exact' | 'aspect'`, and adds
  `.illustration = {path, width?, height?, bytes}` holding the raw provider delivery (e.g. 864x1152
  on MiniMax `image-01` before canvas forwarding or on fallback); downstream (`xhs-pub`,
  daily stages) reads only `.path`.
- **Environment:** the E2E case runs inside `bun test` on Bun 1.4.3 and skips only when
  Playwright's Chromium is absent. The 1.3.14 launch block is gone (re-measured 2026-11-04). The
  artifact script runs all variants in one process. Clean `browser.close()` does not leak
  processes. `compose`'s deadline bounds a hung cycle.
