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
        expect(cmd).toMatch(/workflows_dir:/);
        expect(cmd).toContain('maxResults: 8');
        expect(cmd).toContain('fixture: false');
        expect(cmd).toContain('never overwrite an existing');
    });

    it('R2 — workflow YAML install follows the two-root copy rule with --force', () => {
        expect(cmd).toContain('KK_WORKFLOWS_SOURCE');
        expect(cmd).toContain('plugins/kk/workflows');
        expect(cmd).not.toContain('.spur/workflows');
        expect(cmd).toContain('--force');
        expect(cmd).toContain('cmp -s');
        expect(cmd).toContain('searched KK_WORKFLOWS_SOURCE, plugins/kk/workflows');
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
        for (const v of ['writer', 'playbook', 'research', 'judge', 'outline', 'force', 'rubric', 'verdictFile']) {
            expect(cmd).toContain(`\\"${v}\\"`);
        }
    });

    it('R2 — command stays a thin wrapper (ADR-011: no new kk first-layer noun)', () => {
        expect(cmd).toContain('ADR-011');
        expect(cmd).toContain('No new `kk` CLI noun');
        expect(cmd).toContain('kk-storm-research');
    });

    it('kk-solo-podcast profile copies YAML+sidecar into workflows_dir and runs $dest', () => {
        expect(cmd).toContain('kk-solo-podcast');
        expect(cmd).toContain('validate-voicescript.ts');
        expect(cmd).toContain('target_duration_min');
        expect(cmd).toContain('script_approved');
        expect(cmd).toContain('$HOME/.config/kk/workflows');
        expect(cmd).toContain('never the design-time');
        expect(cmd).toContain('cp "$sdir/$side" "$ddir/$side"');
        expect(cmd).toContain('validate_script');
        expect(cmd).toContain('$workflows_dir/validate-voicescript.ts');
        expect(cmd).toContain('wrap-voicescript-doc.ts');
        expect(cmd).toContain('\\"wrap_script\\"');
        expect(cmd).toContain('spur workflow run "$dest"');
    });
});
