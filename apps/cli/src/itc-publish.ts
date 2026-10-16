import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Content, discoverAllPlugins } from '@gobing-ai/kk-core';
import { z } from 'zod';
import { runFanout } from './fanout';
import { buildItcPublishPlan, type ItcPlanRequest, type ItcPublishPlan, resolveItcTargets } from './itc-plan';
import { itcSelectionSettle } from './itc-topic';

export const ItcDeliveryMetadataSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        effect: z.enum(['none', 'confirmed', 'unknown']),
        publicUrlVerified: z.boolean().optional(),
    })
    .strict();

export const ItcReceiptSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        parentRunId: z.string().min(1),
        planDigest: z.string().min(1),
        payloadDigest: z.string().min(1),
        plugin: z.string().min(1),
        profile: z.string().min(1),
        mode: z.enum(['draft', 'live']),
        attemptId: z.string().min(1),
        status: z.enum(['succeeded', 'failed', 'uncertain']),
        effect: z.enum(['none', 'confirmed', 'unknown']),
        resultDigest: z.string().optional(),
        aggregatePath: z.string().optional(),
        publicUrlVerified: z.boolean().optional(),
        url: z.string().optional(),
        durationMs: z.number().optional(),
    })
    .strict();

export type ItcReceipt = z.infer<typeof ItcReceiptSchema>;

/** First `cover.*` in 4-illustrations as a workspace-relative path, or undefined. */
function findCover(workDir: string): string | undefined {
    const dir = join(workDir, '4-illustrations');
    if (!existsSync(dir)) return undefined;
    const cover = readdirSync(dir).find((file) => file.startsWith('cover.'));
    return cover ? join('4-illustrations', cover) : undefined;
}

function readFrontmatter(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    const text = readFileSync(path, 'utf-8');
    if (!text.startsWith('---')) return {};
    const end = text.indexOf('\n---', 3);
    if (end < 0) return {};
    const out: Record<string, string> = {};
    for (const line of text.slice(4, end).split('\n')) {
        const m = /^([\w-]+):\s*(.+)$/.exec(line);
        if (m?.[1] && m[2]) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return out;
}

function splitList(value: string): string[] {
    return value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/**
 * Materializes 4-publish/content.json and resolves target publication plan.
 */
export async function itcMaterializePlan(args: string[]): Promise<number> {
    const [workDir = '', targetsArg = '', sourceLocale = '', liveArg = '', presetArg = ''] = args;
    if (!workDir) {
        console.error('usage: itc-materialize-plan <work_dir> [targets] [source_locale] [publish_live] [preset]');
        return 1;
    }
    const live = liveArg === 'true';
    const draftPath = join(workDir, '3-draft-draft-article.md');
    if (!existsSync(draftPath)) {
        console.error(`final draft not found: ${draftPath}`);
        return 1;
    }
    const lines = readFileSync(draftPath, 'utf-8').split('\n');
    const h1 = lines.findIndex((line) => /^#\s+\S/.test(line));
    if (h1 < 0) {
        console.error(`no H1 title in ${draftPath}`);
        return 1;
    }
    const title = lines[h1]?.replace(/^#\s+/, '').trim() ?? '';
    const body = [...lines.slice(0, h1), ...lines.slice(h1 + 1)].join('\n').trim();
    if (!body) {
        console.error(`empty body in ${draftPath}`);
        return 1;
    }

    const content: Record<string, unknown> = { title, format: 'markdown', body };
    const outlinePath = join(workDir, '2-outline', 'outline-approved.md');
    if (existsSync(outlinePath)) content.outline = readFileSync(outlinePath, 'utf-8').trim();

    const docsPath = join(workDir, 'docs.json');
    if (existsSync(docsPath)) {
        try {
            const docs = JSON.parse(readFileSync(docsPath, 'utf-8')) as Array<{
                id?: unknown;
                title?: unknown;
                sourceUri?: unknown;
            }>;
            if (Array.isArray(docs)) {
                content.references = docs.map((doc) => ({
                    ...(typeof doc.sourceUri === 'string' ? { url: doc.sourceUri } : {}),
                    ...(typeof doc.title === 'string' ? { title: doc.title } : {}),
                    ...(typeof doc.id === 'string' ? { cite: doc.id } : {}),
                }));
            }
        } catch {
            // ignore malformed docs
        }
    }

    const metadata: Record<string, unknown> = { published: live };
    const cover = findCover(workDir);
    if (cover) metadata.coverImage = cover;
    const brief = readFrontmatter(join(workDir, 'brief.md'));
    if (brief.tags) metadata.tags = splitList(brief.tags);
    if (brief.keywords) metadata.keywords = splitList(brief.keywords);
    if (brief.description) metadata.description = brief.description;
    content.metadata = metadata;

    const publishDir = join(workDir, '4-publish');
    mkdirSync(publishDir, { recursive: true });
    writeFileSync(join(publishDir, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);

    // Target resolution
    const resolvedTargets = resolveItcTargets({
        explicitTargets: targetsArg ? targetsArg : undefined,
        explicitPreset: presetArg ? presetArg : undefined,
    });

    if (resolvedTargets.targets.length === 0) {
        // No targets to plan
        const emptyPlan: ItcPublishPlan = {
            schemaVersion: 1,
            live,
            sourceLocale: sourceLocale || 'en',
            origin: resolvedTargets.origin,
            variants: {},
            fanout: [],
            browser: [],
            targets: [],
        };
        writeFileSync(join(publishDir, 'publish-plan.json'), `${JSON.stringify(emptyPlan, null, 2)}\n`);
        return 0;
    }

    const { plugins } = discoverAllPlugins();
    const req: ItcPlanRequest = {
        schemaVersion: 1,
        workDir,
        sourceLocale: sourceLocale || 'en',
        live,
        targets: resolvedTargets.targets,
        origin: resolvedTargets.origin,
        presetName: resolvedTargets.presetName,
        presetDigest: resolvedTargets.presetDigest,
    };

    try {
        const plan = buildItcPublishPlan(req, plugins);
        const planPath = join(publishDir, 'publish-plan.json');
        writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

        // Prepare isolated target payloads
        await prepareTargetPayloads(workDir, plan);
        return 0;
    } catch (err: unknown) {
        console.error(`itc-materialize-plan: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/**
 * Prepares isolated payload files per target with mode-key unions cleared and specific metadata applied.
 */
async function prepareTargetPayloads(workDir: string, plan: ItcPublishPlan): Promise<void> {
    const publishDir = join(workDir, '4-publish');
    if (!plan.targets || plan.targets.length === 0) return;

    for (const target of plan.targets) {
        const variantEntry = plan.variants[target.variant];
        const baseFile = variantEntry?.file ?? 'content.json';
        let basePath = join(publishDir, baseFile);
        if (!existsSync(basePath)) {
            basePath = join(publishDir, 'content.json');
        }
        if (!existsSync(basePath)) continue;

        const baseContent = JSON.parse(readFileSync(basePath, 'utf-8')) as Content;
        const cleanedMetadata: Record<string, unknown> = { ...(baseContent.metadata ?? {}) };

        // Clear generic and mode-key union fields
        for (const k of ['operation', 'published', 'publishStatus', 'private', 'mode']) {
            delete cleanedMetadata[k];
        }

        // Apply target metadata binding
        const isolatedContent: Content = {
            ...baseContent,
            metadata: {
                ...cleanedMetadata,
                ...target.metadata,
            },
        };

        const targetFileName = `content.${target.plugin}.json`;
        const targetFilePath = join(publishDir, targetFileName);
        const contentStr = `${JSON.stringify(isolatedContent, null, 2)}\n`;
        writeFileSync(targetFilePath, contentStr);

        const payloadDigest = createHash('sha256').update(contentStr).digest('hex');
        target.payloadPath = `4-publish/${targetFileName}`;
        (target as unknown as Record<string, unknown>).payloadDigest = payloadDigest;
    }

    // Re-save plan with updated payloadPath and digests
    writeFileSync(join(publishDir, 'publish-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
}

/**
 * Checks plugin readiness probes for declared targets before sending.
 */
export async function itcCheckTargets(args: string[]): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        console.error('usage: itc-check-targets <work_dir>');
        return 1;
    }
    const planPath = join(workDir, '4-publish/publish-plan.json');
    if (!existsSync(planPath)) return 0;

    const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as ItcPublishPlan;
    if (!plan.targets || plan.targets.length === 0) return 0;

    const { plugins } = discoverAllPlugins();
    const byName = new Map(plugins.map((p) => [p.name, p]));

    for (const target of plan.targets) {
        const plugin = byName.get(target.plugin);
        if (plugin?.check) {
            // Run probe check
            const res = await Bun.spawn([process.execPath, plugin.check, 'check'], {
                env: process.env,
                stdout: 'pipe',
                stderr: 'pipe',
            }).exited;

            if (res !== 0) {
                const botName = plugin.browserSession?.profileName ?? plugin.name;
                console.error(
                    `channel probe for '${target.plugin}' refused: run \`kk bot open/login ${botName}\` to authenticate`,
                );
                return 1;
            }
        }
    }
    return 0;
}

/**
 * Dispatches target sends via executor fan-out and records receipt files under 4-publish/receipts/.
 */
export async function itcSendTargets(args: string[]): Promise<number> {
    const [workDir = ''] = args;
    const isRetry = args.includes('--retry');
    if (!workDir) {
        console.error('usage: itc-send-targets <work_dir> [--retry]');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!existsSync(planPath)) return 0;

    const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as ItcPublishPlan;
    if (!plan.targets || plan.targets.length === 0) return 0;

    const receiptsDir = join(publishDir, 'receipts');
    mkdirSync(receiptsDir, { recursive: true });

    const planRaw = readFileSync(planPath, 'utf-8');
    const planDigest = createHash('sha256').update(planRaw).digest('hex');

    for (const target of plan.targets) {
        const targetReceiptPath = join(receiptsDir, `${target.plugin}.json`);
        if (isRetry) {
            // In retry mode, only retry effect: none failures
            if (!existsSync(targetReceiptPath)) continue;
            try {
                const priorReceipt = JSON.parse(readFileSync(targetReceiptPath, 'utf-8')) as ItcReceipt;
                if (priorReceipt.status === 'succeeded' || priorReceipt.effect !== 'none') {
                    continue;
                }
            } catch {
                continue;
            }
        } else if (existsSync(targetReceiptPath)) {
            // If already succeeded, do not resend
            try {
                const prior = JSON.parse(readFileSync(targetReceiptPath, 'utf-8')) as ItcReceipt;
                if (prior.status === 'succeeded') continue;
            } catch {
                // re-attempt
            }
        }

        const payloadRel = target.payloadPath ?? `4-publish/content.${target.plugin}.json`;
        const payloadPath = join(workDir, payloadRel);
        const payloadRaw = existsSync(payloadPath) ? readFileSync(payloadPath, 'utf-8') : '{}';
        const payloadDigest = createHash('sha256').update(payloadRaw).digest('hex');

        const outPath = join(publishDir, `fanout-result.${target.plugin}.json`);
        const fanoutArgs = [
            '--content',
            payloadPath,
            '--target',
            target.plugin,
            '--out',
            outPath,
            ...(target.transport === 'browser' ? ['--serial-target', target.plugin] : []),
        ];

        let fanoutExit = 0;
        if (!existsSync(outPath)) {
            try {
                fanoutExit = await runFanout(fanoutArgs);
            } catch {
                fanoutExit = 1;
            }
        }

        let outcome: {
            ok?: boolean;
            status?: string;
            url?: string;
            error?: string;
            durationMs?: number;
            metadata?: Record<string, unknown>;
        } = {};
        if (existsSync(outPath)) {
            try {
                const agg = JSON.parse(readFileSync(outPath, 'utf-8')) as {
                    targets?: Array<{
                        target?: string;
                        ok?: boolean;
                        status?: string;
                        url?: string;
                        error?: string;
                        durationMs?: number;
                        metadata?: Record<string, unknown>;
                    }>;
                };
                const found = (agg.targets ?? []).find((t) => t.target === target.plugin);
                if (found) outcome = found;
            } catch {
                outcome = { ok: false, status: 'failed', error: 'failed to parse fanout result' };
            }
        }

        const isSuccess = fanoutExit === 0 && outcome.ok === true && outcome.status === 'published';
        const itcDelivery = outcome.metadata?.itcDelivery as
            | { effect?: 'none' | 'confirmed' | 'unknown'; publicUrlVerified?: boolean }
            | undefined;

        let effect: 'none' | 'confirmed' | 'unknown' = 'unknown';
        let publicUrlVerified = false;

        if (isSuccess) {
            effect = 'confirmed';
            if (target.mode === 'live' && outcome.url) {
                publicUrlVerified = itcDelivery?.publicUrlVerified === true;
            }
        } else if (itcDelivery?.effect === 'none') {
            effect = 'none';
        }

        const receipt: ItcReceipt = {
            schemaVersion: 1,
            parentRunId: 'itc-parent',
            planDigest,
            payloadDigest,
            plugin: target.plugin,
            profile: target.profile,
            mode: target.mode as 'draft' | 'live',
            attemptId: isRetry ? 'retry-1' : 'attempt-1',
            status: isSuccess ? 'succeeded' : effect === 'unknown' ? 'uncertain' : 'failed',
            effect,
            publicUrlVerified,
            ...(outcome.url ? { url: outcome.url } : {}),
            ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
            aggregatePath: outPath,
        };

        writeFileSync(targetReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
    return 0;
}

/**
 * Reconciles target receipts against the plan and settles store selection.
 */
export async function itcReconcileReceipts(args: string[]): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        console.error('usage: itc-reconcile-receipts <work_dir>');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!existsSync(planPath)) return 0;

    const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as ItcPublishPlan;
    if (!plan.targets || plan.targets.length === 0) {
        // No targets planned -> settle as author_only
        await itcSelectionSettle({
            schemaVersion: 1,
            intakeDir: workDir,
            parentRunId: 'itc-parent',
            topicProfile: 'ai-news',
            outcome: 'author_only',
        });
        return 0;
    }

    const receiptsDir = join(publishDir, 'receipts');
    const receipts: ItcReceipt[] = [];

    for (const target of plan.targets) {
        const rPath = join(receiptsDir, `${target.plugin}.json`);
        if (!existsSync(rPath)) {
            console.error(`itc-reconcile-receipts: missing receipt for target '${target.plugin}'`);
            return 1;
        }
        try {
            const r = JSON.parse(readFileSync(rPath, 'utf-8')) as ItcReceipt;
            receipts.push(r);
        } catch {
            console.error(`itc-reconcile-receipts: corrupt receipt for target '${target.plugin}'`);
            return 1;
        }
    }

    // Determine strongest known outcome
    let strongestOutcome: 'published' | 'uncertain' | 'author_only' | 'draft_only' | 'failed' = 'failed';
    const hasUncertain = receipts.some((r) => r.effect === 'unknown' || r.status === 'uncertain');
    const allSucceeded = receipts.every((r) => r.status === 'succeeded');

    if (hasUncertain) {
        strongestOutcome = 'uncertain';
    } else if (allSucceeded) {
        strongestOutcome = plan.live ? 'published' : 'draft_only';
    } else {
        strongestOutcome = 'failed';
    }

    await itcSelectionSettle({
        schemaVersion: 1,
        intakeDir: workDir,
        parentRunId: 'itc-parent',
        topicProfile: 'ai-news',
        outcome: strongestOutcome,
    });

    return 0;
}

/**
 * Exports SEO prepublish request and published pages handoffs.
 */
export async function itcExportSeo(args: string[]): Promise<number> {
    const [workDir = '', mode = 'handoff'] = args;
    if (!workDir) {
        console.error('usage: itc-export-seo <work_dir> [mode]');
        return 1;
    }
    const seoDir = join(workDir, 'seo');
    mkdirSync(seoDir, { recursive: true });

    if (mode === 'off') {
        writeFileSync(
            join(seoDir, 'prepublish-request.json'),
            `${JSON.stringify({ schemaVersion: 1, mode: 'off', status: 'not-assessed' }, null, 2)}\n`,
        );
        writeFileSync(
            join(seoDir, 'published-pages.json'),
            `${JSON.stringify({ schemaVersion: 1, mode: 'off', pages: [], status: 'not-assessed' }, null, 2)}\n`,
        );
        return 0;
    }

    // mode === 'handoff'
    const prepublish = {
        schemaVersion: 1,
        mode: 'handoff',
        status: 'ready',
        draftFile: '3-draft-draft-article.md',
    };
    writeFileSync(join(seoDir, 'prepublish-request.json'), `${JSON.stringify(prepublish, null, 2)}\n`);

    const receiptsDir = join(workDir, '4-publish/receipts');
    const verifiedPages: Array<{ plugin: string; url: string }> = [];

    if (existsSync(receiptsDir)) {
        for (const file of readdirSync(receiptsDir).filter((f) => f.endsWith('.json'))) {
            try {
                const r = JSON.parse(readFileSync(join(receiptsDir, file), 'utf-8')) as ItcReceipt;
                if (r.mode === 'live' && r.effect === 'confirmed' && r.publicUrlVerified === true && r.url) {
                    verifiedPages.push({ plugin: r.plugin, url: r.url });
                }
            } catch {
                // skip corrupt
            }
        }
    }

    const publishedPages = {
        schemaVersion: 1,
        mode: 'handoff',
        status: verifiedPages.length > 0 ? 'assessed' : 'not-assessed',
        pages: verifiedPages,
        ...(verifiedPages.length === 0 ? { reason: 'no verified public live URLs available' } : {}),
    };

    writeFileSync(join(seoDir, 'published-pages.json'), `${JSON.stringify(publishedPages, null, 2)}\n`);
    return 0;
}

/**
 * Emits final run summary report.json and report.md.
 */
export async function itcReportSummary(args: string[]): Promise<number> {
    const [workDir = '', maxRevisions = '2'] = args;
    if (!workDir) {
        console.error('usage: itc-report-summary <work_dir> [max_revisions]');
        return 1;
    }
    const reportDir = join(workDir, '5-report');
    mkdirSync(reportDir, { recursive: true });

    let verdict = 'PASS';
    let outcome = 'done';
    const verdictPath = join(workDir, '.itc-verdict.json');
    if (existsSync(verdictPath)) {
        try {
            const v = JSON.parse(readFileSync(verdictPath, 'utf-8')) as { verdict?: string; confidence?: string };
            verdict = v.verdict ?? 'PASS';
            if (verdict !== 'PASS') outcome = 'failed';
        } catch {
            outcome = 'failed';
        }
    }

    let revisions = 0;
    const revPath = join(workDir, '.auto-revise-count');
    if (existsSync(revPath)) {
        try {
            revisions = Number(readFileSync(revPath, 'utf-8').trim()) || 0;
        } catch {
            revisions = 0;
        }
    }

    const receiptsDir = join(workDir, '4-publish/receipts');
    const receipts: ItcReceipt[] = [];
    if (existsSync(receiptsDir)) {
        for (const file of readdirSync(receiptsDir).filter((f) => f.endsWith('.json'))) {
            try {
                const r = JSON.parse(readFileSync(join(receiptsDir, file), 'utf-8')) as ItcReceipt;
                receipts.push(r);
            } catch {
                // skip
            }
        }
    }

    if (receipts.some((r) => r.status === 'failed')) {
        outcome = 'failed';
    }

    const reportJson = {
        outcome,
        verdict,
        revisions,
        receipts,
        maxRevisions: Number(maxRevisions) || 2,
    };

    writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify(reportJson, null, 2)}\n`);

    const md = [
        '# ITC Publication Run Report',
        '',
        `- Outcome: ${outcome}`,
        `- Verdict: ${verdict}`,
        `- Revisions: ${revisions}`,
        `- Target Receipts: ${receipts.length}`,
        '',
        '## Targets',
        ...receipts.map((r) => `- ${r.plugin} (${r.profile}): status=${r.status}, effect=${r.effect}`),
    ].join('\n');

    writeFileSync(join(reportDir, 'report.md'), `${md}\n`);
    return 0;
}

/**
 * Judge disposition (0301/0302): collapse the verdict + revision counters into ONE
 * outcome word so each transition guard stays a single predicate over a result
 * file (ADR-115 composition budget).
 *
 * Writes `<workDir>/.itc/disposition.txt` with exactly one of:
 * `finish` | `revise` | `autorevise` | `fail`.
 */
export function itcAuthorVerdict(args: string[]): number {
    const [workDir = ''] = args;
    if (!workDir) {
        console.error('usage: itc-author-verdict <work_dir>');
        return 1;
    }
    const auto = process.env.KK_ITC_AUTO === 'true';
    const maxRevisions = Number(process.env.KK_ITC_MAX_REVISIONS ?? '2') || 2;

    const readCount = (name: string): number => {
        const p = join(workDir, name);
        if (!existsSync(p)) return 0;
        const n = Number(readFileSync(p, 'utf-8').trim());
        return Number.isFinite(n) ? n : 0;
    };

    const verdictPath = join(workDir, '.itc-verdict.json');
    let verdict = '';
    let confidence = '';
    if (existsSync(verdictPath)) {
        try {
            const v = JSON.parse(readFileSync(verdictPath, 'utf-8')) as {
                verdict?: unknown;
                confidence?: unknown;
            };
            verdict = typeof v.verdict === 'string' ? v.verdict : '';
            confidence = typeof v.confidence === 'string' ? v.confidence : '';
        } catch {
            verdict = 'malformed';
        }
    }

    let disposition: 'finish' | 'revise' | 'autorevise' | 'fail';
    if (verdict === '') {
        // No verdict file: the dry-run / manual-review convention treats it as a pass.
        disposition = 'finish';
    } else if (verdict === 'PASS' && ['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) {
        disposition = 'finish';
    } else if (verdict === 'NEEDS_REVISION') {
        if (auto) {
            disposition = readCount('.auto-revise-count') < maxRevisions ? 'autorevise' : 'fail';
        } else {
            disposition = readCount('.revise-count') < 3 ? 'revise' : 'fail';
        }
    } else {
        // FAIL, a PASS with an out-of-enum confidence, or an unparseable verdict.
        disposition = 'fail';
    }

    mkdirSync(join(workDir, '.itc'), { recursive: true });
    writeFileSync(join(workDir, '.itc/disposition.txt'), `${disposition}\n`);
    return 0;
}
