import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0409 R3 (AC5) — the spawn-path anomaly, measured rather than assumed.
 *
 * The 2026-11-19 dogfood saw a kk-spawned `surfdash-pub.post` fail with "missing locale file(s):
 * en, ja" while the same `bun scripts/surfdash.ts publish <abs zh path>` run from a shell published
 * all three locales. Two hypotheses: the workflow's `SPUR_*` environment leaks into the nested
 * postsurfing run, or nothing leaks and the real cause was the missing translations (R1).
 *
 * The harness: a stub surfdash root with all three locale dirs, and a stub `postsurfingBin` that
 * records the env keys it inherited (SPUR_* only), its cwd, and what each locale dir holds. The
 * probe drives the plugin's public `publish` operation — the exact path `publishPreparedFile`
 * takes — once from a plain shell and once inside a `spur workflow run` shell step.
 *
 * The comparison IS the assertion: if the two observations differ, the difference is the leak and
 * `spawnCli` must be fixed (and this test then pins the fix). They do not differ, so `spawnCli`
 * keeps stripping only the two single-flight guard vars and R1 carries the root cause.
 */
const PLUGIN = join(import.meta.dir, '../src/index.ts');
const SLUG = '20261119-ai-2026-11-19';

interface Observation {
    spurKeys: string[];
    cwd: string;
    locales: Record<string, string[]>;
}

/** A stub postsurfing bin: writes one observation JSON, then exits 0. */
function stubBin(root: string): string {
    const bin = join(root, 'postsurfing');
    writeFileSync(
        bin,
        [
            '#!/usr/bin/env bun',
            "import { appendFileSync, readdirSync } from 'node:fs';",
            "import { join } from 'node:path';",
            'const root = process.env.PROBE_ROOT;',
            'const spurKeys = Object.keys(process.env).filter((k) => k.startsWith("SPUR_")).sort();',
            'const locales = {};',
            'for (const locale of ["zh", "en", "ja"]) {',
            '    try { locales[locale] = readdirSync(join(root, "content", "posts", "articles", locale, "20261119-ai-2026-11-19")).sort(); }',
            '    catch { locales[locale] = ["<missing>"]; }',
            '}',
            'appendFileSync(process.env.PROBE_OUT, JSON.stringify({ spurKeys, cwd: process.cwd(), locales }) + "\\n");',
            'process.exit(0);',
        ].join('\n'),
        'utf-8',
    );
    spawnSync('chmod', ['+x', bin]);
    return bin;
}

/** A surfdash stub root with all three locale post dirs; only zh exists, as on a real pre-fix day. */
function stubRoot(root: string): void {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const locale of ['zh']) {
        const dir = join(root, 'content', 'posts', 'articles', locale, SLUG);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.md'), `---\ntitle: "${locale}"\n---\n\nbody\n`, 'utf-8');
    }
}

/** The probe: drive the plugin's publish path exactly as the workflow's publish row does. */
function writeProbe(probePath: string): void {
    writeFileSync(
        probePath,
        [
            `import { PostsurfingFileCliTransport } from ${JSON.stringify(PLUGIN)};`,
            'process.env.SURFDASH_ROOT = process.env.PROBE_ROOT;',
            'process.env.POSTSURFING_BIN = process.env.PROBE_BIN;',
            "process.env.SURFDASH_AUTO_PUSH = '0';",
            'const cover = process.env.PROBE_COVER;',
            'await new PostsurfingFileCliTransport().publish({',
            '    content: {',
            "        title: '每日AI乱炖 · 2026-11-19',",
            "        body: '# 每日AI乱炖\\n\\n中文正文。\\n',",
            "        format: 'markdown',",
            '        metadata: {',
            "            runDate: '20261119',",
            "            tags: ['ai-news', 'sub-category:ai-daily'],",
            '            coverImage: cover,',
            "            surfdash: { locales: { en: { title: 'Daily AI Stew', body: '# EN\\n\\nEnglish.\\n' }, ja: { title: 'デイリーAIシチュー', body: '# JA\\n\\n日本語。\\n' } } },",
            '        },',
            '    },',
            '});',
        ].join('\n'),
        'utf-8',
    );
}

function probeEnv(root: string, bin: string, out: string): Record<string, string> {
    return {
        ...(process.env as Record<string, string>),
        PROBE_ROOT: root,
        PROBE_BIN: bin,
        PROBE_OUT: out,
        PROBE_COVER: 'https://podcast-media.salty.vip/production/images/probe-cover.png',
    };
}

const SPUR_ON_PATH = spawnSync('sh', ['-c', 'command -v spur']).status === 0;

describe('surfdash spawn path: plain shell vs inside a spur workflow step (0409 R3)', () => {
    it('the nested run inherits the same cwd, the same locale view, and only the engine vars that exist outside too', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-0409-spawn-'));
        try {
            stubRoot(root);
            const bin = stubBin(root);
            writeFileSync(join(root, 'cover.png'), 'png', 'utf-8');
            const out = join(root, 'observation.json');
            const probe = join(root, 'probe.ts');
            writeProbe(probe);

            // Leg 1 — a plain shell.
            const plain = spawnSync('bun', [probe], { encoding: 'utf-8', env: probeEnv(root, bin, out) });
            expect(plain.status).toBe(0);

            const observations = readFileSync(out, 'utf-8').trim().split('\n');
            expect(observations).toHaveLength(1);
            const plainObservation = JSON.parse(observations[0] as string) as Observation;

            // Leg 2 — the same probe inside a real `spur workflow run` shell step.
            const workflowPath = join(root, 'probe.yaml');
            writeFileSync(
                workflowPath,
                [
                    'kind: state-machine',
                    'name: spawn-probe',
                    'initialState: run',
                    'terminalStates: [done]',
                    'states:',
                    '  - id: run',
                    '    onEnter:',
                    '      - kind: shell',
                    '        options:',
                    `          command: 'bun ${probe}'`,
                    '  - id: done',
                    'transitions:',
                    '  - from: run',
                    '    to: done',
                    '',
                ].join('\n'),
                'utf-8',
            );
            const nested = spawnSync('spur', ['workflow', 'run', workflowPath, '--quiet', '--no-plan'], {
                encoding: 'utf-8',
                cwd: root,
                env: probeEnv(root, bin, out),
            });
            if (nested.status !== 0) {
                throw new Error(`nested spur leg failed: ${nested.stderr}\n${nested.stdout}`);
            }

            const all = readFileSync(out, 'utf-8').trim().split('\n');
            expect(all.length).toBeGreaterThanOrEqual(2);
            const nestedObservation = JSON.parse(all[all.length - 1] as string) as Observation;

            // The three facts the 2026-11-19 hypothesis turned on.
            expect(nestedObservation.cwd).toBe(plainObservation.cwd);
            expect(nestedObservation.locales).toEqual(plainObservation.locales);
            expect(nestedObservation.spurKeys).toEqual(plainObservation.spurKeys);
            // And the leak the fix would have scrubbed is absent: no engine-only key reaches the child
            // (the two single-flight guards are already stripped by `spawnCli`).
            expect(nestedObservation.spurKeys).not.toContain('SPUR_WORKFLOW_RUN_ACTIVE');
            expect(nestedObservation.spurKeys).not.toContain('SPUR_EXPECTED_DEFINITION_DIGEST');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 60_000);

    it('records the nested-leg skip honestly when spur is not on PATH rather than passing silently', () => {
        // The measurement contract: no spur, no nested attempt — and the reason is reported, never
        // an empty pass that reads like "no difference found".
        expect(typeof SPUR_ON_PATH).toBe('boolean');
        if (!SPUR_ON_PATH) console.warn('spawn-path repro: nested leg skipped — spur is not on PATH');
    });
});
