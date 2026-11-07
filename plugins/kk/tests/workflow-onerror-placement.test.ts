import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * spur resolves an action's failure policy as `action.onError ?? workflow default ?? 'fail'`; an
 * `onError` nested under `options:` is passed through to the action untouched and never read. 0339
 * found two voice fallbacks dead this way, and eight more "warning-only" actions (session preflight,
 * voice audit, locale translation, kk-collect ledger sync / board capture) aborted runs they were
 * documented to tolerate. Pin the placement across every shipped workflow.
 */

const WORKFLOWS = join(import.meta.dir, '../workflows');

function misplaced(value: unknown, path: string, found: string[]): string[] {
    if (Array.isArray(value)) {
        for (const [i, item] of value.entries()) misplaced(item, `${path}[${i}]`, found);
    } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const options = record.options as Record<string, unknown> | undefined;
        if (typeof record.kind === 'string' && options && typeof options === 'object' && 'onError' in options) {
            found.push(`${path}.options.onError`);
        }
        for (const [key, child] of Object.entries(record)) misplaced(child, `${path}.${key}`, found);
    }
    return found;
}

test('no shipped workflow action hides onError under options, where the engine ignores it', () => {
    const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((name) =>
        misplaced(Bun.YAML.parse(readFileSync(join(WORKFLOWS, name), 'utf-8')), name, []),
    );
    expect(found).toEqual([]);
});
