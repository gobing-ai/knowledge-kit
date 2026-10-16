import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const ITC_DAG = join(REPO, 'plugins/kk/workflows/kk-itc.yaml');
const ITC_AUTHOR = join(REPO, 'plugins/kk/workflows/kk-itc-author.yaml');

describe('kk-itc DAG workflow (0302 / G21 R6)', () => {
    it('is a valid kind: dag workflow with version 2', () => {
        const raw = readFileSync(ITC_DAG, 'utf-8');
        const parsed = Bun.YAML.parse(raw) as {
            name: string;
            kind: string;
            version: string;
            nodes: Array<{ id: string; dependsOn?: string[] }>;
        };

        expect(parsed.name).toBe('kk-itc');
        expect(parsed.kind).toBe('dag');
        expect(parsed.version).toBe('2');
        expect(Array.isArray(parsed.nodes)).toBe(true);

        const nodeIds = parsed.nodes.map((n) => n.id);
        expect(nodeIds).toContain('prepare');
        expect(nodeIds).toContain('child-author');
        expect(nodeIds).toContain('verify-child-freeze');
        expect(nodeIds).toContain('materialize-plan');
        expect(nodeIds).toContain('adapt');
        expect(nodeIds).toContain('check-targets');
        expect(nodeIds).toContain('send-confirm');
        expect(nodeIds).toContain('fanout-send');
        expect(nodeIds).toContain('fanout-recovery');
        expect(nodeIds).toContain('reconcile-settle');
        expect(nodeIds).toContain('seo');
        expect(nodeIds).toContain('report');

        // Topological ordering check: every node's dependsOn must precede it in declaration order
        const seen = new Set<string>();
        for (const node of parsed.nodes) {
            for (const dep of node.dependsOn ?? []) {
                expect(seen.has(dep), `node '${node.id}' depends on '${dep}' declared after it`).toBe(true);
            }
            seen.add(node.id);
        }

        // report depends on verify-child-freeze so all-skipped publication branches still produce report
        const reportNode = parsed.nodes.find((n) => n.id === 'report');
        expect(reportNode?.dependsOn).toContain('verify-child-freeze');
    });

    it('validates kk-itc-author child workflow exists and is state-machine with version 2', () => {
        expect(existsSync(ITC_AUTHOR)).toBe(true);
        const raw = readFileSync(ITC_AUTHOR, 'utf-8');
        const parsed = Bun.YAML.parse(raw) as {
            name: string;
            kind: string;
            version: string;
            initialState: string;
            terminalStates: string[];
            states: Array<{ id: string }>;
        };

        expect(parsed.name).toBe('kk-itc-author');
        expect(parsed.kind).toBe('state-machine');
        expect(parsed.version).toBe('2');
        expect(parsed.initialState).toBe('author-init');
        expect(parsed.terminalStates).toContain('done');
        expect(parsed.terminalStates).toContain('failed');

        const stateIds = parsed.states.map((s) => s.id);
        expect(stateIds).toContain('outline-write');
        expect(stateIds).toContain('outline-select');
        expect(stateIds).toContain('outline-commit');
        expect(stateIds).toContain('draft-write');
        expect(stateIds).toContain('unslop');
        expect(stateIds).toContain('draft-review');
        expect(stateIds).toContain('draft-revise');
        expect(stateIds).toContain('draft-autorevise');
        expect(stateIds).toContain('judge');
        expect(stateIds).toContain('author-finish');
    });

    it('passes spur workflow validate for both kk-itc DAG and kk-itc-author FSM', () => {
        const resDag = Bun.spawnSync(['spur', 'workflow', 'validate', ITC_DAG], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(resDag.exitCode).toBe(0);

        const resAuthor = Bun.spawnSync(['spur', 'workflow', 'validate', ITC_AUTHOR], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(resAuthor.exitCode).toBe(0);
    });
});
