# Generic IT-writing craft — five disciplines

Distilled from the STORM study "How to Write the Best Generic IT Technical Documentation"
(works dir `how-to-write-the-best-generic-it-technical-docum-0a71c5a7`, provenance only — this
reference replaces vendoring the full report). Load this reference on every `create` run; apply
all five disciplines while authoring the draft.

## 1. Structure and scope (the document architect)

- Pick the document types you actually need — and **stop**. There is no universal list; add a
  document only when no existing one's goal absorbs the content.
- **One document, one goal**, enforced at review: reread after writing and remove or move
  anything that does not serve that goal. Write everything first, then cut.
- **Write the Value Proposition (VP) first**: a one-page list of what the doc will do for its
  reader (save time, reduce errors, cut training…). It says nothing about format or fonts. Use it
  as a scope-creep firewall — keep content that supports a VP item, remove the rest.
- **Plan before writing**: research first (history → latest literature → what existing docs
  already cover), then a documentation plan (scope, objectives, estimates, workflows, resources).
  Do not over-invest in placement up front — move a document after it exists.
- **One goal per section** too: link out to other documents for prerequisites and detail instead
  of inlining everything.

## 2. Write for the reader (the reader advocate)

- **Profile the readership** enough to structure and customize for them. Do not assume background,
  environment, context, or that they have read your other docs — link prerequisites instead of
  inlining them.
- **Show, don't tell**: lead with diagrams (process flows, C4 views), then explain in prose.
  Text-based diagrams (Mermaid, PlantUML) stay easy to update. Use at least one concrete example
  early — a simple example beats an abstract description.
- **Principle of Least Astonishment (POLA)**: cover the gotchas and non-typical usage up front —
  undocumented prerequisites, surprising defaults, implicit ordering. Name assumptions, defaults,
  and prerequisites explicitly.
- **Long-form craft**: a succinct, jargon-free title; structure against the five Ws + H; write the
  introduction last, once the content has settled.
- **Accessibility and inclusive writing** are concrete requirements: follow accessibility
  guidelines for structure/language; use inclusive example names and bias-free language.

## 3. Make it a team discipline (the engineering manager)

- **Budget for docs time**: measure how long SME review of writer output takes and factor it into
  each release. Good docs are written once, read hundreds of times.
- **Close the specialized-skill gap**: technical writing is its own discipline (audience
  understanding + logical presentation); bring in a technical writer or build review processes
  that treat writing with the same rigor as code.
- **Embed docs in the engineering workflow**: docs reviews inside normal PR review, preview builds
  on each check-in, docs as part of shipping every release — not a post-release afterthought.
- **Docs are coordination infrastructure** at team scale: they improve knowledge retention and
  underpin quality, consistency, and compliance.
- **Build documentation mindshare**: state the problem, start in engineering, gather input
  broadly, build a taxonomy, make contribution easy, meet regularly.

## 4. Keep it fresh (the maintenance owner)

- **Docs go stale by default**; the countermeasure is procedural — assess doc impact of changes
  each sprint and allocate update time in the release.
- **Make updates cheap**: prefer simple human-readable formats (Markdown — diffable in Git) and
  text-based diagrams so edits stay cheap.
- **Institutionalize the lifecycle**: plan → write → review → publish, with research up front and
  maintenance at the end; take occasional content inventories and use reader feedback to fill gaps.

## 5. Tooling and publishing (the pipeline engineer)

- **Match tools to doc types and languages**; when in doubt, defer to Markdown and tooling with
  simple human-readable formats. A convenient editor matters — you won't write docs you hate
  editing.
- **Bake publishing into CI/CD**: build docs from sources and publish on every release; generate
  docs from code artifacts where possible (OpenAPI is the canonical example).
- **Plan reuse**: write content once and reuse it (CCMS for cross-product scale); audit for
  overlap before duplication spreads.
- **Adopt (or author) style guides**: shared style guides keep output consistent — don't write
  them from scratch (Write the Docs maintains a living one). During review, get the right experts
  on the right documents and use preview runs to catch errors before publication.

## Applying this in `create`

While drafting `3-draft/draft-article.md` (after `topic`'s outline gate), apply: one goal per
document enforced at the draft-review gate; the Value Proposition as a scope firewall; explicit
prerequisites and POLA; show-don't-tell with diagrams/examples; and accessibility. The `--judge`
gate then verifies technical accuracy against the rubric.
