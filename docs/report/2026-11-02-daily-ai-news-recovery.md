# November 2 daily AI news delivery recovery

Follow-up to task 0338 and the November 1 outage report. Robin refreshed WeChat authentication and explicitly requested publication of today's edition. No historical editions are regenerated. Evidence lives in `.works/tmp/test-daily-recovery/probes/`.

## Current status

Today's [WeChat edition](https://mp.weixin.qq.com/s/sOCVXFjFlIzCxXq5WeY1pg) is public, posted by Robin at 19:25 PST. Authenticated history confirms exactly one additional publication (133 → 134). The canonical receipt explicitly records operator-confirmed publication. The podcast was already live and was not resent.

The repaired WeChat flow passed a real authenticated no-send rehearsal at 21:10 PST: original URL, native layout, completed save, strict persisted content/media/cover/URL verification, one native latest-version recovery, then the visible final 发表 control. The independent action audit records two preparation clicks, one 查看新草稿 action and one final click blocked **before execution**. No duplicate live post was made. This proves readiness through the final confirmation boundary; it does not misrepresent the operator's publication as an automated send.

The final repository gate passes: **4,404 tests passed, zero failed, three existing skips**, across 222 files. Lint/typecheck, build, all 58 pre-check rules and both post-check rules pass. All per-file coverage thresholds pass; no threshold, exclusion or assertion was weakened.

The actual bun-global runtime is backed up, synchronized and verified by eight matching SHA-256 checks. Its installed WeChat plugin passed a read-only authenticated check from outside the checkout. The scheduler restarted idle as PID `86269`; HTTP and all eight schedule registrations (five configured, three built-in) are healthy. Its daily command now explicitly sets `KK_BROWSER_CHANNEL=chrome` and `--wechat-live`, matching the authenticated rehearsal and requested unattended publication. General plugin defaults remain draft. The next tick is **November 3 at 04:30 PST / 12:30 UTC**.

Robin's subsequent `continue` authorized the reviewed deployment. Both Surfdash commits are pushed and the live checkout is fast-forwarded without losing unrelated files. [Deploy run 41592575717](https://github.com/robinmin/surfdash/actions/runs/41592575717) passes Gate, production Build, Cloudflare Deploy and cache purge. All three locale pages and cover assets now return 200; canonical URLs and podcast links are verified. Authenticated CMS reads confirm the existing three published locale IDs. No CMS repost or podcast resend occurred.

Final receipt reconciliation exposed and fixed two reporting defects: the locale branch passed a parsed object to the path-reading `targetsOf` helper, and missing/malformed receipts could abort the folded reporting tail. Failure-first CLI regressions pass for both. The final stage is backed up, synchronized and hash-verified in the installed runtime. Installed classification now reports **full, 2/2 primary destinations**, with locales, WeChat and CMS resync all `done`. XHS remains intentionally disabled. After a native SQLite backup, all seven selected stories were promoted to published. A separate `recovery-receipt.json` records late recovery; the morning schedule receipt remains `incomplete`.

## Observed scheduled outcome

The 04:30 PST run `daily-ai-voice-20261102-1793622601037` generated the seven-item article, cover and audio and finished at 07:34 PST. The supervisor correctly reported `incomplete`, exit 4, rather than claiming delivery success.

- Podcast publication succeeded: <https://podcast.salty.vip/i/daily-ai-2026-11-02/>, item `rI1DB00LN0s`. Recovery must not resend it.
- WeChat refused the morning attempt before composition because its saved session had expired.
- Surfdash rejected CMS sync because English and Japanese siblings were missing. The owning strict gate runs before CMS writes (`surfdash/scripts/publish-orchestrator.ts`, `syncCmsAction`). The daily pipeline attempted publication before locale scaffolding and translation, creating an ordering deadlock. The uncertain-delivery journal remains preserved pending reconciliation.

## WeChat recovery evidence

- Refreshed session passed the plugin's authenticated, read-only headless check: `wechat-authenticated-20261102.json`.
- The login browser's owner process had exited but Chromium's singleton symlinks remained. Only those stale symlinks were archived under the existing recovery backup; authentication state was preserved.
- Today's article still matched the safety-review digest before dispatch. The morning failed input/result were preserved as `wechat-20261102-before-refresh-*.json`.
- The first public attempt clicked the initial publication control but observed neither a success nor refusal. This is an unknown outcome, not success.
- Before another attempt, authenticated home and publication-history reads showed October 23 as the newest publication, with no November 2 entry. The draft list was also empty. Evidence: `wechat-reconcile-{home,published,drafts}-20261102.json` and screenshots.
- A diagnostic attempt uses the owning plugin transport and records the final console state before closing. Its outcome and any repair remain to be verified.

## Additional measured WeChat defects

1. The current layout action can open a separate full-page preview with `使用此排版`. The old flow only sought `匹配目标格式`. Failure-first transport checks cover same-tab and separate-tab completion, plus refusal to submit through an unresolved preview.
2. The audio service-rules label contains an anchor child. The previous leaf-only text search returned `no-label`. A real-Chromium fixture with the observed nested link failed before the label-scoped fix and passes afterward.
3. The image chooser portals its BMP-capable file input outside the audio dialog. A real-Chromium fixture reproduced the missing cover upload; the specific chooser input is now discoverable without selecting the editor's unrelated image input.
4. Inline `必须插入一张图片` was absent from the known publication-refusal signals, and failed Results discarded composition warnings. Both now have failure-first regressions.

5. Cover and audio material selection drifted across several independent UI changes: hidden template links, portalled file inputs, delayed and paginated gallery rows, native cover cropping, and the modern `mp-common-mpaudio` element. Selection now binds to a content-hash filename, verifies the selected source before accepting a cropped derivative, and verifies the inserted audio identity. Real Chromium regressions reject near-match filenames, wrong crop sources and unchanged stale previews. The live cover check returned `confirmed: true`; the actual saved draft contains the correct 22-minute audio at the start of the body.
6. The audio modal's old substring save selector also matched the underlying article's `保存为草稿`. Save is now exact and scoped to the audio upload dialog, and temporary upload files remain present until the browser finishes reading them.
7. Public submission of a new editor can be refused as an obsolete draft. Public mode now saves once, opens the canonical saved editor, and compares title, body, cover and audio before attempting publication. Bounded read-only reloads accommodate partial editor hydration without accepting changed nonempty identities or repeating save/send actions.
8. The current final publication dialog uses `发表`, while the old confirmation selector recognized only `确定`. The failed attempt reached that pending dialog without clicking the final confirmation. The repaired flow scopes the measured final button to the visible publication dialog and clicks once. Explicit `metadata.wechatmp.notifySubscribers: false` verifies a unique switch and its OFF state before confirmation, including the already-off case. Missing, ambiguous or unreadable states stop the final click. The latest authenticated rehearsal showed zero notification quota and an already-OFF switch. The workflow preserves that native setting; it does not bypass platform quota.
9. Authenticated publisher sessions now snapshot atomically with mode 0600. Read-only readiness checks do not change the saved session. Session snapshot or browser-close failures cannot mask an already observed publication result; result diagnostics redact session-bearing URL parameters.
10. A timed-out image-library loading probe was ignored, allowing an incomplete list to trigger a duplicate upload. A loading-forever Chromium fixture failed before the repair and now verifies refusal before a cover upload. Saved-editor receipt redaction also now covers `ticket` and `authkey`, alongside `token`.

## Surfdash ordering and future-date fixes

Authenticated reconciliation found no November 2 CMS entry, dated remote commit, or public locale page before retry. The original uncertain receipt and intent remain preserved; the active receipt records the operator reconciliation and its evidence explicitly.

The daily workflow now prepares the local post, scaffolds/translates all locales, normalizes content, runs the site's owning refiner, and validates/fingerprints all three files before remote dispatch. The final publish consumes those prepared bytes without rematerializing Chinese. Validation binds exact paths and hashes; stale translations, missing markers, changed files and duplicate uncertain receipts fail closed. Locale assets are included in the scoped content commit. Workflow nodes are declared in dependency order because the engine cannot resolve forward declarations reliably.

The first local refine exposed another future-date defect in the Surfdash repository: its static SEO topic map had no November 2 entry, and long unmapped headings collapsed into a date-only title. Local source changes derive bounded labels and descriptions from the actual selected headlines when a map entry is absent, while retaining the strict shared cross-locale admission checks. Independent review passed; 127 focused SEO/refine tests passed, all three real files pass digest checks, and repeated derivation is byte-stable. Surfdash's broader typecheck remains blocked by unrelated existing Astro parse errors. Those source changes remain unstaged; today's content publication must not deploy them accidentally.

## Earlier checkpoint and publication reconciliation

Robin published today's [WeChat edition](https://mp.weixin.qq.com/s/sOCVXFjFlIzCxXq5WeY1pg) at 19:25 PST after adding 原文链接 and clicking 一键排版. Authenticated history confirms `已发表`, the exact November 2 title, and a count increase from 133 to 134. The canonical result explicitly records operator-confirmed publication; it does not claim an unattended transport success. No further public send is permitted for this edition. The final automated attempt also stopped before its publication control, so it did not duplicate the operator's post.

The missing original link had a workflow cause: WeChat ran before Surfdash's receipt existed. The repaired node waits for the Surfdash attempt to settle and consumes its successful URL; failure still permits the soft WeChat channel without inventing a link. The new ordering regression failed before the edit; all 48 workflow tests pass afterward.

Live cover/audio composition is verified. Saved-editor hydration is asynchronous; the bounded read-only reload allowance now covers the observed delayed media restoration. The latest attempt restored the same audio and cover but changed the inline image URL, so the strict URL comparison stopped it. This platform media transformation is under investigation and has not been accepted without identity evidence. The full WeChat publisher suite passes 97 tests; its public subset passes 16. The full repository run recorded 4,367 pass, three existing skips and one CGI fixture failure; the measured-dialog fixture repair then passed all 36 tests in that file. Lint/typecheck, build and all 58 pre-check rules pass. Surfdash public assets, completion classification, installed runtime synchronization and the final green full-suite gate remain pending at this checkpoint.

Surfdash's one guarded invocation published all three CMS records, then failed Git staging on a stale index lock. Reconciliation verified the CMS records before any retry. After proving no Git owner remained, the empty lock was archived and the six dated content/cover files were pushed in `0b5f00fe`; a Chinese description parity correction followed in `f35556c9`. The second deployment passed content/body/SEO checks and failed an existing test that hard-codes 78 corpus posts although the current corpus has 81. All three public HTML pages return 200, but cover assets remain 404 pending a successful static deployment. The original uncertain publisher receipt remains preserved; no duplicate CMS publish was attempted. The corpus-count test correction is being prepared locally for review before any code push.

The November 2 morning run remains recorded as incomplete; recovery must not rewrite it as an on-time success. The next configured tick is November 3 at 04:30 America/Los_Angeles (PST, 12:30 UTC). The scheduler's existing public opt-in will be activated after verification to fulfill Robin's original no-HITL requirement and latest instruction to automate the public WeChat process. No new channel or historical replay is included.

## Prepared Surfdash deployment

The complete clean candidate is `786652f` atop `21505ad` in `/tmp/surfdash-candidate-latest-SD1WO5`, based on `8d5f794`. Across eight files, it contains the two SEO source files, two regression test files, serialization-only updates to today's three locale frontmatter files, and a one-character Astro syntax repair. Parsed frontmatter values, article bodies, cover assets and settings are unchanged. Independent review found no remaining P1/P2 blocker.

Validation was extended from content checks and tests to every deployment gate. Failure-first `bun run lint` found an extra `}` in `modifiedTime={cmsArticleModifiedTime(post.data)}}`, producing 138 cascading Astro diagnostics. Removing it restores typecheck and production build. After a frozen-lockfile install, lint reports zero Astro errors/warnings/hints; pre-check, `check:all`, `sd check digest`, `check:seo --lastmod-base origin/main`, all 1,380 tests across 85 files, post-check and the CI-equivalent Astro/Cloudflare production build pass.

The [sanitized candidate validation manifest](../../.spur/reports/daily-recovery/surfdash-786652f-validation.md) records exact commands, gate counts, the required public build-environment names and the clean-install distinction. No credential value is included.

Robin's `continue` after the concrete deployment request authorized pushing both commits. The [live verification manifest](../../.spur/reports/daily-recovery/surfdash-live-20261102-verification.md) records the successful deployment, all six public HTTP checks and preserved live-checkout changes. The uncertain Surfdash receipt was backed up before recording positive reconciliation of the existing CMS publication and deployment, explicitly stating `publisherRetried: false`. Final classification and settlement are complete.

## Native layout/save findings after Robin's publication

The native layout menu is `.edui-popup .edui-pastecontainer > .edui-button > div.edui-default`, not the role/menu-item selectors the old flow searched. Selecting the measured 匹配目标格式 target transitions through 自动保存中… to 已保存 in roughly 4.3 seconds. Article composition now completes the source link, media and cover before applying layout, matching Robin's sequence.

Canonical URL existence and page Resource Timing were insufficient save acknowledgements. The native adapter now observes a new same-origin full-article save POST, binds it to the actual Save click, waits for the complete response body, and validates HTTP and semantic success. Live receipts encode top-level `ret` as `"0"`; both numeric and string zero are accepted, while nonzero/malformed receipts stop the flow. Nine real-Chromium cases cover delayed headers and response bodies, old/in-flight requests, matching autosave while the button is disabled, unrelated GET/POST operations, HTTP failure, semantic refusal, malformed bodies and timeout. Playwright's request timing is checked after response headers arrive because the real request initially reports `startTime: 0`. Article-specific save checks do not change public sticker/video/podcast behavior.

The original link is also included in strict persisted-snapshot verification. A requested URL missing before save, or changed after canonical reload, blocks publication. The remaining version race is handled through one bounded native 查看新草稿 recovery after the known pre-confirmation refusal. The actual legacy refusal lives in `div.version_fail_dialog`, not a toast or modern WeUI dialog. Recovery requires the same canonical draft ID and unchanged title/body/media/cover/original URL; it performs no save or overwrite. A second stale refusal, unknown result, changed content or no-op action stops before the final send. An uncertain final send is never retried.

The final live audit proves this path: initial preparation at 21:10:08, native latest-draft action at 21:10:14, second preparation at 21:10:18, and final confirmation deliberately blocked at 21:10:21. Source selectors and fixtures now use the measured legacy modal and exact 查看新草稿 label. Notification metadata records the actual pre-click switch state separately from the requested policy; the live account had zero notification quota and its switch was already OFF. Every rehearsal blocks the final public click independently at both the adapter and browser-event layers. No second live edition has been sent.

## Final verification and activation evidence

- `recovery-20261102-final-closure-tests.log`: final suite exits zero, 4,404 pass / zero fail / three baseline skips, 851.04 seconds.
- `recovery-20261102-final-closure-lint.log`, `recovery-20261102-frozen-final-build.log`, `recovery-20261102-final-closure-precheck.log`, `recovery-20261102-final-closure-postcheck.log`: lint/typecheck, build and rule gates pass. CLI production build inputs are unchanged by the final stage-source fixes.
- `runtime-activation-20261102-final.json`: actual installed package root, owner-only backup and eight matching file hashes.
- `installed-wechat-readiness-final.json`: installed plugin reports `verified`, authenticated and read-only. No browser token or credential is recorded.
- `wechat-public-schedule-config-20261102.json`, `activated-scheduler-final.json`: exact public/Chrome scheduler command, config backup, idle restart, new PID and native API registration checks.
- `wechat-reconcile-published-20261102.json`: authenticated final read-only history still shows 134 publications and the single 19:25 edition. `wechat-no-send-action-audit.json` preserves the protected final-button boundary.
- `.works/tmp/test-wechat-audio-browser/audio-coverage.json` and `frame-inventory.json`: repeatable Chromium chooser/cover and fail-closed frame diagnostics.
- `surfdash-public-final-before-approval.json`: fresh three-locale HTTP checks; public pages 200, cover assets 404.
- `surfdash-deployment-final.json`: subsequent approved deployment succeeds; all three pages and cover assets return 200.
- `runtime-final-stage-sync.json`, `final-recovery-classification.log`, `final-store-settlement.json`: final installed stage hash, full classification, all required channels complete and seven stories settled after backup.
- `malformed-fold-tail-receipt.log`, `surfdash-locales-completeness-fix.log`: failure-first CLI regressions for reporting closure and locale receipt handling.

Earlier unsuccessful gate runs exposed a stale CGI readiness fixture, a build/package-check collision and missing attribution for subprocess browser coverage. The fixture was corrected; build/test were serialized; real in-process Chromium checks now cover the measured chooser and frame paths. The reused fixture's unnecessary cleanup/CLI callbacks were replaced with equivalent `try/catch` blocks. No production behavior, assertions, coverage threshold or exclusion was relaxed to pass the gate.

The final full run also exposed a pre-existing pagination fixture that subtracted fixed 24-hour durations across daylight-saving time, yielding 34 local dates instead of 35. It now seeds local calendar dates at noon, preserving all 35/30/5 pagination assertions; no production date logic changed.

The requested recovery is complete: scheduled public WeChat is active; Surfdash source deployment and public assets are verified; required channels, receipts and store settlement are complete. The next actual scheduled edition has not run yet. The original morning run remains an incomplete historical run rather than an on-time success, and today's WeChat publication remains explicitly attributed to Robin.
