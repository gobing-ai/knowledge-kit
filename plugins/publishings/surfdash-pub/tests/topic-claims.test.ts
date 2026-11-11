import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDailyTopicsEntry, isDigestMarkdown, slugFromPostPath, upsertDailyTopicsEntry } from '../src/topic-claims';

/** Realistic digest frontmatter shaped like the 2026-11-08 refined posts. */
const posts = {
    zh: `---
title: "每日AI乱炖 · 2026-11-08：Claude Code、OpenAI 新证明"
description: "Claude Code 被指在请求头里用 curl 带上某个组织的邮箱地址；OpenAI 上周发布了一批新证明，其中一项朝一个长期悬而未决的物理学问题迈进了一步：杨-米尔斯理论究竟是否存在。"
tags:
  - ai-news
  - 'sub-category:ai-daily'
key_points:
  - "Claude Code — 一位评论者说，Claude Code 在私人账号下运行时用 curl 带上了某个组织的邮箱地址；至于它凭什么挑出这个地址、又是怎么把它发出去的，目前并不清楚。"
  - "OpenAI 新证明 — 按他的说法，然后就在上周，OpenAI 发布了一批新证明，其中一项朝一个长期悬而未决的物理问题迈了一步：杨-米尔斯理论究竟是否存在。"
---

正文。
`,
    en: `---
title: "Daily AI Stew · 2026-11-08: Claude Code, OpenAI"
description: "One commenter says Claude Code sent an organizational email address via curl; OpenAI released new proofs last week, one toward Yang–Mills existence."
tags:
  - ai-news
  - 'sub-category:ai-daily'
key_points:
  - "Claude Code — One commenter says Claude Code, running under a private account, sent an organizational email address via curl; how it picked that address and how it sent it remain unclear."
  - "OpenAI — According to the video's author, last week OpenAI released a batch of new proofs, one of which took a step toward a long-open physics question: whether Yang–Mills theory actually exists."
---

Body.
`,
    ja: `---
title: "デイリーAIシチュー · 2026-11-08：Claude Code、OpenAI の新証明"
description: "コメント投稿者によれば Claude Code は curl で組織のメールアドレスを付加。動画の作者の説明では OpenAI は先週新しい証明を公開し、その一つがヤン=ミルズの存在性へ一歩。"
tags:
  - ai-news
  - 'sub-category:ai-daily'
key_points:
  - "Claude Code — あるコメント投稿者によれば、Claude Code は個人アカウントで実行中に curl で組織のメールアドレスを付加していたといい、どうしてそのアドレスを選んだのか、どうやって送ったのかは不明のままです。"
  - "OpenAI の新証明 — 動画の作者の説明では、先週 OpenAI がまとめて新しい証明を公開し、その一つが長く未解決だった物理学の問いに一歩踏み込みました。ヤン=ミルズ理論はそもそも存在するのか、という問いです。"
---

本文。
`,
};

describe('slugFromPostPath and isDigestMarkdown', () => {
    test('reads the folder name from any locale index path', () => {
        expect(slugFromPostPath('/site/content/posts/articles/zh/20261108-ai-2026-11-08/index.md')).toBe(
            '20261108-ai-2026-11-08',
        );
        expect(slugFromPostPath('content/posts/articles/en/20261006-ai/index.md')).toBe('20261006-ai');
        expect(slugFromPostPath('/tmp/not-a-post.md')).toBeUndefined();
    });

    test('detects the digest tag and rejects untagged posts', () => {
        expect(isDigestMarkdown(posts.zh)).toBe(true);
        expect(isDigestMarkdown('---\ntitle: "x"\ntags: [ai-news]\n---\n\n')).toBe(false);
    });
});

describe('buildDailyTopicsEntry', () => {
    test('copies headlines, description, and key-point sentences from the posts', () => {
        const built = buildDailyTopicsEntry(posts);
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        expect(built.entry.zh.headlines).toEqual(['Claude Code', 'OpenAI 新证明']);
        expect(built.entry.zh.key_points).toEqual(['Claude Code', 'OpenAI 新证明']);
        expect(built.entry.zh.description).toContain('Claude Code 被指在请求头里用 curl');
        expect(built.entry.zh.claims[0]).toContain('一位评论者说');
        expect(built.entry.zh.short_claims).toEqual([
            'Claude Code 被指在请求头里用 curl 带上某个组织的邮箱地址',
            'OpenAI 上周发布了一批新证明，其中一项朝一个长期悬而未决的物理学问题迈进了一步：杨-米尔斯理论究竟是否存在。',
        ]);
        expect(built.entry.en.headlines).toEqual(['Claude Code', 'OpenAI']);
        expect(built.entry.en.short_claims[0]).toBe(
            'One commenter says Claude Code sent an organizational email address via curl',
        );
        expect(built.entry.ja.headlines).toEqual(['Claude Code', 'OpenAI の新証明']);
        expect(built.entry.zh).not.toHaveProperty('claim_basis');
    });

    test('fails when the entry cannot be generated confidently', () => {
        const noTitle = buildDailyTopicsEntry({
            ...posts,
            en: posts.en.replace('Daily AI Stew · 2026-11-08: Claude Code, OpenAI', 'Just a title'),
        });
        expect(noTitle.ok).toBe(false);
        if (noTitle.ok) return;
        expect(noTitle.error).toContain('en:');

        const mismatch = buildDailyTopicsEntry({
            ...posts,
            zh: posts.zh.replace('  - "Claude Code —', '  - "Wrong label —'),
        });
        expect(mismatch.ok).toBe(false);
        if (mismatch.ok) return;
        expect(mismatch.error).toContain('do not match');

        const noDesc = buildDailyTopicsEntry({
            ...posts,
            ja: posts.ja.replace(/description: ".*"/, 'description: ""'),
        });
        expect(noDesc.ok).toBe(false);

        const untagged = buildDailyTopicsEntry({
            ...posts,
            zh: posts.zh.replace('sub-category:ai-daily', 'other'),
        });
        expect(untagged.ok).toBe(false);
        if (untagged.ok) return;
        expect(untagged.error).toContain('sub-category:ai-daily');
    });
});

describe('upsertDailyTopicsEntry', () => {
    const sample = buildDailyTopicsEntry(posts);
    if (!sample.ok) throw new Error(sample.error);
    const entry = sample.entry;
    const other = {
        ...entry,
        en: { ...entry.en, description: 'replaced description from the existing key.' },
    };

    test('creates a missing file and inserts the slug once', () => {
        const dir = mkdtempSync(join(tmpdir(), 'daily-topics-'));
        const mapPath = join(dir, 'scripts', 'seo', 'daily-topics.json');
        upsertDailyTopicsEntry(mapPath, '20261108-ai-2026-11-08', entry);
        const raw = readFileSync(mapPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(Object.keys(parsed)).toEqual(['20261108-ai-2026-11-08']);
        expect(parsed['20261108-ai-2026-11-08']).toEqual(entry);
        expect(raw.startsWith('{\n\t')).toBe(true);
        expect(raw.endsWith('\n')).toBe(true);
    });

    test('replaces an existing key in place without adding a second copy', () => {
        const dir = mkdtempSync(join(tmpdir(), 'daily-topics-'));
        const mapPath = join(dir, 'daily-topics.json');
        upsertDailyTopicsEntry(mapPath, '20261107-ai-2026-11-07', entry);
        upsertDailyTopicsEntry(mapPath, '20261108-ai-2026-11-08', entry);
        upsertDailyTopicsEntry(mapPath, '20261108-ai-2026-11-08', other);
        const raw = readFileSync(mapPath, 'utf-8');
        expect((raw.match(/"20261108-ai-2026-11-08"/g) ?? []).length).toBe(1);
        const parsed = JSON.parse(raw) as Record<string, { en: { description: string } }>;
        expect(Object.keys(parsed)).toEqual(['20261107-ai-2026-11-07', '20261108-ai-2026-11-08']);
        expect(parsed['20261108-ai-2026-11-08']?.en.description).toBe('replaced description from the existing key.');
    });

    test('collapses a raw file that already has the same key twice', () => {
        const dir = mkdtempSync(join(tmpdir(), 'daily-topics-'));
        mkdirSync(dir, { recursive: true });
        const mapPath = join(dir, 'daily-topics.json');
        // Invalid JSON object-with-duplicate-keys, the class of bug that broke surfdash #30.
        writeFileSync(
            mapPath,
            '{\n\t"20261108-ai-2026-11-08": {"en":{"headlines":["Old"]}},\n\t"20261107-ai-2026-11-07": {"en":{"headlines":["Keep"]}},\n\t"20261108-ai-2026-11-08": {"en":{"headlines":["Also old"]}}\n}\n',
            'utf-8',
        );
        upsertDailyTopicsEntry(mapPath, '20261108-ai-2026-11-08', entry);
        const raw = readFileSync(mapPath, 'utf-8');
        expect((raw.match(/"20261108-ai-2026-11-08"/g) ?? []).length).toBe(1);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(parsed['20261108-ai-2026-11-08']).toEqual(entry);
        expect(parsed['20261107-ai-2026-11-07']).toEqual({ en: { headlines: ['Keep'] } });
    });

    test('throws on invalid JSON or a non-object document', () => {
        const dir = mkdtempSync(join(tmpdir(), 'daily-topics-'));
        const mapPath = join(dir, 'daily-topics.json');
        writeFileSync(mapPath, '{not json', 'utf-8');
        expect(() => upsertDailyTopicsEntry(mapPath, '20261108-ai-2026-11-08', entry)).toThrow('invalid JSON');
        writeFileSync(mapPath, '[]\n', 'utf-8');
        expect(() => upsertDailyTopicsEntry(mapPath, '20261108-ai-2026-11-08', entry)).toThrow('not a JSON object');
        expect(() => upsertDailyTopicsEntry(mapPath, '  ', entry)).toThrow('empty slug');
    });
});
