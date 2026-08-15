import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@gobing-ai/utils';
import { main, renderContentMarkdown, renderContentMarkdownFile } from '../src/index';

// Capture logger.error: main()'s error paths assert the message via the output seam
// instead of leaking it to the test runner's stderr (web-search tests stub console.error
// for the same reason).
async function captureLoggerErrors(fn: () => Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const original = logger.error;
    logger.error = (...args: unknown[]) => {
        lines.push(args.join(' '));
    };
    try {
        await fn();
    } finally {
        logger.error = original;
    }
    return lines;
}

// R3 characterization: the shipped no-checkout runner (plugins/kk/scripts/render-md.ts)
// must produce byte-identical output to kk-core renderContentMarkdown for the same Content.
// 0059 shells this script, so the test drives the real `bun <script> --in --out` invocation.
const SHIPPED_SCRIPT = join(import.meta.dir, '../../../plugins/kk/scripts/render-md.ts');

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kk-render-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('renderContentMarkdown', () => {
    it('uses trimmed title as H1, else Untitled', () => {
        const withTitle = renderContentMarkdown({ body: 'body', format: 'markdown', title: '  Hello World  ' });
        expect(withTitle).toMatch(/^# Hello World\n\n/);

        const untitled = renderContentMarkdown({ body: 'body', format: 'markdown' });
        expect(untitled).toMatch(/^# Untitled\n\n/);
    });

    it('does not duplicate an H1 when body already starts with the heading', () => {
        const out = renderContentMarkdown({ body: '# Hello World\n\npara', format: 'markdown', title: 'Hello World' });
        expect(out.startsWith('# Hello World\n\npara')).toBe(true);
        expect(out.indexOf('# Hello World', 1)).toBe(-1);
    });

    it('prepends an H1 lead when body does not start with the heading', () => {
        const out = renderContentMarkdown({ body: 'para', format: 'markdown', title: 'Title' });
        expect(out).toBe('# Title\n\npara\n');
    });

    it('emits an Outline block when outline is non-empty after trim', () => {
        const out = renderContentMarkdown({ body: 'body', format: 'markdown', outline: '  \n  A\n  B  ' });
        expect(out).toContain('\n\n## Outline\n\nA\n  B');
    });

    it('omits the Outline block for a blank/whitespace outline', () => {
        const out = renderContentMarkdown({ body: 'body', format: 'markdown', outline: '   ' });
        expect(out).not.toContain('Outline');
    });

    it('renders references as - label lines with an optional (cite) suffix', () => {
        const out = renderContentMarkdown({
            body: 'body',
            format: 'markdown',
            references: [
                { title: 'Alpha', url: 'https://a.example', cite: 'A1' },
                { title: 'Beta', url: 'https://b.example' },
            ],
        });
        expect(out).toContain('\n\n## References\n\n');
        expect(out).toContain('- [Alpha](https://a.example) (A1)');
        expect(out).toContain('- [Beta](https://b.example)');
    });

    it('renders url-only, title-only, and cite-only reference labels', () => {
        const out = renderContentMarkdown({
            body: 'body',
            format: 'markdown',
            references: [{ url: 'https://u.example' }, { title: 'Plain' }, { cite: 'C1' }],
        });
        expect(out).toContain('- https://u.example');
        expect(out).toContain('- Plain');
        expect(out).toContain('- `C1`');
    });

    it('emits no References block when every reference is skipped as empty', () => {
        const out = renderContentMarkdown({ body: 'body', format: 'markdown', references: [{}, { cite: '  ' }] });
        expect(out).not.toContain('## References');
    });

    it('ends with a single trailing newline', () => {
        const out = renderContentMarkdown({ body: 'body', format: 'markdown' });
        expect(out.endsWith('\n')).toBe(true);
        expect(out.endsWith('\n\n')).toBe(false);
    });
});

describe('renderContentMarkdownFile', () => {
    it('reads content.json, validates, and writes rendered markdown to outPath', async () => {
        const inPath = join(dir, 'content.json');
        const outPath = join(dir, 'content.md');
        await writeFile(
            inPath,
            JSON.stringify({ body: 'para', title: 'T', references: [{ url: 'https://x.example', cite: 'X' }] }),
            'utf-8',
        );
        await renderContentMarkdownFile(inPath, outPath);
        const out = await readFile(outPath, 'utf-8');
        expect(out).toContain('# T');
        expect(out).toContain('- https://x.example (X)');
    });

    it('throws on invalid content that fails schema validation', async () => {
        const inPath = join(dir, 'bad.json');
        await writeFile(inPath, JSON.stringify({ title: 'no-body' }), 'utf-8');
        await expect(renderContentMarkdownFile(inPath, join(dir, 'out.md'))).rejects.toThrow();
    });
});

describe('main', () => {
    it('returns 0 and writes markdown on the happy path', async () => {
        const inPath = join(dir, 'content.json');
        const outPath = join(dir, 'content.md');
        await writeFile(inPath, JSON.stringify({ body: 'hello', title: 'Hi' }), 'utf-8');
        process.argv = ['bun', 'render-md', '--in', inPath, '--out', outPath];
        expect(await main()).toBe(0);
        expect(await readFile(outPath, 'utf-8')).toContain('# Hi');
    });

    it('returns 1 when --in or --out is missing', async () => {
        process.argv = ['bun', 'render-md'];
        const lines = await captureLoggerErrors(async () => {
            expect(await main()).toBe(1);
        });
        expect(lines[0]).toContain('Missing required arguments');
    });

    it('returns 1 on invalid content JSON', async () => {
        const inPath = join(dir, 'bad.json');
        const outPath = join(dir, 'out.md');
        await writeFile(inPath, 'not-json', 'utf-8');
        process.argv = ['bun', 'render-md', '--in', inPath, '--out', outPath];
        const lines = await captureLoggerErrors(async () => {
            expect(await main()).toBe(1);
        });
        expect(lines[0]).toContain('render-md failed');
    });
});

describe('R3 — shipped script characterization (byte-identical to kk-core)', () => {
    it('produces byte-identical output for a full Content fixture', async () => {
        const content = {
            body: 'body text',
            title: '  Full Title  ',
            outline: 'A\nB',
            references: [
                { title: 'Alpha', url: 'https://a.example', cite: 'A1' },
                { title: 'Beta', url: 'https://b.example' },
            ],
        };
        const inPath = join(dir, 'full.json');
        const outPath = join(dir, 'full.md');
        await writeFile(inPath, JSON.stringify(content), 'utf-8');
        const proc = Bun.spawn(['bun', SHIPPED_SCRIPT, '--in', inPath, '--out', outPath]);
        expect(await proc.exited).toBe(0);
        const scriptOut = await readFile(outPath, 'utf-8');
        expect(scriptOut).toBe(renderContentMarkdown({ ...content, format: 'markdown' }));
    });

    it('matches for an untitled, reference-less Content (Untitled H1 + no sections)', async () => {
        const content = { body: 'just body', format: 'markdown' };
        const inPath = join(dir, 'untitled.json');
        const outPath = join(dir, 'untitled.md');
        await writeFile(inPath, JSON.stringify(content), 'utf-8');
        const proc = Bun.spawn(['bun', SHIPPED_SCRIPT, '--in', inPath, '--out', outPath]);
        expect(await proc.exited).toBe(0);
        const scriptOut = await readFile(outPath, 'utf-8');
        expect(scriptOut).toBe(renderContentMarkdown(content));
    });
});
