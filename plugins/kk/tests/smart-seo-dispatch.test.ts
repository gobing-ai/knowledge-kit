import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetSeoStageCancellation } from '../scripts/seo-fetch';
import { checkSeoDecisionContracts, runSeoStage, seoPreflight, seoScore } from '../scripts/seo-stages';

/** In-process stage dispatcher and preflight guards (the CLI paths are covered by subprocess tests). */
const dirs: string[] = [];
function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kk-seo-dispatch-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    resetSeoStageCancellation();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const options = {
    url: 'https://example.invalid',
    locale: 'en-US',
    business_context: '',
    max_pages: 2,
    max_depth: 1,
    max_requests: 5,
    deadline_seconds: 30,
    semantic_pages: 1,
    max_pairs: 1,
    max_keywords: 1,
    max_decision_calls: 1,
    performance: false,
    visibility_file: '',
    fixture: '',
};

describe('runSeoStage dispatcher', () => {
    it('rejects an unknown or missing stage name and rethrows stage usage errors', async () => {
        await expect(runSeoStage('seo-nope', [])).rejects.toThrow('unknown stage: seo-nope');
        await expect(runSeoStage(undefined, [])).rejects.toThrow('unknown stage: (none)');
        for (const stage of ['seo-collect', 'seo-check', 'seo-enrich', 'seo-judge', 'seo-score', 'seo-report']) {
            await expect(runSeoStage(stage, [])).rejects.toThrow('usage: kk stage run');
        }
        await expect(runSeoStage('seo-preflight', [])).rejects.toThrow('usage: kk stage run seo-preflight');
    });

    it('records a cancellation marker and exits 143 when SIGTERM arrives mid-stage', async () => {
        const workDir = tmp();
        writeFileSync(join(workDir, 'options.json'), JSON.stringify(options), 'utf-8');
        writeFileSync(join(workDir, 'manifest.json'), JSON.stringify({ runId: 'r', inputDigest: 'd' }), 'utf-8');
        const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as typeof process.exit);
        const err = spyOn(console, 'error').mockImplementation(() => {});
        try {
            const pending = runSeoStage('seo-collect', [workDir]);
            process.emit('SIGTERM');
            await expect(pending).rejects.toThrow('exit:143');
        } finally {
            exit.mockRestore();
            err.mockRestore();
        }
        const marker = JSON.parse(readFileSync(join(workDir, 'cancelled.json'), 'utf-8'));
        expect(marker).toMatchObject({ schemaVersion: 1, stage: 'seo-collect', signal: 'SIGTERM' });
    });

    it('still exits with the signal status when the work_dir is gone', async () => {
        const workDir = tmp();
        writeFileSync(join(workDir, 'options.json'), JSON.stringify(options), 'utf-8');
        writeFileSync(join(workDir, 'manifest.json'), JSON.stringify({ runId: 'r', inputDigest: 'd' }), 'utf-8');
        const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as typeof process.exit);
        const err = spyOn(console, 'error').mockImplementation(() => {});
        try {
            const pending = runSeoStage('seo-collect', [workDir]);
            process.emit('SIGINT');
            rmSync(workDir, { recursive: true, force: true });
            await expect(pending).rejects.toThrow('exit:130');
        } finally {
            exit.mockRestore();
            err.mockRestore();
        }
        expect(existsSync(join(workDir, 'cancelled.json'))).toBe(false);
    });
});

describe('seo-preflight and score guards', () => {
    it('refuses unreadable, oversize, invalid and non-empty inputs', async () => {
        const dir = tmp();
        await expect(seoPreflight([join(dir, 'w'), join(dir, 'absent.json')])).rejects.toThrow('not found');
        mkdirSync(join(dir, 'asdir.json'));
        await expect(seoPreflight([join(dir, 'w'), join(dir, 'asdir.json')])).rejects.toThrow('cannot read');
        writeFileSync(join(dir, 'big.json'), 'x'.repeat(64 * 1024 + 1));
        await expect(seoPreflight([join(dir, 'w'), join(dir, 'big.json')])).rejects.toThrow('64 KiB');
        writeFileSync(join(dir, 'bad.json'), '{');
        await expect(seoPreflight([join(dir, 'w'), join(dir, 'bad.json')])).rejects.toThrow('invalid JSON');
        writeFileSync(join(dir, 'ok.json'), JSON.stringify(options));
        mkdirSync(join(dir, 'full'));
        writeFileSync(join(dir, 'full', 'x'), '');
        await expect(seoPreflight([join(dir, 'full'), join(dir, 'ok.json')])).rejects.toThrow('non-empty');
    });

    it('refuses a non-empty new revision directory', async () => {
        const dir = tmp();
        for (const name of ['checks.json', 'crawl.json', 'options.json']) writeFileSync(join(dir, name), '{}');
        mkdirSync(join(dir, 'rev'));
        writeFileSync(join(dir, 'rev', 'x'), '');
        await expect(seoScore([dir, join(dir, 'rev')])).rejects.toThrow('new_revision_dir exists and is non-empty');
    });

    it('fails the decision contract probe on a failing or non-JSON listing', () => {
        expect(() => checkSeoDecisionContracts(() => ({ status: 1, stdout: '' }))).toThrow('did not succeed');
        expect(() => checkSeoDecisionContracts(() => ({ status: 0, stdout: 'nope' }))).toThrow('did not return JSON');
    });
});
