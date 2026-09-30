# 小宇宙 (Xiaoyuzhou) — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.

| Field | Value |
|-------|-------|
| Official source | <https://post.xiaoyuzhoufm.com/podcast-agreement/> (平台服务协议/社区规范入口) |
| Scope | 播客音频、单集标题/简介/shownotes、节目页文案 |
| Effective date | unknown（协议页面未标注可引用的版本生效日期） |
| Last verified | 2026-09-29（任务 0189 期间人工阅读协议页） |
| Evidence status | 协议原文已读；**未发现公开的字级禁用词表**；2026-09-29 下架事件为**用户报告的反馈**，非官方说明 |
| Changelog | 2026-09-29 — file created after the daily-episode takedown report (task 0189) |

## Evidence distinctions

- **官方规则（已读）**：平台协议正文存在且可访问（2026-09-29 核验）。其中对违法违规、侵权、
  时政类内容有原则性条款；未公布逐字词表。
- **用户报告（未证实为主因）**：2026-09-29 下架反馈提及「简介无新闻资质」类理由。这是唯一
  的平台反馈渠道证据，未获平台官方书面说明。
- **编辑建议（本技能）**：以下审核项是本技能基于上述证据的保守立场，不是平台条文。

## Review items

| ID | Item | Grade |
|----|------|-------|
| XY-01 | 资质口径：简介/标题不得呈现「新闻资讯播报」形态或暗示持有新闻资质（对齐用户报告的下架理由；新闻资质口径为国内平台语境） | block |
| XY-02 | 时政/公共事务主线：政治、外交/贸易管制、军事、公共政策争议、社会公共事件为主线的单集内容 | block |
| XY-03 | 字词命中：敏感领域词汇出现时先做上下文判断（hit ≠ verdict）；命中且主线无风险 → 记录为 note | note→judge |
| XY-04 | 可识别个人信息（简介/shownotes 中听众或第三方的私人信息） | desensitize→block if unfixable |

## Open questions / escalation

- 无官方字级词表 → 任何「词命中即下架」的断言都不成立；同理，无词表不等于安全。
- 下架真实原因未获官方确认 → 每次提审前按 XY-01/XY-02 复核；`RISK` 或证据缺口一律人工复审
  （`escalate: true`），不得静默 PASS。
