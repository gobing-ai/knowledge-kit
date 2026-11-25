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
    attachAudioCover,
    buildAudioDescription,
    clipAudioTitle,
    countAudioRows,
    expectOutcome,
    pendingAudioFlow,
    runAudioPostFlow,
    selectAudioCollection,
    setAudioReceiptBudgetForTests,
} from '../src/audio-flow';

// The receipt clock is a fixed 30 s in production; the scripted no-growth case shortens it. The
// 200 ms assertion budget only shortens the scripted fake's silent waits, never a branch wait.
setAudioReceiptBudgetForTests(200);

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
    /** The confirmation dialog's click rejects (a re-render raced the click). */
    confirmClickRejects?: boolean;
    /** Row counts returned per 音频管理 row read, in order; the last repeats. */
    rows?: number[];
    /** The 封面 tile keeps showing an upload percentage, i.e. the file never settles. */
    coverUploading?: boolean;
    /** Inline validation the form renders when the submit is refused (page never leaves the form). */
    submitRefusal?: string;
    /** Reads of the crop dialog's cropper image that come back empty: the dialog mounts first. */
    cropperMountReads?: number;
    cropProbesDetach?: boolean;
    /** Crop 确认 clicks the dialog swallows before one commits (Infinity: it never closes). */
    cropClicksSwallowed?: number;
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
    let submitted = false;
    let chip = '';
    let titleValue = '';
    let descriptionValue = '';
    let coverDirty = true;
    let pickerOpen = false;
    let cropConfirmed = false;
    let cropperReads = 0;
    let cropClicks = 0;
    const detachedProbes = new Set<string>();
    let confirmClicked = false;
    let picked = '';

    const api = (selector: string) => {
        const self: Record<string, unknown> = {
            first: () => self,
            last: () => self,
            // The audio steps resolve the form node with `.first()`.
            nth: () => self,
            count: async () => {
                calls.push(`count ${selector}`);
                if (selector.startsWith('text=') && selector.includes('.mp3'))
                    return chip !== '' && selector.slice(5).startsWith(chip) ? 1 : 0;
                if (selector.includes('拖拽到此处上传')) return options.zone === false ? 0 : 1;
                if (selector.includes('button:has-text("发表音频")')) {
                    if (afterForm) return options.submit === 'missing' ? 0 : 1;
                    return options.createEntry === false ? 0 : 1;
                }
                if (selector.includes('a:has-text("内容管理")')) return 1;
                if (selector.includes('封面宽高比')) return options.coverHint === false ? 0 : 1;
                if (selector.includes('button:text-is("确认")') && !selector.includes('发表')) {
                    if (options.cropDialog === false) return 0;
                    return cropConfirmed ? 0 : 1;
                }
                // The cropper image mounts after its dialog (measured 2026-11-18).
                if (selector.includes('cropper-wrap') && selector.endsWith(' img')) {
                    if (options.cropDialog === false || cropConfirmed) return 0;
                    if (cropperReads++ < (options.cropperMountReads ?? 0)) return 0;
                    calls.push('cropper mounted');
                    return 1;
                }
                // The crop dialog and its cropper image: open from the cover file until 确认 lands.
                if (selector.includes('cropper-wrap') || selector.includes('编辑音频封面')) {
                    return options.cropDialog === false || cropConfirmed ? 0 : 1;
                }
                if (selector.includes('%')) return options.coverUploading === true ? 1 : 0;
                if (options.submitRefusal !== undefined && selector === `text=${options.submitRefusal}`) {
                    return submitted ? 1 : 0;
                }
                if (selector.includes('请上传封面')) return coverDirty ? 1 : 0;
                if (selector.includes('确认发表')) return options.confirm === true ? (confirmClicked ? 0 : 1) : 0;
                if (selector.includes('div.display-text') && selector.includes('选择合集')) {
                    if (options.picker === false) return 0;
                    return pickerOpen ? 0 : 1;
                }
                if (selector.includes('input[placeholder="请填写标题"]')) return options.titleInput === false ? 0 : 1;
                if (selector.includes('textarea[placeholder="请填写描述"]')) {
                    return options.descriptionInput === false ? 0 : 1;
                }
                return 1;
            },
            click: async () => {
                calls.push(`click ${selector}`);
                if (selector.includes('拖拽到此处上传')) {
                } else if (selector.includes('button:has-text("发表音频")') && !selector.includes('a:has')) {
                    if (afterForm) submitted = true;
                    else afterForm = true;
                } else if (selector.includes('div.display-text') && selector.includes('选择合集')) {
                    pickerOpen = true;
                } else if (selector.includes('确认发表')) {
                    if (options.confirmClickRejects === true) throw new Error('dialog detached');
                    confirmClicked = true;
                } else if (selector.includes('button:text-is("确认")')) {
                    if (cropClicks++ < (options.cropClicksSwallowed ?? 0)) return;
                    cropConfirmed = true;
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
            isVisible: async () => {
                if (options.cropProbesDetach && selector.includes('cropper-wrap') && !detachedProbes.has(selector)) {
                    detachedProbes.add(selector);
                    calls.push(`detach ${selector}`);
                    throw new Error('crop locator detached');
                }
                return true;
            },
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
        // A refused submit never leaves the create form (measured 2026-11-18); a successful one
        // lands back on 音频管理, which is where the receipt is read.
        url: () =>
            submitted
                ? options.submitRefusal !== undefined
                    ? CREATE
                    : MANAGER
                : afterForm && options.openForm !== false
                  ? CREATE
                  : MANAGER,
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
            // Playwright's waitForEvent REJECTS on timeout and the flow attaches `.catch(() => null)`;
            // the cover branch awaits its chooser BEFORE it clicks the tile, so resolve on the next
            // macrotask — a synchronously-rejected null would make the branch unreachable.
            if (options.chooser === false) {
                await new Promise((resolve) => setTimeout(resolve, 0));
                throw new Error('page.waitForEvent: Timeout 5ms exceeded');
            }
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
        run: async () => {
            // The public entry now refuses the unimplemented cover rail pre-browser; the real page
            // budget is irrelevant to the scripted evidence, so shorten it.
            const result = await pendingAudioFlow(input(page, { ...overrides, stepTimeoutMs: 20 }), {
                operation: 'audio',
                publishStatus: 'public',
                profileDir: '/tmp/profile',
            });
            if (!result.ok) calls.push(`error ${result.error}`);
            return result;
        },
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

    it('drives the 音频 surface when a cover is present and confirms from the list', async () => {
        const { page, calls } = fakePage({ rows: [0, 1] });
        const result = await runAudioPostFlow({ ...input(page), stepTimeoutMs: 20 });
        expect(result.ok, calls.join(' | ')).toBe(true);
        expect(calls).toContain('goto');
        expect(calls.some((call) => call.startsWith('files '))).toBe(true);
    });
});

describe('pendingAudioFlow (recon-grounded steps)', () => {
    it('publishes and confirms only when the 音频管理 row count grows', async () => {
        const { run, calls } = pending({ collection: '每日AI乱炖' }, { collections: ['不加合集', '每日AI乱炖'] });
        const result = await run();
        expect(result.ok, calls.join(' | ')).toBe(true);
        expect(calls).toContain('collection click 每日AI乱炖');
    });

    it('reports an unknown effect when the list never grows', async () => {
        const { run, calls } = pending({}, { rows: [0, 0] });
        const result = await run();
        expect(result.error, calls.join(' | ')).toContain('publish-receipt not confirmed');
    });

    it('fails the open step when 发表音频 never opens the form', async () => {
        const { run } = pending({}, { openForm: false });
        expect((await run()).error).toContain('发表音频 form never opened');
    });

    it('names the inline validation when the form refuses the submit', async () => {
        // Measured 2026-11-18: the page stays on /platform/post/createAudio and renders the refusal
        // inline; reporting it beats a 30 s receipt wait that can only say "unknown".
        const { run } = pending({}, { coverAccepted: true, submitRefusal: '请上传封面' });
        const result = await run();
        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('audio-submit-validation');
        expect(String(result.error)).toContain('请上传封面');
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

    it('attaches the 封面 through its crop dialog and requires 「请上传封面」 to clear', async () => {
        // The form generates nothing for a supplied cover: attachAudioCover drives the tile → chooser →
        // 编辑音频封面 crop dialog and refuses while the validation text remains.
        const { run, calls } = pending({}, {});
        const result = await run();
        expect(calls.some((call) => call === 'mouse.click')).toBe(true);
        expect(calls.some((call) => call.startsWith('files '))).toBe(true);
        expect(result.ok, calls.join(' | ')).toBe(true);
    });

    it('waits for the 封面 upload to settle before it looks for the crop dialog', async () => {
        // 2026-11-18: the file was chosen, the tile showed 25%, the flow moved on, and the submit was
        // refused client-side with 「请上传封面」 while the page never left the form.
        const result = await attachAudioCover(fakePage({ coverUploading: true }).page, COVER, 5);
        expect(result).toContain('upload never settled');
    });

    it('waits for the cropper image before it clicks 确认 in a dialog that mounts first', async () => {
        // 2026-11-18: the crop dialog renders before its cropper image; a 确认 fired in that window is
        // swallowed and the submit is later refused with 「请上传封面」.
        const { page, calls } = fakePage({ cropperMountReads: 2 });
        expect(await attachAudioCover(page, COVER, 3_000)).toBeNull();
        const mounted = calls.indexOf('cropper mounted');
        const firstConfirm = calls.findIndex((call) => call.startsWith('click') && call.includes('确认'));
        expect(mounted).toBeGreaterThan(-1);
        expect(firstConfirm).toBeGreaterThan(mounted);
    });

    it('re-clicks 确认 until the crop dialog closes when the first click is swallowed', async () => {
        const { page, calls } = fakePage({ cropClicksSwallowed: 1 });
        expect(await attachAudioCover(page, COVER, 3_000)).toBeNull();
        expect(calls.filter((call) => call.startsWith('click') && call.includes('确认')).length).toBe(2);
    });

    it('retries detached dialog and cropper probes before confirming the cover', async () => {
        const { page, calls } = fakePage({ cropProbesDetach: true });
        expect(await attachAudioCover(page, COVER, 3_000)).toBeNull();
        const confirm = calls.findIndex((call) => call.startsWith('click') && call.includes('确认'));
        const detached = calls.filter((call) => call.startsWith('detach '));
        expect(detached).toHaveLength(2);
        for (const probe of detached) expect(calls.indexOf(probe)).toBeLessThan(confirm);
    });

    it('refuses when the crop dialog never closes, however often 确认 is clicked', async () => {
        const result = await attachAudioCover(fakePage({ cropClicksSwallowed: Infinity }).page, COVER, 1_000);
        expect(result).toContain('crop dialog never closed');
    });

    it('refuses when the crop dialog never appears', async () => {
        const result = await attachAudioCover(fakePage({ cropDialog: false }).page, COVER, 5);
        expect(result).toContain('crop dialog never appeared');
    });

    it('refuses while the form still reports 「请上传封面」 after the crop', async () => {
        const result = await attachAudioCover(fakePage({ coverAccepted: false }).page, COVER, 5);
        expect(result).toContain('still reports');
    });

    it('refuses a 封面 tile with no layout box', async () => {
        const result = await attachAudioCover(fakePage({ coverBox: false }).page, COVER, 5);
        expect(result).toContain('no layout box');
    });

    it('refuses when the 封面 hint is absent', async () => {
        const result = await attachAudioCover(fakePage({ coverHint: false }).page, COVER, 5);
        expect(result).toContain('封面 hint');
    });

    it('refuses when the 封面 tile opens no file chooser', async () => {
        const result = await attachAudioCover(fakePage({ chooser: false }).page, COVER, 5);
        expect(result).toContain('opened no file chooser');
    });

    it('publishes even when the confirmation dialog detaches mid-click', async () => {
        // The confirmation is opportunistic: a dialog that re-renders out from under the click must
        // never turn a submitted post into a failure.
        const { run, calls } = pending({}, { confirm: true, confirmClickRejects: true, rows: [0, 1] });
        const result = await run();
        expect(result.ok, calls.join(' | ')).toBe(true);
        expect(calls.some((call) => call.startsWith('click button:text-is("确认发表")'))).toBe(true);
    });

    it('fails when the 合集 picker is absent and a collection was requested', async () => {
        const { run } = pending({ collection: '每日AI乱炖' }, { picker: false, collections: ['每日AI乱炖'] });
        expect((await run()).error, 'collection picker absent').toContain('合集');
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
        expect(await run()).toMatchObject({ ok: false });
    });

    it('fails when the submit control is missing', async () => {
        const { run } = pending({}, { submit: 'missing' });
        expect((await run()).error).toContain('submit control not found');
    });

    it('keeps the confirmation loop quiet when no dialog is raised', async () => {
        // The no-dialog path is the ordinary case: every confirmation candidate reads 0.
        const { run, calls } = pending({}, { confirm: false, rows: [0, 1] });
        expect((await run()).ok, calls.join(' | ')).toBe(true);
        expect(calls.some((call) => call.startsWith('click button:text-is("确认发表")'))).toBe(false);
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

describe('selectAudioCollection branches', () => {
    it('refuses when the 合集 picker is absent', async () => {
        expect(await selectAudioCollection(fakePage({ picker: false }).page, '每日AI乱炖', 5)).toContain('合集 picker');
    });

    it('refuses a collection the account does not offer', async () => {
        expect(await selectAudioCollection(fakePage({ collections: ['其它'] }).page, '每日AI乱炖', 5)).toContain(
            'is not among',
        );
    });

    it('refuses when the row does not read the collection back', async () => {
        expect(
            await selectAudioCollection(
                fakePage({ collections: ['每日AI乱炖'], collectionReadback: false }).page,
                '每日AI乱炖',
                5,
            ),
        ).toContain('does not show it');
    });

    it('returns null once the exact collection commits and reads back', async () => {
        expect(await selectAudioCollection(fakePage({ collections: ['每日AI乱炖'] }).page, '每日AI乱炖', 5)).toBeNull();
    });
});

describe('audio helpers', () => {
    it('records a probe throw in its last error and succeeds when the probe recovers', async () => {
        let attempt = 0;
        const recovered = await expectOutcome(
            async () => {
                attempt += 1;
                if (attempt === 1) throw new Error('probe window gone');
                // One null read proves the poll continues instead of accepting a missing value.
                return attempt === 2 ? null : 'value';
            },
            2_000,
            'probe',
        );
        expect(recovered).toEqual({ ok: true, evidence: 'value' });
        const failed = await expectOutcome(
            async () => {
                throw new Error('always gone');
            },
            10,
            'probe',
        );
        expect(failed).toEqual({ ok: false, error: 'probe: always gone' });
    });

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
