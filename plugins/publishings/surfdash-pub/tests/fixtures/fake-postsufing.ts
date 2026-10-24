#!/usr/bin/env bun
/**
 * Stand-in for the real `postsurfing`/`sd publish` binary.
 *
 * The publisher's contract check (ADR-008) requires the site's refine step to
 * have run, so a "successful" fake CLI must also stamp `refined: true` into the
 * post it was handed — exactly what surfdash's refine step does. For digest
 * content (tags carry sub-category:ai-daily) the refine step rewrites the
 * series title/description/key_points (seo-digest contract), so the fake
 * stamps realistic values that satisfy checkDigestFrontmatter. Set
 * FAKE_POSTSURFING_BAD_DIGEST=1 to emit the date-only regression shape and
 * exercise the publisher's digest gate.
 *
 * Invoked as: <this> publish <markdown-path>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[3];
if (!file) {
    console.error('fake-postsufing: missing post path');
    process.exit(2);
}
const raw = readFileSync(file, 'utf-8');
if (!raw.includes('refined: true')) {
    const closing = raw.indexOf('\n---\n');
    let stamped: string;
    if (/sub-category:ai-daily/.test(raw)) {
        const bad = process.env.FAKE_POSTSURFING_BAD_DIGEST === '1';
        const date = (raw.match(/publishDate: "?(\d{4}-\d{2}-\d{2})"?/) ?? [])[1] ?? '2026-01-01';
        const title = bad
            ? `每日AI乱炖 · ${date}` // date-only shape: the 2026-10-21 regression
            : `每日AI乱炖 · ${date}：迪士尼买下 Character.AI、微软「医疗超级智能」`;
        const description = bad
            ? '太短。'
            : '本期两条主线：迪士尼正式买下 Character.AI，微软推出「医疗超级智能」新模型。两家公司都把赌注押在个性化智能体上。完整分析见正文，详情逐条展开。';
        const keyPoints = bad
            ? ['一条']
            : ['迪士尼 — 迪士尼确认收购 Character.AI，交易已宣布。', '微软 — 微软发布「医疗超级智能」模型。'];
        const head = closing < 0 ? raw : raw.slice(0, closing);
        const body = closing < 0 ? '' : raw.slice(closing);
        stamped =
            head
                .replace(/^title: .*$/m, `title: ${JSON.stringify(title)}`)
                .replace(/^description: .*$/m, `description: ${JSON.stringify(description)}`) +
            '\nkey_points:\n' +
            keyPoints.map((point) => `  - ${JSON.stringify(point)}`).join('\n') +
            '\nrefined: true' +
            body;
    } else {
        stamped = closing < 0 ? raw : `${raw.slice(0, closing)}\nrefined: true${raw.slice(closing)}`;
    }
    writeFileSync(file, stamped);
}
console.log('Published');
process.exit(0);
