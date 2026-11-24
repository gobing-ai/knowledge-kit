# Apple Podcasts — platform reference

Review-item IDs here are **this skill's bookkeeping numbers**, not official platform rule codes.

| Field | Value |
|-------|-------|
| Official source | Apple Podcasts content guidelines <https://podcasters.apple.com/support/891-content-and-subscription-guidelines> |
| Scope | 播客音频、单集标题/简介、节目元数据（RSS 侧字段经发布通道送达） |
| Effective date | unknown（页面未标注版本生效日期） |
| Last verified | 2026-11-24 — §1.1–§1.12 全文与 §2（含 §2.2 Harmful or Objectionable Content、§2.4）已读原文；§1.2–§1.10 的类别限制核验完毕，AP-02 关闭 |
| Evidence status | §1.1–§1.12 与 §2 的关键条为**官方原文**（下引）；**没有**任何条款按题材（新闻/时政/贸易管制/政府）设限 — 只有 §1.12 禁止用 AI 编造新闻 |
| Changelog | 2026-09-29 — file created (task 0189) · 2026-09-30 — 深链与 §1.1/§1.11/§1.12 原文核验，新增 AP-05/AP-06 · 2026-10-08 — 操作者裁定：单集文末统一 AI 声明撤下，AP-05 改为 note · 2026-11-24 — 补读 §1.2–§1.10 与 §2，AP-02 由 `judge`(evidenceGap) 降为 `note`（见下） |

## Evidence distinctions

- **官方规则**（2026-09-30 读取的原文）：
  - §1.1 Metadata Accuracy — "Podcast metadata (for example, titles, descriptions, language, etc.) must always accurately represent the corresponding content that is distributed."
  - §1.11 AI Generated Content — "Creators using AI to generate audio or video content — including synthetic voices, AI-generated hosts or on-screen personas, or AI-synthesized replicas of real individuals — must prominently disclose this to audiences in the content and metadata for each episode and show."
  - §1.12 Misleading Use of AI — "Creators must not use AI in violation of these guidelines, including to mislead or deceptively portray real-life events in their content (e.g., using AI to fabricate news stories or manipulate audio or video clips to present false narratives)."
- **官方规则**（2026-11-24 补读；同一页面 <https://podcasters.apple.com/support/891-content-and-subscription-guidelines>）：
  - §1.2 Explicit Content — "Creators must flag individual episodes with the 'Explicit' tag if they contain explicit content (for example, profanity or content that may not be suitable for children)."（是一个**标记**义务，不是题材禁令）
  - §1.3 Self-Censored Content / §1.4 Impersonation / §1.5 Manipulation / §1.6 Incomplete Content / §1.7 Rights Infringement / §1.8 Password-Protected Content / §1.9 Duplicate Content / §1.10 Apple Copyrighted Terms — 分别为：标题不得自我审查打码；不得模仿他人；不得操纵榜单；不得只有预告/广告；不得侵权；不得密码保护；不得重复投稿；不得冒用 Apple 商标。
  - §2.2 Harmful or Objectionable Content — "Defamatory, discriminatory, or mean-spirited content … particular if the content is likely to humiliate, intimidate, harass, or harm individuals or groups or includes specific threats of violence … Professional political satirists and humorists are generally exempt from this requirement."（针对**攻击特定群体/个人**的内容；对本节目的产业新闻转述不适用）
  - §2.4 Pornographic or Sexually Explicit Content — "Content promoting sexual violence or sexual humiliation."（禁止**推广**，不是禁止报道相关诉讼/政策）
  - **页面没有任何条款按题材限制新闻、时政、贸易管制或政府相关报道**；核验时逐条确认过 §1.1–§1.12 与 §2.2/§2.4 的措辞。
- **用户报告**：无（本节目在该平台无下架/拒审事件记录）。
- **编辑建议（本技能）**：以下审核项为保守立场。

## Review items

| ID | Item | Grade |
|----|------|-------|
| AP-01 | **管辖口径边界**：不把国内牌照/新闻资质口径当作 Apple 规则适用 — Apple 按其自有 guidelines 审核；「无国内新闻资质」本身不是 Apple 平台的拒审理由。涉及中国大陆听众可达性的判断请回到各国内平台文件 | note |
| AP-02 | 官方 guidelines 的内容类别限制（露骨、暴力、侵权等）。**2026-11-24 已逐条核验**：§1.2 只要求露骨内容打 Explicit 标记，§2.2/§2.4 只禁针对群体/个人的攻击与**推广**色情或性暴力，§1.4–§1.10 是冒充/操纵/侵权/重复类；**没有按题材（新闻、时政、贸易管制、政府）设限的条款**。因此一集产业/时政新闻只要事实有出处、不推广性暴力、不攻击群体，就不构成 Apple 侧拒审理由 → 不再 escalate、不再因「规则未核验」给 BLOCK。露骨言语忘打 Explicit 标记记 fix | note |
| AP-03 | 元数据保真：标题/简介/分类不得与实际音频内容不符（官方 §1.1；通用层类别 4/5） | fix |
| AP-04 | 可识别个人信息（通用层类别 3 直映射） | desensitize |
| AP-05 | 本栏目的制作方式由频道/栏目设置说明。不要因为正文、口播或 show notes 缺少「文字由 AI 辅助整理，音频为 AI 合成配音」「本期音频为 AI 合成配音」或 “The audio in this episode is AI-synthesized.” 而记 fix，也不要提议把这些句子加回去（操作者裁定 2026-10-08）。假实测、假身份仍按 §1.1 / 类别 5 block。 | note |
| AP-06 | 不得用 AI 编造新闻或虚构真实事件（官方 §1.12；通用层类别 4）。无一手来源的「新闻」断言 → block | block |

## Open questions / escalation

- 已关闭（2026-11-24）：guidelines §1.1–§1.12 与 §2.2/§2.4 已逐条读完并更新 Last verified 与 AP-02。下一次只需复核页面是否改版，不重复整读。
- 若某集出现露骨言语，唯一动作是按 §1.2 打 Explicit 标记（AP-02 的 fix 分支），不是删稿或排除平台。
