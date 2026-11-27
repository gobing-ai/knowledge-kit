/**
 * G84/0444 — the two edit kinds on the guarded action plane (feature R4/R6).
 *
 * Failure list written before the code, each of which must launch NOTHING:
 * 1. a body over the cap is 400 before it is hashed (`actions.params.invalid`);
 * 2. a confirmation whose body differs from the previewed one is 409 (`actions.token.invalid`) —
 *    the token binds `sha256(kind + argv + sha256(body))`;
 * 3. a confirmation whose `baseSha` no longer matches the file is 409 `actions.artifact.stale`
 *    carrying the CURRENT sha, and the child is never spawned (R6/AC6);
 * 4. a preview returns the server-computed diff of what the edit would do, and no argv dry run;
 * 5. the launch passes the body on stdin and the holder in `KK_LOCK_HOLDER`, never in argv;
 * 6. the audit lines carry the token hash, never the body.
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { DailyActionLine } from '@gobing-ai/kk-board/contracts';
import {
    type ActionChild,
    type ActionInput,
    type ArtifactSeam,
    argvHashOf,
    bodyBoundHashOf,
    createActionPlane,
} from '../../src/board/action-plane';
import { EDIT_BODY_CAP_BYTES, resolveArgv } from '../../src/board/actions';

const ORIGIN = 'http://127.0.0.1:4340';
const DAY = '20261125';
/** The seeded article's own sha: a preview must carry the sha the file really has. */
const SHA_A = createHash('sha256').update(Buffer.from('line one\nline two\n', 'utf8')).digest('hex');
const SHA_B = 'b'.repeat(64);

interface Harness {
    handle: (input: ActionInput) => Promise<{ status: number; body: Record<string, unknown> }>;
    audit: DailyActionLine[];
    spawned: { argv: string[]; env: Record<string, string>; stdin: string | null }[];
    files: Map<string, string>;
    backups: Map<string, string>;
}

/** A plane over an in-memory artifact seam. */
function harness(overrides: { locked?: boolean } = {}): Harness {
    const audit: DailyActionLine[] = [];
    const spawned: Harness['spawned'] = [];
    const files = new Map<string, string>([['article', 'line one\nline two\n']]);
    const backups = new Map<string, string>([['article', 'old one\nold two\n']]);
    let counter = 0;
    const seam: ArtifactSeam = {
        read: async (_kind, params) => ({
            path: `22-article/${params.day ?? ''}_06_article-write_body.md`,
            text: files.get(params.artifact ?? '') ?? null,
        }),
        newestBackup: async (params) => backups.get(params.artifact ?? '') ?? null,
    };
    const plane = createActionPlane({
        enabled: () => true,
        now: () => 1_700_000_000_000,
        randomHex: () => `token-${++counter}`,
        boardOrigin: ORIGIN,
        acquireLock: async () => (overrides.locked === true ? null : { release: async () => undefined }),
        audit: async (line) => {
            audit.push(line);
        },
        preview: async (argv) => `preview of ${argv.join(' ')}`,
        spawn: (argv, env, stdin): ActionChild => {
            spawned.push({ argv, env: env as Record<string, string>, stdin });
            const stdout = JSON.stringify({ runId: 'stub-1' });
            return { exit: Promise.resolve(0), stdout: () => stdout };
        },
        artifacts: seam,
        lockHolder: () => 'ops-console:holder-1',
    });
    return { handle: plane.handle, audit, spawned, files, backups };
}

/** The request shape the reader adapts from an HTTP POST. */
function request(kind: string, body: unknown): ActionInput {
    return {
        kind,
        origin: ORIGIN,
        host: '127.0.0.1:4340',
        actionHeader: '1',
        body,
    };
}

/** A preview body for one edit. */
function previewBody(artifact = 'article', baseSha = SHA_A): Record<string, unknown> {
    return { params: { day: DAY, artifact, baseSha } };
}

describe('edit-artifact (R4)', () => {
    it('previews the diff of the edit instead of a dry-run argv', async () => {
        const h = harness();
        const answer = await h.handle(request('edit-artifact', { ...previewBody(), body: 'line one\nLINE TWO\n' }));
        expect(answer.status).toBe(200);
        const dryRun = String(answer.body.dryRun ?? '');
        expect(dryRun).toContain('--- a/22-article/20261125_06_article-write_body.md');
        expect(dryRun).toContain('-line two');
        expect(dryRun).toContain('+LINE TWO');
        expect(answer.body.argv).toEqual(
            resolveArgv('edit-artifact', { day: DAY, artifact: 'article', baseSha: SHA_A }).argv,
        );
        expect(h.spawned).toHaveLength(0);
    });

    it('refuses a body over the cap before hashing it', async () => {
        const h = harness();
        const answer = await h.handle(
            request('edit-artifact', { ...previewBody(), body: 'x'.repeat(EDIT_BODY_CAP_BYTES + 1) }),
        );
        expect(answer.status).toBe(400);
        expect(answer.body.code).toBe('actions.params.invalid');
        expect(h.spawned).toHaveLength(0);
    });

    it('refuses a confirmation whose body moved since the preview', async () => {
        const h = harness();
        const preview = await h.handle(request('edit-artifact', { ...previewBody(), body: 'previewed\n' }));
        const answer = await h.handle(
            request('edit-artifact', {
                ...previewBody(),
                body: 'different\n',
                token: String(preview.body.token),
            }),
        );
        expect(answer.status).toBe(409);
        expect(answer.body.code).toBe('actions.token.invalid');
        expect(h.spawned).toHaveLength(0);
    });

    it('refuses a stale base sha as 409 with the current sha, spawning nothing', async () => {
        const h = harness();
        const preview = await h.handle(request('edit-artifact', { ...previewBody(), body: 'new\n' }));
        expect(preview.status).toBe(200);
        const answer = await h.handle(
            request('edit-artifact', {
                ...previewBody('article', SHA_B),
                body: 'new\n',
                token: String(preview.body.token),
            }),
        );
        // The token bound the previewed argv, so a different baseSha is already a token mismatch;
        // the conflict path answers when the argv still matches but the FILE moved.
        expect(answer.status).toBe(409);
        expect(h.spawned).toHaveLength(0);
    });

    it('answers the stale-artifact conflict with the current sha when only the file moved', async () => {
        const h = harness();
        const preview = await h.handle(request('edit-artifact', { ...previewBody(), body: 'new\n' }));
        // The file changes between preview and confirmation — the operator's editor, a re-render, or
        // another action. The argv is unchanged, so the token still matches.
        h.files.set('article', 'changed elsewhere\n');
        const answer = await h.handle(
            request('edit-artifact', {
                ...previewBody(),
                body: 'new\n',
                token: String(preview.body.token),
            }),
        );
        expect(answer.status).toBe(409);
        expect(answer.body.code).toBe('actions.artifact.stale');
        expect(String(answer.body.currentSha)).toMatch(/^[0-9a-f]{64}$/);
        expect(h.spawned).toHaveLength(0);
        expect(h.audit.at(-1)?.refusal).toBe('actions.artifact.stale');
    });

    it('launches with the body on stdin and the holder in the environment, never in argv', async () => {
        const h = harness();
        const preview = await h.handle(request('edit-artifact', { ...previewBody(), body: 'new body\n' }));
        const answer = await h.handle(
            request('edit-artifact', { ...previewBody(), body: 'new body\n', token: String(preview.body.token) }),
        );
        // An edit is awaited: its 200 is the write's outcome, not a launch acknowledgement.
        expect(answer.status).toBe(200);
        expect(answer.body.saved).toBe(true);
        expect(h.spawned).toHaveLength(1);
        const launch = h.spawned[0];
        expect(launch?.stdin).toBe('new body\n');
        expect(launch?.env.KK_LOCK_HOLDER).toBe('ops-console:holder-1');
        expect(launch?.argv.join(' ')).not.toContain('new body');
        // The audit records the token hash only — the body never reaches the log.
        expect(JSON.stringify(h.audit)).not.toContain('new body');
        expect(h.audit.at(-1)?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('binds the token to the body digest', () => {
        const argv = resolveArgv('edit-artifact', { day: DAY, artifact: 'article', baseSha: SHA_A }).argv;
        const one = bodyBoundHashOf('edit-artifact', argv, 'body one\n');
        const two = bodyBoundHashOf('edit-artifact', argv, 'body two\n');
        expect(one).not.toBe(two);
        expect(byte(one)).toBe(64);
        // The body-less formula stays what every other kind binds.
        expect(argvHashOf('publish-window', ['kk', 'x'])).toBe(argvHashOf('publish-window', ['kk', 'x']));
    });

    it('is a non-live kind, so no typed confirmation is required', async () => {
        const h = harness();
        const answer = await h.handle(request('edit-artifact', { ...previewBody(), body: 'x\n' }));
        expect(answer.body.live).toBe(false);
    });
});

describe('revert-artifact (R4)', () => {
    it('previews the diff against the newest backup and launches the revert argv', async () => {
        const h = harness();
        const preview = await h.handle(request('revert-artifact', { params: { day: DAY, artifact: 'article' } }));
        expect(preview.status).toBe(200);
        expect(String(preview.body.dryRun ?? '')).toContain('+old one');
        expect(preview.body.argv).toEqual(resolveArgv('revert-artifact', { day: DAY, artifact: 'article' }).argv);
        const answer = await h.handle(
            request('revert-artifact', {
                params: { day: DAY, artifact: 'article' },
                token: String(preview.body.token),
            }),
        );
        expect(answer.status).toBe(200);
        expect(h.spawned[0]?.stdin).toBeNull();
        expect(h.spawned[0]?.argv.join(' ')).toContain('--revert');
    });

    it('refuses a held lock without spawning', async () => {
        const h = harness({ locked: true });
        const preview = await h.handle(request('revert-artifact', { params: { day: DAY, artifact: 'article' } }));
        const answer = await h.handle(
            request('revert-artifact', {
                params: { day: DAY, artifact: 'article' },
                token: String(preview.body.token),
            }),
        );
        expect(answer.status).toBe(409);
        expect(answer.body.code).toBe('actions.lock.held');
        expect(h.spawned).toHaveLength(0);
    });
});

/** A hex digest's length as a cheap sanity check on the hash shape. */
function byte(hex: string): number {
    return hex.length;
}
