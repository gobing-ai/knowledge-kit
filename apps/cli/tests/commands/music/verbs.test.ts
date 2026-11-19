import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    type AudioToolRunner,
    createOfflineInstance,
    type MusicInstance,
    type ResolvedMusicConfig,
    resolveMusicConfig,
} from '@gobing-ai/music-gen';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { musicSeams } from '../../../src/commands/music/runtime';
import { runCheck, runGen, runRender } from '../../../src/commands/music/verbs';
import { captureOutput } from '../../capture';

/**
 * The verb bodies on their own (task 0401 R1/R4).
 *
 * `apps/cli/tests/commands/music.test.ts` is the AC-level suite: it drives `main()`
 * and asserts the registered surface and the JSON payloads. This file holds what a
 * verb body owns *itself* and would otherwise only be provable by accident:
 *
 *   1. the `<take>.take.json` probe is a predicate — a missing sidecar is a `null`,
 *      not an error (the failure mode a `readFile`-first implementation would have);
 *   2. the prompt `--out` write goes through `musicSeams.fileSystem`, not `node:fs`,
 *      so a caller can point the verbs at a chosen root (rule `no-direct-fs-io`);
 *   3. the `gen` staging DocList is written *and* removed through that same seam —
 *      a run directory keeps only real artifacts;
 *   4. every verb answers with the one envelope, in one key order.
 */

const PLUGIN_ROOT = join(import.meta.dir, '../../../../../plugins/generations/music-gen');
const AUDIO_FIXTURES = join(PLUGIN_ROOT, 'tests/fixtures/audio');
const CLIP_BRIEF = join(PLUGIN_ROOT, 'tests/fixtures/clip/brief.yaml');
const INSTRUMENTAL_BRIEF = join(PLUGIN_ROOT, 'tests/fixtures/instrumental/brief.yaml');

/** The envelope's nine keys, in the order {@link envelope} builds them. */
const ENVELOPE = ['verb', 'paid', 'dryRun', 'artifactPath', 'instanceId', 'digest', 'spend', 'measurements', 'checks'];

const ORIGINAL = { ...musicSeams };
let dir: string;
let config: ResolvedMusicConfig;

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kk-music-verbs-'));
    // An absent config path keeps the user's real `~/.config/kk/config.yaml` out of
    // the test: the env alone decides every value asserted here.
    config = await resolveMusicConfig({
        env: { KK_MUSIC_INSTANCE_URL: 'http://127.0.0.1:3000', KK_MUSIC_DRY_RUN: '1' },
        configPath: join(dir, 'absent-config.yaml'),
    });
});

afterEach(() => {
    musicSeams.fileSystem = ORIGINAL.fileSystem;
    musicSeams.createClient = ORIGINAL.createClient;
    delete musicSeams.audioRunner;
    rmSync(dir, { recursive: true, force: true });
});

/** Run a verb body with the output seam captured (the bodies write the payload). */
async function captured<T>(body: () => Promise<T>): Promise<T> {
    const capture = captureOutput();
    try {
        return await body();
    } finally {
        capture.restore();
    }
}

/**
 * A FileSystem that is the node backend *plus* a record of every write and delete.
 *
 * The verbs must not care which implementation they get; recording the calls is how
 * this file proves the prompt/staging IO went through the seam at all rather than
 * straight to `node:fs`.
 */
function recordingFileSystem(): { fs: FileSystem; writes: string[]; deletes: string[]; reads: string[] } {
    const node = createNodeFileSystem();
    const writes: string[] = [];
    const deletes: string[] = [];
    const reads: string[] = [];
    const fs: FileSystem = {
        ...node,
        readFile: (path) => {
            reads.push(path);
            return node.readFile(path);
        },
        writeFile: (path, content) => {
            writes.push(path);
            return node.writeFile(path, content);
        },
        deleteFile: (path) => {
            deletes.push(path);
            return node.deleteFile(path);
        },
    };
    return { fs, writes, deletes, reads };
}

/**
 * Replay the captured 0405 fixtures: `check` needs no ffmpeg, and the ordering of the
 * three tools it runs (version probe, ffprobe, then ffmpeg silencedetect/loudnorm) is
 * the plugin's, so this runner only has to answer each one.
 */
function audioRunner(): AudioToolRunner {
    const read = (name: string): string => readFileSync(join(AUDIO_FIXTURES, name), 'utf8');
    return async (argv) => {
        const bin = argv[0] ?? '';
        if (argv.includes('-version')) {
            const tool = bin.includes('probe') ? 'ffprobe' : 'ffmpeg';
            return { exitCode: 0, stdout: `${tool} version 8.1.2\n`, stderr: '' };
        }
        if (bin.includes('probe')) {
            return { exitCode: 0, stdout: read('ffprobe-take.json'), stderr: '' };
        }
        const filter = argv.includes('-af') ? (argv[argv.indexOf('-af') + 1] ?? '') : '';
        if (filter.includes('silencedetect')) {
            return { exitCode: 0, stdout: '', stderr: read('silencedetect-take.txt') };
        }
        return { exitCode: 0, stdout: '', stderr: read('loudnorm-take.txt') };
    };
}

describe('readSidecar — the take sidecar probe', () => {
    it('a missing <take>.take.json is null, never an error', async () => {
        const take = join(dir, 'take.wav');
        writeFileSync(take, 'take-bytes');
        musicSeams.audioRunner = audioRunner();

        // No sidecar on disk: the model has to come from the flag, and the two
        // sidecar-derived keys stay null instead of the verb failing outright.
        const payload = await captured(() =>
            runCheck(take, { model: 'pro', durationTarget: '0:34', json: true }, { config, json: true }),
        );

        expect(payload).toMatchObject({
            verb: 'check',
            paid: false,
            artifactPath: take,
            instanceId: null,
            digest: null,
        });
        expect((payload.checks ?? []).map((row) => row.id)).toContain('duration.target');
    });

    it('a present sidecar supplies model, instanceId and digest', async () => {
        const take = join(dir, 'take.wav');
        writeFileSync(take, 'take-bytes');
        writeFileSync(
            `${take}.take.json`,
            JSON.stringify({ instanceId: 'take-9', model: 'pro', digest: 'c'.repeat(64) }),
        );
        musicSeams.audioRunner = audioRunner();

        // No `--model`: it comes from the sidecar, so the probe is not vacuous.
        const payload = await captured(() =>
            runCheck(take, { durationTarget: '0:34', json: true }, { config, json: true }),
        );

        expect(payload.instanceId).toBe('take-9');
        expect(payload.digest).toBe('c'.repeat(64));
    });
});

describe('file IO goes through the injected FileSystem seam', () => {
    it('render writes the prompt to --out and reads the brief through the seam', async () => {
        const seam = recordingFileSystem();
        musicSeams.fileSystem = seam.fs;
        const outPath = join(dir, 'prompt.txt');

        const payload = await captured(() =>
            runRender({ in: INSTRUMENTAL_BRIEF, out: outPath, json: true }, { config, json: true }),
        );
        const body = payload as typeof payload & { prompt: string };

        expect(seam.writes).toEqual([outPath]);
        expect(seam.reads).toContain(resolve(INSTRUMENTAL_BRIEF));
        // The file on disk is exactly the payload's prompt plus its trailing newline.
        expect(readFileSync(outPath, 'utf8')).toBe(`${body.prompt}\n`);
        expect(body.prompt).toContain('Instrumental only — no vocals.');
        expect(payload.artifactPath).toBe(outPath);
    });

    it('gen stages its DocList through the seam and removes it again', async () => {
        const seam = recordingFileSystem();
        musicSeams.fileSystem = seam.fs;
        musicSeams.createClient = () => createOfflineInstance() as unknown as MusicInstance;
        const contentPath = join(dir, 'content.json');
        const stagingPath = `${contentPath}.doclist.json`;

        const payload = await captured(() =>
            runGen({ in: CLIP_BRIEF, out: contentPath, yes: true, json: true }, { config, json: true }),
        );

        expect(seam.writes).toEqual([stagingPath]);
        // Unconditional cleanup in the `finally`: the staging file is gone, the
        // artifact the plugin wrote beside it is not.
        expect(seam.deletes).toEqual([stagingPath]);
        expect(existsSync(stagingPath)).toBe(false);
        expect(existsSync(contentPath)).toBe(true);
        expect(payload.artifactPath).toBe(contentPath);
    });
});

describe('the payload envelope', () => {
    it('every verb answers with the same nine keys, extras after them', async () => {
        const payload = await captured(() => runRender({ in: INSTRUMENTAL_BRIEF, json: true }, { config, json: true }));

        expect(Object.keys(payload)).toEqual([...ENVELOPE, 'brief', 'prompt', 'request', 'explain']);
        expect(payload).toMatchObject({
            verb: 'render',
            paid: false,
            dryRun: true,
            artifactPath: null,
            instanceId: null,
            spend: null,
            measurements: null,
            checks: null,
        });
        // `digest` is the one envelope key a verb fills in without a take.
        expect(payload.digest).toMatch(/^[0-9a-f]{64}$/);
    });
});
