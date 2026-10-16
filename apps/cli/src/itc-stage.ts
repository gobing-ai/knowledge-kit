import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverAllPlugins } from '@gobing-ai/kk-core';
import { buildItcPublishPlan, type ItcPlanRequest, ItcPlanRequestSchema } from './itc-plan';
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
