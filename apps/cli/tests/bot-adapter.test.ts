import { describe, expect, it } from 'bun:test';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { bindAdapterSession, selectBotAdapter } from '../src/bot-adapter';

/**
 * Known-adapter binding order for `kk bot` (task 0277 R2): saved pluginName → unique declared
 * profileName → unique homeUrl origin; ambiguous and unavailable bindings are refused (never a
 * silent generic fallback). Pure selection logic — no discovery, no spawn.
 */

/** A minimal publish record with an optional browserSession descriptor. */
function sessionPlugin(
    name: string,
    browserSession: { profileName: string; homeUrl?: string } | undefined,
): PluginRecord {
    return {
        name,
        kind: 'publish',
        entry: './src/index.ts',
        ...(browserSession === undefined ? {} : { check: './src/profile-check.ts', browserSession }),
        dir: `/plugins/publishings/${name}`,
        manifestPath: `/plugins/publishings/${name}/plugin.json`,
        origin: 'builtin',
    };
}

/** The same descriptor on an ingestion plugin (0346): selection is kind-agnostic by design. */
function ingestionSessionPlugin(name: string, profileName: string, homeUrl?: string): PluginRecord {
    return {
        name,
        kind: 'ingestion',
        entry: './src/index.ts',
        check: './src/profile-check.ts',
        browserSession: { profileName, ...(homeUrl === undefined ? {} : { homeUrl }) },
        dir: `/plugins/ingestions/${name}`,
        manifestPath: `/plugins/ingestions/${name}/plugin.json`,
        origin: 'project',
    };
}

const CHANNELS: readonly PluginRecord[] = [
    sessionPlugin('infoq-pub', { profileName: 'infoq', homeUrl: 'https://xie.infoq.cn/' }),
    sessionPlugin('juejin-pub', { profileName: 'juejin', homeUrl: 'https://juejin.cn/editor/drafts/new?v=2' }),
    sessionPlugin('substack-pub', { profileName: 'substack' }),
    sessionPlugin('xhs-pub', { profileName: 'xhs', homeUrl: 'https://creator.xiaohongshu.com/publish/publish' }),
    sessionPlugin('podcast-pub', undefined),
];

describe('selectBotAdapter (0277 R2)', () => {
    it('rule 1 — the saved pluginName wins and is refused when unavailable', () => {
        const saved = selectBotAdapter(CHANNELS, {
            botName: 'whatever',
            url: 'https://xie.infoq.cn/',
            savedPluginName: 'xhs-pub',
        });
        expect(saved.adapter?.pluginName).toBe('xhs-pub');

        const missing = selectBotAdapter(CHANNELS, { botName: 'b', savedPluginName: 'gone-pub' });
        expect(missing.adapter).toBeNull();
        expect(missing.error).toContain("saved session adapter 'gone-pub' is not a discoverable session plugin");

        // A plugin without a session descriptor is not an available adapter either.
        const nonSession = selectBotAdapter(CHANNELS, { botName: 'b', savedPluginName: 'podcast-pub' });
        expect(nonSession.adapter).toBeNull();
        expect(nonSession.error).toContain('podcast-pub');
    });

    it('rule 2 — a unique declared profileName matching the bot name binds', () => {
        const match = selectBotAdapter(CHANNELS, { botName: 'substack' });
        expect(match.adapter?.pluginName).toBe('substack-pub');
        expect(match.error).toBeUndefined();
    });

    it('rule 2 — several plugins declaring the same profileName are ambiguous, not generic', () => {
        const ambiguous = selectBotAdapter(
            [...CHANNELS, sessionPlugin('weibo-pub', { profileName: 'xhs', homeUrl: 'https://weibo.com' })],
            { botName: 'xhs' },
        );
        expect(ambiguous.adapter).toBeNull();
        expect(ambiguous.error).toContain('several session plugins');
        expect(ambiguous.error).toContain('xhs-pub, weibo-pub');
    });

    it('rule 3 — a unique homeUrl origin match binds, even with extra query on the input URL', () => {
        const match = selectBotAdapter(CHANNELS, {
            botName: 'custom-domain',
            url: 'https://juejin.cn/editor/drafts/new?utm_source=operator',
        });
        expect(match.adapter?.pluginName).toBe('juejin-pub');
    });

    it('rule 3 — two plugins sharing a homeUrl origin are ambiguous; Substack never matches by URL', () => {
        const clone = sessionPlugin('xhs-clone-pub', {
            profileName: 'xhs-two',
            homeUrl: 'https://creator.xiaohongshu.com/publish/publish',
        });
        const ambiguous = selectBotAdapter([...CHANNELS, clone], {
            botName: 'b',
            url: 'https://creator.xiaohongshu.com/publish/publish',
        });
        expect(ambiguous.adapter).toBeNull();
        expect(ambiguous.error).toContain('several session plugins');

        // substack-pub declares no homeUrl, so a publication URL cannot select it by origin.
        const substack = selectBotAdapter(CHANNELS, { botName: 'mysite', url: 'https://mysite.substack.com/' });
        expect(substack.adapter).toBeNull();
        expect(substack.error).toBeUndefined();
    });

    it('rule 4 — no match yields the generic route (null adapter, no error)', () => {
        const none = selectBotAdapter(CHANNELS, { botName: 'unknown-bot', url: 'https://elsewhere.example.com/' });
        expect(none).toEqual({ adapter: null });
    });
});

describe('selectBotAdapter — ingestion descriptors (0346 R5)', () => {
    const plugins = [ingestionSessionPlugin('xhs-collect', 'xhs', 'https://www.xiaohongshu.com/')];

    it('binds an ingestion descriptor by declared profileName', () => {
        const match = selectBotAdapter(plugins, { botName: 'xhs' });
        expect(match.adapter?.pluginName).toBe('xhs-collect');
        expect(match.adapter?.record.kind).toBe('ingestion');
    });

    it('binds an ingestion descriptor by homeUrl origin', () => {
        const match = selectBotAdapter(plugins, { botName: 'unrelated', url: 'https://www.xiaohongshu.com/explore' });
        expect(match.adapter?.pluginName).toBe('xhs-collect');
    });

    it('still refuses an ingestion record without a probe entry (no silent generic fallback)', () => {
        const noProbe: PluginRecord = { ...ingestionSessionPlugin('broken-collect', 'broken'), check: undefined };
        const match = selectBotAdapter([noProbe], { botName: 'broken', savedPluginName: 'broken-collect' });
        expect(match.adapter).toBeNull();
        expect(match.error).toContain('broken-collect');
    });
});

describe('bindAdapterSession (0277 R3)', () => {
    it('spawns the plugin check child with the open/login argv and the scoped lease env', async () => {
        // bindAdapterSession reads the check path lazily through the record, so a missing probe
        // (unreachable via discovery) maps to a usage-shaped failure instead of a crash.
        const bogus = bindAdapterSession({
            pluginName: 'no-check',
            record: sessionPlugin('no-check-pub', { profileName: 'x' }),
        });
        const refused = await bogus.run({ mode: 'open', profileDir: '/p', url: 'https://x/', env: {} });
        expect(refused.exitCode).toBe(2);

        const real = bindAdapterSession({
            pluginName: 'infoq-pub',
            record: {
                ...sessionPlugin('infoq-pub', { profileName: 'infoq' }),
                check: '/plugins/publishings/infoq-pub/src/profile-check.ts',
            },
        });
        expect(real.pluginName).toBe('infoq-pub');
    });
});
