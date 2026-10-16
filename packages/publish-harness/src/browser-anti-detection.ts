import type { Page } from 'playwright';

/** Opt-in anti-detection hooks for one page. Defaults are inert: no hooks install. */
export interface AntiDetectionOptions {
    /** Exact http(s) origins the hooks may act on. Required (nonempty) whenever a flag is enabled. */
    allowedOrigins?: readonly string[];
    /** Intercept the exact `/shield/webprofile` path on allowed origins with a synthetic receipt. */
    shieldProfile?: boolean;
    /** Suppress native file dialogs (behavior owned by the queued-file API; validated here only). */
    suppressFileChooser?: boolean;
}

/** The exact risk-control path intercepted when `shieldProfile` is enabled; query is allowed. */
const SHIELD_PATH = '/shield/webprofile';

/** Per-document install state: configuration signature plus the originals, kept off the wrapper chain. */
const INSTALL_KEY = '__kkAntiDetection';

/**
 * Validate options and canonicalize the origin allowlist. Enabled flags require nonempty canonical
 * http(s) origins without credentials, path, query or hash; omitted origins or both flags false
 * mean "install nothing".
 */
function resolveOptions(
    options: AntiDetectionOptions,
): { allowedOrigins: string[]; shieldProfile: boolean; suppressFileChooser: boolean } | undefined {
    const shieldProfile = options.shieldProfile === true;
    const suppressFileChooser = options.suppressFileChooser === true;
    if (!shieldProfile && !suppressFileChooser) return undefined;
    const raw = options.allowedOrigins;
    if (raw === undefined || raw.length === 0) {
        throw new Error('kk anti-detection: enabled flags require a nonempty allowedOrigins list');
    }
    const allowedOrigins = raw.map((entry) => {
        let url: URL;
        try {
            url = new URL(entry);
        } catch {
            throw new Error(`kk anti-detection: allowedOrigins entry is not a valid URL: '${entry}'`);
        }
        if (
            (url.protocol !== 'https:' && url.protocol !== 'http:') ||
            url.username !== '' ||
            url.password !== '' ||
            url.pathname !== '/' ||
            url.search !== '' ||
            url.hash !== '' ||
            url.origin === 'null'
        ) {
            throw new Error(`kk anti-detection: allowedOrigins entry must be a bare http(s) origin: '${entry}'`);
        }
        return url.origin;
    });
    return { allowedOrigins, shieldProfile, suppressFileChooser };
}

/**
 * The page-side installer, JSON-encoded into a string because the harness tsconfig has no DOM lib
 * (same pattern as the other browser.ts scripts). Runs in the MAIN world on every document via
 * `page.addInitScript` and once immediately via `page.evaluate`. It is a no-op outside the exact
 * allow-listed origins, keeps the originals privately under ${INSTALL_KEY}, and refuses
 * reconfiguration so wrappers never stack over an active install.
 */
function installerScript(config: {
    allowedOrigins: string[];
    shieldProfile: boolean;
    suppressFileChooser: boolean;
}): string {
    const payload = JSON.stringify(config);
    return `(() => {
    const cfg = ${payload};
    const allowed = new Set(cfg.allowedOrigins);
    if (!allowed.has(location.origin)) return;
    const existing = window['${INSTALL_KEY}'];
    const signature = JSON.stringify([cfg.allowedOrigins.slice().sort(), cfg.shieldProfile, cfg.suppressFileChooser]);
    if (existing) {
        if (existing.signature === signature) return;
        throw new Error('kk anti-detection: already installed with a different configuration on this document');
    }
    const originals = {};
    const SHIELD_PATH = ${JSON.stringify(SHIELD_PATH)};
    const nativeLike = (wrapper) => {
        wrapper.toString = function () { return 'function () { [native code] }'; };
        return wrapper;
    };
    const resolveUrl = (input) => {
        try {
            if (typeof Request === 'function' && input instanceof Request) return new URL(input.url);
            return new URL(String(input), document.baseURI);
        } catch {
            return null;
        }
    };
    const isShield = (url) => url !== null && url.origin === location.origin && allowed.has(url.origin) && url.pathname === SHIELD_PATH;
    const receipt = () => JSON.stringify({ code: 0, success: true, msg: 'ok', data: { st: Date.now() } });
    if (cfg.shieldProfile) {
        const originalFetch = window.fetch;
        originals.fetch = originalFetch;
        window.fetch = nativeLike(function (input) {
            if (isShield(resolveUrl(input))) {
                return Promise.resolve(new Response(receipt(), { status: 200, headers: { 'content-type': 'application/json' } }));
            }
            return originalFetch.apply(this, arguments);
        });
        const originalSendBeacon = navigator.sendBeacon.bind(navigator);
        originals.sendBeacon = originalSendBeacon;
        navigator.sendBeacon = nativeLike(function (url) {
            if (isShield(resolveUrl(url))) return true;
            return originalSendBeacon.apply(navigator, arguments);
        });
        const XHR = window.XMLHttpRequest;
        const originalOpen = XHR.prototype.open;
        const originalSend = XHR.prototype.send;
        const originalAbort = XHR.prototype.abort;
        originals.xhr = { XHR, open: originalOpen, send: originalSend, abort: originalAbort };
        XHR.prototype.open = nativeLike(function (method, url) {
            this['__kkShield'] = isShield(resolveUrl(url))
                ? { async: arguments.length < 3 || arguments[2] !== false, aborted: false, delivered: false }
                : null;
            return originalOpen.apply(this, arguments);
        });
        XHR.prototype.send = nativeLike(function () {
            const hit = this['__kkShield'];
            if (!hit) return originalSend.apply(this, arguments);
            if (!hit.async) throw new Error('kk anti-detection: synchronous XHR to the shield path is not supported');
            const self = this;
            const define = (name, value) => {
                try {
                    Object.defineProperty(self, name, { value, configurable: true });
                } catch {}
            };
            setTimeout(() => {
                if (hit.aborted || hit.delivered) return;
                hit.delivered = true;
                const body = receipt();
                define('readyState', 4);
                define('status', 200);
                define('statusText', 'OK');
                define('responseText', body);
                if (self.responseType === 'json') define('response', JSON.parse(body));
                else define('response', body);
                self.dispatchEvent(new Event('readystatechange'));
                self.dispatchEvent(new Event('load'));
                self.dispatchEvent(new Event('loadend'));
            }, 0);
        });
        XHR.prototype.abort = nativeLike(function () {
            if (this['__kkShield']) this['__kkShield'].aborted = true;
            return originalAbort.apply(this, arguments);
        });
    }
    if (cfg.suppressFileChooser) {
        const originalClick = HTMLInputElement.prototype.click;
        originals.inputClick = originalClick;
        HTMLInputElement.prototype.click = nativeLike(function () {
            const install = window['${INSTALL_KEY}'];
            const batch = install ? install.pending : null;
            if (!(this instanceof HTMLInputElement) || this.type !== 'file' || !Array.isArray(batch)) {
                return originalClick.apply(this, arguments);
            }
            // Enforce the multiple constraint BEFORE consumption: a single-file input keeps native
            // behavior and the queue stays available for a multiple-capable input.
            if (batch.length > 1 && !this.multiple) return originalClick.apply(this, arguments);
            const transfer = new DataTransfer();
            for (const file of batch) transfer.items.add(file);
            // Assignment first: a failure here preserves the queue and surfaces the real error.
            this.files = transfer.files;
            install.pending = null;
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
    window['${INSTALL_KEY}'] = { signature, originals, chooser: cfg.suppressFileChooser };
})()`;
}

/**
 * Install the opt-in anti-detection hooks on `page` (MAIN world): once for the current document
 * via `evaluate` and for every later document via `addInitScript` with the same self-contained
 * script. Inert when no flag is enabled. Re-invoking with the same options is a per-document
 * no-op (wrappers never stack); conflicting options on an installed document throw before any
 * init script is registered.
 */
export async function injectBrowserAntiDetection(page: Page, options: AntiDetectionOptions = {}): Promise<void> {
    const config = resolveOptions(options);
    if (config === undefined) return;
    await page.evaluate(installerScript(config));
    await page.addInitScript(installerScript(config));
}

/** One pending browser file: serialized bytes decoded into a `File` in the page's current document. */
export interface BrowserPendingFile {
    /** File name as the site will observe it. */
    name: string;
    /** `type/subtype` MIME string; no parameters. */
    mimeType: string;
    /** Exact standard base64 (padded, no whitespace) of the file bytes. */
    base64: string;
}

/** Declared queue bounds (design §Frozen file API): small files only; larger ones use setInputFiles. */
const MAX_QUEUED_FILES = 20;
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

/** Host-side trust boundary: reject malformed entries or batches beyond the declared bounds. */
function validatePendingFiles(files: readonly BrowserPendingFile[]): number {
    if (files.length === 0) throw new Error('kk file queue: files must be a nonempty batch');
    if (files.length > MAX_QUEUED_FILES) {
        throw new Error(`kk file queue: at most ${MAX_QUEUED_FILES} files per batch, got ${files.length}`);
    }
    let totalBytes = 0;
    for (const file of files) {
        if (typeof file?.name !== 'string' || file.name.trim() === '') {
            throw new Error('kk file queue: every file needs a nonempty name');
        }
        if (typeof file?.mimeType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType)) {
            throw new Error(`kk file queue: file '${file.name}' needs a type/subtype MIME string`);
        }
        if (typeof file?.base64 !== 'string' || file.base64.length === 0) {
            throw new Error(`kk file queue: file '${file.name}' needs nonempty base64 bytes`);
        }
        const bytes = Buffer.from(file.base64, 'base64');
        // Buffer decoding is lenient; the re-encode round-trip is the strict standard-base64 check.
        if (bytes.toString('base64') !== file.base64) {
            throw new Error(`kk file queue: file '${file.name}' base64 is not valid standard base64`);
        }
        totalBytes += bytes.length;
    }
    if (totalBytes > MAX_QUEUED_BYTES) {
        throw new Error(
            `kk file queue: decoded batch is ${totalBytes} bytes, above the ${MAX_QUEUED_BYTES}-byte limit`,
        );
    }
    return totalBytes;
}

/**
 * Page-side queue installer, JSON-encoded like the other scripts. Requires the chooser hook on the
 * current document (the install record only exists on allowed origins, so record presence is the
 * origin check). Replaces any unused queue explicitly — never appends. Queues live only on the
 * current document's install record: never in init scripts, never restored after navigation.
 */
function queueScript(files: readonly BrowserPendingFile[]): string {
    const payload = JSON.stringify(files);
    return `(() => {
    const install = window['${INSTALL_KEY}'];
    if (!install || !install.chooser) {
        throw new Error('kk file queue: no chooser hook is installed on this document — call injectBrowserAntiDetection with suppressFileChooser first');
    }
    install.pending = ${payload}.map((file) => {
        const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
        return new File([bytes], file.name, { type: file.mimeType });
    });
})();`;
}

/**
 * Queue `files` as the next one-shot file-dialog batch on `page`'s current document: the next
 * `input[type=file].click()` while the chooser hook is installed consumes them (files assigned,
 * bubbling input+change dispatched, no native chooser) and later clicks revert to native behavior.
 * Host validation runs before anything is evaluated; a queued batch is replaced, never appended.
 */
export async function queueBrowserFiles(page: Page, files: readonly BrowserPendingFile[]): Promise<void> {
    validatePendingFiles(files);
    await page.evaluate(queueScript(files));
}
