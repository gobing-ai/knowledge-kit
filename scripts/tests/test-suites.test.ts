import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
    buildTestArgv,
    classifyTestFiles,
    discoverWorkspaceTests,
    HEAVY_BUNFIG_PATH,
    HEAVY_TEST_PATTERNS,
    isHeavyTest,
    main,
} from '../test-suites';
import { captureMainAsync } from './capture-output';

const REPO_ROOT = resolve(import.meta.dir, '../..');

describe('scripts/test-suites (0429)', () => {
    test('fast and heavy partitions are disjoint and their union equals all discovered workspace tests', async () => {
        const all = await discoverWorkspaceTests(REPO_ROOT);
        expect(all.length).toBeGreaterThan(300);

        const { fast, heavy } = classifyTestFiles(all);
        expect(fast.length).toBeGreaterThan(0);
        expect(heavy.length).toBeGreaterThan(0);
        expect(heavy).toContain('apps/cli/tests/content-generate.e2e.test.ts');

        const fastSet = new Set(fast);
        const heavySet = new Set(heavy);
        for (const file of fast) {
            expect(heavySet.has(file)).toBe(false);
        }
        const union = [...fast, ...heavy].sort();
        expect(union).toEqual(all);
        expect(fastSet.size + heavySet.size).toBe(all.length);
    });

    test('every explicit heavy path in HEAVY_TEST_PATTERNS matches at least one real workspace test', async () => {
        const all = await discoverWorkspaceTests(REPO_ROOT);
        for (const pattern of HEAVY_TEST_PATTERNS) {
            if (pattern.includes('*')) continue;
            expect(all).toContain(pattern);
            expect(isHeavyTest(pattern)).toBe(true);
        }
    });

    test('buildTestArgv preserves .coverage for fast and uses isolated bunfig for heavy', () => {
        const fastArgv = buildTestArgv('fast', ['a.test.ts']);
        expect(fastArgv).toContain('--parallel=8');
        expect(fastArgv).toContain('--coverage');
        expect(fastArgv).toContain('--coverage-dir=.coverage');
        expect(fastArgv).toContain('--coverage-reporter=lcov');
        expect(fastArgv.at(-1)).toBe('a.test.ts');

        const heavyArgv = buildTestArgv('heavy', ['b.e2e.test.ts'], ['--bail']);
        expect(heavyArgv).toContain(`--config=${HEAVY_BUNFIG_PATH}`);
        expect(heavyArgv).not.toContain('--coverage');
        expect(heavyArgv).not.toContain('--coverage-dir=.coverage');
        expect(heavyArgv).toContain('--bail');
        expect(heavyArgv.at(-1)).toBe('b.e2e.test.ts');
    });

    test('main rejects invalid mode with exit 2 and forwards selected files to spawn', async () => {
        const invalid = await captureMainAsync(() => main(['invalid'], REPO_ROOT));
        expect(invalid.code).toBe(2);
        expect(invalid.stderr).toContain('usage: bun scripts/test-suites.ts <fast|heavy>');

        let capturedArgv: string[] = [];
        const code = await main(['heavy', '--', '--bail'], REPO_ROOT, ((cmd: string[]) => {
            capturedArgv = cmd;
            return { exitCode: 0 } as ReturnType<typeof Bun.spawnSync>;
        }) as typeof Bun.spawnSync);
        expect(code).toBe(0);
        expect(capturedArgv.some((arg) => arg.startsWith('--config='))).toBe(true);
        expect(capturedArgv).toContain('--bail');
        expect(capturedArgv.some((arg) => arg.endsWith('wechatmp-dom.test.ts'))).toBe(true);
    });
});
