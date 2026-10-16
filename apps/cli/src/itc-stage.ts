import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverAllPlugins } from '@gobing-ai/kk-core';
import {
    type ItcEffectiveOptions,
    type ItcLaunchInput,
    resolveItcOptions,
    verifyItcOptionsSnapshot,
    writeItcOptionsSnapshot,
} from './itc-config';
import { ItcDecisionRequestSchema, itcDecision } from './itc-decision';
import { buildItcPublishPlan, type ItcPlanRequest, ItcPlanRequestSchema } from './itc-plan';
import {
    itcAuthorVerdict,
    itcCheckTargets,
    itcExportSeo,
    itcMaterializePlan,
    itcReconcileReceipts,
    itcReportSummary,
    itcSendTargets,
} from './itc-publish';
import { runItcTopicStage } from './itc-topic';

/**
 * Handle native ITC workflow stages asynchronously.
 * Returns the process exit code for an intercepted ITC stage, or `undefined` for a non-ITC stage.
 */
export async function runItcStage(args: string[]): Promise<number | undefined> {
    if (args.length === 0) return undefined;
    const stageName = args[0];

    if (stageName === 'itc-publish-plan') {
        return runItcPublishPlan(args.slice(1));
    }

    if (stageName === 'itc-materialize-plan') {
        return itcMaterializePlan(args.slice(1));
    }

    if (stageName === 'itc-check-targets') {
        return itcCheckTargets(args.slice(1));
    }

    if (stageName === 'itc-send-targets') {
        return itcSendTargets(args.slice(1));
    }

    if (stageName === 'itc-reconcile-receipts') {
        return itcReconcileReceipts(args.slice(1));
    }

    if (stageName === 'itc-export-seo') {
        return itcExportSeo(args.slice(1));
    }

    if (stageName === 'itc-report-summary') {
        return itcReportSummary(args.slice(1));
    }

    if (stageName === 'itc-prepare') {
        return runItcPrepare(args.slice(1));
    }

    if (stageName === 'itc-author-verdict') {
        return itcAuthorVerdict(args.slice(1));
    }

    if (stageName === 'itc-decision') {
        return runItcDecision(args.slice(1));
    }

    if (stageName === 'itc-author-complete') {
        return runItcAuthorComplete(args.slice(1));
    }

    if (
        stageName === 'itc-topic-extract' ||
        stageName === 'itc-topic-validate' ||
        stageName === 'itc-topic-select' ||
        stageName === 'itc-selection-settle'
    ) {
        return runItcTopicStage(stageName, args.slice(1));
    }

    return undefined;
}

function runItcPublishPlan(args: string[]): number {
    let request: ItcPlanRequest;

    const requestIdx = args.indexOf('--request');
    if (requestIdx !== -1) {
        const filePath = args[requestIdx + 1];
        if (!filePath || !existsSync(filePath)) {
            console.error(`itc-publish-plan: request file not found: ${filePath ?? ''}`);
            return 1;
        }
        try {
            const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
            const parsed = ItcPlanRequestSchema.safeParse(raw);
            if (!parsed.success) {
                console.error(`itc-publish-plan: invalid request schema: ${parsed.error.message}`);
                return 1;
            }
            request = parsed.data;
        } catch (err: unknown) {
            console.error(
                `itc-publish-plan: failed to read request file: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 1;
        }
    } else {
        const [workDir = '', targetsArg = '', sourceLocale = '', liveArg = ''] = args;
        if (!workDir || !targetsArg || !sourceLocale) {
            console.error('usage: itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>');
            return 1;
        }
        const live = liveArg === 'true';
        const targetTokens = targetsArg
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        const targets = targetTokens.map((token) => {
            const colonIdx = token.indexOf(':');
            if (colonIdx !== -1) {
                return {
                    plugin: token.slice(0, colonIdx),
                    profile: token.slice(colonIdx + 1),
                };
            }
            return { plugin: token };
        });

        request = {
            workDir,
            sourceLocale,
            live,
            targets,
        };
    }

    try {
        const { plugins } = discoverAllPlugins();
        const plan = buildItcPublishPlan(request, plugins);
        const outDir = join(request.workDir, '4-publish');
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, 'publish-plan.json'), `${JSON.stringify(plan, null, 4)}\n`);
        return 0;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        return 1;
    }
}

async function runItcDecision(args: string[]): Promise<number> {
    const requestIdx = args.indexOf('--request');
    const requestFile = requestIdx !== -1 ? args[requestIdx + 1] : undefined;
    if (!requestFile) {
        console.error('itc-decision: --request <JSON-file> is required');
        return 1;
    }
    if (!existsSync(requestFile)) {
        console.error(`itc-decision: request file not found: ${requestFile}`);
        return 1;
    }
    try {
        const raw = JSON.parse(readFileSync(requestFile, 'utf-8'));
        const parsed = ItcDecisionRequestSchema.parse(raw);
        await itcDecision(parsed);
        return 0;
    } catch (err: unknown) {
        console.error(`itc-decision: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

function runItcAuthorComplete(args: string[]): number {
    const [workDir = '', parentRunId = '', reviewModeArg = ''] = args;
    if (!workDir || !parentRunId) {
        console.error('usage: itc-author-complete <work_dir> <parentRunId> [reviewMode]');
        return 1;
    }
    const draftPath = join(workDir, '3-draft-draft-article.md');
    if (!existsSync(draftPath)) {
        console.error(`itc-author-complete: draft not found: ${draftPath}`);
        return 1;
    }
    const draftText = readFileSync(draftPath, 'utf-8');
    if (draftText.trim().length === 0) {
        console.error(`itc-author-complete: empty draft in ${draftPath}`);
        return 1;
    }
    const draftDigest = createHash('sha256').update(draftText).digest('hex');

    const outlinePath = join(workDir, '2-outline/outline-approved.md');
    if (!existsSync(outlinePath)) {
        console.error(`itc-author-complete: approved outline not found: ${outlinePath}`);
        return 1;
    }
    const outlineText = readFileSync(outlinePath, 'utf-8');
    if (outlineText.trim().length === 0) {
        console.error(`itc-author-complete: empty outline in ${outlinePath}`);
        return 1;
    }
    const outlineDigest = createHash('sha256').update(outlineText).digest('hex');

    const verdictPath = join(workDir, '.itc-verdict.json');
    let judgeDigest: string | null = null;
    let reviewMode: 'manual' | 'judged' = reviewModeArg === 'manual' ? 'manual' : 'judged';

    if (existsSync(verdictPath)) {
        try {
            const verdictRaw = readFileSync(verdictPath, 'utf-8');
            const verdictData = JSON.parse(verdictRaw) as { verdict?: unknown; confidence?: unknown };
            if (verdictData.verdict !== 'PASS') {
                console.error(`itc-author-complete: judge verdict is not PASS: ${String(verdictData.verdict)}`);
                return 1;
            }
            const conf = String(verdictData.confidence ?? '');
            if (!['HIGH', 'MEDIUM', 'LOW'].includes(conf)) {
                console.error(`itc-author-complete: judge confidence must be HIGH, MEDIUM, or LOW, got '${conf}'`);
                return 1;
            }
            judgeDigest = createHash('sha256').update(verdictRaw).digest('hex');
            reviewMode = 'judged';
        } catch (err: unknown) {
            console.error(
                `itc-author-complete: invalid verdict JSON: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 1;
        }
    } else {
        reviewMode = 'manual';
    }

    const runPath = join(workDir, '.itc/author-run.json');
    let childRunId = `${parentRunId}-author`;
    if (existsSync(runPath)) {
        try {
            const runMeta = JSON.parse(readFileSync(runPath, 'utf-8')) as { childRunId?: string };
            if (runMeta.childRunId) childRunId = runMeta.childRunId;
        } catch {
            // keep default
        }
    }

    const completeReceipt = {
        schemaVersion: 1,
        parentRunId,
        childRunId,
        draftDigest,
        outlineDigest,
        judgeDigest,
        reviewMode,
        status: 'complete',
    };

    const itcDir = join(workDir, '.itc');
    mkdirSync(itcDir, { recursive: true });
    writeFileSync(join(itcDir, 'author-complete.json'), `${JSON.stringify(completeReceipt, null, 2)}\n`);
    return 0;
}

/**
 * `itc-prepare` (0303): resolve the frozen ITC effective options from a launch JSON, compose the
 * workspace and persist `itc-options.json`. Validation happens BEFORE any mkdir, so an invalid
 * config or source stops without writing a workspace.
 */
async function runItcPrepare(args: string[]): Promise<number> {
    const requestIdx = args.indexOf('--request');
    const requestFile = requestIdx !== -1 ? args[requestIdx + 1] : undefined;
    if (requestFile === undefined || requestFile === '') {
        console.error('itc-prepare: --request <launch.json> is required');
        return 1;
    }
    if (!existsSync(requestFile)) {
        console.error(`itc-prepare: request file not found: ${requestFile}`);
        return 1;
    }
    let launch: ItcLaunchInput;
    try {
        launch = JSON.parse(readFileSync(requestFile, 'utf-8')) as ItcLaunchInput;
    } catch (err: unknown) {
        console.error(
            `itc-prepare: invalid JSON in ${requestFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 1;
    }

    let options: ItcEffectiveOptions;
    try {
        options = await resolveItcOptions(launch, {
            ...(process.env.KK_CONFIG ? { env: process.env } : {}),
        });
    } catch (err: unknown) {
        // R4: the key/file error is reported and NOTHING is written.
        console.error(`itc-prepare: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    const workDir = options.workDir;
    if (workDir === null) {
        // Collected-topic intake: no workspace exists yet; print the intake snapshot only.
        console.log(JSON.stringify(options));
        return 0;
    }

    const reuseCheck = await verifyItcOptionsSnapshot(workDir, options);
    if (reuseCheck.ok === false && !options.force) {
        console.error(`itc-prepare: ${reuseCheck.reason}`);
        return 1;
    }

    try {
        await writeItcOptionsSnapshot(workDir, options);
    } catch (err: unknown) {
        console.error(
            `itc-prepare: cannot write the workspace at ${workDir}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 1;
    }
    console.log(JSON.stringify(options));
    return 0;
}
