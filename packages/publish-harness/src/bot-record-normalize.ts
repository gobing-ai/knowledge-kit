/**
 * Stable-selector normalization for recorded bot sessions (task 0382 R2).
 *
 * Every recorded click resolves to one selector by a fixed rank, and the rank never reads a class
 * name: the 2026-11-16 recordings show why — LinkedIn and X ship hashed `r-*`/`mxtl*` families that
 * change between deploys, while `data-testid` and `aria-label` survived. The rank is a pure function
 * over a DOM snapshot so it is unit-testable without a browser; the recorder builds the snapshot
 * in the page (it needs the live DOM) and the host resolves it here, so rank logic exists once.
 */

/** Where an emitted selector came from, strongest first. `path` is structural-only. */
export type SelectorRank = 'testid' | 'name' | 'aria' | 'role-text' | 'text' | 'path';

/** One interactive node as the in-page snapshot builder describes it. */
export interface DomNode {
    /** Lowercased tag name. */
    tag: string;
    /** `data-testid` attribute, when present and non-empty. */
    testid?: string;
    /** `name` attribute (form controls). */
    name?: string;
    /** Exact `aria-label` attribute. */
    ariaLabel?: string;
    /** `role` attribute. */
    role?: string;
    /** Trimmed, whitespace-collapsed `textContent`, capped by the snapshot builder. */
    text?: string;
    /** Whether the node was visible when the event fired. */
    visible: boolean;
    /** Structural path built only from tags, `nth-of-type` and stable attributes — unique per node. */
    path: string;
}

/** The DOM the event target sat in: every interactive node in document order, plus the target index. */
export interface DomTargetSnapshot {
    nodes: DomNode[];
    /** Index of the event target's resolved interactive ancestor in `nodes`; -1 when none resolved. */
    targetIndex: number;
}

/** A resolved selector, or an explicit ambiguity the operator must resolve by hand. */
export type NormalizedSelector = { selector: string; rank: SelectorRank } | { ambiguous: true; candidates: string[] };

/** Candidate cap on an ambiguous target: enough to disambiguate, small enough to read. */
const MAX_AMBIGUOUS_CANDIDATES = 5;

/** Quote a selector value, escaping the delimiter so an attribute value can never break out. */
function quoteValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

interface Tier {
    rank: Exclude<SelectorRank, 'path'>;
    build(node: DomNode): { selector: string; matches(candidate: DomNode): boolean } | undefined;
}

/** The rank, strongest first: `data-testid` > `name` > exact `aria-label` > `role`+text > text. */
const TIERS: readonly Tier[] = [
    {
        rank: 'testid',
        build: (node) =>
            node.testid === undefined || node.testid === ''
                ? undefined
                : {
                      selector: `[data-testid="${quoteValue(node.testid)}"]`,
                      matches: (candidate) => candidate.testid === node.testid,
                  },
    },
    {
        rank: 'name',
        build: (node) =>
            node.name === undefined || node.name === ''
                ? undefined
                : {
                      selector: `[name="${quoteValue(node.name)}"]`,
                      matches: (candidate) => candidate.name === node.name,
                  },
    },
    {
        rank: 'aria',
        build: (node) =>
            node.ariaLabel === undefined || node.ariaLabel === ''
                ? undefined
                : {
                      selector: `[aria-label="${quoteValue(node.ariaLabel)}"]`,
                      matches: (candidate) => candidate.ariaLabel === node.ariaLabel,
                  },
    },
    {
        rank: 'role-text',
        build: (node) =>
            node.role === undefined || node.role === '' || node.text === undefined || node.text === ''
                ? undefined
                : {
                      selector: `[role="${quoteValue(node.role)}"]:text-is("${quoteValue(node.text)}")`,
                      matches: (candidate) => candidate.role === node.role && candidate.text === node.text,
                  },
    },
    {
        rank: 'text',
        build: (node) =>
            node.text === undefined || node.text === ''
                ? undefined
                : {
                      selector: `text="${quoteValue(node.text)}"`,
                      matches: (candidate) => candidate.text === node.text,
                  },
    },
];

/**
 * Resolve one event target to a stable selector, or `null` when it must be dropped.
 *
 * A dropped target is either invisible at record time (the DOM carries hidden duplicates — the
 * Threads "New thread" control has one, which is why a text locator clicked an invisible node) or
 * an index the snapshot never had. A target whose best candidate matches more than one visible node
 * is returned as `ambiguous` with the colliding structural paths, never silently narrowed; the
 * structural path itself is unique per node, so it is the last resort and cannot be ambiguous.
 */
export function normalizeTarget(snapshot: DomTargetSnapshot): NormalizedSelector | null {
    const target = snapshot.nodes[snapshot.targetIndex];
    if (target === undefined || !target.visible) return null;
    const visible = snapshot.nodes.filter((candidate) => candidate.visible);

    for (const tier of TIERS) {
        const candidate = tier.build(target);
        if (candidate === undefined) continue;
        const hits = visible.filter(candidate.matches);
        if (hits.length === 0) continue;
        if (hits.length === 1) return { selector: candidate.selector, rank: tier.rank };
        return {
            ambiguous: true,
            candidates: hits.slice(0, MAX_AMBIGUOUS_CANDIDATES).map((hit) => hit.path),
        };
    }

    return { selector: target.path, rank: 'path' };
}

/** Parse one attribute value out of a recorded structural path (`[aria-label="Post"]`). */
function attributeIn(segment: string, name: string): string | undefined {
    const match = new RegExp(`\\[${name}="([^"]*)"\\]`).exec(segment);
    return match?.[1] === undefined ? undefined : match[1].replaceAll('\\"', '"');
}

/**
 * Convert a recorded structural path (the pre-0382 recording format, and the fallback the
 * normalizer emits) into the same ranked selector shape. Used to build fixtures from the two
 * 2026-11-16 transcripts and by codegen when it reads a `path`-ranked step.
 */
export function selectorFor(path: string, text: string): NormalizedSelector {
    // The target is the last descriptor on the recorded path; ancestors carry their own attributes.
    // shortcut: a text value containing ' > ' mis-splits here, so the tier falls back to the whole
    // path; upgrade to a real descriptor parser if a site's labels ever carry that separator.
    const segment = path.split(' > ').at(-1) ?? path;
    const candidate: DomNode = {
        tag: 'unknown',
        path,
        visible: true,
        ...(attributeIn(segment, 'data-testid') === undefined ? {} : { testid: attributeIn(segment, 'data-testid') }),
        ...(attributeIn(segment, 'name') === undefined ? {} : { name: attributeIn(segment, 'name') }),
        ...(attributeIn(segment, 'aria-label') === undefined ? {} : { ariaLabel: attributeIn(segment, 'aria-label') }),
        ...(attributeIn(segment, 'role') === undefined ? {} : { role: attributeIn(segment, 'role') }),
        ...(text === '' ? {} : { text }),
    };
    // A single-node snapshot: the recorded path carries no sibling list, so every tier it can
    // satisfy matches exactly one node and cannot be ambiguous.
    const resolved = normalizeTarget({ nodes: [candidate], targetIndex: 0 });
    return resolved ?? { selector: path, rank: 'path' };
}
