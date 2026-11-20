---
schema_version: 1
id: "L3"
name: "每日AI乱炖节目定位、判断与分发升级"
status: active
priority: P2
tags: []
created_at: "2026-11-18T04:02:01.002Z"
updated_at: "2026-11-20T00:29:00.269Z"
---

# L3: 每日AI乱炖节目定位、判断与分发升级

## Goal

把每日AI乱炖做成面向懂一点 AI 的白领的日更节目，以可核实、易听懂的新闻和有连续性的独立评论为核心，提供一致的节目标题、清晰的节目备注、新闻封面与可预测的全渠道交付。

## Scope

- In scope: Audience and editorial policy, evidence and judgment continuity, episode format, title, notes and cards, crop-safe cover and unified publishing trigger with social rehearsals.
- In scope: Native read-only Daily AI Voice Board redesign and current/legacy evidence binding.
- In scope: Public correction delivery and the verified Official Account link dependency for the existing WeChat Channels cards route.
- In scope: Historical missing-capability audit for the other channels as planning evidence.
- In scope: Selection policy calibration and filter diagnostics, same-series selection continuity, and traceable source citations.
- In scope: Post-cut-over delivery residuals from the `kk news publish` matrix (2026-11-19 dogfood): surfdash digest headline gate (0408), en/ja locale generation for surfdash (0409), shipinhao audio receipt (0407, fixed), and the weibo article / X / Threads / LinkedIn browser rails (0410).
- Out of scope: New LinkedIn Articles, Facebook and Instagram adapters, a weekly show, bulk republishing, platform authorization changes, production schedule changes and Board execution controls.

## Acceptance Criteria

```gherkin
Feature: Daily AI News editorial and delivery uplift

  Scenario: R1 — 验证现有边界与节目基线
    # covers: I1
    Given 有现行新闻 DAG、历史运行产物与官方指引
    When 比较选题、稿件、封面、备注及发布路径
    Then 由可重放基线验证流程校验归代码、编辑判断归 Agent、目标适配归插件

  Scenario: R2 — 按受众影响选择和解释新闻
    # covers: I2
    Given 同时存在底层变更、行业动向、社会影响、市场与应用候选
    When 编辑 Agent 对候选排序后起草日更
    Then 按时效和对白领听众的影响筛选，以白话解释必要术语并把深度专题留到周更

  Scenario: R3 — 核查商业声明与评论证据
    # covers: I3
    Given 入选报道涉及企业推广、管理层利益或可能误导公众的声明
    When 编辑 Agent 审阅并核查缺失的可信来源
    Then 在文案中区分可归因事实、评论和待证推断，证据不足时归因或省略

  Scenario: R4 — 起草前对齐判断并公开纠错
    # covers: I4
    Given 选题已冻结，现有判断被新证据推翻
    When 编排在稿件生成前验证并提交新判断
    Then conclusion.md 记录有证据的新判断和被取代记录，稿件采用本期快照并明确承认错误、致歉及更正

  Scenario: R5 — 短开场和可选评论符合口播节奏
    # covers: I5
    Given 两组素材分别对应新闻充足与新闻较少的期次
    When Agent 编写口播并通过编辑评审
    Then 开场仅简短问候及一到两句要点，逐条评论可省略且至多一句，跨条目综评按价值和时长调整或省略

  Scenario: R6 — 各发布目标共用冻结的节目标题
    # covers: I6
    Given 入选条目包含可核实主线且一期日期为 2026-11-20
    When 生成并交付本期节目
    Then 中文发布标题采用第261120期 · 当日要点，封面复用同一要点，重试和历史重放保留节目身份

  Scenario: R7 — 节目备注恢复时间线并展示卡片
    # covers: I7
    Given 已冻结最终口播条目、实测时间戳及已有卡片
    When 播客插件渲染站点备注及 RSS 描述
    Then 站点呈现简短要点、来源、实测时间线与有序卡片，文章链接随真实回执出现，卡片缺失时仍可读且备注区别于正文

  Scenario: R8 — 新闻封面兼容中心裁切
    # covers: I8
    Given 已有本期标题要点和经确认的透明品牌标识
    When 图片插件生成新闻背景并由排版器合成
    Then 两个目标平台的中心裁切都保留标题要点，完整封面右上角显示缩小后的透明标识，验证产物包含参考融合及平台裁切预览

  Scenario: R9 — 各渠道由一次发布触发并保留授权矩阵
    # covers: I9
    Given 当期产物已冻结且目标包含自有媒体、第三方和微信公众号
    When 运营者触发一次统一发布并按平台检查引流准备
    Then 依赖满足的目标按既有权限执行，微信保留草稿和扫码边界，未就绪的引流可按目标重试且提供逐渠道实机测试材料

  Scenario: R10 — 重试和并发保护判断历史
    # covers: I4
    Given 两次生成读取了同一账本版本且其中一次提交成功
    When 另一运行重试或从旧快照写入
    Then 重复操作不重复追加，冲突不会覆盖已确认判断，无新判断时复用合法快照

  Scenario: R11 — Daily AI Voice follows the native Board shell
    # covers: I10
    Given an operator opens the Daily AI Voice module or a saved tab link
    When the module loads
    Then Summary, Generation and Publishing are available in the Spur shell and historical links resolve to the relevant view

  Scenario: R12 — Current generation and publishing evidence is inspectable
    # covers: I10
    Given a current news attempt with recorded stages, output artifacts and per-target publish results
    When the operator selects the run
    Then the module presents generation progress and outputs, publish status and a summary bound to that run and episode date

  Scenario: R13 — Failed and incomplete runs expose diagnostic evidence
    # covers: I10
    Given a run with a generation or publication failure
    When the operator opens the relevant detail
    Then it shows recorded failure evidence or a clear unavailable state and the selected run can be traced without exposing unrestricted files

  Scenario: R14 — 过滤规则按内容风险校准并在最终报告留证
    # covers: I11
    Given 候选含明确政策命中、偶然关键词、AI 行业相关公共议题及跨条重复
    When 日更执行过滤并生成当期报告，包括无内容的运行
    Then 规则区分内容风险、编辑相关性与渠道准入，报告列出各阶段过滤前后、命中与实际排除，零值与未采集分别显示

  Scenario: R15 — 每日节目按系列阻止重复使用已选新闻
    # covers: I12
    Given 两期出现同一原始条目、同一事件的不同转载和一条有新增事实的后续报道
    When 后续期选稿或另一系列使用同一候选
    Then 同系列排除已采用的原条目和已由可靠证据认同的重复转载，另一系列可独立选用，有实质更新的后续注明新增事实，相关判定可追溯到入选账本

  Scenario: R16 — 正文来源链接指向可核实的实际出处
    # covers: I13
    Given Horizon 提供直达原站、可信原文引用及只有聚合链接的 RSS 条目
    When 生成正文和节目备注
    Then 正文和备注共享已校验出处，直达原站时显示具体来源，聚合来源按事实标明，未核实原文的条目不伪装成已溯源

  Scenario: R17 — 已播纠错随新版节目送达并可追溯
    # covers: I4
    Given 一条已播判断被新证据纠正并已写入本期判断快照
    When 新一期经过现有审核和发布流程
    Then 口播和公开文字明确指出前期错误、道歉和正确事实，备注链接前期与证据，渠道回执可区分更正已送达和待人工处理

  Scenario: R18 — 视频号卡片只使用已确认的公众号文章链接
    # covers: I9
    Given 同一期卡片已生成且公众号所处状态分别为草稿和已公开并已核实
    When 发布批次处理预设中已有的视频号图文目标
    Then 草稿状态下只挂起该目标，公开状态下使用该期真实公众号文章链接和已有卡片，按目标重试不重复发送
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0390 | Redesign Daily AI Voice Board around generation and publishing evidence | done |
| 0396 | Deliver traceable public corrections in the next eligible episode | done |
| 0394 | Preserve RSS ingestion metadata and render traceable source citations | done |
| 0385 | Refine daily audience, spoken script and canonical episode title | done |
| 0384 | Reconcile and protect daily editorial judgments | done |
| 0410 | Weibo article, X, Threads and LinkedIn publish rails still cannot confirm a daily post | todo |
| 0389 | Replay the editorial-to-publish flow and synchronize documentation | done |
| 0386 | Restore concise podcast notes and reuse episode cards | done |
| 0409 | surfdash-pub cannot see the en/ja locale files when it invokes postsurfing from kk | todo |
| 0408 | Surf of the digest headline contract: kk demands two title headlines while the site's aligned plan can collapse to one | todo |
| 0393 | Verify and repair series-scoped selection continuity | done |
| 0391 | Bind Daily AI Voice Board to current news run and publish evidence | done |
| 0387 | Compose news covers for the two centered crops | done |
| 0395 | Bind WeChat Channels cards to the confirmed Official Account article | done |
| 0392 | Calibrate daily topic filters and report candidate losses | done |
| 0407 | shipinhao audio publish cannot read its works row, so every submission is unknown | todo |
| 0388 | Unify the news publish trigger and prepare social promotion | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-18T07:10:07.908Z backlog → active (system)

