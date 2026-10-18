import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 0060 (C4) — storm-research skill + generic /workflow-run command (markdown-only
 * plugin capability files; no TS unit surface). Encodes the R2 ACs that are static invariants
 * of the delivered command:
 *  - 0056 topicId shell-vs-Node equivalence: the actual topicId shell block embedded in
 *    workflow-run.md §4 is extracted and executed, and its output must equal a Node reference
 *    of the frozen 0056 algorithm. A drift in the frozen shell (silent workspace-path change)
 *    fails here, not in a duplicated copy.
 *  - Frozen run procedure: XOR guard, create-on-first-run config heredoc, two-root copy
 *    rule, and the `spur workflow run --vars` 0059 var set.
 * Functional behavior (actual workflow run) is verified separately via `spur workflow` (verify stage).
 */
describe('workflow-run command (0060)', () => {
    const cmdPath = join(import.meta.dir, '../../../plugins/kk/commands/workflow-run.md');
    const cmd = readFileSync(cmdPath, 'utf-8');

    // --- 0056 topicId: shell-vs-Node equivalence -------------------------------

    // Node reference of the frozen 0056 algorithm (must mirror the shell block byte-for-byte
    // in behavior: trim+collapse+lowercase -> slug48 with dash trimming -> sha256[0:8]).
    function referenceTopicId(raw: string): string {
        const normalized = raw.trim().replace(/\s+/g, ' ').toLowerCase();
        let slug = normalized
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48)
            .replace(/-+$/g, '');
        if (!slug) slug = 'topic';
        const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
        return `${slug}-${hash}`;
    }

    // Extract and execute the real topicId shell block from the command markdown.
    function shellTopicId(raw: string): string {
        const block = [...cmd.matchAll(/```bash\n([\s\S]*?)```/g)].find((m) => m[1]?.includes('topic_id='));
        if (!block) throw new Error('topicId shell block not found in workflow-run.md');
        const script = `set -e\nraw="$1"\nworks_dir="$2"\n${block[1]}\nprintf '%s\\n' "$topic_id"`;
        return execFileSync('bash', ['-c', script, '_', raw, '/tmp/kk-works'], {
            encoding: 'utf-8',
        }).trim();
    }

    const topicIdCases = [
        'What are the failure modes of vector databases at 1B rows?',
        'How does  X  behave under Y?',
        'Vector Databases',
        'a_b_c___d',
        '!!!!! leading punctuation',
        'Trailing dash -',
        'x'.repeat(60),
        `${'x'.repeat(60)}----------`,
        '',
    ];

    it('R2 — topicId shell (executed from workflow-run.md) equals the 0056 Node reference', () => {
        for (const raw of topicIdCases) {
            expect(shellTopicId(raw)).toBe(referenceTopicId(raw));
        }
    });

    it('R2 — topicId algorithm steps are present in the command (normalize -> slug48 -> sha256[0:8])', () => {
        expect(cmd).toContain('shasum -a 256');
        expect(cmd).toContain('cut -c1-8');
        expect(cmd).toContain('cut -c1-48');
        expect(cmd).toContain('slug="topic"');
    });

    // --- Frozen run procedure invariants --------------------------------------

    it('R2 — command enforces the topic/--in XOR rule (both or neither -> exit 1, no writes)', () => {
        expect(cmd).toContain('XOR');
        expect(cmd).toMatch(/exactly one of `<topic>` \/ `--in <file>`/);
        expect(cmd).toMatch(/Both set or both empty → exit 1/);
        expect(cmd).toMatch(/no writes/);
    });

    it('R2 — missing config creates on first run with compiled defaults and never overwrites', () => {
        expect(cmd).toContain('create-on-first-run');
        expect(cmd).toMatch(/works_dir:/);
        // ADR-042: the template pins works_dir to the creating cwd and omits workflows_dir — a
        // stale user override silently wins over newer shipped workflow copies.
        expect(cmd).toMatch(/works_dir: "\$PWD\/\.works"/);
        expect(cmd).not.toMatch(/workflows_dir:/);
        expect(cmd).toContain('maxResults: 8');
        expect(cmd).toContain('fixture: false');
        expect(cmd).toContain('never overwrite an existing');
    });

    it('R2 — workflow YAML resolves user-override first, then package root, run in place', () => {
        expect(cmd).toContain('KK_WORKFLOWS_SOURCE');
        expect(cmd).toContain('plugins/kk/workflows');
        expect(cmd).toContain('$pkg/plugins/kk/workflows/$NAME.yaml');
        expect(cmd).toContain('command -v kk');
        expect(cmd).not.toContain('.spur/workflows');
        expect(cmd).toContain('--force');
        expect(cmd).toContain('in place');
        expect(cmd).not.toContain('cp "$src" "$dest"');
        expect(cmd).toContain('no source workflow for $NAME');
    });

    it('R2 — run shells spur workflow run with the 0059 var set for storm-research, all strings', () => {
        expect(cmd).toContain('spur workflow run "$dest" --vars');
        for (const v of ['topic', 'input_file', 'maxResults', 'fixture', 'work_dir', 'plugins_path', 'render_script']) {
            expect(cmd).toContain(`\\"${v}\\"`);
        }
    });

    it('R4 — command defines the kk-itc profile with flags, kebab work_dir, and itc vars', () => {
        expect(cmd).toContain('kk-itc');
        expect(cmd).toContain('--playbook');
        expect(cmd).toContain('--research');
        expect(cmd).toContain('--judge');
        expect(cmd).toContain('--outline');
        expect(cmd).toContain('--writer');
        expect(cmd).toContain('fixture is storm-only');
        // 0303: config-backed options freeze into itc-options.json via the launch JSON; the run vars
        // carry only run-local inputs.
        for (const key of ['writer', 'playbook', 'research', 'judge']) expect(cmd).toContain(`--arg ${key} "$`);
        for (const v of ['outline', 'force', 'rubric']) {
            expect(cmd).toContain(`\\"${v}\\"`);
        }
    });

    it('R2 — command stays a thin wrapper (ADR-011: no new kk first-layer noun)', () => {
        expect(cmd).toContain('ADR-011');
        expect(cmd).toContain('No new `kk` CLI noun');
        expect(cmd).toContain('kk-storm-research');
    });

    it('kk-solo-podcast profile resolves sidecars via package-root fallback, no copy', () => {
        expect(cmd).toContain('kk-solo-podcast');
        expect(cmd).toContain('validate-voicescript.ts');
        expect(cmd).toContain('target_duration_min');
        expect(cmd).toContain('script_approved');
        expect(cmd).toContain('$HOME/.config/kk/workflows');
        expect(cmd).not.toContain('cp "$sdir/$side" "$ddir/$side"');
        expect(cmd).toContain('validate_script');
        expect(cmd).toContain('wrap-voicescript-doc.ts');
        expect(cmd).toContain('\\"wrap_script\\"');
        expect(cmd).toContain('spur workflow run "$dest"');
    });

    // --- 0127: global-install fallback + per-workflow workspace defaults ----------

    /** The §3 candidate-dir loop lines (plain run + --force copy): the resolution chain, in evaluation order. */
    function candidateLoops(): string[] {
        const lines = cmd.split('\n').filter((l) => l.includes('for d in "$KK_WORKFLOWS_SOURCE"'));
        if (lines.length === 0) throw new Error('§3 candidate-dir loop not found in workflow-run.md');
        return lines;
    }

    it('R1 — global installs are probed after KK_WORKFLOWS_SOURCE and before the package root (both §3 loops)', () => {
        const expected = [
            '$KK_WORKFLOWS_SOURCE',
            '$bun_global_workflows',
            '$npm_global_workflows',
            '$pkg/plugins/kk/workflows',
            'plugins/kk/workflows',
        ];
        for (const chain of candidateLoops()) {
            const order = expected.map((entry) => chain.indexOf(entry));
            expect(order.every((i) => i >= 0)).toBe(true);
            expect(order).toEqual([...order].sort((a, b) => a - b));
        }
    });

    it('R1/R2 — each global-install probe is guarded by command -v and a directory test', () => {
        expect(cmd).toContain('command -v bun >/dev/null 2>&1');
        expect(cmd).toContain('command -v npm >/dev/null 2>&1');
        expect(cmd).toContain('bun pm bin -g');
        expect(cmd).toContain('npm root -g');
        expect(cmd).toContain('install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows');
        expect(cmd).toContain('node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows');
        // Guarded probe, not a bare expansion: a missing manager leaves the candidate empty.
        expect(cmd).toMatch(/\[ -d "\$bg" \] && bun_global_workflows="\$bg"/);
        expect(cmd).toMatch(/\[ -d "\$ng" \] && npm_global_workflows="\$ng"/);
    });

    it('R3 — the prose keeps the config failure ahead of every fallback probe', () => {
        expect(cmd).toMatch(/corrupt `config\.yaml` already exited 1 in step 2/);
        expect(cmd).toMatch(/no fallback masks a config error/);
    });

    it('R4 — every profile defaults its work_dir under works_dir/<workflow-name>/', () => {
        // kk-itc's workspace is composed by itc-prepare (explicit dir wins there, 0303).
        expect(cmd).toContain(`work_dir=$(kk stage run itc-prepare --request "$launch" | jq -r '.workDir')`);
        expect(cmd).toContain('`$works_dir/kk-itc/<kebab>[/<run-date>]`');
        for (const profile of ['kk-storm-research', 'kk-solo-podcast', 'kk-daily-ai-voice']) {
            // The ${DIR:-<default>} form is what makes an explicit --dir win over the default.
            expect(cmd).toMatch(new RegExp(`work_dir="\\$\\{DIR:-\\$works_dir/${profile}/`));
        }
    });

    it('R4 — --dir wins over the defaults and no default is cwd-relative', () => {
        expect(cmd).not.toMatch(/\$\{DIR:-\.\//);
        expect(cmd).toMatch(/explicit `--dir`\s+overrides all four defaults/);
    });
});

/**
 * Task 0153 (F41) — `/workflow-run` kk-itc end-to-end profile flags: one command surface
 * binds the 0149-0152 vars (auto/unslop/max-revisions/cover/inline-images/targets/live/
 * source-locale). Static invariants of the markdown command, per the 0060 convention above.
 */
describe('workflow-run kk-itc end-to-end profile flags (0153)', () => {
    const cmdPath = join(import.meta.dir, '../../../plugins/kk/commands/workflow-run.md');
    const cmd = readFileSync(cmdPath, 'utf-8');

    it('R1 — the kk-itc profile documents all eight end-to-end flags', () => {
        expect(cmd).toContain('--auto');
        expect(cmd).toMatch(/--unslop true\|false/);
        expect(cmd).toMatch(/--cover/);
        expect(cmd).toMatch(/--inline-images/);
        expect(cmd).toMatch(/--targets <a,b>/);
        expect(cmd).toMatch(/--live/);
        expect(cmd).toMatch(/--max-revisions <N>/);
        expect(cmd).toMatch(/--source-locale en\|zh\|ja/);
    });

    it('R2 — --auto defaults research, judge and unslop to true unless the operator passed them', () => {
        expect(cmd).toMatch(
            /`--auto` binds `auto=true` and defaults `research`, `judge` and `unslop` to\s+`true` unless the operator passed them explicitly/,
        );
    });

    it('R2 — --live is never implied: publish_live stays false unless passed explicitly (ADR-022)', () => {
        expect(cmd).toMatch(
            /`--live` is never implied — `publish_live`\s+stays `false` unless `--live` is passed explicitly \(ADR-022\)/,
        );
        // AC task-local check: --auto alone leaves publish_live false.
        expect(cmd).not.toMatch(/`--auto`[^\n]*imply[^\n]*live/i);
    });

    it('R2 — --playbook wechat without --source-locale binds zh; explicit --source-locale wins', () => {
        expect(cmd).toMatch(
            /`--playbook wechat` without\s+`--source-locale` binds `source_locale=zh`; an explicit `--source-locale` always wins/,
        );
    });

    it('R2 — the kk-itc launch JSON binds all end-to-end options (spend approvals stay false unless passed)', () => {
        for (const pair of [
            ['auto', 'AUTO'],
            ['unslop', 'UNSLOP'],
            ['maxRevisions', 'MAX_REVISIONS'],
            ['coverEnabled', 'COVER'],
            ['inlineImages', 'INLINE_IMAGES'],
            ['publishTargets', 'TARGETS'],
            ['publishLive', 'LIVE'],
            ['sourceLocale', 'SOURCE_LOCALE'],
        ]) {
            expect(cmd).toContain(`--arg ${pair[0]} "$${pair[1]}"`);
        }
        // Booleans are true only when the flag said "true"; unset ones are dropped for config/defaults.
        expect(cmd).toContain('.value = (.value == "true")');
        expect(cmd).toContain('with_entries(select(.value != ""))');
    });

    it('R2 — cover/inline-images and targets/max-revisions bind their same-named vars, defaulting off', () => {
        expect(cmd).toMatch(/`--targets <a,b>` binds `publish_targets`; `--cover` \/ `--inline-images` bind/);
        expect(cmd).toMatch(/`cover_enabled` \/ `inline_images` \(`false` unless passed\)/);
        expect(cmd).toMatch(/`--max-revisions` binds\s+`max_revisions` \(default `2`\)/);
    });
});
