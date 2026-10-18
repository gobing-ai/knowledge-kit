import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { type Content, discoverAllPlugins, type PluginRecord } from '@gobing-ai/kk-core';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import { runFanout } from './fanout';
import { pluginProcessEnv } from './invoke';
import type { ItcEffectiveOptions } from './itc-config';
import { itcDecision } from './itc-decision';
import { buildItcPublishPlan, type ItcPlanRequest, type ItcPublishPlan, resolveItcTargets } from './itc-plan';
import { type ChosenSourceArtifact, type ItcSelectionSettleRequest, itcSelectionSettle } from './itc-topic';

/** Delivery effect a publish plugin reports alongside its result. */
export const ItcDeliveryMetadataSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        effect: z.enum(['none', 'confirmed', 'unknown']),
        publicUrlVerified: z.boolean().optional(),
    })
    .strict();

/** Per-target publish receipt bound to the parent run, plan digest and payload digest. */
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

/** Parsed ITC publish receipt. */
export type ItcReceipt = z.infer<typeof ItcReceiptSchema>;

/** First `cover.*` in 4-illustrations as an ABSOLUTE path (plugins run with cwd != workDir and reject relative paths), or undefined. */
async function findCover(fs: FileSystem, workDir: string): Promise<string | undefined> {
    const dir = join(workDir, '4-illustrations');
    if (!(await fs.exists(dir))) return undefined;
    const cover = (await fs.readDir(dir)).find((file) => file.startsWith('cover.'));
    return cover ? join(dir, cover) : undefined;
}

async function readFrontmatter(fs: FileSystem, path: string): Promise<Record<string, string>> {
    if (!(await fs.exists(path))) return {};
    const text = await fs.readFile(path);
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
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

/**
 * Materializes 4-publish/content.json and resolves target publication plan.
 */
export async function itcMaterializePlan(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = '', ...positional] = args;
    if (!workDir) {
        echoError('usage: itc-materialize-plan <work_dir> [targets] [source_locale] [publish_live] [preset]');
        return 1;
    }
    // The frozen launch snapshot (0303) wins over positional args, which remain for legacy callers.
    const snapshot = await readOptionsSnapshot(fs, workDir);
    const [targetsArg = '', sourceLocale = '', liveArg = '', presetArg = ''] = snapshot
        ? [snapshot.publishTargets, snapshot.sourceLocale, String(snapshot.publishLive), '']
        : positional;
    const live = liveArg === 'true';
    const draftPath = join(workDir, '3-draft-draft-article.md');
    if (!(await fs.exists(draftPath))) {
        echoError(`final draft not found: ${draftPath}`);
        return 1;
    }
    const lines = (await fs.readFile(draftPath)).split('\n');
    const h1 = lines.findIndex((line) => /^#\s+\S/.test(line));
    if (h1 < 0) {
        echoError(`no H1 title in ${draftPath}`);
        return 1;
    }
    const title = lines[h1]?.replace(/^#\s+/, '').trim() ?? '';
    const body = [...lines.slice(0, h1), ...lines.slice(h1 + 1)].join('\n').trim();
    if (!body) {
        echoError(`empty body in ${draftPath}`);
        return 1;
    }

    const content: Record<string, unknown> = { title, format: 'markdown', body };
    const outlinePath = join(workDir, '2-outline', 'outline-approved.md');
    if (await fs.exists(outlinePath)) content.outline = (await fs.readFile(outlinePath)).trim();

    const docsPath = join(workDir, 'docs.json');
    if (await fs.exists(docsPath)) {
        try {
            const docs = JSON.parse(await fs.readFile(docsPath)) as Array<{
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
    const cover = await findCover(fs, workDir);
    if (cover) metadata.coverImage = cover;
    const brief = await readFrontmatter(fs, join(workDir, 'brief.md'));
    if (brief.tags) metadata.tags = splitList(brief.tags);
    if (brief.keywords) metadata.keywords = splitList(brief.keywords);
    if (brief.description) metadata.description = brief.description;
    content.metadata = metadata;

    const publishDir = join(workDir, '4-publish');
    await fs.ensureDir(publishDir);
    await fs.writeFile(join(publishDir, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);

    // Target resolution
    const fromLaunch = snapshot?.publishPresetSource === 'launch' ? snapshot.publishPreset : null;
    const fromConfig = snapshot?.publishPresetSource === 'config' ? snapshot.publishPreset : null;
    let resolvedTargets: Awaited<ReturnType<typeof resolveItcTargets>>;
    try {
        resolvedTargets = await resolveItcTargets(
            {
                explicitTargets: targetsArg ? targetsArg : undefined,
                explicitPreset: presetArg ? presetArg : (fromLaunch ?? undefined),
                workflowConfigPreset: fromConfig ?? undefined,
                topicProfile: snapshot?.topicProfile ?? undefined,
                projectRoot: snapshot?.launchProjectRoot,
            },
            fs,
        );
    } catch (err: unknown) {
        echoError(`itc-materialize-plan: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    // A topic-profile preset is only a suggestion: a bounded decision accepts it or plans nothing.
    if (resolvedTargets.origin === 'topic-profile' && snapshot) {
        const decision = await itcDecision(
            {
                parentRunId: snapshot.parentRunId,
                decisionId: 'kk-itc-preset-choice',
                candidates: [
                    {
                        id: 'suggested',
                        title: `${resolvedTargets.presetName}: ${resolvedTargets.targets.map((t) => t.plugin).join(', ')}`,
                    },
                ],
                outPath: join(workDir, '4-publish', 'preset-decision.json'),
            },
            fs,
        );
        if (decision.value !== 'suggested') resolvedTargets = { targets: [], origin: 'none' };
    }

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
        await fs.writeFile(join(publishDir, 'publish-plan.json'), `${JSON.stringify(emptyPlan, null, 2)}\n`);
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
        const plan = await buildItcPublishPlan(req, plugins, fs);
        const planPath = join(publishDir, 'publish-plan.json');
        await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);

        // Prepare isolated target payloads
        await prepareTargetPayloads(fs, workDir, plan, plugins);
        return 0;
    } catch (err: unknown) {
        echoError(`itc-materialize-plan: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/** The frozen `itc-options.json` fields materialize reads; absent for legacy positional callers. */
async function readOptionsSnapshot(
    fs: FileSystem,
    workDir: string,
): Promise<
    | Pick<
          ItcEffectiveOptions,
          | 'parentRunId'
          | 'publishTargets'
          | 'sourceLocale'
          | 'publishLive'
          | 'publishPreset'
          | 'publishPresetSource'
          | 'topicProfile'
          | 'launchProjectRoot'
      >
    | undefined
> {
    const path = join(workDir, 'itc-options.json');
    if (!(await fs.exists(path))) return undefined;
    return JSON.parse(await fs.readFile(path)) as ItcEffectiveOptions;
}

/**
 * Prepares isolated payload files per target with mode-key unions cleared and specific metadata applied.
 */
async function prepareTargetPayloads(
    fs: FileSystem,
    workDir: string,
    plan: ItcPublishPlan,
    plugins: readonly PluginRecord[],
): Promise<void> {
    const publishDir = join(workDir, '4-publish');
    if (!plan.targets || plan.targets.length === 0) return;
    const planned = new Set(plan.targets.map((t) => t.plugin));
    const modeKeys = new Set(['operation', 'published', 'publishStatus', 'private', 'mode']);
    for (const plugin of plugins) {
        if (!planned.has(plugin.name)) continue;
        for (const profile of Object.values(plugin.publishing?.profiles ?? {})) {
            for (const binding of Object.values(profile.modes)) {
                for (const key of Object.keys(binding?.metadata ?? {})) modeKeys.add(key);
            }
        }
    }

    for (const target of plan.targets) {
        const variantEntry = plan.variants[target.variant];
        const baseFile = variantEntry?.file ?? 'content.json';
        let basePath = join(publishDir, baseFile);
        if (!(await fs.exists(basePath))) {
            basePath = join(publishDir, 'content.json');
        }
        if (!(await fs.exists(basePath))) continue;

        const baseContent = JSON.parse(await fs.readFile(basePath)) as Content;
        const cleanedMetadata: Record<string, unknown> = { ...(baseContent.metadata ?? {}) };

        // Clear every mode switch any planned profile declares, so no target inherits another's.
        for (const k of modeKeys) {
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
        await fs.writeFile(targetFilePath, contentStr);

        const payloadDigest = createHash('sha256').update(contentStr).digest('hex');
        target.payloadPath = `4-publish/${targetFileName}`;
        (target as unknown as Record<string, unknown>).payloadDigest = payloadDigest;
    }

    // Re-save plan with updated payloadPath and digests
    await fs.writeFile(join(publishDir, 'publish-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
}

/**
 * Checks plugin readiness probes for declared targets before sending.
 */
export async function itcCheckTargets(
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
    executor: ProcessExecutor = new NodeProcessExecutor(),
): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        echoError('usage: itc-check-targets <work_dir>');
        return 1;
    }
    const planPath = join(workDir, '4-publish/publish-plan.json');
    if (!(await fs.exists(planPath))) return 0;

    const plan = JSON.parse(await fs.readFile(planPath)) as ItcPublishPlan;
    if (!plan.targets || plan.targets.length === 0) return 0;

    const { plugins } = discoverAllPlugins();
    const byName = new Map(plugins.map((p) => [p.name, p]));

    for (const target of plan.targets) {
        const plugin = byName.get(target.plugin);
        if (plugin?.check) {
            // Run probe check through the process seam (no direct spawn). Env comes from the
            // shared injection seam (0311): config plugin env under process.env, project root
            // anchored — the same env the send path hands this plugin.
            const probe = await executor.run({
                command: process.execPath,
                args: [plugin.check, 'check'],
                env: pluginProcessEnv(plugin.kind, plugin.name) as Record<string, string>,
                timeout: 60_000,
            });

            if (probe.exitCode !== 0) {
                // The probe's last stdout line carries {status, detail} — surface it so e.g. a
                // stale profile SingletonLock isn't misreported as an auth expiry (dogfood 2026-10-17).
                let detail = '';
                try {
                    const last = probe.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
                    const parsed = JSON.parse(last) as { status?: string; detail?: string };
                    if (parsed.detail) detail = `${parsed.status ?? 'refused'}: ${parsed.detail}`;
                } catch {
                    // keep the generic hint
                }
                const botName = plugin.browserSession?.profileName ?? plugin.name;
                echoError(
                    detail
                        ? `channel probe for '${target.plugin}' refused: ${detail}`
                        : `channel probe for '${target.plugin}' refused: run \`kk bot open/login ${botName}\` to authenticate`,
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
export async function itcSendTargets(
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
    dispatch: (argv: string[]) => Promise<number> = runFanout,
): Promise<number> {
    const [workDir = ''] = args;
    const isRetry = args.includes('--retry');
    if (!workDir) {
        echoError('usage: itc-send-targets <work_dir> [--retry]');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!(await fs.exists(planPath))) return 0;

    const plan = JSON.parse(await fs.readFile(planPath)) as ItcPublishPlan;
    if (!plan.targets || plan.targets.length === 0) return 0;
    // A receipt is evidence for one run; without the frozen snapshot there is no run to bind it to.
    const parentRunId = (await readOptionsSnapshot(fs, workDir))?.parentRunId;
    if (!parentRunId) {
        echoError(`itc-send-targets: ${join(workDir, 'itc-options.json')} has no parentRunId`);
        return 1;
    }

    const receiptsDir = join(publishDir, 'receipts');
    await fs.ensureDir(receiptsDir);

    const planRaw = await fs.readFile(planPath);
    const planDigest = createHash('sha256').update(planRaw).digest('hex');

    for (const target of plan.targets) {
        const targetReceiptPath = join(receiptsDir, `${target.plugin}.json`);
        let reattempt = false;
        if (isRetry) {
            // In retry mode, only retry effect: none failures
            if (!(await fs.exists(targetReceiptPath))) continue;
            try {
                const priorReceipt = JSON.parse(await fs.readFile(targetReceiptPath)) as ItcReceipt;
                if (priorReceipt.status === 'succeeded' || priorReceipt.effect !== 'none') {
                    continue;
                }
            } catch {
                continue;
            }
            reattempt = true;
        } else if (await fs.exists(targetReceiptPath)) {
            // If already succeeded, do not resend
            try {
                const prior = JSON.parse(await fs.readFile(targetReceiptPath)) as ItcReceipt;
                if (prior.status === 'succeeded') continue;
            } catch {
                // re-attempt
            }
            reattempt = true;
        }

        const payloadRel = target.payloadPath ?? `4-publish/content.${target.plugin}.json`;
        const payloadPath = join(workDir, payloadRel);
        const payloadRaw = (await fs.exists(payloadPath)) ? await fs.readFile(payloadPath) : '{}';
        const payloadDigest = createHash('sha256').update(payloadRaw).digest('hex');

        const outPath = join(publishDir, `fanout-result.${target.plugin}${isRetry ? '.retry' : ''}.json`);
        // A re-attempt must re-dispatch: the exists guard is only crash recovery for a dispatch
        // that never got its receipt written. Reusing the aggregate would re-read the old failure
        // (dogfood 2026-10-17: fixed-target resend silently kept the stale error).
        if (reattempt && (await fs.exists(outPath))) await fs.deleteFile(outPath);
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
        if (!(await fs.exists(outPath))) {
            try {
                fanoutExit = await dispatch(fanoutArgs);
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
        if (await fs.exists(outPath)) {
            try {
                const agg = JSON.parse(await fs.readFile(outPath)) as {
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
            parentRunId,
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

        await fs.writeFile(targetReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
    return 0;
}

/**
 * Reconciles target receipts against the plan and settles store selection.
 */
export async function itcReconcileReceipts(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        echoError('usage: itc-reconcile-receipts <work_dir>');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!(await fs.exists(planPath))) return 0;

    const plan = JSON.parse(await fs.readFile(planPath)) as ItcPublishPlan;
    // Only a collected-topic run holds a store selection; a brief-driven run has nothing to settle.
    const chosenPath = join(workDir, 'chosen-source.json');
    const chosen = (await fs.exists(chosenPath))
        ? (JSON.parse(await fs.readFile(chosenPath)) as ChosenSourceArtifact)
        : undefined;
    const settle = async (outcome: ItcSelectionSettleRequest['outcome']): Promise<void> => {
        if (chosen === undefined) return;
        await itcSelectionSettle(
            {
                schemaVersion: 1,
                intakeDir: workDir,
                parentRunId: chosen.parentRunId,
                topicProfile: chosen.topicProfile,
                outcome,
            },
            fs,
        );
    };
    if (!plan.targets || plan.targets.length === 0) {
        await settle('author_only');
        return 0;
    }

    const receiptsDir = join(publishDir, 'receipts');
    const receipts: ItcReceipt[] = [];

    for (const target of plan.targets) {
        const rPath = join(receiptsDir, `${target.plugin}.json`);
        if (!(await fs.exists(rPath))) {
            echoError(`itc-reconcile-receipts: missing receipt for target '${target.plugin}'`);
            return 1;
        }
        try {
            const r = JSON.parse(await fs.readFile(rPath)) as ItcReceipt;
            receipts.push(r);
        } catch {
            echoError(`itc-reconcile-receipts: corrupt receipt for target '${target.plugin}'`);
            return 1;
        }
    }

    // Strongest known outcome: one confirmed live send promotes the selection; otherwise an
    // unresolved remote effect retains it for reconciliation; anything else releases it.
    const liveSuccess = receipts.some((r) => r.mode === 'live' && r.status === 'succeeded');
    const hasUncertain = receipts.some((r) => r.effect === 'unknown' || r.status === 'uncertain');
    const allSucceeded = receipts.every((r) => r.status === 'succeeded');
    await settle(liveSuccess ? 'published' : hasUncertain ? 'uncertain' : allSucceeded ? 'draft_only' : 'failed');

    return 0;
}

/**
 * Exports SEO prepublish request and published pages handoffs.
 */
export async function itcExportSeo(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = '', mode = 'handoff'] = args;
    if (!workDir) {
        echoError('usage: itc-export-seo <work_dir> [mode]');
        return 1;
    }
    const seoDir = join(workDir, 'seo');
    await fs.ensureDir(seoDir);

    if (mode === 'off') {
        await fs.writeFile(
            join(seoDir, 'prepublish-request.json'),
            `${JSON.stringify({ schemaVersion: 1, mode: 'off', status: 'not-assessed' }, null, 2)}\n`,
        );
        await fs.writeFile(
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
    await fs.writeFile(join(seoDir, 'prepublish-request.json'), `${JSON.stringify(prepublish, null, 2)}\n`);

    const receiptsDir = join(workDir, '4-publish/receipts');
    const verifiedPages: Array<{ plugin: string; url: string }> = [];

    if (await fs.exists(receiptsDir)) {
        for (const file of (await fs.readDir(receiptsDir)).filter((f) => f.endsWith('.json'))) {
            try {
                const r = JSON.parse(await fs.readFile(join(receiptsDir, file))) as ItcReceipt;
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

    await fs.writeFile(join(seoDir, 'published-pages.json'), `${JSON.stringify(publishedPages, null, 2)}\n`);
    return 0;
}

/**
 * Emits final run summary report.json and report.md.
 */
export async function itcReportSummary(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = '', maxRevisions = '2'] = args;
    if (!workDir) {
        echoError('usage: itc-report-summary <work_dir> [max_revisions]');
        return 1;
    }
    const reportDir = join(workDir, '5-report');
    await fs.ensureDir(reportDir);

    let verdict = 'PASS';
    let outcome = 'done';
    const verdictPath = join(workDir, '.itc-verdict.json');
    if (await fs.exists(verdictPath)) {
        try {
            const v = JSON.parse(await fs.readFile(verdictPath)) as { verdict?: string; confidence?: string };
            verdict = v.verdict ?? 'PASS';
            if (verdict !== 'PASS') outcome = 'failed';
        } catch {
            outcome = 'failed';
        }
    }

    let revisions = 0;
    const revPath = join(workDir, '.auto-revise-count');
    if (await fs.exists(revPath)) {
        try {
            revisions = Number((await fs.readFile(revPath)).trim()) || 0;
        } catch {
            revisions = 0;
        }
    }

    const receiptsDir = join(workDir, '4-publish/receipts');
    const receipts: ItcReceipt[] = [];
    if (await fs.exists(receiptsDir)) {
        for (const file of (await fs.readDir(receiptsDir)).filter((f) => f.endsWith('.json'))) {
            try {
                const r = JSON.parse(await fs.readFile(join(receiptsDir, file))) as ItcReceipt;
                receipts.push(r);
            } catch {
                // skip
            }
        }
    }

    if (receipts.some((r) => r.status !== 'succeeded')) {
        outcome = 'failed';
    }

    // R5: the receipts must be exactly the frozen plan's targets, bound to that plan's digest.
    const planPath = join(workDir, '4-publish/publish-plan.json');
    let targetContract: { expected: string[]; observed: string[]; stale: string[] } | undefined;
    if (await fs.exists(planPath)) {
        const planRaw = await fs.readFile(planPath);
        const planDigest = createHash('sha256').update(planRaw).digest('hex');
        const expected = ((JSON.parse(planRaw) as ItcPublishPlan).targets ?? []).map((t) => t.plugin).sort();
        const observed = receipts.map((r) => r.plugin).sort();
        const stale = receipts.filter((r) => r.planDigest !== planDigest).map((r) => r.plugin);
        if (expected.join('\n') !== observed.join('\n') || stale.length > 0) {
            targetContract = { expected, observed, stale };
            outcome = 'failed';
        }
    }

    const reportJson = {
        outcome,
        verdict,
        revisions,
        receipts,
        ...(targetContract ? { targetContractFailure: targetContract } : {}),
        maxRevisions: Number(maxRevisions) || 2,
    };

    await fs.writeFile(join(reportDir, 'report.json'), `${JSON.stringify(reportJson, null, 2)}\n`);

    const md = [
        '# ITC Publication Run Report',
        '',
        `- Outcome: ${outcome}`,
        `- Verdict: ${verdict}`,
        `- Revisions: ${revisions}`,
        `- Target Receipts: ${receipts.length}`,
        ...(targetContract
            ? [
                  `- Target contract failure: expected [${targetContract.expected.join(', ')}], observed [${targetContract.observed.join(', ')}], stale [${targetContract.stale.join(', ')}]`,
              ]
            : []),
        '',
        '## Targets',
        ...receipts.map((r) => `- ${r.plugin} (${r.profile}): status=${r.status}, effect=${r.effect}`),
    ].join('\n');

    await fs.writeFile(join(reportDir, 'report.md'), `${md}\n`);
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
export async function itcAuthorVerdict(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        echoError('usage: itc-author-verdict <work_dir>');
        return 1;
    }
    const auto = process.env.KK_ITC_AUTO === 'true';
    const maxRevisions = Number(process.env.KK_ITC_MAX_REVISIONS ?? '2') || 2;

    const readCount = async (name: string): Promise<number> => {
        const p = join(workDir, name);
        if (!(await fs.exists(p))) return 0;
        const n = Number((await fs.readFile(p)).trim());
        return Number.isFinite(n) ? n : 0;
    };

    const verdictPath = join(workDir, '.itc-verdict.json');
    let verdict = '';
    let confidence = '';
    if (await fs.exists(verdictPath)) {
        try {
            const v = JSON.parse(await fs.readFile(verdictPath)) as {
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
            disposition = (await readCount('.auto-revise-count')) < maxRevisions ? 'autorevise' : 'fail';
        } else {
            disposition = (await readCount('.revise-count')) < 3 ? 'revise' : 'fail';
        }
    } else {
        // FAIL, a PASS with an out-of-enum confidence, or an unparseable verdict.
        disposition = 'fail';
    }

    await fs.ensureDir(join(workDir, '.itc'));
    await fs.writeFile(join(workDir, '.itc/disposition.txt'), `${disposition}\n`);
    return 0;
}
