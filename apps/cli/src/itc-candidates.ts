import { join } from 'node:path';
import { type Doc, DocSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import { echo } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import { type ItcDecisionResult, itcDecision } from './itc-decision';
import { type ItcTopicCandidatesArtifactSchema, itcTopicExtract, itcTopicValidate } from './itc-topic';

/** Candidate slot ids `a`–`e` in build order. */
const CANDIDATE_SLOTS = ['a', 'b', 'c', 'd', 'e'] as const;

/** Options for `kk itc candidates`: one collected-topic sweep end to end. */
export interface ItcCandidatesOptions {
    /** Extraction topic profile slug (e.g. `it-topics`, `ai-news`). */
    profile: string;
    /** Explicit profile YAML override (tests / out-of-tree profiles). */
    profilePath?: string;
    /** Parent run every artifact and the decision bind to. */
    parentRunId: string;
    /** Intake dir (default `<cwd>/.itc-intake/<parentRunId>`). */
    intakeDir?: string;
    window?: string;
    limit?: number;
    dbPath?: string;
}

type CandidateSlot = z.infer<typeof ItcTopicCandidatesArtifactSchema>['candidates'][number];

/** The shortlist plus the bound decision `runItcCandidates` produces. */
export interface ItcCandidatesResult {
    intakeDir: string;
    poolCount: number;
    candidates: CandidateSlot[];
    decision: ItcDecisionResult;
}

/**
 * Deterministic candidate producer for `kk itc candidates`: one candidate per
 * citable pool doc (docs with a source URI, pool order), slot `a`–`e`, capped
 * at five. The validator's membership/evidence checks are satisfied by
 * construction — each candidate cites exactly its doc's ID and source URI.
 */
export function buildTopicCandidates(pool: readonly Doc[]): CandidateSlot[] {
    const candidates: CandidateSlot[] = [];
    for (const doc of pool) {
        if (candidates.length >= CANDIDATE_SLOTS.length) break;
        if (!doc.sourceUri) continue; // sourceUrls must match a cited item's sourceUri
        const slot = CANDIDATE_SLOTS[candidates.length];
        if (slot === undefined) break; // unreachable: the length check keeps the index in range
        candidates.push({
            id: slot,
            title: (doc.title ?? doc.id).slice(0, 200),
            reason: `${doc.title ?? doc.id}. Evidence: ${doc.body.slice(0, 300)}`.slice(0, 1000),
            itemIds: [doc.id],
            sourceUrls: [doc.sourceUri],
        });
    }
    return candidates;
}

/**
 * `kk itc candidates` engine: `itc-topic-extract` -> `topic-candidates.json`
 * (deterministic shortlist) -> `itc-topic-validate` -> `itc-decision`
 * (`kk-itc-topic-choice`). Prints the shortlist and returns the served decision
 * so the operator can follow with `itc-topic-select` or pick manually on
 * `defer` — defer is an outcome, never an error.
 */
export async function runItcCandidates(
    options: ItcCandidatesOptions,
    fs: FileSystem = createNodeFileSystem(),
    executor?: ProcessExecutor,
): Promise<ItcCandidatesResult> {
    const intakeDir = options.intakeDir ?? join(process.cwd(), '.itc-intake', options.parentRunId);

    const { count: poolCount } = await itcTopicExtract(
        {
            schemaVersion: 1,
            parentRunId: options.parentRunId,
            intakeDir,
            topicProfile: options.profile,
            ...(options.profilePath ? { profilePath: options.profilePath } : {}),
            ...(options.window ? { window: options.window } : {}),
            ...(options.limit ? { limit: options.limit } : {}),
            ...(options.dbPath ? { dbPath: options.dbPath } : {}),
        },
        fs,
    );

    const pool = z.array(DocSchema).parse(JSON.parse(await fs.readFile(join(intakeDir, 'topic-pool.json'))));
    const manifest = JSON.parse(await fs.readFile(join(intakeDir, 'topic-pool-manifest.json'))) as {
        poolDigest: string;
    };
    const candidates = buildTopicCandidates(pool);
    if (candidates.length === 0) {
        throw new Error(
            `no citable pool item carries a source URI: cannot build topic candidates from ${poolCount} items`,
        );
    }
    await fs.writeFile(
        join(intakeDir, 'topic-candidates.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                parentRunId: options.parentRunId,
                poolDigest: manifest.poolDigest,
                candidates,
            },
            null,
            2,
        )}\n`,
    );

    await itcTopicValidate({ schemaVersion: 1, intakeDir, parentRunId: options.parentRunId }, fs);

    const decision = await itcDecision(
        {
            parentRunId: options.parentRunId,
            decisionId: 'kk-itc-topic-choice',
            candidates: candidates.map((c) => ({ id: c.id, title: c.title, description: c.reason })),
            evidenceFiles: [join(intakeDir, 'topic-candidates.json')],
            outPath: join(intakeDir, 'topic-decision.json'),
        },
        fs,
        executor,
    );

    for (const c of candidates) {
        echo(`${c.id} — ${c.title}`);
    }
    echo(`decision: ${decision.value} (${decision.source})`);
    // Machine-readable tail: the intake dir and pool size the follow-up steps bind to.
    echo(JSON.stringify({ intakeDir, poolCount }));

    return { intakeDir, poolCount, candidates, decision };
}
