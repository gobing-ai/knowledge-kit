# Publishing the recovered 2026-11-03 episode

## Recommendation

Publish the recovered six-story episode through the existing voice2 publishing tail first: Surfdash article (zh/en/ja), podcast host/RSS, then the WeChat article draft with embedded audio. Reuse the restored artifacts; do not restart extraction or TTS. Expand to X/Weibo articles after their channel checks. Treat publish3 as the intended multi-platform orchestration route, with the contract gaps below resolved before real dispatch. Do not launch its default matrix merely because its rows say `draft`.

This is an investigation and execution plan, not a publication receipt. No browser session checks, platform writes, credential changes, schedule changes or sends were performed. Browser-profile presence is local evidence only; it does not prove login validity or account entitlement.

## Current inputs and readiness

Workspace: `.works/kk-daily-ai-voice2/20261103`. MP3, article, cover, script and supporting stage metadata were restored and verified; see `2026-11-03-daily-ai-news-recovery.md`. Audio is 1036.537063 seconds, six stories, QC passed.

Local inventory: `.works/kk-daily-ai-voice2/20261103/publishing-readiness.json`. Credentials were checked through the same `pluginProcessEnv` overlay the executor uses; only variable names and presence booleans were recorded.

Missing publication inputs at inspection:

- Current-byte safety verdict stamp: `24-script/20261103_09_safety-judge_stamp.json`.
- Merged episode payload: `31-publish/20261103_13_publish-prep_content.json`.
- Show notes: `31-publish/20261103_15_show-notes_show-notes.md`.
- Social copy: `26-social/{x,weibo,threads}.md`.
- Channel variants under `30-variants/`, and frozen `bundle.json`.
- Surfdash locale preparation/translation/validation evidence.

| Platform / operation | Designed route | Current local evidence / remaining condition |
| --- | --- | --- |
| Surfdash article | `daily-prepare-surfdash` → translations → local refine/validate → `daily-publish-surfdash` | Checkout exists; HEAD equals the locally recorded `origin/main` (no network refresh performed). Untracked files are present and must be preserved. zh/en/ja files and strict locale validation still needed. The publish operation includes CMS/Git/push side effects. |
| Podcast host + downstream RSS subscribers | `daily-show-notes` → `daily-publish-podcast` → verify host item and RSS entry | `MICROFEED_BASE_URL` and `MICROFEED_API_KEY` present. Host access and subscriber ingestion untested. Use the host/RSS route designed for Apple Podcasts, 小宇宙 and YouTube Music; do not claim subscriber delivery merely from a successful host upload. |
| WeChat MP article with audio | `daily-publish-wechat`, `wechat_live=false`, collection `每日AI资讯` | Saved `wechatmp` profile directory exists. Session check, reviewed payload, MP3 and cover needed. This is a real external draft save, not an offline rehearsal. |
| WeChat MP standalone podcast | publish3 `wechatmp-pub`, operation `播客`, episode variant | Source supports the operation; preset lists it. Daily-use delivery has not been established by this inspection. Keep separate from the article-with-audio draft and verify the resulting draft in the console. |
| X article | `x-pub`, operation `article`, browser transport | Saved `x` profile directory exists. Article access/session and the appropriate article profile/locale need checking. Missing X API credentials do not by themselves block this browser route. Draft supported by source. |
| Weibo long article | `weibo-pub`, operation `article` | Saved `weibo` profile directory exists. Session and 头条文章 entitlement unverified; source marks editor selectors provisional. Draft supported by source, subject to that check. |
| X short post | `x-pub`, operation `post`, after RSS evidence | All four required OAuth variable names are absent from the effective plugin environment. API route posts publicly; no browser fallback or safe draft dispatch. |
| Threads text post | `threads-pub`, operation `post`, after RSS evidence | `THREADS_ACCESS_TOKEN` and `THREADS_USER_ID` absent. Text-only public API route. Do not dispatch a matrix `draft` row. |
| Weibo short post | `weibo-pub`, operation `post`, after RSS evidence | Saved profile directory exists. Source refuses draft posts; needs explicit live status and session validation. |
| XHS podcast / long article / cards | `xhs-pub` operations `发播客` / `写长文` / `上传图文` | Saved profile exists, but voice2 deliberately disables XHS following unreliable draft evidence. Preserve that decision. Shipped preset nevertheless enables podcast drafts and makes long articles dummy; reconcile before using it. Cards are off and no card series was restored. |
| Direct Xiaoyuzhou console draft | `xiaoyuzhou-pub` | Separate plugin is draft-only; no local browser-profile directory. Not required for the designed host/RSS distribution route. |
| 视频号 cards / Threads images | Preset rows are off | Unsupported operations in current plugins; do not turn them on. |
| LinkedIn / Facebook / Instagram | Future design expansion | No corresponding product publishing plugins in this checkout. Not executable targets for this episode. |

Channel scope comes from `plugins/kk/publish-presets/daily-ai-voice.json`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml`, and `docs/design/kk-daily-ai-voice3.md` §7. Other installed publishing plugins are not automatically part of the daily-news design.

## Material publish3 gaps found

1. **A `draft` matrix row does not guarantee draft delivery.** `composePlan` stamps `metadata.publishStatus`, but podcast mapping reads `metadata.status` (default `published`), and Surfdash derives `draft` from `metadata.published` (default false). An offline call with today's article and `publishStatus: draft` reproduced podcast status `published` and Surfdash frontmatter `draft: false`; results are recorded in `publishing-readiness.json`. The X/Threads post transports also issue public API calls without a draft branch. `sendRows` forwards the payload rather than translating these channel-specific mode fields. Fix and verify mode adaptation/refusal before using a draft-only window. Sources: `apps/cli/src/publish-matrix.ts:346`, `apps/cli/src/itc-publish.ts:575`, `plugins/publishings/podcast-pub/src/map.ts:115`, `plugins/publishings/surfdash-pub/src/index.ts:173`, `plugins/publishings/x-pub/src/index.ts:104`, `plugins/publishings/threads-pub/src/index.ts:137`.
2. **Today's safety/locale evidence cannot be skipped by switching orchestrators.** The article variants are built directly from `22-article`, while the merged episode is built from safety-gated publish-prep. The matrix planner checks bundle/schema/digests, not the legacy safety stamp or locale validation receipt. The shared Surfdash variant is the unmodified article, rather than the prepared, validated locale payload. Require the same reviewed-byte and prepared-locale evidence before dispatch. Do not create a stamp by hand. Sources: `plugins/kk/scripts/daily-stages.ts:1895`, `plugins/kk/scripts/daily-stages.ts:2220`, `apps/cli/src/publish-matrix.ts:264`.
3. **The preset disagrees with existing channel decisions/capabilities.** It enables XHS podcast drafts despite voice2's explicit XHS-off decision and labels public-only X/Threads social targets `draft`. Reconcile the matrix with operator decisions; preserve `off`/`dummy` for unsupported channels. Sources: `plugins/kk/publish-presets/daily-ai-voice.json`, `plugins/kk/workflows/kk-daily-ai-voice2.yaml:54`.
4. **A generic readiness PASS is not sufficient.** `probePlugin` returns OK when the plugin declares no check. Podcast and Threads have no declared check, so credential inventory and actual service access still matter. X's declared browser probe does not establish API credentials for `post`. Source: `apps/cli/src/itc-publish.ts:340`.

These findings are isolated from the other agent's G15 worktree; no G15 code or workflow was edited here.

## Execution sequence for this episode

1. **Review the frozen text against all selected target policies.** Use the existing `kk-daily-safety.yaml` workflow on this workspace with run date `20261103`; honor its pass/escalate/exclude/block result and any excluded platforms. The current default list covers xiaoyuzhou/apple-podcasts/wechatmp; broaden only to policy references actually installed for additional selected channels. If a safety revision changes spoken text, reconcile and regenerate the affected audio before continuing; the existing MP3 is valid only for its current script.
2. **Package the reviewed episode locally.** `daily-publish-prep` merges the article, final MP3 and cover and stamps ID3 tags. That can change the MP3 byte hash; record the final publication hash after preparation. It must refuse absent/stale safety evidence. Preserve the original recovery receipt.
3. **Prepare and validate Surfdash locales.** `daily-prepare-surfdash` → `daily-translate-localize` → author en/ja translations → `daily-surfdash-refine` → `daily-translate-validate`. Use the voice2 translation prompts for fixed product names. Preparation writes the Surfdash checkout; preserve its unrelated files. Do not weaken locale checks.
4. **Perform the approved owned-channel publication in dependency order.** `daily-publish-surfdash` with required locale validation, then `daily-show-notes`, then `daily-publish-podcast`. Carry the podcast SEO environment from the voice2 YAML, including date slug, series/show identity and episode numbering; a bare plugin call loses that configuration. Verify the actual host URL, MP3 enclosure and RSS episode date before any dependent social post.
5. **Save the approved WeChat draft.** Run the named session check first, then `daily-publish-wechat` with `wechat_live=false` and collection `每日AI资讯`. Verify the draft in the console, including title, audio, cover and collection. X/Weibo article drafts can follow their own session/entitlement checks and profile-specific payload adaptation. Keep XHS disabled until its earlier restriction is explicitly resolved.
6. **Expand through a frozen bundle once the matrix gaps are resolved.** Author factual channel copy from the six included stories; run `daily-bundle-variants` then `publish-matrix-bundle` with an honest recovery identity. Plan/rehearse selected targets, inspect results, and use `kk-daily-publish3` for real dispatch only after mode and payload contracts pass. A successful dummy receipt has `effect: none` and is never publication evidence.
7. **Finish evidence and bookkeeping.** Run `daily-publish-classify`, `daily-publish-completeness` and the run report/ledger path; inspect each channel receipt, not just the aggregate status. The morning and rehearsal selection reservations were released. Do not blindly execute publish3's `mark-published` against either failed run or claim those rows now represent this six-story recovery. Establish the correct six-story recovery ownership through the store's supported CLI before marking publication.

### Local packaging commands (after valid safety review)

These commands are documented for the next execution step; they were not run by this investigation. Use checkout source for stage bodies to avoid the installed-package staleness recorded in `AGENTS.md`:

```bash
cd /Users/robin/xprojects/knowledge-kit
news_work_dir="$PWD/.works/kk-daily-ai-voice2/20261103"
bun plugins/kk/scripts/kk-workflow-stages.ts daily-publish-prep "$news_work_dir" 20261103 'Robin Min' '咸话咸说'
```

Later, after notes and social copy exist and the matrix contracts are corrected:

```bash
bun plugins/kk/scripts/kk-workflow-stages.ts daily-bundle-variants "$news_work_dir" 20261103 "$PWD/plugins"
bun apps/cli/src/index.ts stage run publish-matrix-bundle "$news_work_dir" --run-date 20261103 --run-id daily-ai-voice-manual-recovery-20261103
bun apps/cli/src/index.ts stage run publish-matrix-plan "$news_work_dir" --bundle "$news_work_dir/bundle.json" --preset daily-ai-voice --window after-generate --channels surfdash-pub,podcast-pub,wechatmp-pub --dummy
```

The last command prepares an offline rehearsal plan only; it does not dispatch anything. Re-plan deliberately for real delivery after review. Do not run the whole generation workflow to reach publishing, and do not invoke `publish-matrix-send` directly to bypass the workflow's live approval pause. No schedules need changing to recover this one episode.

## Evidence and limits

- Local artifacts and plugin configuration presence inspected; no secret values recorded.
- Podcast and Surfdash draft-mode mismatch reproduced by pure mapping calls with zero network requests.
- Surfdash Git status and cached branch relationship read without edits, fetch, pull or push.
- Authentication, account entitlements, actual service responses and final channel rendering remain unverified.
- No product source changed; full test/build reruns are unnecessary for this report and local inventory. `git diff --check` covers the documentation diff.
