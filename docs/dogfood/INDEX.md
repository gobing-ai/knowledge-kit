# Dogfood evidence

Completed reports are generated locally; this tracked index preserves their feature attribution.

| Feature | Task | Result | Report | Evidence |
| --- | --- | --- | --- | --- |
| F8 | 0178 | PASS | [2026-09-28 stage resolution](2026-09-28-F8-stage-resolution-dogfood.md) | Source and compiled CLI run from unrelated cwd, select the live runner and load the matching default style sidecar; documentation and unchanged legacy direct calls checked. Report validator PASS; no unresolved issues. |
| G14 | 0258 | PASS | [2026-10-13 VoxCPM voice driver](2026-10-13-G14-voxcpm-voice-driver-dogfood.md) | Worker protocol P0 (no success-path response) found and fixed in-run; both VoxCPM daily stage shapes rendered the frozen 41-segment episode (16.2 / 15.9 min, QC 100, 48 kHz) with per-artifact provenance; 1 unresolved external block (Gemini quota) and 1 reported risk (Voicebox fallback clears the duration gate with failing QC). |
