/**
 * Test preload: point the ts-utils `echo` / `echoError` defaults at a noop sink.
 *
 * Every test that judges output owns its target (`captureOutput`, `captureMain`, `captureSpawn`) and
 * still works — those helpers replace the defaults. Everything else (plugin diagnostics, stage
 * progress, CLI usage lines) would otherwise write straight into the dots reporter, interleaving
 * with the run and burying real failures. Registered in `bunfig.toml` under `[test] preload`.
 */

import { setDefaultOutputTargets, type WriteTarget } from '@gobing-ai/ts-utils';

const noop: WriteTarget = { write: () => true };

setDefaultOutputTargets({ stdout: noop, stderr: noop });
