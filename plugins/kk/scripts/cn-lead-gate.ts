#!/usr/bin/env bun
/**
 * Deterministic CN-platform lead gate (task 0433).
 *
 * Incident 2026-11-24 (`.works/kk-news-generate/20261124`): the curator led the episode with
 * 英伟达董事会恢复黄仁勋职务并新设国家安全与出口管制委员会 — the day's biggest story, and exactly the
 * mainline the CN platforms block. The variants safety review graded it afterwards (`XY-02` 小宇宙,
 * `WX-01` 公众号, both `block`), `bundle.safety.excludedPlatforms` dropped `podcast-pub.episode` and
 * `wechatmp-pub.文章`, and the day paid for a 12.6 min / 753 s TTS pass it could only deliver to
 * surfdash + 视频号 + 即刻. The pipeline was right; the editorial selection never considered the surface it
 * was writing for.
 *
 * This module is the pre-spend half of 0433 R3/R4: a PURE function, no LLM call, that fails the plan
 * when the LEAD title/summary trips the CN-blocked mainline vocabulary, so the failure lands in the plan
 * stage (`daily-curate-check`, workflow node 5) instead of the post-spend safety verdict (node 19).
 *
 * Scope — deliberately narrow, and it is a *position* constraint, not an exclusion rule:
 *  - Only the lead is scanned (plan index 0), and only its `title` + summary (`metadata.brief`). A body
 *    item may discuss export controls; `news-editorial` SKILL.md shared rule 2 keeps that story IN scope.
 *    What R1 forbids is LEADING a CN-distributed cut with it.
 *  - A hit is not a publish verdict. `content-safety` deliberately refuses to publish a word list, and a
 *    字词命中 stays an input to context judgment there (XY-03). Here the vocabulary only decides whether
 *    the *lead position* is admissible on the CN cut before any money is spent; the post-spend review
 *    keeps its own, contextual say over the whole episode.
 *  - The vocabulary is the machine-readable form of the two shipped platform rules, which stay the source
 *    of truth: `plugins/kk/skills/content-safety/references/platforms/xiaoyuzhou.md` (XY-02,
 *    `时政/公共事务主线：政治、外交/贸易管制、军事、公共政策争议`) and `.../wechatmp.md` (WX-01, same
 *    shape for 图文/音频). Re-verify against those files, not against this table, if a platform ruling
 *    changes — and keep `CN_LEAD_RULE_IDS` naming them in every failure message so the `curate --fix`
 *    pass can fix by rule.
 *  - 2026-11-24 operator ruling (both reference files): XY-02/WX-01 were narrowed to a *domestic-China*
 *    political/social mainline; an overseas vendor under its own regulator's security review is `note`,
 *    not `escalate`. This gate is stricter than that ruling on purpose — it is about the LEAD of a
 *    CN-distributed cut, which is what cost the day its primary channel, and it costs nothing to lead
 *    with the second story instead. See `news-editorial/references/selection.md` § CN lead.
 *
 * Adoption policy (R2, chosen and recorded): DEMOTE, do not fork the cut. The pipeline ships one zh cut
 * and one TTS pass, so a tripping lead is moved to the best body position and the first clean item leads.
 * Tradeoff: the CN surface loses its biggest story from the lead position instead of gaining a second,
 * overseas-only lead — one script, one synthesis bill, no second render path. See selection.md.
 */

/** The shipped platform review items this gate stands on (stable ids — the fix pass routes on them). */
export const CN_LEAD_RULE_IDS = ['XY-02', 'WX-01'] as const;

/** The CN-blocked mainline classes R1 names, one row per class. */
export type CnLeadMainline = 'trade-control' | 'state-security-review' | 'political-affairs';

export interface CnLeadVocabularyRow {
    /** The mainline class, as it reads in the failure message. */
    mainline: CnLeadMainline;
    /** Slash-separated English gloss so an operator reading a refusal knows what tripped. */
    label: string;
    terms: readonly string[];
}

/**
 * The machine-readable vocabulary. Kept to terms that name the MAINLINE of a lead in normal AI-industry
 * copy — a term that survives only as background inside a body paragraph is out of scope by construction
 * (only the lead is scanned). CJK terms match as substrings; Latin terms match from a word boundary and
 * allow a plural/possessive suffix (`export control` → `export controls`), never a bare substring
 * (`war` must not match `software`).
 */
export const CN_LEAD_VOCABULARY: readonly CnLeadVocabularyRow[] = [
    {
        mainline: 'trade-control',
        label: '贸易管制 / 出口管制',
        terms: [
            '出口管制',
            '出口禁令',
            '出口限制',
            '出口许可',
            '出口新规',
            '出口合规',
            '对华出口',
            '对华出货',
            '获准对华',
            '出货需申请',
            '审批许可',
            '许可证制度',
            '贸易管制',
            '贸易战',
            '关税战',
            '加征关税',
            '芯片关税',
            '关税',
            '实体清单',
            '技术封锁',
            '技术禁运',
            '禁运',
            '制裁',
            '反制裁',
            '长臂管辖',
            '商务部',
            'export control',
            'export ban',
            'export restriction',
            'export license',
            'entity list',
            'trade war',
            'tariff',
            'sanction',
            'embargo',
        ],
    },
    {
        mainline: 'state-security-review',
        label: '公共安全审查 / 国家安全审查',
        terms: [
            '国家安全',
            '安全审查',
            '外资审查',
            '外国投资审查',
            '反间谍',
            '间谍',
            '情报法',
            '外国情报',
            '情报机构',
            '网络安全审查',
            '数据出境',
            'national security',
            'security review',
            'espionage',
            'foreign intelligence',
            'cfius',
        ],
    },
    {
        mainline: 'political-affairs',
        label: '时政 / 军事',
        terms: [
            '政治局',
            '人大常委会',
            '全国人大',
            '政协',
            '涉台',
            '台湾问题',
            '选举结果',
            '涉港',
            '国安法',
            '反分裂',
            '军事演习',
            '军演',
            '军事冲突',
            '国防部',
            '军方',
            '美军',
            '军队',
            '外交部',
            '武统',
            '台海',
            '两会',
            '听证',
            '网信办',
            '工信部',
            '中央经济工作会议',
            '军控',
            '军用',
            '情报部门',
            '法案',
            '行政令',
            '国会',
            '国务院',
            '白宫',
            'politburo',
            'military exercise',
            'military conflict',
            'armed forces',
        ],
    },
];

/**
 * The second detector: a policy signal over an AI-industry object.
 *
 * Enumeration alone cannot cover ordinary phrasings (review visit 3 measured 6/23 ordinarily-written
 * class leads caught while 25/33 keyword-dense ones were): `美国拟进一步收紧对华芯片出口` carries no
 * enumerated compound, yet it is exactly the XY-02 class. Requiring BOTH halve keeps it off product
 * news — `新模型…`、`小米发布旗舰手机` and a valuation round carry no policy signal — while any lead
 * that reads as policy acting on the AI industry is caught whatever the wording.
 */
const AI_OBJECT_TERMS: readonly string[] = [
    '芯片',
    '半导体',
    '算力',
    '英伟达',
    '台积电',
    '大模型',
    '模型',
    '人工智能',
    '生成式',
    '数据中心',
    'ai',
    'gpu',
];
/** The nouns a PRODUCT's own terms carry — a policy signal only when a government word is near. */
const PRODUCT_POLICY_WORDS: ReadonlySet<string> = new Set(['政策', '规则', '规范', '指南']);

const POLICY_SIGNAL_TERMS: readonly string[] = [
    '出口',
    '进口',
    '关税',
    '制裁',
    '许可',
    '审查',
    '禁令',
    '禁售',
    '限制',
    '收紧',
    '放宽',
    '新规',
    '规则',
    '政策',
    '办法',
    '行动计划',
    '约谈',
    '规范',
    '指南',
    '法案',
    '监管',
    '调查',
    '豁免',
    '补贴',
    '听证',
    '两会',
    '台海',
    '选举',
    '军方',
    '国防',
];

export interface CnLeadHit {
    /** Which vocabulary class matched. */
    mainline: CnLeadMainline;
    /** The rule ids that class stands on. */
    ruleIds: readonly string[];
    /** The term as written in {@link CN_LEAD_VOCABULARY}. */
    term: string;
    /** The lead surface that carried it. */
    field: 'title' | 'summary';
}

export interface CnLeadScan {
    hits: CnLeadHit[];
    /** Unique matched terms, in vocabulary order — the failure message's evidence. */
    terms: string[];
    /** The rule ids that apply, deduped (`XY-02`, `WX-01`). */
    ruleIds: string[];
}

const LATIN = /^[\x20-\x7e]+$/;

function escapeRegex(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** CJK matching ignores internal whitespace: a translated title may space a term apart. */
function squash(text: string): string {
    return text.replace(/\s+/g, '');
}

/** True when `text` carries `term` — substring for CJK, word-boundary prefix for Latin. */
function trips(text: string, term: string): boolean {
    if (LATIN.test(term)) return new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}`, 'i').test(text);
    return squash(text).includes(squash(term));
}

/** Scan one lead surface (title + summary). Pure; no I/O, no LLM, no state. */
export function scanCnLead(title: string, summary: string): CnLeadScan {
    const hits: CnLeadHit[] = [];
    for (const row of CN_LEAD_VOCABULARY) {
        for (const term of row.terms) {
            for (const [field, text] of [
                ['title', title],
                ['summary', summary],
            ] as const) {
                if (text.trim() !== '' && trips(text, term)) {
                    hits.push({ mainline: row.mainline, ruleIds: CN_LEAD_RULE_IDS, term, field });
                }
            }
        }
    }
    // Second detector: a policy signal over an AI-industry object (see the constant's rationale).
    for (const [field, text] of [
        ['title', title],
        ['summary', summary],
    ] as const) {
        if (text.trim() === '') continue;
        const object = AI_OBJECT_TERMS.find((term) => trips(text, term));
        const policy = POLICY_SIGNAL_TERMS.find((term) => trips(text, term));
        if (object === undefined || policy === undefined) continue;
        // A product's OWN usage policy ("更新模型使用政策/规则/规范") is not a government action on the
        // industry; any government/regulator word in the same surface makes it one again.
        const productPolicy =
            PRODUCT_POLICY_WORDS.has(policy) && !/政府|监管|国家|部门|法案|网信办|工信部|会议/.test(squash(text));
        if (productPolicy) continue;
        hits.push({ mainline: 'trade-control', ruleIds: CN_LEAD_RULE_IDS, term: `${object}+${policy}`, field });
    }
    return {
        hits,
        terms: [...new Set(hits.map((hit) => hit.term))],
        ruleIds: [...new Set(hits.flatMap((hit) => [...hit.ruleIds]))],
    };
}

/**
 * The lead surface of one plan doc: `title` + the summary the episode actually ships.
 *
 * The shipped CN show notes use `metadata.brief`, else the lead's FIRST body sentence
 * (`planItemsForPodcast` in `daily-stages.ts`), so the fallback is scanned too — otherwise a raw
 * `--final` candidate (which never carries a `brief`) has its summary half unscanned while that very
 * sentence reaches the podcast notes (review P3, 0433).
 */
export function leadSurfaceOf(doc: Record<string, unknown>): { id: string; title: string; summary: string } {
    const metadata = doc.metadata;
    const meta = metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
    const body = typeof doc.body === 'string' ? doc.body : '';
    const summary =
        [meta.brief, doc.summary, firstBodySentence(body)].find(
            (value): value is string => typeof value === 'string' && value.trim() !== '',
        ) ?? '';
    return { id: typeof doc.id === 'string' ? doc.id : '', title: String(doc.title ?? ''), summary };
}

/** The lead's first sentence — the shape `planItemsForPodcast` falls back to for the show notes. */
function firstBodySentence(body: string): string {
    return (
        body
            .trim()
            .split(/(?<=[。！？!?\n])/)[0]
            ?.trim() ?? ''
    );
}

/** The failure message. Names the platform rule ids, the terms and the fix, so `--fix` can route. */
export function cnLeadMessage(leadId: string, title: string, scan: CnLeadScan): string {
    return (
        `cn-lead (${CN_LEAD_RULE_IDS.join('/')}): the plan lead [${leadId}] 「${title}」 trips the CN-blocked ` +
        `mainline vocabulary (${scan.terms.join('、')}) — ` +
        `XY-02 (小宇宙) / WX-01 (微信公众号) block a CN-distributed cut whose lead is 时政/贸易管制/公共安全审查. ` +
        'Demote it to a body item and lead with the first clean story; rewrite its title/summary as a neutral ' +
        'headline that names the AI-industry fact (news-editorial references/selection.md § CN lead)'
    );
}

export interface CnLeadPlanVerdict {
    ok: boolean;
    leadId: string | null;
    leadTitle: string;
    hits: CnLeadHit[];
    terms: string[];
    ruleIds: string[];
    /** `''` when ok; otherwise the operator/agent-facing refusal (names XY-02/WX-01). */
    message: string;
}

/**
 * The gate over a plan `Doc[]`: only index 0 is scanned. An empty plan passes — the `empty-plan` rule
 * owns that case, and a second refusal for the same condition would only double-report it.
 */
export function checkCnLeadPlan(docs: readonly Record<string, unknown>[]): CnLeadPlanVerdict {
    const lead = docs[0];
    if (lead === undefined) {
        return { ok: true, leadId: null, leadTitle: '', hits: [], terms: [], ruleIds: [], message: '' };
    }
    const surface = leadSurfaceOf(lead);
    const scan = scanCnLead(surface.title, surface.summary);
    return {
        ok: scan.hits.length === 0,
        leadId: surface.id,
        leadTitle: surface.title,
        hits: scan.hits,
        terms: scan.terms,
        ruleIds: scan.ruleIds,
        message: scan.hits.length === 0 ? '' : cnLeadMessage(surface.id, surface.title, scan),
    };
}

export interface CnLeadEnforcement {
    /** The plan to write. Identical (same array) when nothing had to change. */
    docs: Record<string, unknown>[];
    /** The lead that was moved, and where it now sits (body position, never the last one by rule). */
    demoted: { id: string; from: number; to: number } | null;
    /** Set when EVERY item trips: no safe lead exists, so the caller must refuse before synthesis. */
    blocked: { id: string; message: string } | null;
}

/**
 * R2's chosen behaviour, as code: DEMOTE. When the lead trips, the first item whose lead surface is clean
 * becomes the lead and the tripping story moves to the first body position after it, everything else
 * keeping its relative order. Returns the input array untouched (same reference) when nothing trips, so a
 * caller can persist only what changed.
 *
 * `blocked` is the honest dead end: a pool where every candidate's lead surface trips has no lead this
 * cut may carry, and inventing one would be worse than refusing the day before the TTS spend.
 */
export function enforceCnLead(docs: readonly Record<string, unknown>[]): CnLeadEnforcement {
    const unchanged = docs as Record<string, unknown>[];
    const verdict = checkCnLeadPlan(docs);
    if (verdict.ok) return { docs: unchanged, demoted: null, blocked: null };
    const tripping = docs[0] as Record<string, unknown>;
    const rest = docs.slice(1);
    const cleanIndex = rest.findIndex((entry) => checkCnLeadPlan([entry]).ok);
    if (cleanIndex === -1) {
        return {
            docs: unchanged,
            demoted: null,
            blocked: { id: verdict.leadId ?? '', message: verdict.message },
        };
    }
    const clean = rest[cleanIndex] as Record<string, unknown>;
    const reordered = [clean, ...rest.slice(0, cleanIndex), tripping, ...rest.slice(cleanIndex + 1)];
    return {
        docs: reordered,
        demoted: { id: verdict.leadId ?? '', from: 0, to: cleanIndex + 1 },
        blocked: null,
    };
}
