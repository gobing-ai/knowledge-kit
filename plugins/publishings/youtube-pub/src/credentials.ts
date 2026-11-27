import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * YouTube OAuth2 credential loading for `youtube-pub`.
 *
 * WHY `node:fs` here (the plugin's one sanctioned exemption, recorded in
 * `.spur/rules/strict/runtime-boundaries.yaml`): the ts-runtime `FileSystem` seam exposes
 * `isFile/size/mtimeMs` and no permission bits, and R3 requires refusing a credentials file wider
 * than `0600` — a mode check the seam cannot express. Everything else in this plugin reads through
 * the seam or `Bun.file`.
 */

/** Where the operator's refresh token lives (ADR-042: mission-critical config only). */
export const YOUTUBE_CREDENTIALS_PATH = '~/.config/kk/youtube-oauth.json';

/** Only the owner may hold these bits; any group/world bit makes the file unusable. */
export const REQUIRED_CREDENTIALS_MODE = 0o600;

/** The three values one upload needs. */
export interface YouTubeCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

/** Env var names that win over the credentials file (R2 order). */
export const YOUTUBE_ENV_VARS = {
    clientId: 'KK_YOUTUBE_CLIENT_ID',
    clientSecret: 'KK_YOUTUBE_CLIENT_SECRET',
    refreshToken: 'KK_YOUTUBE_REFRESH_TOKEN',
} as const;

/** Resolution seam: tests inject `env`, `home` and the file reader. */
export interface CredentialsOptions {
    env?: Record<string, string | undefined>;
    home?: string;
}

function nonEmpty(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Absolute path of the credentials file for this home directory. */
export function credentialsFilePath(home: string = homedir()): string {
    return join(home, '.config', 'kk', 'youtube-oauth.json');
}

/** The secrets a message must never carry (R5): the client secret and the refresh token. */
export function credentialSecrets(credentials: YouTubeCredentials | undefined): string[] {
    if (credentials === undefined) return [];
    return [credentials.clientSecret, credentials.refreshToken].filter((value) => value !== '');
}

/** Strip every secret — raw and percent-encoded — from a message. */
export function redact(message: string, secrets: readonly string[]): string {
    let out = message;
    for (const secret of secrets) {
        if (secret === '') continue;
        for (const form of new Set([secret, encodeURIComponent(secret)])) {
            out = out.split(form).join('***');
        }
    }
    return out;
}

/**
 * Load the credentials: env wins, else `~/.config/kk/youtube-oauth.json` at mode `0600`.
 * Returns an actionable error string instead of throwing, so the caller can refuse with zero
 * network calls (R3).
 */
export function loadYouTubeCredentials(
    options: CredentialsOptions = {},
): { credentials: YouTubeCredentials } | { error: string } {
    const env = options.env ?? (process.env as Record<string, string | undefined>);
    const fromEnv = {
        clientId: nonEmpty(env[YOUTUBE_ENV_VARS.clientId]),
        clientSecret: nonEmpty(env[YOUTUBE_ENV_VARS.clientSecret]),
        refreshToken: nonEmpty(env[YOUTUBE_ENV_VARS.refreshToken]),
    };
    if (fromEnv.clientId && fromEnv.clientSecret && fromEnv.refreshToken) {
        return {
            credentials: {
                clientId: fromEnv.clientId,
                clientSecret: fromEnv.clientSecret,
                refreshToken: fromEnv.refreshToken,
            },
        };
    }

    const path = credentialsFilePath(options.home ?? homedir());
    let stats: ReturnType<typeof statSync>;
    try {
        stats = statSync(path);
    } catch {
        return {
            error: `youtube-pub needs OAuth2 credentials: set ${YOUTUBE_ENV_VARS.clientId}/${YOUTUBE_ENV_VARS.clientSecret}/${YOUTUBE_ENV_VARS.refreshToken} or place ${YOUTUBE_CREDENTIALS_PATH} (mode 0600)`,
        };
    }
    if (!stats.isFile()) {
        return { error: `youtube-pub credentials path ${path} is not a regular file` };
    }
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) {
        return {
            error: `youtube-pub credentials file ${path} is mode ${mode.toString(8).padStart(3, '0')}; it must be 600 (chmod 600 ${path})`,
        };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    } catch {
        return {
            error: `youtube-pub credentials file ${path} is not readable JSON`,
        };
    }
    const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const clientId = nonEmpty(record.client_id);
    const clientSecret = nonEmpty(record.client_secret);
    const refreshToken = nonEmpty(record.refresh_token);
    const missing = [
        clientId === undefined ? 'client_id' : undefined,
        clientSecret === undefined ? 'client_secret' : undefined,
        refreshToken === undefined ? 'refresh_token' : undefined,
    ].filter((key): key is string => key !== undefined);
    if (missing.length > 0) {
        return { error: `youtube-pub credentials file ${path} is missing ${missing.join(', ')}` };
    }
    return {
        credentials: {
            clientId: clientId as string,
            clientSecret: clientSecret as string,
            refreshToken: refreshToken as string,
        },
    };
}
