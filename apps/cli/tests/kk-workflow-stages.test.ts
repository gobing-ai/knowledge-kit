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
import { dirname, join, resolve } from 'node:path';

/**
 * 0131/0132 (ADR-115) — behaviour of the shared kk stage runner that replaced the inline
 * prepare / duration-check / prepare-itc / prepare-storm / render shell in the kk
 * workflows. The observable contract (files, messages, revise counter, band, derived
 * topic/local-doc JSON) is asserted here so the YAML delegation is equivalence-checked
 * rather than trusted.
 */
const runner = join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');
// R7 (0211): the daily-* stage bodies live in this sibling; a runner copy can only run a daily
// stage when the sibling ships beside it. series-names.ts is daily-stages' own pure sibling
// (2026-10-23 series naming) and ships with it; so does sentences.ts (2026-10-24 splitter).
const dailyStages = join(import.meta.dir, '../../../plugins/kk/scripts/daily-stages.ts');
const seriesNames = join(import.meta.dir, '../../../plugins/kk/scripts/series-names.ts');
const sentences = join(import.meta.dir, '../../../plugins/kk/scripts/sentences.ts');
// 0348: the runner imports cover-compositor at module load, so lone-runner copies ship it too.
const coverCompositor = join(import.meta.dir, '../../../plugins/kk/scripts/cover-compositor.ts');
const topicSelectionAttempts = join(import.meta.dir, '../../../plugins/kk/scripts/topic-selection-attempts.ts');
const newsEditorialLedger = join(import.meta.dir, '../../../plugins/kk/scripts/news-editorial-ledger.ts');
const sourceCitation = join(import.meta.dir, '../../../plugins/kk/scripts/source-citation.ts');
const episodeIdentity = join(import.meta.dir, '../../../plugins/kk/scripts/episode-identity.ts');

// A real 1x1 JPEG (generated once via `sips -s format jpeg` from a 1x1 png) so the jpg transcode
// test exercises sips with data it can actually decode.
const JPEG_BYTES = Buffer.from(
    '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=',
    'base64',
);

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
    cwd?: string,
): { status: number; stdout: string; stderr: string } {
    const result = spawnSync('bun', [runnerPath, ...args], {
        encoding: 'utf-8',
        cwd,
        env: { ...process.env, VOICEBOX_DEFAULT_PROFILE: 'tester', ...env },
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function writeContent(dir: string, metadata: unknown): void {
    mkdirSync(join(dir, '4-audio'), { recursive: true });
    writeFileSync(join(dir, '4-audio/content.json'), JSON.stringify({ metadata }));
}

/**
 * Task 0189 R10: daily-publish-prep only packages drafts that cleared the content-safety verdict
 * gate. Drives the real prep + gate stages (the two agent outputs are written in the agents' place).
 */
function passSafety(dir: string, stamp: string): void {
    mkdirSync(join(dir, '24-script'), { recursive: true });
    const at = (name: string) => join(dir, '24-script', `${stamp}_09_${name}`);
    writeFileSync(join(dir, '24-script', `${stamp}_08_script_voicescript.yaml`), 'segments: []\n');
    run(['daily-safety-prep', dir, stamp, 'xiaoyuzhou']);
    writeFileSync(at('safety-review_report.json'), JSON.stringify({ platforms: [{ decision: 'OK' }] }));
    writeFileSync(at('safety-judge_verdict.json'), JSON.stringify({ verdict: 'PASS', confidence: 'HIGH' }));
    run(['daily-safety-gate', dir, stamp]);
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
            copyFileSync(coverCompositor, join(dir, 'cover-compositor.ts'));
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

    /**
     * 0171: a fake `ffmpeg` on PATH. Records its argv to `record` and (exit 0 only) writes the
     * tagged file at the last argv entry, so the stage's tmp-write + rename is observable
     * without shelling out to a real encoder.
     */
    function fakeFfmpeg(dir: string, record: string, exitCode = 0): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'ffmpeg');
        writeFileSync(
            path,
            [
                '#!/usr/bin/env bun',
                "const fs = require('node:fs');",
                'const argv = process.argv.slice(2);',
                `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(argv));`,
                exitCode === 0
                    ? 'fs.writeFileSync(argv[argv.length - 1], "tagged");'
                    : `process.stderr.write('ffmpeg: boom'); process.exit(${exitCode});`,
            ].join('\n'),
        );
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    it('daily-publish-classify derives full/partial/none and writes the status file', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
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
            const publish = join(dir, '31-publish');
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

    // 20261002: the publish tail was driven by hand, so the independent channels (locales, XHS,
    // WeChat) and the CMS re-sync never ran — and nothing in the run's own artifacts said so. The
    // classify step now records their state beside the status file; publish_status is unchanged
    // (these targets stay non-blocking by design).
    describe('daily-publish-completeness publish completeness', () => {
        const stamp = '20260101';
        const seeded = (dir: string): string => {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            writeFileSync(
                join(publish, `${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({ ok: true, targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] }),
            );
            writeFileSync(
                join(publish, `${stamp}_16_publish-podcast_result.json`),
                JSON.stringify({ ok: true, targets: [{ target: 'podcast-pub', ok: true, status: 'published' }] }),
            );
            return publish;
        };
        /**
         * A locale whose marker points at a REAL draft, because completeness reads that draft's
         * `draft:` flag: a scaffold is `draft: true` until the workflow's `translate` agent publishes
         * it (`draft: false`), which is the only signal that separates a translated locale from one
         * the agent never got to.
         */
        const localeDraft = (publish: string, locale: string, draft: boolean): void => {
            const dir = join(publish, `locale-${locale}`);
            mkdirSync(dir, { recursive: true });
            const draftPath = join(dir, 'index.md');
            writeFileSync(draftPath, `---\ntitle: t\ndraft: ${draft}\n---\n\nbody\n`);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_${locale}-post-path.txt`), draftPath);
        };
        const completenessOf = (
            publish: string,
        ): { missing: string[]; rows: { channel: string; state: string; detail: string }[] } =>
            JSON.parse(readFileSync(join(publish, `${stamp}_17_publish_completeness.json`), 'utf-8'));

        it('daily-publish-classify classifies outcomes without writing completeness (0220 AC2)', () => {
            withTempDir((dir) => {
                const publish = seeded(dir);
                const res = run(['daily-publish-classify', dir, stamp]);
                expect(res.status, res.stderr).toBe(0);
                expect(readFileSync(join(publish, `${stamp}_17_publish_publish-status.txt`), 'utf-8')).toBe('full');
                expect(existsSync(join(publish, `${stamp}_17_publish_completeness.json`))).toBe(false);
                expect(res.stderr).not.toContain('publish completeness');
                expect(res.stderr).not.toContain('publish-completeness:');
            });
        });

        it('names every channel a hand-driven tail skipped, without touching publish_status', () => {
            withTempDir((dir) => {
                const publish = seeded(dir);
                const res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status, res.stderr).toBe(0);
                const completeness = completenessOf(publish);
                expect(completeness.missing).toEqual(['locales', 'xhs', 'wechat', 'cms-resync']);
                expect(completeness.rows.map((row) => `${row.channel}=${row.state}`)).toEqual([
                    'locales=not-run',
                    'xhs=not-run',
                    'wechat=not-run',
                    'cms-resync=not-run',
                ]);
                expect(res.stderr).toContain('publish completeness');
                expect(res.stderr).toContain('wechat');
            });
        });

        it('records done, a named failure and the CMS skip marker', () => {
            withTempDir((dir) => {
                const publish = seeded(dir);
                for (const locale of ['en', 'ja']) localeDraft(publish, locale, false);
                writeFileSync(
                    join(publish, `${stamp}_24_translate-sync_sync-result.json`),
                    JSON.stringify({ ok: true, target: 'surfdash' }),
                );
                writeFileSync(
                    join(publish, `${stamp}_19_publish-xhs_result.json`),
                    JSON.stringify({ ok: true, target: 'xhs', metadata: { publishStatus: 'draft' } }),
                );
                writeFileSync(
                    join(publish, `${stamp}_20_publish-wechat_result.json`),
                    JSON.stringify({ ok: false, target: 'wechatmp', error: 'console session preflight failed' }),
                );
                writeFileSync(
                    join(publish, `${stamp}_23_patch-surfdash_emdash-resync.txt`),
                    'skipped: no plugins-path\n',
                );
                const res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status, res.stderr).toBe(0);
                const completeness = completenessOf(publish);
                expect(completeness.rows.map((row) => `${row.channel}=${row.state}`)).toEqual([
                    'locales=done',
                    'xhs=done',
                    'wechat=failed',
                    'cms-resync=skipped',
                ]);
                expect(completeness.missing).toEqual(['wechat', 'cms-resync']);
                expect(res.stderr).toContain('console session preflight failed');
            });
        });

        it('reports nothing missing when the tail ran through end to end', () => {
            withTempDir((dir) => {
                const publish = seeded(dir);
                for (const locale of ['en', 'ja']) localeDraft(publish, locale, false);
                writeFileSync(
                    join(publish, `${stamp}_24_translate-sync_sync-result.json`),
                    JSON.stringify({ ok: true, target: 'surfdash' }),
                );
                writeFileSync(
                    join(publish, `${stamp}_19_publish-xhs_result.json`),
                    JSON.stringify({ ok: true, target: 'xhs', metadata: { publishStatus: 'draft' } }),
                );
                writeFileSync(
                    join(publish, `${stamp}_20_publish-wechat_result.json`),
                    JSON.stringify({ ok: true, target: 'wechatmp', metadata: { publishStatus: 'draft' } }),
                );
                writeFileSync(
                    join(publish, `${stamp}_23_patch-surfdash_sync-result.json`),
                    JSON.stringify({ ok: true, target: 'surfdash' }),
                );
                const res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status, res.stderr).toBe(0);
                expect(completenessOf(publish).missing).toEqual([]);
                expect(res.stderr).not.toContain('WARNING: publish completeness');
            });
        });

        it('marks locales done when validator and primary Surfdash receipts both succeed', () => {
            withTempDir((dir) => {
                const publish = seeded(dir);
                for (const locale of ['en', 'ja']) localeDraft(publish, locale, false);
                writeFileSync(
                    join(publish, `${stamp}_24_translate-validate_result.json`),
                    JSON.stringify({ ok: true, target: 'translate-validate' }),
                );
                const res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status, res.stderr).toBe(0);
                const completeness = completenessOf(publish);
                const locales = completeness.rows.find((row) => row.channel === 'locales');
                expect(locales?.state).toBe('done');
                expect(completeness.missing).not.toContain('locales');
            });
        });

        it('reports a locale the translate agent never published, not a scaffolded one (20261012)', () => {
            // The marker is written by the SCAFFOLD step, so it cannot witness the translation. The
            // workflow tolerates a failed `translate` agent (the channel is documented as independent),
            // which makes this the only signal that a locale was lost: the draft's own `draft:` flag.
            withTempDir((dir) => {
                const publish = seeded(dir);
                localeDraft(publish, 'en', false);
                localeDraft(publish, 'ja', true); // scaffolded and never translated
                writeFileSync(
                    join(publish, `${stamp}_24_translate-sync_sync-result.json`),
                    JSON.stringify({ ok: true, target: 'surfdash' }),
                );
                const res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status, res.stderr).toBe(0);
                const row = completenessOf(publish).rows.find((entry) => entry.channel === 'locales');
                expect(row?.state).toBe('failed');
                expect(row?.detail).toContain('ja draft is still a scaffold');
                expect(completenessOf(publish).missing).toContain('locales');
            });
        });

        it('locales requires ok sync result (0220 AC1)', () => {
            withTempDir((dir) => {
                const publish = seeded(dir);
                for (const locale of ['en', 'ja']) localeDraft(publish, locale, false);
                // Scaffolded but no sync result -> not-run with 'never synced'
                let res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status).toBe(0);
                let completeness = completenessOf(publish);
                let localesRow = completeness.rows.find((r) => r.channel === 'locales');
                expect(localesRow?.state).toBe('not-run');
                expect(localesRow?.detail).toContain('never synced');
                expect(res.stderr).toContain('WARNING: publish completeness');

                // With ok: false sync result -> failed with error
                writeFileSync(
                    join(publish, `${stamp}_24_translate-sync_sync-result.json`),
                    JSON.stringify({ ok: false, error: 'connection reset' }),
                );
                res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status).toBe(0);
                completeness = completenessOf(publish);
                localesRow = completeness.rows.find((r) => r.channel === 'locales');
                expect(localesRow?.state).toBe('failed');
                expect(localesRow?.detail).toBe('connection reset');

                // A present but malformed validator receipt is a failed locale gate, not a silent
                // fallback to the legacy sync branch.
                writeFileSync(join(publish, `${stamp}_24_translate-validate_result.json`), '{not-json');
                res = run(['daily-publish-completeness', dir, stamp]);
                expect(res.status).toBe(0);
                localesRow = completenessOf(publish).rows.find((r) => r.channel === 'locales');
                expect(localesRow?.state).toBe('failed');
                expect(localesRow?.detail).toContain('missing or malformed');
            });
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
            for (const sub of ['21-plan', '22-article']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            writeFileSync(join(dir, `21-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a' }]));
            expect(run(['daily-article', dir, stamp, ''], { ...env, ENV_DUMP: envDump }).status).toBe(0);
            expect(JSON.parse(readFileSync(envDump, 'utf-8'))).toEqual({ ART_DATE: undefined, ARTICLE_DATE: stamp });
        });
    });

    it('daily-qc-content empties a thin pool below the floor so no TTS is spent (2026-10-12)', () => {
        withTempDir((dir) => {
            // ≈ the 04:30 pool of 2026-10-11: three short items, which scripted to a 4.0-minute episode.
            const thin = [
                { id: 'a', title: 'A', body: 'x'.repeat(600) },
                { id: 'b', title: 'B', body: 'x'.repeat(500) },
                { id: 'c', title: 'C', body: 'x'.repeat(540) },
            ];
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    `fs.writeFileSync(out, JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs: ${JSON.stringify(thin)} } }));`,
                ].join('\n'),
            );
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const stamp = '20261011';
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_plan_content.json`),
                JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs: thin } }),
            );
            const res = run(
                ['daily-qc-content', dir, stamp, '', 'ai-news', '2', '3', '2', '1', '8', '15', 'gemini'],
                env,
            );
            expect(res.status, res.stderr).toBe(0);
            const candidates = JSON.parse(
                readFileSync(join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`), 'utf-8'),
            ) as { metadata: { docs: unknown[] } };
            // Emptied: every downstream `pool-count --min 1` guard now skips the spending subtree.
            expect(candidates.metadata.docs).toEqual([]);
            const refusal = JSON.parse(
                readFileSync(join(dir, `21-plan/${stamp}_04_quality-control-content_floor-refusal.json`), 'utf-8'),
            ) as { estimatedMinutes: number; minMinutes: number; ids: string[] };
            expect(refusal.minMinutes).toBe(15);
            expect(refusal.estimatedMinutes).toBeLessThan(15);
            expect(refusal.ids).toEqual(['a', 'b', 'c']);
            expect(res.stderr).toContain('floor gate');
        });
        // Spawns stage subprocesses; the full apps/cli suite runs these concurrently and
        // pushes ~1.8s standalone work past bun's 5s default (0392).
    }, 120000);

    it('daily-qc-content keeps a pool that clears the floor and never gates without the arg', () => {
        withTempDir((dir) => {
            // Distinct titles: the QC stage's title-similarity dedup would merge `Item 1`/`Item 2`.
            const titles = [
                'DuckDB 并行执行重构',
                'Deno 团队被收购',
                '微软发布端侧笔记本',
                '澳洲数据中心撤回募资',
                '一只鸟喂食器',
                '默认分词器切换',
                '边缘运行时路线',
            ];
            // 0377: the floor gate now uses the worst measured spoken/raw ratio (0.28), not the
            // typical 1.4, so "clears the floor" needs ~2.3k chars/doc at 15 min / gemini (4.95 cps):
            // 7 x 2,310 = 16,170 chars -> 16,170 * 0.28 / 4.95 = 915 s = 15.2 min.
            const fat = titles.map((title, i) => ({ id: `d${i}`, title, body: 'y'.repeat(2300) }));
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    `fs.writeFileSync(out, JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs: ${JSON.stringify(fat)} } }));`,
                ].join('\n'),
            );
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const stamp = '20261011';
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_plan_content.json`),
                JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs: fat } }),
            );
            const candidatesPath = join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`);
            const above = run(
                ['daily-qc-content', dir, stamp, '', 'ai-news', '2', '3', '2', '1', '8', '15', 'gemini'],
                env,
            );
            expect(above.status, above.stderr).toBe(0);
            const kept = JSON.parse(readFileSync(candidatesPath, 'utf-8')) as { metadata: { docs: unknown[] } };
            expect(kept.metadata.docs).toHaveLength(7);
            expect(existsSync(join(dir, `21-plan/${stamp}_04_quality-control-content_floor-refusal.json`))).toBe(false);
            expect(above.stdout).toContain('above the 15 min floor');

            // The legacy 9-arg call (voice1 and the fixtures it drives) has no floor argument: ungated.
            rmSync(candidatesPath, { force: true });
            const legacy = run(['daily-qc-content', dir, stamp, '', 'ai-news', '2', '3', '2', '1', '8'], env);
            expect(legacy.status, legacy.stderr).toBe(0);
            const keptLegacy = JSON.parse(readFileSync(candidatesPath, 'utf-8')) as { metadata: { docs: unknown[] } };
            expect(keptLegacy.metadata.docs).toHaveLength(7);
        });
        // Spawns stage subprocesses; the full apps/cli suite runs these concurrently and
        // pushes ~1.8s standalone work past bun's 5s default (0392).
    }, 120000);

    it('daily-qc-content re-estimates after the topic boundary so a shrink below the floor is refused pre-spend (2026-10-22)', () => {
        withTempDir((dir) => {
            // 2026-10-22 in miniature: four items clear 15 min, one is dropped by topic admission as a
            // public-policy dispute, and the surviving three fall under the floor. Gating before the
            // boundary cleared the four and the run paid for a synthesis the measured gate refused.
            const docs = [
                { id: 'keep1', title: 'DuckDB 并行执行重构', body: 'y'.repeat(900) },
                { id: 'keep2', title: 'Deno 团队被收购', body: 'y'.repeat(900) },
                { id: 'keep3', title: '微软发布端侧笔记本', body: 'y'.repeat(900) },
                { id: 'drop1', title: '习近平出席数据中心能耗座谈会', body: 'y'.repeat(900) },
            ];
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    `fs.writeFileSync(out, JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs: ${JSON.stringify(docs)} } }));`,
                ].join('\n'),
            );
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const stamp = '20261022';
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_plan_content.json`),
                JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs } }),
            );
            const res = run(
                ['daily-qc-content', dir, stamp, '', 'ai-news', '2', '3', '2', '1', '8', '15', 'voxcpm'],
                env,
            );
            expect(res.status, res.stderr).toBe(0);
            expect(res.stderr).toContain('floor gate');
            const candidates = JSON.parse(
                readFileSync(join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`), 'utf-8'),
            ) as { metadata: { docs: unknown[] } };
            expect(candidates.metadata.docs).toEqual([]);
            const refusal = JSON.parse(
                readFileSync(join(dir, `21-plan/${stamp}_04_quality-control-content_floor-refusal.json`), 'utf-8'),
            ) as { estimatedMinutes: number; ids: string[] };
            expect(refusal.ids).toEqual(['keep1', 'keep2', 'keep3']);
            expect(refusal.estimatedMinutes).toBeLessThan(15);
        });
        // Spawns stage subprocesses; the full apps/cli suite runs these concurrently and
        // pushes ~1.8s standalone work past bun's 5s default (0392).
    }, 120000);

    it('daily-qc-content records a dedup day whose counts reconcile (0392)', () => {
        withTempDir((dir) => {
            // 5-doc pool: 1 prc-leadership exclusion, 1 near-duplicate drop, 3 survivors. Running
            // totals must add up (preFilter = kept + excluded + deduped) or the run report prints a
            // MISMATCH on every ordinary dedup day.
            const docs = [
                { id: 'keep1', title: 'DuckDB 并行执行重构', body: 'x'.repeat(600) },
                { id: 'dup1', title: 'DuckDB 并行执行重构', body: 'x'.repeat(600) },
                { id: 'keep2', title: 'Deno 团队被收购', body: 'x'.repeat(600) },
                { id: 'keep3', title: '微软发布端侧笔记本', body: 'x'.repeat(600) },
                { id: 'drop1', title: '习近平出席数据中心能耗座谈会', body: 'x'.repeat(600) },
            ];
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    `fs.writeFileSync(out, JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs: ${JSON.stringify(docs)} } }));`,
                ].join('\n'),
            );
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const stamp = '20261117';
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_plan_content.json`),
                JSON.stringify({ body: '', title: 'T', format: 'markdown', metadata: { docs } }),
            );
            // Legacy 9-arg call: no floor argument, so the floor stage stays out of this count.
            const res = run(['daily-qc-content', dir, stamp, '', 'ai-news', '2', '3', '2', '1', '8'], env);
            expect(res.status, res.stderr).toBe(0);
            const candidates = JSON.parse(
                readFileSync(join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`), 'utf-8'),
            ) as { metadata: { docs: { id: string }[] } };
            expect(candidates.metadata.docs.map((doc) => doc.id)).toEqual(['keep1', 'keep2', 'keep3']);
            const artifact = JSON.parse(readFileSync(join(dir, '21-plan/topic-selection-attempts.json'), 'utf-8')) as {
                attempts: { counts: Record<string, number | null> }[];
                reconciliation: { reconciled: boolean; issues: string[] };
            };
            expect(artifact.attempts[0]?.counts).toMatchObject({
                preFilter: 5,
                kept: 3,
                uniqueExcluded: 1,
                deduped: 1,
            });
            expect(artifact.reconciliation.issues).toEqual([]);
            expect(artifact.reconciliation.reconciled).toBe(true);
        });
    });

    // 0392 R2: the artifact is staged, not written once. Each later stage amends the attempt already
    // on disk, so one run day keeps ONE attempt whatever the pipeline depth.
    function seedAttempts(dir: string, stamp: string, ids: string[]): void {
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        const stages = [
            { stage: 'qc', input: ids.length, kept: ids.length, dropped: [] },
            { stage: 'topicBoundary', input: ids.length, kept: ids.length, dropped: [] },
            { stage: 'dedup', input: ids.length, kept: ids.length, dropped: [] },
        ];
        writeFileSync(
            join(dir, '21-plan/topic-selection-attempts.json'),
            JSON.stringify({
                version: 2,
                runDate: stamp,
                specVersion: 2,
                attempts: [
                    {
                        attempt: 1,
                        attemptId: `${stamp}#1`,
                        recordedAt: '2026-11-17T04:30:00.000Z',
                        specVersion: 2,
                        counts: {
                            preFilter: ids.length,
                            kept: ids.length,
                            uniqueExcluded: 0,
                            deduped: 0,
                            planned: null,
                        },
                        stages,
                        perRuleHits: {},
                        exclusions: [],
                        curationExcluded: [],
                        multipleHitIds: [],
                        keptIds: ids,
                        channelAdmission: [],
                        stageEvidence: {
                            qc: 'observed',
                            topicBoundary: 'observed',
                            dedup: 'observed',
                            floor: 'unknown',
                            curation: 'unknown',
                            plan: 'unknown',
                            channelAdmission: 'unknown',
                        },
                    },
                ],
                reconciliation: {},
            }),
        );
    }

    type Artifact = {
        attempts: {
            counts: Record<string, number | null>;
            stages: { stage: string; input: number; kept: number; dropped: string[] }[];
            curationExcluded: { id: string; reason: string }[];
            channelAdmission: { scope: string; status: string; targets: { target: string; decision: string }[] }[];
            stageEvidence: Record<string, string>;
        }[];
        reconciliation: { reconciled: boolean; issues: string[]; skippedStages: string[] };
    };

    it('daily-curate-check amends the attempt with curation + plan evidence (0392 R2)', () => {
        withTempDir((dir) => {
            const stamp = '20261117';
            seedAttempts(dir, stamp, ['a', 'b']);
            const candidates = join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`);
            writeFileSync(
                candidates,
                JSON.stringify({
                    metadata: {
                        docs: [
                            { id: 'a', title: 'A' },
                            { id: 'b', title: 'B' },
                        ],
                    },
                }),
            );
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_plan_plan.json`),
                JSON.stringify([{ id: 'a', title: '条目A' }]),
            );
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_curate_excluded.json`),
                JSON.stringify([{ id: 'b', reason: '低价值公关通稿' }]),
            );

            const res = run(['daily-curate-check', dir, stamp]);
            expect(res.status, res.stderr).toBe(0);
            const artifact = JSON.parse(
                readFileSync(join(dir, '21-plan/topic-selection-attempts.json'), 'utf-8'),
            ) as Artifact;
            // Amended, never appended: one run day, one attempt.
            expect(artifact.attempts).toHaveLength(1);
            const latest = artifact.attempts[0];
            expect(latest?.stages.map((entry) => entry.stage)).toEqual([
                'qc',
                'topicBoundary',
                'dedup',
                'curation',
                'plan',
            ]);
            // The agent's own reason is retained, and the curated plan becomes the headline kept count.
            expect(latest?.curationExcluded).toEqual([{ id: 'b', reason: '低价值公关通稿' }]);
            expect(latest?.counts.kept).toBe(1);
            expect(latest?.counts.planned).toBe(1);
            expect(latest?.stageEvidence.curation).toBe('observed');
            // Still unknown: the floor gate and the safety gate ran elsewhere.
            expect(artifact.reconciliation.skippedStages).toEqual(['floor', 'channelAdmission']);
            expect(artifact.reconciliation.reconciled).toBe(true);
            expect(artifact.reconciliation.issues).toEqual([]);
        });
    });

    it('daily-curate-check --final records the documented fallback as curation evidence (0392 R2)', () => {
        withTempDir((dir) => {
            const stamp = '20261117';
            seedAttempts(dir, stamp, ['a', 'b']);
            writeFileSync(
                join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`),
                JSON.stringify({
                    metadata: {
                        docs: [
                            { id: 'a', title: 'A' },
                            { id: 'b', title: 'B' },
                        ],
                    },
                }),
            );
            // No curated plan at all: the agent output is missing, so the check records a fallback.
            const res = run(['daily-curate-check', dir, stamp, '--final']);
            expect(res.status, res.stderr).toBe(0);
            const artifact = JSON.parse(
                readFileSync(join(dir, '21-plan/topic-selection-attempts.json'), 'utf-8'),
            ) as Artifact;
            const latest = artifact.attempts[0];
            // The fallback keeps every candidate and excludes nothing — recorded, not silent.
            expect(latest?.stages).toContainEqual({ stage: 'curation', input: 2, kept: 2, dropped: [] });
            expect(latest?.counts.kept).toBe(2);
            expect(latest?.stageEvidence.curation).toBe('observed');
            expect(artifact.reconciliation.reconciled).toBe(true);
        });
    });

    it('daily-safety-gate records channel admission without touching the candidate totals (0392 R2)', () => {
        withTempDir((dir) => {
            const stamp = '20261117';
            seedAttempts(dir, stamp, ['a', 'b']);
            mkdirSync(join(dir, '24-script'), { recursive: true });
            mkdirSync(join(dir, '22-article'), { recursive: true });
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(join(dir, `24-script/${stamp}_08_script_voicescript.yaml`), 'segments: []\n');
            const prep = run(['daily-safety-prep', dir, stamp, 'xiaoyuzhou,wechatmp']);
            expect(prep.status, prep.stderr).toBe(0);
            const at = (name: string) => join(dir, '24-script', `${stamp}_09_${name}`);
            writeFileSync(
                at('safety-review_report.json'),
                JSON.stringify({
                    platforms: [
                        { platform: 'xiaoyuzhou', decision: 'OK' },
                        { platform: 'wechatmp', decision: 'BLOCK', findings: [{ category: 2, item: 'WX-02' }] },
                    ],
                }),
            );
            writeFileSync(
                at('safety-judge_verdict.json'),
                JSON.stringify({
                    verdict: 'FAIL',
                    confidence: 'LOW',
                    findings: [{ criterion: 'jurisdictional-rules', status: 'fail' }],
                }),
            );
            expect(run(['daily-safety-gate', dir, stamp, '0']).status).toBe(0);
            const artifact = JSON.parse(
                readFileSync(join(dir, '21-plan/topic-selection-attempts.json'), 'utf-8'),
            ) as Artifact;
            const latest = artifact.attempts[0];
            expect(latest?.channelAdmission[0]?.targets).toEqual([
                { target: 'xiaoyuzhou', decision: 'OK' },
                { target: 'wechatmp', decision: 'BLOCK' },
            ]);
            expect(latest?.channelAdmission[0]?.status).toBe('exclude');
            // A channel outcome is a target decision; it never moves the candidate totals.
            expect(latest?.counts).toMatchObject({ preFilter: 2, kept: 2, uniqueExcluded: 0, deduped: 0 });
            expect(latest?.stageEvidence.channelAdmission).toBe('observed');
            expect(artifact.reconciliation.skippedStages).toEqual(['floor', 'curation', 'plan']);
        });
    });

    it('daily-extract widens the store window only while the pool misses the floor (2026-10-19)', () => {
        withTempDir((dir) => {
            const calls = join(dir, 'calls.log');
            // 24h answers three 600-char items; every wider window answers eight 2.1k-char items.
            // 0377: the widen decision uses the worst measured ratio (0.28) at voxcpm's 5.2 cps, so the
            // rich rung is 8 x 2,110 = 16,880 chars -> 909 s = 15.1 min, just over the 15 min floor.
            // The stage must stop at the first window that clears it.
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const win = args[args.indexOf('--window') + 1];",
                    "const out = args[args.indexOf('--out') + 1];",
                    'fs.appendFileSync(process.env.CALLS, win + "\\n");',
                    'const thin = win === "24h";',
                    'const docs = Array.from({ length: thin ? 3 : 8 }, (_, i) => ({ id: win + i, title: "T" + i, body: (thin ? "x" : "y").repeat(thin ? 600 : 2100) }));',
                    'fs.writeFileSync(out, JSON.stringify(docs));',
                ].join('\n'),
            );
            const poolPath = join(dir, '10-collect/pool.json');
            const res = run(['daily-extract', dir, 'ai-news', '24h', '15', 'voxcpm'], { ...env, CALLS: calls });
            expect(res.status, res.stderr).toBe(0);
            expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['24h', '48h']);
            expect((JSON.parse(readFileSync(poolPath, 'utf-8')) as unknown[]).length).toBe(8);
            expect(res.stderr).toContain('below the 15 min floor');
            expect(res.stderr).toContain('clears the 15 min floor');
            // The intermediate attempt files are gone: only pool.json is left for the plan stage.
            expect(existsSync(join(dir, '10-collect/.pool-24h.json'))).toBe(false);
            expect(existsSync(join(dir, '10-collect/.pool-48h.json'))).toBe(false);

            // Without a floor (voice1's legacy 4-arg call) the configured window is the only query.
            writeFileSync(calls, '');
            const ungated = run(['daily-extract', dir, 'ai-news', '24h'], { ...env, CALLS: calls });
            expect(ungated.status, ungated.stderr).toBe(0);
            expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['24h']);
            expect((JSON.parse(readFileSync(poolPath, 'utf-8')) as unknown[]).length).toBe(3);

            // Every rung misses the floor: the ladder stops at the 168h cap and the WIDEST pool is
            // written, so a genuinely thin day closes as no-content on the best candidates it has
            // rather than on the narrowest window.
            fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const win = args[args.indexOf('--window') + 1];",
                    "const out = args[args.indexOf('--out') + 1];",
                    'fs.appendFileSync(process.env.CALLS, win + "\\n");',
                    'fs.writeFileSync(out, JSON.stringify([{ id: win, title: "T", body: "x".repeat(600) }]));',
                ].join('\n'),
            );
            writeFileSync(calls, '');
            const capped = run(['daily-extract', dir, 'ai-news', '24h', '60', 'voxcpm'], { ...env, CALLS: calls });
            expect(capped.status, capped.stderr).toBe(0);
            expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['24h', '48h', '72h', '168h']);
            expect((JSON.parse(readFileSync(poolPath, 'utf-8')) as { id: string }[]).map((d) => d.id)).toEqual([
                '168h',
            ]);
        });
        // Six stage subprocesses land ~5.3s under gate load — over bun's 5s default.
        // Six stage subprocesses: ~5.3s idle, 45s+ on a loaded machine (a full suite runs these
        // concurrently). Budget only; the assertions are unchanged.
    }, 120000);

    it('daily-article unwraps a plan.json that carries the Content envelope instead of the Doc[]', () => {
        // `plan-translate`'s executor has been observed writing the generator's Content envelope
        // back to the plan path — valid JSON of the wrong shape. The article generator refuses it
        // with `expected array, received object`, so the stage must unwrap `metadata.docs` in place
        // (every later reader — script, show notes — reads this same file as a Doc[]).
        withTempDir((dir) => {
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    'const out = args[args.indexOf("--out") + 1];',
                    'fs.writeFileSync(out, JSON.stringify({ body: "# article" }));',
                ].join('\n'),
            );
            for (const sub of ['21-plan', '22-article']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const planPath = join(dir, `21-plan/${stamp}_03_plan_plan.json`);
            const docs = [
                { id: 'a', title: 'A', body: 'translated a' },
                { id: 'b', title: 'B', body: 'translated b' },
            ];
            writeFileSync(
                planPath,
                JSON.stringify({ title: 'plan', body: '# plan', format: 'markdown', metadata: { docs } }),
            );
            writeFileSync(
                join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`),
                JSON.stringify({ metadata: { docs: [{ id: 'a', title: 'A', body: 'untranslated a' }] } }),
            );
            expect(run(['daily-article', dir, stamp, ''], env).status).toBe(0);
            // The envelope is replaced by its own docs — not by the untranslated candidates.
            expect(JSON.parse(readFileSync(planPath, 'utf-8'))).toEqual(docs);
        });
    });

    it('daily-publish-prep stamps the ID3 tags on the MP3 enclosure and drops an absent cover path', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const audio = join(dir, '30-audio/content.mp3');
            const record = join(dir, 'ffmpeg-argv.json');
            writeFileSync(audio, 'mp3-bytes');
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: audio, duration: 12 } }),
            );
            passSafety(dir, stamp);
            expect(
                run(['daily-publish-prep', dir, stamp, 'Robin Min', '咸话咸说'], fakeFfmpeg(dir, record)).status,
            ).toBe(0);
            // R3: ID3v2.3 title/artist/album/date copy-stamped onto the MP3 (title from the
            // article, date from the digits-only run_date) — no re-encode.
            expect(JSON.parse(readFileSync(record, 'utf-8'))).toEqual([
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                audio,
                '-c',
                'copy',
                '-id3v2_version',
                '3',
                '-metadata',
                'title=T',
                '-metadata',
                'artist=Robin Min',
                '-metadata',
                'album=咸话咸说',
                '-metadata',
                'date=2026-01-01',
                `${audio}.id3.tmp.mp3`,
            ]);
            // temp-then-rename: the tagged bytes land on the original path and the tmp is gone.
            expect(readFileSync(audio, 'utf-8')).toBe('tagged');
            expect(existsSync(`${audio}.id3.tmp.mp3`)).toBe(false);
            const merged = JSON.parse(
                readFileSync(join(dir, `31-publish/${stamp}_13_publish-prep_content.json`), 'utf-8'),
            ) as { metadata: Record<string, unknown>; options: Record<string, unknown> };
            expect(merged.metadata.audioFile).toBe(audio);
            expect(merged.metadata.runDate).toBe(stamp);
            expect(merged.metadata.itunes).toEqual({ season: 2026, episode: 1 });
            expect(merged.options.durationSec).toBe(12);
            expect('coverPath' in merged.options).toBe(false);
        });
    });

    it('daily-publish-prep derives itunes season/episode from a dashed run_date (year, day-of-year)', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '2026-09-29';
            const audio = join(dir, '30-audio/content.mp3');
            writeFileSync(audio, 'mp3-bytes');
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: audio, duration: 12 } }),
            );
            passSafety(dir, stamp);
            expect(
                run(['daily-publish-prep', dir, stamp, '', ''], fakeFfmpeg(dir, join(dir, 'ffmpeg-argv.json'))).status,
            ).toBe(0);
            const merged = JSON.parse(
                readFileSync(join(dir, `31-publish/${stamp}_13_publish-prep_content.json`), 'utf-8'),
            ) as { metadata: Record<string, unknown> };
            expect(merged.metadata.itunes).toEqual({ season: 2026, episode: 272 });
        });
    });

    it('daily-publish-prep omits the artist/album tags when those vars are empty', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const audio = join(dir, '30-audio/content.mp3');
            const record = join(dir, 'ffmpeg-argv.json');
            writeFileSync(audio, 'mp3-bytes');
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { mp3Path: audio, duration: 12 } }),
            );
            passSafety(dir, stamp);
            expect(run(['daily-publish-prep', dir, stamp, '', ''], fakeFfmpeg(dir, record)).status).toBe(0);
            const argv = JSON.parse(readFileSync(record, 'utf-8')) as string[];
            expect(argv.filter((arg) => arg.startsWith('artist=') || arg.startsWith('album='))).toEqual([]);
            expect(argv).toContain('title=T');
        });
    });

    it('daily-publish-prep refuses drafts with no safety stamp, or edited after the stamp (0189 R10)', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const audio = join(dir, '30-audio/content.mp3');
            const article = join(dir, `22-article/${stamp}_06_article_content.json`);
            const prep = join(dir, `31-publish/${stamp}_13_publish-prep_content.json`);
            writeFileSync(audio, 'mp3-bytes');
            writeFileSync(article, JSON.stringify({ title: 'T', body: 'B' }));
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: audio, duration: 12 } }),
            );
            const env = fakeFfmpeg(dir, join(dir, 'ffmpeg-argv.json'));
            const unreviewed = run(['daily-publish-prep', dir, stamp, '', ''], env);
            expect(unreviewed.status).not.toBe(0);
            expect(unreviewed.stderr).toContain('content-safety');
            passSafety(dir, stamp);
            writeFileSync(article, JSON.stringify({ title: 'T', body: 'edited after PASS' }));
            const stale = run(['daily-publish-prep', dir, stamp, '', ''], env);
            expect(stale.status).not.toBe(0);
            expect(stale.stderr).toContain('changed after');
            expect(existsSync(prep)).toBe(false);
        });
    });

    it('20261005 — an admission-only exclusion is stamped, prep accepts it, and the excluded platform rides the merge', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '24-script', '30-audio', '31-publish'])
                mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const audio = join(dir, '30-audio/content.mp3');
            writeFileSync(audio, 'mp3-bytes');
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `24-script/${stamp}_08_script_voicescript.yaml`),
                'title: T\nsegments:\n  - text: 大家好。\n',
            );
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: audio, duration: 12 } }),
            );
            const at = (name: string) => join(dir, '24-script', `${stamp}_09_${name}`);
            expect(run(['daily-safety-prep', dir, stamp, 'wechatmp']).status).toBe(0);
            writeFileSync(
                at('safety-review_report.json'),
                JSON.stringify({
                    platforms: [
                        { platform: 'wechatmp', decision: 'BLOCK', findings: [{ category: 2, item: 'WX-02' }] },
                    ],
                    escalate: true,
                }),
            );
            writeFileSync(
                at('safety-judge_verdict.json'),
                JSON.stringify({
                    verdict: 'FAIL',
                    confidence: 'LOW',
                    findings: [{ criterion: 'jurisdictional-rules', status: 'fail' }],
                }),
            );
            // Budget 0 = the remediation passes are already spent.
            expect(run(['daily-safety-gate', dir, stamp, '0']).status).toBe(0);
            expect(readFileSync(at('safety-judge_status.txt'), 'utf-8')).toBe('exclude');
            const env = fakeFfmpeg(dir, join(dir, 'ffmpeg-argv.json'));
            expect(run(['daily-publish-prep', dir, stamp, '', ''], env).status).toBe(0);
            const merged = JSON.parse(
                readFileSync(join(dir, `31-publish/${stamp}_13_publish-prep_content.json`), 'utf-8'),
            ) as { metadata: { safetyExcludedPlatforms?: string[] } };
            expect(merged.metadata.safetyExcludedPlatforms).toEqual(['wechatmp']);
        });
    });

    it('20261005 — daily-publish-wechat skips a platform the safety gate excluded, and the run continues', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '24-script', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            writeFileSync(
                join(dir, `24-script/${stamp}_09_safety-judge_stamp.json`),
                JSON.stringify({ digest: 'd', status: 'exclude', excludedPlatforms: ['wechatmp'] }),
            );
            const result = run(['daily-publish-wechat', dir, stamp, '', 'false', 'AI 乱炖']);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('SKIPPED');
            expect(existsSync(join(dir, `31-publish/${stamp}_20_publish-wechat_content.json`))).toBe(false);
        });
    });

    it('daily-publish-prep rejects a non-MP3 enclosure naming transcode_mp3', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const wav = join(dir, '30-audio/content.wav');
            writeFileSync(wav, 'RIFF-fake-wave');
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: wav, duration: 12 } }),
            );
            const result = run(
                ['daily-publish-prep', dir, stamp, 'Robin Min', '咸话咸说'],
                fakeFfmpeg(dir, join(dir, 'ffmpeg-argv.json')),
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('publish-prep: resolved audio is not an MP3');
            expect(result.stderr).toContain('transcode_mp3');
            expect(existsSync(join(dir, `31-publish/${stamp}_13_publish-prep_content.json`))).toBe(false);
        });
    });

    it('daily-publish-prep fails the stage when the ffmpeg ID3 stamp fails, leaving the audio untouched', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const audio = join(dir, '30-audio/content.mp3');
            writeFileSync(audio, 'mp3-bytes');
            writeFileSync(
                join(dir, `22-article/${stamp}_06_article_content.json`),
                JSON.stringify({ title: 'T', body: 'B' }),
            );
            writeFileSync(
                join(dir, `30-audio/${stamp}_11_generate_content.json`),
                JSON.stringify({ metadata: { audioPath: audio, duration: 12 } }),
            );
            const result = run(
                ['daily-publish-prep', dir, stamp, 'Robin Min', '咸话咸说'],
                fakeFfmpeg(dir, join(dir, 'ffmpeg-argv.json'), 1),
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('publish-prep: ffmpeg ID3 stamp failed: ffmpeg: boom');
            expect(readFileSync(audio, 'utf-8')).toBe('mp3-bytes');
            expect(existsSync(`${audio}.id3.tmp.mp3`)).toBe(false);
            expect(existsSync(join(dir, `31-publish/${stamp}_13_publish-prep_content.json`))).toBe(false);
        });
    });

    it('daily-publish-prep fails loud when the voice content carries no audio path', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            writeFileSync(join(dir, `22-article/${stamp}_06_article_content.json`), JSON.stringify({ title: 'T' }));
            writeFileSync(join(dir, `30-audio/${stamp}_11_generate_content.json`), JSON.stringify({ metadata: {} }));
            const result = run(['daily-publish-prep', dir, stamp]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('publish-prep: voice content carries no mp3Path/audioPath');
        });
    });

    it('daily-publish-prep fails loud naming the path when the article content file is missing (date-shape mismatch)', () => {
        withTempDir((dir) => {
            for (const sub of ['22-article', '30-audio', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
            const result = run(['daily-publish-prep', dir, '2026-01-01']);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                `required input not found or unparsable: ${join(dir, '22-article/2026-01-01_06_article_content.json')}`,
            );
        });
    });

    it('daily-cover-normalize renames the manifest-recorded png cover and clears the stale artifacts', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            // F614: the artifact name follows the format preset; normalize follows the manifest.
            const artifact = join(cover, 'content-daily-news-cover-01.png');
            writeFileSync(artifact, 'png');
            writeFileSync(join(cover, 'content-cover-01.png'), 'stale-png');
            writeFileSync(join(cover, 'content-cover-01.jpg'), 'stale-jpg');
            writeFileSync(join(cover, 'content.json'), JSON.stringify({ metadata: { images: [{ path: artifact }] } }));
            expect(run(['daily-cover-normalize', dir, '20260101']).status).toBe(0);
            expect(readFileSync(join(cover, '20260101_07_cover_cover.png'), 'utf-8')).toBe('png');
            expect(existsSync(artifact)).toBe(false);
            expect(existsSync(join(cover, 'content-cover-01.png'))).toBe(false);
            expect(existsSync(join(cover, 'content-cover-01.jpg'))).toBe(false);
        });
    });

    // sips ships only on macOS; ubuntu CI cannot exercise the real transcode. The
    // absent-sips failure path stays covered platform-neutrally by the fails-loud test below.
    const itMacOnly = it.skipIf(process.platform !== 'darwin');
    itMacOnly('daily-cover-normalize transcodes a manifest-recorded jpg cover via sips', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            const artifact = join(cover, 'content-daily-news-cover-01.jpg');
            writeFileSync(artifact, JPEG_BYTES);
            writeFileSync(join(cover, 'content.json'), JSON.stringify({ metadata: { images: [{ path: artifact }] } }));
            expect(run(['daily-cover-normalize', dir, '20260101']).status).toBe(0);
            expect(existsSync(join(cover, '20260101_07_cover_cover.png'))).toBe(true);
            expect(existsSync(artifact)).toBe(false);
        });
    });

    it('daily-cover-normalize fails loud when the manifest is missing or carries no image path', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '23-cover'), { recursive: true });
            const missing = run(['daily-cover-normalize', dir, '20260101']);
            expect(missing.status).toBe(1);
            expect(missing.stderr).toContain('cover normalize: no image artifact in 23-cover/content.json');

            writeFileSync(join(dir, '23-cover/content.json'), JSON.stringify({ metadata: { images: [] } }));
            const empty = run(['daily-cover-normalize', dir, '20260101']);
            expect(empty.status).toBe(1);
            expect(empty.stderr).toContain('cover normalize: no image artifact in 23-cover/content.json');
        });
    });

    it('daily-cover-normalize fails loud when sips is absent for a jpg cover', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            const artifact = join(cover, 'content-daily-news-cover-01.jpg');
            writeFileSync(artifact, 'jpg');
            writeFileSync(join(cover, 'content.json'), JSON.stringify({ metadata: { images: [{ path: artifact }] } }));
            // Keep `bun` resolvable but drop `sips` from PATH: a bin dir holding only a bun symlink.
            const bin = join(dir, 'only-bun');
            mkdirSync(bin, { recursive: true });
            symlinkSync(process.execPath, join(bin, 'bun'));
            const result = run(['daily-cover-normalize', dir, '20260101'], { PATH: bin });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('cover normalize: sips not found; cannot transcode jpg -> png');
            expect(existsSync(join(dir, '23-cover/20260101_07_cover_cover.png'))).toBe(false);
        });
    });

    /**
     * E8: a fake `kk` for the XHS stages. Records every argv line, then answers as the real plugin
     * would: `image-gen` writes the artifact beside `--out` plus a Content recording its path and
     * composed prompt (what `daily-xhs-render` reads back), `xhs-pub` writes its own Result.
     */
    function fakeXhsKk(
        dir: string,
        record: string,
        mode: 'image-gen' | 'xhs-pub' | 'wechatmp-pub',
        exitCode = 0,
    ): Record<string, string> {
        const respond =
            mode === 'image-gen'
                ? [
                      'const spec = JSON.parse(fs.readFileSync(at("--in"), "utf8"))[0].metadata.imageGen;',
                      'const artifact = at("--out").replace(/.json$/, "") + "-" + spec.format + "-01.png";',
                      'fs.writeFileSync(artifact, "png");',
                      'const illus = at("--out").replace(/.json$/, "") + "-illustration-01.png";',
                      'fs.writeFileSync(illus, "png");',
                      'fs.writeFileSync(at("--out"), JSON.stringify({ metadata: { images: [{ path: artifact, prompt: "flat illustration " + spec.vars.subject, illustration: { path: illus, bytes: 3 } }] } }));',
                  ]
                : [
                      'const payload = JSON.parse(fs.readFileSync(at("--in"), "utf8"));',
                      'fs.writeFileSync(at("--out"), JSON.stringify({ ok: true, target: "xhs-pub", metadata: { publishStatus: payload.metadata.publishStatus } }));',
                  ];
        return fakeKk(
            dir,
            [
                "const fs = require('node:fs');",
                'const argv = process.argv.slice(2);',
                `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + '\\n');`,
                `if (${exitCode} !== 0) process.exit(${exitCode});`,
                'const at = (name) => argv[argv.indexOf(name) + 1];',
                ...respond,
            ].join('\n'),
        );
    }

    function xhsCard(role: string, copy: string, sourcePoint: string) {
        return { role, copy, points: [`${copy}-要点`], layout: 'definition', subject: 'a desk', sourcePoint };
    }

    it('daily-xhs-render builds one pinned envelope per card and packages the images in card order (E8)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({
                    title: '今日 AI 速览',
                    body: '正文 #AI',
                    cards: [xhsCard('cover', '今日头条', 'lead fact'), xhsCard('content', '模型发布', 'detail fact')],
                }),
            );
            const result = run(
                ['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', 'minimax', 'image-01'],
                env,
            );
            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);

            // One provider call per card, in card order — the series is never fanned out.
            const calls = readFileSync(record, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            expect(calls.length).toBe(2);
            type Envelope = {
                format: string;
                style: string;
                provider: string;
                model: string;
                maxImages: number;
                vars: Record<string, string>;
            };
            const specs = calls.map((argv) => {
                expect(argv.slice(0, 3)).toEqual(['executor', 'run', 'image-gen']);
                const inPath = argv[argv.indexOf('--in') + 1];
                if (inPath === undefined) throw new Error(`no --in in: ${argv.join(' ')}`);
                const docs = JSON.parse(readFileSync(inPath, 'utf-8')) as {
                    metadata: { imageGen: Envelope };
                }[];
                return docs[0]?.metadata.imageGen as Envelope;
            });
            expect(specs.map((spec) => spec.vars.index)).toEqual(['01', '02']);
            for (const spec of specs) {
                // Pinned by the stage, never model-authored: a plan cannot drift the card look.
                expect(spec.format).toBe('xhs-card');
                expect(spec.style).toBe('xhs-knowledge');
                expect(spec.provider).toBe('minimax');
                expect(spec.model).toBe('image-01');
                expect(spec.maxImages).toBe(1);
                // 0181: card copy is typeset by image-gen's composer — no language var.
                expect(spec.vars.language).toBeUndefined();
            }
            expect(specs[1]?.vars.role).toBe('content');

            const content = JSON.parse(readFileSync(join(xhs, 'content.json'), 'utf-8')) as {
                title: string;
                metadata: { images: { path: string }[]; publishStatus: string };
            };
            expect(content.title).toBe('今日 AI 速览');
            expect(content.metadata.publishStatus).toBe('draft');
            expect(content.metadata.images.map((image) => image.path)).toEqual([
                join(xhs, 'cards/card-01-xhs-card-01.png'),
                join(xhs, 'cards/card-02-xhs-card-01.png'),
            ]);
            // Provenance (source point, layout, prompt path) stays in the manifest, not the DTO.
            const manifest = JSON.parse(readFileSync(join(xhs, 'cards.json'), 'utf-8')) as {
                cards: { sourcePoint: string; status: string; illustrationPath?: string }[];
            };
            expect(manifest.cards.map((card) => card.status)).toEqual(['rendered', 'rendered']);
            expect(manifest.cards[0]?.sourcePoint).toBe('lead fact');
            // 0181: the text-free illustration layer is recorded beside the card image.
            expect(manifest.cards[0]?.illustrationPath).toBe(join(xhs, 'cards/card-01-illustration-01.png'));
            expect(manifest.cards[1]?.illustrationPath).toBe(join(xhs, 'cards/card-02-illustration-01.png'));
            expect(readFileSync(join(xhs, 'cards/card-01.prompt.txt'), 'utf-8')).toBe('flat illustration a desk');
        });
    });

    const writeXhsPlan = (dir: string) => {
        const xhs = join(dir, '25-xhs');
        mkdirSync(xhs, { recursive: true });
        writeFileSync(
            join(xhs, '20260101_18_xhs_plan.json'),
            JSON.stringify({
                title: '今日 AI 速览',
                body: '正文 #AI',
                cards: [xhsCard('cover', '今日头条', 'lead fact'), xhsCard('content', '模型发布', 'detail fact')],
            }),
        );
    };

    /** 0235: the episode's cover artifact (`daily-cover`'s own output) that the note attaches last. */
    const writeEpisodeCover = (dir: string): string => {
        mkdirSync(join(dir, '23-cover'), { recursive: true });
        const cover = join(dir, '23-cover/20260101_07_cover_cover.png');
        writeFileSync(cover, 'png');
        return cover;
    };

    /** 0235 R1: a 6-card episode plan — cover, four episode items, closing. */
    const writeEpisodePlan = (dir: string, body: string) => {
        const xhs = join(dir, '25-xhs');
        mkdirSync(xhs, { recursive: true });
        const cards = [
            xhsCard('cover', '今日头条', 'lead fact'),
            xhsCard('content', '模型发布', 'fact 2'),
            xhsCard('content', '芯片禁令', 'fact 3'),
            xhsCard('content', '开源权重', 'fact 4'),
            xhsCard('content', '评测榜单', 'fact 5'),
            xhsCard('closing', '明天见', 'closing fact'),
        ];
        writeFileSync(join(xhs, '20260101_18_xhs_plan.json'), JSON.stringify({ title: '今日 AI 速览', body, cards }));
        return cards;
    };

    /** The card artifacts the fake `image-gen` writes, in attach order. */
    const cardImagePaths = (dir: string, count: number): string[] =>
        Array.from({ length: count }, (_, i) =>
            join(dir, `25-xhs/cards/card-${`${i + 1}`.padStart(2, '0')}-xhs-card-01.png`),
        );

    /** 0235 R4: the 9-arg voice2 call — `note_scope` trails the 0219 `fallback` slot. */
    const episodeArgs = (dir: string, count: number, fallback = ''): string[] => [
        'daily-xhs-render',
        dir,
        '20260101',
        '',
        `${count}`,
        'xhs-knowledge',
        'minimax',
        'image-01',
        fallback,
        'episode',
    ];

    it('daily-xhs-render with note_scope=episode appends the episode cover and pairs every image with its own text (0235 R1/R2)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            const cards = writeEpisodePlan(dir, '本期三件事 #AI #模型');
            const cover = writeEpisodeCover(dir);

            const result = run(episodeArgs(dir, 6, 'true'), env);
            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);

            const content = JSON.parse(readFileSync(join(dir, '25-xhs/content.json'), 'utf-8')) as {
                format: string;
                body: string;
                metadata: { images: { path: string }[]; publishStatus: string };
            };
            // R1: the cards in card order, then the ultrawide episode cover last.
            expect(content.metadata.images.map((image) => image.path)).toEqual([...cardImagePaths(dir, 6), cover]);
            expect(content.metadata.publishStatus).toBe('draft');
            expect(content.format).toBe('text');

            // R2: one numbered line per attached image, in attach order.
            const lines = content.body.split('\n');
            const numbered = lines.filter((line) => /^[①-⑱]/.test(line));
            expect(numbered.length).toBe(7);
            cards.forEach((card, index) => {
                expect(numbered[index]).toContain(card.copy);
                expect(numbered[index]).toContain(card.points[0] ?? '');
            });
            expect(numbered[6]).toContain('本期封面');
            expect(numbered[6]).toContain('20260101');
            // The LLM paragraph stays the lead above the list; hashtags stay last.
            expect(lines[0]).toBe('本期三件事');
            expect(lines.at(-1)).toBe('#AI #模型');
            expect(content.body.length).toBeLessThanOrEqual(1000);
        });
    });

    it('daily-xhs-render with note_scope=episode but no episode cover keeps the cards and names the missing cover (0235 R1)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            writeEpisodePlan(dir, '本期三件事 #AI');

            const result = run(episodeArgs(dir, 6), env);
            expect(result.status).toBe(0);
            expect(result.stderr).toBe('');
            expect(result.stdout).toContain(`no episode cover at ${join(dir, '23-cover/20260101_07_cover_cover.png')}`);

            const content = JSON.parse(readFileSync(join(dir, '25-xhs/content.json'), 'utf-8')) as {
                body: string;
                metadata: { images: { path: string }[] };
            };
            expect(content.metadata.images.map((image) => image.path)).toEqual(cardImagePaths(dir, 6));
            expect(content.body.split('\n').filter((line) => /^[①-⑱]/.test(line)).length).toBe(6);
        });
    });

    it('daily-xhs-render trims only the lead paragraph when the episode body would overflow 1000 chars (0235 R2)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            // The plan's own body is inside its 1000-char cap; the added lines push the note over.
            const lead = '播'.repeat(980);
            writeEpisodePlan(dir, `${lead} #AI`);
            writeEpisodeCover(dir);

            const result = run(episodeArgs(dir, 6), env);
            expect(result.status).toBe(0);
            const content = JSON.parse(readFileSync(join(dir, '25-xhs/content.json'), 'utf-8')) as { body: string };
            expect(content.body.length).toBeLessThanOrEqual(1000);
            expect(content.body.startsWith(lead)).toBe(false);
            // Every image keeps its line, and the hashtags keep their place.
            expect(content.body.split('\n').filter((line) => /^[①-⑱]/.test(line)).length).toBe(7);
            expect(content.body.split('\n').at(-1)).toBe('#AI');
            expect(content.body).toContain('本期封面');
        });
    });

    it('daily-xhs-render fails before rendering any card when the numbered lines alone overflow the note cap (0235 R2)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            // Six 200-char first points: the lines alone exceed 1000 with no lead left to trim.
            const card = (role: string, copy: string) => ({
                ...xhsCard(role, copy, 'fact'),
                points: ['长'.repeat(200)],
            });
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({
                    title: '今日 AI 速览',
                    body: '本期 #AI',
                    cards: [
                        card('cover', 'a'),
                        ...['b', 'c', 'd', 'e'].map((c) => card('content', c)),
                        card('closing', 'f'),
                    ],
                }),
            );

            const result = run(episodeArgs(dir, 6), env);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('a line is never dropped');
            // Nothing was paid for: no provider call, no manifest, no note.
            expect(existsSync(record)).toBe(false);
            expect(existsSync(join(xhs, 'cards.json'))).toBe(false);
            expect(existsSync(join(xhs, 'content.json'))).toBe(false);
        });
    });

    it('daily-xhs-render records each card plan item id in cards.json when the plan carries one (0235)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({
                    title: '今日 AI 速览',
                    body: '正文 #AI',
                    cards: [
                        xhsCard('cover', '今日头条', 'lead fact'),
                        { ...xhsCard('content', '模型发布', 'f'), itemId: 'i2' },
                    ],
                }),
            );

            expect(run(episodeArgs(dir, 2), env).status).toBe(0);
            const manifest = JSON.parse(readFileSync(join(xhs, 'cards.json'), 'utf-8')) as {
                cards: Record<string, unknown>[];
            };
            // The hook card maps to no single item, so it carries no key at all.
            expect('itemId' in (manifest.cards[0] ?? {})).toBe(false);
            expect(manifest.cards[1]?.itemId).toBe('i2');
        });
    });

    it('daily-xhs-render without note_scope packages the pre-0235 content.json byte-for-byte (0235 R4)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            writeXhsPlan(dir);
            // The episode cover exists and is deliberately ignored: opt-in is the whole contract.
            writeEpisodeCover(dir);

            const result = run(
                ['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', 'minimax', 'image-01'],
                env,
            );
            expect(result.status).toBe(0);
            // Captured before the 0235 change by running this stage over this same fixture (the
            // only substitution is the temp dir): lead-item series, verbatim LLM body, no cover.
            const golden = `{
  "title": "今日 AI 速览",
  "body": "正文 #AI",
  "format": "text",
  "metadata": {
    "images": [
      {
        "path": "${dir}/25-xhs/cards/card-01-xhs-card-01.png",
        "prompt": "flat illustration a desk",
        "illustration": {
          "path": "${dir}/25-xhs/cards/card-01-illustration-01.png",
          "bytes": 3
        }
      },
      {
        "path": "${dir}/25-xhs/cards/card-02-xhs-card-01.png",
        "prompt": "flat illustration a desk",
        "illustration": {
          "path": "${dir}/25-xhs/cards/card-02-illustration-01.png",
          "bytes": 3
        }
      }
    ],
    "publishStatus": "draft"
  }
}`;
            expect(readFileSync(join(dir, '25-xhs/content.json'), 'utf-8')).toBe(golden);
        });
    });

    it('daily-xhs-render threads the opt-in fallback into every envelope, strictly when absent (0219 AC1)', () => {
        const envelope = (fallbackArg?: string) => {
            let imageGen: Record<string, unknown> = {};
            withTempDir((dir) => {
                writeXhsPlan(dir);
                const record = join(dir, 'kk-argv.jsonl');
                const env = fakeXhsKk(dir, record, 'image-gen');
                const args = ['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', ''];
                if (fallbackArg !== undefined) args.push(fallbackArg);
                const result = run(args, env);
                expect(result.status).toBe(0);
                const envelopes = JSON.parse(
                    readFileSync(join(dir, '25-xhs', 'cards', 'card-01.in.json'), 'utf-8'),
                ) as { metadata: { imageGen: Record<string, unknown> } }[];
                imageGen = envelopes.at(0)?.metadata.imageGen ?? {};
            });
            return imageGen;
        };
        expect(envelope('true').fallback).toBe(true);
        expect(envelope('google, openai').fallback).toStrictEqual(['google', 'openai']);
        expect(envelope().fallback).toBeUndefined();
        expect(envelope('').fallback).toBeUndefined();
        // Spawns stage subprocesses; the full apps/cli suite runs these concurrently and
        // pushes ~1.8s standalone work past bun's 5s default (0392).
    }, 120000);

    it('daily-xhs-render names the failed card and exits with image-gen status, keeping earlier cards (0219 AC2)', () => {
        withTempDir((dir) => {
            writeXhsPlan(dir);
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen', 7);
            const result = run(['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', '', 'true'], env);
            expect(result.status).toBe(7);
            expect(result.stderr).toContain('xhs render: card 01 failed');
            expect(result.stderr).toContain('re-run daily-xhs-render to resume');
            // 0269: no overflow sentence in the fake's stderr, so the failure is the provider's — it gets
            // one same-envelope retry. This fake fails EVERY call, so the retry fails too and the series
            // stops here with exactly two calls (never an unbounded loop).
            expect(readFileSync(record, 'utf-8').trim().split('\n')).toHaveLength(2);
            expect(() => readFileSync(join(dir, '25-xhs', 'cards.json'))).toThrow();
            expect(() => readFileSync(join(dir, '25-xhs', 'content.json'))).toThrow();
        });
    });

    /**
     * 0251: a fake image-gen `kk` that fails each `--in` path's FIRST call with `failStderr`
     * (which fakeXhsKk cannot do — it exits before it can print) and answers every later call
     * with fakeXhsKk's success path, so the overflow retry is observable end to end. Every call's
     * `--in` envelope is snapshotted to `<record>.<n>.json` — the retry rewrites the one in.json
     * in place, so the first envelope is gone by the time the stage returns.
     */
    function fakeXhsKkFailFirst(
        dir: string,
        record: string,
        failStderr: string,
        exitCode: number,
        failCalls = 1,
    ): Record<string, string> {
        return fakeKk(
            dir,
            [
                "const fs = require('node:fs');",
                'const argv = process.argv.slice(2);',
                `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + '\\n');`,
                'const at = (name) => argv[argv.indexOf(name) + 1];',
                `const prior = fs.readFileSync(${JSON.stringify(record)}, 'utf8').trim().split('\\n').filter((line) => line.includes(at('--in')));`,
                `fs.copyFileSync(at('--in'), ${JSON.stringify(record)} + '.' + prior.length + '.json');`,
                `if (prior.length <= ${failCalls}) { process.stderr.write(${JSON.stringify(failStderr)} + '\\n'); process.exit(${exitCode}); }`,
                'const spec = JSON.parse(fs.readFileSync(at("--in"), "utf8"))[0].metadata.imageGen;',
                'const artifact = at("--out").replace(/.json$/, "") + "-" + spec.format + "-01.png";',
                'fs.writeFileSync(artifact, "png");',
                'fs.writeFileSync(at("--out"), JSON.stringify({ metadata: { images: [{ path: artifact, prompt: "flat illustration " + spec.vars.subject }] } }));',
            ].join('\n'),
        );
    }

    it('daily-xhs-render shortens overflowing points and retries the card once (0251 AC1)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKkFailFirst(
                dir,
                record,
                'image-gen failed: compose: text overflows the safe area for field(s): points[1], points[2] (safe area: 72px inset)',
                1,
            );
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            const card = {
                ...xhsCard('cover', '今日头条', 'lead fact'),
                points: [
                    '保持原样',
                    '第一句很长很长的内容用来填充安全区。第二句更长更长更长的内容会被整体丢掉。',
                    '短。这一句会被丢掉因为太长太长太长太长太长太长太长太长。',
                ],
            };
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({ title: '今日 AI 速览', body: '正文 #AI', cards: [card] }),
            );

            const result = run(['daily-xhs-render', dir, '20260101', '', '1', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);

            // Two calls: the overflow and the single retry with the shortened points.
            const calls = readFileSync(record, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            expect(calls).toHaveLength(2);
            const readPoints = (snapshot: string): string[] => {
                const docs = JSON.parse(readFileSync(snapshot, 'utf-8')) as {
                    metadata: { imageGen: { vars: { points: string } } };
                }[];
                return docs[0]?.metadata.imageGen.vars.points.split('\n') ?? [];
            };
            const firstPoints = readPoints(`${record}.1.json`);
            const secondPoints = readPoints(`${record}.2.json`);
            // The unnamed point is verbatim; each named point lost its last sentence.
            expect(secondPoints[0]).toBe(firstPoints[0]);
            expect(secondPoints[1]).toBe('第一句很长很长的内容用来填充安全区。');
            expect(secondPoints[2]).toBe('短。');
            expect(secondPoints[1]?.length).toBeLessThan(firstPoints[1]?.length ?? 0);
            expect(secondPoints[2]?.length).toBeLessThan(firstPoints[2]?.length ?? 0);
            // The retry packaged the series.
            expect(existsSync(join(xhs, 'content.json'))).toBe(true);
        });
    });

    it('daily-xhs-render retries a 37-code-point one-sentence point truncated to the same length (0251)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKkFailFirst(
                dir,
                record,
                'image-gen failed: compose: text overflows the safe area for field(s): points[0] (safe area: 72px inset)',
                1,
            );
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            // 36 code points + `…` is still 37 UTF-16 units: a length comparison misses this shortening.
            const long = '长'.repeat(37);
            const card = { ...xhsCard('cover', '今日头条', 'lead fact'), points: [long] };
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({ title: '今日 AI 速览', body: '正文 #AI', cards: [card] }),
            );

            const result = run(['daily-xhs-render', dir, '20260101', '', '1', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            const snapshot = JSON.parse(readFileSync(`${record}.2.json`, 'utf-8')) as {
                metadata: { imageGen: { vars: { points: string } } };
            }[];
            expect(snapshot[0]?.metadata.imageGen.vars.points).toBe(`${'长'.repeat(36)}…`);
        });
    });

    it('daily-xhs-render drops the trailing point when no point can be shortened (2026-10-12)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            // The measured shape: four 12-16 code-point single-sentence cover points, so the
            // shortener no-ops on every one and only a block-level cut can fit the card.
            const env = fakeXhsKkFailFirst(
                dir,
                record,
                'image-gen failed: compose: text overflows the safe area for field(s): points[3] (safe area: 72px inset)',
                1,
            );
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            const card = {
                ...xhsCard('cover', '智能体越权了', 'lead fact'),
                points: [
                    '测试中的模型智能体无人指示就行动',
                    '利用大学网站漏洞下载数据',
                    '向政府机构提交被禁止的表格',
                    '警方收到的虚假线索被标记为垃圾',
                ],
            };
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({ title: '今日 AI 速览', body: '正文 #AI', cards: [card] }),
            );

            const result = run(['daily-xhs-render', dir, '20260101', '', '1', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            const readPoints = (snapshot: string): string[] => {
                const docs = JSON.parse(readFileSync(snapshot, 'utf-8')) as {
                    metadata: { imageGen: { vars: { points: string } } };
                }[];
                return docs[0]?.metadata.imageGen.vars.points.split('\n') ?? [];
            };
            expect(readPoints(`${record}.1.json`)).toHaveLength(4);
            // Unchanged text, one fewer bullet — the block was over budget, not a sentence.
            expect(readPoints(`${record}.2.json`)).toEqual([
                '测试中的模型智能体无人指示就行动',
                '利用大学网站漏洞下载数据',
                '向政府机构提交被禁止的表格',
            ]);
            expect(existsSync(join(xhs, 'content.json'))).toBe(true);
        });
    });

    it('daily-xhs-render retries a non-overflow failure once and recovers the card (0269)', () => {
        // 0269: the observed loss was a provider flake AFTER a rewrite — card 02 overflowed, was made
        // to fit, and the second call then failed with only a vendor-fallback warning; the same saved
        // envelope rendered first try by hand. A failure the composer's overflow sentence does not
        // explain is the provider's, so it gets one same-envelope retry instead of ending the series.
        withTempDir((dir) => {
            writeXhsPlan(dir);
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKkFailFirst(dir, record, 'image-gen failed: provider timeout', 3);
            const result = run(['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('retrying the same envelope once');
            // Two calls for the FIRST card: the failure and its one retry. Counted per card, because the
            // later cards are rendered too once the retry succeeds. The envelope is byte-identical
            // between the two — a rewrite would have gone through the overflow branch instead.
            const calls = readFileSync(record, 'utf-8').trim().split('\n');
            expect(calls.filter((line) => line.includes('card-01.in.json'))).toHaveLength(2);
            expect(readFileSync(`${record}.1.json`, 'utf-8')).toBe(readFileSync(`${record}.2.json`, 'utf-8'));
            expect(existsSync(join(dir, '25-xhs', 'cards.json'))).toBe(true);
            expect(existsSync(join(dir, '25-xhs', 'content.json'))).toBe(true);
        });
    });

    it('daily-xhs-render still stops the series when the same non-overflow failure persists (0251 R2, bounded)', () => {
        withTempDir((dir) => {
            writeXhsPlan(dir);
            const record = join(dir, 'kk-argv.jsonl');
            // Every call for this envelope fails: the bounded retry must not become an unbounded one.
            const env = fakeXhsKkFailFirst(dir, record, 'image-gen failed: provider timeout', 3, 99);
            const result = run(['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(3);
            expect(result.stderr).toContain('xhs render: card 01 failed');
            expect(result.stderr).toContain('re-run daily-xhs-render');
            // One call plus exactly one retry: a permanent failure costs a single extra illustration.
            expect(readFileSync(record, 'utf-8').trim().split('\n')).toHaveLength(2);
            expect(() => readFileSync(join(dir, '25-xhs', 'cards.json'))).toThrow();
        });
    });

    it('daily-xhs-render gives each card its own same-envelope retry budget (0269 R5)', () => {
        withTempDir((dir) => {
            writeXhsPlan(dir);
            const record = join(dir, 'kk-argv.jsonl');
            // Both cards flake exactly once. The shared snapshot file overwrote across cards in the
            // recovery test, so this fake namespaces its snapshots per card: the byte-identical
            // assertion below reads each card's own fail/success pair, and card 02 getting a retry at
            // all falsifies any transientRetryUsed guard hoisted outside the per-card loop.
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const argv = process.argv.slice(2);',
                    `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + '\\n');`,
                    'const at = (name) => argv[argv.indexOf(name) + 1];',
                    `const inName = at('--in').split('/').pop().replace(/\\.in\\.json$/, '');`,
                    `const prior = fs.readFileSync(${JSON.stringify(record)}, 'utf8').trim().split('\\n').filter((line) => line.includes(at('--in')));`,
                    `fs.copyFileSync(at('--in'), ${JSON.stringify(record)} + '.' + inName + '.' + prior.length + '.json');`,
                    `if (prior.length <= 1) { process.stderr.write('image-gen failed: provider timeout\\n'); process.exit(3); }`,
                    'const spec = JSON.parse(fs.readFileSync(at("--in"), "utf8"))[0].metadata.imageGen;',
                    'const artifact = at("--out").replace(/.json$/, "") + "-" + spec.format + "-01.png";',
                    'fs.writeFileSync(artifact, "png");',
                    'fs.writeFileSync(at("--out"), JSON.stringify({ metadata: { images: [{ path: artifact, prompt: "flat illustration " + spec.vars.subject }] } }));',
                ].join('\n'),
            );
            const result = run(['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            const calls = readFileSync(record, 'utf-8').trim().split('\n');
            for (const card of ['card-01', 'card-02']) {
                expect(calls.filter((line) => line.includes(`${card}.in.json`))).toHaveLength(2);
                expect(readFileSync(`${record}.${card}.1.json`, 'utf-8')).toBe(
                    readFileSync(`${record}.${card}.2.json`, 'utf-8'),
                );
            }
            expect(existsSync(join(dir, '25-xhs', 'cards.json'))).toBe(true);
            expect(existsSync(join(dir, '25-xhs', 'content.json'))).toBe(true);
        });
    });

    it('daily-xhs-render spends the shared loop cap on a rewrite followed by the same-envelope retry (0269 R6)', () => {
        withTempDir((dir) => {
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            const card = {
                ...xhsCard('cover', '今日头条', 'lead fact'),
                points: ['保持原样', '第一句很长很长的内容用来填充安全区。第二句更长更长更长的内容会被整体丢掉。'],
            };
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({ title: '今日 AI 速览', body: '正文 #AI', cards: [card] }),
            );
            const record = join(dir, 'kk-argv.jsonl');
            // Call 1 overflows points[1] (rewrite branch), call 2 is a provider failure (same-envelope
            // retry), call 3 succeeds. Both remediations must fit inside the one shared budget.
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const argv = process.argv.slice(2);',
                    `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + '\\n');`,
                    'const at = (name) => argv[argv.indexOf(name) + 1];',
                    `const prior = fs.readFileSync(${JSON.stringify(record)}, 'utf8').trim().split('\\n').filter((line) => line.includes(at('--in')));`,
                    `fs.copyFileSync(at('--in'), ${JSON.stringify(record)} + '.' + prior.length + '.json');`,
                    `if (prior.length === 1) { process.stderr.write('image-gen failed: compose: text overflows the safe area for field(s): points[1] (safe area: 72px inset)\\n'); process.exit(1); }`,
                    `if (prior.length === 2) { process.stderr.write('image-gen failed: provider timeout\\n'); process.exit(3); }`,
                    'const spec = JSON.parse(fs.readFileSync(at("--in"), "utf8"))[0].metadata.imageGen;',
                    'const artifact = at("--out").replace(/.json$/, "") + "-" + spec.format + "-01.png";',
                    'fs.writeFileSync(artifact, "png");',
                    'fs.writeFileSync(at("--out"), JSON.stringify({ metadata: { images: [{ path: artifact, prompt: "flat illustration " + spec.vars.subject }] } }));',
                ].join('\n'),
            );
            const result = run(['daily-xhs-render', dir, '20260101', '', '1', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('retrying the same envelope once');
            const calls = readFileSync(record, 'utf-8').trim().split('\n');
            // Initial + rewrite + one same-envelope retry: three invocations, no fourth.
            expect(calls).toHaveLength(3);
            const readPoints = (snapshot: string): string[] => {
                const docs = JSON.parse(readFileSync(snapshot, 'utf-8')) as {
                    metadata: { imageGen: { vars: { points: string } } };
                }[];
                return docs[0]?.metadata.imageGen.vars.points.split('\n') ?? [];
            };
            // The rewrite shortened points[1]; the provider retry reused that rewritten envelope byte
            // for byte instead of falling back to the original.
            expect(readPoints(`${record}.2.json`)).not.toEqual(readPoints(`${record}.1.json`));
            expect(readPoints(`${record}.2.json`)[0]).toBe('保持原样');
            expect(readFileSync(`${record}.3.json`, 'utf-8')).toBe(readFileSync(`${record}.2.json`, 'utf-8'));
            expect(existsSync(join(xhs, 'content.json'))).toBe(true);
        });
    });

    it('daily-xhs-render stops through resume once overflow rewrites exhaust the shared cap (0269 R6)', () => {
        withTempDir((dir) => {
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            // Four single-sentence points (the plan loader's max) long enough to truncate exactly
            // once each: each rewrite either shortens the named last point or, once it has stalled,
            // drops the trailing one. Three successful rewrites spend the whole shared cap, so the
            // loop must exit on the attempt bound — a larger cap would ask image-gen a fifth time.
            const card = {
                ...xhsCard('cover', '智能体越权了', 'lead fact'),
                points: [
                    '测试中的智能体在没有得到任何人工确认的情况下自行决定下载并执行来自陌生域名的工具包',
                    '它利用一所大学网站的漏洞批量下载了受限的数据集并把副本上传到了公开的对象存储桶',
                    '它还向多个政府监管机构提交了被明确禁止的自动化表格招致了跨部门的联合调查程序',
                    '警方根据它生成的虚假线索突击检查了一处民宅事后证实那条线索完全是无中生有的编造',
                ],
            };
            writeFileSync(
                join(xhs, '20260101_18_xhs_plan.json'),
                JSON.stringify({ title: '今日 AI 速览', body: '正文 #AI', cards: [card] }),
            );
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const argv = process.argv.slice(2);',
                    `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(argv) + '\\n');`,
                    'const at = (name) => argv[argv.indexOf(name) + 1];',
                    `const pts = JSON.parse(fs.readFileSync(at("--in"), "utf8"))[0].metadata.imageGen.vars.points.split('\\n');`,
                    `const prior = fs.readFileSync(${JSON.stringify(record)}, 'utf8').trim().split('\\n').filter((line) => line.includes(at('--in')));`,
                    `fs.copyFileSync(at('--in'), ${JSON.stringify(record)} + '.' + prior.length + '.json');`,
                    `if (prior.length > 4) { process.stderr.write('image-gen failed: provider timeout\\n'); process.exit(3); }`,
                    `process.stderr.write('image-gen failed: compose: text overflows the safe area for field(s): points[' + (pts.length - 1) + '] (safe area: 72px inset)\\n');`,
                    'process.exit(1);',
                    'const spec = JSON.parse(fs.readFileSync(at("--in"), "utf8"))[0].metadata.imageGen;',
                    'const artifact = at("--out").replace(/.json$/, "") + "-" + spec.format + "-01.png";',
                    'fs.writeFileSync(artifact, "png");',
                    'fs.writeFileSync(at("--out"), JSON.stringify({ metadata: { images: [{ path: artifact, prompt: "flat illustration " + spec.vars.subject }] } }));',
                ].join('\n'),
            );
            const result = run(['daily-xhs-render', dir, '20260101', '', '1', 'xhs-knowledge', '', ''], env);
            // A fifth failure would only be reachable with a larger cap (cap 3 ⇒ initial + three
            // rewrites); the provider-timeout sentinel beyond it must never run.
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('xhs render: card 01 failed');
            expect(result.stderr).toContain('re-run daily-xhs-render');
            expect(readFileSync(record, 'utf-8').trim().split('\n')).toHaveLength(4);
            expect(() => readFileSync(join(xhs, 'content.json'))).toThrow();
        });
    });

    it('daily-xhs-render with every artifact already on disk spends nothing but still packages (E8 0181)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            const cards = join(dir, '25-xhs/cards');
            mkdirSync(cards, { recursive: true });
            writeFileSync(
                join(dir, '25-xhs/20260101_18_xhs_plan.json'),
                JSON.stringify({
                    title: 't',
                    body: 'b',
                    cards: [xhsCard('cover', 'c1', 'sp1'), xhsCard('content', 'c2', 'sp2')],
                }),
            );
            for (const index of ['01', '02']) {
                const png = join(cards, `card-${index}-xhs-card-01.png`);
                writeFileSync(png, 'png');
                writeFileSync(
                    join(cards, `card-${index}.json`),
                    JSON.stringify({ metadata: { images: [{ path: png, prompt: `flat illustration ${index}` }] } }),
                );
            }
            const result = run(['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            expect(result.stderr).toBe('');
            // Zero provider calls: the fake kk never ran (it would have created the record).
            expect(existsSync(record)).toBe(false);
            const content = JSON.parse(readFileSync(join(dir, '25-xhs/content.json'), 'utf-8')) as {
                metadata: { images: { path: string }[] };
            };
            expect(content.metadata.images.map((image) => image.path)).toEqual([
                join(cards, 'card-01-xhs-card-01.png'),
                join(cards, 'card-02-xhs-card-01.png'),
            ]);
        });
    });

    it('daily-xhs-render refuses a plan whose card count disagrees with xhs_cards, and one not opening on the cover (E8)', () => {
        withTempDir((dir) => {
            const xhs = join(dir, '25-xhs');
            mkdirSync(xhs, { recursive: true });
            const plan = join(xhs, '20260101_18_xhs_plan.json');
            writeFileSync(plan, JSON.stringify({ title: 't', body: 'b', cards: [xhsCard('cover', 'c', 'sp')] }));
            const short = run(['daily-xhs-render', dir, '20260101', '', '4', 'xhs-knowledge', '', '']);
            expect(short.status).toBe(1);
            expect(short.stderr).toContain('xhs plan: expected 4 cards (xhs_cards), got 1');

            // A content card in first position would publish a series with no cover.
            writeFileSync(plan, JSON.stringify({ title: 't', body: 'b', cards: [xhsCard('content', 'c', 'sp')] }));
            const noCover = run(['daily-xhs-render', dir, '20260101', '', '1', 'xhs-knowledge', '', '']);
            expect(noCover.status).toBe(1);
            expect(noCover.stderr).toContain("must be role 'cover'");

            // The cap is refused before any plan is read, so a bad var cannot spend.
            const capped = run(['daily-xhs-render', dir, '20260101', '', '11', 'xhs-knowledge', '', '']);
            expect(capped.status).toBe(1);
            expect(capped.stderr).toContain('xhs render: xhs_cards must be 1..10');
        });
    });

    it('daily-xhs-render reuses a card whose artifact is still on disk instead of re-rendering it (E8)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'image-gen');
            const cards = join(dir, '25-xhs/cards');
            mkdirSync(cards, { recursive: true });
            writeFileSync(
                join(dir, '25-xhs/20260101_18_xhs_plan.json'),
                JSON.stringify({
                    title: 't',
                    body: 'b',
                    cards: [xhsCard('cover', 'c1', 'sp1'), xhsCard('content', 'c2', 'sp2')],
                }),
            );
            // Card 01 survived an earlier run (resume after a card-02 failure): artifact on disk.
            const kept = join(cards, 'card-01-xhs-card-01.png');
            writeFileSync(kept, 'png');
            writeFileSync(
                join(cards, 'card-01.json'),
                JSON.stringify({ metadata: { images: [{ path: kept, prompt: 'composed earlier' }] } }),
            );

            const result = run(['daily-xhs-render', dir, '20260101', '', '2', 'xhs-knowledge', '', ''], env);
            expect(result.status).toBe(0);
            // Exactly one paid call — card 02 — and the cached prompt is preserved verbatim.
            const calls = readFileSync(record, 'utf-8').trim().split('\n');
            expect(calls.length).toBe(1);
            expect(calls[0]).toContain('card-02');
            expect(readFileSync(join(cards, 'card-01.prompt.txt'), 'utf-8')).toBe('composed earlier');
            const content = JSON.parse(readFileSync(join(dir, '25-xhs/content.json'), 'utf-8')) as {
                metadata: { images: { path: string }[] };
            };
            expect(content.metadata.images.map((image) => image.path)).toEqual([
                kept,
                join(cards, 'card-02-xhs-card-01.png'),
            ]);
        });
    });

    it('daily-bundle-variants writes the placeholder variant set and skips absent channels (0327 R2/R3)', () => {
        withTempDir((dir) => {
            const article = join(dir, '22-article');
            const publish = join(dir, '31-publish');
            const xhs = join(dir, '25-xhs');
            const cover = join(dir, '23-cover');
            const social = join(dir, '26-social');
            for (const sub of [article, publish, xhs, cover, social]) mkdirSync(sub, { recursive: true });
            writeFileSync(
                join(article, '20260101_06_article_content.json'),
                JSON.stringify({ title: '标题', format: 'markdown', body: '正文', metadata: {} }),
            );
            writeFileSync(
                join(publish, '20260101_13_publish-prep_content.json'),
                JSON.stringify({ title: '标题', body: '正文', metadata: { audioFile: '/tmp/e.mp3' } }),
            );
            writeFileSync(join(publish, '20260101_15_show-notes_show-notes.md'), '# 时间轴');
            writeFileSync(join(cover, '20260101_07_cover_cover.png'), 'png');
            writeFileSync(join(xhs, 'content.json'), JSON.stringify({ title: '卡片', body: '正文', metadata: {} }));
            writeFileSync(join(social, 'x.md'), 'x 文案');

            const result = run(['daily-bundle-variants', dir, '20260101', ''], {});
            expect(result.status).toBe(0);

            const variants = join(dir, '30-variants');
            const read = (key: string): Record<string, unknown> =>
                JSON.parse(readFileSync(join(variants, `${key}.content.json`), 'utf-8')) as Record<string, unknown>;

            // The 公众号 payload carries the article-url placeholder, not a real link.
            const wechat = read('article@wechatmp-pub') as {
                body: string;
                metadata: { wechatmp: { originalUrl?: string; coverPath?: string } };
            };
            expect(wechat.metadata.wechatmp.originalUrl).toBe('{{article_url}}');
            expect(wechat.metadata.wechatmp.coverPath).toBe(join(cover, '20260101_07_cover_cover.png'));
            expect(wechat.body).toContain('咸话咸说');

            // The 公众号 播客 variant carries the episode body without the article-only closer.
            const wechatEpisode = read('episode@wechatmp-pub') as { body: string };
            expect(wechatEpisode.body).toBe('正文');

            // The episode variants carry the show notes / the 发播客 operation.
            const podcast = read('episode@podcast-pub') as { metadata: { showNotes: string } };
            expect(podcast.metadata.showNotes).toBe('# 时间轴');
            const xhsEpisode = read('episode@xhs-pub') as { metadata: { operation: string; audio: string } };
            expect(xhsEpisode.metadata.operation).toBe('发播客');
            expect(xhsEpisode.metadata.audio).toBe('/tmp/e.mp3');

            // Social copy becomes a variant with the cover attached; the missing platforms are named.
            const socialX = read('social_x') as { body: string; metadata: { coverImage?: string } };
            expect(socialX.body).toBe('x 文案');
            expect(socialX.metadata.coverImage).toBe(join(cover, '20260101_07_cover_cover.png'));
            expect(result.stdout).toContain('social:weibo (no 26-social/weibo.md)');
            expect(existsSync(join(variants, 'social_weibo.content.json'))).toBe(false);
        });
    });

    it("daily-bundle-variants applies X's weighted cap, not a raw character count (0327 R3)", () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '26-social'), { recursive: true });
            // 200 CJK characters = 400 of X's units (CJK counts 2), so a code-unit count would let the
            // whole post through; the weighted backstop must cut it to at most 280 units.
            writeFileSync(join(dir, '26-social', 'x.md'), '字'.repeat(200));
            expect(run(['daily-bundle-variants', dir, '20260101', ''], {}).status).toBe(0);
            const variant = JSON.parse(readFileSync(join(dir, '30-variants', 'social_x.content.json'), 'utf-8')) as {
                body: string;
                metadata: { truncatedFrom?: number; truncatedUnit?: string };
            };
            expect([...variant.body]).toHaveLength(140);
            expect(variant.metadata.truncatedFrom).toBe(400);
            expect(variant.metadata.truncatedUnit).toBe('weighted');

            // A Latin post of the same length is within budget and stays whole.
            writeFileSync(join(dir, '26-social', 'x.md'), 'a'.repeat(200));
            expect(run(['daily-bundle-variants', dir, '20260101', ''], {}).status).toBe(0);
            const latin = JSON.parse(readFileSync(join(dir, '30-variants', 'social_x.content.json'), 'utf-8')) as {
                body: string;
                metadata: { truncatedFrom?: number };
            };
            expect(latin.body).toHaveLength(200);
            expect(latin.metadata.truncatedFrom).toBeUndefined();
        });
    });

    it('daily-bundle-variants truncates over-length social copy as a backstop (0327 R3)', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '26-social'), { recursive: true });
            writeFileSync(join(dir, '26-social', 'x.md'), 'a'.repeat(400));
            const result = run(['daily-bundle-variants', dir, '20260101', ''], {});
            expect(result.status).toBe(0);
            const variant = JSON.parse(readFileSync(join(dir, '30-variants', 'social_x.content.json'), 'utf-8')) as {
                body: string;
                metadata: { truncatedFrom?: number };
            };
            expect(variant.body).toHaveLength(280);
            expect(variant.metadata.truncatedFrom).toBe(400);

            // LinkedIn (0328): a plain 3000-character cap — CJK is not weighted, so 3000 汉字 stay whole.
            const linkedin = (body: string) => {
                writeFileSync(join(dir, '26-social', 'linkedin.md'), body);
                expect(run(['daily-bundle-variants', dir, '20260101', ''], {}).status).toBe(0);
                return JSON.parse(readFileSync(join(dir, '30-variants', 'social_linkedin.content.json'), 'utf-8')) as {
                    body: string;
                    metadata: { truncatedFrom?: number };
                };
            };
            const whole = linkedin('字'.repeat(3000));
            expect([...whole.body]).toHaveLength(3000);
            expect(whole.metadata.truncatedFrom).toBeUndefined();
            const cut = linkedin('字'.repeat(3500));
            expect([...cut.body]).toHaveLength(3000);
            expect(cut.metadata.truncatedFrom).toBe(3500);
        });
    });

    it('daily-publish-xhs drafts by default, caches per requested status, and never blocks the run (E8)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'xhs-pub');
            const xhs = join(dir, '25-xhs');
            const publish = join(dir, '31-publish');
            mkdirSync(xhs, { recursive: true });
            mkdirSync(publish, { recursive: true });

            // A failed render packages nothing: the target skips instead of failing the run.
            const skipped = run(['daily-publish-xhs', dir, '20260101', '', 'false'], env);
            expect(skipped.status).toBe(0);
            expect(skipped.stdout).toContain('no card series at');
            expect(existsSync(record)).toBe(false);

            writeFileSync(
                join(xhs, 'content.json'),
                JSON.stringify({
                    title: 't',
                    body: 'b',
                    format: 'text',
                    metadata: { images: [{ path: '/tmp/x.png' }] },
                }),
            );
            const input = join(publish, '20260101_19_publish-xhs_content.json');
            const statusOf = (): string =>
                (JSON.parse(readFileSync(input, 'utf-8')) as { metadata: { publishStatus: string } }).metadata
                    .publishStatus;
            const callCount = (): number => readFileSync(record, 'utf-8').trim().split('\n').length;

            // Default is a draft — the packaged Content never carries a live status by itself.
            expect(run(['daily-publish-xhs', dir, '20260101', '', 'false'], env).status).toBe(0);
            expect(statusOf()).toBe('draft');
            expect(callCount()).toBe(1);

            // Cached on the *requested* status: a repeat draft run does not post a second draft...
            expect(run(['daily-publish-xhs', dir, '20260101', '', 'false'], env).status).toBe(0);
            expect(callCount()).toBe(1);
            // ...and a cached draft must not satisfy a live request (ADR-022 explicit switch).
            expect(run(['daily-publish-xhs', dir, '20260101', '', 'true'], env).status).toBe(0);
            expect(statusOf()).toBe('public');
            expect(callCount()).toBe(2);
        });
    });

    it('daily-publish-xhs logs a plugin failure without failing the run (E8 non-blocking target)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            // The plugin fails (expired XHS session, changed console): the run must survive it.
            const env = fakeXhsKk(dir, record, 'xhs-pub', 1);
            mkdirSync(join(dir, '25-xhs'), { recursive: true });
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            writeFileSync(
                join(dir, '25-xhs/content.json'),
                JSON.stringify({
                    title: 't',
                    body: 'b',
                    format: 'text',
                    metadata: { images: [{ path: '/tmp/x.png' }] },
                }),
            );
            const result = run(['daily-publish-xhs', dir, '20260101', '', 'false'], env);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('WARNING: publish-xhs — xhs-pub exited 1');
        });
    });

    /** The card series the xhs-render stage packages (what this stage sends to `xhs-pub`). */
    function writeXhsSeries(dir: string): void {
        mkdirSync(join(dir, '25-xhs'), { recursive: true });
        mkdirSync(join(dir, '31-publish'), { recursive: true });
        writeFileSync(
            join(dir, '25-xhs/content.json'),
            JSON.stringify({ title: 't', body: 'b', format: 'text', metadata: { images: [{ path: '/tmp/x.png' }] } }),
        );
    }

    /**
     * 0236 R1: the episode's own publish-prep output — the final mp3 (intro sting included) and the
     * `23-cover` PNG — that the 发播客 note reuses verbatim. No artifact is produced here.
     */
    function writePublishPrep(dir: string): { audio: string; cover: string } {
        const audio = join(dir, '30-audio/20260101_11_episode.mp3');
        const cover = join(dir, '23-cover/20260101_07_cover_cover.png');
        mkdirSync(join(dir, '30-audio'), { recursive: true });
        mkdirSync(join(dir, '23-cover'), { recursive: true });
        writeFileSync(audio, 'mp3');
        writeFileSync(cover, 'png');
        writeFileSync(
            join(dir, '31-publish/20260101_13_publish-prep_content.json'),
            JSON.stringify({
                title: '每日AI乱炖',
                body: '本期三件事',
                format: 'text',
                metadata: {
                    audioFile: audio,
                    coverImage: cover,
                    runDate: '20260101',
                    itunes: { season: 2026, episode: 1 },
                },
                options: { audioFile: audio, durationSec: 1002.11 },
            }),
        );
        return { audio, cover };
    }

    const packagedNote = (
        dir: string,
    ): { metadata: { publishStatus: string; followUps?: { metadata: Record<string, unknown> }[] } } =>
        JSON.parse(readFileSync(join(dir, '31-publish/20260101_19_publish-xhs_content.json'), 'utf-8'));

    it('daily-publish-xhs carries the episode 发播客 Content as a follow-up only when the trailing arg is passed (0236 R1)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'xhs-pub');
            writeXhsSeries(dir);
            const { audio, cover } = writePublishPrep(dir);

            // voice1 passes no trailing arg: the packaged 图文 Content keeps its pre-0236 shape.
            expect(run(['daily-publish-xhs', dir, '20260101', '', 'false'], env).status).toBe(0);
            expect(
                JSON.parse(readFileSync(join(dir, '31-publish/20260101_19_publish-xhs_content.json'), 'utf-8')),
            ).toEqual({
                title: 't',
                body: 'b',
                format: 'text',
                metadata: { images: [{ path: '/tmp/x.png' }], publishStatus: 'draft' },
            });
            // That run's draft result is cached; drop it so the voice2 call below is not skipped.
            rmSync(join(dir, '31-publish/20260101_19_publish-xhs_result.json'), { force: true });

            // voice2 passes `podcast=true`: the episode's 发播客 Content rides the same visit.
            expect(run(['daily-publish-xhs', dir, '20260101', '', 'false', 'true'], env).status).toBe(0);
            const packaged = packagedNote(dir);
            expect(packaged.metadata.followUps).toHaveLength(1);
            // R1: the prep Content's own mp3 and cover, plus the operation and the run's status.
            expect(packaged.metadata.followUps?.[0]?.metadata).toEqual({
                audioFile: audio,
                coverImage: cover,
                runDate: '20260101',
                itunes: { season: 2026, episode: 1 },
                operation: '发播客',
                audio,
                publishStatus: 'draft',
            });
            // R4: xhs_live is false, so neither note claims a live status.
            expect(packaged.metadata.publishStatus).toBe('draft');
        });
    });

    it('daily-publish-xhs skips the 发播客 note when the run has no publish-prep Content (0236 non-blocking)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'xhs-pub');
            writeXhsSeries(dir);

            const result = run(['daily-publish-xhs', dir, '20260101', '', 'false', 'true'], env);
            expect(result.status).toBe(0);
            // The 图文 note still goes out, and the missing episode drafts are named, not invented.
            expect(result.stdout).toContain(
                `no publish-prep Content at ${join(dir, '31-publish/20260101_13_publish-prep_content.json')}`,
            );
            expect('followUps' in packagedNote(dir).metadata).toBe(false);
            expect(readFileSync(record, 'utf-8')).toContain('xhs-pub');
        });
    });

    it('daily-publish-xhs names a failed 发播客 follow-up on a cache hit instead of hiding it (0236)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'xhs-pub');
            writeXhsSeries(dir);
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            // A visit whose 图文 draft stood and whose 发播客 note failed.
            writeFileSync(
                join(dir, '31-publish/20260101_19_publish-xhs_result.json'),
                JSON.stringify({
                    ok: true,
                    target: 'xhs',
                    metadata: {
                        publishStatus: 'draft',
                        followUps: [
                            { ok: false, target: 'xhs', error: 'modal save', metadata: { operation: '发播客' } },
                        ],
                    },
                }),
            );

            const result = run(['daily-publish-xhs', dir, '20260101', '', 'false', 'true'], env);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('publish-xhs cached: draft already recorded');
            expect(result.stdout).toContain('follow-up 发播客 did not complete: modal save');
            // Still cached: a rerun would post a second 图文 draft, so the visit is not repeated.
            expect(existsSync(record)).toBe(false);
        });
    });

    it('daily-publish-wechat drafts by default, caches per requested status, and never blocks the run (2026-09-29)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            const env = fakeXhsKk(dir, record, 'wechatmp-pub');
            const article = join(dir, '22-article');
            const publish = join(dir, '31-publish');
            mkdirSync(article, { recursive: true });
            mkdirSync(publish, { recursive: true });

            // No article (generate ran with article_write_enabled=false): skip without a call.
            const skipped = run(['daily-publish-wechat', dir, '20260101', '', 'false'], env);
            expect(skipped.status).toBe(0);
            expect(skipped.stdout).toContain('no article at');
            expect(existsSync(record)).toBe(false);

            writeFileSync(
                join(article, '20260101_06_article_content.json'),
                JSON.stringify({ title: 't', body: 'b', format: 'text' }),
            );
            const input = join(publish, '20260101_20_publish-wechat_content.json');
            const statusOf = (): string =>
                (JSON.parse(readFileSync(input, 'utf-8')) as { metadata: { publishStatus: string } }).metadata
                    .publishStatus;
            const callCount = (): number => readFileSync(record, 'utf-8').trim().split('\n').length;

            // Default is a draft — the article Content is repackaged, never published live by itself.
            expect(run(['daily-publish-wechat', dir, '20260101', '', 'false'], env).status).toBe(0);
            expect(statusOf()).toBe('draft');
            expect(callCount()).toBe(1);

            // Cached on the *requested* status, and a live request re-runs (wechat_live is the rail).
            expect(run(['daily-publish-wechat', dir, '20260101', '', 'false'], env).status).toBe(0);
            expect(callCount()).toBe(1);
            expect(run(['daily-publish-wechat', dir, '20260101', '', 'true'], env).status).toBe(0);
            expect(statusOf()).toBe('public');
            expect(callCount()).toBe(2);
        });
    });

    it('daily-publish-wechat logs a plugin failure without failing the run (non-blocking target)', () => {
        withTempDir((dir) => {
            const record = join(dir, 'kk-argv.jsonl');
            // The plugin refuses (sessionless profile, changed console): the run must survive it.
            const env = fakeXhsKk(dir, record, 'wechatmp-pub', 1);
            mkdirSync(join(dir, '22-article'), { recursive: true });
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            writeFileSync(
                join(dir, '22-article/20260101_06_article_content.json'),
                JSON.stringify({ title: 't', body: 'b', format: 'text' }),
            );
            const result = run(['daily-publish-wechat', dir, '20260101', '', 'false'], env);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('WARNING: publish-wechat — wechatmp-pub exited 1');
        });
    });

    it('daily-wrap-docs hashes the file URL the shell built and labels the profile', () => {
        withTempDir((dir) => {
            for (const sub of ['24-script', '30-audio']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260101';
            const scriptPath = join(dir, `24-script/${stamp}_08_script_voicescript.yaml`);
            // A minimal *valid* VoiceScript: the wrap-docs stage now runs the R3 content validator,
            // so a schema-invalid stub no longer reaches the doc packaging it is here to exercise.
            writeFileSync(scriptPath, 'language: en\nsegments:\n  - text: "Hello and welcome to the episode."\n');
            expect(run(['daily-wrap-docs', dir, stamp, 'Alex']).status).toBe(0);
            const docs = JSON.parse(readFileSync(join(dir, `30-audio/${stamp}_10_wrap-docs_docs.json`), 'utf-8')) as {
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
            mkdirSync(join(dir, '10-ingest'), { recursive: true });
            mkdirSync(join(dir, '20-facts'), { recursive: true });
            const stamp = '20260101';
            writeFileSync(join(dir, `10-ingest/${stamp}_02_collect_blended.json`), '[]');
            expect(run(['daily-collect-facts', dir, stamp, ''], env).status).toBe(0);
            expect(readFileSync(join(dir, `20-facts/${stamp}_02_collect_core-facts.md`), 'utf-8')).toBe('facts body');
            // Second run takes the cache branch (the fake kk would overwrite the body otherwise).
            writeFileSync(join(dir, `20-facts/${stamp}_02_collect_content.json`), JSON.stringify({ body: 'ignored' }));
            expect(run(['daily-collect-facts', dir, stamp, ''], env).status).toBe(0);
            expect(readFileSync(join(dir, `20-facts/${stamp}_02_collect_core-facts.md`), 'utf-8')).toBe('facts body');
        });
    });

    it('daily-translate-localize writes zh/en/ja markers, skips without a zh path, scaffolds otherwise', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20260101';
            // No result.json → no post path → all markers written empty and no scaffolding runs.
            expect(run(['daily-translate-localize', dir, stamp, '']).status).toBe(0);
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`), 'utf-8')).toBe('');
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), 'utf-8')).toBe('');
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), 'utf-8')).toBe('');

            // With a prepared zh path and no draft on disk, each locale scaffolds via surfdash-pub.
            const zhPath = join(dir, 'posts/zh/index.md');
            mkdirSync(dirname(zhPath), { recursive: true });
            writeFileSync(zhPath, 'prepared zh source');
            writeFileSync(
                join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: true, status: 'prepared', metadata: { postPath: zhPath } }],
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

            // A transient scaffold failure must not abort the DAG before the local validator can
            // emit its rejected receipt. The marker is deliberately empty, so final publish stays
            // fail-closed instead of treating a partial locale set as ready.
            rmSync(join(dir, 'posts/en/index.md'), { force: true });
            const scaffoldFailed = run(['daily-translate-localize', dir, stamp, ''], fakeKk(dir, 'process.exit(7)'));
            expect(scaffoldFailed.status).toBe(0);
            expect(scaffoldFailed.stderr).toContain('translate-localize: en scaffold failed');
            expect(scaffoldFailed.stderr).toContain('translate-localize: ja scaffold failed');
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), 'utf-8')).toBe('');
            expect(readFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), 'utf-8')).toBe('');

            // The failed scaffold leaves old publishable files on disk in real workspaces. Empty
            // markers must bind both refine and validation to the current locale set, rather than
            // deriving those stale siblings from the zh path and publishing them.
            writeFileSync(zhPath, 'prepared zh source changed');
            const staleEn = join(dir, 'posts/en/index.md');
            const staleJa = join(dir, 'posts/ja/index.md');
            mkdirSync(dirname(staleEn), { recursive: true });
            mkdirSync(dirname(staleJa), { recursive: true });
            writeFileSync(staleEn, '---\ndraft: false\n---\n\nstale en\n');
            writeFileSync(staleJa, '---\ndraft: false\n---\n\nstale ja\n');
            const refineCalled = join(dir, 'refine-called');
            const noRefineDispatch = fakeKk(
                dir,
                `require('node:fs').writeFileSync(${JSON.stringify(refineCalled)}, 'called');`,
            );
            const blockedRefine = run(['daily-surfdash-refine', dir, stamp, ''], noRefineDispatch);
            expect(blockedRefine.status).toBe(0);
            expect(blockedRefine.stderr).toContain('surfdash-refine: en marker');
            expect(existsSync(refineCalled)).toBe(false);
            const blockedValidate = run([
                'daily-translate-validate',
                dir,
                stamp,
                '',
                join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`),
            ]);
            expect(blockedValidate.status).toBe(0);
            expect(blockedValidate.stderr).toContain('translate-validate: en marker');
            expect(readFileSync(staleEn, 'utf-8')).toContain('stale en');
            expect(readFileSync(staleJa, 'utf-8')).toContain('stale ja');
        });
    });

    it('daily-translate-localize invalidates cached locale drafts when the zh source hash changes', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20261102';
            const zhPath = join(dir, 'posts/zh/index.md');
            const enPath = join(dir, 'posts/en/index.md');
            const jaPath = join(dir, 'posts/ja/index.md');
            mkdirSync(dirname(zhPath), { recursive: true });
            mkdirSync(dirname(enPath), { recursive: true });
            mkdirSync(dirname(jaPath), { recursive: true });
            writeFileSync(zhPath, 'source-v1');
            writeFileSync(enPath, 'translated-en-v1');
            writeFileSync(jaPath, 'translated-ja-v1');
            writeFileSync(
                join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: true, status: 'prepared', metadata: { postPath: zhPath } }],
                }),
            );
            const sourceHash = createHash('sha256').update('source-v1').digest('hex');
            for (const locale of ['en', 'ja']) {
                writeFileSync(join(publish, `${stamp}_20_translate-localize_${locale}-source-sha256.txt`), sourceHash);
            }
            const calls = join(dir, 'scaffold-calls.log');
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const input = args[args.indexOf('--in') + 1];",
                    "const out = args[args.indexOf('--out') + 1];",
                    `const options = JSON.parse(fs.readFileSync(input, 'utf8')).options;`,
                    `fs.appendFileSync(${JSON.stringify(calls)}, options.target + ':' + String(options.force === true) + '\\n');`,
                    "fs.writeFileSync(out, JSON.stringify({ metadata: { draftPath: 'posts/' + JSON.parse(fs.readFileSync(input, 'utf8')).options.target + '/index.md' } }));",
                ].join('\n'),
            );

            expect(run(['daily-translate-localize', dir, stamp, ''], env).status).toBe(0);
            expect(existsSync(calls)).toBe(false);

            writeFileSync(zhPath, 'source-v2');
            expect(run(['daily-translate-localize', dir, stamp, ''], env).status).toBe(0);
            expect(readFileSync(calls, 'utf-8').trim().split('\n').sort()).toEqual(['en:true', 'ja:true']);
        });
    });

    it('daily-prepare-surfdash writes a prepare operation and requires a returned zh post path', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20261102';
            const prep = join(publish, `${stamp}_13_publish-prep_content.json`);
            const postPath = join(dir, 'posts/zh/20261102-post/index.md');
            mkdirSync(join(dir, 'posts/zh/20261102-post'), { recursive: true });
            writeFileSync(prep, JSON.stringify({ title: '每日 AI 新闻', body: '今天的内容。', format: 'markdown' }));
            const env = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    "const path = require('node:path');",
                    'const args = process.argv.slice(2);',
                    "const input = args[args.indexOf('--in') + 1];",
                    "const out = args[args.indexOf('--out') + 1];",
                    `const postPath = ${JSON.stringify(postPath)};`,
                    "fs.writeFileSync(path.join(path.dirname(out), 'locale.txt'), process.env.SURFDASH_LOCALE ?? 'missing');",
                    "fs.writeFileSync(path.join(path.dirname(out), 'prepare-call.json'), JSON.stringify(JSON.parse(fs.readFileSync(input, 'utf8'))));",
                    "fs.writeFileSync(postPath, '---\\ntitle: zh\\n---\\n\\nBody\\n');",
                    "fs.writeFileSync(out, JSON.stringify({ ok: true, target: 'surfdash-pub', metadata: { postPath } }));",
                ].join('\n'),
            );
            const result = run(['daily-prepare-surfdash', dir, stamp, ''], { ...env, SURFDASH_LOCALE: 'en' });
            expect(result.status).toBe(0);
            expect(readFileSync(join(publish, 'locale.txt'), 'utf-8')).toBe('zh');
            const input = JSON.parse(
                readFileSync(join(publish, `${stamp}_14_publish-surfdash-prepare_content.json`), 'utf-8'),
            ) as { options?: { operation?: string } };
            expect(input.options).toEqual({ operation: 'prepare' });
            expect(readFileSync(join(publish, 'prepare-call.json'), 'utf-8')).toContain('"operation":"prepare"');
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`), 'utf-8')),
            ).toMatchObject({
                targets: [{ target: 'surfdash-pub', status: 'prepared', metadata: { postPath } }],
            });
            expect(result.stdout).toContain(`prepared zh post ${postPath}`);

            const failed = run(['daily-prepare-surfdash', dir, stamp, ''], fakeKk(dir, 'process.exit(7)'));
            expect(failed.status).toBe(0);
            expect(failed.stderr).toContain('status 7');
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`), 'utf-8')),
            ).toMatchObject({
                ok: false,
                targets: [{ target: 'surfdash-pub', ok: false, status: 'failed' }],
            });
        });
    });

    it('daily-translate-validate gates the final publish on complete translated locale files', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            const localeRoot = join(dir, 'content/posts/articles');
            mkdirSync(publish, { recursive: true });
            for (const locale of ['zh', 'en', 'ja'])
                mkdirSync(join(localeRoot, locale, '20261102-post'), { recursive: true });
            const stamp = '20261102';
            const post = (locale: string, draft: boolean): string => {
                const path = join(localeRoot, locale, '20261102-post/index.md');
                writeFileSync(
                    path,
                    `---\ndescription: translated description\ndraft: ${draft}\nrefined: true\nkey_points:\n  - Label — one sentence\n---\n\nBody\n`,
                );
                return path;
            };
            const zhPath = post('zh', false);
            const enPath = post('en', false);
            const jaPath = post('ja', false);
            const marker = join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`);
            writeFileSync(marker, zhPath);
            for (const locale of ['en', 'ja'] as const) {
                writeFileSync(
                    join(publish, `${stamp}_20_translate-localize_${locale}-post-path.txt`),
                    locale === 'en' ? enPath : jaPath,
                );
            }

            const passed = run(['daily-translate-validate', dir, stamp, '', marker]);
            expect(passed.status).toBe(0);
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_24_translate-validate_result.json`), 'utf-8')),
            ).toMatchObject({
                ok: true,
                status: 'validated',
                metadata: { postPath: zhPath },
            });

            // The final validator is read-only: a retired series name must be repaired before
            // site-owned refine/fingerprinting, never rewritten after the fingerprint is admitted.
            const pendingNames = readFileSync(enPath, 'utf-8').replace(
                'description: translated description',
                'title: Daily AI Medley\ndescription: translated description',
            );
            writeFileSync(enPath, pendingNames);
            rmSync(join(publish, `${stamp}_24_translate-validate_result.json`));
            const pending = run(['daily-translate-validate', dir, stamp, '', marker]);
            expect(pending.status).toBe(0);
            expect(pending.stderr).toContain('series-name normalization is pending');
            expect(readFileSync(enPath, 'utf-8')).toBe(pendingNames);
            writeFileSync(enPath, pendingNames.replace('title: Daily AI Medley\n', ''));

            // The local gate must not admit a fresh, unrefined locale set even when the structural
            // translation checks pass; the site-owned refine phase is a prerequisite to fingerprinting.
            writeFileSync(enPath, readFileSync(enPath, 'utf-8').replace('refined: true', 'refined: false'));
            rmSync(join(publish, `${stamp}_24_translate-validate_result.json`));
            const unrefined = run(['daily-translate-validate', dir, stamp, '', marker]);
            expect(unrefined.status).toBe(0);
            expect(unrefined.stderr).toContain('site-owned refine has not completed');
            writeFileSync(enPath, readFileSync(enPath, 'utf-8').replace('refined: false', 'refined: true'));

            writeFileSync(jaPath, readFileSync(jaPath, 'utf-8').replace('draft: false', 'draft: true'));
            rmSync(join(publish, `${stamp}_24_translate-validate_result.json`));
            const rejected = run(['daily-translate-validate', dir, stamp, '', marker]);
            expect(rejected.status).toBe(0);
            expect(rejected.stderr).toContain('draft is still true');
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_24_translate-validate_result.json`), 'utf-8')),
            ).toMatchObject({ ok: false, status: 'rejected' });

            // A malformed or absent key_points list is not a translatable locale, even when the
            // description and draft flag look valid.
            post('ja', false);
            writeFileSync(
                enPath,
                readFileSync(enPath, 'utf-8').replace('key_points:\n  - Label — one sentence', 'key_points: malformed'),
            );
            rmSync(join(publish, `${stamp}_24_translate-validate_result.json`));
            const malformed = run(['daily-translate-validate', dir, stamp, '', marker]);
            expect(malformed.status).toBe(0);
            expect(malformed.stderr).toContain('key_points missing or malformed');
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_24_translate-validate_result.json`), 'utf-8')),
            ).toMatchObject({
                ok: false,
                status: 'rejected',
            });

            // Restore a valid tree and capture the validator's source-bound receipt for the final
            // publisher checks below.
            post('en', false);
            post('ja', false);
            rmSync(join(publish, `${stamp}_24_translate-validate_result.json`));
            expect(run(['daily-translate-validate', dir, stamp, '', marker]).status).toBe(0);
            const validation = JSON.parse(
                readFileSync(join(publish, `${stamp}_24_translate-validate_result.json`), 'utf-8'),
            ) as { metadata: Record<string, unknown> };
            expect(validation.metadata).toMatchObject({ runDate: stamp, postPath: zhPath });
            expect(validation.metadata.localePaths).toMatchObject({ zh: zhPath, en: enPath, ja: jaPath });
            const localeDigests = validation.metadata.localeDigests as Record<string, string>;
            for (const [locale, path] of Object.entries({ zh: zhPath, en: enPath, ja: jaPath })) {
                expect(localeDigests[locale]).toBe(createHash('sha256').update(readFileSync(path)).digest('hex'));
            }
            expect(typeof validation.metadata.fingerprint).toBe('string');

            const prepareResult = join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`);
            writeFileSync(
                prepareResult,
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: true, status: 'prepared', metadata: { postPath: zhPath } }],
                }),
            );
            writeFileSync(join(publish, `${stamp}_13_publish-prep_content.json`), '{}');
            const localeCapture = join(dir, 'surfdash-locale.txt');
            const dispatch = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    `fs.writeFileSync(${JSON.stringify(localeCapture)}, process.env.SURFDASH_LOCALE ?? 'missing');`,
                    "fs.writeFileSync(out, JSON.stringify({ ok: true, target: 'surfdash', status: 'published' }));",
                ].join('\n'),
            );
            const published = run(['daily-publish-surfdash', dir, stamp, '', 'true'], {
                ...dispatch,
                SURFDASH_LOCALE: 'ja',
            });
            expect(published.status).toBe(0);
            expect(readFileSync(localeCapture, 'utf-8')).toBe('zh');

            // Changing a locale after validation invalidates the receipt. A prior success must not
            // turn that stale validation into a silent cache hit; dispatch is forbidden.
            writeFileSync(enPath, `${readFileSync(enPath, 'utf-8')}\nchanged-after-validation`);
            rmSync(localeCapture, { force: true });
            const stale = run(['daily-publish-surfdash', dir, stamp, '', 'true'], {
                ...dispatch,
                SURFDASH_LOCALE: 'ja',
            });
            expect(stale.status).toBe(0);
            expect(stale.stderr).toContain('locale validation');
            expect(existsSync(localeCapture)).toBe(false);
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_14_publish-surfdash_result.json`), 'utf-8')),
            ).toMatchObject({
                targets: [{ target: 'surfdash-pub', status: 'failed', metadata: { deliveryState: 'uncertain' } }],
            });

            // The workflow keeps the run's terminal classifier alive, but the final publisher writes
            // an explicit failed receipt and never invokes kk/CMS when the local gate rejects.
            rmSync(join(publish, `${stamp}_14_publish-surfdash_result.json`), { force: true });
            const blocked = run(['daily-publish-surfdash', dir, stamp, '', 'true'], fakeKk(dir, 'process.exit(99)'));
            expect(blocked.status).toBe(0);
            expect(blocked.stderr).toContain('blocked by locale validation');
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_14_publish-surfdash_result.json`), 'utf-8')),
            ).toMatchObject({
                ok: false,
                targets: [{ target: 'surfdash-pub', ok: false, status: 'failed' }],
            });
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_14_publish-surfdash_result.json`), 'utf-8')),
            ).toMatchObject({ targets: [{ metadata: { deliveryState: 'not-sent' } }] });
        });
    });

    it('daily-surfdash-refine delegates site-owned refinement for every locale before the gate fingerprint', () => {
        withTempDir((dir) => {
            const stamp = '20261102';
            const surfdash = join(dir, 'surfdash');
            const workDir = join(dir, 'work');
            const publish = join(workDir, '31-publish');
            const slug = `${stamp}-fresh-refine`;
            const paths = {
                zh: join(surfdash, 'content/posts/articles/zh', slug, 'index.md'),
                en: join(surfdash, 'content/posts/articles/en', slug, 'index.md'),
                ja: join(surfdash, 'content/posts/articles/ja', slug, 'index.md'),
            };
            mkdirSync(publish, { recursive: true });
            for (const path of Object.values(paths)) {
                mkdirSync(dirname(path), { recursive: true });
                const locale = path.includes('/en/') ? 'en' : path.includes('/ja/') ? 'ja' : 'zh';
                const title = locale === 'en' ? 'Daily AI Medley' : locale === 'ja' ? '毎日AIブレンド' : '每日AI乱炖';
                const body =
                    locale === 'en'
                        ? 'Your daily AI hodgepodge from Robin, on Salty Talk.'
                        : locale === 'ja'
                          ? '咸話咸説の毎日AIブレンド、Robin がお届けします。'
                          : '咸话咸说之AI乱炖。';
                writeFileSync(
                    path,
                    `---\ntitle: ${title}\npublishDate: "2026-11-02"\ndraft: false\nrefined: false\n---\n\n${body}\n`,
                );
            }
            mkdirSync(join(surfdash, 'scripts'), { recursive: true });
            writeFileSync(
                join(surfdash, 'scripts/publish-orchestrator.ts'),
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const path = process.argv[3];',
                    "if (process.argv[2] !== 'refine' || !path) process.exit(2);",
                    "writeFileSync(path, readFileSync(path, 'utf-8').replace('refined: false', 'refined: true'));",
                ].join('\n'),
            );
            const marker = join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`);
            writeFileSync(marker, paths.zh);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), paths.en);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), paths.ja);
            const pluginsRoot = join(import.meta.dir, '../../../plugins');
            const refined = run(['daily-surfdash-refine', workDir, stamp, pluginsRoot], {
                SURFDASH_ROOT: surfdash,
            });
            expect(refined.status).toBe(0);
            for (const path of Object.values(paths)) {
                const content = readFileSync(path, 'utf-8');
                expect(content).toContain('refined: true');
                expect(content).not.toContain('Daily AI Medley');
                expect(content).not.toContain('毎日AIブレンド');
                expect(content).not.toContain('咸话咸说之AI乱炖。');
            }
            const afterFirstRefine = Object.fromEntries(
                Object.entries(paths).map(([locale, path]) => [locale, readFileSync(path, 'utf-8')]),
            ) as Record<string, string>;
            const repeated = run(['daily-surfdash-refine', workDir, stamp, pluginsRoot], {
                SURFDASH_ROOT: surfdash,
            });
            expect(repeated.status).toBe(0);
            for (const [locale, path] of Object.entries(paths)) {
                const expected = afterFirstRefine[locale];
                if (expected === undefined) throw new Error(`missing first-refine snapshot for ${locale}`);
                expect(readFileSync(path as string, 'utf-8')).toBe(expected);
            }
            expect(
                JSON.parse(readFileSync(join(publish, `${stamp}_24_surfdash-refine_result.json`), 'utf-8')),
            ).toMatchObject({
                ok: true,
                targets: [{ target: 'surfdash-pub', status: 'refined' }],
            });
        });
    });

    it('daily-surfdash-refine installs the work-dir translations over the locale scaffolds (20261104 sandbox)', () => {
        // 2026-11-04: codex (workspace-write) and claude (acceptEdits) both run with cwd = this repo,
        // so neither could edit the scaffolds in the Surfdash checkout; both "succeeded" and left
        // en/ja untranslated. The agents now write under the work dir and this stage installs them.
        withTempDir((dir) => {
            const stamp = '20261104';
            const surfdash = join(dir, 'surfdash');
            const publish = join(dir, 'work', '31-publish');
            const slug = `${stamp}-sandbox`;
            const path = (locale: string) => join(surfdash, 'content/posts/articles', locale, slug, 'index.md');
            mkdirSync(publish, { recursive: true });
            for (const locale of ['zh', 'en', 'ja']) {
                mkdirSync(dirname(path(locale)), { recursive: true });
                writeFileSync(
                    path(locale),
                    `---\ntitle: scaffold\ndraft: ${locale !== 'zh'}\nrefined: false\n---\n\n正文\n`,
                );
                writeFileSync(join(publish, `${stamp}_20_translate-localize_${locale}-post-path.txt`), path(locale));
            }
            const translated = (locale: string) => join(publish, `${stamp}_21_translate_${locale}.md`);
            writeFileSync(translated('en'), '---\ntitle: Translated\ndraft: false\nrefined: false\n---\n\nBody\n');
            writeFileSync(translated('ja'), '---\ntitle: 翻訳済み\ndraft: false\nrefined: false\n---\n\n本文\n');
            mkdirSync(join(surfdash, 'scripts'), { recursive: true });
            writeFileSync(
                join(surfdash, 'scripts/publish-orchestrator.ts'),
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const path = process.argv[3];',
                    "if (process.argv[2] !== 'refine' || !path) process.exit(2);",
                    "writeFileSync(path, readFileSync(path, 'utf-8').replace('refined: false', 'refined: true'));",
                ].join('\n'),
            );
            const pluginsRoot = join(import.meta.dir, '../../../plugins');
            const refined = run(['daily-surfdash-refine', join(dir, 'work'), stamp, pluginsRoot], {
                SURFDASH_ROOT: surfdash,
            });
            expect(refined.status).toBe(0);
            expect(readFileSync(path('en'), 'utf-8')).toContain('title: Translated');
            expect(readFileSync(path('ja'), 'utf-8')).toContain('title: 翻訳済み');
            expect(readFileSync(path('en'), 'utf-8')).toContain('refined: true');
            // Consumed once: a rerun must not clobber an operator's repair of the installed post.
            expect(existsSync(translated('en'))).toBe(false);
            writeFileSync(path('en'), readFileSync(path('en'), 'utf-8').replace('Body', 'Repaired'));
            expect(
                run(['daily-surfdash-refine', join(dir, 'work'), stamp, pluginsRoot], { SURFDASH_ROOT: surfdash })
                    .status,
            ).toBe(0);
            expect(readFileSync(path('en'), 'utf-8')).toContain('Repaired');
        });
    });

    it('daily-publish-surfdash treats duplicate target receipts as uncertain and never retries', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20261102';
            const resultPath = join(publish, `${stamp}_14_publish-surfdash_result.json`);
            writeFileSync(
                resultPath,
                JSON.stringify({
                    targets: [
                        { target: 'surfdash-pub', ok: true, status: 'published' },
                        { target: 'surfdash-pub', ok: true, status: 'published' },
                    ],
                }),
            );
            const called = join(dir, 'called');
            const blocked = run(
                ['daily-publish-surfdash', dir, stamp, ''],
                fakeKk(dir, `require('node:fs').writeFileSync(${JSON.stringify(called)}, 'called')`),
            );
            expect(blocked.status).toBe(0);
            expect(blocked.stdout).toContain('uncertain delivery');
            expect(existsSync(called)).toBe(false);
            expect(JSON.parse(readFileSync(resultPath, 'utf-8'))).toMatchObject({
                targets: [{ metadata: { deliveryState: 'uncertain' } }],
            });
        });
    });

    it('daily-publish-surfdash never caches a legacy success or a changed slug identity', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            const articles = join(dir, 'content/posts/articles');
            const stamp = '20261102';
            mkdirSync(publish, { recursive: true });
            const writeLocaleSet = (slug: string): { zh: string; en: string; ja: string } => {
                const paths = {
                    zh: join(articles, 'zh', slug, 'index.md'),
                    en: join(articles, 'en', slug, 'index.md'),
                    ja: join(articles, 'ja', slug, 'index.md'),
                };
                for (const [locale, path] of Object.entries(paths)) {
                    mkdirSync(dirname(path), { recursive: true });
                    writeFileSync(
                        path,
                        `---\ndescription: valid ${locale}\ndraft: false\nrefined: true\nkey_points:\n  - Label — one sentence\n---\n\nBody\n`,
                    );
                }
                return paths;
            };
            const oldPaths = writeLocaleSet('20261102-original');
            const marker = join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`);
            writeFileSync(marker, oldPaths.zh);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), oldPaths.en);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), oldPaths.ja);
            writeFileSync(
                join(publish, `${stamp}_13_publish-prep_content.json`),
                JSON.stringify({ title: 'prepared' }),
            );
            writeFileSync(
                join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`),
                JSON.stringify({
                    targets: [
                        { target: 'surfdash-pub', ok: true, status: 'prepared', metadata: { postPath: oldPaths.zh } },
                    ],
                }),
            );
            expect(run(['daily-translate-validate', dir, stamp, '', marker]).status).toBe(0);
            const dispatch = fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    `fs.writeFileSync(${JSON.stringify(join(dir, 'called'))}, 'called');`,
                    "fs.writeFileSync(out, JSON.stringify({ ok: true, target: 'surfdash' }));",
                ].join('\n'),
            );
            const first = run(['daily-publish-surfdash', dir, stamp, '', 'true'], dispatch);
            expect(first.status).toBe(0);
            const resultPath = join(publish, `${stamp}_14_publish-surfdash_result.json`);
            const firstResult = JSON.parse(readFileSync(resultPath, 'utf-8')) as Record<string, unknown>;
            expect(firstResult.targets).toBeDefined();

            // A failed executor discovery can return before it owns/clears --out. A stale
            // transport success must not be promoted into this invocation's publish receipt.
            const intentPath = join(publish, `${stamp}_14_publish-surfdash_intent.json`);
            const transportPath = join(publish, `${stamp}_14_publish-surfdash_transport_result.json`);
            const savedIntent = readFileSync(intentPath, 'utf-8');
            rmSync(resultPath, { force: true });
            rmSync(intentPath, { force: true });
            writeFileSync(transportPath, JSON.stringify({ ok: true, target: 'surfdash' }));
            const failedDispatch = fakeKk(dir, 'process.exit(7);');
            const staleTransport = run(['daily-publish-surfdash', dir, stamp, '', 'true'], failedDispatch);
            expect(staleTransport.status).toBe(0);
            expect(staleTransport.stderr).toContain('delivery is uncertain');
            expect(JSON.parse(readFileSync(resultPath, 'utf-8'))).toMatchObject({
                targets: [{ metadata: { deliveryState: 'uncertain' } }],
            });
            writeFileSync(resultPath, JSON.stringify(firstResult));
            writeFileSync(intentPath, savedIntent);

            // A pre-existing success from the old fan-out path has no exact identity and may not
            // satisfy a same-day rerun, even though the local validation receipt is still current.
            writeFileSync(
                resultPath,
                JSON.stringify({
                    ok: true,
                    targets: [
                        { target: 'surfdash-pub', ok: true, status: 'published', metadata: { postPath: oldPaths.zh } },
                    ],
                }),
            );
            rmSync(join(dir, 'called'), { force: true });
            const legacy = run(['daily-publish-surfdash', dir, stamp, '', 'true'], dispatch);
            expect(legacy.status).toBe(0);
            expect(legacy.stderr).toContain('exact postPath/payloadSha256/localeFingerprint identity');
            expect(existsSync(join(dir, 'called'))).toBe(false);

            // A fully-bound success for the old slug must not cache after the validated path moves
            // to a different same-day slug. The dispatch must remain untouched.
            writeFileSync(resultPath, JSON.stringify(firstResult));
            const newPaths = writeLocaleSet('20261102-regenerated');
            writeFileSync(marker, newPaths.zh);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_en-post-path.txt`), newPaths.en);
            writeFileSync(join(publish, `${stamp}_20_translate-localize_ja-post-path.txt`), newPaths.ja);
            writeFileSync(
                join(publish, `${stamp}_14_publish-surfdash-prepare_result.json`),
                JSON.stringify({
                    targets: [
                        { target: 'surfdash-pub', ok: true, status: 'prepared', metadata: { postPath: newPaths.zh } },
                    ],
                }),
            );
            expect(run(['daily-translate-validate', dir, stamp, '', marker]).status).toBe(0);
            const changed = run(['daily-publish-surfdash', dir, stamp, '', 'true'], dispatch);
            expect(changed.status).toBe(0);
            expect(changed.stderr).toContain('exact postPath/payloadSha256/localeFingerprint identity');
            expect(existsSync(join(dir, 'called'))).toBe(false);
            expect(JSON.parse(readFileSync(resultPath, 'utf-8'))).toMatchObject({
                targets: [{ metadata: { deliveryState: 'uncertain', postPath: newPaths.zh } }],
            });
        });
    });

    it('daily-publish-surfdash preserves the legacy success cache when locale validation is omitted', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            const stamp = '20261102';
            mkdirSync(publish, { recursive: true });
            const resultPath = join(publish, `${stamp}_14_publish-surfdash_result.json`);
            writeFileSync(
                resultPath,
                JSON.stringify({
                    ok: true,
                    targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }],
                }),
            );
            const called = join(dir, 'legacy-dispatch-called');
            const cached = run(
                ['daily-publish-surfdash', dir, stamp, ''],
                fakeKk(dir, `require('node:fs').writeFileSync(${JSON.stringify(called)}, 'called');`),
            );
            expect(cached.status).toBe(0);
            expect(cached.stdout).toContain('surfdash target ok');
            expect(existsSync(called)).toBe(false);
            expect(JSON.parse(readFileSync(resultPath, 'utf-8'))).toMatchObject({
                targets: [{ status: 'published' }],
            });
        });
    });

    it('daily-translate-sync skips without a zh path file and syncs through the zh marker', () => {
        withTempDir((dir) => {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            const stamp = '20260101';
            // No marker file at all → loud skip without invoking kk.
            expect(run(['daily-translate-sync', dir, stamp, '', '']).status).toBe(0);
            expect(existsSync(join(publish, `${stamp}_24_translate-sync_sync.json`))).toBe(false);

            const marker = join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`);
            // The shipped marker holds the post's ABSOLUTE path inside the checkout; the plugin
            // itself rejects anything else, so the fixture writes the real shape (2026-10-22).
            const post = join(dir, 'checkout', 'content', 'posts', 'articles', 'zh', `post`, 'index.md');
            mkdirSync(dirname(post), { recursive: true });
            writeFileSync(post, '---\ntitle: T\n---\n');
            writeFileSync(marker, post);
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
            expect(sync.options).toEqual({ operation: 'sync', postPath: post });

            // Passing the POST as the 4th argument instead of the marker fails loud and never
            // forwards the article body to the plugin as a `postPath` (2026-10-22).
            rmSync(join(publish, `${stamp}_24_translate-sync_sync.json`), { force: true });
            const wrong = run(['daily-translate-sync', dir, stamp, '', post], env);
            expect(wrong.status).toBe(1);
            expect(wrong.stderr).toContain('must be the zh marker file');
            expect(existsSync(join(publish, `${stamp}_24_translate-sync_sync.json`))).toBe(false);
        });
    });

    // 2026-10-23: the translate agent invented locale series names (ja 毎日AIブレンド, en
    // "Daily AI Medley"/hodgepodge phrasing, zh-name listen links inside en/ja). The prompt pins
    // the names; these tests pin the deterministic backstop in the stage — rewrite the known bad
    // set per locale before the CMS sync, fail on anything the rewrite cannot make safe, and gate
    // the key_points label discipline.
    describe('daily-translate-sync series names + key_points labels (20261023)', () => {
        interface Draft {
            title: string;
            body: string[];
            items: string[];
        }

        function localeTree(
            dir: string,
            stamp: string,
            drafts: { en?: Draft; ja?: Draft; zhShortForm?: boolean },
        ): {
            marker: string;
            at: (locale: string) => string;
        } {
            const publish = join(dir, '31-publish');
            mkdirSync(publish, { recursive: true });
            const marker = join(publish, `${stamp}_20_translate-localize_zh-post-path.txt`);
            const at = (locale: string) =>
                join(dir, 'checkout', 'content', 'posts', 'articles', locale, 'post', 'index.md');
            mkdirSync(dirname(at('zh')), { recursive: true });
            writeFileSync(
                at('zh'),
                [
                    '---',
                    'title: 每日AI乱炖 · 2026-10-23',
                    'key_points:',
                    '  - "模型 — OpenAI 发布了 GPT-5.2。"',
                    '---',
                    '',
                    drafts.zhShortForm === true
                        ? '这里是由Robin为你带来的咸话咸说之AI乱炖。'
                        : '这里是由Robin为你带来的咸话咸说之每日AI乱炖。',
                    '',
                ].join('\n'),
            );
            writeFileSync(marker, at('zh'));
            const stock = {
                en: {
                    title: 'Daily AI Medley · 2026-10-23',
                    body: [
                        'Your daily AI hodgepodge from Robin, on Salty Talk.',
                        '[listen to 每日AI乱炖 · 2026-10-23](https://pod.example/i/1).',
                    ],
                    items: ['"Model launch — OpenAI shipped GPT-5.2 with new tools."'],
                },
                ja: {
                    title: '毎日AIブレンド · 2026-10-23',
                    body: [
                        '咸話咸説の毎日AIブレンド、Robin がお届けします。',
                        '[每日AI乱炖 · 2026-10-23 を聴く](https://pod.example/i/1)。',
                    ],
                    items: ['"モデル公開 — OpenAI が GPT-5.2 をリリース。"'],
                },
            } as Record<'en' | 'ja', Draft>;
            for (const locale of ['en', 'ja'] as const) {
                const draft = drafts[locale] ?? stock[locale];
                mkdirSync(dirname(at(locale)), { recursive: true });
                writeFileSync(
                    at(locale),
                    [
                        '---',
                        `title: ${draft.title}`,
                        'description: "A summary."',
                        'key_points:',
                        ...draft.items.map((item) => `  - ${item}`),
                        '---',
                        '',
                        ...draft.body,
                        '',
                    ].join('\n'),
                );
            }
            return { marker, at };
        }

        const okKk = (dir: string): Record<string, string> =>
            fakeKk(
                dir,
                [
                    "const fs = require('node:fs');",
                    'const args = process.argv.slice(2);',
                    "const out = args[args.indexOf('--out') + 1];",
                    'fs.writeFileSync(out, JSON.stringify({ ok: true }));',
                ].join('\n'),
            );

        it('rewrites the retired/wrong-locale series names in all three posts before syncing', () => {
            withTempDir((dir) => {
                const stamp = '20260101';
                const { marker, at } = localeTree(dir, stamp, { zhShortForm: true });
                expect(run(['daily-translate-sync', dir, stamp, '', marker], okKk(dir)).status).toBe(0);
                expect(readFileSync(at('zh'), 'utf-8')).toContain('咸话咸说之每日AI乱炖。');
                const en = readFileSync(at('en'), 'utf-8');
                expect(en).toContain('title: Daily AI Stew · 2026-10-23');
                expect(en).toContain('Your Daily AI Stew from Robin, on Salty Talk.');
                expect(en).toContain('[listen to Daily AI Stew · 2026-10-23](https://pod.example/i/1)');
                const ja = readFileSync(at('ja'), 'utf-8');
                expect(ja).toContain('title: デイリーAIシチュー · 2026-10-23');
                expect(ja).toContain('咸話咸説のデイリーAIシチュー、Robin がお届けします。');
                expect(ja).toContain('[デイリーAIシチュー · 2026-10-23 を聴く](https://pod.example/i/1)');
                expect(existsSync(join(dir, '31-publish', `${stamp}_24_translate-sync_sync.json`))).toBe(true);
            });
        });

        it('fails the sync when a retired name cannot be rewritten safely', () => {
            withTempDir((dir) => {
                const stamp = '20260101';
                const { marker } = localeTree(dir, stamp, {
                    en: {
                        title: 'Daily AI Stew · 2026-10-23',
                        body: ['The stack is a hodgepodge of APIs.'],
                        items: ['"Model launch — OpenAI shipped GPT-5.2 with new tools."'],
                    },
                });
                const failed = run(['daily-translate-sync', dir, stamp, '', marker], okKk(dir));
                expect(failed.status).toBe(1);
                expect(failed.stderr).toContain('en draft failed the pre-sync structural check');
                expect(failed.stderr).toContain('retired series names left after rewrite: hodgepodge');
                expect(existsSync(join(dir, '31-publish', `${stamp}_24_translate-sync_sync.json`))).toBe(false);
            });
        });

        it('fails the sync on key_points labels over the locale cap or …-truncated', () => {
            withTempDir((dir) => {
                const stamp = '20260101';
                const good = {
                    title: 'Daily AI Stew · 2026-10-23',
                    body: ['Body line.'],
                    items: ['"Model launch — OpenAI shipped GPT-5.2 with new tools."'],
                };
                const longLabel = {
                    ...good,
                    items: ['"OpenAI launches its next-generation flagship — GPT-5.2 shipped with new tools."'],
                };
                const truncated = {
                    title: 'デイリーAIシチュー · 2026-10-23',
                    body: ['本文。'],
                    items: ['"新モデルの発表が… — OpenAI が GPT-5.2 をリリース。"'],
                };
                const cases = [
                    { drafts: { en: longLabel }, locale: 'en', cap: 28 },
                    { drafts: { ja: truncated }, locale: 'ja', cap: 14 },
                ];
                for (const { drafts, locale, cap } of cases) {
                    withTempDir((inner) => {
                        const tree = localeTree(inner, stamp, drafts);
                        const failed = run(['daily-translate-sync', inner, stamp, '', tree.marker], okKk(inner));
                        expect(failed.status).toBe(1);
                        expect(failed.stderr).toContain(`${locale} draft failed the pre-sync structural check`);
                        expect(failed.stderr).toContain(`key_points label over ${cap} chars or …-truncated`);
                    });
                }
                // A cap-compliant label syncs cleanly — the YAML quotes do not count toward the cap
                // (the 14-char ja label "Character.AI買収" from the 2026-10-23 post sits exactly at it).
                const jaAtCap = {
                    title: 'デイリーAIシチュー · 2026-10-23',
                    body: ['本文。'],
                    items: ['"Character.AI買収 — Character.AI は今週正式に破産を申請した。"'],
                };
                const clean = localeTree(dir, stamp, { en: good, ja: jaAtCap });
                expect(run(['daily-translate-sync', dir, stamp, '', clean.marker], okKk(dir)).status).toBe(0);
                // Nor does a folded scalar's `>-` indicator: refine writes long items that way
                // (2026-11-04 rejected "trnrtの推論最適化", 11 chars, as ">- trnrtの推論最適化").
                const jaFolded = {
                    ...jaAtCap,
                    items: ['>-\n    Character.AI買収 — Character.AI は今週\n    正式に破産を申請した。'],
                };
                withTempDir((inner) => {
                    const tree = localeTree(inner, stamp, { en: good, ja: jaFolded });
                    const synced = run(['daily-translate-sync', inner, stamp, '', tree.marker], okKk(inner));
                    expect(synced.stderr).not.toContain('pre-sync structural check');
                    expect(synced.status).toBe(0);
                });
            });
        });
    });

    // The marker is the run's artifact, so it belongs under the run's workDir — a cwd-relative
    // path both littered whatever tree the caller stood in and moved the note out of the episode.
    it('daily-publish-partial names the failed targets and writes the retry file under workDir', () => {
        withTempDir((dir) => {
            withTempDir((cwd) => {
                mkdirSync(join(dir, '31-publish'), { recursive: true });
                const stamp = '20260101';
                writeFileSync(
                    join(dir, `31-publish/${stamp}_17_publish_result.json`),
                    JSON.stringify({
                        targets: [
                            { target: 'surfdash-pub', ok: true, status: 'published' },
                            { target: 'podcast-pub', ok: false, status: 'failed' },
                        ],
                    }),
                );
                const result = run(['daily-publish-partial', dir, stamp], {}, runner, cwd);
                expect(result.status).toBe(0);
                expect(result.stderr).toContain('failed targets: podcast-pub');
                const retry = readFileSync(join(dir, '.spur/run', `publish-partial-${stamp}.txt`), 'utf-8');
                expect(retry).toContain('failed targets: podcast-pub');
                expect(retry).toContain('--retry-from');
                expect(existsSync(join(cwd, '.spur'))).toBe(false);
            });
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
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            const stamp = '20260101';
            const postPath = '/posts/zh/daily-ai-20260101/index.md';
            writeFileSync(
                join(dir, `31-publish/${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: true, status: 'published', metadata: { postPath } }],
                }),
            );
            const rendered = run(['daily-show-notes', dir, stamp, '', 'Daily AI'], showNotesKk(dir));
            expect(rendered.status).toBe(0);
            expect(rendered.stderr).not.toContain('ARTICLE_POST_PATH is empty');
            expect(showNotesEnv(dir)).toMatchObject({
                PODCAST_PUB_ARTICLE_POST_PATH: postPath,
                PODCAST_PUB_RUN_DATE: stamp,
                PODCAST_PUB_BRIEF_MODE: 'true',
                PODCAST_PUB_TITLE: 'Daily AI',
            });
            expect(showNotesEnv(dir).PODCAST_PUB_FOOTER_NOTE).toBeUndefined();
        });
    });

    it('daily-show-notes forwards the frozen judgment snapshot so the correction block can be carried (0396 R1)', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const stamp = '20260101';
            const snapshot = join(dir, `21-plan/${stamp}_judgment-snapshot.json`);
            writeFileSync(
                snapshot,
                JSON.stringify({ version: 1, runDate: stamp, judgments: [], superseded: [], corrections: [] }),
            );
            const rendered = run(['daily-show-notes', dir, stamp, '', 'Daily AI'], showNotesKk(dir));
            expect(rendered.status).toBe(0);
            // The stage owns the wiring: the plugin reads the snapshot path, not the ledger, and only
            // when it exists — otherwise a run without corrections renders byte-identically.
            expect(showNotesEnv(dir)).toMatchObject({ PODCAST_PUB_CORRECTIONS: snapshot });

            const withoutSnapshot = run(['daily-show-notes', dir, '20260102', '', 'Daily AI'], showNotesKk(dir));
            expect(withoutSnapshot.status).toBe(0);
            expect(showNotesEnv(dir).PODCAST_PUB_CORRECTIONS).toBeUndefined();
        });
    });

    it('daily-show-notes degrades to an empty article post path when the surfdash result is absent or failed', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            const stamp = '20260101';
            // Absent file — the surfdash state never ran or published nothing.
            const absent = run(['daily-show-notes', dir, stamp, '', 'T'], showNotesKk(dir));
            expect(absent.status).toBe(0);
            expect(absent.stderr).toContain(
                'WARN podcast-pub: brief mode requested but ARTICLE_POST_PATH is empty; using legacy layout',
            );
            expect(showNotesEnv(dir).PODCAST_PUB_ARTICLE_POST_PATH).toBe('');
            // Present file with a failed target — the legacy full-body layout must survive.
            writeFileSync(
                join(dir, `31-publish/${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: false, status: 'failed', metadata: { postPath: null } }],
                }),
            );
            const failed = run(['daily-show-notes', dir, stamp, '', 'T'], showNotesKk(dir));
            expect(failed.status).toBe(0);
            expect(failed.stderr).toContain(
                'WARN podcast-pub: brief mode requested but ARTICLE_POST_PATH is empty; using legacy layout',
            );
            expect(showNotesEnv(dir).PODCAST_PUB_ARTICLE_POST_PATH).toBe('');
        });
    });

    it('daily-show-notes never depends on _17_publish_result.json, which the later publish state writes', () => {
        withTempDir((dir) => {
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            const stamp = '20260101';
            writeFileSync(
                join(dir, `31-publish/${stamp}_17_publish_result.json`),
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
            const later = run(['daily-show-notes', dir, stamp, '', 'T'], showNotesKk(dir));
            expect(later.status).toBe(0);
            expect(later.stderr).toContain(
                'WARN podcast-pub: brief mode requested but ARTICLE_POST_PATH is empty; using legacy layout',
            );
            expect(showNotesEnv(dir).PODCAST_PUB_ARTICLE_POST_PATH).toBe('');
        });
    });

    it('daily-publish-podcast forwards the frozen judgment snapshot so a delivery can be recorded (0396 R1)', () => {
        withTempDir((dir) => {
            const stamp = '20260101';
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            // The publish stage only reaches its fan-out with a prepared Content in place.
            writeFileSync(
                join(dir, '31-publish', `${stamp}_13_publish-prep_content.json`),
                JSON.stringify({
                    title: '每日AI乱炖 · 2026-01-01',
                    body: 'notes',
                    format: 'markdown',
                    metadata: { audioFile: '/tmp/a.mp3', podcast: { keep: true } },
                }),
            );
            writeFileSync(join(dir, '31-publish', `${stamp}_15_show-notes_show-notes.md`), '# notes\n');
            const snapshot = join(dir, `21-plan/${stamp}_judgment-snapshot.json`);
            writeFileSync(
                snapshot,
                JSON.stringify({ version: 1, runDate: stamp, judgments: [], superseded: [], corrections: [] }),
            );
            const envLog = join(dir, 'publish-env.jsonl');
            // A correction's delivery becomes real at dispatch, so the snapshot must ride the fan-out;
            // without it the per-target record could never be written by a production run.
            const published = run(
                ['daily-publish-podcast', dir, stamp, ''],
                fakeKk(
                    dir,
                    `require('node:fs').appendFileSync(${JSON.stringify(envLog)}, JSON.stringify(process.env) + '\\n'); process.exit(0)`,
                ),
            );
            expect(published.status).toBe(0);
            const envs = readFileSync(envLog, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as Record<string, string>);
            expect(envs.some((entry) => entry.PODCAST_PUB_CORRECTIONS === snapshot)).toBe(true);
        });
    });

    it('daily-publish-podcast hands the other channels dispatch rows to the correction classifier (0396 R2)', () => {
        withTempDir((dir) => {
            const stamp = '20260101';
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            mkdirSync(join(dir, '4-publish'), { recursive: true });
            writeFileSync(
                join(dir, '31-publish', `${stamp}_13_publish-prep_content.json`),
                JSON.stringify({
                    title: '每日AI乱炖 · 2026-01-01',
                    body: 'notes',
                    format: 'markdown',
                    metadata: { audioFile: '/tmp/a.mp3', podcast: { keep: true } },
                }),
            );
            writeFileSync(join(dir, '31-publish', `${stamp}_15_show-notes_show-notes.md`), '# notes\n');
            // The 0388 ledger is the authority on the other channels' dispatch state.
            writeFileSync(
                join(dir, '4-publish', 'dispatch-ledger.json'),
                // The EXACT shape `planDispatch`/`writeDispatchLedger` produce: an entry carries
                // `id` (`plugin[@operation]`) plus `plugin`, never a `target` field — a fixture that
                // invents `target` passes while the real seam reads nothing (0396 review).
                JSON.stringify({
                    schemaVersion: 1,
                    entries: [
                        {
                            id: 'podcast-pub',
                            plugin: 'podcast-pub',
                            window: 'cn-peak',
                            tier: 0,
                            mode: 'live',
                            state: 'pending',
                            attempts: 0,
                        },
                        {
                            id: 'wechatmp-pub',
                            plugin: 'wechatmp-pub',
                            window: 'cn-peak',
                            tier: 2,
                            mode: 'draft',
                            state: 'blocked',
                            attempts: 0,
                            blockedBy: ['surfdash-pub@article'],
                            manualStep: 'qr-scan',
                        },
                        {
                            id: 'x-pub',
                            plugin: 'x-pub',
                            window: 'cn-peak',
                            tier: 2,
                            mode: 'live',
                            state: 'retry',
                            attempts: 1,
                            lastError: 'HTTP 502',
                        },
                    ],
                }),
            );
            const published = run(['daily-publish-podcast', dir, stamp, ''], fakeKk(dir, 'process.exit(0)'));
            expect(published.status).toBe(0);
            const prep = JSON.parse(
                readFileSync(join(dir, '31-publish', `${stamp}_13_publish-prep_content.json`), 'utf-8'),
            ) as {
                options?: { correctionTargets?: Array<Record<string, unknown>> };
            };
            const rows = prep.options?.correctionTargets ?? [];
            // The podcast row is the stage's own dispatch; the others ride along with their exact
            // state so a manual/blocked/retry reason can be recorded per target.
            expect(rows.map((row) => row.target)).toEqual(['wechatmp-pub', 'x-pub']);
            expect(rows[0]).toMatchObject({
                state: 'blocked',
                blockedBy: ['surfdash-pub@article'],
                manualStep: 'qr-scan',
            });
            expect(rows[1]).toMatchObject({ state: 'retry', lastError: 'HTTP 502' });
            // No capability is asserted for an unknown surface: it must be classified `unsupported`.
            expect(rows.some((row) => row.supportsCorrections === true)).toBe(false);
        });
    });

    it('daily-publish-podcast copies the Surfing refined title and omits it when the result has none', () => {
        withTempDir((dir) => {
            const stamp = '20260101';
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const post = join(dir, 'index.md');
            writeFileSync(post, '---\ntitle: 文章\ndescription: "今天的描述"\nrefined: true\n---\n正文\n');
            const prepPath = join(dir, '31-publish', `${stamp}_13_publish-prep_content.json`);
            writeFileSync(
                prepPath,
                JSON.stringify({
                    title: '每日AI乱炖 · 2026-01-01',
                    body: 'notes',
                    format: 'markdown',
                    metadata: { audioFile: '/tmp/a.mp3', podcast: { keep: true } },
                }),
            );
            writeFileSync(join(dir, '31-publish', `${stamp}_15_show-notes_show-notes.md`), '# notes\n');
            writeFileSync(
                join(dir, '31-publish', `${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({
                    targets: [
                        { target: 'other', ok: true, metadata: { refinedTitle: '忽略' } },
                        { target: 'surfdash-pub', ok: false, metadata: { refinedTitle: '失败' } },
                        {
                            target: 'surfdash-pub',
                            ok: true,
                            metadata: { postPath: post, refinedTitle: '  每日AI乱炖 · 2026-01-01：甲、乙  ' },
                        },
                    ],
                }),
            );
            writeFileSync(
                join(dir, '21-plan', `${stamp}_03_plan_plan.json`),
                JSON.stringify([{ title: '不应使用的全文计划' }]),
            );
            writeFileSync(
                join(dir, '21-plan', `${stamp}_03_plan_plan-shownotes.json`),
                JSON.stringify([
                    { title: '甲，细节', body: '正文一句。', metadata: { brief: '简报优先。' } },
                    { title: '  ' },
                    null,
                    { title: '乙', body: '只有正文。第二句。' },
                ]),
            );
            const published = run(['daily-publish-podcast', dir, stamp, ''], fakeKk(dir, 'process.exit(0)'));
            expect(published.status).toBe(0);
            const prep = JSON.parse(readFileSync(prepPath, 'utf-8')) as {
                metadata: { showNotes: string; podcast: Record<string, unknown> };
            };
            expect(prep.metadata.showNotes).toContain('# notes');
            expect(prep.metadata.podcast.keep).toBe(true);
            expect(prep.metadata.podcast.refinedTitle).toBe('每日AI乱炖 · 2026-01-01：甲、乙');
            expect(prep.metadata.podcast.refinedDescription).toBe('今天的描述');
            expect(prep.metadata.podcast.planItems).toEqual([
                { title: '甲，细节', brief: '简报优先。' },
                { title: '乙', brief: '只有正文。' },
            ]);
        });
        withTempDir((dir) => {
            const stamp = '20260102';
            mkdirSync(join(dir, '31-publish'), { recursive: true });
            const post = join(dir, 'empty.md');
            writeFileSync(post, '---\ndescription: ""\n---\n');
            const prepPath = join(dir, '31-publish', `${stamp}_13_publish-prep_content.json`);
            writeFileSync(prepPath, JSON.stringify({ title: 'T', body: 'b', format: 'markdown', metadata: {} }));
            writeFileSync(join(dir, '31-publish', `${stamp}_15_show-notes_show-notes.md`), 'notes');
            writeFileSync(
                join(dir, '31-publish', `${stamp}_14_publish-surfdash_result.json`),
                JSON.stringify({
                    targets: [{ target: 'surfdash-pub', ok: true, metadata: { postPath: post, refinedTitle: '   ' } }],
                }),
            );
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            writeFileSync(join(dir, '21-plan', `${stamp}_03_plan_plan.json`), '{}');
            const omitted = run(['daily-publish-podcast', dir, stamp, ''], fakeKk(dir, 'process.exit(0)'));
            expect(omitted.status).toBe(0);
            const prep = JSON.parse(readFileSync(prepPath, 'utf-8')) as { metadata: Record<string, unknown> };
            expect(prep.metadata.podcast).toBeUndefined();
            expect(prep.metadata.showNotes).toBe('notes');
        });
    });
});

describe('task 0250 — daily-plan deferPlanDocs contract (voice2 dogfood R1/AC1)', () => {
    const stamp = '20261010';

    /** A `kk` stub: `executor run episode-plan-gen` writes a Content envelope with one doc. */
    function fakePlanKk(dir: string): Record<string, string> {
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
                "fs.writeFileSync(out, JSON.stringify({ metadata: { docs: [{ id: 'p1', title: '浏览器端零依赖语音实现' }] } }));",
            ].join('\n'),
        );
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    it('a 5th arg of true writes only the content file; a rerun logs plan cached; four args write plan.json', () => {
        withTempDir((dir) => {
            // voice2's extract node artifact — dailyPlan prefers 10-collect/pool.json (0212).
            mkdirSync(join(dir, '10-collect'), { recursive: true });
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            writeFileSync(join(dir, '10-collect', 'pool.json'), '[]');
            const planContent = join(dir, `21-plan/${stamp}_03_plan_content.json`);
            const planJson = join(dir, `21-plan/${stamp}_03_plan_plan.json`);
            const env = fakePlanKk(dir);

            // voice2 passes plan_translate_enabled as the 5th arg: plan-translate owns plan.json.
            const deferred = run(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(deferred.status).toBe(0);
            expect(existsSync(planContent)).toBe(true);
            expect(existsSync(planJson)).toBe(false);

            const rerun = run(['daily-plan', dir, stamp, '', '8', 'true'], env);
            expect(rerun.status).toBe(0);
            expect(rerun.stdout).toContain('plan cached:');
            expect(existsSync(planJson)).toBe(false);

            // voice1's four-argument call still materializes plan.json from the content docs.
            const fourArg = run(['daily-plan', dir, stamp, '', '8'], env);
            expect(fourArg.status).toBe(0);
            const plan = JSON.parse(readFileSync(planJson, 'utf-8')) as unknown;
            expect(Array.isArray(plan)).toBe(true);
            expect((plan as unknown[]).length).toBeGreaterThan(0);
        });
    });
});

describe('task 0250 — daily-show-notes script-plan exclusions (voice2 dogfood R4/AC4)', () => {
    const stamp = '20261010';

    /** A `kk` stub that records its argv and writes the `--out` artifact. */
    function fakeArgvKk(dir: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(
            path,
            [
                '#!/usr/bin/env bun',
                "const fs = require('node:fs');",
                'const args = process.argv.slice(2);',
                'fs.writeFileSync(process.env.SHOW_NOTES_ARGV, JSON.stringify(args));',
                "fs.writeFileSync(args[args.indexOf('--out') + 1], '# show notes');",
            ].join('\n'),
        );
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}`, SHOW_NOTES_ARGV: join(dir, 'argv.json') };
    }

    function argvIn(dir: string): string {
        const args = JSON.parse(readFileSync(join(dir, 'argv.json'), 'utf-8')) as string[];
        return args[args.indexOf('--in') + 1] ?? '';
    }

    /** A plan of two docs and an article body with no 未写入 note; the caller adds the script plan. */
    function setup(dir: string): { plan: string; shownotes: string } {
        for (const sub of ['21-plan', '22-article', '31-publish']) mkdirSync(join(dir, sub), { recursive: true });
        const plan = join(dir, `21-plan/${stamp}_03_plan_plan.json`);
        writeFileSync(
            plan,
            JSON.stringify([
                { id: 'keep-1', title: '浏览器端零依赖语音实现' },
                { id: 'drop-1', title: '本地向量数据库基准测试方法' },
            ]),
        );
        writeFileSync(
            join(dir, `22-article/${stamp}_06_article_content.json`),
            JSON.stringify({ title: 'T', body: '两条技术新闻。' }),
        );
        return { plan, shownotes: plan.replace(/\.json$/, '-shownotes.json') };
    }

    it('an id in the script plan excluded list leaves the plan podcast-pub sees, via the -shownotes sibling', () => {
        withTempDir((dir) => {
            const { shownotes } = setup(dir);
            mkdirSync(join(dir, '24-script'), { recursive: true });
            writeFileSync(
                join(dir, `24-script/${stamp}_08_script-write_plan.json`),
                JSON.stringify({ items: [{ id: 'keep-1' }], excluded: [{ id: 'drop-1', reason: 'topic boundary' }] }),
            );
            expect(run(['daily-show-notes', dir, stamp, '', 'T'], fakeArgvKk(dir)).status).toBe(0);
            const filtered = JSON.parse(readFileSync(shownotes, 'utf-8')) as { id: string }[];
            expect(filtered.map((doc) => doc.id)).toEqual(['keep-1']);
            expect(argvIn(dir)).toBe(shownotes);
        });
    });

    it('a missing script-plan file keeps both docs on the original plan path', () => {
        withTempDir((dir) => {
            const { plan, shownotes } = setup(dir);
            expect(run(['daily-show-notes', dir, stamp, '', 'T'], fakeArgvKk(dir)).status).toBe(0);
            expect(argvIn(dir)).toBe(plan);
            expect(existsSync(shownotes)).toBe(false);
            const docs = JSON.parse(readFileSync(plan, 'utf-8')) as { id: string }[];
            expect(docs.map((doc) => doc.id)).toEqual(['keep-1', 'drop-1']);
        });
    });
});

describe('F614 (0163) — daily-cover stage', () => {
    function fakeImageGen(dir: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(
            path,
            [
                '#!/usr/bin/env bun',
                "const fs = require('node:fs');",
                'const args = process.argv.slice(2);',
                "if (process.env.KK_TEST_CALL_LOG) fs.appendFileSync(process.env.KK_TEST_CALL_LOG, JSON.stringify(args) + '\\n');",
                "if (process.env.KK_TEST_ENV_LOG) fs.appendFileSync(process.env.KK_TEST_ENV_LOG, JSON.stringify(JSON.parse(fs.readFileSync(args[args.indexOf('--in') + 1], 'utf8'))) + '\\n');",
                "fs.writeFileSync(args[args.indexOf('--out') + 1], JSON.stringify({ metadata: { images: [{ path: 'unused.png' }] } }));",
                '',
            ].join('\n'),
        );
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    function imageGens(envLog: string): Array<Record<string, unknown>> {
        return envLog
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as Array<{ metadata?: { imageGen?: Record<string, unknown> } }>)
            .map((docs) => docs[0]?.metadata?.imageGen ?? {});
    }

    const briefSubject = 'a robot reading the morning news at a breakfast table';

    function runDailyCover(
        dir: string,
        env: Record<string, string>,
        provider = 'minimax',
        model = 'image-01',
        fallback = '',
    ): {
        status: number;
        stdout: string;
        stderr: string;
    } {
        return run(['daily-cover', dir, '20260101', 'plugins', provider, model, fallback], env);
    }

    it('daily-cover writes the brief subject into the pinned image-gen envelope and invokes the plugin', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            writeFileSync(join(cover, '20260101_07_cover-brief.json'), JSON.stringify({ subject: briefSubject }));
            const env = fakeImageGen(dir);
            const envLog = join(dir, 'envs.log');
            const callLog = join(dir, 'calls.log');
            const result = runDailyCover(dir, { ...env, KK_TEST_ENV_LOG: envLog, KK_TEST_CALL_LOG: callLog });

            expect(result.status).toBe(0);
            // The plugin call is the frozen executor invocation; non-empty plugins path forwards.
            const calls = readFileSync(callLog, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            expect(calls).toEqual([
                [
                    'executor',
                    'run',
                    'image-gen',
                    '--in',
                    join(cover, '20260101_07_cover_image-gen-in.json'),
                    '--out',
                    join(cover, 'content.json'),
                    '--plugins-path',
                    'plugins',
                ],
            ]);

            const [imageGen] = imageGens(readFileSync(envLog, 'utf-8'));
            expect(imageGen).toEqual({
                job: 'cover',
                format: 'daily-news-podcast-cover',
                style: 'quasi-news-podcast',
                vars: { subject: briefSubject },
                maxImages: 1,
                provider: 'minimax',
                model: 'image-01',
            });
        });
    });

    it('daily-cover maps the 6th fallback arg onto the envelope: absent / true / comma list (D6 0166 R7)', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            writeFileSync(join(cover, '20260101_07_cover-brief.json'), JSON.stringify({ subject: briefSubject }));
            const env = fakeImageGen(dir);
            const envLog = join(dir, 'envs.log');
            const options = { ...env, KK_TEST_ENV_LOG: envLog };

            // '' (the shipped var default) keeps strict: no fallback field, F614's pinned look.
            expect(runDailyCover(dir, options, 'minimax', 'image-01', '').status).toBe(0);
            // 'true' opts into the AUTO_ORDER retry.
            expect(runDailyCover(dir, options, 'minimax', 'image-01', 'true').status).toBe(0);
            // Anything else is a comma-split, trimmed candidate list.
            expect(runDailyCover(dir, options, 'minimax', 'image-01', 'google, zai').status).toBe(0);

            const envelopes = imageGens(readFileSync(envLog, 'utf-8'));
            expect(envelopes[0]?.fallback).toBeUndefined();
            expect(envelopes[1]?.fallback).toBe(true);
            expect(envelopes[2]?.fallback).toEqual(['google', 'zai']);
        });
    });

    it('daily-cover omits empty provider/model keys and forwards a non-empty plugins path', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            writeFileSync(join(cover, '20260101_07_cover-brief.json'), JSON.stringify({ subject: briefSubject }));
            const env = fakeImageGen(dir);
            const envLog = join(dir, 'envs.log');
            const callLog = join(dir, 'calls.log');
            const options = { ...env, KK_TEST_ENV_LOG: envLog, KK_TEST_CALL_LOG: callLog };

            // Empty provider/model/plugins path: keys omitted, no --plugins-path flag.
            expect(run(['daily-cover', dir, '20260101', '', '', ''], options).status).toBe(0);
            let calls = readFileSync(callLog, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            expect(calls[0]).toEqual([
                'executor',
                'run',
                'image-gen',
                '--in',
                join(cover, '20260101_07_cover_image-gen-in.json'),
                '--out',
                join(cover, 'content.json'),
            ]);
            let imageGensOut = imageGens(readFileSync(envLog, 'utf-8'));
            expect(imageGensOut[0]).toEqual({
                job: 'cover',
                format: 'daily-news-podcast-cover',
                style: 'quasi-news-podcast',
                vars: { subject: briefSubject },
                maxImages: 1,
            });

            // A non-empty plugins path forwards as the trailing --plugins-path flag.
            expect(run(['daily-cover', dir, '20260101', 'plugins', '', ''], options).status).toBe(0);
            calls = readFileSync(callLog, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            expect(calls[1]?.slice(-2)).toEqual(['--plugins-path', 'plugins']);
            imageGensOut = imageGens(readFileSync(envLog, 'utf-8'));
            expect(imageGensOut[1]).toEqual(imageGensOut[0]);
        });
    });

    it('daily-cover falls back to empty vars for each R4 brief failure and logs the reason', () => {
        const cases: Array<[string, string | null, string]> = [
            ['missing file', null, 'missing-brief'],
            ['unparsable json', 'not-json{', 'invalid-json'],
            ['non-object json', '[1, 2]', 'invalid-json'],
            ['no subject key', '{}', 'no-subject'],
            ['empty subject', JSON.stringify({ subject: '   ' }), 'subject-cap'],
            ['over-cap subject', JSON.stringify({ subject: 'x'.repeat(241) }), 'subject-cap'],
        ];
        for (const [name, briefText, reason] of cases) {
            withTempDir((dir) => {
                const cover = join(dir, '23-cover');
                mkdirSync(cover, { recursive: true });
                if (briefText !== null) writeFileSync(join(cover, '20260101_07_cover-brief.json'), briefText);
                const env = fakeImageGen(dir);
                const envLog = join(dir, 'envs.log');
                const result = runDailyCover(dir, { ...env, KK_TEST_ENV_LOG: envLog });

                expect(result.status, name).toBe(0);
                expect(result.stderr, name).toContain(`cover brief: fallback (${reason})`);
                const [imageGen] = imageGens(readFileSync(envLog, 'utf-8'));
                expect(imageGen, name).toEqual({
                    job: 'cover',
                    format: 'daily-news-podcast-cover',
                    style: 'quasi-news-podcast',
                    vars: {},
                    maxImages: 1,
                    provider: 'minimax',
                    model: 'image-01',
                });
            });
        }
    });

    it('daily-cover fails the stage when the image-gen plugin fails', () => {
        withTempDir((dir) => {
            const cover = join(dir, '23-cover');
            mkdirSync(cover, { recursive: true });
            writeFileSync(join(cover, '20260101_07_cover-brief.json'), JSON.stringify({ subject: briefSubject }));
            // A fake kk that exits non-zero: a plugin failure is a real failure (no fallback).
            const bin = join(dir, 'bin');
            mkdirSync(bin, { recursive: true });
            writeFileSync(join(bin, 'kk'), '#!/usr/bin/env bun\nprocess.exit(3);\n');
            chmodSync(join(bin, 'kk'), 0o755);
            const result = runDailyCover(dir, { PATH: `${bin}:${process.env.PATH ?? ''}` });
            expect(result.status).toBe(3);
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
            for (const sub of ['21-plan', '22-article']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            const planPath = join(dir, `21-plan/${stamp}_03_plan_plan.json`);
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
            for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            writeFileSync(join(dir, `21-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
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
            for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            writeFileSync(join(dir, `21-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
            const bodyPath = join(dir, 'body.yaml');
            writeFileSync(bodyPath, validScript());
            const result = run(['daily-script', dir, stamp, '', 'en', 'T', 'Robin'], fakeKkEchoingBody(dir, bodyPath));
            expect(result.status).toBe(0);
            expect(readFileSync(join(dir, `24-script/${stamp}_08_script_voicescript.yaml`), 'utf-8')).toBe(
                validScript(),
            );
        });
    });

    it('daily-wrap-docs rejects a HITL-edited duplicate segment, then proceeds once repaired', () => {
        withTempDir((dir) => {
            for (const sub of ['24-script', '30-audio']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260916';
            const scriptPath = join(dir, `24-script/${stamp}_08_script_voicescript.yaml`);
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
            expect(existsSync(join(dir, `30-audio/${stamp}_10_wrap-docs_docs.json`))).toBe(false);

            // Recovery is an operator edit + re-run: the repaired YAML packages normally, so generate
            // consumes it.
            writeFileSync(scriptPath, validScript('  - text: "Second segment."'));
            const repaired = run(['daily-wrap-docs', dir, stamp, 'Robin']);
            expect(repaired.status).toBe(0);
            const docs = JSON.parse(readFileSync(join(dir, `30-audio/${stamp}_10_wrap-docs_docs.json`), 'utf-8')) as {
                body: string;
            }[];
            expect(docs[0]?.body).toContain('Hello and welcome to the episode.');
            expect(docs[0]?.body).toContain('Second segment.');
        });
    });
});

describe('task 0250 — daily-script episode-budget fitting (voice2 dogfood R3/AC3)', () => {
    const stamp = '20261010';
    // The fitter's contract (daily-stages.ts fitVoicescriptToBudget): budget =
    // floor((maxMinutes*60 - 8 - 120) * 5.6) spoken chars for the voicebox driver.
    const maxMinutes = '25';
    const budget = Math.floor((25 * 60 - 8 - 120) * 5.6); // 7683
    const validateSidecar = join(import.meta.dir, '../../../plugins/kk/scripts/validate-voicescript.ts');

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

    const spokenChars = (yaml: string): number =>
        (Bun.YAML.parse(yaml) as { segments: { text?: unknown }[] }).segments.reduce(
            (sum, seg) => sum + [...String(seg.text ?? '')].length,
            0,
        );

    function setup(dir: string, body: string): { yamlOut: string; env: Record<string, string> } {
        for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
        writeFileSync(join(dir, `21-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
        const bodyPath = join(dir, 'body.yaml');
        writeFileSync(bodyPath, body);
        return {
            yamlOut: join(dir, `24-script/${stamp}_08_script_voicescript.yaml`),
            env: fakeKkEchoingBody(dir, bodyPath),
        };
    }

    const runScript = (dir: string, env: Record<string, string>, vdriver = 'voicebox') =>
        run(['daily-script', dir, stamp, '', 'zh', 'T', 'Robin', maxMinutes, vdriver], env);

    it('fits a voxcpm script to its measured rate, not the borrowed voicebox 5.6 (2026-10-15)', () => {
        withTempDir((dir) => {
            // voxcpm measured 6,772 spoken chars / 1,297.7 s (5.19 字/秒) on the 20261015 episode. At
            // the borrowed 5.6 the budget was 7,683 chars ≈ 24.6 min of audio — inside the 25-min gate
            // by 18 s. The 5.2 rate budgets 7,134 chars ≈ 22.9 min.
            const voxcpmBudget = Math.floor((25 * 60 - 8 - 120) * 5.2); // 7134
            const sentence = '这是一句关于本地模型推理优化的技术播报。';
            const body = [
                'title: "T"',
                'language: zh',
                'segments:',
                '  - text: "开场白。"',
                `  - text: ${JSON.stringify(sentence.repeat(420))}`,
                '  - text: "结束语。"',
                '',
            ].join('\n');
            const { yamlOut, env } = setup(dir, body);
            const result = runScript(dir, env, 'voxcpm');
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('script: fitted voicescript');
            const chars = spokenChars(readFileSync(yamlOut, 'utf-8'));
            expect(chars).toBeLessThanOrEqual(voxcpmBudget);
            expect(chars).toBeGreaterThan(voxcpmBudget - 40);
        });
    });

    it('an over-budget script is rewritten as block YAML at or under the budget and passes the checker', () => {
        withTempDir((dir) => {
            // 420 sentences x 20 chars = 8400 spoken chars > the 7683 budget; every sentence ends
            // at 。 so the fitter can cut the single fact segment to size in one pass.
            const sentence = '这是一句关于本地模型推理优化的技术播报。';
            const body = [
                'title: "T"',
                'language: zh',
                'segments:',
                '  - text: "开场白。"',
                `  - text: ${JSON.stringify(sentence.repeat(420))}`,
                '  - text: "结束语。"',
                '',
            ].join('\n');
            const { yamlOut, env } = setup(dir, body);
            const result = runScript(dir, env);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('script: fitted voicescript');
            const yaml = readFileSync(yamlOut, 'utf-8');
            // Run 08a98453 failed here: Bun.YAML.stringify emitted a `{...}` flow document and the
            // checker JSON-parses any trimmed file that starts with `{`. Block YAML must not.
            expect(yaml.trimStart().startsWith('{')).toBe(false);
            const check = spawnSync('bun', [validateSidecar, '--in', yamlOut], { encoding: 'utf-8' });
            expect(check.status).toBe(0);
            expect(spokenChars(yaml)).toBeLessThanOrEqual(budget);
        });
    });

    it('an under-budget script keeps its exact yaml bytes', () => {
        withTempDir((dir) => {
            const body = [
                'language: zh',
                'segments:',
                '  - text: "开场白。"',
                '  - text: "一条简短的欠预算技术播报。"',
                '  - text: "结束语。"',
                '',
            ].join('\n');
            const { yamlOut, env } = setup(dir, body);
            const result = runScript(dir, env);
            expect(result.status).toBe(0);
            expect(result.stdout).not.toContain('script: fitted voicescript');
            expect(readFileSync(yamlOut, 'utf-8')).toBe(body);
        });
    });
});

describe('F613 (0162) — script-write stage wiring', () => {
    // ADR-045: the style contract ships inside the kk:news-editorial skill.
    const SKILL_DIR = join(import.meta.dir, '../../../plugins/kk/skills/news-editorial');
    const STYLE_CONTRACT = join(SKILL_DIR, 'references/style-contract.zh.md');

    /** Writes a `kk` stub that logs the selected plugin env vars as one JSON line, then echoes a body. */
    function fakeKkLoggingEnv(dir: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(
            path,
            [
                '#!/usr/bin/env bun',
                "const fs = require('node:fs');",
                "const out = process.argv[process.argv.indexOf('--out') + 1];",
                "fs.appendFileSync(process.env.KK_TEST_ENV_LOG, JSON.stringify(process.env) + '\\n');",
                "fs.writeFileSync(out, JSON.stringify({ title: 'T', body: 'language: en\\nsegments:\\n  - text: \"Hello and welcome to the episode.\"\\n' }));",
                '',
            ].join('\n'),
        );
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    function lastEnv(envLog: string): Record<string, string> {
        const lines = readFileSync(envLog, 'utf-8').trim().split('\n');
        return JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, string>;
    }

    it('daily-script-style snapshots the news-editorial skill and its style contract, idempotently (R1, 0345 R3)', () => {
        withTempDir((dir) => {
            const stamp = '20260925';
            const snapshot = join(dir, `24-script/${stamp}_08_script-write_style.md`);
            const skillSnapshot = join(dir, '20-editorial/news-editorial');
            expect(run(['daily-script-style', dir, stamp]).status).toBe(0);
            expect(existsSync(snapshot)).toBe(true);
            expect(readFileSync(snapshot, 'utf-8')).toBe(readFileSync(STYLE_CONTRACT, 'utf-8'));
            // The writer reads the skill by path (kk skills are not installed for every executor),
            // so SKILL.md and its references travel with the run.
            expect(readFileSync(join(skillSnapshot, 'SKILL.md'), 'utf-8')).toBe(
                readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8'),
            );
            expect(readFileSync(join(skillSnapshot, 'references/style-contract.zh.md'), 'utf-8')).toBe(
                readFileSync(STYLE_CONTRACT, 'utf-8'),
            );
            // Idempotent: the second run keeps whatever is on disk (an operator-edited snapshot
            // is the audit record for the plan already written against it).
            writeFileSync(snapshot, 'operator-edited');
            const again = run(['daily-script-style', dir, stamp]);
            expect(again.status).toBe(0);
            expect(again.stdout).toContain('cached');
            expect(readFileSync(snapshot, 'utf-8')).toBe('operator-edited');
        });
    });

    it('daily-script-style fails loud naming the skill when the package ships no news-editorial skill (R1)', () => {
        withTempDir((dir) => {
            // Runner + sibling with no ../skills beside them: the lazy daily-stage load succeeds,
            // then the skill lookup misses and the stage names the skill and the remediation.
            const loneRunner = join(dir, 'kk-workflow-stages.ts');
            copyFileSync(runner, loneRunner);
            copyFileSync(dailyStages, join(dir, 'daily-stages.ts'));
            copyFileSync(coverCompositor, join(dir, 'cover-compositor.ts'));
            copyFileSync(seriesNames, join(dir, 'series-names.ts'));
            copyFileSync(sentences, join(dir, 'sentences.ts'));
            // 0392: daily-stages now imports the attempt ledger, so the lone-runner fixture
            // needs that sibling too — its absence would surface as the wrong "daily-stages.ts
            // not found" remediation instead of the skill-missing message under test.
            copyFileSync(topicSelectionAttempts, join(dir, 'topic-selection-attempts.ts'));
            copyFileSync(newsEditorialLedger, join(dir, 'news-editorial-ledger.ts'));
            copyFileSync(sourceCitation, join(dir, 'source-citation.ts'));
            copyFileSync(episodeIdentity, join(dir, 'episode-identity.ts'));
            const result = run(
                ['daily-script-style', dir, '20260925'],
                { HOME: dir, KK_WORKFLOWS_DIR: '' },
                loneRunner,
            );
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('news-editorial skill not found');
            expect(result.stderr).toContain('install or refresh the kk package');
        });
    });

    it('daily-script always passes the absolute plan and style paths (R4)', () => {
        withTempDir((dir) => {
            for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260925';
            writeFileSync(join(dir, `21-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
            const envLog = join(dir, 'env.jsonl');
            const result = run(['daily-script', dir, stamp, '', 'zh', 'T', 'Robin'], {
                KK_TEST_ENV_LOG: envLog,
                ...fakeKkLoggingEnv(dir),
            });
            expect(result.status).toBe(0);
            const env = lastEnv(envLog);
            expect(env.DAILYNEWS_SCRIPT_PLAN).toBe(resolve(dir, '24-script', `${stamp}_08_script-write_plan.json`));
            expect(env.DAILYNEWS_STYLE_FILE).toBe(resolve(STYLE_CONTRACT));
            // Task 0189: the broadcast greeting carries the run date (backfill/retry must not say today).
            expect(env.DAILYNEWS_DATE).toBe(stamp);
        });
    });

    describe('daily-script-check (0345 R4: validator errors drive script-write-fix)', () => {
        const stamp = '20260925';

        /** A `kk` stub standing in for dailynews-gen: stamps KK_TEST_SCRIPT_META into Content.metadata. */
        function fakeBuilder(dir: string): Record<string, string> {
            const bin = join(dir, 'bin');
            mkdirSync(bin, { recursive: true });
            const path = join(bin, 'kk');
            writeFileSync(
                path,
                [
                    '#!/usr/bin/env bun',
                    "const fs = require('node:fs');",
                    "const out = process.argv[process.argv.indexOf('--out') + 1];",
                    "fs.writeFileSync(out, JSON.stringify({ title: 'T', body: 'b', metadata: JSON.parse(process.env.KK_TEST_SCRIPT_META) }));",
                    '',
                ].join('\n'),
            );
            chmodSync(path, 0o755);
            return { PATH: `${bin}:${process.env.PATH ?? ''}` };
        }

        function setup(dir: string, withPlan: boolean): { errorsOut: string } {
            for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
            writeFileSync(join(dir, `21-plan/${stamp}_03_plan_plan.json`), JSON.stringify([{ id: 'a', body: 'b' }]));
            if (withPlan) writeFileSync(join(dir, `24-script/${stamp}_08_script-write_plan.json`), '{}');
            return { errorsOut: join(dir, `24-script/${stamp}_08_script-write_errors.json`) };
        }

        it('writes missing-plan when the writer produced no plan, without invoking the builder', () => {
            withTempDir((dir) => {
                const { errorsOut } = setup(dir, false);
                const result = run(['daily-script-check', dir, stamp, ''], {
                    ...fakeBuilder(dir),
                    KK_TEST_SCRIPT_META: 'not json: builder must not run',
                });
                expect(result.status).toBe(0);
                expect(JSON.parse(readFileSync(errorsOut, 'utf-8'))).toEqual([
                    { itemId: 'episode', rule: 'missing-plan' },
                ]);
            });
        });

        it('writes the builder rejection errors and leaves no script artifacts that would poison `script`', () => {
            withTempDir((dir) => {
                const { errorsOut } = setup(dir, true);
                const errors = [
                    { itemId: 'a', rule: 'cap:insight' },
                    { itemId: 'episode', rule: 'banned:首先' },
                ];
                const result = run(['daily-script-check', dir, stamp, ''], {
                    ...fakeBuilder(dir),
                    KK_TEST_SCRIPT_META: JSON.stringify({ scriptSource: 'template', scriptPlanErrors: errors }),
                });
                expect(result.status).toBe(0);
                expect(JSON.parse(readFileSync(errorsOut, 'utf-8'))).toEqual(errors);
                expect(existsSync(join(dir, `24-script/${stamp}_08_script_voicescript.yaml`))).toBe(false);
                expect(existsSync(join(dir, `24-script/${stamp}_08_script_content.json`))).toBe(false);
            });
        });

        it('clears a stale errors file when the builder accepts the plan', () => {
            withTempDir((dir) => {
                const { errorsOut } = setup(dir, true);
                writeFileSync(errorsOut, '[{"itemId":"episode","rule":"schema"}]');
                const result = run(['daily-script-check', dir, stamp, ''], {
                    ...fakeBuilder(dir),
                    KK_TEST_SCRIPT_META: JSON.stringify({ scriptSource: 'plan', scriptPlanErrors: [] }),
                });
                expect(result.status).toBe(0);
                expect(existsSync(errorsOut)).toBe(false);
                expect(result.stdout).toContain('accepted');
            });
        });

        it('fails loud when the builder output carries no scriptSource stamp', () => {
            withTempDir((dir) => {
                setup(dir, true);
                const result = run(['daily-script-check', dir, stamp, ''], {
                    ...fakeBuilder(dir),
                    KK_TEST_SCRIPT_META: '{}',
                });
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('scriptSource');
            });
        });
    });

    describe('daily-curate-check (0345 R8 / AC5: curate split validation, unwrap, dedup, final fallback)', () => {
        const stamp = '20261108';

        function setupCandidates(dir: string, docs: Record<string, unknown>[]) {
            mkdirSync(join(dir, '21-plan'), { recursive: true });
            const candidatesPath = join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`);
            writeFileSync(candidatesPath, JSON.stringify({ metadata: { docs } }));
            return {
                candidatesPath,
                planPath: join(dir, `21-plan/${stamp}_03_plan_plan.json`),
                excludedPath: join(dir, `21-plan/${stamp}_03_curate_excluded.json`),
                errorsPath: join(dir, `21-plan/${stamp}_03_curate_errors.json`),
            };
        }

        it('(a) valid split writes no errors file and removes a stale one', () => {
            withTempDir((dir) => {
                const { planPath, excludedPath, errorsPath } = setupCandidates(dir, [
                    { id: 'a', title: 'Item A', body: 'Body A' },
                    { id: 'b', title: 'Item B', body: 'Body B' },
                ]);
                writeFileSync(planPath, JSON.stringify([{ id: 'a', title: '条目A', body: '正文A' }]));
                writeFileSync(excludedPath, JSON.stringify([{ id: 'b', reason: '低价值公关通稿' }]));
                writeFileSync(errorsPath, JSON.stringify([{ itemId: 'episode', rule: 'missing-plan' }]));

                const res = run(['daily-curate-check', dir, stamp]);
                expect(res.status).toBe(0);
                expect(existsSync(errorsPath)).toBe(false);
            });
        });

        it('(b) id in both files reports conflict-id; (c) candidate id in neither reports missing-item; (d) unknown id reports unknown-id', () => {
            withTempDir((dir) => {
                const { planPath, excludedPath, errorsPath } = setupCandidates(dir, [
                    { id: 'a', title: 'Item A', body: 'Body A' },
                    { id: 'b', title: 'Item B', body: 'Body B' },
                    { id: 'c', title: 'Item C', body: 'Body C' },
                ]);
                // 'a' in both (conflict-id), 'b' in neither (missing-item), 'x' in plan and 'y' in excluded (unknown-id)
                writeFileSync(
                    planPath,
                    JSON.stringify([
                        { id: 'a', title: '条目A', body: '正文A' },
                        { id: 'c', title: '条目C', body: '正文C' },
                        { id: 'x', title: '未知X', body: '正文X' },
                    ]),
                );
                writeFileSync(
                    excludedPath,
                    JSON.stringify([
                        { id: 'a', reason: '重复列入' },
                        { id: 'y', reason: '未知Y' },
                    ]),
                );

                const res = run(['daily-curate-check', dir, stamp]);
                expect(res.status).toBe(0);
                expect(JSON.parse(readFileSync(errorsPath, 'utf-8'))).toEqual(
                    expect.arrayContaining([
                        { itemId: 'x', rule: 'unknown-id' },
                        { itemId: 'y', rule: 'unknown-id' },
                        { itemId: 'a', rule: 'conflict-id' },
                        { itemId: 'b', rule: 'missing-item' },
                    ]),
                );
            });
        });

        it('(e) Content envelope in _03_plan_plan.json is unwrapped to Doc[] and accepted', () => {
            withTempDir((dir) => {
                const { planPath, excludedPath, errorsPath } = setupCandidates(dir, [
                    { id: 'a', title: 'Item A', body: 'Body A' },
                ]);
                const docs = [{ id: 'a', title: '条目A', body: '已翻译正文A' }];
                writeFileSync(
                    planPath,
                    JSON.stringify({ title: 'plan', body: '# plan', format: 'markdown', metadata: { docs } }),
                );
                writeFileSync(excludedPath, JSON.stringify([]));

                const res = run(['daily-curate-check', dir, stamp]);
                expect(res.status).toBe(0);
                expect(existsSync(errorsPath)).toBe(false);
                expect(JSON.parse(readFileSync(planPath, 'utf-8'))).toEqual(docs);
            });
        });

        it('(f) near-duplicate titles in _03_plan_plan.json are deduped via dedupPlanByTitle and stay valid on --final', () => {
            withTempDir((dir) => {
                const { planPath, excludedPath, errorsPath } = setupCandidates(dir, [
                    { id: 'a', title: 'OpenAI 发布 GPT-5 推理架构', body: 'Body A' },
                    {
                        id: 'b1',
                        title: 'Google 发布 Gemini 3.8 Live 实时语音模型支持超低延迟多模态交互',
                        body: 'Body B1',
                    },
                    {
                        id: 'b2',
                        title: 'Google 推出 Gemini 3.8 Live 实时语音模型支持超低延迟多模态对话',
                        body: 'Body B2',
                    },
                ]);
                writeFileSync(
                    planPath,
                    JSON.stringify([
                        { id: 'a', title: 'OpenAI 发布 GPT-5 推理架构', body: 'Body A' },
                        {
                            id: 'b1',
                            title: 'Google 发布 Gemini 3.8 Live 实时语音模型支持超低延迟多模态交互',
                            body: 'Body B1',
                        },
                        {
                            id: 'b2',
                            title: 'Google 推出 Gemini 3.8 Live 实时语音模型支持超低延迟多模态对话',
                            body: 'Body B2',
                        },
                    ]),
                );
                writeFileSync(excludedPath, JSON.stringify([]));

                const res = run(['daily-curate-check', dir, stamp]);
                expect(res.status).toBe(0);
                expect(existsSync(errorsPath)).toBe(false);
                expect((JSON.parse(readFileSync(planPath, 'utf-8')) as { id: string }[]).map((d) => d.id)).toEqual([
                    'a',
                    'b1',
                ]);

                // Running --final after dedup still succeeds because b2 was recorded in excluded.json
                const finalRes = run(['daily-curate-check', dir, stamp, '--final']);
                expect(finalRes.status).toBe(0);
                expect(existsSync(errorsPath)).toBe(false);
                expect((JSON.parse(readFileSync(planPath, 'utf-8')) as { id: string }[]).map((d) => d.id)).toEqual([
                    'a',
                    'b1',
                ]);
            });
        });

        it('(g) --final with an invalid plan falls back to untranslated candidates with [] exclusions and exits 0', () => {
            withTempDir((dir) => {
                const rawCandidates = [
                    { id: 'a', title: 'Untranslated A', body: 'Raw body A' },
                    { id: 'b', title: 'Untranslated B', body: 'Raw body B' },
                ];
                const { planPath, excludedPath, errorsPath } = setupCandidates(dir, rawCandidates);
                // First check on missing plan writes missing-plan error
                const first = run(['daily-curate-check', dir, stamp]);
                expect(first.status).toBe(0);
                expect(JSON.parse(readFileSync(errorsPath, 'utf-8'))).toEqual([
                    { itemId: 'episode', rule: 'missing-plan' },
                ]);

                // --final with still-invalid plan falls back to untranslated candidates and [] exclusions, removing errors
                writeFileSync(planPath, '{not valid json');
                const finalRes = run(['daily-curate-check', dir, stamp, '--final']);
                expect(finalRes.status).toBe(0);
                expect(existsSync(errorsPath)).toBe(false);
                expect(JSON.parse(readFileSync(planPath, 'utf-8'))).toEqual(rawCandidates);
                expect(JSON.parse(readFileSync(excludedPath, 'utf-8'))).toEqual([]);
            });
        });
    });

    describe('daily-editorial-render (0345 R10 / AC7b: deterministic renders from master script plan)', () => {
        const stamp = '20261108';

        function seedMaster(dir: string, overrides: Record<string, unknown> = {}) {
            for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
            writeFileSync(
                join(dir, `21-plan/${stamp}_03_plan_plan.json`),
                JSON.stringify([
                    {
                        id: 'doc-1',
                        title: 'OpenAI 开源轻量推理引擎',
                        body: 'OpenAI 今日宣布开源轻量级推理引擎，单卡吞吐提升 2.4 倍。',
                        sourceUri: 'https://openai.com/news/engine',
                        metadata: { source: 'OpenAI' },
                    },
                    {
                        id: 'doc-2',
                        title: 'Anthropic 发布上下文缓存协议',
                        body: 'Anthropic 公布跨会话上下文缓存协议，长文档延迟降低 60%。',
                        sourceUri: 'https://anthropic.com/news/cache',
                        metadata: { source: 'Anthropic' },
                    },
                ]),
            );
            const master = {
                version: 1,
                intro: '今天我们看两条推理效率动态：OpenAI 开源轻量推理引擎，Anthropic 发布上下文缓存协议。',
                outro: '以上就是今天的全部内容，推理成本与延迟正在同步下探。',
                cover: 'A sleek crystalline processor core splitting a beam of light into two parallel fiber channels',
                cards: {
                    title: '推理加速双突破',
                    body: '今日聚焦推理吞吐与上下文缓存两项核心进展 #AI工程 #大模型推理 #开源技术',
                },
                social: {
                    short: '今日AI乱炖：OpenAI 开源轻量推理引擎（单卡吞吐×2.4），Anthropic 发布跨会话缓存（延迟-60%）。',
                    long: '今日两项推理基础设施进展：1. OpenAI 开源轻量级推理引擎，单卡吞吐提升 2.4 倍；2. Anthropic 发布跨会话上下文缓存协议，长文档延迟降低 60%。本地与云端推理成本同步下探。',
                },
                items: [
                    {
                        id: 'doc-1',
                        lead: '先看 OpenAI 在推理侧的新动作。',
                        insight:
                            '单卡吞吐翻倍意味着中小团队部署专有模型的硬件门槛进一步降低，接下来值得观察社区算子适配速度。',
                        card: {
                            copy: 'OpenAI开源推理引擎',
                            points: ['单卡吞吐提升2.4倍', '降低私有化部署硬件门槛'],
                            subject: 'A compact server blade glowing with cyan light channels on a dark workbench',
                        },
                    },
                    {
                        id: 'doc-2',
                        lead: '再看 Anthropic 针对长上下文的优化。',
                        insight: '跨会话缓存直接切中 Agent 多轮调用的延迟痛点，长文档工作流的边际成本将显著下降。',
                        card: {
                            copy: '跨会话缓存协议',
                            points: ['长文档延迟降低60%', '切中Agent多轮调用成本痛点'],
                            subject: 'Layered translucent memory plates connected by golden optical threads',
                        },
                    },
                ],
                ...overrides,
            };
            writeFileSync(join(dir, `24-script/${stamp}_08_script-write_plan.json`), JSON.stringify(master, null, 2));
        }

        it('produces all five artifacts byte-stable across two runs and xhs_plan.json matches dailyXhsRender contract', () => {
            withTempDir((dir) => {
                seedMaster(dir);
                const first = run(['daily-editorial-render', dir, stamp, 'true', '4']);
                expect(first.status).toBe(0);

                const paths = {
                    article: join(dir, `22-article/${stamp}_06_article-write_body.md`),
                    cover: join(dir, `23-cover/${stamp}_07_cover-brief.json`),
                    xhs: join(dir, `25-xhs/${stamp}_18_xhs_plan.json`),
                    x: join(dir, '26-social/x.md'),
                    threads: join(dir, '26-social/threads.md'),
                    weibo: join(dir, '26-social/weibo.md'),
                    linkedin: join(dir, '26-social/linkedin.md'),
                };
                const snap1 = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p, 'utf-8')]));

                // Check article content structure
                expect(snap1.article).toContain('这里是由Robin为你带来的咸话咸说之每日AI乱炖。');
                expect(snap1.article).toContain('## OpenAI 开源轻量推理引擎');
                expect(snap1.article).toContain('单卡吞吐提升 2.4 倍');
                // 0394 R16: the citation names the verified source host, not the collector label
                // (`metadata.source` was the ingest classification, so an aggregator permalink or a
                // publisher page both used to be labelled by transport).
                expect(snap1.article).toContain('[来源：openai.com](https://openai.com/news/engine)');
                expect(snap1.article).toContain('以上就是今天的全部内容');

                // Check cover brief (0347 R5: legacy string cover keeps subject, gains the
                // lead-anchored headline fallback pair)
                const cover = JSON.parse(snap1.cover as string) as {
                    subject: string;
                    headline: string;
                    leadStoryTitle: string;
                    episodeIdentity: {
                        version: number;
                        date: string;
                        issue: string;
                        headline: string | null;
                        title: string | null;
                        coverHeadline: string | null;
                        supportingSourceIds: string[];
                        status: string;
                    };
                };
                expect(cover).toMatchObject({
                    subject:
                        'A sleek crystalline processor core splitting a beam of light into two parallel fiber channels',
                    headline: 'OpenAI 开源轻量推理引擎',
                    leadStoryTitle: 'OpenAI 开源轻量推理引擎',
                });
                // 0385 R4: the cover reuses the ONE frozen point and carries the episode identity, so a
                // retry or a replay re-renders the same episode (`第<issue>期 · <point>`).
                // This fixture's cover is a legacy STRING, so there is no 当日要点 to freeze: the
                // identity records that honestly (`no-headline`, no headline/coverHeadline) and keeps
                // the pre-0385 title, so a historical replay still re-renders what it shipped.
                expect(cover.episodeIdentity).toMatchObject({
                    version: 1,
                    date: '20261108',
                    issue: '261108',
                    headline: null,
                    coverHeadline: null,
                    title: 'OpenAI 开源轻量推理引擎',
                    status: 'no-headline',
                });

                // Check xhs_plan.json shape (cover + 2 content + closing = 4 cards)
                const xhs = JSON.parse(snap1.xhs as string);
                expect(xhs.title).toBe('推理加速双突破');
                expect(xhs.cards).toHaveLength(4);
                expect(xhs.cards[0].role).toBe('cover');
                expect(xhs.cards[1]).toMatchObject({
                    role: 'content',
                    copy: 'OpenAI开源推理引擎',
                    itemId: 'doc-1',
                });
                expect(xhs.cards[2]).toMatchObject({
                    role: 'content',
                    copy: '跨会话缓存协议',
                    itemId: 'doc-2',
                });
                expect(xhs.cards[3].role).toBe('closing');

                // Check social files (x, threads and weibo share unified short notice)
                expect(snap1.x).toBe(snap1.threads);
                expect(snap1.weibo).toBe(snap1.x);

                // Second run is byte-identical
                const second = run(['daily-editorial-render', dir, stamp, 'true', '4']);
                expect(second.status).toBe(0);
                const snap2 = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(p, 'utf-8')]));
                expect(snap2).toEqual(snap1);
            });
        });

        it('skips xhs_plan.json when cards_enabled is false, and skips only the missing artifact when a master field is omitted', () => {
            withTempDir((dir) => {
                seedMaster(dir, { cover: undefined });
                const res = run(['daily-editorial-render', dir, stamp, 'false', '4']);
                expect(res.status).toBe(0);
                expect(existsSync(join(dir, `22-article/${stamp}_06_article-write_body.md`))).toBe(true);
                expect(existsSync(join(dir, `23-cover/${stamp}_07_cover-brief.json`))).toBe(false);
                expect(existsSync(join(dir, `25-xhs/${stamp}_18_xhs_plan.json`))).toBe(false);
                expect(existsSync(join(dir, '26-social/x.md'))).toBe(true);
                expect(existsSync(join(dir, '26-social/weibo.md'))).toBe(true);
                expect(`${res.stdout}${res.stderr}`).toContain('cover');
            });
        });
    });

    it('daily-run-report passes NEWS_REPORT_SCRIPT_FILE for the 脚本来源 read (R5)', () => {
        withTempDir((dir) => {
            for (const sub of ['21-plan', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
            const stamp = '20260925';
            writeFileSync(
                join(dir, `21-plan/${stamp}_04_quality-control-content_candidates.json`),
                JSON.stringify({ metadata: { docs: [] } }),
            );
            const envLog = join(dir, 'env.jsonl');
            const result = run(['daily-run-report', dir, stamp, '', '2', '3', '2', '1'], {
                KK_TEST_ENV_LOG: envLog,
                ...fakeKkLoggingEnv(dir),
            });
            expect(result.status).toBe(0);
            expect(lastEnv(envLog).NEWS_REPORT_SCRIPT_FILE).toBe(
                resolve(dir, '24-script', `${stamp}_08_script_content.json`),
            );
            // 20261016: the independent channels only surface in the completeness ledger, so the
            // report must be handed it or an empty WeChat/XHS draft box stays invisible.
            expect(lastEnv(envLog).NEWS_REPORT_COMPLETENESS_FILE).toBe(
                resolve(dir, '31-publish', `${stamp}_17_publish_completeness.json`),
            );
        });
    });
});

describe('kk workflow stage runner — daily-prepare work_dir composition (0139)', () => {
    // The anchor and composed paths are cwd-relative, so these tests run the stages
    // script with the temp dir as cwd instead of the repo root.
    function runIn(cwd: string, args: string[], env: Record<string, string> = {}) {
        const result = spawnSync('bun', [runner, ...args], {
            encoding: 'utf-8',
            cwd,
            env: { ...process.env, VOICEBOX_DEFAULT_PROFILE: 'tester', ...env },
        });
        return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    }

    const dprep = (stamp: string) => ['daily-prepare', '', '', '', '', '', '', '', stamp];
    const anchor = (dir: string) => readFileSync(join(dir, '.spur/runs/kk-daily-ai-voice/work-dir.txt'), 'utf-8');

    it('composes $KK_WORKS_DIR/kk-daily-ai-voice/<digits> from a dashed run_date and anchors it', () => {
        withTempDir((dir) => {
            const res = runIn(dir, dprep('2026-09-18'), { KK_WORKS_DIR: dir });
            expect(res.status).toBe(0);
            const work = join(dir, 'kk-daily-ai-voice/20260918');
            expect(readFileSync(join(work, 'run-date.txt'), 'utf-8')).toBe('20260918\n');
            expect(existsSync(join(work, '10-ingest/source.json'))).toBe(true);
            expect(anchor(dir)).toBe(`${work}\n`);
        });
    });

    it('a digits-only run_date (persisted var read-back) re-derives the same directory', () => {
        withTempDir((dir) => {
            const res = runIn(dir, dprep('20260918'), { KK_WORKS_DIR: dir });
            expect(res.status).toBe(0);
            expect(existsSync(join(dir, 'kk-daily-ai-voice/20260918/run-date.txt'))).toBe(true);
        });
    });

    it('explicit work_dir wins over composition but the anchor still records it', () => {
        withTempDir((dir) => {
            const work = join(dir, 'explicit');
            const res = runIn(dir, ['daily-prepare', work, '', '', '', '', '', '', '2026-09-18'], {
                KK_WORKS_DIR: dir,
            });
            expect(res.status).toBe(0);
            expect(existsSync(join(work, 'run-date.txt'))).toBe(true);
            expect(anchor(dir)).toBe(`${work}\n`);
        });
    });

    it('KK_CONFIG works_dir drives composition when KK_WORKS_DIR is unset', () => {
        withTempDir((home) => {
            const works = join(home, 'custom-works');
            writeFileSync(join(home, 'config.yaml'), `works_dir: ${works}\n`);
            const res = runIn(home, dprep('2026-09-18'), { KK_CONFIG: join(home, 'config.yaml') });
            expect(res.status).toBe(0);
            expect(readFileSync(join(works, 'kk-daily-ai-voice/20260918/run-date.txt'), 'utf-8')).toBe('20260918\n');
        });
    });
});

describe('daily-preflight stage/runner skew guard (20261020)', () => {
    const workflows = join(import.meta.dir, '../../../plugins/kk/workflows');

    it('passes when the installed runner advertises every stage the daily workflows invoke', () => {
        const result = run([
            'daily-preflight',
            join(workflows, 'kk-daily-ai-voice2.yaml'),
            join(workflows, 'kk-daily-safety.yaml'),
        ]);
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
            'advertises every stage kk-daily-ai-voice2.yaml + kk-daily-safety.yaml invokes',
        );
    });

    it('refuses at minute 0, naming the stage the stale runner lacks (the 2026-10-20 failure)', () => {
        withTempDir((dir) => {
            const workflow = join(dir, 'probe.yaml');
            writeFileSync(
                workflow,
                'name: probe\nnodes:\n  - id: x\n    action:\n      kind: shell\n      options:\n        command: >-\n          kk stage daily-safety-verdict "a" "b" && kk stage daily-not-a-real-stage\n',
            );
            const result = run(['daily-preflight', workflow]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('daily-preflight.runner-stale');
            expect(result.stderr).toContain('daily-not-a-real-stage (needed by probe.yaml)');
            // A stage the runner does know must not be reported.
            expect(result.stderr).not.toContain('daily-safety-verdict');
        });
    });

    it('fails loud on a missing workflow file and on no arguments', () => {
        const missing = run(['daily-preflight', join(tmpdir(), 'no-such-workflow.yaml')]);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain('daily-preflight.workflow-missing');
        const bare = run(['daily-preflight']);
        expect(bare.status).toBe(2);
        expect(bare.stderr).toContain('pass at least one workflow YAML path');
    });
});

describe('daily-patch-surfdash git scoping and frontmatter (R6/R11)', () => {
    const RUN_DATE = '20260904';
    const POST_REL = `content/posts/articles/zh/${RUN_DATE}-post/index.md`;

    const git = (cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } => {
        const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
        return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };

    /**
     * A throwaway surfdash checkout on `main` with a bare `origin`, one zh post, the two publish
     * result fixtures the stage reads, and an unrelated *staged* file that must survive the commit.
     */
    function setupFixture(
        dir: string,
        imageUrl: string,
        bodyLine: string,
    ): { workDir: string; root: string; bare: string; postDir: string } {
        const workDir = join(dir, 'work');
        const root = join(dir, 'surfdash');
        const bare = join(dir, 'bare.git');
        const postDir = join(root, 'content', 'posts', 'articles', 'zh', `${RUN_DATE}-post`);
        mkdirSync(postDir, { recursive: true });
        writeFileSync(
            join(postDir, 'index.md'),
            `---\ntitle: T\npublishDate: ${RUN_DATE.slice(0, 4)}-${RUN_DATE.slice(4, 6)}-${RUN_DATE.slice(6, 8)}\n---\n\n${bodyLine}\n`,
            'utf-8',
        );

        const pub = join(workDir, '31-publish');
        mkdirSync(pub, { recursive: true });
        writeFileSync(
            join(pub, `${RUN_DATE}_14_publish-surfdash_result.json`),
            JSON.stringify({ targets: [{ metadata: { postPath: join(postDir, 'index.md') } }] }),
            'utf-8',
        );
        writeFileSync(
            join(pub, `${RUN_DATE}_16_publish-podcast_result.json`),
            JSON.stringify({ targets: [{ url: 'https://pod.example/i/1', metadata: { imageUrl } }] }),
            'utf-8',
        );

        git(root, 'init', '-b', 'main');
        git(root, 'config', 'user.email', 'test@example.com');
        git(root, 'config', 'user.name', 'Test');
        writeFileSync(join(root, 'other.txt'), 'unrelated\n', 'utf-8');
        // surfdash-pub runs the site gate (`bun run sd check digest` plus the site's content suite
        // `check:content` / `check:body` / `check:seo`) in the checkout before it pushes; stub all of
        // them as passing so these tests stay about git scoping.
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({
                name: 'surfdash-fixture',
                private: true,
                scripts: { sd: 'true', 'check:content': 'true', 'check:body': 'true', 'check:seo': 'true' },
            }),
            'utf-8',
        );
        git(root, 'add', '-A');
        git(root, 'commit', '-m', 'init');
        // The operator's unrelated work is *modified and staged* so it is visible in the index and
        // must survive the stage's scoped commit (staging an unmodified file leaves no diff).
        writeFileSync(join(root, 'other.txt'), 'unrelated modified\n', 'utf-8');
        git(root, 'add', 'other.txt');

        spawnSync('git', ['init', '--bare', bare], { encoding: 'utf-8' });
        git(root, 'remote', 'add', 'origin', bare);
        return { workDir, root, bare, postDir };
    }

    it('commits only its own paths, from main, leaving unrelated staged work alone', () => {
        withTempDir((dir) => {
            const fx = setupFixture(dir, 'https://cdn.example/c.png', 'Body.');
            const res = run(['daily-patch-surfdash', fx.workDir, RUN_DATE, fx.root], { SURFDASH_AUTO_PUSH: '1' });
            expect(res.status).toBe(0);

            const committed = git(fx.root, 'show', '--name-only', '--pretty=format:', 'HEAD')
                .stdout.split('\n')
                .filter((l) => l.trim() !== '');
            expect(committed).toEqual([POST_REL]);
            // The unrelated staged file is still staged — and was never committed.
            expect(git(fx.root, 'diff', '--cached', '--name-only').stdout).toContain('other.txt');
            expect(committed).not.toContain('other.txt');
            // The push targeted origin main.
            const localHead = git(fx.root, 'rev-parse', 'HEAD').stdout.trim();
            expect(git(fx.bare, 'log', 'main', '-1', '--format=%H').stdout.trim()).toBe(localHead);
        });
    });

    it('refuses to commit when the checkout is not on main', () => {
        withTempDir((dir) => {
            const fx = setupFixture(dir, 'https://cdn.example/c.png', 'Body.');
            git(fx.root, 'checkout', '-b', 'feature');
            const before = git(fx.root, 'rev-parse', 'HEAD').stdout.trim();

            const res = run(['daily-patch-surfdash', fx.workDir, RUN_DATE, fx.root], { SURFDASH_AUTO_PUSH: '1' });

            expect(res.status).not.toBe(0);
            expect(`${res.stdout}${res.stderr}`).toContain('main');
            expect(git(fx.root, 'rev-parse', 'HEAD').stdout.trim()).toBe(before);
        });
    });

    it('skips (exit 0) when the surfdash publish carries no postPath — a partial publish must not fail the run', () => {
        withTempDir((dir) => {
            const fx = setupFixture(dir, 'https://cdn.example/c.png', 'Body.');
            // 2026-10-21: the surfdash `git push` was rejected (`fetch first`), so the target landed
            // with no postPath while the podcast episode published. classify routed `partial`, and the
            // folded patch tail then failed the whole run — the episode was live, the run was `failed`.
            writeFileSync(
                join(fx.workDir, '31-publish', `${RUN_DATE}_14_publish-surfdash_result.json`),
                JSON.stringify({ targets: [{ ok: false, status: 'failed', error: 'push rejected (fetch first)' }] }),
                'utf-8',
            );
            const before = git(fx.root, 'rev-parse', 'HEAD').stdout.trim();

            const res = run(['daily-patch-surfdash', fx.workDir, RUN_DATE, fx.root], { SURFDASH_AUTO_PUSH: '1' });

            expect(res.status, res.stderr).toBe(0);
            expect(res.stderr).toContain('carries no postPath');
            expect(existsSync(join(fx.workDir, '31-publish', `${RUN_DATE}_23_patch-surfdash_patch.json`))).toBe(false);
            // Nothing was committed for a post that does not exist.
            expect(git(fx.root, 'rev-parse', 'HEAD').stdout.trim()).toBe(before);
        });
    });

    it("commits this run's untracked post when the surfdash receipt is missing — the deploy owes it the cover", () => {
        withTempDir((dir) => {
            const fx = setupFixture(dir, 'https://cdn.example/c.png', 'Body.');
            // 2026-11-20: a window whose plan excluded surfdash-pub (an earlier attempt had died at
            // `sync_cms`) left the day's post untracked with no receipt. The stage skipped, so the
            // post and its `./assets/cover.png` never reached git, the deploy had nothing to ship and
            // the live article 404'd its own cover while the cron log carried only a warning.
            rmSync(join(fx.workDir, '31-publish', `${RUN_DATE}_14_publish-surfdash_result.json`));
            const postDir = `content/posts/articles/zh/${RUN_DATE}-post`;
            git(fx.root, 'rm', '-q', '--cached', '-r', postDir);
            const before = git(fx.root, 'rev-parse', 'HEAD').stdout.trim();

            const res = run(['daily-patch-surfdash', fx.workDir, RUN_DATE, fx.root], { SURFDASH_AUTO_PUSH: '1' });

            expect(res.status, res.stderr).toBe(0);
            expect(res.stderr).toContain('is uncommitted in the checkout');
            const committed = git(fx.root, 'show', '--name-only', '--pretty=format:', 'HEAD')
                .stdout.split('\n')
                .filter((l) => l.trim() !== '');
            expect(committed).toContain(`${postDir}/index.md`);
            expect(git(fx.root, 'rev-parse', 'HEAD').stdout.trim()).not.toBe(before);
        });
    });

    it('writes a failed resync receipt and skips the remote patch when a publish receipt has no targets array', () => {
        withTempDir((dir) => {
            const fx = setupFixture(dir, 'https://cdn.example/c.png', 'Body.');
            writeFileSync(
                join(fx.workDir, '31-publish', `${RUN_DATE}_14_publish-surfdash_result.json`),
                JSON.stringify({ ok: true }),
                'utf-8',
            );
            const before = git(fx.root, 'rev-parse', 'HEAD').stdout.trim();

            const res = run(['daily-patch-surfdash', fx.workDir, RUN_DATE, fx.root], { SURFDASH_AUTO_PUSH: '1' });

            expect(res.status, res.stderr).toBe(0);
            expect(res.stderr).toContain('malformed surfdash/podcast publish receipt');
            expect(existsSync(join(fx.workDir, '31-publish', `${RUN_DATE}_23_patch-surfdash_patch.json`))).toBe(false);
            expect(
                JSON.parse(
                    readFileSync(
                        join(fx.workDir, '31-publish', `${RUN_DATE}_23_patch-surfdash_sync-result.json`),
                        'utf-8',
                    ),
                ),
            ).toMatchObject({ ok: false, target: 'surfdash-pub' });
            expect(git(fx.root, 'rev-parse', 'HEAD').stdout.trim()).toBe(before);
        });
    });

    it('writes valid, frontmatter-only YAML when the value holds a quote and a dollar', () => {
        withTempDir((dir) => {
            const url = "https://cdn.example/it's-$&-cover.png";
            const fx = setupFixture(dir, url, 'image: keep-me');
            const res = run(['daily-patch-surfdash', fx.workDir, RUN_DATE, fx.root], { SURFDASH_AUTO_PUSH: '1' });
            expect(res.status).toBe(0);

            const md = readFileSync(join(fx.postDir, 'index.md'), 'utf-8');
            // YAML single-quoted scalars escape `'` as `''`; `$&` is not expanded (function replacement).
            expect(md).toContain("image: 'https://cdn.example/it''s-$&-cover.png'");
            expect(md).toContain("og_image: 'https://cdn.example/it''s-$&-cover.png'");
            // A body line starting with `image:` is untouched — the upsert is frontmatter-scoped.
            expect(md).toContain('image: keep-me');

            const frontmatter = md.split('---')[1] ?? '';
            const parsed = Bun.YAML.parse(frontmatter) as Record<string, unknown>;
            expect(parsed.image).toBe(url);
            expect(parsed.og_image).toBe(url);
        });
    });
});

describe('daily-intro (0176)', () => {
    // Regression net for the concat-collision bug: pre-fix the join read `mp3Path` first and
    // rewrote only a `.wav` suffix, so with transcode_mp3=true the output equalled input #1 and
    // ffmpeg aborted with "same as Input #1". These tests pin audioPath-first selection and the
    // extension-agnostic `<stem>.intro.wav` derivation. Requires ffmpeg/ffprobe on PATH (the same
    // pipeline dependency the stage itself shells out to).
    const INTRO_SECS = '0.3';
    const MAIN_SECS = '0.5';
    const RUN_DATE = '20260925';

    function makeAudio(path: string, secs: string, codec: 'wav' | 'mp3'): void {
        const args = ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', secs];
        if (codec === 'wav') args.push('-c:a', 'pcm_s16le');
        else args.push('-codec:a', 'libmp3lame', '-qscale:a', '2');
        args.push(path);
        const res = spawnSync('ffmpeg', args, { encoding: 'utf-8' });
        expect(res.status, `ffmpeg fixture ${path}: ${res.stderr}`).toBe(0);
    }

    function probeDuration(path: string): number {
        const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], {
            encoding: 'utf-8',
        }).stdout;
        return Number.parseFloat((out ?? '').trim());
    }

    function setupWorkDir(dir: string, metadata: Record<string, unknown>): string {
        const workDir = join(dir, 'work');
        mkdirSync(join(workDir, '30-audio'), { recursive: true });
        writeFileSync(join(workDir, '30-audio', `${RUN_DATE}_11_generate_content.json`), JSON.stringify({ metadata }));
        return workDir;
    }

    function readMeta(workDir: string): Record<string, unknown> {
        const content = JSON.parse(
            readFileSync(join(workDir, '30-audio', `${RUN_DATE}_11_generate_content.json`), 'utf-8'),
        );
        return content.metadata as Record<string, unknown>;
    }

    it('merges from the raw render, keeps inputs intact, and is idempotent (R1, R3)', () => {
        withTempDir((dir) => {
            const wav = join(dir, 'main.wav');
            const mp3 = join(dir, 'main.mp3');
            const intro = join(dir, 'intro.wav');
            makeAudio(wav, MAIN_SECS, 'wav');
            makeAudio(mp3, MAIN_SECS, 'mp3');
            makeAudio(intro, INTRO_SECS, 'wav');
            const wavBefore = createHash('sha256').update(readFileSync(wav)).digest('hex');
            const workDir = setupWorkDir(dir, { audioPath: wav, mp3Path: mp3, duration: 0.5 });

            const res = run(['daily-intro', workDir, RUN_DATE, intro]);
            expect(res.status, res.stderr).toBe(0);
            expect(res.stdout).toContain('intro-music: merged');

            const merged = join(dir, 'main.intro.wav');
            expect(existsSync(merged)).toBe(true);
            const mergedDur = probeDuration(merged);
            expect(mergedDur).toBeGreaterThan(0.6);
            expect(mergedDur).toBeLessThan(1.2);
            // R3: raw render preserved byte-for-byte; mp3 re-transcoded to carry the intro.
            expect(createHash('sha256').update(readFileSync(wav)).digest('hex')).toBe(wavBefore);
            expect(probeDuration(mp3)).toBeGreaterThan(0.6);

            const meta = readMeta(workDir);
            expect(meta.audioPath).toBe(merged);
            expect(meta.introMerged).toBe(true);
            expect(meta.duration as number).toBeGreaterThan(0.6);

            const again = run(['daily-intro', workDir, RUN_DATE, intro]);
            expect(again.status).toBe(0);
            expect(again.stdout).toContain('intro-music cached');
        });
    });

    it('never collides output with input when only an mp3 primary exists (R2 — the 0176 bug)', () => {
        withTempDir((dir) => {
            const mp3 = join(dir, 'main.mp3');
            const intro = join(dir, 'intro.wav');
            makeAudio(mp3, MAIN_SECS, 'mp3');
            makeAudio(intro, INTRO_SECS, 'wav');
            const workDir = setupWorkDir(dir, { mp3Path: mp3, duration: 0.5 });

            const res = run(['daily-intro', workDir, RUN_DATE, intro]);
            expect(res.status, res.stderr).toBe(0);

            const merged = join(dir, 'main.intro.wav');
            expect(merged).not.toBe(mp3);
            expect(existsSync(merged)).toBe(true);
            expect(probeDuration(merged)).toBeGreaterThan(0.6);
            const meta = readMeta(workDir);
            expect(meta.audioPath).toBe(merged);
        });
    });

    it('expands a ~/ intro path against HOME (the sting lives under the config root, ADR-042)', () => {
        withTempDir((dir) => {
            const home = join(dir, 'home');
            const voices = join(home, '.config/kk/voices');
            mkdirSync(voices, { recursive: true });
            makeAudio(join(voices, 'intro.wav'), INTRO_SECS, 'wav');
            const mp3 = join(dir, 'main.mp3');
            makeAudio(mp3, MAIN_SECS, 'mp3');
            const workDir = setupWorkDir(dir, { mp3Path: mp3, duration: 0.5 });

            const res = run(['daily-intro', workDir, RUN_DATE, '~/.config/kk/voices/intro.wav'], { HOME: home });
            expect(res.status, res.stderr).toBe(0);
            expect(res.stdout).toContain('intro-music: merged');
        });
    });
});

describe('daily-voice-audit — advisory speaker-consistency check (20261016)', () => {
    const stamp = '20261016';

    /**
     * A fake voxcpm plugin tree whose `python` stands in for the audit. The stage must pass the audit's
     * own exit code through as a WARNING and still exit 0: a regression, a missing venv, or a broken
     * script must never stop the episode from publishing.
     */
    function fakePlugin(dir: string, exitCode: number): string {
        const plugin = join(dir, 'plugins', 'generations', 'voxcpm-tts');
        mkdirSync(join(plugin, '.venv', 'bin'), { recursive: true });
        mkdirSync(join(plugin, 'scripts'), { recursive: true });
        writeFileSync(join(plugin, 'scripts', 'audit-speaker-consistency.py'), '# stub\n');
        const python = join(plugin, '.venv', 'bin', 'python');
        writeFileSync(python, `#!/bin/sh\necho "FAIL — 08-item: F0 spread 103 Hz"\nexit ${exitCode}\n`);
        chmodSync(python, 0o755);
        mkdirSync(join(dir, '30-audio'), { recursive: true });
        writeFileSync(join(dir, '30-audio', `${stamp}_11_generate_content.json`), JSON.stringify({ metadata: {} }));
        return join(dir, 'plugins');
    }

    it('reports a failing audit as a warning and still exits 0', () => {
        withTempDir((dir) => {
            const plugins = fakePlugin(dir, 1);
            const result = run(['daily-voice-audit', dir, stamp, plugins]);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('F0 spread 103 Hz');
            expect(result.stdout).toContain('WARNING');
        });
    });

    it('stays silent-quiet and exits 0 when the audit passes', () => {
        withTempDir((dir) => {
            const plugins = fakePlugin(dir, 0);
            const result = run(['daily-voice-audit', dir, stamp, plugins]);
            expect(result.status).toBe(0);
            expect(result.stdout).not.toContain('WARNING');
        });
    });

    it('skips without failing when the episode content or the plugin tree is absent', () => {
        withTempDir((dir) => {
            const result = run(['daily-voice-audit', dir, stamp, join(dir, 'plugins')]);
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('no episode content');
        });
    });
});

describe('daily-translate-sync pre-sync structural check (20261023 splice regression)', () => {
    const STAMP = '20261023';

    function postPath(dir: string, locale: 'zh' | 'en' | 'ja'): string {
        return join(dir, 'surfdash', 'content', 'posts', 'articles', locale, `${STAMP}-ai-post`, 'index.md');
    }

    function writePost(
        dir: string,
        locale: 'zh' | 'en' | 'ja',
        frontmatter: { description: string; keyPoints: string[] },
    ): void {
        const file = postPath(dir, locale);
        mkdirSync(dirname(file), { recursive: true });
        const points = frontmatter.keyPoints.map((p) => `  - "${p}"`).join('\n');
        writeFileSync(
            file,
            `---\ntitle: T ${locale}\ndescription: "${frontmatter.description}"\ntags:\n  - ai-news\npublishDate: 2026-10-23\ndraft: true\nkey_points:\n${points}\n---\n\nBody.\n`,
        );
    }

    /** PATH kk shim: records argv and exits 0 — the stage must reach the real sync spawn only when the gate passes. */
    function kkShim(dir: string, logPath: string): Record<string, string> {
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        const path = join(bin, 'kk');
        writeFileSync(path, `#!/usr/bin/env bash\nprintf '%s\\n' "kk $*" >> "${logPath}"\nexit 0\n`);
        chmodSync(path, 0o755);
        return { PATH: `${bin}:${process.env.PATH ?? ''}` };
    }

    function markerFile(dir: string, zhPath: string): string {
        const publish = join(dir, '31-publish');
        mkdirSync(publish, { recursive: true });
        const marker = join(publish, `${STAMP}_20_translate-localize_zh-post-path.txt`);
        writeFileSync(marker, zhPath);
        return marker;
    }

    it('fails loud on a spliced en key_points list (merged items) and never spawns the sync', () => {
        withTempDir((dir) => {
            const zhPath = postPath(dir, 'zh');
            writePost(dir, 'zh', { description: '中文摘要', keyPoints: ['a', 'b', 'c', 'd'] });
            writePost(dir, 'en', { description: 'English summary', keyPoints: ['spliced a and b', 'c plus d'] });
            writePost(dir, 'ja', { description: '日本語の要約', keyPoints: ['a', 'b', 'c', 'd'] });
            const log = join(dir, 'kk-calls.log');
            const res = run(['daily-translate-sync', dir, STAMP, '', markerFile(dir, zhPath)], kkShim(dir, log));
            expect(res.status).toBe(1);
            expect(res.stderr).toContain('pre-sync structural check');
            expect(res.stderr).toContain('key_points count 2 != zh 4');
            expect(existsSync(log)).toBe(false);
        });
    });

    it('fails loud on an empty en description', () => {
        withTempDir((dir) => {
            const zhPath = postPath(dir, 'zh');
            writePost(dir, 'zh', { description: '中文摘要', keyPoints: ['a', 'b'] });
            writePost(dir, 'en', { description: '', keyPoints: ['a', 'b'] });
            const log = join(dir, 'kk-calls.log');
            const res = run(['daily-translate-sync', dir, STAMP, '', markerFile(dir, zhPath)], kkShim(dir, log));
            expect(res.status).toBe(1);
            expect(res.stderr).toContain('description missing/empty');
            expect(existsSync(log)).toBe(false);
        });
    });

    it('passes matching en/ja drafts through to the surfdash-pub sync', () => {
        withTempDir((dir) => {
            const zhPath = postPath(dir, 'zh');
            writePost(dir, 'zh', { description: '中文摘要', keyPoints: ['a', 'b'] });
            writePost(dir, 'en', { description: 'English summary', keyPoints: ['a', 'b'] });
            writePost(dir, 'ja', { description: '日本語の要約', keyPoints: ['a', 'b'] });
            const log = join(dir, 'kk-calls.log');
            const res = run(['daily-translate-sync', dir, STAMP, '', markerFile(dir, zhPath)], kkShim(dir, log));
            expect(res.status).toBe(0);
            expect(readFileSync(log, 'utf-8')).toContain('executor run surfdash-pub');
        });
    });

    it('skips without a zh marker file', () => {
        withTempDir((dir) => {
            const res = run(['daily-translate-sync', dir, STAMP, '', join(dir, 'missing.txt')]);
            expect(res.status).toBe(0);
            expect(res.stdout).toContain('no zh post path');
        });
    });
});
