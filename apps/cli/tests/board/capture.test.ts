/**
 * G8/0252 — the `captureRun` seam and `kk board capture` verb.
 *
 * Failure-first list (written before the code):
 * 1. an unknown workflow / unsafe run id / unsafe stamp / malformed digest is refused;
 * 2. an unknown `--setting` key is dropped (never captured, never a diagnostic payload);
 * 3. an out-of-allowlist value for a known key is refused;
 * 4. a successful capture writes the immutable record AND the ownership marker atomically;
 * 5. a conflicting identity for an existing run id is refused, never silently rewritten;
 * 6. a new run revokes the previous owner's marker before writing (AC7);
 * 7. a refused revocation throws and writes no record (result mutation must be refused);
 * 8. the workflow runs capture only inside the successful lock-holder path.
 *
 * Real temporary directories only — no mocks of the behavior under test.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    captureRun,
    parseSetting,
    readCaptureRecord,
    readOwnerMarker,
    topologyFromYaml,
} from '../../src/board/capture';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

/** A throwaway project root with one run workspace. */
function project(): { root: string; workDir: string } {
    const root = tempDir('kk-board-capture-');
    const workDir = join(root, '.works', 'kk-collect', '20261011T1200Z');
    mkdirSync(workDir, { recursive: true });
    return { root, workDir };
}

const baseInput = (workDir: string) => ({
    workflow: 'kk-collect' as const,
    runId: 'run-1',
    workDir,
    stamp: '20261011T1200Z',
    settings: { limit: '10' },
});

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
});

describe('capture validation', () => {
    it('refuses an unknown workflow, run id, stamp and digest', async () => {
        const { root, workDir } = project();
        const deps = { projectPath: root };
        await expect(captureRun({ ...baseInput(workDir), workflow: 'nope' as 'kk-collect' }, deps)).rejects.toThrow(
            /unknown workflow/,
        );
        await expect(captureRun({ ...baseInput(workDir), runId: '../escape' }, deps)).rejects.toThrow(
            /safe path segment/,
        );
        await expect(captureRun({ ...baseInput(workDir), stamp: '2026 1011' }, deps)).rejects.toThrow(/--stamp/);
        await expect(captureRun({ ...baseInput(workDir), definitionDigest: 'sha256:zz' }, deps)).rejects.toThrow(
            /--definition-digest/,
        );
    });

    it('drops unknown settings and refuses an out-of-allowlist value', () => {
        expect(parseSetting('kk-collect', 'topic=whatever')).toBeNull();
        expect(parseSetting('kk-collect', 'limit=10')).toEqual({ key: 'limit', value: '10' });
        expect(() => parseSetting('kk-collect', 'limit=-1')).toThrow(/nonnegative integer/);
        expect(() => parseSetting('kk-collect', 'horizon_hours=soon')).toThrow(/nonnegative integer/);
    });
});

describe('capture writes', () => {
    it('writes the immutable record and the ownership marker', async () => {
        const { root, workDir } = project();
        const outcome = await captureRun(baseInput(workDir), {
            projectPath: root,
            now: () => new Date('2026-10-11T12:00:00Z'),
        });
        expect(outcome).toMatchObject({ revoked: false, captured: true });
        const record = await readCaptureRecord(createNodeFileSystem(), root, 'run-1');
        expect(record).toMatchObject({
            schemaVersion: 1,
            projectPath: root,
            workflow: 'kk-collect',
            runId: 'run-1',
            stamp: '20261011T1200Z',
            capturedAt: '2026-10-11T12:00:00.000Z',
            settings: { limit: '10' },
        });
        const marker = await readOwnerMarker(createNodeFileSystem(), workDir);
        expect(marker).toMatchObject({ runId: 'run-1', projectPath: root, workflow: 'kk-collect' });
        // No temp files left behind by the atomic write.
        expect(readdirSync(join(root, '.works/.board/runs'))).toEqual(['run-1.json']);
    });

    it('is idempotent for an identical re-capture', async () => {
        const { root, workDir } = project();
        await captureRun(baseInput(workDir), { projectPath: root });
        const again = await captureRun(baseInput(workDir), { projectPath: root });
        expect(again).toMatchObject({ revoked: false, captured: true });
    });

    it('refuses a conflicting identity for an existing run id', async () => {
        const { root, workDir } = project();
        await captureRun(baseInput(workDir), { projectPath: root });
        // A different workspace under the same project's works root: still a conflicting identity.
        const sibling = join(root, '.works', 'kk-collect', 'S2');
        mkdirSync(sibling, { recursive: true });
        await expect(captureRun({ ...baseInput(workDir), workDir: sibling }, { projectPath: root })).rejects.toThrow(
            /different workflow or workspace/,
        );
    });
});

describe('ownership', () => {
    it('revokes the previous owner marker before writing the new one (AC7)', async () => {
        const { root, workDir } = project();
        await captureRun({ ...baseInput(workDir), runId: 'run-old' }, { projectPath: root });
        const outcome = await captureRun({ ...baseInput(workDir), runId: 'run-new' }, { projectPath: root });
        expect(outcome.revoked).toBe(true);
        const marker = await readOwnerMarker(createNodeFileSystem(), workDir);
        expect(marker?.runId).toBe('run-new');
        // The earlier run's immutable record survives: only ownership changed.
        expect(await readCaptureRecord(createNodeFileSystem(), root, 'run-old')).not.toBeNull();
    });

    it('refuses capture (and writes no record) when revocation fails', async () => {
        const { root, workDir } = project();
        await captureRun({ ...baseInput(workDir), runId: 'run-old' }, { projectPath: root });
        chmodSync(workDir, 0o500);
        try {
            await expect(
                captureRun({ ...baseInput(workDir), runId: 'run-new' }, { projectPath: root }),
            ).rejects.toThrow();
        } finally {
            chmodSync(workDir, 0o755);
        }
        expect(await readCaptureRecord(createNodeFileSystem(), root, 'run-new')).toBeNull();
        expect(readFileSync(join(workDir, '.kk-board-owner.json'), 'utf-8')).toContain('run-old');
    });
});

describe('collect workflow integration', () => {
    it('declares the digest var and captures only in the successful lock-holder path', () => {
        const yaml = readFileSync(join(import.meta.dir, '../../../../plugins/kk/workflows/kk-collect.yaml'), 'utf-8');
        expect(yaml).toContain('__definitionDigest: ""');
        const lockState = yaml.slice(yaml.indexOf('- id: lock'), yaml.indexOf('- id: collect'));
        expect(lockState).not.toContain('kk board capture');
        const collectState = yaml.slice(yaml.indexOf('- id: collect'), yaml.indexOf('- id: store'));
        expect(collectState).toContain('kk board capture');
        // The store guard requires the capture artifact, so a refused revocation blocks result writes.
        const collectToStore = yaml.slice(yaml.indexOf('from: collect'), yaml.indexOf('to: release-failed'));
        expect(collectToStore).toContain('board-capture.json');
    });

    it('writes the capture artifact before the fan-in action', () => {
        const yaml = readFileSync(join(import.meta.dir, '../../../../plugins/kk/workflows/kk-collect.yaml'), 'utf-8');
        const collectState = yaml.slice(yaml.indexOf('- id: collect'), yaml.indexOf('- id: store'));
        expect(collectState.indexOf('kk board capture')).toBeLessThan(collectState.indexOf('kk executor fan-in'));
    });

    it('exposes an empty string when a --setting pair has no separator', () => {
        expect(() => parseSetting('kk-collect', 'limit')).toThrow();
    });

    it('extracts reviewed topology from a state machine and a DAG, and nothing from junk', () => {
        expect(topologyFromYaml('states:\n  - id: a\n  - id: b\ntransitions:\n  - from: a\n    to: b\n')).toEqual({
            nodes: ['a', 'b'],
            edges: [{ from: 'a', to: 'b' }],
        });
        expect(topologyFromYaml('nodes:\n  - id: a\n  - id: b\n    dependsOn: [a]\n')).toEqual({
            nodes: ['a', 'b'],
            edges: [{ from: 'a', to: 'b' }],
        });
        expect(topologyFromYaml('name: empty\n')).toBeNull();
    });

    it('captures a definition digest only when it is a real sha256', async () => {
        const { root, workDir } = project();
        const digest = `sha256:${'a'.repeat(64)}`;
        const outcome = await captureRun(baseInput(workDir), {
            projectPath: root,
            lookupTopology: () => null,
        });
        expect(outcome.diagnostics).toEqual([]);
        const withDigest = await captureRun(
            { ...baseInput(workDir), definitionDigest: digest },
            { projectPath: root, lookupTopology: () => null },
        );
        expect(withDigest.captured).toBe(true);
        expect(withDigest.record?.topology).toBeUndefined();
        expect(withDigest.diagnostics[0]?.code).toBe('board.capture.topology-unavailable');
        writeFileSync(join(workDir, 'scratch.txt'), 'ok');
    });
});

describe('capture setting kinds', () => {
    it('validates every allowlisted setting kind and refuses an out-of-range value', () => {
        expect(parseSetting('kk-daily-ai-voice2', 'qc_min_quality=0.7')).toEqual({
            key: 'qc_min_quality',
            value: '0.7',
        });
        expect(parseSetting('kk-daily-ai-voice2', 'skip_review=true')).toEqual({ key: 'skip_review', value: 'true' });
        expect(parseSetting('kk-daily-ai-voice2', 'window=12h')).toEqual({ key: 'window', value: '12h' });
        expect(parseSetting('kk-daily-ai-voice2', 'language=zh')).toEqual({ key: 'language', value: 'zh' });
        expect(() => parseSetting('kk-daily-ai-voice2', 'qc_min_quality=soon')).toThrow(/nonnegative number/);
        expect(() => parseSetting('kk-daily-ai-voice2', 'skip_review=maybe')).toThrow(/'true' or 'false'/);
        expect(() => parseSetting('kk-daily-ai-voice2', 'window=soon')).toThrow(/expected a duration/);
        expect(() => parseSetting('kk-daily-ai-voice2', 'language=fr')).toThrow(/expected one of/);
    });
});

describe('capture read hardening', () => {
    it('returns null for an unparseable record and an unreadable marker', async () => {
        const { root, workDir } = project();
        const runsDir = join(root, '.works/.board/runs');
        mkdirSync(runsDir, { recursive: true });
        writeFileSync(join(runsDir, 'broken.json'), '{not json');
        expect(await readCaptureRecord(createNodeFileSystem(), root, 'broken')).toBeNull();
        mkdirSync(join(workDir, '.kk-board-owner.json'));
        expect(await readOwnerMarker(createNodeFileSystem(), workDir)).toBeNull();
    });

    it('rejects a marker whose schemaVersion is missing or not 1 (§9)', async () => {
        const { workDir } = project();
        const fs = createNodeFileSystem();
        writeFileSync(
            join(workDir, '.kk-board-owner.json'),
            JSON.stringify({ projectPath: '/proj', workflow: 'kk-collect', runId: 'run-1' }),
        );
        expect(await readOwnerMarker(fs, workDir)).toBeNull();
        writeFileSync(
            join(workDir, '.kk-board-owner.json'),
            JSON.stringify({ schemaVersion: 2, projectPath: '/proj', workflow: 'kk-collect', runId: 'run-1' }),
        );
        expect(await readOwnerMarker(fs, workDir)).toBeNull();
        writeFileSync(
            join(workDir, '.kk-board-owner.json'),
            JSON.stringify({ schemaVersion: 1, projectPath: '/proj', workflow: 'kk-collect', runId: 'run-1' }),
        );
        expect(await readOwnerMarker(fs, workDir)).toMatchObject({ runId: 'run-1' });
    });
});

describe('capture workspace guard', () => {
    it('refuses a filesystem root as the run workspace', async () => {
        const { root, workDir } = project();
        await expect(captureRun({ ...baseInput(workDir), workDir: '/' }, { projectPath: root })).rejects.toThrow(
            /run workspace below a works root/,
        );
    });

    it('refuses a home, project-root, outside-works or works-root workspace (§9)', async () => {
        const { root, workDir } = project();
        const deps = { projectPath: root };
        // A relative path that does not land in a works root is refused on its canonical location.
        await expect(captureRun({ ...baseInput(workDir), workDir: 'relative/dir' }, deps)).rejects.toThrow(
            /run workspace below a works root/,
        );
        await expect(captureRun({ ...baseInput(workDir), workDir: homedir() }, deps)).rejects.toThrow(
            /run workspace below a works root/,
        );
        await expect(captureRun({ ...baseInput(workDir), workDir: root }, deps)).rejects.toThrow(
            /run workspace below a works root/,
        );
        const elsewhere = join(root, 'elsewhere');
        mkdirSync(elsewhere, { recursive: true });
        await expect(captureRun({ ...baseInput(workDir), workDir: elsewhere }, deps)).rejects.toThrow(
            /run workspace below a works root/,
        );
        // The works root itself is not a run workspace — the marker must land in a child of it.
        await expect(captureRun({ ...baseInput(workDir), workDir: join(root, '.works') }, deps)).rejects.toThrow(
            /run workspace below a works root/,
        );
    });

    it('accepts a relative work-dir and a foreign calling tree (§9 E2E shape)', async () => {
        const { root } = project();
        // `kk-collect` composes `.works/kk-collect/<stamp>` RELATIVE to its project, and the engine may
        // run the action from any cwd — both shapes must capture (the E2E caught a guard that did not).
        const relative = await captureRun(
            {
                ...baseInput(join(root, '.works', 'kk-collect', '20261011T1200Z')),
                workDir: '.works/kk-collect/20261011T1200Z',
            },
            { projectPath: root },
        );
        expect(relative.record?.workspacePath).toBe(join(root, '.works', 'kk-collect', '20261011T1200Z'));
        const otherTree = tempDir('kk-board-other-project-');
        await expect(
            captureRun(baseInput(join(root, '.works', 'kk-collect', '20261011T1200Z')), { projectPath: otherTree }),
        ).resolves.toBeDefined();
    });
});

describe('capture topology', () => {
    it('attaches a matched topology and warns when the lookup throws or misses', async () => {
        const { root, workDir } = project();
        const digest = `sha256:${'b'.repeat(64)}`;
        const attached = await captureRun(
            { ...baseInput(workDir), runId: 'run-topo', definitionDigest: digest },
            { projectPath: root, lookupTopology: () => ({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b' }] }) },
        );
        expect(attached.diagnostics).toEqual([]);
        expect(attached.record?.topology).toEqual({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b' }] });

        const other = project();
        const thrown = await captureRun(
            { ...baseInput(other.workDir), runId: 'run-topo2', definitionDigest: digest },
            {
                projectPath: other.root,
                lookupTopology: () => {
                    throw new Error('catalog down');
                },
            },
        );
        expect(thrown.diagnostics[0]?.code).toBe('board.capture.topology-unavailable');
        expect(thrown.record?.topology).toBeUndefined();
    });

    it('warns (never rewrites results) when the record write fails after revocation', async () => {
        const { root, workDir } = project();
        await captureRun({ ...baseInput(workDir), runId: 'run-old' }, { projectPath: root });
        const runsDir = join(root, '.works/.board/runs');
        rmSync(runsDir, { recursive: true, force: true });
        writeFileSync(runsDir, 'not a directory');
        const outcome = await captureRun({ ...baseInput(workDir), runId: 'run-new' }, { projectPath: root });
        expect(outcome).toMatchObject({ revoked: true, captured: false, record: null });
        expect(outcome.diagnostics[0]?.code).toBe('board.capture.failed');
    });

    it('reads topology from the catalog entry whose digest matches', async () => {
        const { root, workDir } = project();
        const catalogDir = tempDir('kk-board-catalog-');
        const workflowPath = join(catalogDir, 'kk-collect.yaml');
        writeFileSync(
            workflowPath,
            'states:\n  - id: collect\n  - id: store\ntransitions:\n  - from: collect\n    to: store\n',
        );
        const digest = `sha256:${'c'.repeat(64)}`;
        const previous = process.env.KK_SPUR_BIN;
        const spurBin = join(catalogDir, 'spur');
        writeFileSync(
            spurBin,
            `#!/bin/sh\nprintf '%s' '{"entries":[{"name":"kk-collect","definitionDigest":"${digest}","path":"${workflowPath}"}]}'\n`,
        );
        chmodSync(spurBin, 0o755);
        process.env.KK_SPUR_BIN = spurBin;
        try {
            const outcome = await captureRun(
                { ...baseInput(workDir), runId: 'run-catalog', definitionDigest: digest },
                { projectPath: root },
            );
            expect(outcome.diagnostics).toEqual([]);
            expect(outcome.record?.topology).toEqual({
                nodes: ['collect', 'store'],
                edges: [{ from: 'collect', to: 'store' }],
            });
        } finally {
            if (previous === undefined) delete process.env.KK_SPUR_BIN;
            else process.env.KK_SPUR_BIN = previous;
        }
    });
});
