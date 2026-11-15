# Migration: scheduled jobs from laptop → mac mini

## Current handoff — same-host cutover on the production Mac mini (2026-11-15, task 0373)

**Owner: the coding agent running on the production host. Supersedes the 2026-11-14 deferred handoff.**
The earlier text in this section described a remote migration over `ssh homelab` (`mac.lan`) from a
laptop. That premise was wrong: `mac.lan` / `HomeServer` — Mac16,10 Mac mini, Apple M4, 16 GB,
macOS 27.0.1, arm64, `America/Los_Angeles` — **is** the production host. It runs
`ai.gobing.spur-serve`, holds the live `.works/kk.db`, and needs no migration onto it. The remaining
work is a same-host cutover plus the defects that inspection exposed. `git revert 86ec3def` is no
longer the rollback plan; the deployed bundle is.

### What inspection found and what was changed (2026-11-15)

| Defect | Evidence | Resolution |
| --- | --- | --- |
| Two servers fought over port 3003; the supervised one crash-looped | `launchctl` `runs = 165`, last exit 1, while a shell-owned `spur self serve` held `*:3003` | Duplicate retired; `ai.gobing.spur-serve` now owns `127.0.0.1:3003` and stays up |
| `bootstrap.scheduler.enabled: false` while ticks kept firing | commit `6a1713ea` vs live `scheduler.custom` rows | Set `true`; the flag now matches behaviour |
| Scheduled ticks carried retired commands (`bun scripts/daily-ai-news.ts …`, deleted by `86ec3def`) | `queue_jobs` 2026-11-12 → 2026-11-15 all `Module not found` | Current config uses the `kk news` verbs; a fresh tick enqueued the current command |
| Cost-first executor resolution picked dead executors | `opencode -free` → `Invalid credential`; `agy-gemini` → OAuth login; `pi-dsv4.1-flash-volc` → 429 until 2026-11-18 | The two opencode `-free` entries are disabled; the three kk news jobs pin `--agent pi-dsv4.1-flash-cc`, which answered a probe here |
| Installed `dist/index.js` lacked the `greenWithBundle` fix from `99be5d14` | bundle diff vs a fresh `bun run build` | Rebuilt bundle deployed over the installed copy; `plugins/kk/scripts` and workflows already matched |
| Stuck `kk bot open` windows held the weibo and shipinhao profile leases | lease `owner.json` pids 18359 / 40202, 14–17 h idle | Closed with operator approval; the two stale lease dirs were moved to `.works/tmp/rollback-20261115/leases/` |

### Resolved — generation now produces content (2026-11-15)

`kk news prepare` extracted a non-empty pool and then never ran `daily-plan`/`daily-qc-content`: the
pool gate read `10-collect/pool.json` through an object-only reader, so the bare `Doc[]` that
`dailyExtract` writes counted as zero items and every day closed `no-content`. Fixed as **task 0374**
(`apps/cli/src/commands/content-generate.ts`, regression case in `apps/cli/tests/content-generate.e2e.test.ts`)
and proven on the live store: `{"pool":"ok","candidates":4,"selected":4}`, gate `PASS`. **Task 0373** is
closed on that evidence.

### Remaining sequence — owned by task 0376

1. Observe one complete scheduled day: the 04:30 generate, the 07:00 `overseas-rss` window and the
   17:00 `cn-peak` window must all settle. `xhs` stays `off` in
   `plugins/kk/publish-presets/daily-ai-voice.json` and `--live-channels` cannot promote an `off` row.
2. Read back the day's three `scheduler.custom` payloads and confirm none names a retired entry point.
3. Save the three redacted launch receipts plus `kk news status --run-date <YYYYMMDD>` under
   `docs/tasks/evidence/0369/<YYYYMMDD>/`, with an index recording host, build, timezone, works root,
   timestamps and the previous-day overseas selection. Never save env dumps or authentication state.
4. Keep rollback explicit: pre-change copies live in `.works/tmp/rollback-20261115/`
   (`config.yaml.bak`, `ai.gobing.spur-serve.plist.pre-selfserve`, both pre-fix bundles,
   `spur-config.yaml.bak`, the two lease dirs). Restore by re-enabling exactly one scheduler host,
   never two, and never by dropping `kk.db`.

Note: the launchd argv now runs `spur self serve --host 0.0.0.0 --port 3003` per operator decision, but
`kk schedule render kk-serve` still emits `serve` + `127.0.0.1`
(`plugins/kk/schedules/kk-serve.launchd.plist.tmpl`), so a re-render silently reverts it.

## Historical October deployment

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
| C7 | The target's store (`.works/kk.db`) carries the 24 h item pool, and the intro sting at `~/.config/kk/voices/AI每日资讯_8秒播客片头.mp3` exists (`intro_music` names it there; no `.works` symlink is needed). |
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

# C. The whole works tree — every historical run artifact, plus the store
#    (.works is gitignored, so this tarball is the only transport for history)
tar -C /Users/robin/xprojects/knowledge-kit -czf /tmp/kk-migration/kk-works-full.tgz .works
#    4.5 G -> 3.8 G; media (png/mp3/wav) does not compress. ~20 min over the LAN.

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

`fm-local` additionally needs the Apple Foundation Models CLI licence accepted once per machine by a
privileged user (`sudo fm license`). Until that is done every `fm-local` decision answers
`no-backend` and falls back to its fail-closed default — `kk-item-category` returns `non-ai` for
every item, so the `ai-news` extract profile admits nothing and the daily run closes as no-content
even though collection worked. On a machine without the licence, route the labelling decisions to a
maker that does answer (the laptop's `.spur/config.yaml` sends `kk-item-category`,
`kk-item-importance`, `kk-item-urgency` and `kk-item-impact` to `typesafe` for this reason).

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

### 6.6 The works tree (history) — stop the scheduler first

`.works` holds every historical run (audio, articles, covers, ledgers) **and** the store
`kk.db`. It is gitignored, so nothing here is recoverable from the repo.

**Stop the target's scheduler before touching the store.** A running `spur serve` holds the DB
open and a tick can fire mid-extraction:

```bash
launchctl bootout gui/$(id -u)/ai.gobing.spur-serve
```

Then archive the target's own state, move its DB aside, and extract:

```bash
cd ~/xprojects/knowledge-kit
tar -czf ~/kkmig-test/kk-works-mini-before-migration.tgz .works          # reversible
tar -xzpf /tmp/kk-migration/kk-works-full.tgz --exclude=".works/spur-serve/serve.log"
du -sh .works && sqlite3 .works/kk.db "select count(*) from items;"
```

The two intro-music files are **absolute symlinks** into `~/.config/kk/voices/`, so they resolve on
the target only because §6.5 already ran — verify with `ls -laL`.

### 6.6.1 The store diverges — merge, never blind-overwrite

If the target's scheduler ran between the copy in §6.3 and this step, its `kk.db` and the source's
have **both** moved: each collected items the other lacks (observed 2026-10-20: source 422 items,
target 418, with 6 source-only and 2 target-only). Overwriting the target's DB silently drops its
rows, so back it up and merge:

```bash
# diff what each side has (do this before extracting)
sqlite3 .works/kk.db "select id from items order by id;" > /tmp/mini-items.txt
sqlite3 .works/kk.db "attach '/path/to/source/kk.db' as new; \
  select id from new.items where id not in (select id from items);"

# merge: collect_runs -> items -> labels, each by explicit id list
sqlite3 .works/kk.db <<'SQL'
ATTACH '/Users/robin/kkmig-test/mini-db-before/kk.db' AS old;
BEGIN;
INSERT OR IGNORE INTO collect_runs SELECT * FROM old.collect_runs
  WHERE run_id IN (SELECT first_seen_run FROM old.items WHERE id IN ('<ids>'));
INSERT OR IGNORE INTO items SELECT * FROM old.items WHERE id IN ('<ids>');
INSERT OR IGNORE INTO labels SELECT * FROM old.labels WHERE item_id IN ('<ids>');
COMMIT;
SQL
sqlite3 .works/kk.db "PRAGMA integrity_check;"
```

`items`/`labels` carry **no foreign keys**, and `labels` has a unique index on
`(item_id, decision_id, maker, run_id)`, so `INSERT OR IGNORE` is idempotent. Insert in that order,
and select the label rows by **explicit item id** — a `WHERE item_id NOT IN (SELECT id FROM main.items)`
clause is order-dependent and silently matches nothing once the items are already in (that mistake
cost one merge attempt on 2026-10-20).

Finish by restarting the scheduler and confirming it re-registers:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur-serve.plist
curl -s localhost:3003/api/health
grep "Scheduler entries registered" .spur/logs/spur.log | tail -1     # -> {"jobs":5}
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
| Render speed | 202 s cold **and 178.8 s warm** for the same 7 s clip — model load is not the difference; ~36 s on the M5 laptop |
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

1. **Browser-profile logins do not survive the move.** Chromium cookie values in
   `~/.config/kk/browser-profiles/*` are `v10`-encrypted (verified: every `Cookies` row carries a
   `0x763130…` blob and zero plaintext `value`s) and decrypt with a key from the login Keychain.
   `ts-browser-automation` launches `playwright.chromium.launchPersistentContext(profileDir)` with no
   `channel` (`ts-browser-automation/dist/launcher.js:76`), i.e. **Playwright's bundled Chromium**,
   whose key is the `Chromium Safe Storage` item — present on the source, **absent on the target**
   (`security find-generic-password -s "Chromium Safe Storage"`). Even with the item present the key
   is random per machine, so the copied profiles cannot authenticate. Not blocking for the daily
   run — surfdash and podcast publish use API tokens — but every browser-backed channel needs one
   interactive re-login on the target (`kk bot login <channel>`, headed).
2. **`kk stage` vs the checkout** (§6.4) is the highest-frequency failure mode: a reinstalled
   `knowledge-kit` silently reverts the stage runner, and the failure surfaces 30 minutes into the
   run. Re-rsync after every install.
3. **Untracked workflow work.** The laptop tree carries fixes that are not on GitHub (the
   `daily-preflight` guard, surfdash-pub patching, daily-article-gen). Until they are committed and
   pushed, the target's checkout is a hand-carried snapshot with no provenance — land them on a
   branch soon after the trip.
4. **Low Power Mode is on, but it is not the explanation.** `pmset -g custom` reports
   `lowpowermode 1` on AC. A warm re-render still took 178.8 s against 202 s cold, so the 5× gap to
   the M5 laptop is the SoC/memory, not a cold model load and not proven to be throttling.
   `sudo pmset -a lowpowermode 0` is worth trying, but do not expect it to explain the gap.
5. **Per-invocation cost, not per-episode.** `daily-generate` synthesises **one section per
   `kk executor run`, sequentially** (`plugins/kk/scripts/daily-stages.ts:1139-1178`), and the voxcpm
   worker loads the model once per invocation. At ~170 s of load plus render time per section, an
   episode of 10–14 sections projects to roughly **50–90 min** on the M4 versus ~22 min on the M5.
   The job's `timeoutMs` is 4 h, so it fits — but the first unattended episode (V10) is the real
   measurement. If it overruns, set `vdriver: gemini` in the workflow vars rather than editing the
   scheduler.
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

---

## 11. Claim verification

Every non-obvious claim this runbook relies on, with the evidence that supports it. `path:line`
means the owning source in this checkout; a shell command means it was executed on 2026-10-20 and
the output is quoted. **H** = observed or read directly, **M** = consistent with docs/source but not
independently exercised, **L** = inference or third-party claim not verified here.

| # | Claim | Evidence | Conf. |
| --- | --- | --- | --- |
| 1 | `kk stage` resolves its runner from the **installed** package while the scheduler executes the **checkout's** YAML | `git show 1358156:plugins/kk/scripts/daily-stages.ts \| grep -c daily-preflight` → `0` (the released 0.1.5 lacks the stage the current YAML calls), and `kk stage daily-preflight …` only passes after the §6.4 rsync; `AGENTS.md` §"Editing `plugins/kk/scripts/`" documents the split | H |
| 2 | `daily-generate` synthesises one section per `kk executor run`, sequentially | `plugins/kk/scripts/daily-stages.ts:1139-1178` (`for (const plan of plans)` → `kk(voiceExecutorArgs(...), {soft:true})`) | H |
| 3 | The voxcpm worker loads the model once per invocation, so per-section cost is load-bound | `plugins/generations/voxcpm-tts/README.md` ("one model load per invocation") + measured 202 s cold / 178.8 s warm for one 7 s clip | H |
| 4 | spur resolves the laya interpreter from `~/.local/share/uv/tools/laya-mlx/bin/python` before `python3` | `~/node_modules/@gobing-ai/spur/spur.js:70060-70077` (`resolvePythonPath` candidate list); installing the uv tool flipped `kk-item-quality` from `DecisionConfigError` to `maker: laya-local, source: model` | H |
| 5 | The laya default model is `convaiinnovations/laya-multilingual` | `spur.js:70202` (`DEFAULT_LAYA_MODEL_ID`) | H |
| 6 | v10 cookies cannot be reused on another machine | `sqlite3 <profile>/Default/Cookies` → every `encrypted_value` starts `763130` (`v10`), `select count(*) where value != ''` → `0`; `ts-browser-automation/dist/launcher.js:76` launches bundled Chromium; `security find-generic-password -s "Chromium Safe Storage"` → found on the source, **not found** on the target | H |
| 7 | `surfdash-pub` commits and pushes the checkout itself | `plugins/publishings/surfdash-pub/src/index.ts:319,336,346` (`git add` / `git commit` / `git push … origin main`) | H |
| 8 | The macOS `rsync` rejects `--info=progress2` | `rsync --version` → `openrsync: protocol version 29 / rsync version 2.6.9 compatible`; the flag aborted with a usage dump | H |
| 9 | The `typesafe` maker is broken identically on both hosts | `spur decision run kk-item-china-politics …` → `TypeError: Body already used`, `value 3`, on the source **and** the target | H |
| 10 | The extract profile still yields a pool on a normal day | `sqlite3 .works/kk.db` join over `items`+`labels` (category/quality/importance/china-politics) → **176** items in a 7-day window; a 24 h window held 2 fresh items, both china-politics `3` | H |
| 11 | Low Power Mode explains the slow render | **Disproven as the sole cause**: warm 178.8 s vs cold 202 s — the load is not re-paid, yet the gap to the M5 (36 s) persists. Its own contribution is unmeasured | L |
| 12 | Gemini TTS is ~100 requests/day on Tier 1 | Only the comment in `~/.config/kk/config.yaml` (the project's own earlier finding); no provider page was read | L |
| 13 | A `gui/$UID` LaunchAgent needs the user's GUI session after a reboot | Not tested by an actual reboot. Observed: `launchctl managername` → `Background`, `autoLoginUser=robin`, `fdesetup status` → FileVault Off | M |
| 14 | whisper weights are not needed by the voxcpm path | `grep -rn whisper` over `plugins/generations/{voice-gen,voxcpm-tts}/{src,python}` → no hits; the ASR model belongs to `omni-voice-gen`. Does not cover transitive imports from `uv.lock` | M |
| 15 | Playwright's Chromium is already installed on the target | `~/Library/Caches/ms-playwright/chromium-1194` present (1.1 GiB cache) and `playwright` resolved under `node_modules/.bun` — so no `npx playwright install` step was needed | H |

### 11.1 Uncertainty phrases from the 2026-10-20 report, resolved

| Phrase as written | Resolution |
| --- | --- |
| "Browser-profile cookies **likely** won't decrypt on the mini" | Confirmed — claim 6. Wording upgraded to a statement, with the missing keychain item named. |
| "the **likely cause** of the 3m22s render" (Low Power Mode) | Withdrawn — claim 11. The warm measurement rules it out as the sole cause; the real driver is per-invocation model load on a slower SoC. |
| "**may** need one interactive login" per browser channel | Still conditional, and correctly so: it needs a login on *every* channel whose profile was copied (claim 6), not just "some". |
| "**~22 min** episode on the M5" | Sourced from the workflow's own 2026-10-15 production measurement (`.spur/config.yaml` comment), not re-measured here — treat as M. |

### 11.2 Works-tree migration (2026-10-20, evening)

| Check | Result |
| --- | --- |
| Tarball | `.works` 4.5 GiB → 3.8 GiB (`tar -czf`), sha256 `06c55c8c…` verified on the target |
| Transfer | ~35 min over this LAN (~2 MB/s) — the slowest step of the whole migration |
| Extraction | 23 s, `tar -xzpf`, excluding the target's live `serve.log` |
| Item parity before merge | source 422, target 418 — **6 source-only, 2 target-only**; the target was not a subset |
| Merge | 2 items + 16 label rows + 1 `collect_runs` row inserted; `PRAGMA integrity_check` → `ok`; final **424 items / 8805 labels** |
| Run artifacts | `kk-daily-ai-voice2` run dirs: **17 on both hosts**. File-level diff: **0 source-only paths**, 48 target-only paths (26 `kk-collect` files from its own `T2305Z` run, 22 `kk-smart-seo` preflights) — additive, nothing missing |
| Symlinks | 4 absolute `voices/` symlinks resolve (`ls -laL` → 223862 bytes) |
| Scheduler | halted during the swap, re-bootstrapped after: `state = running`, `Scheduler entries registered {jobs:5}` |
| Backups retained | `~/kkmig-test/kk-works-mini-before-migration.tgz` (1.1 MiB), `~/kkmig-test/kk.db.pre-merge` (5.9 MiB) |
| Disk after | 17 GiB free |

**Lesson.** A "copy the folder over" instruction is not safe for `.works`: the store inside it is a
live database that both machines advance independently. Diff first, back up the loser, merge by
explicit id, and only then restart the scheduler.

### 11.3 Works-tree migration claims (2026-10-20, evening)

`laptop-only files` is the decisive completeness measure: `comm -23 <source list> <target list>`.

| # | Claim | Evidence | Conf. |
| --- | --- | --- | --- |
| 1 | `.works` is untracked, so the tarball is the only transport for history | `git check-ignore -v .works` → `.gitignore:180:/.works` | H |
| 2 | The tarball is complete — nothing was left on the source | `comm -23 laptop-files.txt mini-files.txt` → **0 laptop-only files** (4877 vs 4892; every source path present) | H |
| 3 | The target holds 48 files the source does not, all from its own post-cutover runs | `comm -13` → 48, composed of 26 `kk-collect/` files from runs `20261020T2004Z` (**source**) + `20261020T2305Z` (**target-local**) and 22 `kk-smart-seo/` preflight dirs | H |
| 4 | `--exclude` preserved the target's live `serve.log` instead of overwriting it | target log: `size=582`, `created=Oct 20 12:54:33`, 2 start banners; source log: 1701 bytes, 5 banners. The source's content is absent → exclusion held, and the target's file was created before the migration and kept its inode | H |
| 5 | Compression is only 16% because the bulk is media | measured 4.5 GiB → 3.8 GiB (84%); by count the tree is dominated by text (3521 `json`, 368 `txt`, 316 `md`) against 155 `wav`/123 `png`/115 `mp3`, but by bytes the media dominates — so 16% is the measured result, the media explanation is plausibility, not a measurement | H / M |
| 6 | `items` and `labels` carry no foreign keys | `select sql from sqlite_master … \| grep -ci "foreign key"` → `0` | H |
| 7 | `labels` is protected by a unique index, so a re-run of the merge cannot duplicate | `sqlite_master` → `CREATE UNIQUE INDEX "labels_observation_unique" ON labels (item_id, decision_id, maker, run_id)` | H |
| 8 | `INSERT OR IGNORE` skips conflicting rows rather than aborting | Observed effect only: a second attempt at the same insert changed nothing (labels stayed 8789) and the corrected insert moved 8789 → 8805. The general semantics come from SQLite's conflict-clause documentation (sqlite.org/lang_conflict.html), **not fetched this session** | H (observed) / M (general) |
| 9 | Blindly overwriting the target's DB would have dropped rows | Divergence observed before the merge: 422 vs 418 items, 6 source-only and 2 target-only ids. The loss is inferred from the row counts, not from attempting the overwrite | H |
| 10 | The two intro-music files are absolute symlinks that resolve on the target | `readlink` → `/Users/robin/.config/kk/voices/…`; `ls -laL` → 223862 bytes on both hosts | H |
| 11 | The stale `index.lock` had no owner and was safe to move | 0 bytes, `created 14:33`, no `git` process in `ps`, and `git status` in the same repo worked — so only write paths were blocked | H |
| 12 | The target's scheduler kept running after cutover, which is why the store diverged | `queue_jobs` `scheduler.custom` rows completed at 16:00, 16:05, 16:30, 17:00, 17:30; the 16:05 tick is the one that added the 2 target-only items | H |
| 13 | `kk` must be upgraded to 0.1.6 because the repo moved to it | `npm view @gobing-ai/knowledge-kit dist-tags` → `{ latest: '0.1.6' }`; after `bun add`, `kk --version` → `0.1.6` and preflight still exits 0 | H |
| 14 | The repo's `bun.lock` change came from the version bump | **Unverified.** It was reverted with `git checkout -- bun.lock` because a generated lock diff does not belong in a hand-carried tree. The actual cause was not traced | L |
| 15 | Transfer ran at ~2 MB/s / ~35 min and extraction took 23 s | Measured from the transfer loop's byte counters (3278 MB → 3877 MB over ~10 min, tapering to ~2 MB/s) and the `tar` wall clock | H |

### 11.4 Final state report claims (2026-10-20, 19:45)

| # | Claim | Evidence | Conf. |
| --- | --- | --- | --- |
| 1 | The source scheduler is durably disabled, not just stopped | `launchctl print-disabled gui/501` → `"ai.gobing.spur-serve" => disabled`; `ps` count of `spur serve` → 0 | H |
| 2 | The target scheduler runs under launchd | `launchctl print` → `state = running`, `pid = 15393`; `/api/health` → `{"status":"ok",…,"uptime_seconds":…}` | H |
| 3 | No scheduled job has failed on the target | `select count(*) from queue_jobs where type='scheduler.custom' and status!='completed'` → `0` | H |
| 4 | Ticks completed at 16:00/16:05/16:30/17:00/17:30/19:00/19:30 | `queue_jobs` timestamps, quoted from the query output | H |
| 5 | The 18:00 and 18:30 gaps came from my own halt during the works swap | Halt window observed: backup tarball created 17:39, `Starting Spur server` #2 at 18:31:48, `serve.log` modified 18:31:48. A tick between 17:30 and 19:00 is absent from `queue_jobs`, which is exactly that window | H |
| 6 | A missed history tick self-heals from its checkpoint | Only the project's own comment says so: `.spur/config.yaml:81` "checkpoint resume self-heals the gap". Not exercised — no run was inspected for gap backfill | M |
| 7 | The rollback needs `launchctl enable` before `bootstrap` | Verified the `enable` half only, and it is safe to verify: `enable` flips the flag without loading the agent (`ps` → 0, port 3003 → 0 lines), then the flag was set back to `disabled`. The full pair was **not** executed on the source, deliberately — loading it would re-arm a second 04:30 run | H (half) / M (pair) |
| 8 | `publish-surfdash` and `publish-podcast` are hard-fail nodes | Both node blocks contain `0` `onError:` keys (block-scoped `awk`, count printed per node) | H |
| 9 | The publish artifacts live in `31-publish/` | `ls .works/kk-daily-ai-voice2/20261020/31-publish/` → `…_14_publish-surfdash_result.json`, `…_16_publish-podcast_result.json`, `…_17_publish_completeness.json` | H |
| 10 | Cadences: history every 30 min (07–23), episode 04:30, collect 04:05/10:05/16:05/22:05 | `.spur/config.yaml:83` (`*/30 7-23`), `:136` (`30 4`), `:171` (`5 4,10,16,22`); the observed 16:05 and 19:00/19:30 ticks match | H |
| 11 | The source is a clean 1-command rollback | Overstated twice: it is a **two**-command sequence, and the rollback plist is only valid while `~/.config/kk` and `.works` stay untouched on the source | M |
| 12 | A macOS update could leave the agent dormant at the login window | Inference only. The inputs were verified (`autoLoginUser=robin`, `fdesetup status` → FileVault Off, `stat /dev/console` → `robin`), but no reboot was performed | L |
| 13 | The port-3003 listener seen on the source was unrelated | `lsof` → pid 42385, `spur-new/apps/cli/src/index.ts serve --cwd …/spur-new-runall-g11-8c1f`, i.e. another project's dev server, not a second knowledge-kit scheduler | H |
| 14 | Transfer scratch is 4.4 GiB and removable | `du -sh /tmp/kk-migration` → 4.4G, of which `kk-works-full.tgz` is 3.8G; both `.works` copies are authoritative | H |
