// Offline review probes: all HTTP requests are intercepted; dispatch is a local fake.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sendRows } from '../../apps/cli/src/itc-publish';
import { planPublishMatrix } from '../../apps/cli/src/publish-matrix';
import { mapContentToEpisode } from '../../plugins/publishings/podcast-pub/src/map';
import { mapContentToSurfingMarkdown } from '../../plugins/publishings/surfdash-pub/src/index';
import { ThreadsPostApiTransport } from '../../plugins/publishings/threads-pub/src/index';
import { XPostApiTransport } from '../../plugins/publishings/x-pub/src/index';

const root = resolve('.works/tmp/test-publish3-review');
await mkdir(`${root}/receipts`, { recursive: true });
const payload = `${root}/content.json`;
await writeFile(
    payload,
    JSON.stringify({ title: 'probe', format: 'text', body: 'offline probe', metadata: { publishStatus: 'public' } }),
);
await writeFile(
    `${root}/receipts/probe.json`,
    JSON.stringify({
        status: 'succeeded',
        mode: 'draft',
        effect: 'confirmed',
        parentRunId: 'old-run',
        payloadDigest: 'old-payload',
        planDigest: 'old-plan',
    }),
);
let dispatches = 0;
await sendRows({
    rows: [
        { key: 'probe', plugin: 'probe', profile: 'article', mode: 'live', payloadPath: payload, transport: 'fanout' },
    ],
    publishDir: root,
    receiptsDir: `${root}/receipts`,
    parentRunId: 'new-run',
    planDigest: 'new-plan',
    retry: false,
    label: 'offline-review',
    dispatch: async () => {
        dispatches++;
        return 0;
    },
});
const requests: Array<{ method: string; url: string }> = [];
const priorFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ method: init?.method ?? 'GET', url: url.split('?')[0] ?? url });
    return Response.json(
        url.includes('api.x.com')
            ? { data: { id: '123' } }
            : url.includes('fields=permalink')
              ? { permalink: 'https://www.threads.net/@offline/post/123' }
              : { id: '123' },
    );
}) as typeof fetch;
for (const key of [
    'X_API_KEY',
    'X_API_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET',
    'THREADS_ACCESS_TOKEN',
    'THREADS_USER_ID',
])
    process.env[key] = 'offline-probe';
const content = {
    title: 'probe',
    format: 'text' as const,
    body: 'offline probe',
    metadata: { publishStatus: 'draft' },
};
try {
    await new XPostApiTransport().publish({ content });
    await new ThreadsPostApiTransport().publish({ content });
} finally {
    globalThis.fetch = priorFetch;
}
await mkdir(`${root}/.kk/publish-presets`, { recursive: true });
await writeFile(
    `${root}/.kk/publish-presets/daily-ai-voice.json`,
    await readFile('plugins/kk/publish-presets/daily-ai-voice.json'),
);
const variantRaw = JSON.stringify(content);
await writeFile(`${root}/variant.json`, variantRaw);
await writeFile(
    `${root}/bundle.json`,
    JSON.stringify({
        schemaVersion: 1,
        runId: 'probe',
        runDate: '20261025',
        episode: { title: 'probe' },
        variants: {
            article: { path: 'variant.json', sha256: new Bun.CryptoHasher('sha256').update(variantRaw).digest('hex') },
        },
    }),
);
const cnExit = await planPublishMatrix(
    [
        root,
        '--bundle',
        `${root}/bundle.json`,
        '--window',
        'cn-peak',
        '--preset',
        'daily-ai-voice',
        '--live-channels',
        'wechatmp-pub,xhs-pub,weibo-pub,x-pub',
    ],
    { projectRoot: root },
);
const draftMappings = {
    surfdashFrontmatter: mapContentToSurfingMarkdown(content),
    podcastStatus: mapContentToEpisode({
        ...content,
        metadata: { ...content.metadata, audioUrl: 'https://example.invalid/probe.mp3' },
    }).status,
};
const result = {
    draftReceiptReusedForDifferentLiveRun: {
        dispatches,
        retainedReceipt: JSON.parse(await readFile(`${root}/receipts/probe.json`, 'utf8')),
    },
    draftModeHttpAttempts: requests,
    draftMappings,
    cnSchedulePlanExit: cnExit,
};
await writeFile('.spur/reports/publish3-review-probes.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
