import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { enrichArticle } from '../src/enrich';
import { insertAudioMaterial, type ModeRunDeps, runMode } from '../src/flow';
import { validateModeInput } from '../src/modes';
import type { WechatPage } from '../src/page';

const tempRoots: string[] = [];
function makeTmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempRoots.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe('wechatmp validateModeInput coverSource=library behavior', () => {
    test('does not include coverPath in body images when coverSource is library, while still validating coverPath', async () => {
        const dir = makeTmpDir('kk-wx-modes-');
        const cover = join(dir, 'cover.png');
        const bodyImg = join(dir, 'illus.png');
        const audio = join(dir, 'ep.mp3');
        writeFileSync(cover, 'png');
        writeFileSync(bodyImg, 'png');
        writeFileSync(audio, 'mp3');

        const libraryOnly: Content = {
            title: '第261121期 · 测试',
            body: '## 今日要点\n\n- A\n\n正文段落。',
            format: 'markdown',
            metadata: {
                wechatmp: {
                    coverSource: 'library',
                    coverPath: cover,
                    audioPath: audio,
                    audioTitle: '第261121期 · 测试',
                    audioCoverPath: cover,
                },
            },
        };
        const res = await validateModeInput('文章', libraryOnly);
        expect(res.error).toBeUndefined();
        if (res.input?.operation === '文章') {
            expect(res.input.images).toEqual([]);
        }

        const withIllustration: Content = {
            ...libraryOnly,
            metadata: {
                ...libraryOnly.metadata,
                images: [bodyImg],
            },
        };
        const resIllus = await validateModeInput('文章', withIllustration);
        expect(resIllus.error).toBeUndefined();
        if (resIllus.input?.operation === '文章') {
            expect(resIllus.input.images).toEqual([bodyImg]);
        }

        const missingCover: Content = {
            ...libraryOnly,
            metadata: {
                wechatmp: {
                    coverSource: 'library',
                    coverPath: join(dir, 'missing.png'),
                },
            },
        };
        const bad = await validateModeInput('文章', missingCover);
        expect(bad.error).toContain('does not exist');
    });
});

describe('wechatmp enrichArticle live original DOM & post-enrich recheck', () => {
    test('enrichArticle script checks #js_original_open and clicks weui-desktop-form__check-label agreement', async () => {
        let originalOpenVisible = false;
        let originalCheckedInOpen = false;
        let unsetCheckboxChecked = false;
        let claimCommitted = false;
        let agreementChecked = false;
        let dialogOpen = false;
        let claimClearedOriginal = false;

        const clicks: string[] = [];
        const handleClick = (selector: string) => {
            clicks.push(selector);
            if (selector.includes('#js_original .setting-group__content-info')) {
                dialogOpen = true;
                unsetCheckboxChecked = true;
            } else if (selector.includes('i.weui-desktop-icon-checkbox')) {
                agreementChecked = true;
            } else if (selector.includes('button:text-is("确定")')) {
                if (agreementChecked) {
                    originalOpenVisible = true;
                    originalCheckedInOpen = true;
                    dialogOpen = false;
                }
            } else if (selector.includes('#js_claim_source_area')) {
                dialogOpen = true;
            } else if (selector.includes('button:text-is("确认")')) {
                dialogOpen = false;
                claimCommitted = true;
                if (claimClearedOriginal) {
                    originalOpenVisible = false;
                    originalCheckedInOpen = false;
                }
            } else if (selector.includes('取消') || selector.includes('close')) {
                dialogOpen = false;
            }
        };

        const locatorCount = (selector: string): number => {
            if (selector.includes('label.original_agreement')) return 0;
            if (selector.includes('我已阅读并同意')) return dialogOpen && !agreementChecked ? 1 : 0;
            if (selector.includes('#js_original') || selector.includes('#js_claim_source_area')) return 1;
            if (selector.includes('文字原创') || selector.includes('内容由AI生成')) return dialogOpen ? 1 : 0;
            if (selector === '.weui-desktop-dialog:visible') return dialogOpen ? 1 : 0;
            if (selector.includes('确定') || selector.includes('确认')) return dialogOpen ? 1 : 0;
            if (selector.includes('取消')) return dialogOpen ? 1 : 0;
            return 0;
        };

        const page = {
            url: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg',
            waitForTimeout: async () => undefined,
            press: async () => undefined,
            click: async (selector: string) => handleClick(selector),
            fill: async () => undefined,
            locator: (selector: string) => ({
                count: async () => locatorCount(selector),
                first: () => ({
                    count: async () => locatorCount(selector),
                    isVisible: async () =>
                        dialogOpen || selector.includes('#js_original') || selector.includes('#js_claim_source_area'),
                    waitFor: async () => undefined,
                    click: async () => handleClick(selector),
                    inputValue: async () => '',
                }),
            }),
            evaluate: async (script: string) => {
                if (script.includes('#js_original_open') && script.includes('#js_original')) {
                    return originalOpenVisible && originalCheckedInOpen;
                }
                if (script.includes('#js_original')) {
                    return unsetCheckboxChecked;
                }
                if (script.includes('#js_claim_source_area')) {
                    return { enabled: claimCommitted, text: claimCommitted ? '内容由AI生成' : '' };
                }
                if (script.includes('weui-desktop-dialog')) return dialogOpen;
                return null;
            },
        } as unknown as WechatPage;

        const warnings = await enrichArticle(page, {
            original: true,
            author: '冰原奔狼',
            claimSource: '内容由AI生成',
        });
        expect(warnings).toEqual([]);
        expect(clicks.some((s) => s.includes('我已阅读并同意') && s.includes('i.weui-desktop-icon-checkbox'))).toBe(
            true,
        );

        // Simulate a later step clearing #js_original_open after initial confirmation.
        originalOpenVisible = false;
        originalCheckedInOpen = false;
        unsetCheckboxChecked = false;
        agreementChecked = false;
        claimClearedOriginal = true;
        claimCommitted = false;
        const postCleared = await enrichArticle(page, {
            original: true,
            author: '冰原奔狼',
            claimSource: '内容由AI生成',
        });
        expect(postCleared.some((w) => w.includes('原创声明'))).toBe(true);
    });
});

describe('wechatmp insertAudioMaterial live upload & save waits', () => {
    test('fails with save/progress diagnostic instead of clicking 取消 prematurely when upload dialog stays open', async () => {
        const dir = makeTmpDir('kk-wx-audio-');
        const mp3 = join(dir, 'ep.mp3');
        const cover = join(dir, 'cover.png');
        writeFileSync(mp3, 'mp3');
        writeFileSync(cover, 'png');
        mkdirSync(dir, { recursive: true });

        let saveClicked = false;
        let cancelClickedAfterSave = false;

        const locCount = (selector: string): number => {
            if (selector.includes('选择图片')) return 0;
            if (
                selector.includes('上传音频') ||
                selector.includes('重新上传') ||
                selector.includes('保存') ||
                selector.includes('上传封面') ||
                selector.includes('标题')
            ) {
                return 1;
            }
            return 1;
        };

        const page = {
            url: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg',
            waitForTimeout: async () => undefined,
            press: async () => undefined,
            click: async (selector: string) => {
                if (selector.includes('保存')) saveClicked = true;
            },
            fill: async () => undefined,
            setInputFiles: async () => undefined,
            locator: (selector: string) => ({
                count: async () => locCount(selector),
                first: () => ({
                    count: async () => locCount(selector),
                    isVisible: async () => !selector.includes('选择图片'),
                    fill: async () => undefined,
                    waitFor: async () => undefined,
                    click: async () => {
                        if (selector.includes('保存')) saveClicked = true;
                    },
                    textContent: async () => (selector.includes('h3.weui-desktop-dialog__title') ? '上传音频' : ''),
                }),
            }),
            evaluate: async (script: string) => {
                if (script.includes('input[name=audio_id]')) return '100%';
                if (script.includes('我已阅读并同意')) return 'checked';
                if (script.includes('btn.click()') && script.includes('保存')) return 'clicked';
                if (script.includes('.audio_title')) return 'missing';
                if (script.includes("textContent ?? '').trim() === '取消'")) {
                    if (saveClicked) cancelClickedAfterSave = true;
                }
                if (script.includes('window.__kkToasts'))
                    return JSON.stringify({ btn: { disabled: false }, toasts: ['音频转码失败'] });
                return undefined;
            },
        } as unknown as WechatPage;

        const res = await insertAudioMaterial(
            page,
            { title: 'Ep 1', audioPath: mp3, coverPath: cover },
            { uploadWaitMs: 30, saveCloseWaitMs: 30, saveDispatchWaitMs: 30, rowRetries: 1 },
        );
        expect(res.warning).toContain('保存失败');
        expect(cancelClickedAfterSave).toBe(false);
    });

    test('fails when live upload never reaches 100%, and retries 插入 after post-save library polling', async () => {
        const dir = makeTmpDir('kk-wx-audio2-');
        const mp3 = join(dir, 'ep.mp3');
        const cover = join(dir, 'cover.png');
        writeFileSync(mp3, 'mp3');
        writeFileSync(cover, 'png');

        const page = {
            url: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg',
            waitForTimeout: async () => undefined,
            press: async () => undefined,
            click: async () => undefined,
            fill: async () => undefined,
            setInputFiles: async () => undefined,
            locator: (selector: string) => ({
                count: async () => (selector.includes('重新上传') || selector.includes('选择图片') ? 0 : 1),
                first: () => ({
                    count: async () => (selector.includes('重新上传') || selector.includes('选择图片') ? 0 : 1),
                    isVisible: async () => !selector.includes('选择图片'),
                    fill: async () => undefined,
                    waitFor: async () => undefined,
                    click: async () => undefined,
                    textContent: async () => (selector.includes('h3.weui-desktop-dialog__title') ? '上传音频' : ''),
                }),
            }),
            evaluate: async (script: string) => {
                if (script.includes('input[name=audio_id]')) return '42%';
                if (script.includes('.audio_title')) return 'missing';
                return undefined;
            },
        } as unknown as WechatPage;

        const res = await insertAudioMaterial(
            page,
            { title: 'Ep 1', audioPath: mp3, coverPath: cover },
            { uploadWaitMs: 25, saveCloseWaitMs: 20, saveDispatchWaitMs: 20, rowRetries: 1 },
        );
        expect(res.warning).toContain('未达到 100%');
    });

    test('succeeds on live upload path after JS-dispatch save close and delayed 插入 retry', async () => {
        const dir = makeTmpDir('kk-wx-audio3-');
        const mp3 = join(dir, 'ep.mp3');
        const cover = join(dir, 'cover.png');
        writeFileSync(mp3, 'mp3');
        writeFileSync(cover, 'png');

        let uploadOpen = true;
        let chooserOpen = false;
        let preUploadReads = 0;
        let insertAttempts = 0;

        const page = {
            url: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg',
            waitForTimeout: async () => undefined,
            press: async () => undefined,
            click: async () => undefined,
            fill: async () => undefined,
            setInputFiles: async () => undefined,
            locator: (selector: string) => {
                const count = (): number => {
                    if (selector.includes('选择图片')) return chooserOpen ? 1 : 0;
                    if (selector.includes('h3.weui-desktop-dialog__title:text-is("上传音频")'))
                        return uploadOpen ? 1 : 0;
                    if (selector.includes('上一步')) return chooserOpen ? 1 : 0;
                    return 1;
                };
                return {
                    count: async () => count(),
                    first: () => ({
                        count: async () => count(),
                        isVisible: async () => (selector.includes('选择图片') ? chooserOpen : count() > 0),
                        fill: async () => undefined,
                        waitFor: async () => undefined,
                        click: async () => {
                            if (selector.includes('上传封面')) chooserOpen = true;
                            if (selector.includes('完成')) chooserOpen = false;
                        },
                        textContent: async () =>
                            selector.includes('h3.weui-desktop-dialog__title') && uploadOpen ? '上传音频' : '',
                    }),
                };
            },
            evaluate: async (script: string) => {
                if (script.includes('input[name=audio_id]')) return '100%';
                if (script.includes('#js_image_dialog_list_wrp')) return true;
                if (script.includes('row.classList.contains')) return true;
                if (script.includes('weui-desktop-img-picker__img-title')) return 0;
                if (script.includes('我已阅读并同意')) return 'checked';
                if (script.includes('btn.click()') && script.includes('保存')) {
                    uploadOpen = false;
                    return 'clicked';
                }
                if (script.includes('.audio_title')) {
                    preUploadReads += 1;
                    return preUploadReads <= 3 ? 'missing' : JSON.stringify({ state: 'checked', identity: 'media-9' });
                }
                if (script.includes('插入')) {
                    insertAttempts += 1;
                    return insertAttempts >= 2;
                }
                if (script.includes("state: 'noeditor'")) {
                    return JSON.stringify({ state: 'top', identity: 'media-9' });
                }
                return undefined;
            },
        } as unknown as WechatPage;

        const res = await insertAudioMaterial(
            page,
            { title: 'Ep 1', audioPath: mp3, coverPath: cover },
            { uploadWaitMs: 30, saveCloseWaitMs: 15, saveDispatchWaitMs: 30, rowRetries: 2 },
        );
        expect(res.warning).toBe('');
        expect(res.coverSeeded).toBe(true);
        expect(insertAttempts).toBe(2);
    });
});

describe('wechatmp partial enrich separates capability refusals from real failures', () => {
    test('WECHATMP_ALLOW_PARTIAL_ENRICH=1 still fails on non-capability 音频/原创 failures while tolerating capability refusals', async () => {
        const dir = makeTmpDir('kk-wx-partial-');
        const cover = join(dir, 'cover.png');
        const audio = join(dir, 'ep.mp3');
        writeFileSync(cover, 'png');
        writeFileSync(audio, 'mp3');

        function buildPartialHarness(opts: { rewardOnlyCapability: boolean }) {
            let saved = false;
            let pasted = false;
            const editorUrl = 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&createType=0&token=123';
            const editorCount = (sel: string): number => {
                if (sel.includes('ProseMirror') || sel.includes('js_cover_area') || sel.includes('js_cover_btn_area'))
                    return 1;
                if (sel.includes('.audio_dialog') || sel.includes('js_insertaudio')) return 1;
                if (sel.includes('前往开通') || sel.includes('无法开启')) return 1;
                if (sel.includes('保存为草稿') || sel.includes('js_reward')) return 1;
                if (sel.includes('上传音频') || sel.includes('ailayout') || sel.includes('一键排版')) return 0;
                if (sel.includes('weui-desktop-dialog')) return 0;
                if (sel.includes('js_description') || sel.includes('author')) return 0;
                if (sel.includes('js_imagedialog') || sel.includes('下一步') || sel.includes('确认')) return 1;
                return 0;
            };
            const makeMockPage = (isHome: boolean): WechatPage =>
                ({
                    url: () =>
                        isHome ? 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=123' : editorUrl,
                    goto: async () => undefined,
                    waitForTimeout: async () => undefined,
                    press: async () => undefined,
                    setInputFiles: async () => undefined,
                    locator: (sel: string) => {
                        const c = isHome ? (sel.includes('更新于') && saved ? 1 : 0) : editorCount(sel);
                        return {
                            count: async () => c,
                            first: () => ({
                                count: async () => c,
                                isVisible: async () => c > 0,
                                click: async () => {
                                    if (sel.includes('保存为草稿')) saved = true;
                                },
                                type: async () => undefined,
                                fill: async () => undefined,
                                waitFor: async () => undefined,
                                textContent: async () => (saved && sel.includes('更新于') ? '更新于 16:00' : ''),
                                inputValue: async () => '测试标题',
                            }),
                        };
                    },
                    evaluate: async (expr: string) => {
                        if (expr.includes('无法开启赞赏')) {
                            return { clickable: false, blocked: true, text: '无法开启赞赏，因为还没有赞赏账户' };
                        }
                        if (expr.includes('editor_content_placeholder')) return pasted ? 20 : 0;
                        if (expr.includes('ClipboardEvent')) {
                            pasted = true;
                            return true;
                        }
                        if (expr.includes('ProseMirror') && expr.includes('textContent')) return pasted ? '正文' : '';
                        if (expr.includes('img.crop-img')) return '[]';
                        if (expr.includes('weui-desktop-img-picker__item')) {
                            return JSON.stringify({ picked: true, src: 'https://mmbiz.qpic.cn/cover.png' });
                        }
                        if (expr.includes('#js_cover_area')) return 'https://mmbiz.qpic.cn/cover.png';
                        if (expr.includes('#js_reward_setting_area')) return false;
                        if (expr.includes('.weui-desktop-dialog__wrp')) return false;
                        if (expr.includes('audio_title')) return 'missing';
                        return '';
                    },
                }) as unknown as WechatPage;

            const homePage = makeMockPage(true);
            const editorPage = makeMockPage(false);
            const content: Content = {
                title: '测试标题',
                body: '测试正文',
                format: 'markdown',
                metadata: {
                    wechatmp: {
                        coverSource: 'library',
                        coverPath: cover,
                        reward: true,
                        ...(opts.rewardOnlyCapability
                            ? {}
                            : {
                                  audioTitle: '测试标题',
                                  audioPath: audio,
                                  audioCoverPath: cover,
                              }),
                    },
                },
            };
            const deps: ModeRunDeps = {
                entry: homePage,
                pages: () => [homePage],
                newPage: async () => editorPage,
                driver: 'script',
                profileDir: dir,
                publishStatus: 'draft',
                content,
                stepTimeoutMs: 50,
                pollMs: 5,
                draftTimeoutMs: 100,
                submitSettleMs: 1,
                submitAttempts: 1,
                draftBaseline: { stamp: null },
            };
            return { content, deps };
        }

        const prev = process.env.WECHATMP_ALLOW_PARTIAL_ENRICH;
        process.env.WECHATMP_ALLOW_PARTIAL_ENRICH = '1';
        try {
            // 1. Real non-capability audio failure + reward capability refusal: MUST still fail under ALLOW_PARTIAL_ENRICH=1!
            const withAudioFailure = buildPartialHarness({ rewardOnlyCapability: false });
            const val1 = await validateModeInput('文章', withAudioFailure.content);
            expect(val1.error).toBeUndefined();
            if (!val1.input) throw new Error('expected input');
            const res1 = await runMode(val1.input, withAudioFailure.deps);
            expect(res1.ok).toBe(false);
            expect(res1.error).toContain('音频');

            // 2. Capability-only warning (reward blocked): passes when ALLOW_PARTIAL_ENRICH=1!
            const capabilityOnly = buildPartialHarness({ rewardOnlyCapability: true });
            const val2 = await validateModeInput('文章', capabilityOnly.content);
            expect(val2.error).toBeUndefined();
            if (!val2.input) throw new Error('expected input');
            const res2 = await runMode(val2.input, capabilityOnly.deps);
            expect(res2.ok).toBe(true);
            expect(
                (res2.metadata?.enrichWarnings as string[] | undefined)?.some((w) => w.includes('需要赞赏账户')),
            ).toBe(true);
        } finally {
            if (prev === undefined) delete process.env.WECHATMP_ALLOW_PARTIAL_ENRICH;
            else process.env.WECHATMP_ALLOW_PARTIAL_ENRICH = prev;
        }
    });
});
