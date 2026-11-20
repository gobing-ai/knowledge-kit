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
 * 0409: a digest post carries zh/en/ja siblings, and the real orchestrator
 * refines EVERY locale file it discovers — so this fake stamps the siblings too
 * (locale-appropriate digest values), otherwise the publisher's locale-set gate
 * would judge half-refined posts that the real site never produces.
 *
 * Invoked as: <this> publish <markdown-path>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';

/** Per-locale digest values the site's seo-digest refine emits, keyed by locale directory. */
const DIGEST_BY_LOCALE = {
    zh: {
        series: '每日AI乱炖',
        separator: '：',
        listSeparator: '、',
        description:
            '本期两条主线：迪士尼正式买下 Character.AI，微软推出「医疗超级智能」新模型。两家公司都把赌注押在个性化智能体上。完整分析见正文，详情逐条展开。',
        badDescription: '太短。',
        // The digest contract ties headlines to the LEADING key_points labels, so the refine
        // stub emits the labels themselves — exactly what the site's retitle stamps.
        headlines: ['迪士尼', '微软'],
        badHeadline: ['全标题'],
        keyPoints: ['迪士尼 — 迪士尼确认收购 Character.AI，交易已宣布。', '微软 — 微软发布「医疗超级智能」模型。'],
        badKeyPoints: ['一条'],
    },
    en: {
        series: 'Daily AI Stew',
        separator: ': ',
        listSeparator: ', ',
        // 153 code points: inside the en digest window (120–155) and inside the 60-char title budget.
        description:
            'Disney agreed to buy Character.AI while Microsoft shipped its care superintelligence model, moving both bets closer to the people who use daily AI tools.',
        badDescription: 'Too short.',
        headlines: ['Disney', 'Microsoft'],
        badHeadline: ['Whole title'],
        keyPoints: [
            'Disney — Disney confirmed the Character.AI acquisition today.',
            'Microsoft — Microsoft launched its care superintelligence model.',
        ],
        badKeyPoints: ['One item'],
    },
    ja: {
        series: 'デイリーAIシチュー',
        separator: '：',
        listSeparator: '、',
        description:
            '今号の本題は二つです。ディズニーがCharacter.AIの買収を決め、マイクロソフトは医療分野のスーパーインテリジェンスを公開しました。どちらも個別化エージェントへの賭けです。',
        badDescription: '短い。',
        headlines: ['ディズニー', 'マイクロソフト'],
        badHeadline: ['全体'],
        keyPoints: [
            'ディズニー — ディズニーがCharacter.AIの買収を発表した。',
            'マイクロソフト — 医療AIモデルを公開した。',
        ],
        badKeyPoints: ['一つ'],
    },
} as const;

type Locale = keyof typeof DIGEST_BY_LOCALE;

/** Locale directory of a post path, or undefined when the path is not inside a locale tree. */
function localeOf(file: string): Locale | undefined {
    const segments = file.split(sep);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        if (segment === 'zh' || segment === 'en' || segment === 'ja') return segment;
    }
    return undefined;
}

/** Refines one post file in place; mirrors the site's seo-digest rewrite for digest posts. */
function refine(file: string): void {
    const raw = readFileSync(file, 'utf-8');
    if (raw.includes('refined: true')) return;
    const locale = localeOf(file) ?? 'zh';
    const values = DIGEST_BY_LOCALE[locale];
    const closing = raw.indexOf('\n---\n');
    const body = closing < 0 ? '' : raw.slice(closing);
    if (/sub-category:ai-daily/.test(raw)) {
        const bad = process.env.FAKE_POSTSURFING_BAD_DIGEST === '1';
        const date = (raw.match(/publishDate: "?(\d{4}-\d{2}-\d{2})"?/) ?? [])[1] ?? '2026-01-01';
        const headlines = bad ? values.badHeadline : values.headlines;
        const title = `${values.series} · ${date}${values.separator}${headlines.join(values.listSeparator)}`;
        const description = bad ? values.badDescription : values.description;
        const keyPoints = bad ? values.badKeyPoints : values.keyPoints;
        const head = closing < 0 ? raw : raw.slice(0, closing);
        const stamped =
            head
                .replace(/^title: .*$/m, `title: ${JSON.stringify(title)}`)
                .replace(/^description: .*$/m, `description: ${JSON.stringify(description)}`) +
            '\nkey_points:\n' +
            keyPoints.map((point: string) => `  - ${JSON.stringify(point)}`).join('\n') +
            '\nrefined: true' +
            body;
        writeFileSync(file, stamped);
        return;
    }
    writeFileSync(file, closing < 0 ? raw : `${raw.slice(0, closing)}\nrefined: true${body}`);
}

const file = process.argv[3];
if (!file) {
    console.error('fake-postsufing: missing post path');
    process.exit(2);
}
refine(file);
// Only a DIGEST pulls its siblings through refine: that is the locale set the site's orchestrator
// validates, and touching a prepared post's non-primary bytes would break the locale fingerprint
// the prepared-publish path checks after the spawn.
if (file.includes(`${sep}zh${sep}`) && /sub-category:ai-daily/.test(readFileSync(file, 'utf-8'))) {
    for (const locale of ['en', 'ja']) {
        const sibling = file.replace(`${sep}zh${sep}`, `${sep}${locale}${sep}`);
        if (existsSync(sibling)) refine(sibling);
    }
}
console.log('Published');
process.exit(0);
