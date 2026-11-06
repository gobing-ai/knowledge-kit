# Salty Talk / Surfing (surfdash) — platform reference

`surfing.salty.vip` 是本项目自有的静态发布站点（Robin Min 自有域名，栏目「AI 乱炖」，zh/en/ja 三语）。
这是**自有渠道**，不是第三方分发平台：没有平台审核队列、字级词表或 AI 标注接口可引用。
本文件存在的意义是把「自有站点没有平台规则」这件事写清楚，避免审核流程把「无三方平台规则」
误判成证据缺口并默认 BLOCK。

| Field | Value |
|-------|-------|
| Official source | 自有站点，无第三方协议页；本文件由站点维护者（Robin Min）本人核定 |
| Scope | `surfing.salty.vip` 文章页（正文、frontmatter 的 title/description/key_points/cover） |
| Effective date | 本文件创建日即生效（自有平台规则由维护者裁定） |
| Last verified | 2026-11-05（创建） |
| Evidence status | 维护者本人口径，非三方引用；无字级禁用词表 |

## Evidence distinctions

- **维护者裁定（本文件的权威来源）**：站点是自有域名下的小型技术/资讯栏目，采用与本项目其他
  台一致的通用内容纪律；没有平台方提供的可引用条款。
- **通用纪律（沿用技能默认）**：披露/AI 声明、来源可靠性、隐私/PII、医疗/投资类内容红线全部
  沿用技能 default；本文件不新增平台规则。

## Review items

| ID | Item | Grade |
|----|------|-------|
| SD-01 | 来源诚实性：对外引用（媒体/论文/Blog）须给出真实出处链接；「综述性转述未读原文」是 sourcing gap，按 note 记录并在站点正文保持既有 hedging；**不要**因为转述来自聚合页/未读原文而 block——这与 apple-podcasts 的 AP-06 严格度不同，自有站点由维护者自行判断并复核。 | note |
| SD-02 | 数字与事实核对：与源链接一致的数字/日期/机构名出现冲突时按技能通用规则处理（correctable → revise；冲突无解 → block）。 | note→judge |
| SD-03 | 可识别个人信息（听众或第三方的私人信息、联系方式、住址等） | desensitize→block if unfixable |
| SD-04 | roku/医疗/投资劝诱内容技能默认红线不变（本文件不放开任何默认红线）。 | default |

## Open questions / escalation

- 自有站点无第三方审核 → 本文件不应产生 `evidenceGap: true` 类 BLOCK；任何「surfdash 无 reference
  文件」的发现都指向本文件缺失，而不是内容风险。
- 若未来站点引入广告或国家安全审查类规则，本文件需要更新。
