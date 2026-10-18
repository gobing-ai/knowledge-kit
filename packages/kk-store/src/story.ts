/**
 * Deterministic story clustering (G32 D5): the same event reported under two URLs must land on one
 * `story_id`, so tomorrow's selection dedup can drop it. The key is the title alone — stub-length
 * bodies are common (G31 0212 dogfood), so a body would add noise.
 *
 * `storyTokens` is deliberately NOT the plugin's `titleSimilarity`
 * (`plugins/generations/episode-plan-gen/src/index.ts:313-320`): that whole-string character bigram
 * set over-merges unrelated English titles, so this splits scripts — CJK runs become character
 * bigrams (no word boundaries), Latin/digit runs become words.
 *
 * ponytail: no cross-language merge; upgrade path is an embedding backend.
 */

/** How alike two titles must be, and how far back a candidate may have first been seen. */
export interface StoryPolicy {
    /** Jaccard similarity in `(0, 1]` a candidate must reach to absorb the item. */
    threshold: number;
    /** Candidate window, in hours (`first_seen_at >= now - windowHours * 3_600_000`). */
    windowHours: number;
}

/** Default `store.story.threshold`. */
export const DEFAULT_STORY_THRESHOLD = 0.6;
/** Default `store.story.window_hours`. */
export const DEFAULT_STORY_WINDOW_HOURS = 72;
/** The zero-config story policy: the two defaults above. */
export const DEFAULT_STORY_POLICY: StoryPolicy = {
    threshold: DEFAULT_STORY_THRESHOLD,
    windowHours: DEFAULT_STORY_WINDOW_HOURS,
};

/**
 * The URL identity of one item: its own canonical URL plus the links its body points at.
 * `storyIdForUrls` matches on this BEFORE the title pass runs (0316 R1).
 */
export interface StoryUrlIdentity {
    /** The item's own `canonical_url`, when it has one. */
    canonicalUrl?: string;
    /** Canonicalized outbound links found in the item's body. */
    bodyUrls: readonly string[];
}

/** One item `storyIdFor` may cluster a new title against. */
export interface StoryCandidate {
    /** The item's id — the final tiebreak. */
    id: string;
    /** The story root this item belongs to; the match result is this, not `id`. */
    storyId: string;
    title: string;
    /** `items.first_seen_at` — the primary tiebreak (earliest wins). */
    firstSeenAt: number;
    /** The candidate's own canonical URL — matched against a new item's outbound links. */
    canonicalUrl?: string;
    /** Links the candidate's body points at — matched against a new item's own URL. */
    bodyUrls?: readonly string[];
}

/** A trailing outlet suffix (`Headline - Outlet`) never exceeds this many characters. */
const OUTLET_SUFFIX_MAX = 30;
/** The separators an outlet suffix follows: a spaced `-`/`—`, or a `|`/`｜` with optional spaces. */
const OUTLET_SEPARATOR = /\s(?:-|—)\s|\s?[|｜]\s?/g;
/** Punctuation and symbols, replaced by a space so a token never straddles them. */
const PUNCTUATION = /[\p{P}\p{S}]/gu;
/** One script run: a CJK run (bigrammed) or a Latin/digit run (one word), subtracting CJK from word via the v flag. */
const TOKEN_RUN =
    /(?<cjk>[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+)|(?<word>[[\p{L}\p{N}]--[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]]+)/gv;

/**
 * Drop a trailing outlet suffix (`… | The Verge`, `… - Reuters`) when the text after the LAST
 * separator is 1–30 characters. A longer clause is part of the headline, not an outlet (`0227`'s
 * "a long ` - ` clause that is not a suffix" case), so the title is left whole.
 */
function stripOutletSuffix(title: string): string {
    OUTLET_SEPARATOR.lastIndex = 0;
    let last: RegExpExecArray | null = null;
    let match = OUTLET_SEPARATOR.exec(title);
    while (match !== null) {
        last = match;
        match = OUTLET_SEPARATOR.exec(title);
    }
    if (last === null) return title;
    const suffix = title.slice(last.index + last[0].length).trim();
    if (suffix.length === 0 || suffix.length > OUTLET_SUFFIX_MAX) return title;
    return title.slice(0, last.index);
}

/** NFKC + lowercase, outlet suffix dropped, punctuation/symbols turned into spaces. */
function normalizeTitle(title: string): string {
    return stripOutletSuffix(title.normalize('NFKC').toLowerCase()).replace(PUNCTUATION, ' ');
}

/**
 * The title's comparison tokens: CJK runs as character bigrams (a single-character run as that
 * character), Latin/digit runs as whole words. An empty set means the title carries no comparable
 * signal and must never match.
 */
export function storyTokens(title: string): Set<string> {
    const tokens = new Set<string>();
    for (const run of normalizeTitle(title).matchAll(TOKEN_RUN)) {
        const cjk = run.groups?.cjk;
        if (cjk === undefined) {
            tokens.add(run[0]);
            continue;
        }
        const chars = [...cjk];
        if (chars.length === 1) {
            tokens.add(chars[0] as string);
            continue;
        }
        for (let index = 0; index < chars.length - 1; index++) {
            tokens.add(`${chars[index]}${chars[index + 1]}`);
        }
    }
    return tokens;
}

/** Jaccard similarity (`|A∩B| / |A∪B|`); `0` when either side is empty. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const token of a) {
        if (b.has(token)) intersection += 1;
    }
    return intersection / (a.size + b.size - intersection);
}

/** True when `candidate` should win a tie: earliest `firstSeenAt`, then smallest `id`. */
function precedes(candidate: StoryCandidate, best: StoryCandidate): boolean {
    if (candidate.firstSeenAt !== best.firstSeenAt) return candidate.firstSeenAt < best.firstSeenAt;
    return candidate.id < best.id;
}

/**
 * The story root `title` belongs to: the best candidate whose token Jaccard is `>= threshold`
 * (ties → earliest `first_seen_at`, then smallest `id`), or `null` so the caller uses the item's own
 * id. An empty token set never matches. `candidates` are pre-filtered by the caller's window; this
 * function reads no clock and no database.
 */
export function storyIdFor(title: string, candidates: readonly StoryCandidate[], threshold: number): string | null {
    const tokens = storyTokens(title);
    if (tokens.size === 0) return null;
    let best: StoryCandidate | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
        const candidateTokens = storyTokens(candidate.title);
        if (candidateTokens.size === 0) continue;
        const score = jaccard(tokens, candidateTokens);
        if (score < threshold) continue;
        if (best === null || score > bestScore || (score === bestScore && precedes(candidate, best))) {
            best = candidate;
            bestScore = score;
        }
    }
    return best?.storyId ?? null;
}

/**
 * The story root for an item with URL identity `urls`, matched against `candidates` on URL
 * identity alone — the pass that runs BEFORE {@link storyIdFor}.
 *
 * A candidate matches when either side links to the other's own URL: the item's outbound links
 * contain the candidate's `canonical_url`, or the candidate's body links contain the item's own.
 * That is the link-post/primary-source pair (0316: a `simonwillison.net` post about a `claude.dev`
 * article), whose titles share no token and so never reach the Jaccard threshold.
 *
 * Deliberately NOT "any shared URL": two link roundups that happen to cite one page are not the
 * same event, so body-vs-body intersection never merges. Ties resolve like `storyIdFor` —
 * earliest `first_seen_at`, then smallest `id`.
 */
export function storyIdForUrls(urls: StoryUrlIdentity, candidates: readonly StoryCandidate[]): string | null {
    const ownUrl = urls.canonicalUrl;
    const links = new Set(urls.bodyUrls);
    if (ownUrl === undefined && links.size === 0) return null;
    let best: StoryCandidate | null = null;
    for (const candidate of candidates) {
        const candidateOwnUrl = candidate.canonicalUrl;
        const linksToCandidate = candidateOwnUrl !== undefined && candidateOwnUrl !== '' && links.has(candidateOwnUrl);
        const candidateLinksToItem =
            ownUrl !== undefined && ownUrl !== '' && (candidate.bodyUrls ?? []).includes(ownUrl);
        if (!linksToCandidate && !candidateLinksToItem) continue;
        if (best === null || precedes(candidate, best)) best = candidate;
    }
    return best?.storyId ?? null;
}
