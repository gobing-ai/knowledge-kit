---
schema_version: 1
name: "Implement the image-gen adapter hop: byte-writer, seedream adapter, illustration insertion"
status: backlog
template: feature-impl
created_at: 2026-09-10T05:43:47.363Z
updated_at: "2026-09-10T05:44:16.830Z"
feature_id: K

dependencies: ["0103", "0104"]
---

## 0107. Implement the image-gen adapter hop: byte-writer, seedream adapter, illustration insertion

### Background

Owns the registered adapter-hop deferral from 0104 (Design: "Deferred to the adapter hop (single seam, by design)"). 0104 stopped its branches exactly where provider bytes would be written — `plugins/generations/image-gen/src/index.ts:197-202` throws not-implemented at the money boundary. This task implements that seam: the binary byte-writer (needs a `no-direct-fs-io` seam exemption — the FileSystem seam is text-only; voice-gen and podcast-pub each carry an explicit exemption as precedent), the 0103+ wire-speaking provider adapters (seedream first), illustration insertion + captions (0104 R4), and the artefact-tracking cleanup (`written[]`). Also closes 0104's P4 advisories riding this hop: outputStem traversal guard, parseInt leniency, dead cleanup loop. Blocked on an ARK credential for live provider runs; dry-run legs are executable without one.

### Requirements

- R1: Byte-writer lands image bytes beside `--out` via `artifactPath` (0104 R3), never in the plugin directory, with the `no-direct-fs-io` seam exemption recorded.
- R2: Seedream adapter speaks the provider wire through the 0103 `ImageProvider` interface; generation writes deterministic zero-padded artefact names.
- R3: Illustration job inserts round-trip refs + captions into `Content.body` without mutating the input (0104 R4).
- R4: `written[]` artefact tracking cleans up partial output on failure.
- R5: 0104 P4 advisories closed: outputStem traversal guard, parseInt leniency, dead cleanup loop.

### Acceptance Criteria

- Artefacts land beside `--out`, never in the plugin directory (positive file claim, non-dry run) — discharges 0104 AC.
- Artefact names are deterministic and zero-padded across two runs — discharges 0104 AC.
- The illustration round trip preserves the original (sha256 unchanged) and body gains refs + captions — discharges 0104 AC.
- `KK_IMAGE_MAX_IMAGES` override leg with 9 images completes end-to-end — discharges 0104 AC.
- A failed mid-batch run leaves at most one partial file, cleaned up.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
