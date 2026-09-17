import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
    const result = spawnSync('bun', [runnerPath, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, VOICEBOX_DEFAULT_PROFILE: 'tester', ...env },
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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

describe('kk workflow stage runner — kk-daily-ai-voice verbs (0133)', () => {
    function fakeKk(dir: string, script: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(path, `#!/usr/bin/env bun\n${script}\n`);
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    it('daily-publish-classify derives full/partial/none and writes the status file', () => {
        withTempDir((dir) => {
            const publish = join(dir, '3-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20260101';
            const write = (name: string, ok: boolean, status: string) =>
                writeFileSync(
                    join(publish, `${stamp}_${name}_result.json`),
                    JSON.stringify({
                        ok,
                        targets: [
                            { target: name === '14_publish-surfdash' ? 'surfdash-pub' : 'podcast-pub', ok, status },
                        ],
                    }),
                );
            write('14_publish-surfdash', true, 'published');
            write('16_publish-podcast', false, 'failed');
            expect(run(['daily-publish-classify', dir, stamp]).status).toBe(0);
            expect(readFileSync(join(publish, `${stamp}_17_publish_publish-status.txt`), 'utf-8')).toBe('partial');
            const result = JSON.parse(readFileSync(join(publish, `${stamp}_17_publish_result.json`), 'utf-8')) as {
                ok: boolean;
                targets: unknown[];
            };
            expect(result.ok).toBe(false);
            expect(result.targets).toHaveLength(2);
        });
    });

    it('daily-publish-classify reports none when a per-target result file is missing', () => {
        withTempDir((dir) => {
            const publish = join(dir, '3-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20260101';
            // Only the surfdash file exists: the pre-0133 `jq -s` chain could not read the pair and
            // drove status to `none`; classifying over the survivor would wrongly report `full`.
            writeFileSync(
                join(publish, `${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({ targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] }),
            );
            expect(run(['daily-publish-classify', dir, stamp]).status).toBe(0);
            expect(readFileSync(join(publish, `${stamp}_17_publish_publish-status.txt`), 'utf-8')).toBe('none');
            const result = JSON.parse(readFileSync(join(publish, `${stamp}_17_publish_result.json`), 'utf-8')) as {
                ok: boolean;
                targets: unknown[];
            };
            expect(result).toEqual({ ok: false, targets: [] });
        });
    });

    it('daily-article passes ARTICLE_DATE (not ART_DATE) to the article plugin', () => {
        withTempDir((dir) => {
            const envDump = join(dir, 'env.json');
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    'fs.writeFileSync(process.env.ENV_DUMP, JSON.stringify({ ARTICLE_DATE: process.env.ARTICLE_DATE, ART_DATE: process.env.ART_DATE }));',
                    "fs.writeFileSync(out, JSON.stringify({ body: '# article' }));",
                ].join('\n'),
            );
            for (const sub of ['2-plan', '2-article']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            writeFileSync(join(dir, `2-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a' }]));
            expect(run(['daily-article', dir, stamp, ''], { ...env, ENV_DUMP: envDump }).status).toBe(0);
            expect(JSON.parse(readFileSync(envDump, 'utf-8'))).toEqual({ ART_DATE: undefined, ARTICLE_DATE: stamp });
        });
    });

    it('daily-publish-prep merges the voice metadata and drops an absent cover path', () => {
        withTempDir((dir) => {
            for (const sub of ['2-article', '3-audio', '3-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            writeFileSync(
                join(dir, `2-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `3-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: 'audio.wav', duration: 12 } }),
            );
            expect(run(['daily-publish-prep', dir, stamp]).status).toBe(0);
            const merged = JSON.parse(
                readFileSync(join(dir, `3-publish/${stamp}_13_publish-prep_content.json`), 'utf-8'),
            ) as { metadata: Record<string, unknown>; options: Record<string, unknown> };
            expect(merged.metadata.audioFile).toBe(resolve('audio.wav'));
            expect(merged.metadata.runDate).toBe(stamp);
            expect(merged.options.durationSec).toBe(12);
            expect('coverPath' in merged.options).toBe(false);
        });
    });

    it('daily-publish-prep fails loud when the voice content carries no audio path', () => {
        withTempDir((dir) => {
            for (const sub of ['2-article', '3-audio', '3-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            writeFileSync(join(dir, `2-article/${stamp}_06_article_content.json`), JSON.stringify({ title: 'T' }));
            writeFileSync(join(dir, `3-audio/${stamp}_11_generate_content.json`), JSON.stringify({ metadata: {} }));
            const result = run(['daily-publish-prep', dir, stamp]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('publish-prep: voice content carries no mp3Path/audioPath');
        });
    });

    it('daily-cover-normalize renames a png cover and clears the stale artifacts', () => {
        withTempDir((dir) => {
            const cover = join(dir, '2-cover');
            mkdirSync(cover, { recursive: true });
            writeFileSync(join(cover, 'content-cover-01.png'), 'png');
            writeFileSync(join(cover, 'content-cover-01.jpg'), 'jpg');
            expect(run(['daily-cover-normalize', dir, '20260101']).status).toBe(0);
            expect(readFileSync(join(cover, '20260101_07_cover_cover.png'), 'utf-8')).toBe('png');
            expect(existsSync(join(cover, 'content-cover-01.png'))).toBe(false);
            expect(existsSync(join(cover, 'content-cover-01.jpg'))).toBe(false);
        });
    });

    it('daily-cover-normalize fails loud when sips is absent for a jpg cover', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '2-cover'), { recursive: true });
            writeFileSync(join(dir, '2-cover/content-cover-01.jpg'), 'jpg');
            // Keep `bun` resolvable but drop `sips` from PATH: a bin dir holding only a bun symlink.
            const bin = join(dir, 'only-bun');
            mkdirSync(bin, { recursive: true });
            symlinkSync(process.execPath, join(bin, 'bun'));
            const result = run(['daily-cover-normalize', dir, '20260101'], { PATH: bin });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('cover normalize: sips not found; cannot transcode jpg -> png');
            expect(existsSync(join(dir, '2-cover/20260101_07_cover_cover.png'))).toBe(false);
        });
    });

    it('daily-wrap-docs hashes the file URL the shell built and labels the profile', () => {
        withTempDir((dir) => {
            for (const sub of ['2-script', '3-audio']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const scriptPath = join(dir, `2-script/${stamp}_08_script_voicescript.yaml`);
            // A minimal *valid* VoiceScript: the wrap-docs stage now runs the R3 content validator,
            // so a schema-invalid stub no longer reaches the doc packaging it is here to exercise.
            writeFileSync(scriptPath, 'language: en\nsegments:\n  - text: "Hello and welcome to the episode."\n');
            expect(run(['daily-wrap-docs', dir, stamp, 'Alex']).status).toBe(0);
            const docs = JSON.parse(readFileSync(join(dir, `3-audio/${stamp}_10_wrap-docs_docs.json`), 'utf-8')) as {
                id: string;
                sourceUri: string;
                body: string;
                metadata: { voiceProfile: string };
            }[];
            expect(docs[0]?.body).toBe('language: en\nsegments:\n  - text: "Hello and welcome to the episode."\n');
            expect(docs[0]?.sourceUri).toBe(`file://${scriptPath}`);
            expect(docs[0]?.id).toBe(createHash('sha256').update(`file://${scriptPath}`).digest('hex').slice(0, 16));
            expect(docs[0]?.metadata.voiceProfile).toBe('Alex');
        });
    });

    it('daily-collect-facts caches on both artifacts and writes the facts file', () => {
        withTempDir((dir) => {
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    "fs.mkdirSync(require('node:path').dirname(out), { recursive: true });",
                    "fs.writeFileSync(out, JSON.stringify({ body: 'facts body' }));",
                ].join('\n'),
            );
            mkdirSync(join(dir, '1-ingest'), { recursive: true });
            mkdirSync(join(dir, '2-facts'), { recursive: true });
            const stamp = '20260101';
            writeFileSync(join(dir, `1-ingest/${stamp}_02_collect_blended.json`), '[]');
            expect(run(['daily-collect-facts', dir, stamp, ''], env).status).toBe(0);
            expect(readFileSync(join(dir, `2-facts/${stamp}_02_collect_core-facts.md`), 'utf-8')).toBe('facts body');
            // Second run takes the cache branch (the fake kk would overwrite the body otherwise).
            writeFileSync(join(dir, `2-facts/${stamp}_02_collect_content.json`), JSON.stringify({ body: 'ignored' }));
            expect(run(['daily-collect-facts', dir, stamp, ''], env).status).toBe(0);
            expect(readFileSync(join(dir, `2-facts/${stamp}_02_collect_core-facts.md`), 'utf-8')).toBe('facts body');
        });
    });

    it('daily-translate-localize writes zh/en/ja markers, skips without a zh path, scaffolds otherwise', () => {
        withTempDir((dir) => {
            const publish = join(dir, '3-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20260101';
            // No result.json → no post path → all markers written empty and no scaffolding runs.
            expect(run(['daily-translate-localize', dir, stamp, '']).status).toBe(0);
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`), 'utf-8')).toBe('');
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), 'utf-8')).toBe('');
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), 'utf-8')).toBe('');

            // With a published zh path and no draft on disk, each locale scaffolds via surfdash-pub.
            const zhPath = join(dir, 'posts/zh/index.md');
            writeFileSync(
                join(publish, `${stamp}_17_publish_result.json`),
                JSON.stringify({
                    targets: [
                        { target: 'surfdash-pub', ok: true, status: 'published', metadata: { postPath: zhPath } },
                    ],
                }),
            );
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    "const target = out.includes('-ja-') ? 'ja' : 'en';",
                    "fs.writeFileSync(out, JSON.stringify({ metadata: { draftPath: 'posts/' + target + '/index.md' } }));",
                ].join('\n'),
            );
            expect(run(['daily-translate-localize', dir, stamp, ''], env).status).toBe(0);
            const scaffold = JSON.parse(
                readFileSync(join(publish, `${stamp}_20_translate-localize_scaffold-en.json`), 'utf-8'),
            ) as { options: Record<string, string> };
            expect(scaffold.options).toEqual({ operation: 'scaffold-locale', postPath: zhPath, target: 'en' });
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), 'utf-8')).toBe(
                'posts/en/index.md',
            );
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), 'utf-8')).toBe(
                'posts/ja/index.md',
            );

            // An on-disk draft is the retry cache: reused without re-scaffolding (re-scaffolding
            // would erase the agent's translation).
            rmSync(join(publish, `${stamp}_20_translate-localize_scaffold-en.json`), { force: true });
            mkdirSync(join(dir, 'posts/en'), { recursive: true });
            writeFileSync(join(dir, 'posts/en/index.md'), 'translated');
            expect(run(['daily-translate-localize', dir, stamp, ''], env).status).toBe(0);
            expect(existsSync(join(publish, `${stamp}_20_translate-localize_scaffold-en.json`))).toBe(false);
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), 'utf-8')).toBe(
                join(dir, 'posts/en/index.md'),
            );
        });
    });

    it('daily-translate-sync skips without a zh path file and syncs through the zh marker', () => {
        withTempDir((dir) => {
            const publish = join(dir, '3-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20260101';
            // No marker file at all → loud skip without invoking kk.
            expect(run(['daily-translate-sync', dir, stamp, '', '']).status).toBe(0);
            expect(existsSync(join(publish, `${stamp}_24_translate-sync_sync.json`))).toBe(false);

            const marker = join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`);
            writeFileSync(marker, 'posts/zh/index.md');
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    'fs.writeFileSync(out, JSON.stringify({ ok: true }));',
                ].join('\n'),
            );
            expect(run(['daily-translate-sync', dir, stamp, '', marker], env).status).toBe(0);
            const sync = JSON.parse(readFileSync(join(publish, `${stamp}_24_translate-sync_sync.json`), 'utf-8')) as {
                options: Record<string, string>;
            };
            expect(sync.options).toEqual({ operation: 'sync', postPath: 'posts/zh/index.md' });
        });
    });

    it('daily-publish-partial names the failed targets and preserves the retry file', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '3-publish'), { recursive: true });
            const stamp = '20260101';
            writeFileSync(
                join(dir, `3-publish/${stamp}_17_publish_result.json`),
                JSON.stringify({
                    targets: [
                        { target: 'surfdash-pub', ok: true, status: 'published' },
                        { target: 'podcast-pub', ok: false, status: 'failed' },
                    ],
                }),
            );
            const result = run(['daily-publish-partial', dir, stamp]);
            expect(result.status).toBe(0);
            expect(result.stderr).toContain('failed targets: podcast-pub');
            const retry = readFileSync(join('.spur/run', `publish-partial-${stamp}.txt`), 'utf-8');
            expect(retry).toContain(`failed targets: podcast-pub`);
            rmSync(join('.spur/run', `publish-partial-${stamp}.txt`), { force: true });
        });
    });

    /** Fake `kk` that dumps the podcast-pub env channels and writes the `--out` artifact. */
    function showNotesKk(dir: string): Record<string, string> {
        const dump = join(dir, 'show-notes-env.json');
        const env = fakeKk(
            dir,
            [
                "const fs = require('node:fs');",
                'const args = process.argv.slice(2);',
                "const out = args[args.indexOf('--out') + 1];",
                'fs.writeFileSync(process.env.SHOW_NOTES_DUMP, JSON.stringify({ ...process.env }));',
                "fs.writeFileSync(out, '# show notes');",
            ].join('\n'),
        );
        return { ...env, SHOW_NOTES_DUMP: dump };
    }

    function showNotesEnv(dir: string): Record<string, string> {
        return JSON.parse(readFileSync(join(dir, 'show-notes-env.json'), 'utf-8')) as Record<string, string>;
    }

    it('daily-show-notes forwards the published surfdash post path so the timeline layout engages', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '3-publish'), { recursive: true });
            const stamp = '20260101';
            const postPath = '/posts/zh/daily-ai-20260101/index.md';
            writeFileSync(
                join(dir, `3-publish/${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: true, status: 'published', metadata: { postPath } }],
                }),
            );
            expect(run(['daily-show-notes', dir, stamp, '', 'Daily AI'], showNotesKk(dir)).status).toBe(0);
            expect(showNotesEnv(dir)).toMatchObject({
                PODCAST_PUB_ARTICLE_POST_PATH: postPath,
                PODCAST_PUB_RUN_DATE: stamp,
                PODCAST_PUB_BRIEF_MODE: 'true',
                PODCAST_PUB_TITLE: 'Daily AI',
            });
        });
    });

    it('daily-show-notes degrades to an empty article post path when the surfdash result is absent or failed', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '3-publish'), { recursive: true });
            const stamp = '20260101';
            // Absent file — the surfdash state never ran or published nothing.
            expect(run(['daily-show-notes', dir, stamp, '', 'T'], showNotesKk(dir)).status).toBe(0);
            expect(showNotesEnv(dir).PODCAST_PUB_ARTICLE_POST_PATH).toBe('');
            // Present file with a failed target — the legacy full-body layout must survive.
            writeFileSync(
                join(dir, `3-publish/${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: false, status: 'failed', metadata: { postPath: null } }],
                }),
            );
            expect(run(['daily-show-notes', dir, stamp, '', 'T'], showNotesKk(dir)).status).toBe(0);
            expect(showNotesEnv(dir).PODCAST_PUB_ARTICLE_POST_PATH).toBe('');
        });
    });

    it('daily-show-notes never depends on _17_publish_result.json, which the later publish state writes', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '3-publish'), { recursive: true });
            const stamp = '20260101';
            writeFileSync(
                join(dir, `3-publish/${stamp}_17_publish_result.json`),
                JSON.stringify({
                    targets: [
                        {
                            target: 'surfdash-pub',
                            ok: true,
                            status: 'published',
                            metadata: { postPath: '/posts/zh/published-later/index.md' },
                        },
                    ],
                }),
            );
            expect(run(['daily-show-notes', dir, stamp, '', 'T'], showNotesKk(dir)).status).toBe(0);
            expect(showNotesEnv(dir).PODCAST_PUB_ARTICLE_POST_PATH).toBe('');
        });
    });
});

describe('kk workflow stage runner — post-translation plan dedup (0138 R3)', () => {
    // Threshold calibration evidence, measured on 20260916_03_plan_plan.json: the Gemini 3.8 Live
    // pair (plan items 5 and 7) scores 0.417 zh title-only bigram Jaccard; the nearest distinct
    // pair (items 3 and 4) scores 0.1. DEDUP_TITLE_THRESHOLD = 0.4 sits between them with a 4x
    // margin. Mixed-language pre-translate titles measure 0.208 for the same pair — unusable, which
    // is why dedup runs after plan-translate.
    const geminiFirst = 'Google 发布 Gemini 3.8 Live 实时语音模型，Simon Willison 推出浏览器零依赖实现';
    const geminiSecond = 'Google 发布 Gemini 3.8 Live 与 3.8 Live Extended Thinking 实时语音模型';
    const distinct = 'OpenAI 据报道考虑以约 1.2 万亿美元估值融资';

    /**
     * `dedupPlanByTitle` is called out of process on purpose: importing the runner into the test
     * process registers its ~1300-line CLI body with coverage (7%), which the per-file threshold in
     * `bunfig.toml` then fails. The stage runner is a spawned script, not an in-process library.
     */
    function dedup(docs: unknown[]): { kept: { id?: unknown }[]; dropped: string[] } {
        const script = [
            `import { dedupPlanByTitle } from ${JSON.stringify(runner)};`,
            `console.log(JSON.stringify(dedupPlanByTitle(${JSON.stringify(docs)})));`,
        ].join('\n');
        const result = spawnSync('bun', ['-e', script], { encoding: 'utf-8' });
        if (result.status !== 0) throw new Error(`dedupPlanByTitle failed: ${result.stderr}`);
        return JSON.parse(result.stdout) as { kept: { id?: unknown }[]; dropped: string[] };
    }

    function fakeKk(dir: string, script: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(path, `#!/usr/bin/env bun\n${script}\n`);
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    it('merges the real Gemini 3.8 Live pair onto its first plan-order occurrence', () => {
        const { kept, dropped } = dedup([
            { id: 'a', title: distinct },
            { id: 'b', title: geminiFirst },
            { id: 'c', title: geminiSecond },
        ]);
        expect(kept.map((entry) => entry.id)).toEqual(['a', 'b']);
        expect(dropped).toEqual(['c']);
    });

    it('is a no-op on an already-deduped plan and on items without a title', () => {
        const plan = [
            { id: 'a', title: distinct },
            { id: 'b', title: geminiFirst },
        ];
        expect(dedup(plan)).toEqual({ kept: plan, dropped: [] });
        expect(dedup([{ id: 'x' }, { id: 'y' }])).toEqual({ kept: [{ id: 'x' }, { id: 'y' }], dropped: [] });
    });

    it('daily-article dedups plan.json before the cache early-return (AC5)', () => {
        withTempDir((dir) => {
            const env = fakeKk(
                dir,
                [
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    "require('node:fs').writeFileSync(out, JSON.stringify({ body: '# article' }));",
                ].join('\n'),
            );
            for (const sub of ['2-plan', '2-article']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            const planPath = join(dir, `2-plan/${stamp}_03_plan_plan.json`);
            writeFileSync(
                planPath,
                JSON.stringify([
                    { id: 'a', title: distinct },
                    { id: 'b', title: geminiFirst },
                    { id: 'c', title: geminiSecond },
                ]),
            );

            const first = run(['daily-article', dir, stamp, ''], env);
            expect(first.status).toBe(0);
            expect(first.stderr).toContain('near-duplicate plan item(s)');
            expect(planIds(planPath)).toEqual(['a', 'b']);

            // Second run takes the article cache path — the dedup must still have run first, or the
            // script stage would read a plan.json that still carries the duplicate.
            const second = run(['daily-article', dir, stamp, ''], env);
            expect(second.status).toBe(0);
            expect(second.stdout).toContain('article cached:');
            expect(planIds(planPath)).toEqual(['a', 'b']);
        });
    });
});

function planIds(path: string): unknown[] {
    return (JSON.parse(readFileSync(path, 'utf-8')) as { id: unknown }[]).map((entry) => entry.id);
}

describe('0139 R3 — voicescript content gate wiring', () => {
    /** Writes a `kk` stub that copies a prepared voicescript body into the stage's `--out`. */
    function fakeKkEchoingBody(dir: string, bodyPath: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(
            path,
            [
                '#!/usr/bin/env bun',
                "const fs = require('node:fs');",
                'const args = process.argv.slice(2);',
                "const out = args[args.indexOf('--out') + 1];",
                `fs.writeFileSync(out, JSON.stringify({ title: 'T', body: fs.readFileSync(${JSON.stringify(bodyPath)}, 'utf8') }));`,
                '',
            ].join('\n'),
        );
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    const validScript = (extra = '') =>
        ['language: en', 'segments:', '  - text: "Hello and welcome to the episode."', extra, ''].join('\n');

    it('daily-script exits non-zero when the generated voicescript carries a 标签 metadata tail', () => {
        withTempDir((dir) => {
            for (const sub of ['2-plan', '2-script']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            writeFileSync(join(dir, `2-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
            const bodyPath = join(dir, 'body.yaml');
            writeFileSync(
                bodyPath,
                ['language: en', 'segments:', '  - text: "正文。标签，ai"', '  - text: "Second."', ''].join('\n'),
            );
            const result = run(['daily-script', dir, stamp, '', 'en', 'T', 'Robin'], fakeKkEchoingBody(dir, bodyPath));
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('content check failed');
            expect(result.stderr).toContain('segment 0');
            expect(result.stderr).toContain('标签 metadata tail');
        });
    });

    it('daily-script passes a clean voicescript through to the file', () => {
        withTempDir((dir) => {
            for (const sub of ['2-plan', '2-script']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            writeFileSync(join(dir, `2-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
            const bodyPath = join(dir, 'body.yaml');
            writeFileSync(bodyPath, validScript());
            const result = run(['daily-script', dir, stamp, '', 'en', 'T', 'Robin'], fakeKkEchoingBody(dir, bodyPath));
            expect(result.status).toBe(0);
            expect(readFileSync(join(dir, `2-script/${stamp}_08_script_voicescript.yaml`), 'utf-8')).toBe(
                validScript(),
            );
        });
    });

    it('daily-wrap-docs rejects a HITL-edited duplicate segment, then proceeds once repaired', () => {
        withTempDir((dir) => {
            for (const sub of ['2-script', '3-audio']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            const scriptPath = join(dir, `2-script/${stamp}_08_script_voicescript.yaml`);
            const duplicated = [
                'language: en',
                'segments:',
                '  - text: "Hello and welcome to the episode."',
                '  - text: "Hello and welcome to the episode."',
                '',
            ].join('\n');
            writeFileSync(scriptPath, duplicated);

            const rejected = run(['daily-wrap-docs', dir, stamp, 'Robin']);
            expect(rejected.status).toBe(1);
            expect(rejected.stderr).toContain('content check failed');
            expect(rejected.stderr).toContain('segment 1');
            expect(rejected.stderr).toContain('duplicates segment 0');
            // Nothing packaged while the gate is red.
            expect(existsSync(join(dir, `3-audio/${stamp}_10_wrap-docs_docs.json`))).toBe(false);

            // Recovery is an operator edit + re-run: the repaired YAML packages normally, so generate
            // consumes it.
            writeFileSync(scriptPath, validScript('  - text: "Second segment."'));
            const repaired = run(['daily-wrap-docs', dir, stamp, 'Robin']);
            expect(repaired.status).toBe(0);
            const docs = JSON.parse(readFileSync(join(dir, `3-audio/${stamp}_10_wrap-docs_docs.json`), 'utf-8')) as {
                body: string;
            }[];
            expect(docs[0]?.body).toContain('Hello and welcome to the episode.');
            expect(docs[0]?.body).toContain('Second segment.');
        });
    });
});
