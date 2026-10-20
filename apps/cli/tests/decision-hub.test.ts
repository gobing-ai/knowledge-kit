/**
 * Task 0317 R8 — the in-process decision hub that replaces the per-item `spur decision run`
 * subprocess in the batch labelling path.
 *
 * ## Failure-first list — written before the assertions
 *
 *  1. The hub loses the project's maker routing: `.spur/config.yaml` `decisions.makers[<id>]`
 *     stops beating `decisions.maker`, so a run silently changes maker.
 *  2. The explicit `--maker` stops winning over the config (the A/B surface would be unusable).
 *  3. The item body reaches the model unbounded, so the in-process request is not the request the
 *     subprocess path made (`spur` bounds evidence to 2000 characters).
 *  4. A hub rejection (unknown decision id, input outside the contract) surfaces as an exception
 *     instead of "no usable answer", which would fail a collect run over one bad answer.
 *  5. `dispose()` never runs, so a laya worker's pipes keep the process alive past the batch.
 *  6. The catalog resolves only from the cwd, so the installed CLI cannot find its own catalog.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createItemDecisionAsker,
    type DecisionHubLike,
    EVIDENCE_MAX_CHARS,
    readDecisionRouting,
    resolveCatalogPath,
    runDecisionSubprocess,
} from '../src/decision-hub';

const tempDirs: string[] = [];

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-decision-hub-')));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Call {
    id: string;
    input: Record<string, unknown>;
    maker?: string;
}

/** A recording hub double: answers with a fixed result and records every call it receives. */
function recordingHub(answer: Awaited<ReturnType<DecisionHubLike['decide']>> | Error): {
    hub: DecisionHubLike;
    calls: Call[];
    disposed: () => number;
} {
    const calls: Call[] = [];
    let disposed = 0;
    return {
        hub: {
            async decide(id, input, options) {
                calls.push({ id, input, ...(options?.maker === undefined ? {} : { maker: options.maker }) });
                if (answer instanceof Error) throw answer;
                return answer;
            },
            registry: {
                dispose() {
                    disposed += 1;
                },
            },
        },
        calls,
        disposed: () => disposed,
    };
}

describe('decision hub — maker routing and request parity (0317 R8)', () => {
    it('reads the project routing: per-decision overrides plus the layer default', async () => {
        const dir = tempDir();
        mkdirSync(join(dir, '.spur'), { recursive: true });
        writeFileSync(
            join(dir, '.spur/config.yaml'),
            [
                'name: fixture',
                'decisions:',
                '  paths:',
                '    - plugins/kk/decisions',
                '  maker: fm-local',
                '  makers:',
                '    kk-item-quality: typesafe',
                '    kk-item-audience: ""',
                '',
            ].join('\n'),
        );

        const routing = await readDecisionRouting(dir);
        expect(routing.routing.maker).toBe('fm-local');
        expect(routing.routing.makers).toEqual({ 'kk-item-quality': 'typesafe' });
    });

    it('a missing .spur/config.yaml leaves the catalog’s own routing in charge', async () => {
        const routing = await readDecisionRouting(tempDir());
        expect(routing.routing).toEqual({ makers: {} });
        expect(routing.catalogPath.endsWith('plugins/kk/decisions/kk-items.yaml')).toBe(true);
    });

    it('the item body is bounded exactly like the --evidence subprocess request', async () => {
        const { hub, calls } = recordingHub({
            value: 3,
            confidence: 0.9,
            source: 'model',
            reason: 'accepted',
            maker: 'fm-local',
        });
        const asker = await createItemDecisionAsker({ projectRoot: tempDir(), hub });
        await asker.ask('kk-item-importance', { title: 'T', source: 'rss', body: 'x'.repeat(5000) });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.input.instructions).toBe('x'.repeat(EVIDENCE_MAX_CHARS));
        expect(calls[0]?.input.title).toBe('T');
        expect(calls[0]?.input.source).toBe('rss');
    });

    it('--maker beats the config, the config beats nothing, and dispose reaches the registry', async () => {
        const dir = tempDir();
        mkdirSync(join(dir, '.spur'), { recursive: true });
        writeFileSync(
            join(dir, '.spur/config.yaml'),
            ['decisions:', '  maker: fm-local', '  makers:', '    kk-item-quality: typesafe', ''].join('\n'),
        );
        const { hub, calls, disposed } = recordingHub({
            value: 4,
            confidence: 0.8,
            source: 'model',
            reason: 'accepted',
            maker: 'typesafe',
        });
        const asker = await createItemDecisionAsker({ projectRoot: dir, hub });
        await asker.ask('kk-item-quality', { title: 'T', source: 'rss', body: 'body' });
        await asker.ask('kk-item-importance', { title: 'T', source: 'rss', body: 'body' });
        await asker.ask('kk-item-quality', { title: 'T', source: 'rss', body: 'body' }, 'clef');

        expect(calls.map((call) => call.maker)).toEqual(['typesafe', 'fm-local', 'clef']);
        expect(disposed()).toBe(0);
        await asker.dispose();
        expect(disposed()).toBe(1);
    });

    it('a rejected ask is "no usable answer", never a thrown batch', async () => {
        const { hub } = recordingHub(new Error('unknown decision'));
        const asker = await createItemDecisionAsker({ projectRoot: tempDir(), hub });
        expect(await asker.ask('kk-item-audience', { title: 'T', source: 'rss', body: '' })).toBeUndefined();
        await asker.dispose();
    });

    it('a backend that cannot serve a decision in process falls back to the one-off transport and latches', async () => {
        const degraded = {
            value: 2,
            confidence: null,
            source: 'default',
            reason: 'error',
            maker: 'typesafe',
        };
        const { hub, calls } = recordingHub(degraded);
        const served: string[] = [];
        const asker = await createItemDecisionAsker({
            projectRoot: tempDir(),
            hub,
            fallback: (decisionId) => {
                served.push(decisionId);
                return { value: 4, confidence: 0.9, source: 'model', reason: 'accepted', maker: 'typesafe' };
            },
        });
        const ask = () => asker.ask('kk-item-quality', { title: 'T', source: 'rss', body: 'body' });
        // Each ask that the hub cannot serve still gets a real answer from the one-off transport —
        // correctness first, then the latch.
        expect((await ask())?.value).toBe(4);
        expect((await ask())?.value).toBe(4);
        expect(calls).toHaveLength(2);
        expect(served).toHaveLength(2);
        // From the third ask on the hub is skipped entirely: a dead backend costs two probes, not
        // one probe (plus a spawn) per item.
        expect((await ask())?.value).toBe(4);
        expect((await ask())?.value).toBe(4);
        expect(calls).toHaveLength(2);
        expect(served).toHaveLength(4);
        await asker.dispose();
    });

    it('a healthy hub answer never touches the one-off transport', async () => {
        const { hub } = recordingHub({
            value: 3,
            confidence: 0.9,
            source: 'model',
            reason: 'accepted',
            maker: 'fm-local',
        });
        let spawned = 0;
        const asker = await createItemDecisionAsker({
            projectRoot: tempDir(),
            hub,
            fallback: () => {
                spawned += 1;
                return undefined;
            },
        });
        await asker.ask('kk-item-importance', { title: 'T', source: 'rss', body: 'body' });
        expect(spawned).toBe(0);
        await asker.dispose();
    });

    it('an injected hub module without a default export is a loud config error', async () => {
        const dir = tempDir();
        const modulePath = join(dir, 'broken-hub.ts');
        writeFileSync(modulePath, 'export const notDefault = 1;\n');
        const previous = process.env.KK_DECISION_HUB;
        process.env.KK_DECISION_HUB = modulePath;
        try {
            await expect(createItemDecisionAsker({ projectRoot: dir })).rejects.toThrow('has no default export');
        } finally {
            if (previous === undefined) delete process.env.KK_DECISION_HUB;
            else process.env.KK_DECISION_HUB = previous;
        }
    });

    it('the one-off transport reads spur’s JSON and treats every failure as no answer', () => {
        const dir = tempDir();
        const stub = join(dir, 'spur');
        writeFileSync(
            stub,
            [
                '#!/bin/sh',
                'case "$3" in',
                '  kk-item-good) printf \'%s\\n\' \'{"value":4,"confidence":0.9,"source":"model","reason":"accepted","maker":"fm-local"}\'; exit 0;;',
                '  kk-item-slow) exit 1;;',
                '  *) echo "not json"; exit 0;;',
                'esac',
                '',
            ].join('\n'),
        );
        chmodSync(stub, 0o755);
        const previous = process.env.KK_SPUR_BIN;
        process.env.KK_SPUR_BIN = stub;
        try {
            const answer = runDecisionSubprocess('kk-item-good', { title: 'T', source: 'rss', body: 'b' }, 'fm-local');
            expect(answer?.value).toBe(4);
            expect(
                runDecisionSubprocess('kk-item-slow', { title: 'T', source: 'rss', body: 'b' }, undefined),
            ).toBeUndefined();
            expect(
                runDecisionSubprocess('kk-item-junk', { title: 'T', source: 'rss', body: 'b' }, undefined),
            ).toBeUndefined();
        } finally {
            if (previous === undefined) delete process.env.KK_SPUR_BIN;
            else process.env.KK_SPUR_BIN = previous;
        }
    });

    it('the catalog resolves from this module’s own install when the cwd has none', async () => {
        const resolved = await resolveCatalogPath(tempDir());
        expect(resolved.endsWith('plugins/kk/decisions/kk-items.yaml')).toBe(true);
    });
});
