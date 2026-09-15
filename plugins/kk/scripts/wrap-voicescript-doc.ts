#!/usr/bin/env bun
/**
 * Runtime VoiceScript→Doc[] wrapper for kk-solo-podcast.
 *
 * Resolved from the kk package (`plugins/kk/scripts/`) by `kk-workflow-stages.ts`,
 * or from an explicit runtime override ($KK_WORKFLOWS_DIR / ~/.config/kk/workflows)
 * when one exists. Node/Bun builtins only — no @gobing-ai/* and no relative imports
 * (those paths do not exist outside the package).
 *
 * SYNC: plugins/kk/scripts/kk-workflow-stages.ts (its `wrap` verb delegates here with the
 * scriptPath, outPath, voiceProfile argv the kk-solo-podcast wrap-docs state passes). The wrap
 * shape must stay a single-Doc array with sha256(file://scriptPath)[0:16] id — voice-gen and
 * tests depend on it.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [scriptPathArg, outPathArg, voiceProfileArg] = process.argv.slice(2);

if (!scriptPathArg || !outPathArg) {
    console.error('usage: wrap-voicescript-doc.ts <scriptPath> <outPath> [voiceProfile]');
    process.exit(1);
}

const scriptPath = resolve(scriptPathArg);
const outPath = resolve(outPathArg);
const voiceProfile = voiceProfileArg || process.env.VOICEBOX_DEFAULT_PROFILE || '';
const body = readFileSync(scriptPath, 'utf-8');
const sourceUri = `file://${scriptPath}`;
const id = createHash('sha256').update(sourceUri).digest('hex').slice(0, 16);
const doc = {
    id,
    title: 'Podcast VoiceScript',
    sourceUri,
    body,
    mediaType: 'application/yaml',
    metadata: voiceProfile ? { voiceProfile } : {},
};

writeFileSync(outPath, JSON.stringify([doc], null, 2));
