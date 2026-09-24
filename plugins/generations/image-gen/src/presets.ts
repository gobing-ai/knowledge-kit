import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';

/**
 * Image preset contract (task 0102): the format × style preset schemas, the
 * frozen prompt-composition rule (R2), and multi-root resolution with
 * shadowing (R4), mirroring ADR-012's plugin discovery
 * (`docs/design/multi-root-plugin-discovery.md`).
 */

/** One colour entry in a structured (baoyu-style) palette. */
export interface PaletteEntry {
    role: string;
    name: string;
    hex: string;
}

/** Provenance of a style preset; 0105 populates it after extraction. */
export interface PresetSource {
    kind: 'authored' | 'extracted';
    refImages?: string[];
    extractedAt?: string;
    confidence?: 'high' | 'medium' | 'low';
}

/** One declared template variable: caller-facing description plus default. */
export interface FormatVariable {
    description: string;
    default: string;
}

/** R1 — `formats/<name>.yaml`: the job skeleton (template, keywords, variables). */
export interface FormatPreset {
    /** Filename stem must equal this. */
    name: string;
    description: string;
    /** Which plugin job branch this format drives (0104). */
    job: 'free' | 'cover' | 'illustration';
    /** Portable primary dimension; width/height are the optional exact pixels. */
    aspectRatio: string;
    width?: number;
    height?: number;
    /** Style used when the caller names none. */
    defaultStyle: string;
    /** Quality/composition tail, joined with ', '. */
    keywords: string[];
    /** Same placeholder grammar as the template, e.g. '{{title | cover}}.png'. */
    outputFilename: string;
    variables: Record<string, FormatVariable>;
    /** Prompt body; YAML block scalar, embedded newlines preserved. */
    template: string;
}

/** R1 — `styles/<name>.yaml`; `modifiers` is the only required prompt field. */
export interface StylePreset {
    name: string;
    description: string;
    modifiers: string;
    palette?: PaletteEntry[];
    typography?: string;
    visualElements?: string[];
    bestFor?: string;
    /** Provider negative prompt when supported, else appended as 'avoid: …'. */
    negative?: string;
    source?: PresetSource;
}

const PaletteEntrySchema = z.object({ role: z.string(), name: z.string(), hex: z.string() });

const PresetSourceSchema = z.object({
    kind: z.enum(['authored', 'extracted']),
    refImages: z.array(z.string()).optional(),
    extractedAt: z.string().optional(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
});

/** Parse gate for `formats/<name>.yaml`. */
export const FormatPresetSchema = z.object({
    name: z.string(),
    description: z.string(),
    job: z.enum(['free', 'cover', 'illustration']),
    aspectRatio: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    defaultStyle: z.string(),
    keywords: z.array(z.string()),
    outputFilename: z.string(),
    variables: z.record(z.string(), z.object({ description: z.string(), default: z.string() })),
    template: z.string(),
});

/** Parse gate for `styles/<name>.yaml`. */
export const StylePresetSchema = z.object({
    name: z.string(),
    description: z.string(),
    modifiers: z.string(),
    palette: z.array(PaletteEntrySchema).optional(),
    typography: z.string().optional(),
    visualElements: z.array(z.string()).optional(),
    bestFor: z.string().optional(),
    negative: z.string().optional(),
    source: PresetSourceSchema.optional(),
});

/**
 * Merge caller vars over the format's declared defaults; the caller wins.
 */
export function mergeVars(
    declared: Record<string, FormatVariable>,
    vars: Record<string, string>,
): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const [name, def] of Object.entries(declared)) {
        merged[name] = def.default;
    }
    for (const [name, value] of Object.entries(vars)) {
        merged[name] = value;
    }
    return merged;
}

/**
 * Match one `{{ … }}` expression with brace-depth counting, so a fallback
 * that itself contains a placeholder survives whole. wt's `[^}]+` regex
 * truncates at the first inner `}` (`{{subtitle | , subtitled
 * "{{subtitle}}"}}` lost its tail); the R6 golden prompt pins that form as
 * rendering correctly, so the port must balance the braces.
 */
function matchPlaceholder(template: string, start: number): { expr: string; end: number } | undefined {
    let depth = 1;
    for (let i = start + 2; i < template.length; i++) {
        if (template.startsWith('{{', i)) {
            depth++;
            i++;
        } else if (template.startsWith('}}', i)) {
            depth--;
            if (depth === 0) {
                return { expr: template.slice(start + 2, i), end: i + 2 };
            }
            i++;
        }
    }
    return undefined;
}

/**
 * Resolve one expression against the merged vars. An empty value (including
 * a caller-passed '') resolves to the fallback; an unknown placeholder with
 * no fallback throws, naming the placeholder and the format — wt silently
 * left it in place, and a literal `{{title}}` must not reach a paid provider.
 * Leading trim on the fallback skips the `| ` separator; its trailing space
 * is preserved (the R6 golden prompt pins it). Single pass: a fallback is
 * emitted literally and never re-scanned, like wt's `re.sub`.
 */
function resolvePlaceholder(expr: string, vars: Record<string, string>, formatName: string): string {
    const pipe = expr.indexOf('|');
    if (pipe !== -1) {
        const name = expr.slice(0, pipe).trim();
        const fallback = expr.slice(pipe + 1).trimStart();
        const value = vars[name];
        if (!value) {
            return fallback;
        }
        // A fallback that embeds its own '{{name}}' slot is a mini-template
        // wrapping the value (the R6 golden's ', subtitled "…"' form); a
        // plain-text fallback is just the default, so the value wins.
        return fallback.includes(`{{${name}}}`) ? fallback.split(`{{${name}}}`).join(value) : value;
    }
    const name = expr.trim();
    const value = vars[name];
    if (value === undefined) {
        throw new Error(`Format "${formatName}": placeholder {{${name}}} has no value and no fallback`);
    }
    return value;
}

/**
 * Render `{{name}}` / `{{name | fallback}}` (wt's two-form grammar,
 * `template_engine.py` `_substitute_variables`).
 */
export function renderTemplate(template: string, vars: Record<string, string>, formatName: string): string {
    let rendered = '';
    let cursor = 0;
    while (cursor < template.length) {
        const start = template.indexOf('{{', cursor);
        if (start === -1) {
            rendered += template.slice(cursor);
            break;
        }
        const match = matchPlaceholder(template, start);
        if (match === undefined) {
            rendered += template.slice(cursor, start + 2);
            cursor = start + 2;
            continue;
        }
        rendered += template.slice(cursor, start);
        rendered += resolvePlaceholder(match.expr, vars, formatName);
        cursor = match.end;
    }
    return rendered;
}

/**
 * R2 — the frozen composition rule, wt's order as built
 * (`template_engine.py:174-190`): rendered body → keywords → style modifiers
 * → caller extra, empty segments dropped. Keeping wt's order makes the ported
 * presets render byte-identically to their wt originals; the extra segment is
 * the only addition (0105's ref-derived traits land there).
 */
export function composePrompt(
    format: FormatPreset,
    style: StylePreset,
    vars: Record<string, string>,
    extra?: string,
): string {
    const body = renderTemplate(format.template, mergeVars(format.variables, vars), format.name);
    return [body, format.keywords.join(', '), style.modifiers, extra].filter(Boolean).join(', ');
}

/** Discovery diagnostic, mirroring kk-core's `DiscoveryDiagnostic` shape. */
export interface PresetDiagnostic {
    code: 'shadowed' | 'invalid';
    path: string;
    reason: string;
}

export interface LoadedPresets {
    formats: Map<string, FormatPreset>;
    styles: Map<string, StylePreset>;
    diagnostics: PresetDiagnostic[];
}

// File IO goes through the ts-runtime FileSystem seam (rule no-direct-fs-io). The
// node backend uses sync fs APIs by default (file-system-node.d.ts); the interface
// unions Promise for CF stubs, so pin the sync shape once here.
const fs = createNodeFileSystem() as unknown as {
    exists(path: string): boolean;
    readFile(path: string): string;
    readDir(path: string): string[];
    stat(path: string): { isDirectory(): boolean } | null;
};

function isDirectory(path: string): boolean {
    return fs.stat(path)?.isDirectory() ?? false;
}

/**
 * R4 — preset roots, low → high, mirroring ADR-012's plugin roots
 * (`docs/design/multi-root-plugin-discovery.md`): builtin → user → project →
 * each `KK_IMAGE_PRESET_PATH` entry (colon-separated, left → right). The
 * project root resolves against KNOWLEDGE_KIT_PROJECT_ROOT, not cwd, because
 * plugins are spawned with cwd set to their own package dir
 * (`apps/cli/src/invoke.ts`).
 */
export function resolvePresetRoots(): string[] {
    const roots: string[] = [join(import.meta.dir, '..', 'presets')];
    // process.env.HOME directly: Bun snapshots os.homedir() at startup, so a
    // runtime HOME override (tests) would be invisible through homedir().
    const userRoot = join(process.env.HOME ?? homedir(), '.config', 'kk', 'image-presets');
    if (isDirectory(userRoot)) {
        roots.push(userRoot);
    }
    const projectRoot = join(process.env.KNOWLEDGE_KIT_PROJECT_ROOT ?? process.cwd(), '.kk', 'image-presets');
    if (isDirectory(projectRoot)) {
        roots.push(projectRoot);
    }
    for (const entry of process.env.KK_IMAGE_PRESET_PATH?.split(delimiter).filter((p) => p !== '') ?? []) {
        if (entry !== '' && isDirectory(entry)) {
            roots.push(entry);
        }
    }
    return roots;
}

/** Minimal structural shape of a Zod schema, so the loader stays generic. */
interface SchemaLike<T extends { name: string }> {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: Error };
}

/**
 * Load one axis (`formats/` or `styles/`) from one root. A file that fails its
 * schema parse (or YAML parse) is skipped with an `invalid` diagnostic, never
 * fatal; a name already loaded from a lower root is replaced wholesale with a
 * `shadowed` diagnostic naming the losing file — no field merging, because a
 * half-overridden preset cannot be reproduced from its file alone.
 */
function loadAxis<T extends { name: string }>(
    dir: string,
    byName: Map<string, T>,
    pathsByName: Map<string, string>,
    schema: SchemaLike<T>,
    diagnostics: PresetDiagnostic[],
): void {
    if (!isDirectory(dir)) {
        return;
    }
    for (const entry of fs.readDir(dir).sort()) {
        if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
            continue;
        }
        const path = join(dir, entry);
        let parsed: unknown;
        try {
            parsed = Bun.YAML.parse(fs.readFile(path));
        } catch (error) {
            diagnostics.push({ code: 'invalid', path, reason: `unreadable or unparseable: ${error}` });
            continue;
        }
        const result = schema.safeParse(parsed);
        if (!result.success) {
            diagnostics.push({ code: 'invalid', path, reason: result.error.message });
            continue;
        }
        const previousPath = pathsByName.get(result.data.name);
        if (previousPath !== undefined) {
            diagnostics.push({
                code: 'shadowed',
                path: previousPath,
                reason: `Preset "${result.data.name}" shadowed by ${path}`,
            });
        }
        byName.set(result.data.name, result.data);
        pathsByName.set(result.data.name, path);
    }
}

/**
 * R4 — load formats and styles across all resolved roots; a later root
 * shadows an earlier one by preset name within each axis.
 */
export function loadPresets(): LoadedPresets {
    const diagnostics: PresetDiagnostic[] = [];
    const formats = new Map<string, FormatPreset>();
    const styles = new Map<string, StylePreset>();
    const formatPaths = new Map<string, string>();
    const stylePaths = new Map<string, string>();
    for (const root of resolvePresetRoots()) {
        loadAxis(join(root, 'formats'), formats, formatPaths, FormatPresetSchema, diagnostics);
        loadAxis(join(root, 'styles'), styles, stylePaths, StylePresetSchema, diagnostics);
    }
    return { formats, styles, diagnostics };
}
