import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Feature G ("kk workflows") is a collection parent whose two @core scenarios are rules about the
 * feature tree itself (task 0221). This file makes them executable so the tree cannot drift from
 * them silently. Both rules are DERIVED from the files — no hard-coded child→workflow map.
 *
 * ## Failure-first list — what this must catch
 *
 * 1. A new product workflow YAML lands with no direct G child homing it.
 * 2. Two direct children home the same workflow (name match on one, Goal mention on another).
 * 3. A nested sub-workflow's runner disappears, so the nested file has no home.
 * 4. A G child's Goal stops naming a versioned successor it homes (voice2 under G1).
 * 5. A `kk` command family becomes shared between workflows and no child's Scope claims it.
 * 6. A shared family is claimed by two children.
 * 7. A shared family is claimed by a workflow child whose workflow never invokes it (not the owner).
 * 8. Parsing silently finds nothing and the loops pass vacuously.
 */
const REPO = join(import.meta.dir, '../../..');
const WORKFLOWS = join(REPO, 'plugins/kk/workflows');
const FEATURES = join(REPO, 'docs/features');

/**
 * Shared by several workflows but not G's workflow infrastructure: `executor` runs plugin instances
 * (C/D/E), `package` is the generic packager, and `stage` is a namespace whose stages each belong to
 * one workflow. G's Scope puts engine/runtime and plugin work Out.
 */
const NON_INFRA_FAMILIES = new Set(['executor', 'package', 'stage']);

interface Child {
    id: string;
    name: string;
    goal: string;
    scopeIn: string;
}

function section(text: string, heading: string): string {
    const start = text.indexOf(`\n## ${heading}\n`);
    if (start === -1) return '';
    const end = text.indexOf('\n## ', start + 1);
    return end === -1 ? text.slice(start) : text.slice(start, end);
}

const children: Child[] = readdirSync(FEATURES)
    .filter((file) => /^G\d_/.test(file))
    .map((file) => {
        const text = readFileSync(join(FEATURES, file), 'utf8');
        return {
            id: file.split('_')[0] as string,
            name: text.match(/^name:\s*"?([^"\n]+)"?/m)?.[1]?.trim() ?? '',
            goal: section(text, 'Goal'),
            scopeIn: section(text, 'Scope').match(/^- In:.*$/m)?.[0] ?? '',
        };
    });

const workflows = new Map(
    readdirSync(WORKFLOWS)
        .filter((file) => file.endsWith('.yaml') && !file.endsWith('-example.yaml'))
        .map((file) => [file.replace(/\.yaml$/, ''), readFileSync(join(WORKFLOWS, file), 'utf8')]),
);

/** The workflow that runs `stem` as a nested sub-workflow, if any. */
function runnerOf(stem: string): string | undefined {
    return [...workflows].find(
        ([other, text]) => other !== stem && text.includes(`plugins/kk/workflows/${stem}.yaml`),
    )?.[0];
}

function homes(stem: string): Set<string> {
    const runner = runnerOf(stem);
    if (runner) return homes(runner);
    return new Set(
        children
            .filter((c) => c.name === stem || c.goal.includes(`\`${stem}.yaml\``) || c.goal.includes(`/${stem}.yaml`))
            .map((c) => c.id),
    );
}

function families(text: string): Set<string> {
    return new Set([...text.matchAll(/(?:^|[\s"'(;|&])kk ([a-z][a-z-]+)/gm)].map((m) => m[1] as string));
}

describe('feature G — the kk workflow tree', () => {
    it('R1 — every product workflow has exactly one home child', () => {
        expect(children.length).toBeGreaterThan(0);
        expect(workflows.size).toBeGreaterThan(0);
        for (const stem of workflows.keys()) {
            expect({ stem, homes: [...homes(stem)] }).toEqual({ stem, homes: [expect.any(String)] });
        }
    });

    it('R2 — each shared workflow capability is claimed by exactly one child, its own or its owner', () => {
        const usedBy = new Map<string, string[]>();
        for (const [stem, text] of workflows) {
            for (const family of families(text)) usedBy.set(family, [...(usedBy.get(family) ?? []), stem]);
        }
        const shared = [...usedBy].filter(([family, users]) => users.length > 1 && !NON_INFRA_FAMILIES.has(family));
        expect(shared.length).toBeGreaterThan(0);
        for (const [family, users] of shared) {
            const claimers = children.filter((c) => new RegExp(`\\b${family}\\b`).test(c.scopeIn));
            expect({ family, claimers: claimers.map((c) => c.id) }).toEqual({ family, claimers: [expect.any(String)] });
            const claimer = claimers[0] as Child;
            const ownedByWorkflow = workflows.has(claimer.name);
            if (ownedByWorkflow)
                expect({ family, owner: claimer.name, invokes: users.includes(claimer.name) }).toEqual({
                    family,
                    owner: claimer.name,
                    invokes: true,
                });
        }
    });
});
