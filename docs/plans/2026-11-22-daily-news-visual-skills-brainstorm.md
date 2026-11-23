---
kind: plan
tags: [brainstorm, daily-news, image-gen]
needs_design: true
run_id: c6892c47-9cef-47d4-b18f-9926fccc9d9d
---
# Daily AI news visuals

## Vendor review

Reviewed the local snapshot at 8d1a0a5, including all ten layout templates, eight textual few-shots, eight rendered covers, README and LICENSE. The skill is a prompt author. It gathers intent, chooses a layout, loads a matching reference on demand, then turns the story into a physical subject with explicit placement, scale, depth and overlap. The rendered examples rely on a strong focal object or gesture, tight headline hierarchy and dark backgrounds with high-contrast type. The text reference library concentrates on dark gradient, product-led and collage layouts, so it gives limited evidence for the remaining seven. Start with original product-led, physical metaphor and comparison examples grounded in actual news. Apply safe zones from the target formats, reserve space for deterministic overlays and retain editorial tone. The portrait ratio, mandatory face, fixed reference slots, interactive questionnaires, generated Chinese text and clickbait styling belong to the vendor's use case. Keep the copyright and license notice if any substantial vendor material is reused. See vendors/gbro-cover-design/SKILL.md:142, vendors/gbro-cover-design/references/examples.md:1 and vendors/gbro-cover-design/LICENSE:1.

| Vendor composition | Transfer to daily news |
| --- | --- |
| Dark gradient | Use tonal separation behind the lead subject when it helps the existing headline overlay. Keep the published palette in the preset. |
| Flat color | Use a clean background where a compact card needs one legible object. |
| Product-led | Lead with the real product form or an approved reference, with the focal detail inside both crops. |
| Comparison cards | Translate a sourced before/after or A/B relationship into two distinguishable objects. Keep judgment and labels in editorial copy or captions. |
| Minimal negative space | Reserve clear space for the renderer's title or brand without crowding the focal subject. |
| Collage | Use explicit depth and overlap only when available assets carry the story. Limit layers for small displays. |
| Side placement | Use directional balance for the wide cover while protecting the tighter OG center crop. |
| Rear view | Borrow the viewpoint and depth for a grounded scene. Person-based framing is optional. |
| Partial appearance | Use a close-up or interaction detail to make the subject clear at thumbnail size. |
| Direct gaze | Borrow focal hierarchy. A host-led portrait would need its own approved source asset and editorial rationale. |

The vendor's repeated intake questions map to three inputs already available here: approved editorial context, destination format and optional references. Resolve them from the frozen run in scheduled mode. A manual request can override creative direction within the same render contract. Use the vendor checkout as review material and ship self-contained skill references.

## Current paths

- The scheduled script plan authors cover scene, headline, and card data (plugins/kk/skills/news-editorial/SKILL.md:92; plugins/kk/workflows/kk-news-generate.yaml:154). The canonical episode identity consumes the Hook. Keep the headline, story selection, provenance and story claims with editorial.
- The daily cover stage builds a pinned image-gen request (plugins/kk/scripts/daily-stages.ts:942). The normalizer reads the recorded raw artifact and composites the canonical 1344×576 podcast PNG and 1200×630 social JPG when the headline is present (plugins/kk/scripts/kk-workflow-stages.ts:1049; docs/00_ADR.md:1751). Legacy daily voice workflows include cover-brief prompts.
- The scheduled cards node delegates to generate-cards (plugins/kk/workflows/kk-news-generate.yaml:420). The daily XHS stage renders one text-free background per card, uses deterministic card typesetting, keeps completed cards on failure and maintains the optional episode-cover attachment and card order (plugins/kk/scripts/daily-stages.ts:6489). Legacy workflows also embed XHS visual directions. Generic kk:xhs-images still serves non-news requests.
- Generic kk:image-authoring describes inline placement (plugins/kk/skills/image-authoring/SKILL.md:69). image-gen validates one unambiguous non-overlapping anchor per planned image before spend and returns captions and updated Markdown (plugins/generations/image-gen/src/index.ts:153). Scheduled news has no equivalent inline node. Target adapters must prove image references survive materialization before enabling it. Keep the feature opt-in with zero additional scheduled spend by default.
- Existing image-gen presets own format, dimensions, and style. Its request already carries template vars, references and bounded counts. Preserve the provider/model pins, optional fallback and deterministic crop/typography. No plugin changes are currently justified. Verify this boundary with dry-run and use a narrow provider-neutral enhancement only if the existing contract blocks a requirement. K2 and K3 track provider/style experiments separately.

## Approaches

1. **Two editorial visual skills over the current renderers** (recommended). Move daily scene and layout guidance into two focused skills with small original examples. Have existing agents load those references and keep deterministic CLI stages in charge of validation and generation. Preserve fallback and artifact boundaries. Inline adds one explicit opt-in branch and requires path/locale verification.
2. **One universal visual skill and one plan across channels.** Fewer entry points but conflates episode imagery, typography-backed social cards and article placement, and changes editorial validation and resume boundaries.
3. **Move daily visual policy into image-gen presets or provider adapters.** Centralizes static styles and canvas controls, already owned there, but creates product-specific generator policy and cannot own editorial source selection or article placement.

## Design Summary

Use two dedicated skills under plugins/kk/skills. The cover skill interprets the approved lead and frozen headline for the existing podcast and OG render contract. The illustration skill authors the existing XHS card visuals and optionally a small, anchored inline set for the reviewed article. Both use the existing image-gen envelope and preserve the deterministic typography, presets, spend switches, and downstream artifacts. Put reusable composition examples next to the skills and keep all prose out of workflow YAML.
