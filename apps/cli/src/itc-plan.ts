import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { parseProfile } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';

/** Origin of the resolved publication targets (task 0300). */
export const ItcTargetsOriginSchema = z.enum([
    'explicit-targets',
    'explicit-preset',
    'workflow-config',
    'topic-profile',
    'none',
]);

export type ItcTargetsOrigin = z.infer<typeof ItcTargetsOriginSchema>;

/** Schema for a target selector inside an ITC plan request. */
export const ItcPlanTargetRequestSchema = z
    .object({
        plugin: z.string().min(1),
        profile: z.string().min(1).optional(),
    })
    .strict();

export type ItcPlanTargetRequest = z.infer<typeof ItcPlanTargetRequestSchema>;

/** Target entry inside a publish preset. */
export const PublishPresetTargetSchema = z
    .object({
        plugin: z.string().min(1),
        profile: z.string().min(1).optional(),
    })
    .strict();

/** Preset v1 definition schema (task 0300). */
export const PublishPresetSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        name: z.string().min(1),
        targets: z.array(PublishPresetTargetSchema).min(1),
    })
    .strict();

export type PublishPreset = z.infer<typeof PublishPresetSchema>;

export interface ItcTargetSelection {
    explicitTargets?: string | readonly ItcPlanTargetRequest[];
    explicitPreset?: string;
    workflowConfigPreset?: string;
    topicProfile?: string;
    topicProfilePath?: string;
    projectRoot?: string;
    packageRoot?: string;
}

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

export type ItcPlanRequest = z.infer<typeof ItcPlanRequestSchema>;

export interface ItcPlanVariantEntry {
    file: string;
    adapt: boolean;
    limits?: Record<string, unknown>;
    switches: Record<string, unknown>;
}

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
}

const BROWSER_TARGETS = new Set(['substack-pub', 'juejin-pub', 'infoq-pub', 'xhs-pub']);
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The package/checkout root that ships the ITC assets, found by walking up from the cwd for
 * `plugins/kk/publish-presets`. Never derived from the module location: Bun inlines `__dirname`
 * as an absolute source path in the bundle, which would make the packed CLI reference the checkout
 * it was built in (0255 AC7).
 */
async function resolveDefaultPackageRoot(fs: FileSystem): Promise<string> {
    let dir = resolve(process.cwd());
    for (;;) {
        if (await fs.exists(join(dir, 'plugins/kk/publish-presets'))) return dir;
        const parent = resolve(dir, '..');
        if (parent === dir) return process.cwd();
        dir = parent;
    }
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
            throw new Error(
                `target ${targetReq.plugin} needs a cover image at 4-illustrations/cover.* in ${request.workDir}`,
            );
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

        const isBrowser =
            BROWSER_TARGETS.has(targetReq.plugin) ||
            (plugin.browserSession !== undefined &&
                targetReq.plugin !== 'wechatmp-pub' &&
                targetReq.plugin !== 'x-pub');

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
        live: request.live,
        sourceLocale: request.sourceLocale,
        variants,
        fanout,
        browser,
    };
}
