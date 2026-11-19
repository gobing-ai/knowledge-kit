import { describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkPresetIndex,
    INDEX_END,
    INDEX_START,
    main as presetIndexMain,
    README_PATH,
    renderPresetIndex,
    splicePresetIndex,
} from '../scripts/gen-preset-index';
import { main as resolvePresetMain } from '../scripts/resolve-preset';
import { parseMusicBrief } from '../src/brief';
import {
    explainJob,
    loadMusicPresets,
    MUSIC_PRESET_ROOT,
    PRESET_STATUSES,
    PresetDataError,
    presetLayerForTheme,
    resolveJob,
    resolveNamedJob,
    themeDirectionGaps,
    UnknownPresetError,
} from '../src/presets';
import { renderBriefPrompt } from '../src/render';
import { renderGenerateRequest } from '../src/request';

/**
 * AC1–AC5 for task 0399: the shipped format × theme preset data, the loader
 * checks that make a preset file trustworthy, name-based resolution on top of
 * 0397's precedence, and the README index the generator owns. Fully offline —
 * no generated take, no adapter, no network.
 */

const PLUGIN_DIR = join(import.meta.dir, '..');
const INVALID_ROOT = join(import.meta.dir, 'fixtures', 'preset-roots', 'invalid');
const SHIPPED_FORMATS = ['clip', 'jingle', 'loop', 'song', 'underscore'];
const SHIPPED_THEMES = ['ambient-tech', 'cinematic', 'lofi', 'synthwave'];

const shipped = await loadMusicPresets();

function brief(overrides: Record<string, unknown> = {}): ReturnType<typeof parseMusicBrief> {
    return parseMusicBrief({ title: 'Preset data', format: 'song', theme: 'lofi', ...overrides });
}

async function captureLoad(root: string): Promise<PresetDataError | undefined> {
    try {
        await loadMusicPresets({ root });
        return undefined;
    } catch (error) {
        return error as PresetDataError;
    }
}

describe('AC1 — formats fix structure without pinning the provider', () => {
    test('the five shipped formats declare model, skeleton and lyrics policy', () => {
        expect([...shipped.formats.keys()].sort()).toEqual(SHIPPED_FORMATS);
        for (const preset of shipped.formats.values()) {
            expect(preset.model === 'pro' || preset.model === 'clip').toBe(true);
            expect(preset.structure.length).toBeGreaterThan(0);
            expect(['allowed', 'forbidden']).toContain(preset.lyrics_policy);
            if (preset.model === 'pro') {
                expect(preset.duration_target).toMatch(/^\d{1,2}:[0-5]\d$/);
            } else {
                expect(preset.duration_target).toBeUndefined();
            }
        }
        expect(shipped.formats.get('song')?.duration_target).toBe('2:30');
        expect(shipped.formats.get('jingle')?.duration_target).toBe('0:20');
        expect(shipped.formats.get('underscore')?.lyrics_policy).toBe('forbidden');
        expect(shipped.formats.get('loop')?.lyrics_policy).toBe('forbidden');
    });

    test('the clip and loop formats resolve to a request with no durationTarget', () => {
        for (const format of ['clip', 'loop']) {
            const job = resolveNamedJob(brief({ format, theme: 'ambient-tech' }), shipped);
            expect(job.model.value).toBe('clip');
            expect(job.duration_target.value).toBeUndefined();
            expect(renderGenerateRequest(job).durationTarget).toBeUndefined();
        }
    });

    test('a pro format carries its default duration target onto the wire', () => {
        for (const [format, duration] of [
            ['song', '2:30'],
            ['jingle', '0:20'],
            ['underscore', '0:45'],
        ] as const) {
            const job = resolveNamedJob(brief({ format, theme: 'cinematic' }), shipped);
            expect(job.duration_target).toEqual({ value: duration, source: 'format', origin: format });
            expect(renderGenerateRequest(job).durationTarget).toBe(duration);
        }
    });

    test('no shipped preset file names a provider, model id, base URL or price', () => {
        const forbidden =
            /\b(provider|providers|model_id|model-id|modelId|api_model_id|base_url|base-url|baseUrl|price|prices|unit_price|cost|api_key|apiKey|secret|token|endpoint)\b/;
        for (const axis of ['formats', 'themes']) {
            const dir = join(MUSIC_PRESET_ROOT, axis);
            const files = readdirSync(dir).filter((entry) => entry.endsWith('.yaml'));
            expect(files.length).toBeGreaterThan(0);
            for (const file of files) {
                const text = readFileSync(join(dir, file), 'utf8');
                expect({ file: `${axis}/${file}`, hit: forbidden.exec(text)?.[0] }).toEqual({
                    file: `${axis}/${file}`,
                    hit: undefined,
                });
            }
        }
    });
});

describe('AC2 — themes carry the technical direction the model reads', () => {
    test('the four shipped themes state every facet in their prose', () => {
        expect([...shipped.themes.keys()].sort()).toEqual(SHIPPED_THEMES);
        for (const preset of shipped.themes.values()) {
            expect({ theme: preset.name, gaps: themeDirectionGaps(preset) }).toEqual({ theme: preset.name, gaps: [] });
            expect(preset.instrumentation.length).toBeGreaterThan(0);
            expect(preset.avoid.length).toBeGreaterThan(0);
        }
        expect(['corporate-tech', 'xhs-pop'].filter((name) => shipped.themes.has(name))).toEqual([]);
    });

    test('a theme status is authored, evidence-pending or verified — and none claims verified', () => {
        for (const preset of [...shipped.themes.values(), ...shipped.formats.values()]) {
            expect(PRESET_STATUSES).toContain(preset.provenance.status);
            expect(preset.provenance.authored_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            if (preset.provenance.status === 'verified') {
                // Promotion needs a real generation review; a freshly authored file cannot have one.
                expect(preset.provenance.evidence).toBeDefined();
            }
            expect(['authored', 'evidence-pending']).toContain(preset.provenance.status);
        }
    });

    test('the default avoid-list renders as exactly one Avoid: segment', () => {
        const theme = shipped.themes.get('cinematic');
        expect(theme).toBeDefined();
        const job = resolveNamedJob(brief({ format: 'underscore', theme: 'cinematic' }), shipped);
        const prompt = renderBriefPrompt(job);
        const segments = prompt.split('\n').filter((line) => line.startsWith('Avoid: '));
        expect(segments).toHaveLength(1);
        expect(segments[0]).toBe(`Avoid: ${theme?.avoid.join(', ')}`);
    });

    test('a brief avoid-list merges into the same single segment', () => {
        const job = resolveNamedJob(brief({ format: 'song', theme: 'lofi', avoid: ['authored cliché'] }), shipped);
        const segments = renderBriefPrompt(job)
            .split('\n')
            .filter((line) => line.startsWith('Avoid: '));
        expect(segments).toHaveLength(1);
        expect(segments[0]).toContain('authored cliché');
        expect(segments[0]).toContain('trap hi-hat rolls');
    });

    test('the theme layer is style prose plus avoid, nothing else', () => {
        const theme = shipped.themes.get('synthwave');
        expect(theme).toBeDefined();
        if (theme === undefined) {
            return;
        }
        expect(presetLayerForTheme(theme)).toEqual({ name: 'synthwave', style: theme.style, avoid: theme.avoid });
    });
});

describe('AC3 — precedence is deterministic and explained', () => {
    test('the 0397 precedence still decides each field over the preset data', () => {
        const fromFormat = resolveNamedJob(brief({ format: 'song', theme: 'lofi' }), shipped);
        expect(explainJob(fromFormat)).toContain('duration_target: 2:30 (format preset "song")');
        expect(explainJob(fromFormat)).toContain('model: pro (format preset "song")');
        expect(explainJob(fromFormat).some((line) => line.startsWith('style: Dusty sampled lo-fi'))).toBe(true);

        const fromBrief = resolveNamedJob(
            brief({ format: 'song', theme: 'lofi', duration_target: '1:00', style: 'Brief direction.' }),
            shipped,
        );
        expect(fromBrief.duration_target).toEqual({ value: '1:00', source: 'brief', origin: undefined });
        expect(fromBrief.style).toEqual({ value: 'Brief direction.', source: 'brief', origin: undefined });

        const fromWorkflow = resolveNamedJob(brief({ format: 'song', theme: 'lofi' }), shipped, {
            workflow: { name: 'wf', style: 'Workflow direction.' },
        });
        expect(fromWorkflow.style).toEqual({ value: 'Workflow direction.', source: 'workflow', origin: 'wf' });
        expect(explainJob(fromWorkflow)).toContain('style: Workflow direction. (workflow preset "wf")');
        expect(explainJob(fromWorkflow)).toContain('structure: 6 section(s) (format preset "song")');
    });

    test('an unknown format name exits non-zero, lists the valid names and prints the trace', () => {
        const script = [
            `import { loadMusicPresets, resolveNamedJob } from ${JSON.stringify(join(PLUGIN_DIR, 'src', 'presets.ts'))};`,
            `import { parseMusicBrief } from ${JSON.stringify(join(PLUGIN_DIR, 'src', 'brief.ts'))};`,
            'const presets = await loadMusicPresets();',
            `const brief = parseMusicBrief(${JSON.stringify({ title: 'T', format: 'nope', theme: 'lofi' })});`,
            'try { resolveNamedJob(brief, presets); process.exit(0); }',
            'catch (error) { console.error(error.report ?? error.message); process.exit(error.exitCode ?? 1); }',
        ].join('\n');
        const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
        const stderr = result.stderr.toString();
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain('unknown format preset "nope"');
        expect(stderr).toContain('clip, jingle, loop, song, underscore');
        expect(stderr).toContain('resolution with the known layers failed');
    });

    test('an unknown theme name exits non-zero with the valid names and the explainJob trace', () => {
        const script = [
            `import { loadMusicPresets, resolveNamedJob } from ${JSON.stringify(join(PLUGIN_DIR, 'src', 'presets.ts'))};`,
            `import { parseMusicBrief } from ${JSON.stringify(join(PLUGIN_DIR, 'src', 'brief.ts'))};`,
            'const presets = await loadMusicPresets();',
            `const brief = parseMusicBrief(${JSON.stringify({
                title: 'T',
                format: 'song',
                theme: 'corporate-tech',
                style: 'Brief direction.',
            })});`,
            'try { resolveNamedJob(brief, presets); process.exit(0); }',
            'catch (error) { console.error(error.report ?? error.message); process.exit(error.exitCode ?? 1); }',
        ].join('\n');
        const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
        const stderr = result.stderr.toString();
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain('unknown theme preset "corporate-tech"');
        expect(stderr).toContain('ambient-tech, cinematic, lofi, synthwave');
        // The source trace is printed, not just the failure.
        expect(stderr).toContain('duration_target: 2:30 (format preset "song")');
        expect(stderr).toContain('structure: 6 section(s) (format preset "song")');
    });

    test('an unknown name never falls back to a built-in', () => {
        expect(() => resolveNamedJob(brief({ format: 'song', theme: 'nope' }), shipped)).toThrow(UnknownPresetError);
        try {
            resolveNamedJob(brief({ format: 'song', theme: 'nope' }), shipped);
        } catch (error) {
            const unknown = error as UnknownPresetError;
            expect(unknown.exitCode).toBe(1);
            expect(unknown.axis).toBe('theme');
            expect(unknown.validNames).toEqual(SHIPPED_THEMES);
            expect(unknown.report.split('\n').length).toBeGreaterThan(1);
        }
    });
});

describe('AC4 — invalid preset files are rejected with a reason', () => {
    test('each rule reports a field-specific problem naming the file', async () => {
        const error = await captureLoad(INVALID_ROOT);
        expect(error).toBeInstanceOf(PresetDataError);
        if (error === undefined) {
            return;
        }
        expect(error.exitCode).toBe(2);
        const cases = [
            { file: 'formats/invalid-provider.yaml', field: 'provider', message: 'not portable' },
            { file: 'formats/invalid-price.yaml', field: 'price', message: 'not portable' },
            { file: 'themes/invalid-model-id.yaml', field: 'model_id', message: 'not portable' },
            { file: 'themes/invalid-status.yaml', field: 'provenance.status', message: 'authored' },
            { file: 'formats/invalid-provenance.yaml', field: 'provenance', message: 'expected object' },
            { file: 'formats/invalid-clip-structure.yaml', field: 'structure.2.at', message: 'clip ceiling' },
            { file: 'themes/invalid-coverage.yaml', field: 'style', message: 'production "trailer-bright master"' },
        ];
        for (const expectation of cases) {
            const problem = error.problems.find((entry) => entry.path.endsWith(expectation.file));
            expect({ file: expectation.file, problem: problem === undefined }).toEqual({
                file: expectation.file,
                problem: false,
            });
            expect({ file: expectation.file, field: problem?.field }).toEqual({
                file: expectation.file,
                field: expectation.field,
            });
            expect(problem?.message).toContain(expectation.message);
            expect(error.message).toContain(expectation.file);
        }
    });

    test('the portable control files in the same root report nothing', async () => {
        const error = await captureLoad(INVALID_ROOT);
        const reported = error?.problems.map((problem) => problem.path) ?? [];
        expect(reported.some((path) => path.endsWith('valid-song.yaml'))).toBe(false);
        expect(reported.some((path) => path.endsWith('valid-lofi.yaml'))).toBe(false);
    });

    test('no partially loaded preset set escapes: the loader throws and returns nothing', async () => {
        const error = await captureLoad(INVALID_ROOT);
        expect(error).toBeInstanceOf(PresetDataError);
        expect((error?.problems.length ?? 0) >= 7).toBe(true);
    });

    test('a missing root and a name/file mismatch are rejected', async () => {
        const missing = await captureLoad(join(tmpdir(), 'kk-no-such-preset-root'));
        expect(missing).toBeInstanceOf(PresetDataError);
        expect(missing?.message).toContain('preset directory is missing');

        const root = mkdtempSync(join(tmpdir(), 'kk-music-presets-'));
        try {
            mkdirSync(join(root, 'formats'), { recursive: true });
            mkdirSync(join(root, 'themes'), { recursive: true });
            writeFileSync(
                join(root, 'formats', 'wrong-stem.yaml'),
                [
                    'name: something-else',
                    'description: d',
                    'intended_use: i',
                    'model: pro',
                    'duration_target: "0:30"',
                    'lyrics_policy: allowed',
                    'structure:',
                    '  - at: "0:00"',
                    '    section: Intro',
                    'provenance: { authoring_source: test, authored_at: "2026-11-19", status: authored }',
                ].join('\n'),
            );
            const mismatch = await captureLoad(root);
            expect(mismatch).toBeInstanceOf(PresetDataError);
            expect(mismatch?.message).toContain('but the file is wrong-stem.yaml');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('AC5 — the index matches the data', () => {
    test('the shipped README index equals the preset inventory', async () => {
        const result = await checkPresetIndex();
        if (!result.ok) {
            throw new Error(`README preset index drifted:\n${result.expected}`);
        }
        expect(result.ok).toBe(true);
    });

    test('the README carries the markers the generator owns', () => {
        const readme = readFileSync(README_PATH, 'utf8');
        expect(readme).toContain(INDEX_START);
        expect(readme).toContain(INDEX_END);
        expect(readme.indexOf(INDEX_START)).toBeLessThan(readme.indexOf(INDEX_END));
    });

    test('each row shows the use case, status and default duration', () => {
        const block = renderPresetIndex(shipped);
        expect(block).toContain('| Format | Model | Default duration | Lyrics | Intended use | Status |');
        expect(block).toContain('| Theme | Technical direction | Default avoid | Intended use | Status |');
        expect(block).toContain('`2:30`');
        expect(block).toContain('`0:20`');
        expect(block).toContain('— (clip is fixed at ~0:30)');
        expect(block).toContain('| `authored` |');
        const rows = block.split('\n').filter((line) => line.startsWith('| `')).length;
        expect(rows).toBe(SHIPPED_FORMATS.length + SHIPPED_THEMES.length);
    });

    test('the check fails on drift and the generator rewrites the block', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-music-index-'));
        try {
            const presetRoot = join(root, 'presets');
            cpSync(MUSIC_PRESET_ROOT, presetRoot, { recursive: true });
            const readmePath = join(root, 'README.md');
            cpSync(README_PATH, readmePath);
            writeFileSync(
                join(presetRoot, 'formats', 'hymn.yaml'),
                readFileSync(join(presetRoot, 'formats', 'song.yaml'), 'utf8').replace(/name: song/, 'name: hymn'),
            );

            const drift = await checkPresetIndex({ root: presetRoot, readmePath });
            expect(drift.ok).toBe(false);
            expect(drift.expected).toContain('| `hymn` |');

            const synced = splicePresetIndex(drift.actual, drift.expected);
            expect(synced).toContain('| `hymn` |');
            // Idempotent: regenerating from the synced README changes nothing.
            expect(splicePresetIndex(synced, drift.expected)).toBe(synced);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('splicing without the markers is a hard error, never a silent append', () => {
        expect(() => splicePresetIndex('# no markers here\n', 'block')).toThrow(/preset-index markers/);
    });
});

describe('AC1–AC3 — the shipped data resolves without a workflow preset', () => {
    test('every format × theme pair resolves and renders', () => {
        for (const format of SHIPPED_FORMATS) {
            for (const theme of SHIPPED_THEMES) {
                const job = resolveNamedJob(brief({ format, theme, title: `${format} × ${theme}` }), shipped);
                const request = renderGenerateRequest(job);
                expect(request.prompt.length).toBeGreaterThan(0);
                expect(request.model).toBe(format === 'clip' || format === 'loop' ? 'clip' : 'pro');
                expect(job.structure.value.length).toBeGreaterThan(0);
                // The prompt carries the theme prose and the format skeleton, never an instance-owned segment.
                expect(request.prompt.toLowerCase()).toContain((shipped.themes.get(theme)?.genre ?? '').toLowerCase());
                expect(request.prompt).not.toContain('Lyrics (sing in');
                expect(request.prompt).not.toContain('Total running time');
            }
        }
    });

    test('resolveJob still rejects a hand-built preset set that supplies no direction', () => {
        expect(() =>
            resolveJob(brief({ theme: 'lofi', format: 'song', style: undefined }), {
                format: { name: 'song', model: 'pro', duration_target: '2:30' },
            }),
        ).toThrow(/style is unresolved/);
    });
});

/** Silence a CLI's stdout/stderr while a test drives it in-process. */
async function quiet<T>(run: () => Promise<T>): Promise<T> {
    const log = console.log;
    const error = console.error;
    console.log = () => undefined;
    console.error = () => undefined;
    try {
        return await run();
    } finally {
        console.log = log;
        console.error = error;
    }
}

/** A throwaway preset root holding the two portable control fixtures. */
function scratchRoot(prefix: string): { dir: string; presets: string; readme: string } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const presets = join(dir, 'presets');
    mkdirSync(join(presets, 'formats'), { recursive: true });
    mkdirSync(join(presets, 'themes'), { recursive: true });
    cpSync(join(INVALID_ROOT, 'formats', 'valid-song.yaml'), join(presets, 'formats', 'valid-song.yaml'));
    cpSync(join(INVALID_ROOT, 'themes', 'valid-lofi.yaml'), join(presets, 'themes', 'valid-lofi.yaml'));
    const readme = join(dir, 'README.md');
    cpSync(README_PATH, readme);
    return { dir, presets, readme };
}

describe('R5 — the index generator CLI rewrites, checks and fails loudly', () => {
    test('write mode syncs a stale README, then reports it unchanged', async () => {
        const { dir, presets, readme } = scratchRoot('kk-music-index-cli-');
        try {
            writeFileSync(
                join(presets, 'formats', 'hymn.yaml'),
                readFileSync(join(presets, 'formats', 'valid-song.yaml'), 'utf8').replace(
                    /name: valid-song/,
                    'name: hymn',
                ),
            );
            expect(await quiet(() => presetIndexMain([], { root: presets, readmePath: readme }))).toBe(0);
            expect(readFileSync(readme, 'utf8')).toContain('| `hymn` |');
            expect(await quiet(() => presetIndexMain([], { root: presets, readmePath: readme }))).toBe(0);
            expect(await quiet(() => presetIndexMain(['--check'], { root: presets, readmePath: readme }))).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('check mode exits 1 on drift and prints the differing line', async () => {
        const { dir, presets, readme } = scratchRoot('kk-music-index-drift-');
        try {
            writeFileSync(readme, readFileSync(readme, 'utf8').replace('`valid-song`', '`drifted-row`'));
            expect(await quiet(() => presetIndexMain(['--check'], { root: presets, readmePath: readme }))).toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an invalid preset root exits 2 and a markerless README throws', async () => {
        expect(await quiet(() => presetIndexMain(['--check'], { root: INVALID_ROOT }))).toBe(2);
        const { dir, presets, readme } = scratchRoot('kk-music-index-bare-');
        try {
            writeFileSync(readme, '# no markers at all\n');
            let thrown: Error | undefined;
            try {
                await quiet(() => presetIndexMain([], { root: presets, readmePath: readme }));
            } catch (error) {
                thrown = error as Error;
            }
            expect(thrown?.message).toContain('preset-index markers');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('R3 — the resolve-preset CLI prints the trace and maps failures to exit codes', () => {
    test('a resolved brief prints the trace and the request, exit 0', async () => {
        const { dir, presets } = scratchRoot('kk-music-resolve-');
        try {
            const briefPath = join(dir, 'brief.yaml');
            writeFileSync(briefPath, 'title: Probe\nformat: valid-song\ntheme: valid-lofi\n');
            expect(await quiet(() => resolvePresetMain(['--in', briefPath, '--root', presets, '--json']))).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('usage, an unparseable brief, an unknown name and an invalid root all exit non-zero', async () => {
        const { dir, presets } = scratchRoot('kk-music-resolve-fail-');
        try {
            const unknown = join(dir, 'unknown.yaml');
            writeFileSync(unknown, 'title: Probe\nformat: valid-song\ntheme: corporate-tech\nstyle: Probe.\n');
            const broken = join(dir, 'broken.yaml');
            writeFileSync(broken, '- not\n- a mapping\n');
            expect(await quiet(() => resolvePresetMain([]))).toBe(1);
            expect(await quiet(() => resolvePresetMain(['--in', broken, '--root', presets]))).toBe(1);
            expect(await quiet(() => resolvePresetMain(['--in', unknown, '--root', presets]))).toBe(1);
            expect(await quiet(() => resolvePresetMain(['--in', unknown, '--root', INVALID_ROOT]))).toBe(2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
