# Illustration positions and captions

Loaded by the image-authoring skill when the resolved format's `job` is
`illustration`. Position detection, concept prompts and caption authoring are
**model work** — this file's — while the plugin does the deterministic half:
composing one prompt per anchor (the anchor rides the format's `concept`
template variable), generating, and inserting the markdown at the anchor. The
skill's entire output across this boundary is `metadata.positions` in the
`--in` envelope.

## The anchor contract

- `metadata.positions` is an **array of anchor strings**, one per illustration.
- Each anchor must occur **exactly once** in the doc `body` — the plugin
  inserts at that occurrence and fails loud if it is absent or ambiguous.
  Headings and distinctive sentences are safe anchors; short common phrases
  are not.
- The array length is the image count: `--count` must equal it, and each
  anchor is fed as image *i*'s `concept` var (`plugins/generations/image-gen/src/index.ts`
  composes one prompt per anchor in array order).
- The budget still applies: the default cap is 4 images (`maxImages`); a
  longer article does not silently spend past it.

## Detection procedure

Read the article once, end to end, then list **candidate** positions before
selecting. For each candidate record: line/section, **type**, a 0–12 **score**,
and a one-line rationale. The wt taxonomy, kept because it works:

| Type | Looks like | Typical score driver |
| --- | --- | --- |
| abstract concept | jargon-dense section with no visual ("microservices architecture", "service discovery") | technical-jargon density |
| information dense | wide tables, long parameter lists | structure that a diagram would organise |
| emotional transition | major section break, shift in narrative register | flow improvement |

Selection rules (the wt defaults, kept): prefer higher score; keep at least
~20 lines between chosen positions; respect the operator's `--count` as the
maximum; spread across types rather than clustering on one. Fewer, better
placements beat filling the quota.

For each **selected** position, author in the same pass:

1. **Anchor** — the exactly-once string from the body.
2. **Concept** — a one-sentence visual brief; the plugin feeds it to the
   format's `concept` variable, so write it as an image subject, not prose
   about the article.
3. **Caption and alt text** — the caption states what the image adds; the alt
   text describes the image for a screen reader (complete sentence, no "image
   of"). These are reported to the operator against each artefact path.
4. **Style** — default to the resolved style; `technical-diagram` suits
   concepts and dense reference content, `sketch` suits data relationships,
   `minimalist` suits transitions. A proposal, shown in the preview — the
   operator confirms the whole spend once.

## Worked example (from the wt plugin, the prior art)

Input: `article-before.md`, a 1,850-word microservices guide with no images.
Detection found **8 candidates, selected 5** (two dropped for sitting too
close to a higher-scoring neighbour, one for low score):

| # | Line | Type | Score | Selected |
| --- | --- | --- | --- | --- |
| 1 | 23 | abstract concept ("What Are Microservices?") | 12 | yes |
| 2 | 45 | abstract concept (service discovery) | 11 | yes |
| 3 | 62 | information dense (7-column API table) | 10 | yes |
| 4 | 79 | abstract concept (communication patterns) | 10 | no — too close to #3 |
| 5 | 92 | information dense (configuration list) | 11 | yes |
| 6 | 112 | emotional transition ("Best Practices") | 7 | yes |
| 7 | 128 | abstract concept | 8 | no — below the line |

The chosen anchors became `metadata.positions`; image *i*'s anchor was fed as
its `concept` — e.g. position 1's concept, "Microservices architecture pattern
with API gateway", produced a technical-diagram prompt, and the caption
reported back as alt text: "Diagram showing microservices architecture with
API gateway, independent services with databases, and message queue
communication". The output side is `article-after.md` — the same article with
`![alt](path)` references at the anchors — plus the captions payload the
plugin emits at `metadata.captions[]` (`{index, path, caption, altText,
anchor}`), which is what the skill reports to the operator.

## What this file never does

- No detection inside the plugin — the plugin never reads for meaning; it
  only inserts where told.
- No image selection after the fact — positions are decided **before** the
  confirmation preview, so the operator approves the whole spend knowingly.
- No caption writing inside the plugin — captions are the skill's voice.
