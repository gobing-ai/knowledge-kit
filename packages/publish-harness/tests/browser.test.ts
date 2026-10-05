import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import {
    type ChannelBrowserConfig,
    checkChannelSession,
    expectOutcome,
    fillCodeMirror,
    markdownToHtml,
    pasteHtml,
    resolveChannelProfileDir,
    resolveSelector,
    runProfileCli,
    uploadFile,
    waitUntil,
} from '../src/browser';

/** Records every helper call so a test can assert which DOM path ran. */
interface FakePageHandle {
    page: Page;
    calls: string[];
}

/**
 * Fake `Page` exposing only the four primitives the helpers may use (`locator`, `evaluate`,
 * `keyboard`, `setInputFiles`). `evaluateResults` is a queue whose last entry repeats, so the
 * Nth evaluate of a poll loop is scriptable without knowing the poll count.
 */
function makeFakePage(options: { attached?: boolean; evaluateResults?: unknown[] } = {}): FakePageHandle {
    const calls: string[] = [];
    const results = [...(options.evaluateResults ?? [])];
    const page = {
        locator(selector: string) {
            calls.push(`locator:${selector}`);
            return {
                first() {
                    return {
                        count: async () => (options.attached === false ? 0 : 1),
                        isVisible: async () => false,
                    };
                },
            };
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression}`);
            const head = results.length > 1 ? results.shift() : results[0];
            return head ?? '';
        },
        keyboard: {
            async insertText(text: string) {
                calls.push(`insertText:${text}`);
            },
        },
        async setInputFiles(selector: string, files: string) {
            calls.push(`setInputFiles:${selector}|${files}`);
        },
        async goto(url: string) {
            calls.push(`goto:${url}`);
        },
    };
    return { page: page as unknown as Page, calls };
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    page: FakePageHandle;
    closeCount: () => number;
}

/** Launcher fake returning a recording context; `onLaunch` may throw to simulate a refusal. */
function makeLauncher(onLaunch?: (request: ProfileLaunchRequest) => void): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const page = makeFakePage();
    let closes = 0;
    const launcher: BrowserLauncher = {
        async launch(request) {
            requests.push(request);
            onLaunch?.(request);
            const context = {
                pages: () => [page.page],
                newPage: async () => page.page,
                close: async () => {
                    closes += 1;
                },
            };
            return context as unknown as BrowserContext;
        },
    };
    return { launcher, requests, page, closeCount: () => closes };
}

const CONFIG: ChannelBrowserConfig = {
    channel: 'infoq',
    homeUrl: 'https://xie.infoq.cn/write',
    isAuthenticated: async () => true,
};

const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'infoq');

// The profile-dir tiers are process-wide env; clear them for every case so a developer shell or a
// neighbouring suite cannot change the resolved path, and restore the originals afterwards.
const originalChannelDir = process.env.INFOQ_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;

beforeEach(() => {
    delete process.env.INFOQ_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
});

afterEach(() => {
    if (originalChannelDir === undefined) delete process.env.INFOQ_PROFILE_DIR;
    else process.env.INFOQ_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
});

describe('resolveChannelProfileDir', () => {
    test('falls back to the harness default when no override tier is set', () => {
        expect(resolveChannelProfileDir('infoq')).toBe(DEFAULT_DIR);
    });

    test('prefers override over both env tiers', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.INFOQ_PROFILE_DIR = '~/from-channel';
        expect(resolveChannelProfileDir('infoq', '~/from-flag')).toBe(join(homedir(), 'from-flag'));
    });

    test('prefers the channel env over the shared env', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.INFOQ_PROFILE_DIR = '~/from-channel';
        expect(resolveChannelProfileDir('infoq')).toBe(join(homedir(), 'from-channel'));
    });

    test('falls through to the shared env when the channel env is unset', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        expect(resolveChannelProfileDir('infoq')).toBe(join(homedir(), 'from-shared'));
    });

    test('treats blank tiers as unset rather than as a path', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '   ';
        expect(resolveChannelProfileDir('infoq', '')).toBe(DEFAULT_DIR);
    });
});

describe('checkChannelSession', () => {
    test('verified headless probe reports the profile dir, no headed retry', async () => {
        const { launcher, requests, closeCount } = makeLauncher();
        const result = await checkChannelSession(CONFIG, { profileDir: DEFAULT_DIR, launcher });

        expect(result.status).toBe('verified');
        expect(result.profileDir).toBe(DEFAULT_DIR);
        expect(result.detail).toContain(DEFAULT_DIR);
        expect(requests.map((request) => request.headless)).toEqual([true]);
        expect(closeCount()).toBe(1);
    });

    test('missing profile is refused without a headed retry (never creates one)', async () => {
        const { launcher, requests } = makeLauncher(() => {
            throw new BrowserProfileMissingError(DEFAULT_DIR);
        });
        const result = await checkChannelSession(CONFIG, { profileDir: DEFAULT_DIR, launcher });

        expect(result.status).toBe('refused');
        expect(requests).toHaveLength(1);
        expect(result.detail).toContain(DEFAULT_DIR);
    });

    test('retries headed once when the headless probe refuses', async () => {
        const { launcher, requests } = makeLauncher((request) => {
            if (request.headless) throw new LoginTimeoutError('headless console never confirmed');
        });
        const result = await checkChannelSession(CONFIG, { profileDir: DEFAULT_DIR, launcher });

        expect(result.status).toBe('verified');
        expect(result.detail).toContain('headed');
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });

    test('headedFallback false keeps a refusal to the single headless pass', async () => {
        const { launcher, requests } = makeLauncher(() => {
            throw new LoginTimeoutError('headless console never confirmed');
        });
        const result = await checkChannelSession(CONFIG, {
            profileDir: DEFAULT_DIR,
            launcher,
            headedFallback: false,
        });

        expect(result.status).toBe('refused');
        expect(result.detail).toContain('headless console never confirmed');
        expect(requests.map((request) => request.headless)).toEqual([true]);
    });
});

describe('runProfileCli', () => {
    function collect(lines: string[]): (line: string) => void {
        return (line) => {
            lines.push(line);
        };
    }

    test('unknown verb is a usage error (exit 2) and never launches a browser', async () => {
        const lines: string[] = [];
        const { launcher, requests } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['banish'], { launcher, stdout: collect(lines) });

        expect(code).toBe(2);
        expect(lines.join('\n')).toContain("unknown command 'banish'");
        expect(lines.join('\n')).toContain('usage:');
        expect(requests).toHaveLength(0);
    });

    test('non-numeric --timeout is a usage error (exit 2)', async () => {
        const lines: string[] = [];
        const code = await runProfileCli(CONFIG, ['check', '--timeout', 'soon'], {
            stdout: collect(lines),
        });
        expect(code).toBe(2);
        expect(lines.join('\n')).toContain('--timeout');
    });

    test('login exits 0 and prints the verified profile dir', async () => {
        const lines: string[] = [];
        const { launcher, requests } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['login', '--profile', '~/from-flag'], {
            launcher,
            stdout: collect(lines),
        });

        expect(code).toBe(0);
        expect(requests[0]?.headless).toBe(false);
        expect(requests[0]?.profileDir).toBe(join(homedir(), 'from-flag'));
        expect(lines.join('\n')).toContain('login verified');
    });

    test('login exits 1 when the headed login never confirms', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher(() => {
            throw new LoginTimeoutError('not confirmed within 10ms');
        });
        const code = await runProfileCli(CONFIG, ['login'], { launcher, stdout: collect(lines) });

        expect(code).toBe(1);
        expect(lines.join('\n')).toContain('not confirmed within 10ms');
    });

    test('check exits 0 and prints the machine-readable verdict when verified', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['check'], { launcher, stdout: collect(lines) });

        expect(code).toBe(0);
        expect(JSON.parse(lines[0] ?? '')).toMatchObject({ status: 'verified', profileDir: DEFAULT_DIR });
    });

    test('check exits 1 and names the refusal when the session is refused', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher(() => {
            throw new BrowserProfileMissingError(DEFAULT_DIR);
        });
        const code = await runProfileCli(CONFIG, ['check'], { launcher, stdout: collect(lines) });

        expect(code).toBe(1);
        expect(lines.join('\n')).toContain('refused');
    });

    test('writes through the ts-utils output seam when no stdout dep is injected', async () => {
        // Default-writer path: no `stdout` in deps, so the line goes to the ts-utils stdout target
        // (captured here with the documented buffer-target seam instead of the real process stdout).
        const captured = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: captured });
        try {
            const code = await runProfileCli(CONFIG, ['banish']);
            expect(code).toBe(2);
            expect(captured.text()).toContain("unknown command 'banish'");
            expect(captured.text()).toContain('usage:');
        } finally {
            restore();
        }
    });
});

describe('waitUntil', () => {
    test('returns true as soon as the predicate passes', async () => {
        let calls = 0;
        const observed = await waitUntil(async () => {
            calls += 1;
            return calls >= 2;
        }, 1_000);

        expect(observed).toBe(true);
        expect(calls).toBe(2);
    });

    test('returns the final predicate call after the deadline', async () => {
        let calls = 0;
        const observed = await waitUntil(async () => {
            calls += 1;
            return false;
        }, 20);

        expect(observed).toBe(false);
        expect(calls).toBe(2);
    });
});

describe('pasteHtml', () => {
    test('dispatches a synthetic paste event and accepts a filled editor', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['', 'article body'] });
        await pasteHtml(page, '.ProseMirror', '<p>article body</p>');

        const paste = calls.find((call) => call.includes('ClipboardEvent'));
        expect(paste).toBeDefined();
        expect(paste).toContain('text/html');
        expect(paste).toContain('text/plain');
        expect(paste).toContain('<p>article body</p>');
    });

    test('throws naming the selector and timeout when the editor stays empty', async () => {
        const { page } = makeFakePage({ evaluateResults: ['', ''] });
        await expect(pasteHtml(page, '.stale', '<p>x</p>', { timeoutMs: 20 })).rejects.toThrow(/\.stale.*20ms/);
    });

    test('throws naming the selector and timeout when it never attaches', async () => {
        const { page } = makeFakePage({ attached: false });
        await expect(pasteHtml(page, '#missing', '<p>x</p>', { timeoutMs: 20 })).rejects.toThrow(/#missing.*20ms/);
    });
});

describe('fillCodeMirror', () => {
    test('tries CodeMirror 6, then CodeMirror 5, then the keyboard in that order', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm6'] });
        await fillCodeMirror(page, '.cm-editor', '# Title');

        expect(calls.some((call) => call.startsWith('insertText:'))).toBe(false);
        const script = calls.find((call) => call.startsWith('evaluate:')) ?? '';
        expect(script.indexOf('view.dispatch')).toBeLessThan(script.indexOf('setValue'));
        expect(script.indexOf('setValue')).toBeLessThan(script.indexOf("'keyboard'"));
    });

    test('fills through the CodeMirror 6 view when available', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm6'] });
        await fillCodeMirror(page, '.cm-editor', '# Title');

        expect(calls.some((call) => call.startsWith('insertText:'))).toBe(false);
        expect(calls.some((call) => call.includes('view.dispatch'))).toBe(true);
    });

    test('falls back to the CodeMirror 5 setValue API', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm5'] });
        await fillCodeMirror(page, '.CodeMirror', '# Title');

        expect(calls.some((call) => call.startsWith('insertText:'))).toBe(false);
        expect(calls.some((call) => call.includes('setValue'))).toBe(true);
    });

    test('falls back to keyboard insertText when no editor API is reachable', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['keyboard'] });
        await fillCodeMirror(page, '.bytemd', '# Title');

        expect(calls).toContain('insertText:# Title');
    });

    test('throws naming the selector and timeout when the editor element vanishes', async () => {
        const { page } = makeFakePage({ evaluateResults: ['missing'] });
        await expect(fillCodeMirror(page, '.gone', '# Title', { timeoutMs: 20 })).rejects.toThrow(/\.gone.*20ms/);
    });

    test('reads the editor back before reporting the fill', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm6', '# Title'] });
        await fillCodeMirror(page, '.cm-editor', '# Title');

        expect(calls.filter((call) => call.startsWith('evaluate:')).length).toBeGreaterThanOrEqual(2);
    });

    test('throws when the editor stays empty after the fill (no false success)', async () => {
        const { page } = makeFakePage({ evaluateResults: ['cm6', ''] });
        await expect(fillCodeMirror(page, '.cm-editor', '# Title', { timeoutMs: 20 })).rejects.toThrow(
            /editor text is empty 20ms/,
        );
    });
});

describe('resolveSelector', () => {
    test('resolves the first attached candidate of a list', async () => {
        const { page } = makeFakePage();
        await expect(resolveSelector(page, ['.title-input', 'input[placeholder*="标题"]'])).resolves.toBe(
            '.title-input',
        );
    });

    test('throws naming every candidate and the deadline when none attaches', async () => {
        const { page } = makeFakePage({ attached: false });
        await expect(resolveSelector(page, ['.a', '.b'], { timeoutMs: 20, label: 'body editor' })).rejects.toThrow(
            /body editor: \.a \| \.b not attached within 20ms/,
        );
    });
});

describe('uploadFile', () => {
    test('sets files on an attached input without requiring visibility', async () => {
        const { page, calls } = makeFakePage();
        await uploadFile(page, 'input[type="file"]', '/tmp/cover.png');

        expect(calls).toContain('setInputFiles:input[type="file"]|/tmp/cover.png');
        expect(calls.some((call) => call.includes('isVisible'))).toBe(false);
    });

    test('throws naming the selector and timeout when the input never attaches', async () => {
        const { page } = makeFakePage({ attached: false });
        await expect(uploadFile(page, 'input[type="file"]', '/tmp/cover.png', { timeoutMs: 20 })).rejects.toThrow(
            /input\[type="file"\].*20ms/,
        );
    });
});

describe('expectOutcome', () => {
    test('returns the observed evidence', async () => {
        const evidence: (string | null)[] = [null, '', 'draft-42'];
        const outcome = await expectOutcome(async () => evidence.shift() ?? 'draft-42', {
            timeoutMs: 1_000,
            label: 'juejin draft',
        });

        expect(outcome).toEqual({ ok: true, evidence: 'draft-42' });
    });

    test('reports the label and deadline when nothing is observed', async () => {
        const outcome = await expectOutcome(async () => null, { timeoutMs: 20, label: 'substack URL' });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.error).toContain('substack URL');
        expect(outcome.ok === false && outcome.error).toContain('20ms');
    });
});

describe('markdownToHtml', () => {
    test('renders GFM through the Bun built-in', () => {
        const html = markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |\n');

        expect(html).toContain('<table>');
        expect(html).toContain('<td>1</td>');
    });
});

describe('main entry isolation (R5)', () => {
    test('src/index.ts never imports the browser module or the browser package', async () => {
        const source = await Bun.file(new URL('../src/index.ts', import.meta.url)).text();

        expect(source).not.toContain('./browser');
        expect(source).not.toContain('ts-browser-automation');
    });
});
