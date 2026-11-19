/**
 * The `music` noun (task 0401 R1/R5; design `docs/design/music-gen.md` §6).
 *
 * Seven verbs over the `music-gen` plugin: `render`, `presets`, `gen`, `library`,
 * `analyze`, `check`, `master`. Each verb resolves the plugin configuration
 * (`music:` in the kk user config + `KK_MUSIC_*` overrides), delegates to the
 * plugin function that owns the behaviour, and emits one stable payload — JSON on
 * `--json`, operator lines otherwise. `gen` and `analyze` are the paid verbs and
 * say so in their help line and in the payload's `paid` flag (R5).
 *
 * Output goes through the repo's `CommandOutput` seam (`consoleOutput`), never
 * `console.*`; nothing here spawns a process — `check`/`master` reach ffmpeg
 * through the plugin's `AudioToolRunner`, which defaults to the sanctioned
 * `ProcessExecutor` seam inside the plugin.
 */
import type { Command } from 'commander';
import { isVerbose, musicFailure, musicSeams, writeConfigReport } from './runtime';
import {
    checkExitCode,
    type MusicPayload,
    runAnalyze,
    runCheck,
    runGen,
    runLibrary,
    runMaster,
    runPresets,
    runRender,
    type VerbContext,
    type VerbOptions,
} from './verbs';

/** Resolve the config, report it under `--verbose`, run the body, map failures. */
async function execute(
    verb: string,
    options: VerbOptions,
    command: Command,
    body: (context: VerbContext) => Promise<MusicPayload>,
): Promise<void> {
    const commandLine = command.optsWithGlobals();
    void commandLine;
    const configPath = musicSeams.configPath();
    let config: Awaited<ReturnType<typeof musicSeams.resolveConfig>>;
    try {
        config = await musicSeams.resolveConfig();
    } catch (error) {
        musicFailure(verb, error, configPath);
    }
    if (isVerbose(command)) {
        writeConfigReport(config, configPath);
    }
    let payload: MusicPayload;
    try {
        payload = await body({ config, json: options.json === true });
    } catch (error) {
        musicFailure(verb, error, configPath);
    }
    if (verb === 'check' && checkExitCode(payload) !== 0) {
        // 0405 R2: the verdict is the exit code, and the rows already explained it on stdout.
        musicFailure(
            verb,
            Object.assign(new Error('music check: at least one check failed'), { exitCode: checkExitCode(payload) }),
            configPath,
        );
    }
}

/** Register the `music` command group and its seven verbs. */
export function registerMusicCommand(program: Command): void {
    const music = program
        .command('music')
        // Kept to one line: a wrapped description line is indistinguishable from a
        // command to `kk --help`'s noun parser (the A22 surface test).
        .description('Music generation over the music-gen plugin (gen/analyze paid)');
    const json = (cmd: Command): Command => cmd.option('--json', 'emit the verb’s stable JSON payload');

    json(
        music
            .command('render')
            .description(
                'resolve a brief through the presets and print its prompt + request (free — no instance traffic)',
            )
            .requiredOption('--in <brief.yaml>', 'YAML music brief (0397 authoring form)')
            .option('--out <path>', 'write the rendered prompt text to this file')
            .option('--root <dir>', 'preset root override (tests/probes; defaults to the shipped presets)'),
    ).action(async (options: VerbOptions & { in: string; out?: string; root?: string }, command: Command) => {
        await execute('render', options, command, async (context) => await runRender(options, context));
    });

    json(
        music
            .command('presets')
            .description(
                'list the shipped format and theme presets with their evidence status (free — no instance traffic)',
            )
            .option('--root <dir>', 'preset root override (tests/probes; defaults to the shipped presets)'),
    ).action(async (options: VerbOptions & { root?: string }, command: Command) => {
        await execute('presets', options, command, async (context) => await runPresets(options, context));
    });

    json(
        music
            .command('gen')
            .description('generate takes from a brief behind the spend guard (PAID — needs --yes)')
            .requiredOption('--in <brief.yaml>', 'YAML music brief (0397 authoring form)')
            .requiredOption('--out <content.json>', 'generator Content output; takes land beside it')
            .option('--takes <n>', 'takes to request (bounded by music.takesCap, never above 4)')
            .option('--yes', 'confirm the paid call (the 0400 gate)')
            .option('--estimate-only', 'print the cost and stop — no socket, no artifact (exit 0)')
            .option('--force', 'accept a paid re-send of an already-paid take')
            .option('--reason <text>', 'why --force was passed; recorded in the sidecar')
            .option('--stem <slug>', 'artifact slug override (default: the brief title)'),
    ).action(
        async (
            options: VerbOptions & {
                in: string;
                out: string;
                takes?: string;
                yes?: boolean;
                estimateOnly?: boolean;
                force?: boolean;
                reason?: string;
                stem?: string;
            },
            command: Command,
        ) => {
            await execute('gen', options, command, async (context) => await runGen(options, context));
        },
    );

    json(
        music
            .command('library')
            .description('list the instance’s own take library (free — read-only GET /api/generations)'),
    ).action(async (options: VerbOptions, command: Command) => {
        await execute('library', options, command, async (context) => await runLibrary(options, context));
    });

    json(
        music
            .command('analyze <instanceId>')
            .description('analyze one take on the instance (PAID — needs --yes)')
            .option('--yes', 'confirm the paid call (the 0400 gate)')
            .option('--model <model>', 'model recorded on the take (display and estimate only)'),
    ).action(async (instanceId: string, options: VerbOptions & { yes?: boolean; model?: string }, command: Command) => {
        await execute('analyze', options, command, async (context) => await runAnalyze(instanceId, options, context));
    });

    json(
        music
            .command('check <take>')
            .description('measure a take and write <take>.checks.json (free — local ffmpeg/ffprobe only)')
            .option('--model <model>', 'pro|clip (default: the take sidecar’s model)')
            .option('--duration-target <m:ss>', 'the brief’s duration target (default: the take sidecar’s)')
            .option('--style <text>', 'the brief’s style prose, for the warn-only agreement checks')
            .option('--sections <n>', 'the brief’s structure length, for the section-count check'),
    ).action(
        async (
            take: string,
            options: VerbOptions & { model?: string; durationTarget?: string; style?: string; sections?: string },
            command: Command,
        ) => {
            await execute('check', options, command, async (context) => await runCheck(take, options, context));
        },
    );

    json(
        music
            .command('master <take>')
            .description('loudness-normalize a take to a delivery profile (free — local ffmpeg only)')
            .option('--profile <name>', 'delivery profile (default: streaming; define more in music.delivery)')
            .option('--out <path>', 'output path override (default: <take>.<profile>.<container>)'),
    ).action(async (take: string, options: VerbOptions & { profile?: string; out?: string }, command: Command) => {
        await execute('master', options, command, async (context) => await runMaster(take, options, context));
    });
}
