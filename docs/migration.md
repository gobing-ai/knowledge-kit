# Migration: scheduled jobs from laptop → mac mini

Operational runbook. **Source** = `macbook` (`/Users/robin`, laptop, macOS 26, arm64).
**Target** = `mac.lan` (reachable as `ssh homelab`, Apple M4, 16 GB, macOS 27.0.1, arm64,
`/Users/robin`, America/Los_Angeles).

Goal: with the laptop switched off during the 2026-10-26 → 11-02 trip, the daily AI-news episode
(`kk-daily-ai-voice2`) still collects, writes, voices, publishes and records itself without an
operator present. Everything below is repeatable and re-runnable; no step assumes a human at the
target keyboard.

> **Status 2026-10-20**: written and executed in one session. Verification evidence in §9.

---

## 1. Cutover contract (what "done" means)

| # | Condition |
| --- | --- |
| C1 | Target checkout is `origin/main` @ `13581560` **plus** the laptop's uncommitted working-tree changes (11 files) — the daily workflow's current behavior is not on GitHub yet. |
| C2 | `kk` / `spur` on the target are 0.1.5 / 0.4.18, and `kk` resolves to a package copy whose `plugins/kk/scripts/` matches the checkout (`kk stage` reads the **installed** runner, not the checkout). |
| C3 | `~/.config/kk/` on the target holds the laptop's credentials, voice registries, image presets and browser profiles. |
| C4 | Voice generation works on the target: `uv` + the voxcpm venv + `openbmb/VoxCPM2` weights in the HF cache, `ffmpeg`/`ffprobe` present. |
| C5 | Publishing works: the `surfdash` checkout exists at the path `vars.surfdash_root` names, and `gh` can push it as `robinmin`. |
| C6 | The scheduler runs on the target under launchd (`ai.gobing.spur-serve`), surviving logout, with `TYPESAFE_API_KEY` in its environment. |
| C7 | The target's store (`.works/kk.db`) carries the 24 h item pool, and the intro sting at `.works/kk-daily-ai-voice/AI每日资讯_8秒播客片头.mp3` exists. |
| C8 | The laptop's scheduler is stopped last, after C1–C7 pass, so exactly one machine is due at 04:30. |

---

## 2. What actually runs today

Scheduling lives in **one** place: `.spur/config.yaml` → `bootstrap.scheduler.jobs`, executed by the
job worker inside `spur serve`. `crontab` is empty; the only launchd agent that matters keeps
`spur serve` alive.

| Job | Cron (local) | Command |
| --- | --- | --- |
| `history-refresh` | `*/30 7-23 * * *` | `spur history import && spur history analyze` |
| `history-daily-report` | `3 5 * * *` | `spur history import --source all && spur workflow run config/workflows/history-anatomy.yaml && spur self maintain` |
| `kk-daily-ai-voice` | `30 4 * * *` | `spur workflow run plugins/kk/workflows/kk-daily-ai-voice2.yaml --vars {"publish_enabled":"true","skip_review":"true"}` |
| `kk-collect` | `5 4,10,16,22 * * *` | `spur workflow run plugins/kk/workflows/kk-collect.yaml` |
| `database-weekly-maintenance` | `0 4 * * 0` | `spur self maintain --vacuum` |

Source launchd agent: `~/Library/LaunchAgents/ai.gobing.spur-serve.plist` (absolute
`Program=/Users/robin/.bun/bin/spur`, `KeepAlive`, PATH env, `TYPESAFE_API_KEY` env,
logs to `.works/spur-serve/serve.log`). `ai.gobing.kk-collect.plist*` exists only as `.bak-*` —
disabled; the scheduler owns collection now.

Daily voice chain in `kk-daily-ai-voice2.yaml`: `daily-preflight` → store extract → episode plan →
article → cover → script → nested safety machine → audio (`vdriver: voxcpm`, then gemini, then
omni) → surfdash + podcast publish → soft channels (XHS / WeChat draft) → ledger.

---

## 3. Dependency inventory

Verified by probe on both hosts on 2026-10-20.

| Dependency | Source | Target before | Action |
| --- | --- | --- | --- |
| bun | 1.4.3 (`.prototools`) | 1.4.2 | install 1.4.3 |
| `~/` bun runner project (`@gobing-ai/*`) | kk 0.1.5, spur 0.4.18, superskill 0.3.40 + `ts-*`/`ts-laya-mlx`/`@johnhenry/laya` | kk 0.1.3, spur 0.4.15 | upgrade to laptop versions |
| `ffmpeg` / `ffprobe` | homebrew | present | — |
| `uv` | 0.11.28 | 0.12.5 | — |
| `gh` | `robinmin`, `repo` scope | logged in as `robinmin` | verify push |
| coding-agent CLIs (`agent.run`) | claude, codex, pi, omp, opencode | same set present, authed | smoke test |
| HF weights | `openbmb/VoxCPM2` 4.6 G, laya 3.4 M | 18 M cache | rsync |
| voxcpm venv | `plugins/generations/voxcpm-tts/.venv` 1.5 G | absent | `uv sync --locked` |
| `surfdash` checkout | `/Users/robin/xprojects/surfdash` 2.4 G | absent | rsync |
| `~/.config/kk/` | 1.4 G (browser profiles 1.4 G) | `browser-leases/` only | tarball |
| kk store + intro sting | `.works/kk.db` 6 MB, `.works/kk-daily-ai-voice/` | absent | copy |
| disk | 21 GiB free on target | — | fits (~13 GiB) |
| sleep policy | target: `sleep 0` on AC, `powernap 1` | already set | verify |

Deliberately **not** migrated: `k2-fsa/OmniVoice` (3 G, last-resort fallback — pulls on demand),
`whisper-*` (unused by the voxcpm path), `.spur/spur.db` (target builds its own scheduler state),
`node_modules` (reinstalled), `~/node_modules` (reinstalled).

---

## 4. Pre-flight on the source

```bash
cd /Users/robin/xprojects/knowledge-kit
git fetch origin && git log --oneline -1          # 13581560 chore(release): bump knowledge-kit to 0.1.5
git status --short                                # 11 modified files — these are part of the migration
spur serve --help >/dev/null                      # CLI reachable
```

Check the source run is not mid-flight before touching `.works/kk.db`:

```bash
spur workflow list --json | jq -r '.workflows[]?.lastRunStatus'   # no "running"
```

---

## 5. Build the transfer artifacts

Directory used on both sides: `/tmp/kk-migration/`.

```bash
mkdir -p /tmp/kk-migration
cd /Users/robin/xprojects/knowledge-kit

# A. Uncommitted working-tree changes, as a patch on top of the carried commits
git diff > /tmp/kk-migration/laptop-tree.patch

# A2. Local commits that are NOT on origin — bundle them (never push another session's WIP)
git bundle create /tmp/kk-migration/laptop-main.bundle origin/main..main

# B. ~/.config/kk, full copy (credentials, voices, presets, browser profiles)
tar -C /Users/robin/.config -czf /tmp/kk-migration/kk-config.tgz kk

# C. Store + intro sting
tar -C /Users/robin/xprojects/knowledge-kit -czf /tmp/kk-migration/kk-works-state.tgz \
    .works/kk.db .works/kk-daily-ai-voice

# D. checksums for verification on the target
shasum -a 256 /tmp/kk-migration/* > /tmp/kk-migration/SHA256SUMS
```

Model cache is rsynced directly (4.6 G; a tarball would only be re-expanded). Use `rsync -a` only —
the source macOS ships openrsync 2.6.9 and rejects `--info=progress2`. The 647 MiB laya weights are
*not* copied: the first `typesafe`/`laya-local` decision pulls them through `laya-mlx` on demand
(§6.7), which is also the proof that the tool is wired correctly.

```bash
rsync -a ~/.cache/huggingface/hub/models--openbmb--VoxCPM2 homelab:~/.cache/huggingface/hub/
```

Copy artifacts and the second checkout:

```bash
rsync -a /tmp/kk-migration homelab:/tmp/                                    # ~1.4 G
rsync -a --info=progress2 /Users/robin/xprojects/surfdash homelab:/Users/robin/xprojects/
```

---

## 6. Restore on the target

All steps run over `ssh homelab`. Non-interactive ssh has a minimal `PATH` — export it first.

```bash
ssh homelab
export PATH=$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH
```

### 6.1 Toolchain

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3" && exec $SHELL
bun --version        # 1.4.3
```

### 6.2 Runner project + CLI versions

The home project (`~/package.json`, name `runner-home`) is the source of the installed CLIs, the
same layout as the laptop. Upgrade it, then point the `~/.bun/bin` shims at it so `kk` resolves the
same copy the repo's edit-and-rsync workflow targets:

```bash
cd ~
bun add @gobing-ai/knowledge-kit@^0.1.5 @gobing-ai/spur@^0.4.18 @gobing-ai/superskill@^0.3.40 \
        @gobing-ai/ts-ai-runner @gobing-ai/ts-db @gobing-ai/ts-infra @gobing-ai/ts-runtime \
        @gobing-ai/ts-utils @gobing-ai/ts-ai-decision @gobing-ai/ts-decision-fm @gobing-ai/ts-laya-mlx \
        @johnhenry/laya @johnhenry/backend-mlx
ln -sfn ../../node_modules/@gobing-ai/knowledge-kit/dist/index.js $HOME/.bun/bin/kk
ln -sfn ../../node_modules/@gobing-ai/knowledge-kit/dist/index.js $HOME/.bun/bin/knowledge-kit
ln -sfn ../../node_modules/@gobing-ai/spur/spur.js                  $HOME/.bun/bin/spur
hash -r; kk --version; spur --version        # 0.1.5 / 0.4.18
```

The `ts-*` / laya extras are what the `kk-item-category` (`fm-local`) and `kk-item-quality`
(`laya-local`) decision makers need; without them `kk store label` degrades or fails.

### 6.3 Checkout at the laptop's exact tree

Two layers: the commits that exist only locally (a bundle), then the uncommitted working tree (a
patch). Cut both at the same moment — this tree is shared with other agent sessions and moved three
times during the first execution.

```bash
scp /tmp/kk-migration/laptop-main.bundle /tmp/kk-migration/laptop-tree.patch homelab:/tmp/kk-migration/
ssh homelab
cd ~/xprojects/knowledge-kit
git fetch origin && git pull --ff-only                       # 13581560

git fetch /tmp/kk-migration/laptop-main.bundle main:refs/heads/bundled
git merge --ff-only --no-edit bundled                        # local-only commits, in order
git apply --3way /tmp/kk-migration/laptop-tree.patch         # the uncommitted remainder
git reset                                                    # unstage; keep the worktree
git status --short                                           # same files as the source `git diff --name-only`
bun install
```

Verify parity on the files that drive the run, not just the file count — identical hashes on both
hosts:

```bash
shasum -a 256 plugins/kk/scripts/daily-stages.ts plugins/kk/scripts/kk-workflow-stages.ts \
              plugins/kk/workflows/kk-daily-ai-voice2.yaml
```

If the patch does not apply, stop: the target would run different workflow logic than the source.
Re-cut both artifacts from the source and retry rather than hand-merging.

### 6.4 Stage runners — the failure the last run died of

`kk stage <name>` resolves its runner from the **installed** package while the scheduler executes the
**checkout's** YAML. `daily-preflight`, added 2026-10-20, exists only in the working tree, so the
installed copy must be refreshed or the 04:30 run dies at 04:31 with `unknown stage`:

```bash
rsync -a ~/xprojects/knowledge-kit/plugins/kk/scripts/ \
         ~/node_modules/@gobing-ai/knowledge-kit/plugins/kk/scripts/
grep -c daily-preflight ~/node_modules/@gobing-ai/knowledge-kit/plugins/kk/scripts/daily-stages.ts
# expect >= 1
```

Re-run this after any `bun add` that reinstalls `knowledge-kit`, and after every stage edit.

### 6.5 Configuration

```bash
cd /tmp/kk-migration && shasum -a 256 -c SHA256SUMS
tar -C ~/.config -xzf kk-config.tgz            # -> ~/.config/kk
ls ~/.config/kk                                # config.yaml voices image-presets backups ...
```

`config.yaml` uses absolute `/Users/robin/...` paths — identical on the target, so no rewriting.

### 6.6 Store, sting, voice weights

```bash
cd ~/xprojects/knowledge-kit
tar -xzf /tmp/kk-migration/kk-works-state.tgz  # .works/kk.db + intro sting
sqlite3 .works/kk.db "select count(*) from items;"      # sanity: rows present
ls ~/.cache/huggingface/hub | grep -E 'VoxCPM2|laya'
```

### 6.7 voxcpm venv + the laya decision runtime

Two Python runtimes, for two different jobs — both are uv-managed and neither lives in the repo.

```bash
cd ~/xprojects/knowledge-kit
uv sync --project plugins/generations/voxcpm-tts --locked --no-dev     # ~1.4 G, ~60 s
uv run --project plugins/generations/voxcpm-tts --locked --no-dev \
   python plugins/generations/voxcpm-tts/python/worker.py            # prints health, then EOF

# the laya-labelled decisions (kk-item-quality, kk-item-category) run through this tool
uv tool install laya-mlx==0.4.0
spur decision run kk-item-quality --param title=probe --param source=aihot --json
# must print "maker": "laya-local", "source": "model" — NOT an error + fallback value
```

First real render also pulls `openbmb/VoxCPM2` if §5 was skipped; on M4 it runs on `mps`
(`VOXCPM_DEVICE=auto`).

### 6.8 surfdash (publish target)

```bash
cd ~/xprojects/surfdash
git status --short | head            # must match the source's dirty content files
gh auth status                       # robinmin, repo scope
git remote -v
```

`surfdash-pub` runs `git add/commit/push origin main` inside that checkout, so the push credential
must work from the scheduler's environment. `gh auth setup-git` if `git push --dry-run` fails.

---

## 7. Scheduling on the target

```bash
mkdir -p ~/xprojects/knowledge-kit/.works/spur-serve
cd ~/xprojects/knowledge-kit
kk schedule render kk-serve --platform launchd --repo "$PWD" \
  > ~/Library/LaunchAgents/ai.gobing.spur-serve.plist
```

The rendered plist inherits whatever is in the rendering shell's environment, and `TYPESAFE_API_KEY`
is load-bearing: without it every `typesafe`-routed decision fails closed, the extract pool empties
and the run closes as *no-content*. Carry the key over from the source plist instead of retyping it:

```bash
# on the source
plutil -extract EnvironmentVariables.TYPESAFE_API_KEY raw ~/Library/LaunchAgents/ai.gobing.spur-serve.plist
# on the target, before rendering
export TYPESAFE_API_KEY='<value from the line above>'
```

Confirm the rendered file contains `TYPESAFE_API_KEY`, `RunAtLoad`, `KeepAlive`, and a `PATH` that
resolves `bun spur kk jq ffmpeg uv gh claude codex`. Then load it:

```bash
launchctl bootout gui/$(id -u)/ai.gobing.spur-serve 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur-serve.plist
launchctl print gui/$(id -u)/ai.gobing.spur-serve | head -20
```

Keep the machine awake on AC (already set; `sudo` needs a password, so only verify):

```bash
pmset -g custom | grep -E ' sleep| powernap| autorestart'
```

---

## 8. Verification matrix

Each row is a command whose failure blocks the cutover. The Evidence column is the 2026-10-20 run.

| ID | Check | Command | Pass criterion | Evidence 2026-10-20 |
| --- | --- | --- | --- | --- |
| V1 | CLI versions | `kk --version; spur --version` | `0.1.5` / `0.4.18` | PASS |
| V2 | Stage runner parity | `kk stage daily-preflight plugins/kk/workflows/kk-daily-ai-voice2.yaml plugins/kk/workflows/kk-daily-safety.yaml` | exit 0, no `unknown stage` | PASS — `preflight: stage runner advertises every stage …` |
| V3 | Config is read | `kk store extract --topic ai-news --window 24h --include-selected` | same count as the source | PASS — 3 on both hosts (topic profile + store path resolve) |
| V4 | Store pool | `kk store extract --topic ai-news --window 24h` | identical to the source | PASS — 0 on both (today's pool was already consumed) |
| V5 | Decision makers | `spur decision run kk-item-quality --param title=… --param source=… --json` | `maker: laya-local`, `source: model` | PASS — value 1, confidence 0.326, `reason: accepted` |
| V6 | Agent executors | `spur agent run "…write a file…" --agent scribe` and `--agent reviewer` | exit 0, file written | PASS — pi/minimax 12.8 s, pi/kimi-k3 15.6 s |
| V7 | voxcpm render | `kk executor run voxcpm-tts --in smoke.json --out out.json` | WAV present, QC passed, non-silent | PASS — 7.02 s WAV, QC 100/100, mean −20.0 dB, peak −6.7 dB |
| V8 | Publish transport | `git push --dry-run origin main` in the surfdash checkout | no auth error | PASS — `Everything up-to-date` as `robinmin` |
| V9 | Scheduler live | `launchctl print gui/$(id -u)/ai.gobing.spur-serve` + `.spur/logs/spur.log` | agent `running`, 5 jobs | PASS — pid running, `Scheduler entries registered {jobs:5}`, and a real tick (`history-refresh`) fired at 13:00 local and finished `completed` |
| V10 | One real episode | leave the 04:30 tick to run, then read `.works/kk-daily-ai-voice2/<date>/` | episode audio + publish result + ledger row | pending — first unattended tick |

Rows V1–V9 ran before the cutover; **V10 is the cutover** — the first unattended tick on the target
with the laptop's scheduler already stopped.

### 8.1 Restore evidence beyond the matrix

| Fact | Observed |
| --- | --- |
| Config tarball | 653 MiB (1.4 GiB expanded), `SHA256SUMS` verified on the target |
| Checkout | `origin/main` @ `13581560` + 11-file working-tree patch applied cleanly (`git apply --3way`) |
| Store | `.works/kk.db` 414 items on arrival; a real `kk-collect` run took it to 416 and reported `workflow done: kk-collect -> done` |
| Voice weights | `openbmb/VoxCPM2` 4.6 GiB rsynced; voxcpm venv 1.4 GiB via `uv sync --locked` in 59 s |
| Voice identity | `voices/robin-news.wav` sha256 `472cbee3…` identical on both hosts; both renders used the `reference` profile |
| Laya maker | `laya-mlx==0.4.0` uv tool + 647 MiB `convaiinnovations/laya-multilingual` weights auto-pulled |
| Render speed | 3 m 22 s cold (model load) vs ~36 s warm on the M5 laptop; episode-scale timing not yet measured |
| Disk after restore | 19 GiB free (from 21 GiB) |
| Headless survival | console session `robin`, `autoLoginUser=robin`, FileVault off, AC `sleep 0` |

### 8.2 Findings that changed the procedure

1. **`laya-mlx` is a hidden dependency.** Without it the `kk-item-quality` decision silently
   degrades: `DecisionConfigError: laya-mlx runtime is not importable`, `confidenceLevel: LOW`,
   fallback value — no error, no failed run, just worse labels. Install it as a *uv tool*
   (`uv tool install laya-mlx==0.4.0`) because spur resolves
   `~/.local/share/uv/tools/laya-mlx/bin/python` **before** `python3`.
2. **`kk` resolved to the bun-global copy, not the home project.** The target's `~/.bun/bin/kk`
   pointed at `~/.bun/install/global/…` while `~/node_modules/@gobing-ai/knowledge-kit` was the
   copy §6.4 refreshes. Repointed both `kk`/`knowledge-kit` shims at `~/node_modules`, matching the
   source layout.
3. **The surfdash clone paused at a stale commit.** `git push --dry-run` failed with
   "remote contains work that you do not have" — the source checkout was one commit behind
   `origin/main`, and that commit also absorbed the content edits the rsync had copied. The two
   colliding untracked files were byte-identical to the incoming blobs (`shasum` compared before
   deleting), so `git pull --ff-only` was safe and the mini is now level with origin.
4. **Low Power Mode is on.** `pmset -g custom` reports `lowpowermode 1` on AC, which throttles the
   M4 during a long MPS render. Turning it off needs the operator's sudo password:
   `sudo pmset -a lowpowermode 0`.
5. **A pre-existing decision-maker bug, not a migration defect.** `kk-item-china-politics` and the
   other `typesafe`-routed decisions currently fail with `TypeError: Body already used` and
   fail closed to `3`; items that hit that path are excluded by the profile's `lte: 1` gate. It
   reproduces identically on the source machine, and 176 items in the store still pass every gate
   over a 7-day window, so the pool refills from the heuristic path. Worth fixing separately — a
   consulted item is silently dropped.
6. **Executor roster differs.** The target has 11 usable executors vs the source's 17: the whole
   `antigravity-cli` (`agy`) family is missing, so `reviewer`/`planner` elect `pi/kimi-k3` instead of
   `gemini-3.8-flash-high`, and `scribe` elects `minimax/MiniMax-M3.1-Flash-Preview`. Every role the
   daily DAG uses (`scribe`, `reviewer`) still resolves and runs; output style may drift slightly.

---

## 9. Cutover and rollback

Cutover, in this order (executed 2026-10-20):

```bash
# 1. target: everything above green, scheduler loaded and serving
# 2. source: stop the scheduler so two machines are never both due at 04:30,
#    and disable it so a source reboot does not bring it back
launchctl bootout gui/$(id -u)/ai.gobing.spur-serve
launchctl disable gui/$(id -u)/ai.gobing.spur-serve
launchctl print gui/$(id -u)/ai.gobing.spur-serve   # -> "Could not find service"
launchctl print-disabled gui/$(id -u) | grep gobing # -> ". => disabled"
# 3. source: keep the plist file in place — it is the rollback
```

Rollback (any time, ~1 min):

```bash
launchctl enable gui/$(id -u)/ai.gobing.spur-serve
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur-serve.plist
ssh homelab 'launchctl bootout gui/$(id -u)/ai.gobing.spur-serve'
```

The store fork is the only asymmetric state: whichever machine ran the tick owns that day's ledger
row. If the target publishes and the source later re-runs the same date, `kk daily prepare` sees the
ledger row and skips — verify with `kk ledger show --date <date>` before re-enabling.

---

## 10. Risks and known gaps

1. **Browser-profile logins may not survive the move.** Chromium cookie values in
   `~/.config/kk/browser-profiles/*` are encrypted with a key from the login Keychain
   (`<Browser> Safe Storage`). The tarball carries the profile *directories*, not that Keychain item,
   so XHS/WeChat/Medium sessions can come up logged-out on the target. Not blocking for the daily
   run — surfdash and podcast publish use API tokens — but any browser-backed soft channel needs one
   interactive re-login on the target (`kk bot login <channel>`, headed).
2. **`kk stage` vs the checkout** (§6.4) is the highest-frequency failure mode: a reinstalled
   `knowledge-kit` silently reverts the stage runner, and the failure surfaces 30 minutes into the
   run. Re-rsync after every install.
3. **Untracked workflow work.** The laptop tree carries fixes that are not on GitHub (the
   `daily-preflight` guard, surfdash-pub patching, daily-article-gen). Until they are committed and
   pushed, the target's checkout is a hand-carried snapshot with no provenance — land them on a
   branch soon after the trip.
4. **Memory, disk and throttling.** 16 GB unified memory on M4: voxcpm on `mps` fits, but a
   concurrent `spur serve` history-analyze tick plus a render can pressure swap. 19 GiB free after
   the copy; a 2 h episode render writes < 1 GiB. Low Power Mode is currently **on** (`lowpowermode
   1`) and throttles MPS renders — `sudo pmset -a lowpowermode 0` if episodes run long. Monitor
   `df -h` weekly.
5. **Render throughput is unproven at episode scale.** One segment cost 3 m 22 s cold on the M4
   versus a ~36 s warm render on the M5 laptop; the 2026-10-15 production episode took 21.8 min on
   the laptop. The job's `timeoutMs` is 4 h, so a 3–5× slowdown still fits, but the first
   unattended episode is the real measurement (V10). If it overruns, set `vdriver: gemini` in the
   workflow vars (hosted, quota-bound) rather than editing the scheduler.
6. **A reboot needs the GUI session back.** The agent is a `gui/$UID` LaunchAgent: it starts at
   login, not at boot. `autoLoginUser=robin` and FileVault off mean a power-loss restart recovers
   unattended (both verified 2026-10-20); a macOS update that lands on the login window without
   auto-login would leave the scheduler dormant until someone logs in.
7. **Fallback ceilings.** `gemini-tts` is Tier 1 (~100 requests/day) with
   `VOICEBOX_MAX_VERIFY_ATTEMPTS=1`; omni-voice is last and its 3 GB model is *not* pre-pulled, so on
   a cold fallback the render waits on a Hugging Face download.
8. **Agent auth drift.** `agent.run` resolves whatever CLI is installed and logged in. The target has
   claude/codex/pi/omp/opencode; if a token expires while travelling the plan/article stages fail with
   exit 3. Check `spur agent list` and one real `agent.run` before leaving (§8 V6). The target also
   lacks the `agy` family, so `reviewer`/`planner` elect a different executor than the source.
9. **Time-of-day is load-bearing.** `kk-collect` (:05) must finish before the 04:30 episode run reads
   the pool. Both hosts are `America/Los_Angeles`; do not change the target's timezone, and do not
   move the mini across a DST boundary mid-run.
10. **Single machine, single point of failure.** No failover: if the mini is off, asleep on battery,
    or its `spur serve` is killed, the day silently produces nothing (this happened 2026-10-12 — see
    the plist header). `KeepAlive` + `sleep 0` on AC are the mitigations; check
    `.works/spur-serve/serve.log` and `launchctl print` after the first unattended day.
11. **The pool can close empty for reasons outside this migration.** `kk-item-china-politics` gates
    the extract profile at `lte: 1`, and the `typesafe` maker currently errors (`Body already used`)
    and fails closed to `3`. Observed 2026-10-20: a 24 h window holding only two fresh items produced
    a 0-item pool while 176 items over 7 days pass every gate. A thin news day therefore closes
    `done-no-content` by design, but a broken maker narrows it further.
