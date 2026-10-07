import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const FIXTURES_ROOT = join(import.meta.dir, '../fixtures/plugins');
const E2E_ARTIFACT = join(import.meta.dir, '../../../../.spur/run/e2e/E93-plugin-check.json');
const TOKEN = 'sk-live-e2e0123456789abcdef';

interface CheckJson {
    ok: boolean;
    plugins: Array<{ name: string; kind: string; status: string; profileDir?: string; detail?: string }>;
}

interface StatusJson {
    healthy: boolean;
    plugins: Array<{ name: string; kind: string; check?: string; healthy: boolean }>;
    diagnostics: Array<{ code: string; path: string; reason: string }>;
}

/** Run main with ts-utils echo/echoError captured into strings. */
async function runCaptured(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const cap = captureOutput();
    try {
        const code = await main(['node', 'test', ...args]);
        return { code, out: cap.read(), err: cap.readErr() };
    } finally {
        cap.restore();
    }
}

function rootArgs(): string[] {
    return ['--plugins-root', FIXTURES_ROOT];
}

async function checkJson(args: string[]): Promise<{ code: number; report: CheckJson; out: string; err: string }> {
    const { code, out, err } = await runCaptured(['plugin', 'check', '--json', ...rootArgs(), ...args]);
    return { code, report: JSON.parse(out) as CheckJson, out, err };
}

function rowFor(report: CheckJson, name: string): CheckJson['plugins'][number] | undefined {
    return report.plugins.find((p) => p.name === name);
}

describe('plugin check (ADR-032)', () => {
    it('reports verified, refused, error and unsupported over the fixture tree and exits nonzero (AC1)', async () => {
        const { code, report } = await checkJson([
            'e2e-verified',
            'e2e-refused',
            'e2e-broken',
            'e2e-unsupported',
            'e2e-secret',
        ]);
        expect(report.ok).toBe(false);
        expect(rowFor(report, 'e2e-verified')?.status).toBe('verified');
        expect(rowFor(report, 'e2e-verified')?.profileDir).toBe('/tmp/e2e-verified-profile');
        expect(rowFor(report, 'e2e-verified')?.detail).toBe('session live');
        expect(rowFor(report, 'e2e-refused')?.status).toBe('refused');
        expect(rowFor(report, 'e2e-refused')?.detail).toBe('login expired');
        expect(rowFor(report, 'e2e-broken')?.status).toBe('error');
        expect(rowFor(report, 'e2e-broken')?.detail).toContain('malformed probe output');
        // The broken probe's raw stdout line never leaks into the report.
        expect(JSON.stringify(report)).not.toContain('not json at all');
        expect(rowFor(report, 'e2e-unsupported')?.status).toBe('unsupported');
        expect(code).not.toBe(0);
    });

    it('a probe exceeding --timeout is an error verdict, not refused (R3)', async () => {
        const { code, report } = await checkJson(['e2e-slow', '--timeout', '400']);
        expect(rowFor(report, 'e2e-slow')?.status).toBe('error');
        expect(code).not.toBe(0);
    });

    it('writes the E2E artifact recording each fixture verdict', async () => {
        const { code, report } = await checkJson([
            'e2e-verified',
            'e2e-refused',
            'e2e-broken',
            'e2e-unsupported',
            'e2e-secret',
        ]);
        const slow = await checkJson(['e2e-slow', '--timeout', '400']);
        mkdirSync(join(E2E_ARTIFACT, '..'), { recursive: true });
        writeFileSync(
            E2E_ARTIFACT,
            `${JSON.stringify(
                {
                    feature: 'E93',
                    command: 'kk plugin check --json --plugins-root apps/cli/tests/fixtures/plugins',
                    exitCode: code,
                    plugins: [...report.plugins, ...(slow.report.plugins ?? [])],
                },
                null,
                2,
            )}\n`,
        );
        expect(report.plugins.length).toBe(5);
    });

    it('selecting only verified and unsupported fixtures exits 0 (AC2)', async () => {
        const { code, report } = await checkJson(['e2e-verified', 'e2e-unsupported']);
        expect(code).toBe(0);
        expect(report.ok).toBe(true);
    });

    it('never echoes probe stdout/stderr tokens and forwards --headed only when passed (AC3)', async () => {
        const plain = await checkJson(['e2e-secret']);
        expect(plain.out).not.toContain(TOKEN);
        expect(plain.err).not.toContain(TOKEN);
        expect(rowFor(plain.report, 'e2e-secret')?.detail).toBe('headed=false');

        const headed = await checkJson(['e2e-secret', '--headed']);
        expect(headed.out).not.toContain(TOKEN);
        expect(rowFor(headed.report, 'e2e-secret')?.detail).toBe('headed=true');
    });

    it('login propagates the probe exit code; missing check names the field (AC4)', async () => {
        const propagated = await runCaptured(['plugin', 'login', 'e2e-verified', ...rootArgs()]);
        expect(propagated.code).toBe(7);

        const noCheck = await runCaptured(['plugin', 'login', 'e2e-unsupported', ...rootArgs()]);
        expect(noCheck.code).toBe(2);
        expect(noCheck.err).toContain('check');

        const unknown = await runCaptured(['plugin', 'login', 'e2e-nope', ...rootArgs()]);
        expect(unknown.code).toBe(2);
        expect(unknown.err).toContain('unknown plugin');
    });

    it('check rejects unknown names and bad options with usage errors', async () => {
        const unknown = await runCaptured(['plugin', 'check', 'e2e-nope', '--json', ...rootArgs()]);
        expect(unknown.code).toBe(2);

        const badTimeout = await runCaptured([
            'plugin',
            'check',
            'e2e-verified',
            '--json',
            '--timeout',
            'abc',
            ...rootArgs(),
        ]);
        expect(badTimeout.code).toBe(2);

        const badKind = await runCaptured(['plugin', 'check', '--json', '--kind', 'widget', ...rootArgs()]);
        expect(badKind.code).toBe(1);
    });

    it('--kind filters probe selection', async () => {
        const { report } = await checkJson(['--kind', 'generator']);
        expect(report.plugins.map((p) => p.name)).toEqual(['e2e-unsupported']);
        expect(report.ok).toBe(true);
    });
});

describe('plugin status stays static with the check field (AC5 / R6)', () => {
    it('status --json matches the pre-change shape plus check, spawning no probe', async () => {
        const { code, out, err } = await runCaptured(['plugin', 'status', '--json', ...rootArgs()]);
        const report = JSON.parse(out) as StatusJson;
        expect(code).toBe(0);
        expect(report.healthy).toBe(true);

        const verified = report.plugins.find((p) => p.name === 'e2e-verified');
        const unsupported = report.plugins.find((p) => p.name === 'e2e-unsupported');
        expect(verified?.check).toBeDefined();
        expect(isAbsolute(verified?.check ?? '')).toBe(true);
        expect(unsupported?.check).toBeUndefined();

        // Static: no probe ever ran, so no verdict detail appears anywhere.
        expect(out).not.toContain('session live');
        expect(err).not.toContain('session live');
    });
});

describe('six browser channels declare probes (0216, AC1)', () => {
    const REAL_ROOT = join(import.meta.dir, '../../../../plugins');
    const CHANNELS = ['infoq-pub', 'juejin-pub', 'substack-pub', 'x-pub', 'xhs-pub', 'wechatmp-pub'];

    it('plugin status --json lists check for exactly the six browser publish channels, no others', async () => {
        const { code, out } = await runCaptured(['plugin', 'status', '--json', '--plugins-root', REAL_ROOT]);
        const report = JSON.parse(out) as StatusJson;
        expect(code).toBe(0);

        const withCheck = report.plugins.filter((p) => p.kind === 'publish' && p.check !== undefined);
        expect(withCheck.map((p) => p.name).sort()).toEqual([...CHANNELS].sort());
        for (const name of CHANNELS) {
            const row = report.plugins.find((p) => p.name === name);
            expect(row?.check).toBeDefined();
            expect(isAbsolute(row?.check ?? '')).toBe(true);
            expect(row?.check).toContain(join('plugins', 'publishings', name, 'src', 'profile-check.ts'));
        }
    });

    it('substack with no publication URL reports error naming SUBSTACK_PUBLICATION_URL (0216, AC4)', async () => {
        const saved = { url: process.env.SUBSTACK_PUBLICATION_URL, config: process.env.KK_CONFIG };
        delete process.env.SUBSTACK_PUBLICATION_URL;
        // An absent config file keeps the operator's real publication URL out of the probe env.
        process.env.KK_CONFIG = join(tmpdir(), 'kk-no-such-config.yaml');
        try {
            const { code, out } = await runCaptured([
                'plugin',
                'check',
                '--json',
                '--plugins-root',
                REAL_ROOT,
                'substack-pub',
            ]);
            const report = JSON.parse(out) as CheckJson;
            expect(code).not.toBe(0);
            expect(rowFor(report, 'substack-pub')?.status).toBe('error');
            expect(rowFor(report, 'substack-pub')?.detail).toContain('SUBSTACK_PUBLICATION_URL');
        } finally {
            if (saved.url === undefined) delete process.env.SUBSTACK_PUBLICATION_URL;
            else process.env.SUBSTACK_PUBLICATION_URL = saved.url;
            if (saved.config === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = saved.config;
        }
    });
});

describe('manifest check entry missing on disk (review triage, 0215)', () => {
    it('check reports error and login exits 1 instead of an unhandled spawn throw', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-noentry-'));
        try {
            const dir = join(root, 'publishings', 'e2e-noentry');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'plugin.json'),
                JSON.stringify({ name: 'e2e-noentry', kind: 'publish', entry: './entry.ts', check: './gone.ts' }),
            );
            const args = ['--plugins-root', root];

            const checkRun = await runCaptured(['plugin', 'check', '--json', ...args, 'e2e-noentry']);
            const report = JSON.parse(checkRun.out) as CheckJson;
            expect(checkRun.code).toBe(1);
            expect(rowFor(report, 'e2e-noentry')?.status).toBe('error');
            expect(rowFor(report, 'e2e-noentry')?.detail).toBe('probe entry missing');

            const loginRun = await runCaptured(['plugin', 'login', ...args, 'e2e-noentry']);
            expect(loginRun.code).toBe(1);
            expect(loginRun.err).toContain('probe entry missing');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
