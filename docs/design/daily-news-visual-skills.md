# Daily AI news cover and illustration skills

**Shipped · 2026-11-24 · L4 · ADR-057** (design accepted 2026-11-22; tasks 0424–0427)

[Vendor and repository comparison](../plans/2026-11-22-daily-news-visual-skills-brainstorm.md)

## 1. Ownership

| Owner | Outputs and responsibilities |
| --- | --- |
| `kk:news-editorial` | Approved stories and IDs, claims, Chinese Hook and frozen episode identity, and card editorial copy |
| `kk:daily-news-cover` | One concrete text-free scene grounded in the lead. Selects a composition with room for the existing podcast and OG overlays. |
| `kk:daily-news-illustrations` | Grounded card art direction and optional inline placement, caption, alt text and visual concepts |
| Daily CLI/stages | Validation, fallback, resume, dispatch settings, typography for the podcast/OG cover, and artifact handoff to consumers |
| `image-gen` | Preset interpolation, provider requests, raw image artifacts, card composition and inline anchors/captions |
| Publish/materialization | Target-specific reference resolution and reviewed/frozen payloads |

Place each skill and its focused examples under `plugins/kk/skills/`. Put shared daily composition principles in one installed reference under the plugin and have both skills link to it. Keep channel-specific constraints in the actual preset or task-specific reference. Manual authoring consumes the same inputs and emits the same brief/plan as scheduled authoring. An unattended invocation uses the settled lead/card order and existing settings. One direct request can supply explicit direction or assets, subject to the existing render contracts.

## 2. Cover and cards

- Add the visual skill references to the scheduled master-plan author and repair paths. Preserve `cover.scene` or legacy string, `cover.headline` and provenance, and the existing card shape. In supported legacy voice workflow prompts, leave only input/output mapping and a skill pointer. Read skill references from the resolved plugin directory in both checkout and installed modes.
- Cover composition choices are product-led, concrete metaphor, and simple comparison. Use an ordered default based on available source evidence and whether the fact is inherently comparative. Describe focal subject, scene relationship, visual weight, protected crop and headline/logo zones. Keep the current scene limit and presets. Prefer non-person subjects by default. Use an approved reference only when the existing request and configured provider support it. Standalone renders can use the existing mock runner.
- Keep cover generation on the existing pinned daily path. Keep both existing cover outputs, conditional headline/logo composition, template fallback and cached behavior. Compare the wider podcast crop and the OG crop in the same review.
- Illustration guidance grounds each card scene in the existing card source point. It preserves copy, source IDs, card roles/order and deterministic card typesetting. Use the existing card retry and resume behavior. Keep the generic `kk:xhs-images` and `kk:image-authoring` paths available for non-news use.

## 3. Optional inline figures

- Freeze an explicit opt-in in the existing news run options, default off. Reuse the run's approved identifiers. Start with the original-language reviewed article and no more than two figures. Choose one exact unique paragraph per concept, outside code blocks, headings, quotations and existing images. Keep caption and alt text in the article locale. Record the source story ID alongside the concept for review.
- Plan against the reviewed source body and validate the whole plan and requested target before any provider call. Use the existing illustration job and its anchor semantics. Store generated figures and a derived article beside the run, preserving the reviewed original. Select only a proven target payload before the variants review/freeze so the reviewed bytes match the bytes submitted. Other variants retain their original article bytes. Reuse an existing complete receipt if the source, plan and files match.
- Prove the first target in a fake-adapter replay. Daily already builds `article@wechatmp-pub` with episode audio. The plain WeChat CGI path prepends body images and the editor path attaches them separately, so merely passing images as attachments cannot prove anchor placement on the daily audio route. Reuse the existing media transport and add target-specific placement support if the replay shows it is required. Require evidence of anchor order, captions, alt text and resolvable image sources through the selected route before enabling it. Reject unsupported target or anchor requests before spend. Keep local article/figure artifacts available for inspection and avoid embedding local file paths in remote posts. Other locales and channels require separately proven mappings before opting in.

## 4. Verification

Use a fixture episode with a stable lead and Chinese Hook, one cached card, both cover crops, two valid inline anchors, an ambiguous anchor and a target without body-media support. Capture the runner's plugin requests, cover and card outputs, anchored captions and frozen variant payload. Replay with opt-in off and on, then retry against the same run directory to prove no duplicate spend for complete outputs. Exercise missing/legacy cover data and installed skill discovery. The packaged replay (L4 0427, `apps/cli/tests/kk-news-generate.e2e.test.ts`) covers that half: it packs and extracts the CLI outside the repo, asserts discovery of both `SKILL.md` files and the shared `news-editorial/references/daily-visual-composition.md` with no `vendors/` dependency, and replays the default, cache and opt-in paths into `.works/tmp/test-news-generate/0427-packaged-replay-receipt.json`. Pair the automated replay with a side-by-side contact sheet for product announcement, abstract story and comparison when real renders are authorized. Score focal readability at thumbnail size, factual grounding, crop clearance, typographic integrity and card/figure fit. Existing image-gen presets and providers are sufficient for the planned architecture. Any later plugin change must identify the blocked fixture, preserve generic callers and remain provider-neutral.
