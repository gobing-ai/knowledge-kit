# Brainstorm: microfeed podcast platform + `podcast-pub` publish plugin

Date: 2026-09-02 · Pipeline run: F0CD8BBF-C71A-432F-9D9F-67AE7E2D0EA4

## Overview

The operator wants a self-hosted podcast platform: (1) deploy microfeed to
Cloudflare Workers via `npx @microfeed/cli manage` (wrangler already
authenticated; custom domain bound manually later), (2) a new `podcast-pub`
publish plugin under `plugins/publishings/` that publishes podcast episodes to
that microfeed instance, configured via `plugins.publishings.podcast-pub` in
`~/.config/kk/config.yaml`, plus simple management operations, and (3) —
explicitly **out of scope** — a future chained AI/tech-news podcast workflow.

microfeed is vendored at `vendors/microfeed` as the API reference. Its REST
API (`/api/v1/*`, Bearer `mf_…` named keys, disabled by default until enabled
in the dashboard) covers items CRUD and media upload preparation (same-origin
R2 upload flow). The existing publish-plugin suite (qiita-pub, zenn-pub,
surfdash-pub, emdash-pub) establishes the `file-cli` transport precedent:
`Content → Result` with env-only secrets.

## Approaches

### A. Direct REST API transport (`file-cli`, fetch + Bearer key)

The plugin calls microfeed `/api/v1/` directly: prepare media upload → upload
audio → create/validate the feed item with the audio attachment. Config =
`MICROFEED_BASE_URL` + `MICROFEED_API_KEY` env entries under
`plugins.publishings.podcast-pub`. Management ops (list/get/update/delete
items) are thin REST calls in the same plugin.

- **Pros:** exact qiita-pub precedent; env-only secrets channel already exists;
  fully non-interactive → pipeline-safe; microfeed's own docs position REST as
  the integration path for "another application or service."
- **Cons:** requires one-time manual dashboard steps (enable API, create key);
  per-instance OpenAPI is the version contract → drift risk pinned to the
  deployed microfeed version.
- **Confidence:** HIGH. Sources: `vendors/microfeed/docs/api/index.md`,
  `docs/api/authentication.md`, `docs/design/publish-plugin-specification.md`
  (2026-09-02, repo-local).

### B. Wrap `@microfeed/cli` as a child-process transport

The plugin shells out to the official CLI, which holds opaque browser-granted
auth and is the path microfeed recommends "if you want a coding agent to
publish content."

- **Pros:** no API key management; CLI handles upload choreography.
- **Cons:** browser-granted auth state is interactive and machine-local —
  fights the env-only secrets contract; heavyweight dep for a pipeline step;
  CLI output isn't a stable machine contract vs the OpenAPI schema.
- **Confidence:** MEDIUM. Source: `vendors/microfeed/docs/api/index.md`.

### C. Hybrid: REST publish, CLI/dashboard for management

Publish path via REST (A); defer all management ops to the operator dashboard
or `@microfeed/cli`, shipping zero management code now.

- **Pros:** smallest plugin; zero management-surface drift.
- **Cons:** violates the stated requirement ("other simple management tasks");
  gaps discovered the first time a pipeline needs to check/update an episode.
- **Confidence:** MEDIUM.

## Recommendation

**Approach A**, with management ops scoped to thin REST read/update/list
calls in the same plugin. B's auth model is incompatible with a
non-interactive pipeline step; C drops a stated requirement for a saving of a
few functions.

The microfeed **deployment** (idea part 1) is an operator-executed task, not
code: `@microfeed/cli manage` is interactive by design. The task batch carries
it as a setup+verification task (instance URL reachable, JSON Feed 200, API
enabled, key created and pasted into config), gating the plugin's live
verification but not its offline-tested development (FakeFileCliTransport
precedent).

## Design Summary

New publish plugin `plugins/publishings/podcast-pub/` (kind `publish`,
`file-cli` transport, per `publish-plugin-specification.md`): manifest +
`src/index.ts` implementing `PublishTransport` against microfeed `/api/v1/`
with Bearer auth; media upload via the API's prepare-upload flow; episode item
created with audio attachment metadata mapped from `Content` (+ `metadata`
fields: audio URL/duration/etc. — exact mapping pinned at decompose/design
time against the vendored OpenAPI doc). Secrets via
`plugins.publishings.podcast-pub.env` (`MICROFEED_BASE_URL`,
`MICROFEED_API_KEY`) in `~/.config/kk/config.yaml` — the domain lives in
`MICROFEED_BASE_URL`, so the later manual domain bind is a one-line config
edit, not a code change. Offline tests via `FakeFileCliTransport`; live
verification is a gated manual step after deployment. Deployment task records
the instance URL and API-enablement as its AC evidence. Out of scope: the
chained news→podcast workflow (future feature under F/E as appropriate).

Spec self-review: no placeholders; no contradictions; scope boundaries stated;
decompose inputs (spec doc, qiita-pub precedent, vendored API docs) all exist.

## needs_design

`true` — new plugin package, new external API boundary (microfeed REST +
Cloudflare), config-schema addition. See `.spur/run/F0CD8BBF-C71A-432F-9D9F-67AE7E2D0EA4-idea-needs-design.json`.
