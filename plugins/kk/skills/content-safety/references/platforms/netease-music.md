# 网易云音乐·播客 (NetEase Music podcasts) — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.

| Field | Value |
|-------|-------|
| Official source | 网易音乐人 / 播客入驻协议（URL 未在本次任务核验 — 标记 unknown，勿编造深链） |
| Scope | 播客音频、单集简介、节目页图文 |
| Effective date | unknown |
| Last verified | 未核验（本节目未向该平台投递，无事件记录） |
| Evidence status | unknown — 无官方条文核验、无用户报告、无下架/拒审事件 |
| Changelog | 2026-09-29 — file created (task 0189), placeholder rules from the generic layer only |

## Evidence distinctions

- **官方规则**：未核验。
- **用户报告**：无。
- **编辑建议（本技能）**：目前只有通用层规则映射；平台特有规则待首次核验后补充。

## Review items

| ID | Item | Grade |
|----|------|-------|
| NE-01 | 时政/公共事务主线（通用层类别 2 直映射） | block |
| NE-02 | 资质口径：新闻资讯播报形态内容（同 XY-01 逻辑；平台口径未核验 → evidenceGap） | block |
| NE-03 | 可识别个人信息 / 未经核实断言（通用层类别 3、4 直映射） | desensitize / fix |

## Open questions / escalation

- 全部证据状态为 unknown → 任何 findings 一律 `evidenceGap: true` + 人工复审；本平台不产出
  自动 `OK`（风险内容）以外的自动判定前，需先补一次官方条文核验并更新本文件。
