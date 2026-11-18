import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runner = join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');
const stamp = '20261102';

function runStage(args: string[], env: Record<string, string>) {
    return spawnSync('bun', [runner, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, ...env },
    });
}

function fakeKk(dir: string): Record<string, string> {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const path = join(bin, 'kk');
    writeFileSync(
        path,
        [
            '#!/usr/bin/env bun',
            "const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');",
            'const args = process.argv.slice(2);',
            'const input = args[args.indexOf("--in") + 1];',
            'const output = args[args.indexOf("--out") + 1];',
            'appendFileSync(process.env.CALLS ?? "/tmp/kk-daily-cache-calls.log", JSON.stringify({ args, input, output }) + "\\n");',
            'const sourcePath = args.find((value) => value.endsWith("/pool.json")) ?? input;',
            'const source = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, "utf8")) : { metadata: { docs: [] } };',
            'const docs = Array.isArray(source) ? source : (source.metadata?.docs ?? []);',
            'writeFileSync(output, JSON.stringify({ body: "", title: "fixture", format: "markdown", metadata: { docs } }));',
        ].join('\n'),
    );
    chmodSync(path, 0o755);
    return { PATH: `${bin}:${process.env.PATH ?? ''}`, CALLS: join(dir, 'calls.log') };
}

function writePool(dir: string, docs: Record<string, unknown>[]): void {
    mkdirSync(join(dir, '10-collect'), { recursive: true });
    mkdirSync(join(dir, '21-plan'), { recursive: true });
    writeFileSync(join(dir, '10-collect', 'pool.json'), JSON.stringify(docs));
}

describe('daily planning cache recovery', () => {
    it('recomputes plan and QC after source or floor inputs change, while unchanged reruns stay cached', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-daily-cache-'));
        try {
            const env = fakeKk(dir);
            const callsPath =
                env.CALLS ??
                (() => {
                    throw new Error('fixture CALLS path missing');
                })();
            const planPath = join(dir, '21-plan', `${stamp}_03_plan_content.json`);
            const firstDocs = [{ id: 'first', title: 'First item', body: 'x'.repeat(1000) }];
            writePool(dir, firstDocs);

            const firstPlan = runStage(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(firstPlan.status, `${firstPlan.stderr}\n${firstPlan.stdout}`).toBe(0);
            expect(JSON.parse(readFileSync(planPath, 'utf8')).metadata.docs).toEqual(firstDocs);

            const cachedPlan = runStage(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(cachedPlan.status, cachedPlan.stderr).toBe(0);
            expect(cachedPlan.stdout).toContain('plan cached:');

            const secondDocs = [{ id: 'second', title: 'Second item', body: 'y'.repeat(1000) }];
            writePool(dir, secondDocs);
            const refreshedPlan = runStage(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(refreshedPlan.status, refreshedPlan.stderr).toBe(0);
            expect(refreshedPlan.stdout).not.toContain('plan cached:');
            expect(JSON.parse(readFileSync(planPath, 'utf8')).metadata.docs).toEqual(secondDocs);

            const qcArgs = ['daily-qc-content', dir, stamp, '', 'ai-news', '1', '1', '1', '1', '1', '15', 'gemini'];
            const refused = runStage(qcArgs, env);
            expect(refused.status, refused.stderr).toBe(0);
            const candidatesPath = join(dir, '21-plan', `${stamp}_04_quality-control-content_candidates.json`);
            const refusalPath = join(dir, '21-plan', `${stamp}_04_quality-control-content_floor-refusal.json`);
            expect(JSON.parse(readFileSync(candidatesPath, 'utf8')).metadata.docs).toEqual([]);
            expect(existsSync(refusalPath)).toBe(true);

            const recovered = runStage(
                ['daily-qc-content', dir, stamp, '', 'ai-news', '1', '1', '1', '1', '1', '1', 'gemini'],
                env,
            );
            expect(recovered.status, recovered.stderr).toBe(0);
            expect(recovered.stdout).not.toContain('candidates cached:');
            expect(JSON.parse(readFileSync(candidatesPath, 'utf8')).metadata.docs).toEqual(secondDocs);
            expect(existsSync(refusalPath)).toBe(false);

            const calls = readFileSync(callsPath, 'utf8')
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            expect(calls).toHaveLength(4);

            const summaryDir = join(process.cwd(), '.works/tmp/test-daily-recovery/cache');
            mkdirSync(summaryDir, { recursive: true });
            writeFileSync(
                join(summaryDir, 'summary.json'),
                JSON.stringify(
                    {
                        version: 1,
                        stamp,
                        assertions: {
                            unchangedPlanCached: true,
                            changedPoolRecomputed: true,
                            floorRefusalRecovered: true,
                            staleRefusalCleared: true,
                        },
                        pluginCalls: calls.length,
                    },
                    null,
                    2,
                ),
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
        // Five stage subprocesses plus the QC attempt ledger (0392) land ~5.3s — over bun's 5s
        // default, which is a budget artefact, not a slow path worth optimising.
    }, 20000);

    it('does not trust a malformed cache sidecar', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-daily-cache-invalid-'));
        try {
            const env = fakeKk(dir);
            const callsPath =
                env.CALLS ??
                (() => {
                    throw new Error('fixture CALLS path missing');
                })();
            const docs = [{ id: 'safe', title: 'Safe item', body: 'x'.repeat(1000) }];
            writePool(dir, docs);
            const contentPath = join(dir, '21-plan', `${stamp}_03_plan_content.json`);
            const cachePath = `${contentPath}.cache.json`;
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            writeFileSync(contentPath, JSON.stringify({ metadata: { docs: [{ id: 'stale' }] } }));
            writeFileSync(cachePath, '{invalid');

            const refreshed = runStage(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(refreshed.status, refreshed.stderr).toBe(0);
            expect(JSON.parse(readFileSync(contentPath, 'utf8')).metadata.docs).toEqual(docs);
            expect(readFileSync(callsPath, 'utf8').trim().split('\n')).toHaveLength(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails closed before recomputing QC when its fingerprint changes after authored descendants exist', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-daily-cache-authored-'));
        try {
            const env = fakeKk(dir);
            const callsPath =
                env.CALLS ??
                (() => {
                    throw new Error('fixture CALLS path missing');
                })();
            const docs = [{ id: 'authored-source', title: 'Authored source', body: 'x'.repeat(1000) }];
            writePool(dir, docs);

            const plan = runStage(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(plan.status, `${plan.stderr}\n${plan.stdout}`).toBe(0);
            const qcArgs = ['daily-qc-content', dir, stamp, '', 'ai-news', '1', '1', '1', '1', '1', '1', 'gemini'];
            const firstQc = runStage(qcArgs, env);
            expect(firstQc.status, `${firstQc.stderr}\n${firstQc.stdout}`).toBe(0);
            const candidatesPath = join(dir, '21-plan', `${stamp}_04_quality-control-content_candidates.json`);
            const before = readFileSync(candidatesPath, 'utf8');

            mkdirSync(join(dir, '22-article'), { recursive: true });
            writeFileSync(join(dir, '22-article', `${stamp}_07_article.md`), 'authored article');

            const changedQc = runStage(
                ['daily-qc-content', dir, stamp, '', 'ai-news', '2', '1', '1', '1', '1', '1', 'gemini'],
                env,
            );

            expect(changedQc.status).not.toBe(0);
            expect(`${changedQc.stderr}\n${changedQc.stdout}`).toContain(
                'QC cache changed after downstream artifacts were authored',
            );
            expect(readFileSync(candidatesPath, 'utf8')).toBe(before);
            expect(readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean)).toHaveLength(2);

            const unchangedQc = runStage(qcArgs, env);
            expect(unchangedQc.status, unchangedQc.stderr).toBe(0);
            expect(unchangedQc.stdout).toContain('candidates cached:');
            expect(readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean)).toHaveLength(2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
        // Four stage subprocesses plus the QC attempt ledger (0392) land at ~5.0s, i.e. on bun's 5s
        // default — a budget artefact of the ledger write, not a slow path worth optimising.
    }, 20000);
});
