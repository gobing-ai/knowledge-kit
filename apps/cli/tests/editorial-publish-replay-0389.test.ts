import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    composeEpisodeTitle,
    freezeEpisodeIdentity,
    identityFromMetadata,
} from '../../../plugins/kk/scripts/episode-identity';

/**
 * 0384's ledger, loaded at RUNTIME with a computed specifier.
 *
 * `plugins/kk` is not a workspace package and was never type-checked by any tsconfig, so a static
 * import would drag that file into this program and fail `bun run lint` on unrelated strictness
 * errors. The replay only needs three entry points, declared here as the contract it relies on —
 * which is also the point of the task: the replay pins the SURFACE, not the plugin's internals.
 */
const LEDGER_MODULE = `${import.meta.dir}/../../../plugins/kk/scripts/news-editorial-ledger.ts`;

interface JudgmentProposal {
    version: number;
    judgments: Array<Record<string, unknown>>;
}

interface LedgerApi {
    commitAlignment(input: Record<string, unknown>): Promise<{
        status: string;
        appended: string[];
        superseded?: string[];
        correctionIds?: string[];
    }>;
    validateProposal(proposal: unknown, selectedIds: Set<string>): { errors: string[] };
    parseConclusion(markdown: string): { error?: string };
}

async function ledgerApi(): Promise<LedgerApi> {
    // A computed specifier keeps the plugin file out of this workspace's TS program.
    return (await import(LEDGER_MODULE)) as LedgerApi;
}

import {
    readFrozenCorrections,
    renderCorrectionsBlock,
} from '../../../plugins/publishings/podcast-pub/src/corrections';
import { renderBriefShowNotes } from '../../../plugins/publishings/podcast-pub/src/show-notes-brief';
import {
    carryOfficialAccountLink,
    gateChannelsCard,
    OFFICIAL_ACCOUNT_PLACEHOLDER,
    verifyOfficialAccountUrl,
} from '../src/publish-channels-link';
import {
    applyDispatchResults,
    type DispatchTarget,
    dispatchable,
    planDispatch,
    readDispatchLedger,
    resolveFrozenRunDate,
    retryable,
    writeDispatchLedger,
} from '../src/publish-dispatch';
import { BundleSchema } from '../src/publish-matrix';

/**
 * 0389 — L3 R1 replay of the editorial → publish chain over FROZEN fixtures carried from the batch's
 * finished tasks, asserting the three-way responsibility split observably:
 *
 *  1. **deterministic validation is code-owned** — the ledger commit, the bundle/plan schemas, the
 *     channels gate and the correction reader are the surfaces that REFUSE a bad input;
 *  2. **editorial judgement is agent-owned** — the skill surface authors the judgment proposal; the
 *     code validates its shape and never judges the story;
 *  3. **per-target adaptation is plugin-owned** — the podcast renderer owns the notes/correction
 *     markup, the Channels card payload stays with `shipinhao-pub`, and the CLI only carries a
 *     confirmed link; no adapter content is duplicated in `apps/cli`.
 *
 * READ-ONLY by construction: every artifact below is written into a fresh `mkdtempSync` directory
 * (the production store, the run directory and the network are never touched), and the fixtures are
 * the frozen projections the finished tasks actually produce — 0384's judgment ledger/snapshot,
 * 0385's episode identity, 0386's show-notes payload, 0388's dispatch ledger, 0395's Channels gate
 * and 0396's correction block.
 *
 * The static assertions are the mutation-sensitive half: moving a validator into a prompt, or
 * copying a plugin's adaptation into the CLI, fails this file.
 */

const RUN_DATE = '2026-11-19';
const BUNDLE_ID = 'bundle-20261119-r1';
const NOW = '2026-11-19T06:00:00.000Z';
const REPO = resolve(import.meta.dir, '../../..');

const tmpRoots: string[] = [];

function freshDir(label: string): string {
    const dir = mkdtempSync(join(tmpdir(), `kk-0389-${label}-`));
    tmpRoots.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

/** 0384 — the agent's `align` output: judgement, as data. */
function agentProposal(overrides: Record<string, unknown> = {}, proposalId = 'j-20261119-openai'): JudgmentProposal {
    return {
        version: 1,
        judgments: [
            {
                id: proposalId,
                selectedId: 'doc-openai-weights',
                storyKey: 'openai-open-weights',
                date: RUN_DATE,
                fact: 'OpenAI 公开发布了一组可商用权重。',
                attribution: 'OpenAI 官方博客',
                comment: '权重开放把自建推理的成本压到可承受区间。',
                evidence: { url: 'https://openai.com/blog/open-weights', checkedAt: NOW },
                supersedes: null,
                ...overrides,
            },
        ],
    };
}

/** The 0386 fixture: the settled spoken items with 0394 citation provenance. */
const SPOKEN_DOCS = [
    {
        id: 'doc-openai-weights',
        title: '开源权重把推理成本压到自建区间',
        body: 'OpenAI 公开发布了一组可商用权重。自建集群的每百万 token 成本降到原来的三分之一。',
        sourceUri: 'https://openai.com/blog/open-weights',
        metadata: { brief: '权重开放，自建推理成本降到三分之一。', sourceName: 'OpenAI 官方博客' },
    },
    {
        id: 'doc-eu-procurement',
        title: '欧洲把模型许可审查写进采购规则',
        body: '欧盟采购规则要求供应商披露训练数据来源。合规团队需要提前准备材料。',
        sourceUri: 'https://example.eu/digital-procurement',
        metadata: { brief: '采购新规要求披露训练数据来源。', sourceName: 'EU Digital' },
    },
];

const SEGMENTS = [{ duration: 132 }, { duration: 96 }];

describe('0389 replay — the editorial half: agent judges, code validates and commits (0384/0385)', () => {
    it('commits an agent-authored judgment through the deterministic ledger, then freezes the episode identity', async () => {
        const dir = freshDir('editorial');
        const ledgerPath = join(dir, 'kk-news-generate', 'conclusion.md');
        const snapshotPath = join(dir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`);
        const receiptPath = join(dir, '21-plan', `${RUN_DATE}_judgment-commit.json`);

        const { commitAlignment } = await ledgerApi();
        const first = await commitAlignment({
            ledgerPath,
            snapshotPath,
            receiptPath,
            proposal: agentProposal() as unknown as Record<string, unknown>,
            selectedIds: new Set(['doc-openai-weights']),
            runDate: RUN_DATE,
            runId: 'run-20261119',
            now: NOW,
        });
        expect(first.status).toBe('applied');
        expect(first.appended).toEqual(['j-20261119-openai']);
        expect(existsSync(ledgerPath)).toBe(true);

        // A retry of the SAME proposal appends nothing (0384's no-op replay protection).
        const replay = await commitAlignment({
            ledgerPath,
            snapshotPath,
            receiptPath,
            proposal: agentProposal() as unknown as Record<string, unknown>,
            selectedIds: new Set(['doc-openai-weights']),
            runDate: RUN_DATE,
            runId: 'run-20261119',
            now: NOW,
        });
        expect(replay.appended).toEqual([]);
        expect(['no-op', 'applied']).toContain(replay.status);

        // 0385 — one episode carries one frozen identity, and a replay reads it back unchanged.
        const identity = freezeEpisodeIdentity({
            date: RUN_DATE,
            headline: '开源权重把推理成本压到自建区间',
            supportingSourceIds: ['doc-openai-weights'],
            admittedSourceIds: ['doc-openai-weights', 'doc-eu-procurement'],
        });
        expect(identity.title ?? null).toBe(composeEpisodeTitle(RUN_DATE, '开源权重把推理成本压到自建区间'));
        expect((identity.title ?? '').startsWith('第261119期 · ')).toBe(true);
        expect(identityFromMetadata({ episodeIdentity: identity })).toEqual(identity);
    });

    it('refuses an agent proposal that cites an unselected id — the refusal is code, not prose', async () => {
        const { validateProposal, parseConclusion } = await ledgerApi();
        const refused = validateProposal(
            agentProposal({ selectedId: 'doc-not-selected' }),
            new Set(['doc-openai-weights']),
        );
        expect(refused.errors.length).toBeGreaterThan(0);
        expect(refused.errors[0]).toContain('doc-not-selected');

        // And the code owns the ledger's machine block format: a corrupt ledger is a parse error,
        // never a silent rebuild.
        const corrupt = parseConclusion(`${'<!-- kk:judgment-ledger:begin -->'}\n{not json`);
        expect(corrupt.error).toBeTruthy();
    });
});

describe('0389 replay — 0396 corrections ride the frozen 0384 snapshot into the 0386 notes', () => {
    it('projects a superseded judgment into the podcast correction block and the brief notes', async () => {
        const dir = freshDir('corrections');
        const ledgerPath = join(dir, 'kk-news-generate', 'conclusion.md');
        const snapshotPath = join(dir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`);
        const receiptPath = join(dir, '21-plan', `${RUN_DATE}_judgment-commit.json`);

        // Day 1: the judgment that will later be found wrong.
        const { commitAlignment } = await ledgerApi();
        await commitAlignment({
            ledgerPath,
            snapshotPath,
            receiptPath,
            proposal: agentProposal() as unknown as Record<string, unknown>,
            selectedIds: new Set(['doc-openai-weights']),
            runDate: RUN_DATE,
            runId: 'run-20261119',
            now: NOW,
        });
        // Day 2: the agent corrects itself and the replacement supersedes the first judgment.
        const correction = await commitAlignment({
            ledgerPath,
            snapshotPath,
            receiptPath,
            proposal: agentProposal(
                {
                    id: 'j-20261120-openai-fixed',
                    date: '2026-11-20',
                    fact: 'OpenAI 公开发布的权重并非全量可商用。',
                    comment: '可商用仅限研究用途，商业部署仍需单独授权。',
                    evidence: {
                        url: 'https://openai.com/blog/open-weights-license',
                        checkedAt: '2026-11-20T06:00:00.000Z',
                    },
                    supersedes: 'j-20261119-openai',
                },
                'j-20261120-openai-fixed',
            ),
            selectedIds: new Set(['doc-openai-weights']),
            runDate: '2026-11-20',
            runId: 'run-20261120',
            now: '2026-11-20T06:00:00.000Z',
        });
        expect(correction.superseded).toEqual(['j-20261119-openai']);
        expect((correction.correctionIds ?? []).length).toBe(1);

        // 0396 — the frozen snapshot is the correction provider; the reader is tolerant by contract.
        const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as Record<string, unknown>;
        const set = readFrozenCorrections(snapshot, { runDate: '2026-11-20' });
        expect(set.corrections.length).toBeGreaterThan(0);
        const block = renderCorrectionsBlock(set);
        expect(block).not.toBeNull();
        expect(block as string).toContain('本期更正说明');
        expect(block as string).toContain('2026-11-19');

        // An absent/odd snapshot owes no correction — never a fabricated block.
        const empty = readFrozenCorrections(null);
        expect(empty.corrections).toEqual([]);
        expect(renderCorrectionsBlock(empty)).toBeNull();

        // 0386 — the notes render the frozen title, the 0394 sources and the 0396 block in one render.
        const { markdown } = renderBriefShowNotes({
            title: composeEpisodeTitle('2026-11-20', '权重许可收紧'),
            docs: SPOKEN_DOCS,
            articleUrl: '',
            audioSegments: SEGMENTS,
            cards: undefined,
        });
        expect(markdown).toContain('第261120期 · 权重许可收紧');
        expect(markdown).toContain('openai.com');
        expect(markdown).toContain('待文章发布回执');
        expect(`${markdown}\n${block}`).toContain('本期更正说明');
    });
});

describe('0389 replay — the publish half: one frozen date, one dispatch ledger, one Channels gate (0388/0395)', () => {
    const PRESET: DispatchTarget[] = [
        {
            plugin: 'surfdash-pub',
            operation: 'post',
            variant: 'article',
            tier: 0,
            window: 'after-generate',
            mode: 'live',
        },
        {
            plugin: 'podcast-pub',
            operation: 'publish',
            variant: 'podcast',
            tier: 0,
            window: 'after-generate',
            mode: 'live',
        },
        {
            plugin: 'wechatmp-pub',
            operation: 'article',
            variant: 'article',
            tier: 1,
            window: 'after-generate',
            mode: 'live',
        },
        {
            plugin: 'shipinhao-pub',
            operation: 'image',
            variant: 'card',
            tier: 2,
            window: 'after-generate',
            mode: 'live',
        },
    ];

    it('freezes the day from the bundle and dispatches every ready target exactly once across windows', async () => {
        const dir = freshDir('publish');
        const frozen = resolveFrozenRunDate({ bundleRunDate: RUN_DATE, window: 'after-generate' });
        expect(frozen).toEqual({ runDate: RUN_DATE, source: 'bundle', pinned: true });

        // Trigger 1 — tier 0 only is ready: the article and the card are gated on their producers.
        const first = planDispatch({
            runDate: frozen.runDate,
            window: 'after-generate',
            targets: PRESET,
            frozenSource: frozen.source,
            bundleRunId: BUNDLE_ID,
            ledger: null,
        });
        expect(dispatchable(first).map((entry) => entry.id)).toEqual(['surfdash-pub@post', 'podcast-pub@publish']);
        const articleRow = first.entries.find((entry) => entry.id === 'wechatmp-pub@article');
        expect(articleRow?.state).toBe('blocked');
        expect(articleRow?.blockedBy).toEqual(['surfdash-pub@post', 'podcast-pub@publish']);
        // The WeChat row is a DRAFT with the manual QR step, never an auto-published live article.
        expect(articleRow?.mode).toBe('draft');
        expect(articleRow?.manualStep).toBe('qr-scan');

        // Write + read the ledger through the node filesystem port (the real 0388 artifact path).
        const fs = createNodeFileSystem();
        await writeDispatchLedger(fs, dir, first);
        const readBack = await readDispatchLedger(fs, dir);
        expect(readBack?.runDate).toBe(RUN_DATE);
        expect(readBack?.entries.filter((entry) => entry.state === 'dispatched').length).toBe(0);

        // Trigger 2 — the tier-0 effects are adopted, not re-run, and tier 1 unblocks.
        const settled = applyDispatchResults(first, [
            { id: 'surfdash-pub@post', ok: true, url: 'https://surfdash.example/posts/1' },
            { id: 'podcast-pub@publish', ok: true, url: 'https://podcast.example/episodes/1' },
        ]);
        const second = planDispatch({
            runDate: RUN_DATE,
            window: 'after-generate',
            targets: PRESET,
            frozenSource: frozen.source,
            bundleRunId: BUNDLE_ID,
            ledger: settled,
        });
        expect(dispatchable(second).map((entry) => entry.id)).toEqual(['wechatmp-pub@article']);
        expect(second.entries.filter((entry) => entry.state === 'dispatched').length).toBe(2);
        // The card still waits on the article: a dependency, not a bypass.
        const card = second.entries.find((entry) => entry.id === 'shipinhao-pub@image');
        expect(card?.state).toBe('blocked');
        expect(card?.blockedBy).toEqual(['wechatmp-pub@article']);

        // Trigger 3 — the confirmed article unblocks the Channels card.
        const confirmed = applyDispatchResults(second, [
            { id: 'wechatmp-pub@article', ok: true, url: 'https://mp.weixin.qq.com/s/abc123' },
        ]);
        const third = planDispatch({
            runDate: RUN_DATE,
            window: 'after-generate',
            targets: PRESET,
            frozenSource: frozen.source,
            bundleRunId: BUNDLE_ID,
            ledger: confirmed,
        });
        expect(dispatchable(third).map((entry) => entry.id)).toEqual(['shipinhao-pub@image']);

        // A per-target failure becomes a retry row, and only that row is retried.
        const failed = applyDispatchResults(third, [{ id: 'shipinhao-pub@image', ok: false, error: 'ui drift' }]);
        expect(retryable(failed).map((entry) => entry.id)).toEqual(['shipinhao-pub@image']);
        const fourth = planDispatch({
            runDate: RUN_DATE,
            window: 'after-generate',
            targets: PRESET,
            frozenSource: frozen.source,
            bundleRunId: BUNDLE_ID,
            ledger: failed,
        });
        expect(fourth.entries.filter((entry) => entry.state === 'dispatched').length).toBe(3);
        expect(retryable(fourth).map((entry) => entry.id)).toEqual(['shipinhao-pub@image']);
    });

    it('binds the Channels card to a CONFIRMED same-bundle article, and blocks every other shape', () => {
        const receipts = [
            {
                targetId: 'wechatmp-pub@article',
                bundleRunId: BUNDLE_ID,
                status: 'published',
                mode: 'live',
                url: 'https://mp.weixin.qq.com/s/confirmed',
            },
            {
                targetId: 'wechatmp-pub@article',
                bundleRunId: 'bundle-20261118-r1',
                status: 'published',
                mode: 'live',
                url: 'https://mp.weixin.qq.com/s/stale',
            },
        ];
        const pass = gateChannelsCard({ receipts, parentRunId: BUNDLE_ID, producerIds: ['wechatmp-pub@article'] });
        expect(pass).toEqual({
            ok: true,
            url: 'https://mp.weixin.qq.com/s/confirmed',
            receiptId: 'wechatmp-pub@article',
        });

        // Only yesterday's article exists for this bundle ⇒ the gate refuses (never a foreign link).
        const stale = gateChannelsCard({
            receipts: [receipts[1] as (typeof receipts)[number]],
            parentRunId: BUNDLE_ID,
            producerIds: ['wechatmp-pub@article'],
        });
        expect(stale.ok).toBe(false);
        if (stale.ok) throw new Error('expected a refusal');
        expect(stale.reason).toBe('article-not-published');

        // A draft article is not a confirmed link.
        const draft = gateChannelsCard({
            receipts: [
                {
                    targetId: 'wechatmp-pub@article',
                    bundleRunId: BUNDLE_ID,
                    status: 'draft',
                    mode: 'draft',
                    url: 'https://mp.weixin.qq.com/s/draft',
                },
            ],
            parentRunId: BUNDLE_ID,
            producerIds: ['wechatmp-pub@article'],
        });
        expect(draft.ok).toBe(false);
        if (draft.ok) throw new Error('expected a refusal');
        expect(draft.reason).toBe('article-still-draft');

        // No article target planned ⇒ nothing to bind.
        const notPlanned = gateChannelsCard({ receipts, parentRunId: BUNDLE_ID, producerIds: [] });
        if (notPlanned.ok) throw new Error('expected a refusal');
        expect(notPlanned.reason).toBe('article-not-planned');

        // The URL verifier is the code-owned half of that gate.
        expect(verifyOfficialAccountUrl('https://evil.example/s/abc').ok).toBe(false);
        expect(verifyOfficialAccountUrl('javascript:alert(1)').ok).toBe(false);
        expect(verifyOfficialAccountUrl('https://mp.weixin.qq.com/s/confirmed').ok).toBe(true);

        // 0395 carriage: the reviewed card body keeps its bytes; only the link rides along.
        const payload = JSON.stringify({
            body: `已审核的卡片文案 ${OFFICIAL_ACCOUNT_PLACEHOLDER}`,
            images: ['a.png'],
            metadata: { draft: 1 },
        });
        const carried = carryOfficialAccountLink(payload, 'https://mp.weixin.qq.com/s/confirmed');
        expect(carried.placement).toBe('placeholder');
        const carriedPayload = JSON.parse(carried.text) as {
            body: string;
            images: string[];
            metadata: Record<string, unknown>;
        };
        expect(carriedPayload.body).toBe('已审核的卡片文案 https://mp.weixin.qq.com/s/confirmed');
        expect(carriedPayload.images).toEqual(['a.png']);
        expect(carriedPayload.metadata.draft).toBe(1);
        // Idempotent: a retry neither duplicates the link nor rewrites the reviewed body.
        const again = JSON.parse(
            carryOfficialAccountLink(carried.text, 'https://mp.weixin.qq.com/s/confirmed').text,
        ) as {
            body: string;
            metadata: Record<string, unknown>;
        };
        expect(again.body).toBe(carriedPayload.body);
        expect(again.body.split('https://mp.weixin.qq.com/s/confirmed').length).toBe(2);
    });

    it('rejects a malformed bundle/date at the schema boundary instead of dispatching it', () => {
        const bundle = {
            schemaVersion: 1,
            runId: BUNDLE_ID,
            runDate: RUN_DATE,
            contentType: 'news',
            title: '第261119期 · 权重许可收紧',
            parentRunId: BUNDLE_ID,
            runs: [BUNDLE_ID],
            episode: { title: '第261119期 · 权重许可收紧', guid: 'kk-20261119' },
            variants: { podcast: { path: 'variants/podcast.json', sha256: 'a'.repeat(64) } },
            safety: {
                status: 'pass',
                digest: 'b'.repeat(64),
                excludedPlatforms: [],
                variants: { podcast: 'a'.repeat(64) },
            },
        };
        expect(BundleSchema.safeParse(bundle).success).toBe(true);
        // A blocked safety verdict is unrepresentable in a bundle, and an unknown top-level key is
        // refused: the freeze is the code-owned half of the generate → publish handover.
        expect(BundleSchema.safeParse({ ...bundle, safety: { ...bundle.safety, status: 'block' } }).success).toBe(
            false,
        );
        expect(BundleSchema.safeParse({ ...bundle, publishPreset: 'daily-ai-voice' }).success).toBe(false);
        expect(BundleSchema.safeParse({ ...bundle, variants: { podcast: { path: 'x.json' } } }).success).toBe(false);
        // A non-calendar day stops the launch before any dispatch.
        expect(() => resolveFrozenRunDate({ runDate: '2026-13-40', window: 'after-generate' })).toThrow();
    });
});

// ── the responsibility split itself: static, mutation-sensitive boundary assertions ───────────────

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, out);
        else out.push(path);
    }
    return out;
}

function readTree(dir: string, extensions: readonly string[]): Array<{ path: string; text: string }> {
    if (!existsSync(dir)) return [];
    return walk(dir)
        .filter((path) => extensions.some((ext) => path.endsWith(ext)))
        .map((path) => ({ path, text: readFileSync(path, 'utf-8') }));
}

describe('0389 R1 — the three-way responsibility split is observable at the boundary', () => {
    it('keeps deterministic validation in code: prompts and skills carry no schema or validator', () => {
        const agentSurfaces = [
            ...readTree(join(REPO, 'plugins/kk/skills'), ['.md']),
            ...readTree(join(REPO, 'plugins/kk/workflows'), ['.yaml']),
            ...readTree(join(REPO, 'plugins/kk/commands'), ['.md']),
        ];
        expect(agentSurfaces.length).toBeGreaterThan(10);
        const violations = agentSurfaces.filter(({ text }) => /z\.object\(|\.safeParse\(|zod|ZodError/.test(text));
        expect(violations.map(({ path }) => path)).toEqual([]);

        // The validators exist, and they are code: each of these modules exports its own refusal.
        const code = [
            'plugins/kk/scripts/news-editorial-ledger.ts',
            'apps/cli/src/publish-matrix.ts',
            'apps/cli/src/publish-channels-link.ts',
            'plugins/publishings/podcast-pub/src/corrections.ts',
        ];
        for (const relative of code) {
            const text = readFileSync(join(REPO, relative), 'utf-8');
            expect(text).toMatch(/export (function|const) [a-zA-Z]*(valid|verify|read|resolve|gate|parse)/i);
        }
    });

    it('keeps editorial judgement agent-owned: the skill authors it, the code only validates shape', () => {
        const skill = readFileSync(join(REPO, 'plugins/kk/skills/news-editorial/SKILL.md'), 'utf-8');
        // The skill declares the split and holds the judgement policy.
        // (line-wrapped in the source, so the declaration is matched as prose)
        expect(skill).toMatch(/Everything deterministic stays\s+in code/);
        expect(skill).toMatch(/选题边界|新闻优先/);

        // The ledger code must not carry the judgement vocabulary — moving policy into code fails here.
        const ledger = readFileSync(join(REPO, 'plugins/kk/scripts/news-editorial-ledger.ts'), 'utf-8');
        for (const policy of ['新闻优先', '选题边界', '白领', 'style-contract']) {
            expect(ledger).not.toContain(policy);
        }
        // …and it must not be the surface that reads the skill: the prompt hands the proposal in.
        expect(ledger).not.toContain('skills/news-editorial');
        // The agent-facing surface is where the judgement modes are wired.
        expect(skill).toContain('| `align` |');
    });

    it('keeps per-target adaptation plugin-owned: no adapter markup or formatter lives in the CLI', () => {
        // Plugin-owned adaptation literals: the show-notes/correction/card markup of the podcast and
        // Channels adapters. Each is defined once, inside its plugin package.
        const adapters: Array<{ literal: string; owner: string }> = [
            { literal: '<!--kk:timeline-->', owner: 'plugins/publishings/podcast-pub/src' },
            { literal: '<!--kk:corrections-->', owner: 'plugins/publishings/podcast-pub/src' },
            { literal: 'kk-tl-row', owner: 'plugins/publishings/podcast-pub/src' },
        ];
        for (const { literal, owner } of adapters) {
            const owned = readTree(join(REPO, owner), ['.ts']).filter(({ text }) => text.includes(literal));
            expect(owned.length).toBeGreaterThan(0);
            const cliCopies = readTree(join(REPO, 'apps/cli/src'), ['.ts']).filter(({ text }) =>
                text.includes(literal),
            );
            expect(cliCopies.map(({ path }) => path)).toEqual([]);
        }

        // The CLI never imports an adapter package: adaptation crosses that boundary through the
        // executor port, so a duplicated adapter in `apps/cli` shows up as an import.
        const cliImports = readTree(join(REPO, 'apps/cli/src'), ['.ts'])
            .filter(({ text }) => /from '[^']*plugins\/publishings\//.test(text) || /@gobing-ai\/[a-z]+-pub/.test(text))
            .map(({ path }) => path);
        expect(cliImports).toEqual([]);

        // Every publish plugin owns its own operation set — the matrix in the CLI only picks modes.
        const pluginDirs = readdirSync(join(REPO, 'plugins/publishings'));
        expect(pluginDirs.length).toBeGreaterThan(10);
        for (const name of pluginDirs) {
            const entry = join(REPO, 'plugins/publishings', name, 'src/index.ts');
            expect(existsSync(entry)).toBe(true);
            expect(readFileSync(entry, 'utf-8')).toMatch(
                /export (const|type) [A-Z_]+OPERATION|export async function processPublishIO/,
            );
        }
    });
});
