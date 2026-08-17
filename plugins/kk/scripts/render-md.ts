/**
 * Shipped no-checkout runner for the Content→markdown research-report helper.
 * 0059's `render` state shells: `bun <this script> --in <content.json> --out <content.md>`.
 *
 * Self-contained by design: end users install the published `kk` package and cannot
 * resolve `@gobing-ai/kk-core` (private). The render logic below is a COPY of
 * `packages/kk-core/src/render-md.ts`; keep them byte-identical for the same Content.
 *
 * NODE-BUILTIN-ONLY — no workspace or `@gobing-ai/*` imports, and therefore raw
 * `console.error` rather than the ts-utils output seam. This script ships to arbitrary
 * user projects and is shelled as `bun <this script>`; an `@gobing-ai/*` import resolves
 * there only because bun auto-installs it from the network, so it fails under
 * `bun --no-install`, offline, or in an air-gapped environment. Enforced by
 * `shipped-script-isolation` in `.spur/rules/boundary/`.
 *
 * SYNC: packages/kk-core/src/render-md.ts (renderContentMarkdown + helpers)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

interface Ref {
    url?: string;
    title?: string;
    cite?: string;
}

interface ContentInput {
    body: string;
    title?: string;
    outline?: string;
    references?: Ref[];
}

/** Mirror of `ContentSchema` structural requirements for the fields this render touches. */
function parseContent(raw: string): ContentInput {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('content must be an object');
    }
    const c = value as Record<string, unknown>;
    if (typeof c.body !== 'string') {
        throw new Error('body is required and must be a string');
    }
    const out: ContentInput = { body: c.body };
    if (c.title !== undefined) {
        if (typeof c.title !== 'string') {
            throw new Error('title must be a string');
        }
        out.title = c.title;
    }
    if (c.outline !== undefined) {
        if (typeof c.outline !== 'string') {
            throw new Error('outline must be a string');
        }
        out.outline = c.outline;
    }
    if (c.references !== undefined) {
        if (!Array.isArray(c.references)) {
            throw new Error('references must be an array');
        }
        out.references = c.references.map((r, i) => {
            if (r === null || typeof r !== 'object' || Array.isArray(r)) {
                throw new Error(`references[${i}] must be an object`);
            }
            const rr = r as Record<string, unknown>;
            for (const key of ['url', 'title', 'cite'] as const) {
                if (rr[key] !== undefined && typeof rr[key] !== 'string') {
                    throw new Error(`references[${i}].${key} must be a string`);
                }
            }
            return { url: rr.url, title: rr.title, cite: rr.cite } as Ref;
        });
    }
    return out;
}

export function renderContentMarkdown(content: ContentInput): string {
    const heading = content.title?.trim() || 'Untitled';
    const startsWithHeading = content.body.startsWith(`# ${heading}`);
    const lead = startsWithHeading ? '' : `# ${heading}\n\n`;
    const refsBlock = renderReferences(content.references);
    return `${lead}${content.body}${refsBlock}\n`;
}

function renderReferences(references: ContentInput['references']): string {
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

function renderReferenceLabel(ref: Ref): string {
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

async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        console.error('Error: Missing required arguments --in and --out');
        return 1;
    }
    try {
        const content = parseContent(await readFile(values.in, 'utf-8'));
        await writeFile(values.out, renderContentMarkdown(content), 'utf-8');
        return 0;
    } catch (err: unknown) {
        console.error(`render-md failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exitCode = await main();
}
