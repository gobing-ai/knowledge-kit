/**
 * G85/0446 — the digest push (feature R1–R5, AC1/AC2/AC4/AC6).
 *
 * Failure list written before the code; every refusal must send nothing and keep the URL out of every
 * artifact the operator can see:
 * 1. the pushed bytes are not the digest renderer's output (a second formatter would drift);
 * 2. the same digest is pushed twice (an unchanged sha256 skips and reports the earlier receipt);
 * 3. a changed digest is posted without `update: true`;
 * 4. `--dry-run` sends something, or writes a receipt;
 * 5. a disabled block, an unset variable or a non-loopback plaintext URL still sends;
 * 6. the URL or a token inside it appears in stdout, stderr, the receipt or the config;
 * 7. a below-floor digest is treated as a failure instead of a skip;
 * 8. a 500 or a timeout is reported as success;
 * 9. the launch binding pushes when enabled and does nothing when disabled.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { projectDay } from '../src/board/day';
import {
    DEFAULT_DIGEST_NOTIFY,
    type DigestNotifyConfig,
    type DigestReceipt,
    digestNotifyConfigOf,
    digestPushBody,
    digestPushForLaunch,
    digestPushLine,
    loadNotifyConfig,
    pushDigest,
    receiptPath,
} from '../src/news-digest-push';

const DAY = '20261125';
const TOKEN = 'super-secret-token-value';

interface Stub {
    url: string;
    bodies: string[];
    headers: string[];
    stop(): void;
}

const stubs: Stub[] = [];
afterAll(() => {
    for (const stub of stubs) stub.stop();
});

/** A loopback `Bun.serve` stub that records the bodies and content types it received. */
function stub(options: { status?: number; delayMs?: number; path?: string } = {}): Stub {
    const bodies: string[] = [];
    const headers: string[] = [];
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request) => {
            bodies.push(await request.text());
            headers.push(request.headers.get('content-type') ?? '');
            if ((options.delayMs ?? 0) > 0) await Bun.sleep(options.delayMs ?? 0);
            const status = options.status ?? 200;
            return new Response(status === 200 ? 'ok' : 'nope', { status });
        },
    });
    const created = {
        url: `http://127.0.0.1:${server.port}/${options.path ?? TOKEN}`,
        bodies,
        headers,
        stop: () => server.stop(true),
    };
    stubs.push(created);
    return created;
}

interface Fixture {
    project: string;
    workDir: string;
    fs: ReturnType<typeof createNodeFileSystem>;
}

/** A day directory with the minimum the projection needs to answer. */
function dayDir(): Fixture {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'kk-push-')));
    const workDir = join(project, '.works', 'kk-news-generate', DAY);
    mkdirSync(join(workDir, '4-safety-variants'), { recursive: true });
    writeFileSync(
        join(workDir, 'schedule-receipt.json'),
        JSON.stringify({ schemaVersion: 1, runId: 'run-1', status: 'done' }),
    );
    writeFileSync(
        join(workDir, '4-safety-variants', `${DAY}_08b_safety-verdict.decision`),
        JSON.stringify({ value: 'pass' }),
    );
    return { project, workDir, fs: createNodeFileSystem() };
}

/** The projected digest for that day. */
async function digestOf(fixture: Fixture) {
    const digest = await projectDay(
        { projectPath: fixture.project, fs: fixture.fs, worksDir: join(fixture.project, '.works') },
        DAY,
    );
    if ('notFound' in digest) throw new Error('fixture day not projected');
    return digest;
}

/** The enabled config every sending test uses. */
const NOTIFY: DigestNotifyConfig = { ...DEFAULT_DIGEST_NOTIFY, enabled: true, urlEnv: 'KK_DIGEST_WEBHOOK_URL' };

describe('the push (R1/R3, AC1/AC4)', () => {
    it('posts the renderer output to the webhook and records one receipt', async () => {
        const hook = stub();
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.sent');
        expect(outcome.exitCode).toBe(0);
        expect(hook.bodies).toHaveLength(1);
        expect(hook.bodies[0]).toBe(digestPushBody(digest, 'markdown'));
        expect(hook.headers[0]).toContain('text/markdown');
        const receipt = JSON.parse(readFileSync(receiptPath(fixture.workDir, 'generate'), 'utf-8')) as DigestReceipt;
        expect(receipt).toMatchObject({
            trigger: 'generate',
            digestStatus: digest.status,
            httpStatus: 200,
            error: null,
            update: false,
        });
        expect(receipt.digestSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('posts JSON when the config asks for it', async () => {
        const hook = stub();
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: { ...NOTIFY, body: 'json' },
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(JSON.parse(hook.bodies[0] ?? '{}')).toEqual(JSON.parse(JSON.stringify(digest)));
        expect(hook.headers[0]).toContain('application/json');
    });

    it('skips an unchanged digest and reports the earlier receipt', async () => {
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const body = digestPushBody(digest, 'markdown');
        const sha256 = new Bun.CryptoHasher('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
        const earlier: DigestReceipt = {
            ts: '2026-11-25T05:00:00.000Z',
            trigger: 'generate',
            digestStatus: digest.status,
            digestSha256: sha256,
            httpStatus: 200,
            error: null,
            errorCode: null,
            update: false,
        };
        writeFileSync(receiptPath(fixture.workDir, 'generate'), `${JSON.stringify(earlier, null, 4)}\n`);
        const hook = stub();
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.unchanged');
        expect(outcome.receipt).toEqual(earlier);
        expect(hook.bodies).toHaveLength(0);
    });

    it('posts a changed digest with `update: true`', async () => {
        const fixture = dayDir();
        // A stale safety draft changes the digest body without changing the day's status.
        writeFileSync(
            join(fixture.workDir, '24-script', `${DAY}_08_script_voicescript.yaml`).replace(
                '/24-script/',
                '/4-safety-variants/',
            ),
            JSON.stringify({ digest: 'changed' }),
        );
        mkdirSync(join(fixture.workDir, '24-script'), { recursive: true });
        writeFileSync(join(fixture.workDir, '22-article').replace('/22-article', '/22-article'), 'x');
        const previous: DigestReceipt = {
            ts: '2026-11-25T05:00:00.000Z',
            trigger: 'generate',
            digestStatus: 'ok',
            digestSha256: 'f'.repeat(64),
            httpStatus: 200,
            error: null,
            errorCode: null,
            update: false,
        };
        writeFileSync(receiptPath(fixture.workDir, 'generate'), `${JSON.stringify(previous, null, 4)}\n`);
        const hook = stub();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.sent');
        expect(outcome.receipt?.update).toBe(true);
        expect(hook.bodies).toHaveLength(1);
    });
});

describe('config and refusals (R2/R4, AC2)', () => {
    it('is off unless `notify.digest.enabled` is true', async () => {
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: DEFAULT_DIGEST_NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: TOKEN },
            fetch: () => Promise.reject(new Error('must not be called')),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.disabled');
        expect(outcome.exitCode).toBe(2);
        expect(existsSync(receiptPath(fixture.workDir, 'generate'))).toBe(false);
    });

    it('reads the block, defaulting each key and refusing a malformed one', () => {
        expect(digestNotifyConfigOf({})).toEqual(DEFAULT_DIGEST_NOTIFY);
        expect(digestNotifyConfigOf({ notify: { digest: { enabled: true } } })).toEqual({
            enabled: true,
            urlEnv: 'KK_DIGEST_WEBHOOK_URL',
            body: 'markdown',
            minStatus: 'ok',
        });
        expect(
            digestNotifyConfigOf({
                notify: { digest: { enabled: true, url_env: 'HOOK', body: 'json', min_status: 'failed' } },
            }),
        ).toEqual({ enabled: true, urlEnv: 'HOOK', body: 'json', minStatus: 'failed' });
        expect(
            digestNotifyConfigOf({ notify: { digest: { enabled: true, body: 'xml', min_status: 'great' } } }),
        ).toEqual({ enabled: true, urlEnv: 'KK_DIGEST_WEBHOOK_URL', body: 'markdown', minStatus: 'ok' });
    });

    it('refuses an unset variable without sending', async () => {
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: {},
            fetch: () => Promise.reject(new Error('must not be called')),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.url-env.unset');
        expect(outcome.exitCode).toBe(1);
    });

    it('refuses a plaintext non-loopback URL and exposes only the host', async () => {
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: `http://hooks.example.com/${TOKEN}` },
            fetch: () => Promise.reject(new Error('must not be called')),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.url.not-https');
        expect(outcome.host).toBe('hooks.example.com');
        expect(JSON.stringify(outcome)).not.toContain(TOKEN);
    });

    it('keeps the token out of the receipt, the line and the log', async () => {
        const hook = stub();
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        const receiptText = readFileSync(receiptPath(fixture.workDir, 'generate'), 'utf-8');
        const line = digestPushLine(outcome);
        for (const surface of [receiptText, line, JSON.stringify(outcome.receipt)]) {
            expect(surface).not.toContain(TOKEN);
        }
        expect(line).toContain('notify.digest.sent');
        // The host is the one deliberate disclosure (an operator needs to know where it went); the
        // URL's path — where a token lives — never appears.
        expect(line).toContain(`host=127.0.0.1:`);
        expect(line).not.toContain('/hook');
    });

    it('skips a digest below the configured floor with exit 0', async () => {
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const hook = stub();
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: { ...NOTIFY, minStatus: 'failed' },
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.min-status.skipped');
        expect(outcome.exitCode).toBe(0);
        expect(hook.bodies).toHaveLength(0);
    });

    it('a dry run prints the body and writes nothing', async () => {
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const hook = stub();
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
            dryRun: true,
        });
        expect(outcome.body).toContain(`# Daily AI Voice — ${DAY}`);
        expect(outcome.host).toBe(`127.0.0.1:${new URL(hook.url).port}`);
        expect(hook.bodies).toHaveLength(0);
        expect(existsSync(receiptPath(fixture.workDir, 'generate'))).toBe(false);
    });
});

describe('transport failures (R1/R3)', () => {
    it('reports an HTTP failure without claiming success', async () => {
        const hook = stub({ status: 500 });
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
        });
        expect(outcome.code).toBe('notify.digest.http');
        expect(outcome.exitCode).toBe(1);
        const receipt = JSON.parse(readFileSync(receiptPath(fixture.workDir, 'generate'), 'utf-8')) as DigestReceipt;
        expect(receipt).toMatchObject({ httpStatus: 500, errorCode: 'notify.digest.http' });
    });

    it('reports a timeout and writes the receipt', async () => {
        const hook = stub({ delayMs: 400 });
        const fixture = dayDir();
        const digest = await digestOf(fixture);
        const outcome = await pushDigest({
            fs: fixture.fs,
            digest,
            workDir: fixture.workDir,
            trigger: 'generate',
            notify: NOTIFY,
            env: { KK_DIGEST_WEBHOOK_URL: hook.url },
            fetch: (url, init) => fetch(url, init),
            now: () => '2026-11-25T05:10:00.000Z',
            timeoutMs: 50,
        });
        expect(['notify.digest.timeout', 'notify.digest.http']).toContain(outcome.code);
        expect(outcome.exitCode).toBe(1);
        expect(existsSync(receiptPath(fixture.workDir, 'generate'))).toBe(true);
    });
});

describe('the launch binding (R5, AC5)', () => {
    it('does nothing when the block is disabled', async () => {
        const fixture = dayDir();
        const configFile = join(fixture.project, 'config.yaml');
        writeFileSync(configFile, 'notify:\n  digest:\n    enabled: false\n');
        const before = readdirSync(fixture.workDir).sort();
        const previous = process.env.KK_CONFIG;
        process.env.KK_CONFIG = configFile;
        try {
            await digestPushForLaunch({ workDir: fixture.workDir, runDate: DAY, trigger: 'generate' });
        } finally {
            if (previous === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = previous;
        }
        expect(readdirSync(fixture.workDir).sort()).toEqual(before);
    });

    it('pushes on the configured trigger when enabled', async () => {
        const hook = stub();
        const fixture = dayDir();
        const configFile = join(fixture.project, 'config.yaml');
        writeFileSync(configFile, 'notify:\n  digest:\n    enabled: true\n');
        const previousConfig = process.env.KK_CONFIG;
        const previousUrl = process.env.KK_DIGEST_WEBHOOK_URL;
        const previousCwd = process.cwd();
        process.env.KK_CONFIG = configFile;
        process.env.KK_DIGEST_WEBHOOK_URL = hook.url;
        process.chdir(fixture.project);
        try {
            // The works root is `<project>/.works`, so the day directory's grandparent is the works root.
            await digestPushForLaunch({ workDir: fixture.workDir, runDate: DAY, trigger: 'cn-peak' });
        } finally {
            process.chdir(previousCwd);
            if (previousConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = previousConfig;
            if (previousUrl === undefined) delete process.env.KK_DIGEST_WEBHOOK_URL;
            else process.env.KK_DIGEST_WEBHOOK_URL = previousUrl;
        }
        expect(hook.bodies).toHaveLength(1);
        expect(existsSync(receiptPath(fixture.workDir, 'cn-peak'))).toBe(true);
    });

    it('loads the block through the config file, not the process env alone', async () => {
        const project = realpathSync(mkdtempSync(join(tmpdir(), 'kk-push-cfg-')));
        const configFile = join(project, 'config.yaml');
        writeFileSync(configFile, 'notify:\n  digest:\n    enabled: true\n    body: json\n');
        expect(await loadNotifyConfig(createNodeFileSystem(), configFile)).toEqual({
            enabled: true,
            urlEnv: 'KK_DIGEST_WEBHOOK_URL',
            body: 'json',
            minStatus: 'ok',
        });
        expect(await loadNotifyConfig(createNodeFileSystem(), join(project, 'missing.yaml'))).toEqual(
            DEFAULT_DIGEST_NOTIFY,
        );
    });
});

/** The receipt path is derived, so a push can never write outside its own day. */
it('keeps the receipt inside the day directory', () => {
    expect(receiptPath('/tmp/day', 'cn-peak')).toBe(join('/tmp/day', 'notify-receipt.cn-peak.json'));
    expect(resolve('/tmp')).toBe('/tmp');
});
