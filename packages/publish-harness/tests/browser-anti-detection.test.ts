import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import type { Browser, Page } from 'playwright';
import { injectBrowserAntiDetection, queueBrowserFiles } from '../src/browser-anti-detection';
import {
    launchChromium,
    mainServerRoutes,
    newPage,
    otherServerRoutes,
    startFixtureServer,
    until,
} from './fixtures/browser-anti-detection-runner';

/** Fake `Page` exposing only the two primitives the installer uses, with call recording. */
function makeFakePage(): { page: Page; evaluated: unknown[]; initScripts: unknown[] } {
    const evaluated: unknown[] = [];
    const initScripts: unknown[] = [];
    return {
        evaluated,
        initScripts,
        page: {
            evaluate: async (script: string | (() => unknown)) => {
                evaluated.push(script);
                return undefined;
            },
            addInitScript: async (script: string | (() => unknown)) => {
                initScripts.push(script);
            },
        } as unknown as Page,
    };
}

describe('injectBrowserAntiDetection', () => {
    test('disabled flags install no hooks', async () => {
        const fake = makeFakePage();
        await injectBrowserAntiDetection(fake.page);
        await injectBrowserAntiDetection(fake.page, { allowedOrigins: ['https://example.com'] });
        await injectBrowserAntiDetection(fake.page, {
            shieldProfile: false,
            suppressFileChooser: false,
            allowedOrigins: ['https://example.com'],
        });
        expect(fake.evaluated).toHaveLength(0);
        expect(fake.initScripts).toHaveLength(0);
    });

    test('enabled flags require a nonempty origin list', async () => {
        const fake = makeFakePage();
        expect(injectBrowserAntiDetection(fake.page, { shieldProfile: true })).rejects.toThrow(
            'nonempty allowedOrigins',
        );
        expect(
            injectBrowserAntiDetection(fake.page, { suppressFileChooser: true, allowedOrigins: [] }),
        ).rejects.toThrow('nonempty allowedOrigins');
        expect(fake.evaluated).toHaveLength(0);
    });

    test('origin entries must be bare http(s) origins', async () => {
        const bad = [
            'ftp://example.com',
            'https://user:pw@example.com',
            'https://example.com/path',
            'https://example.com/?q=1',
            'https://example.com/#h',
        ];
        for (const origin of bad) {
            expect(
                injectBrowserAntiDetection(makeFakePage().page, { shieldProfile: true, allowedOrigins: [origin] }),
            ).rejects.toThrow('bare http(s) origin');
        }
        expect(
            injectBrowserAntiDetection(makeFakePage().page, { shieldProfile: true, allowedOrigins: ['not a url'] }),
        ).rejects.toThrow('not a valid URL');
    });

    test('an enabled hook evaluates the installer on the current document and registers it for navigations', async () => {
        const fake = makeFakePage();
        await injectBrowserAntiDetection(fake.page, {
            shieldProfile: true,
            allowedOrigins: ['https://example.com', 'http://other.test'],
        });
        expect(fake.evaluated).toHaveLength(1);
        expect(fake.initScripts).toHaveLength(1);
        const script = fake.evaluated[0] as string;
        expect(script).toContain('/shield/webprofile');
        expect(script).toContain('https://example.com');
        expect(script).toContain('http://other.test');
        expect(fake.initScripts[0]).toBe(script);
    });
});

/** Generated page scripts are self-contained; execute them against injected browser-global mocks. */
function runScript(script: string, mock: Record<string, unknown>): void {
    const names = Object.keys(mock);
    const fn = new Function(...names, `"use strict";\n${script}`);
    fn(...names.map((name) => mock[name]));
}

/** Minimal MAIN-world mock: just the globals the chooser-only installer and queue script touch. */
function makeChooserDom(origin: string) {
    const nativeClicks: unknown[][] = [];
    class Event {
        constructor(
            public type: string,
            public init?: { bubbles?: boolean },
        ) {}
    }
    class DataTransfer {
        private list: unknown[] = [];
        readonly items = {
            add: (file: unknown) => {
                this.list.push(file);
            },
        };
        get files() {
            return this.list;
        }
    }
    class File {
        constructor(
            public parts: unknown[],
            public name: string,
            public options?: { type?: string },
        ) {}
    }
    class HTMLInputElement {
        type = 'file';
        multiple = true;
        files: unknown = null;
        dispatched: Event[] = [];
        click(...args: unknown[]) {
            nativeClicks.push(args);
        }
        dispatchEvent(event: Event) {
            this.dispatched.push(event);
            return true;
        }
    }
    const windowObj: Record<string, unknown> = {};
    const mock = { window: windowObj, location: { origin }, HTMLInputElement, DataTransfer, Event, File };
    return { mock, windowObj, HTMLInputElement, nativeClicks };
}

const pendingFile = (body: string) => ({
    name: 'a.png',
    mimeType: 'image/png',
    base64: Buffer.from(body).toString('base64'),
});

/** Install the chooser-only hook into a mock DOM and return its pieces plus a queueing fake page. */
async function installChooserDom() {
    const fake = makeFakePage();
    await injectBrowserAntiDetection(fake.page, {
        suppressFileChooser: true,
        allowedOrigins: ['https://example.com'],
    });
    const dom = makeChooserDom('https://example.com');
    runScript(fake.evaluated[0] as string, dom.mock);
    const queue = async (files: Parameters<typeof queueBrowserFiles>[1]) => {
        await queueBrowserFiles(fake.page, files);
        runScript(fake.evaluated.at(-1) as string, dom.mock);
    };
    return { dom, queue };
}

function installRecord(dom: ReturnType<typeof makeChooserDom>): { pending: unknown } {
    return dom.windowObj.__kkAntiDetection as { pending: unknown };
}

describe('queueBrowserFiles', () => {
    test('rejects malformed entries and out-of-bounds batches before evaluating anything', async () => {
        const fake = makeFakePage();
        await injectBrowserAntiDetection(fake.page, {
            suppressFileChooser: true,
            allowedOrigins: ['https://example.com'],
        });
        expect(queueBrowserFiles(fake.page, [])).rejects.toThrow('nonempty batch');
        expect(
            queueBrowserFiles(
                fake.page,
                Array.from({ length: 21 }, () => pendingFile('x')),
            ),
        ).rejects.toThrow('at most 20 files');
        expect(queueBrowserFiles(fake.page, [{ ...pendingFile('x'), name: ' ' }])).rejects.toThrow('nonempty name');
        expect(queueBrowserFiles(fake.page, [{ ...pendingFile('x'), mimeType: 'png' }])).rejects.toThrow(
            'type/subtype',
        );
        expect(queueBrowserFiles(fake.page, [{ ...pendingFile('x'), base64: 'not!base64' }])).rejects.toThrow(
            'standard base64',
        );
        const oversize = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64');
        expect(queueBrowserFiles(fake.page, [{ ...pendingFile('x'), base64: oversize }])).rejects.toThrow('byte limit');
        expect(fake.evaluated).toHaveLength(1);
    });

    test('queues into the current document and replaces an unused queue instead of appending', async () => {
        const fake = makeFakePage();
        await injectBrowserAntiDetection(fake.page, {
            suppressFileChooser: true,
            allowedOrigins: ['https://example.com'],
        });
        await queueBrowserFiles(fake.page, [{ ...pendingFile('first'), name: 'first.png' }]);
        await queueBrowserFiles(fake.page, [{ ...pendingFile('second'), name: 'second.png' }]);
        expect(fake.evaluated).toHaveLength(3);
        const queue = fake.evaluated[2] as string;
        expect(queue).toContain('second.png');
        expect(queue).not.toContain('first.png');
        expect(fake.initScripts).toHaveLength(1); // queues never enter init scripts
    });

    test('requires an installed chooser hook on the document', async () => {
        const fake = makeFakePage();
        await injectBrowserAntiDetection(fake.page, {
            suppressFileChooser: true,
            allowedOrigins: ['https://example.com'],
        });
        await queueBrowserFiles(fake.page, [pendingFile('x')]);
        const queue = fake.evaluated[1] as string;
        const dom = makeChooserDom('https://example.com');
        expect(() => runScript(queue, dom.mock)).toThrow('no chooser hook');
        dom.windowObj.__kkAntiDetection = { signature: 'shield-only', originals: {}, chooser: false };
        expect(() => runScript(queue, dom.mock)).toThrow('no chooser hook');
    });

    test('a queued click assigns the files, fires input+change once, and the next click is native', async () => {
        const { dom, queue } = await installChooserDom();
        const input = new dom.HTMLInputElement();
        await queue([pendingFile('first'), pendingFile('second')]);
        input.click();
        expect(dom.nativeClicks).toHaveLength(0);
        const files = input.files as { name: string; options?: { type?: string } }[];
        expect(files).toHaveLength(2);
        expect(files.map((file) => file.name)).toEqual(['a.png', 'a.png']);
        expect(files.every((file) => file.options?.type === 'image/png')).toBe(true);
        expect(input.dispatched.map((event) => event.type)).toEqual(['input', 'change']);
        expect(input.dispatched.every((event) => event.init?.bubbles === true)).toBe(true);
        expect(installRecord(dom).pending).toBeNull();
        input.click();
        expect(dom.nativeClicks).toHaveLength(1);
    });

    test('ineligible clicks keep native behavior and leave the queue intact', async () => {
        const { dom, queue } = await installChooserDom();
        const noQueue = new dom.HTMLInputElement();
        noQueue.click();
        expect(dom.nativeClicks).toHaveLength(1);
        const text = new dom.HTMLInputElement();
        text.type = 'text';
        await queue([pendingFile('x')]);
        text.click();
        expect(dom.nativeClicks).toHaveLength(2);
        expect(installRecord(dom).pending).not.toBeNull();
        const single = new dom.HTMLInputElement();
        single.multiple = false;
        await queue([pendingFile('x'), pendingFile('y')]);
        single.click();
        expect(dom.nativeClicks).toHaveLength(3);
        expect(installRecord(dom).pending).not.toBeNull();
    });

    test('re-running the identical install does not stack the click wrapper; conflicting config throws', async () => {
        const fake = makeFakePage();
        await injectBrowserAntiDetection(fake.page, {
            suppressFileChooser: true,
            allowedOrigins: ['https://example.com'],
        });
        const dom = makeChooserDom('https://example.com');
        const installer = fake.evaluated[0] as string;
        runScript(installer, dom.mock);
        const wrapped = dom.HTMLInputElement.prototype.click;
        runScript(installer, dom.mock);
        expect(dom.HTMLInputElement.prototype.click).toBe(wrapped);
        dom.windowObj.__kkAntiDetection = { signature: 'different', originals: {} };
        expect(() => runScript(installer, dom.mock)).toThrow('already installed with a different configuration');
    });
});

/** Typed views of string-evaluated page results (harness tsconfig has no DOM lib). */
interface ShieldFetchView {
    status: number;
    type: string | null;
    body: { code: number; success: boolean; msg: string; data: { st: number } };
}
interface XhrLifecycleView {
    events: string[];
    readyState: number;
    status: number;
    responseText: string;
}
interface NativeXhrView {
    loaded: boolean;
    readyState: number;
    status: number;
    responseText: string;
}
interface InstallProbeView {
    stacked: boolean;
}
interface QueuedFilesView {
    count: number;
    names: string[];
    types: string[];
    sizes: number[];
    firstText: string | null;
    events: string[];
    pending: unknown;
}
interface RecordView {
    pending: { length: number } | null | undefined;
}

const fixtureFile = (name: string, body: string, mimeType: string) => ({
    name,
    mimeType,
    base64: Buffer.from(body).toString('base64'),
});

describe('real-Chromium synthetic-page fixtures (0288 R4)', () => {
    let browser: Browser;
    let page: Page;
    let chooserEvents = 0;

    beforeAll(async () => {
        browser = (await launchChromium()).browser;
    }, 30_000);
    afterAll(async () => {
        await browser.close();
    });
    beforeEach(async () => {
        page = await newPage(browser);
        chooserEvents = 0;
        page.on('filechooser', () => {
            chooserEvents += 1;
        });
    });
    afterEach(async () => {
        await page.close();
    });

    const main = startFixtureServer(mainServerRoutes());
    const other = startFixtureServer(otherServerRoutes());
    afterAll(async () => {
        await main.stop();
        await other.stop();
    });

    test('AC1: shield fetch is intercepted server-side with the exact synthetic receipt (query allowed)', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin] });
        main.reset();
        const hit = (await page.evaluate(`(async () => {
            const res = await fetch(${JSON.stringify(main.url('/shield/webprofile?q=1'))});
            return { status: res.status, type: res.headers.get('content-type'), body: await res.json() };
        })()`)) as ShieldFetchView;
        expect(hit.status).toBe(200);
        expect(hit.type).toBe('application/json');
        expect(hit.body.code).toBe(0);
        expect(hit.body.success).toBe(true);
        expect(hit.body.msg).toBe('ok');
        expect(typeof hit.body.data.st).toBe('number');
        expect(main.count('/shield/webprofile')).toBe(0);
    }, 30_000);

    test('AC3: fetch pass-through keeps native semantics and the server observes plain and Request calls; other origins pass through', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin] });
        main.reset();
        other.reset();
        const passthrough = (await page.evaluate(`(async () => {
            const plain = await fetch(${JSON.stringify(main.url('/api/other'))});
            const boom = await fetch(${JSON.stringify(main.url('/boom'))});
            const viaRequest = await fetch(new Request(${JSON.stringify(main.url('/api/other'))}));
            return { plainStatus: plain.status, plain: await plain.text(), boomStatus: boom.status, viaRequest: await viaRequest.text() };
        })()`)) as { plainStatus: number; plain: string; boomStatus: number; viaRequest: string };
        expect(passthrough).toEqual({
            plainStatus: 200,
            plain: 'passthrough-ok',
            boomStatus: 500,
            viaRequest: 'passthrough-ok',
        });
        expect(main.count('/api/other')).toBe(2);
        expect(main.count('/boom')).toBe(1);
        const otherBody = (await page.evaluate(
            `(async () => await (await fetch(${JSON.stringify(other.url('/shield/webprofile'))})).text())()`,
        )) as string;
        expect(otherBody).toBe('other-origin-shield');
        expect(other.count('/shield/webprofile')).toBe(1);
    }, 30_000);

    test('AC1: matching sendBeacon returns true without network; unmatched beacons reach the server', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin] });
        main.reset();
        const shielded = (await page.evaluate(
            `navigator.sendBeacon(${JSON.stringify(main.url('/shield/webprofile'))}, 'ping')`,
        )) as boolean;
        expect(shielded).toBe(true);
        expect(main.count('/shield/webprofile')).toBe(0);
        await page.evaluate(`navigator.sendBeacon(${JSON.stringify(main.url('/beacon'))}, 'ping')`);
        expect(await until(() => main.count('/beacon') === 1)).toBe(true);
    }, 30_000);

    test('AC1: matching async XHR exposes the synthetic lifecycle once (readystatechange/load/loadend, json response)', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin] });
        main.reset();
        const xhr = (await page.evaluate(`(async () => {
            const client = new XMLHttpRequest();
            const events = [];
            client.addEventListener('readystatechange', () => events.push('readystatechange:' + client.readyState));
            client.addEventListener('load', () => events.push('load'));
            client.addEventListener('loadend', () => events.push('loadend'));
            client.open('GET', ${JSON.stringify(main.url('/shield/webprofile'))});
            client.send();
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { events, readyState: client.readyState, status: client.status, responseText: client.responseText };
        })()`)) as XhrLifecycleView;
        expect(xhr.events.filter((event) => event !== 'readystatechange:1')).toEqual([
            'readystatechange:4',
            'load',
            'loadend',
        ]);
        expect(xhr.readyState).toBe(4);
        expect(xhr.status).toBe(200);
        expect(JSON.parse(xhr.responseText).code).toBe(0);
        const json = (await page.evaluate(`(async () => {
            const client = new XMLHttpRequest();
            client.responseType = 'json';
            let resolve;
            const done = new Promise((r) => { resolve = r; });
            client.addEventListener('load', () => resolve(client.response));
            client.open('GET', ${JSON.stringify(main.url('/shield/webprofile'))});
            client.send();
            return await done;
        })()`)) as ShieldFetchView['body'];
        expect(json).toEqual({ code: 0, success: true, msg: 'ok', data: { st: expect.any(Number) } });
        expect(main.count('/shield/webprofile')).toBe(0);
    }, 30_000);

    test('AC3: pass-through XHR keeps the native lifecycle; abort suppresses delivery; sync matching XHR is refused', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin] });
        main.reset();
        const native = (await page.evaluate(`(async () => {
            const client = new XMLHttpRequest();
            let loaded = false;
            client.addEventListener('load', () => { loaded = true; });
            client.open('GET', ${JSON.stringify(main.url('/api/other'))});
            client.send();
            await new Promise((resolve) => setTimeout(resolve, 300));
            return { loaded, readyState: client.readyState, status: client.status, responseText: client.responseText };
        })()`)) as NativeXhrView;
        expect(native).toEqual({ loaded: true, readyState: 4, status: 200, responseText: 'passthrough-ok' });
        expect(main.count('/api/other')).toBe(1);
        const aborted = (await page.evaluate(`(async () => {
            const client = new XMLHttpRequest();
            const events = [];
            client.addEventListener('load', () => events.push('load'));
            client.addEventListener('loadend', () => events.push('loadend'));
            client.open('GET', ${JSON.stringify(main.url('/shield/webprofile'))});
            client.send();
            client.abort();
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { events, status: client.status };
        })()`)) as { events: string[]; status: number };
        expect(aborted.events).toEqual([]);
        expect(aborted.status).toBe(0);
        expect(main.count('/shield/webprofile')).toBe(0);
        const syncError = (await page.evaluate(`(() => {
            const client = new XMLHttpRequest();
            client.open('GET', ${JSON.stringify(main.url('/shield/webprofile'))}, false);
            try { client.send(); return 'sent'; } catch (error) { return String(error && error.message); }
        })()`)) as string;
        expect(syncError).toContain('synchronous XHR');
    }, 30_000);

    test('AC1: direct wrapper toString reports the native-like string on every wrapped surface', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, {
            shieldProfile: true,
            suppressFileChooser: true,
            allowedOrigins: [main.origin],
        });
        const strings = (await page.evaluate(`({
            fetch: window.fetch.toString(),
            beacon: navigator.sendBeacon.toString(),
            open: XMLHttpRequest.prototype.open.toString(),
            send: XMLHttpRequest.prototype.send.toString(),
            abort: XMLHttpRequest.prototype.abort.toString(),
            click: HTMLInputElement.prototype.click.toString(),
        })`)) as Record<string, string>;
        for (const value of Object.values(strings)) expect(value).toBe('function () { [native code] }');
    }, 30_000);

    test('AC3: identical re-install never stacks wrappers, conflicting config throws, navigation re-installs cleanly', async () => {
        await page.goto(main.url('/'));
        const options = { shieldProfile: true, allowedOrigins: [main.origin] as const };
        await injectBrowserAntiDetection(page, options);
        await page.evaluate(`(() => {
            window.__probeNative = window.__kkAntiDetection.originals.fetch;
            window.__probeWrapper = window.fetch;
        })()`);
        await injectBrowserAntiDetection(page, options);
        const probe = (await page.evaluate(`(() => {
            const record = window.__kkAntiDetection;
            return {
                stacked: window.__probeNative !== record.originals.fetch || window.__probeWrapper !== window.fetch,
            };
        })()`)) as InstallProbeView;
        expect(probe.stacked).toBe(false);
        expect(
            injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin, other.origin] }),
        ).rejects.toThrow('already installed with a different configuration');
        await page.goto(main.url('/'));
        const fresh = (await page.evaluate(`(async () => {
            const receipt = await (await fetch(${JSON.stringify(main.url('/shield/webprofile'))})).json();
            const record = window.__kkAntiDetection;
            return {
                code: receipt.code,
                singleWrapper: window.fetch !== record.originals.fetch,
                toString: window.fetch.toString(),
            };
        })()`)) as { code: number; singleWrapper: boolean; toString: string };
        expect(fresh).toEqual({ code: 0, singleWrapper: true, toString: 'function () { [native code] }' });
        expect(main.count('/shield/webprofile')).toBe(0);
    }, 30_000);

    test('AC2: queued click assigns exact bytes to FileList, fires input+change once with no native dialog, consumed once', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { suppressFileChooser: true, allowedOrigins: [main.origin] });
        await queueBrowserFiles(page, [
            fixtureFile('a.png', 'hello', 'image/png'),
            fixtureFile('b.txt', 'café', 'text/plain'),
        ]);
        await page.evaluate(`(() => {
            window.__events = [];
            const input = document.querySelector('#existing');
            document.addEventListener('input', (event) => {
                window.__events.push('input@target=' + (event.target === input) + ':bubbles=' + event.bubbles);
            });
            document.addEventListener('change', () => window.__events.push('change'));
        })()`);
        await page.evaluate(`document.querySelector('#existing').click()`);
        const observed = (await page.evaluate(`(async () => {
            const input = document.querySelector('#existing');
            const files = Array.from(input.files);
            return {
                count: files.length,
                names: files.map((file) => file.name),
                types: files.map((file) => file.type),
                sizes: files.map((file) => file.size),
                firstText: files[0] ? await files[0].text() : null,
                events: window.__events,
                pending: window.__kkAntiDetection.pending,
            };
        })()`)) as QueuedFilesView;
        expect(observed.count).toBe(2);
        expect(observed.names).toEqual(['a.png', 'b.txt']);
        expect(observed.types).toEqual(['image/png', 'text/plain']);
        expect(observed.sizes).toEqual([Buffer.byteLength('hello'), Buffer.byteLength('café')]);
        expect(observed.firstText).toBe('hello');
        expect(observed.events).toEqual(['input@target=true:bubbles=true', 'change']);
        expect(observed.pending).toBeNull();
        expect(chooserEvents).toBe(0);
        // one-shot: the next click reverts to native behavior (real filechooser event)
        await page.evaluate(`document.querySelector('#existing').click()`);
        expect(await until(() => chooserEvents > 0)).toBe(true);
    }, 30_000);

    test('AC2: dynamically created inputs are hooked too and consume the queue with change events', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { suppressFileChooser: true, allowedOrigins: [main.origin] });
        await queueBrowserFiles(page, [fixtureFile('dyn.png', 'd', 'image/png')]);
        const dynamic = (await page.evaluate(`(() => new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            document.body.append(input);
            input.addEventListener('change', () => resolve([input.files.length, input.files[0].name]));
            input.click();
        }))()`)) as [number, string];
        expect(dynamic).toEqual([1, 'dyn.png']);
        expect(chooserEvents).toBe(0);
    }, 30_000);

    test('AC2/AC3: queue bounds reject, non-multiple input stays native and keeps the queue, navigation resets it', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { suppressFileChooser: true, allowedOrigins: [main.origin] });
        expect(queueBrowserFiles(page, [])).rejects.toThrow('nonempty batch');
        expect(
            queueBrowserFiles(
                page,
                Array.from({ length: 21 }, () => fixtureFile('a.png', 'x', 'image/png')),
            ),
        ).rejects.toThrow('at most 20 files');
        // non-multiple input with a 2-file batch: native click (real chooser) and the queue survives
        await queueBrowserFiles(page, [fixtureFile('a.png', 'x', 'image/png'), fixtureFile('b.png', 'y', 'image/png')]);
        await page.evaluate(`(() => {
            const single = document.createElement('input');
            single.type = 'file';
            single.id = 'single';
            document.body.append(single);
        })()`);
        await page.evaluate(`document.querySelector('#single').click()`);
        expect(await until(() => chooserEvents > 0)).toBe(true);
        const kept = (await page.evaluate('(() => ({ pending: window.__kkAntiDetection.pending }))()')) as RecordView;
        expect(kept.pending?.length).toBe(2);
        // navigation resets: the re-installed document starts with no pending batch
        await page.goto(main.url('/'));
        await page.evaluate(`document.querySelector('#existing').click()`);
        expect(await until(() => chooserEvents > 1)).toBe(true);
        const afterNav = (await page.evaluate(
            '(() => ({ count: document.querySelector("#existing").files.length, pending: window.__kkAntiDetection.pending }))()',
        )) as { count: number; pending: unknown };
        expect(afterNav.count).toBe(0);
        expect(afterNav.pending).toBeUndefined();
    }, 30_000);

    test('AC3: queueBrowserFiles requires an installed chooser hook on the real document', async () => {
        await page.goto(main.url('/'));
        await injectBrowserAntiDetection(page, { shieldProfile: true, allowedOrigins: [main.origin] });
        expect(queueBrowserFiles(page, [fixtureFile('a.png', 'x', 'image/png')])).rejects.toThrow(
            'no chooser hook is installed',
        );
    }, 30_000);
});
