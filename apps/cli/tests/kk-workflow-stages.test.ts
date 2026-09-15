import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0131/0132 (ADR-115) — behaviour of the shared kk stage runner that replaced the inline
 * prepare / duration-check / prepare-itc / prepare-storm / render shell in the kk
 * workflows. The observable contract (files, messages, revise counter, band, derived
 * topic/local-doc JSON) is asserted here so the YAML delegation is equivalence-checked
 * rather than trusted.
 */
const runner = join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'kk-workflow-stages-'));
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

describe('kk workflow stage runner (0132)', () => {
    it('prepare-solo writes brief.md from the topic, stages both subdirs, and zeroes .revise-count', () => {
        withTempDir((dir) => {
            expect(run(['prepare-solo', dir, 'Episode topic', '', 'profile-x', 'false']).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('Episode topic\n');
            expect(existsSync(join(dir, '2-outline'))).toBe(true);
            expect(existsSync(join(dir, '4-audio'))).toBe(true);
            expect(readFileSync(join(dir, '.revise-count'), 'utf-8')).toBe('0\n');
        });
    });

    it('prepare-solo refuses both-or-neither topic/input_file with the XOR messages', () => {
        withTempDir((dir) => {
            const both = run(['prepare-solo', dir, 'topic', join(dir, 'in.md'), 'p', 'false']);
            expect(both.status).toBe(1);
            expect(both.stderr).toContain('XOR violation: both topic and input_file set');

            const neither = run(['prepare-solo', dir, '', '', 'p', 'false']);
            expect(neither.status).toBe(1);
            expect(neither.stderr).toContain('XOR violation: neither topic nor input_file set');
        });
    });

    it('prepare-solo refuses to clobber an existing brief.md unless force=true', () => {
        withTempDir((dir) => {
            writeFileSync(join(dir, 'brief.md'), 'existing\n');
            const refused = run(['prepare-solo', dir, 'new topic', '', 'p', 'false']);
            expect(refused.status).toBe(1);
            expect(refused.stderr).toContain(`initialization target already exists at ${dir}/brief.md`);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('existing\n');

            expect(run(['prepare-solo', dir, 'new topic', '', 'p', 'true']).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('new topic\n');
        });
    });

    it('prepare-solo requires a voice profile from argv or VOICEBOX_DEFAULT_PROFILE', () => {
        withTempDir((dir) => {
            const missing = run(['prepare-solo', dir, 'topic', '', '', 'false'], { VOICEBOX_DEFAULT_PROFILE: '' });
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

    it('prepare-solo copies brief.md from input_file in file mode', () => {
        withTempDir((dir) => {
            const source = join(dir, 'source.md');
            writeFileSync(source, '# Source\n\nBody\n');
            expect(run(['prepare-solo', dir, '', source, 'p', 'false']).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('# Source\n\nBody\n');
        });
    });

    it('prepare-solo and duration require a work_dir instead of defaulting to cwd', () => {
        for (const stage of ['prepare-solo', 'duration']) {
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
            const loneRunner = join(dir, 'kk-workflow-stages.ts');
            copyFileSync(runner, loneRunner);
            const scriptPath = join(dir, '3-script-voicescript.yaml');
            writeFileSync(scriptPath, 'title: "Episode 1"\n');
            const env = { HOME: dir, KK_WORKFLOWS_DIR: '' };
            const validate = run(['validate', '', '--in', scriptPath], env, loneRunner);
            expect(validate.status).toBe(1);
            expect(validate.stderr).toContain('validate_script not found');
            expect(validate.stderr).toContain('install or refresh the kk package');

            const wrap = run(['wrap', '', '--in', scriptPath, '--out', join(dir, 'docs.json')], env, loneRunner);
            expect(wrap.stderr).toContain('wrap_script not found');

            const render = run(['render-storm', '', '--in', scriptPath, '--out', join(dir, 'out.md')], env, loneRunner);
            expect(render.stderr).toContain('render_script not found');

            // A workflow var may hold a path-like value starting with `-`; the pre-0132 shell chain
            // treated it as a path and fell through, so the runner must not treat it as an option.
            const dashed = run(['validate', '-x', '--in', scriptPath], env, loneRunner);
            expect(dashed.status).toBe(1);
            expect(dashed.stderr).toContain('validate_script not found');
        });
    });
});

describe('kk workflow stage runner — itc / storm verbs (0132)', () => {
    it('prepare-itc stages 2-outline, zeroes .revise-count before the XOR checks, and needs no voice profile', () => {
        withTempDir((dir) => {
            const env = { VOICEBOX_DEFAULT_PROFILE: '' };
            expect(run(['prepare-itc', dir, 'A topic', '', 'false'], env).status).toBe(0);
            expect(readFileSync(join(dir, 'brief.md'), 'utf-8')).toBe('A topic\n');
            expect(existsSync(join(dir, '2-outline'))).toBe(true);
            expect(existsSync(join(dir, '4-audio'))).toBe(false);
            expect(readFileSync(join(dir, '.revise-count'), 'utf-8')).toBe('0\n');

            expect(run(['prepare-itc', dir, 'topic', 'input.md', 'false'], env).stderr).toContain(
                'XOR violation: both topic and input_file set',
            );
            expect(run(['prepare-itc', dir, '', '', 'false'], env).stderr).toContain(
                'XOR violation: neither topic nor input_file set',
            );
            expect(run(['prepare-itc', dir, 'another', '', 'false'], env).stderr).toContain(
                `initialization target already exists at ${dir}/brief.md`,
            );
            expect(run(['prepare-itc', dir, 'another', '', 'true'], env).status).toBe(0);
        });
    });

    it('prepare-storm sentence mode writes topic.json only (no brief.md)', () => {
        withTempDir((dir) => {
            expect(run(['prepare-storm', dir, 'HNSW at 1B rows', '', '8', 'false']).status).toBe(0);
            expect(JSON.parse(readFileSync(join(dir, 'topic.json'), 'utf-8'))).toEqual({
                topic: 'HNSW at 1B rows',
                maxResults: 8,
                fixture: false,
            });
            expect(existsSync(join(dir, 'brief.md'))).toBe(false);
            expect(existsSync(join(dir, 'input.md'))).toBe(false);
        });
    });

    it('prepare-storm file mode copies input.md and derives the H1 query, local-doc, and topic.json', () => {
        withTempDir((dir) => {
            const source = join(dir, 'notes.md');
            writeFileSync(source, '# Vector search at scale\n\nbody line\n');
            expect(run(['prepare-storm', dir, '', source, '8', 'true']).status).toBe(0);

            expect(readFileSync(join(dir, 'input.md'), 'utf-8')).toBe('# Vector search at scale\n\nbody line\n');
            const topic = JSON.parse(readFileSync(join(dir, 'topic.json'), 'utf-8')) as Record<string, unknown>;
            expect(topic).toEqual({ topic: 'Vector search at scale', maxResults: 8, fixture: true });

            const sourceUri = `file://${source}`;
            const doc = JSON.parse(readFileSync(join(dir, 'local-doc.json'), 'utf-8')) as Record<string, unknown>;
            expect(doc).toEqual({
                id: createHash('sha256').update(sourceUri).digest('hex').slice(0, 16),
                // `$(cat …)` strips the trailing newline before jq sees the body.
                body: '# Vector search at scale\n\nbody line',
                title: 'Vector search at scale',
                sourceUri,
                mediaType: 'text/markdown',
                metadata: { query: 'Vector search at scale', rank: -1, position: 0 },
            });
        });
    });

    it('prepare-storm falls back to the basename query and fails loud without either', () => {
        withTempDir((dir) => {
            const noHeading = join(dir, 'fallback-topic.md');
            writeFileSync(noHeading, 'no heading here\n');
            expect(run(['prepare-storm', dir, '', noHeading, '8', 'false']).status).toBe(0);
            const topic = JSON.parse(readFileSync(join(dir, 'topic.json'), 'utf-8')) as Record<string, unknown>;
            expect(topic.topic).toBe('fallback-topic');

            const empty = run(['prepare-storm', dir, '', join(dir, 'missing.md'), '8', 'false']);
            expect(empty.status).toBe(1);
            expect(empty.stderr).toContain('input_file not readable');

            // jq's `tonumber` grammar is the contract: the same strings must be rejected.
            for (const bad of ['many', '', '   ', '0x10', '1e400', 'inf', 'nan']) {
                const badMax = run(['prepare-storm', dir, 'topic', '', bad, 'false']);
                expect(badMax.status).toBe(1);
                expect(badMax.stderr).toContain('invalid maxResults');
            }
            // …and the same strings must be accepted (`jq -n '$m|tonumber'` on 2026-09-14).
            for (const [raw, value] of [
                ['+8', 8],
                ['8.', 8],
                ['.5', 0.5],
                ['1e3', 1000],
            ] as const) {
                expect(run(['prepare-storm', dir, 'topic', '', raw, 'false']).status).toBe(0);
                const topic = JSON.parse(readFileSync(join(dir, 'topic.json'), 'utf-8')) as Record<string, unknown>;
                expect(topic.maxResults).toBe(value);
            }
        });
    });

    it('render-storm delegates to the shipped render-md.ts', () => {
        withTempDir((dir) => {
            const input = join(dir, 'content.json');
            const output = join(dir, 'content.md');
            writeFileSync(input, JSON.stringify({ body: 'para', format: 'markdown', title: 'Title' }));
            expect(run(['render-storm', '', '--in', input, '--out', output]).status).toBe(0);
            expect(readFileSync(output, 'utf-8')).toBe('# Title\n\npara\n');

            const missing = run(['render-storm', '', '--in', join(dir, 'absent.json'), '--out', output]);
            expect(missing.status).toBe(1);
        });
    });

    it('duration echoes the raw duration token exactly as the shell printf did', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: '1200.0' });
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(readFileSync(join(dir, '.duration-feedback'), 'utf-8')).toContain(
                'Regenerate: last audio duration 1200.0s outside 0.5x–2x of 480s',
            );
        });
    });

    it('duration accepts a numeric-string duration but rejects a non-numeric one', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: '480' });
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(existsSync(join(dir, '4-audio/.duration-ok'))).toBe(true);

            writeContent(dir, { duration: 'soon' });
            expect(run(['duration', dir, '8']).status).toBe(0);
            expect(readFileSync(join(dir, '.duration-feedback'), 'utf-8')).toContain(
                'Regenerate: audio metadata.duration missing or not a number.',
            );
        });
    });

    it('a staged file operation that fails reports mkdir/cp-style, not a stack trace', () => {
        withTempDir((dir) => {
            const blocked = join(dir, 'ro');
            mkdirSync(blocked, { recursive: true });
            // A file where a directory must go: mkdir cannot create it.
            const clash = join(blocked, '2-outline');
            writeFileSync(clash, 'not a dir\n');
            const result = run(['prepare-itc', blocked, 'topic', '', 'false']);
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/^mkdir: .*: /);
            expect(result.stderr).not.toContain('    at ');
        });
    });

    it('the option scanner accepts --flag=value, keeps values containing `=`, and fails on an unknown flag', () => {
        withTempDir((dir) => {
            const scriptPath = join(dir, '3-script-voicescript.yaml');
            writeFileSync(scriptPath, ['language: "en"', 'segments:', '  - text: "Hi."'].join('\n'));
            expect(run(['validate', '', `--in=${scriptPath}`]).status).toBe(0);

            // Split on the FIRST `=`: a value may contain one.
            const equalsPath = join(dir, 'out=box.yaml');
            writeFileSync(equalsPath, readFileSync(scriptPath, 'utf-8'));
            expect(run(['validate', '', `--in=${equalsPath}`]).status).toBe(0);

            const unknown = run(['validate', '', '--nope', scriptPath]);
            expect(unknown.status).toBe(1);
            expect(unknown.stderr).toContain('unknown option: --nope');
        });
    });

    it('an unreadable content.json reports the read error instead of "missing data"', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: 480 });
            chmodSync(join(dir, '4-audio/content.json'), 0o000);
            const result = run(['duration', dir, '8']);
            expect(result.status).toBe(1);
            expect(result.stderr).toMatch(/^read: .*content\.json: /);
            expect(result.stderr).not.toContain('    at ');
        });
    });

    it('an unusable input path reports a named file error rather than a stack trace', () => {
        withTempDir((dir) => {
            // A path whose parent is a regular file: statSync throws ENOTDIR, `[ -f ]` said false.
            const throughFile = join(dir, 'not-a-dir', 'brief.md');
            writeFileSync(join(dir, 'not-a-dir'), 'file, not a directory\n');
            const result = run(['prepare-itc', dir, '', throughFile, 'false']);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('input file not found');
            expect(result.stderr).not.toContain('    at ');
        });
    });

    it('duration validates the target before it clears a stale gate file', () => {
        withTempDir((dir) => {
            writeContent(dir, { duration: 480 });
            writeFileSync(join(dir, '4-audio/.duration-ok'), '');
            expect(run(['duration', dir, 'nope']).status).toBe(1);
            expect(existsSync(join(dir, '4-audio/.duration-ok'))).toBe(true);
        });
    });

    it('the verbs appear in the usage of an unknown-stage failure', () => {
        expect(run(['nope']).stderr).toContain('prepare-storm');
        expect(run(['nope']).stderr).toContain('render-storm');
    });
});
