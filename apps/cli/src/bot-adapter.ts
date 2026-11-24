import type { PluginRecord } from '@gobing-ai/kk-core';
import type { BotAdapterRunRequest, BotAdapterSession } from '@gobing-ai/publish-harness/browser';
import { spawnPluginSession } from './invoke';

/**
 * Known-adapter binding for `kk bot` (task 0277 R2). Discovery stays in kk-core and site routines
 * stay in the plugins; this module only matches a bot against the discovered `browserSession`
 * descriptors and binds the plugin's profile-check child as the harness adapter seam.
 */

/** A discovered plugin that can drive a bot session: declared `browserSession` + probe entry. */
export interface SessionAdapterCandidate {
    /** Plugin manifest name (the adapter identity persisted in `bot.json`). */
    pluginName: string;
    /** The discovered record carrying the probe entry path and plugin dir. */
    record: PluginRecord;
}

/** Result of adapter selection: a bound candidate, or `null` for the generic confirmed route. */
export interface AdapterSelection {
    /** Bound adapter, or `null` when no descriptor matched and the generic route applies. */
    adapter: SessionAdapterCandidate | null;
    /** Refusal detail when a binding exists but is ambiguous/unavailable — never a silent fallback. */
    error?: string;
}

/** Inputs to {@link selectBotAdapter}: the bot being driven and whatever identity is known. */
export interface SelectBotAdapterOptions {
    /** Bot name; matches a descriptor's declared `profileName` (binding rule 2). */
    botName: string;
    /** Session URL (supplied on login, saved default on open); matches a descriptor homeUrl origin (rule 3). */
    url?: string;
    /** `pluginName` persisted in the bot metadata; the strongest binding (rule 1). */
    savedPluginName?: string;
}

/** Plugins that can drive a session: a descriptor with the probe entry that owns the routines. */
function sessionCandidates(plugins: readonly PluginRecord[]): SessionAdapterCandidate[] {
    return plugins
        .filter((record) => record.browserSession !== undefined && record.check !== undefined)
        .map((record) => ({ pluginName: record.name, record }));
}

/** Origin of an http(s) URL, or `null` when it does not parse. */
function urlOrigin(value: string): string | null {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

/**
 * Bind a bot to a known session adapter (0277 R2), in order:
 * 1. the metadata's saved `pluginName` — refused when that plugin is not a discoverable session
 *    plugin (no silent generic fallback);
 * 2. the unique descriptor whose `profileName` equals the bot name;
 * 3. the unique descriptor whose fixed `homeUrl` origin equals the session URL origin
 *    (Substack declares no homeUrl, so publication URLs never match this rule);
 * 4. otherwise `null` — the generic operator-confirmed route.
 *
 * Ambiguous matches (several plugins declaring the same profileName or homeUrl origin) are
 * refused, never resolved arbitrarily.
 */
export function selectBotAdapter(plugins: readonly PluginRecord[], options: SelectBotAdapterOptions): AdapterSelection {
    const candidates = sessionCandidates(plugins);

    if (options.savedPluginName !== undefined) {
        const saved = candidates.filter((candidate) => candidate.pluginName === options.savedPluginName);
        if (saved.length !== 1) {
            return {
                adapter: null,
                error:
                    `saved session adapter '${options.savedPluginName}' is not a discoverable session plugin — ` +
                    `reinstall it or re-login with \`kk bot login <url> --save ${options.botName}\``,
            };
        }
        return { adapter: saved[0] ?? null };
    }

    const byProfileName = candidates.filter(
        (candidate) => candidate.record.browserSession?.profileName === options.botName,
    );
    if (byProfileName.length > 1) {
        return {
            adapter: null,
            error:
                `bot name '${options.botName}' matches the declared profile name of several session plugins ` +
                `(${byProfileName.map((candidate) => candidate.pluginName).join(', ')}) — refusing an ambiguous adapter`,
        };
    }
    if (byProfileName.length === 1) {
        return { adapter: byProfileName[0] ?? null };
    }

    const origin = options.url !== undefined ? urlOrigin(options.url) : null;
    if (origin !== null) {
        const byHomeUrl = candidates.filter((candidate) => {
            const homeUrl = candidate.record.browserSession?.homeUrl;
            return homeUrl !== undefined && urlOrigin(homeUrl) === origin;
        });
        if (byHomeUrl.length > 1) {
            return {
                adapter: null,
                error:
                    `the session URL origin matches the declared home URL of several session plugins ` +
                    `(${byHomeUrl.map((candidate) => candidate.pluginName).join(', ')}) — refusing an ambiguous adapter`,
            };
        }
        if (byHomeUrl.length === 1) {
            return { adapter: byHomeUrl[0] ?? null };
        }
    }

    return { adapter: null };
}

/**
 * Bind a discovered session plugin as the harness adapter seam: every run spawns that plugin's
 * own profile-check child (`login`/`open --profile --url`) through the sanctioned invoke spawn,
 * forwarding the scoped lease env. The plugin dir is the child cwd, so plugin env tiers apply.
 */
export function bindAdapterSession(candidate: SessionAdapterCandidate): BotAdapterSession {
    const record = candidate.record;
    const checkPath = record.check;
    return {
        pluginName: record.name,
        async run(request: BotAdapterRunRequest) {
            if (checkPath === undefined) {
                return { exitCode: 2, stdout: '' };
            }
            return await spawnPluginSession({
                entryPath: checkPath,
                cwd: record.dir,
                subcommand: request.mode,
                profileDir: request.profileDir,
                url: request.url,
                extraEnv: request.env,
                pluginKind: record.kind,
                pluginName: record.name,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
        },
    };
}
