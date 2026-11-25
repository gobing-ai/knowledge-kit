/**
 * Task 0438 — calibrate the CN-lead gate against a committed two-family fixture.
 *
 * Six review visits on 0433 each widened the vocabulary against fresh anecdotes, and each next visit
 * found the unpinned half. The fixture `fixtures/cn-lead-calibration.json` turns the next change into
 * a measurement: `class` (30 XY-02/WX-01-class leads), `product` (86 ordinary product/market leads),
 * `acceptedMisses` (3 recorded tradeoffs, not counted against R1). Rows are never edited after seeing
 * gate output; add rows, and record a removal in the task Q&A.
 *
 * Failures enumerated before the fix (baseline against the unchanged 0433 gate in the task's Testing):
 *  1. AC1: fewer than 28/30 class leads trip — domestic administrative instruments (条例/细则/备案/
 *     征求意见/指引), bare 管制 and 供应 carry no signal, and a ministry actor fails to cancel the
 *     product-policy carve-out;
 *  2. AC2: more than 3/86 product leads trip — 许可/审查/调查/限制 have no product-side escape, a
 *     company 部门 cancels the carve-out, `新规` matches across 更新+规范, `ai` matches `Airbnb`;
 *  3. AC5: an added term or actor that no row depends on can be deleted with the suite still green;
 *  4. AC4: a `--final` pool whose candidates trip only the two-signal detector refuses the whole day
 *     (`blocked`), so three product false positives cost more than the incident the gate prevents.
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { enforceCnLead, scanCnLead } from '../scripts/cn-lead-gate.ts';

interface Row {
    lead: string;
    note: string;
    source: '0433-v5' | '0438';
    pins?: string;
}

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, 'fixtures/cn-lead-calibration.json'), 'utf-8')) as {
    class: Row[];
    product: Row[];
    acceptedMisses: Row[];
};

/** The re-measurement: every row with the terms it tripped on, so a failure names its mechanism. */
function measure(rows: Row[]): { lead: string; terms: string[] }[] {
    return rows.map((row) => ({ lead: row.lead, terms: scanCnLead(row.lead, '').terms }));
}

describe('cn-lead calibration fixture (0438 R5)', () => {
    it('has the frozen family sizes', () => {
        expect(fixture.class.length).toBe(30);
        expect(fixture.product.length).toBe(86);
        expect(fixture.acceptedMisses.length).toBe(3);
    });

    it('AC1 — at least 28 of 30 class leads trip (R1)', () => {
        const missed = measure(fixture.class).filter((row) => row.terms.length === 0);
        expect(missed.length <= 2 ? [] : missed).toEqual([]);
    });

    it('AC2 — at most 3 of 86 product leads trip, each named with its terms (R2)', () => {
        const tripped = measure(fixture.product).filter((row) => row.terms.length > 0);
        expect(tripped.length <= 3 ? [] : tripped).toEqual([]);
    });

    it('the accepted misses stay recorded tradeoffs (not counted against R1)', () => {
        expect(measure(fixture.acceptedMisses).filter((row) => row.terms.length > 0)).toEqual([]);
    });

    it.each(fixture.class.filter((row) => row.pins !== undefined))(
        'AC5 — $lead depends on its pinned term "$pins"',
        (row) => {
            const parts = scanCnLead(row.lead, '').terms.flatMap((term) => term.split('+'));
            expect(parts).toContain(row.pins as string);
        },
    );
});

/** Product-shaped leads that still trip the two-signal detector (no enumerated vocabulary term). */
const TWO_SIGNAL_ONLY = [
    'Kimi 新模型完成生成式人工智能服务备案，正式向公众开放',
    '英伟达放宽 GPU 保修政策',
    '某大模型厂商收紧免费额度',
];
/** Every candidate carries an enumerated vocabulary hit: the honest dead end. */
const VOCABULARY_EVERYWHERE = ['美方对华出口管制再收紧', '英伟达董事会新设国家安全委员会', '美国对华加征芯片关税'];

function doc(id: string, title: string): Record<string, unknown> {
    return { id, title, body: '正文', metadata: { brief: '' } };
}

/** The real `daily-curate-check --final` runner over a temp work dir (pattern of the 0433 suite). */
function runFinal(titles: string[]): { status: number; stderr: string; plan: string[]; refused: boolean } {
    const root = mkdtempSync(join(tmpdir(), 'kk-cn-lead-0438-'));
    const runDate = '20261125';
    const dir = join(root, 'kk-news-generate-20261125-1', '21-plan');
    mkdirSync(dir, { recursive: true });
    const docs = titles.map((title, index) => doc(String.fromCharCode(97 + index), title));
    writeFileSync(
        join(dir, `${runDate}_04_quality-control-content_candidates.json`),
        JSON.stringify({ metadata: { docs } }),
    );
    writeFileSync(join(dir, `${runDate}_03_plan_plan.json`), JSON.stringify(docs));
    writeFileSync(join(dir, `${runDate}_03_curate_excluded.json`), '[]');
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');
    const result = spawnSync('bun', [runner, 'daily-curate-check', join(dir, '..'), runDate, '--final'], {
        encoding: 'utf-8',
    });
    const plan = (JSON.parse(readFileSync(join(dir, `${runDate}_03_plan_plan.json`), 'utf-8')) as { id: string }[]).map(
        (entry) => entry.id,
    );
    let refused = true;
    try {
        readFileSync(join(dir, `${runDate}_03_cn-lead-refusal.json`));
    } catch {
        refused = false;
    }
    rmSync(root, { recursive: true, force: true });
    return { status: result.status ?? 1, stderr: result.stderr ?? '', plan, refused };
}

describe('a two-signal-only pool never refuses the day (0438 R4)', () => {
    it('the pool rows trip only the two-signal detector, the dead-end rows carry vocabulary', () => {
        for (const title of TWO_SIGNAL_ONLY) {
            const hits = scanCnLead(title, '').hits;
            expect(hits.length, title).toBeGreaterThan(0);
            expect(
                hits.every((hit) => hit.detector === 'two-signal'),
                title,
            ).toBe(true);
        }
        for (const title of VOCABULARY_EVERYWHERE) {
            expect(
                scanCnLead(title, '').hits.some((hit) => hit.detector === 'vocabulary'),
                title,
            ).toBe(true);
        }
    });

    it('enforceCnLead leads with the first two-signal-only candidate and reports it as weakLead', () => {
        const docs = [doc('a', VOCABULARY_EVERYWHERE[0] as string), ...TWO_SIGNAL_ONLY.map((t, i) => doc(`p${i}`, t))];
        const enforced = enforceCnLead(docs);
        expect(enforced.blocked).toBeNull();
        expect(enforced.docs.map((entry) => entry.id)).toEqual(['p0', 'a', 'p1', 'p2']);
        expect(enforced.weakLead?.id).toBe('p0');
        expect(enforced.weakLead?.terms).toEqual(scanCnLead(TWO_SIGNAL_ONLY[0] as string, '').terms);
    });

    it('AC4 — --final over three two-signal-only leads exits 0, writes no refusal and keeps the first lead', () => {
        const res = runFinal(TWO_SIGNAL_ONLY);
        expect(res.status, res.stderr).toBe(0);
        expect(res.refused).toBe(false);
        expect(res.plan).toEqual(['a', 'b', 'c']);
        expect(res.stderr).toContain('weak lead');
    });

    it('AC4 — --final over a vocabulary-everywhere pool still refuses with the record', () => {
        const res = runFinal(VOCABULARY_EVERYWHERE);
        expect(res.status).not.toBe(0);
        expect(res.refused).toBe(true);
    });
});
