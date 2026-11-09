import { describe, expect, it } from 'bun:test';
import { decodeBotPlan } from '../src/bot-plan';

describe('decodeBotPlan', () => {
    it('returns the object for a JSON object plan', () => {
        expect(decodeBotPlan('{"steps":[]}')).toEqual({ ok: true, plan: { steps: [] } });
    });

    it('names invalid JSON', () => {
        expect(decodeBotPlan('not-json')).toEqual({ ok: false, reason: 'invalid-json' });
    });

    it('rejects arrays, null and scalars as not-object', () => {
        for (const raw of ['[]', 'null', '42', '"s"']) {
            expect(decodeBotPlan(raw)).toEqual({ ok: false, reason: 'not-object' });
        }
    });
});
