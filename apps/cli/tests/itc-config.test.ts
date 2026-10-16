import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    digestItcOptions,
    ItcConfigInvalidError,
    ItcLaunchInvalidError,
    isSafeSlug,
    parseRunDate,
    readItcConfigBlock,
    resolveItcConfigPath,
    resolveItcOptions,
    resolveItcWorkspace,
    slugifyTopicName,
    verifyItcOptionsSnapshot,
} from '../src/itc-config';
import { runItcStage } from '../src/itc-stage';

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-itc-config-'));
    try {
        await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** A hermetic context: a temp $HOME, an explicit config path and a fixed clock. */
function ctx(home: string, extra: Record<string, string> = {}) {
    return {
        env: { HOME: home, ...extra },
        homeDir: home,
        cwd: home,
        now: () => new Date('2026-10-15T09:30:00.000Z'),
    };
}

function writeConfig(home: string, yaml: string): string {
    const dir = join(home, '.config', 'kk');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'config.yaml');
    writeFileSync(path, yaml);
    return path;
}

describe('0303 R4 — invalid ITC configuration stops before mutation', () => {
    it('a missing config file uses compiled defaults and creates nothing', async () => {
        await withTempDir(async (home) => {
            const options = await resolveItcOptions({ topic: 'reliable-workflows' }, ctx(home));
            expect(options.playbook).toBe('generic');
            expect(options.writer).toBe('itc-generating');
            expect(options.sourceLocale).toBe('en');
            expect(options.maxRevisions).toBe(2);
            expect(options.auto).toBe(false);
            // No config file was created.
            expect(() => readFileSync(join(home, '.config/kk/config.yaml'), 'utf-8')).toThrow();
        });
    });

    it('malformed YAML fails naming the file and writes no workspace', async () => {
        await withTempDir(async (home) => {
            const path = writeConfig(home, 'workflows:\n  kk-itc: {unclosed\n');
            expect(() => readItcConfigBlock(path)).toThrow(ItcConfigInvalidError);
            expect(() => readItcConfigBlock(path)).toThrow(/not valid YAML/);
            await expect(resolveItcOptions({ topic: 'x' }, ctx(home))).rejects.toThrow(ItcConfigInvalidError);
            expect(() => readFileSync(join(home, 'works', 'kk-itc', 'x', 'itc-options.json'), 'utf-8')).toThrow();
        });
    });

    it('an unsupported declared key fails naming the key, never the value', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'workflows:\n  kk-itc:\n    secret_preset: my-token-abcdef\n');
            try {
                readItcConfigBlock(join(home, '.config/kk/config.yaml'));
                throw new Error('expected a throw');
            } catch (error) {
                expect(error).toBeInstanceOf(ItcConfigInvalidError);
                const message = (error as Error).message;
                expect(message).toContain('secret_preset');
                // The operator's value must never be echoed into the error.
                expect(message).not.toContain('my-token-abcdef');
            }
        });
    });

    it('a wrong-typed declared value fails naming the key', async () => {
        await withTempDir(async (home) => {
            const path = writeConfig(home, 'workflows:\n  kk-itc:\n    max_revisions: "many"\n');
            expect(() => readItcConfigBlock(path)).toThrow(/max_revisions/);
            writeFileSync(path, 'workflows:\n  kk-itc:\n    research: "yes"\n');
            expect(() => readItcConfigBlock(path)).toThrow(/'workflows\.kk-itc\.research' must be a boolean/);
            writeFileSync(path, 'workflows:\n  kk-itc:\n    source_locale: fr\n');
            expect(() => readItcConfigBlock(path)).toThrow(/source_locale/);
            writeFileSync(path, 'workflows:\n  kk-itc:\n    seo:\n      mode: live\n');
            expect(() => readItcConfigBlock(path)).toThrow(/seo\.mode/);
        });
    });

    it('preserves unrelated top-level keys instead of rejecting them', async () => {
        await withTempDir(async (home) => {
            const path = writeConfig(
                home,
                'works_dir: .works\nworkflows:\n  kk-itc:\n    judge: true\n  kk-daily-ai-voice2:\n    window: 24h\nstore:\n  db_path: /tmp/x.db\n',
            );
            const block = readItcConfigBlock(path);
            expect(block.judge).toBe(true);
        });
    });
});

describe('0303 R3 — ITC workspace follows the configured topic and optional date', () => {
    it('composes <worksRoot>/kk-itc/<topic> by default', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'works_dir: .works\n');
            const options = await resolveItcOptions({ topic: 'reliable-workflows' }, ctx(home));
            expect(options.workDir).toBe(join(home, '.config', 'kk', '.works', 'kk-itc', 'reliable-workflows'));
            expect(options.status).toBe('prepared');
        });
    });

    it('an explicit valid --run-date appends YYYYMMDD', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'works_dir: .works\n');
            const options = await resolveItcOptions({ topic: 'reliable-workflows', runDate: '20261015' }, ctx(home));
            expect(options.workDir).toBe(
                join(home, '.config', 'kk', '.works', 'kk-itc', 'reliable-workflows-20261015'),
            );
        });
    });

    it('rejects an impossible calendar date', async () => {
        await withTempDir(async (home) => {
            await expect(resolveItcOptions({ topic: 't', runDate: '20260230' }, ctx(home))).rejects.toBeInstanceOf(
                ItcLaunchInvalidError,
            );
            expect(parseRunDate('20260230')).toBeNull();
            expect(parseRunDate('2026-10-15')).toBeNull();
            expect(parseRunDate('20261015')).toBe('20261015');
        });
    });

    it('a full directory override wins over the composed path', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'works_dir: .works\n');
            const absolute = join(home, 'elsewhere', 'my-run');
            const options = await resolveItcOptions({ topic: 't', dir: absolute }, ctx(home));
            expect(options.workDir).toBe(absolute);

            const relative = await resolveItcOptions({ topic: 't', dir: 'runs/one' }, ctx(home));
            expect(relative.workDir).toBe(join(home, 'runs', 'one'));
        });
    });

    it('resolves a relative works_dir against the config directory and expands ~ only', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'works_dir: ~/custom-works\n');
            const options = await resolveItcOptions({ topic: 't' }, ctx(home));
            expect(options.worksRoot).toBe(join(home, 'custom-works'));
            expect(options.workDir).toBe(join(home, 'custom-works', 'kk-itc', 't'));
        });
    });

    it('KK_WORKS_DIR outranks the config works_dir', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'works_dir: .works\n');
            const options = await resolveItcOptions(
                { topic: 't' },
                ctx(home, { KK_WORKS_DIR: join(home, 'from-env') }),
            );
            expect(options.worksRoot).toBe(join(home, 'from-env'));
        });
    });

    it('slugifies non-English topic names, rejects separators, and keeps ASCII slugs stable', () => {
        expect(slugifyTopicName('Reliable Workflows')).toBe('reliable-workflows');
        expect(slugifyTopicName('可靠的工作流')).toBe('可靠的工作流');
        expect(slugifyTopicName('A  B---C')).toBe('a-b-c');
        expect(slugifyTopicName('..')).toBeNull();
        expect(slugifyTopicName('a/b')).toBeNull();
        expect(slugifyTopicName('a\\b')).toBeNull();
        expect(slugifyTopicName('')).toBeNull();
        expect(slugifyTopicName('ok-1')).toBe('ok-1');
        expect(isSafeSlug('reliable-workflows')).toBe(true);
        expect(isSafeSlug('Reliable')).toBe(false);
        expect(() =>
            resolveItcWorkspace({ worksRoot: '/w', runDate: null, dated: false, launchProjectRoot: '/' }, '..'),
        ).toThrow(ItcLaunchInvalidError);
    });
});

describe('0303 R5 — the frozen snapshot and resume', () => {
    it('an explicit per-option flag wins over an explicitly supplied --auto', async () => {
        await withTempDir(async (home) => {
            const options = await resolveItcOptions(
                { topic: 't', auto: true, judge: false, research: true },
                ctx(home),
            );
            expect(options.auto).toBe(true);
            // Explicit per-option values are honoured even against --auto.
            expect(options.judge).toBe(false);
            expect(options.research).toBe(true);
            // An omitted option is filled by the auto default.
            expect(options.unslop).toBe(true);
        });
    });

    it('a config-only auto fills omitted options but never overrides configured per-option values', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'workflows:\n  kk-itc:\n    auto: true\n    judge: false\n    research: true\n');
            const options = await resolveItcOptions({ topic: 't' }, ctx(home));
            expect(options.auto).toBe(true);
            expect(options.judge).toBe(false);
            expect(options.research).toBe(true);
            expect(options.unslop).toBe(true);
        });
    });

    it('distinguishes an absent option from an explicit false', async () => {
        await withTempDir(async (home) => {
            const absent = await resolveItcOptions({ topic: 't' }, ctx(home));
            expect(absent.judge).toBe(false); // compiled default
            const explicit = await resolveItcOptions({ topic: 't', judge: false, auto: true }, ctx(home));
            expect(explicit.judge).toBe(false); // explicit false outranks auto
        });
    });

    it('--playbook wechat implies zh only without an explicit source locale', async () => {
        await withTempDir(async (home) => {
            const implied = await resolveItcOptions({ topic: 't', playbook: 'wechat' }, ctx(home));
            expect(implied.sourceLocale).toBe('zh');
            const explicit = await resolveItcOptions({ topic: 't', playbook: 'wechat', sourceLocale: 'ja' }, ctx(home));
            expect(explicit.sourceLocale).toBe('ja');
        });
    });

    it('freezes the options and verifies a resume against the SAME snapshot', async () => {
        await withTempDir(async (home) => {
            writeConfig(home, 'works_dir: .works\n');
            const first = await resolveItcOptions({ topic: 't', parentRunId: 'run-1' }, ctx(home));
            expect(first.status).toBe('prepared');
            const { optionsDigest, frozenAt, ...digestInput } = first;
            expect(optionsDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(typeof frozenAt).toBe('string');
            expect(first.optionsDigest).toBe(digestItcOptions(digestInput));

            const workspace = first.workDir as string;
            mkdirSync(workspace, { recursive: true });
            writeFileSync(join(workspace, 'itc-options.json'), `${JSON.stringify(first, null, 2)}\n`);

            const same = await resolveItcOptions({ topic: 't', parentRunId: 'run-1' }, ctx(home));
            expect((await verifyItcOptionsSnapshot(workspace, same)).ok).toBe(true);

            // Ambient config now points somewhere else; the run must NOT silently change directory.
            writeConfig(home, 'works_dir: /somewhere/else\n');
            const changed = await resolveItcOptions({ topic: 't', parentRunId: 'run-1' }, ctx(home));
            const verdict = await verifyItcOptionsSnapshot(workspace, changed);
            expect(verdict.ok).toBe(false);
            if (verdict.ok === false) expect(verdict.reason).toContain('resume refused');
        });
    });

    it('a collected-topic source is intake with no workspace yet', async () => {
        await withTempDir(async (home) => {
            const options = await resolveItcOptions({ fromCollect: 'ai-news', topicProfile: 'ai-news' }, ctx(home));
            expect(options.status).toBe('intake');
            expect(options.workDir).toBeNull();
            expect(options.topicName).toBeNull();
            expect(options.sourceKind).toBe('from_collect');
        });
    });

    it('requires exactly one source and keeps input-file values as literal data', async () => {
        await withTempDir(async (home) => {
            await expect(resolveItcOptions({}, ctx(home))).rejects.toBeInstanceOf(ItcLaunchInvalidError);
            await expect(resolveItcOptions({ topic: 'a', inputFile: 'b.md' }, ctx(home))).rejects.toThrow(
                /exactly one/,
            );

            // Shell metacharacters must survive as data, never be interpreted.
            const weird = `weird $HOME \`whoami\` ; rm -rf / -- "quoted".md`;
            const options = await resolveItcOptions({ inputFile: weird }, ctx(home));
            expect(options.sourceValue).toBe(weird);
            expect(options.sourceKind).toBe('input_file');
            // The workspace leaf comes from the basename; the raw value is never used as a path.
            expect(options.topicName).toBe('quoted');
            expect(options.workDir).not.toContain('whoami');
        });
    });

    it('resolveItcConfigPath honours KK_CONFIG and otherwise uses ~/.config/kk/config.yaml', () => {
        expect(resolveItcConfigPath({}, '/home/u')).toBe(join('/home/u', '.config', 'kk', 'config.yaml'));
        expect(resolveItcConfigPath({ KK_CONFIG: '~/alt.yaml' }, '/home/u')).toBe(join('/home/u', 'alt.yaml'));
        expect(resolveItcConfigPath({ KK_CONFIG: '/abs/alt.yaml' }, '/home/u')).toBe('/abs/alt.yaml');
    });
});

describe('0303 R2 — the itc-prepare stage entry', () => {
    it('writes the frozen snapshot for a valid launch under the configured works root', async () => {
        await withTempDir(async (home) => {
            const configPath = writeConfig(home, 'works_dir: .works\nworkflows:\n  kk-itc:\n    judge: true\n');
            const request = join(home, 'launch.json');
            writeFileSync(request, JSON.stringify({ topic: 'reliable-workflows', parentRunId: 'run-abc' }));

            // The stage resolves against the REAL process env; pin HOME/KK_CONFIG for the duration.
            const priorConfig = process.env.KK_CONFIG;
            const priorHome = process.env.HOME;
            process.env.KK_CONFIG = configPath;
            process.env.HOME = home;
            try {
                expect(await runItcStage(['itc-prepare', '--request', request])).toBe(0);
            } finally {
                if (priorConfig === undefined) delete process.env.KK_CONFIG;
                else process.env.KK_CONFIG = priorConfig;
                if (priorHome === undefined) delete process.env.HOME;
                else process.env.HOME = priorHome;
            }

            const snapshot = JSON.parse(
                readFileSync(join(home, '.config/kk/.works/kk-itc/reliable-workflows/itc-options.json'), 'utf-8'),
            );
            expect(snapshot.judge).toBe(true);
            expect(snapshot.optionsDigest).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    it('fails loud without a request file and returns 1 on an invalid config', async () => {
        expect(await runItcStage(['itc-prepare'])).toBe(1);
        expect(await runItcStage(['itc-prepare', '--request', '/nonexistent/launch.json'])).toBe(1);
    });
});
