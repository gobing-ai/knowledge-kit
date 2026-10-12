#!/bin/sh
# Falsification cases for `api-library-claim-citation.sh` (rule
# `api-library-claim-cites-source-and-confidence`).
#
#   sh .spur/rules/structure/api-library-claim-citation.test.sh   # 0 = every case behaved
#
# Each case is a fixture document with (or without) an `API/library claim sources and confidence`
# block, plus the exit status the checker must produce for it. A case failing here means the rule
# stopped enforcing the citation-and-earned-level contract, or started failing a row it must accept
# (the two real-corpus cases below are the positive control for the latter).
set -u

checker="$(dirname "$0")/api-library-claim-citation.sh"
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass=0
fail=0

# case <name> <want-exit> <document>
case_check() {
    name="$1"
    want="$2"
    file="$tmp/$name.md"
    cat >"$file"
    if sh "$checker" "$file" >"$tmp/$name.out" 2>&1; then
        got=0
    else
        got=1
    fi
    if [ "$got" -eq "$want" ]; then
        pass=$((pass + 1))
        printf 'ok   %-30s exit=%s\n' "$name" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL %-30s want exit=%s got %s\n' "$name" "$want" "$got"
        sed 's/^/     /' "$tmp/$name.out"
    fi
}

# --- the contract ---

case_check cited-high-gapped-medium 0 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `react-dom` facade is importable | https://example.com/manifest | Read the installed manifest | HIGH |
| Markdown renders as text | Author's report | Not re-fetched at task creation | MEDIUM |
EOF

case_check empty-block 1 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
EOF

case_check level-outside-enum 1 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `apiVersion` is 1 | board/index.d.ts:21 | Read | SURE |
EOF

case_check high-without-citation 1 <<'EOF'
#### API / library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The loader accepts compiled ESM | I checked it earlier | Ran the loader once | HIGH |
EOF

case_check medium-cites 0 <<'EOF'
#### API / library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The route returns 404 for orphan rows | `apps/cli/src/commands/run.ts:120` | Read the handler | MEDIUM |
EOF

case_check medium-names-gap 0 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The theme renders the field unescaped | the theme's triple-stache, as cited in review | Not re-fetched at task creation | MEDIUM |
EOF

case_check low-cites 0 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| Only one test imports the type | `rg -l TargetOutcome` | `apps/cli/tests/fanout.test.ts` | LOW |
EOF

case_check low-with-prose-only 1 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The fallback is exploitable | Reasoned from the code | Looks plausible | LOW |
EOF

case_check qualified-confidence-tail 0 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| A sibling manifest exists at every root | `package.json` at the repo root and in the published package | Read all three roots | HIGH for the monorepo and bundle; MEDIUM for third-party installs |
EOF

# A quoted pipe inside a cell must not widen the row (task 0157 does exactly this).
case_check escaped-pipe-stays-four-cells 0 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `.safeParse` returns `{ success, data \| error.issues }` with `issues[].path` | https://zod.dev/basics#handling-errors | Every `safeParse` site uses this shape | HIGH |
EOF

case_check short-row-is-malformed 1 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| The loader accepts ESM | https://example.com/manifest | Read it | HIGH
EOF

# ROW scope: a cited HIGH neighbour must not launder an uncited HIGH row.
case_check row-scope-not-block-scope 1 <<'EOF'
#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| `apiVersion` is 1 | board/index.d.ts:21 | Read | HIGH |
| The loader accepts compiled ESM | A colleague told me | Nothing yet | HIGH |
EOF

# PRESENCE is not the rule's business: a document with no claim block asserts nothing here.
case_check no-block-is-not-a-finding 0 <<'EOF'
# Some design

## Boundary

The artefacts are read through a loopback reader.
EOF

# --- positive control: the real corpus blocks must stay accepted ---
real=""
for rel in docs/tasks/0155_fix-packages-review-findings-kk-core-publish-harness-hardeni.md \
    docs/tasks/0156_fix-plugins-review-findings-image-gen-key-leak-show-notes-xs.md \
    docs/tasks/0157_fix-apps-review-findings-invoke-input-deletion-alias-fan-out.md \
    docs/design/workflow-board-modules.md; do
    [ -f "$repo/$rel" ] && real="$real $repo/$rel"
done
if [ -z "$real" ]; then
    fail=$((fail + 1))
    printf 'FAIL %-30s no real claim block found under %s\n' real-corpus-blocks "$repo"
elif sh "$checker" $real >"$tmp/real.out" 2>&1; then
    pass=$((pass + 1))
    printf 'ok   %-30s exit=0\n' real-corpus-blocks
else
    fail=$((fail + 1))
    printf 'FAIL %-30s the real corpus blocks must stay accepted\n' real-corpus-blocks
    sed 's/^/     /' "$tmp/real.out"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
