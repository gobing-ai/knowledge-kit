import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0131 (ADR-115) — behaviour of the solo-podcast stage runner that replaced the inline
 * prepare / duration-check shell in kk-solo-podcast.yaml. The pipeline's observable
 * contract (files, messages, revise counter, band) is asserted here so the YAML
 * delegation is equivalence-checked rather than trusted.
 */
const runner = join(import.meta.dir, '../../../plugins/kk/scripts/solo-podcast-stages.ts');

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'kk-solo-podcast-stages-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function run(
    args: string[],
    env: Record<string, string> = {},
    runnerPath: string = runner,
): { status: number; stdout: string; stderr: string } {
    try {
        const stdout = execFileSync('bun', [runnerPath, ...args], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, VOICEBOX_DEFAULT_PROFILE: 'tester', ...env },
        });
        return { status: 0, stdout, stderr: '' };
    } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { status: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
}

function writeContent(dir: string, metadata: unknown): void {
    mkdirSync(join(dir, '4-audio'), { recursive: true });
    writeFileSync(join(dir, '4-audio/content.json'), JSON.stringify({ metadata }));
}

describe('solo-podcast stage runner (0131)', () => {
    it('prepare writes brief.md from the topic, stages both subdirs, and zeroes .revise-count', () => {
        withTempDir((dir) => {
            expect(run(['prepare', dir, 'Episode topic', '', 'profile-x', 'false']).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('Episode topic\n');
            expect(existsSync(join(dir, '2-outline'))).toBe(true);
            expect(existsSync(join(dir, '4-audio'))).toBe(true);
            expect(readFileSync(join(dir, '.revise-count'), 'utf-8')).toBe('0\n');
        });
    });

    it('prepare refuses both-or-neither topic/input_file with the XOR messages', () => {
        withTempDir((dir) => {
            const both = run(['prepare', dir, 'topic', join(dir, 'in.md'), 'p', 'false']);
            expect(both.status).toBe(1);
            expect(both.stderr).toContain('XOR violation: both topic and input_file set');

            const neither = run(['prepare', dir, '', '', 'p', 'false']);
            expect(neither.status).toBe(1);
            expect(neither.stderr).toContain('XOR violation: neither topic nor input_file set');
        });
    });

    it('prepare refuses to clobber an existing brief.md unless force=true', () => {
        withTempDir((dir) => {
            writeFileSync(join(dir, 'brief.md'), 'existing\n');
            const refused = run(['prepare', dir, 'new topic', '', 'p', 'false']);
            expect(refused.status).toBe(1);
            expect(refused.stderr).toContain(`initialization target already exists at ${dir}/brief.md`);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('existing\n');

            expect(run(['prepare', dir, 'new topic', '', 'p', 'true']).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('new topic\n');
        });
    });

    it('prepare requires a voice profile from argv or VOICEBOX_DEFAULT_PROFILE', () => {
        withTempDir((dir) => {
            const missing = run(['prepare', dir, 'topic', '', '', 'false'], { VOICEBOX_DEFAULT_PROFILE: '' });
            expect(missing.status).toBe(1);
            expect(missing.stderr).toContain('missing voice_profile');
        });
    });

    it('duration is silent and leaves no gate file when content.json is absent (dry-run)', () => {
        withTempDir((dir) => {
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(existsSync(join(dir, '4-audio/.duration-ok'))).toBe(false);
            expect(existsSync(join(dir, '.duration-feedback'))).toBe(false);
        });
    });

    it('duration marks .duration-ok inside the [0.5x, 2x] band', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: 480 });
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(existsSync(join(dir, '4-audio/.duration-ok'))).toBe(true);
            expect(existsSync(join(dir, '.duration-feedback'))).toBe(false);
        });
    });

    it('duration feeds back and bumps .revise-count outside the band', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: 1200 });
            writeFileSync(join(dir, '.revise-count'), '1\n');
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(existsSync(join(dir, '4-audio/.duration-ok'))).toBe(false);
            expect(readFileSync(join(dir, '.duration-feedback'), 'utf-8')).toContain(
                'Regenerate: last audio duration 1200s outside 0.5x–2x of 480s',
            );
            expect(readFileSync(join(dir, '.revise-count'), 'utf-8')).toBe('2\n');
        });
    });

    it('duration treats a missing or non-numeric duration as not-a-number', () => {
        withTempDir((dir) => {
            writeContent(dir, {});
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(readFileSync(join(dir, '.duration-feedback'), 'utf-8')).toContain(
                'Regenerate: audio metadata.duration missing or not a number.',
            );
            expect(readFileSync(join(dir, '.revise-count'), 'utf-8')).toBe('1\n');
        });
    });

    it('duration rejects an unusable target instead of retrying against a zero band', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: 480 });
            for (const target of ['', 'abc', '0', '-4']) {
                const result = run(['duration', dir, target]);
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('invalid target_duration_min');
            }
        });
    });

    it('duration accepts both band edges and rejects just outside them', () => {
        withTempDir((dir) => {
            for (const [duration, ok] of [
                [240, true],
                [960, true],
                [239, false],
                [961, false],
            ] as const) {
                writeContent(dir, { duration });
                expect(run(['duration', dir, '8']).status).toBe(0);
                expect(existsSync(join(dir, '4-audio/.duration-ok'))).toBe(ok);
                rmSync(join(dir, '.duration-feedback'), { force: true });
            }
        });
    });

    it('prepare copies brief.md from input_file in file mode', () => {
        withTempDir((dir) => {
            const source = join(dir, 'source.md');
            writeFileSync(source, '# Source\n\nBody\n');
            expect(run(['prepare', dir, '', source, 'p', 'false']).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('# Source\n\nBody\n');
        });
    });

    it('prepare and duration require a work_dir instead of defaulting to cwd', () => {
        for (const stage of ['prepare', 'duration']) {
            const missing = run([stage]);
            expect(missing.status).toBe(1);
            expect(missing.stderr).toContain('missing work_dir');
        }
    });

    it('validate and wrap delegate to the shipped sidecars', () => {
        withTempDir((dir) => {
            const scriptPath = join(dir, '3-script-voicescript.yaml');
            writeFileSync(
                scriptPath,
                ['title: "Episode 1"', 'language: "en"', 'default_profile: "p"', 'segments:', '  - text: "Hi."'].join(
                    '\n',
                ),
            );
            expect(run(['validate', '', '--in', scriptPath]).status).toBe(0);
            expect(run(['validate', '', '--in', join(dir, 'missing.yaml')]).status).toBe(1);

            const outPath = join(dir, '4-audio', 'docs.json');
            mkdirSync(join(dir, '4-audio'), { recursive: true });
            expect(run(['wrap', '', '--in', scriptPath, '--out', outPath, '--profile', 'p']).status).toBe(0);
            const docs = JSON.parse(readFileSync(outPath, 'utf-8')) as { title: string; metadata: unknown }[];
            expect(docs[0]?.title).toBe('Podcast VoiceScript');
            expect(docs[0]?.metadata).toEqual({ voiceProfile: 'p' });
        });
    });

    it('an unknown or missing stage fails loud', () => {
        expect(run([]).stderr).toContain('unknown stage');
        expect(run(['nope']).stderr).toContain('unknown stage: nope');
    });

    it('duration requires a work_dir instead of silently defaulting to cwd', () => {
        const missing = run(['duration']);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain('missing work_dir');
    });
    it('validate honours the sidecar override chain: var > $KK_WORKFLOWS_DIR > package copy > $HOME', () => {
        withTempDir((dir) => {
            const envDir = join(dir, 'env-sidecars');
            const homeDir = join(dir, 'home');
            const homeSidecars = join(homeDir, '.config/kk/workflows');
            mkdirSync(envDir, { recursive: true });
            mkdirSync(homeSidecars, { recursive: true });
            const scriptPath = join(dir, '3-script-voicescript.yaml');
            writeFileSync(
                scriptPath,
                ['title: "Episode 1"', 'language: "en"', 'segments:', '  - text: "Hello and welcome."'].join('\n'),
            );
            // Marked copies exit with a distinctive status so "which copy ran" is observable.
            writeFileSync(join(envDir, 'validate-voicescript.ts'), 'process.exit(7);\n');
            writeFileSync(join(homeSidecars, 'validate-voicescript.ts'), 'process.exit(9);\n');

            const viaEnv = run(['validate', '', '--in', scriptPath], { KK_WORKFLOWS_DIR: envDir, HOME: homeDir });
            expect(viaEnv.status).toBe(7);

            const viaVar = run(['validate', join(homeSidecars, 'validate-voicescript.ts'), '--in', scriptPath], {
                KK_WORKFLOWS_DIR: envDir,
                HOME: homeDir,
            });
            expect(viaVar.status).toBe(9);

            // F8 R1: the shipped package copy precedes the config-dir copy, so an unelected
            // ~/.config/kk/workflows copy must NOT win — the valid fixture exits 0 through
            // the package copy instead of 9 through the $HOME copy.
            const viaPackage = run(['validate', '', '--in', scriptPath], { KK_WORKFLOWS_DIR: '', HOME: homeDir });
            expect(viaPackage.status).toBe(0);
        });
    });

    it('a missing sidecar fails loud with the remediation path', () => {
        withTempDir((dir) => {
            // A lone copy of the runner: its directory holds no sibling sidecars, so the
            // whole chain misses and `requireSidecar` must name the remediation.
            const loneRunner = join(dir, 'solo-podcast-stages.ts');
            copyFileSync(runner, loneRunner);
            const scriptPath = join(dir, '3-script-voicescript.yaml');
            writeFileSync(scriptPath, 'title: "Episode 1"\n');
            const result = run(['validate', '', '--in', scriptPath], { HOME: dir, KK_WORKFLOWS_DIR: '' }, loneRunner);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('validate-voicescript.ts not found');
            expect(result.stderr).toContain('/workflow-run kk-solo-podcast');
        });
    });
});
