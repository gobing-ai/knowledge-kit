/**
 * kk plugin runtime-requires guard (task 0342, feature F81 R1/R2/R3).
 *
 * Every kk entity (skill, command) declares a `requires:` frontmatter list in the
 * superskill 0162 grammar. The test derives the expected set from each entity body
 * (direct CLI invocations + the transitive closure over `Skill(skill="kk:<id>")`
 * dispatches) and compares it to the annotation, so an undeclared CLI use or an
 * inherited-but-missing token fails instead of rotting:
 *
 *   AC1 — every declared list equals the derived closure, sorted and de-duplicated.
 *   AC2 — checkRequires is pure: mutated in-memory fixtures (direct + inherited)
 *         fail with the entity name and the missing/extra tokens.
 *   AC3 — the group snapshot matches the frozen table (8/5/1/5; 2026-11-08 adds news-editorial) and no
 *         entity declares hooks or subagents.
 *
 * Plugin standalone contract: only bun:* and node:* builtins plus relative imports.
 * Rules mirror spur task 1291 (plugins/sp/tests/runtime-requires.test.ts).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN_ROOT = join(import.meta.dir, '..');

const TRACKED_CLIS = ['kk', 'spur', 'superskill', 'gh'] as const;

/** Direct tracked-CLI use: `<name> [a-z]` at a word boundary (superskill 0162). */
const CLI_INVOCATION_RE = /(^|[^a-z0-9_/.-])(kk|spur|superskill|gh) [a-z]/g;

const SKILL_DISPATCH_RE = /Skill\(skill="kk:([a-z0-9-]+)"/g;
const REQUIRES_TOKEN_RE = /^(hooks|subagents|local-fs|cli:[a-z0-9][a-z0-9._-]*)$/;

interface Entity {
    /** Relative to the plugin root, e.g. `skills/topic/SKILL.md`. */
    path: string;
    /** Frontmatter of the entity file. */
    frontmatter: string;
    /** Body after the frontmatter block. */
    body: string;
}

function parseEntity(filePath: string, raw: string): Entity {
    const lines = raw.split('\n');
    let end = -1;
    if (lines[0]?.trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i]?.trim() === '---') {
                end = i;
                break;
            }
        }
    }
    const rel = filePath.slice(PLUGIN_ROOT.length + 1);
    return {
        path: rel,
        frontmatter: end === -1 ? '' : lines.slice(0, end + 1).join('\n'),
        body: end === -1 || end + 1 > lines.length ? '' : lines.slice(end + 1).join('\n'),
    };
}

function listEntities(): Entity[] {
    const entities: Entity[] = [];
    const commands = readdirSync(join(PLUGIN_ROOT, 'commands')).filter((f) => f.endsWith('.md'));
    for (const f of commands) {
        entities.push(
            parseEntity(join(PLUGIN_ROOT, 'commands', f), readFileSync(join(PLUGIN_ROOT, 'commands', f), 'utf8')),
        );
    }
    // kk ships no agents dir and no hooks (plugins/kk/hooks holds only a README).
    for (const d of readdirSync(join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })) {
        const p = join(PLUGIN_ROOT, 'skills', d.name, 'SKILL.md');
        if (d.isDirectory() && existsSync(p)) {
            entities.push(parseEntity(p, readFileSync(p, 'utf8')));
        }
    }
    return entities;
}

const entities: Entity[] = listEntities();
const byPath: Map<string, Entity> = new Map(entities.map((e) => [e.path, e]));

/** Parse `requires:` from the entity frontmatter via Bun.YAML (AC1). */
function declaredRequires(entity: Entity): string[] {
    let parsed = Bun.YAML.parse(entity.frontmatter) as unknown;
    if (Array.isArray(parsed)) parsed = parsed[0]; // YAML multi-document: Bun.YAML returns one entry per document
    const v = (parsed as Record<string, unknown> | null | undefined)?.requires;
    if (!Array.isArray(v)) return [];
    return v.map((t) => String(t));
}

/**
 * deriveRequires: direct tracked-CLI invocations ∪ closure over dispatched kk
 * skills ∪ local-fs. Memoized + cycle-safe.
 */
function deriveRequires(
    target: string,
    scope: Map<string, Entity> = byPath,
    options: { memo?: Map<string, Set<string>>; inProgress?: Set<string> } = {},
): Set<string> {
    const memo = options.memo ?? memoized;
    const inProgress = options.inProgress ?? new Set<string>();
    const cached = memo.get(target);
    if (cached) return cached;
    if (inProgress.has(target)) return new Set();
    inProgress.add(target);
    const out = new Set<string>(['local-fs']);
    const entity = scope.get(target);
    if (entity) {
        for (const match of entity.body.matchAll(CLI_INVOCATION_RE)) out.add(`cli:${match[2]}`);
        for (const match of entity.body.matchAll(SKILL_DISPATCH_RE)) {
            const depPath = `skills/${match[1]}/SKILL.md`;
            if (scope.has(depPath)) {
                for (const token of deriveRequires(depPath, scope, { memo, inProgress })) out.add(token);
            }
        }
    }
    inProgress.delete(target);
    memo.set(target, out);
    return out;
}

const memoized: Map<string, Set<string>> = new Map();

/** checkRequires: violation messages naming the entity and the missing/extra tokens. */
function checkRequires(list: Entity[]): string[] {
    const violations: string[] = [];
    // Fresh closure scope + memo per call: fixture entities may shadow/shed real paths.
    const scope: Map<string, Entity> = new Map(list.map((entity) => [entity.path, entity]));
    const memo: Map<string, Set<string>> = new Map();
    for (const entity of list) {
        const declared = declaredRequires(entity);
        const derived = deriveRequires(entity.path, scope, { memo });
        let sorted = true;
        for (let i = 1; i < declared.length; i++) {
            const prev = declared[i - 1];
            const current = declared[i];
            if (prev !== undefined && current !== undefined && prev > current) {
                sorted = false;
                break;
            }
        }
        if (!sorted) violations.push(`${entity.path}: unsorted`);
        for (const token of declared) {
            if (!REQUIRES_TOKEN_RE.test(token)) violations.push(`${entity.path}: invalid ${token}`);
        }
        const seen = new Set<string>();
        for (const token of declared) {
            if (seen.has(token)) {
                violations.push(`${entity.path}: extra ${token}`); // duplicate occurrence
                continue;
            }
            seen.add(token);
            if (token !== 'local-fs' && !derived.has(token)) {
                violations.push(`${entity.path}: extra ${token}`); // stale: not derived
            }
        }
        for (const token of derived) {
            if (!declared.includes(token)) violations.push(`${entity.path}: missing ${token}`);
        }
    }
    return violations;
}

describe('runtime-requires (task 0342 / feature F81 R1, R2, R3)', () => {
    test('19 kk entities are collected (15 skills, 4 commands)', () => {
        expect(entities.length).toBe(19);
        expect(byPath.size).toBe(19);
    });

    test('AC1: every entity declares a valid, sorted, de-duplicated requires list equal to the derived closure', () => {
        expect(checkRequires(entities)).toEqual([]);
        // The regex alternation stays in sync with the frozen tracked-CLI inventory.
        for (const name of TRACKED_CLIS) {
            expect(CLI_INVOCATION_RE.source.includes(name)).toBe(true);
        }
    });

    test('AC3: the group snapshot matches the 2026-11-08 frozen table (8/5/1/5)', () => {
        const groups: Record<string, number> = {};
        for (const entity of entities) {
            const key = [...deriveRequires(entity.path)].sort().join(',');
            groups[key] = (groups[key] ?? 0) + 1;
        }
        expect(groups).toEqual({
            'cli:kk,cli:spur,local-fs': 8,
            'cli:kk,local-fs': 5,
            'cli:spur,local-fs': 1,
            'local-fs': 5,
        });
        // No kk entity may claim hooks or subagents (kk ships none).
        for (const entity of entities) {
            for (const token of declaredRequires(entity)) {
                expect(token === 'hooks' || token === 'subagents').toBe(false);
            }
        }
    });

    test('AC2: undeclared use fails the pure check with a named diff — direct spur use and inherited use through a dispatch', () => {
        // Fixture base: a real [local-fs]-only skill, copied into memory.
        const localOnly = entities.find((entity) => {
            const derived = deriveRequires(entity.path);
            return derived.size === 1 && derived.has('local-fs') && entity.path.startsWith('skills/');
        });
        expect(localOnly).toBeDefined();
        const fixtureBase = localOnly as Entity;
        const skillPath = 'skills/ac2-fixture-skill/SKILL.md';
        const fixtureSkillId = fixtureBase.path.split('/')[1];
        const skill: Entity = {
            path: skillPath,
            frontmatter: fixtureBase.frontmatter,
            body: `${fixtureBase.body}\nspur workflow run task-pipeline.yaml --vars '{"wbs":"0000"}'\n`,
        };
        const command: Entity = {
            path: 'commands/ac2-fixture-command.md',
            frontmatter: '---\ndescription: fixture\nrequires: [local-fs]\n---',
            body: 'Skill(skill="kk:ac2-fixture-skill")',
        };

        const violations = checkRequires([skill, command]);
        expect(violations.some((v) => v === `${skillPath}: missing cli:spur`)).toBe(true);
        expect(violations.some((v) => v === `${command.path}: missing cli:spur`)).toBe(true);

        // The unmutated copies pass: the real skill's annotation matches its real body,
        // and the command inheriting through a real dispatch carries only [local-fs].
        const violationsClean = checkRequires([
            fixtureBase,
            { ...command, body: `Skill(skill="kk:${fixtureSkillId}")`, path: 'commands/ac2-clean-command.md' },
        ]);
        expect(violationsClean.includes(`${skillPath}: missing cli:spur`)).toBe(false);
        expect(violationsClean.includes('commands/ac2-clean-command.md: missing cli:spur')).toBe(false);
    });
});
