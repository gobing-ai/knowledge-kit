/**
 * `kk music` runtime seams (task 0401 R2/R4).
 *
 * Every verb resolves configuration through the plugin's one reader
 * (`resolveMusicConfig`) and builds its adapter through `createMusicInstance`, so
 * the CLI owns no endpoint, no price and no timeout of its own. Both are exposed
 * on {@link musicSeams} because a CLI-level test must be able to prove that a
 * *free* verb never builds a client, and must replay ffmpeg output instead of
 * requiring the binary (the 0405 harness precedent).
 */
import type { AudioToolRunner } from '@gobing-ai/music-gen';
import {
    createMusicInstance,
    InstanceError,
    MusicConfigError,
    type MusicInstance,
    type ResolvedMusicConfig,
    resolveMusicConfig,
    resolveMusicConfigPath,
} from '@gobing-ai/music-gen';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { consoleOutput } from '../../output';

/** Everything a verb borrows from the process boundary. */
export interface MusicSeams {
    /** The plugin's config reader (`music:` block + `KK_MUSIC_*` overrides). */
    resolveConfig: () => Promise<ResolvedMusicConfig>;
    /** The adapter factory; `dryRun` config yields the offline adapter, unchanged. */
    createClient: (config: ResolvedMusicConfig) => MusicInstance;
    /** `ffmpeg`/`ffprobe` runner for `check`/`master`; absent = the plugin's real spawn. */
    audioRunner?: AudioToolRunner;
    /** The config file the resolved values came from (named in every remediation). */
    configPath: () => string;
    /**
     * File IO for everything a verb body reads or writes itself — the brief, the
     * `<take>.take.json` probe, the `--out` prompt write and the `gen` staging file
     * (rule `no-direct-fs-io`: `node:fs` is never imported). A test can point it at a
     * temp root instead of standing up real files.
     */
    fileSystem: FileSystem;
}

/** The production seams. Tests replace members and restore them afterwards. */
export const musicSeams: MusicSeams = {
    resolveConfig: () => resolveMusicConfig(),
    createClient: (config) => createMusicInstance(config),
    configPath: () => resolveMusicConfigPath(process.env),
    fileSystem: createNodeFileSystem(),
};

/** Collapse any diagnostic to the one line a remediation is allowed to occupy. */
function oneLine(message: string): string {
    return message.split('\n')[0]?.trim() ?? message;
}

/** Print a diagnostic and fail with the exit code the caller owns. */
function fail(code: number, id: string, message: string): never {
    consoleOutput.error(message);
    throw new CommanderError(code, id, message);
}

/**
 * Map a plugin error onto the CLI's exit contract, one line on stderr.
 *
 * Exit 2 is usage/config; exit 1 is a verb that ran and could not finish. An
 * unreachable instance and an ambiguous paid call name the config key that
 * resolves them (`music.baseUrl` / `KK_MUSIC_INSTANCE_URL`) plus the config file,
 * because that is the only actionable thing in either case.
 */
export function musicFailure(verb: string, error: unknown, configPath: string): never {
    if (error instanceof CommanderError) {
        throw error;
    }
    if (error instanceof MusicConfigError) {
        fail(2, `kk.music.${verb}.config`, `${error.message} (config: ${configPath})`);
    }
    if (error instanceof InstanceError) {
        if (error.kind === 'connect') {
            fail(
                1,
                'kk.music.unreachable',
                `music.baseUrl (or KK_MUSIC_INSTANCE_URL) at ${error.endpoint} is unreachable — start the instance or fix the key in ${configPath}; nothing was billed`,
            );
        }
        fail(1, `kk.music.${verb}.instance`, oneLine(`music.baseUrl at ${error.endpoint}: ${error.message}`));
    }
    const message = error instanceof Error ? error.message : String(error);
    const seen = error as { exitCode?: unknown };
    const code = typeof seen.exitCode === 'number' ? seen.exitCode : 1;
    fail(code, `kk.music.${verb}.failed`, oneLine(message));
}

/** The `--verbose` configuration report (AC2: the winning layer is named per key). */
export function writeConfigReport(config: ResolvedMusicConfig, configPath: string): void {
    const { sources } = config;
    const prices = config.prices;
    const lines = [
        `music.config = ${configPath}`,
        `music.baseUrl = ${config.baseUrl} (${sources.baseUrl})`,
        `music.timeoutMs = ${String(config.timeoutMs)} (${sources.timeoutMs})`,
        `music.connectTimeoutMs = ${String(config.connectTimeoutMs)} (${sources.connectTimeoutMs})`,
        `music.defaultModel = ${config.defaultModel} (${sources.defaultModel})`,
        `music.takesCap = ${String(config.takesCap)} (${sources.takesCap})`,
        `music.prices = pro ${String(prices.pro)} / clip ${String(prices.clip)} / analyze ${
            prices.analyze === null ? 'unpriced' : String(prices.analyze)
        } (${sources.prices})`,
        `music.dryRun = ${String(config.dryRun)} (${sources.dryRun})`,
    ];
    for (const line of lines) {
        consoleOutput.write(line);
    }
}

/** Program-level `--verbose`, read through any nesting level. */
export function isVerbose(command: Command): boolean {
    const globals = command.optsWithGlobals() as { verbose?: unknown };
    return globals.verbose === true;
}
