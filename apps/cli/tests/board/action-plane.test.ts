/**
 * G83/0442 — the guarded action plane (feature R10/R11, AC2/AC3).
 *
 * Failure list written before the code — every one of these must launch NOTHING and write an audit
 * line:
 * 1. an unknown kind is 404 and never resolves an argv;
 * 2. a foreign or absent Origin is 403 (a cross-site simple POST cannot reach the plane);
 * 3. a non-loopback Host is 403;
 * 4. a missing `X-KK-Action: 1` header is 403;
 * 5. invalid params are 400 and never reach a spawn;
 * 6. a preview token is single-use: replaying it is 409 and launches nothing;
 * 7. an expired token is 409 (injected clock);
 * 8. a live kind without the typed confirmation is 400 — and the token survives, so the operator
 *    can confirm with the same preview;
 * 9. a held single-flight lock is 409;
 * 10. the disabled plane is 403 before any validation;
 * 11. the launch line is audited BEFORE the child exists, and the exit line carries the run id;
 * 12. the argv comes from `resolveArgv`, so a preview's argv and the launched argv are identical.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DailyActionLine } from '@gobing-ai/kk-board/contracts';
import { createNodeFileSystem, type NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    ACTION_TOKEN_TTL_MS,
    type ActionChild,
    type ActionInput,
    actionLogPath,
    actionsEnabledFromConfig,
    appendActionLog,
    createActionPlane,
    defaultActionPlane,
    parseActionLog,
    runIdOf,
    scopeOf,
    spawnArgv,
} from '../../src/board/action-plane';

const ORIGIN = 'http://127.0.0.1:4340';

/** A deterministic clock and token source, plus a recorded spawn/audit trail. */
function harness(overrides: Partial<Parameters<typeof createActionPlane>[0]> = {}): {
    handle: (input: ActionInput) => Promise<{ status: number; body: Record<string, unknown> }>;
    audit: DailyActionLine[];
    spawned: string[][];
    advance: (ms: number) => void;
    setLockHeld: (held: boolean) => void;
} {
    let now = 1_700_000_000_000;
    let counter = 0;
    let lockHeld = false;
    const audit: DailyActionLine[] = [];
    const spawned: string[][] = [];
    const plane = createActionPlane({
        enabled: () => true,
        now: () => now,
        randomHex: () => `token-${++counter}`,
        boardOrigin: ORIGIN,
        acquireLock: async () => (lockHeld ? null : { release: async () => undefined }),
        audit: async (line) => {
            audit.push(line);
        },
        preview: async (argv) => `preview of ${argv.join(' ')}`,
        spawn: (argv): ActionChild => {
            spawned.push(argv);
            const stdout = JSON.stringify({ runId: 'kk-publish-20261125-9' });
            return { exit: Promise.resolve(0), stdout: () => stdout };
        },
        ...overrides,
    });
    return {
        handle: plane.handle,
        audit,
        spawned,
        advance: (ms) => {
            now += ms;
        },
        setLockHeld: (held) => {
            lockHeld = held;
        },
    };
}

/** A well-formed POST body for one kind. */
function body(params: Record<string, string>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { params, ...extra };
}

/** A request with every required guard satisfied. */
function request(kind: string, payload: Record<string, unknown>, overrides: Partial<ActionInput> = {}): ActionInput {
    return {
        kind,
        origin: ORIGIN,
        host: '127.0.0.1:4340',
        actionHeader: '1',
        body: payload,
        ...overrides,
    };
}

const WINDOW_PARAMS = { day: '20261125', window: 'after-generate' };

describe('the preview → execute handshake (AC2, R1/R2/R3/R6)', () => {
    it('previews an argv and its dry run, then launches that exact argv once', async () => {
        const h = harness();
        const preview = await h.handle(request('publish-retry', body({ ...WINDOW_PARAMS, channels: 'x-pub' })));
        expect(preview.status).toBe(200);
        expect(preview.body.live).toBe(true);
        expect(preview.body.dryRun).toContain('preview of');
        const argv = preview.body.argv as string[];
        expect(argv).toEqual([
            'kk',
            'news',
            'publish',
            '--run-date',
            '20261125',
            '--window',
            'after-generate',
            '--retry',
            '--channels',
            'x-pub',
        ]);
        const token = preview.body.token as string;
        expect(h.spawned).toEqual([]);

        const execute = await h.handle(
            request(
                'publish-retry',
                body({ ...WINDOW_PARAMS, channels: 'x-pub' }, { token, typedConfirm: '20261125' }),
            ),
        );
        expect(execute.status).toBe(202);
        expect(h.spawned).toEqual([argv]);
        // Preview, then the launch line written BEFORE the child, then the exit line with its run id.
        // The exit line lands from the child's own promise, so give the microtask queue one turn.
        await Promise.resolve();
        await Promise.resolve();
        expect(h.audit.map((line) => line.result)).toEqual(['preview', 'launched', 'exited']);
        expect(h.audit[1]?.runId).toBeNull();
        expect(h.audit[2]?.runId).toBe('kk-publish-20261125-9');
        expect(h.audit[2]?.exit).toBe(0);
        expect(h.audit.every((line) => line.tokenHash !== null)).toBe(true);
    });

    it('refuses a replayed token and launches nothing', async () => {
        const h = harness();
        const preview = await h.handle(request('cancel-run', body({ runId: 'run-1' })));
        const token = preview.body.token as string;
        expect((await h.handle(request('cancel-run', body({ runId: 'run-1' }, { token })))).status).toBe(202);
        const replay = await h.handle(request('cancel-run', body({ runId: 'run-1' }, { token })));
        expect(replay.status).toBe(409);
        expect(replay.body.code).toBe('actions.token.invalid');
        expect(h.spawned).toHaveLength(1);
        expect(h.audit.at(-1)?.refusal).toBe('actions.token.invalid');
    });

    it('refuses an expired token', async () => {
        const h = harness();
        const preview = await h.handle(request('cancel-run', body({ runId: 'run-1' })));
        const token = preview.body.token as string;
        h.advance(ACTION_TOKEN_TTL_MS + 1);
        expect((await h.handle(request('cancel-run', body({ runId: 'run-1' }, { token })))).status).toBe(409);
        expect(h.spawned).toEqual([]);
    });

    it('refuses a token bound to a different argv', async () => {
        const h = harness();
        const preview = await h.handle(request('cancel-run', body({ runId: 'run-1' })));
        const token = preview.body.token as string;
        const swapped = await h.handle(request('cancel-run', body({ runId: 'run-2' }, { token })));
        expect(swapped.status).toBe(409);
        expect(h.spawned).toEqual([]);
    });

    it('refuses a live kind without the typed confirmation and keeps the token usable', async () => {
        const h = harness();
        const preview = await h.handle(request('publish-window', body(WINDOW_PARAMS)));
        const token = preview.body.token as string;
        const refused = await h.handle(request('publish-window', body(WINDOW_PARAMS, { token, typedConfirm: 'nope' })));
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('actions.confirm.missing');
        expect(h.spawned).toEqual([]);
        const confirmed = await h.handle(
            request('publish-window', body(WINDOW_PARAMS, { token, typedConfirm: '20261125' })),
        );
        expect(confirmed.status).toBe(202);
        expect(h.spawned).toHaveLength(1);
    });

    it('accepts a non-live kind without a typed confirmation', async () => {
        const h = harness();
        const preview = await h.handle(
            request('generate-from-node', body({ node: 'voice', runId: 'kk-news-generate-20261125-1' })),
        );
        expect(preview.body.live).toBe(false);
        const execute = await h.handle(
            request(
                'generate-from-node',
                body({ node: 'voice', runId: 'kk-news-generate-20261125-1' }, { token: preview.body.token }),
            ),
        );
        expect(execute.status).toBe(202);
    });

    it('refuses when the single-flight lock is held', async () => {
        const h = harness();
        const preview = await h.handle(request('cancel-run', body({ runId: 'run-1' })));
        h.setLockHeld(true);
        const refused = await h.handle(request('cancel-run', body({ runId: 'run-1' }, { token: preview.body.token })));
        expect(refused.status).toBe(409);
        expect(refused.body.code).toBe('actions.lock.held');
        expect(h.spawned).toEqual([]);
    });
});

describe('the refusal matrix (AC3, R5)', () => {
    it('refuses everything before the switch is on', async () => {
        const h = harness({ enabled: () => false });
        const answer = await h.handle(request('cancel-run', body({ runId: 'run-1' })));
        expect(answer.status).toBe(403);
        expect(answer.body.code).toBe('actions.disabled');
        expect(h.audit.at(-1)?.refusal).toBe('actions.disabled');
    });

    it('refuses an unknown kind as 404', async () => {
        const h = harness();
        const answer = await h.handle(request('edit-artifact', body({ day: '20261125' })));
        expect(answer.status).toBe(404);
        expect(answer.body.code).toBe('actions.kind.unknown');
    });

    it('refuses a foreign or absent Origin', async () => {
        const h = harness();
        for (const origin of ['http://evil.example', null]) {
            const answer = await h.handle(request('cancel-run', body({ runId: 'run-1' }), { origin }));
            expect(answer.status).toBe(403);
            expect(answer.body.code).toBe('actions.origin.refused');
        }
        expect(h.audit.every((line) => line.refusal === 'actions.origin.refused')).toBe(true);
    });

    it('refuses a non-loopback Host and a missing action header', async () => {
        const h = harness();
        const host = await h.handle(request('cancel-run', body({ runId: 'run-1' }), { host: 'kk.example' }));
        expect(host.body.code).toBe('actions.host.refused');
        const header = await h.handle(request('cancel-run', body({ runId: 'run-1' }), { actionHeader: null }));
        expect(header.body.code).toBe('actions.header.missing');
        expect(h.spawned).toEqual([]);
    });

    it('refuses invalid params without resolving an argv', async () => {
        const h = harness();
        for (const payload of [
            { params: { day: '2026-11-25', window: 'cn-peak' } },
            { params: { day: '20261125', window: 'midnight' } },
            { params: { day: '20261125', window: 'cn-peak', channels: 'a b' } },
            { params: { runId: '../../etc/passwd' } },
            { params: 'not-an-object' },
            { nope: true },
        ]) {
            const answer = await h.handle(request('cancel-run', payload as Record<string, unknown>));
            expect(answer.status).toBe(400);
            expect(answer.body.code).toBe('actions.params.invalid');
        }
        expect(h.spawned).toEqual([]);
    });
});

describe('the recorded decision (AC1, feature R9)', () => {
    // The decision must exist BEFORE the write path ships, so it is asserted, not merely referenced:
    // the ADR amendment carries its Accepted status and the design names the single write route.
    const REPO = join(import.meta.dir, '../../../..');

    it('carries the ADR-035 amendment as Accepted, naming the shipped slices', () => {
        const adr = readFileSync(join(REPO, 'docs/00_ADR.md'), 'utf-8');
        expect(adr).toContain('Amendment — 2026-11-25 (G83: day-centric ops console and a guarded action endpoint)');
        expect(adr).toContain('**Status:** Accepted · **Work:** G83');
        expect(adr).toContain('guarded action plane in 0442');
        // The amendment still states the boundary: Spur keeps run authority, only verbs are launched.
        expect(adr).toContain('Spur keeps run authority');
    });

    it('documents the route, the switch and the closed refusal vocabulary', () => {
        const design = readFileSync(join(REPO, 'docs/04_DESIGN.md'), 'utf-8');
        expect(design).toContain('POST /api/actions/<kind>');
        expect(design).toContain('board.actions.enabled');
        for (const code of [
            'actions.disabled',
            'actions.kind.unknown',
            'actions.origin.refused',
            'actions.host.refused',
            'actions.header.missing',
            'actions.params.invalid',
            'actions.token.invalid',
            'actions.confirm.missing',
            'actions.lock.held',
        ]) {
            expect(`${code}: ${design.includes(code)}`).toBe(`${code}: true`);
        }
    });
});

describe('the production wiring (R5/R6)', () => {
    /** Point the CLI config at a temp file with the given YAML body. */
    async function withConfig<T>(yaml: string, fn: () => Promise<T>): Promise<T> {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-action-config-')));
        const path = join(dir, 'config.yaml');
        writeFileSync(path, yaml);
        const before = process.env.KK_CONFIG;
        process.env.KK_CONFIG = path;
        try {
            return await fn();
        } finally {
            if (before === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = before;
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('reads the switch from config, and reads absent or malformed as off', async () => {
        const fs = createNodeFileSystem();
        await withConfig('board:\n  actions:\n    enabled: true\n', async () => {
            expect(await actionsEnabledFromConfig(fs)).toBe(true);
        });
        await withConfig('board: {}\n', async () => {
            expect(await actionsEnabledFromConfig(fs)).toBe(false);
        });
        await withConfig('board: [not an object]\n', async () => {
            expect(await actionsEnabledFromConfig(fs)).toBe(false);
        });
    });

    it('builds a plane from the config that refuses everything offline defaults', async () => {
        const fs = createNodeFileSystem();
        await withConfig('board:\n  actions:\n    enabled: false\n', async () => {
            const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-action-project-')));
            const plane = await defaultActionPlane({ projectPath: dir, fs, boardOrigin: ORIGIN });
            const answer = await plane.handle(request('cancel-run', body({ runId: 'run-1' })));
            expect(answer.status).toBe(403);
            expect(answer.body.code).toBe('actions.disabled');
            rmSync(dir, { recursive: true, force: true });
        });
    });

    it('runs a preview through the injected executor and takes the injected lock', async () => {
        const fs = createNodeFileSystem();
        const runs: string[][] = [];
        const locks: { acquire: string[]; release: string[] } = { acquire: [], release: [] };
        const executor = {
            run: async (options: { command: string; args?: string[] }) => {
                runs.push([options.command, ...(options.args ?? [])]);
                return {
                    command: options.command,
                    args: options.args ?? [],
                    exitCode: 0,
                    stdout: 'dry run: 3 targets would send',
                    stderr: '',
                    durationMs: 1,
                };
            },
        } as unknown as NodeProcessExecutor;
        const store = {
            locks: {
                acquire: async (name: string) => {
                    locks.acquire.push(name);
                    return true;
                },
                release: async (name: string) => {
                    locks.release.push(name);
                    return true;
                },
            },
        };
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-action-plane-dir-')));
        await withConfig('board:\n  actions:\n    enabled: true\n', async () => {
            const plane = await defaultActionPlane({ projectPath: dir, fs, boardOrigin: ORIGIN }, { executor, store });
            const preview = await plane.handle(request('publish-retry', body(WINDOW_PARAMS)));
            expect(preview.status).toBe(200);
            expect(String(preview.body.dryRun)).toContain('3 targets would send');
            expect(runs[0]?.at(-1)).toBe('--dry-run');
            // The preview audited one line into the day's own file.
            expect(
                parseActionLog(await fs.readFile(join(dir, '.works/kk-news-generate/20261125/actions.jsonl'))),
            ).toHaveLength(1);

            const execute = await plane.handle(
                request(
                    'publish-retry',
                    body(WINDOW_PARAMS, { token: preview.body.token as string, typedConfirm: '20261125' }),
                ),
            );
            expect(execute.status).toBe(202);
            expect(locks.acquire).toEqual(['ops-console:20261125']);
            // The release rides the child's exit and the exit audit's fs append: bounded wait.
            for (let attempt = 0; attempt < 50 && locks.release.length === 0; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(locks.release).toEqual(['ops-console:20261125']);
        });
        rmSync(dir, { recursive: true, force: true });
    });

    it('spawns one argv array and reports its exit code and captured output', async () => {
        const calls: { command: string; args?: string[] }[] = [];
        const executor = {
            run: async (options: { command: string; args?: string[] }) => {
                calls.push(options);
                return {
                    command: options.command,
                    args: options.args ?? [],
                    exitCode: 3,
                    stdout: '{"runId":"r-1"}',
                    stderr: '',
                    durationMs: 1,
                };
            },
        } as unknown as Parameters<typeof spawnArgv>[0];
        const child = spawnArgv(executor, ['kk', 'news', 'publish', '--retry'], '/tmp');
        expect(calls[0]?.command).toBe('kk');
        expect(calls[0]?.args).toEqual(['news', 'publish', '--retry']);
        expect(await child.exit).toBe(3);
        expect(runIdOf(child.stdout())).toBe('r-1');
    });

    it('refuses an empty argv rather than spawning anything', () => {
        const executor = { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) } as unknown as Parameters<
            typeof spawnArgv
        >[0];
        expect(() => spawnArgv(executor, [], '/tmp')).toThrow(/cannot be empty/);
    });
});

describe('plane helpers', () => {
    it('scopes a day-bound kind to its day and a run-scoped kind to its run', () => {
        expect(scopeOf('publish-retry', WINDOW_PARAMS)).toEqual({ day: '20261125', lock: 'ops-console:20261125' });
        expect(scopeOf('generate-from-node', { node: 'voice', runId: 'kk-news-generate-20261125-1' })).toEqual({
            day: '20261125',
            lock: 'ops-console:20261125',
        });
        expect(scopeOf('cancel-run', { runId: 'other-run' })).toEqual({ day: null, lock: 'ops-console:run-other-run' });
    });

    it('reads a launched run id out of JSON stdout, and tolerates a non-JSON tail', () => {
        expect(runIdOf('log line\n{"runId":"run-9"}\n')).toBe('run-9');
        expect(runIdOf('not json at all')).toBeNull();
        expect(runIdOf('')).toBeNull();
        // A truncated JSON object is not the run id, and the scan keeps looking upward.
        expect(runIdOf('{"runId":"run-8"}\n{"runId":')).toBe('run-8');
        expect(runIdOf('{"runId":')).toBeNull();
    });

    it('appends and reads back the audit file it names', async () => {
        const fs = createNodeFileSystem();
        const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'kk-actions-'))), '20261125');
        await fs.ensureDir(dir);
        const path = actionLogPath(dir);
        expect(path.endsWith('actions.jsonl')).toBe(true);
        await appendActionLog(fs, path, {
            ts: '2026-11-25T12:00:00Z',
            kind: 'cancel-run',
            argv: ['spur', 'workflow', 'cancel', 'run-1'],
            origin: ORIGIN,
            tokenHash: 'abc',
            runId: 'run-1',
            exit: 0,
            result: 'exited',
        });
        expect(parseActionLog(await fs.readFile(path))).toHaveLength(1);
        expect(parseActionLog(await fs.readFile(path))[0]?.kind).toBe('cancel-run');
    });

    it('bounds and skips a torn audit line', () => {
        const lines = Array.from({ length: 60 }, (_, index) => JSON.stringify({ ts: `t${index}`, kind: 'cancel-run' }));
        const parsed = parseActionLog(`${lines.join('\n')}\n{"ts":"torn"`, 50);
        expect(parsed).toHaveLength(50);
        expect(parsed[0]?.ts).toBe('t10');
        expect(parseActionLog(undefined)).toEqual([]);
    });
});
