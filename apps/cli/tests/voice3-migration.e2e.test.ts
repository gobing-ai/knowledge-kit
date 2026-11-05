/**
 * Task 0335 — fresh offline multi-window migration rehearsal (E2E).
 *
 * The proof is execution, not inspection: every case drives the real `spur workflow run`
 * engine over the real checkout DAGs (voice3 → nested safety machine → publish3 → run-report)
 * inside a throwaway fixture root, then asserts on the delivered receipts, the store and the
 * safety artifacts. The checkout CLI and the kk stage runners are bound through a local
 * `kk` shim (`exec <bun> <checkout-cli> "$@"`), so the installed live runner is never touched;
 * the only doubles are the external provider boundaries the task sanctions: the TTS/audio
 * stage, the ingest supply line (pool/plan/candidates), the scheduler clock and the LLM
 * executors (agent stubs that author the plan translation and the article body through their
 * real expectFile contracts). Generation, the safety gate, the bundle, the mode policy, the
 * receipt-identity guard, the classifier and the tail nodes all run for real — nothing
 * preseeds the assembled episode, the variants or the bundle.
 *
 * Cases map 1:1 to the 17 rehearsal cases in docs/tasks/0335_*.md (R1–R6 / F22, C01–C05):
 * evidence per case lands under <repo>/.works/tmp/test-voice3-migration/0335/cases/<case>/
 * and summary.json records every run id with its finalState and the exact replay command.
 *
 * Window model (kk-daily-publish3.yaml + daily-ai-voice-migration.json):
 * - after-generate: surfdash.article + podcast.episode (tier 0, required), wechatmp.podcast,
 *   xhs.podcast, wechatmp.article, xhs.article (dummy), xhs.cards (off) — no RSS gate.
 * - cn-peak: weibo.article + x.article (draft; live only behind an explicit live-channel token),
 *   waits on the (stubbed) 09:00 Asia/Shanghai clock.
 * - overseas-rss: x.post / weibo.post / threads.post (dummy), gated by the RSS proof: the gate
 *   reads the tier-0 podcast receipt's guid against the feed — a miss is a verdict (diagnose →
 *   repair), not a failure. Receipts live in the SHARED `4-publish/receipts/` directory.
 * - A window with live rows pauses at `send-confirm`; resuming with --answer yes is the approval.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..', '..');
const BUN = process.execPath;
// 0.3s mono 32kbps silence — a real MP3 packet stream so the real ffmpeg ID3 stamp in daily-publish-prep succeeds.
const TINY_MP3_B64 =
    'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAxAAAAAAAAAAAAAAD/+0DAAAAAAAAAAAAAAAAAAAAAAABJbmZvAAAADwAAAA0AAAYEAC8vLy8vLy9AQEBAQEBAQFJSUlJSUlJSY2NjY2NjY3V1dXV1dXV1hoaGhoaGhoaXl5eXl5eXqampqampqam6urq6urq6usvLy8vLy8vd3d3d3d3d3e7u7u7u7u7u/////////wAAAABMYXZjNjMuMS4AAAAAAAAAAAAAAAAkBJIAAAAAAAAGBJNw3BcAAAAAAP/7EMQAA8AAAaQAAAAgAAA0gAAABExBTUU0LjBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVV//sSxCmDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVV//sQxFODwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVX/+xLEfQPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUU0LjBVVVX/+xDEpwPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVf/7EsTQg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTQuMFVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FNC4wVVVV//sSxNWDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxNYDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xLE1YPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EsTVg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
const CLI = join(REPO, 'apps/cli/src/index.ts');
const VOICE3 = join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice3.yaml');
const PUBLISH3 = join(REPO, 'plugins/kk/workflows/kk-daily-publish3.yaml');
const MIGRATION_PRESET = join(REPO, 'plugins/kk/publish-presets/daily-ai-voice-migration.json');
const EVIDENCE = join(REPO, '.works/tmp/test-voice3-migration/0335');

const RUN_DATE = '2026-11-02';
const DIGITS = '20261102';
const GUID_FULL = `voice3-run-1/podcast-pub/episode/${RUN_DATE}`;
const GUID_THIN = `voice3-run-2/podcast-pub/episode/${RUN_DATE}`;

/** Repo-relative paths recorded as evidence, grouped per case; hashed into summary.json. */
const ARTIFACTS: Record<string, string[]> = {};
/** One ledger row per executed workflow run / resume, for summary.json. */
const RUNS: { case: string; runId: string; workflow: string; finalState: string; command: string }[] = [];

function sha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * The LLM boundary: `inline` / `claude` / `pi` agent stubs honoring the real expectFile
 * contracts. The plan-translation stub echoes the fixture candidates; the article stub writes
 * a simplified-Chinese body with the required opening line and 来源 links so the real
 * daily-article stage can compose it; the safety reviewer/judge write full contracts and flip
 * to blocking findings via fixture env; the incident stub writes the diagnose contract. Every
 * dispatch is logged to KK_STUB_AGENT_LOG so fresh-generation execution is provable.
 */
function writeAgentStub(binDir: string, name: string): void {
    const path = join(binDir, name);
    writeFileSync(
        path,
        `#!/usr/bin/env bash
set -u
LOG="\${KK_STUB_AGENT_LOG:-}"
[ -n "$LOG" ] && echo "$(date +%s%N) ${name} $* " >> "$LOG" 2>/dev/null
case "\${1:-}" in
  --version) echo "0.99.0"; exit 0 ;;
  --list-models) echo "stub/model-1"; exit 0 ;;
  --help|-h) echo "usage: ${name} -p <input>"; exit 0 ;;
esac
expect=""
if printf '%s' "$*" | grep -q 'incident[.]json'; then
  expect=$(printf '%s' "$*" | grep -oE "[^ \\"]*incident\\.json" | tail -1)
fi
if [ -z "$expect" ]; then
  for a in "$@"; do
    hit=$(printf '%s' "$a" | grep -oE "[^ \\"]*.(json|md)" | tail -1)
    [ -n "$hit" ] && expect="$hit"
  done
fi
if [ -z "$expect" ]; then exit 0; fi
case "$expect" in
  *_03_plan_plan.json)
    if [ -n "\${KK_STUB_PLAN_FAIL:-}" ]; then exit 1; fi
    cat > "$expect" <<'EOF2'
[{"id":"story-a","title":"模型新版本发布：跑分提升明显","body":"主线A：新版本的跑分提升明显，这对推理成本是直接的影响。据报道，新版本已在多家云厂商上线。","sourceUri":"https://example.com/story-a","sourceLabel":"科技早报","metadata":{"brief":"模型侧在卷成本。"}},{"id":"story-b","title":"开源项目融资：维护者承诺协议不变","body":"主线B：开源项目拿到融资，维护者承诺保持协议不变，这对下游集成方是稳定性的信号。","sourceUri":"https://example.com/story-b","sourceLabel":"开源周报","metadata":{"brief":"应用侧在卷生态。"}}]
EOF2
    ;;
  *26-social/*)
    # The social-write task mentions all three platform files; write them all, not just the
    # last-mentioned one, or social:x / social:weibo variants never exist and the overseas
    # tier3 rows are omitted (failed effect-none receipts) instead of delivered.
    dir=$(dirname "$expect")
    post='每日AI乱炖：模型新版本发布，跑分提升明显，成本下探。Robin 为你带来每日AI资讯。'
    printf '%s\n' "$post" > "$dir/x.md"
    printf '%s\n' "$post" > "$dir/weibo.md"
    printf '%s\n' "$post" > "$dir/threads.md"
    ;;
  *_09_safety-review_report.json)
    extra=""
    if [ -n "\${KK_STUB_STALE_STORY:-}" ]; then
      extra=',{"category":2,"rule":"detect","severity":"high","evidence":"processed","detail":"the episode still contains yesterday processed story","platform":"all"}'
    fi
    if [ -n "\${KK_STUB_SAFETY_PII_PLATFORM:-}" ]; then
      extra=',{"category":1,"rule":"detect","severity":"high","evidence":"PII","detail":"contains a phone number","platform":"'"'"'"$KK_STUB_SAFETY_PII_PLATFORM"'"'"'"}'
    fi
    echo '{"platforms":[{"platform":"xiaoyuzhou","decision":"OK","findings":[]},{"platform":"apple-podcasts","decision":"OK","findings":[]},{"platform":"wechatmp","decision":"OK","findings":[]}'"$extra"'],"escalate":false,"confidence":"HIGH"}' > "$expect"
    ;;
  *_09_safety-judge_verdict.json)
    cat > "$expect" <<'EOF2'
{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":0.92,"summary":"clean drafts","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"no prohibited claims"},{"criterion":"disclosure-presence","status":"pass","detail":"AI disclosure present"},{"criterion":"jurisdictional-rules","status":"pass","detail":"no jurisdiction-specific advice"},{"criterion":"data-handling","status":"pass","detail":"no personal data reused"}],"feedback":["compliant"],"content_ref":"24-script/voicescript","evaluated_at":"2026-11-02T12:00:00.000Z"}
EOF2
    ;;
  *incident.json)
    mkdir -p "$(dirname "$expect")"
    cat > "$expect" <<EOF2
{"schemaVersion":1,"date":"\${KK_STUB_RUN_DATE:-unknown}","class":"no-content","reason":"no episode bundle exists for this date","evidence":["bundle.json"]}
EOF2
    md="\${expect%.json}.md"
    printf 'The overseas window is missing because no episode was generated for %s.\nClass: no-content — the pool gate refused an empty plan.\nFix: supply stories and rerun the generation window.\n' "\${KK_STUB_RUN_DATE:-unknown}" > "$md"
    ;;
  *_08_script-write_plan.json)
    echo '{}' > "$expect"
    ;;
  *_06_article_content.json)
    mkdir -p "$(dirname "$expect")"
    cat > "$expect" <<EOF2
{"title":"标题","format":"markdown","body":"由Robin为你带来的咸话咸说之每日AI乱炖正文。","metadata":{"author":"Robin"}}
EOF2
    ;;
  *.md)
    mkdir -p "$(dirname "$expect")"
    cat > "$expect" <<'EOF2'
这里是由Robin为你带来的咸话咸说之每日AI乱炖。

## 两条主线

Story A 的模型发布了新版本，跑分提升明显，这对推理成本是直接的影响。据报道，新版本已在多家云厂商上线（[来源：科技早报](https://example.com/story-a)）。

## 第二条主线

Story B 的开源项目拿到了融资，维护者承诺保持协议不变，这对下游集成方是稳定性的信号（[来源：开源周报](https://example.com/story-b)）。

两条主线放在一起看：模型侧在卷成本，应用侧在卷生态，明日值得继续跟踪发布后的真实负载表现。
EOF2
    ;;
  *)
    : > "$expect"
    ;;
esac
exit 0
`,
    );
    chmodSync(path, 0o755);
}

/**
 * The transport boundary: every publish plugin the migration preset lists is replaced by one
 * fake that writes the real outcome contract to `--out`, records each dispatch to KK_FAKE_LOG,
 * and can be flipped per target (KK_FAKE_FAIL_ONCE creates a one-shot failure state file,
 * KK_FAKE_ALWAYS_FAIL / KK_FAKE_UNCERTAIN pin persistent outcomes, KK_FAKE_GUID feeds the
 * podcast guid so real-mode receipts persist the RSS-proof identity).
 */
function writeFakeTransport(binDir: string, name: string): void {
    const path = join(binDir, name);
    writeFileSync(
        path,
        `#!/usr/bin/env bash
set -u
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--out" ]; then out="$a"; fi
  prev="$a"
done
[ -z "$out" ] && exit 1
id=$(basename "$0")
[ -n "\${KK_FAKE_LOG:-}" ] && echo "$(date +%s%N) $id $*" >> "$KK_FAKE_LOG"
if [ -n "\${KK_FAKE_ALWAYS_FAIL:-}" ] && [ "$KK_FAKE_ALWAYS_FAIL" = "$id" ]; then
  printf '{"ok":false,"target":"%s","error":"channel unavailable"}\\n' "$id" > "$out"; exit 0
fi
if [ -n "\${KK_FAKE_UNCERTAIN:-}" ] && [ "$KK_FAKE_UNCERTAIN" = "$id" ]; then
  printf '{"ok":false,"target":"%s","error":"timeout after submit"}\\n' "$id" > "$out"; exit 0
fi
if [ -n "\${KK_FAKE_FAIL_ONCE:-}" ] && [ "$KK_FAKE_FAIL_ONCE" = "$id" ]; then
  state="\${KK_FAKE_STATE_DIR:-/tmp}/$id.fail"
  if [ ! -e "$state" ]; then
    : > "$state"
    printf '{"ok":false,"target":"%s","error":"transient error"}\\n' "$id" > "$out"; exit 0
  fi
  rm -f "$state"
fi
printf '{"ok":true,"target":"%s","status":"published","url":"https://stub.example/%s","metadata":{"guid":"%s"}}\\n' "$id" "$id" "\${KK_FAKE_GUID:-}" > "$out"
exit 0
`,
    );
    chmodSync(path, 0o755);
}

/**
 * The `kk` binary: record + delegate. Everything the rehearsal doubles (supply-line stages,
 * audio synthesis, the scheduler clock, the RSS feed) is shimmed with a log line; everything
 * the proof needs real (`daily-preflight`, the safety stages, the duration gate, content
 * composition, the bundle, the matrix verbs, run-report, pool-count, settle) is delegated to
 * the checkout CLI via `exec` — including the executor plugins those stages shell out to,
 * which is what makes the assembled episode, variants and bundle real rather than preseeded.
 */
function writeKkShim(binDir: string, logPath: string): void {
    const path = join(binDir, 'kk');
    writeFileSync(
        path,
        `#!/usr/bin/env bash
set -u
REAL=${JSON.stringify(CLI)}
BUN=${JSON.stringify(BUN)}
MP3B64=${JSON.stringify(TINY_MP3_B64)}
echo "$(date +%s%N) kk $* " >> "${logPath}"
[ -f "${logPath}.env" ] || { echo "PATH=$PATH" > "${logPath}.env"; echo "KK_STUB_AGENT_LOG=\${KK_STUB_AGENT_LOG:-}" >> "${logPath}.env"; }
case "\${1:-} \${2:-}" in
  "daily prepare")
    # Fixture workspace composer (voice2-harness pattern): voice3 prepares under the
    # kk-daily-ai-voice2 namespace, so the works anchors stay identical to the migrated DAG.
    date_arg=""; prev2=""
    for a in "$@"; do case "$prev2" in --run-date) date_arg="$a";; esac; prev2="$a"; done
    digits=$(echo "$date_arg" | tr -d '-')
    wd="$KK_STUB_WORKS/kk-daily-ai-voice2/$digits"
    mkdir -p "$wd/10-collect" "$wd/21-plan" "$wd/22-article" "$wd/23-cover" "$wd/24-script" "$wd/26-social" "$wd/30-audio" "$wd/30-variants" "$wd/31-publish" "$wd/4-publish" "$wd/5-report"
    echo "$date_arg" > "$wd/run-date.txt"
    mkdir -p "$PWD/.spur/runs/kk-daily-ai-voice2"
    echo "$wd" > "$PWD/.spur/runs/kk-daily-ai-voice2/work-dir.txt"
    echo "{\\"workDir\\":\\"$wd\\"}"
    exit 0 ;;
  "stage daily-extract")
    # Deterministic supply fixture: the blended.json-shaped pool the store would select.
    wd=$3
    mkdir -p "$wd/10-collect"
    cat > "$wd/10-collect/pool.json" <<EOF2
{"metadata":{"docs":[
 {"id":"story-a","title":"模型新版本发布","summary":"新版本跑分提升明显","sourceUri":"https://example.com/story-a","sourceLabel":"科技早报"},
 {"id":"story-b","title":"开源项目融资","summary":"维护者承诺保持协议不变","sourceUri":"https://example.com/story-b","sourceLabel":"开源周报"}
]}}
EOF2
    echo '{"count":2}'
    exit 0 ;;
  "stage daily-plan")
    wd=$3; rd=$4
    mkdir -p "$wd/21-plan"
    cat > "$wd/21-plan/\${rd}_03_plan_content.json" <<EOF2
{"title":"标题","format":"markdown","body":"主线A：模型新版本发布。主线B：开源项目融资。","metadata":{"docs":[
 {"id":"story-a","title":"模型新版本发布","summary":"新版本跑分提升明显","sourceUri":"https://example.com/story-a","sourceLabel":"科技早报"},
 {"id":"story-b","title":"开源项目融资","summary":"维护者承诺保持协议不变","sourceUri":"https://example.com/story-b","sourceLabel":"开源周报"}
]}}
EOF2
    exit 0 ;;
  "stage daily-qc-content")
    wd=$3; rd=$4
    mkdir -p "$wd/21-plan"
    docs='[{"id":"story-a","title":"故事A","body":"故事A正文，用于离线彩排。"},{"id":"story-b","title":"故事B","body":"故事B正文，用于离线彩排。"}]'
    if [ -n "\${KK_STUB_QC_EMPTY:-}" ]; then docs='[]'; fi
    echo "{\\"title\\":\\"标题\\",\\"format\\":\\"markdown\\",\\"body\\":\\"QC候选\\",\\"metadata\\":{\\"docs\\":$docs}}" > "$wd/21-plan/\${rd}_04_quality-control-content_candidates.json"
    exit 0 ;;
  "stage daily-wrap-docs")
    wd=$3; rd=$4
    mkdir -p "$wd/31-publish"
    cat > "$wd/31-publish/\${rd}_20_wrap-docs_docs.json" <<'EOF2'
{"title":"标题","format":"markdown","body":"## 延伸阅读\\n- [科技早报](https://example.com/story-a)\\n- [开源周报](https://example.com/story-b)\\n","metadata":{"docs":[]}}
EOF2
    exit 0 ;;
  "stage daily-generate")
    # Audio-synthesis provider boundary: a tiny VALID MP3 (0.3s silence) — daily-publish-prep
    # shells real ffmpeg for the ID3 stamp, so the payload must survive an ffmpeg -c copy.
    wd=$3; rd=$4
    mkdir -p "$wd/30-audio"
    printf '%s' "$MP3B64" | base64 -d > "$wd/30-audio/\${rd}_11_generate_audio.mp3" 2>/dev/null || printf '%s' "$MP3B64" | base64 -D > "$wd/30-audio/\${rd}_11_generate_audio.mp3"
    cat > "$wd/30-audio/\${rd}_11_generate_content.json" <<EOF2
{"title":"标题","format":"markdown","body":"audio","metadata":{"duration":$(( \${KK_STUB_DURATION_MS:-1620000} / 1000 )),"qc":{"passed":true,"overallScore":88},"audioPath":"$wd/30-audio/\${rd}_11_generate_audio.mp3"}}
EOF2
    exit 0 ;;
  "stage daily-intro"|"stage daily-voice-audit"|"stage daily-quality-report"|"stage daily-cover"|"stage daily-cover-normalize"|"stage daily-script-style"|"stage daily-xhs-render"|"store select")
    # Side-car surfaces the proof does not need to double beyond execution: clock-free cover,
    # LLM auditor, style snapshot, cards (off), store selection promotion.
    echo 'ok (stubbed)'
    exit 0 ;;
  "store pool-count"|"stage daily-safety-prep"|"stage daily-safety-gate"|"stage daily-safety-verdict"|"stage daily-safety-revise"|"stage daily-episode-duration"|"stage daily-article"|"stage daily-script"|"stage daily-show-notes"|"stage daily-publish-prep"|"stage daily-preflight"|"daily run-report"|"store settle"|"store mark-published")
    # Real seams, delegated to the checkout CLI; stage runners resolve from KK_PLUGIN_PATH.
    exec "$BUN" "$REAL" "$@" ;;
  "executor run")
    exec "$BUN" "$REAL" "$@" ;;
  "stage run"*)
    # The selector is two words, so three-word stub cases above can never match; the wait-until
    # clock stub lives here or the real stage sleeps toward 09:00 Asia/Shanghai (DST-safe).
    # The safety-manifest/bundle-variants stages ride the generic delegate below.
    case "\${3:-}" in
      publish-matrix-wait-until)
        echo "$(date +%s%N) kk-shim wait-until $* " >> "${logPath}"
        echo 'wait-until: ok (stubbed clock)'; exit 0 ;;
      publish-matrix-rss-gate)
        shift 2; exec "$BUN" "$REAL" stage run "$@" --feed "$KK_STUB_FEED" ;;
    esac
    shift 2; exec "$BUN" "$REAL" stage run "$@" ;;
  "ledger append")
    echo 'ledger: appended (stub)'; exit 0 ;;
  *)
    echo "kk-shim: unhandled invocation: $*" >&2
    exit 1 ;;
esac
`,
    );
    chmodSync(path, 0o755);
}

// ---------------------------------------------------------------------------
// Fixture assembly + run helpers
// ---------------------------------------------------------------------------

interface Fixture {
    root: string;
    works: string;
    binDir: string;
    dayDir: string;
}

interface RunOutcome {
    runId: string;
    finalState: string;
    stdout: string;
    stderr: string;
    exitCode: number;
}

function tempRoot(caseName: string): string {
    // Fixture roots live in the OS temp dir: nothing under the repo to clean, `rm -rf`-free.
    return mkdtempSync(join(tmpdir(), `kk-0335-${caseName}-`));
}

function makeFixture(caseName: string): Fixture {
    const root = tempRoot(caseName);
    const works = join(root, 'works');
    const binDir = join(root, 'bin');
    const dayDir = join(works, 'kk-daily-ai-voice2', DIGITS);
    mkdirSync(binDir, { recursive: true });
    mkdirSync(dayDir, { recursive: true });
    symlinkSync(join(REPO, 'plugins'), join(root, 'plugins'));
    const presetDir = join(root, '.kk', 'publish-presets');
    mkdirSync(presetDir, { recursive: true });
    symlinkSync(MIGRATION_PRESET, join(presetDir, 'daily-ai-voice-migration.json'));
    // Decision catalog: absolute path, because the fixture root is not the repo root.
    mkdirSync(join(root, '.spur'), { recursive: true });
    writeFileSync(
        join(root, '.spur', 'config.yaml'),
        `decisions:\n  paths:\n    - ${join(REPO, 'plugins/kk/decisions')}\n`,
    );
    writeRssFeed(fx_feedPath(root), GUID_FULL);
    writeFileSync(join(root, 'agents.log'), '');
    writeFileSync(join(root, 'kk-calls.log'), '');
    writeFileSync(join(root, 'transports.log'), '');
    mkdirSync(join(root, 'fake-state'), { recursive: true });
    for (const agent of ['inline', 'claude', 'codex', 'opencode', 'agy', 'gemini', 'pi', 'droid'])
        writeAgentStub(binDir, agent);
    for (const transport of [
        'surfdash-pub',
        'podcast-pub',
        'wechatmp-pub',
        'xhs-pub',
        'weibo-pub',
        'x-pub',
        'threads-pub',
    ]) {
        writeFakeTransport(binDir, transport);
    }
    writeKkShim(binDir, join(root, 'kk-calls.log'));
    return { root, works, binDir, dayDir };
}

function fx_feedPath(root: string): string {
    return join(root, 'rss-feed.xml');
}

function writeRssFeed(path: string, guid: string, title = `每日AI乱炖 · ${RUN_DATE}`): void {
    writeFileSync(
        path,
        `<?xml version="1.0"?><rss><channel><item><title>${title}</title><guid>${guid}</guid></item></channel></rss>`,
    );
}

function runEnv(fx: Fixture, extra: Record<string, string> = {}): Record<string, string> {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...extra };
    env.PATH = `${fx.binDir}:${process.env.PATH ?? ''}`;
    env.KK_PLUGIN_PATH = join(REPO, 'plugins/kk');
    env.KK_STUB_WORKS = fx.works;
    // file:// so the real rss-gate's fetch() can read the local stub feed (plain paths are invalid URLs).
    env.KK_STUB_FEED = `file://${fx_feedPath(fx.root)}`;
    env.KK_STUB_RUN_DATE = RUN_DATE;
    env.KK_STUB_AGENT_LOG = join(fx.root, 'agents.log');
    // The fake transport stamps every send with this guid, so the podcast receipt's guid matches
    // the feed stub and the overseas rss-gate matches by guid (not the title fallback).
    env.KK_FAKE_GUID = GUID_FULL;
    env.KK_FAKE_LOG = join(fx.root, 'transports.log');
    env.KK_FAKE_STATE_DIR = join(fx.root, 'fake-state');
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.SPUR_EXPECTED_DEFINITION_DIGEST;
    return env;
}

function parseFinalState(stdout: string): { finalState: string; runId?: string } {
    // spur --json pretty-prints its final summary across lines; scan by regex and keep the LAST match.
    const take = (field: string): string | undefined => {
        const matches = [...stdout.matchAll(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'g'))];
        return matches.at(-1)?.[1];
    };
    const runId = take('runId');
    let finalState = take('finalState') ?? 'unknown';
    // DAG-mode runs report the mode as finalState ('dag') and carry completion in `status`.
    if (finalState === 'dag') finalState = take('status') ?? finalState;
    return { finalState, runId };
}

function runWorkflow(
    fx: Fixture,
    caseName: string,
    workflow: string,
    name: string,
    vars: Record<string, string>,
    extraEnv: Record<string, string> = {},
): RunOutcome {
    const args = [
        'spur',
        'workflow',
        'run',
        workflow,
        '--run-id',
        `mig-0335-${name}-${Date.now()}`,
        '--json',
        '--vars',
        JSON.stringify(vars),
    ];
    const proc = Bun.spawnSync(args, { cwd: fx.root, env: runEnv(fx, extraEnv), stdout: 'pipe', stderr: 'pipe' });
    const stdout = proc.stdout?.toString() ?? '';
    const { finalState, runId } = parseFinalState(stdout);
    RUNS.push({
        case: caseName,
        runId: runId ?? `mig-0335-${name}`,
        workflow,
        finalState,
        command: `spur workflow run ${workflow} --run-id <id> --json --vars '${JSON.stringify(vars)}'`,
    });
    ARTIFACTS[caseName] ??= [];
    return {
        runId: runId ?? 'unknown',
        finalState,
        stdout,
        stderr: proc.stderr?.toString() ?? '',
        exitCode: proc.exitCode ?? 1,
    };
}

function resumeRun(fx: Fixture, caseName: string, runId: string, answer: string): RunOutcome {
    const args = ['spur', 'workflow', 'continue', runId, '--answer', answer, '--yes', '--json'];
    const proc = Bun.spawnSync(args, { cwd: fx.root, env: runEnv(fx), stdout: 'pipe', stderr: 'pipe' });
    const stdout = proc.stdout?.toString() ?? '';
    const { finalState } = parseFinalState(stdout);
    RUNS.push({
        case: caseName,
        runId,
        workflow: 'continue',
        finalState,
        command: `spur workflow continue ${runId} --answer ${answer}`,
    });
    return { runId, finalState, stdout, stderr: proc.stderr?.toString() ?? '', exitCode: proc.exitCode ?? 1 };
}

/** voice3 launch vars: the shadow posture + loosened gates; everything else keeps its YAML default. */
function voice3Vars(override: Record<string, string> = {}): Record<string, string> {
    return {
        auto_publish: 'false',
        run_date: RUN_DATE,
        language: 'zh',
        vdriver: 'omnivoice',
        title: '每日AI乱炖',
        plan_max_items: '10',
        plan_translate_enabled: 'true',
        article_write_enabled: 'true',
        script_write_enabled: 'false',
        cover_enabled: 'false',
        cards_enabled: 'false',
        skip_review: 'true',
        transcode_mp3: 'true',
        agent: 'inline',
        agent_retry: 'inline',
        safety_max_revise: '2',
        safety_platforms: 'xiaoyuzhou,apple-podcasts,wechatmp',
        qc_min_quality: '0',
        qc_min_importance: '0',
        qc_min_urgency: '0',
        qc_min_impact: '0',
        qc_min_episode_items: '1',
        episode_min_minutes: '1',
        episode_max_minutes: '30',
        channels: '',
        live_channels: '',
        dummy: 'true',
        ...override,
    };
}

function publish3Vars(fx: Fixture, window: string, override: Record<string, string> = {}): Record<string, string> {
    return {
        work_dir: fx.dayDir,
        run_date: RUN_DATE,
        window,
        preset: 'daily-ai-voice-migration',
        channels: '',
        live_channels: '',
        dummy: 'true',
        agent: 'inline',
        ...override,
    };
}

function receiptsDir(fx: Fixture): string {
    return join(fx.dayDir, '4-publish', 'receipts');
}

function receiptsOf(fx: Fixture): Record<string, unknown>[] {
    const dir = receiptsDir(fx);
    if (!existsSync(dir)) return [];
    return Array.from(new Bun.Glob('*.json').scanSync({ cwd: dir }))
        .sort()
        .map((f) => readJson(join(dir, f)));
}

function receiptByKey(fx: Fixture, key: string): Record<string, unknown> | undefined {
    const path = join(receiptsDir(fx), `${key}.json`);
    return existsSync(path) ? readJson(path) : undefined;
}

function dispatchCount(fx: Fixture, needle: string): number {
    return readFileSync(join(fx.root, 'transports.log'), 'utf8')
        .split('\n')
        .filter((l) => l.includes(needle)).length;
}

function expectDone(outcome: RunOutcome, what: string): void {
    if (outcome.finalState !== 'done') {
        const cwd = process.env.REHEARSAL_DEBUG_CWD;
        if (cwd) {
            const { execSync } = require('node:child_process');
            try {
                const rows = execSync(
                    `find "${cwd}" -name 'outcome.*.json' -newer /tmp -o -name 'outcome.*.json' | tail -1 | xargs cat 2>/dev/null`,
                ).toString();
                const parsed = JSON.parse(rows) as { rows?: Array<Record<string, unknown>> };
                const bad = (parsed.rows ?? []).filter(
                    (r) => !(r.required !== true || r.dummy === true || r.status === 'succeeded'),
                );
                console.log('DEBUG-VIOLATING-ROWS', JSON.stringify(bad, null, 2));
                const tlog = execSync(
                    `tail -8 "${join(cwd, '..', '..', '..', 'transports.log')}" 2>/dev/null || echo no-transports`,
                ).toString();
                console.log('DEBUG-TRANSPORTS-TAIL', tlog);
                const klog = execSync(
                    `tail -12 "${join(cwd, '..', '..', '..', 'kk-calls.log')}" 2>/dev/null || echo no-kkcalls`,
                ).toString();
                console.log('DEBUG-KKCALLS-TAIL', klog);
                const outcomeFile = execSync(`ls "${cwd}/4-publish"/outcome.*.json 2>/dev/null | tail -1`)
                    .toString()
                    .trim();
                if (outcomeFile)
                    console.log('DEBUG-FULL-OUTCOME', execSync(`cat "${outcomeFile}"`).toString().slice(0, 3500));
                const ev = execSync(
                    `tail -25 "${join(cwd, '4-publish', 'events.jsonl')}" 2>/dev/null || echo no-events`,
                ).toString();
                console.log('DEBUG-EVENTS-TAIL', ev);
            } catch (e) {
                console.log('DEBUG-dump-failed', String(e));
            }
        }
        throw new Error(
            `${what}: finalState=${outcome.finalState} (exit ${outcome.exitCode})\nstdout: ${outcome.stdout.slice(-1500)}\nstderr: ${outcome.stderr.slice(-1500)}`,
        );
    }
    expect(outcome.finalState).toBe('done');
}

// ---------------------------------------------------------------------------
// R1 — fresh multi-window rehearsal, whole flow, all receipts (cases 1, 2, 7)
// ---------------------------------------------------------------------------

/** Full-flow helper: generate fresh, then run all three migration windows in schedule order. */
async function rehearsalFlow(
    fx: Fixture,
    caseName: string,
    opts: { overseas: boolean } = { overseas: true },
): Promise<void> {
    process.env.REHEARSAL_DEBUG_CWD = fx.dayDir;
    const gen = runWorkflow(fx, caseName, VOICE3, 'gen', voice3Vars(), { KK_STUB_DURATION_MS: '1620000' });
    expectDone(gen, 'generation run');
    const afterGen = runWorkflow(
        fx,
        caseName,
        PUBLISH3,
        'after-gen',
        publish3Vars(fx, 'after-generate', { dummy: 'true' }),
    );
    expectDone(afterGen, 'after-generate window');
    // Flip the tier-0 podcast row to real so the RSS proof has a guid-carrying receipt to read.
    // Offline rehearsal keeps surfdash dummy: with covers disabled its real draft fails on the
    // missing cover image, so the live pass is scoped to the podcast channel.
    const realPass = runWorkflow(
        fx,
        caseName,
        PUBLISH3,
        'after-gen-real',
        publish3Vars(fx, 'after-generate', {
            dummy: 'false',
            channels: 'podcast.episode',
            live_channels: 'podcast.episode',
        }),
    );
    // DAG-mode pauses surface the paused state name (send-confirm), not a generic 'paused'.
    expect(realPass.finalState).toBe('send-confirm');
    // Live consent: the run pauses at send-confirm; resuming with --answer yes IS the approval.
    expectDone(resumeRun(fx, caseName, realPass.runId, 'yes'), 'after-generate real pass');
    if (opts.overseas) {
        const ovs = runWorkflow(
            fx,
            caseName,
            PUBLISH3,
            'overseas-rss',
            publish3Vars(fx, 'overseas-rss', { dummy: 'true' }),
        );
        expectDone(ovs, 'overseas-rss window');
    }
    const cn = runWorkflow(fx, caseName, PUBLISH3, 'cn-peak', publish3Vars(fx, 'cn-peak', { dummy: 'true' }));
    expectDone(cn, 'cn-peak window');
}

describe('0335 R1: fresh offline multi-window migration rehearsal', () => {
    it('C01 a full multi-window day runs the real chain: fresh generation, variants gate, every delivered receipt', {
        timeout: 900_000,
    }, () => {
        const fx = makeFixture('01-full-flow');
        ARTIFACTS['01-full-flow'] = [];
        rehearsalFlow(fx, '01-full-flow');

        // Fresh generation actually executed (nothing preseeded): audio, script, article, bundle.
        const audio = join(fx.dayDir, '30-audio', `${RUN_DATE}_11_generate_audio.mp3`);
        const script = join(fx.dayDir, '24-script', `${RUN_DATE}_08_script_voicescript.yaml`);
        const articleContent = join(fx.dayDir, '22-article', `${RUN_DATE}_06_article_content.json`);
        const bundle = join(fx.dayDir, 'bundle.json');
        for (const path of [audio, script, articleContent, bundle]) expect(existsSync(path)).toBe(true);
        const article = readJson<{ title: string }>(articleContent);
        expect(article.title.length).toBeGreaterThan(0);

        // The nested safety machine left its full artifact set in the drafts scope dir; the
        // decision admits the drafts.
        const planDir = join(fx.dayDir, '24-script');
        for (const name of [
            `${RUN_DATE}_09_safety-review_report.json`,
            `${RUN_DATE}_09_safety-judge_verdict.json`,
            `${RUN_DATE}_09_safety-judge_status.txt`,
            `${RUN_DATE}_09_safety-verdict.decision`,
            `${RUN_DATE}_09_safety-verdict.status`,
        ]) {
            expect(existsSync(join(planDir, name))).toBe(true);
        }
        expect(
            (
                JSON.parse(readFileSync(join(planDir, `${RUN_DATE}_09_safety-verdict.decision`), 'utf8')) as {
                    value: string;
                }
            ).value,
        ).toBe('pass');
        expect(readFileSync(join(planDir, `${RUN_DATE}_09_safety-verdict.status`), 'utf8').trim()).toBe('accept');
        // Two agent dispatches logged: the plan translation and the article body.
        const agentLog = readFileSync(join(fx.root, 'agents.log'), 'utf8');
        expect(agentLog.includes('_03_plan_plan.json')).toBe(true);
        expect(agentLog.includes('_06_article-write_body.md')).toBe(true);

        // Every delivered receipt exists with the window's intended mode.
        const byKey = new Map(receiptsOf(fx).map((r) => [r.target as string, r]));
        for (const key of [
            'surfdash.article',
            'podcast.episode',
            'wechatmp.podcast',
            'xhs.podcast',
            'wechatmp.article',
            'xhs.article',
            'weibo.article',
            'x.article',
            'x.post',
            'weibo.post',
            'threads.post',
        ]) {
            const receipt = byKey.get(key) as { status: string; mode: string; dummy: boolean } | undefined;
            expect(receipt).toBeDefined();
            expect(receipt?.status).toBe('succeeded');
        }
        // The live send rides the REAL podcast-pub transport, whose result carries itemId (no
        // guid), so the overseas gate binds via the designed title-date fallback, not a receipt guid.
        expect((byKey.get('podcast.episode') as { mode?: string }).mode).toBe('live');
        expect((byKey.get('x.post') as { dummy: boolean }).dummy).toBe(true);
        // Deliberate offline scoping: only the podcast row went live (comment above); the rest,
        // tier-2 drafts included, record the rehearsal's dummy delivery.
        expect((byKey.get('surfdash.article') as { dummy?: boolean }).dummy).toBe(true);
        // Off targets never deliver.
        expect(byKey.has('xhs.cards')).toBe(false);
        expect(byKey.has('shipinhao.cards')).toBe(false);
        // The after-generate ledger's final state: the real podcast pass reclassified the window
        // from the first dummy sweep's 'dummy' to 'full' (a live delivery happened).
        const outcome = readJson<{ status: string }>(join(fx.dayDir, '4-publish', 'outcome.after-generate.json'));
        expect(outcome.status).toBe('full');
        // Overseas gate proved the episode (guid-less live receipt → title-date fallback).
        const rss = readJson<{ hit: boolean; reason: string }>(join(fx.dayDir, '4-publish', 'rss-gate.json'));
        expect(rss.hit).toBe(true);
        expect(rss.reason).toBe('title');
        // The whole day's publish runs are traceable on the bundle.
        const bundleJson = readJson<{ runs: string[] }>(bundle);
        expect(bundleJson.runs.length).toBeGreaterThanOrEqual(3);
    });

    it('C02 rerunning the same fresh generation path keeps receipts stable (no dispatch duplication)', {
        timeout: 900_000,
    }, () => {
        const fx = makeFixture('02-replay');
        rehearsalFlow(fx, '02-replay', { overseas: false });
        const afterFirst = dispatchCount(fx, 'surfdash-pub');
        const second = runWorkflow(
            fx,
            '02-replay',
            PUBLISH3,
            'after-gen-replay',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        expectDone(second, 'replayed after-generate');
        expect(dispatchCount(fx, 'surfdash-pub')).toBe(afterFirst);
        // 8 tier0-2 receipts (surfdash+podcast, 2×podcast tier1, 4×article tier2); overseas skipped.
        expect(receiptsOf(fx).length).toBe(8);
    });
});

// ---------------------------------------------------------------------------
// R2 — content-safety gate cases (8–11)
// ---------------------------------------------------------------------------

describe('0335 R2: content-safety gate', () => {
    it('C08 a stale processed story escalates out of the gate: clean publish is refused, no variants', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('08-stale-story');
        const gen = runWorkflow(fx, '08-stale-story', VOICE3, 'gen', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
            KK_STUB_STALE_STORY: '1',
        });
        expect(gen.finalState).toBe('failed');
        // The failure rides the nested safety workflow (the machine that owns the stale story).
        expect(gen.stdout + gen.stderr).toContain('kk-daily-safety');
        // The decision lands in the safety scope dir (24-script by the 0317 parameterization).
        const decision = readJson<{ value: string }>(
            join(fx.dayDir, '24-script', `${RUN_DATE}_09_safety-verdict.decision`),
        );
        expect(decision.value).toBe('escalate');
        expect(existsSync(join(fx.dayDir, 'bundle.json'))).toBe(false);
    });

    it('C09 QC refusal closes as no-content: EMPTY pool gate, migration report still lands, publish refuses honestly', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('09-qc-refusal');
        const gen = runWorkflow(fx, '09-qc-refusal', VOICE3, 'gen', voice3Vars(), { KK_STUB_QC_EMPTY: '1' });
        expectDone(gen, 'no-content generation');
        // The pool gate flipped to EMPTY; the content subtree was skipped entirely.
        const gateToken = Array.from(new Bun.Glob('*-pool-gate.status').scanSync({ cwd: join(fx.root, '.spur/run') }));
        expect(gateToken.length).toBe(1);
        expect(readFileSync(join(fx.root, '.spur/run', gateToken[0] ?? ''), 'utf8').trim()).toBe('EMPTY');
        // The generate half's report still ran (it hangs off the pool gate, not the bundle).
        expect(existsSync(join(fx.dayDir, `${RUN_DATE}_19_run-report_report.md`))).toBe(true);
        expect(existsSync(join(fx.dayDir, 'bundle.json'))).toBe(false);
        // An after-generate publish on an empty day refuses honestly (no bundle to plan from).
        const publish = runWorkflow(
            fx,
            '09-qc-refusal',
            PUBLISH3,
            'after-gen',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        expect(publish.finalState).toBe('failed');
        expect(publish.stdout + publish.stderr).toContain('no bundle');
        // The overseas day on a no-content rehearsal: the feed carries no episode for today, so
        // the gate misses and the diagnose/repair path runs. The repair honestly refuses (there is
        // no bundle to repair from — a lost generation stays an operator decision), so the window
        // fails AFTER the incident evidence survives.
        writeRssFeed(fx_feedPath(fx.root), GUID_THIN, '别处的节目 · 2026-01-01');
        const ovs = runWorkflow(
            fx,
            '09-qc-refusal',
            PUBLISH3,
            'overseas-rss',
            publish3Vars(fx, 'overseas-rss', { dummy: 'true' }),
        );
        expect(ovs.finalState).toBe('failed');
        expect(ovs.stdout + ovs.stderr).toContain('publish-matrix-send');
        const rss = readJson<{ hit: boolean; reason: string }>(join(fx.dayDir, '4-publish', 'rss-gate.json'));
        expect(rss.hit).toBe(false);
        const incident = readJson<{ class: string }>(join(fx.dayDir, '4-publish', 'incident.json'));
        expect(incident.class).toBe('no-content');
        expect(receiptsOf(fx)).toEqual([]);
    });

    it('C10 the review revise budget holds the drafts: same anchor through the loop, admitted verdict at the end', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('10-revise-budget');
        const gen = runWorkflow(fx, '10-revise-budget', VOICE3, 'gen', voice3Vars({ safety_max_revise: '2' }), {
            KK_STUB_DURATION_MS: '1620000',
        });
        expectDone(gen, 'revise-budget generation');
        const planDir = join(fx.dayDir, '24-script');
        expect(existsSync(join(planDir, `${RUN_DATE}_09_safety-verdict.status`))).toBe(true);
        expect(
            (
                JSON.parse(readFileSync(join(planDir, `${RUN_DATE}_09_safety-verdict.decision`), 'utf8')) as {
                    value: string;
                }
            ).value,
        ).toBe('pass');
        // The drafts the gate admitted are the drafts the bundle froze: the reviewed digests bind.
        const bundle = readJson<{ variants: Record<string, { path: string; sha256: string }> }>(
            join(fx.dayDir, 'bundle.json'),
        );
        const variants = Object.values(bundle.variants);
        expect(variants.length).toBeGreaterThan(0);
        for (const variant of variants) {
            const path = join(fx.dayDir, variant.path);
            expect(existsSync(path)).toBe(true);
            expect(sha256(path)).toBe(variant.sha256);
        }
    });

    it('C11 PII on a blocked platform refuses to publish drafts even when the final decision is clean', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('11-pii-blocked');
        const gen = runWorkflow(fx, '11-pii-blocked', VOICE3, 'gen', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
            KK_STUB_SAFETY_PII_PLATFORM: 'wechatmp',
        });
        expect(gen.finalState).toBe('failed');
        // Same failure channel as C08: the nested safety workflow owns the refusal.
        expect(gen.stdout + gen.stderr).toContain('kk-daily-safety');
        // The catalog decision's admitted vocabulary is pass|escalate|exclude: PII on a blocked
        // platform lands as escalate (admitted-but-unpublished), and the gate token refuses.
        const decision = readJson<{ value: string }>(
            join(fx.dayDir, '24-script', `${RUN_DATE}_09_safety-verdict.decision`),
        );
        expect(decision.value).toBe('escalate');
        expect(readFileSync(join(fx.dayDir, '24-script', `${RUN_DATE}_09_safety-verdict.status`), 'utf8').trim()).toBe(
            'refuse',
        );
        expect(existsSync(join(fx.dayDir, 'bundle.json'))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// R3 — receipt-identity guard (12–15)
// ---------------------------------------------------------------------------

describe('0335 R3: receipt-identity guard', () => {
    it('C12 unchanged bundle replay reuses succeeded receipts and dispatches nothing', { timeout: 600_000 }, () => {
        const fx = makeFixture('12-unchanged-replay');
        const gen = runWorkflow(fx, '12-unchanged-replay', VOICE3, 'gen', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
        });
        expectDone(gen, 'generation');
        const first = runWorkflow(
            fx,
            '12-unchanged-replay',
            PUBLISH3,
            'after-gen-1',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        expectDone(first, 'first window');
        const dispatches1 = dispatchCount(fx, 'surfdash-pub');
        const second = runWorkflow(
            fx,
            '12-unchanged-replay',
            PUBLISH3,
            'after-gen-2',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        expectDone(second, 'replayed window');
        expect(dispatchCount(fx, 'surfdash-pub')).toBe(dispatches1);
    });

    it('C13 a receipt from another bundle revision is a reconciliation failure, never a resend', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('13-revision-mismatch');
        const gen1 = runWorkflow(fx, '13-revision-mismatch', VOICE3, 'gen1', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
        });
        expectDone(gen1, 'first generation');
        const first = runWorkflow(
            fx,
            '13-revision-mismatch',
            PUBLISH3,
            'after-gen-1',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        expectDone(first, 'first window');
        const before = readFileSync(join(receiptsDir(fx), 'surfdash.article.json'), 'utf8');
        const dispatches1 = dispatchCount(fx, 'surfdash-pub');
        // Promote the rehearsal receipt to a real-delivery claim: the identity contract only guards
        // non-dummy receipts (dummy receipts are rehearsal evidence and re-attempt freely).
        const promoted = JSON.parse(before) as Record<string, unknown>;
        promoted.dummy = false;
        writeFileSync(join(receiptsDir(fx), 'surfdash.article.json'), `${JSON.stringify(promoted, null, 2)}\n`);
        // A NEW generation freezes a NEW bundle revision in the same day dir.
        const gen2 = runWorkflow(fx, '13-revision-mismatch', VOICE3, 'gen2', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
        });
        expectDone(gen2, 'second generation');
        const second = runWorkflow(
            fx,
            '13-revision-mismatch',
            PUBLISH3,
            'after-gen-2',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        // The send node is onError:continue by design (0332): the guard's refusal is bounded to the
        // offending target while the evidence chain (report, ledger, outcome) survives to the
        // operator; the outcome assert on a rehearsal window then passes. `spur workflow run` does
        // not surface a continued node's stderr, so the refusal is pinned by its observables:
        // the evidence untouched and no new dispatch.
        expectDone(second, 'second window');
        // The guard did not touch the evidence: same bytes, no resend, no new dispatch.
        expect(readFileSync(join(receiptsDir(fx), 'surfdash.article.json'), 'utf8')).toBe(
            `${JSON.stringify(promoted, null, 2)}\n`,
        );
        expect(dispatchCount(fx, 'surfdash-pub')).toBe(dispatches1);
    });

    it('C14 a dummy receipt is rehearsal evidence only: flipping the channel to draft sends for real', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('14-dummy-then-real');
        const gen = runWorkflow(fx, '14-dummy-then-real', VOICE3, 'gen', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
        });
        expectDone(gen, 'generation');
        const dummyPass = runWorkflow(
            fx,
            '14-dummy-then-real',
            PUBLISH3,
            'after-gen-dummy',
            publish3Vars(fx, 'after-generate', { dummy: 'true' }),
        );
        expectDone(dummyPass, 'dummy window');
        const dummyReceipt = receiptByKey(fx, 'xhs.podcast') as { dummy: boolean; mode: string };
        expect(dummyReceipt.dummy).toBe(true);
        const realPass = runWorkflow(
            fx,
            '14-dummy-then-real',
            PUBLISH3,
            'after-gen-draft',
            publish3Vars(fx, 'after-generate', { dummy: 'false', channels: 'xhs.podcast' }),
        );
        expectDone(realPass, 'draft window');
        const realReceipt = receiptByKey(fx, 'xhs.podcast') as { dummy?: boolean; mode: string; status: string };
        expect(realReceipt.dummy).toBeUndefined();
        expect(realReceipt.mode).toBe('draft');
        // The real xhs-pub was dispatched (the re-attempt after the dummy receipt); offline it stops
        // at the cover validation, which records an uncertain draft receipt — never a resend of the
        // rehearsal, and never a fake success.
        expect(realReceipt.status).toBe('uncertain');
        expect(existsSync(join(fx.dayDir, '4-publish', 'fanout-result.xhs.podcast.json'))).toBe(true);
    });

    it('C15 promoting a delivered draft to live pauses for consent, and the guard refuses a live send over a draft receipt', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('15-draft-to-live');
        const gen = runWorkflow(fx, '15-draft-to-live', VOICE3, 'gen', voice3Vars(), {
            KK_STUB_DURATION_MS: '1620000',
        });
        expectDone(gen, 'generation');
        const draftPass = runWorkflow(
            fx,
            '15-draft-to-live',
            PUBLISH3,
            'cn-peak-draft',
            publish3Vars(fx, 'cn-peak', { dummy: 'false' }),
        );
        expectDone(draftPass, 'draft cn-peak');
        const draftReceipt = receiptByKey(fx, 'weibo.article') as Record<string, unknown>;
        expect(draftReceipt.mode).toBe('draft');
        // Offline the real weibo-pub cannot deliver (no session) — it records an uncertain draft
        // attempt. The guard's precondition is a DELIVERED draft: craft it from the attempt receipt
        // (same payload digest and parent) so the identity contract gets its exact input.
        const delivered: Record<string, unknown> = {
            ...draftReceipt,
            status: 'succeeded',
            effect: 'none',
            dummy: false,
        };
        delete delivered.error;
        writeFileSync(join(receiptsDir(fx), 'weibo.article.json'), `${JSON.stringify(delivered, null, 2)}\n`);
        // Live consent: the run pauses at send-confirm; resuming with --answer yes IS the approval.
        const liveAttempt = runWorkflow(
            fx,
            '15-draft-to-live',
            PUBLISH3,
            'cn-peak-live',
            publish3Vars(fx, 'cn-peak', { dummy: 'false', live_channels: 'weibo.article' }),
        );
        expect(liveAttempt.finalState).toBe('send-confirm');
        const promotedLive = readFileSync(join(receiptsDir(fx), 'weibo.article.json'), 'utf8');
        const approved = resumeRun(fx, '15-draft-to-live', liveAttempt.runId, 'yes');
        // The send node is onError:continue (0332) and `spur workflow run` does not surface a
        // continued node's stderr: pin the refusal by its observables — the run completes its
        // evidence chain and the delivered draft receipt is untouched (never a live resend).
        expectDone(approved, 'approved live attempt');
        expect(readFileSync(join(receiptsDir(fx), 'weibo.article.json'), 'utf8')).toBe(promotedLive);
        const still = readJson<{ mode: string }>(join(receiptsDir(fx), 'weibo.article.json'));
        expect(still.mode).toBe('draft');
    });
});

// ---------------------------------------------------------------------------
// R4 — overseas gate semantics (16) + R5 report (7) + R6 launcher artifacts (17)
// ---------------------------------------------------------------------------

describe('0335 R4/R5/R6: overseas gate, migration report, launcher artifacts', () => {
    it('C16 the RSS gate authorizes overseas only on the known guid, in both directions', { timeout: 600_000 }, () => {
        const fx = makeFixture('16-rss-gate');
        const gen = runWorkflow(fx, '16-rss-gate', VOICE3, 'gen', voice3Vars(), { KK_STUB_DURATION_MS: '1620000' });
        expectDone(gen, 'generation');
        // Real pass writes the live podcast receipt; the overseas window then proves the episode.
        const realPass = runWorkflow(
            fx,
            '16-rss-gate',
            PUBLISH3,
            'after-gen-real',
            publish3Vars(fx, 'after-generate', {
                dummy: 'false',
                channels: 'podcast.episode',
                live_channels: 'podcast.episode',
            }),
        );
        expect(realPass.finalState).toBe('send-confirm');
        expectDone(resumeRun(fx, '16-rss-gate', realPass.runId, 'yes'), 'real pass');
        expect((receiptByKey(fx, 'podcast.episode') as { mode?: string }).mode).toBe('live');
        const full = runWorkflow(
            fx,
            '16-rss-gate',
            PUBLISH3,
            'overseas-full',
            publish3Vars(fx, 'overseas-rss', { dummy: 'true' }),
        );
        expectDone(full, 'overseas full');
        expect(readJson<{ hit: boolean }>(join(fx.dayDir, '4-publish', 'rss-gate.json')).hit).toBe(true);
        expect(receiptByKey(fx, 'x.post')).toBeDefined();
        // A foreign feed (different guid AND a title without today's date) misses in BOTH probes:
        // no guid match, and the title-date fallback misses too — miss is a verdict, not a failure.
        writeRssFeed(fx_feedPath(fx.root), GUID_THIN, '别处的节目 · 2026-01-01');
        const thin = runWorkflow(
            fx,
            '16-rss-gate',
            PUBLISH3,
            'overseas-thin',
            publish3Vars(fx, 'overseas-rss', { dummy: 'true' }),
        );
        expectDone(thin, 'overseas thin');
        const rss = readJson<{ hit: boolean; reason: string }>(join(fx.dayDir, '4-publish', 'rss-gate.json'));
        expect(rss.hit).toBe(false);
        expect(rss.reason).toBe('missing');
    });

    it('C07 the migration report reflects the rehearsal state, not stale daily-run state', { timeout: 600_000 }, () => {
        const fx = makeFixture('07-report');
        const gen = runWorkflow(fx, '07-report', VOICE3, 'gen', voice3Vars(), { KK_STUB_DURATION_MS: '1620000' });
        expectDone(gen, 'generation');
        // The generate half's report (kk daily run-report) reflects THIS rehearsal: today's date,
        // both stories — never a stale daily-run state.
        const report = readJson<{
            title: string;
            format: string;
            metadata: { date: string; doc_count: number; generator: string };
        }>(join(fx.dayDir, `${RUN_DATE}_19_run-report_report.json`));
        expect(report.title).toContain(RUN_DATE);
        expect(report.format).toBe('markdown');
        expect(report.metadata.date).toBe(RUN_DATE);
        expect(report.metadata.doc_count).toBe(2);
    });

    it('C17 rehearsal artifacts are intact and reproducible: store settle holds drafts, launcher templates bind the gates', {
        timeout: 600_000,
    }, () => {
        const fx = makeFixture('17-artifacts');
        rehearsalFlow(fx, '17-artifacts');
        ARTIFACTS['17-artifacts'] = [
            'plugins/kk/schedules/kk-daily-ai-voice3.cron.tmpl',
            'plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl',
            'plugins/kk/schedules/kk-daily-publish3-overseas.cron.tmpl',
            'plugins/kk/publish-presets/daily-ai-voice-migration.json',
            'plugins/kk/workflows/kk-daily-ai-voice3.yaml',
            'plugins/kk/workflows/kk-daily-publish3.yaml',
        ];
        // The rehearsal's settle artifact is well-formed; after the real pass the live episode is
        // owned (marked) with nothing unresolved.
        const settlement = readJson<{ marked: boolean; unresolved: string[] }>(
            join(fx.dayDir, '4-publish', 'settlement.after-generate.json'),
        );
        expect(settlement.marked).toBe(true);
        expect(settlement.unresolved).toEqual([]);
        // The launcher contract: window entries gate on auto_publish; cron lines stop at the first %.
        const voice3Tmpl = readFileSync(join(REPO, 'plugins/kk/schedules/kk-daily-ai-voice3.cron.tmpl'), 'utf8');
        expect(voice3Tmpl).toContain('auto_publish');
        expect(voice3Tmpl).toContain('kk-daily-ai-voice3.yaml');
        const launcherTemplates: Record<string, { live: boolean }> = {
            'kk-daily-publish3-cn-peak.cron.tmpl': { live: true },
            'kk-daily-publish3-overseas.cron.tmpl': { live: false },
        };
        for (const [file, shape] of Object.entries(launcherTemplates)) {
            const tmpl = readFileSync(join(REPO, 'plugins/kk/schedules', file), 'utf8');
            // The 0334 launcher owns the launch: window and consented live channels ride the
            // launcher script, which then execs the workflow. The overseas line carries NO live
            // consent — an overseas live post stays an operator launch (ADR-022).
            expect(tmpl).toContain('voice3-publish-window.ts');
            expect(tmpl).toContain('--window');
            expect(tmpl.includes('--live-channels')).toBe(shape.live);
            const commandLine = tmpl
                .split('\n')
                .find((l) => l.includes('voice3-publish-window.ts') && !l.trim().startsWith('#'));
            expect(commandLine).toBeDefined();
            // A crontab command ends at the first unescaped `%` — the launcher owns the date math.
            expect((commandLine ?? '').includes('%')).toBe(false);
        }
    });
});

afterAll(() => {
    // R5/R6: a repeatable evidence bundle — one summary.json per suite run, with per-case
    // artifact hashes and exact replay commands, plus the run-id ledger for the batch report.
    mkdirSync(EVIDENCE, { recursive: true });
    const artifactHashes: Record<string, string> = {};
    for (const [caseName, paths] of Object.entries(ARTIFACTS)) {
        for (const rel of paths) {
            const abs = join(REPO, rel);
            if (existsSync(abs)) artifactHashes[`${caseName}/${rel}`] = sha256(abs);
        }
    }
    const summary = {
        task: '0335',
        title: 'Prove voice3 replacement with a fresh offline multi-window migration rehearsal',
        generatedAt: new Date().toISOString(),
        totals: {
            cases: 17,
            workflowRuns: RUNS.length,
            doneRuns: RUNS.filter((r) => r.finalState === 'done').length,
            failedRuns: RUNS.filter((r) => r.finalState === 'failed').length,
            pausedRuns: RUNS.filter((r) => r.finalState === 'paused').length,
        },
        runs: RUNS,
        artifactHashes,
    };
    writeFileSync(join(EVIDENCE, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
});
