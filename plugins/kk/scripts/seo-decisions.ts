import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CrawlArtifact, PageRecord, SeoOptions } from './seo-facts';
import { assertSeoNotCancelled, SEO_CANCEL_SIGNALS, SeoStageCancelledError, writeJsonAtomic } from './seo-fetch';

export interface JudgmentEntry {
    id: string; // decision id, e.g. "kk-seo-page-type"
    subjectId: string;
    subjectUrl: string;
    type: 'choice' | 'score' | 'noul';
    value: string | number | boolean;
    confidence: number | null;
    maker: string;
    source: string; // "model" | "default" | "fallback" | "deterministic"
    reason: string;
    qualified: boolean;
}

export interface JudgmentsArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    createdAt: string;
    inputDigest: string;
    predecessorDigests: Record<string, string>;
    status: 'complete' | 'partial';
    entries: JudgmentEntry[];
    summary: {
        totalCalls: number;
        successfulCalls: number;
        qualifiedCalls: number;
        fallbackCalls: number;
    };
}

export type DecisionStubHandler = (id: string, params: Record<string, string>) => unknown;

/**
 * Produce compact serialized evidence JSON <= 1,800 UTF-16 units.
 */
export function buildCompactEvidencePacket(
    page: PageRecord,
    siteOrigin: string,
): {
    factsJson: string;
    excerptJson: string;
} {
    const facts = page.facts;
    const rawFacts = {
        url: page.url,
        title: facts?.title ?? null,
        metaDescription: facts?.metaDescription ?? null,
        h1: facts?.headings.find((h) => h.level === 1)?.text ?? null,
        canonical: facts?.canonical ?? null,
        wordCount: facts?.wordCount ?? 0,
    };
    let factsJson = JSON.stringify(rawFacts);
    if (factsJson.length > 1800) {
        factsJson = JSON.stringify({
            url: page.url,
            title: facts?.title ? `${facts.title.slice(0, 100)}...` : null,
            meta: facts?.metaDescription ? `${facts.metaDescription.slice(0, 150)}...` : null,
            wordCount: facts?.wordCount ?? 0,
        });
    }

    const text = facts?.textSample || '';
    const openingText = text.slice(0, 400);
    const middleText = text.length > 800 ? text.slice(400, 800) : '';

    const excerptObj = {
        url: page.url,
        siteOrigin,
        originalLength: text.length,
        openingText,
        middleText,
        truncated: text.length > 800,
    };
    let excerptJson = JSON.stringify(excerptObj);
    if (excerptJson.length > 1800) {
        excerptJson = JSON.stringify({
            url: page.url,
            openingText: openingText.slice(0, 300),
            truncated: true,
        });
    }

    return { factsJson, excerptJson };
}

/**
 * Execute spur decision run via child process with strict bounds.
 *
 * `options.subjectUrl` is ledger display metadata, never a decision parameter: every SEO catalog
 * declares `subject_id`/`locale` (plus `candidates` on kk-seo-keyword-page), and spur rejects an
 * undeclared `--param` before any maker runs — so forwarding a display value in `params` would turn
 * the whole judgment into a silent fallback.
 */
export function executeDecisionRun(
    decisionId: string,
    params: Record<string, string>,
    evidencePaths: string[],
    options: { spurBin?: string; timeoutMs?: number; stub?: DecisionStubHandler; subjectUrl?: string } = {},
): JudgmentEntry {
    const spurBin = options.spurBin || 'spur';
    const timeoutMs = options.timeoutMs ?? 30000;
    const subjectId = params.subject_id || '';
    const subjectUrl = options.subjectUrl || subjectId;

    if (options.stub) {
        try {
            const raw = options.stub(decisionId, params) as Record<string, unknown>;
            return validateAndNormalizeDecisionResult(decisionId, subjectId, subjectUrl, raw);
        } catch (err: unknown) {
            return {
                id: decisionId,
                subjectId,
                subjectUrl,
                type: 'choice',
                value: 'unclear',
                confidence: null,
                maker: 'stub',
                source: 'fallback',
                reason: err instanceof Error ? err.message : String(err),
                qualified: false,
            };
        }
    }

    // Cancellation refuses new dispatch (design §4); the stage aborts instead of recording fallbacks.
    assertSeoNotCancelled();

    const args = ['decision', 'run', decisionId];
    for (const [k, v] of Object.entries(params)) {
        args.push('--param', `${k}=${v}`);
    }
    for (const ev of evidencePaths) {
        args.push('--evidence', ev);
    }
    args.push('--json');

    try {
        const res = spawnSync(spurBin, args, {
            encoding: 'utf-8',
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // The signal handlers cannot run while spawnSync blocks, so a cancellation delivered to the
        // process group is observed through the child's own termination signal instead: the child
        // was killed by the same cancellation, which means this stage must stop rather than record
        // the kill as a fallback result and dispatch another decision.
        // spawnSync kills a timed-out child with SIGTERM too; that is this decision's timeout, not a
        // cancellation, so it records a fallback before the signal check can misread it.
        const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
        if (!timedOut && res.signal !== null && (SEO_CANCEL_SIGNALS as readonly string[]).includes(res.signal)) {
            throw new SeoStageCancelledError(res.signal as NodeJS.Signals, decisionId);
        }
        // A cancellation that arrived while the child ran already terminated it with the process
        // group; the loop must stop here rather than treat the killed child as a fallback result.
        assertSeoNotCancelled();

        if (res.status !== 0 || !res.stdout) {
            return {
                id: decisionId,
                subjectId,
                subjectUrl,
                type: 'choice',
                value: 'unclear',
                confidence: null,
                maker: 'unknown',
                source: 'fallback',
                reason: timedOut
                    ? `decision run timed out after ${timeoutMs}ms`
                    : res.stderr
                      ? res.stderr.slice(0, 200)
                      : `exit status ${res.status}`,
                qualified: false,
            };
        }

        const parsed = JSON.parse(res.stdout);
        return validateAndNormalizeDecisionResult(decisionId, subjectId, subjectUrl, parsed);
    } catch (err: unknown) {
        // Cancellation is control flow, not a fallback decision: it must abort the stage.
        if (err instanceof SeoStageCancelledError) throw err;
        return {
            id: decisionId,
            subjectId,
            subjectUrl,
            type: 'choice',
            value: 'unclear',
            confidence: null,
            maker: 'unknown',
            source: 'fallback',
            reason: err instanceof Error ? err.message : String(err),
            qualified: false,
        };
    }
}

/**
 * Validate returned decision structure and apply KK confidence policy.
 */
export function validateAndNormalizeDecisionResult(
    decisionId: string,
    subjectId: string,
    subjectUrl: string,
    raw: Record<string, unknown>,
): JudgmentEntry {
    const type = (typeof raw.type === 'string' ? raw.type : 'choice') as 'choice' | 'score' | 'noul';
    const val = raw.value !== undefined ? raw.value : raw.choice !== undefined ? raw.choice : raw.noul;
    // Documented validation is "null or finite 0–1" (design §7): an out-of-range number is not a
    // confidence. Preserving it would let a bad maker payload pass the >= 0.8 sufficiency gate while
    // spur bands the same value LOW.
    const confidence =
        typeof raw.confidence === 'number' &&
        Number.isFinite(raw.confidence) &&
        raw.confidence >= 0 &&
        raw.confidence <= 1
            ? raw.confidence
            : null;
    const maker = typeof raw.maker === 'string' && raw.maker.trim() !== '' ? raw.maker : 'unknown';
    const source = typeof raw.source === 'string' && raw.source.trim() !== '' ? raw.source : 'default';
    const reason = typeof raw.reason === 'string' ? raw.reason : '';

    let qualified = false;

    if (source === 'model') {
        if (type === 'choice' || type === 'score') {
            qualified = confidence !== null && confidence >= 0.8;
        } else if (type === 'noul') {
            const prob = typeof val === 'number' ? val : typeof raw.probability === 'number' ? raw.probability : 0.5;
            qualified = prob >= 0.8 || prob <= 0.2;
        }
    }

    let normalizedValue: string | number | boolean = 'unclear';
    if (type === 'score') {
        normalizedValue = typeof val === 'number' && Number.isInteger(val) ? val : 0;
    } else if (type === 'noul') {
        normalizedValue = typeof val === 'boolean' ? val : false;
    } else {
        normalizedValue = typeof val === 'string' ? val : 'unclear';
    }

    return {
        id: decisionId,
        subjectId,
        subjectUrl,
        type,
        value: normalizedValue,
        confidence,
        maker,
        source,
        reason,
        qualified,
    };
}

/**
 * Execute seo-judge stage across crawl artifact.
 */
export async function executeSeoJudgeStage(
    workDir: string,
    options: { spurBin?: string; stub?: DecisionStubHandler } = {},
): Promise<JudgmentsArtifact> {
    const optionsPath = join(workDir, 'options.json');
    const crawlPath = join(workDir, 'crawl.json');

    const optionsRaw = readFileSync(optionsPath, 'utf-8');
    const crawlRaw = readFileSync(crawlPath, 'utf-8');

    const opts: SeoOptions = JSON.parse(optionsRaw);
    const crawl: CrawlArtifact = JSON.parse(crawlRaw);

    const deadlineMs = Date.now() + 600 * 1000; // 600s max stage deadline
    const maxCalls = opts.max_decision_calls || 320;
    let callCount = 0;

    const evidenceDir = join(workDir, 'evidence', 'decisions');
    mkdirSync(evidenceDir, { recursive: true });

    const entries: JudgmentEntry[] = [];
    const siteUrl = opts.url;
    const siteOrigin = new URL(siteUrl).origin;

    // 1. Site-level decisions (5 decisions)
    const siteDecisions = [
        'kk-seo-business-model',
        'kk-seo-value-proposition',
        'kk-seo-entity-clarity',
        'kk-seo-topical-focus',
        'kk-seo-local-intent',
    ];

    const siteContextFile = join(evidenceDir, 'site-context.json');
    const siteContextContent = JSON.stringify({
        origin: siteOrigin,
        businessContext: (opts.business_context || '').slice(0, 1000),
        locale: opts.locale || 'en-US',
    });
    writeJsonAtomic(siteContextFile, JSON.parse(siteContextContent));

    for (const dId of siteDecisions) {
        if (callCount >= maxCalls || Date.now() >= deadlineMs) break;
        callCount += 1;
        const entry = executeDecisionRun(
            dId,
            { subject_id: siteOrigin, locale: opts.locale },
            [siteContextFile],
            options,
        );
        entries.push(entry);
    }

    // 2. Page-level decisions (13 decisions per semantic page)
    const availablePages = crawl.pages.filter((p) => p.availability === 'available' && p.facts);
    const selectedPages = availablePages.slice(0, opts.semantic_pages || 20);

    for (const page of selectedPages) {
        if (callCount >= maxCalls || Date.now() >= deadlineMs) break;
        const { factsJson, excerptJson } = buildCompactEvidencePacket(page, siteOrigin);
        const pFactsFile = join(evidenceDir, `p-${page.subjectId}-facts.json`);
        const pExcerptFile = join(evidenceDir, `p-${page.subjectId}-excerpt.json`);
        writeJsonAtomic(pFactsFile, JSON.parse(factsJson));
        writeJsonAtomic(pExcerptFile, JSON.parse(excerptJson));

        const isHomepage = page.url === siteUrl || page.url === `${siteOrigin}/`;

        // Page-level question list with applicability checks
        const pDecisions: string[] = [];
        if (!isHomepage) {
            pDecisions.push('kk-seo-page-type');
        } else {
            // Deterministic homepage type
            entries.push({
                id: 'kk-seo-page-type',
                subjectId: page.subjectId,
                subjectUrl: page.url,
                type: 'choice',
                value: 'homepage',
                confidence: 1.0,
                maker: 'deterministic',
                source: 'deterministic',
                reason: 'Root URL classified deterministically as homepage',
                qualified: true,
            });
        }

        pDecisions.push(
            'kk-seo-search-intent',
            'kk-seo-page-action',
            'kk-seo-importance',
            'kk-seo-helpfulness',
            'kk-seo-specificity',
            'kk-seo-trust',
            'kk-seo-citability',
        );

        if (page.facts?.title) {
            pDecisions.push('kk-seo-title-fit');
        }
        if (page.facts?.metaDescription) {
            pDecisions.push('kk-seo-meta-fit');
        }
        if (page.facts?.headings.length) {
            pDecisions.push('kk-seo-heading-fit');
        }
        pDecisions.push('kk-seo-answer-first', 'kk-seo-next-step');

        for (const dId of pDecisions) {
            if (callCount >= maxCalls || Date.now() >= deadlineMs) break;
            callCount += 1;
            const entry = executeDecisionRun(
                dId,
                { subject_id: page.url, locale: opts.locale },
                [pFactsFile, pExcerptFile, siteContextFile],
                { ...options, subjectUrl: page.url },
            );
            entries.push(entry);
        }
    }

    // 3. Pair-level decisions (kk-seo-intent-overlap)
    const pairsToCompare: Array<[PageRecord, PageRecord]> = [];
    for (let i = 0; i < selectedPages.length; i += 1) {
        for (let j = i + 1; j < selectedPages.length; j += 1) {
            const pA = selectedPages[i];
            const pB = selectedPages[j];
            if (pA && pB && pairsToCompare.length < (opts.max_pairs || 10)) {
                pairsToCompare.push([pA, pB]);
            }
        }
    }

    for (const [pA, pB] of pairsToCompare) {
        if (callCount >= maxCalls || Date.now() >= deadlineMs) break;
        const pairId = [pA.subjectId, pB.subjectId].sort().join('::');
        const pairEvFile = join(evidenceDir, `pair-${pairId}.json`);
        const pairPayload = {
            pageA: { url: pA.url, title: pA.facts?.title, h1: pA.facts?.headings.find((h) => h.level === 1)?.text },
            pageB: { url: pB.url, title: pB.facts?.title, h1: pB.facts?.headings.find((h) => h.level === 1)?.text },
        };
        writeJsonAtomic(pairEvFile, pairPayload);

        callCount += 1;
        const entry = executeDecisionRun(
            'kk-seo-intent-overlap',
            { subject_id: pairId, locale: opts.locale },
            [pairEvFile],
            { ...options, subjectUrl: `${pA.url} :: ${pB.url}` },
        );
        entries.push(entry);
    }

    // 4. Keyword decisions: suppressed when visibility is missing
    const hasVisibility = Boolean(opts.visibility_file && existsSync(resolve(opts.visibility_file)));
    if (hasVisibility) {
        try {
            const visRaw = readFileSync(resolve(opts.visibility_file), 'utf-8');
            const vis = JSON.parse(visRaw);
            const rows = Array.isArray(vis.rows) ? vis.rows : [];
            const maxKeywords = opts.max_keywords || 10;
            const keywordsToEvaluate = rows.slice(0, maxKeywords);

            for (const kwRow of keywordsToEvaluate) {
                if (callCount >= maxCalls || Date.now() >= deadlineMs) break;
                const query = typeof kwRow.query === 'string' ? kwRow.query : '';
                if (!query) continue;

                // kk-seo-keyword-other-brand
                callCount += 1;
                entries.push(
                    executeDecisionRun(
                        'kk-seo-keyword-other-brand',
                        { subject_id: query, locale: opts.locale },
                        [siteContextFile],
                        options,
                    ),
                );

                // kk-seo-keyword-page
                const candidates = selectedPages.slice(0, 30).map((p) => ({
                    subjectId: p.subjectId,
                    url: p.url,
                    title: p.facts?.title || '',
                }));
                callCount += 1;
                entries.push(
                    executeDecisionRun(
                        'kk-seo-keyword-page',
                        { subject_id: query, locale: opts.locale, candidates: JSON.stringify(candidates) },
                        [siteContextFile],
                        options,
                    ),
                );
            }
        } catch {
            // ignore malformed visibility snapshot
        }
    }

    const summary = {
        totalCalls: callCount,
        successfulCalls: entries.length,
        // The deterministic homepage entry is not a decision call, so it stays out of the call tallies.
        qualifiedCalls: entries.filter((e) => e.qualified && e.source !== 'deterministic').length,
        fallbackCalls: entries.filter((e) => e.source === 'fallback' || e.source === 'default').length,
    };

    const isPartial = callCount >= maxCalls || Date.now() >= deadlineMs;

    const judgmentsArtifact: JudgmentsArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId: crawl.runId,
        createdAt: new Date().toISOString(),
        inputDigest: crawl.inputDigest,
        predecessorDigests: {
            'crawl.json': crawl.predecessorDigests['crawl.json'] || 'abc',
        },
        status: isPartial ? 'partial' : 'complete',
        entries,
        summary,
    };

    writeJsonAtomic(join(workDir, 'judgments.json'), judgmentsArtifact);
    return judgmentsArtifact;
}
