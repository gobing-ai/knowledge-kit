/**
 * Preset index generator (task 0399 R5). Renders the format + theme inventory
 * into `README.md` between the `<!-- preset-index:start -->` and
 * `<!-- preset-index:end -->` markers, so the index cannot drift from the data
 * files: `--check` fails when the README no longer equals the presets.
 *
 *   bun plugins/generations/music-gen/scripts/gen-preset-index.ts            # rewrite the block
 *   bun plugins/generations/music-gen/scripts/gen-preset-index.ts --check     # exit 1 on drift
 *   bun run --cwd plugins/generations/music-gen gen:preset-index
 *
 * Only the shipped `presets/` root is read — a user or project preset root must
 * never leak into the published index (image-gen's `gen-samples.ts` precedent).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LoadedMusicPresets, loadMusicPresets, PresetDataError } from '../src/presets';

export const PLUGIN_DIR = join(import.meta.dir, '..');
export const README_PATH = join(PLUGIN_DIR, 'README.md');

/** Markers the generated block lives between. */
export const INDEX_START = '<!-- preset-index:start -->';
export const INDEX_END = '<!-- preset-index:end -->';

/** A duration cell for a format that has no target (clip is fixed at about 0:30). */
const NO_DURATION = '— (clip is fixed at ~0:30)';

/** Make a value safe inside a markdown table cell. */
function cell(value: string): string {
    return value
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, ' ')
        .trim();
}

/** One row per shipped format, sorted by name. */
function formatRows(presets: LoadedMusicPresets): string[] {
    return [...presets.formats.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((preset) => {
            const duration = preset.duration_target === undefined ? NO_DURATION : `\`${preset.duration_target}\``;
            return `| \`${preset.name}\` | \`${preset.model}\` | ${duration} | ${preset.lyrics_policy} | ${cell(preset.intended_use)} | \`${preset.provenance.status}\` |`;
        });
}

/** One row per shipped theme, sorted by name. */
function themeRows(presets: LoadedMusicPresets): string[] {
    return [...presets.themes.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((preset) => {
            const direction = `${preset.genre}; ${preset.tempo}; ${preset.key}`;
            return `| \`${preset.name}\` | ${cell(direction)} | ${cell(preset.avoid.join(', '))} | ${cell(preset.intended_use)} | \`${preset.provenance.status}\` |`;
        });
}

/** The full generated block, with a marker-free trailing newline. */
export function renderPresetIndex(presets: LoadedMusicPresets): string {
    return [
        `\`formats/\`: ${String(presets.formats.size)} · \`themes/\`: ${String(presets.themes.size)}. Regenerate with`,
        '`bun plugins/generations/music-gen/scripts/gen-preset-index.ts`; `--check` fails on drift.',
        '',
        '### Formats',
        '',
        'A format fixes the job intent, the instance selector (`pro|clip`), the default duration target and the',
        'timestamped section skeleton. `lyrics` is the format’s policy: `forbidden` resolves `instrumental: true`.',
        '',
        '| Format | Model | Default duration | Lyrics | Intended use | Status |',
        '| --- | --- | --- | --- | --- | --- |',
        ...formatRows(presets),
        '',
        '### Themes',
        '',
        'A theme supplies the technical-direction prose the model reads — genre, tempo, key, instrumentation,',
        'vocal character and production — plus its default `avoid[]`, rendered as one `Avoid: …` segment.',
        '',
        '| Theme | Technical direction | Default avoid | Intended use | Status |',
        '| --- | --- | --- | --- | --- |',
        ...themeRows(presets),
    ].join('\n');
}

/** Replace the block between the markers; a missing marker is a hard error, never a silent append. */
export function splicePresetIndex(readme: string, block: string): string {
    const start = readme.indexOf(INDEX_START);
    const end = readme.indexOf(INDEX_END);
    if (start === -1 || end === -1 || end < start) {
        throw new Error(`README is missing the ${INDEX_START} / ${INDEX_END} preset-index markers`);
    }
    return `${readme.slice(0, start + INDEX_START.length)}\n${block}\n${readme.slice(end)}`;
}

export interface PresetIndexOptions {
    /** Preset root override (tests and probes use a throwaway tree). */
    root?: string;
    /** README path override, so a test never rewrites the shipped index by accident. */
    readmePath?: string;
}

export interface PresetIndexCheck {
    ok: boolean;
    /** What the README must contain once the generator has run. */
    expected: string;
    /** What the README contains now. */
    actual: string;
}

/** Compare the README block against the shipped presets (AC5). */
export async function checkPresetIndex(options: PresetIndexOptions = {}): Promise<PresetIndexCheck> {
    const presets = await loadMusicPresets(options.root === undefined ? {} : { root: options.root });
    const readmePath = options.readmePath ?? README_PATH;
    const actual = readFileSync(readmePath, 'utf8');
    return {
        ok: splicePresetIndex(actual, renderPresetIndex(presets)) === actual,
        expected: renderPresetIndex(presets),
        actual,
    };
}

/** Print the first differing line pair, so a drift report points at the row that changed. */
function driftReport(result: PresetIndexCheck): string[] {
    const wanted = splicePresetIndex(result.actual, result.expected).split('\n');
    const have = result.actual.split('\n');
    const lines: string[] = [];
    const length = Math.max(wanted.length, have.length);
    for (let index = 0; index < length; index += 1) {
        if (wanted[index] !== have[index]) {
            lines.push(`  line ${String(index + 1)}`);
            lines.push(`  - ${have[index] ?? '(missing)'}`);
            lines.push(`  + ${wanted[index] ?? '(missing)'}`);
            if (lines.length >= 9) {
                break;
            }
        }
    }
    return lines;
}

export async function main(argv: readonly string[], options: PresetIndexOptions = {}): Promise<number> {
    const check = argv.includes('--check');
    const readmePath = options.readmePath ?? README_PATH;
    try {
        if (check) {
            const result = await checkPresetIndex(options);
            if (result.ok) {
                console.log('preset-index: README matches the shipped presets');
                return 0;
            }
            console.error(
                'preset-index: README drift — run `bun run --cwd plugins/generations/music-gen gen:preset-index`',
            );
            for (const line of driftReport(result)) {
                console.error(line);
            }
            return 1;
        }
        const presets = await loadMusicPresets(options.root === undefined ? {} : { root: options.root });
        const readme = readFileSync(readmePath, 'utf8');
        const next = splicePresetIndex(readme, renderPresetIndex(presets));
        if (next === readme) {
            console.log(
                `preset-index: unchanged (${String(presets.formats.size)} formats, ${String(presets.themes.size)} themes)`,
            );
            return 0;
        }
        writeFileSync(readmePath, next);
        console.log(
            `preset-index: wrote ${String(presets.formats.size)} formats and ${String(presets.themes.size)} themes into README.md`,
        );
        return 0;
    } catch (error) {
        if (error instanceof PresetDataError) {
            console.error(error.message);
            return error.exitCode;
        }
        throw error;
    }
}

if (import.meta.main) {
    process.exit(await main(process.argv.slice(2)));
}
