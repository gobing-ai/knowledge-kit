import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Task 0409 R1 — `news-localize-validate`. The news pipeline translates the reviewed zh article into
 * en/ja BEFORE the bundle freeze, and this stage is the deterministic gate on that output: a missing,
 * empty, or untranslated locale fails the run, so a half-localized day can never freeze (and therefore
 * never reach `surfdash-pub`, whose digest publish refuses an incomplete locale set).
 *
 * Spawned out of process, like the other stage tests: importing the runner body would register its
 * ~2300 lines with coverage and blow the per-file threshold (see kk-workflow-stages.test.ts).
 */
const runner = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');

const EN =
    '# Daily AI Stew · 2026-11-19\n\nDisney agreed to buy Character.AI while Microsoft shipped its care model.\n';
const JA =
    '# デイリーAIシチュー · 2026-11-19\n\nディズニーがCharacter.AIの買収を決め、マイクロソフトは医療AIを公開した。\n';

/** A run directory with `22-article/locales/<locale>.md` written for each provided draft. */
function workDir(locales: Record<string, string | undefined>): string {
    const dir = mkdtempSync(join(tmpdir(), 'kk-news-localize-'));
    mkdirSync(join(dir, '22-article', 'locales'), { recursive: true });
    for (const [locale, body] of Object.entries(locales)) {
        if (body === undefined) continue;
        writeFileSync(join(dir, '22-article', 'locales', `${locale}.md`), body, 'utf-8');
    }
    return dir;
}

function run(dir: string): { status: number; stderr: string; stdout: string } {
    const result = spawnSync('bun', [runner, 'news-localize-validate', dir], { encoding: 'utf-8' });
    return { status: result.status ?? 1, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

describe('news-localize-validate (0409 R1)', () => {
    it('passes when both locales carry a translated, non-empty title and body', () => {
        const dir = workDir({ en: EN, ja: JA });
        try {
            const result = run(dir);
            expect(result.stderr).not.toContain('localize-validate:');
            expect(result.status).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails naming the locale when a translation is empty (AC2)', () => {
        const dir = workDir({ en: EN, ja: '   \n' });
        try {
            const result = run(dir);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('ja');
            expect(result.stderr).toContain('empty');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails when a locale file was never produced (AC2)', () => {
        const dir = workDir({ en: EN });
        try {
            const result = run(dir);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('ja');
            expect(result.stderr).toContain('missing');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails when the "translation" is still Chinese (an untranslated locale is not a locale)', () => {
        const dir = workDir({ en: '# 每日AI乱炖 · 2026-11-19\n\n迪士尼正式买下 Character.AI。\n', ja: JA });
        try {
            const result = run(dir);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('en');
            expect(result.stderr).toContain('untranslated');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails when a locale file has no "# <title>" line', () => {
        const dir = workDir({ en: 'Just a body, no title.\n', ja: JA });
        try {
            const result = run(dir);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('en');
            expect(result.stderr).toContain('title');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('records what it accepted in the run directory', () => {
        const dir = workDir({ en: EN, ja: JA });
        try {
            expect(run(dir).status).toBe(0);
            const receipt = join(dir, '22-article', 'locales', 'localize-validate.json');
            expect(existsSync(receipt)).toBe(true);
            const parsed = JSON.parse(readFileSync(receipt, 'utf-8')) as { ok: boolean; locales: string[] };
            expect(parsed.ok).toBe(true);
            expect(parsed.locales).toEqual(['en', 'ja']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('normalizes compound retired series brands like Daily AI Hotchpotch and 毎日AIごった煮 before freezing', () => {
        const dir = workDir({
            en: '# Daily AI Stew · 2026-11-21\n\nHere is your Daily AI Hotchpotch.\n',
            ja: '# デイリーAIシチュー · 2026-11-21\n\nRobinがお届けする「毎日AIごった煮」です。\n',
        });
        try {
            const result = run(dir);
            expect(result.status).toBe(0);
            expect(readFileSync(join(dir, '22-article', 'locales', 'en.md'), 'utf-8')).toContain('Daily AI Stew');
            expect(readFileSync(join(dir, '22-article', 'locales', 'ja.md'), 'utf-8')).toContain('デイリーAIシチュー');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails when bare ごった煮 or wrong-locale show names remain', () => {
        const jaBad = workDir({
            en: EN,
            ja: '# デイリーAIシチュー · 2026-11-21\n\nSalty Talkのごった煮回です。\n',
        });
        const enBad = workDir({
            en: '# Daily AI Stew · 2026-11-21\n\nPresented by 咸话咸说.\n',
            ja: JA,
        });
        try {
            const jaRes = run(jaBad);
            expect(jaRes.status).toBe(1);
            expect(jaRes.stderr).toContain('ja');

            const enRes = run(enBad);
            expect(enRes.status).toBe(1);
            expect(enRes.stderr).toContain('en');
        } finally {
            rmSync(jaBad, { recursive: true, force: true });
            rmSync(enBad, { recursive: true, force: true });
        }
    });
});

const WORKFLOW = resolve(join(import.meta.dir, '../workflows/kk-news-generate.yaml'));

/** The authored DAG, parsed once: these assertions are about wiring, not about a run. */
const dag = Bun.YAML.parse(readFileSync(WORKFLOW, 'utf-8')) as {
    nodes: {
        id: string;
        dependsOn?: string[];
        action?: { kind: string; options?: { command?: string; input?: string; expectFile?: string } };
    }[];
};

describe('the news DAG localizes before the freeze (0409 R1/R4)', () => {
    const byId = new Map(dag.nodes.map((node) => [node.id, node]));

    it('localize runs after render and review (the reviewed zh article is its source)', () => {
        expect(byId.get('localize')?.dependsOn).toEqual(['render', 'review']);
        expect(byId.get('localize')?.action?.kind).toBe('agent.run');
        expect(String(byId.get('localize')?.action?.options?.expectFile)).toContain('22-article/locales/ja.md');
    });

    it('localize-check depends on localize and gates the variants', () => {
        expect(byId.get('localize-check')?.dependsOn).toEqual(['localize']);
        expect(String(byId.get('localize-check')?.action?.options?.command)).toContain('news-localize-validate');
        expect(byId.get('variants')?.dependsOn).toContain('localize-check');
    });

    it('the validator cannot be swallowed: no onError: continue on the check node', () => {
        const check = byId.get('localize-check') as { action?: { onError?: string } } | undefined;
        expect(check?.action?.onError).toBeUndefined();
    });
});
