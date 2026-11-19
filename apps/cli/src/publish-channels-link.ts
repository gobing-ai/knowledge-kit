/**
 * 0395 — the WeChat Channels card carries only the CONFIRMED Official Account article link (L3 R18).
 *
 * The preset's `shipinhao-pub` / `image` (`variant: cards`) row is a 图文 post whose caption points
 * at the episode's 公众号 article. Two things are wrong with resolving that from the generic
 * `{{article_url}}` placeholder:
 *
 *  1. `{{article_url}}` is the **SurfDash** post (`apps/cli/src/publish-matrix.ts:482`), not the
 *     Official Account article, so the card would send readers somewhere nobody approved.
 *  2. A WeChat draft has NO public URL yet. `wechatmp-pub` publishes a draft and waits for the
 *     operator's QR scan (`effectiveMode`), so before that release there is no confirmed link to
 *     put on a card — and a Channels post that ships without it (or with an episode's neighbour)
 *     cannot be recalled.
 *
 * So the card is gated: it dispatches only when THIS bundle's receipts prove a released Official
 * Account article, and the URL passes a safe-destination check at the trusted boundary. Otherwise
 * the row alone is deferred (`preparePayload` -> effect `none` receipt -> dispatch-ledger `retry`),
 * which is exactly the per-target retry 0388 already owns — no second ledger, no new mechanism.
 * Every other target keeps its configured mode and still dispatches.
 */
import { type OwnerReceipt, type OwnerUrlResolution, resolveOwnerUrls } from './publish-dispatch';

/** The Channels 图文 target: the preset row this gate owns (`operation: image`, `variant: cards`). */
export const CHANNELS_CARD_PLUGIN = 'shipinhao-pub';
/** The preset row's operation key; with the plugin above it identifies the ONE gated target. */
export const CHANNELS_CARD_OPERATION = 'image';

/** The only producer whose receipt may confirm a card link: the Official Account article row. */
export const OFFICIAL_ACCOUNT_PLUGIN = 'wechatmp-pub';

/**
 * The host family of a published 公众号 article. `mp.weixin.qq.com` is the public article host the
 * channel serves; anything else (a shortener, a mirror, a foreign domain, an `http` origin) is not
 * the confirmed link and is refused rather than sent.
 */
export const OFFICIAL_ACCOUNT_HOST = 'mp.weixin.qq.com';

/**
 * Optional placeholder a variant may carry for the confirmed link. The shared `cards` variant does
 * not (yet), so the fallback is the caption — the design's "use the body link when allowed and
 * record that distinction".
 */
export const OFFICIAL_ACCOUNT_PLACEHOLDER = '{{official_account_url}}';

/** Why the Channels card could not be sent on this pass. */
export type ChannelsCardDeferral =
    /** No Official Account article row is planned for this bundle revision. */
    | 'article-not-planned'
    /** The article row has no receipt at all for this bundle revision. */
    | 'article-not-published'
    /** The article's only evidence is a DRAFT receipt: a draft has no public URL. */
    | 'article-still-draft'
    /** The receipt names a URL that is not the confirmed published 公众号 article. */
    | 'article-url-unsafe';

/** Gate verdict: the confirmed link to carry, or the deferral classification. */
export type ChannelsCardGate =
    | { ok: true; url: string; receiptId: string }
    | { ok: false; reason: ChannelsCardDeferral; detail: string };

/** Where the confirmed link landed in the card payload (`caption` is the documented fallback). */
export type ChannelsLinkPlacement = 'placeholder' | 'caption';

/**
 * Is this preset/plan row the Channels 图文 target the gate owns? Keyed on plugin + operation so
 * the tier-1 `audio` row of the same plugin (a different post kind) is untouched.
 */
export function isChannelsCardTarget(target: { plugin: string; operation?: string }): boolean {
    return (
        target.plugin === CHANNELS_CARD_PLUGIN &&
        (target.operation ?? CHANNELS_CARD_OPERATION) === CHANNELS_CARD_OPERATION
    );
}

/**
 * Verify a candidate link as the published Official Account article before anything is sent.
 *
 * This is the trusted boundary: `https` only (a plain-http link is neither the channel's nor
 * safe), no embedded credentials, the Official Account host family, and the `/s...` article path
 * the platform serves. Everything else is unsafe — the card is deferred, never sent. Returns the
 * normalized `href` so the carried link is exactly what was verified.
 */
export function verifyOfficialAccountUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return { ok: false, reason: 'unparseable' };
    }
    if (parsed.protocol !== 'https:') return { ok: false, reason: 'not-https' };
    if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'has-credentials' };
    if (parsed.hostname !== OFFICIAL_ACCOUNT_HOST) return { ok: false, reason: `foreign-host (${parsed.hostname})` };
    if (!/^\/s(\/|$)/.test(parsed.pathname)) return { ok: false, reason: 'not-an-article-path' };
    return { ok: true, url: parsed.href };
}

/**
 * Decide whether the Channels card may carry a link on THIS pass.
 *
 * The same-episode binding is 0388's: `resolveOwnerUrls` keeps only receipts whose `parentRunId` /
 * `bundleRunId` names this bundle, and files a draft-mode receipt under `draft` — never under
 * `owner`. So a previous episode's article, a stale bundle revision and an unreleased draft all
 * fail here by construction. An operator who released the article by hand supplies the public URL
 * through that same receipt (the existing recovery path), which is what makes the retry work.
 */
export function gateChannelsCard(input: {
    receipts: readonly OwnerReceipt[];
    /** This run's bundle identity — the plan's `parentRunId`. */
    parentRunId: string;
    /** Target ids of this bundle's Official Account ARTICLE rows. */
    producerIds: readonly string[];
}): ChannelsCardGate {
    if (input.producerIds.length === 0) {
        return {
            ok: false,
            reason: 'article-not-planned',
            detail: 'no Official Account article target is planned for this bundle',
        };
    }
    const resolution: OwnerUrlResolution = resolveOwnerUrls(input.receipts, { bundleRunId: input.parentRunId });
    const confirmed = input.producerIds.filter((id) => resolution.owner[id] !== undefined);
    if (confirmed.length === 0) {
        const drafted = input.producerIds.filter((id) => resolution.draft[id] !== undefined);
        if (drafted.length > 0) {
            return {
                ok: false,
                reason: 'article-still-draft',
                detail: `Official Account article '${drafted[0]}' is still a draft — no confirmed public URL yet`,
            };
        }
        return {
            ok: false,
            reason: 'article-not-published',
            detail: `no confirmed Official Account article receipt for ${input.producerIds.join(', ')} in bundle ${input.parentRunId}`,
        };
    }
    for (const id of confirmed) {
        const verified = verifyOfficialAccountUrl(resolution.owner[id] as string);
        if (!verified.ok) {
            return {
                ok: false,
                reason: 'article-url-unsafe',
                detail: `Official Account receipt '${id}' carries an unsafe URL (${verified.reason})`,
            };
        }
        return { ok: true, url: verified.url, receiptId: id };
    }
    // Unreachable: `confirmed` is non-empty above.
    return { ok: false, reason: 'article-not-published', detail: 'no usable Official Account receipt' };
}

/**
 * Carry the confirmed link into the approved card payload.
 *
 * The card's own bytes (title, body, `images`) stay the reviewed ones — only the link rides along.
 * A variant that declares the placeholder gets a clean substitution; otherwise the link is appended
 * to the caption (`body`) and both the link and the placement are recorded in metadata, so the
 * degradation the design asks for is visible, not implicit. Idempotent: a body that already carries
 * the link is left alone, so a retry produces the same bytes and the same payload digest.
 */
export function carryOfficialAccountLink(
    payloadText: string,
    url: string,
): { text: string; placement: ChannelsLinkPlacement } {
    if (payloadText.includes(OFFICIAL_ACCOUNT_PLACEHOLDER)) {
        // The payload is JSON text: escape the URL as a string fragment so a quote cannot break it.
        return {
            text: payloadText.split(OFFICIAL_ACCOUNT_PLACEHOLDER).join(JSON.stringify(url).slice(1, -1)),
            placement: 'placeholder',
        };
    }
    const parsed = JSON.parse(payloadText) as Record<string, unknown>;
    const body = typeof parsed.body === 'string' ? parsed.body : '';
    const trimmed = body.trimEnd();
    const withLink = body.includes(url) ? body : `${trimmed}${trimmed === '' ? '' : '\n\n'}原文链接：${url}`;
    const rawMeta = parsed.metadata;
    const metadata =
        rawMeta !== null && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
            ? (rawMeta as Record<string, unknown>)
            : {};
    return {
        text: `${JSON.stringify(
            {
                ...parsed,
                body: withLink,
                metadata: {
                    ...metadata,
                    officialAccountUrl: url,
                    officialAccountLinkPlacement: 'caption',
                },
            },
            null,
            2,
        )}\n`,
        placement: 'caption',
    };
}
