/**
 * Task 0361 — the neutral publish core is the surface a second content type builds on.
 *
 * Failure-first list (written before the extraction):
 *  1. a matrix/ITC caller still reaching the receipt, preset or send symbols through an `./itc-*` module;
 *  2. the neutral receipt schema silently dropping a matrix field (`target`/`window`/`dummy`/`guid`) or
 *     accepting an unknown key (a wire change by accident);
 *  3. `resolveConfigPath` losing the trim/`~` expansion that made it NOT interchangeable with
 *     `resolveKkConfigPath`;
 *  4. a preset slug that escapes the preset directory being accepted by the core.
 *
 * Behaviour-preservation of the move itself is proved by the existing suites (itc-publish,
 * publish-matrix, itc-config, itc-presets, fanout) running unchanged; this file covers only the new
 * module boundary.
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    DeliveryMetadataSchema,
    loadPublishPreset,
    probePlugin,
    ReceiptSchema,
    resolveConfigPath,
} from '../src/publish-core';

describe('publish core — neutral surface (0361)', () => {
    it('resolveConfigPath trims an explicit KK_CONFIG and expands a leading ~/$HOME', () => {
        // Why the ITC resolver moved instead of folding into `resolveKkConfigPath`: that one reads
        // process.env untrimmed and never expands `~`, so these four inputs would disagree.
        expect(resolveConfigPath({}, '/home/robin')).toBe(join('/home/robin', '.config/kk/config.yaml'));
        expect(resolveConfigPath({ KK_CONFIG: '   ' }, '/home/robin')).toBe(
            join('/home/robin', '.config/kk/config.yaml'),
        );
        expect(resolveConfigPath({ KK_CONFIG: ' ~/kk.yaml ' }, '/home/robin')).toBe(join('/home/robin', 'kk.yaml'));
        expect(resolveConfigPath({ KK_CONFIG: '$HOME/x.yaml' }, '/home/robin')).toBe(join('/home/robin', 'x.yaml'));
        expect(resolveConfigPath({ KK_CONFIG: '/abs/config.yaml' }, '/home/robin')).toBe('/abs/config.yaml');
    });

    it('loadPublishPreset preserves every matrix field and digests the bytes it read', async () => {
        const root = mkdtempSync(join(tmpdir(), 'publish-core-'));
        try {
            const dir = join(root, 'plugins/kk/publish-presets');
            mkdirSync(dir, { recursive: true });
            const bytes = `${JSON.stringify({
                schemaVersion: 1,
                name: 'fixture',
                targets: [
                    {
                        plugin: 'x-pub',
                        profile: 'longform',
                        id: 'x-longform',
                        operation: 'post',
                        variant: 'article',
                        tier: 1,
                        window: 'cn-peak',
                        mode: 'live',
                        required: true,
                    },
                ],
            })}\n`;
            writeFileSync(join(dir, 'fixture.json'), bytes);
            const { preset, digest } = await loadPublishPreset(
                'fixture',
                { projectRoot: root, packageRoot: root },
                createNodeFileSystem(),
            );
            expect(preset.targets[0]).toMatchObject({
                window: 'cn-peak',
                mode: 'live',
                tier: 1,
                required: true,
                id: 'x-longform',
            });
            expect(digest).toMatch(/^[0-9a-f]{64}$/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('refuses a preset slug that could escape the preset directory', async () => {
        await expect(
            loadPublishPreset('../escape', { projectRoot: '/tmp', packageRoot: '/tmp' }, createNodeFileSystem()),
        ).rejects.toThrow(/invalid publish preset slug/);
    });

    it('keeps the matrix row fields on the receipt schema and stays strict', () => {
        const row = {
            parentRunId: 'run-1',
            planDigest: 'd'.repeat(64),
            payloadDigest: 'p'.repeat(64),
            plugin: 'x-pub',
            profile: 'longform',
            mode: 'live',
            attemptId: 'attempt-1',
            status: 'succeeded',
            effect: 'confirmed',
            target: 'x-longform',
            window: 'cn-peak',
            dummy: false,
            guid: 'episode-guid',
        };
        expect(ReceiptSchema.safeParse(row).success).toBe(true);
        // A strict schema: an unknown key is a wire change, never quietly dropped.
        expect(ReceiptSchema.safeParse({ ...row, unexpected: true }).success).toBe(false);
    });

    it('accepts the delivery metadata shape a publish plugin reports', () => {
        expect(DeliveryMetadataSchema.parse({ effect: 'none' })).toEqual({ schemaVersion: 1, effect: 'none' });
        expect(DeliveryMetadataSchema.safeParse({ effect: 'maybe' }).success).toBe(false);
    });

    it('probes nothing when the plugin declares no check entry', async () => {
        // Only the two fields `probePlugin` reads: a plugin that declares no `check` entry.
        const plugin = { kind: 'publishings', name: 'no-check-pub' } as unknown as PluginRecord;
        expect(await probePlugin(plugin)).toEqual({ ok: true });
    });
});
