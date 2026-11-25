import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertAudioMaterial } from '../src/flow';
import type { WechatPage } from '../src/page';

function makeDuplicateCoverPage(): WechatPage {
    const evals = ['missing', 'missing', 'missing'];
    return {
        goto: async () => undefined,
        url: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=77&token=123',
        press: async () => undefined,
        waitForTimeout: async () => undefined,
        setInputFiles: async () => undefined,
        evaluate: async (script: string) => {
            if (script.includes('audio_item')) return evals.shift() ?? 'missing';
            if (script.includes('weui-desktop-loading')) return true;
            if (script.includes('img-picker__item')) return '2';
            return undefined;
        },
        locator: () => ({
            count: async () => 1,
            first: () => ({
                count: async () => 1,
                isVisible: async () => true,
                waitFor: async () => undefined,
                click: async () => undefined,
                fill: async () => undefined,
            }),
        }),
    } as unknown as WechatPage;
}

describe('wechatmp audio cover chooser branches (0430 R1)', () => {
    test('refuses duplicate cover matches in the chooser without uploading', async () => {
        const cover = join(tmpdir(), `kk-0430-dup-${randomUUID()}.png`);
        await Bun.write(cover, 'png');
        try {
            const result = await insertAudioMaterial(makeDuplicateCoverPage(), {
                title: 'Ep dup',
                audioPath: 'a.mp3',
                coverPath: cover,
            });
            expect(result.warning).toContain('存在多个同名素材');
            expect(result.coverSeeded).toBe(false);
        } finally {
            await rm(cover, { force: true });
        }
    });
});
