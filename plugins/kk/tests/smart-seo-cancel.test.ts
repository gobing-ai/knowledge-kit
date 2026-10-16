import { afterEach, describe, expect, it } from 'bun:test';
import {
    assertSeoNotCancelled,
    installSeoStageCancellation,
    onSeoCancel,
    resetSeoStageCancellation,
    SeoStageCancelledError,
    seoCancelledSignal,
    seoSignalExitCode,
} from '../scripts/seo-fetch';

/**
 * Design §4 — a cancelled SEO stage records the first signal, stops new work and still
 * notifies every listener. Handlers are invoked directly: a real signal would hit the runner.
 */
describe('SEO stage cancellation registry', () => {
    afterEach(() => resetSeoStageCancellation());

    /** The handler this registry installed for `signal` (the listener added after `before`). */
    function installedHandler(signal: NodeJS.Signals, before: ReturnType<typeof process.listeners>): () => void {
        const added = process.listeners(signal).filter((l) => !before.includes(l));
        expect(added).toHaveLength(1);
        return added[0] as () => void;
    }

    it('records the first signal, notifies every listener despite a throwing one, and ignores later signals', () => {
        const before = { term: process.listeners('SIGTERM'), int: process.listeners('SIGINT') };
        const seen: string[] = [];
        installSeoStageCancellation();
        onSeoCancel(() => {
            throw new Error('listener failure');
        });
        onSeoCancel((signal) => seen.push(signal));

        expect(seoCancelledSignal()).toBeNull();
        expect(() => assertSeoNotCancelled()).not.toThrow();

        installedHandler('SIGTERM', before.term)();
        installedHandler('SIGINT', before.int)();
        expect(seoCancelledSignal()).toBe('SIGTERM');
        expect(seen).toEqual(['SIGTERM']);
        expect(() => assertSeoNotCancelled()).toThrow(SeoStageCancelledError);
        expect(() => assertSeoNotCancelled()).toThrow('seo stage cancelled by SIGTERM');
    });

    it('removes its process handlers once the last listener is disposed', () => {
        const before = process.listeners('SIGHUP').length;
        const a = onSeoCancel(() => {});
        const b = onSeoCancel(() => {});
        expect(process.listeners('SIGHUP').length).toBe(before + 1);
        a();
        expect(process.listeners('SIGHUP').length).toBe(before + 1);
        b();
        expect(process.listeners('SIGHUP').length).toBe(before);
    });

    it('maps signals to conventional exit codes and names the detail', () => {
        expect(seoSignalExitCode('SIGINT')).toBe(130);
        expect(seoSignalExitCode('SIGTERM')).toBe(143);
        expect(seoSignalExitCode('SIGHUP')).toBe(129);
        expect(seoSignalExitCode('SIGUSR1')).toBe(1);
        const err = new SeoStageCancelledError('SIGINT', 'mid-fetch');
        expect(err.message).toBe('seo stage cancelled by SIGINT: mid-fetch');
        expect(err.name).toBe('SeoStageCancelledError');
        expect(err.signal).toBe('SIGINT');
    });
});
