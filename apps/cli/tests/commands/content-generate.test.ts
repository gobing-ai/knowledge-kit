import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import {
    GENERATE_ROWS,
    itemCount,
    NEWS_STAGE_DEFAULTS,
    poolGatePath,
    resolveNewsSettings,
} from '../../src/commands/content-generate';

describe('content generate command module', () => {
    it('registers the seven step verbs on both nouns, news-only verbs included', () => {
        // The noun list is asserted in content.test.ts; here the module's own rows must be complete.
        expect(GENERATE_ROWS.map((row) => row.verb)).toEqual([
            'prepare',
            'generate-check',
            'generate-render',
            'generate-voice',
            'generate-cards',
            'generate-bundle',
            'report',
        ]);
        const program = new Command();
        const group = program.command('news');
        for (const row of GENERATE_ROWS) group.command(row.verb);
        expect(group.commands.length).toBe(GENERATE_ROWS.length);
    });

    it('carries every row as a stage table, not one function per verb', () => {
        for (const row of GENERATE_ROWS) {
            expect(Array.isArray(row.stages)).toBe(true);
            expect(row.stages.length).toBeGreaterThan(0);
            for (const stage of row.stages) {
                expect(typeof stage.name).toBe('string');
                expect(typeof stage.args === 'function').toBe(true);
            }
            expect(typeof row.summary === 'function').toBe(true);
        }
    });

    it('puts the pool gate inside the run directory (design §1.3, R3)', () => {
        expect(poolGatePath('/runs/20260101')).toBe('/runs/20260101/pool-gate.json');
    });

    it('counts a pool payload as Doc[], metadata.docs, or nothing', () => {
        expect(itemCount([{ id: 'a' }, { id: 'b' }])).toBe(2);
        expect(itemCount({ metadata: { docs: [{ id: 'a' }] } })).toBe(1);
        expect(itemCount({ metadata: { docs: [] } })).toBe(0);
        expect(itemCount(null)).toBe(0);
        expect(itemCount({ metadata: 'nope' })).toBe(0);
    });

    it('merges a declared workflows block over the defaults and rejects an unknown key', () => {
        const merged = resolveNewsSettings({ workflows: { 'kk-news-generate': { cards: 4 } } });
        expect(merged.cards).toBe(4);
        expect(merged.qc_min_quality).toBe(NEWS_STAGE_DEFAULTS.qc_min_quality);
        expect(() => resolveNewsSettings({ workflows: { 'kk-news-generate': { nope: 1 } } })).toThrow();
        expect(() => resolveNewsSettings({ workflows: { 'kk-news-generate': { cards: 0 } } })).toThrow();
    });
});
