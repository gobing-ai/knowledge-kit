import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { logger } from '@gobing-ai/utils';
import { type Content, ContentSchema } from './schemas';

/**
 * Render a {@link Content} object to the research-report markdown shape. Pure:
 * does no IO, ignores `metadata` and `format`.
 *
 * Frozen template (task 0058):
 *   1. heading = `title` trimmed, else `Untitled`.
 *   2. lead = `# <heading>\n\n`, unless `body` already starts with `# <heading>`
 *      (then `''` — no second H1).
 *   3. outline block = `\n\n## Outline\n\n<outline>` when `outline` is non-empty after trim.
 *   4. references block = `\n\n## References\n\n` + one `- <label>` line per item,
 *      with an optional ` (<cite>)` suffix.
 *   5. Result = `lead + body + outlineBlock + refsBlock` with a single trailing newline.
 */
export function renderContentMarkdown(content: Content): string {
    const heading = content.title?.trim() || 'Untitled';
    const startsWithHeading = content.body.startsWith(`# ${heading}`);
    const lead = startsWithHeading ? '' : `# ${heading}\n\n`;
    const outlineBlock =
        content.outline && content.outline.trim().length > 0 ? `\n\n## Outline\n\n${content.outline.trim()}` : '';
    const refsBlock = renderReferences(content.references);
    return `${lead}${content.body}${outlineBlock}${refsBlock}\n`;
}

function renderReferences(references: Content['references']): string {
    if (!references || references.length === 0) {
        return '';
    }
    const lines: string[] = [];
    for (const ref of references) {
        const label = renderReferenceLabel(ref);
        if (label === '') {
            continue;
        }
        lines.push(`- ${label}`);
    }
    if (lines.length === 0) {
        return '';
    }
    return `\n\n## References\n\n${lines.join('\n')}`;
}

function renderReferenceLabel(ref: { url?: string; title?: string; cite?: string }): string {
    const { url, title, cite } = ref;
    const titleT = title?.trim() ?? '';
    const urlT = url?.trim() ?? '';
    const citeT = cite?.trim() ?? '';
    let label: string;
    if (titleT !== '' && urlT !== '') {
        label = `[${titleT}](${urlT})`;
    } else if (titleT !== '') {
        label = titleT;
    } else if (urlT !== '') {
        label = urlT;
    } else if (citeT !== '') {
        label = `\`${citeT}\``;
    } else {
        return '';
    }
    if (citeT !== '' && label !== `\`${citeT}\``) {
        label = `${label} (${citeT})`;
    }
    return label;
}

/**
 * Read `content.json` from `inPath`, validate against `ContentSchema`, and write
 * the rendered markdown to `outPath`. Throws on invalid JSON / schema failure, so
 * the caller decides whether to write `--out`.
 */
export async function renderContentMarkdownFile(inPath: string, outPath: string): Promise<void> {
    const raw = await readFile(inPath, 'utf-8');
    const content = ContentSchema.parse(JSON.parse(raw));
    await writeFile(outPath, renderContentMarkdown(content), 'utf-8');
}

/** CLI entry: parse `--in`/`--out`, render, report via logger; returns exit code. */
export async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        logger.error('Error: Missing required arguments --in and --out');
        return 1;
    }
    try {
        await renderContentMarkdownFile(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        logger.error(`render-md failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exitCode = await main();
}
