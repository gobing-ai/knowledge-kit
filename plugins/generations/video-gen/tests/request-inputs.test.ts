import { describe, expect, it } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVideoInputs } from '../src/inputs';
import { runtimeRunProcess } from '../src/process';
import { parseVideoGenRequest, parseVideoGenRequestInput, SHIPPED_VISUAL_MODES } from '../src/request';
import { localKenBurns, resolveVisualProvider } from '../src/visual-provider';
import { makeFixtureRun } from './fixtures';

/**
 * AC5 (R6) + R2 (AC4) — request validation, daily-run input resolution and provider selection all
 * fail closed (or succeed) before anything is spawned.
 */

describe('parseVideoGenRequest', () => {
    const base = { workDir: '/works/daily/20261126', runDate: '20261126', visualMode: 'editorial' };

    it('accepts an editorial request, with an optional hook window', () => {
        expect(parseVideoGenRequest(base)).toEqual(base);
        expect(parseVideoGenRequest({ ...base, hook: { startSec: 0, endSec: 50 } })).toMatchObject({
            hook: { startSec: 0, endSec: 50 },
        });
        // 0452 ships the avatar modes; the guard now only refuses unknown values.
        expect(SHIPPED_VISUAL_MODES).toEqual(['editorial', 'avatar', 'hybrid-pip']);
    });

    it('rejects an unknown mode, a bad run date and stray keys', () => {
        expect(() => parseVideoGenRequest({ ...base, visualMode: 'hologram' })).toThrow(/invalid request/);
        expect(() => parseVideoGenRequest({ ...base, runDate: '2026-11-26' })).toThrow(/runDate/);
        // An avatar provider on an editorial reel is refused (it drives the presenter shells).
        expect(() => parseVideoGenRequest({ ...base, provider: 'musetalk' })).toThrow(/needs visualMode "avatar"/);
        expect(() => parseVideoGenRequest({ ...base, provider: 'echomimic-v2' })).toThrow(/needs visualMode "avatar"/);
        expect(() => parseVideoGenRequest({ ...base, bogus: true })).toThrow(/invalid request/);
        expect(parseVideoGenRequest({ ...base, provider: 'wan21-i2v' })).toMatchObject({ provider: 'wan21-i2v' });
        expect(
            parseVideoGenRequest({ ...base, provider: 'wan21-i2v', colab: { gpu: 'A100', maxMonthlyCcu: 120 } }),
        ).toMatchObject({ colab: { gpu: 'A100', maxMonthlyCcu: 120 } });
        expect(() => parseVideoGenRequest({ ...base, colab: { gpu: 'V100' } })).toThrow(/invalid request/);
        // 0452 lifts the avatar guard: those modes are now accepted when they carry a portrait.
        expect(
            parseVideoGenRequest({ ...base, visualMode: 'avatar', hostPortraitPath: '/tmp/host.png' }),
        ).toMatchObject({
            visualMode: 'avatar',
            provider: 'musetalk',
        });
        expect(() => parseVideoGenRequest({ ...base, visualMode: 'avatar' })).toThrow(/hostPortraitPath/);
    });
});

describe('parseVideoGenRequestInput', () => {
    const request = { workDir: '/works/daily/20261126', runDate: '20261126', visualMode: 'editorial' };

    it('reads the request from Doc[0].metadata, which is what kk executor run accepts', () => {
        const docs = [{ id: 'video-gen-request', body: '', metadata: request }];
        expect(parseVideoGenRequestInput(docs)).toEqual(request);
    });

    it('still accepts a bare request object for a direct run', () => {
        expect(parseVideoGenRequestInput(request)).toEqual(request);
    });

    it('fails closed on an empty array or a Doc without metadata', () => {
        expect(() => parseVideoGenRequestInput([])).toThrow(/first entry carries the request/);
        expect(() => parseVideoGenRequestInput([null])).toThrow(/first entry carries the request/);
        expect(() => parseVideoGenRequestInput([{ id: 'x', body: '' }])).toThrow(/carries no metadata/);
    });
});

describe('resolveVideoInputs', () => {
    it('resolves the prep-content audio, cover, plan and ordered cards', async () => {
        const run = makeFixtureRun({ withCards: true });
        const inputs = await resolveVideoInputs(run.workDir, run.runDate);
        expect(inputs.audioPath).toBe(run.audioPath);
        expect(inputs.coverPath).toBe(run.coverPath);
        expect(inputs.planPath).toBe(run.planPath);
        expect(inputs.cardPaths).toEqual([run.cardPath as string]);
        expect(inputs.plan.headline).toBe('AI 日报 1126');
        expect(inputs.plan.tags).toEqual(['ai', 'daily']);
        expect(inputs.plan.items.map((item) => item.id)).toEqual(['n1', 'n2']);
    });

    it('falls back to the voice content audio when publish-prep carries none', async () => {
        const run = makeFixtureRun({ withPrepContent: false, audioInVoiceContent: true });
        expect((await resolveVideoInputs(run.workDir, run.runDate)).audioPath).toBe(run.audioPath);
        writeFileSync(
            join(run.workDir, '30-audio', `${run.runDate}_11_generate_content.json`),
            JSON.stringify({ metadata: { mp3Path: run.audioPath } }),
        );
        expect((await resolveVideoInputs(run.workDir, run.runDate)).audioPath).toBe(run.audioPath);
    });

    it('fails closed on missing audio, a missing audio file, a missing cover and a bad plan', async () => {
        const noAudio = makeFixtureRun({ withPrepContent: false });
        await expect(resolveVideoInputs(noAudio.workDir, noAudio.runDate)).rejects.toThrow(/no episode audio recorded/);

        const unreadable = makeFixtureRun();
        writeFileSync(
            join(unreadable.workDir, '31-publish', `${unreadable.runDate}_13_publish-prep_content.json`),
            JSON.stringify({ metadata: { audioFile: join(unreadable.workDir, 'gone.wav') } }),
        );
        await expect(resolveVideoInputs(unreadable.workDir, unreadable.runDate)).rejects.toThrow(
            /missing or unreadable/,
        );
        writeFileSync(
            join(unreadable.workDir, '31-publish', `${unreadable.runDate}_13_publish-prep_content.json`),
            JSON.stringify({ metadata: { audioFile: unreadable.workDir } }),
        );
        await expect(resolveVideoInputs(unreadable.workDir, unreadable.runDate)).rejects.toThrow(
            /missing or unreadable/,
        );

        const locked = makeFixtureRun();
        chmodSync(locked.audioPath, 0o000);
        try {
            await expect(resolveVideoInputs(locked.workDir, locked.runDate)).rejects.toThrow(/missing or unreadable/);
        } finally {
            chmodSync(locked.audioPath, 0o600);
        }

        const noCover = makeFixtureRun({ withCover: false });
        await expect(resolveVideoInputs(noCover.workDir, noCover.runDate)).rejects.toThrow(/cover artwork not found/);

        const noPlan = makeFixtureRun({ withPlan: false });
        await expect(resolveVideoInputs(noPlan.workDir, noPlan.runDate)).rejects.toThrow(/script plan not found/);

        const emptyPlan = makeFixtureRun();
        writeFileSync(emptyPlan.planPath, JSON.stringify({ version: 1, items: [{ lead: 'no id' }] }));
        await expect(resolveVideoInputs(emptyPlan.workDir, emptyPlan.runDate)).rejects.toThrow(/no usable items/);
    });
});

describe('visual provider', () => {
    it('hands the shell the stills in order', async () => {
        const layer = await localKenBurns.prepare({ images: ['cover.png', 'card.png'] });
        expect(layer).toEqual({ kind: 'stills', images: ['cover.png', 'card.png'] });
        expect(resolveVisualProvider('editorial').id).toBe('local-ken-burns');
    });

    it('fails closed on an empty still set or an unwired mode', async () => {
        await expect(localKenBurns.prepare({ images: [] })).rejects.toThrow(/at least one still/);
        expect(() => resolveVisualProvider('avatar')).toThrow(/no local provider/);
    });
});

describe('runtimeRunProcess', () => {
    it('returns the exit code and captured streams', async () => {
        const ok = await runtimeRunProcess(['/bin/sh', '-c', 'printf hi']);
        expect(ok.code).toBe(0);
        expect(ok.stdout).toBe('hi');

        const failing = await runtimeRunProcess(['/bin/sh', '-c', 'printf bad >&2; exit 3']);
        expect(failing.code).toBe(3);
        expect(failing.stderr).toBe('bad');
    });

    it('honours an explicit environment', async () => {
        const result = await runtimeRunProcess(['/bin/sh', '-c', 'printf %s "$KK_TEST"'], { env: { KK_TEST: 'yes' } });
        expect(result.stdout).toBe('yes');
    });
});
