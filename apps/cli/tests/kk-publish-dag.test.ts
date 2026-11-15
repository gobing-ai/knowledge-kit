/**
 * Task 0366 R1–R3, R6 — the `kk-publish` DAG as a file contract.
 *
 * The design freeze (`docs/design/content-pipeline-consolidation.md` §5.3) names nine nodes and the
 * fate of publish3's eighteen; this suite asserts the YAML matches that map without executing it —
 * `kk-publish.e2e.test.ts` runs the graph, this file fails fast when a node is renamed, reordered,
 * re-wired or given a shell body the design forbids (R2: one `kk <noun> publish-<step>` call per
 * non-agent, non-pause node).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-publish.yaml');

interface NodeAction {
    kind: string;
    onError?: string;
    options?: Record<string, unknown>;
}

interface Node {
    id: string;
    description?: string;
    dependsOn?: string[];
    pause?: boolean;
    condition?: { kind: string; options?: Record<string, unknown> };
    action?: NodeAction;
}

interface Doc {
    name: string;
    kind: string;
    vars: Record<string, string>;
    nodes: Node[];
}

const doc = Bun.YAML.parse(readFileSync(WORKFLOW, 'utf-8')) as Doc;
const byId = new Map(doc.nodes.map((node) => [node.id, node]));
const command = (node: Node): string => String(node.action?.options?.command ?? '');
const condition = (node: Node): string => String(node.condition?.options?.command ?? '');

/** Shell nodes: everything but the pause and the agent call. */
const shellNodes = (): Node[] => doc.nodes.filter((node) => node.pause !== true && node.action?.kind === 'shell');

describe('kk-publish — the nine nodes of design §5.3 (0366 R1, R6)', () => {
    it('declares exactly the nine designed node ids, in topological order', () => {
        expect(doc.name).toBe('kk-publish');
        expect(doc.kind).toBe('dag');
        // Order is the design's own numbering; the engine executes in dependency order, but the file
        // stays readable as the §5.3 table.
        expect(doc.nodes.map((node) => node.id)).toEqual([
            'plan',
            'check',
            'send-confirm',
            'send',
            'send-retry',
            'diagnose',
            'repair',
            'settle',
            'report',
        ]);
    });

    it('keeps every dependency forward-only (a DAG, and a readable one)', () => {
        const order = doc.nodes.map((node) => node.id);
        for (const node of doc.nodes) {
            for (const dep of node.dependsOn ?? []) {
                expect(order).toContain(dep);
                expect(order.indexOf(dep)).toBeLessThan(order.indexOf(node.id));
            }
        }
        // `plan` is the single entry point: no other node may start a window's work.
        expect(byId.get('plan')?.dependsOn ?? []).toEqual([]);
        for (const node of doc.nodes.filter((entry) => entry.id !== 'plan')) {
            expect((node.dependsOn ?? []).length).toBeGreaterThan(0);
        }
    });

    it('declares the designed vars and no default the engine would reject as empty', () => {
        expect(Object.keys(doc.vars).sort()).toEqual([
            'agent',
            'channels',
            'dummy',
            'feed',
            'live_channels',
            'live_confirm',
            'noun',
            'preset',
            'retry',
            'run_date',
            'window',
            'work_dir',
        ]);
        // A var the node commands need as a WORD always has a non-empty default; only the vars that
        // spell an optional flag may be empty (an empty value adds no word / is read as absent).
        for (const key of ['agent', 'noun', 'preset', 'window']) {
            expect(doc.vars[key]).not.toBe('');
        }
        expect(doc.vars.agent).toBe('inline');
        expect(doc.vars.noun).toBe('news');
        expect(doc.vars.window).toBe('after-generate');
        expect(doc.vars.live_confirm).toBe('false');
        expect(doc.vars.retry).toBe('false');
    });

    it('spells the noun through the node commands, so one file serves both content nouns', () => {
        for (const node of shellNodes()) {
            expect(command(node).startsWith(`kk \${vars.noun} publish-`)).toBe(true);
        }
        // R2: no jq, printf, stage call or multi-command shell anywhere in an action.
        for (const node of shellNodes()) {
            const text = command(node);
            expect(text).not.toMatch(/kk stage run|jq |printf /);
            expect(text).not.toContain(';');
            expect(text).not.toContain('&&');
            // One call, so exactly one `kk` word.
            expect(text.match(/\bkk /g) ?? []).toHaveLength(1);
        }
        // The two step verbs that take a fixed window name it literally (design §5.3 node 7).
        expect(command(byId.get('repair') as Node)).toContain('--window after-generate --retry --tier 0');
    });

    it('gives every shell node its --work-dir and --window, and keeps every command on one verb', () => {
        const steps: Record<string, string> = {
            plan: 'publish-plan',
            check: 'publish-check',
            send: 'publish-send',
            'send-retry': 'publish-send',
            repair: 'publish-send',
            settle: 'publish-settle',
            report: 'publish-report',
        };
        for (const [id, step] of Object.entries(steps)) {
            const node = byId.get(id) as Node;
            expect(command(node)).toContain(`publish-${step.replace('publish-', '')}`);
            expect(command(node)).toContain(`--work-dir "\${vars.work_dir}"`);
            expect(command(node)).toContain('--window');
        }
    });
});

describe('kk-publish — conditions and error policy (0366 R3)', () => {
    it('pauses for a live send only on consent plus a live row', () => {
        const confirm = byId.get('send-confirm') as Node;
        expect(confirm.pause).toBe(true);
        expect(confirm.action).toBeUndefined();
        expect(condition(confirm)).toContain(`"\${vars.live_confirm}" = "true"`);
        expect(condition(confirm)).toContain(`plan.\${vars.window}.json`);
        expect(condition(confirm)).toContain('"mode": "live"');
    });

    it('continues on a failed send, retries once, and only when a failure is left', () => {
        expect(byId.get('send')?.action?.onError).toBe('continue');
        const retry = byId.get('send-retry') as Node;
        expect(retry.dependsOn).toEqual(['send']);
        expect(condition(retry)).toContain('"status": "failed"');
        expect(condition(retry)).toContain(`\${vars.retry}" = "true"`);
        expect(command(retry)).toContain('--retry');
    });

    it('keeps the gated-miss path reachable: plan continues, diagnose hangs off plan', () => {
        // A hard-failing `plan` would skip every successor by the all-deps-skipped rule and take the
        // incident path with it (publish3's own comment, §5.3 node 1).
        expect(byId.get('plan')?.action?.onError).toBe('continue');
        expect(byId.get('diagnose')?.dependsOn).toEqual(['plan']);
        const diagnose = byId.get('diagnose') as Node;
        expect(diagnose.action?.kind).toBe('agent.run');
        expect(diagnose.action?.onError).toBe('continue');
        expect(diagnose.action?.options?.role).toBe('scribe');
        expect(diagnose.action?.options?.agent).toBe(`\${vars.agent}`);
        expect(String(diagnose.action?.options?.expectFile)).toContain('4-publish/incident.json');
        expect(condition(diagnose)).toContain('"overseas-rss"');
        expect(condition(diagnose)).toContain('"hit": false');
        // repair is reachable only through diagnose — "condition: 6 ran".
        expect(byId.get('repair')?.dependsOn).toEqual(['diagnose']);
    });

    it('fails the run at settle and still writes the report on every path that reached a window', () => {
        const settle = byId.get('settle') as Node;
        // settle continues so `report` always runs (design §5.3 R3, the ported publish3 order:
        // outcome-assert sat AFTER report and ledger); `report`'s verb owns the honest exit — it
        // re-reads outcome.<window>.json and exits 1 when a required non-dummy row did not succeed.
        expect(settle.action?.onError).toBe('continue');
        expect(settle.action?.kind).toBe('shell');
        expect(command(settle)).toContain('publish-settle');
        // settle runs on both real paths (a clean window has no send-retry, a gated day has repair).
        expect(new Set(settle.dependsOn)).toEqual(new Set(['send', 'repair']));
        // report is ordered after settle and also reachable on a gated miss.
        expect(byId.get('report')?.dependsOn).toEqual(['settle', 'diagnose']);
        expect(byId.get('report')?.condition).toBeUndefined();
    });

    it('skips the plan/send chain and the settlement on a gated miss', () => {
        expect(condition(byId.get('check') as Node)).toContain('"hit": false');
        expect(condition(byId.get('settle') as Node)).toContain('"hit": false');
        // `send` keeps both ancestors so a draft window (send-confirm skipped) still sends.
        expect(new Set(byId.get('send')?.dependsOn)).toEqual(new Set(['check', 'send-confirm']));
    });

    it('never names a channel matrix inside the workflow (the preset owns it)', () => {
        const text = readFileSync(WORKFLOW, 'utf-8');
        for (const plugin of ['surfdash-pub', 'podcast-pub', 'wechatmp-pub', 'xhs-pub', 'weibo-pub', 'threads-pub']) {
            expect(text).not.toContain(plugin);
        }
        expect(text).not.toContain('mode: live');
    });
});
