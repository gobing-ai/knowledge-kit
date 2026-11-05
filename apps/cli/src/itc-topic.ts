import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { type Doc, DocSchema } from '@gobing-ai/kk-core';
import {
    compileProfile,
    DEFAULT_LABEL_PRIORITY,
    DEFAULT_MIN_CONFIDENCE,
    type ExtractProfile,
    type LabelPolicy,
    openStore,
    parseProfile,
    readStoreConfig,
    resolveStorePath,
    type SelectionInput,
    type StoredDoc,
} from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import { resolvePackageRoot } from './package-root';

const WINDOW_UNITS: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};

function parseWindow(raw?: string): number {
    const str = raw ? raw.trim() : '24h';
    const match = /^(\d+)([smhd])$/.exec(str);
    const amount = match?.[1];
    const unit = match?.[2];
    if (amount === undefined || unit === undefined) {
        throw new Error(`--window must be '<n>s|m|h|d' (e.g. 24h), got '${raw ?? ''}'`);
    }
    const milliseconds = Number(amount) * (WINDOW_UNITS[unit] ?? 0);
    if (milliseconds <= 0) {
        throw new Error(`--window must be greater than zero, got '${raw ?? ''}'`);
    }
    return milliseconds;
}

function toPoolDoc(item: StoredDoc): Doc {
    return {
        id: item.id,
        title: item.title,
        body: item.body,
        ...(item.sourceUri === null ? {} : { sourceUri: item.sourceUri }),
        ...(item.mediaType === null ? {} : { mediaType: item.mediaType }),
        metadata: { ...item.metadata, labels: item.labels },
    };
}

function resolveKkConfigPath(): string {
    return process.env.KK_CONFIG || resolve(process.env.HOME || '~', '.config/kk/config.yaml');
}

async function resolveTopicProfilePath(fs: FileSystem, topic: string, customPath?: string): Promise<string> {
    if (customPath !== undefined && (await fs.exists(customPath))) {
        return customPath;
    }
    // Shipped profile via the package-root resolver (cwd tree first — the project shadows the
    // install — then the runtime script's tree, so a run outside any checkout still resolves it).
    // Never `__dirname`: Bun inlines it as an absolute source path, which would make the packed
    // CLI reference its build checkout (0255 AC7).
    const candidate = join(await resolvePackageRoot(fs), 'plugins/kk/decisions/extract', `${topic}.yaml`);
    if (await fs.exists(candidate)) return candidate;
    throw new Error(
        `no profile for topic '${topic}': expected plugins/kk/decisions/extract/${topic}.yaml under the package root (cwd or script tree)`,
    );
}

// ---------------------------------------------------------------------------
// 1. itc-topic-extract
// ---------------------------------------------------------------------------

export const ItcTopicExtractRequestSchema = z.object({
    schemaVersion: z.literal(1).default(1),
    parentRunId: z.string().min(1),
    intakeDir: z.string().min(1),
    topicProfile: z.string().min(1),
    window: z.string().optional().default('24h'),
    limit: z.number().int().positive().optional().default(20),
    dbPath: z.string().optional(),
    profilePath: z.string().optional(),
    refreshRun: z
        .object({
            runId: z.string().min(1),
            status: z.enum(['succeeded', 'failed', 'locked', 'skipped']),
            outputDocsPath: z.string().optional(),
        })
        .optional(),
});

/** Caller-facing (pre-default) topic extract request. */
export type ItcTopicExtractRequest = z.input<typeof ItcTopicExtractRequestSchema>;

/** Extract the windowed topic pool for a profile into `topic-pool.json` plus its digest manifest. */
export async function itcTopicExtract(
    request: ItcTopicExtractRequest,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ count: number; poolDigest: string }> {
    request = ItcTopicExtractRequestSchema.parse(request);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(request.topicProfile)) throw new Error('invalid topic profile slug');
    if (request.refreshRun?.status === 'failed') throw new Error('requested collection refresh failed (failed)');
    const profilePath = await resolveTopicProfilePath(fs, request.topicProfile, request.profilePath);
    const profileText = await fs.readFile(profilePath);
    const profile: ExtractProfile = parseProfile(profileText);

    const query = compileProfile(profile, {
        windowMs: parseWindow(request.window),
        now: Date.now(),
        limit: request.limit,
        excludeTopic: request.topicProfile,
    });

    const storePath = await resolveStorePath(resolveKkConfigPath(), request.dbPath);
    const store = await openStore({ path: storePath });
    let docs: Doc[];
    try {
        let policy: LabelPolicy = {
            priority: DEFAULT_LABEL_PRIORITY,
            decisionPriority: {},
            minConfidence: DEFAULT_MIN_CONFIDENCE,
        };
        try {
            policy = (await readStoreConfig(resolveKkConfigPath())).labels;
        } catch {
            // default fallback policy
        }
        const rawDocs = await store.items.selectByProfile(query, policy);
        docs = z.array(DocSchema).parse(rawDocs.map(toPoolDoc));
    } finally {
        await store.close();
    }

    if (docs.length === 0) {
        if (request.refreshRun && request.refreshRun.status !== 'succeeded') {
            throw new Error(
                `requested collection refresh failed (${request.refreshRun.status}) and existing store pool is empty for profile '${request.topicProfile}'`,
            );
        }
        throw new Error(`no usable topic; collection store pool is empty for profile '${request.topicProfile}'`);
    }

    await fs.ensureDir(request.intakeDir);

    const poolDigest = createHash('sha256').update(JSON.stringify(docs)).digest('hex');

    const manifest = {
        schemaVersion: 1,
        parentRunId: request.parentRunId,
        topicProfile: request.topicProfile,
        window: request.window,
        limit: request.limit,
        extractedAt: new Date().toISOString(),
        poolDigest,
        ...(request.refreshRun?.runId ? { collectRunId: request.refreshRun.runId } : {}),
    };

    await fs.writeFile(join(request.intakeDir, 'topic-pool.json'), `${JSON.stringify(docs, null, 2)}\n`);
    await fs.writeFile(join(request.intakeDir, 'topic-pool-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    return { count: docs.length, poolDigest };
}

// ---------------------------------------------------------------------------
// 2. itc-topic-validate
// ---------------------------------------------------------------------------

export const ItcTopicCandidateSchema = z.object({
    id: z.enum(['a', 'b', 'c', 'd', 'e']),
    title: z.string().min(1).max(200),
    reason: z.string().min(1).max(1000),
    itemIds: z.array(z.string().min(1)).min(1),
    sourceUrls: z.array(z.string().url()).min(1),
});

/** Parsed topic candidate. */
export type ItcTopicCandidate = z.infer<typeof ItcTopicCandidateSchema>;

/** Schema of `topic-candidates.json`: up to five candidates bound to the pool digest. */
export const ItcTopicCandidatesArtifactSchema = z.object({
    schemaVersion: z.literal(1).default(1),
    parentRunId: z.string().min(1),
    poolDigest: z.string().min(1),
    candidates: z.array(ItcTopicCandidateSchema).min(1).max(5),
});

/** Parsed topic candidates artifact. */
export type ItcTopicCandidatesArtifact = z.infer<typeof ItcTopicCandidatesArtifactSchema>;

/** Input to `itc-topic-validate`. */
export const ItcTopicValidateRequestSchema = z.object({
    schemaVersion: z.literal(1).default(1),
    intakeDir: z.string().min(1),
    parentRunId: z.string().min(1),
});

/** Parsed topic validate request. */
export type ItcTopicValidateRequest = z.infer<typeof ItcTopicValidateRequestSchema>;

/** Validate candidates against the pool manifest and items; writes the `.topic-candidates-valid` marker. */
export async function itcTopicValidate(
    request: ItcTopicValidateRequest,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ valid: true }> {
    const manifestPath = join(request.intakeDir, 'topic-pool-manifest.json');
    const poolPath = join(request.intakeDir, 'topic-pool.json');
    const candidatesPath = join(request.intakeDir, 'topic-candidates.json');

    if (!(await fs.exists(manifestPath)) || !(await fs.exists(poolPath))) {
        throw new Error(`topic pool artifacts not found in ${request.intakeDir}`);
    }
    if (!(await fs.exists(candidatesPath))) {
        throw new Error(`topic-candidates.json not found in ${request.intakeDir}`);
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath)) as {
        parentRunId: string;
        poolDigest: string;
        topicProfile: string;
    };
    const poolDocs = z.array(DocSchema).parse(JSON.parse(await fs.readFile(poolPath)));
    const rawCandidates = JSON.parse(await fs.readFile(candidatesPath));

    const parsed = ItcTopicCandidatesArtifactSchema.safeParse(rawCandidates);
    if (!parsed.success) {
        throw new Error(`invalid topic candidates artifact: ${parsed.error.message}`);
    }
    const artifact = parsed.data;

    if (artifact.parentRunId !== request.parentRunId || artifact.parentRunId !== manifest.parentRunId) {
        throw new Error(
            `parentRunId mismatch: request ${request.parentRunId} vs candidates ${artifact.parentRunId} vs manifest ${manifest.parentRunId}`,
        );
    }
    const currentDigest = createHash('sha256').update(JSON.stringify(poolDocs)).digest('hex');
    if (artifact.poolDigest !== manifest.poolDigest || currentDigest !== manifest.poolDigest) {
        throw new Error(
            `stale candidates: poolDigest mismatch (candidates ${artifact.poolDigest} vs pool ${manifest.poolDigest})`,
        );
    }

    // Verify candidate IDs are unique
    const candidateIds = new Set<string>();
    for (const c of artifact.candidates) {
        if (candidateIds.has(c.id)) {
            throw new Error(`duplicate candidate id '${c.id}'`);
        }
        candidateIds.add(c.id);
    }

    const poolDocMap = new Map<string, Doc>(poolDocs.map((d) => [d.id, d]));

    for (const c of artifact.candidates) {
        for (const itemId of c.itemIds) {
            const doc = poolDocMap.get(itemId);
            if (!doc) {
                throw new Error(`candidate '${c.id}' cites unknown item ID '${itemId}' not present in topic-pool.json`);
            }
        }
        for (const url of c.sourceUrls) {
            const matchingDoc = c.itemIds.map((id) => poolDocMap.get(id)).find((doc) => doc?.sourceUri === url);
            if (!matchingDoc) {
                throw new Error(
                    `candidate '${c.id}' sourceUrl '${url}' does not match any referenced item sourceUri in topic-pool.json`,
                );
            }
        }
    }

    await fs.writeFile(join(request.intakeDir, '.topic-candidates-valid'), `${new Date().toISOString()}\n`);
    return { valid: true };
}

// ---------------------------------------------------------------------------
// 3. itc-topic-select
// ---------------------------------------------------------------------------

export const ItcTopicSelectRequestSchema = z.object({
    schemaVersion: z.literal(1).default(1),
    intakeDir: z.string().min(1),
    parentRunId: z.string().min(1),
    selectedCandidateId: z.enum(['a', 'b', 'c', 'd', 'e']),
    dbPath: z.string().optional(),
});

/** Parsed topic select request. */
export type ItcTopicSelectRequest = z.infer<typeof ItcTopicSelectRequestSchema>;

/** Schema of `chosen-source.json`: the selected candidate and its item ids for this run. */
export interface ChosenSourceArtifact {
    schemaVersion: 1;
    parentRunId: string;
    topicProfile: string;
    candidateId: string;
    poolDigest: string;
    topicName: string;
    displayTitle: string;
    itemIds: string[];
    selectedDocsPath: string;
}

/** Revalidate, then record the selected candidate as `chosen-source.json` and reserve its items in the store. */
export async function itcTopicSelect(
    request: ItcTopicSelectRequest,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ selectedCandidateId: string; itemIds: string[] }> {
    await itcTopicValidate(request, fs);
    const manifestPath = join(request.intakeDir, 'topic-pool-manifest.json');
    const poolPath = join(request.intakeDir, 'topic-pool.json');
    const candidatesPath = join(request.intakeDir, 'topic-candidates.json');

    if (!(await fs.exists(manifestPath)) || !(await fs.exists(poolPath)) || !(await fs.exists(candidatesPath))) {
        throw new Error(`intake artifacts missing in ${request.intakeDir}`);
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath)) as {
        parentRunId: string;
        poolDigest: string;
        topicProfile: string;
    };
    const poolDocs = JSON.parse(await fs.readFile(poolPath)) as Doc[];
    const candidatesArtifact = JSON.parse(await fs.readFile(candidatesPath)) as ItcTopicCandidatesArtifact;

    const candidate = candidatesArtifact.candidates.find((c) => c.id === request.selectedCandidateId);
    if (!candidate) {
        throw new Error(
            `selected candidate '${request.selectedCandidateId}' not found in candidates list: [${candidatesArtifact.candidates.map((c) => c.id).join(', ')}]`,
        );
    }

    const selectedDocSet = new Set(candidate.itemIds);
    const selectedDocs = poolDocs.filter((d) => selectedDocSet.has(d.id));

    const selectedDocsPath = join(request.intakeDir, 'selected-docs.json');
    await fs.writeFile(selectedDocsPath, `${JSON.stringify(selectedDocs, null, 2)}\n`);

    const chosenSource: ChosenSourceArtifact = {
        schemaVersion: 1,
        parentRunId: request.parentRunId,
        topicProfile: manifest.topicProfile,
        candidateId: candidate.id,
        poolDigest: manifest.poolDigest,
        topicName: candidate.title,
        displayTitle: candidate.title,
        itemIds: candidate.itemIds,
        selectedDocsPath,
    };

    await fs.writeFile(join(request.intakeDir, 'chosen-source.json'), `${JSON.stringify(chosenSource, null, 2)}\n`);

    // Call store select to record topic-scoped selection in SQLite
    const storePath = await resolveStorePath(resolveKkConfigPath(), request.dbPath);
    const store = await openStore({ path: storePath });
    try {
        const now = Date.now();
        const rows: SelectionInput[] = [];
        for (const [index, itemId] of candidate.itemIds.entries()) {
            const item = await store.items.findById(itemId);
            if (!item) {
                throw new Error(`item '${itemId}' not found in store`);
            }
            rows.push({
                topic: manifest.topicProfile,
                itemId: item.id,
                runId: request.parentRunId,
                storyId: item.storyId ?? item.id,
                workflow: 'kk-itc',
                rank: index + 1,
            });
        }
        await store.selections.insertMany(rows, now);
    } finally {
        await store.close();
    }

    return { selectedCandidateId: candidate.id, itemIds: candidate.itemIds };
}

// ---------------------------------------------------------------------------
// 4. itc-selection-settle
// ---------------------------------------------------------------------------

export const ItcSelectionSettleRequestSchema = z.object({
    schemaVersion: z.literal(1).default(1),
    intakeDir: z.string().min(1),
    parentRunId: z.string().min(1),
    topicProfile: z.string().min(1),
    outcome: z.enum(['published', 'uncertain', 'author_only', 'draft_only', 'failed']),
    dbPath: z.string().optional(),
});

/** Parsed selection settle request. */
export type ItcSelectionSettleRequest = z.infer<typeof ItcSelectionSettleRequestSchema>;

/** Settle reserved selections by publish outcome: mark published, release, or retain for reconcile. */
export async function itcSelectionSettle(
    request: ItcSelectionSettleRequest,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ settled: number | string; action: 'marked_published' | 'released' | 'reconcile_retained' }> {
    const storePath = await resolveStorePath(resolveKkConfigPath(), request.dbPath);

    if (request.outcome === 'published') {
        let itemIds: string[] | undefined;
        const chosenSourcePath = join(request.intakeDir, 'chosen-source.json');
        if (await fs.exists(chosenSourcePath)) {
            try {
                const chosen = JSON.parse(await fs.readFile(chosenSourcePath)) as ChosenSourceArtifact;
                if (Array.isArray(chosen.itemIds)) {
                    itemIds = chosen.itemIds;
                }
            } catch {
                itemIds = undefined;
            }
        }
        const store = await openStore({ path: storePath });
        try {
            const count = await store.selections.updateStatus(
                request.parentRunId,
                request.topicProfile,
                'published',
                itemIds,
            );
            return { settled: count, action: 'marked_published' };
        } finally {
            await store.close();
        }
    }

    if (request.outcome === 'uncertain') {
        const reconcileInfo = {
            schemaVersion: 1,
            parentRunId: request.parentRunId,
            topicProfile: request.topicProfile,
            settledAt: new Date().toISOString(),
            status: 'retained_for_reconciliation',
            reason: 'unresolved possible remote effects',
            guidance: 'reconcile status manually via kk store mark-published or kk store release',
        };
        await fs.ensureDir(request.intakeDir);
        await fs.writeFile(
            join(request.intakeDir, '.selection-reconcile.json'),
            `${JSON.stringify(reconcileInfo, null, 2)}\n`,
        );
        return { settled: 'retained', action: 'reconcile_retained' };
    }

    // outcome === 'author_only' || 'draft_only' || 'failed' -> release
    const store = await openStore({ path: storePath });
    try {
        const count = await store.selections.updateStatus(request.parentRunId, request.topicProfile, 'dropped');
        return { settled: count, action: 'released' };
    } finally {
        await store.close();
    }
}

// ---------------------------------------------------------------------------
// Stage dispatcher router for itc-topic-*
// ---------------------------------------------------------------------------

export async function runItcTopicStage(
    stageName: string,
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
): Promise<number | undefined> {
    const requestIdx = args.indexOf('--request');
    const requestFile = requestIdx !== -1 ? args[requestIdx + 1] : undefined;
    if (requestFile === undefined || requestFile === '') {
        echoError(`${stageName}: --request <JSON-file> is required`);
        return 1;
    }
    if (!(await fs.exists(requestFile))) {
        echoError(`${stageName}: request file not found: ${requestFile}`);
        return 1;
    }

    let raw: unknown;
    try {
        raw = JSON.parse(await fs.readFile(requestFile));
    } catch (err: unknown) {
        echoError(`${stageName}: invalid JSON in request file: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    try {
        if (stageName === 'itc-topic-extract') {
            const parsed = ItcTopicExtractRequestSchema.parse(raw);
            const res = await itcTopicExtract(parsed, fs);
            echo(JSON.stringify(res));
            return 0;
        }
        if (stageName === 'itc-topic-validate') {
            const parsed = ItcTopicValidateRequestSchema.parse(raw);
            const res = await itcTopicValidate(parsed, fs);
            echo(JSON.stringify(res));
            return 0;
        }
        if (stageName === 'itc-topic-select') {
            const parsed = ItcTopicSelectRequestSchema.parse(raw);
            const res = await itcTopicSelect(parsed, fs);
            echo(JSON.stringify(res));
            return 0;
        }
        if (stageName === 'itc-selection-settle') {
            const parsed = ItcSelectionSettleRequestSchema.parse(raw);
            const res = await itcSelectionSettle(parsed, fs);
            echo(JSON.stringify(res));
            return 0;
        }
    } catch (err: unknown) {
        echoError(`${stageName}: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    return undefined;
}
