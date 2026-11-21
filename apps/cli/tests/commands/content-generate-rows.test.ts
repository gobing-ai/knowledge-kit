import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, chmodSync as setMode, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    type GenerateContext,
    type GenerateVerbRow,
    NEWS_STAGE_DEFAULTS,
    runGenerateRow,
    setGenerateDeps,
} from '../../src/commands/content-generate';

/**
 * The row runner, driven **directly** (`content-generate.ts` owns the assemble-and-dispatch seam).
 *
 * Why this file exists next to `content-generate-inproc.test.ts`: that suite drives the verbs through
 * `main()`, and bun's per-file coverage attributes execution to the module instance a test imports
 * directly — so the row machinery (`executeStep`'s report / bundle-stamp / pool-gate branches and the
 * `reportOptions` argv arrows) read as uncovered even while the verbs ran them. Calling `runGenerateRow`
 * from here is the same production code, reached through the import the instrument can see.
 *
 * The rows below are the shipped shapes (`content-generate.ts`'s own table): a report row, a bundle row
 * whose freeze stage stamps the content type, and a row whose stage is a plain stage call, so each
 * `executeStep` branch has one case rather than one giant integration.
 */

const fs = createNodeFileSystem();
/** The shipped defaults every verb starts from (the row runners read a subset of them). */
const RESOLVED_DEFAULTS = NEWS_STAGE_DEFAULTS;

function context(workDir: string, over: Partial<GenerateContext> = {}): GenerateContext {
    return {
        fs,
        noun: 'news',
        type: 'news',
        workflow: 'kk-news-generate',
        workDir,
        runDate: '20260101',
        runId: 'run-1',
        // The rows read only a handful of settings; the rest are the documented defaults, filled from
        // the verb's own resolver so this fixture cannot drift from the real shape.
        settings: RESOLVED_DEFAULTS,
        engine: 'voxcpm',
        step: '',
        final: false,
        bundleStage: 'variants',
        preset: 'daily-ai-voice',
        worksDir: join(workDir, '..'),
        warnings: [],
        priorErrors: false,
        maxRevisions: 2,
        ...over,
    };
}

function scratch(): string {
    return mkdtempSync(join(tmpdir(), 'kk-generate-row-'));
}

describe('runGenerateRow — the report row', () => {
    test('writes 5-report/generation.md from the daily report body and reports its path', async () => {
        const dir = scratch();
        const deps = setGenerateDeps({
            runStage: async () => 0,
            runCli: async () => 0,
            selectedCount: () => 2,
        });
        // The report row's ledger sync shells out to `spur`: a stub keeps the case offline and fast
        // (the real binary would be a live-process dependency, which no unit case should carry).
        const spurStub = join(dir, 'spur');
        writeFileSync(spurStub, '#!/bin/sh\nexit 0\n');
        setMode(spurStub, 0o755);
        const savedSpur = process.env.KK_SPUR_BIN;
        process.env.KK_SPUR_BIN = spurStub;
        try {
            mkdirSync(join(dir, '10-collect'), { recursive: true });
            writeFileSync(join(dir, '10-collect', 'pool.json'), JSON.stringify([{ id: 'a' }, { id: 'b' }]));
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            writeFileSync(
                join(dir, '21-plan', '20260101_04_quality-control-content_candidates.json'),
                JSON.stringify([{ id: 'a' }]),
            );
            const row: GenerateVerbRow = {
                verb: 'report',
                stages: [{ name: 'generation-report', args: () => [] }],
                summary: async () => ({ stage: 'generation-report' }),
            };
            const summary = await runGenerateRow(row, context(dir));
            expect(summary).toEqual({ stage: 'generation-report' });
            const page = join(dir, '5-report', 'generation.md');
            expect(readFileSync(page, 'utf-8')).toContain('2026-01-01');
        } finally {
            if (savedSpur === undefined) delete process.env.KK_SPUR_BIN;
            else process.env.KK_SPUR_BIN = savedSpur;
            deps();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});

describe('runGenerateRow — bundle rows', () => {
    const bundleRow: GenerateVerbRow = {
        verb: 'generate-bundle',
        stages: [{ name: 'bundle-content-type', args: () => [] }],
        summary: async () => ({ stage: 'bundle-content-type' }),
    };

    test('the freeze stage stamps contentType onto the shipped bundle', async () => {
        const dir = scratch();
        const deps = setGenerateDeps({ runStage: async () => 0, runCli: async () => 0 });
        try {
            mkdirSync(join(dir, '4-publish'), { recursive: true });
            writeFileSync(
                join(dir, '4-publish', 'bundle.json'),
                JSON.stringify({ runId: 'run-1', runDate: '20260101', variants: {} }),
            );
            await runGenerateRow(bundleRow, context(dir, { bundleStage: 'freeze' }));
            const frozen = JSON.parse(readFileSync(join(dir, '4-publish', 'bundle.json'), 'utf-8')) as {
                contentType?: string;
            };
            expect(frozen.contentType).toBe('news');
        } finally {
            deps();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an unreadable bundle refuses the stamp with exit 1 instead of writing garbage', async () => {
        const dir = scratch();
        const deps = setGenerateDeps({ runStage: async () => 0, runCli: async () => 0 });
        try {
            mkdirSync(join(dir, '4-publish'), { recursive: true });
            writeFileSync(join(dir, '4-publish', 'bundle.json'), '{"variants":"not-an-object"}');
            let thrown: unknown;
            try {
                await runGenerateRow(bundleRow, context(dir, { bundleStage: 'freeze' }));
            } catch (error) {
                thrown = error;
            }
            // `fail()` is the module's exit path: a typed throw, never a silent partial write.
            expect(thrown).toBeDefined();
        } finally {
            deps();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('runGenerateRow — plain stage rows and the pool gate', () => {
    test('a plain stage row forwards its argv to the stage runner', async () => {
        const dir = scratch();
        const stages: string[][] = [];
        const deps = setGenerateDeps({
            runStage: async (argv) => {
                stages.push([...argv]);
                return 0;
            },
            runCli: async () => 0,
        });
        try {
            const row: GenerateVerbRow = {
                verb: 'generate-render',
                stages: [{ name: 'daily-render', args: (ctx) => [ctx.workDir, ctx.runDate] }],
                summary: async () => ({ stage: 'daily-render' }),
            };
            await runGenerateRow(row, context(dir));
            expect(stages).toEqual([['daily-render', dir, '20260101']]);
        } finally {
            deps();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the pool gate writes PASS for a non-empty pool and EMPTY when nothing arrived', async () => {
        const deps = setGenerateDeps({ runStage: async () => 0, runCli: async () => 0 });
        const gate = async (pool: unknown, candidates: unknown): Promise<string> => {
            const dir = scratch();
            try {
                mkdirSync(join(dir, '10-collect'), { recursive: true });
                mkdirSync(join(dir, '21-plan'), { recursive: true });
                if (pool !== undefined) writeFileSync(join(dir, '10-collect', 'pool.json'), JSON.stringify(pool));
                if (candidates !== undefined)
                    writeFileSync(
                        join(dir, '21-plan', '20260101_04_quality-control-content_candidates.json'),
                        JSON.stringify(candidates),
                    );
                const row: GenerateVerbRow = {
                    verb: 'prepare',
                    stages: [{ name: 'pool-gate', args: () => [] }],
                    summary: async () => ({ stage: 'pool-gate' }),
                };
                await runGenerateRow(row, context(dir));
                return (JSON.parse(readFileSync(join(dir, 'pool-gate.json'), 'utf-8')) as { status: string }).status;
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        };
        try {
            expect(await gate([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }])).toBe('PASS');
            // A day that collected nothing is a no-content day, never a failed run.
            expect(await gate(undefined, undefined)).toBe('EMPTY');
        } finally {
            deps();
        }
    });
});
