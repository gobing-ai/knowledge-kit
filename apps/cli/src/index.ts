#!/usr/bin/env bun
import { initializeLogger } from '@gobing-ai/ts-infra';
import { main } from './main';

if (import.meta.main) {
    // R4: initialize the structured-logging seam exactly once per process, before
    // dispatch. The console sink is disabled under NODE_ENV=test so test runs stay
    // clean. The CLI has zero diagnostic call sites today — the seam is ready, not
    // speculatively used (design-doc §3: no getLogger without a real diagnostic).
    await initializeLogger({ console: process.env.NODE_ENV !== 'test', json: true, level: 'warn' });
    process.exit(await main());
}
