/**
 * G83/0439 — `resolveArgv` (feature R8/AC3, task R3).
 *
 * Failure list written before the code (each is a refusal, not a fallback):
 * 1. an unknown kind is refused, never mapped to a default;
 * 2. a key the kind does not allowlist is refused, even when the value looks valid;
 * 3. free text in any value (a node, a window, a channel, a path) is refused;
 * 4. `--engine` is refused on a non-voice step and outside the voice engine enum;
 * 5. a `dayDir` that does not end with its own day is refused (no path escape by naming);
 * 6. a recipe that cannot resolve is never emitted (`recipeOf` → null);
 * 7. the resolved argv matches the frozen design table exactly, dry-run variants included.
 */

import { describe, expect, it } from 'bun:test';
import { ActionParamError, recipeOf, resolveArgv } from '../../src/board/actions';

function refusal(kind: Parameters<typeof resolveArgv>[0], params: Record<string, string>): string {
    try {
        resolveArgv(kind, params);
    } catch (error) {
        expect(error).toBeInstanceOf(ActionParamError);
        return (error as ActionParamError).param;
    }
    throw new Error(`expected ${kind} to be refused`);
}

describe('resolveArgv — the frozen argv table (R3, AC3)', () => {
    it('generate-from-node resumes one node of one run', () => {
        const resolved = resolveArgv('generate-from-node', { node: 'voice', runId: 'kk-news-generate-20261125-1' });
        expect(resolved.argv).toEqual([
            'spur',
            'workflow',
            'run',
            'plugins/kk/workflows/kk-news-generate.yaml',
            '--from',
            'voice',
            '--from-run',
            'kk-news-generate-20261125-1',
            '--async',
            '--json',
        ]);
        expect(resolved.live).toBe(false);
    });

    it('publish-retry carries the channel list and a dry-run variant', () => {
        const resolved = resolveArgv('publish-retry', {
            day: '20261125',
            window: 'after-generate',
            channels: 'shipinhao-pub,x-pub',
        });
        expect(resolved.argv).toEqual([
            'kk',
            'news',
            'publish',
            '--run-date',
            '20261125',
            '--window',
            'after-generate',
            '--retry',
            '--channels',
            'shipinhao-pub,x-pub',
        ]);
        expect(resolved.dryRunArgv).toEqual([...resolved.argv, '--dry-run']);
        expect(resolved.live).toBe(true);
    });

    it('publish-retry omits --channels when no channel is named', () => {
        expect(resolveArgv('publish-retry', { day: '20261125', window: 'cn-peak' }).argv).toEqual([
            'kk',
            'news',
            'publish',
            '--run-date',
            '20261125',
            '--window',
            'cn-peak',
            '--retry',
        ]);
    });

    it('publish-window is live unless it is a dummy send', () => {
        const live = resolveArgv('publish-window', { day: '20261125', window: 'cn-peak' });
        expect(live.argv).toEqual(['kk', 'news', 'publish', '--run-date', '20261125', '--window', 'cn-peak']);
        expect(live.live).toBe(true);
        const dummy = resolveArgv('publish-window', { day: '20261125', window: 'cn-peak', dummy: 'true' });
        expect(dummy.argv.at(-1)).toBe('--dummy');
        expect(dummy.live).toBe(false);
    });

    it('rerender-step maps each step to its own verb, and only voice takes an engine', () => {
        const voice = resolveArgv('rerender-step', {
            day: '20261125',
            dayDir: '/works/kk-news-generate/20261125',
            step: 'voice',
            engine: 'gemini',
        });
        expect(voice.argv).toEqual([
            'kk',
            'news',
            'generate-voice',
            '--work-dir',
            '/works/kk-news-generate/20261125',
            '--engine',
            'gemini',
        ]);
        expect(voice.live).toBe(false);
        expect(
            resolveArgv('rerender-step', { day: '20261125', dayDir: '/works/kk-news-generate/20261125', step: 'cards' })
                .argv,
        ).toEqual(['kk', 'news', 'generate-cards', '--work-dir', '/works/kk-news-generate/20261125']);
        expect(
            resolveArgv('rerender-step', {
                day: '20261125',
                dayDir: '/works/kk-news-generate/20261125',
                step: 'render',
            }).argv,
        ).toEqual(['kk', 'news', 'generate-render', '--work-dir', '/works/kk-news-generate/20261125']);
    });

    it('cancel-run and store-release take only a run id', () => {
        expect(resolveArgv('cancel-run', { runId: 'run-1' }).argv).toEqual([
            'spur',
            'workflow',
            'cancel',
            'run-1',
            '--json',
        ]);
        expect(resolveArgv('store-release', { runId: 'run-1' }).argv).toEqual([
            'kk',
            'store',
            'release',
            '--run',
            'run-1',
        ]);
    });
});

describe('resolveArgv — refusals (task R3)', () => {
    it('refuses an unknown kind', () => {
        expect(refusal('delete-run' as Parameters<typeof resolveArgv>[0], { day: '20261125' })).toBe('kind');
    });

    it('refuses a key the kind does not allowlist', () => {
        expect(refusal('cancel-run', { runId: 'run-1', day: '20261125' })).toBe('day');
        expect(refusal('publish-window', { day: '20261125', window: 'cn-peak', channels: 'x-pub' })).toBe('channels');
    });

    it('refuses free text, a bad day and an unknown window', () => {
        expect(refusal('generate-from-node', { node: 'voice; rm -rf /', runId: 'run-1' })).toBe('node');
        expect(refusal('publish-window', { day: '2026-11-25', window: 'cn-peak' })).toBe('day');
        expect(refusal('publish-window', { day: '20261125', window: 'midnight' })).toBe('window');
        expect(refusal('publish-retry', { day: '20261125', window: 'cn-peak', channels: 'a b' })).toBe('channels');
        expect(refusal('cancel-run', { runId: '../../etc/passwd' })).toBe('runId');
    });

    it('refuses a missing required parameter', () => {
        expect(refusal('cancel-run', {})).toBe('runId');
        expect(refusal('publish-window', { window: 'cn-peak' })).toBe('day');
    });

    it('refuses an engine on a non-voice step and outside the enum', () => {
        expect(
            refusal('rerender-step', {
                day: '20261125',
                dayDir: '/works/kk-news-generate/20261125',
                step: 'cards',
                engine: 'gemini',
            }),
        ).toBe('engine');
        expect(
            refusal('rerender-step', {
                day: '20261125',
                dayDir: '/works/kk-news-generate/20261125',
                step: 'voice',
                engine: 'elevenlabs',
            }),
        ).toBe('engine');
    });

    it('refuses a dayDir that escapes its own day', () => {
        expect(refusal('rerender-step', { day: '20261125', dayDir: '/works/20261124', step: 'cards' })).toBe('dayDir');
        expect(refusal('rerender-step', { day: '20261125', dayDir: 'relative/20261125', step: 'cards' })).toBe(
            'dayDir',
        );
    });

    it('refuses a non-boolean dummy flag', () => {
        expect(refusal('publish-window', { day: '20261125', window: 'cn-peak', dummy: 'yes' })).toBe('dummy');
    });

    it('recipeOf returns null instead of an unresolvable recipe', () => {
        expect(recipeOf('cancel-run', 'cancel', { runId: 'nope/nope' })).toBeNull();
        const recipe = recipeOf('publish-retry', 'retry', { day: '20261125', window: 'cn-peak' });
        expect(recipe?.live).toBe(true);
        expect(recipe?.params).toEqual({ day: '20261125', window: 'cn-peak' });
    });
});
