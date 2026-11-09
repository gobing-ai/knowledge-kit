import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { BrowserContext } from 'playwright';
import { BotError } from '../src/bot';
import {
    type BotCollectionArtifact,
    type BotCollectionOptions,
    type BotCollectionPlan,
    runBotCollection,
} from '../src/bot-collection';
import type { ProfileLease } from '../src/profile-lease';

/**
 * Rendered collection runner (task 0346 R1–R4) driven through an injected fake launcher: no
 * browser binary, no real profile root, no real lease. These tests prove plan validation before
 * side effects, ordered execution, one launch/one lease, capture timing, fail-closed
 * classification, redaction, deadlines/caps and cleanup. Real Chromium behavior is proven by
 * `apps/cli/tests/e2e-bot-collection.ts`, not here.
 */

const PROFILE = 'bot-a';
const BASE = 'https://collect.test';

/** One emitted response the runner's pre-registered listener should see. */
interface EmittedResponse {
    url: string;
    status?: number;
    body?: string;
    bodyRejects?: boolean;
    bodyHangs?: boolean;
}

/** Deterministic fake behaviour; every hook is optional and records into the run record. */
interface FakeBehaviour {
    fetchStatus?: number;
    fetchBody?: string;
    fetchThrows?: boolean;
    fetchError?: string;
    fetchBodyHangs?: boolean;
    gotoStatus?: number;
    gotoThrows?: boolean;
    gotoNoResponse?: boolean;
    /** Final URL after navigation (a login redirect changes only the URL). */
    finalUrl?: string;
    waitThrows?: boolean;
    clickThrows?: boolean;
    scrollThrows?: boolean;
    scrollHangs?: boolean;
    extractThrows?: boolean;
    /** An extraction that never settles — proves the step bound actually applies. */
    extractHangs?: boolean;
    content?: string;
    bodyText?: string;
    locatorHtml?: string;
    locatorText?: string;
    /** Responses emitted while the `wait` step runs — proves listeners precede step execution. */
    duringWait?: EmittedResponse[];
}

/** What the fake launcher recorded, asserted by the tests. */
interface FakeRecord {
    launches: number;
    acquires: string[];
    releases: number;
    closes: number;
    ops: string[];
    timeouts: number[];
    currentUrl: string;
    emit(spec: EmittedResponse): void;
}

interface FakeContext {
    record: FakeRecord;
    options: BotCollectionOptions;
}

function makeFake(behaviour: FakeBehaviour = {}): FakeContext {
    const ops: string[] = [];
    const timeouts: number[] = [];
    const acquires: string[] = [];
    const listeners: ((response: unknown) => void)[] = [];
    const hangingSettles: (() => void)[] = [];
    let currentUrl = 'about:blank';

    const record: FakeRecord = {
        launches: 0,
        acquires,
        releases: 0,
        closes: 0,
        ops,
        timeouts,
        get currentUrl() {
            return currentUrl;
        },
        emit(spec) {
            for (const listener of [...listeners]) listener(makeResponse(spec));
        },
    };

    function makeResponse(spec: EmittedResponse) {
        return {
            status: () => spec.status ?? 200,
            url: () => spec.url,
            body: async (): Promise<Buffer> => {
                if (spec.bodyRejects === true) throw new Error(`response body unavailable for ${spec.url}`);
                if (spec.bodyHangs === true) {
                    return await new Promise<Buffer>((_resolve, reject) => {
                        hangingSettles.push(() => reject(new Error('context closed')));
                    });
                }
                return Buffer.from(spec.body ?? '');
            },
        };
    }

    const page = {
        async goto(url: string, init: { timeout: number }) {
            ops.push('goto');
            timeouts.push(init.timeout);
            if (behaviour.gotoThrows === true) throw new Error(`page.goto: net::ERR_FAILED at ${url}`);
            currentUrl = behaviour.finalUrl ?? url;
            if (behaviour.gotoNoResponse === true) return null;
            return makeResponse({ url: currentUrl, status: behaviour.gotoStatus ?? 200 });
        },
        async waitForSelector(selector: string, init: { timeout: number }) {
            ops.push(`wait:${selector}`);
            timeouts.push(init.timeout);
            for (const spec of behaviour.duringWait ?? []) record.emit(spec);
            if (behaviour.waitThrows === true) throw new Error(`Timeout waiting for ${selector}`);
        },
        locator(selector: string) {
            return {
                first: () => ({
                    async click(init: { timeout: number }) {
                        ops.push(`click:${selector}`);
                        timeouts.push(init.timeout);
                        if (behaviour.clickThrows === true) throw new Error(`not clickable: ${selector}`);
                    },
                    async evaluate() {
                        ops.push(`element-html:${selector}`);
                        if (behaviour.extractThrows === true) throw new Error(`element detached: ${selector}`);
                        if (behaviour.extractHangs === true) return await new Promise<string>(() => {});
                        return behaviour.locatorHtml ?? '';
                    },
                    async innerText() {
                        ops.push(`element-text:${selector}`);
                        if (behaviour.extractThrows === true) throw new Error(`element detached: ${selector}`);
                        return behaviour.locatorText ?? '';
                    },
                }),
            };
        },
        async content() {
            ops.push('content');
            if (behaviour.extractThrows === true) throw new Error('page content unavailable');
            if (behaviour.extractHangs === true) return await new Promise<string>(() => {});
            return behaviour.content ?? '';
        },
        async evaluate(script: string) {
            ops.push(script.startsWith('document.body') ? 'body-text' : 'scroll');
            if (script.startsWith('document.body')) {
                if (behaviour.extractThrows === true) throw new Error('body text unavailable');
                if (behaviour.extractHangs === true) return await new Promise<string>(() => {});
                return behaviour.bodyText ?? '';
            }
            if (behaviour.scrollThrows === true) throw new Error('scroll refused');
            if (behaviour.scrollHangs === true) {
                return await new Promise<void>((_resolve, reject) => {
                    hangingSettles.push(() => reject(new Error('context closed')));
                });
            }
            return undefined;
        },
        url: () => currentUrl,
    };

    const context = {
        request: {
            async fetch(url: string, init: { method?: string; timeout?: number; data?: Buffer }) {
                ops.push(`fetch:${init.method}`);
                timeouts.push(init.timeout ?? 0);
                if (behaviour.fetchThrows === true) {
                    throw new Error(behaviour.fetchError ?? `apiRequestContext.fetch failed: ${url}`);
                }
                return {
                    status: () => behaviour.fetchStatus ?? 200,
                    statusText: () => 'OK',
                    headersArray: () => [],
                    body: async () => {
                        if (behaviour.fetchBodyHangs === true) {
                            return await new Promise<Buffer>((_resolve, reject) => {
                                hangingSettles.push(() => reject(new Error('context closed')));
                            });
                        }
                        return Buffer.from(behaviour.fetchBody ?? 'request-body');
                    },
                };
            },
        },
        on(event: string, listener: (response: unknown) => void) {
            if (event === 'response') listeners.push(listener);
            return context;
        },
        pages: () => [page],
        newPage: async () => page,
        once: () => context,
        cookies: async () => [],
        async close() {
            record.closes += 1;
            for (const settle of hangingSettles.splice(0)) settle();
        },
    };

    const launcher = {
        async launch() {
            record.launches += 1;
            return context as unknown as BrowserContext;
        },
    };

    return {
        record,
        options: {
            launcher,
            acquireLease: async (profileDir: string) => {
                acquires.push(profileDir);
                return {
                    release: async () => {
                        record.releases += 1;
                    },
                } as unknown as ProfileLease;
            },
        },
    };
}

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kk-bot-collection-'));
    mkdirSync(join(root, PROFILE));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

/** Run a plan against the fake, with the temp root as the profile root. */
async function run(
    plan: BotCollectionPlan,
    behaviour: FakeBehaviour = {},
    extra: Partial<BotCollectionOptions> = {},
): Promise<{ result?: Awaited<ReturnType<typeof runBotCollection>>; error?: BotError; fake: FakeRecord }> {
    const fake = makeFake(behaviour);
    try {
        const result = await runBotCollection(PROFILE, plan, {
            root,
            fileSystem: createNodeFileSystem(),
            ...fake.options,
            ...extra,
        });
        return { result, fake: fake.record };
    } catch (error) {
        expect(error).toBeInstanceOf(BotError);
        return { error: error as BotError, fake: fake.record };
    }
}

const requestStep = { id: 'fetch', type: 'request', url: `${BASE}/api/items?token=SEKRET` } as const;

describe('plan validation happens before any side effect (R3)', () => {
    const cases: Array<[string, unknown, string]> = [
        ['non-object plan', 'nope', 'plan must be a JSON object'],
        ['steps not an array', { steps: 'x' }, 'plan.steps must be an array'],
        ['responses not an array', { steps: [], responses: 'x' }, 'plan.responses must be an array'],
        ['step not an object', { steps: ['x'] }, 'plan.steps[0]'],
        ['unknown step type', { steps: [{ id: 'a', type: 'paging' }] }, 'plan.steps[0].type'],
        ['unsafe step id', { steps: [{ id: 'a b', type: 'wait', selector: 'x' }] }, 'plan.steps[0].id'],
        ['empty selector', { steps: [{ id: 'a', type: 'wait', selector: ' ' }] }, 'plan.steps[0].selector'],
        ['click needs a selector', { steps: [{ id: 'a', type: 'click' }] }, 'plan.steps[0].selector'],
        ['bad deltaY', { steps: [{ id: 'a', type: 'scroll', deltaY: 0 }] }, 'plan.steps[0].deltaY'],
        ['bad extract format', { steps: [{ id: 'a', type: 'extract', format: 'pdf' }] }, 'plan.steps[0].format'],
        ['bad data type', { steps: [{ id: 'a', type: 'request', url: `${BASE}/x`, data: 5 }] }, 'plan.steps[0].data'],
        [
            'bad followRedirects',
            { steps: [{ id: 'a', type: 'request', url: `${BASE}/x`, followRedirects: 'yes' }] },
            'plan.steps[0].followRedirects',
        ],
        [
            'bad headers',
            { steps: [{ id: 'a', type: 'request', url: `${BASE}/x`, headers: { a: 1 } }] },
            'plan.steps[0].headers.a',
        ],
        ['bad method', { steps: [{ id: 'a', type: 'request', url: `${BASE}/x`, method: '' }] }, 'plan.steps[0].method'],
        [
            'bad waitUntil',
            { steps: [{ id: 'a', type: 'navigate', url: `${BASE}/x`, waitUntil: 'paint' }] },
            'plan.steps[0].waitUntil',
        ],
        ['relative url', { steps: [{ id: 'a', type: 'navigate', url: '/x' }] }, 'plan.steps[0].url'],
        ['ftp url', { steps: [{ id: 'a', type: 'navigate', url: 'ftp://x.test/' }] }, 'plan.steps[0].url'],
        ['credential url', { steps: [{ id: 'a', type: 'request', url: 'https://u:p@x.test/' }] }, 'plan.steps[0].url'],
        [
            'non-integer step timeout',
            { steps: [{ id: 'a', type: 'wait', selector: 'x', timeoutMs: 1.5 }] },
            'plan.steps[0].timeoutMs',
        ],
        [
            'duplicate id',
            {
                steps: [
                    { id: 'a', type: 'wait', selector: 'x' },
                    { id: 'a', type: 'click', selector: 'y' },
                ],
            },
            'duplicates',
        ],
        ['no artifact source', { steps: [{ id: 'a', type: 'wait', selector: 'x' }] }, 'no artifact source'],
        [
            'bad capture origin',
            {
                steps: [{ id: 'a', type: 'extract', format: 'text' }],
                responses: [{ id: 'r', origin: `${BASE}/api`, pathPrefix: '/api' }],
            },
            'plan.responses[0].origin',
        ],
        [
            'capture origin with credentials',
            { steps: [], responses: [{ id: 'r', origin: 'https://u:p@collect.test', pathPrefix: '/api' }] },
            'plan.responses[0].origin',
        ],
        [
            'relative pathPrefix',
            { steps: [], responses: [{ id: 'r', pathPrefix: 'api' }] },
            'plan.responses[0].pathPrefix',
        ],
        [
            'query in pathPrefix',
            { steps: [], responses: [{ id: 'r', pathPrefix: '/api?x' }] },
            'plan.responses[0].pathPrefix',
        ],
        ['capture not an object', { steps: [], responses: ['x'] }, 'plan.responses[0]'],
        [
            'duplicate capture id',
            { steps: [{ id: 'a', type: 'extract', format: 'text' }], responses: [{ id: 'a', pathPrefix: '/api' }] },
            'duplicates',
        ],
        [
            'plan timeout above the ceiling',
            { steps: [{ id: 'a', type: 'extract', format: 'text' }], timeoutMs: 600_001 },
            'plan.timeoutMs must not exceed',
        ],
        [
            'plan timeout not an integer',
            { steps: [{ id: 'a', type: 'extract', format: 'text' }], timeoutMs: 10.5 },
            'plan.timeoutMs must be a positive integer',
        ],
    ];

    for (const [label, plan, expected] of cases) {
        test(`rejects ${label}`, async () => {
            const { error, fake } = await run(plan as BotCollectionPlan);
            expect(error?.code).toBe('usage');
            expect(error?.message).toContain(expected);
            // Validation precedes everything: no lease, no launch.
            expect(fake.acquires).toHaveLength(0);
            expect(fake.launches).toBe(0);
        });
    }

    test('rejects an unsafe profile name before the profile lookup', async () => {
        const fake = makeFake();
        await expect(
            runBotCollection(
                'not safe',
                { steps: [{ id: 'a', type: 'extract', format: 'text' }] },
                {
                    root,
                    ...fake.options,
                },
            ),
        ).rejects.toMatchObject({ code: 'usage' });
    });

    test('reports a missing profile as not-found without acquiring a lease', async () => {
        const fake = makeFake();
        await expect(
            runBotCollection(
                'absent',
                { steps: [{ id: 'a', type: 'extract', format: 'text' }] },
                {
                    root,
                    ...fake.options,
                },
            ),
        ).rejects.toMatchObject({ code: 'not-found' });
        expect(fake.record.acquires).toHaveLength(0);
        expect(fake.record.launches).toBe(0);
    });
});

describe('ordered execution, one launch and one lease (R1, R3)', () => {
    test('runs plan steps in declaration order and returns identity plus a redacted URL', async () => {
        const plan: BotCollectionPlan = {
            steps: [
                { id: 'open', type: 'navigate', url: `${BASE}/items?page=2` },
                { id: 'ready', type: 'wait', selector: '.item' },
                { id: 'more', type: 'click', selector: '.more' },
                { id: 'down', type: 'scroll', deltaY: 400 },
                { id: 'markup', type: 'extract', format: 'html', selector: 'main' },
                { id: 'copy', type: 'extract', format: 'text' },
                requestStep,
            ],
        };
        const { result, error, fake } = await run(plan, {
            locatorHtml: '<main><p class="item">hi</p></main>',
            bodyText: 'rendered body',
        });

        expect(error).toBeUndefined();
        expect(fake.ops).toEqual([
            'goto',
            'wait:.item',
            'click:.more',
            'scroll',
            'element-html:main',
            'body-text',
            'fetch:GET',
        ]);
        expect(fake.launches).toBe(1);
        expect(fake.acquires).toEqual([join(root, PROFILE)]);
        expect(result?.steps.map((step) => [step.index, step.id, step.type])).toEqual([
            [0, 'open', 'navigate'],
            [1, 'ready', 'wait'],
            [2, 'more', 'click'],
            [3, 'down', 'scroll'],
            [4, 'markup', 'extract'],
            [5, 'copy', 'extract'],
            [6, 'fetch', 'request'],
        ]);
        expect(result?.steps[0]?.url).toBe(`${BASE}/items`);

        const artifacts = result?.artifacts ?? [];
        expect(artifacts.map((artifact) => [artifact.id, artifact.kind])).toEqual([
            ['markup', 'html'],
            ['copy', 'text'],
            ['fetch', 'request'],
        ]);
        expect(artifacts[0]?.body).toContain('class="item"');
        expect(artifacts[2]?.status).toBe(200);
        // The supplied query carried a token and must not survive into the result.
        expect(artifacts[2]?.url).toBe(`${BASE}/api/items`);
        expect(JSON.stringify(result)).not.toContain('SEKRET');
        expect(fake.releases).toBe(1);
        expect(fake.closes).toBe(1);
    });

    test('clamps a per-step timeout to the remaining whole-run budget', async () => {
        const { fake } = await run(
            {
                steps: [
                    { id: 'ready', type: 'wait', selector: '.item', timeoutMs: 5000 },
                    { id: 'copy', type: 'extract', format: 'text' },
                ],
                timeoutMs: 5000,
            },
            { bodyText: 'x' },
        );
        const [timeout] = fake.timeouts;
        expect(timeout).toBeDefined();
        expect(timeout as number).toBeGreaterThan(4900);
        expect(timeout as number).toBeLessThanOrEqual(5000);
    });

    test('defaults POST when data is supplied and follows redirects only when asked', async () => {
        const { fake } = await run({
            steps: [
                { id: 'post', type: 'request', url: `${BASE}/api`, data: '{"a":1}' },
                { id: 'follow', type: 'request', url: `${BASE}/api`, followRedirects: true, method: 'PUT' },
            ],
        });
        expect(fake.ops).toEqual(['fetch:POST', 'fetch:PUT']);
    });

    test('an extraction before any navigation reports no URL rather than about:blank', async () => {
        const { result, error } = await run(
            { steps: [{ id: 'copy', type: 'extract', format: 'text' }] },
            { bodyText: 'text before navigation' },
        );
        expect(error).toBeUndefined();
        expect(result?.artifacts[0]?.url).toBeUndefined();
        expect(result?.artifacts[0]?.body).toBe('text before navigation');
    });

    test('navigates without a response object and still reports the final URL', async () => {
        const { result } = await run(
            {
                steps: [
                    { id: 'open', type: 'navigate', url: `${BASE}/app`, waitUntil: 'domcontentloaded' },
                    { id: 'copy', type: 'extract', format: 'text', selector: '.note' },
                ],
            },
            { gotoNoResponse: true, locatorText: 'note text' },
        );
        expect(result?.steps[0]?.url).toBe(`${BASE}/app`);
        expect(result?.artifacts[0]?.body).toBe('note text');
        expect(result?.artifacts[0]?.url).toBe(`${BASE}/app`);
    });
});

describe('pre-registered response capture (R2)', () => {
    const plan: BotCollectionPlan = {
        steps: [
            { id: 'open', type: 'navigate', url: `${BASE}/app` },
            { id: 'ready', type: 'wait', selector: '.item' },
        ],
        responses: [{ id: 'items', origin: BASE, pathPrefix: '/api/items' }],
    };

    test('captures a response that arrives before any later step, and ignores unrelated traffic', async () => {
        const { result, error } = await run(plan, {
            duringWait: [
                { url: `${BASE}/api/items?page=1&token=SEKRET`, body: '[{"id":1}]' },
                { url: `${BASE}/analytics?q=1`, body: 'noise' },
                { url: 'https://elsewhere.test/api/items', body: 'other-origin' },
            ],
        });
        expect(error).toBeUndefined();
        const captured: BotCollectionArtifact[] = result?.artifacts ?? [];
        expect(captured).toHaveLength(1);
        expect(captured[0]?.id).toBe('items');
        expect(captured[0]?.kind).toBe('response');
        expect(captured[0]?.body).toBe('[{"id":1}]');
        expect(captured[0]?.status).toBe(200);
        expect(captured[0]?.url).toBe(`${BASE}/api/items`);
        expect(JSON.stringify(result)).not.toContain('SEKRET');
    });

    test('returns one artifact per matching response', async () => {
        const { result } = await run(
            {
                steps: [{ id: 'ready', type: 'wait', selector: '.item' }],
                responses: [{ id: 'pages', pathPrefix: '/api/items' }],
            },
            {
                duringWait: [
                    { url: `${BASE}/api/items?page=1`, body: 'one' },
                    { url: `${BASE}/api/items?page=2`, body: 'two' },
                ],
            },
        );
        expect(result?.artifacts.map((artifact) => artifact.body)).toEqual(['one', 'two']);
    });

    test('fails empty when a required capture never matches', async () => {
        const { error } = await run(plan, { duringWait: [{ url: `${BASE}/api/other`, body: 'x' }] });
        expect(error?.code).toBe('empty');
        expect(error?.details.stepId).toBe('items');
        expect(error?.message).toContain("capture 'items'");
    });

    test('fails empty when every matching body is blank', async () => {
        const { error } = await run(plan, { duringWait: [{ url: `${BASE}/api/items`, body: '   ' }] });
        expect(error?.code).toBe('empty');
        expect(error?.details.stepId).toBe('items');
    });

    test('fails browser when a matched body cannot be read, without echoing the URL', async () => {
        const { error } = await run(plan, {
            duringWait: [{ url: `${BASE}/api/items?token=SEKRET`, body: '', bodyRejects: true }],
        });
        expect(error?.code).toBe('browser');
        expect(error?.details.stepId).toBe('items');
        expect(error?.message).not.toContain('SEKRET');
        expect(error?.message).not.toContain(BASE);
    });

    test('fails browser when a capture body does not settle inside the deadline', async () => {
        const { error } = await run(
            { ...plan, timeoutMs: 120 },
            { duringWait: [{ url: `${BASE}/api/items`, body: '', bodyHangs: true }] },
        );
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('exceeded the collection deadline');
    });

    test('classifies required capture statuses instead of returning their error bodies', async () => {
        for (const [status, code] of [
            [401, 'authentication'],
            [403, 'authentication'],
            [404, 'browser'],
        ] as const) {
            const { error, fake } = await run(plan, {
                duringWait: [{ url: `${BASE}/api/items?token=SEKRET`, status, body: 'MARKER-BODY' }],
            });
            expect(error?.code).toBe(code);
            expect(error?.details).toMatchObject({ stepId: 'items' });
            expect(error?.details.stepIndex).toBeUndefined();
            expect(error?.message).toContain("capture 'items'");
            expect(error?.message).not.toContain('SEKRET');
            expect(error?.message).not.toContain('MARKER-BODY');
            expect(fake.closes).toBe(1);
            expect(fake.releases).toBe(1);
        }
    });
});

describe('fail-closed classification and redaction (R4)', () => {
    test('401 and 403 are authentication failures naming the safe step id and login guidance', async () => {
        for (const status of [401, 403]) {
            const { error } = await run({ steps: [requestStep] }, { fetchStatus: status });
            expect(error?.code).toBe('authentication');
            expect(error?.details).toMatchObject({ stepIndex: 0, stepId: 'fetch' });
            expect(error?.message).toContain('kk bot login');
            expect(error?.message).not.toContain('SEKRET');
        }
    });

    test('any other explicit status ≥400 is a browser failure', async () => {
        const { error } = await run({ steps: [requestStep] }, { fetchStatus: 404 });
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('status 404');
    });

    test('a navigation landing on a login path is an authentication failure', async () => {
        const { error } = await run(
            {
                steps: [
                    { id: 'open', type: 'navigate', url: `${BASE}/app` },
                    { id: 'copy', type: 'extract', format: 'text' },
                ],
            },
            { finalUrl: `${BASE}/signin?next=/app` },
        );
        expect(error?.code).toBe('authentication');
        expect(error?.details.stepId).toBe('open');
        expect(error?.message).toContain('kk bot login');
    });

    test('a navigation whose response is 403 is an authentication failure', async () => {
        const { error } = await run(
            {
                steps: [
                    { id: 'open', type: 'navigate', url: `${BASE}/app` },
                    { id: 'copy', type: 'extract', format: 'text' },
                ],
            },
            { gotoStatus: 403 },
        );
        expect(error?.code).toBe('authentication');
    });

    test('a navigation with a non-auth ≥400 status is a browser failure', async () => {
        const { error } = await run(
            {
                steps: [
                    { id: 'open', type: 'navigate', url: `${BASE}/app` },
                    { id: 'copy', type: 'extract', format: 'text' },
                ],
            },
            { gotoStatus: 500, bodyText: 'x' },
        );
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('status 500');
    });

    test('request transport failures keep the query out of the diagnostic', async () => {
        const { error } = await run({ steps: [requestStep] }, { fetchThrows: true });
        expect(error?.code).toBe('browser');
        expect(error?.message).not.toContain('SEKRET');
        expect(error?.message).toContain('<url>');
    });

    test('request transport failures remove every supplied header and data value', async () => {
        const { error } = await run(
            {
                steps: [
                    {
                        ...requestStep,
                        headers: { authorization: 'HEADER-SEKRET', 'x-api-key': 'KEY-SEKRET' },
                        data: 'DATA-SEKRET',
                    },
                ],
            },
            {
                fetchThrows: true,
                fetchError: `fetch failed for ${requestStep.url}: HEADER-SEKRET KEY-SEKRET DATA-SEKRET`,
            },
        );
        expect(error?.code).toBe('browser');
        for (const secret of ['SEKRET', 'HEADER-SEKRET', 'KEY-SEKRET', 'DATA-SEKRET']) {
            expect(error?.message).not.toContain(secret);
        }
    });

    test('navigation failures keep the query out of the diagnostic', async () => {
        const { error } = await run(
            {
                steps: [
                    { id: 'open', type: 'navigate', url: `${BASE}/app?token=SEKRET` },
                    { id: 'copy', type: 'extract', format: 'text' },
                ],
            },
            { gotoThrows: true },
        );
        expect(error?.code).toBe('browser');
        expect(error?.details.stepId).toBe('open');
        expect(error?.message).not.toContain('SEKRET');
    });

    test('wait, click, scroll and extract failures are static and named', async () => {
        const steps: Array<[FakeBehaviour, string]> = [
            [{ waitThrows: true }, 'timed out waiting'],
            [{ clickThrows: true }, 'could not click'],
            [{ scrollThrows: true }, 'could not scroll'],
            [{ extractThrows: true }, 'could not extract'],
        ];
        for (const [behaviour, expected] of steps) {
            const plan: BotCollectionPlan = {
                steps: [
                    { id: 'a', type: 'wait', selector: '.x' },
                    { id: 'b', type: 'click', selector: '.x' },
                    { id: 'c', type: 'scroll', deltaY: -50 },
                    { id: 'd', type: 'extract', format: 'text' },
                ],
            };
            const { error } = await run(plan, { ...behaviour, bodyText: 'x' });
            expect(error?.code).toBe('browser');
            expect(error?.message).toContain(expected);
        }
    });

    test('an extraction that never settles is bounded by the step timeout', async () => {
        const { error } = await run(
            { steps: [{ id: 'copy', type: 'extract', format: 'text', timeoutMs: 80 }], timeoutMs: 5000 },
            { extractHangs: true },
        );
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('could not extract');
        expect(error?.details.stepId).toBe('copy');
    });

    test('scroll and request-body reads are bounded by the step timeout', async () => {
        const cases = [
            {
                plan: {
                    steps: [
                        { id: 'down', type: 'scroll', deltaY: 50, timeoutMs: 60 },
                        { id: 'copy', type: 'extract', format: 'text' },
                    ],
                } as BotCollectionPlan,
                behaviour: { scrollHangs: true },
                id: 'down',
            },
            {
                plan: { steps: [{ ...requestStep, timeoutMs: 60 }] },
                behaviour: { fetchBodyHangs: true },
                id: 'fetch',
            },
        ];
        for (const entry of cases) {
            const { error, fake } = await run({ ...entry.plan, timeoutMs: 5000 }, entry.behaviour);
            expect(error?.code).toBe('browser');
            expect(error?.message).toContain('exceeded the collection deadline');
            expect(error?.details).toMatchObject({ stepIndex: 0, stepId: entry.id });
            expect(fake.closes).toBe(1);
            expect(fake.releases).toBe(1);
        }
    });

    test('an extract step with no content fails empty', async () => {
        const { error } = await run({ steps: [{ id: 'copy', type: 'extract', format: 'text' }] }, { bodyText: '  ' });
        expect(error?.code).toBe('empty');
        expect(error?.details).toMatchObject({ stepIndex: 0, stepId: 'copy' });
    });

    test('an element extraction failure is a named browser failure', async () => {
        const { error } = await run(
            { steps: [{ id: 'copy', type: 'extract', format: 'html', selector: 'main' }] },
            { locatorHtml: '' },
        );
        expect(error?.code).toBe('empty');
        expect(error?.details.stepId).toBe('copy');
    });

    test('a stored expiresAt in the past is never consulted: only an observed signal fails a run', async () => {
        // A profile whose recorded estimate is long past still collects, because an estimate is
        // not readiness evidence — the same rule the session-fact columns state.
        writeFileSync(
            join(root, PROFILE, 'bot.json'),
            JSON.stringify({
                schemaVersion: 1,
                defaultUrl: 'https://collect.test/app',
                authenticationEvidence: 'operator-confirmed',
                lastLoginAt: '2020-01-01T00:00:00.000Z',
                expiresAt: '2020-01-02T00:00:00.000Z',
            }),
        );
        const { error, result } = await run({ steps: [requestStep] });
        expect(error).toBeUndefined();
        expect(result?.artifacts[0]?.body).toBe('request-body');

        // The same profile fails the moment a signal is observed.
        const rejected = await run({ steps: [requestStep] }, { fetchStatus: 401 });
        expect(rejected.error?.code).toBe('authentication');
    });
});

describe('deadline, caps and cleanup (R3)', () => {
    test('a step that starts past the whole-run deadline fails without running', async () => {
        const ticks = [0, 5000];
        const { error, fake } = await run(
            { steps: [{ id: 'copy', type: 'extract', format: 'text' }], timeoutMs: 1000 },
            { bodyText: 'x' },
            {
                now: () => ticks.shift() ?? 5000,
            },
        );
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('exceeded the collection deadline');
        expect(fake.releases).toBe(1);
        expect(fake.closes).toBe(1);
    });

    test('a per-artifact body over the cap fails the run', async () => {
        const { error } = await run({ steps: [requestStep] }, { fetchBody: 'x'.repeat(5 * 1024 * 1024 + 1) });
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('per-artifact body cap');
        expect(error?.details.stepId).toBe('fetch');
    });

    test('an aggregate body over the cap fails the run', async () => {
        const body = 'x'.repeat(4 * 1024 * 1024);
        const { error } = await run(
            {
                steps: [
                    { id: 'a', type: 'request', url: `${BASE}/a` },
                    { id: 'b', type: 'request', url: `${BASE}/b` },
                    { id: 'c', type: 'request', url: `${BASE}/c` },
                    { id: 'd', type: 'request', url: `${BASE}/d` },
                    { id: 'e', type: 'request', url: `${BASE}/e` },
                    { id: 'f', type: 'request', url: `${BASE}/f` },
                ],
            },
            { fetchBody: body },
        );
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('aggregate body cap');
    });

    test('more than 100 artifacts fails the run', async () => {
        const declarations = Array.from({ length: 101 }, (_unused, index) => ({
            id: `c${index}`,
            pathPrefix: `/api/${index}/`,
        }));
        const emitted = declarations.map((declaration) => ({ url: `${BASE}${declaration.pathPrefix}x`, body: 'v' }));
        const { error } = await run(
            { steps: [{ id: 'ready', type: 'wait', selector: '.x' }], responses: declarations },
            { duringWait: emitted },
        );
        expect(error?.code).toBe('browser');
        expect(error?.message).toContain('more than 100 artifacts');
    });

    test('closes the context and releases the lease on failure', async () => {
        const { error, fake } = await run({ steps: [requestStep] }, { fetchStatus: 401 });
        expect(error?.code).toBe('authentication');
        expect(fake.closes).toBe(1);
        expect(fake.releases).toBe(1);
    });

    test('a launch failure still releases the lease', async () => {
        let releases = 0;
        await expect(
            runBotCollection(
                PROFILE,
                { steps: [requestStep] },
                {
                    root,
                    acquireLease: async () =>
                        ({
                            release: async () => {
                                releases += 1;
                            },
                        }) as unknown as ProfileLease,
                    launcher: {
                        async launch() {
                            throw new Error('executable does not exist');
                        },
                    },
                },
            ),
        ).rejects.toThrow('executable does not exist');
        expect(releases).toBe(1);
    });

    test('a lease refusal propagates as busy without launching', async () => {
        const fake = makeFake();
        await expect(
            runBotCollection(
                PROFILE,
                { steps: [requestStep] },
                {
                    root,
                    acquireLease: async () => {
                        throw new BotError('busy', 'profile busy');
                    },
                    launcher: fake.options.launcher,
                },
            ),
        ).rejects.toMatchObject({ code: 'busy' });
        expect(fake.record.launches).toBe(0);
    });
});
