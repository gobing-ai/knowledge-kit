# x article-composer UI discovery (task 0204) — first pass, blocked: no profile

## Status: BLOCKED — operator login (profile creation) required

- No X browser profile exists on this machine; the article composer has never been walked here. Post path stays on API v2 transport (out of scope for browser discovery); the composer walk targets `https://x.com/compose/articles` (X_ARTICLES_URL) only.
- Session login is operator-interactive: run `bun plugins/publishings/x-pub/src/profile-check.ts login` (X_PROFILE_DIR tier), then rerun the walk.

## Baseline from plugin constants (to verify after login)

| Control | Recorded candidates |
| --- | --- |
| Entry | `https://x.com/compose/articles` |
| Modes | article composer only (long-form); post = API v2, affordance boundary recorded but never triggered |
| Live | article publish affordances (Post/Publish buttons) located only, never activated |

## Safety

No console opened (no profile); nothing to act on.
