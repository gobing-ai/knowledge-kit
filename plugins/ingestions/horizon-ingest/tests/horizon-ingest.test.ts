import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestToDocs, main, processIngestionIO, splitItemBlocks } from '../src/index';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');
const OUT_FILE = join(FIXTURES_DIR, 'out', 'docs.json');

const DIGEST = `# Horizon Daily - 2026-09-03

> From 16 items, 2 important content pieces were selected

---

**Technology News**
1. [Alpha model ships](#item-tech-news-1) ⭐️ 7.0/10

---

## Technology News

<a id="item-tech-news-1"></a>
### [Alpha model ships](https://example.com/alpha) ⭐️ 7.0/10

Alpha released a model. Details follow in the summary paragraph.

hackernews · user1 · Sep 2, 19:33 · [Discussion](https://news.ycombinator.com/item?id=1)

**「Background」** Background block text.

**「Impact」** Impact block text.

<details><summary>References</summary>
<ul>
<li><a href="https://ref.example/1">Ref One</a></li>
</ul>
</details>

**Tags**: \`#open-source\`, \`#llm\`

---

<a id="item-tech-news-2"></a>
### [Beta framework launches](https://example.com/beta) ⭐️ 8.5/10

Beta launched a framework.

reddit · r/MachineLearning · Sep 2, 10:00 · [Discussion](https://reddit.example/2)

**Tags**: \`#devtools\`
`;

function fakeRunner(exitCode = 0, stderr = '') {
    return async () => {
        const summaries = join(FIXTURES_DIR, 'data', 'summaries');
        await mkdir(summaries, { recursive: true });
        await writeFile(join(summaries, 'horizon-2026-09-03-en.md'), DIGEST);
        return { exitCode, stderr };
    };
}

afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true });
});

describe('splitItemBlocks + digestToDocs', () => {
    test('parses one Doc per item block with id/date/profile/n, score, tags, references', () => {
        const docs = digestToDocs(DIGEST, '2026-09-03', 'en');
        expect(docs).toHaveLength(2);
        const [first, second] = docs;
        expect(first?.id).toBe('horizon:2026-09-03-tech-news-1');
        expect(first?.title).toBe('Alpha model ships');
        expect(first?.sourceUri).toBe('https://example.com/alpha');
        expect(first?.metadata?.score).toBe(7);
        expect(first?.metadata?.profile).toBe('tech-news');
        expect(first?.metadata?.source).toBe('hackernews');
        expect(first?.metadata?.tags).toEqual(['open-source', 'llm']);
        expect(first?.metadata?.references).toEqual(['https://ref.example/1']);
        expect(first?.body).toContain('Alpha released a model.');
        expect(first?.body).toContain('Background block text.');
        expect(first?.body).not.toContain('<details>');
        expect(second?.id).toBe('horizon:2026-09-03-tech-news-2');
        expect(second?.metadata?.score).toBe(8.5);
    });

    test('blocks without anchors or headings are skipped', () => {
        expect(splitItemBlocks('# just a heading\n\nno items here')).toEqual([]);
    });
});

describe('processIngestionIO', () => {
    test('runs horizon, parses the fresh digest for the run date, writes Doc[]', async () => {
        const now = new Date(Date.now() - 60_000); // run started a minute ago (real clock)
        const { docs } = await processIngestionIO(
            { out: OUT_FILE },
            { data_dir: join(FIXTURES_DIR, 'data'), languages: ['en'] },
            fakeRunner(),
            now,
        );
        expect(docs).toHaveLength(2);
        const written = JSON.parse(await Bun.file(OUT_FILE).text());
        expect(written[0].id).toBe('horizon:2026-09-03-tech-news-1');
    });
    test('tolerates filename date ≠ run date (UTC-midnight crossing): freshness is mtime-based', async () => {
        // Run starts 23:35 UTC Sep 3; the crawl finishes after midnight and Horizon names the
        // digest for the finishing date (Sep 4). Freshness is by mtime; ids carry the filename date.
        const now = new Date(Date.now() - 5 * 60_000); // run start: 5 min ago, real clock
        const { docs } = await processIngestionIO(
            { out: OUT_FILE },
            { data_dir: join(FIXTURES_DIR, 'data'), languages: ['en'] },
            async () => {
                const summaries = join(FIXTURES_DIR, 'data', 'summaries');
                await mkdir(summaries, { recursive: true });
                await writeFile(join(summaries, 'horizon-2999-12-31-en.md'), DIGEST); // "next-day" name
                return { exitCode: 0, stderr: '' };
            },
            now,
        );
        expect(docs).toHaveLength(2);
        expect(docs[0]?.id).toBe('horizon:2999-12-31-tech-news-1');
    });

    test('stale digest from an earlier run (old mtime) emits [] with exit 0', async () => {
        const now = new Date('2026-09-04T12:00:00Z');
        const { docs } = await processIngestionIO(
            { out: OUT_FILE },
            { data_dir: join(FIXTURES_DIR, 'data'), languages: ['en'] },
            async () => {
                const summaries = join(FIXTURES_DIR, 'data', 'summaries');
                await mkdir(summaries, { recursive: true });
                const file = join(summaries, 'horizon-2026-08-30-en.md');
                await writeFile(file, DIGEST);
                await utimes(file, new Date('2026-08-30'), new Date('2026-08-30')); // stale
                return { exitCode: 0, stderr: '' };
            },
            now,
        );
        expect(docs).toEqual([]);
    });

    test('no fresh digest this run falls back to the newest digest within stale_fallback_ms', async () => {
        const now = new Date('2026-09-04T12:00:00Z');
        const { docs } = await processIngestionIO(
            { out: OUT_FILE },
            { data_dir: join(FIXTURES_DIR, 'data'), languages: ['en'] },
            async () => {
                const summaries = join(FIXTURES_DIR, 'data', 'summaries');
                await mkdir(summaries, { recursive: true });
                const file = join(summaries, 'horizon-2026-08-30-en.md');
                await writeFile(file, DIGEST);
                await utimes(file, new Date('2026-09-04T06:00:00Z'), new Date('2026-09-04T06:00:00Z')); // 6h old
                return { exitCode: 0, stderr: '' };
            },
            now,
        );
        expect(docs).toHaveLength(2);
        expect(docs[0]?.id).toBe('horizon:2026-08-30-tech-news-1');
    });

    test('fallback is capped by stale_fallback_ms (0 disables it)', async () => {
        const now = new Date('2026-09-04T12:00:00Z');
        const { docs } = await processIngestionIO(
            { out: OUT_FILE },
            { data_dir: join(FIXTURES_DIR, 'data'), languages: ['en'], stale_fallback_ms: 0 },
            async () => {
                const summaries = join(FIXTURES_DIR, 'data', 'summaries');
                await mkdir(summaries, { recursive: true });
                const file = join(summaries, 'horizon-2026-08-30-en.md');
                await writeFile(file, DIGEST);
                await utimes(file, new Date('2026-09-04T06:00:00Z'), new Date('2026-09-04T06:00:00Z'));
                return { exitCode: 0, stderr: '' };
            },
            now,
        );
        expect(docs).toEqual([]);
    });

    test('fails loud when horizon exits non-zero', async () => {
        await expect(
            processIngestionIO({ out: OUT_FILE }, { data_dir: join(FIXTURES_DIR, 'data') }, fakeRunner(2, 'uv boom')),
        ).rejects.toThrow('horizon exited 2: uv boom');
    });
});

describe('defaultRunner (fake uv via HORIZON_UV)', () => {
    test('spawns uv run horizon, then parses the fresh digest it wrote', async () => {
        const binDir = join(FIXTURES_DIR, 'bin');
        const summaries = join(FIXTURES_DIR, 'data', 'summaries');
        await mkdir(binDir, { recursive: true });
        await mkdir(summaries, { recursive: true });
        // fake uv: "runs horizon" by copying a pre-written digest into summaries/, exits 0
        const digestSource = join(FIXTURES_DIR, 'digest-source.md');
        await writeFile(digestSource, DIGEST);
        const fakeUv = join(binDir, 'uv');
        await writeFile(
            fakeUv,
            `#!/usr/bin/env bun
await Bun.write(${JSON.stringify(join(summaries, 'horizon-2026-09-03-en.md'))}, await Bun.file(${JSON.stringify(digestSource)}).text());
`,
        );
        await chmod(fakeUv, 0o755);
        process.env.HORIZON_UV = fakeUv;
        try {
            const { docs } = await processIngestionIO(
                { out: OUT_FILE },
                { data_dir: join(FIXTURES_DIR, 'data'), horizon_dir: FIXTURES_DIR, languages: ['en'] },
            );
            expect(docs).toHaveLength(2);
            expect(docs[0]?.id).toBe('horizon:2026-09-03-tech-news-1');
        } finally {
            delete process.env.HORIZON_UV;
        }
    });
});

describe('main', () => {
    test('returns 1 when --in/--out are missing', async () => {
        const original = process.argv;
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main(fakeRunner())).toBe(1);
        } finally {
            process.argv = original;
        }
    });

    test('returns 0 on success and 1 when horizon fails', async () => {
        const original = process.argv;
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(join(FIXTURES_DIR, 'cfg.json'), JSON.stringify({ data_dir: join(FIXTURES_DIR, 'data') }));
        try {
            process.argv = ['bun', 'index.ts', '--in', join(FIXTURES_DIR, 'cfg.json'), '--out', OUT_FILE];
            expect(await main(fakeRunner())).toBe(0);
            expect(await main(fakeRunner(2, 'uv boom'))).toBe(1);
        } finally {
            process.argv = original;
        }
    });
});
