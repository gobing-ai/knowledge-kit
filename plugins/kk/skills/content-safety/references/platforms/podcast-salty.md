# Salty Podcast (podcast-salty) — platform reference

`podcast.salty.vip` 是本项目自有的播客站点（Robin Min 自有域名，microfeed 实例，节目「每日AI乱炖」，RSS `/rss/`）。
这是**自有渠道**，不是第三方分发平台：没有平台审核队列、字级词表或收听量干预可引用。
本文件存在的意义是把「自有播客宿主没有平台规则」这件事写清楚，避免审核流程把「无三方平台规则」
误判成证据缺口并默认 BLOCK。

| Field | Value |
|-------|-------|
| Official source | 自有站点，无第三方协议页；本文件由站点维护者（Robin Min）本人核定 |
| Scope | `podcast.salty.vip` 节目标题、音频、show notes、封面（RSS 输出随 item 状态变化） |
| Effective date | 本文件创建日即生效（自有平台规则由维护者裁定） |
| Last verified | 2026-11-05（创建） |
| Evidence status | 维护者本人口径，非三方引用；无字级禁用词表 |

## Evidence distinctions

- **维护者裁定（本文件的权威来源）**：播客节目是自有域名下的小型日更节目，采用与本项目其他
  渠一致的通用内容纪律；没有平台方提供的可引用条款。
- **与 apple-podcasts 的边界（AP-06 不在此生效）**：Apple Podcasts 目录收录是第三方目录的准入
  问题，由维护者人工决定，不由本 pipeline 控制；本 host 的 RSS 只是自有分发的出口。对未核实
  的估值/数字，节目文案应保持项目既有的 hedging 与出处注明（这是事实纪律，不是平台准入规则），
  但**不要**因为「聚合页转述未读原文」而 block——那属于 sourcing note，由维护者自行复核。
- **通用纪律（沿用技能默认）**：AI 声明、来源可靠性、隐私/PII、医疗/投资类内容红线全部沿用
  技能 default；本文件不新增平台规则。

## Review items

| ID | Item | Grade |
|----|------|-------|
| PS-01 | 来源诚实性：show notes 中的对外引用（媒体/论文/Blog）须给出真实出处；转述链保持既有 hedging；未读原文的聚合转述记 note，不 push block。 | note |
| PS-02 | 数字与事实核对：与源链接一致的数字/日期/机构名冲突时按技能通用规则处理（correctable → revise；冲突无解 → block）。 | note→judge |
| PS-03 | 可识别个人信息（听众或第三方的私人信息） | desensitize→block if unfixable |
| PS-04 | 医疗/投资劝诱内容技能默认红线不变（未核实估值→保持 hedging 并注明出处，而非删除条目）。 | default |

## Open questions / escalation

- 自有播客无第三方审核 → 本文件不应产生 `evidenceGap: true` 类 BLOCK；任何「podcast-salty 无
  reference 文件」的发现都指向本文件缺失，而不是内容风险。
- 若未来节目上线商业化、赞助或接入第三方目录（Apple/小宇宙实际分配），本文件需要为相应渠道
  追加准入条款。
