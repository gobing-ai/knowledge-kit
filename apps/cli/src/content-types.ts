import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { createNodeFileSystem, type FileSystem, walkDir } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import { resolvePackageRoot } from './package-root';
import { resolveConfigPath } from './publish-core';

const ChannelModeSchema = z.enum(['off', 'dummy', 'draft', 'live']);

/** Validated workflow, writer, preset, and channel settings for one content type. */
export const ContentTypeSchema = z.strictObject({
    workflow: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    writer_skill: z.string().regex(/^[a-z0-9-]+:[a-z0-9-]+$/),
    publish_preset: z.string().min(1),
    channels: z.record(z.string().min(1), ChannelModeSchema).default({}),
});

/** Registry keyed by the public content-type identifier. */
export const ContentTypesSchema = z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), ContentTypeSchema);

/** Settings for one validated content type. */
export type ContentType = z.infer<typeof ContentTypeSchema>;
/** Validated content-type registry. */
export type ContentTypes = z.infer<typeof ContentTypesSchema>;

/** Defaults used when the operator has no content-type override. */
export const BUILTIN_CONTENT_TYPES: ContentTypes = {
    news: {
        workflow: 'kk-news-generate',
        writer_skill: 'kk:news-editorial',
        publish_preset: 'daily-ai-voice',
        channels: {},
    },
    itc: {
        workflow: 'kk-article-generate',
        writer_skill: 'kk:itc-generating',
        publish_preset: 'itc-main',
        channels: {},
    },
};

/** Configuration blocks consumed by content-type resolution. */
export interface ContentTypeConfig {
    content_types?: unknown;
    workflows?: unknown;
}

/** Explicit overrides and dependencies for content-type resolution. */
export interface ResolveContentTypeFlags {
    preset?: string;
    packageRoot?: string;
    configPath?: string;
    fileSystem?: FileSystem;
}

/** Resolved settings with the writer skill's location and content fingerprint. */
export interface ResolvedContentType extends ContentType {
    type: string;
    skillDir: string;
    skillSha256: string;
}

/** Names an unknown type and the configuration path that can define it. */
export class ContentTypeUnknownError extends Error {
    constructor(
        type: string,
        known: readonly string[],
        configPath = resolveConfigPath(process.env, process.env.HOME ?? ''),
    ) {
        super(
            `unknown content type '${type}' (known: ${known.join(', ')}); add content_types.${type} to ${configPath}`,
        );
        this.name = 'ContentTypeUnknownError';
    }
}

/** Reports a configured writer skill without its required entry file. */
export class ContentTypeSkillMissingError extends Error {
    constructor(path: string) {
        super(`content type writer skill is missing SKILL.md: ${path}`);
        this.name = 'ContentTypeSkillMissingError';
    }
}

function asMapping(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function readUserTypes(config: ContentTypeConfig): Record<string, unknown> {
    return asMapping(config.content_types);
}

function workflowPreset(config: ContentTypeConfig, workflow: string): string | undefined {
    const block = asMapping(asMapping(config.workflows)[workflow]);
    return typeof block.publish_preset === 'string' ? block.publish_preset : undefined;
}

function mergeType(base: ContentType, override: Record<string, unknown>): ContentType {
    const candidate = {
        ...base,
        ...override,
        channels: { ...base.channels, ...ContentTypeSchema.shape.channels.parse(override.channels) },
    };
    return ContentTypeSchema.parse(candidate);
}

async function hashSkill(skillDir: string, fs: FileSystem): Promise<string> {
    const skillFile = join(skillDir, 'SKILL.md');
    if (!(await fs.exists(skillFile))) throw new ContentTypeSkillMissingError(skillFile);
    const hash = createHash('sha256');
    const referencesDir = join(skillDir, 'references');
    const allFiles = await walkDir(skillDir, fs);
    const paths = [
        skillFile,
        ...allFiles
            .filter((path) => path !== skillFile && path.startsWith(`${referencesDir}${sep}`))
            .sort((left, right) => {
                const leftRelative = relative(skillDir, left);
                const rightRelative = relative(skillDir, right);
                return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
            }),
    ];
    for (const path of paths) {
        hash.update(relative(skillDir, path));
        hash.update('\0');
        hash.update(await fs.readFile(path));
        hash.update('\0');
    }
    return hash.digest('hex');
}

/** Resolve one configured content type and the immutable writer-skill audit values. */
export async function resolveContentType(
    type: string,
    config: ContentTypeConfig = {},
    flags: ResolveContentTypeFlags = {},
): Promise<ResolvedContentType> {
    const userTypes = readUserTypes(config);
    const known = [...new Set([...Object.keys(BUILTIN_CONTENT_TYPES), ...Object.keys(userTypes)])].sort();
    const builtIn = BUILTIN_CONTENT_TYPES[type];
    const userEntry = asMapping(userTypes[type]);
    if (!builtIn && Object.keys(userEntry).length === 0)
        throw new ContentTypeUnknownError(type, known, flags.configPath);
    const base = builtIn ?? ContentTypeSchema.parse(userEntry);
    const merged = mergeType(base, {
        ...userEntry,
        ...(flags.preset !== undefined ? { publish_preset: flags.preset } : {}),
    });
    const preset =
        flags.preset ??
        (typeof userEntry.publish_preset === 'string' ? userEntry.publish_preset : undefined) ??
        workflowPreset(config, merged.workflow) ??
        merged.publish_preset;
    const resolved = mergeType(merged, { publish_preset: preset });
    const fs = flags.fileSystem ?? createNodeFileSystem();
    const packageRoot = flags.packageRoot ?? (await resolvePackageRoot(fs));
    const [, plugin, skill] = /^([^:]+):(.+)$/.exec(resolved.writer_skill) ?? [];
    const skillDir = resolve(packageRoot, 'plugins', plugin ?? '', 'skills', skill ?? '');
    return { ...resolved, type, skillDir, skillSha256: await hashSkill(skillDir, fs) };
}

/** Inputs used to select a content run's workflow and directory. */
export interface ResolveRunInput {
    type: string;
    slug?: string;
    runDate?: string;
    workDir?: string;
    worksDir: string;
    now?: Date;
    workflow?: string;
    dated?: boolean;
    config?: ContentTypeConfig;
}

/** Canonical workflow, run identifier, and absolute directory. */
export interface ResolvedRun {
    workDir: string;
    run: string;
    workflow: string;
}

function laDate(now: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}${values.month}${values.day}`;
}

function validDate(value: string): boolean {
    if (!/^\d{8}$/.test(value)) return false;
    const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10).replaceAll('-', '') === value;
}

/** Compose the canonical `<works>/<workflow>/<run>` workspace path. */
export function resolveRun(input: ResolveRunInput): ResolvedRun {
    const builtIn = BUILTIN_CONTENT_TYPES[input.type];
    const workflow = input.workflow ?? builtIn?.workflow;
    if (!workflow) throw new ContentTypeUnknownError(input.type, Object.keys(BUILTIN_CONTENT_TYPES).sort());
    const workflowConfig = asMapping(asMapping(input.config?.workflows)[workflow]);
    const dated = input.dated ?? asMapping(workflowConfig.workspace).dated === true;
    const runDate = input.runDate ?? (input.type === 'news' ? laDate(input.now ?? new Date()) : undefined);
    if (input.type === 'news' && (runDate === undefined || !validDate(runDate))) {
        throw new Error(`--run-date must be a real calendar date as YYYYMMDD`);
    }
    if (input.type !== 'news' && (!input.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))) {
        throw new Error('--slug is required for article content and must be a lowercase slug');
    }
    const run =
        input.type === 'news'
            ? (runDate as string)
            : dated
              ? `${runDate ?? laDate(input.now ?? new Date())}-${input.slug}`
              : (input.slug as string);
    return { workDir: resolve(input.workDir ?? join(input.worksDir, workflow, run)), run, workflow };
}
