import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineInstance, InstanceError, type MusicInstance } from '@gobing-ai/music-gen';
import { createProgram } from '../../src/cli';
import { musicSeams } from '../../src/commands/music/runtime';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

/**
 * `kk music` at the CLI level (task 0401 AC1–AC5).
 *
 * Everything is asserted through `main()` and the ts-utils output seam, never by
 * calling the verb bodies directly: AC1/AC5 are about the registered surface, and
 * AC4 is about what `--json` puts on stdout. The adapter and the ffmpeg runner are
 * the plugin's own seams, so a free verb can be proven not to build a client and a
 * check/master run needs no ffmpeg binary.
 */

const PRESETS = join(import.meta.dir, '../../../../plugins/generations/music-gen/presets');
const AUDIO_FIXTURES = join(import.meta.dir, '../../../../plugins/generations/music-gen/tests/fixtures/audio');
const CLIP_BRIEF = join(PRESETS, '..', 'tests', 'fixtures', 'clip', 'brief.yaml');
const INSTRUMENTAL_BRIEF = join(PRESETS, '..', 'tests', 'fixtures', 'instrumental', 'brief.yaml');

interface Ran {
    code: number;
    out: string;
    err: string;
}

/** Run `kk` with the output seam captured. */
async function run(args: string[]): Promise<Ran> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'test', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

/** Parse the JSON payload a verb printed. */
function payload(run: Ran): Record<string, unknown> {
    return JSON.parse(run.out) as Record<string, unknown>;
}

const ORIGINAL = { ...musicSeams };
let dir: string;
let configPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kk-music-cli-'));
    configPath = join(dir, 'config.yaml');
    writeFileSync(configPath, 'music:\n  takesCap: 2\n  defaultModel: pro\n');
    process.env.KK_CONFIG = configPath;
});

afterEach(() => {
    musicSeams.createClient = ORIGINAL.createClient;
    musicSeams.resolveConfig = ORIGINAL.resolveConfig;
    musicSeams.configPath = ORIGINAL.configPath;
    delete musicSeams.audioRunner;
    delete process.env.KK_CONFIG;
    delete process.env.KK_MUSIC_DRY_RUN;
    delete process.env.KK_MUSIC_INSTANCE_URL;
    delete process.env.KK_MUSIC_DEFAULT_MODEL;
    delete process.env.KK_MUSIC_TIMEOUT_MS;
    rmSync(dir, { recursive: true, force: true });
});

describe('AC1 — the noun is registered on the shared surface', () => {
    it('registers render, gen, library, analyze, check, master and presets with their arguments', () => {
        const program = createProgram();
        const music = program.commands.find((command) => command.name() === 'music');
        expect(music?.commands.map((command) => command.name()).sort()).toEqual([
            'analyze',
            'check',
            'gen',
            'library',
            'master',
            'presets',
            'render',
        ]);
        // A22 R1: two command words and an action — `presets` is the listing verb, not a group.
        const presets = music?.commands.find((command) => command.name() === 'presets');
        expect(presets?.commands).toEqual([]);
        const analyze = music?.commands.find((command) => command.name() === 'analyze');
        expect(analyze?.registeredArguments.map((argument) => argument.name())).toEqual(['instanceId']);
        const master = music?.commands.find((command) => command.name() === 'master');
        expect(master?.registeredArguments.map((argument) => argument.name())).toEqual(['take']);
    });

    it('kk music --help marks gen and analyze paid and the rest free (AC5)', async () => {
        const { out } = await run(['music', '--help']);
        expect(out).toContain('gen [options]');
        expect(out).toContain('PAID');
        expect(out).toContain('analyze [options] <instanceId>');
        const paidLines = out.split('\n').filter((line) => line.includes('PAID'));
        expect(paidLines).toHaveLength(2);
        expect(out).toContain('free');
    });

    it('gen and analyze refuse without --yes through the 0400 guard', async () => {
        process.env.KK_MUSIC_DRY_RUN = '1';
        const gen = await run(['music', 'gen', '--in', CLIP_BRIEF, '--out', join(dir, 'content.json'), '--json']);
        expect(gen.code).not.toBe(0);
        expect(gen.err).toContain('--yes');
        const analyze = await run(['music', 'analyze', 'offline-take-1', '--json']);
        expect(analyze.code).not.toBe(0);
        expect(analyze.err).toContain('--yes');
    });
});

describe('AC2 — config comes from the user root with an env override', () => {
    it('reports the winning layer per key under --verbose, env above config', async () => {
        process.env.KK_MUSIC_INSTANCE_URL = 'http://env-host:9999';
        process.env.KK_MUSIC_DEFAULT_MODEL = 'clip';
        const { out, code } = await run(['--verbose', 'music', 'presets']);
        expect(code).toBe(0);
        expect(out).toContain(`music.config = ${configPath}`);
        expect(out).toContain('music.baseUrl = http://env-host:9999 (env)');
        expect(out).toContain('music.defaultModel = clip (env)');
        expect(out).toContain('music.takesCap = 2 (config)');
        expect(out).toContain('music.timeoutMs = 180000 (default)');
    });

    it('uses the documented defaults when there is no config and no override', async () => {
        delete process.env.KK_CONFIG;
        const { out } = await run(['--verbose', 'music', 'presets']);
        expect(out).toContain('music.baseUrl = http://127.0.0.1:3000 (default)');
        expect(out).toContain('music.defaultModel = pro (default)');
    });

    it('rejects takesCap above 4 at load, naming the key', async () => {
        writeFileSync(configPath, 'music:\n  takesCap: 5\n');
        const { code, err } = await run(['music', 'presets']);
        expect(code).not.toBe(0);
        expect(err).toContain('music.takesCap');
        expect(err.trim().split('\n')).toHaveLength(1);
    });

    it('an unreachable endpoint yields one line naming music.baseUrl', async () => {
        musicSeams.createClient = () =>
            ({
                listGenerations: () =>
                    Promise.reject(
                        new InstanceError({
                            kind: 'connect',
                            detail: 'refused every connection',
                            endpoint: 'http://x.invalid/api/generations',
                            attempts: 3,
                            elapsedMs: 12,
                            remediation: 'start the instance',
                        }),
                    ),
            }) as unknown as MusicInstance;
        const { code, err } = await run(['music', 'library']);
        expect(code).toBe(1);
        const lines = err.trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('music.baseUrl');
        expect(lines[0]).toContain('KK_MUSIC_INSTANCE_URL');
        expect(lines[0]).toContain(configPath);
    });
});

describe('AC3 — free verbs never reach the instance', () => {
    it('render, presets, check and master succeed with the instance down and no client built', async () => {
        let built = 0;
        musicSeams.createClient = () => {
            built += 1;
            throw new Error('a free verb must not build an adapter');
        };
        process.env.KK_MUSIC_INSTANCE_URL = 'http://127.0.0.1:9';
        const take = join(dir, 'take.wav');
        writeFileSync(take, 'take-bytes');
        writeFileSync(
            `${take}.take.json`,
            JSON.stringify({ instanceId: 'take-1', model: 'pro', digest: 'a'.repeat(64) }),
        );
        musicSeams.audioRunner = fakeAudioRunner();

        const render = await run(['music', 'render', '--in', INSTRUMENTAL_BRIEF, '--json']);
        expect(render.code).toBe(0);
        expect(payload(render).paid).toBe(false);

        const presets = await run(['music', 'presets', '--json']);
        expect(presets.code).toBe(0);

        const check = await run(['music', 'check', take, '--json']);
        // The 0405 fixture take has 2 s of leading silence, so the verdict is a fail:
        // the verb still ran, and the payload explains which row failed.
        expect(check.code).toBe(1);
        expect(payload(check).checks).toBeDefined();

        const master = await run(['music', 'master', take, '--json']);
        expect(payload(master).artifactPath).toContain('.streaming.wav');
        expect(built).toBe(0);
    });
});

describe('AC4 — JSON output is stable and complete', () => {
    it('render carries prompt, request and digest with the paid/free envelope', async () => {
        const { code, out } = await run(['music', 'render', '--in', INSTRUMENTAL_BRIEF, '--json']);
        expect(code).toBe(0);
        const body = payload({ code, out, err: '' });
        expect(Object.keys(body)).toEqual([
            'verb',
            'paid',
            'dryRun',
            'artifactPath',
            'instanceId',
            'digest',
            'spend',
            'measurements',
            'checks',
            'brief',
            'prompt',
            'request',
            'explain',
        ]);
        expect(body.verb).toBe('render');
        expect(body.paid).toBe(false);
        expect(body.artifactPath).toBeNull();
        expect(body.spend).toBeNull();
        expect(body.digest).toMatch(/^[0-9a-f]{64}$/);
        expect((body.request as Record<string, unknown>).durationTarget).toBe('0:45');
        expect(body.prompt as string).toContain('Instrumental only — no vocals.');
    });

    it('gen in dry-run carries artifact path, instance id, digest, paid and spend', async () => {
        process.env.KK_MUSIC_DRY_RUN = '1';
        const out = join(dir, 'content.json');
        const ran = await run(['music', 'gen', '--in', CLIP_BRIEF, '--out', out, '--yes', '--json']);
        expect(ran.code).toBe(0);
        const body = payload(ran);
        expect(body).toMatchObject({
            verb: 'gen',
            paid: true,
            dryRun: true,
            artifactPath: out,
            instanceId: 'offline-take-1',
            spend: { currency: 'USD', takes: 1, unitPrice: 0.04, total: 0.04 },
            measurements: null,
            checks: null,
        });
        expect(body.digest).toMatch(/^[0-9a-f]{64}$/);
        const takes = body.takes as Array<Record<string, unknown>>;
        expect(takes[0]?.artifactPath).toContain('lofi-loop-sketch-clip-offline-take-1.wav');
    });

    it('analyze in dry-run reports the analysis and the charged flag', async () => {
        // One offline adapter for both verbs, so analyze sees the take gen just made.
        const offline = createOfflineInstance();
        musicSeams.createClient = () => offline;
        const generated = await run(['music', 'gen', '--in', CLIP_BRIEF, '--out', join(dir, 'c.json'), '--yes']);
        expect(generated.code).toBe(0);
        const ran = await run(['music', 'analyze', 'offline-take-1', '--yes', '--json']);
        expect(ran.code).toBe(0);
        const body = payload(ran);
        expect(body).toMatchObject({ verb: 'analyze', paid: true, instanceId: 'offline-take-1', cached: true });
        expect(body.spend).toMatchObject({ unitPrice: null, takes: 1 });
        expect(body.analysis).toBeDefined();
    });

    it('check carries measurements and check rows', async () => {
        const take = join(dir, 'take.wav');
        writeFileSync(take, 'take-bytes');
        writeFileSync(
            `${take}.take.json`,
            JSON.stringify({ instanceId: 'take-7', model: 'pro', digest: 'b'.repeat(64), durationTarget: '0:34' }),
        );
        musicSeams.audioRunner = fakeAudioRunner();
        const ran = await run(['music', 'check', take, '--json']);
        const body = payload(ran);
        expect(body).toMatchObject({ verb: 'check', paid: false, artifactPath: take, instanceId: 'take-7' });
        expect(body.measurements).toMatchObject({ probe: { durationSeconds: 34, sampleRate: 48_000 } });
        const rows = body.checks as Array<Record<string, unknown>>;
        expect(rows.map((row) => row.id)).toContain('duration.target');
        expect(rows.every((row) => typeof row.source === 'string')).toBe(true);
    });

    it('master carries the delivered file, profile and delivery rows', async () => {
        const take = join(dir, 'take.wav');
        writeFileSync(take, 'take-bytes');
        musicSeams.audioRunner = fakeAudioRunner();
        const ran = await run(['music', 'master', take, '--json']);
        expect(ran.code).toBe(0);
        const body = payload(ran);
        expect(body).toMatchObject({
            verb: 'master',
            paid: false,
            artifactPath: join(dir, 'take.streaming.wav'),
            profile: { name: 'streaming', lufs: -14, truePeak: -1, container: 'wav', sampleRate: 44_100 },
        });
        expect((body.checks as Array<Record<string, unknown>>).map((row) => row.id)).toContain(
            'delivery.integrated_loudness',
        );
        expect(body.measurements).toMatchObject({ loudness: { integratedLufs: -14 } });
    });
});

describe('AC5 — help and plugin check agree', () => {
    it('the plugin manifest declares the ffmpeg/ffprobe binaries its check/master verbs spawn', () => {
        const manifest = JSON.parse(
            readFileSync(join(import.meta.dir, '../../../../plugins/generations/music-gen/plugin.json'), 'utf8'),
        ) as { runtime: { requires: string[] } };
        expect(manifest.runtime.requires).toContain('ffmpeg');
        expect(manifest.runtime.requires).toContain('ffprobe');
    });
});

/**
 * Replay the captured 0405 fixtures: no test spawns ffmpeg, so CI needs none.
 * The pass-2 master call writes the bytes the measurement then reads.
 */
function fakeAudioRunner() {
    const read = (name: string): string => readFileSync(join(AUDIO_FIXTURES, name), 'utf8');
    // Queues: the take is measured once, the mastered output a second time.
    const probes = ['ffprobe-take.json', 'ffprobe-mastered.json'];
    const loudness = ['loudnorm-take.txt', 'loudnorm-delivery.txt'];
    let probeCalls = 0;
    let loudnessCalls = 0;
    const next = (queue: string[], index: number): string => queue[Math.min(index, queue.length - 1)] ?? '';
    return async (argv: readonly string[]) => {
        const bin = argv[0] ?? '';
        if (argv.includes('-version')) {
            return {
                exitCode: 0,
                stdout: bin.includes('probe') ? 'ffprobe version 8.1.2\n' : 'ffmpeg version 8.1.2\n',
                stderr: '',
            };
        }
        if (bin.includes('probe')) {
            // A mastered output is 44.1 kHz; the provider take is 48 kHz.
            const target = argv[argv.length - 1] ?? '';
            const fixture = target.includes('.streaming.') ? 'ffprobe-mastered.json' : next(probes, probeCalls);
            probeCalls += 1;
            return { exitCode: 0, stdout: read(fixture), stderr: '' };
        }
        const filter = argv.includes('-af') ? (argv[argv.indexOf('-af') + 1] ?? '') : '';
        if (filter.includes('silencedetect')) {
            return { exitCode: 0, stdout: '', stderr: read('silencedetect-take.txt') };
        }
        if (filter.includes('loudnorm=print_format=json')) {
            const fixture = next(loudness, loudnessCalls);
            loudnessCalls += 1;
            return { exitCode: 0, stdout: '', stderr: read(fixture) };
        }
        // The single pass-2 write: the mastered file the delivery check then measures.
        writeFileSync(argv[argv.length - 1] ?? '', 'mastered-bytes');
        return { exitCode: 0, stdout: '', stderr: '' };
    };
}
