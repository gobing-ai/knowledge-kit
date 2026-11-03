import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { findAttachedSelector, findSelector, modalState, waitForVisible, wrapPlaywrightPage } from '../src/page';
import { runScenario } from './fixtures/wechatmp-dom-runner';

const artifactDir = join(process.cwd(), '.works/tmp/test-wechat-audio-browser');
const artifactPath = join(artifactDir, 'audio-coverage.json');

describe('wechatmp audio chooser coverage (same-process Chromium)', () => {
    test('exercises the real chooser upload and deterministic cover-reuse paths in-process', async () => {
        const reuse = await runScenario('audio-upload-reuse-cover');
        const upload = await runScenario('audio-upload-scoped-inputs');

        expect(reuse.ops?.audioResult).toBe('');
        expect(reuse.ops?.uploads).toEqual(['audio-input']);
        expect(reuse.ops?.tickedRows).toEqual(['media-7']);
        expect(reuse.ops?.insertedMediaId).toBe('media-7');

        expect(upload.ops?.audioResult).toBe('');
        expect(upload.ops?.uploads).toEqual(['audio-input', 'cover-input']);
        expect(upload.ops?.tickedRows).toEqual(['media-7']);
        expect(upload.ops?.insertedMediaId).toBe('media-7');

        await mkdir(artifactDir, { recursive: true });
        await writeFile(
            artifactPath,
            JSON.stringify(
                {
                    scenarios: [reuse, upload],
                    assertions: {
                        reuseCover: 'existing uniquely named cover selected without duplicate cover upload',
                        newCover: 'cover uploaded through the real portaled chooser and selected before save',
                    },
                },
                null,
                2,
            ),
        );
    }, 180_000);

    test('adapter diagnostics remain fail-closed for missing controls, frames, and a closed page', async () => {
        const browser = await chromium.launch({ headless: true });
        const raw = await browser.newPage();
        const page = wrapPlaywrightPage(raw);
        try {
            await raw.setContent(
                '<button id="save">保存为草稿</button><iframe srcdoc="<p>frame diagnostic</p>"></iframe>',
            );
            await raw.frameLocator('iframe').locator('p').waitFor();
            expect(await modalState(page)).toBe('closed');

            const frames = page.frames?.() ?? [];
            const frameUrls = frames.map((frame) => frame.url());
            expect(frameUrls).toEqual(['about:blank', 'about:srcdoc']);
            const childFrame = frames.find((frame) => frame.url() === 'about:srcdoc');
            const childBodyCount = await childFrame?.locator('p').count();
            expect(childBodyCount).toBe(1);
            const frame = frames[0];
            if (frame === undefined) throw new Error('main frame wrapper was not exposed');
            expect(await frame.locator('body').count()).toBe(1);

            await expect(findSelector(page, ['#missing'], 'missing control', 20)).rejects.toThrow('missing control');
            await expect(findAttachedSelector(page, ['#missing'], 'missing input', 20)).rejects.toThrow(
                'missing input',
            );
            await expect(waitForVisible(page, '#missing', 20)).rejects.toThrow('#missing: not visible');

            await raw.close();
            const closedPageState = await modalState(page);
            expect(closedPageState).toBe('unknown');
            await writeFile(
                join(artifactDir, 'frame-inventory.json'),
                JSON.stringify({ frameUrls, childBodyCount, closedPageState }, null, 2),
            );
        } finally {
            await browser.close();
        }
    }, 30_000);
});
