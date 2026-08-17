import { describe, expect, it } from 'bun:test';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { consoleOutput, toJson } from '../src/output';

/** Capture ts-utils echo/echoError into buffers, returning a rollback. */
function capture(): {
    out: ReturnType<typeof createBufferTarget>;
    err: ReturnType<typeof createBufferTarget>;
    restore: () => void;
} {
    const out = createBufferTarget();
    const err = createBufferTarget();
    const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
    return { out, err, restore };
}

describe('consoleOutput', () => {
    it('write strips one existing trailing newline, then echo re-adds one (byte-identity)', () => {
        const { out, restore } = capture();
        try {
            // Commander help text ends with \n; legacy logger.out wrote it verbatim (no append).
            consoleOutput.write('Usage: kk [options]\n');
            expect(out.text()).toBe('Usage: kk [options]\n');
        } finally {
            restore();
        }
    });

    it('write adds exactly one newline when the message has none', () => {
        const { out, restore } = capture();
        try {
            consoleOutput.write('data');
            expect(out.text()).toBe('data\n');
        } finally {
            restore();
        }
    });

    it('error keeps a trailing newline the message already carries (commander error text + legacy append)', () => {
        const { err, restore } = capture();
        try {
            // Baseline: commander passes "error: unknown command 'x'\n" and legacy
            // logger.error appended one more → stderr ends "\n\n". echoError(message)
            // must not strip, or byte-identity breaks.
            consoleOutput.error("error: unknown command 'x'\n");
            expect(err.text()).toBe("error: unknown command 'x'\n\n");
        } finally {
            restore();
        }
    });

    it('error adds one newline for a message without one', () => {
        const { err, restore } = capture();
        try {
            consoleOutput.error('boom');
            expect(err.text()).toBe('boom\n');
        } finally {
            restore();
        }
    });
});

describe('toJson', () => {
    it('stringifies with 2-space indentation', () => {
        expect(toJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
});
