#!/usr/bin/env bun
/**
 * Stand-in for the real `postsurfing`/`sd publish` binary.
 *
 * The publisher's contract check (ADR-008) requires the site's refine step to
 * have run, so a "successful" fake CLI must also stamp `refined: true` into the
 * post it was handed — exactly what surfdash's refine step does.
 *
 * Invoked as: <this> publish <markdown-path>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[3];
if (!file) {
    console.error('fake-postsufing: missing post path');
    process.exit(2);
}
const raw = readFileSync(file, 'utf-8');
if (!raw.includes('refined: true')) {
    const closing = raw.indexOf('\n---\n');
    const stamped = closing < 0 ? raw : `${raw.slice(0, closing)}\nrefined: true${raw.slice(closing)}`;
    writeFileSync(file, stamped);
}
console.log('Published');
process.exit(0);
