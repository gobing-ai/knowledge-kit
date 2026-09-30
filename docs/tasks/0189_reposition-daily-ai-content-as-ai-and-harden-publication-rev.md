---
schema_version: 1
name: Reposition daily AI content as AI乱炖 and harden publication review after takedowns
status: done
template: issue
created_at: 2026-09-30T05:13:07.630Z
updated_at: "2026-09-30T13:38:32.721Z"
feature_id: F61

ac_altitude: task-local
ac_numbering: task-local
priority: P1
---

## 0189. Reposition daily AI content as AI乱炖 and harden publication review after takedowns

### Background

Robin 报告：小宇宙与微信公众号内容审核通过、发布后约一小时内陆续下架；小宇宙反馈为「简介无新闻资质，请修改后重新提交」，微信无反馈。9 月 25 日《每日 AI 资讯》仍在架，9 月 29 日同系列被下架。该对照削弱标题是唯一原因的假设，但不能证明标题无风险，也不能推定微信原因或苹果播客、网易云规则相同。

一次性修整现有日更生产链：推荐保留总节目「咸话咸说」，栏目改为「AI 乱炖」，副标题「工具、论文与实践随聊」；从综合时事汇编转向真实的 AI 技术阅读与实践分享。不是用闲聊、大厂或职务代称包装原来的政治、外交、军事内容。

网信办《互联网新闻信息服务管理规定》第二、五条关注服务与内容性质，并非通用禁词清单；未找到小宇宙官方逐词禁用表。Google AI mode 的「必驳回」「保证通过」、伪装建议及虚构时间轴不采纳。法律正文证据强；具体平台下架机制未确认。

用户贴出的 9 月 29 日全文作为原始失败样本；网页抓取失败，尚未独立取得 9 月 25 日正文或真实后台配置。Anthropic 模型版本与性能数字、OpenAI 暂停训练/取消发布等重大断言未经本次核验，不视为事实；仅有 RSS 标题或 Google News 聚合地址不能支持细节。

关联仍 active 的 F61 日更端到端管线，复用已完成 L1 的 QC/生成/发布链；本任务 AC 为下架事件的修复验收，采用 task-local，不替代 F61 总体交付或已完成 L1 的功能验收。公众号仅修整已经接入的现有路径，不扩建平台能力。

Robin 后续明确要求：将社交媒体/自媒体敏感内容检测及脱敏处理集中为新的独立 agent skill，采用「通用部分 + 每个平台一个外部参考文件」两层结构，支持随规则变化维护；分离程序层与内容管理层。本任务据此调整：栏目修整是首个应用案例，共享内容政策与平台差异由 skill 管理，不散落在 TS 或工作流提示词中。

### Requirements

- [x] R1. 形成一次性栏目定位与文案包：默认「AI 乱炖｜工具、论文与实践随聊」，保留「咸话咸说」总节目；节目/栏目简介、主播简介、单集标题、简介、开场、收尾和公众号合集用语一致。身份、实测经历、更新频率及 AI 制作说明必须真实；栏目名为本任务推荐默认，可由 Robin 在执行前调整。
- [x] R2. 复用现有选题/QC seam，制定并落实技术分享选题边界：产品使用、模型文档、论文方法、编程实践可进入；以政治人物、外交/贸易管制、军事行动/采购、公共政策争议和社会公共事件为主线的条目排除或送人工复核，不用代称/八卦措辞绕过。保留被排除条目的 ID 与理由；不得删除原始来源或污染归档输入。
- [x] R3. 在既有事实核验/人工审稿流程要求关键断言追溯到具体原文与日期；官方产品、模型与价格断言对照官方来源，论文断言对照论文，第三方测试须明确归属，不冒充本人实测。RSS 标题、聚合地址、未知模型名、矛盾日期或无法支持细节的材料不得进入已核实事实；可核验条目不足时缩短或停止本期，不编造补齐。
- [x] R4. 修正共享生成源与回退路径，检查文章正文、语音脚本、实际音频、show notes、RSS 单集字段、ID3、封面文字/图片提示、互链文案与公众号合集，避免旧新闻定位被下游重新生成。简介必须匹配实际音频；时间轴取真实段落时长，不虚构。内部 plugin/工作流 ID 和 ai-news 技术分类无需为改名重构。
- [x] R5. 交付 9/29 的修订文章、脚本、音频、单集标题与简介等本地可审阅包，明确原 9 条的保留/删除/核验状态。默认剔除 #1/#2/#4/#5/#6 的公共事务主线；#3 只在证据充分且能独立讲清技术机制时考虑，#7/#8 核验后考虑，#9 无一手证据不发。不得将这些预判当作事实或平台规则；新稿以最终核验结果为准，重新生成结语。
- [x] R6. 区分平台处理：小宇宙以实际反馈为证据，微信原因未知，网易云尚无实测，Apple Podcasts 独立核对其规则。提供真实 channel/主播/RSS 字段差异清单与手动修改步骤；不新建各平台集成或自动上架监控，不把国内许可口径直接声称为苹果规则。
- [x] R7. 发布前人工核对完整本地稿件与音频；外部更名、RSS 写入、历史单集替换与重新提交须 Robin 明确授权。保留现有 feed URL、GUID、订阅关系与回退快照；记录上传成功、初审通过、持续在架为不同状态，不把发布成功当长期通过。操作包提供提交后约 1h/24h/72h 的人工检查表，此窗口是本任务观察方案而非官方要求。
- [x] R8. 先定义失败样本再修改实现，用既有 E2E/离线发布替身验证至少一个完整生成到发布载荷路径，保存可重复运行的命令与产物；同步受影响设计文档，按项目要求运行 lint/test/build/rules 和 task check，实施完成才记录 verify PASS。平台复审另记实测状态，不保证通过。 用 Superskill 管理新 skill 的 scaffold/validate/evaluate 生命周期，并做任务样本行为验证：检测、最小改写、隐私脱敏、不可修复内容拒绝/转人工、平台差异、证据过期/缺失与提示注入。不得使用同音/拆字/代称规避审核，不删改来源以掩盖内容性质，不编造个人经历；隐私发现报告不重复暴露敏感值。保留原稿与可追溯修订，只有对应最终稿件且完成复核的 PASS 可供程序消费。
- [x] R9. 新增独立 skill `plugins/kk/skills/content-safety/SKILL.md`，集中社交媒体/自媒体敏感词与语义风险识别、上下文判断和保真修订流程；两层结构为 SKILL.md 的通用流程/约束与 `references/platforms/<platform>.md` 的平台规则。首批小宇宙、微信公众号、网易云音乐、Apple Podcasts 各一个参考文件，按明确目标平台加载，不加载全部、不混同适用地区；未核实的平台文件明确记录 unknown，不虚构规则。通用部分覆盖词语歧义、真实身份/资质、可识别隐私、来源保真与必要披露的检查方式；不把所有出现「新闻」「研究所」等词的技术内容一刀切禁用。 每个平台参考文件记录官方来源 URL、规则适用范围/账号及内容类型、生效日期（未知则标记）、最近核验日期、证据状态、规则 ID 与变更记录；明确区分官方规定、用户实测反馈、编辑建议。每次使用检查适用性与时效，规则变动/冲突/涉及高风险资质且证据不足时重新查官方来源或给出待人工复核结论，不静默 PASS。新增平台只需添加参考文件及路由索引，不增加 TS 平台分支。官方明确禁用项可列规则；其余关键词只作为上下文复核提示。
- [x] R10. 明确 skill 与程序边界：skill 输入目标平台/地区/账号类型、正文及标题/简介/脚本等关联稿件、来源和允许的修订范围；输出逐项发现、规则及出处、保真修订稿与变更说明。用现有 content-judge 的 verdict 合同进行修订后复核，不能以修订动作自动授予 PASS；未核实高风险项不得被 warn 分数抵消。程序只传入上下文、调用既有 agent.run/人工审稿 seam、保留原稿/结果并消费 verdict，不硬编码敏感词、平台审核口径或替换表。FAIL/NEEDS_REVISION/缺失或不可读结果均不可自动发布，重试须复核最终版本；不新建产品 plugin kind 或重复 judge 评分引擎。

### Acceptance Criteria

- [x] AC1 — 栏目文案与真实身份一致，默认名为 AI 乱炖，所有对外文案不再将本栏目定位为新闻通报 (req: R1, R4)
- [x] AC2 — 9/29 样本及混合技术/公共事务样本在生成前有逐条准入理由；被排除条目不进入稿件/音频，原始输入保留；纯技术样本可通过而非机械禁词 (req: R2)
- [x] AC3 — 仅 RSS 标题、未知模型版本、无原文性能数字和矛盾日期不能变成肯定事实；有效官方原文/论文支持的技术条目保留，可用素材为空时不生成或发布 (req: R3)
- [x] AC4 — 正常生成、agent 失败回退及重试路径的标题/正文/口播/show notes/ID3/封面/互链/公众号载荷均符合新定位，时间轴由真实时长生成，正文与音频一致 (req: R4)
- [x] AC5 — 9/29 有完整本地修订包与九条逐项处理表，删除公共事务主线和未经核实断言，人工试听可复现；9/25 有实际取得的对照材料或明确的缺失证据标记 (req: R5, R8)
- [x] AC6 — 操作包按小宇宙、微信、网易云和苹果分别列证据/未知项与拟修改字段；没有未授权外部写入，保留 feed/GUID，列出回退与 1h/24h/72h 检查步骤 (req: R6, R7)
- [x] AC7 — 一个可重复的离线 E2E 覆盖混合样本筛选至发布载荷，产物可审阅，项目 lint/test/build/rules/task check 有结果；本地 verify 与平台复审证据分开记录 (req: R8)
- [x] AC8 — 新 skill 是共用内容政策的唯一维护入口，SKILL.md + 四个平台参考文件存在并按目标加载；合法技术上下文不会仅因关键词误杀，unknown 平台不会被当成已核实规则 (req: R9)
- [x] AC9 — 平台发现可追溯规则 ID/来源/适用范围/核验日期，过期、冲突或缺失关键依据有明确待复核结果；增添一个平台参考文件不需要修改程序判断分支 (req: R9)
- [x] AC10 — 新 skill 的发现与修订稿经现有 content-judge 独立复核，程序消费对应最终稿的 verdict；缺失/无效结果、非 PASS、修改后的旧 PASS 或重试旧稿均不能触发发布，TS/工作流不存在新增平台敏感词表或替换规则 (req: R10)
- [x] AC11 — Superskill validate/evaluate 有真实结果；行为样本展示保真改写、隐私脱敏、语义风险拒绝/转人工、平台差异、来源缺失和提示注入处理；修订不虚构事实、不规避审核、不在报告泄露敏感值 (req: R8)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

最小方案：新增一个内容管理 skill，复用 L1 的选题/QC、现有 agent 审稿、content-judge verdict、`daily-voice-style.zh.md` 和共享 stage；不引入独立程序合规引擎、全局词库、自动审核规避机制或新依赖。先锁定共同技术分享选题，再按目标平台复核最终稿件；不能让公众号继续取得已排除的原时事全文。AI 乱炖的名称/风格仍属于栏目配置，不固化为通用 skill 的适用前提。

拟定目录（参考文件是 skill 内独立文件，不是 SKILL.md 中重复粘贴的章节）：

```text
plugins/kk/skills/content-safety/
  SKILL.md
  references/platforms/
    xiaoyuzhou.md
    wechatmp.md
    netease-music.md
    apple-podcasts.md
```

第一层：通用检测与保真修订流程，区分字词命中、语义/资质风险、隐私泄露及未经核实断言；支持只检测与检测后修订两种请求，改写范围由调用方给出。第二层：一个平台一份规则/实测/未知项证据，含来源、适用范围、有效性与维护记录；仅在对应平台请求时读取。既有 tech-accuracy/compliance 判断继续交给 content-judge，新 skill 不复制其权重与评分逻辑；接线时特别验证未知高风险不能因 warn 的累计得分得到 PASS。

执行流程：共同候选计划审查 → 各目标稿件生成 → content-safety 检测/允许范围内修订 → content-judge 基于适用证据复核最终稿 → 程序消费 verdict → 已授权发布。音频应从通过内容复核的脚本生成，最终包再核对音频/简介一致性；修订使既有音频或 verdict 失效时重新生成/复核。程序只处理已有文件/状态与调用，不拥有编辑判断；原稿不覆盖，变更和规则证据随本次产物保存，报告隐藏真实隐私值。

新 skill 可独立用于其他自媒体稿件，不要求必须运行日更管线，也不依赖具体平台适配器。未支持的平台运行通用检查并明确平台规则未知；高风险处转人工，不能以「未发现关键词」宣布平台审核会通过。网页与待审文本都是证据/输入，不可授予发布权限或改变审核指令。

建议文案（执行时按真实制作流程修订）：

> AI 乱炖，是「咸话咸说」里的 AI 技术分享栏目。Robin 从开发者视角，聊聊 AI 工具、论文阅读与实践中的收获和坑。文中区分原文事实、第三方体验与个人判断，并附可追溯来源。

单集标题模式：`AI 乱炖｜<本期实际技术主题> · YYYY-MM-DD`。9/29 的具体主题和简介待核验后的条目确定，不提前宣称 Sonnet 5.5 发布或本人实测。AI 配音/生成参与按真实程度和平台要求说明；不虚构朋友对谈、个人经历和时长。

节目总名、主播个人身份与各平台 profile 属外部配置，先收集只读快照和拟修改 diff。推荐默认无需等待才可完善本地任务，但外部应用仍单独等待授权。本任务状态保持 todo；创建任务不等于已经改代码、改节目或重新发布。

### Plan

1. 只读收集两天的文章、实际 show notes/脚本/音频、RSS/channel/主播字段和下架通知，保存可用证据及缺失项；对 9/29 九条标明来源核验结果。未取得后台不阻塞本地方案，不猜配置。
2. 在代码前列出失败条件并准备可重复的离线混合样本：公共事务掺入、无原文断言、合法词语上下文误杀、隐私泄露、过期/冲突/未知规则、输入提示注入、agent 回退旧名、缓存/重试复用旧稿/旧 PASS、简介与音频不一致、来源日期错误、筛选后零条目。
3. 用 cc-cc-skills 与 Superskill 的 live leaf help scaffold `content-safety`，完善通用流程和四个平台参考文件，validate/evaluate 并以第 2 步样本验证行为；无法取得依据的项明确 unknown，不为了填满参考文件杜撰规则。
4. 确定栏目定位及准入文案包，通过现有 agent.run/人工审稿 seam 调用新 skill，复用 content-judge 复核与 gate；程序不添加平台政策判断。统一生成提示与模板/回退/重试路径，沿共享 stage 检查每个发布调用者。
5. 生成 9/29 本地修订包并试听；输出频道/合集/简介拟修改表。保留 feed URL/GUID，不自动编辑或重发历史单集，不扩建平台适配器。
6. E2E 用既有离线发布替身检查最终载荷，覆盖新 skill 到 judge 到程序 gate 的交接；按 docs/99 走设计文档同步，执行项目 gate 与 task check；记录实际 verify 证据。实施中涉及 workflow 编辑须明确确认授权，创建任务本身不等于授权实施。
7. 交付可审阅包后，获明确授权再应用后台修改/重新提交。人工分别记录各平台 1h/24h/72h 状态与反馈；未授权或未观察的状态写 pending，不能记为复审成功。反馈作为对应平台参考文件的实测证据维护，不自动升级为通用禁词规则。

### Root Cause

已观察到的生成缺口（不等于已证实的下架原因）：

- `plugins/kk/workflows/kk-daily-ai-voice.yaml:196` 明确要求 morning-news 文章与「每日 AI 资讯」标题；当前约束仅回避中国领导人姓名/国内政治，允许国际政治、外交、军事和公共事务类选题继续进入正文。
- 同文件 `:80` 和 `plugins/kk/scripts/kk-workflow-stages.ts:1263` 保留「每日AI资讯」公众号合集默认值；`:1846` 的中文播客互链亦硬编码旧栏目名。
- `plugins/generations/daily-article-gen/src/index.ts:108`、`:126` 在模板/回退路径继续生成旧标题和「条新闻」措辞。只改成功的 agent 输出会漏掉回退路径。
- 现有 `dailyQcContent`（`kk-workflow-stages.ts:720`）按类别与评分筛选；这些维度本身不能证明稿件不存在资质边界问题或事实已核实。
- 用户样本混入峰会/出口管制、国防部与军事争议、州政府诉讼、总统钢厂宣布等条目；9 条汇编加宏观结语呈现明显时事通报定位。更名不能消除正文和音频中的该定位。

待执行核查：真实 RSS/channel 描述、主播简介、9/25 与 9/29 实際 show notes/音频/公众号稿件及平台通知。不得把未读到的配置或媒体原文认定为根因。

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-workflow-stages.test.ts:1833` |
| `plugins/generations/daily-article-gen/src/index.ts:105` |
| `plugins/generations/daily-article-gen/src/index.ts:121` |
| `plugins/generations/daily-article-gen/src/index.ts:140` |
| `plugins/generations/daily-article-gen/src/index.ts:145` |
| `plugins/generations/daily-article-gen/src/index.ts:154` |
| `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:131` |
| `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:68` |
| `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:73` |
| `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:98` |
| `plugins/generations/dailynews-gen/src/index.ts:130` |
| `plugins/generations/dailynews-gen/src/index.ts:69` |
| `plugins/generations/dailynews-gen/src/script-builder.ts:316` |
| `plugins/generations/dailynews-gen/src/script-builder.ts:320` |
| `plugins/generations/dailynews-gen/src/script-builder.ts:334` |
| `plugins/generations/dailynews-gen/src/script-builder.ts:357` |
| `plugins/generations/dailynews-gen/src/script-builder.ts:385` |
| `plugins/generations/dailynews-gen/src/script-builder.ts:456` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:143` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:148` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:150` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:166` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:184` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:187` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:193` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:197` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:209` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:8` |
| `plugins/generations/dailynews-gen/tests/dailynews-gen.test.ts:91` |
| `plugins/generations/dailynews-gen/tests/script-plan.test.ts:284` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1392` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1465` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1978` |
| `plugins/kk/scripts/kk-workflow-stages.ts:2246` |
| `plugins/kk/scripts/kk-workflow-stages.ts:720` |
| `plugins/kk/scripts/kk-workflow-stages.ts:835` |
| `plugins/kk/scripts/kk-workflow-stages.ts:866` |
| `plugins/kk/scripts/validate-voicescript.ts:139` |
| `plugins/kk/scripts/validate-voicescript.ts:184` |

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | PARTIAL | Code copy is consistent: title `plugins/generations/daily-article-gen/src/index.ts:112`, intro `plugins/generations/daily-article-gen/src/index.ts:123`, greeting `plugins/generations/dailynews-gen/src/script-builder.ts:385`, AI-voice sign-off `plugins/generations/dailynews-gen/src/script-builder.ts:457`, article AI note `plugins/generations/daily-article-gen/src/index.ts:155`, collection `plugins/kk/workflows/kk-daily-ai-voice.yaml:81`. Copy pack `.spur/run/0189/ops/copy-pack.md` line 6. Missing: 主播简介 and 更新频率 are blank pending Robin (copy-pack line 19, line 20); podcast show notes and RSS metadata carry no AI-production note; live RSS still declares News category `.spur/run/0189/evidence/rss-snapshot-20260930.xml` line 27. |
| R2 | MET | Admission gate `plugins/kk/scripts/kk-workflow-stages.ts:768`, word-boundary keyword match `plugins/kk/scripts/kk-workflow-stages.ts:788`, exclusions audit with id and reason `plugins/kk/scripts/kk-workflow-stages.ts:846`; tests `plugins/kk/tests/kk-workflow-stages.test.ts:104`, `plugins/kk/tests/kk-workflow-stages.test.ts:143`, `plugins/kk/tests/kk-workflow-stages.test.ts:194`; gate run this turn 1572 pass / 0 fail. |
| R3 | MET | Date-conflict cutoff on the local run day `plugins/kk/scripts/kk-workflow-stages.ts:815`, rule text `plugins/kk/scripts/topic-boundary.json:102`; tests `plugins/kk/tests/kk-workflow-stages.test.ts:129`, `plugins/kk/tests/kk-workflow-stages.test.ts:157`, zero-kept stop `plugins/kk/tests/kk-workflow-stages.test.ts:239`. 9/29 item 9 (RSS title only) not published: `.spur/run/0189/revision/0929-disposition.md` line 16; items 3/7/8 re-verified against primary sources this run (lines 10, 14, 15). |
| R4 | MET | Computed title on mechanical and agent paths `plugins/generations/daily-article-gen/src/index.ts:144`, H1-only strip `plugins/generations/daily-article-gen/src/index.ts:141`, script title `plugins/generations/dailynews-gen/src/script-builder.ts:357`, script date from run date `plugins/kk/scripts/kk-workflow-stages.ts:1478`, cross-links `plugins/kk/scripts/kk-workflow-stages.ts:1991`, WeChat collection default `plugins/kk/scripts/kk-workflow-stages.ts:1403`, retired-name guard `plugins/kk/scripts/validate-voicescript.ts:142`; tests `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:131`, `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:138`, `plugins/kk/tests/validate-voicescript.test.ts:25`. |
| R5 | PARTIAL | Revised article, docs, script plan, script content, disposition table and reproduce notes exist under `.spur/run/0189/revision/` (disposition `.spur/run/0189/revision/0929-disposition.md` lines 8-16; script regenerated offline this run and carries the AI-voice sign-off). Missing: no audio file was rendered (TTS is a paid external call, not authorized), so the pack has no audio to audition. |
| R6 | MET | Per-platform sections `.spur/run/0189/ops/platform-field-diffs.md` line 21, line 30, line 39, line 47; measured RSS channel fields line 59; manual steps line 75. Apple rules checked independently against the official page: `plugins/kk/skills/content-safety/references/platforms/apple-podcasts.md:7`, `plugins/kk/skills/content-safety/references/platforms/apple-podcasts.md:17`, jurisdiction boundary `plugins/kk/skills/content-safety/references/platforms/apple-podcasts.md:27`. |
| R7 | MET | No external write performed this run (read-only GETs only). Human review pause `plugins/kk/workflows/kk-daily-ai-voice.yaml:277`; rollback steps `.spur/run/0189/ops/platform-field-diffs.md` line 93; 1h/24h/72h table line 106 (all rows pending); execution boundary line 123; feed snapshot `.spur/run/0189/evidence/rss-snapshot-20260930.xml`. |
| R8 | MET | Failing tests written before each fix this run (`plugins/kk/tests/kk-workflow-stages.test.ts:143`, `plugins/kk/tests/kk-workflow-stages.test.ts:157`, `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:143`, `plugins/generations/dailynews-gen/tests/script-plan.test.ts:302`); offline E2E to publish payload `plugins/kk/tests/kk-workflow-stages.test.ts:256`; `bun run gate` exit 0 this run (`.spur/run/0189-test-gate.log` line 174; 1572 pass, 0 fail, coverage 98.54% functions / 98.33% lines, rules pass); `spur task check 0189 --strict-core` pass true; superskill validate valid true, evaluate PASS grade A 0.906; behavior samples `.spur/run/0189/evidence/content-safety-reports.md` line 8, line 45, line 57, line 69, line 86. Caveat: samples are a single inline agent run. |
| R9 | MET | `plugins/kk/skills/content-safety/SKILL.md:18` two-layer design, per-platform decision and unsupported-platform BLOCK `plugins/kk/skills/content-safety/SKILL.md:73`; four reference files present under `plugins/kk/skills/content-safety/references/platforms/`; unknown status recorded `plugins/kk/skills/content-safety/references/platforms/netease-music.md:10`, `plugins/kk/skills/content-safety/references/platforms/wechatmp.md:10`. |
| R10 | PARTIAL | Skill side is complete: inputs `plugins/kk/skills/content-safety/SKILL.md:136`, output contract `plugins/kk/skills/content-safety/SKILL.md:88`, content-judge re-check `plugins/kk/skills/content-safety/SKILL.md:127`. Program side is not: `plugins/kk/workflows/kk-daily-ai-voice.yaml` has no state that invokes content-safety or content-judge or consumes a verdict; the only gate is the human pause at `plugins/kk/workflows/kk-daily-ai-voice.yaml:277`, which `skip_review` bypasses at `plugins/kk/workflows/kk-daily-ai-voice.yaml:590`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | PARTIAL | test | Generated copy passes: `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:66`, `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:143`, `plugins/kk/tests/validate-voicescript.test.ts:25`. Not met for live outward copy: feed snapshot still shows category News (`.spur/run/0189/evidence/rss-snapshot-20260930.xml` line 27) and both live items titled 每日 AI 资讯; host bio and cadence unconfirmed. |
| AC2 | MET | test | `plugins/kk/tests/kk-workflow-stages.test.ts:104`, `plugins/kk/tests/kk-workflow-stages.test.ts:143`, `plugins/kk/tests/kk-workflow-stages.test.ts:152`, `plugins/kk/tests/kk-workflow-stages.test.ts:194`; per-item reasons for 9/29 `.spur/run/0189/revision/0929-disposition.md` lines 8-16. |
| AC3 | MET | test | `plugins/kk/tests/kk-workflow-stages.test.ts:129`, `plugins/kk/tests/kk-workflow-stages.test.ts:157`, `plugins/kk/tests/kk-workflow-stages.test.ts:168`, `plugins/kk/tests/kk-workflow-stages.test.ts:239`. |
| AC4 | MET | test | `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:131`, `plugins/generations/daily-article-gen/tests/daily-article-gen.test.ts:138`, `plugins/kk/tests/kk-workflow-stages.test.ts:221`, `plugins/kk/tests/kk-workflow-stages.test.ts:256`, `plugins/generations/dailynews-gen/tests/script-plan.test.ts:302`. |
| AC5 [non-behavior] | PARTIAL | static-ref | Nine-row table `.spur/run/0189/revision/0929-disposition.md` lines 8-16; 9/25 and 9/29 originals `.spur/run/0189/evidence/0925-original.md` line 3, `.spur/run/0189/evidence/0929-original.md` line 3; offline script regeneration command in `.spur/run/0189/revision/REPRODUCE.md`. No audio rendered, so human audition is not yet possible. |
| AC6 [docs-only] | MET | static-ref | `.spur/run/0189/ops/platform-field-diffs.md` line 21, line 30, line 39, line 47, line 59, line 75, line 93, line 106, line 123; no external write performed. |
| AC7 | MET | command | `bun run gate` exit 0 this run, `.spur/run/0189-test-gate.log` line 168 (1572 pass), line 169 (0 fail), line 174; E2E `plugins/kk/tests/kk-workflow-stages.test.ts:256`; record `.spur/run/0189/evidence/e2e-publish-payload.md` line 9; `spur task check 0189 --strict-core` pass true. |
| AC8 | MET | command | `superskill skill validate` valid true this run (`.spur/run/0189/superskill-content-safety-validate.json`); `plugins/kk/skills/content-safety/SKILL.md:18`, `plugins/kk/skills/content-safety/SKILL.md:73`; word-boundary test against keyword false positives `plugins/kk/tests/kk-workflow-stages.test.ts:143`. |
| AC9 [docs-only] | MET | static-ref | `plugins/kk/skills/content-safety/references/platforms/apple-podcasts.md:7`, `plugins/kk/skills/content-safety/references/platforms/apple-podcasts.md:10`, `plugins/kk/skills/content-safety/references/platforms/apple-podcasts.md:31`, `plugins/kk/skills/content-safety/references/platforms/xiaoyuzhou.md:10`; platforms resolve by file name with no program branch `plugins/kk/skills/content-safety/SKILL.md:73`. |
| AC10 [non-behavior] | PARTIAL | static-ref | Contract documented `plugins/kk/skills/content-safety/SKILL.md:127`; no workflow state consumes a verdict, only the bypassable human pause `plugins/kk/workflows/kk-daily-ai-voice.yaml:277`, `plugins/kk/workflows/kk-daily-ai-voice.yaml:590`. No new sensitive-word table in workflow; `plugins/kk/scripts/topic-boundary.json:102` is a topic-admission spec. |
| AC11 | MET | command | `superskill skill evaluate` PASS grade A aggregate 0.906 this run (`.spur/run/0189/superskill-content-safety-evaluate.json`); samples `.spur/run/0189/evidence/content-safety-reports.md` line 8, line 45, line 57, line 69, line 86; injection handling `plugins/kk/skills/content-safety/SKILL.md:61`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PARTIAL) |

### References

- 用户 2026-09-29 提供的小宇宙原始反馈、微信无反馈观察、9/25 在架与 9/29 下架对照、9/29 全文与 Google AI mode 建议；反馈为用户报告，非本次后台实测。
- 网信办规则（已读第二、五、六条）：https://www.cac.gov.cn/2017-05/02/c_1120902760.htm
- 小宇宙官方服务协议（已读；未检索到新闻/资质逐词禁用表）：https://post.xiaoyuzhoufm.com/podcast-agreement/
- 用户失败样本页面（本次 native web 抓取失败）：https://surfing.salty.vip/zh/posts/20260929-ai-2026-09-29
- 9/25 对照 URL 根据日期推定，尚未验证路径及正文：https://surfing.salty.vip/zh/posts/20260925-ai-2026-09-25
- `plugins/kk/workflows/kk-daily-ai-voice.yaml:80`、`:102`、`:196`、`:239`、`:331`、`:382`
- `plugins/kk/scripts/kk-workflow-stages.ts:720`、`:1263`、`:1322`、`:1669`、`:1846`
- `plugins/generations/daily-article-gen/src/index.ts:108`、`:126`
- `plugins/kk/scripts/daily-voice-style.zh.md:1`（当前标题已是「每日AI科技漫谈」，内部仍用新闻表述）
- `plugins/publishings/podcast-pub/src/map.ts:16`（show notes/body 回退的发布映射）
- `docs/design/kk-daily-ai-voice.md`、`docs/design/podcast-pub.md`、`docs/99_PROJECT_CONSTITUTION.md`
- Robin 后续关于独立社交媒体/自媒体敏感内容 skill、通用 + 每个平台独立参考文件、规则时效性及程序/内容管理分层的明确要求。
- `plugins/kk/skills/content-judge/SKILL.md`、`references/rubrics.md`：既有 verdict 合同、compliance/tech-accuracy 复核，避免另建评分引擎；需验证未知高风险不会被 warn 加权抵消。
- 已读取的 `cc-cc-skills` 生命周期指导及 live `superskill skill scaffold|validate|evaluate --help`；新 skill 尚未创建，后续执行须实际验证。

### History

- 2026-09-30T08:57:33.847Z todo → wip (system)
- 2026-09-30T10:26:23.407Z wip → testing (system)
- 2026-09-30T10:33:13.229Z testing → done (system)

