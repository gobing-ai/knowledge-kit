# 微信公众号 (WeChat MP) — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.

| Field | Value |
|-------|-------|
| Official source | 微信公众平台协议与《微信公众平台运营规范》，入口 <https://mp.weixin.qq.com>（具体条款深链未在本次任务核验，勿引用未经核验的深链） |
| Scope | 公众号图文、音频素材库、标题/摘要/合集 |
| Effective date | unknown（运营规范版本/生效日期未核验） |
| Last verified | 2026-09-29（仅事件层面；规则原文未逐条核验） |
| Evidence status | 规则条文**未核验**；2026-09-29 图文下架事件为**用户报告**，平台未给出书面理由 |
| Changelog | 2026-09-29 — file created after the takedown report (task 0189) |

## Evidence distinctions

- **官方规则**：存在（平台协议体系众所周知），但本任务未逐条核验 → 任何条文引用都标
  `evidenceGap: true`。
- **用户报告**：2026-09-29 下架事件；无平台反馈。
- **编辑建议（本技能）**：以下审核项为保守立场。

## Review items

| ID | Item | Grade |
|----|------|-------|
| WX-01 | 时政/公共事务主线：政治、外交/贸易管制、军事、公共政策争议、社会公共事件为主的图文或音频 | block |
| WX-02 | 资质口径：不做新闻资讯播报形态的标题/摘要（未持有相关资质；同小宇宙 XY-01 的教训） | block |
| WX-03 | AI 生成声明：图文含 AI 生成内容时按平台入口如实声明（声明入口以平台当前设置为准，未核验 → evidenceGap） | disclose |
| WX-04 | 可识别个人信息；标题党/夸大断言（未经核实断言按类别 4 处理） | desensitize / fix |

## Open questions / escalation

- 运营规范原文未核验 → 涉及条文的判断一律人工复审；本文件不得被当作条文依据引用。
