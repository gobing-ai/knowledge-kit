/**
 * `launchWorkflow` — the in-binary launch supervisor (task 0365 R1–R5, R9; design §3).
 *
 * FAILURE MODES, written before the implementation (task Q&A "failure modes first"). Every entry
 * is a named case below; the number is the case's subject, the rest says what the supervisor owes.
 *
 *   1. lock held          — another run owns `<workflow>-<run>`: exit 6, receipt byte-identical, no child (R2, AC1).
 *   2. probe dead         — the executor probe fails: exit 5, refused receipt naming the executor, no child (R3, AC2).
 *   3. dirty harness      — `git status --porcelain` on harness paths is non-empty: exit 5 unless `allowDirty` (R3).
 *   4. install divergence — checkout differs from the installed kk package: exit 5 (R3).
 *   5. missing skill      — the writer skill carries no SKILL.md: exit 5, refused before the lock pays (R4).
 *   6. spawn failure      — the engine binary cannot be spawned: `failed` + the spawn reason, exit 1 (R5).
 *   7. non-zero exit      — the workflow failed: `failed`, the child's own exit code (R5, AC3b).
 *   8. timeout            — `timeoutMs` expires: `timeout`, exit 124 (R5, AC3c).
 *   9. SIGINT             — interrupted: `failed`, exit 143, cleanup runs (R5).
 *  10. SIGTERM            — interrupted: `failed`, exit 143, cleanup runs, lock free (R5, AC3d).
 *  11. cleanup throws     — store release / ledger sync throw: the lock is still released and the receipt still lands (R5).
 *  12. receipt unwritable — the running receipt cannot be written: the error surfaces and the lock is released (R5).
 *  13. dry run            — steps 1+3 only: no lock, no write, planned argv under `dryRun`, exit 0 (R9).
 *  14. no content         — the run report says `no-content:`: status `no-content`, exit 0 (R5).
 *  15. publish launch     — a `kk-publish` launch never recycles store selections a send may own (R5, §3.2).
 *  16. done without bundle — a green generate that froze no bundle recycles: nothing could settle it.
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RunCaptureInput } from '@gobing-ai/kk-board/contracts';
import {
    createNodeFileSystem,
    type FileSystem,
    type ProcessExecutor,
    type ProcessOptions,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import type { CaptureOutcome } from '../src/board/capture';
import { createLaunchDeps, type LaunchDeps, type LaunchReceipt, launchWorkflow } from '../src/launch';
import { silenceOutput } from './capture';

interface Call {
    command: string;
    args: string[];
    cwd?: string;
}

interface Reply {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    outcome?: ProcessResult['outcome'];
}

interface Harness {
    deps: LaunchDeps;
    calls: Call[];
    locks: string[];
    releases: string[];
    recycled: string[];
    ledgers: string[];
    /** Ordered lifecycle facts: `subscribe`, `recycle`, `ledger`, `release`, `unsubscribe`. */
    events: string[];
    /** Whether the signal handler was still installed each time the harness fired a signal. */
    handlerLive: boolean[];
    /** Board capture inputs the hermetic default seam saw (0391). */
    captures: RunCaptureInput[];
    workflowRuns(): Call[];
    fire(signal: 'SIGINT' | 'SIGTERM'): void;
    restore(): void;
}

interface HarnessOptions {
    reply?: (call: Call) => Reply | undefined;
    installRoot?: string | null;
    /** Fire a signal from inside one cleanup step, the window defect 2 is about. */
    fireDuring?: 'recycle' | 'ledger';
    fireSignal?: 'SIGINT' | 'SIGTERM';
    lockHeld?: boolean;
    lockReleaseThrows?: boolean;
    recycleThrows?: boolean;
    ledgerThrows?: boolean | 'string';
    fs?: FileSystem;
}

/** The default answer table: a healthy machine, a green workflow, one stubbed probe. */
function defaultReply(call: Call): Reply | undefined {
    const joined = call.args.join(' ');
    if (call.command === 'git' && joined.includes('rev-parse')) return { stdout: 'abc123\n' };
    if (call.command === 'git' && joined.includes('status')) return { stdout: '' };
    if (call.command === 'sh') return { exitCode: 1, stdout: '' };
    if (joined.includes('agent run')) return { exitCode: 0 };
    return { exitCode: 0 };
}

function harness(options: HarnessOptions = {}): Harness {
    const silence = silenceOutput();
    const calls: Call[] = [];
    const locks: string[] = [];
    const releases: string[] = [];
    const recycled: string[] = [];
    const ledgers: string[] = [];
    const events: string[] = [];
    const handlerLive: boolean[] = [];
    const captures: RunCaptureInput[] = [];
    let handler: ((signal: 'SIGINT' | 'SIGTERM') => void) | undefined;
    const fireNow = (): void => {
        handlerLive.push(handler !== undefined);
        handler?.(options.fireSignal ?? 'SIGTERM');
    };
    const reply = options.reply ?? defaultReply;
    const executor: ProcessExecutor = {
        async run(processOptions: ProcessOptions): Promise<ProcessResult> {
            const call: Call = {
                command: processOptions.command,
                args: processOptions.args ?? [],
                ...(processOptions.cwd === undefined ? {} : { cwd: processOptions.cwd }),
            };
            calls.push(call);
            const answer = reply(call) ?? {};
            return {
                command: call.command,
                args: call.args,
                exitCode: answer.exitCode ?? 0,
                stdout: answer.stdout ?? '',
                stderr: answer.stderr ?? '',
                durationMs: 1,
                outcome: answer.outcome ?? 'exit',
            };
        },
        runStreaming() {
            throw new Error('launchWorkflow supervises one shot child only');
        },
    };
    const deps: LaunchDeps = {
        spawn: executor,
        now: () => new Date('2026-11-13T20:00:00.000Z'),
        fs: options.fs ?? createNodeFileSystem(),
        lock: {
            async acquire(name, run, ttl) {
                locks.push(`${name}:${run}:${ttl}`);
                return options.lockHeld === true ? { acquired: false, holder: 'other-run' } : { acquired: true };
            },
            async release(name, run) {
                events.push('release');
                releases.push(`${name}:${run}`);
                if (options.lockReleaseThrows === true) throw new Error('lock store unavailable');
                return true;
            },
        },
        signals: {
            subscribe(next) {
                events.push('subscribe');
                handler = next;
                return () => {
                    events.push('unsubscribe');
                    handler = undefined;
                };
            },
        },
        async recycleRun(runId) {
            events.push('recycle');
            recycled.push(runId);
            if (options.recycleThrows === true) throw new Error('store release exploded');
            if (options.fireDuring === 'recycle') fireNow();
            return { released: 2 };
        },
        async ledgerSync(settings) {
            events.push('ledger');
            ledgers.push(`${settings.workflow}:${settings.workDir}`);
            if (options.ledgerThrows === true) throw new Error('ledger sync exploded');
            if (options.ledgerThrows === 'string') throw 'ledger sync exploded';
            if (options.fireDuring === 'ledger') fireNow();
        },
        installRoot: async () => options.installRoot ?? null,
        // 0391: the capture seam stays hermetic like every other dep — a launch binds nothing real.
        capture: async (input) => {
            captures.push(input);
            return { revoked: false, captured: true, record: null, diagnostics: [] };
        },
    };
    return {
        deps,
        calls,
        captures,
        locks,
        releases,
        recycled,
        ledgers,
        events,
        handlerLive,
        workflowRuns: () => calls.filter((call) => call.args.includes('workflow') && call.args.includes('run')),
        fire: (signal) => handler?.(signal),
        restore: silence,
    };
}

interface Scratch {
    root: string;
    workDir: string;
    workflowPath: string;
    receiptPath: string;
    harnessRoot: string;
}

function scratch(): Scratch {
    const root = mkdtempSync(join(tmpdir(), 'kk-launch-'));
    const workDir = join(root, 'works', 'kk-news-generate', '20260101');
    const workflowPath = join(root, 'workflows', 'kk-news-generate.yaml');
    mkdirSync(workDir, { recursive: true });
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, 'name: kk-news-generate\n');
    return {
        root,
        workDir,
        workflowPath,
        receiptPath: join(workDir, 'schedule-receipt.json'),
        harnessRoot: root,
    };
}

function baseOptions(space: Scratch) {
    return {
        type: 'news',
        workflow: 'kk-news-generate',
        workflowPath: space.workflowPath,
        run: '20260101',
        workDir: space.workDir,
        worksDir: join(space.root, 'works'),
        harnessRoot: space.harnessRoot,
        allowDirty: true,
        spurBin: 'spur',
    } as const;
}

function readReceipt(path: string): LaunchReceipt {
    return JSON.parse(readFileSync(path, 'utf8')) as LaunchReceipt;
}

describe('launchWorkflow — lock ownership (0365 R2, AC1)', () => {
    it('refuses a second launch for the same workflow and run day, leaving the holder receipt byte-identical', async () => {
        const space = scratch();
        const before = `${JSON.stringify({ status: 'running', runId: 'holder' }, null, 2)}\n`;
        writeFileSync(space.receiptPath, before);
        const stub = harness({ lockHeld: true });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.exitCode).toBe(6);
            expect(receipt.status).toBe('refused');
            expect(receipt.reason).toContain('other-run');
            expect(readFileSync(space.receiptPath, 'utf8')).toBe(before);
            expect(stub.workflowRuns()).toHaveLength(0);
            expect(stub.releases).toEqual([]);
            expect(stub.locks).toEqual(['kk-news-generate-20260101:kk-news-generate-20260101-1794600000000:13500000']);
        } finally {
            stub.restore();
        }
    });
});

describe('launchWorkflow — preflight refusals (0365 R3, AC2)', () => {
    it('refuses with exit 5 and a refused receipt naming the executor when the traffic probe fails', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.join(' ').includes('agent run'))
                    return { exitCode: 1, stderr: 'quota exhausted for scribe' };
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });
            const written = readReceipt(space.receiptPath);

            expect(receipt.exitCode).toBe(5);
            expect(receipt.status).toBe('refused');
            expect(receipt.reason).toContain("executor probe failed for 'scribe'");
            expect(receipt.reason).toContain('quota exhausted');
            expect(written.status).toBe('refused');
            expect(written.reason).toContain('quota exhausted');
            expect(stub.workflowRuns()).toHaveLength(0);
            expect(stub.releases).toHaveLength(1);
            expect(stub.calls.some((call) => call.args.includes('--agent') && call.args.includes('scribe'))).toBe(true);
        } finally {
            stub.restore();
        }
    });

    it('refuses a dirty harness path unless allowDirty is set, then launches', async () => {
        const space = scratch();
        const dirty = harness({
            reply: (call) => {
                if (call.command === 'git' && call.args.join(' ').includes('status')) {
                    return { stdout: ' M plugins/kk/workflows/kk-news-generate.yaml\n' };
                }
                return defaultReply(call);
            },
        });
        try {
            const refused = await launchWorkflow({ ...baseOptions(space), allowDirty: false, deps: dirty.deps });
            expect(refused.exitCode).toBe(5);
            expect(refused.reason).toContain('working tree dirty on harness paths');
            expect(dirty.workflowRuns()).toHaveLength(0);

            const allowed = await launchWorkflow({ ...baseOptions(space), allowDirty: true, deps: dirty.deps });
            expect(allowed.status).toBe('done');
            expect(dirty.workflowRuns()).toHaveLength(1);
        } finally {
            dirty.restore();
        }
    });

    it('refuses when the checkout diverges from the installed kk package', async () => {
        const space = scratch();
        // The checkout lives one level down from the package root the binary belongs to.
        const checkout = join(space.root, 'checkout');
        mkdirSync(join(checkout, 'plugins', 'kk', 'workflows'), { recursive: true });
        mkdirSync(join(space.root, 'plugins', 'kk', 'workflows'), { recursive: true });
        const stub = harness({
            installRoot: space.root,
            reply: (call) => {
                if (call.command === 'diff') {
                    return { exitCode: 1, stdout: `Files ${call.args[1]}/a.yaml and ${call.args[2]}/a.yaml differ\n` };
                }
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({
                ...baseOptions(space),
                harnessRoot: checkout,
                deps: stub.deps,
            });

            expect(receipt.exitCode).toBe(5);
            expect(receipt.reason).toContain('checkout diverges from installed kk');
            expect(receipt.reason).toContain('checkout/');
            // The refusal names the repair: a stale bundled copy is refreshed by the repo's own
            // bundler, and a stale install by reinstalling the package.
            expect(receipt.reason).toContain('bun scripts/bundle-plugins.ts');
            expect(stub.workflowRuns()).toHaveLength(0);
        } finally {
            stub.restore();
        }
    });

    it('refuses before the lock pays for a writer skill that carries no SKILL.md', async () => {
        const space = scratch();
        const stub = harness();
        try {
            const receipt = await launchWorkflow({
                ...baseOptions(space),
                preflightReasons: ['content type writer skill is missing SKILL.md: /pkg/skills/missing/SKILL.md'],
                deps: stub.deps,
            });

            expect(receipt.exitCode).toBe(5);
            expect(receipt.reason).toContain('missing SKILL.md');
            expect(stub.workflowRuns()).toHaveLength(0);
        } finally {
            stub.restore();
        }
    });
});

describe('launchWorkflow — child lifecycle and cleanup (0365 R4, R5, AC3)', () => {
    it('records one workflow child, the vars, and a done receipt with executor and checkout commit', async () => {
        const space = scratch();
        // A genuinely green generate froze its bundle; without one the launch now recycles (case 16).
        mkdirSync(join(space.workDir, '4-publish'), { recursive: true });
        writeFileSync(join(space.workDir, '4-publish', 'bundle.json'), '{}\n');
        const stub = harness();
        try {
            const receipt = await launchWorkflow({
                ...baseOptions(space),
                agent: 'codex',
                window: 'after-generate',
                vars: { skill_dir: '/pkg/skills/news-editorial', skip_review: 'true' },
                writerSkill: { dir: '/pkg/skills/news-editorial', sha256: 'f'.repeat(64) },
                deps: stub.deps,
            });
            const runs = stub.workflowRuns();
            const vars = JSON.parse(runs[0]?.args[runs[0].args.indexOf('--vars') + 1] ?? '{}') as Record<
                string,
                string
            >;

            expect(receipt.status).toBe('done');
            expect(receipt.exitCode).toBe(0);
            expect(receipt.executor).toBe('codex');
            expect(receipt.checkoutCommit).toBe('abc123');
            expect(receipt.window).toBe('after-generate');
            expect(receipt.writerSkill?.sha256).toBe('f'.repeat(64));
            expect(runs).toHaveLength(1);
            expect(runs[0]?.args.slice(0, 3)).toEqual(['--no-logo', 'workflow', 'run']);
            expect(runs[0]?.args[3]).toBe(space.workflowPath);
            expect(vars).toMatchObject({
                work_dir: space.workDir,
                run_date: '20260101',
                run_id: receipt.runId,
                agent: 'codex',
                window: 'after-generate',
                skill_dir: '/pkg/skills/news-editorial',
                skip_review: 'true',
            });
            expect(stub.recycled).toEqual([]);
            expect(stub.ledgers).toHaveLength(1);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('omits the agent var when no executor was named and records the default inline posture', async () => {
        const space = scratch();
        const stub = harness();
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), agent: '  ', deps: stub.deps });
            const run = stub.workflowRuns()[0];
            const vars = JSON.parse(run?.args[(run?.args.indexOf('--vars') ?? 0) + 1] ?? '{}') as Record<
                string,
                string
            >;

            expect(receipt.executor).toBe('inline');
            expect('agent' in vars).toBe(false);
            expect(stub.calls.some((call) => call.args.includes('--agent') && call.args.includes('scribe'))).toBe(true);
        } finally {
            stub.restore();
        }
    });

    it('fails with the child exit code and still cancels, recycles, syncs and frees the lock', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) {
                    return { exitCode: 1, stderr: 'node voice failed' };
                }
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('failed');
            expect(receipt.exitCode).toBe(1);
            expect(receipt.reason).toContain('node voice failed');
            expect(receipt.executor).toBe('inline');
            expect(receipt.checkoutCommit).toBe('abc123');
            // Cleanup cancels the run AND the nested `<runId>-safety` review design §5.1 may have started.
            expect(stub.calls.filter((call) => call.args.includes('cancel'))).toHaveLength(2);
            expect(stub.calls.filter((call) => call.args.join(' ').includes('-safety'))).toHaveLength(1);
            expect(stub.recycled).toEqual([receipt.runId]);
            expect(stub.ledgers).toHaveLength(1);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('records a HITL pause as incomplete and leaves the run resumable: no cancel, no recycle', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) {
                    // spur exits 1 on a pause node (2026-11-20/23 manual runs stopped at `review`).
                    return { exitCode: 1, stderr: 'workflow paused: kk-news-generate -> review' };
                }
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('incomplete');
            expect(receipt.exitCode).toBe(1);
            expect(receipt.reason).toContain('paused at review');
            expect(receipt.reason).toContain(`spur workflow continue ${receipt.runId}`);
            expect(stub.calls.filter((call) => call.args.includes('cancel'))).toHaveLength(0);
            expect(stub.recycled).toEqual([]);
            expect(stub.ledgers).toHaveLength(1);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('reports a spawn failure as failed with the engine error named, releasing the lock', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) {
                    return { exitCode: null as unknown as number, outcome: 'error', stderr: 'spawn spur ENOENT' };
                }
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('failed');
            expect(receipt.exitCode).toBe(1);
            expect(receipt.reason).toContain('spawn spur ENOENT');
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('maps an expired deadline to a timeout receipt with exit 124', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) {
                    return { exitCode: null as unknown as number, outcome: 'timeout', stderr: '' };
                }
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), timeoutMs: 50, deps: stub.deps });

            expect(receipt.status).toBe('timeout');
            expect(receipt.exitCode).toBe(124);
            // Cleanup cancels the run AND the nested `<runId>-safety` review design §5.1 may have started.
            expect(stub.calls.filter((call) => call.args.includes('cancel'))).toHaveLength(2);
            expect(stub.calls.filter((call) => call.args.join(' ').includes('-safety'))).toHaveLength(1);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('treats SIGINT and SIGTERM as a failed launch that cleans up the same way', async () => {
        const space = scratch();
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
            const stub = harness({
                reply: (call) => {
                    if (call.args.includes('workflow') && call.args.includes('run')) {
                        stub.fire(signal);
                        return { exitCode: null as unknown as number, outcome: 'cancelled' };
                    }
                    return defaultReply(call);
                },
            });
            try {
                const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

                expect(receipt.status).toBe('failed');
                expect(receipt.exitCode).toBe(143);
                // Cleanup cancels the run AND the nested `<runId>-safety` review design §5.1 may have started.
                expect(stub.calls.filter((call) => call.args.includes('cancel'))).toHaveLength(2);
                expect(stub.calls.filter((call) => call.args.join(' ').includes('-safety'))).toHaveLength(1);
                expect(stub.recycled).toEqual([receipt.runId]);
                expect(stub.releases).toHaveLength(1);
            } finally {
                stub.restore();
            }
        }
    });
});

describe('launchWorkflow — the real signal port (0365 R5)', () => {
    it('delivers SIGINT and SIGTERM to the subscriber once and unsubscribes on release', () => {
        const port = createLaunchDeps().signals;
        const seen: string[] = [];
        const off = port.subscribe((signal) => seen.push(signal));

        process.emit('SIGTERM');
        process.emit('SIGINT');
        off();
        process.emit('SIGTERM');

        expect(seen).toEqual(['SIGTERM', 'SIGINT']);
    });
});

describe('launchWorkflow — the signal handler outlives cleanup (0365 R5)', () => {
    it('keeps the handler installed through cleanup and still frees the lock when a signal lands mid-cleanup', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) return { exitCode: 1 };
                return defaultReply(call);
            },
            fireDuring: 'ledger',
            fireSignal: 'SIGTERM',
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            // The signal arrived while `kk ledger sync` ran: the handler must still be the subscriber,
            // so it never takes the default disposition and cleanup runs to completion.
            expect(stub.handlerLive).toEqual([true]);
            expect(stub.events).toEqual(['subscribe', 'recycle', 'ledger', 'unsubscribe', 'release']);
            expect(stub.releases).toHaveLength(1);
            expect(receipt.status).toBe('failed');
            expect(receipt.exitCode).toBe(1);
            expect(readReceipt(space.receiptPath).status).toBe('failed');
            expect(readReceipt(space.receiptPath).finishedAt).toBe('2026-11-13T20:00:00.000Z');
        } finally {
            stub.restore();
        }
    });

    it('releases the handler first-thing when the preflight refuses, so no listener outlives the launch', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.join(' ').includes('agent run')) return { exitCode: 1, stderr: 'dead' };
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('refused');
            expect(stub.events).toEqual(['release']);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });
});

describe('launchWorkflow — cleanup is unkillable (0365 R5)', () => {
    it('frees the lock even when store release and ledger sync both throw', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) return { exitCode: 1 };
                return defaultReply(call);
            },
            recycleThrows: true,
            ledgerThrows: true,
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('failed');
            expect(receipt.reason).toContain('store release exploded');
            expect(receipt.reason).toContain('ledger sync exploded');
            expect(stub.releases).toHaveLength(1);
            expect(readReceipt(space.receiptPath).status).toBe('failed');
        } finally {
            stub.restore();
        }
    });

    it('records a cleanup step that throws a non-Error value', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) return { exitCode: 1 };
                return defaultReply(call);
            },
            ledgerThrows: 'string',
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.reason).toContain('ledger sync exploded');
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('surfaces an unwritable running receipt and still frees the lock without spawning a child', async () => {
        const space = scratch();
        const base = createNodeFileSystem();
        const fs: FileSystem = {
            exists: (path) => base.exists(path),
            readFile: (path) => base.readFile(path),
            writeFile: (path, content) => {
                if (path === space.receiptPath) throw new Error('EROFS: read-only receipt');
                return base.writeFile(path, content);
            },
            appendFile: (path, content) => base.appendFile(path, content),
            ensureDir: (path) => base.ensureDir(path),
            readDir: (path) => base.readDir(path),
            deleteFile: (path) => base.deleteFile(path),
            rename: (from, to) => base.rename(from, to),
            copy: (from, to) => base.copy(from, to),
            stat: (path) => base.stat(path),
            createWriteStream: (path) => base.createWriteStream(path),
            realPath: (path) => base.realPath?.(path) ?? path,
            resolve: (...parts) => base.resolve(...parts),
            getProjectRoot: () => base.getProjectRoot(),
        };
        const stub = harness({ fs });
        try {
            await expect(launchWorkflow({ ...baseOptions(space), deps: stub.deps })).rejects.toThrow(
                'EROFS: read-only receipt',
            );
            expect(stub.workflowRuns()).toHaveLength(0);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });
});

describe('launchWorkflow — dry run and no-content (0365 R9, R5)', () => {
    it('plans the launch without a lock, without a write, and without a child', async () => {
        const space = scratch();
        const stub = harness();
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), dryRun: true, deps: stub.deps });

            expect(receipt.exitCode).toBe(0);
            expect(receipt.dryRun?.argv.slice(0, 3)).toEqual(['--no-logo', 'workflow', 'run']);
            expect(receipt.dryRun?.vars.run_date).toBe('20260101');
            expect(stub.locks).toEqual([]);
            expect(stub.calls.some((call) => call.args.includes('workflow') && call.args.includes('run'))).toBe(false);
            expect(() => readFileSync(space.receiptPath, 'utf8')).toThrow();
        } finally {
            stub.restore();
        }
    });

    it('refuses a dry run with exit 5 and names the dead executor', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.join(' ').includes('agent run')) return { exitCode: 1, stderr: 'dead' };
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), dryRun: true, deps: stub.deps });

            expect(receipt.exitCode).toBe(5);
            expect(receipt.reason).toContain("executor probe failed for 'scribe'");
            expect(receipt.dryRun).toBeUndefined();
            expect(stub.locks).toEqual([]);
            expect(() => readFileSync(space.receiptPath, 'utf8')).toThrow();
        } finally {
            stub.restore();
        }
    });

    it('records no-content as a successful launch and returns any reservation to the pool (0393 R2)', async () => {
        // A late refusal (floor/duration gate) writes no-content AFTER store-select reserved the
        // pool; nothing was sent, so the reservation must be released or it locks those items out
        // of every later pool. An early empty pool reserved nothing and the release is a no-op.
        const space = scratch();
        writeFileSync(
            join(space.workDir, 'run-report.summary.txt'),
            'no-content: the script gate refused the episode duration\n',
        );
        const stub = harness();
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('no-content');
            expect(receipt.exitCode).toBe(0);
            expect(stub.recycled).toEqual([receipt.runId]);
        } finally {
            stub.restore();
        }
    });
});

describe('launchWorkflow — a green generate owns nothing it cannot settle', () => {
    it('recycles the selections of a done run that froze no bundle', async () => {
        const space = scratch();
        const stub = harness();
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: stub.deps });

            expect(receipt.status).toBe('done');
            expect(receipt.exitCode).toBe(0);
            expect(stub.recycled).toEqual([receipt.runId]);
            expect(stub.ledgers).toHaveLength(1);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });
});

describe('launchWorkflow — publish owns no store rows (0365 R5, design §3.2)', () => {
    it('never recycles selections a kk-publish send may own, but still frees the lock and syncs the ledger', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.includes('workflow') && call.args.includes('run')) return { exitCode: 1 };
                return defaultReply(call);
            },
        });
        try {
            const receipt = await launchWorkflow({
                ...baseOptions(space),
                type: 'news',
                workflow: 'kk-publish',
                window: 'cn-peak',
                identityVar: null,
                vars: { run_date: '20260101', window: 'cn-peak' },
                receiptPath: join(space.workDir, '4-publish', 'schedule-receipt.cn-peak.json'),
                deps: stub.deps,
            });

            expect(receipt.status).toBe('failed');
            expect(receipt.window).toBe('cn-peak');
            expect(stub.recycled).toEqual([]);
            expect(stub.ledgers).toHaveLength(1);
            expect(stub.releases).toHaveLength(1);
            expect(readReceipt(join(space.workDir, '4-publish', 'schedule-receipt.cn-peak.json')).window).toBe(
                'cn-peak',
            );
        } finally {
            stub.restore();
        }
    });
});

/** The Board capture binding (0391): the happy capture outcome a bound attempt produces. */
function okCapture(record = true): CaptureOutcome {
    return {
        revoked: false,
        captured: record,
        record: record
            ? {
                  schemaVersion: 1,
                  projectPath: '/proj',
                  workflow: 'kk-news-generate',
                  runId: 'run-1',
                  workspacePath: '/proj/.works/kk-news-generate/20260101',
                  stamp: '20260101',
                  capturedAt: '2026-11-13T20:00:00.000Z',
                  settings: {},
              }
            : null,
        diagnostics: [],
    };
}

/** A publish-verb scratch: `kk-publish` owns no run workspace and is never captured (R15 posture). */
function publishScratch() {
    const root = mkdtempSync(join(tmpdir(), 'kk-launch-pub-'));
    const workDir = join(root, 'works', 'kk-publish', 'manual');
    const workflowPath = join(root, 'workflows', 'kk-publish.yaml');
    mkdirSync(workDir, { recursive: true });
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, 'name: kk-publish\n');
    return { root, workDir, workflowPath, receiptPath: join(workDir, 'schedule-receipt.json') };
}

describe('launchWorkflow — board capture binding (0391)', () => {
    it('binds the attempt under the lock, before the running receipt and the child', async () => {
        const space = scratch();
        const stub = harness();
        const inputs: RunCaptureInput[] = [];
        let childRunsAtCapture = -1;
        const capture = async (input: RunCaptureInput): Promise<CaptureOutcome> => {
            inputs.push(input);
            childRunsAtCapture = stub.workflowRuns().length;
            return okCapture();
        };
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: { ...stub.deps, capture } });
            expect(receipt.exitCode).toBe(0);
            expect(inputs).toHaveLength(1);
            expect(inputs[0]).toMatchObject({
                workflow: 'kk-news-generate',
                runId: receipt.runId,
                stamp: '20260101',
                workDir: space.workDir,
            });
            // The binding happened while the child had not yet spawned (lock -> capture -> receipt -> child).
            expect(childRunsAtCapture).toBe(0);
            expect(stub.workflowRuns()).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('snapshots only the workflow allowlist from the effective launch vars', async () => {
        const space = scratch();
        const stub = harness();
        const inputs: RunCaptureInput[] = [];
        const capture = async (input: RunCaptureInput): Promise<CaptureOutcome> => {
            inputs.push(input);
            return okCapture();
        };
        try {
            await launchWorkflow({
                ...baseOptions(space),
                vars: { skip_review: 'true', language: 'zh', transcode_mp3: 'maybe', bogus: 'nope' },
                deps: { ...stub.deps, capture },
            });
            expect(inputs).toHaveLength(1);
            // `work_dir`/`run_date`/`run_id`/`bogus` are never snapshot-able; an invalid value
            // (`transcode_mp3: 'maybe'`) is skipped, not fatal.
            expect(inputs[0]?.settings).toEqual({ skip_review: 'true', language: 'zh' });
        } finally {
            stub.restore();
        }
    });

    it('stays effect-free on a dry run', async () => {
        const space = scratch();
        const stub = harness();
        const capture = async (): Promise<CaptureOutcome> => {
            throw new Error('capture must not run on a dry run');
        };
        try {
            const receipt = await launchWorkflow({
                ...baseOptions(space),
                dryRun: true,
                deps: { ...stub.deps, capture },
            });
            expect(receipt.dryRun).toBeDefined();
            expect(existsSync(space.receiptPath)).toBe(false);
            expect(stub.workflowRuns()).toHaveLength(0);
        } finally {
            stub.restore();
        }
    });

    it('stays effect-free on a preflight refusal', async () => {
        const space = scratch();
        const stub = harness({
            reply: (call) => {
                if (call.args.join(' ').includes('agent run')) return { exitCode: 1, stderr: 'quota exhausted' };
                return defaultReply(call);
            },
        });
        const capture = async (): Promise<CaptureOutcome> => {
            throw new Error('capture must not run behind a refused preflight');
        };
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: { ...stub.deps, capture } });
            expect(receipt.exitCode).toBe(5);
            expect(receipt.status).toBe('refused');
            expect(existsSync(space.receiptPath)).toBe(true); // the refusal receipt itself, nothing else
            expect(stub.workflowRuns()).toHaveLength(0);
        } finally {
            stub.restore();
        }
    });

    it('refuses the launch before the child when capture refuses', async () => {
        const space = scratch();
        const stub = harness();
        const capture = async (): Promise<CaptureOutcome> => {
            throw new Error('workspace marker refuses revocation');
        };
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: { ...stub.deps, capture } });
            expect(receipt.exitCode).toBe(5);
            expect(receipt.status).toBe('refused');
            expect(receipt.reason).toContain('board capture refused');
            expect(receipt.reason).toContain('refuses revocation');
            expect(readReceipt(space.receiptPath).status).toBe('refused');
            expect(stub.workflowRuns()).toHaveLength(0);
            expect(stub.releases).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('skips the binding with a receipt note for an unsafe capture identity, still launching', async () => {
        const space = scratch();
        const stub = harness();
        const capture = async (): Promise<CaptureOutcome> => {
            throw new Error('an unsafe identity must skip, not call the seam');
        };
        try {
            const receipt = await launchWorkflow({
                ...baseOptions(space),
                runId: '../evil',
                deps: { ...stub.deps, capture },
            });
            expect(receipt.exitCode).toBe(0);
            expect(receipt.reason).toContain('board capture skipped');
            expect(receipt.reason).toContain('outside the capture alphabet');
            expect(stub.workflowRuns()).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('never captures a publish launch', async () => {
        const space = publishScratch();
        const stub = harness();
        const capture = async (): Promise<CaptureOutcome> => {
            throw new Error('kk-publish is not a Board workflow and must never be captured');
        };
        try {
            const receipt = await launchWorkflow({
                type: 'publish',
                workflow: 'kk-publish',
                workflowPath: space.workflowPath,
                run: 'manual',
                workDir: space.workDir,
                worksDir: join(space.root, 'works'),
                harnessRoot: space.root,
                allowDirty: true,
                identityVar: null,
                deps: { ...stub.deps, capture },
            });
            expect(receipt.exitCode).toBe(0);
            expect(stub.workflowRuns()).toHaveLength(1);
        } finally {
            stub.restore();
        }
    });

    it('rides capture diagnostics and the uncaptured note on the terminal receipt', async () => {
        const space = scratch();
        const stub = harness();
        const capture = async (): Promise<CaptureOutcome> => ({
            revoked: true,
            captured: false,
            record: null,
            diagnostics: [{ code: 'board.capture.record-write-failed', message: 'the record write failed' }],
        });
        try {
            const receipt = await launchWorkflow({ ...baseOptions(space), deps: { ...stub.deps, capture } });
            expect(receipt.exitCode).toBe(0);
            expect(receipt.reason).toContain('board capture: the record write failed');
            expect(receipt.reason).toContain('the Board serves it uncaptured');
        } finally {
            stub.restore();
        }
    });
});
