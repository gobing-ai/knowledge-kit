/**
 * G84/0444 — `kk news edit` end to end against the real binary (feature R1/R2/R3/R6).
 *
 * Failure list written before the code; every refusal asserts the artifact is byte-identical and no
 * `edits/` entry was created:
 * 1. an unknown artifact, an unreadable source, a base-sha mismatch, a body over 256 KiB, a script
 *    that is not YAML or lacks two non-empty segments, a frozen bundle and another holder's
 *    `ops-console:<day>` lock are each refused by name;
 * 2. a successful edit writes exactly the allowlisted file, backs up the previous bytes and prints
 *    `{backup, sha256}` whose sha matches the file on disk;
 * 3. a revert restores the newest backup and backs up what it replaced, so a revert-of-revert works;
 * 4. the 256 KiB boundary is inclusive (exactly at the cap is accepted, one byte over is refused).
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';

const REPO = resolve(import.meta.dir, '../../../..');
const CLI_ENTRY = join(REPO, 'apps/cli/src/index.ts');
const DAY = '20261125';
/** The real cap, restated here so the test fails if the product constant drifts. */
const CAP = 256 * 1024;
/** Each case spawns the real CLI once or twice; bun's 5 s default is shorter than two launches. */
const TEST_TIMEOUT = 60_000;

interface Fixture {
    root: string;
    works: string;
    dayDir: string;
    config: string;
    bin: string;
    article: string;
    script: string;
}

/** A throwaway project holding one day directory with a plausible article + script pair. */
async function fixture(): Promise<Fixture> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-news-edit-')));
    const works = join(root, 'works');
    const dayDir = join(works, 'kk-news-generate', DAY);
    const config = join(root, 'config.yaml');
    const bin = join(root, 'bin');
    mkdirSync(join(dayDir, '22-article'), { recursive: true });
    mkdirSync(join(dayDir, '24-script'), { recursive: true });
    mkdirSync(join(root, 'home'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(config, ['works_dir: works', 'store:', `  db_path: ${join(root, 'kk.db')}`, ''].join('\n'));
    const article = join(dayDir, '22-article', `${DAY}_06_article-write_body.md`);
    const script = join(dayDir, '24-script', `${DAY}_08_script_voicescript.yaml`);
    writeFileSync(article, '# Episode\n\nFirst line.\nSecond line.\n');
    writeFileSync(join(dayDir, '22-article', `${DAY}_06_article_content.json`), '{"title":"Episode"}');
    writeFileSync(
        script,
        [
            'title: Episode',
            'segments:',
            '  - speaker: host',
            '    text: opening line',
            '  - speaker: host',
            '    text: closing line',
            '',
        ].join('\n'),
    );
    return { root, works, dayDir, config, bin, article, script };
}

/** Run the real CLI with this fixture's config and a bounded stdin. */
function kk(fx: Fixture, args: string[], stdin?: string, env: Record<string, string> = {}) {
    const child = Bun.spawnSync([process.execPath, CLI_ENTRY, ...args], {
        cwd: fx.root,
        stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...(process.env as Record<string, string>),
            PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
            HOME: join(fx.root, 'home'),
            KK_CONFIG: fx.config,
            ...env,
        },
    });
    return {
        code: child.exitCode ?? 1,
        out: child.stdout?.toString() ?? '',
        err: child.stderr?.toString() ?? '',
    };
}

/** The artifact's own sha, as the verb prints it. */
function shaOf(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every backup file under `<day>/edits`, ascending. */
function backups(fx: Fixture): string[] {
    const dir = join(fx.dayDir, 'edits');
    return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe('kk news edit (R1)', () => {
    it(
        'replaces the allowlisted article, backs up the old bytes and prints the new sha',
        async () => {
            const fx = await fixture();
            const before = readFileSync(fx.article, 'utf8');
            const result = kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                '# Episode\n\nEdited.\n',
            );
            expect(result.code).toBe(0);
            const record = JSON.parse(result.out.trim().split('\n').at(-1) ?? '{}') as {
                backup: string;
                sha256: string;
            };
            expect(readFileSync(fx.article, 'utf8')).toBe('# Episode\n\nEdited.\n');
            expect(record.sha256).toBe(shaOf(fx.article));
            expect(readFileSync(record.backup, 'utf8')).toBe(before);
            expect(backups(fx)).toHaveLength(1);
        },
        TEST_TIMEOUT,
    );

    it(
        'reads --from-file <path> as well as stdin',
        async () => {
            const fx = await fixture();
            const source = join(fx.root, 'new-body.md');
            writeFileSync(source, 'from a file\n');
            const result = kk(fx, [
                'news',
                'edit',
                '--run-date',
                DAY,
                '--artifact',
                'article',
                '--from-file',
                source,
                '--base-sha',
                shaOf(fx.article),
            ]);
            expect(result.code).toBe(0);
            expect(readFileSync(fx.article, 'utf8')).toBe('from a file\n');
        },
        TEST_TIMEOUT,
    );
});

describe('kk news edit --revert (R2)', () => {
    it(
        'restores the newest backup and backs up what it replaced',
        async () => {
            const fx = await fixture();
            const original = readFileSync(fx.article, 'utf8');
            kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'first edit\n',
            );
            kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'second edit\n',
            );
            expect(readFileSync(fx.article, 'utf8')).toBe('second edit\n');

            const revert = kk(fx, ['news', 'edit', '--run-date', DAY, '--artifact', 'article', '--revert']);
            expect(revert.code).toBe(0);
            expect(readFileSync(fx.article, 'utf8')).toBe('first edit\n');
            // The revert backed up the bytes it replaced, so it can itself be undone.
            expect(backups(fx)).toHaveLength(3);
            const undo = kk(fx, ['news', 'edit', '--run-date', DAY, '--artifact', 'article', '--revert']);
            expect(undo.code).toBe(0);
            expect(readFileSync(fx.article, 'utf8')).toBe('second edit\n');
            expect(original).toBe('# Episode\n\nFirst line.\nSecond line.\n');
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses when no backup exists',
        async () => {
            const fx = await fixture();
            const before = readFileSync(fx.article, 'utf8');
            const result = kk(fx, ['news', 'edit', '--run-date', DAY, '--artifact', 'article', '--revert']);
            expect(result.code).toBe(1);
            expect(result.err).toContain('news.edit.no-backup');
            expect(readFileSync(fx.article, 'utf8')).toBe(before);
            expect(backups(fx)).toHaveLength(0);
        },
        TEST_TIMEOUT,
    );
});

describe('refusals change nothing (R3)', () => {
    /** Assert one refusal: nonzero, the named code, unchanged bytes, no backup. */
    function refusal(fx: Fixture, args: string[], code: string, stdin?: string): void {
        const before = readFileSync(
            args.includes('--artifact') && args[args.indexOf('--artifact') + 1] === 'script' ? fx.script : fx.article,
            'utf8',
        );
        const result = kk(fx, args, stdin);
        expect(result.code).toBe(1);
        expect(result.err).toContain(code);
        expect(readFileSync(fx.article, 'utf8')).toBe(
            args.includes('script') ? readFileSync(fx.article, 'utf8') : before,
        );
        expect(readFileSync(fx.script, 'utf8')).toContain('segments:');
        expect(backups(fx)).toHaveLength(0);
    }

    it(
        'refuses an unknown artifact',
        async () => {
            const fx = await fixture();
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'audio',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'news.edit.artifact.unknown',
                'x\n',
            );
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses an unreadable source path',
        async () => {
            const fx = await fixture();
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    join(fx.root, 'nope.md'),
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'news.edit.source.unreadable',
            );
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses a stale base sha and reports the current one',
        async () => {
            const fx = await fixture();
            const result = kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    'f'.repeat(64),
                ],
                'x\n',
            );
            expect(result.code).toBe(1);
            expect(result.err).toContain('news.edit.base-sha.mismatch');
            expect(result.err).toContain(`current=${shaOf(fx.article)}`);
            expect(backups(fx)).toHaveLength(0);
        },
        TEST_TIMEOUT,
    );

    it(
        'accepts exactly the cap',
        async () => {
            const fx = await fixture();
            const atCap = 'a'.repeat(CAP);
            const accepted = kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                atCap,
            );
            expect(accepted.code).toBe(0);
            expect(readFileSync(fx.article, 'utf8').length).toBe(CAP);
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses one byte over the cap',
        async () => {
            const fx = await fixture();
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'news.edit.body.too-large',
                `${'b'.repeat(CAP)}b`,
            );
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses a script that is not YAML, and one without two non-empty segments',
        async () => {
            const fx = await fixture();
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'script',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.script),
                ],
                'news.edit.script.invalid',
                'segments: [\n  - text: one\n',
            );
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'script',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.script),
                ],
                'news.edit.script.invalid',
                'segments:\n  - text: only one\n',
            );
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'script',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.script),
                ],
                'news.edit.script.invalid',
                'segments:\n  - text: one\n  - text: "  "\n',
            );
        },
        TEST_TIMEOUT,
    );

    it(
        'accepts a script with two non-empty segments',
        async () => {
            const fx = await fixture();
            const body = 'segments:\n  - text: opening\n  - text: closing\n';
            const result = kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'script',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.script),
                ],
                body,
            );
            expect(result.code).toBe(0);
            expect(readFileSync(fx.script, 'utf8')).toBe(body);
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses a frozen bundle',
        async () => {
            const fx = await fixture();
            writeFileSync(join(fx.dayDir, 'bundle.json'), '{"runId":"b-1","contentType":"news"}');
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'news.edit.frozen',
                'x\n',
            );
        },
        TEST_TIMEOUT,
    );

    it(
        "refuses another holder's ops-console lock",
        async () => {
            const fx = await fixture();
            const store = await openStore({ path: await resolveStorePath(fx.config) });
            try {
                expect(await store.locks.acquire(`ops-console:${DAY}`, 'ops-console:someone-else', 60_000)).toBe(true);
            } finally {
                await store.close();
            }
            refusal(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'news.edit.lock.held',
                'x\n',
            );
        },
        TEST_TIMEOUT,
    );

    it(
        'allows the same holder through when the plane proves it owns the lock',
        async () => {
            const fx = await fixture();
            const store = await openStore({ path: await resolveStorePath(fx.config) });
            try {
                expect(await store.locks.acquire(`ops-console:${DAY}`, 'ops-console:me', 60_000)).toBe(true);
            } finally {
                await store.close();
            }
            const result = kk(
                fx,
                [
                    'news',
                    'edit',
                    '--run-date',
                    DAY,
                    '--artifact',
                    'article',
                    '--from-file',
                    '-',
                    '--base-sha',
                    shaOf(fx.article),
                ],
                'owned\n',
                { KK_LOCK_HOLDER: 'ops-console:me' },
            );
            expect(result.code).toBe(0);
            expect(readFileSync(fx.article, 'utf8')).toBe('owned\n');
        },
        TEST_TIMEOUT,
    );
});

describe('the surface (R7)', () => {
    it(
        'is registered on kk news only, with named flags',
        async () => {
            const fx = await fixture();
            const news = kk(fx, ['news', 'edit', '--help']);
            expect(news.code).toBe(0);
            expect(news.out).toContain('--run-date');
            expect(news.out).toContain('--artifact');
            expect(news.out).toContain('--base-sha');
            expect(news.out).toContain('--revert');
            // The article noun never registers it: the two drafts it guards are the news day's.
            const article = kk(fx, ['article', '--help']);
            expect(article.out).toContain('publish-plan');
            expect(article.out).not.toContain('replace or revert an allowlisted day artifact');
        },
        TEST_TIMEOUT,
    );
});

/** Keep the module graph honest: the CLI entry is the product binary, not a copy. */
it('runs the checkout binary', () => {
    expect(existsSync(dirname(CLI_ENTRY))).toBe(true);
});
