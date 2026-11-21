/**
 * `kk stage audio-prune` — the publish tail's WAV cleanup (measured 2026-11-20: 987 MB of lossless
 * intermediates across six daily runs, 80% of a works root that is otherwise 15 MB of MP3 a day).
 *
 * The stage runs for real against a real work dir, so the assertions are the artifact state a
 * publish tail leaves behind: intermediates gone, delivered MP3 kept, and the source kept whenever
 * the MP3 is missing (a failed transcode must not cost a paid re-synthesis).
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const runner = resolve(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');

function withWorkDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'kk-audio-prune-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const run = (args: string[]): { status: number; stdout: string; stderr: string } => {
    const result = spawnSync('bun', [runner, ...args], { encoding: 'utf-8' });
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/** The layout `daily-generate` leaves: per-section renders, the joined final, the intro merge. */
function writeEpisode(dir: string, options: { mp3Recorded: boolean; mp3OnDisk: boolean }): string[] {
    const audio = join(dir, '30-audio');
    const sections = join(audio, 'sections', '20261120');
    mkdirSync(sections, { recursive: true });
    const wavs = [
        join(sections, '00-opening.wav'),
        join(sections, '01-item.wav'),
        join(audio, '20261120_11_generate_content.wav'),
        join(audio, '20261120_11_generate_content.intro.wav'),
    ];
    for (const wav of wavs) writeFileSync(wav, 'RIFF-wav-bytes');
    writeFileSync(join(sections, '00-opening.mp3'), 'mp3');
    writeFileSync(join(audio, '20261120_11_generate_content.mp3'), 'episode-mp3');
    mkdirSync(join(dir, '23-cover'), { recursive: true });
    writeFileSync(join(dir, '23-cover', 'cover.png'), 'png');
    const metadata: Record<string, unknown> = { duration: 1002.11 };
    if (options.mp3Recorded) {
        const mp3Path = join(audio, options.mp3OnDisk ? '20261120_11_generate_content.mp3' : 'missing.mp3');
        metadata.mp3Path = mp3Path;
    }
    writeFileSync(
        join(audio, '20261120_11_generate_content.json'),
        JSON.stringify({ title: 'Daily AI News', format: 'audio', metadata }),
    );
    return wavs;
}

describe('kk stage audio-prune — a published episode keeps its MP3 and drops the WAV intermediates', () => {
    it('removes the section renders, the joined final and the intro merge once the MP3 is on disk', () => {
        withWorkDir((dir) => {
            const wavs = writeEpisode(dir, { mp3Recorded: true, mp3OnDisk: true });
            const result = run(['audio-prune', dir]);
            expect(result.status).toBe(0);
            for (const wav of wavs) expect(existsSync(wav)).toBe(false);
            // The delivered artifact and the run's evidence survive.
            expect(existsSync(join(dir, '30-audio/20261120_11_generate_content.mp3'))).toBe(true);
            expect(existsSync(join(dir, '30-audio/20261120_11_generate_content.json'))).toBe(true);
            expect(existsSync(join(dir, '30-audio/sections/20261120/00-opening.mp3'))).toBe(true);
            expect(existsSync(join(dir, '23-cover/cover.png'))).toBe(true);
            expect(result.stdout).toContain('removed 4 WAV intermediates');
        });
    });

    it('keeps every WAV when the recorded MP3 is not on disk — a failed transcode keeps its source', () => {
        withWorkDir((dir) => {
            const wavs = writeEpisode(dir, { mp3Recorded: true, mp3OnDisk: false });
            const result = run(['audio-prune', dir]);
            expect(result.status).toBe(0);
            for (const wav of wavs) expect(existsSync(wav)).toBe(true);
            expect(result.stdout).toContain('publish MP3 not on disk');
        });
    });

    it('keeps every WAV when the episode content records no MP3 at all', () => {
        withWorkDir((dir) => {
            const wavs = writeEpisode(dir, { mp3Recorded: false, mp3OnDisk: true });
            const result = run(['audio-prune', dir]);
            expect(result.status).toBe(0);
            for (const wav of wavs) expect(existsSync(wav)).toBe(true);
            expect(result.stdout).toContain('publish MP3 not on disk');
        });
    });

    it('no-ops on a run with no audio subtree, so one publish tail serves every noun', () => {
        withWorkDir((dir) => {
            const result = run(['audio-prune', dir]);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('nothing to prune');
        });
    });

    it('fails loud without a work_dir instead of guessing one', () => {
        const result = run(['audio-prune']);
        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('missing work_dir');
    });

    it('leaves the recorded MP3 path readable in the content sidecar it did not rewrite', () => {
        withWorkDir((dir) => {
            writeEpisode(dir, { mp3Recorded: true, mp3OnDisk: true });
            run(['audio-prune', dir]);
            const content = JSON.parse(readFileSync(join(dir, '30-audio/20261120_11_generate_content.json'), 'utf-8'));
            expect(content.metadata.mp3Path).toContain('20261120_11_generate_content.mp3');
        });
    });
});
