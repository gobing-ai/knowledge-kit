import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { buildNewsVoiceScript, formatVoiceScriptToYaml, type ScriptBuilderOptions } from './script-builder';
import {
    parseStyleContract,
    type ScriptPlan,
    type ScriptPlanError,
    type StyleContract,
    validateScriptPlan,
} from './script-plan';

export * from './script-builder';
export * from './script-plan';

export interface GeneratorOptions extends ScriptBuilderOptions {
    in: string;
    out: string;
}

/** `Content.metadata` stamp describing which script path ran (F613 R4). */
interface ScriptPlanOutcome {
    scriptPlan?: ScriptPlan;
    scriptSource: 'plan' | 'template';
    scriptPlanErrors: ScriptPlanError[];
}

/**
 * Resolve the optional VoiceScript plan (F613). `DAILYNEWS_SCRIPT_PLAN` / `DAILYNEWS_STYLE_FILE`
 * are absolute paths owned by the caller (the workflow wires them; plugin cwd is the package dir,
 * so a relative path is the caller's bug). All-or-nothing: any failure — absent plan, unreadable
 * style, unparseable plan, rejected content — falls back to templates with one warn line naming
 * every `itemId`/`rule`. Fallback is never silent; the exit code stays 0.
 */
async function resolveScriptPlan(fs: FileSystem, docs: Doc[]): Promise<ScriptPlanOutcome> {
    const planPath = process.env.DAILYNEWS_SCRIPT_PLAN;
    if (!planPath) {
        return { scriptSource: 'template', scriptPlanErrors: [] };
    }
    const fallback = (errors: ScriptPlanError[]): ScriptPlanOutcome => {
        const reason = errors.map((error) => `${error.itemId}:${error.rule}`).join(', ');
        echoError(`dailynews-gen: script plan rejected, falling back to templates (${reason})`);
        return { scriptSource: 'template', scriptPlanErrors: errors };
    };
    if (!(await fs.exists(planPath))) {
        return fallback([{ itemId: 'episode', rule: 'missing-plan' }]);
    }
    let style: StyleContract;
    try {
        style = parseStyleContract(await fs.readFile(process.env.DAILYNEWS_STYLE_FILE ?? ''));
    } catch {
        return fallback([{ itemId: 'episode', rule: 'no-style' }]);
    }
    let planJson: unknown;
    try {
        planJson = JSON.parse(await fs.readFile(planPath));
    } catch {
        return fallback([{ itemId: 'episode', rule: 'schema' }]);
    }
    const validated = validateScriptPlan(planJson, docs, style);
    if (!validated.ok) {
        return fallback(validated.errors);
    }
    return { scriptPlan: validated.plan, scriptSource: 'plan', scriptPlanErrors: [] };
}

/**
 * `DAILYNEWS_DATE` (YYYYMMDD or `YYYY-MM-DD`) → a local-midnight Date. Task 0189: the broadcast
 * greeting must carry the episode's run date, not the render date — a 9/29 episode rebuilt on 9/30
 * must not greet "今天是9月30日". Parsed as local calendar parts, never UTC (`new Date('2026-09-29')`
 * is UTC midnight and renders the previous day west of UTC). Absent → undefined; garbled or
 * out-of-range (the Date constructor rolls over, e.g. month 13) → undefined with a warn so a
 * caller bug surfaces instead of silently broadcasting the wrong day.
 */
export function broadcastDateFromEnv(raw: string | undefined): Date | undefined {
    if (!raw) return undefined;
    const match = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (match === null) {
        echoError(`dailynews-gen: ignoring malformed DAILYNEWS_DATE "${raw}" (expected YYYYMMDD or YYYY-MM-DD)`);
        return undefined;
    }
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
        echoError(`dailynews-gen: ignoring out-of-range DAILYNEWS_DATE "${raw}"`);
        return undefined;
    }
    return date;
}

export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    options?: ScriptBuilderOptions,
): Promise<Content> {
    const fs = createNodeFileSystem();

    let docs: Doc[];
    try {
        const rawInput = await fs.readFile(inputPath);
        docs = DocListSchema.parse(JSON.parse(rawInput));
    } catch (err: unknown) {
        throw new Error(`Invalid DocList input: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Optional story cap (daily pipeline: the blend carries 50+ docs; a broadcast needs a bound).
    // Input order is curated-first (fan-in first-seen), so a head-cap keeps the best items.
    const maxItemsEnv = process.env.DAILYNEWS_MAX_ITEMS;
    if (maxItemsEnv) {
        const maxItems = Number.parseInt(maxItemsEnv, 10);
        if (Number.isInteger(maxItems) && maxItems > 0 && docs.length > maxItems) {
            echoError(`dailynews-gen: capping ${docs.length} docs to ${maxItems} (DAILYNEWS_MAX_ITEMS)`);
            docs = docs.slice(0, maxItems);
        }
    }

    // F613: env-handled plan (validated against the capped docs — the same items that are spoken)
    // with explicit template fallback; the outcome is always stamped into Content.metadata.
    // 0161-review P2: the builder template-builds en regardless of any plan (script-builder.ts's
    // isZh guard), so en must never stamp scriptSource 'plan' — skip resolution entirely so the
    // stamp and the fallback warn channel stay zh-only.
    const isZh = (options?.language || 'zh').toLowerCase() === 'zh';
    const planOutcome = isZh
        ? await resolveScriptPlan(fs, docs)
        : { scriptSource: 'template' as const, scriptPlanErrors: [] as ScriptPlanError[] };
    // Topic boundary (task 0189): docs the plan declares excluded are not spoken, not counted,
    // and not referenced — title, storyCount, and references must match what is actually said.
    const excludedIds = new Set(planOutcome.scriptPlan?.excluded?.map((ex) => ex.id) ?? []);
    if (excludedIds.size > 0) {
        echoError(`dailynews-gen: topic boundary excludes ${excludedIds.size} doc(s): ${[...excludedIds].join(', ')}`);
        docs = docs.filter((doc) => !excludedIds.has(doc.id));
    }
    // Explicit option wins; else DAILYNEWS_DATE (workflow backfill/retry); else the builder's now.
    const date = options?.date ?? broadcastDateFromEnv(process.env.DAILYNEWS_DATE);
    const script = buildNewsVoiceScript(docs, { ...options, date, scriptPlan: planOutcome.scriptPlan });
    const yamlBody = formatVoiceScriptToYaml(script);

    const content: Content = {
        title: script.title,
        body: yamlBody,
        format: 'markdown',
        references: docs
            .filter((d) => d.sourceUri)
            .map((d) => ({
                title: d.title,
                url: d.sourceUri,
            })),
        metadata: {
            generator: 'kk:dailynews-gen',
            language: script.language,
            voiceProfile: script.default_profile,
            storyCount: docs.length,
            stories: docs.map((d) => ({
                id: d.id,
                title: d.title,
                sourceUri: d.sourceUri,
            })),
            scriptSource: planOutcome.scriptSource,
            scriptPlanErrors: planOutcome.scriptPlanErrors,
        },
    };

    const validatedContent = ContentSchema.parse(content);

    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await fs.ensureDir(outDir);
    }
    await fs.writeFile(outputPath, JSON.stringify(validatedContent, null, 2));

    return validatedContent;
}

export async function main(): Promise<number> {
    let values: {
        in?: string;
        out?: string;
        language?: string;
        title?: string;
        'voice-profile'?: string;
    };

    try {
        ({ values } = parseArgs({
            options: {
                in: { type: 'string' },
                out: { type: 'string' },
                language: { type: 'string' },
                title: { type: 'string' },
                'voice-profile': { type: 'string' },
            },
        }));
    } catch (err: unknown) {
        echoError(`dailynews-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    if (!values.in || !values.out) {
        echoError('dailynews-gen failed: Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processGeneratorIO(values.in, values.out, {
            language: values.language || process.env.DAILYNEWS_LANGUAGE,
            title: values.title || process.env.DAILYNEWS_TITLE,
            voiceProfile: values['voice-profile'] || process.env.VOICEBOX_DEFAULT_PROFILE,
        });
        return 0;
    } catch (err: unknown) {
        echoError(`dailynews-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
