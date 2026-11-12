/**
 * Typed publish failures (task 0350), mirroring the vendor-proven
 * `vendors/xiaohongshu-skills/scripts/xhs/errors.py` mapping. The flows THROW these; the
 * transport's catch turns `error.message` into the failed Result, so every message names its
 * class — the Result error string is what callers and tiers match on.
 *
 * Name assignment lives in constructor bodies, not field initializers: bun's coverage counts
 * each initializer as an unattributable function, which would pin this file below the 90%
 * per-file function threshold.
 */
export class PublishError extends Error {
    override name: string;
    constructor(message: string, name = 'PublishError') {
        super(message);
        this.name = name;
    }
}

/** The server refused the note for account-level risk control (−913x / 禁止发笔记) — not retryable. */
export class AccountRiskControlError extends PublishError {
    constructor(message: string) {
        super(message, 'AccountRiskControlError');
    }
}

/** The platform's own counter says the title exceeds its limit. */
export class TitleTooLongError extends PublishError {
    constructor(message: string) {
        super(message, 'TitleTooLongError');
    }
}

/** The platform's own counter says the body exceeds its limit. */
export class ContentTooLongError extends PublishError {
    constructor(message: string) {
        super(message, 'ContentTooLongError');
    }
}

/** A just-saved draft failed its post-save reopen verification (slots/srcs/fields). */
export class DraftVerifyError extends PublishError {
    constructor(message: string) {
        super(message, 'DraftVerifyError');
    }
}
