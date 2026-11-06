# 小红书 (Xiaohongshu / xhs) — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.
与 xiaoyuzhou.md 同一格式约定：这是本技能基于操作者已核验证据的保守立场，不是平台条文。

| Field | Value |
|-------|-------|
| Official source | <https://www.xiaohongshu.com/community/>（社区公约/创作细则入口，多级页面） |
| Scope | 笔记（图文/视频长文）、封面图、话题标签、昵称简介 |
| Effective date | unknown（社区公约页面未标注可引用的版本生效日期） |
| Last verified | 2026-11-05（写本文件时按操作者已有账号审查经验整理，未逐字读官方更新后全文） |
| Evidence status | **未获官方逐字条文**；以下审核项是本技能的保守立场，不是平台条文；与小宇宙 0189 事件类似，任何具体下架理由以官方为主，本技能按保守项判断 |

## Evidence distinctions

- **官方规则（已知存在，未逐字核对）**：小红书有《社区公约》与《创作规范》，对违法违规、医疗
  健康、财产投资、隐私、低质同质化、AI 生成内容有原则性条款；公开文本不提供逐字词表。
- **操作者经验（保守立场来源）**：账号为个人技术分享（栏目「AI 乱炖」衍生），非新闻机构、无
  医疗/金融资质、不带货；发帖以图文长文/播客预告为主。
- **编辑建议（本技能）**：以下审核项是本技能基于上述证据的保守立场，不是平台条文。

## Review items

| ID | Item | Grade |
|----|------|-------|
| XH-01 | 资质口径：不得呈现「新闻资讯播报」形态或暗示持有新闻资质（技术/科普类分享不受影响；同 xiaoyuzhou.md XY-01 的操作者裁定 2026-10-10，按 note 记录，不逐集 escalate）。 | note |
| XH-02 | 医疗健康/药品/诊疗建议：以医疗结论、疗效、用药指导为主线的内容（本栏目主题为 AI 技术/产业资讯，正常不会触发；一旦触发按 block）。 | block |
| XH-03 | 投资/理财：以个股买卖建议、收益承诺为主线的内容（对 quadrature/Anthropic 等估值表述属于普通事实转述，不是建议；命中后再 judge）。 | block |
| XH-04 | AI 生成内容标识：平台对 AI 生成内容有标注要求（** 未逐字核对当前接口规则，按公共常见要求保守处理**）。本栏目发布为「AI 辅助创作」的播客预告/图文 —— 操作者已在账号简介披露 AI 辅助；单条内容不再逐条 escalate。 | note |
| XH-05 | 可识别个人信息（听众或第三方的私人信息、联系方式、住址等） | desensitize→block if unfixable |
| XH-06 | 时政/公共事务主线：同 xiaoyuzhou.md XY-02（政策管制、军事、公共政策争议为主线的内容按 block）。 | block |

## Open questions / escalation

- 无官方字级词表 → 任何「词命中即下架」的断言都不成立；同理，无词表不等于安全。
- AI 标注、内容审核新规变化频繁 → 每次提审前按 XH-04 复核；`RISK` 或证据缺口一律人工复审
  （`escalate: true`），不得静默 PASS。
- 资质口径、时政主线与个人信息的红线全部沿用技能默认，本文件只 diminute XH-04 的逐条 escalate
  （业务上固定披露已存在）。
