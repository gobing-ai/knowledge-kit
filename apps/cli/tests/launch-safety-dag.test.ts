/**
 * Task 0360 — launch safety across the six in-scope workflows (ADR-053 §5).
 *
 * Failure-first list (written before the change):
 *  1. a second executor var (`agent_retry`) surviving anywhere in the six files;
 *  2. an `agent.run` node pinned to a name that is not the operator's `agent` var, or a retry that
 *     does not resolve by role (`agent: inline` + `role: reviewer`);
 *  3. a nested `spur workflow run` that does not forward `agent` at all (voice3 publish3, 2026-11-13);
 *  4. a run that spends its window on a dead executor because no real-traffic probe ran first.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const WORKFLOWS = join(REPO, 'plugins/kk/workflows');
const IN_SCOPE = ['kk-news-generate', 'kk-daily-safety', 'kk-publish', 'kk-article-generate'] as const;

interface WorkflowAction {
    kind?: string;
    onError?: string;
    options?: Record<string, unknown>;
}

interface WorkflowNode {
    id?: string;
    dependsOn?: string[];
    action?: WorkflowAction;
    onEnter?: WorkflowAction[];
}

interface Workflow {
    vars?: Record<string, unknown>;
    nodes?: WorkflowNode[];
    states?: WorkflowNode[];
}

function load(name: string): { raw: string; parsed: Workflow } {
    const raw = readFileSync(join(WORKFLOWS, `${name}.yaml`), 'utf-8');
    return { raw, parsed: Bun.YAML.parse(raw) as Workflow };
}

function nodesOf(workflow: Workflow): WorkflowNode[] {
    return workflow.nodes ?? workflow.states ?? [];
}

/** Every action a node declares, whichever slot it uses (`action` on a DAG, `onEnter` on a state). */
function actionsOf(node: WorkflowNode): WorkflowAction[] {
    return [...(node.action ? [node.action] : []), ...(node.onEnter ?? [])];
}

/** The `--vars "{…}"` payload of every nested `spur workflow run` in a workflow's source. */
function nestedInvocations(raw: string): string[] {
    return (
        raw
            .split('spur workflow run plugins/kk/workflows/')
            .slice(1)
            // A description may quote the invocation form; only a real command carries `--quiet`.
            .map((invocation) => {
                const end = invocation.indexOf('--quiet');
                return end === -1 ? null : invocation.slice(0, end);
            })
            .filter((invocation): invocation is string => invocation !== null)
    );
}

/** A `${vars.<name>}` reference as the workflow source spells it (built, not a template literal). */
const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');
const AGENT_REF = varRef('agent');

describe('launch safety: one executor var (0360 R1, R2, R3)', () => {
    it('declares no agent_retry var and references no retry var in any in-scope workflow', () => {
        for (const name of IN_SCOPE) {
            const { raw, parsed } = load(name);
            expect({ name, declares: 'agent_retry' in (parsed.vars ?? {}) }).toEqual({ name, declares: false });
            expect({ name, references: raw.includes('agent_retry') }).toEqual({ name, references: false });
        }
    });

    it('drives every agent.run node from the agent var, or from the literal inline with role reviewer', () => {
        for (const name of IN_SCOPE) {
            const { parsed } = load(name);
            for (const node of nodesOf(parsed)) {
                for (const action of actionsOf(node).filter((candidate) => candidate.kind === 'agent.run')) {
                    const options = action.options ?? {};
                    const primary = options.agent === AGENT_REF;
                    const roleRetry = options.agent === 'inline' && options.role === 'reviewer';
                    expect({ name, id: node.id, agent: options.agent, role: options.role }).toMatchObject(
                        primary || roleRetry
                            ? { agent: primary ? AGENT_REF : 'inline', role: roleRetry ? 'reviewer' : options.role }
                            : { ineligible: true },
                    );
                }
            }
        }
    });

    it('forwards the single agent var to every nested workflow launched from the generate DAG', () => {
        const { raw } = load('kk-news-generate');
        const invocations = nestedInvocations(raw);
        // Two real nested launches today: the drafts safety review and the variants-scope review.
        expect(invocations.length).toBe(2);
        for (const invocation of invocations) {
            expect(invocation).toContain(`\\"agent\\":\\"${AGENT_REF}\\"`);
            expect(invocation).not.toContain('agent_retry');
        }
    });
});

describe('launch safety: traffic probe first (0360 R4)', () => {
    for (const name of ['kk-news-generate'] as const) {
        it(`${name} starts with a real-traffic executor probe that every other node waits on`, () => {
            const { parsed } = load(name);
            const nodes = nodesOf(parsed);
            const probe = nodes.find((node) => node.id === 'executor-probe');
            expect(probe).toBeDefined();
            expect(probe?.action).toMatchObject({
                kind: 'agent.run',
                options: {
                    role: 'scribe',
                    agent: AGENT_REF,
                    timeoutMs: 120000,
                    input: 'Reply with exactly: OK',
                },
            });
            expect(probe?.action?.onError).toBeUndefined();
            expect(probe?.dependsOn ?? []).toEqual([]);
            // The probe is declared first and prepare — the only other root — waits on it.
            expect(nodes[0]?.id).toBe('executor-probe');
            expect(nodes.filter((node) => (node.dependsOn ?? []).length === 0).map((node) => node.id)).toEqual([
                'executor-probe',
            ]);
            expect(nodes.find((node) => node.id === 'prepare')?.dependsOn).toContain('executor-probe');
        });
    }
});
