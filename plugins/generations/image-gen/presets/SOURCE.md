# Preset sources and validation provenance

## Open Image Prompts style-card adaptations

Source: [NanmiCoder/open-image-prompts](https://github.com/NanmiCoder/open-image-prompts),
commit `0e8da2c8d317ec517af75f5bbf3a76124cfff5b1`, under `skills/img-gen-taste/references/`.
The Skill instructions are MIT-licensed, Copyright 2026 NanmiCoder. Adaptations remove subject and
aspect-ratio slots so the existing `FormatPreset` continues to own the deliverable and canvas.

All candidates begin **generation-pending**, including cards marked `corpus-reviewed` upstream.
Corpus review establishes reference evidence, not generation quality. `source.refImages` is omitted
because upstream images are not downloaded or vendored. Reference IDs below are provenance only;
third-party source images and prompts are not relicensed or included here.

| Card | Upstream reference tweet IDs | Initial evidence status |
| --- | --- | --- |
| `limited-ink-risograph-editorial` | `2065135532875645242` | corpus-reviewed / generation-pending; one explicit source |
| `layered-papercraft-diorama` | `2059228200841232771`, `2066752996499927074` | corpus-reviewed / generation-pending |
| `minimalist-ink-wash-negative-space` | `2062404916174569621`, `2066447081980473664` | corpus-reviewed / generation-pending |
| `notion-editorial-line-art` | none supplied | authored-unverified / generation-pending; upstream reference section is empty |
| `product-exploded-identity` | `2071674030998933562`, `2039274904843960366`, `2073026525243310084` | corpus-reviewed / generation-pending |
| `handcrafted-clay-character` | `2031792275765047546`, `2042595606670004459` | corpus-reviewed / generation-pending |

Generation outcomes and final promotion status are recorded in the K3/task-0380 evaluation report.
Only accepted candidates belong in `styles/`; rejected candidates remain evaluation evidence.

**Outcome (2026-11-16): none of the six candidates is promoted.** Two independent blind reviews under
the same gate (`>= 3 of 4 cells won` and `zero critical violations`) both returned 0 accepted:
`minimax/image-01` rejected risograph, papercraft, ink-wash, Notion line art and exploded-product, with
clay blocked by Token Plan exhaustion. The complete `h3-local/h3` v2 run rejected all six after 48 renders
and 24 blind reviews: risograph 0 wins / 3 critical groups; papercraft 0/4; ink-wash 1/2;
Notion line art 0/1; exploded-product 0/3; clay 1/4. Reports: `docs/tasks/evidence/K3/0380/`.
No candidate is in `styles/`; rejected candidates remain evaluation evidence, and no quality claim is
made for a provider or revision that was not evaluated.

## Provider neutrality

Preset YAML declares only portable format/style data. Provider and model selection never belongs in
`formats/*.yaml` or `styles/*.yaml`; runners resolve them from CLI flags and the existing provider
registry. Each evaluation run uses a provider-specific work directory and records actual provider/model
provenance, so switching providers never mixes images or scores from different runs.

## MIT License notice for adapted Skill instructions

MIT License

Copyright (c) 2026 NanmiCoder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
