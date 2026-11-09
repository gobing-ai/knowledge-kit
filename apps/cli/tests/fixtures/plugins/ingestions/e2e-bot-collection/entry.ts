// 0346 E2E fixture entry: a real ingestion plugin child that owns its bot-backed source.
//
// fan-in spawns this file with `--in <docs.json> --out <docs.json>` and the plugin env tier. The
// collection plan, the profile/lease roots and the observation sidecar therefore arrive through
// `KK_E2E_BOT_*` env vars — exactly the seam a production plugin would use for its own config.
// The fixture is test evidence, not a discovered production plugin.
import { readFileSync, writeFileSync } from 'node:fs';
import { runBotCollection } from '@gobing-ai/publish-harness/bot-collection';

/** Read one required env var, failing loudly: a missing root would silently use the real profile. */
function required(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === '') throw new Error(`fixture requires ${name}`);
    return value;
}

const argv = process.argv.slice(2);
const outPath = argv[argv.indexOf('--out') + 1];
if (outPath === undefined) throw new Error('fixture requires --out');

const plan = JSON.parse(readFileSync(required('KK_E2E_BOT_PLAN'), 'utf8'));
const observations = { launches: 0, acquisitions: 0 };

const result = await runBotCollection(process.env.KK_E2E_BOT_PROFILE ?? 'e2e-bot', plan, {
    root: required('KK_E2E_BOT_PROFILE_ROOT'),
    leaseRoot: required('KK_E2E_BOT_LEASE_ROOT'),
    acquireLease: async (profileDir, options) => {
        observations.acquisitions += 1;
        const { acquireProfileLease } = await import('@gobing-ai/publish-harness/browser');
        return await acquireProfileLease(profileDir, options);
    },
    launcher: {
        async launch(request) {
            observations.launches += 1;
            const { kkBrowserLauncher } = await import('@gobing-ai/publish-harness/browser');
            return await kkBrowserLauncher.launch(request);
        },
    },
});

writeFileSync(required('KK_E2E_BOT_OBSERVATIONS'), `${JSON.stringify(observations)}\n`);

const artifacts = new Map(result.artifacts.map((artifact) => [artifact.id, artifact]));
const docs: Array<Record<string, unknown>> = [];

const text = artifacts.get('copy');
if (text !== undefined) {
    docs.push({ id: 'e2e-bot-collection:rendered', title: 'Rendered page text', body: text.body });
}

// The captured XHR is the JSON source; the rendered extraction is text. Parse defensively so a
// fixture never turns a capture mismatch into an opaque parse crash.
const captured = result.artifacts.find((artifact) => artifact.kind === 'response');
if (captured !== undefined) {
    let parsed: { items?: Array<{ id?: unknown; title?: unknown }> } = {};
    try {
        parsed = JSON.parse(captured.body) as typeof parsed;
    } catch {
        parsed = {};
    }
    for (const [index, item] of (parsed.items ?? []).entries()) {
        docs.push({
            id: `e2e-bot-collection:item-${index}`,
            title: typeof item.title === 'string' ? item.title : undefined,
            body: JSON.stringify(item),
        });
    }
}

const direct = artifacts.get('api');
if (direct !== undefined) {
    docs.push({ id: 'e2e-bot-collection:request', title: 'Authenticated request body', body: direct.body });
}

writeFileSync(outPath, JSON.stringify(docs));
