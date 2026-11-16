/**
 * Preset sample gallery (task 0340): render one sample per shipped format × style
 * pair into assets/sample/ and regenerate README.md as the index over them.
 *
 * Usage (run from the repo root so `kk` resolves this checkout's plugin):
 *   bun plugins/generations/image-gen/scripts/gen-samples.ts                 # render missing pairs + README
 *   bun plugins/generations/image-gen/scripts/gen-samples.ts --force         # re-render every pair
 *   bun plugins/generations/image-gen/scripts/gen-samples.ts --readme-only   # README from samples on disk
 *   bun plugins/generations/image-gen/scripts/gen-samples.ts --provider gemini --model <m>
 *   bun plugins/generations/image-gen/scripts/gen-samples.ts --provider google --concurrency 1
 * Provider/model defaults come from the provider registry. assets/sample/provenance.json records
 * the actual provider/model for every thumbnail, so mixed-provider galleries remain truthful.
 *
 * Only the builtin presets/ root is read — user/project preset roots never leak
 * into the shipped index. A finished sample is never overwritten without --force,
 * so a run that dies on pair 37 resumes from pair 37. Failed pairs are named and
 * the script exits 1.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type FormatPreset, FormatPresetSchema, type StylePreset, StylePresetSchema } from '../src/presets';
import { PROVIDERS } from '../src/providers/types';

const PLUGIN_DIR = join(import.meta.dir, '..');
const SAMPLE_DIR = join(PLUGIN_DIR, 'assets', 'sample');
const README = join(PLUGIN_DIR, 'README.md');
const WORK_DIR = join(process.cwd(), '.works', 'tmp', 'test-samples');
const THUMB_PX = 640;
const PROVENANCE_PATH = join(SAMPLE_DIR, 'provenance.json');

interface SampleOrigin {
    provider: string;
    model: string;
}

const provenance: Record<string, SampleOrigin> = existsSync(PROVENANCE_PATH)
    ? (JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8')) as Record<string, SampleOrigin>)
    : {};

function saveProvenance(): void {
    mkdirSync(SAMPLE_DIR, { recursive: true });
    writeFileSync(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 4)}\n`);
}

/** Existing K1 samples predate the sidecar and were all MiniMax image-01 (task 0340). */
function originFor(file: string): SampleOrigin {
    return provenance[file] ?? { provider: 'minimax', model: 'image-01' };
}

/** Fixed per-job inputs so every style is compared on the same subject. */
const SAMPLE_SUBJECT = 'a request flowing through an API gateway to three microservices';
const COVER_VARS = {
    title: 'Building Reliable AI Agents',
    subtitle: 'Patterns for production',
    topics: 'AI agents',
};

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string, fallback: string): string => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const provider = option('--provider', 'minimax');
const registration = PROVIDERS[provider];
if (registration === undefined) {
    throw new Error(`Unknown provider '${provider}'. Valid providers: ${Object.keys(PROVIDERS).sort().join(', ')}`);
}
const model = option('--model', registration.defaultModel);
const concurrency = Number(option('--concurrency', '3'));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('--concurrency must be an integer from 1 to 10');
}

function loadBuiltin<T>(axis: string, schema: { parse(value: unknown): T }): T[] {
    const dir = join(PLUGIN_DIR, 'presets', axis);
    return readdirSync(dir)
        .filter((entry) => entry.endsWith('.yaml'))
        .sort()
        .map((entry) => schema.parse(Bun.YAML.parse(readFileSync(join(dir, entry), 'utf8'))));
}

const formats = loadBuiltin<FormatPreset>('formats', FormatPresetSchema);
const styles = loadBuiltin<StylePreset>('styles', StylePresetSchema);
const sampleName = (format: string, style: string): string => `${format}__${style}.jpg`;

/** The Doc envelope that drives one pair through the real executor. */
function envelope(format: FormatPreset, style: StylePreset): unknown[] {
    const imageGen: Record<string, unknown> = {
        job: format.job,
        format: format.name,
        style: style.name,
        provider,
        model,
    };
    const doc: Record<string, unknown> = { id: `${format.name}__${style.name}`, title: COVER_VARS.title, body: '' };
    if (format.job === 'cover') {
        imageGen.vars = COVER_VARS;
    } else if (format.job === 'illustration') {
        // The anchor must occur exactly once in the body (index.ts assertAnchorPlan).
        doc.body = `Every call enters at the edge: ${SAMPLE_SUBJECT}.`;
        doc.metadata = { positions: [SAMPLE_SUBJECT] };
    } else if (format.compose !== undefined) {
        imageGen.vars = { subject: SAMPLE_SUBJECT, headline: 'API 网关', points: '统一入口\n鉴权限流\n路由转发' };
    } else {
        imageGen.vars = { subject: SAMPLE_SUBJECT };
    }
    doc.metadata = { ...((doc.metadata as object) ?? {}), imageGen: { ...imageGen, maxImages: 1 } };
    return [doc];
}

async function render(format: FormatPreset, style: StylePreset): Promise<void> {
    const stem = `${format.name}__${style.name}`;
    const dir = join(WORK_DIR, stem);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const input = join(dir, 'in.json');
    const output = join(dir, 'out.json');
    await Bun.write(input, JSON.stringify(envelope(format, style)));
    const run = Bun.spawn(['kk', 'executor', 'run', 'image-gen', '--in', input, '--out', output], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([run.exited, new Response(run.stderr).text()]);
    if (code !== 0) {
        throw new Error(`kk exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
    }
    const content = (await Bun.file(output).json()) as {
        metadata?: { images?: Array<{ path?: string; provider?: string; model?: string }> };
    };
    const artifact = content.metadata?.images?.[0];
    const image = artifact?.path;
    if (image === undefined) {
        throw new Error('executor output carries no metadata.images[0].path');
    }
    const source = image.startsWith('/') ? image : join(dir, image);
    // ponytail: macOS sips does the downscale (no image dep in the repo); add sharp if this must run on Linux.
    const sips = Bun.spawnSync([
        'sips',
        '-Z',
        String(THUMB_PX),
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '80',
        source,
        '--out',
        join(SAMPLE_DIR, sampleName(format.name, style.name)),
    ]);
    if (sips.exitCode !== 0) {
        throw new Error(`sips failed: ${sips.stderr.toString().trim()}`);
    }
    provenance[sampleName(format.name, style.name)] = {
        provider: artifact?.provider ?? provider,
        model: artifact?.model ?? model,
    };
    saveProvenance();
}

async function renderAll(): Promise<string[]> {
    mkdirSync(SAMPLE_DIR, { recursive: true });
    const queue = formats.flatMap((format) =>
        styles
            .filter((style) => flag('--force') || !existsSync(join(SAMPLE_DIR, sampleName(format.name, style.name))))
            .map((style) => ({ format, style })),
    );
    console.log(`${queue.length} of ${formats.length * styles.length} pairs to render via ${provider}/${model}`);
    const failed: string[] = [];
    const worker = async (): Promise<void> => {
        for (let pair = queue.shift(); pair !== undefined; pair = queue.shift()) {
            const name = `${pair.format.name} × ${pair.style.name}`;
            try {
                await render(pair.format, pair.style);
                console.log(`ok   ${name}`);
            } catch (error) {
                failed.push(name);
                console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`);
            }
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return failed;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

function readme(): string {
    const lines = [
        '# image-gen',
        '',
        'Image generation plugin (`kind: generator`): `free`, `cover` and `illustration` jobs over the',
        '`Doc[] → Content` contract. Every image is one **format** (canvas, template, job) composed with one',
        '**style** (visual modifiers); any format pairs with any style.',
        '',
        'This page is the preset index: one sample per shipped format × style pair, so you can pick a',
        'combination by eye. Pass the pair as `metadata.imageGen.format` / `metadata.imageGen.style`, or',
        "`--format` / `--style` to the `kk:image-generate` skill. Omitting the style uses the format's",
        'default (★ below).',
        '',
        `Samples: provider/model shown per cell, downscaled to ${THUMB_PX}px JPEG. Inputs are fixed per`,
        `job — subject “${SAMPLE_SUBJECT}”; cover title “${COVER_VARS.title}”. Regenerate with`,
        '`bun plugins/generations/image-gen/scripts/gen-samples.ts` (see its header for flags).',
        '',
        '## Formats',
        '',
        '| Format | Job | Aspect | Size | Default style | Description |',
        '| --- | --- | --- | --- | --- | --- |',
        ...formats.map(
            (f) =>
                `| [\`${f.name}\`](#format-${f.name}) | ${f.job} | ${f.aspectRatio} | ${f.width ?? '?'}×${f.height ?? '?'} | ${f.defaultStyle} | ${oneLine(f.description)} |`,
        ),
        '',
        '## Styles',
        '',
        '| Style | Description | Best for |',
        '| --- | --- | --- |',
        ...styles.map((s) => `| \`${s.name}\` | ${oneLine(s.description)} | ${oneLine(s.bestFor ?? '')} |`),
        '',
        '## Gallery',
    ];
    const columns = 3;
    for (const format of formats) {
        lines.push('', `<a id="format-${format.name}"></a>`, '', `### ${format.name}`, '');
        lines.push(`${format.job} job · ${format.aspectRatio} · default style \`${format.defaultStyle}\``, '');
        lines.push(`|${' |'.repeat(columns)}`, `|${' --- |'.repeat(columns)}`);
        for (let i = 0; i < styles.length; i += columns) {
            const cells = styles.slice(i, i + columns).map((style) => {
                const file = sampleName(format.name, style.name);
                const label = `\`${style.name}\`${style.name === format.defaultStyle ? ' ★' : ''}`;
                const origin = originFor(file);
                return existsSync(join(SAMPLE_DIR, file))
                    ? `<img src="assets/sample/${file}" alt="${format.name} × ${style.name}" width="260"><br>${label}<br><small>${origin.provider}/${origin.model}</small>`
                    : `_not rendered_<br>${label}`;
            });
            lines.push(`| ${cells.join(' | ')} |`);
        }
    }
    return `${lines.join('\n')}\n`;
}

const failed = flag('--readme-only') ? [] : await renderAll();
for (const format of formats) {
    for (const style of styles) {
        const file = sampleName(format.name, style.name);
        if (existsSync(join(SAMPLE_DIR, file)) && provenance[file] === undefined) {
            provenance[file] = originFor(file);
        }
    }
}
saveProvenance();
await Bun.write(README, readme());
console.log(`wrote ${README}`);
if (failed.length > 0) {
    console.error(`${failed.length} pair(s) failed — rerun to retry only those:\n  ${failed.join('\n  ')}`);
    process.exit(1);
}
