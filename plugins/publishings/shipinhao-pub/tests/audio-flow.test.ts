/**
 * shipinhao 音频 flow — offline contract against a scripted fake page.
 *
 * Failure-first list (the ways this file can betray the operator):
 *  1. A draft request names the cover rule instead of its own blocker (order matters).
 *  2. A cover-less public request gets past the pre-browser gate into the silent 「请上传封面」 trap.
 *  3. The unimplemented 1:1 cover rail is quietly dropped instead of refused by name.
 *  4. A navigation that never reaches 音频管理 / 发表音频 is reported as success.
 *  5. A dropped 标题 or 描述 fill is published silently (no readback).
 *  6. A 合集 that the account does not offer is clicked by substring (our own title) or ignored.
 *  7. A submit whose 音频管理 list never grows is reported `ok: true` (the uncertain/unknown trap).
 *  8. A disabled submit or a form with no 发表音频 control is clicked anyway.
 */

import { describe, expect, it } from 'bun:test';
import type { Page } from 'playwright';
import {
    type AudioFlowInput,
    buildAudioDescription,
    clipAudioTitle,
    countAudioRows,
    pendingAudioFlow,
    runAudioPostFlow,
} from '../src/audio-flow';

const TITLE = '每日AI乱炖 · 2026-11-15';
const AUDIO = '/tmp/episode.mp3';
const COVER = '/tmp/cover.png';
const MANAGER = 'https://channels.weixin.qq.com/platform/post/audioManager';
const CREATE = 'https://channels.weixin.qq.com/platform/post/createAudio';

interface FakeOptions {
    /** The 发表音频 entry renders on 音频管理 (default true). */
    createEntry?: boolean;
    /** The form opens after `发表音频` drains (default true). */
    openForm?: boolean;
    zone?: boolean;
    chooser?: boolean;
    titleInput?: boolean | 'drops';
    descriptionInput?: boolean | 'drops';
    coverHint?: boolean;
    coverBox?: boolean;
    cropDialog?: boolean;
    coverAccepted?: boolean;
    picker?: boolean;
    collections?: string[];
    collectionReadback?: boolean;
    submit?: 'enabled' | 'missing' | 'disabled';
    confirm?: boolean;
    /** Row counts returned per 音频管理 row read, in order; the last repeats. */
    rows?: number[];
}

/**
 * A scripted page. `count(selector)` answers from the fake state and records every call, so each
 * branch is asserted on what the flow asked the console for.
 */
function fakePage(options: FakeOptions = {}): { page: Page; calls: string[] } {
    const calls: string[] = [];
    const rows = [...(options.rows ?? [0])];
    const collections = options.collections ?? [];
    let afterForm = false;
    let chooserClicks = 0;
    let chip = '';
    let titleValue = '';
    let descriptionValue = '';
    let coverDirty = true;
    let pickerOpen = false;
    let picked = '';

    const api = (selector: string) => {
        let nested = 0;
        const self: Record<string, unknown> = {
            first: () => self,
            last: () => self,
            // The audio steps resolve the form node with `.first()`.
            nth: () => self,
            count: async () => {
                calls.push(`count ${selector}`);
                if (selector.startsWith('text=') && !selector.includes('拖拽到此处'))
                    return chip.startsWith(selector.slice(5)) ? 1 : 0;
                if (selector.includes('拖拽到此处上传')) return options.zone === false ? 0 : 1;
                if (selector.includes('button:has-text("发表音频")')) {
                    // First read is the 音频管理 entry, the next is the form's submit control.
                    nested += 1;
                    if (nested === 1) return options.createEntry === false ? 0 : 1;
                    return options.submit === 'missing' ? 0 : 1;
                }
                if (selector.includes('a:has-text("内容管理")')) return 1;
                if (selector.includes('封面宽高比')) return options.coverHint === false ? 0 : 1;
                if (selector.includes('button:text-is("确认")')) {
                    return options.cropDialog === false ? 0 : 1;
                }
                if (selector.includes('请上传封面')) return coverDirty ? 1 : 0;
                if (selector.includes('div.display-text') && selector.includes('选择合集')) {
                    if (options.picker === false) return 0;
                    if (pickerOpen) return 0;
                    return 1;
                }
                if (selector.includes('确认发表') || selector.includes('确定')) return options.confirm === true ? 1 : 0;
                if (selector.includes('input[placeholder="请填写标题"]')) return options.titleInput === false ? 0 : 1;
                if (selector.includes('textarea[placeholder="请填写描述"]')) {
                    return options.descriptionInput === false ? 0 : 1;
                }
                return 1;
            },
            click: async () => {
                calls.push(`click ${selector}`);
                if (selector.includes('拖拽到此处上传')) {
                    chooserClicks += 1;
                } else if (selector.includes('button:has-text("发表音频")') && !selector.includes('a:has')) {
                    afterForm = true;
                } else if (selector.includes('div.display-text') && selector.includes('选择合集')) {
                    pickerOpen = true;
                } else if (selector.includes('button:text-is("确认")')) {
                    coverDirty = options.coverAccepted === false;
                }
            },
            hover: async () => {
                calls.push(`hover ${selector}`);
            },
            fill: async (value: string) => {
                calls.push(`fill ${selector}`);
                if (selector.includes('请填写标题')) titleValue = options.titleInput === 'drops' ? '' : value;
                if (selector.includes('请填写描述'))
                    descriptionValue = options.descriptionInput === 'drops' ? '' : value;
            },
            inputValue: async () => (selector.includes('请填写标题') ? titleValue : descriptionValue),
            isDisabled: async () => {
                calls.push(`isDisabled ${selector}`);
                return options.submit === 'disabled';
            },
            isVisible: async () => true,
            scrollIntoViewIfNeeded: async () => {
                calls.push(`scroll ${selector}`);
            },
            boundingBox: async (): Promise<{ x: number; y: number; width: number; height: number } | null> => {
                calls.push(`box ${selector}`);
                if (selector.includes('封面宽高比') && options.coverHint === false) return null;
                return options.coverBox === false ? null : { x: 0, y: 100, width: 80, height: 80 };
            },
            elementHandle: async () => ({
                textContent: async () => {
                    if (options.collectionReadback === false) return '选择合集';
                    return picked === '' ? '选择合集' : `合集 ${picked}`;
                },
            }),
        };
        return self;
    };

    const page = {
        goto: async () => {
            calls.push('goto');
            afterForm = false;
        },
        url: () => (afterForm && options.openForm !== false ? CREATE : MANAGER),
        waitForTimeout: async (ms: number) => {
            calls.push(`wait ${ms}`);
        },
        evaluate: async () => {
            calls.push('evaluate');
            return true;
        },
        locator: (selector: string) => api(selector),
        getByText: (text: string) => {
            if (text === TITLE) {
                return {
                    last: () => ({ click: async () => calls.push('row.click') }),
                    count: async () => {
                        calls.push('row read');
                        const value = rows[0] ?? 0;
                        if (rows.length > 1) rows.shift();
                        return value;
                    },
                };
            }
            return {
                count: async () => (collections.includes(text) ? 1 : 0),
                last: () => ({
                    click: async () => {
                        calls.push(`collection click ${text}`);
                        if (collections.includes(text)) picked = text;
                    },
                }),
            };
        },
        waitForEvent: async () => {
            calls.push('waitForEvent');
            // The flow attaches .catch(() => null) to this promise, so a missing chooser resolves null.
            if (options.chooser === false) return null;
            chooserClicks += 1;
            if (chooserClicks === 0) return null;
            return {
                setFiles: async (file: string) => {
                    calls.push(`files ${file}`);
                    chip = file.split('/').pop() ?? '';
                },
            };
        },
        mouse: {
            click: async () => {
                calls.push('mouse.click');
                chooserClicks += 1;
            },
        },
    } as unknown as Page;
    return { page, calls };
}

function input(page: Page, overrides: Partial<AudioFlowInput> = {}): AudioFlowInput {
    return {
        page,
        title: TITLE,
        body: '正文',
        tags: ['ai-news'],
        media: [AUDIO],
        coverPath: COVER,
        publishPublic: true,
        operation: 'audio',
        profileDir: '/tmp/profile',
        stepTimeoutMs: 5,
        ...overrides,
    };
}

/** Reach the recon-grounded steps directly (the public entry refuses a cover pre-browser). */
function pending(overrides: Partial<AudioFlowInput> = {}, options: FakeOptions = {}) {
    const { page, calls } = fakePage({ rows: [0, 1], ...options });
    return {
        calls,
        run: () =>
            pendingAudioFlow(input(page, overrides), {
                operation: 'audio',
                publishStatus: 'public',
                profileDir: '/tmp/profile',
            }),
    };
}

describe('runAudioPostFlow refusals (pre-browser)', () => {
    it('refuses a draft request by name before the cover rule', async () => {
        const { page, calls } = fakePage();
        const result = await runAudioPostFlow(input(page, { publishPublic: false, coverPath: undefined }));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('has no draft rail');
        expect(calls).toEqual([]);
    });

    it('refuses a cover-less public request with the measured 「请上传封面」 reason', async () => {
        const { page, calls } = fakePage();
        const result = await runAudioPostFlow(input(page, { coverPath: undefined }));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('requires a cover');
        expect(result.error).toContain('请上传封面');
        expect(calls).toEqual([]);
    });

    it('refuses the unimplemented 1:1 cover rail by name instead of dropping the cover', async () => {
        const { page, calls } = fakePage();
        const result = await runAudioPostFlow(input(page));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('1:1 audio rail');
        expect(calls).toEqual([]);
    });
});

describe('pendingAudioFlow (recon-grounded steps)', () => {
    it('publishes and confirms only when the 音频管理 row count grows', async () => {
        const { run, calls } = pending({ collection: '每日AI乱炖' }, { collections: ['不加合集', '每日AI乱炖'] });
        expect((await run()).ok).toBe(true);
        expect(calls).toContain('collection click 每日AI乱炖');
    });

    it('reports an unknown effect when the list never grows', async () => {
        const { run } = pending({}, { rows: [0, 0] });
        const result = await run();
        expect(result.ok).toBe(false);
        expect(result.error).toContain('publish-receipt not confirmed');
    });

    it('fails the open step when 发表音频 never opens the form', async () => {
        const { run } = pending({}, { openForm: false });
        expect((await run()).error).toContain('发表音频 form never opened');
    });

    it('fails the upload step when the drop zone is absent', async () => {
        const { run } = pending({}, { zone: false });
        expect((await run()).error).toContain('audio drop zone');
    });

    it('fails the upload step when clicking the zone opens no chooser', async () => {
        const { run } = pending({}, { chooser: false });
        expect((await run()).error).toContain('opened no file chooser');
    });

    it('fails the title step when the 标题 input is absent', async () => {
        const { run } = pending({}, { titleInput: false });
        expect((await run()).error).toContain('标题 input not found');
    });

    it('fails the title readback when the 标题 drops the fill', async () => {
        const { run } = pending({}, { titleInput: 'drops' });
        expect((await run()).error).toContain('标题 readback failed');
    });

    it('fails the description step when the 描述 textarea is absent', async () => {
        const { run } = pending({}, { descriptionInput: false });
        expect((await run()).error).toContain('描述 textarea not found');
    });

    it('fails the description readback when the 描述 drops the fill', async () => {
        const { run } = pending({}, { descriptionInput: 'drops' });
        expect((await run()).error).toContain('描述 readback failed');
    });

    it('fails the cover step when the 封面 hint is absent', async () => {
        const { run } = pending({}, { coverHint: false });
        expect((await run()).error).toContain('封面 hint');
    });

    it('fails the cover step when the tile has no layout box', async () => {
        const { run } = pending({}, { coverBox: false });
        expect((await run()).error).toContain('no layout box');
    });

    it('fails the cover step when no crop dialog appears', async () => {
        const { run } = pending({}, { cropDialog: false });
        expect((await run()).error).toContain('crop dialog never appeared');
    });

    it('fails the cover step when the form still reports 「请上传封面」', async () => {
        const { run } = pending({}, { coverAccepted: false });
        expect((await run()).error).toContain('still reports');
    });

    it('fails when the 合集 picker is absent and a collection was requested', async () => {
        const { run } = pending({ collection: '每日AI乱炖' }, { picker: false });
        expect((await run()).error).toContain('合集 picker');
    });

    it("fails when the requested 合集 is not one of the account's", async () => {
        const { run } = pending({ collection: '另一个合集' }, { collections: ['每日AI乱炖'] });
        expect((await run()).error).toContain('is not among');
    });

    it('fails when the 合集 click does not read back', async () => {
        const { run } = pending(
            { collection: '每日AI乱炖' },
            { collections: ['每日AI乱炖'], collectionReadback: false },
        );
        expect((await run()).error).toContain('does not show it');
    });

    it('fails when no collection is requested and the 选择合集 row is missing', async () => {
        const { run } = pending({}, { picker: false });
        expect((await run()).error).toContain('合集 row missing');
    });

    it('fails when the submit control is missing', async () => {
        const { run } = pending({}, { submit: 'missing' });
        expect((await run()).error).toContain('submit control not found');
    });

    it('fails when the submit control is disabled', async () => {
        const { run } = pending({}, { submit: 'disabled' });
        expect((await run()).error).toContain('is disabled');
    });

    it('clicks a confirmation when the form raises one, then confirms from the list', async () => {
        const { run, calls } = pending({}, { confirm: true, rows: [0, 1] });
        expect((await run()).ok).toBe(true);
        expect(calls.some((call) => call.includes('确认发表'))).toBe(true);
    });
});

describe('audio helpers', () => {
    it('clips the 标题 to 40 code points', () => {
        expect(clipAudioTitle(TITLE)).toBe(TITLE);
        expect(Array.from(clipAudioTitle('字'.repeat(60)))).toHaveLength(40);
    });

    it('builds the 描述 from the body plus topic tags inside the cap', () => {
        expect(buildAudioDescription('body', ['ai-news', '#daily'])).toBe('body\n\n#ai-news #daily');
        expect(buildAudioDescription('x'.repeat(4_000), [])).toHaveLength(3_000);
    });

    it('countAudioRows returns 0 instead of throwing when the page probe fails', async () => {
        const page = {
            getByText: () => ({
                count: async () => {
                    throw new Error('page closed');
                },
            }),
        } as unknown as Page;
        expect(await countAudioRows(page, TITLE)).toBe(0);
    });
});
