import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { discoverAllPlugins } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import {
    type ChosenTopic,
    finalizeItcCollectedOptions,
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
export async function runItcStage(
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
): Promise<number | undefined> {
    if (args.length === 0) return undefined;
    const stageName = args[0];

    if (stageName === 'itc-publish-plan') {
        return runItcPublishPlan(args.slice(1), fs);
    }

    if (stageName === 'itc-materialize-plan') {
        return itcMaterializePlan(args.slice(1), fs);
    }

    if (stageName === 'itc-check-targets') {
        return itcCheckTargets(args.slice(1), fs);
    }

    if (stageName === 'itc-send-targets') {
        return itcSendTargets(args.slice(1), fs);
    }

    if (stageName === 'itc-reconcile-receipts') {
        return itcReconcileReceipts(args.slice(1), fs);
    }

    if (stageName === 'itc-export-seo') {
        return itcExportSeo(args.slice(1), fs);
    }

    if (stageName === 'itc-report-summary') {
        return itcReportSummary(args.slice(1), fs);
    }

    if (stageName === 'itc-prepare') {
        return runItcPrepare(args.slice(1), fs);
    }

    if (stageName === 'itc-author-verdict') {
        return itcAuthorVerdict(args.slice(1), fs);
    }

    if (stageName === 'itc-decision') {
        return runItcDecision(args.slice(1), fs);
    }

    if (stageName === 'itc-author-complete') {
        return runItcAuthorComplete(args.slice(1), fs);
    }

    if (
        stageName === 'itc-topic-extract' ||
        stageName === 'itc-topic-validate' ||
        stageName === 'itc-topic-select' ||
        stageName === 'itc-selection-settle'
    ) {
        return runItcTopicStage(stageName, args.slice(1), fs);
    }

    return undefined;
}

async function runItcPublishPlan(args: string[], fs: FileSystem): Promise<number> {
    let request: ItcPlanRequest;

    const requestIdx = args.indexOf('--request');
    if (requestIdx !== -1) {
        const filePath = args[requestIdx + 1];
        if (filePath === undefined || filePath === '' || !(await fs.exists(filePath))) {
            echoError(`itc-publish-plan: request file not found: ${filePath ?? ''}`);
            return 1;
        }
        try {
            const raw = JSON.parse(await fs.readFile(filePath));
            const parsed = ItcPlanRequestSchema.safeParse(raw);
            if (!parsed.success) {
                echoError(`itc-publish-plan: invalid request schema: ${parsed.error.message}`);
                return 1;
            }
            request = parsed.data;
        } catch (err: unknown) {
            echoError(
                `itc-publish-plan: failed to read request file: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 1;
        }
    } else {
        const [workDir = '', targetsArg = '', sourceLocale = '', liveArg = ''] = args;
        if (!workDir || !targetsArg || !sourceLocale) {
            echoError('usage: itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>');
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
        const plan = await buildItcPublishPlan(request, plugins, fs);
        const outDir = join(request.workDir, '4-publish');
        await fs.ensureDir(outDir);
        await fs.writeFile(join(outDir, 'publish-plan.json'), `${JSON.stringify(plan, null, 4)}\n`);
        // A skipped target is not an error, but the operator must see which one was dropped.
        for (const warning of plan.warnings ?? []) echoError(`itc-publish-plan: ${warning}`);
        return 0;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        echoError(msg);
        return 1;
    }
}

async function runItcDecision(args: string[], fs: FileSystem): Promise<number> {
    if (args[0] === '--outline' || args[0] === '--topic') return runSlotDecision(args, fs);
    const requestIdx = args.indexOf('--request');
    const requestFile = requestIdx !== -1 ? args[requestIdx + 1] : undefined;
    if (!requestFile) {
        echoError('itc-decision: --request <JSON-file> is required');
        return 1;
    }
    if (!(await fs.exists(requestFile))) {
        echoError(`itc-decision: request file not found: ${requestFile}`);
        return 1;
    }
    try {
        const raw = JSON.parse(await fs.readFile(requestFile));
        const parsed = ItcDecisionRequestSchema.parse(raw);
        await itcDecision(parsed, fs);
        return 0;
    } catch (err: unknown) {
        echoError(`itc-decision: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/**
 * Workflow-facing decision forms that build the bounded candidate set from real slot files:
 * `--outline <work_dir> <parentRunId>` binds the outline pick into `2-outline/.auto-pick` (empty on
 * defer, so the child pauses for the operator instead of guessing); `--topic <intake_dir>
 * <parentRunId>` prints the chosen candidate id or `defer`.
 */
async function runSlotDecision(args: string[], fs: FileSystem): Promise<number> {
    const [mode, dir = '', parentRunId = ''] = args;
    if (!dir || !parentRunId) {
        echoError(`itc-decision: usage: itc-decision ${mode} <dir> <parentRunId>`);
        return 1;
    }
    try {
        if (mode === '--topic') {
            const candidatesPath = join(dir, 'topic-candidates.json');
            const artifact = JSON.parse(await fs.readFile(candidatesPath)) as {
                candidates: Array<{ id: string; title: string; reason: string }>;
            };
            const result = await itcDecision(
                {
                    parentRunId,
                    decisionId: 'kk-itc-topic-choice',
                    candidates: artifact.candidates.map((c) => ({ id: c.id, title: c.title, description: c.reason })),
                    evidenceFiles: [candidatesPath],
                    outPath: join(dir, 'topic-decision.json'),
                },
                fs,
            );
            echo(result.value);
            return 0;
        }
        const outlineDir = join(dir, '2-outline');
        const candidates: Array<{ id: string; title: string }> = [];
        const evidenceFiles: string[] = [];
        for (const id of ['a', 'b', 'c']) {
            const file = join(outlineDir, `outline-option-${id}.md`);
            if (!(await fs.exists(file))) continue;
            const heading = (await fs.readFile(file)).split('\n').find((line) => line.trim() !== '') ?? id;
            candidates.push({ id, title: heading.replace(/^#+\s*/, '').trim() });
            evidenceFiles.push(file);
        }
        if (candidates.length === 0) throw new Error(`no outline options in ${outlineDir}`);
        evidenceFiles.push(join(outlineDir, 'outline-recommendation.json'));
        const result = await itcDecision(
            {
                parentRunId,
                decisionId: 'kk-itc-outline-choice',
                candidates,
                evidenceFiles,
                outPath: join(outlineDir, 'outline-decision.json'),
            },
            fs,
        );
        const pick = result.value === 'defer' ? '' : result.value;
        if (pick === '') echoError(`itc-decision: outline choice deferred to the operator: ${result.reason}`);
        await fs.writeFile(join(outlineDir, '.auto-pick'), pick);
        return 0;
    } catch (err: unknown) {
        echoError(`itc-decision: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

async function runItcAuthorComplete(args: string[], fs: FileSystem): Promise<number> {
    const [workDir = '', parentRunId = '', reviewModeArg = ''] = args;
    if (!workDir || !parentRunId) {
        echoError('usage: itc-author-complete <work_dir> <parentRunId> [reviewMode]');
        return 1;
    }
    const draftPath = join(workDir, '3-draft-draft-article.md');
    if (!(await fs.exists(draftPath))) {
        echoError(`itc-author-complete: draft not found: ${draftPath}`);
        return 1;
    }
    const draftText = await fs.readFile(draftPath);
    if (draftText.trim().length === 0) {
        echoError(`itc-author-complete: empty draft in ${draftPath}`);
        return 1;
    }
    const draftDigest = createHash('sha256').update(draftText).digest('hex');

    const outlinePath = join(workDir, '2-outline/outline-approved.md');
    if (!(await fs.exists(outlinePath))) {
        echoError(`itc-author-complete: approved outline not found: ${outlinePath}`);
        return 1;
    }
    const outlineText = await fs.readFile(outlinePath);
    if (outlineText.trim().length === 0) {
        echoError(`itc-author-complete: empty outline in ${outlinePath}`);
        return 1;
    }
    const outlineDigest = createHash('sha256').update(outlineText).digest('hex');

    const verdictPath = join(workDir, '.itc-verdict.json');
    let judgeDigest: string | null = null;
    let reviewMode: 'manual' | 'judged' = reviewModeArg === 'manual' ? 'manual' : 'judged';

    if (await fs.exists(verdictPath)) {
        try {
            const verdictRaw = await fs.readFile(verdictPath);
            const verdictData = JSON.parse(verdictRaw) as { verdict?: unknown; confidence?: unknown };
            if (verdictData.verdict !== 'PASS') {
                echoError(`itc-author-complete: judge verdict is not PASS: ${String(verdictData.verdict)}`);
                return 1;
            }
            const conf = String(verdictData.confidence ?? '');
            if (!['HIGH', 'MEDIUM', 'LOW'].includes(conf)) {
                echoError(`itc-author-complete: judge confidence must be HIGH, MEDIUM, or LOW, got '${conf}'`);
                return 1;
            }
            judgeDigest = createHash('sha256').update(verdictRaw).digest('hex');
            reviewMode = 'judged';
        } catch (err: unknown) {
            echoError(`itc-author-complete: invalid verdict JSON: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
    } else {
        reviewMode = 'manual';
    }

    const runPath = join(workDir, '.itc/author-run.json');
    let childRunId = `${parentRunId}-author`;
    if (await fs.exists(runPath)) {
        try {
            const runMeta = JSON.parse(await fs.readFile(runPath)) as { childRunId?: string };
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
    await fs.ensureDir(itcDir);
    await fs.writeFile(join(itcDir, 'author-complete.json'), `${JSON.stringify(completeReceipt, null, 2)}\n`);
    return 0;
}

/**
 * `itc-prepare` (0303): resolve the frozen ITC effective options from a launch JSON, compose the
 * workspace and persist `itc-options.json`. Validation happens BEFORE any mkdir, so an invalid
 * config or source stops without writing a workspace.
 */
async function runItcPrepare(args: string[], fs: FileSystem): Promise<number> {
    const requestIdx = args.indexOf('--request');
    const requestFile = requestIdx !== -1 ? args[requestIdx + 1] : undefined;
    if (requestFile === undefined || requestFile === '') {
        echoError('itc-prepare: --request <launch.json> is required');
        return 1;
    }
    if (!(await fs.exists(requestFile))) {
        echoError(`itc-prepare: request file not found: ${requestFile}`);
        return 1;
    }
    let launch: ItcLaunchInput;
    try {
        launch = JSON.parse(await fs.readFile(requestFile)) as ItcLaunchInput;
    } catch (err: unknown) {
        echoError(`itc-prepare: invalid JSON in ${requestFile}: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    let options: ItcEffectiveOptions;
    try {
        options = await resolveItcOptions(
            launch,
            {
                ...(process.env.KK_CONFIG ? { env: process.env } : {}),
            },
            fs,
        );
    } catch (err: unknown) {
        // R4: the key/file error is reported and NOTHING is written.
        echoError(`itc-prepare: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    // Phase 2 of a collected-topic launch: the chosen topic finalizes the intake snapshot.
    const chosenIdx = args.indexOf('--chosen');
    const intakeDir = chosenIdx !== -1 ? args[chosenIdx + 1] : undefined;
    if (intakeDir !== undefined) {
        if (options.status !== 'intake') {
            echoError('itc-prepare: --chosen applies only to a --from-collect launch');
            return 1;
        }
        const chosenPath = join(intakeDir, 'chosen-source.json');
        if (!(await fs.exists(chosenPath))) {
            echoError(`itc-prepare: chosen source not found: ${chosenPath}`);
            return 1;
        }
        let chosen: ChosenTopic & { parentRunId?: string };
        try {
            chosen = JSON.parse(await fs.readFile(chosenPath)) as ChosenTopic & { parentRunId?: string };
            if (chosen.parentRunId !== options.parentRunId) {
                throw new Error(`chosen source belongs to run '${chosen.parentRunId}', not '${options.parentRunId}'`);
            }
            options = finalizeItcCollectedOptions(options, chosen, launch);
        } catch (err: unknown) {
            echoError(`itc-prepare: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
    }

    const workDir = options.workDir;
    if (workDir === null) {
        // Collected-topic intake: no workspace exists yet; print the intake snapshot only.
        echo(JSON.stringify(options));
        return 0;
    }

    const reuseCheck = await verifyItcOptionsSnapshot(workDir, options, fs);
    if (reuseCheck.ok === false && !options.force) {
        echoError(`itc-prepare: ${reuseCheck.reason}`);
        return 1;
    }

    try {
        await writeItcOptionsSnapshot(workDir, options, fs);
        // The workspace owns its selection evidence: reconcile settles from its chosen-source.json.
        if (intakeDir !== undefined) {
            // selected-docs.json lands as docs.json, the references source materialize already reads.
            const copies: [string, string][] = [
                ['chosen-source.json', 'chosen-source.json'],
                ['selected-docs.json', 'docs.json'],
                ['topic-pool-manifest.json', 'topic-pool-manifest.json'],
            ];
            for (const [from, to] of copies) {
                const src = join(intakeDir, from);
                if (await fs.exists(src)) await fs.writeFile(join(workDir, to), await fs.readFile(src));
            }
        }
    } catch (err: unknown) {
        echoError(
            `itc-prepare: cannot write the workspace at ${workDir}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 1;
    }
    echo(JSON.stringify(options));
    return 0;
}
