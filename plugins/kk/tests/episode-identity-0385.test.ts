import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEpisodeIdentityToArticle, dailyEditorialRender } from '../scripts/daily-stages';
import {
    composeEpisodeTitle,
    EPISODE_IDENTITY_KEY,
    type EpisodeIdentity,
    freezeEpisodeIdentity,
    identityFromMetadata,
    issueLabel,
    issueNumberOf,
    MAX_HEADLINE_CHARS,
} from '../scripts/episode-identity';

let stageLog: { mockRestore(): void };
let stageError: { mockRestore(): void };
beforeEach(() => {
    stageLog = spyOn(console, 'log').mockImplementation(() => {});
    stageError = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    stageLog.mockRestore();
    stageError.mockRestore();
});

/**
 * 0385 R4 — one episode carries one frozen identity (`第261120期 · 当日要点`), the cover reuses the
 * same point, and a retry or a historical replay keeps the identity the bundle already shipped.
 * The withhold path is the interesting one: admission dropping the headline's support must leave no
 * title at all rather than a title nothing backs.
 */
const DATE = '2026-11-20';

describe('0385 episode title format', () => {
    it('renders the canonical 第261120期 · 当日要点 title from the frozen date and point', () => {
        expect(issueNumberOf(DATE)).toBe('261120');
        expect(issueNumberOf('20261120')).toBe('261120');
        expect(issueLabel(DATE)).toBe('第261120期');
        expect(composeEpisodeTitle(DATE, '开源模型许可收紧')).toBe('第261120期 · 开源模型许可收紧');
    });

    it('collapses writer line breaks and a trailing sentence stop into one point', () => {
        expect(composeEpisodeTitle(DATE, '  开源模型\n许可收紧。 ')).toBe('第261120期 · 开源模型 许可收紧');
    });

    it('never emits a dangling prefix when the point or the date is empty', () => {
        expect(composeEpisodeTitle(DATE, '   ')).toBe('');
        expect(composeEpisodeTitle('', '开源模型许可收紧')).toBe('');
    });

    it('clips a long point at the cover-headline cap by code point', () => {
        const long = '开'.repeat(40);
        const point = composeEpisodeTitle(DATE, long).split(' · ')[1] ?? '';
        expect([...point].length).toBe(MAX_HEADLINE_CHARS);
        expect(point.endsWith('…')).toBe(true);
        // A surrogate pair is never split in half by the clip.
        const emoji = '🚀'.repeat(40);
        expect(composeEpisodeTitle(DATE, emoji).includes('\uFFFD')).toBe(false);
    });
});

describe('0385 freezeEpisodeIdentity', () => {
    it('freezes the point, the title and the cover point together', () => {
        const identity = freezeEpisodeIdentity({
            date: DATE,
            headline: '开源模型许可收紧',
            supportingSourceIds: ['doc-lead'],
            admittedSourceIds: ['doc-lead', 'doc-2'],
        });
        expect(identity).toEqual({
            version: 1,
            date: DATE,
            issue: '261120',
            headline: '开源模型许可收紧',
            title: '第261120期 · 开源模型许可收紧',
            coverHeadline: '开源模型许可收紧',
            supportingSourceIds: ['doc-lead'],
            status: 'frozen',
        });
        // The cover reuses the same point — not a second wording of it (R4).
        expect(identity.coverHeadline).toBe(identity.headline);
    });

    it('is deterministic: the same inputs freeze the same record', () => {
        const input = { date: DATE, headline: '要点', supportingSourceIds: ['a'], admittedSourceIds: ['a'] };
        expect(freezeEpisodeIdentity(input)).toEqual(freezeEpisodeIdentity(input));
    });

    it('withholds the title and the cover point when admission drops every supporting source', () => {
        const identity = freezeEpisodeIdentity({
            date: DATE,
            headline: '开源模型许可收紧',
            supportingSourceIds: ['doc-lead'],
            admittedSourceIds: ['doc-2'],
        });
        expect(identity.status).toBe('support-removed');
        expect(identity.title).toBeNull();
        expect(identity.headline).toBeNull();
        expect(identity.coverHeadline).toBeNull();
        // The record still names what it was resting on, so the operator can see what vanished.
        expect(identity.supportingSourceIds).toEqual(['doc-lead']);
    });

    it('keeps the headline when only one of several named supports survives', () => {
        const identity = freezeEpisodeIdentity({
            date: DATE,
            headline: '要点',
            supportingSourceIds: ['gone', 'kept'],
            admittedSourceIds: ['kept'],
        });
        expect(identity.status).toBe('frozen');
        expect(identity.title).toBe('第261120期 · 要点');
    });

    it('does not withhold when the caller names no supporting source (legacy plans, no id on the cover)', () => {
        const identity = freezeEpisodeIdentity({ date: DATE, headline: '要点', admittedSourceIds: [] });
        expect(identity.status).toBe('frozen');
        expect(identity.supportingSourceIds).toEqual([]);
    });

    it('carries a legacy title through when no point was frozen, and withholds nothing it cannot see', () => {
        const identity = freezeEpisodeIdentity({ date: DATE, legacyTitle: '每日AI乱炖 · 2026-11-20' });
        expect(identity.status).toBe('no-headline');
        expect(identity.title).toBe('每日AI乱炖 · 2026-11-20');
        expect(identity.coverHeadline).toBeNull();
    });

    it('has no title to offer when neither a point nor a legacy title exists', () => {
        expect(freezeEpisodeIdentity({ date: DATE }).title).toBeNull();
    });

    it('dedupes and trims supporting ids, dropping blanks', () => {
        const identity = freezeEpisodeIdentity({
            date: DATE,
            headline: '要点',
            supportingSourceIds: [' a ', 'a', '', 'b'],
            admittedSourceIds: ['a'],
        });
        expect(identity.supportingSourceIds).toEqual(['a', 'b']);
    });
});

describe('0385 identityFromMetadata (retry / historical replay)', () => {
    const frozen: EpisodeIdentity = freezeEpisodeIdentity({
        date: DATE,
        headline: '开源模型许可收紧',
        supportingSourceIds: ['doc-lead'],
        admittedSourceIds: ['doc-lead'],
    });

    it('round-trips a frozen record so a retry re-publishes the same identity', () => {
        expect(identityFromMetadata({ [EPISODE_IDENTITY_KEY]: frozen })).toEqual(frozen);
    });

    it('replays an old bundle verbatim even when today’s admission would withhold it', () => {
        const replayed = identityFromMetadata({ [EPISODE_IDENTITY_KEY]: frozen });
        expect(replayed?.title).toBe('第261120期 · 开源模型许可收紧');
    });

    it('preserves a withheld record on replay instead of regenerating a title', () => {
        const withheld = freezeEpisodeIdentity({
            date: DATE,
            headline: '要点',
            supportingSourceIds: ['gone'],
            admittedSourceIds: [],
        });
        expect(withheld.status).toBe('support-removed');
        expect(identityFromMetadata({ [EPISODE_IDENTITY_KEY]: withheld })?.title).toBeNull();
    });

    it('rejects an unrecognizable record so the caller freezes afresh', () => {
        expect(identityFromMetadata(undefined)).toBeNull();
        expect(identityFromMetadata({})).toBeNull();
        expect(identityFromMetadata({ [EPISODE_IDENTITY_KEY]: 'text' })).toBeNull();
        expect(
            identityFromMetadata({ [EPISODE_IDENTITY_KEY]: { version: 2, date: DATE, status: 'frozen' } }),
        ).toBeNull();
        expect(identityFromMetadata({ [EPISODE_IDENTITY_KEY]: { version: 1, date: '', status: 'frozen' } })).toBeNull();
        expect(
            identityFromMetadata({ [EPISODE_IDENTITY_KEY]: { version: 1, date: DATE, status: 'unknown' } }),
        ).toBeNull();
    });

    it('reads a hand-written record tolerantly (missing issue / ids)', () => {
        expect(
            identityFromMetadata({ episodeIdentity: { version: 1, date: DATE, status: 'frozen', title: 't' } }),
        ).toEqual({
            version: 1,
            date: DATE,
            issue: '261120',
            headline: null,
            title: 't',
            coverHeadline: null,
            supportingSourceIds: [],
            status: 'frozen',
        });
    });
});

/**
 * The contract half of R1–R4 is prose (a prompt sidecar), so the test pins the prose: the audience
 * retune, the fact/comment/inference split, the short opening, the optional commentary and the one
 * frozen title must be present, and the machine-readable block the validator reads must still parse.
 */
const CONTRACT = readFileSync(
    join(import.meta.dir, '..', 'skills', 'news-editorial', 'references', 'style-contract.zh.md'),
    'utf-8',
);
const SKILL = readFileSync(join(import.meta.dir, '..', 'skills', 'news-editorial', 'SKILL.md'), 'utf-8');

describe('0385 style-contract retune', () => {
    it('states the white-collar audience and the plain-language / weekly-depth rules (R1)', () => {
        expect(CONTRACT).toContain('## 受众取舍（0385 R1）');
        expect(CONTRACT).toContain('白领听众');
        expect(CONTRACT).toContain('深度专题留到周更');
        // The old technical-sharing register is retired.
        expect(CONTRACT).not.toContain('AI 技术分享栏目');
    });

    it('states the fact / commentary / inference separation and the omit-when-thin rule (R2)', () => {
        expect(CONTRACT).toContain('## 事实、评论与待证推断（0385 R2）');
        for (const phrase of ['可归因事实', '评论', '待证推断', '直接省略', '商业声明']) {
            expect(CONTRACT).toContain(phrase);
        }
    });

    it('states the short opening, the optional per-item comment and the optional synthesis (R3)', () => {
        expect(CONTRACT).toContain('一句问候加一到两句要点');
        expect(CONTRACT).toContain('- `insight`：可选');
        expect(CONTRACT).toContain('跨条目的综评');
    });

    it('states the one frozen episode title, the shared cover point and the withhold path (R4)', () => {
        expect(CONTRACT).toContain('## 节目标题与节目身份（0385 R4）');
        expect(CONTRACT).toContain('第261120期 · 当日要点');
        expect(CONTRACT).toContain('metadata.episodeIdentity');
        expect(CONTRACT).toContain('撤下标题');
    });

    it('keeps the machine-readable block the validator reads intact', () => {
        const block = /```json\s*([\s\S]*?)```/.exec(CONTRACT)?.[1];
        expect(block).toBeDefined();
        const parsed = JSON.parse(block ?? '{}') as { caps: Record<string, number>; banned: string[] };
        for (const field of ['intro', 'outro', 'lead', 'insight', 'cover', 'coverHeadline']) {
            expect(typeof parsed.caps[field]).toBe('number');
        }
        expect(parsed.caps.coverHeadline).toBe(MAX_HEADLINE_CHARS);
        expect(parsed.banned.length).toBeGreaterThan(0);
        expect(parsed.banned).not.toContain('第261120期 · 当日要点');
    });

    it('points the write mode at the frozen identity module (R4 seam)', () => {
        expect(SKILL).toContain('plugins/kk/scripts/episode-identity.ts');
        expect(SKILL).toContain('第<YYMMDD>期 · 当日要点');
        expect(SKILL).toContain('0385 R2');
    });
});

/**
 * The render seam: `daily-editorial-render` is where the episode identity is frozen, and where a
 * point that lost its supporting source is withheld instead of being published unsupported. The
 * plan (`03_plan_plan.json`) is the admission set; the master script plan holds the cover point.
 */
describe('0385 editorial-render freezes the episode identity', () => {
    const DATE = '20261120';

    const render = (options: {
        docs: Record<string, unknown>[];
        cover: unknown;
        articleTitle?: string;
        /** The article Content does not exist yet — the FIRST-RUN order of `generate-render`. */
        noArticle?: boolean;
        articleMetadata?: Record<string, unknown>;
        /** The script plan's own `excluded` list (one of the two drop signals admission honours). */
        planExcluded?: unknown;
        /** Per-item insight override; a blank value exercises 0385 R3's optional comment. */
        insights?: Record<string, string>;
        /** Keep the sandbox after the render so the caller can drive a later stage (it then cleans up). */
        keepWorkDir?: boolean;
        sidecar?: unknown;
    }): {
        workDir: string;
        identity: Record<string, unknown>;
        article: Record<string, unknown>;
        articleExists: boolean;
        articleBody: string;
        brief: Record<string, unknown>;
    } => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-0385-'));
        const planDir = join(workDir, '21-plan');
        const scriptDir = join(workDir, '24-script');
        mkdirSync(planDir, { recursive: true });
        mkdirSync(scriptDir, { recursive: true });
        mkdirSync(join(workDir, '22-article'), { recursive: true });
        writeFileSync(join(planDir, `${DATE}_03_plan_plan.json`), JSON.stringify(options.docs));
        writeFileSync(
            join(scriptDir, `${DATE}_08_script-write_plan.json`),
            JSON.stringify({
                outro: '下期见。',
                cover: options.cover,
                ...(options.planExcluded !== undefined ? { excluded: options.planExcluded } : {}),
                items: options.docs.map((doc) => ({
                    id: doc.id,
                    lead: '导语。',
                    insight: options.insights?.[String(doc.id)] ?? '洞见。',
                })),
            }),
        );
        const articlePath = join(workDir, '22-article', `${DATE}_06_article_content.json`);
        if (options.noArticle !== true) {
            writeFileSync(
                articlePath,
                JSON.stringify({
                    title: options.articleTitle ?? '每日AI乱炖 · 2026-11-20',
                    body: `# ${options.articleTitle ?? '每日AI乱炖 · 2026-11-20'}\n\n正文。\n`,
                    metadata: options.articleMetadata ?? {},
                }),
            );
        }
        if (options.sidecar !== undefined) {
            writeFileSync(join(planDir, `${DATE}_05_script_identity.json`), JSON.stringify(options.sidecar));
        }
        dailyEditorialRender([workDir, DATE, 'false', '6']);
        const read = (path: string): Record<string, unknown> =>
            JSON.parse(readFileSync(join(workDir, path), 'utf-8')) as Record<string, unknown>;
        const articleExists = existsSync(articlePath);
        const result = {
            workDir,
            identity: read(`21-plan/${DATE}_05_script_identity.json`),
            article: articleExists ? read(`22-article/${DATE}_06_article_content.json`) : {},
            articleExists,
            articleBody: existsSync(join(workDir, '22-article', `${DATE}_06_article-write_body.md`))
                ? readFileSync(join(workDir, '22-article', `${DATE}_06_article-write_body.md`), 'utf-8')
                : '',
            brief: read(`23-cover/${DATE}_07_cover-brief.json`),
        };
        if (options.keepWorkDir !== true) rmSync(workDir, { recursive: true, force: true });
        return result;
    };

    const leadDoc = { id: 'doc-lead', title: '开源模型许可收紧', body: '正文。', sourceUri: '' };
    const secondDoc = { id: 'doc-2', title: '另一条', body: '正文。', sourceUri: '' };

    it('freezes the point, the title, the cover point and the article title together', () => {
        const { identity, article, brief } = render({
            docs: [leadDoc, secondDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧' },
        });
        expect(identity).toMatchObject({
            date: DATE,
            issue: '261120',
            headline: '开源模型许可收紧',
            title: '第261120期 · 开源模型许可收紧',
            status: 'frozen',
            supportingSourceIds: ['doc-lead'],
        });
        // All targets read the one frozen title: the article Content carries it and its H1 agrees.
        expect(article.title).toBe('第261120期 · 开源模型许可收紧');
        expect(String(article.body).startsWith('# 第261120期 · 开源模型许可收紧')).toBe(true);
        expect(identityFromMetadata(article.metadata)?.title).toBe('第261120期 · 开源模型许可收紧');
        // The cover reuses the same point, never a second wording of it.
        expect(brief.headline).toBe(identity.headline);
    });

    it('withholds the title and the cover point when admission drops the headline support', () => {
        const { identity, article, brief } = render({
            docs: [secondDoc], // the lead the headline rests on is gone
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧', sourceIds: ['doc-lead'] },
        });
        expect(identity.status).toBe('support-removed');
        expect(identity.title).toBeNull();
        expect(brief.headline).toBe('');
        // Not silently replaced by the legacy title or the surviving lead's title.
        expect(article.title).toBe('每日AI乱炖 · 2026-11-20');
    });

    it('keeps the identity a retry already froze, even when the point would change', () => {
        const frozen = freezeEpisodeIdentity({
            date: DATE,
            headline: '原先的要点',
            supportingSourceIds: ['doc-lead'],
            admittedSourceIds: ['doc-lead'],
        });
        const { identity, article } = render({
            docs: [leadDoc],
            cover: { scene: 'a dark studio table', headline: '改过的要点' },
            sidecar: frozen,
        });
        expect(identity.title).toBe('第261120期 · 原先的要点');
        expect(article.title).toBe('第261120期 · 原先的要点');
    });

    it('falls back to the episode legacy title when the script plan froze no point (old bundle)', () => {
        const { identity, article } = render({ docs: [leadDoc], cover: 'a dark studio table' });
        expect(identity.status).toBe('no-headline');
        expect(identity.title).toBe('开源模型许可收紧');
        expect(article.title).toBe('开源模型许可收紧');
    });

    it('renders an item that carries no insight, dropping only the comment sentence (R3)', () => {
        const { articleBody } = render({
            docs: [leadDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧' },
            insights: { 'doc-lead': '   ' },
        });
        // The item still renders (heading, lead, body) — an empty comment used to drop the whole item.
        expect(articleBody).toContain('## 开源模型许可收紧');
        expect(articleBody).toContain('导语。');
        expect(articleBody).toContain('正文。');
        // …and no comment paragraph is emitted, so no bare 「。」 segment reaches the article.
        expect(articleBody).not.toContain('\n\n。\n\n');
        expect(articleBody.split('\n\n').some((part) => part.trim() === '。')).toBe(false);
    });

    it('withholds the point when the lead it rests on was dropped from the episode (R4/P3)', () => {
        // The article boundary drop (`metadata.excludedIds`) is a signal show-notes already filters on;
        // the default support (the admitted lead) has to honour it, or the guarantee can never fire.
        const { identity, brief } = render({
            docs: [leadDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧' },
            articleMetadata: { excludedIds: ['doc-lead'] },
        });
        expect(identity.status).toBe('support-removed');
        expect(identity.title).toBeNull();
        expect(brief.headline).toBe('');
    });

    it('withholds the point when the script plan itself excludes the lead (R4/P3)', () => {
        const { identity } = render({
            docs: [leadDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧' },
            planExcluded: [{ id: 'doc-lead', reason: '低价值公关通稿' }],
        });
        expect(identity.status).toBe('support-removed');
        expect(identity.title).toBeNull();
    });

    it('keeps the point when the named support survives even though another id was dropped (R4)', () => {
        const { identity } = render({
            docs: [leadDoc, secondDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧', sourceIds: ['doc-lead'] },
            articleMetadata: { excludedIds: ['doc-2'] },
        });
        expect(identity.status).toBe('frozen');
        expect(identity.title).toBe('第261120期 · 开源模型许可收紧');
    });

    it('keeps a legacy article title untouched when the cover carries no point either', () => {
        const { identity, article, brief } = render({
            docs: [],
            cover: 'a dark studio table',
        });
        expect(identity.status).toBe('no-headline');
        expect(identity.title).toBeNull();
        expect(article.title).toBe('每日AI乱炖 · 2026-11-20');
        expect(brief.headline).toBe('');
    });
});

/**
 * 0385 R4 — the title has to survive BOTH orders `generate-render` can run in. `daily-editorial-render`
 * runs before `daily-article`, so on a first run its stamp has nothing to write to; on a retry
 * `daily-article` re-derives (proseStale) and overwrites whatever was stamped. `applyEpisodeIdentityToArticle`
 * is the seam `daily-article` calls in both cases; these tests drive the same two orders.
 */
describe('0385 article title survives the generate-render order', () => {
    const DATE = '20261120';
    const articleRel = `22-article/${DATE}_06_article_content.json`;
    const leadDoc = { id: 'doc-lead', title: '开源模型许可收紧', body: '正文。', sourceUri: '' };

    /** What `daily-article-gen` writes on a derivation: its own legacy title, no identity metadata. */
    const derivedContent = (title: string): string =>
        JSON.stringify({ title, body: `# ${title}\n\n正文重新生成。\n`, metadata: {} });

    const render = (options: {
        docs: Record<string, unknown>[];
        cover: unknown;
        noArticle?: boolean;
        keepWorkDir?: boolean;
    }): { workDir: string; identity: Record<string, unknown>; articleExists: boolean } => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-0385-order-'));
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '24-script'), { recursive: true });
        mkdirSync(join(workDir, '22-article'), { recursive: true });
        writeFileSync(join(workDir, '21-plan', `${DATE}_03_plan_plan.json`), JSON.stringify(options.docs));
        writeFileSync(
            join(workDir, '24-script', `${DATE}_08_script-write_plan.json`),
            JSON.stringify({
                outro: '下期见。',
                cover: options.cover,
                items: options.docs.map((doc) => ({ id: doc.id, lead: '导语。', insight: '洞见。' })),
            }),
        );
        if (options.noArticle !== true) {
            writeFileSync(join(workDir, articleRel), derivedContent('每日AI乱炖 · 2026-11-20'));
        }
        dailyEditorialRender([workDir, DATE, 'false', '6']);
        const identity = JSON.parse(
            readFileSync(join(workDir, '21-plan', `${DATE}_05_script_identity.json`), 'utf-8'),
        ) as Record<string, unknown>;
        return { workDir, identity, articleExists: existsSync(join(workDir, articleRel)) };
    };

    it('first run: the stamp waits for the article, then applies one frozen title', () => {
        const { workDir, identity, articleExists } = render({
            docs: [leadDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧' },
            noArticle: true,
            keepWorkDir: true,
        });
        // The editorial-render stamp is a no-op here — there is no article Content yet, and the run
        // must still freeze the identity (this is the file `daily-article` reads).
        expect(articleExists).toBe(false);
        expect(identity.status).toBe('frozen');
        expect(identity.title).toBe('第261120期 · 开源模型许可收紧');

        // `daily-article` derives the Content from the prose body — a fresh legacy title, no identity.
        writeFileSync(join(workDir, articleRel), derivedContent('每日AI乱炖 · 2026-11-20'));
        const applied = applyEpisodeIdentityToArticle(workDir, DATE, join(workDir, articleRel));
        expect(applied?.title).toBe('第261120期 · 开源模型许可收紧');

        const stamped = JSON.parse(readFileSync(join(workDir, articleRel), 'utf-8')) as {
            title: string;
            body: string;
            metadata: Record<string, unknown>;
        };
        // Surfdash/show-notes read `title`; ID3/RSS read the same record from the metadata.
        expect(stamped.title).toBe('第261120期 · 开源模型许可收紧');
        expect(stamped.body.startsWith('# 第261120期 · 开源模型许可收紧')).toBe(true);
        expect(identityFromMetadata(stamped.metadata)?.title).toBe(stamped.title);
        rmSync(workDir, { recursive: true, force: true });
    });

    it('retry: a proseStale re-derivation cannot wipe the stamped title or its metadata', () => {
        const { workDir } = render({
            docs: [leadDoc],
            cover: { scene: 'a dark studio table', headline: '开源模型许可收紧' },
            keepWorkDir: true,
        });
        // The retry order: editorial-render stamps the existing Content first…
        const afterRender = JSON.parse(readFileSync(join(workDir, articleRel), 'utf-8')) as {
            title: string;
            metadata: Record<string, unknown>;
        };
        expect(afterRender.title).toBe('第261120期 · 开源模型许可收紧');

        // …then `daily-article` re-derives because the prose body is newer (proseStale) and the
        // generator overwrites the Content wholesale. Without the article seam the title is gone.
        writeFileSync(join(workDir, articleRel), derivedContent('每日AI乱炖 · 2026-11-20'));
        const applied = applyEpisodeIdentityToArticle(workDir, DATE, join(workDir, articleRel));
        expect(applied?.title).toBe('第261120期 · 开源模型许可收紧');

        const restamped = JSON.parse(readFileSync(join(workDir, articleRel), 'utf-8')) as {
            title: string;
            metadata: Record<string, unknown>;
        };
        expect(restamped.title).toBe('第261120期 · 开源模型许可收紧');
        // The identity record survived the re-derivation, so publish-prep still sees one title.
        expect(identityFromMetadata(restamped.metadata)?.title).toBe('第261120期 · 开源模型许可收紧');
        rmSync(workDir, { recursive: true, force: true });
    });

    it('leaves the Content untouched when no identity was frozen (nothing to share)', () => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-0385-none-'));
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '22-article'), { recursive: true });
        writeFileSync(join(workDir, articleRel), derivedContent('每日AI乱炖 · 2026-11-20'));
        expect(applyEpisodeIdentityToArticle(workDir, DATE, join(workDir, articleRel))).toBeNull();
        const untouched = JSON.parse(readFileSync(join(workDir, articleRel), 'utf-8')) as { title: string };
        expect(untouched.title).toBe('每日AI乱炖 · 2026-11-20');
        rmSync(workDir, { recursive: true, force: true });
    });
});
