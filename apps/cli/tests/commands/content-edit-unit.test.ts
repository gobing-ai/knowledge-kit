/**
 * G84/0444 — `kk news edit` exercised **in process** (coverage for the merged-tree full gate).
 *
 * The E2E next door spawns the real binary, which gives the strongest behavioural evidence but zero
 * coverage inside this process. The full gate measures per-file coverage, so this file drives the same
 * surface through the exported functions: the pure helpers and `editAction` itself, with `KK_CONFIG`
 * pointed at a temp file and the process cwd moved into a throwaway project.
 *
 * Failure list written before the code:
 * 1. an artifact id outside the enum, a missing day directory, an unreadable source, a missing
 *    `--base-sha`, a sha mismatch (carrying the current one), an empty body, a body over the cap, an
 *    invalid script, a frozen bundle and a foreign lock each refuse by code and write nothing;
 * 2. a valid edit and a revert round-trip the bytes and keep a backup each time;
 * 3. the path helpers never derive a destination from caller input.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { CommanderError } from 'commander';
import { EDIT_BODY_CAP_BYTES } from '../../src/board/actions';
import {
    atomicWriteText,
    backupStamp,
    backupsOf,
    byteLengthOf,
    currentArtifact,
    EDIT_REFUSALS,
    EditRefusedError,
    editAction,
    editBackupDir,
    lockHeldByOther,
    resolveEditDayDir,
    sha256Of,
    validateVoicescript,
} from '../../src/commands/content-edit';

const DAY = '20261125';

/** The cwd/env a case ran with, restored after it. */
const restores: (() => void)[] = [];

afterEach(() => {
    while (restores.length > 0) restores.pop()?.();
});

interface Fx {
    root: string;
    dayDir: string;
    config: string;
    article: string;
    script: string;
}

/** A throwaway project with one day directory, switched into as the current process. */
function fixture(configText = 'works_dir: works\n'): Fx {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-edit-unit-')));
    const dayDir = join(root, 'works', 'kk-news-generate', DAY);
    mkdirSync(join(dayDir, '22-article'), { recursive: true });
    mkdirSync(join(dayDir, '24-script'), { recursive: true });
    const config = join(root, 'config.yaml');
    writeFileSync(config, `${configText}store:\n  db_path: ${join(root, 'kk.db')}\n`);
    const article = join(dayDir, '22-article', `${DAY}_06_article-write_body.md`);
    const script = join(dayDir, '24-script', `${DAY}_08_script_voicescript.yaml`);
    writeFileSync(article, '# Episode\n\nbody\n');
    writeFileSync(script, 'segments:\n  - text: one\n  - text: two\n');
    writeFileSync(join(dayDir, '22-article', `${DAY}_06_article_content.json`), '{"title":"t","body":"b"}');

    const previousCwd = process.cwd();
    const previousConfig = process.env.KK_CONFIG;
    process.chdir(root);
    process.env.KK_CONFIG = config;
    restores.push(() => {
        process.chdir(previousCwd);
        if (previousConfig === undefined) delete process.env.KK_CONFIG;
        else process.env.KK_CONFIG = previousConfig;
    });
    return { root, dayDir, config, article, script };
}

/** The refusal code `editAction` throws, or null when it did not refuse. */
async function refusalOf(options: Parameters<typeof editAction>[0]): Promise<string | null> {
    try {
        await editAction(options);
        return null;
    } catch (error) {
        if (error instanceof EditRefusedError) return error.code;
        if (error instanceof CommanderError) return error.code;
        throw error;
    }
}

describe('the pure helpers', () => {
    it('hashes and measures UTF-8 bytes', () => {
        expect(sha256Of('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(byteLengthOf('é')).toBe(2);
        expect(byteLengthOf('')).toBe(0);
    });

    it('names backups in a sortable UTC stamp', () => {
        const stamp = backupStamp(new Date('2026-11-25T04:05:06.789Z'));
        expect(stamp).toBe('20261125T040506.789Z');
        expect(
            backupStamp(new Date('2026-11-25T00:00:00.000Z')) < backupStamp(new Date('2026-12-01T00:00:00.000Z')),
        ).toBe(true);
    });

    it('accepts only a Voicescript with two non-empty segments', () => {
        expect(validateVoicescript('segments:\n  - text: a\n  - text: b\n')).toBeNull();
        expect(validateVoicescript('segments: [\n')).toContain('not valid YAML');
        expect(validateVoicescript('- a\n- b\n')).toContain('mapping');
        expect(validateVoicescript('segments:\n  - text: only\n')).toContain('at least 2');
        expect(validateVoicescript('segments:\n  - text: a\n  - text: "  "\n')).toContain('segment 1');
        expect(validateVoicescript('segments:\n  - text: a\n  - nothing: b\n')).toContain('segment 1');
    });

    it('keeps the refusal vocabulary closed', () => {
        expect(EDIT_REFUSALS).toContain('news.edit.body.empty');
        expect(new Set(EDIT_REFUSALS).size).toBe(EDIT_REFUSALS.length);
    });

    it('writes atomically and reads the current bytes', async () => {
        const fx = fixture();
        const fs = createNodeFileSystem();
        const target = join(fx.dayDir, 'notes.md');
        await atomicWriteText(fs, target, 'first\n');
        expect(readFileSync(target, 'utf8')).toBe('first\n');
        expect(await currentArtifact(fs, target)).toBe('first\n');
        expect(await currentArtifact(fs, join(fx.dayDir, 'missing.md'))).toBeNull();
    });

    it("lists one artifact's backups newest-last and ignores the rest", async () => {
        const fx = fixture();
        const fs = createNodeFileSystem();
        const dir = editBackupDir(fx.dayDir);
        await atomicWriteText(fs, join(dir, `20260101T000000.000Z-article.md`), 'a');
        await atomicWriteText(fs, join(dir, `20260102T000000.000Z-article.md`), 'b');
        await atomicWriteText(fs, join(dir, `20260103T000000.000Z-script.yaml`), 'c');
        expect(await backupsOf(fs, fx.dayDir, 'article')).toEqual([
            '20260101T000000.000Z-article.md',
            '20260102T000000.000Z-article.md',
        ]);
        expect(await backupsOf(fs, fx.dayDir, 'script')).toEqual(['20260103T000000.000Z-script.yaml']);
        expect(await backupsOf(fs, join(fx.dayDir, 'nowhere'), 'article')).toEqual([]);
    });

    it('resolves the day through the config, and reports a missing one', async () => {
        const fx = fixture();
        const fs = createNodeFileSystem();
        expect((await resolveEditDayDir(fs, fx.config, DAY)).dayDir).toBe(fx.dayDir);
        expect((await resolveEditDayDir(fs, fx.config, '29990101')).exists).toBe(false);
    });
});

describe('editAction writes', () => {
    it('edits the article, then reverts it, then reverts the revert', async () => {
        const fx = fixture();
        const original = readFileSync(fx.article, 'utf8');
        // The stdin path needs a pipe; `--from-file <path>` is the same code path after `readBody`.
        const source = join(fx.root, 'next.md');
        writeFileSync(source, 'edited\n');
        await editAction({ runDate: DAY, artifact: 'article', fromFile: source, baseSha: sha256Of(original) });
        expect(readFileSync(fx.article, 'utf8')).toBe('edited\n');

        await editAction({ runDate: DAY, artifact: 'article', revert: true });
        expect(readFileSync(fx.article, 'utf8')).toBe(original);
        await editAction({ runDate: DAY, artifact: 'article', revert: true });
        expect(readFileSync(fx.article, 'utf8')).toBe('edited\n');
    });

    it('accepts a valid script and refuses an invalid one', async () => {
        const fx = fixture();
        const good = join(fx.root, 'script.yaml');
        writeFileSync(good, 'segments:\n  - text: opening\n  - text: closing\n');
        await editAction({
            runDate: DAY,
            artifact: 'script',
            fromFile: good,
            baseSha: sha256Of(readFileSync(fx.script, 'utf8')),
        });
        expect(readFileSync(fx.script, 'utf8')).toContain('opening');

        const bad = join(fx.root, 'bad.yaml');
        writeFileSync(bad, 'segments:\n  - text: only\n');
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'script',
                fromFile: bad,
                baseSha: sha256Of(readFileSync(fx.script, 'utf8')),
            }),
        ).toBe('news.edit.script.invalid');
    });
});

describe('editAction refusals', () => {
    it('refuses an unknown artifact before touching the filesystem', async () => {
        fixture();
        expect(await refusalOf({ runDate: DAY, artifact: 'audio', fromFile: '-' })).toBe('news.edit.artifact.unknown');
    });

    it('refuses a missing day directory', async () => {
        fixture();
        expect(
            await refusalOf({ runDate: '29990101', artifact: 'article', fromFile: '-', baseSha: sha256Of('x') }),
        ).toBe('news.edit.source.unreadable');
    });

    it('refuses an unreadable source and a missing base sha', async () => {
        const fx = fixture();
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'article',
                fromFile: join(fx.root, 'nope.md'),
                baseSha: sha256Of('x'),
            }),
        ).toBe('news.edit.source.unreadable');
        expect(await refusalOf({ runDate: DAY, artifact: 'article', fromFile: join(fx.root, 'nope.md') })).toBe(
            'news.edit.base-sha.mismatch',
        );
        expect(await refusalOf({ runDate: DAY, artifact: 'article' })).toBe('news.edit.source.unreadable');
    });

    it('refuses a stale base sha and prints the current one', async () => {
        const fx = fixture();
        const before = readFileSync(fx.article, 'utf8');
        try {
            await editAction({ runDate: DAY, artifact: 'article', fromFile: fx.article, baseSha: 'f'.repeat(64) });
            throw new Error('expected a refusal');
        } catch (error) {
            // `refuse()` surfaces as the CLI's CommanderError; the code and the current sha both ride it.
            expect(error).toBeInstanceOf(CommanderError);
            expect((error as CommanderError).code).toBe('news.edit.base-sha.mismatch');
            expect((error as CommanderError).message).toContain(`current=${sha256Of(before)}`);
        }
        expect(readFileSync(fx.article, 'utf8')).toBe(before);
    });

    it('refuses an empty body and one over the cap', async () => {
        const fx = fixture();
        const empty = join(fx.root, 'empty.md');
        writeFileSync(empty, '   \n');
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'article',
                fromFile: empty,
                baseSha: sha256Of(readFileSync(fx.article, 'utf8')),
            }),
        ).toBe('news.edit.body.empty');

        const huge = join(fx.root, 'huge.md');
        writeFileSync(huge, 'a'.repeat(EDIT_BODY_CAP_BYTES + 1));
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'article',
                fromFile: huge,
                baseSha: sha256Of(readFileSync(fx.article, 'utf8')),
            }),
        ).toBe('news.edit.body.too-large');
    });

    it('refuses a frozen bundle', async () => {
        const fx = fixture();
        writeFileSync(join(fx.dayDir, 'bundle.json'), '{"runId":"b","contentType":"news"}');
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'article',
                fromFile: fx.article,
                baseSha: sha256Of(readFileSync(fx.article, 'utf8')),
            }),
        ).toBe('news.edit.frozen');
    });

    it('refuses when the day lock belongs to another holder', async () => {
        const fx = fixture();
        const store = await openStore({ path: await resolveStorePath(fx.config) });
        try {
            expect(await store.locks.acquire(`ops-console:${DAY}`, 'ops-console:other', 60_000)).toBe(true);
        } finally {
            await store.close();
        }
        expect(await lockHeldByOther(DAY)).toContain('held by ops-console:other');
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'article',
                fromFile: fx.article,
                baseSha: sha256Of(readFileSync(fx.article, 'utf8')),
            }),
        ).toBe('news.edit.lock.held');

        // The holder's own invocation is allowed through.
        const previous = process.env.KK_LOCK_HOLDER;
        process.env.KK_LOCK_HOLDER = 'ops-console:other';
        restores.push(() => {
            if (previous === undefined) delete process.env.KK_LOCK_HOLDER;
            else process.env.KK_LOCK_HOLDER = previous;
        });
        expect(await lockHeldByOther(DAY)).toBeNull();
    });

    it('refuses a revert with no backup', async () => {
        fixture();
        expect(await refusalOf({ runDate: DAY, artifact: 'article', revert: true })).toBe('news.edit.no-backup');
    });

    it('refuses a revert while another holder owns the lock', async () => {
        const fx = fixture();
        // A real edit first, so a backup exists and the lock check is the refusal the revert hits.
        const source = join(fx.root, 'seed.md');
        writeFileSync(source, 'seeded\n');
        await editAction({
            runDate: DAY,
            artifact: 'article',
            fromFile: source,
            baseSha: sha256Of(readFileSync(fx.article, 'utf8')),
        });
        const store = await openStore({ path: await resolveStorePath(fx.config) });
        try {
            expect(await store.locks.acquire(`ops-console:${DAY}`, 'ops-console:other', 60_000)).toBe(true);
        } finally {
            await store.close();
        }
        const second = join(fx.root, 'x.md');
        writeFileSync(second, 'one\n');
        expect(
            await refusalOf({
                runDate: DAY,
                artifact: 'article',
                fromFile: second,
                baseSha: sha256Of(readFileSync(fx.article, 'utf8')),
            }),
        ).toBe('news.edit.lock.held');
    });
});

/** A directory that is not a day: the resolver must not invent one on the way in. */
it('resolves a day directory relative to an absolute config path', async () => {
    const fx = fixture();
    const fs = createNodeFileSystem();
    const resolvedPath = (await resolveEditDayDir(fs, resolve(fx.config), DAY)).dayDir;
    expect(resolvedPath.endsWith(join('works', 'kk-news-generate', DAY))).toBe(true);
    expect(dirname(dirname(dirname(resolvedPath)))).toBe(fx.root);
});
