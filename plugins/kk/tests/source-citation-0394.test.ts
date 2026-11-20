import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyEditorialRender } from '../scripts/daily-stages';
import { AGGREGATOR_MARKER, resolveSourceCitation } from '../scripts/source-citation';

let stageLog: { mockRestore(): void };
let stageError: { mockRestore(): void };
beforeEach(() => {
    stageLog = spyOn(console, 'log').mockImplementation(() => {});
    stageError = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    stageLog.mockRestore();
    stageError.mockRestore();
});

/**
 * 0394 R1/R16 — the rendered 来源 link points at a verifiable actual origin, never at a transport
 * label wearing the retrieval URL's clothes.
 *
 * The four shapes the acceptance criteria name: a direct RSS source stays as-is, an aggregator URL
 * with a corroborated original cites the original, an aggregator URL with no corroboration falls
 * back explicitly, and a doc with no link candidates renders no citation at all.
 */
describe('0394 resolveSourceCitation', () => {
    it('keeps a direct RSS source as-is: destination host, corroborated classification label', () => {
        const doc = { sourceUri: 'https://openai.com/index/gpt-5', metadata: { source: 'openai.com' } };
        expect(resolveSourceCitation(doc, 'https://openai.com/index/gpt-5')).toEqual({
            url: 'https://openai.com/index/gpt-5',
            label: 'openai.com',
            kind: 'direct',
        });
        // Classification that does not describe the destination is not allowed to name it: the
        // transport (`rss`) is not a publisher, so the verified host labels the link instead.
        const transport = { sourceUri: 'https://openai.com/index/gpt-5', metadata: { source: 'rss' } };
        expect(resolveSourceCitation(transport, 'https://openai.com/index/gpt-5')).toEqual({
            url: 'https://openai.com/index/gpt-5',
            label: 'openai.com',
            kind: 'direct',
        });
        // No metadata at all (older stored docs): the host is still the identity.
        expect(resolveSourceCitation(null, 'https://www.example.com/a')).toEqual({
            url: 'https://www.example.com/a',
            label: 'example.com',
            kind: 'direct',
        });
    });

    it('cites a corroborated original when an aggregator URL carries an off-origin reference', () => {
        const doc = {
            sourceUri: 'https://news.ycombinator.com/item?id=1',
            metadata: { source: 'hackernews', references: ['https://openai.com/index/gpt-5'] },
        };
        // Normalised output is what is linked: never the aggregator page.
        expect(resolveSourceCitation(doc, 'https://news.ycombinator.com/item?id=1')).toEqual({
            url: 'https://openai.com/index/gpt-5',
            label: 'openai.com',
            kind: 'original',
        });
        // Reference encoding is decoded by the URL parser; the identity is the host that carries it.
        const encoded = {
            sourceUri: 'https://reddit.com/r/ml/abc',
            metadata: { source: 'reddit', references: ['https://Example.COM:443/post%2Fx?utm=1'] },
        };
        expect(resolveSourceCitation(encoded, 'https://reddit.com/r/ml/abc')).toEqual({
            url: 'https://example.com/post%2Fx?utm=1',
            label: 'example.com',
            kind: 'original',
        });
        // Several references on the SAME origin still corroborate one original; the first wins.
        const sameOrigin = {
            sourceUri: 'https://news.ycombinator.com/item?id=2',
            metadata: {
                source: 'hackernews',
                references: ['https://openai.com/a', 'https://openai.com/b', 'https://openai.com/a'],
            },
        };
        expect(resolveSourceCitation(sameOrigin, 'https://news.ycombinator.com/item?id=2')).toEqual({
            url: 'https://openai.com/a',
            label: 'openai.com',
            kind: 'original',
        });
    });

    it('keeps a publisher retrieval URL when references are only secondary citations', () => {
        // A publisher page is already the verifiable origin: an off-origin reference must not displace
        // it (review finding 1 probe — this used to cite arxiv.org over the item's own page).
        const publisher = {
            sourceUri: 'https://openai.com/index/gpt-5',
            metadata: { source: 'openai.com', references: ['https://arxiv.org/abs/2501.00001'] },
        };
        expect(resolveSourceCitation(publisher, 'https://openai.com/index/gpt-5')).toEqual({
            url: 'https://openai.com/index/gpt-5',
            label: 'openai.com',
            kind: 'direct',
        });
        // Same for an unclassified retrieval URL that is not a transport: the host labels it.
        const unclassified = {
            sourceUri: 'https://example.com/alpha',
            metadata: { source: 'hackernews', references: ['https://ref.example/1'] },
        };
        expect(resolveSourceCitation(unclassified, 'https://example.com/alpha')).toEqual({
            url: 'https://example.com/alpha',
            label: 'example.com',
            kind: 'direct',
        });
    });

    it('never cites a reference that lands on a known aggregator host as a bare original', () => {
        // The reference is itself a transport page: it corroborates nothing, so the aggregator
        // retrieval URL keeps the citation — with the 聚合 marker, never a bare `original`.
        const transportReference = {
            sourceUri: 'https://news.ycombinator.com/item?id=6',
            metadata: { source: 'hackernews', references: ['https://reddit.com/r/ml/zz'] },
        };
        expect(resolveSourceCitation(transportReference, 'https://news.ycombinator.com/item?id=6')).toEqual({
            url: 'https://news.ycombinator.com/item?id=6',
            label: `news.ycombinator.com${AGGREGATOR_MARKER}`,
            kind: 'aggregator-fallback',
        });
        // Aggregator reference over a publisher retrieval: the publisher page stays authoritative.
        const publisherWithTransportRef = {
            sourceUri: 'https://openai.com/index/gpt-5',
            metadata: { source: 'openai.com', references: ['https://news.ycombinator.com/item?id=7'] },
        };
        expect(resolveSourceCitation(publisherWithTransportRef, 'https://openai.com/index/gpt-5')).toEqual({
            url: 'https://openai.com/index/gpt-5',
            label: 'openai.com',
            kind: 'direct',
        });
        // No retrieval URL at all and only a transport reference: marked, not presented as an original.
        const transportOnly = { metadata: { references: ['https://reddit.com/r/ml/yy'] } };
        expect(resolveSourceCitation(transportOnly, '')).toEqual({
            url: 'https://reddit.com/r/ml/yy',
            label: `reddit.com${AGGREGATOR_MARKER}`,
            kind: 'aggregator-fallback',
        });
    });

    it('falls back to an explicit aggregator label when no original can be corroborated', () => {
        const noRefs = {
            sourceUri: 'https://news.ycombinator.com/item?id=3',
            metadata: { source: 'hackernews', references: [] },
        };
        expect(resolveSourceCitation(noRefs, 'https://news.ycombinator.com/item?id=3')).toEqual({
            url: 'https://news.ycombinator.com/item?id=3',
            label: `news.ycombinator.com${AGGREGATOR_MARKER}`,
            kind: 'aggregator-fallback',
        });
        // Only same-origin references: the aggregator page is still all that is verified.
        const sameOriginOnly = {
            sourceUri: 'https://reddit.com/r/ml/xyz',
            metadata: { source: 'reddit', references: ['https://reddit.com/r/ml/xyz', 'not-a-url'] },
        };
        expect(resolveSourceCitation(sameOriginOnly, 'https://reddit.com/r/ml/xyz')).toEqual({
            url: 'https://reddit.com/r/ml/xyz',
            label: `reddit.com${AGGREGATOR_MARKER}`,
            kind: 'aggregator-fallback',
        });
        // Conflicting references prove nothing about which is the publisher: never pick one.
        const conflicting = {
            sourceUri: 'https://news.ycombinator.com/item?id=4',
            metadata: { source: 'hackernews', references: ['https://a.example/x', 'https://b.example/y'] },
        };
        expect(resolveSourceCitation(conflicting, 'https://news.ycombinator.com/item?id=4')).toEqual({
            url: 'https://news.ycombinator.com/item?id=4',
            label: `news.ycombinator.com${AGGREGATOR_MARKER}`,
            kind: 'aggregator-fallback',
        });
        // An unclassified aggregator page is not promoted to a publisher either: the host labels it,
        // and a transport that is not a known aggregator keeps its verified host without a marker.
        expect(
            resolveSourceCitation(
                { sourceUri: 'https://news.ycombinator.com/item?id=5' },
                'https://news.ycombinator.com/item?id=5',
            ),
        ).toEqual({
            url: 'https://news.ycombinator.com/item?id=5',
            label: 'news.ycombinator.com',
            kind: 'direct',
        });
    });

    it('returns null when there is no link candidate at all', () => {
        expect(resolveSourceCitation(null, '')).toBeNull();
        expect(resolveSourceCitation({}, 'javascript:alert(1)')).toBeNull();
        expect(resolveSourceCitation({ metadata: { references: ['mailto:a@b.c'] } }, '   ')).toBeNull();
        // A usable reference is still evidence when the retrieval URL is unusable.
        expect(resolveSourceCitation({ metadata: { references: ['https://p.example/y'] } }, 'not-a-url')).toEqual({
            url: 'https://p.example/y',
            label: 'p.example',
            kind: 'original',
        });
    });
});

describe('0394 editorial-render citation', () => {
    const renderArticle = (docs: Record<string, unknown>[]): string => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-0394-'));
        const date = '20261118';
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '24-script'), { recursive: true });
        writeFileSync(join(workDir, '21-plan', `${date}_03_plan_plan.json`), JSON.stringify(docs));
        writeFileSync(
            join(workDir, '24-script', `${date}_08_script-write_plan.json`),
            JSON.stringify({
                outro: '下期见。',
                items: docs.map((doc) => ({ id: doc.id, lead: '导语。', insight: '洞见。' })),
            }),
        );
        dailyEditorialRender([workDir, date, 'false', '6']);
        const body = readFileSync(join(workDir, '22-article', `${date}_06_article-write_body.md`), 'utf-8');
        rmSync(workDir, { recursive: true, force: true });
        return body;
    };

    it('renders the corroborated original URL and host, not the transport label', () => {
        const body = renderArticle([
            {
                id: 'horizon:20261118-tech-1',
                title: '标题甲',
                body: '正文甲。',
                sourceUri: 'https://news.ycombinator.com/item?id=9',
                metadata: { source: 'hackernews', references: ['https://openai.com/index/gpt-5'] },
            },
        ]);
        expect(body).toContain('[来源：openai.com](https://openai.com/index/gpt-5)');
        expect(body).not.toContain('news.ycombinator.com](https://news.ycombinator.com');
        expect(body).not.toContain('来源：hackernews');
    });

    it('renders the explicit aggregator fallback and skips the line when there is no link', () => {
        const body = renderArticle([
            {
                id: 'horizon:20261118-tech-1',
                title: '标题甲',
                body: '正文甲。',
                sourceUri: 'https://news.ycombinator.com/item?id=9',
                metadata: { source: 'hackernews' },
            },
            { id: 'horizon:20261118-tech-2', title: '标题乙', body: '正文乙。', sourceUri: '', metadata: {} },
        ]);
        expect(body).toContain(
            `[来源：news.ycombinator.com${AGGREGATOR_MARKER}](https://news.ycombinator.com/item?id=9)`,
        );
        expect(body.match(/\[来源：/g)?.length).toBe(1);
    });
});
