import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    buildColabArgv,
    buildDownloadArgv,
    buildStopArgv,
    type ColabJob,
    DEFAULT_COLAB_CACHE_DIR,
    LOCAL_KILL_GRACE_MS,
    parseWorkerResult,
    runColabJob,
    sessionName,
    WORKER_RESULT_MARKER,
} from '../src/colab-runner';
import type { RunProcess } from '../src/process';

/**
 * AC2 (R1/R2/R3) — the Colab runner against a recording fake `colab`: the frozen argv, the cache
 * env, the download path, unconditional teardown, and one ledger line per job.
 */

const fs = createNodeFileSystem();

function job(overrides: Partial<ColabJob> = {}): ColabJob {
    return {
        jobType: 'wan21-i2v',
        gpu: 'A100',
        script: '/plugins/video-gen/python/colab_wan21_i2v.py',
        inputPaths: ['/local/cover.png'],
        outputNames: ['clip-0.mp4'],
        remoteDir: '/content/kk-video',
        runDate: '20261126',
        timeoutMs: 600_000,
        ...overrides,
    };
}

function scratch(): { runProcess: RunProcess; calls: { argv: string[]; timeoutMs?: number }[]; outputs: () => string } {
    const outputs = mkdtempSync(join(tmpdir(), 'kk-colab-out-'));
    const calls: { argv: string[]; timeoutMs?: number }[] = [];
    const runProcess: RunProcess = async (argv, options) => {
        calls.push({ argv, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
        if (argv[1] === 'exec') {
            return {
                code: 0,
                stdout: `booting\n${WORKER_RESULT_MARKER}{"cache":"drive","outputs":["/content/kk-video/clip-0.mp4"]}\n`,
                stderr: '',
            };
        }
        if (argv[1] === 'download') {
            writeFileSync(argv[3] as string, 'mp4');
            return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
    };
    return { runProcess, calls, outputs: () => outputs };
}

const deps = (harness: ReturnType<typeof scratch>, now?: () => number) => ({
    runProcess: harness.runProcess,
    fs,
    ledgerPath: join(harness.outputs(), 'works', 'colab-ccu-ledger.jsonl'),
    outputDir: harness.outputs(),
    now: now ?? (() => Date.parse('2026-11-27T12:00:00.000Z')),
});

describe('frozen argv (step-0 spike)', () => {
    it('runs the worker in the selected session with a timeout and cache env', () => {
        const session = sessionName(job());
        const argv = buildColabArgv(job(), session);
        expect(argv.slice(0, 2)).toEqual([process.env.KK_COLAB_BIN ?? 'colab', 'exec']);
        expect(argv[argv.indexOf('--file') + 1]).toBe('/plugins/video-gen/python/colab_wan21_i2v.py');
        expect(argv[argv.indexOf('--session') + 1]).toBe(session);
        // A 600 000 ms job is 600 s; the CLI default (30 s) must never be inherited.
        expect(argv[argv.indexOf('--timeout') + 1]).toBe('600');
        expect(argv.join(' ')).toContain(`--env KK_COLAB_CACHE_DIR=${DEFAULT_COLAB_CACHE_DIR}`);
        expect(session).toMatch(/^kk-video-20261126-wan21-i2v-/);
    });

    it('carries extra env pairs and the CLI transfer verbs', () => {
        const argv = buildColabArgv(job({ env: { KK_WAN21_STEPS: '20' } }), 's1', '/drive/cache');
        expect(argv.join(' ')).toContain('--env KK_WAN21_STEPS=20');
        expect(argv.join(' ')).toContain('--env KK_COLAB_CACHE_DIR=/drive/cache');
        expect(buildDownloadArgv('s1', '/content/kk-video/clip-0.mp4', '/tmp/clip-0.mp4')).toEqual([
            process.env.KK_COLAB_BIN ?? 'colab',
            'download',
            '/content/kk-video/clip-0.mp4',
            '/tmp/clip-0.mp4',
            '--session',
            's1',
        ]);
        expect(buildStopArgv('s1')).toContain('stop');
        expect(buildStopArgv('s1')).toContain('s1');
    });
});

describe('worker result parsing', () => {
    it('reads the last marker line and tolerates silence or junk', () => {
        expect(parseWorkerResult(`${WORKER_RESULT_MARKER}{"cache":"local"}`)).toEqual({ cache: 'local' });
        expect(parseWorkerResult('no marker here')).toBeNull();
        expect(parseWorkerResult(`${WORKER_RESULT_MARKER}not-json`)).toBeNull();
        expect(parseWorkerResult(`${WORKER_RESULT_MARKER}{"cache":"drive","outputs":["a","b"]}`)).toEqual({
            cache: 'drive',
            outputs: ['a', 'b'],
        });
    });
});

describe('runColabJob', () => {
    it('cleans up only the session assigned to each attempt for the same date and provider', async () => {
        const first = scratch();
        const second = scratch();
        const failedNew: RunProcess = async (argv) => {
            second.calls.push({ argv });
            return { code: argv[1] === 'new' ? 1 : 0, stdout: '', stderr: 'allocation refused' };
        };

        await runColabJob(job(), deps(first));
        await runColabJob(job(), { ...deps(second), runProcess: failedNew });

        const sessions = (harness: ReturnType<typeof scratch>) =>
            harness.calls.map(({ argv }) => argv[argv.indexOf('--session') + 1]);
        const firstSession = sessions(first)[0];
        const secondSession = sessions(second)[0];
        expect(firstSession).toMatch(/^kk-video-20261126-wan21-i2v-/);
        expect(secondSession).not.toBe(firstSession);
        expect(new Set(sessions(first))).toEqual(new Set([firstSession]));
        expect(sessions(second)).toEqual([secondSession, secondSession]);
        expect(second.calls.map(({ argv }) => argv[1])).toEqual(['new', 'stop']);
    });

    it('downloads the outputs, stops the session and appends a ledger line', async () => {
        const harness = scratch();
        const result = await runColabJob(job(), deps(harness));

        expect(result.ok).toBe(true);
        expect(result.outputs).toHaveLength(1);
        expect(result.cache).toBe('drive');
        expect(result.estimatedCcu).toBe(0);

        const programs = harness.calls.map((call) => call.argv[1]);
        expect(programs).toEqual(['new', 'drivemount', 'upload', 'exec', 'download', 'stop']);
        // The local kill allowance rides the seam's deadline (R1).
        expect(harness.calls[3]?.timeoutMs).toBe(600_000 + LOCAL_KILL_GRACE_MS);

        const ledger = await fs.readFile(join(harness.outputs(), 'works', 'colab-ccu-ledger.jsonl'));
        expect(JSON.parse(ledger.trim())).toMatchObject({ gpu: 'A100', jobType: 'wan21-i2v', status: 'ok' });
    });

    it('uploads input media before executing the worker with VM-local arguments', async () => {
        const harness = scratch();
        const input = '/local/news cover.png';
        const result = await runColabJob(job({ inputPaths: [input] }), deps(harness));
        expect(result.ok).toBe(true);
        const [create, mount, upload, execute, download, stop] = harness.calls.map((call) => call.argv);
        const session = create?.[3];
        expect(session).toMatch(/^kk-video-20261126-wan21-i2v-/);
        expect(create?.slice(1)).toEqual(['new', '--session', session, '--gpu', 'A100']);
        expect(mount?.slice(1)).toEqual(['drivemount', '/content/drive', '--session', session]);
        expect(upload?.slice(1, 4)).toEqual(['upload', input, '/content/kk-input-0.png']);
        expect(execute).toContain(
            'KK_COLAB_ARGS=["--images","/content/kk-input-0.png","--out-dir","/content/kk-video"]',
        );
        expect(download?.[2]).toBe('/content/kk-video/clip-0.mp4');
        expect(stop?.[1]).toBe('stop');
    });

    it('stops the session after a failed run and reports the cause', async () => {
        const harness = scratch();
        const runProcess: RunProcess = async (argv, options) => {
            harness.calls.push({ argv, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
            if (argv[1] === 'exec') return { code: 1, stdout: '', stderr: 'CUDA out of memory' };
            return { code: 0, stdout: '', stderr: '' };
        };
        const result = await runColabJob(job(), { ...deps(harness), runProcess });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('CUDA out of memory');
        expect(harness.calls.map((call) => call.argv[1])).toEqual(['new', 'drivemount', 'upload', 'exec', 'stop']);
    });

    it('stops a session when input upload fails and never executes the worker', async () => {
        const harness = scratch();
        const runProcess: RunProcess = async (argv, options) => {
            if (argv[1] === 'upload') {
                harness.calls.push({ argv });
                return { code: 1, stdout: '', stderr: 'transfer failed' };
            }
            return harness.runProcess(argv, options);
        };
        const result = await runColabJob(job(), { ...deps(harness), runProcess });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('transfer failed');
        expect(harness.calls.map((call) => call.argv[1])).toEqual(['new', 'drivemount', 'upload', 'stop']);
    });

    it('reports a teardown refusal even when inference and download succeed', async () => {
        const harness = scratch();
        const runProcess: RunProcess = async (argv, options) =>
            argv[1] === 'stop'
                ? { code: 1, stdout: '', stderr: 'session stop refused' }
                : harness.runProcess(argv, options);
        const result = await runColabJob(job(), { ...deps(harness), runProcess });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session stop refused');
    });

    it('stops the session when the run times out, and records the timeout status', async () => {
        const harness = scratch();
        const runProcess: RunProcess = async (argv, options) => {
            harness.calls.push({ argv, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
            if (argv[1] === 'exec') throw new Error('timeout: process group killed after 660000ms');
            return { code: 0, stdout: '', stderr: '' };
        };
        const result = await runColabJob(job(), { ...deps(harness), runProcess });
        expect(result.ok).toBe(false);
        expect(harness.calls.map((call) => call.argv[1])).toContain('stop');
        const ledger = await fs.readFile(join(harness.outputs(), 'works', 'colab-ccu-ledger.jsonl'));
        expect(JSON.parse(ledger.trim())).toMatchObject({ status: 'timeout' });
    });

    it('refuses before launching when the rolling 30-day total is at the cap', async () => {
        const harness = scratch();
        const ledgerPath = join(harness.outputs(), 'works', 'colab-ccu-ledger.jsonl');
        await fs.ensureDir(join(harness.outputs(), 'works'));
        await fs.writeFile(
            ledgerPath,
            `${JSON.stringify({
                timestamp: '2026-11-20T00:00:00.000Z',
                gpu: 'A100',
                durationSec: 3600,
                estimatedCcu: 179,
                jobType: 'wan21-i2v',
                status: 'ok',
            })}\n`,
        );
        const result = await runColabJob(job(), { ...deps(harness), ledgerPath });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('budget exhausted');
        // Zero invocations: the refusal happens before any spawn.
        expect(harness.calls).toHaveLength(0);
    });

    it('reports a missing worker result and a failed download as failures', async () => {
        const silent = scratch();
        const silentRun: RunProcess = async (argv, options) => {
            silent.calls.push({ argv, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
            return { code: 0, stdout: 'booting only', stderr: '' };
        };
        const noResult = await runColabJob(job(), { ...deps(silent), runProcess: silentRun });
        expect(noResult.ok).toBe(false);
        expect(noResult.error).toContain('no KK_COLAB_RESULT');

        const broken = scratch();
        const brokenRun: RunProcess = async (argv, options) => {
            broken.calls.push({ argv, ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
            if (argv[1] === 'exec') {
                return { code: 0, stdout: `${WORKER_RESULT_MARKER}{"cache":"drive"}`, stderr: '' };
            }
            if (argv[1] === 'download') return { code: 1, stdout: '', stderr: 'no such file' };
            return { code: 0, stdout: '', stderr: '' };
        };
        const failedDownload = await runColabJob(job(), { ...deps(broken), runProcess: brokenRun });
        expect(failedDownload.ok).toBe(false);
        expect(failedDownload.error).toContain('download of clip-0.mp4 failed');
    });
});
