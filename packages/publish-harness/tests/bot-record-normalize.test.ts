import { describe, expect, test } from 'bun:test';
import { type DomNode, normalizeTarget, selectorFor } from '../src/bot-record-normalize';

function node(overrides: Partial<DomNode> & { path: string }): DomNode {
    return { tag: 'button', visible: true, ...overrides };
}

/** Snapshot whose target is the last node, so each case reads target-first at the call site. */
function withTarget(target: DomNode, siblings: DomNode[] = []): DomNode[] {
    return [...siblings, target];
}

describe('normalizeTarget ranking', () => {
    test('a data-testid wins over every weaker attribute on the same node', () => {
        const target = node({
            path: 'main > button:nth-of-type(1)',
            testid: 'SideNav_NewTweet_Button',
            name: 'post',
            ariaLabel: 'Post',
            role: 'button',
            text: 'Post',
        });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toEqual({
            selector: '[data-testid="SideNav_NewTweet_Button"]',
            rank: 'testid',
        });
    });

    test('name outranks aria-label, role+text and text', () => {
        const target = node({ path: 'form > input', tag: 'input', name: 'title', ariaLabel: 'Title', text: 'Title' });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toEqual({
            selector: '[name="title"]',
            rank: 'name',
        });
    });

    test('an exact aria-label is used before role+text', () => {
        const target = node({ path: 'main > div > button', ariaLabel: 'Post text', role: 'button', text: 'Post' });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toEqual({
            selector: '[aria-label="Post text"]',
            rank: 'aria',
        });
    });

    test('role with exact text is preferred over bare text', () => {
        const target = node({ path: 'main > div > div', role: 'button', text: 'New thread' });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toEqual({
            selector: '[role="button"]:text-is("New thread")',
            rank: 'role-text',
        });
    });

    test('bare exact text is the last non-structural rank', () => {
        const target = node({ path: 'main > div > span', tag: 'span', text: 'Publish' });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toEqual({
            selector: 'text="Publish"',
            rank: 'text',
        });
    });

    test('with no stable attribute at all it falls back to the structural path', () => {
        const target = node({ path: 'main > div:nth-of-type(2) > button:nth-of-type(1)' });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toEqual({
            selector: 'main > div:nth-of-type(2) > button:nth-of-type(1)',
            rank: 'path',
        });
    });
});

describe('normalizeTarget rejections', () => {
    test('a target that was not visible is dropped instead of recorded', () => {
        const target = node({ path: 'main > button', testid: 'hidden-post', visible: false });

        expect(normalizeTarget({ nodes: withTarget(target), targetIndex: 0 })).toBeNull();
    });

    test('a hidden duplicate is skipped, so the visible node keeps its attribute tier', () => {
        const hidden = node({ path: 'main > div[hidden] > div', role: 'button', text: 'New thread', visible: false });
        const visible = node({ path: 'main > div > div', role: 'button', text: 'New thread' });

        expect(normalizeTarget({ nodes: [hidden, visible], targetIndex: 1 })).toEqual({
            selector: '[role="button"]:text-is("New thread")',
            rank: 'role-text',
        });
    });

    test('two visible nodes sharing the only attribute are ambiguous, never silently narrowed', () => {
        const first = node({ path: 'main > div:nth-of-type(1)', testid: 'tweetButton', text: 'Post' });
        const second = node({ path: 'main > div:nth-of-type(2)', testid: 'tweetButton', text: 'Post' });

        expect(normalizeTarget({ nodes: [first, second], targetIndex: 1 })).toEqual({
            ambiguous: true,
            candidates: ['main > div:nth-of-type(1)', 'main > div:nth-of-type(2)'],
        });
    });

    test('ambiguity stops at five candidates but still reports it', () => {
        const nodes = Array.from({ length: 7 }, (_, index) =>
            node({ path: `main > div:nth-of-type(${index + 1})`, ariaLabel: 'Reply' }),
        );

        const resolved = normalizeTarget({ nodes, targetIndex: 3 });
        expect(resolved).not.toBeNull();
        expect(resolved !== null && 'ambiguous' in resolved).toBe(true);
        expect(resolved !== null && 'candidates' in resolved ? resolved.candidates.length : 0).toBe(5);
    });

    test('an out-of-range target index is dropped rather than guessed', () => {
        expect(normalizeTarget({ nodes: [node({ path: 'main > button' })], targetIndex: 4 })).toBeNull();
    });

    test('a class attribute is never read, so a hashed class cannot reach a selector', () => {
        const target = node({ path: 'main > div.mxtl-2a3b > button.r-1u9xkd', text: 'Post' });

        const resolved = normalizeTarget({ nodes: withTarget(target), targetIndex: 0 });
        expect(resolved).toEqual({ selector: 'text="Post"', rank: 'text' });
        expect(JSON.stringify(resolved)).not.toMatch(/(^|[^\w-])r-|mxtl|css-/);
    });
});

describe('selectorFor', () => {
    test('a recorded path with stable attributes converts to the same rank the normalizer emits', () => {
        const path =
            'div > div > div[data-testid="tweetTextarea_0RichTextInputContainer"] > div > div > div[data-testid="tweetTextarea_0"][aria-label="Post text"][role="textbox"][contenteditable="true"]';

        expect(selectorFor(path, '')).toEqual({ selector: '[data-testid="tweetTextarea_0"]', rank: 'testid' });
    });

    test('a path carrying only aria-label and role uses the aria tier', () => {
        expect(selectorFor('main > div[aria-label="Post"][role="link"]', '')).toEqual({
            selector: '[aria-label="Post"]',
            rank: 'aria',
        });
    });

    test('role plus recorded text resolves to the role-text tier', () => {
        expect(selectorFor('main > div[role="button"]', 'New thread')).toEqual({
            selector: '[role="button"]:text-is("New thread")',
            rank: 'role-text',
        });
    });

    test('a bare path with no attribute and no text stays structural', () => {
        expect(selectorFor('main > div:nth-of-type(2)', '')).toEqual({
            selector: 'main > div:nth-of-type(2)',
            rank: 'path',
        });
    });
});
