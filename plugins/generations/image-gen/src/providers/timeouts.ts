/**
 * Per-request HTTP timeout shared by every image-gen provider.
 *
 * This lives in a leaf module (no imports) rather than in `types.ts` because `types.ts` builds the
 * `PROVIDERS` registry from value imports of each adapter, which would make `types.ts ⇄ <adapter>`
 * a runtime import cycle: a consumer that imported an adapter first (e.g. the google helper tests)
 * would evaluate `types.ts` while the adapter was still initialising and hit a TDZ error on the
 * registry's `create` reference. `types.ts` re-exports this constant, so importing it from there
 * still works.
 *
 * Bun's `fetch` — like WHATWG fetch — has no overall request deadline unless a `signal` is passed,
 * so a stalled peer would hang the workflow step until someone killed the run (R5).
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = 300_000;
