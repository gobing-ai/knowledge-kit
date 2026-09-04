import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import {
    type AgentRunEnvelope,
    type ArticleResult,
    articleStage,
    type CurationResult,
    curationStage,
    generateWithStormPipeline,
    type OutlineResult,
    outlineStage,
    type PolishResult,
    polishStage,
    type StormStageRunner,
    spurStageRunner,
} from '../src/storm';

const FIXTURES_DIR = join(import.meta.dir, 'storm-fixtures');
const MOCK_SPUR = join(FIXTURES_DIR, 'spur');
const INPUT_PATH = join(FIXTURES_DIR, 'docs.json');
const ORIGINAL_SPUR_BIN = process.env.KNOWLEDGE_KIT_SPUR_BIN;
const ORIGINAL_PROJECT_ROOT = process.env.KNOWLEDGE_KIT_PROJECT_ROOT;

const DOCS: Doc[] = [
    { id: 'doc-1', title: 'Architecture Overview', body: 'Content for architecture overview.' },
    { id: 'doc-2', body: 'Content without a title.' },
];

const VALID_CURATION: CurationResult = {
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
            evidence: ['doc-2'],
        },
    ],
};

const VALID_OUTLINE: OutlineResult = {
    title: 'Synthesis',
    outline: '# Introduction\n\n## Body\n\n## Conclusion',
    references: ['doc-1', 'doc-2'],
};

const VALID_ARTICLE: ArticleResult = {
    title: 'Synthesis',
    body: '# Introduction\n\nIntro text [doc-1].\n\n## Body\n\nBody text [doc-2].\n\n## Conclusion\n\nConclusion.',
    citations: ['doc-1', 'doc-2'],
};

const VALID_POLISH: PolishResult = {
    title: 'Synthesis',
    body: '# Introduction\n\nIntro text [doc-1].\n\n## Body\n\nBody text [doc-2].\n\n## Conclusion\n\nConclusion.',
    outline: '# Introduction\n\n## Body\n\n## Conclusion',
};

function fakeRunner(output: AgentRunEnvelope, onPrompt?: (prompt: string) => void): StormStageRunner {
    return {
        async runStage(prompt) {
            onPrompt?.(prompt);
            return output;
        },
    };
}

function jsonRunner(raw: unknown, onPrompt?: (prompt: string) => void): StormStageRunner {
    return fakeRunner({ exitCode: 0, stdout: JSON.stringify(raw), stderr: '' }, onPrompt);
}

/** Runner that replays one envelope per stage call, recording prompts for order assertions. */
function scriptedRunner(stages: AgentRunEnvelope[]): { runner: StormStageRunner; prompts: string[] } {
    const prompts: string[] = [];
    let index = 0;
    return {
        prompts,
        runner: {
            async runStage(prompt) {
                prompts.push(prompt);
                const output = stages[index];
                index += 1;
                if (output === undefined) {
                    throw new Error('scripted runner: unexpected stage call');
                }
                return output;
            },
        },
    };
}

afterEach(async () => {
    if (ORIGINAL_SPUR_BIN === undefined) delete process.env.KNOWLEDGE_KIT_SPUR_BIN;
    else process.env.KNOWLEDGE_KIT_SPUR_BIN = ORIGINAL_SPUR_BIN;
    if (ORIGINAL_PROJECT_ROOT === undefined) delete process.env.KNOWLEDGE_KIT_PROJECT_ROOT;
    else process.env.KNOWLEDGE_KIT_PROJECT_ROOT = ORIGINAL_PROJECT_ROOT;
    await rm(FIXTURES_DIR, { recursive: true, force: true });
});

describe('curation stage (R2)', () => {
    test('builds grounded perspectives whose evidence traces only to supplied document IDs', async () => {
        let prompt = '';
        const runner = jsonRunner(VALID_CURATION, (p) => (prompt = p));

        const result = await curationStage(runner, DOCS, INPUT_PATH);

        expect(result).toEqual(VALID_CURATION);
        expect(result.perspectives.length).toBeGreaterThanOrEqual(2);
        expect(prompt).toContain('untrusted');
        expect(prompt).toContain('do not fetch or retrieve any external source');
        expect(prompt).toContain('"doc-1","doc-2"');
    });

    test('rejects a single-perspective result (R2 requires multiple perspectives)', async () => {
        const runner = jsonRunner({
            perspectives: [{ id: 'p', name: 'Architect', questions: ['q?'], evidence: ['doc-1'] }],
        });

        await expect(curationStage(runner, DOCS, INPUT_PATH)).rejects.toThrow(
            'Curation stage failed: malformed output',
        );
    });

    test('fails loud when evidence cites an unknown document ID', async () => {
        const runner = jsonRunner({
            perspectives: [
                { id: 'p1', name: 'Architect', questions: ['q?'], evidence: ['doc-1'] },
                { id: 'p2', name: 'Operator', questions: ['q?'], evidence: ['doc-1', 'doc-999'] },
            ],
        });

        await expect(curationStage(runner, DOCS, INPUT_PATH)).rejects.toThrow(
            'Curation stage failed: cites unknown document ID(s): doc-999',
        );
    });

    test('fails loud on malformed output', async () => {
        const runner = jsonRunner({ perspectives: [{ id: 'p', name: '', questions: [], evidence: [] }] });

        await expect(curationStage(runner, DOCS, INPUT_PATH)).rejects.toThrow(
            'Curation stage failed: malformed output',
        );
    });

    test('fails loud when the agent exits non-zero', async () => {
        const runner = fakeRunner({ exitCode: 1, stdout: '', stderr: 'agent exploded' });

        await expect(curationStage(runner, DOCS, INPUT_PATH)).rejects.toThrow('Curation stage failed: agent exploded');
    });

    test('accepts a fenced JSON response', async () => {
        const runner = fakeRunner({
            exitCode: 0,
            stdout: `Here you go:\n\n\`\`\`json\n${JSON.stringify(VALID_CURATION)}\n\`\`\`\n\nDone.`,
            stderr: '',
        });

        await expect(curationStage(runner, DOCS, INPUT_PATH)).resolves.toEqual(VALID_CURATION);
    });
});

describe('outline stage (R3)', () => {
    test('emits a structured markdown outline derived from the curation result', async () => {
        let prompt = '';
        const runner = jsonRunner(VALID_OUTLINE, (p) => (prompt = p));

        const result = await outlineStage(runner, VALID_CURATION, DOCS, INPUT_PATH);

        expect(result.outline).toContain('# Introduction');
        expect(result.title).toBe('Synthesis');
        expect(prompt).toContain('perspective-1');
        expect(prompt).toContain('untrusted');
    });

    test('fails loud when the outline cites an unknown document ID', async () => {
        const runner = jsonRunner({ outline: '# Intro', references: ['doc-1', 'doc-999'] });

        await expect(outlineStage(runner, VALID_CURATION, DOCS, INPUT_PATH)).rejects.toThrow(
            'Outline stage failed: cites unknown document ID(s): doc-999',
        );
    });

    test('fails loud on malformed output', async () => {
        const runner = jsonRunner({ outline: '' });

        await expect(outlineStage(runner, VALID_CURATION, DOCS, INPUT_PATH)).rejects.toThrow(
            'Outline stage failed: malformed output',
        );
    });

    test('fails loud when the agent exits non-zero', async () => {
        const runner = fakeRunner({ exitCode: 2, stdout: '', stderr: 'outline agent crashed' });

        await expect(outlineStage(runner, VALID_CURATION, DOCS, INPUT_PATH)).rejects.toThrow(
            'Outline stage failed: outline agent crashed',
        );
    });
});

describe('article stage (R2)', () => {
    test('writes a markdown draft grounded in the curation result and outline', async () => {
        let prompt = '';
        const runner = jsonRunner(VALID_ARTICLE, (p) => (prompt = p));

        const result = await articleStage(runner, VALID_CURATION, VALID_OUTLINE, DOCS, INPUT_PATH);

        expect(result).toEqual(VALID_ARTICLE);
        expect(result.body).toContain('# Introduction');
        expect(prompt).toContain('untrusted');
        expect(prompt).toContain('perspective-1');
        expect(prompt).toContain('# Introduction');
        expect(prompt).toContain('"doc-1","doc-2"');
    });

    test('fails loud when a citation references an unknown document ID', async () => {
        const runner = jsonRunner({ ...VALID_ARTICLE, citations: ['doc-1', 'doc-999'] });

        await expect(articleStage(runner, VALID_CURATION, VALID_OUTLINE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Article stage failed: cites unknown document ID(s): doc-999',
        );
    });

    test('fails loud when the draft body cites an unknown document ID omitted from citations', async () => {
        const runner = jsonRunner({
            ...VALID_ARTICLE,
            body: `${VALID_ARTICLE.body}\n\nUnverified claim [doc-999].`,
        });

        await expect(articleStage(runner, VALID_CURATION, VALID_OUTLINE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Article stage failed: cites unknown document ID(s): doc-999',
        );
    });

    test('accepts markdown footnote-style citation ids (^doc-1) as known evidence', async () => {
        const runner = jsonRunner({
            ...VALID_ARTICLE,
            body: VALID_ARTICLE.body.replaceAll('[doc-1]', '[^doc-1]'),
            citations: ['^doc-1', 'doc-2'],
        });

        const result = await articleStage(runner, VALID_CURATION, VALID_OUTLINE, DOCS, INPUT_PATH);

        expect(result.citations).toEqual(['^doc-1', 'doc-2']);
    });

    test('fails loud on malformed output', async () => {
        const runner = jsonRunner({ body: '' });

        await expect(articleStage(runner, VALID_CURATION, VALID_OUTLINE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Article stage failed: malformed output',
        );
    });

    test('fails loud when the agent exits non-zero', async () => {
        const runner = fakeRunner({ exitCode: 3, stdout: '', stderr: 'article agent crashed' });

        await expect(articleStage(runner, VALID_CURATION, VALID_OUTLINE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Article stage failed: article agent crashed',
        );
    });
});

describe('polish stage (R3)', () => {
    test('polishes the draft while preserving headings and citations and emits an outline', async () => {
        let prompt = '';
        const runner = jsonRunner(VALID_POLISH, (p) => (prompt = p));

        const result = await polishStage(runner, VALID_ARTICLE, DOCS, INPUT_PATH);

        expect(result).toEqual(VALID_POLISH);
        expect(result.body).toContain('# Introduction');
        expect(result.body).toContain('[doc-1]');
        expect(result.outline).toContain('## Body');
        expect(prompt).toContain('preserve every heading and citation');
        expect(prompt).toContain('untrusted');
    });

    test('fails loud on malformed output', async () => {
        const runner = jsonRunner({ body: '' });

        await expect(polishStage(runner, VALID_ARTICLE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Polish stage failed: malformed output',
        );
    });

    test('fails loud when polish drops a heading from the draft', async () => {
        const runner = jsonRunner({
            ...VALID_POLISH,
            body: '# Introduction\n\nIntro text [doc-1].\n\n## Body\n\nBody text [doc-2].\n\nConclusion.',
        });

        await expect(polishStage(runner, VALID_ARTICLE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Polish stage failed: preservation check failed: dropped heading(s): ## Conclusion',
        );
    });

    test('fails loud when polish drops a citation from the draft', async () => {
        const runner = jsonRunner({
            ...VALID_POLISH,
            body: '# Introduction\n\nIntro text.\n\n## Body\n\nBody text [doc-2].\n\n## Conclusion\n\nConclusion.',
        });

        await expect(polishStage(runner, VALID_ARTICLE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Polish stage failed: preservation check failed: dropped citation(s): doc-1',
        );
    });

    test('fails loud when polish introduces a citation to an unknown document ID', async () => {
        const runner = jsonRunner({
            ...VALID_POLISH,
            body: `${VALID_POLISH.body}\n\nRelated work [doc-999].`,
        });

        await expect(polishStage(runner, VALID_ARTICLE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Polish stage failed: cites unknown document ID(s): doc-999',
        );
    });

    test('fails loud when the agent exits non-zero', async () => {
        const runner = fakeRunner({ exitCode: 4, stdout: '', stderr: 'polish agent crashed' });

        await expect(polishStage(runner, VALID_ARTICLE, DOCS, INPUT_PATH)).rejects.toThrow(
            'Polish stage failed: polish agent crashed',
        );
    });
});

describe('owned STORM pipeline (R1)', () => {
    test('runs curation, outline, article, and polish in order and maps Content', async () => {
        const { runner, prompts } = scriptedRunner([
            { exitCode: 0, stdout: JSON.stringify(VALID_CURATION), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(VALID_OUTLINE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(VALID_ARTICLE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(VALID_POLISH), stderr: '' },
        ]);

        const content = await generateWithStormPipeline(DOCS, INPUT_PATH, runner);

        expect(prompts[0]).toContain('perspectives');
        expect(prompts[1]).toContain('outline');
        expect(prompts[2]).toContain('Write the complete article');
        // R1 (0063): the article-stage prompt mandates synthesis — digest, not index.
        expect(prompts[2]).toContain('references are evidence, not the deliverable');
        expect(prompts[2]).toContain(
            'Return only a JSON object matching {"title":string,"body":string,"citations":[string]}',
        );
        // Digest mandate is article-stage only: curation/outline/polish prompts stay clean.
        expect(prompts[0]).not.toContain('references are evidence');
        expect(prompts[1]).not.toContain('references are evidence');
        expect(prompts[3]).not.toContain('references are evidence');
        expect(prompts[3]).toContain('Polish the draft');
        expect(content).toEqual({
            title: 'Synthesis',
            body: VALID_POLISH.body,
            format: 'markdown',
            outline: VALID_POLISH.outline,
            references: [
                { url: undefined, title: 'Architecture Overview', cite: 'doc-1' },
                { url: undefined, title: undefined, cite: 'doc-2' },
            ],
            metadata: { generator: 'kk:storm', stageCount: 4, docIds: ['doc-1', 'doc-2'] },
        });
    });

    test('survives caret-vs-bare citation drift between stages and normalizes the final body', async () => {
        const { runner } = scriptedRunner([
            { exitCode: 0, stdout: JSON.stringify(VALID_CURATION), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(VALID_OUTLINE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(VALID_ARTICLE), stderr: '' },
            {
                exitCode: 0,
                stdout: JSON.stringify({
                    ...VALID_POLISH,
                    body: VALID_POLISH.body.replaceAll('[doc-2]', '[^doc-2]'),
                }),
                stderr: '',
            },
        ]);

        const content = await generateWithStormPipeline(DOCS, INPUT_PATH, runner);

        expect(content.body).toContain('Body text [doc-2].');
        expect(content.body).not.toContain('[^doc-2]');
    });

    test('a failed stage aborts the pipeline with a stage-specific diagnostic', async () => {
        const { runner, prompts } = scriptedRunner([
            { exitCode: 0, stdout: JSON.stringify(VALID_CURATION), stderr: '' },
            { exitCode: 1, stdout: '', stderr: 'outline agent crashed' },
        ]);

        await expect(generateWithStormPipeline(DOCS, INPUT_PATH, runner)).rejects.toThrow(
            'Outline stage failed: outline agent crashed',
        );
        expect(prompts.length).toBe(2);
    });

    test('a malformed stage result aborts the pipeline before later stages run', async () => {
        const { runner, prompts } = scriptedRunner([
            { exitCode: 0, stdout: JSON.stringify(VALID_CURATION), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify(VALID_OUTLINE), stderr: '' },
            { exitCode: 0, stdout: JSON.stringify({ body: '' }), stderr: '' },
        ]);

        await expect(generateWithStormPipeline(DOCS, INPUT_PATH, runner)).rejects.toThrow(
            'Article stage failed: malformed output',
        );
        expect(prompts.length).toBe(3);
    });
});

describe('spur stage runner (R1)', () => {
    test('invokes the existing spur agent run boundary with structured-output flags', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(
            MOCK_SPUR,
            "#!/usr/bin/env bun\nconsole.log(JSON.stringify({ exitCode: 0, stdout: JSON.stringify(process.argv), stderr: '' }));\n",
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('test prompt');

        expect(envelope.exitCode).toBe(0);
        const argv = JSON.parse(envelope.stdout) as string[];
        expect(argv.slice(2, 4)).toEqual(['agent', 'run']);
        expect(argv).toContain('--json');
        expect(argv).toContain('--mode');
        expect(argv).toContain('text');
    });

    test('anchors --cwd to KNOWLEDGE_KIT_PROJECT_ROOT when set, else the process cwd', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(
            MOCK_SPUR,
            "#!/usr/bin/env bun\nconsole.log(JSON.stringify({ exitCode: 0, stdout: JSON.stringify(process.argv), stderr: '' }));\n",
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        process.env.KNOWLEDGE_KIT_PROJECT_ROOT = '/sentinel/project-root';
        const pinned = JSON.parse((await spurStageRunner.runStage('p')).stdout) as string[];
        expect(pinned[pinned.indexOf('--cwd') + 1]).toBe('/sentinel/project-root');

        delete process.env.KNOWLEDGE_KIT_PROJECT_ROOT;
        const fallback = JSON.parse((await spurStageRunner.runStage('p')).stdout) as string[];
        expect(fallback[fallback.indexOf('--cwd') + 1]).toBe(process.cwd());
    });

    test('retries a crashed agent run once, then returns the success', async () => {
        // Regression (dogfood daily-ai-news-20260903): polish stage agent exit 1 killed a 90-min run.
        await mkdir(FIXTURES_DIR, { recursive: true });
        const counter = join(FIXTURES_DIR, 'attempts.txt');
        await writeFile(
            MOCK_SPUR,
            `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const f = ${JSON.stringify(counter)};
const n = (existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0) + 1;
writeFileSync(f, String(n));
if (n === 1) console.log(JSON.stringify({ exitCode: 1, stdout: '', stderr: 'Agent exited with code 1' }));
else console.log(JSON.stringify({ exitCode: 0, stdout: '{"recovered":true}', stderr: '' }));
`,
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('p');

        expect(envelope.exitCode).toBe(0);
        expect(envelope.stdout).toBe('{"recovered":true}');
        expect(await Bun.file(counter).text()).toBe('2');
    });

    test('gives up after one retry when the agent keeps crashing', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        const counter = join(FIXTURES_DIR, 'attempts.txt');
        await writeFile(
            MOCK_SPUR,
            `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const f = ${JSON.stringify(counter)};
const n = (existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0) + 1;
writeFileSync(f, String(n));
console.log(JSON.stringify({ exitCode: 1, stdout: '', stderr: 'Agent exited with code 1' }));
`,
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('p');

        expect(envelope.exitCode).toBe(1);
        expect(await Bun.file(counter).text()).toBe('2');
    });

    test('does not retry a malformed envelope (deterministic contract failure)', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        const counter = join(FIXTURES_DIR, 'attempts.txt');
        await writeFile(
            MOCK_SPUR,
            `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const f = ${JSON.stringify(counter)};
const n = (existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0) + 1;
writeFileSync(f, String(n));
console.log('garbage');
`,
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('p');

        expect(envelope.exitCode).toBe(1);
        expect(envelope.stderr).toContain('malformed');
        expect(await Bun.file(counter).text()).toBe('1');
    });

    test('returns the CLI-level failure when the spur binary exits non-zero without an envelope', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(
            MOCK_SPUR,
            "#!/usr/bin/env bun\nconsole.error('spur: command not found');\nprocess.exit(3);\n",
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('test prompt');

        expect(envelope).toEqual({ exitCode: 3, stdout: '', stderr: 'spur: command not found\n' });
    });

    test('surfaces a runner diagnostic when the spur binary exits 0 without an envelope', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(MOCK_SPUR, "#!/usr/bin/env bun\nconsole.log('not json at all');\n", 'utf-8');
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('test prompt');

        expect(envelope.exitCode).toBe(1);
        expect(envelope.stdout).toBe('');
        expect(envelope.stderr).toContain('spur agent run returned malformed output');
    });

    test('a stage prefixes the runner diagnostic when spur emits non-JSON output', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(MOCK_SPUR, "#!/usr/bin/env bun\nconsole.log('garbage');\n", 'utf-8');
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        await expect(curationStage(spurStageRunner, DOCS, INPUT_PATH)).rejects.toThrow(
            'Curation stage failed: spur agent run returned malformed output',
        );
    });

    test('unwraps the spur agent run --json envelope so stages consume agent output', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(
            MOCK_SPUR,
            "#!/usr/bin/env bun\nconsole.log(JSON.stringify({ exitCode: 7, stdout: 'agent produced this', stderr: 'agent failed' }));\n",
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const envelope = await spurStageRunner.runStage('test prompt');

        expect(envelope).toEqual({ exitCode: 7, stdout: 'agent produced this', stderr: 'agent failed' });
    });

    test('curation stage runs end to end through the real runner', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(
            MOCK_SPUR,
            `#!/usr/bin/env bun
const result = { perspectives: [{ id: 'perspective-1', name: 'Architect', questions: ['How is the system decomposed?'], evidence: ['doc-1'] }, { id: 'perspective-2', name: 'Operator', questions: ['What are the operational requirements?'], evidence: ['doc-2'] }] };
console.log(JSON.stringify({ exitCode: 0, stdout: JSON.stringify(result), stderr: '' }));
`,
            'utf-8',
        );
        await chmod(MOCK_SPUR, 0o755);
        process.env.KNOWLEDGE_KIT_SPUR_BIN = MOCK_SPUR;

        const result = await curationStage(spurStageRunner, DOCS, INPUT_PATH);

        expect(result.perspectives.map((perspective) => perspective.name)).toEqual(['Architect', 'Operator']);
        expect(result.perspectives).toHaveLength(2);
        expect(result.perspectives[0]?.evidence).toEqual(['doc-1']);
    });
});
