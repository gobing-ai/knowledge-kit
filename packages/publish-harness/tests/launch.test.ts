import { afterEach, describe, expect, mock, test } from 'bun:test';
import { launchPersistentBrowser } from '../src/index';

describe('launchPersistentBrowser', () => {
    afterEach(() => {
        mock.restore();
    });

    test('opens a persistent context via playwright when present', async () => {
        mock.module('playwright', () => ({
            chromium: {
                launchPersistentContext: async (userDataDir: string, options: { headless?: boolean }) => ({
                    userDataDir,
                    headless: options.headless ?? false,
                }),
            },
        }));

        const ctx = await launchPersistentBrowser({
            profileDir: '/tmp/kk-profile',
            headless: true,
        });

        expect(ctx).toEqual({ userDataDir: '/tmp/kk-profile', headless: true });
    });
});
