import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0189 F1 — the retired-names gate (R4) in validate-voicescript.ts. The validator runs
 * `main()` at import, so it is exercised as the spawned script it is, never imported in-process.
 */
const validator = join(import.meta.dir, '../scripts/validate-voicescript.ts');

function validate(script: unknown): ReturnType<typeof spawnSync> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-validate-vs-'));
    const inPath = join(dir, 'voicescript.json');
    writeFileSync(inPath, JSON.stringify(script));
    try {
        return spawnSync('bun', [validator, '--in', inPath], { encoding: 'utf-8' });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('validate-voicescript retired-names gate (task 0189 R4/F1)', () => {
    it('rejects a segment carrying a retired pre-0189 column name', () => {
        const result = validate({ segments: [{ text: '每日 AI 资讯，第 41 期。' }] });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('retired positioning name "每日 AI 资讯"');
    });

    it('accepts a clean segment under the new positioning (control)', () => {
        const result = validate({ segments: [{ text: 'AI 乱炖，本期聊三件事。' }] });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });
});
