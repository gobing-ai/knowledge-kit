import { echo, echoError } from '@gobing-ai/ts-utils';

/** Injectable terminal-output adapter for the CLI. */
export interface CommandOutput {
    write(message: string): void;
    error(message: string): void;
}

/**
 * Strip one existing trailing line ending (`\r?\n`). ts-utils `echo`/`echoError`
 * each append exactly one `\n`, so a message that already ends with one must have
 * it removed first to avoid doubling. Commander help/version text ends with `\n`;
 * legacy `logger.out` wrote it verbatim (no append) — this preserves that.
 */
function withoutFinalLineEnding(message: string): string {
    return message.replace(/\r?\n$/, '');
}

/** Standard console output binding delegating to ts-utils echo/echoError. */
export const consoleOutput: CommandOutput = {
    write(message): void {
        echo(withoutFinalLineEnding(message));
    },
    error(message): void {
        // Commander error text ALREADY ends with `\n` (e.g. "error: unknown
        // command 'x'\n"), and the legacy logger.error appended one more, so the
        // pre-migration stderr ends with `\n\n`. Byte-identity (AC R2) requires
        // echoError to keep that trailing newline — stripping here would collapse
        // the double newline to a single one. (Design-doc §2 shows a strip on
        // `error`; the commander writeErr site violates that newline assumption,
        // and per the task's own mapping rule: "fix the mapping, don't force the
        // pattern.")
        echoError(message);
    },
};

/** JSON.stringify with 2-space indentation — the data-output shape (`kk … --json`). */
export function toJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
