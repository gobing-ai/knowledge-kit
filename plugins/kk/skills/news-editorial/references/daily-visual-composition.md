# Daily visual composition — one text-free scene per episode

Shared by `kk:daily-news-cover` (the cover) and the card series. It owns *how to pick and describe*
the scene; the renderers own pixels, typography and pins. Nothing here is vendor artwork or vendor
prose: every pattern and example is written for this product, so the reference ships inside the
package and reads the same on any machine.

## The canvas the scene has to survive

| Fact | Value | Owner |
| --- | --- | --- |
| Cover canvas | 1344 × 576 (21:9) | `plugins/generations/image-gen/presets/formats/daily-news-podcast-cover.yaml` |
| Social crop | 1200 × 630 JPG | `plugins/kk/scripts/cover-compositor.ts` |
| Headline zone | lower third, ≤25 chars/row, ≤3 rows | `cover-compositor.ts` |
| Safe region | the intersection of every target crop, inset 32 px — the only area the headline may occupy | `cover-compositor.ts` (`SAFE_MARGIN`) |
| Tightest crop | the 1:1 feed crop keeps only x 384..960 of the 1344-wide frame | `cover-compositor.ts` |

The model authors a **scene**, never a layout: the format template already asks for "focal subject in
upper-center or right-third, generous dark negative space in the lower third". Your job is to choose a
focal subject that belongs in that band and to keep the middle column (`x 384..960`) meaningful,
because that column is all the 1:1 feed crop will ever show.

## Choosing a pattern

Pick the first rule that applies, and say which one you picked in one clause of the scene:

1. **Product-led** — the story names a product, device, model card, dataset, robot or facility you can
   point at. Show that object doing its thing. This is the default for release, benchmark, hardware and
   deployment news.
2. **Comparison** — the story's fact is an A/B (before/after, ours/theirs, price/performance, two
   vendors, an old limit and a new one). Only when the source states both sides; show the pair in one
   frame, never two collages.
3. **Metaphor** — the story is a policy, market, litigation or safety event with no photographable
   object. Use one concrete physical object that carries the same relation (a locked gate, a
   weighbridge, a sealed archive box, a printed contract on a desk). Concrete noun, not an abstract
   symbol.

Never mix two patterns in one scene, never illustrate the headline's wording literally, and never
invent a product, benchmark or person the sources do not name.

## The ten patterns

Each row is a layout you may describe. "Focal band" is where the subject sits on the 1344 × 576 frame;
"Crop-safe" is what must stay inside `x 384..960`.

| # | Pattern | Use when | Focal band | Crop-safe requirement |
| --- | --- | --- | --- | --- |
| 1 | Product hero, right third | A released product or device is the news | right third, mid-height | the product's silhouette reaches into the middle column |
| 2 | Product hero, upper centre | A model, chip or dataset is shown as an object | upper centre | the object's core detail sits inside the middle column |
| 3 | Cleanroom / lab bench | Manufacturing, yield, process or hardware claims | upper centre, bench line low | the bench edge and the handled object both survive |
| 4 | Screen-in-room | Software, API, agent or UI release | right third screen, room left | the screen's frame is inside the middle column |
| 5 | Two-object comparison | A sourced A/B fact (price, speed, size) | left and right thirds, equal weight | both objects enter the middle column by at least a third |
| 6 | Before/after seam | A limit lifted, a cost dropped, a migration done | vertical seam just right of centre | the seam itself is inside the middle column |
| 7 | Supply-chain chain | Chips, export controls, procurement, logistics | diagonal chain from lower-left to upper-right | the chain's middle link sits in the middle column |
| 8 | Institutional facade | Regulation, litigation, standards, enforcement | upper centre facade, steps low | the doorway and the steps both survive |
| 9 | Sealed object on a desk | Market, funding, contracts, a withheld claim | upper centre object on a low desk plane | the object and its seal stay in the middle column |
| 10 | Single concrete metaphor | Safety, alignment, opacity, a broken promise | upper centre object, generous dark space | the metaphor's single readable detail sits in the middle column |

Two patterns may not be stacked: pick one, and let the negative space in the lower third stay empty
for the composited headline.

## Eight worked examples

Every example names a **sourced focal subject** (the plan item it comes from), its **spatial placement**
and the **crop-safe region** it protects. The quoted string is what you hand the renderer: English,
≤240 characters, no text.

### E1 — product-led, released accelerator (pattern 1)

- Source: the lead plan item's `title`/`metadata.brief` naming a specific accelerator or chip.
- Focal subject: that chip on a handler, pins catching the light.
- Placement: right third, mid-height; handler arm enters from the upper right.
- Crop-safe: the chip body and its socket must reach `x 384..960`.
- Scene: `a single server accelerator card held by a robotic handler arm, copper heatsink fins catching cold light, dark datacenter racks behind, empty dark lower third`

### E2 — product-led, model release (pattern 2)

- Source: the item naming the model and what it does, not its benchmark numbers.
- Focal subject: a glowing compute module as the model's stand-in object.
- Placement: upper centre, small and dense.
- Crop-safe: the module's core stays inside the middle column at every crop.
- Scene: `a compact illuminated compute module floating above a dark plinth, thin light filaments rising from its surface, deep shadows, empty dark lower third`

### E3 — product-led, robot or embodied release (pattern 1)

- Source: the item naming the robot, the task and the venue.
- Focal subject: the robot's end effector in mid-task.
- Placement: right third, reaching left into the middle column.
- Crop-safe: the gripper and the object it holds both survive the 1:1 crop.
- Scene: `a robotic gripper closing on a small metal component at a bright assembly bench, shallow depth of field, industrial hall behind, empty dark lower third`

### E4 — comparison, two vendors (pattern 5)

- Source: a sourced A/B fact — two named vendors, two measured numbers, two prices.
- Focal subject: two identical objects, one visibly larger or brighter, no logos.
- Placement: left and right thirds, equal visual weight.
- Crop-safe: both objects enter the middle column; neither is cropped out at 1:1.
- Scene: `two identical unmarked metal server chassis side by side on a dark floor, the right one taller with brighter status lights, cold rim light, empty dark lower third`

### E5 — comparison, limit lifted (pattern 6)

- Source: the item stating the old limit and the new one.
- Focal subject: one wall of stacked panels ending mid-frame, the far half clean.
- Placement: vertical seam just right of centre.
- Crop-safe: the seam sits inside the middle column so both halves read at 1:1.
- Scene: `a wall of stacked dark glass panels, the left half frosted and the right half clear, a clean vertical seam just right of centre, empty dark lower third`

### E6 — supply chain, export controls (pattern 7)

- Source: the item naming the component, the restriction and the two countries or firms.
- Focal subject: a chain of identical sealed crates on a loading line.
- Placement: diagonal from lower-left to upper-right.
- Crop-safe: the middle crate sits inside the middle column.
- Scene: `a diagonal line of sealed cargo crates on an industrial loading dock, cold overhead light, the middle crate in sharp focus, empty dark lower third`

### E7 — institutional, regulation or litigation (pattern 8)

- Source: the item naming the regulator, court or standard, and the actor it acts on.
- Focal subject: the institution's steps and doorway, no crest, no flag, no readable sign.
- Placement: upper centre facade, steps low in frame.
- Crop-safe: doorway and steps both stay inside the middle column.
- Scene: `the stone steps and open doorway of a neoclassical institutional building at dusk, unmarked facade, cold blue light, empty dark lower third`

### E8 — metaphor, a withheld or broken claim (pattern 10)

- Source: an item whose fact is an unverifiable claim, a retraction or a sealed filing.
- Focal subject: one sealed document box on a bare desk, tape intact.
- Placement: upper centre on a low desk plane.
- Crop-safe: the box and its seal remain inside the middle column.
- Scene: `a single sealed cardboard document box taped shut on a bare metal desk, one bare bulb above, deep shadow around it, empty dark lower third`

## Refusals

A scene is rejected before any spend when it contains any of:

- lettering of any kind — words, captions, labels, UI text, code, numbers, signage;
- a logo, brand mark, crest, flag or uniform insignia;
- a recognizable real person, or a person's face as the focal subject;
- a style, colour, lighting or lens instruction (the pinned style owns those);
- two patterns at once, or a focal subject in the lower third where the headline is composited;
- a product, benchmark or actor the sources do not name;
- more than 240 characters, or a non-English scene.

## Pointers

- Composition and typography pixels: `plugins/kk/scripts/cover-compositor.ts`.
- The pinned look: `daily-news-podcast-cover` × `quasi-news-podcast` (format preset above).
- Card series: `kk:xhs-images` reuses this reference for its card artwork direction.
- Editorial ownership of `cover.headline`, `sourceIds` and the plan shape:
  `plugins/kk/skills/news-editorial/SKILL.md` (mode `write`).
