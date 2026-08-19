# English-platform playbook (X / Medium / Substack)

Distilled from the STORM study "How to Write and Distribute IT Technical Documents on English
Platforms" (works dir `how-to-write-it-technical-documents-for-english-a6a76477`, provenance only).
Load this reference when `--playbook english`; it shapes platform choice, format, and distribution
for the draft — never reimplements publishing.

## Choose the platform before you write

- The writer's-first-question fallacy: pick a platform *after* deciding what you actually want as
  a writer. Technical content is expensive to produce; making it for the wrong audience on the
  wrong surface wastes your scarcest resource.
- Compare platforms on three axes:
  - **Growth/discoverability** — Medium: internal distribution, but the algorithm decides reach.
    X: reach with high volatility. Substack: slow to start, compounds (Notes, recommendations,
    direct email) into an asset you keep.
  - **Audience/culture** — X is fast and combative; Medium skews essay readers; Substack readers
    opt in deliberately (roughly 85% email / 10% app on a typical post).
  - **Business model** — Medium pays per member read; X monetization is thin for most; Substack is
    free, you own your subscriber list, paid subs optional (10% cut only when someone pays).
- For IT writers the email list is the difference between building equity and renting attention.
  Cross-posting to Medium is a fine low-effort hedge — just understand its mechanics first.

## Launch and grow (Substack)

- Substack is three layers: email newsletter, publication (archive/about/navigation), and
  social/discovery (Notes, recommendations, search). Most writers only use layer one — that is why
  they struggle to grow.
- Setup order: name the publication (clear topic promise or memorable brand — not your personal
  name unless known); write an attention-grabbing bio (what you write, who it's for, credentials);
  import any existing subscriber list; publish a first post before promoting.
- Cadence: a sustainable frequency — one good post per week beats one "perfect" post per month;
  shipping gets you feedback to iterate. Open each issue with a clear thesis and keep it readable
  in an email client.
- **Growth levers combine**: from zero, Notes daily + connecting with writers gets the first
  50–100 subs; 100–500 layers in guest posts, collaborations, and recommendations (one publication
  gained ~7,000 subs through recommendations alone).
- **Notes** is the "new Twitter for writers": short valuable insights, questions, daily presence,
  genuine engagement (comments, restacks). Not random hot takes or growth-hacking. A 3-2-1 weekly
  rhythm: three value notes, two engagement posts, one soft promotion.
- **Own the channel, rent the algorithm**: the email list is the asset that survives platform
  changes; Notes/X/LinkedIn are top-of-funnel discovery — valuable, volatile, never the foundation.

## Position and voice

- **Author-first** (the newsletter builds an audience for *you*; topics range widely) vs
  **topic-first** (the publication is the draw; the niche is the promise — "production Kubernetes
  war stories"). IT content tends to capture niche intent faster topic-first; author-first builds a
  brand that travels.
- **Voice is the durable moat**: people want the person behind the publication. When automation
  repurposes content, preserve conversational voice and framework thinking — never "AI rewrites my
  stuff," which yields generic output.

## Repurposing (one long-form → many assets)

- One newsletter becomes 5 LinkedIn posts + 10 Substack Notes + 3 X threads via a webhook →
  extract → generate → deliver pipeline (Make.com + Firecrawl + OpenAI + Google Docs), cutting
  hours of manual reformatting to ~30 minutes of polish.
- **Adapt per platform, never copy-paste**: LinkedIn wants declarative hooks + strategic line
  breaks; Substack Notes wants ~200-character insights with bold + mic-drop endings; X threads
  need conversational hooks with curiosity gaps between tweets.
- Dense IT material (architecture tradeoffs, debugging walkthroughs, benchmarks) must be re-cut
  per surface. Long-form Substack/Medium carries the full technical depth and is the canonical
  source everything links back to.
- **The 10–20% human polish pass is mandatory and non-delegable** — for technical material this
  is where accuracy lives: verify every code snippet, command, flag, and version-specific claim.

## Applying this in `create`

Load this reference when `--playbook english`. It informs the draft's framing (audience, voice,
platform-native format) and the distribution plan, but the deliverable stays `topic`'s
`3-draft/draft-article.md` — this playbook never publishes and never writes a parallel artifact.
