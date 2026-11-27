/**
 * G84/0444 — the day projection re-arms after an edit (feature R5, AC5).
 *
 * Failure list written before the code:
 * 1. an edited voicescript leaves the recorded safety verdict reading `pass` — it must read stale;
 * 2. an edited article BODY leaves the digest unchanged (`_06_article_content.json` is what the
 *    digest hashes), so a digest comparison alone reports `fresh` — the mtime case must catch it;
 * 3. the `artifact-edited` recipes must be in the order that re-certifies the day: article →
 *    re-render then safety; script → safety then re-render;
 * 4. the mirrored digest must agree with `safety-artifact-check.ts revision-valid`, which is the
 *    gate's own implementation — the mirror is pinned, not asserted by comment.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { projectDay } from '../../src/board/day';

const REPO = resolve(import.meta.dir, '../../../..');
const CHECK = join(REPO, 'plugins/kk/scripts/safety-artifact-check.ts');
const DAY = '20261125';

/** A project root holding one day with a matched draft pair and a recorded review digest. */
function seededDay(): { project: string; dayDir: string; works: string } {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'kk-day-edit-')));
    const works = join(project, '.works');
    const dayDir = join(works, 'kk-news-generate', DAY);
    mkdirSync(join(dayDir, '22-article'), { recursive: true });
    mkdirSync(join(dayDir, '24-script'), { recursive: true });
    mkdirSync(join(dayDir, '4-safety-variants'), { recursive: true });
    writeFileSync(
        join(dayDir, 'schedule-receipt.json'),
        JSON.stringify({ schemaVersion: 1, runId: 'run-1', status: 'done' }),
    );
    // Order matters for the seed: the render is NEWER than the body, so the day starts fresh.
    const body = join(dayDir, '22-article', `${DAY}_06_article-write_body.md`);
    const content = join(dayDir, '22-article', `${DAY}_06_article_content.json`);
    writeFileSync(body, '# Episode\n\nbody\n');
    writeFileSync(content, '{"title":"Episode","body":"body"}');
    const earlier = new Date(Date.now() - 120_000);
    utimesSync(body, earlier, earlier);
    writeFileSync(
        join(dayDir, '24-script', `${DAY}_08_script_voicescript.yaml`),
        'segments:\n  - text: one\n  - text: two\n',
    );
    writeFileSync(
        join(dayDir, '4-safety-variants', `${DAY}_08b_safety-verdict.decision`),
        JSON.stringify({ schemaVersion: 1, value: 'pass' }),
    );
    const digest = recordedDigest(dayDir);
    writeFileSync(join(dayDir, '24-script', `${DAY}_09_safety-review_request.json`), JSON.stringify({ digest }));
    return { project, dayDir, works };
}

/**
 * The digest the stage records: sha256(article content.json + '\0' + voicescript + '\0').
 *
 * `safety-artifact-check.ts:199-207` is the authority; this is the mirror the projection carries,
 * and the parity assertions below compare the two behaviours end to end.
 */
function recordedDigest(dayDir: string): string {
    return createHash('sha256')
        .update(readFileSync(join(dayDir, '22-article', `${DAY}_06_article_content.json`)))
        .update('\0')
        .update(readFileSync(join(dayDir, '24-script', `${DAY}_08_script_voicescript.yaml`)))
        .update('\0')
        .digest('hex');
}

/** Run the gate's own predicate; `status 1` with the unchanged-digest reason means "fresh". */
function gateVerdict(dayDir: string): { status: number | null; text: string } {
    const result = spawnSync(process.execPath, [CHECK, 'revision-valid', dayDir, DAY], {
        cwd: REPO,
        encoding: 'utf-8',
        env: { ...process.env },
    });
    return { status: result.status, text: `${result.stdout}${result.stderr}` };
}

/** The context the projection takes. */
function ctx(project: string): { projectPath: string; fs: ReturnType<typeof createNodeFileSystem>; worksDir: string } {
    return { projectPath: project, fs: createNodeFileSystem(), worksDir: join(project, '.works') };
}

describe('safety staleness (R5)', () => {
    it('reads fresh while the draft matches the recorded digest, and the gate agrees', async () => {
        const { project, dayDir } = seededDay();
        const digest = await projectDay(ctx(project), DAY);
        if ('notFound' in digest) throw new Error('day not projected');
        expect(digest.safety.stale).toBeUndefined();
        expect(digest.attention.some((item) => item.kind === 'artifact-edited')).toBe(false);
        const gate = gateVerdict(dayDir);
        expect(gate.text).toContain('draft digest is unchanged');
        expect(gate.status).toBe(1);
    });

    it('reads stale after a script edit, with safety first and the voice re-render second', async () => {
        const { project, dayDir } = seededDay();
        writeFileSync(
            join(dayDir, '24-script', `${DAY}_08_script_voicescript.yaml`),
            'segments:\n  - text: one\n  - text: edited\n',
        );
        const digest = await projectDay(ctx(project), DAY);
        if ('notFound' in digest) throw new Error('day not projected');
        expect(digest.safety.stale).toBe(true);
        expect(digest.safety.staleReason).toContain('digest');
        const item = digest.attention.find((entry) => entry.kind === 'artifact-edited');
        expect(item?.subject).toBe('script');
        expect(item?.recipes.map((recipe) => recipe.kind)).toEqual(['generate-from-node', 'rerender-step']);
        expect(item?.recipes[1]?.params.step).toBe('voice');
    });

    it('reads stale for an article body newer than content.json, with the render first', async () => {
        const { project, dayDir } = seededDay();
        const content = join(dayDir, '22-article', `${DAY}_06_article_content.json`);
        const body = join(dayDir, '22-article', `${DAY}_06_article-write_body.md`);
        // The body edit leaves the digest untouched; only the mtime order reveals it.
        writeFileSync(body, '# Episode\n\nedited body\n');
        const older = new Date(Date.now() - 60_000);
        utimesSync(content, older, older);
        const digest = await projectDay(ctx(project), DAY);
        if ('notFound' in digest) throw new Error('day not projected');
        expect(digest.safety.stale).toBe(true);
        expect(digest.safety.staleReason).toContain('content.json');
        const item = digest.attention.find((entry) => entry.kind === 'artifact-edited');
        expect(item?.subject).toBe('article');
        expect(item?.recipes.map((recipe) => recipe.kind)).toEqual(['rerender-step', 'generate-from-node']);
        expect(item?.recipes[0]?.params.step).toBe('render');
    });

    it('agrees with the gate implementation (parity pin)', async () => {
        const { project, dayDir } = seededDay();
        writeFileSync(
            join(dayDir, '24-script', `${DAY}_08_script_voicescript.yaml`),
            'segments:\n  - text: one\n  - text: edited\n',
        );
        const digest = await projectDay(ctx(project), DAY);
        if ('notFound' in digest) throw new Error('day not projected');
        expect(digest.safety.stale).toBe(true);
        const gate = gateVerdict(dayDir);
        // The gate reports a changed-but-valid revision by exiting 0 (`revision-valid: ok`); a fresh
        // draft is the exit-1 "unchanged" answer asserted in the first test. Both sides agree.
        expect(gate.text).not.toContain('draft digest is unchanged');
        expect(gate.status).toBe(0);
    });
});
