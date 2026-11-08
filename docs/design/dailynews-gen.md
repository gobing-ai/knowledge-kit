# dailynews-gen Plugin Design

## 1. Purpose

`dailynews-gen` (`plugins/generations/dailynews-gen`) is a knowledge-kit generator plugin that transforms curated news articles (`Doc[]`) into a structured broadcast VoiceScript YAML `Content` object conforming to ADR-007, ADR-009, and the Generator Plugin Specification.

## 2. CLI Surface

```bash
DAILYNEWS_LANGUAGE=zh DAILYNEWS_TITLE='AI Today' VOICEBOX_DEFAULT_PROFILE=Robin \
  kk executor run dailynews-gen --in <doc-list.json> --out <content.json>
```

| Input | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `--in` | Yes | - | Input `Doc[]` JSON path |
| `--out` | Yes | - | Output `Content` JSON path |
| `DAILYNEWS_LANGUAGE` | No | `zh` | `zh` or `en` |
| `DAILYNEWS_TITLE` | No | Auto-derived | Episode title |
| `DAILYNEWS_DATE` | No | now | Broadcast date for the greeting (`YYYYMMDD` or `YYYY-MM-DD`, task 0189): a backfilled/retried run greets the episode's run date, not the render date; garbled/out-of-range values warn and fall back to now |
| `VOICEBOX_DEFAULT_PROFILE` | No | `Robin` | Voice profile carried into the VoiceScript |
| `DAILYNEWS_SCRIPT_PLAN` | No | unset | Absolute path to a `ScriptPlan` JSON (`version: 1`, intro/outro, per-item lead/insight, `docs/design/daily-voice-script-plan.md`). zh only; absent/unreadable/rejected plans fall back to templates |
| `DAILYNEWS_STYLE_FILE` | No | unset | Absolute path to the style contract (`kk:news-editorial` skill's `references/style-contract.zh.md`, ADR-045); read only when `DAILYNEWS_SCRIPT_PLAN` is set |

The directly executable plugin entry also accepts `--language`, `--title`, and `--voice-profile`;
direct flags override environment values.

### 2.1 Script plan and metadata (F613)

When `DAILYNEWS_SCRIPT_PLAN` is set, the plan is validated against the (capped) docs and the style
contract; on success it fills the intro/lead/insight/outro text slots. Segment count and order,
`emotion`/`speed`/`gap_ms` tokens, and `splitFactText` chunking stay identical to the template path,
and the greeting and sign-off remain builder-owned. Any failure falls back to templates with one
`echoError` warn line naming every `itemId`/`rule`. `Content.metadata` always carries:

- `scriptSource`: `'plan'` (valid plan applied) or `'template'` (unset env or any fallback)
- `scriptPlanErrors`: `[{ itemId, rule }]` — empty on the plan path and when the env var is unset

## 3. VoiceScript Structure

The generated `Content.body` contains a YAML serialized `VoiceScript`:

```yaml
title: 今日AI快讯（共3条）
language: zh
default_profile: Robin
segments:
  - text: 大家好，欢迎收听今日AI快讯。今天为您精选了 3 条重点动态，让我们快速浏览：
    gap_ms: 600
  - text: 第 1 条动态：OpenAI Sora 2。OpenAI发布Sora应用，集成Sora 2模型...
    gap_ms: 500
  - text: 第 2 条动态：Claude 3.7 Sonnet...
    gap_ms: 500
  - text: 以上就是今天AI快讯的全部精选内容。感谢您的收听，祝您拥有高效的一天。
    gap_ms: 300
```

`VoiceScriptSchema` validates the language, non-empty title/text, non-negative integer gaps, and
at least one segment before `Content` is written. The `Content.format` is `markdown`; only
`voice-gen`, which creates the WAV, emits `format: audio`.

## 4. Integration with voice-gen

`dailynews-gen` output feeds `voice-gen` through the workflow:
1. `dailynews-gen` generates `content.json` whose `body` is the VoiceScript YAML.
2. The workflow wraps this `Content` or VoiceScript into a single `Doc` (`mediaType: application/yaml`).
3. `voice-gen` reads the `Doc[]` and synthesizes the concatenated WAV audio and optional MP3.
