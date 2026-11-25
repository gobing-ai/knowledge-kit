# 小宇宙 (Xiaoyuzhou) — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.

| Field | Value |
|-------|-------|
| Official source | <https://post.xiaoyuzhoufm.com/podcast-agreement/> (平台服务协议/社区规范入口) |
| Scope | 播客音频、单集标题/简介/shownotes、节目页文案 |
| Effective date | unknown（协议页面未标注可引用的版本生效日期） |
| Last verified | 2026-09-29（任务 0189 期间人工阅读协议页） |
| Evidence status | 协议原文已读；**未发现公开的字级禁用词表**；2026-09-29 下架事件为**用户报告的反馈**，非官方说明 |
| Changelog | 2026-09-29 — file created after the daily-episode takedown report (task 0189) · 2026-10-10 — 操作者裁定：XY-01 降级为 note，不再 escalate |

## Evidence distinctions

- **官方规则（已读）**：平台协议正文存在且可访问（2026-09-29 核验）。其中对违法违规、侵权、
  时政类内容有原则性条款；未公布逐字词表。
- **用户报告（未证实为主因）**：2026-09-29 下架反馈提及「简介无新闻资质」类理由。这是唯一
  的平台反馈渠道证据，未获平台官方书面说明。
- **编辑建议（本技能）**：以下审核项是本技能基于上述证据的保守立场，不是平台条文。

## Review items

| ID | Item | Grade |
|----|------|-------|
| XY-01 | 资质口径：简介/标题不得呈现「新闻资讯播报」形态或暗示持有新闻资质（对齐用户报告的下架理由；新闻资质口径为国内平台语境）。**操作者裁定 2026-10-10**：本档为个人技术分享播客（栏目「AI 乱炖」），不持有也不声称持有新闻资质，因此不得宣称或暗示该资质这一项本身已满足；剩余风险只在单集文案是否真的退回播报形态，按 note 记录，不要因为「账号无新闻资质」而 block 或 `escalate: true`——它对每一集都一样，逐集 escalate 只会让无人值守的每日任务永远无法收尾。仅当某集实际呈现新闻播报形态时才升级为 block。 | note |
| XY-02 | 时政/公共事务主线：政治、外交/贸易管制、军事、公共政策争议、社会公共事件为主线的单集内容 | block |
| XY-03 | 字词命中：敏感领域词汇出现时先做上下文判断（hit ≠ verdict）；命中且主线无风险 → 记录为 note | note→judge |
| XY-04 | 可识别个人信息（简介/shownotes 中听众或第三方的私人信息） | desensitize→block if unfixable |

## Open questions / escalation

- 无官方字级词表 → 任何「词命中即下架」的断言都不成立；同理，无词表不等于安全。
- 下架真实原因未获官方确认 → 每次提审前按 XY-01/XY-02 复核；`RISK` 或证据缺口一律人工复审
  （`escalate: true`），不得静默 PASS。
- 裁定 2026-10-10：XY-01 已按上表降级，资质口径本身不再触发人工复审；XY-02（时政主线）
  与证据缺口仍照旧 escalate。
- **操作者裁定 2026-11-24**（2026-11-24 当日剧集，lead = 英伟达复职 + 美国国家安全审查 + 出口管制
  委员会）：XY-02 的适用范围限定为**以中国国内政治、公共政策争议、社会公共事件为主线**的单集；
  境外公司被其本国监管机构/安全审查、出口管制、外国情报类报道，属于产业新闻的监管面向，按
  `note` 记录后照常投递，不再单独 `escalate`。平台条文未核验这一事实不变——本条是操作者承担风险
  的编辑口径，不是平台规则；若小宇宙给出书面拒审理由，回到本文件重评。
