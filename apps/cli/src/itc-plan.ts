import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { parseProfile } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import { resolvePackageRoot } from './package-root';

/** Origin of the resolved publication targets (task 0300). */
export const ItcTargetsOriginSchema = z.enum([
    'explicit-targets',
    'explicit-preset',
    'workflow-config',
    'topic-profile',
    'none',
]);

/** Where the resolved publication targets came from. */
export type ItcTargetsOrigin = z.infer<typeof ItcTargetsOriginSchema>;

/** Schema for a target selector inside an ITC plan request. */
export const ItcPlanTargetRequestSchema = z
    .object({
        plugin: z.string().min(1),
        profile: z.string().min(1).optional(),
    })
    .strict();

/** Parsed target selector (plugin plus optional profile). */
export type ItcPlanTargetRequest = z.infer<typeof ItcPlanTargetRequestSchema>;

/** Publish window a preset target belongs to (design kk-daily-ai-voice3 §5a, task 0321). */
export const PublishWindowSchema = z.enum(['after-generate', 'cn-peak', 'overseas-rss']);

/**
 * Target entry inside a publish preset.
 *
 * The matrix fields are all optional so every shipped itc preset keeps validating. `mode` is closed
 * over `off | dummy | draft | live`: ADR-022's 2026-11-12 amendment moved live consent into the
 * operator-owned preset, so `daily-ai-voice.json` ships live rows and a channel opts out with `off`
 * (`--live-channels` still promotes a single row for an ad-hoc window; `live_confirm` keeps the
 * send-confirm pause available to a supervised run).
 */
export const PublishPresetTargetSchema = z
    .object({
        plugin: z.string().min(1),
        profile: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        operation: z.string().min(1).optional(),
        variant: z.string().min(1).optional(),
        tier: z.number().int().min(0).max(3).optional(),
        window: PublishWindowSchema.optional(),
        mode: z.enum(['off', 'dummy', 'draft', 'live']).optional(),
        required: z.boolean().optional(),
        options: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

/** One preset target row, including the optional channel-matrix fields. */
export type PublishPresetTarget = z.infer<typeof PublishPresetTargetSchema>;

/** Parsed publish window. */
export type PublishWindow = z.infer<typeof PublishWindowSchema>;

/** Preset v1 definition schema (task 0300). */
export const PublishPresetSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        name: z.string().min(1),
        targets: z.array(PublishPresetTargetSchema).min(1),
    })
    .strict();

/** Parsed publish preset v1. */
export type PublishPreset = z.infer<typeof PublishPresetSchema>;

/** Target sources in precedence order: explicit targets, explicit preset, workflow config, topic profile. */
export interface ItcTargetSelection {
    explicitTargets?: string | readonly ItcPlanTargetRequest[];
    explicitPreset?: string;
    workflowConfigPreset?: string;
    topicProfile?: string;
    topicProfilePath?: string;
    projectRoot?: string;
    packageRoot?: string;
}

/** Resolved targets with their origin and, for presets, the preset name and digest. */
export interface ResolvedItcTargets {
    targets: ItcPlanTargetRequest[];
    origin: ItcTargetsOrigin;
    presetName?: string;
    presetDigest?: string;
}

/** Schema for substantive ITC publish plan request. */
export const ItcPlanRequestSchema = z.object({
    schemaVersion: z.literal(1).optional(),
    workDir: z.string().min(1),
    sourceLocale: z.string().min(1),
    live: z.boolean(),
    targets: z.array(ItcPlanTargetRequestSchema),
    origin: ItcTargetsOriginSchema.optional(),
    presetName: z.string().optional(),
    presetDigest: z.string().optional(),
    sourceContentDigest: z.string().optional(),
    configDigest: z.string().optional(),
});

/** Parsed ITC publish plan request. */
export type ItcPlanRequest = z.infer<typeof ItcPlanRequestSchema>;

/** One content variant the plan renders: file, adaptation flag, limits and switches. */
export interface ItcPlanVariantEntry {
    file: string;
    adapt: boolean;
    limits?: Record<string, unknown>;
    switches: Record<string, unknown>;
}

/** Per-target plan row: plugin, profile, variant, transport, mode and payload binding. */
export interface ItcPlanTargetDetail {
    target: string;
    plugin: string;
    profile: string;
    variant: string;
    transport: 'fanout' | 'browser';
    mode?: 'draft' | 'live';
    payloadPath?: string;
    payloadDigest?: string;
    metadata: Record<string, unknown>;
}

/** Full ITC publish plan: variants, fanout and browser routes, and per-target details. */
export interface ItcPublishPlan {
    schemaVersion?: 1;
    origin?: ItcTargetsOrigin;
    presetName?: string;
    presetDigest?: string;
    live: boolean;
    sourceLocale: string;
    variants: Record<string, ItcPlanVariantEntry>;
    fanout: Array<{ variant: string; targets: string[] }>;
    browser: Array<{ target: string; variant: string }>;
    targets?: ItcPlanTargetDetail[];
    /** Non-fatal planning notes: targets skipped for an unmet requirement (e.g. missing cover). */
    warnings?: string[];
}

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The package/checkout root that ships the ITC assets, via the shared resolver: the cwd tree first
 * (a checkout keeps shadowing the installed package), then the runtime script's directory so a run
 * from a foreign work dir still finds the installed package's shipped presets. Never derived from
 * `import.meta.dir`/`__dirname`: Bun inlines those as absolute source paths in the bundle, which
 * would make the packed CLI reference the checkout it was built in (0255 AC7).
 */
async function resolveDefaultPackageRoot(fs: FileSystem): Promise<string> {
    return resolvePackageRoot(fs);
}

/** Parse comma-separated target tokens: `medium-pub,qiita-pub:article` */
function parseTargetTokens(raw: string): ItcPlanTargetRequest[] {
    const tokens = raw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    if (tokens.length === 0) {
        throw new Error('explicit targets input is empty');
    }
    return tokens.map((token) => {
        const colonIdx = token.indexOf(':');
        if (colonIdx !== -1) {
            return {
                plugin: token.slice(0, colonIdx),
                profile: token.slice(colonIdx + 1),
            };
        }
        return { plugin: token };
    });
}

/** Normalize target list: collapse exact duplicates, reject conflicting profiles for the same plugin. */
function normalizeTargetList(targets: readonly ItcPlanTargetRequest[]): ItcPlanTargetRequest[] {
    if (targets.length === 0) {
        throw new Error('explicit targets input is empty');
    }
    const pluginProfiles = new Map<string, string | undefined>();
    const unique: ItcPlanTargetRequest[] = [];
    for (const t of targets) {
        if (pluginProfiles.has(t.plugin)) {
            const existing = pluginProfiles.get(t.plugin);
            if (existing !== t.profile) {
                throw new Error(
                    `conflicting profiles for plugin ${t.plugin}: "${existing ?? ''}" vs "${t.profile ?? ''}"`,
                );
            }
            continue;
        }
        pluginProfiles.set(t.plugin, t.profile);
        unique.push({ plugin: t.plugin, ...(t.profile ? { profile: t.profile } : {}) });
    }
    return unique;
}

/**
 * Resolve a publish preset from roots:
 * Search `<projectRoot>/.kk/publish-presets/<slug>.json` then `<packageRoot>/plugins/kk/publish-presets/<slug>.json`.
 * Traversal rejected; malformed override throws immediately without falling through.
 */
async function resolvePresetFromRoots(
    fs: FileSystem,
    slug: string,
    projectRoot: string,
    packageRoot: string,
): Promise<{ preset: PublishPreset; digest: string }> {
    if (!SLUG_REGEX.test(slug)) {
        throw new Error(`invalid publish preset slug '${slug}': must be lowercase alphanumeric with hyphens`);
    }

    const projectDir = resolve(projectRoot, '.kk/publish-presets');
    const projectPath = resolve(projectDir, `${slug}.json`);
    if (await fs.exists(projectPath)) {
        return readPresetFile(fs, projectPath, projectDir, slug);
    }

    const pkgDir = resolve(packageRoot, 'plugins/kk/publish-presets');
    const pkgPath = resolve(pkgDir, `${slug}.json`);
    if (await fs.exists(pkgPath)) {
        return readPresetFile(fs, pkgPath, pkgDir, slug);
    }

    throw new Error(`publish preset '${slug}' not found in ${projectPath} or ${pkgPath}`);
}

/** Read one preset file, refusing a path outside `root` and a present-but-malformed document. */
async function readPresetFile(
    fs: FileSystem,
    path: string,
    root: string,
    slug: string,
): Promise<{ preset: PublishPreset; digest: string }> {
    if (!path.startsWith(root)) {
        throw new Error(`path traversal rejected for preset '${slug}'`);
    }
    let text: string;
    try {
        text = await fs.readFile(path);
    } catch (err: unknown) {
        throw new Error(`malformed publish preset at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    let parsed: ReturnType<typeof PublishPresetSchema.safeParse>;
    try {
        parsed = PublishPresetSchema.safeParse(JSON.parse(text));
    } catch (err: unknown) {
        throw new Error(`malformed publish preset at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!parsed.success) {
        throw new Error(`malformed publish preset at ${path}: ${parsed.error.message}`);
    }
    return { preset: parsed.data, digest: createHash('sha256').update(text).digest('hex') };
}

/**
 * Resolve target selection by strict frozen precedence (task 0300):
 * explicit --targets > explicit --publish-preset > resolved workflows.kk-itc.publish_preset > topicProfile.publishPreset > none.
 */
export async function resolveItcTargets(
    input: ItcTargetSelection,
    fs: FileSystem = createNodeFileSystem(),
): Promise<ResolvedItcTargets> {
    const projectRoot = input.projectRoot ? resolve(input.projectRoot) : process.cwd();
    const packageRoot = input.packageRoot ? resolve(input.packageRoot) : await resolveDefaultPackageRoot(fs);

    // 1. Explicit --targets
    if (input.explicitTargets !== undefined) {
        if (typeof input.explicitTargets === 'string') {
            if (input.explicitTargets.trim() === '') {
                throw new Error('explicit targets input is empty');
            }
            const parsed = parseTargetTokens(input.explicitTargets);
            return {
                targets: normalizeTargetList(parsed),
                origin: 'explicit-targets',
            };
        }
        if (Array.isArray(input.explicitTargets)) {
            if (input.explicitTargets.length === 0) {
                throw new Error('explicit targets input is empty');
            }
            return {
                targets: normalizeTargetList(input.explicitTargets),
                origin: 'explicit-targets',
            };
        }
    }

    // 2. Explicit --publish-preset
    if (input.explicitPreset !== undefined) {
        if (input.explicitPreset.trim() === '') {
            throw new Error('explicit publish preset input is empty');
        }
        const { preset, digest } = await resolvePresetFromRoots(
            fs,
            input.explicitPreset.trim(),
            projectRoot,
            packageRoot,
        );
        return {
            targets: normalizeTargetList(preset.targets),
            origin: 'explicit-preset',
            presetName: preset.name,
            presetDigest: digest,
        };
    }

    // 3. Resolved workflows.kk-itc.publish_preset
    if (input.workflowConfigPreset !== undefined) {
        if (input.workflowConfigPreset.trim() === '') {
            throw new Error('workflow config publish preset input is empty');
        }
        const { preset, digest } = await resolvePresetFromRoots(
            fs,
            input.workflowConfigPreset.trim(),
            projectRoot,
            packageRoot,
        );
        return {
            targets: normalizeTargetList(preset.targets),
            origin: 'workflow-config',
            presetName: preset.name,
            presetDigest: digest,
        };
    }

    // 4. Topic profile's publishPreset
    if (input.topicProfile !== undefined) {
        const topicSlug = input.topicProfile.trim();
        if (!SLUG_REGEX.test(topicSlug)) {
            throw new Error('topicProfile must be a lowercase hyphenated slug');
        }
        const profilePath =
            input.topicProfilePath !== undefined && (await fs.exists(input.topicProfilePath))
                ? input.topicProfilePath
                : resolve(packageRoot, 'plugins/kk/decisions/extract', `${topicSlug}.yaml`);
        if (await fs.exists(profilePath)) {
            const profile = parseProfile(await fs.readFile(profilePath));
            if (profile.publishPreset) {
                const { preset, digest } = await resolvePresetFromRoots(
                    fs,
                    profile.publishPreset,
                    projectRoot,
                    packageRoot,
                );
                return {
                    targets: normalizeTargetList(preset.targets),
                    origin: 'topic-profile',
                    presetName: preset.name,
                    presetDigest: digest,
                };
            }
        }
    }

    // 5. No targets
    return {
        targets: [],
        origin: 'none',
    };
}

/**
 * Load one publish preset by slug, preserving every matrix field.
 *
 * `resolveItcTargets` narrows a preset to plugin+profile because that is all the itc plan binds;
 * the channel matrix needs the full row, so it reads the same file through the same resolver.
 */
export async function loadPublishPreset(
    slug: string,
    roots: { projectRoot?: string; packageRoot?: string } = {},
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ preset: PublishPreset; digest: string }> {
    const projectRoot = roots.projectRoot ? resolve(roots.projectRoot) : process.cwd();
    const packageRoot = roots.packageRoot ? resolve(roots.packageRoot) : await resolveDefaultPackageRoot(fs);
    return resolvePresetFromRoots(fs, slug.trim(), projectRoot, packageRoot);
}

/** Check whether a cover image exists under 4-illustrations/cover.* */
async function hasCoverImage(fs: FileSystem, workDir: string): Promise<boolean> {
    const dir = join(workDir, '4-illustrations');
    if (!(await fs.exists(dir))) return false;
    try {
        const files = await fs.readDir(dir);
        return files.some((f) => f.startsWith('cover.'));
    } catch {
        return false;
    }
}

/** Check whether 4-publish/content.json exists and has valid ordered metadata.images */
async function hasOrderedImages(fs: FileSystem, workDir: string): Promise<boolean> {
    const path = join(workDir, '4-publish', 'content.json');
    if (!(await fs.exists(path))) return false;
    try {
        const data = JSON.parse(await fs.readFile(path)) as { metadata?: Record<string, unknown> };
        const images = data.metadata?.images;
        return (
            Array.isArray(images) &&
            images.length > 0 &&
            (
                await Promise.all(
                    images.map(
                        async (img) =>
                            typeof img === 'string' &&
                            img.trim().length > 0 &&
                            (await fs.exists(resolve(workDir, img))),
                    ),
                )
            ).every(Boolean)
        );
    } catch {
        return false;
    }
}

/**
 * Substantive native ITC publication planner.
 * Resolves targets against discovered plugin capabilities without central channel tables.
 */
export async function buildItcPublishPlan(
    request: ItcPlanRequest,
    plugins: readonly PluginRecord[],
    fs: FileSystem = createNodeFileSystem(),
): Promise<ItcPublishPlan> {
    const pluginsByName = new Map<string, PluginRecord>(plugins.map((p) => [p.name, p]));
    const hasCover = await hasCoverImage(fs, request.workDir);

    // Validate duplicate vs conflicting profile selectors per plugin
    const pluginProfiles = new Map<string, string>();
    const uniqueTargets: ItcPlanTargetRequest[] = [];

    for (const t of request.targets) {
        const plugin = pluginsByName.get(t.plugin);
        if (plugin?.kind !== 'publish' || !plugin.publishing) {
            throw new Error(`unsupported publish target: ${t.plugin} (unknown or not an article target)`);
        }
        const profileName = t.profile ?? plugin.publishing.defaultProfile;
        const existingProfile = pluginProfiles.get(t.plugin);
        if (existingProfile !== undefined) {
            if (existingProfile !== profileName) {
                throw new Error(
                    `conflicting profiles for plugin ${t.plugin}: "${existingProfile}" vs "${profileName}"`,
                );
            }
            // Exact duplicate -> collapse
            continue;
        }
        pluginProfiles.set(t.plugin, profileName);
        uniqueTargets.push({ plugin: t.plugin, profile: profileName });
    }

    const variants: Record<string, ItcPlanVariantEntry> = {};
    const fanoutMap = new Map<string, string[]>();
    const browser: Array<{ target: string; variant: string }> = [];
    const targetDetails: ItcPlanTargetDetail[] = [];
    const warnings: string[] = [];

    for (const targetReq of uniqueTargets) {
        const plugin = pluginsByName.get(targetReq.plugin);
        if (!plugin?.publishing) {
            continue;
        }
        const profileName = targetReq.profile ?? plugin.publishing.defaultProfile;
        const profile = plugin.publishing.profiles[profileName];
        if (!profile) {
            throw new Error(`target ${targetReq.plugin} has no profile "${profileName}"`);
        }

        const modeKey = request.live ? 'live' : 'draft';
        const modeBinding = profile.modes[modeKey];
        if (!modeBinding) {
            if (request.live) {
                throw new Error(`target ${targetReq.plugin} refuses a live publish`);
            }
            throw new Error(`target ${targetReq.plugin} has no draft mode; it needs publish_live=true`);
        }

        if (profile.requires?.cover && !hasCover) {
            // One unmet requirement skips only this target; the rest of the plan still materializes.
            warnings.push(
                `skipped ${targetReq.plugin}: needs a cover image at 4-illustrations/cover.* in ${request.workDir}`,
            );
            continue;
        }

        if (profile.requires?.orderedImages && !(await hasOrderedImages(fs, request.workDir))) {
            throw new Error(
                `target ${targetReq.plugin} requires ordered metadata.images with real paths; a hero cover alone does not satisfy that requirement`,
            );
        }

        const locale = profile.locale === 'source' ? request.sourceLocale : profile.locale;
        const format = profile.format;
        const variant = `${locale}-${format}`;
        const sharesSourceArticle = variant === `${request.sourceLocale}-article`;
        const file = sharesSourceArticle ? 'content.json' : `content.${variant}.json`;
        const adapt = !sharesSourceArticle;

        const switches = { ...modeBinding.metadata };

        if (!variants[variant]) {
            variants[variant] = {
                file,
                adapt,
                limits: profile.limits ?? (sharesSourceArticle ? undefined : {}),
                switches: {},
            };
        }
        Object.assign(variants[variant].switches, switches);

        // A plugin that declares a browser session drives a real browser profile: dispatch it serially.
        const isBrowser = plugin.browserSession !== undefined;

        if (isBrowser) {
            browser.push({ target: targetReq.plugin, variant });
        } else {
            const group = fanoutMap.get(variant);
            if (group) {
                if (!group.includes(targetReq.plugin)) group.push(targetReq.plugin);
            } else {
                fanoutMap.set(variant, [targetReq.plugin]);
            }
        }

        targetDetails.push({
            target: targetReq.plugin,
            plugin: targetReq.plugin,
            profile: profileName,
            variant,
            transport: isBrowser ? 'browser' : 'fanout',
            mode: modeKey,
            metadata: switches,
        });
    }

    const fanout = [...fanoutMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([variant, targets]) => ({ variant, targets }));

    return {
        ...(request.schemaVersion !== undefined ? { schemaVersion: 1, targets: targetDetails } : {}),
        ...(request.origin !== undefined ? { origin: request.origin } : {}),
        ...(request.presetName !== undefined ? { presetName: request.presetName } : {}),
        ...(request.presetDigest !== undefined ? { presetDigest: request.presetDigest } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
        live: request.live,
        sourceLocale: request.sourceLocale,
        variants,
        fanout,
        browser,
    };
}
