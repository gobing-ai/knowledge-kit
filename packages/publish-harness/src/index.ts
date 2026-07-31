import type { Content, Result } from '@gobing-ai/kk-core';

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
 * Common interface for publish transports (`file-cli` vs `browser`).
 */
export interface PublishTransport {
    /** Transport mechanism classification. */
    kind: 'file-cli' | 'browser';
    /** Executes a publish operation given a transport payload. */
    publish(payload: PublishTransportPayload): Promise<Result>;
}

/**
 * In-memory recorded call log entry captured by {@link FakeFileCliTransport}.
 */
export interface FakeCallLogEntry {
    /** Timestamp when the call was captured. */
    timestamp: string;
    /** Payload supplied to the publish call. */
    payload: PublishTransportPayload;
}

/**
 * Fake File/CLI publish transport for offline unit testing without side effects.
 */
export class FakeFileCliTransport implements PublishTransport {
    public readonly kind = 'file-cli';
    private callLogs: FakeCallLogEntry[];
    private nextResult?: Result;

    constructor() {
        this.callLogs = [];
    }

    /**
     * Configures the result to return on the next publish invocation.
     * @param result - Overridden result object.
     */
    public setNextResult(result: Result): void {
        this.nextResult = result;
    }

    /**
     * Executes a simulated publish call, recording the payload offline.
     * @param payload - Target content and options.
     * @returns A promise resolving to a valid `Result` object.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        this.callLogs.push({
            timestamp: new Date().toISOString(),
            payload,
        });

        if (this.nextResult) {
            return this.nextResult;
        }

        return {
            ok: true,
            target: 'fake-file-cli',
            url: 'https://example.com/published-post',
            id: 'fake-id-123',
            message: 'Published offline via FakeFileCliTransport',
        };
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
