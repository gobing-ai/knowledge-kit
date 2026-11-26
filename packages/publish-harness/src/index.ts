import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Content, Result } from '@gobing-ai/kk-core';

export {
    channelStorageStatePath,
    DEFAULT_CHANNEL_STATE_SETTLE_MS,
    persistChannelSessionState,
    restoreChannelSessionState,
    stateRestoringLauncher,
} from './session-state';

/**
 * Common payload passed to publish transport implementations.
 */
export interface PublishTransportPayload {
    /** Target markdown content and associated frontmatter/metadata. */
    content: Content;
    /** Target-specific options. */
    options?: Record<string, unknown>;
}

/**
 * Who drives a `browser` transport. Omitted for `file-cli`.
 *
 * `script` — Playwright (or equivalent) runs inside the plugin process.
 * `agent` — a kk skill / workflow `agent.run` drives the page; the plugin still
 * owns mapping and Result and never embeds an LLM (ADR-008 amdt 2026-09-17).
 */
export type BrowserDriver = 'script' | 'agent';

/**
 * Common interface for publish transports (`file-cli` vs `browser`).
 */
export interface PublishTransport {
    /** Transport mechanism classification. */
    kind: 'file-cli' | 'browser';
    /** Required when `kind` is `browser`. Omitted for `file-cli`. */
    driver?: BrowserDriver;
    /** Executes a publish operation given a transport payload. */
    publish(payload: PublishTransportPayload): Promise<Result>;
}

/**
 * In-memory recorded call log entry captured by fake transports.
 */
export interface FakeCallLogEntry {
    /** Timestamp when the call was captured. */
    timestamp: string;
    /** Payload supplied to the publish call. */
    payload: PublishTransportPayload;
}

/**
 * Shared body for the fake transports (0155 R3): the in-memory call log, the sticky result
 * override, and the publish/log/reset surface live here once. Not exported — the public API
 * stays the two fakes. Composition instead of an abstract base class: subclassing here
 * deterministically tripped a Bun 1.3.14 test-runner bug (full suite exits 1 with zero
 * failures; not re-tested on 1.4.3); composition keeps the single implementation site without inheritance.
 */
class FakeTransportCore {
    private callLogs: FakeCallLogEntry[] = [];
    private nextResult?: Result;

    /**
     * Configures the result returned by **every** subsequent publish call until `reset()`
     * is called (sticky, not one-shot; 0155 R2).
     * @param result - Overridden result object.
     */
    public setNextResult(result: Result): void {
        this.nextResult = result;
    }

    /**
     * Executes a simulated publish call, recording the payload offline.
     * @param payload - Target content and options.
     * @param defaultResult - The fake's own default `Result` used when no override is set.
     * @returns A promise resolving to the sticky override or the provided default.
     */
    public async publish(payload: PublishTransportPayload, defaultResult: Result): Promise<Result> {
        this.callLogs.push({
            timestamp: new Date().toISOString(),
            payload,
        });
        return this.nextResult ?? defaultResult;
    }

    /**
     * Returns all in-memory recorded call log entries.
     */
    public getCallLogs(): readonly FakeCallLogEntry[] {
        return this.callLogs;
    }

    /**
     * Clears all in-memory recorded call logs and custom result overrides.
     */
    public reset(): void {
        this.callLogs = [];
        this.nextResult = undefined;
    }
}

/**
 * Fake File/CLI publish transport for offline unit testing without side effects.
 */
export class FakeFileCliTransport implements PublishTransport {
    public readonly kind = 'file-cli';
    private readonly core = new FakeTransportCore();

    /**
     * Configures the result returned by **every** subsequent `publish()` call until
     * `reset()` is called (sticky, not one-shot; 0155 R2).
     * @param result - Overridden result object.
     */
    public setNextResult(result: Result): void {
        this.core.setNextResult(result);
    }

    /**
     * Executes a simulated file/CLI publish call, recording the payload offline.
     * @param payload - Target content and options.
     * @returns A promise resolving to a valid `Result` object.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        return this.core.publish(payload, {
            ok: true,
            target: 'fake-file-cli',
            url: 'https://example.com/published-post',
            id: 'fake-id-123',
            message: 'Published offline via FakeFileCliTransport',
        });
    }

    /**
     * Returns all in-memory recorded call log entries.
     */
    public getCallLogs(): readonly FakeCallLogEntry[] {
        return this.core.getCallLogs();
    }

    /**
     * Clears all in-memory recorded call logs and custom result overrides.
     */
    public reset(): void {
        this.core.reset();
    }
}

/**
 * Fake browser publish transport for offline unit testing without a live browser.
 */
export class FakeBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly core = new FakeTransportCore();

    /**
     * @param driver - Who would drive the real browser (`script` or `agent`).
     */
    constructor(driver: BrowserDriver = 'agent') {
        this.driver = driver;
    }

    /**
     * Configures the result returned by **every** subsequent `publish()` call until
     * `reset()` is called (sticky, not one-shot; 0155 R2).
     * @param result - Overridden result object.
     */
    public setNextResult(result: Result): void {
        this.core.setNextResult(result);
    }

    /**
     * Executes a simulated browser publish call, recording the payload offline.
     * @param payload - Target content and options.
     * @returns A promise resolving to a valid `Result` object.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        return this.core.publish(payload, {
            ok: true,
            target: 'fake-browser',
            url: 'https://example.com/browser-draft',
            id: 'fake-browser-id-123',
            message: 'Published offline via FakeBrowserTransport',
            metadata: { driver: this.driver },
        });
    }

    /**
     * Returns all in-memory recorded call log entries.
     */
    public getCallLogs(): readonly FakeCallLogEntry[] {
        return this.core.getCallLogs();
    }

    /**
     * Clears all in-memory recorded call logs and custom result overrides.
     */
    public reset(): void {
        this.core.reset();
    }
}

/**
 * Minimal locator surface `trySelectors` needs — structural so the harness
 * does not depend on Playwright at import time.
 */
export interface SelectorLocator {
    count(): Promise<number>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
}

/**
 * Minimal page surface `trySelectors` needs.
 */
export interface SelectorPage {
    locator(selector: string): { first(): SelectorLocator };
}

/**
 * Result of trying a list of selectors against a page.
 */
export interface TrySelectorsResult {
    found: boolean;
    selector: string | null;
}

/**
 * Resolves the persistent profile directory for a publish channel.
 *
 * Default: `~/.config/kk/browser-profiles/<channel>`. An explicit override
 * (env or flag) wins and is always resolved to an absolute path (0155 R7:
 * non-`~/` overrides go through `path.resolve()`). Does not create the directory.
 *
 * @param channel - Channel slug (`juejin`, `x`, …).
 * @param override - Optional absolute, relative, or `~/`-prefixed path.
 */
export function resolveBrowserProfileDir(channel: string, override?: string): string {
    if (override && override.trim().length > 0) {
        const trimmed = override.trim();
        if (trimmed.startsWith('~/')) {
            return join(homedir(), trimmed.slice(2));
        }
        return resolve(trimmed);
    }
    return join(homedir(), '.config', 'kk', 'browser-profiles', channel);
}

/**
 * Try selectors in order and return the first attached (and optionally visible) match.
 * Harvested from `@wt/web-automation` trySelectors; no Playwright import.
 *
 * The visibility check is a point-in-time read: `timeout` is forwarded to
 * `isVisible` for compatibility with the structural `SelectorLocator`, but Playwright
 * ignores it (1.55 marks the option `@deprecated`) and returns immediately.
 *
 * @param page - Page exposing `locator(sel).first()`.
 * @param selectors - CSS/text selectors to try.
 * @param options - `timeout` forwarded to each visibility check (default 2000); `visible` defaults true.
 */
export async function trySelectors(
    page: SelectorPage,
    selectors: readonly string[],
    options: { timeout?: number; visible?: boolean } = {},
): Promise<TrySelectorsResult> {
    const timeout = options.timeout ?? 2000;
    const visible = options.visible ?? true;

    for (const selector of selectors) {
        try {
            const locator = page.locator(selector).first();
            const attached = (await locator.count()) > 0;
            if (!attached) {
                continue;
            }
            if (visible) {
                const isVisible = await locator.isVisible({ timeout }).catch(() => false);
                if (!isVisible) {
                    continue;
                }
            }
            return { found: true, selector };
        } catch {
            // try next
        }
    }

    return { found: false, selector: null };
}
