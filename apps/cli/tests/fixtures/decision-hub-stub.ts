/**
 * Test double for `@gobing-ai/ts-ai-decision` (task 0317 R8).
 *
 * The label suite loads this module through `KK_DECISION_HUB`, the in-process replacement for the
 * `KK_SPUR_BIN` stub the subprocess path used. It answers from a JSON file
 * (`KK_DECISION_HUB_ANSWERS`: `{ "<decision id>" | "*": <answer> }`), appends every asked id to
 * `KK_DECISION_HUB_SPAWNS` so a test can assert consult order and count, and records whether
 * `dispose()` ran (`KK_DECISION_HUB_DISPOSED`, a touch file) so the batch lifecycle is provable.
 *
 * An id with no answer throws — the hub's caller-mistake path, which the asker maps to "no usable
 * answer", exactly as a non-zero `spur decision run` exit did.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

interface StubAnswer {
    value: string | number;
    confidence: number | null;
    source: string;
    reason: string;
    maker?: string;
    durationMs?: number;
}

interface StubHub {
    decide(id: string, input: Record<string, unknown>): Promise<StubAnswer>;
    registry: { dispose(): Promise<void> };
}

function answers(): Record<string, StubAnswer> {
    const path = process.env.KK_DECISION_HUB_ANSWERS ?? '';
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, StubAnswer>;
}

const hub: StubHub = {
    async decide(id: string): Promise<StubAnswer> {
        const spawns = process.env.KK_DECISION_HUB_SPAWNS;
        if (spawns !== undefined && spawns !== '') appendFileSync(spawns, `${id}\n`);
        const table = answers();
        const answer = table[id] ?? table['*'];
        if (answer === undefined) throw new Error(`no stub answer for ${id}`);
        return { durationMs: answer.durationMs ?? 100, ...answer };
    },
    registry: {
        async dispose(): Promise<void> {
            const disposed = process.env.KK_DECISION_HUB_DISPOSED;
            if (disposed !== undefined && disposed !== '') writeFileSync(disposed, 'disposed\n');
        },
    },
};

export default hub;
