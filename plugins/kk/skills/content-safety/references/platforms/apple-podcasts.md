# Apple Podcasts — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.

| Field | Value |
|-------|-------|
| Official source | Apple Podcasts content guidelines <https://podcasters.apple.com/support/891-content-and-subscription-guidelines> |
| Scope | 播客音频、单集标题/简介、节目元数据（RSS 侧字段经发布通道送达） |
| Effective date | unknown（页面未标注版本生效日期） |
| Last verified | 2026-09-30 — §1.1、§1.11、§1.12 已读原文；其余条款（§1.2–§1.10、§2 起）仅见标题，未逐条核验 |
| Evidence status | §1.1 / §1.11 / §1.12 为**官方原文**（下引）；其余条款未核验 → 引用时标 `evidenceGap: true` |
| Changelog | 2026-09-29 — file created (task 0189) · 2026-09-30 — 深链与 §1.1/§1.11/§1.12 原文核验，新增 AP-05/AP-06 |

## Evidence distinctions

- **官方规则**（2026-09-30 读取的原文）：
  - §1.1 Metadata Accuracy — "Podcast metadata (for example, titles, descriptions, language, etc.) must always accurately represent the corresponding content that is distributed."
  - §1.11 AI Generated Content — "Creators using AI to generate audio or video content — including synthetic voices, AI-generated hosts or on-screen personas, or AI-synthesized replicas of real individuals — must prominently disclose this to audiences in the content and metadata for each episode and show."
  - §1.12 Misleading Use of AI — "Creators must not use AI in violation of these guidelines, including to mislead or deceptively portray real-life events in their content (e.g., using AI to fabricate news stories or manipulate audio or video clips to present false narratives)."
- **用户报告**：无（本节目在该平台无下架/拒审事件记录）。
- **编辑建议（本技能）**：以下审核项为保守立场。

## Review items

| ID | Item | Grade |
|----|------|-------|
| AP-01 | **管辖口径边界**：不把国内牌照/新闻资质口径当作 Apple 规则适用 — Apple 按其自有 guidelines 审核；「无国内新闻资质」本身不是 Apple 平台的拒审理由。涉及中国大陆听众可达性的判断请回到各国内平台文件 | note |
| AP-02 | 官方 guidelines 的内容类别限制（露骨、暴力、侵权等）— 条文未核验，引用时 evidenceGap | judge |
| AP-03 | 元数据保真：标题/简介/分类不得与实际音频内容不符（官方 §1.1；通用层类别 4/5） | fix |
| AP-04 | 可识别个人信息（通用层类别 3 直映射） | desensitize |
| AP-05 | AI 合成语音披露：音频内容**和**每期、节目两级元数据都须显著说明（官方 §1.11；通用层类别 5）。缺任一处 → fix | fix |
| AP-06 | 不得用 AI 编造新闻或虚构真实事件（官方 §1.12；通用层类别 4）。无一手来源的「新闻」断言 → block | block |

## Open questions / escalation

- 首次向该平台大规模投递前，人工读一遍 guidelines 并更新本文件的 Last verified 与 AP-02。
