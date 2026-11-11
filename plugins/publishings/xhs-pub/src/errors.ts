/**
 * Typed publish failures (task 0350), mirroring the vendor-proven
 * `vendors/xiaohongshu-skills/scripts/xhs/errors.py` mapping. The flows THROW these; the
 * transport's catch turns `error.message` into the failed Result, so every message names its
 * class — the Result error string is what callers and tiers match on.
 */
export class PublishError extends Error {
    override name = 'PublishError';
    constructor(message: string) {
        super(message);
    }
}

/** The server refused the note for account-level risk control (−913x / 禁止发笔记) — not retryable. */
export class AccountRiskControlError extends PublishError {
    override name = 'AccountRiskControlError';
}

/** The platform's own counter says the title exceeds its limit. */
export class TitleTooLongError extends PublishError {
    override name = 'TitleTooLongError';
}

/** The platform's own counter says the body exceeds its limit. */
export class ContentTooLongError extends PublishError {
    override name = 'ContentTooLongError';
}

/** A just-saved draft failed its post-save reopen verification (slots/srcs/fields). */
export class DraftVerifyError extends PublishError {
    override name = 'DraftVerifyError';
}
