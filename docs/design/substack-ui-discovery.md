# substack console UI discovery (task 0203) — first pass, blocked: no profile

## Status: BLOCKED — operator login (profile creation) + publication URL required

- No browser profile exists on this machine (`~/.config/kk/browser-profiles/` has infoq/juejin/wechatmp/xhs only); the channel has never been walked here.
- Session login is operator-interactive; additionally the editor URL is publication-scoped — the walk needs `SUBSTACK_PUBLICATION_URL` (publication root, optionally trailing `/publish`).
- After `bun plugins/publishings/substack-pub/src/profile-check.ts login` and publication URL config, rerun the walk (script to be authored at rerun time; selectors below are the baseline to verify).

## Baseline from plugin constants (to verify after login)

| Control | Recorded candidates |
| --- | --- |
| Entry | `<publication-root>/publish` (URL derivation from publication root — verify) |
| Draft | post draft, publication-scoped; draft signal to observe (URL postId / Saved indicator) |
| Live | publish/「Publish」 controls — never activated by automation |

## Safety

No console was opened (no profile); nothing to act on.
