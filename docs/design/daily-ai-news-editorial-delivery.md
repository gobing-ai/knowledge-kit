# 每日AI乱炖编辑与分发设计

**状态** Accepted design · **日期** 2026-11-17 · **Feature** L3 · **决策** ADR-054

## 基线与方案

| 现行边界 | 核对结果 | L3 决策 |
| --- | --- | --- |
| `plugins/kk/workflows/kk-news-generate.yaml:74`、`:137`、`:150`、`:214` | 已有选题、校验、稿件、评审，尚无跨期判断对齐。现行主持契约仍以技术分享为定位。 | 在最终选题通过后复用 news-editorial 加入判断对齐。稿件、卡片、标题共享通过校验的输入。 |
| `plugins/kk/scripts/daily-stages.ts:4839`、`apps/cli/src/commands/content-generate.ts:938`、`plugins/publishings/podcast-pub/src/index.ts:171` | 当前生成调用旧 brief notes，旧渲染从前序 SurfDash 回执取路径，路径缺失时记录 legacy layout 降级。10 月 19 日的本地与线上版本均保留时间线和全文入口。 | 由 podcast-pub 从最终稿和发布回执渲染，备注可以先在无链接状态审阅。 |
| `plugins/kk/scripts/cover-compositor.ts:116`、`plugins/kk/scripts/daily-stages.ts:803` | 已有图像生成与排版分层，默认标识在左上，标题位置需要按实测裁切重配。 | 复用 L2 预设和 compositor，更新此节目的模板、资产与裁切约束。 |
| `plugins/kk/workflows/kk-publish.yaml:50`、`apps/cli/src/commands/content-launch.ts:525` | 已有共享发布 DAG。新闻预设与现有 cron 仍区分三个窗口，overseas 默认日期与其他窗口不同。 | 扩展同一个发布入口和通用依赖机制，新闻专属策略放在 preset，平台认证和上传留在插件。 |

只改提示词部署快，适合修文风，但无法处理并发写入、时间线和发布依赖。重建流水线能统一模型，却会复制 G61 的发布能力并扩大变更面。采用增量方案并把实现限制在当前入口、输入契约和现有插件。L2 与 O 用于复用已有行为，实施前审查仍活跃任务的写入范围，避免重复修改。周更制作与历史批量重发由后续范围决定。

本机 11 月 17 日的生成回执为 `no-content`，检查到的近期本地目录没有完整冻结 bundle。因此现行版本的备注缺失机制和成片质量仍需用完整重放确认。空池单独留作失败样本。

## 节目内容与判断（R1–R5、R10）

1. `news-editorial` 按时效、实际影响与可信度评选跨行业、社会、市场、应用的 AI 新闻。技术稿先说影响，保留听众理解结论所需解释。热度只参与排序，来源多样性用真实主源覆盖检查。复用现有边界和最低供稿量门，素材短缺可见。
2. 最终选题后执行 Agent 对齐，输入选中条目、账本快照及可信来源。输出可为空的结构化变更。每条变更包含稳定 ID、关联选题、日期、事实与归因、评论、证据 URL 与核查时间、被替代 ID（如有）。调查利益冲突时区分宣称、可观察行为和动机推断。关键证据不够时在线核实，仍不明确则标注不确定或省略。已播错误用面向听众的说明致歉和更正，并由目标插件提供受权限约束的更正交付。
3. `<works_dir>/kk-news-generate/conclusion.md` 是唯一可写判断账本。默认路径对应用户指定位置。代码使用现有锁能力按账本范围串行提交，比较输入摘要，检查稳定 ID、证据和替代关系，在同一文件系统原子替换完整文件。已提交变更重放为 no-op，摘要冲突重新对齐，损坏或异常缺失拒绝重建并报告恢复路径。覆盖目录清理排除、备份与恢复演练。首建与恢复须可辨认。运行目录快照与提交回执是事件证据。账本区分待用、已播证据和被替代记录，未通过后续安全门的稿件不可凭账本提交推断已播。
4. 扩展现有 script plan。代码固定开场骨架，Agent 提供一到两句摘要、逐条可选的单句短评和可省略的综评。新闻密集时优先报道，素材少时只在存在跨条目联系且符合总时长时增加综评。复用编辑评审和现有安全门。安全门若删除选题，结构化引用必须重新校验，旧标题与卡片不得泄露。稿件只读取本期已验证快照。语义可读性、评论价值与事实正确性由评审核对，代码验证格式、引用与时间预算。

## 单一标题、备注与封面（R6–R8）

- Agent 从最终可发布条目选一个具体 headline 并引用支撑条目。代码从冻结的节目日期生成 `第<YY><MM><DD>期 · <headline>`，同一中文标题进入各发布目标。已有多语言稿只本地化 headline，保留期号与语义。频道确有硬限制时通过预检显式报出，避免静默改题。沿用现有日期、GUID、slug、去重键和旧 bundle 读取。新校验采用现行节目入口的版本化约束，旧的 SurfDash digest 合同继续服务历史路径。
- podcast-pub 接收有序的最终已讲条目、短摘要、来源、可选文章 URL、音频实测偏移及可用的 `cards.json` 引用。站点恢复 10 月 19 日的时间线和图文入口，用独立响应式区域呈现已生成卡片，保留顺序、可读 alt 和纯文本降级。不得伪造时间戳，缺少测量时显示无时间标记。复用图片上传和回执机制前验证宿主可保留的标记及安全 URL，站点与 RSS 可消费同一资料。卡片是装饰性补充，渲染或上传失败后保留 notes 并产生单独诊断。链接依赖真实成功回执，不从标题推断 slug。
- Agent 为图像预设提供有来源的视觉主体，避免把生成画面包装成现场实拍。image-gen 预设负责新闻插画风格与留白，现有 compositor 锁定 CJK 标题、对比度与安全区域，使用缩小的透明右上标识。以微信公众号和播客站点中心裁切交集验证标题框。保留完整封面与平台截图、长标题预览。检查操作员 banner 的标识融合；本机路径当前缺失，可先对包内标识做预览，参考比对须在执行阶段补齐。

## 一个发布触发（R9）

- 保留生成→冻结→发布的结构。同一节目日期一个发布触发，LA 日期解析、选中 bundle 与重放日期显式记录。上线提议以现有国内触发时段为起点，经已冻结产物可用性和 DST 演练再定最终时刻。旧窗口参数继续处理旧运行和按目标恢复。
- 发布 preset 记录目标与依赖。播客发布产生真实 URL，图文与播客若存在双向链接只在后续补链，避免循环依赖；依赖 RSS 的引流等待有界可用性检查，超时仅挂起受影响目标。发布引擎继续使用现有计划、授权、锁、回执和幂等恢复。各插件处理本平台检查、上传与草稿。微信继续草稿并记录需扫码状态。保持现有 off/dummy/draft/live 授权组合，发布验证使用可控传输。
- 为每个当前配置的社媒输出内容样本、模式、所需资产、前置链接、预检与重试诊断。社媒实机操作和生产 cron 切换需要现有发布授权。

### 公开纠错和视频号引流（R17–R18）

- 已播判断的更正通过下一期符合条件的节目公开送达。0384 提供不可变更正 ID、旧判断和证据，0385/0386 将其写入口播、正文及备注，0396 根据正常渠道回执记录更正是否已送达。稿件说明哪里错了、致歉、给出正确事实和来源。备注尽可能链接旧节目。既有内容的原位更新只使用已支持的渠道操作、已核实的条目身份和明确授权。草稿、未知和需人工处理分别记录。
- 已有视频号图文目标必须同时具备本期卡片和已核实属于本期的公众号文章公开链接。0395 使用 0388 的依赖和回执协议。公众号仍是草稿时只延后该目标，操作员发布并提供链接后可按目标恢复。优先使用渠道支持的链接机制，允许时可用正文链接作为降级并明确记录。排程、账号权限与默认渠道模式沿用现行配置。

## 可重复验收

以 2026-10-19 本地 timeline 和线上公开 HTML 为历史版式基线，选择一个现行重放期及新闻充足、稀少各一组冻结输入。保留选题和来源矩阵、中文标题/资产断言、无卡片及失败注入结果、两平台裁切、备注 HTML 与 RSS 预览、dry-run 发布计划及回执。演练并发提交、损坏账本恢复、重复发布、无 RSS、微信人工状态、午夜与 DST。比较各阶段产物和失败定位。开播后的点击和完播作为观察指标，设计阶段不预设提升幅度。

## 选稿过滤、跨期去重与新闻溯源（R14–R16）

### 过滤规则与执行报告

机械边界的现行版本只保留最高领导人关键词规则及未来日期检查。Agent 仍整类排除政治、外交、贸易管制、军事、公共政策争议与社会事件。两层叠加会使既有代码收窄失效。历史本地排除记录可以重放旧 `policy-dispute` 的命中，也需要用现行规则重放，区分偶然提及、AI 主线相关政策、明确限制和素材质量不够。黄赌毒等规则须查明现行执行位置和所依据的政策，检查语境和误杀。在有证据的情况下调整宽泛编辑规则，继续执行已确认的硬限制与渠道准入门。 [规则配置](../../plugins/kk/scripts/topic-boundary.json) · [Agent 选题边界](../../plugins/kk/skills/news-editorial/SKILL.md#shared-rules-all-modes)

报告记录当期原始池、QC 前后、机械边界、去重、Agent 选稿与渠道准入。每个阶段输出前后数量、被排除的唯一条目数及按规则的命中数，多条规则命中同一条目仅在排除数中计一次。区分未运行、零命中、命中但保留和真实排除。用当前尝试标识、规则版本和输入摘要绑定结构化证据，保留本地逐条判定以供复查。无内容时也写入最终报告，即使正常报告节点未被调度。异常提前结束时如实显示截至当时的统计并标明缺失阶段。保留已有发布安全章程，利用本地历史回放校准选题效果。

### 系列账本与疑似重复

代码已经在提取时排除同 `topic` 的 `selected` 或 `published` story。现行新闻入口用 `ai-news`，在最终 Agent 选稿前先记账。同一期会话重跑、提前落账却未成片、发布结算和事件聚类都值得分开核对。当前聚类先比较 URL 及引用，再按标题词元、时间窗匹配。不同报道的标题或链接都变时，原始条目去重仍有可能漏过同一事件。 [提取条件](../../apps/cli/src/commands/store.ts#L1257) · [预选入口](../../apps/cli/src/commands/content-generate.ts#L864) · [事件聚类](../../packages/kk-store/src/story.ts)

本机以只读方式查到三个与操作员描述吻合的标题，它们有三个不同的 story ID，均无入选记录。库里另有六个 story ID 出现在两条已发布运行中，均指向 10 月 9 日的同日 voice2 记录。两种观察都不足以确认这次跨日重复的来因，也无法据此判断相关标题的事实真伪。实施先从实际制播主机对照对应期次的稿件、bundle、选用账本和发布回执。保留临时选用、确已发布和可重用的差别，并以相同系列中的原条目或经证据确认的重复事件为排除对象。另一系列可独立选用。对有可核实新进展的条目，Agent 说明其变化并引用出处。无证据的事件合并不得造成全库误伤。

### 来源归因

Horizon 将条目 URL 与参考链接分别保存，另把 `rss` 等值写入采集分类。现行正文优先用 `metadata.source` 填来源名，容易把 `rss` 当作出版方。只读抽查本机 162 条标为 RSS 的库内条目，有 139 条链接到 Google News，18 条链接到 Simon Willison 的站点，5 条链接到 AIHot。验证必须分开检查显示名和链接最终能到哪里。 [Horizon 映射](../../plugins/ingestions/horizon-ingest/src/index.ts#L114) · [正文归因](../../plugins/kk/scripts/daily-stages.ts#L4586)

保留采集分类用于运营统计。正文和 notes 共享可追溯的归因决策，以已证实的具体文章链接为先。原文未核实的条目明确标为聚合转引或来源未核实，保留经过校验的可用链接。来自聚合摘要的证据不足以支持关键判断时，交由编辑核查或省略该判断。避免对已有 URL 身份做批量重写，确保引用改进不造成账本重复。

## Spur Board redesign (R11–R13)

The module opens on the newest recorded generation attempt. Its run selector shows the episode date, attempt and state. The same selection drives all three views and is reflected in a shareable URL.

| View | First-level content | Drill-down |
| --- | --- | --- |
| Summary | Episode title and date, generation state and elapsed time, content/no-content result, publication count by actual status and the latest actionable issue | Expand the existing episode funnel, source supply and captured settings when recorded |
| Generation | Ordered recorded stages with active, skipped, done and failed states, timing and retry count. Separate the engine state from the episode result | Expand a failed stage for its recorded diagnostic and exact run/action reference. Open generated article, script, cover, cards, audio, notes or generation report from a collapsed Outputs panel |
| Publishing | One row per recorded target and operation, grouped by publish attempt or window. Distinguish live, draft, dummy, skipped, failed, uncertain and missing evidence | Expand a target for verified public URL, safe diagnostic, publish run or receipt reference, and recovery context. An absent outcome has an explicit empty or pending state |

Use Spur's root `DESIGN.md` module-shell contract and native `@gobing-ai/spur/board/ui` facade. Compose `ModuleShell`, `ModuleHeader`, `ModuleTabs`, and the shared empty/loading/diagnostic states. Keep one compact header with the run selector and refresh, a controlled tablist and dense content. Use host tokens for content styles. Confirm the host's published import map and types before wiring packaging. Preserve the contribution route and saved runs. Migrate `results` and `progress` to Generation, and `config` to Summary. Use host base-path helpers for same-origin requests and links. Cover keyboard navigation, light/dark themes and narrow viewports.

The existing view selects `kk-news-generate` but the reader maps it to `DAILY_VOICE_ARTIFACTS` for voice2. The current launch also skips voice2's capture hook. Task 0378 provides the CLI status projection and intentionally excluded Board rendering. Bind new runs through the existing capture seam under the generation lock. Reuse producer evidence and the current status projection for progress, and register a distinct current artifact map based on actual generating nodes, including voice fallback. For uncaptured history show verified Spur engine evidence and mark artifacts unavailable. Keep old voice2 links reachable regardless of current run availability.

Derive publication rows from the selected episode's versioned plan/outcome and per-target receipts. Match the document date, bundle or parent identity and plan digest where the format provides them. Keep old or superseded evidence labelled, never attribute it to the selected replacement attempt. Read these files only within the authorized workspace with existing ownership and containment checks and bounded projection. Diagnostics expose owned, redacted fields or an exact link to Spur evidence. Use current publish-window identifiers as data rather than UI tabs so L3's unified trigger can change them without another view migration.

Task 0391 owns the reader and launch binding. Task 0390 consumes its response and owns the native contribution. It must verify the packed Board in Chromium against recorded current generation, a no-content or failed run, a mixed publishing result and a voice2 history run. Verify fast selection changes, lost reader connection and old deep links. The UI stays read-only. These tasks reuse G82's verified funnel and do not depend on delivery of the other L3 features.

## Historical prompt audit (missing capabilities only)

| Missing capability | Repository evidence |
| --- | --- |
| LinkedIn article publishing | `plugins/publishings/linkedin-pub/plugin.json:7` provides feed posts with an image. The daily preset at `plugins/kk/publish-presets/daily-ai-voice.json:118` routes LinkedIn to `post` with `social:linkedin`. There is no long-form article transport or daily target. |
| Facebook promotion posts | There is no Facebook publisher under `plugins/publishings/`, no daily preset target and no generated Facebook social variant. The original design records Facebook among the missing publishers at `docs/design/kk-daily-ai-voice3.md:218`. |
| Instagram card posts | There is no Instagram publisher, daily target or generated Instagram social variant. The Threads transport's Instagram references concern login and media hosting. The original design records Instagram among the missing publishers at `docs/design/kk-daily-ai-voice3.md:218`. |
| WeChat Channels card posts linked to the Official Account article | The image operation exists and the daily preset wires generic cards (`plugins/kk/publish-presets/daily-ai-voice.json:126`). The card variant carries the XHS card payload (`plugins/kk/scripts/daily-stages.ts:2286`). The matrix's article placeholder resolves SurfDash, with no path that injects the actual Official Account article URL into the Channels card post (`apps/cli/src/publish-matrix.ts:469`). Turning the channel on would leave this link integration missing. |

An existing mode being disabled, draft-only, moved to a successor workflow or re-timed was excluded from the audit. The project already ships the owned podcast RSS path. Subscriber-side delivery is external and the repository's RSS gate validates the owned feed only. The existing WeChat Channels operation's missing link is in scope as 0395. LinkedIn Articles, Facebook and Instagram require new operations or adapters and remain separate backlog candidates.

## Implementation handoff

| Task | Owns | Waits for |
| --- | --- | --- |
| 0392 | Filter calibration and run-report statistics | — |
| 0393 | Series-scoped selection audit and evidenced fixes | — |
| 0394 | Verified article attribution for RSS items | — |
| 0384 | Judgment reconciliation, records and storage lifecycle | 0393 |
| 0385 | Audience, script, episode title | 0384, 0392, 0394 |
| 0386 | Podcast notes and card reuse | 0385 |
| 0387 | Image prompt, compositor and crop evidence | 0385 |
| 0388 | Single dispatch and social rehearsal | 0386, 0387 |
| 0391 | Board capture, evidence reader and DTO | — |
| 0390 | Native Board contribution and browser proof | 0391 |
| 0395 | Official Account link dependency for existing WeChat Channels cards | 0388 |
| 0396 | Public correction delivery evidence and recovery | 0388 |
| 0389 | Cross-pipeline replay and doc sync | 0388, 0390, 0395, 0396 |

The batch can start with 0391–0394. Use `/sp:dev-runall --feature L3 --auto` for dependency-ordered execution. Assign shared files by seam: 0391 owns launch-time capture and the reader; 0393 owns selection lifecycle; 0392 owns selection diagnostics and report output; 0394 owns citation projection. After 0388, 0395 owns the channel-specific payload and dependency, while 0396 owns correction evidence and recovery. Integrate shared publish-core edits sequentially if either task needs to change the same function. Obtain any required authorization for workflow definitions and live operations before editing or sending. Use fixtures for replay and browser verification. The missing banner reference, actual platform crops, live social receipts and source evidence for the suspected repeated story remain assigned verification inputs.

## 依据

- [AP 编辑标准](https://www.ap.org/about/news-values-and-principles/telling-the-story/)
- [Reuters 准确性与更正规范](https://reutersagency.com/about/standards-values/)
- [Google Search 标题指引](https://developers.google.com/search/docs/appearance/title-link)
- [Apple Podcast RSS 要求](https://podcasters.apple.com/support/823-podcast-requirements)
- [10 月 19 日实际节目页面](https://podcast.salty.vip/i/ai-2026-10-19-B6Y1naNFp3k/)
