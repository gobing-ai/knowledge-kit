import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import { runInvoke } from '../../../apps/cli/src/invoke';
import { main, processGeneratorIO } from '../src/index';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');
const IN_FILE = join(FIXTURES_DIR, 'docs.json');
const OUT_FILE = join(import.meta.dir, 'output.json');
const MOCK_SPUR = join(FIXTURES_DIR, 'spur');
const QUEUE_FILE = join(FIXTURES_DIR, 'queue.json');
const PROMPTS_LOG = join(FIXTURES_DIR, 'prompts.log');
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_SPUR_BIN = process.env.KNOWLEDGE_KIT_SPUR_BIN;

const CURATION = {
    perspectives: [
        {
            id: 'perspective-1',
            name: 'Architect',
            questions: ['How is the system decomposed?'],
            evidence: ['doc-1'],
        },
        {
            id: 'perspective-2',
            name: 'Operator',
            questions: ['What are the operational requirements?'],
            evidence: ['doc-1'],
        },
    ],
};

const OUTLINE = {
    title: 'Architecture Overview',
    outline: '# Introduction\n\n## Body\n\n## Conclusion',
    references: ['doc-1'],
};

const ARTICLE = {
    title: 'Architecture Overview',
    body: '# Introduction\n\nIntro [doc-1].\n\n## Body\n\nBody [doc-1].\n\n## Conclusion\n\nConclusion.',
    citations: ['doc-1'],
};

const POLISHED = {
    title: 'Architecture Overview',
    body: '# Introduction\n\nIntro [doc-1].\n\n## Body\n\nBody [doc-1].\n\n## Conclusion\n\nConclusion.',
    outline: '# Introduction\n\n## Body\n\n## Conclusion',
};

const STAGE_RESULTS = [
    { exitCode: 0, stdout: JSON.stringify(CURATION), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify(OUTLINE), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify(ARTICLE), stderr: '' },
    { exitCode: 0, stdout: JSON.stringify(POLISHED), stderr: '' },
];

/** Mock spur that replays one result per `spur agent run` call and logs prompts for order assertions. */
async function writeSequentialMockSpur(results: { exitCode: number; stdout: string; stderr: string }[]): Promise<void> {
    await writeFile(
        MOCK_SPUR,
        `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const queue = JSON.parse(readFileSync(${JSON.stringify(QUEUE_FILE)}, 'utf-8'));
const next = queue.shift();
writeFileSync(${JSON.stringify(QUEUE_FILE)}, JSON.stringify(queue));
appendFileSync(${JSON.stringify(PROMPTS_LOG)}, JSON.stringify({ prompt: process.argv[4] ?? '' }) + '\\n');
console.log(JSON.stringify({ ...next, durationMs: 1 }));
`,
        'utf-8',
    );
    await chmod(MOCK_SPUR, 0o755);
    await writeFile(QUEUE_FILE, JSON.stringify(results), 'utf-8');
    await writeFile(PROMPTS_LOG, '', 'utf-8');
    process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;
}

async function readPrompts(): Promise<string[]> {
    const lines = (await readFile(PROMPTS_LOG, 'utf-8')).trim().split('\n').filter(Boolean);
    return lines.map((line) => (JSON.parse(line) as { prompt: string }).prompt);
}

afterEach(async () => {
    process.argv = ORIGINAL_ARGV;
    if (ORIGINAL_SPUR_BIN === undefined) delete process.env.KNOWLEDGE_KIT_SPUR_BIN;
    else process.env.KNOWLEDGE_KIT_SPUR_BIN = ORIGINAL_SPUR_BIN;
    await rm(FIXTURES_DIR, { recursive: true, force: true });
    await rm(OUT_FILE, { force: true });
});

describe('content-gen plugin adapter', () => {
    test('runInvoke runs curation, outline, article, and polish in order and writes ContentSchema output', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        const docs: Doc[] = [
            {
                id: 'doc-1',
                title: 'Architecture Overview',
                body: 'Content for architecture overview.',
                sourceUri: 'https://example.com/arch',
            },
        ];
        await writeFile(IN_FILE, JSON.stringify(docs), 'utf-8');
        await writeSequentialMockSpur(STAGE_RESULTS);

        const code = await runInvoke({
            plugin: 'content-gen',
            inPath: IN_FILE,
            outPath: OUT_FILE,
            pluginsRoot: join(import.meta.dir, '../..'),
        });

        expect(code).toBe(0);
        const content = ContentSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(content).toEqual({
            title: 'Architecture Overview',
            body: POLISHED.body,
            format: 'markdown',
            outline: POLISHED.outline,
            references: [{ url: 'https://example.com/arch', title: 'Architecture Overview', cite: 'doc-1' }],
            metadata: {
                generator: 'kk:storm',
                stageCount: 4,
                docIds: ['doc-1'],
            },
        });

        const prompts = await readPrompts();
        expect(prompts.length).toBe(4);
        expect(prompts[0]).toContain('perspectives');
        expect(prompts[1]).toContain('outline');
        expect(prompts[2]).toContain('Write the complete article');
        expect(prompts[3]).toContain('Polish the draft');
    });

    test('empty input writes the contract notice without invoking any stage', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, '[]', 'utf-8');
        const generate = async () => {
            throw new Error('must not run');
        };

        await processGeneratorIO(IN_FILE, OUT_FILE, generate);

        const result = ContentSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(result.body).toContain('No documents provided for generation.');
        expect(result.references).toEqual([]);
    });

    test('stage failure returns non-zero, reaches stderr, and leaves no output', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ id: 'doc-1', body: 'test' }]), 'utf-8');
        await writeFile(OUT_FILE, 'stale', 'utf-8');
        await writeSequentialMockSpur([
            { exitCode: 0, stdout: JSON.stringify(CURATION), stderr: '' },
            { exitCode: 1, stdout: '', stderr: 'outline agent crashed' },
        ]);
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});

        try {
            const code = await runInvoke({
                plugin: 'content-gen',
                inPath: IN_FILE,
                outPath: OUT_FILE,
                pluginsRoot: join(import.meta.dir, '../..'),
            });
            expect(code).toBe(1);
            expect(errorSpy.mock.calls.flat().join(' ')).toContain('Outline stage failed: outline agent crashed');
            expect(await Bun.file(OUT_FILE).exists()).toBe(false);
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('malformed stage output fails loud before writing', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ id: 'doc-1', body: 'test' }]), 'utf-8');
        await writeSequentialMockSpur([
            { exitCode: 0, stdout: JSON.stringify(CURATION), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(OUTLINE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify({ body: '' }), stderr: '' },
        ]);
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});

        try {
            const code = await runInvoke({
                plugin: 'content-gen',
                inPath: IN_FILE,
                outPath: OUT_FILE,
                pluginsRoot: join(import.meta.dir, '../..'),
            });
            expect(code).toBe(1);
            expect(errorSpy.mock.calls.flat().join(' ')).toContain('Article stage failed: malformed output');
            expect(await Bun.file(OUT_FILE).exists()).toBe(false);
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('sparse document metadata stays schema-valid and omits absent reference fields', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ id: 'doc-1', body: 'Content without a title.' }]), 'utf-8');
        await writeSequentialMockSpur([
            {
                exitCode: 0,
                stdout: JSON.stringify({
                    perspectives: [
                        { id: 'p', name: 'Architect', questions: ['q?'], evidence: ['doc-1'] },
                        { id: 'p2', name: 'Operator', questions: ['q2?'], evidence: ['doc-1'] },
                    ],
                }),
                stderr: '',
            },
            { exitCode: 0, stdout: JSON.stringify(OUTLINE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(ARTICLE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(POLISHED), stderr: '' },
        ]);

        const code = await runInvoke({
            plugin: 'content-gen',
            inPath: IN_FILE,
            outPath: OUT_FILE,
            pluginsRoot: join(import.meta.dir, '../..'),
        });

        expect(code).toBe(0);
        const content = ContentSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(content.references).toEqual([{ cite: 'doc-1' }]);
        expect(content.metadata).toEqual({ generator: 'kk:storm', stageCount: 4, docIds: ['doc-1'] });
    });

    test('invalid pipeline output fails before writing', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ id: 'doc-1', body: 'test' }]), 'utf-8');
        const generate = async () => ({ title: 'missing body' }) as Content;

        await expect(processGeneratorIO(IN_FILE, OUT_FILE, generate)).rejects.toThrow();
        expect(await Bun.file(OUT_FILE).exists()).toBe(false);
    });

    test('malformed input fails before invoking any stage', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ title: 'missing id and body' }]), 'utf-8');
        const generate = async () => {
            throw new Error('must not run');
        };

        await expect(processGeneratorIO(IN_FILE, OUT_FILE, generate)).rejects.toThrow();
        expect(await Bun.file(OUT_FILE).exists()).toBe(false);
    });

    test('main reports missing arguments without terminating the process', async () => {
        process.argv = ['bun', 'index.ts'];
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});
        try {
            expect(await main()).toBe(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });

    test('main returns success after writing validated pipeline output', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ id: 'doc-1', body: 'test' }]), 'utf-8');
        await writeSequentialMockSpur(STAGE_RESULTS);
        process.argv = ['bun', 'index.ts', '--in', IN_FILE, '--out', OUT_FILE];

        expect(await main()).toBe(0);
        const content = ContentSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(content.body).toBe(POLISHED.body);
        expect(content.metadata).toEqual({ generator: 'kk:storm', stageCount: 4, docIds: ['doc-1'] });
    });

    test('main returns failure and removes stale output', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(IN_FILE, JSON.stringify([{ id: 'doc-1', body: 'test' }]), 'utf-8');
        await writeFile(OUT_FILE, 'stale', 'utf-8');
        await writeSequentialMockSpur([
            { exitCode: 0, stdout: JSON.stringify(CURATION), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(OUTLINE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(ARTICLE), stderr: '' },
            { exitCode: 1, stdout: '', stderr: 'polish agent crashed' },
        ]);
        process.argv = ['bun', 'index.ts', '--in', IN_FILE, '--out', OUT_FILE];
        const errorSpy = spyOn(logger, 'error').mockImplementation(() => {});

        try {
            expect(await main()).toBe(1);
            expect(errorSpy.mock.calls.flat().join(' ')).toContain('Polish stage failed: polish agent crashed');
            expect(await Bun.file(OUT_FILE).exists()).toBe(false);
        } finally {
            errorSpy.mockRestore();
        }
    });
});
