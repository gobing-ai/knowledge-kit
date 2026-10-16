import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { z } from 'zod';

/** Schema for a target selector inside an ITC plan request. */
export const ItcPlanTargetRequestSchema = z.object({
    plugin: z.string().min(1),
    profile: z.string().min(1).optional(),
});

export type ItcPlanTargetRequest = z.infer<typeof ItcPlanTargetRequestSchema>;

/** Schema for substantive ITC publish plan request. */
export const ItcPlanRequestSchema = z.object({
    schemaVersion: z.literal(1).optional(),
    workDir: z.string().min(1),
    sourceLocale: z.string().min(1),
    live: z.boolean(),
    targets: z.array(ItcPlanTargetRequestSchema),
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
    metadata: Record<string, unknown>;
}

export interface ItcPublishPlan {
    schemaVersion?: 1;
    live: boolean;
    sourceLocale: string;
    variants: Record<string, ItcPlanVariantEntry>;
    fanout: Array<{ variant: string; targets: string[] }>;
    browser: Array<{ target: string; variant: string }>;
    targets?: ItcPlanTargetDetail[];
}

const BROWSER_TARGETS = new Set(['substack-pub', 'juejin-pub', 'infoq-pub', 'xhs-pub']);

/** Check whether a cover image exists under 4-illustrations/cover.* */
function hasCoverImage(workDir: string): boolean {
    const dir = join(workDir, '4-illustrations');
    if (!existsSync(dir)) return false;
    try {
        const files = readdirSync(dir);
        return files.some((f) => f.startsWith('cover.'));
    } catch {
        return false;
    }
}

/** Check whether 4-publish/content.json exists and has valid ordered metadata.images */
function hasOrderedImages(workDir: string): boolean {
    const path = join(workDir, '4-publish', 'content.json');
    if (!existsSync(path)) return false;
    try {
        const data = JSON.parse(readFileSync(path, 'utf-8')) as { metadata?: Record<string, unknown> };
        const images = data.metadata?.images;
        return (
            Array.isArray(images) &&
            images.length > 0 &&
            images.every((img) => typeof img === 'string' && img.trim().length > 0)
        );
    } catch {
        return false;
    }
}

/**
 * Substantive native ITC publication planner.
 * Resolves targets against discovered plugin capabilities without central channel tables.
 */
export function buildItcPublishPlan(request: ItcPlanRequest, plugins: readonly PluginRecord[]): ItcPublishPlan {
    const pluginsByName = new Map<string, PluginRecord>(plugins.map((p) => [p.name, p]));
    const hasCover = hasCoverImage(request.workDir);

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

        if (profile.requires?.orderedImages && !hasOrderedImages(request.workDir)) {
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
            metadata: switches,
        });
    }

    const fanout = [...fanoutMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([variant, targets]) => ({ variant, targets }));

    return {
        ...(request.schemaVersion !== undefined ? { schemaVersion: 1, targets: targetDetails } : {}),
        live: request.live,
        sourceLocale: request.sourceLocale,
        variants,
        fanout,
        browser,
    };
}
