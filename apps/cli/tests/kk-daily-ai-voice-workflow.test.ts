import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0074 (F6) — kk-daily-ai-voice workflow static and structural invariants.
 * Extended 2026-09-03 (F61 destination): states now cover collect (aihot + last30days +
 * Horizon) → blend-facts → article → cover → script → voice → publish; the plugin set grew
 * to aihot-ingest, last30days-ingest, horizon-ingest, core-facts-gen, content-gen,
 * dailynews-gen, voice-gen plus the fan-in/fan-out subcommands.
 * Extended 2026-09-07 (0097): collect collapses fetch, ingest-* and blend-facts into one
 * kk executor fan-in --source state; quality-control-content runs episode-plan-gen filter
 * mode over the EPISODE_PLAN_MODE env channel (kk executor run forwards only --in/--out)
 * with a done-no-content terminal for empty candidate sets; the publish tail adds
 * podcast-pub, surfdash-pub and a publish-partial route.
 */
describe('kk-daily-ai-voice workflow (0074)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-daily-ai-voice.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R1 & R5 — walks state machine states with done/failed terminals', () => {
        expect(stateIds).toEqual([
            'prepare',
            'collect',
            'plan',
            'quality-control-content',
            'plan-translate',
            'article',
            'cover',
            'script',
            'review',
            'wrap-docs',
            'generate',
            'quality-control',
            'publish-prep',
            'publish-surfdash',
            'show-notes',
            'publish-podcast',
            'publish',
            'publish-partial',
            'run-report',
            'translate-en',
            'translate-en-agent',
            'translate-ja',
            'translate-ja-agent',
            'translate-sync',
            'done',
            'done-no-content',
            'failed',
        ]);
        expect(yaml).toContain('name: kk-daily-ai-voice');
        expect(yaml).toContain('kind: state-machine');
        expect(yaml).toContain('"$schema":');
        // 0097: an empty QC'd candidate set terminates done-no-content, not failed.
        expect(yaml).toContain('terminalStates:\n  - done\n  - done-no-content\n  - failed');
        expect(existsSync(workflowPath)).toBe(true);
    });

    it('R2 — defines standard variables for configuration', () => {
        expect(yaml).toContain('voice_profile: "robin-news"');
        expect(yaml).toContain('limit: "10"');
        expect(yaml).toContain('language: "zh"');
        expect(yaml).toContain('skip_review: "false"');
        expect(yaml).toContain('transcode_mp3: "false"');
        expect(yaml).toContain('cover_enabled: "true"');
        expect(yaml).toContain('publish_enabled: "false"');
        expect(yaml).toContain('last30days_enabled: "false"');
        expect(yaml).toContain('run_date: ""');
        // last30days disable writes an empty last30days input in prepare (fan-in --source tolerates it).
        expect(yaml).toContain('"$' + '{vars.last30days_enabled}" != "true"');
        // Content QC thresholds ride the plugin env channel (0099-calibrated DEFAULT_FILTER_CONFIG).
        expect(yaml).toContain('qc_categories: "ai-news,ai-industry"');
        expect(yaml).toContain('qc_min_quality: "2"');
        expect(yaml).toContain('qc_min_importance: "3"');
        expect(yaml).toContain('qc_min_urgency: "2"');
        expect(yaml).toContain('qc_min_impact: "1"');
        expect(yaml).toContain('EPISODE_PLAN_MODE=filter');
        // Date-stamped caching: article/script/cover outputs carry ${vars.run_date}.
        expect(yaml).toContain('article-$' + '{vars.run_date}.md');
        expect(yaml).toContain('voicescript-$' + '{vars.run_date}.yaml');
        expect(yaml).toContain('cover-$' + '{vars.run_date}.png');
        // Audio is cached when the day's content.json exists and QC passed.
        // Publish fan-out shells into postsurfing's own spur workflow — unset the recursion guard.
        expect(yaml).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE');
    });

    it('R1/R2 (N) — cover state invokes kk:image-authoring under the non-interactive contract and normalizes the artifact', () => {
        expect(yaml).toContain('kk:image-authoring');
        expect(yaml).toContain('KK_NONINTERACTIVE=1');
        expect(yaml).toContain('KK_IMAGE_AUTO_CONFIRM=1');
        expect(yaml).toContain('--format cover');
        const workDir = '$' + '{vars.work_dir}';
        const runDate = '$' + '{vars.run_date}';
        expect(yaml).toContain(`--content ${workDir}/2-article/article-${runDate}.md`);
        expect(yaml).toContain(`--out ${workDir}/2-cover`);
        expect(yaml).toContain(`expectFile: ${workDir}/2-cover/content-cover-01.jpg`);
        expect(yaml).toContain(`cover-${runDate}.png`); // canonical downstream artifact stays PNG (sips-normalized from jpg)
        expect(yaml).not.toContain('wt-image-cover');
    });

    it('R3 & R5 — invokes the pipeline plugins through kk executor (incl. fan-in/fan-out)', () => {
        // 0097: the ingest plugins spawn inside kk executor fan-in --source (concurrent collect).
        expect(yaml).toContain('--source "aihot-ingest:');
        expect(yaml).toContain('--source "last30days-ingest:');
        // 0099: horizon's ingest latency (28m39s solo in 0098 r7) straddled the fan-in 30m
        // default — the workflow pins a 45m per-source override for horizon only.
        expect(yaml).toContain('--source-timeout-override "horizon-ingest:2700000"');
        expect(yaml).toContain('--source "horizon-ingest:');
        expect(yaml).toContain('kk executor fan-in --source');
        expect(yaml).toContain('kk executor run core-facts-gen');
        expect(yaml).toContain('kk executor run episode-plan-gen');
        expect(yaml).toContain('kk executor run daily-article-gen');
        expect(yaml).toContain('kk executor run dailynews-gen');
        expect(yaml).toContain('kk executor run $' + '{vars.voice_generator}');
        expect(yaml).toContain('kk executor fan-out');
        expect(yaml).toContain('kk executor run podcast-pub');
        expect(yaml).toContain('kk executor run surfdash-pub');
        expect(yaml).toContain('kind: hitl.confirm');

        expect(yaml).toContain('pause: true');
        // 0097: an empty QC'd candidate set routes to its own terminal, not failed.
        expect(yaml).toContain('done-no-content');
    });

    it('R5 — supports review bypass via skip_review=true', () => {
        expect(yaml).toContain('test "$' + '{vars.skip_review}" = "true"');
    });

    it('R5 — executes all plugin commands and creates pipeline artifacts', () => {
        if (!Bun.which('spur', { PATH: process.env.PATH })) {
            return;
        }
        for (const voiceGenerator of [undefined, 'omni-voice-gen'] as const) {
            const testRoot = mkdtempSync(join(tmpdir(), 'kk-daily-ai-voice-'));
            const binDir = join(testRoot, 'bin');
            const workDir = join(testRoot, 'work dir');
            const fakeKkPath = join(binDir, 'kk');
            const callLog = join(testRoot, 'calls.jsonl');
            const runId = `f6-integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            try {
                mkdirSync(binDir);
                writeFileSync(
                    fakeKkPath,
                    `#!/usr/bin/env bun
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const flags = (name) => {
    const out = [];
    for (let i = 0; i < args.length; i++) if (args[i] === name) out.push(args[i + 1]);
    return out;
};

const DOC = (id) => [{ id, title: 'AI News ' + id, sourceUri: 'https://example.com/' + id, body: 'Body ' + id, mediaType: 'text/markdown' }];

const inPath = flag('--in');
const outPath = flag('--out');
if (args[0] !== 'executor') process.exit(2);

if (args[1] === 'fan-in') {
    const sources = flags('--source');
    const ins = flags('--in');
    if (!outPath || (!sources.length && !ins.length)) process.exit(2);
    mkdirSync(dirname(outPath), { recursive: true });
    // 0097 collect: fan-in --source spawns each ingest plugin with its config file and
    // merges the outputs; the fake emulates the three known sources.
    const sourceDocs = [];
    for (const source of sources) {
        const sep = source.indexOf(':');
        const sourcePlugin = source.slice(0, sep);
        const configPath = source.slice(sep + 1);
        if (sourcePlugin === 'aihot-ingest') {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            if (config.limit !== 2 || config.cursor !== 'cursor-1') process.exit(3);
            sourceDocs.push(...DOC('news-1'));
        } else {
            readFileSync(configPath, 'utf8');
            sourceDocs.push(...DOC(sourcePlugin + '-1'));
        }
        appendFileSync(process.env.KK_TEST_CALL_LOG, JSON.stringify({ plugin: sourcePlugin, inPath: configPath, outPath, via: 'fan-in', pluginsPath: flag('--plugins-path') }) + '\\n');
    }
    const merged = sourceDocs.concat(ins.flatMap((p) => JSON.parse(readFileSync(p, 'utf8'))));
    appendFileSync(process.env.KK_TEST_CALL_LOG, JSON.stringify({ plugin: 'fan-in', inPath: ins.join('+') || sources.join('+'), outPath, via: 'fan-in', pluginsPath: flag('--plugins-path') }) + '\\n');
    writeFileSync(outPath, JSON.stringify(merged));
    process.exit(0);
}

const plugin = args[2];
if (args[1] !== 'run' || !plugin || !inPath || !outPath) process.exit(2);
mkdirSync(dirname(outPath), { recursive: true });
appendFileSync(process.env.KK_TEST_CALL_LOG, JSON.stringify({
    plugin,
    via: 'run',
    inPath,
    outPath,
    pluginsPath: flag('--plugins-path'),
    language: process.env.DAILYNEWS_LANGUAGE,
    title: process.env.DAILYNEWS_TITLE,
    voiceProfile: process.env.VOICEBOX_DEFAULT_PROFILE,
    mode: plugin === 'episode-plan-gen' ? (process.env.EPISODE_PLAN_MODE ?? 'plan') : undefined,
}) + '\\n');

if (plugin === 'aihot-ingest') {
    const config = JSON.parse(readFileSync(inPath, 'utf8'));
    if (config.limit !== 2 || config.cursor !== 'cursor-1') process.exit(3);
    writeFileSync(outPath, JSON.stringify(DOC('news-1')));
} else if (plugin === 'last30days-ingest' || plugin === 'horizon-ingest') {
    readFileSync(inPath, 'utf8');
    writeFileSync(outPath, JSON.stringify(DOC(plugin + '-1')));
} else if (plugin === 'episode-plan-gen') {
    const docs = JSON.parse(readFileSync(inPath, 'utf8'));
    writeFileSync(outPath, JSON.stringify({
        title: 'Episode Plan',
        body: '# Episode Plan\\n\\n' + docs.length + ' items',
        format: 'markdown',
        metadata: { docs },
    }));
    if (process.env.EPISODE_PLAN_MODE === 'filter') {
        writeFileSync(outPath.replace(/\\.json$/, '.rejected.json'), JSON.stringify({ rejected: [], config: {}, total: docs.length }));
    }
} else if (plugin === 'core-facts-gen') {
    const docs = JSON.parse(readFileSync(inPath, 'utf8'));
    writeFileSync(outPath, JSON.stringify({ title: 'Core Facts', body: '# Core Facts\\n\\n' + docs.length + ' items', format: 'markdown' }));
} else if (plugin === 'daily-article-gen') {
    const docs = JSON.parse(readFileSync(inPath, 'utf8'));
    writeFileSync(outPath, JSON.stringify({ title: 'Daily AI News', body: '# Daily article\\n\\n' + docs.length + ' items', format: 'markdown' }));
} else if (plugin === 'dailynews-gen') {
    const docs = JSON.parse(readFileSync(inPath, 'utf8'));
    const script = {
        title: process.env.DAILYNEWS_TITLE,
        language: process.env.DAILYNEWS_LANGUAGE,
        default_profile: process.env.VOICEBOX_DEFAULT_PROFILE,
        segments: [{ text: docs[0].body, gap_ms: 100 }],
    };
    writeFileSync(outPath, JSON.stringify({
        title: script.title,
        body: Bun.YAML.stringify(script),
        format: 'markdown',
    }));
} else if (plugin === 'voice-gen') {
    readFileSync(inPath, 'utf8');
    const wavPath = join(dirname(outPath), 'content.wav');
    writeFileSync(wavPath, 'RIFF-fake-wave');
    writeFileSync(outPath, JSON.stringify({
        title: 'Daily AI News',
        body: wavPath,
        format: 'audio',
        metadata: { audioPath: wavPath },
    }));
} else if (plugin === 'omni-voice-gen') {
    readFileSync(inPath, 'utf8');
    const wavPath = join(dirname(outPath), 'content.wav');
    writeFileSync(wavPath, 'RIFF-fake-wave');
    writeFileSync(outPath, JSON.stringify({
        title: 'Daily AI News',
        body: wavPath,
        format: 'audio',
        metadata: { audioPath: wavPath, generator: 'kk:omni-voice-gen' },
    }));
} else {
    process.exit(4);
}
`,
                );
                chmodSync(fakeKkPath, 0o755);
                const vars = JSON.stringify({
                    work_dir: workDir,
                    limit: '2',
                    language: 'en',
                    voice_profile: 'Alex',
                    title: 'AI Today',
                    cursor: 'cursor-1',
                    state_file: join(testRoot, 'cursor state.json'),
                    skip_review: 'true',
                    cover_enabled: 'false',
                    plan_translate_enabled: 'false',
                    publish_enabled: 'false',
                    last30days_enabled: 'true',
                    plugins_path: join(testRoot, 'plugin root'),
                    voice_generator: voiceGenerator,
                });
                const result = Bun.spawnSync(
                    ['spur', 'workflow', 'run', workflowPath, '--vars', vars, '--run-id', runId, '--json'],
                    {
                        cwd: join(import.meta.dir, '../../..'),
                        env: {
                            ...process.env,
                            // The test itself may run inside a pipeline step — never leak the guard
                            // into the child, or spur refuses to start the workflow under test.
                            SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                            KK_TEST_CALL_LOG: callLog,
                            PATH: `${binDir}:${process.env.PATH ?? ''}`,
                        },
                        stdout: 'pipe',
                        stderr: 'pipe',
                    },
                );

                expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
                expect(existsSync(join(workDir, '1-ingest/source.json'))).toBe(true);
                const runDate = readFileSync(join(workDir, 'run-date.txt'), 'utf8').trim();
                // 0097: per-source docs live in fan-in's internal temp files — only blended.json lands.
                expect(existsSync(join(workDir, '1-ingest/blended.json'))).toBe(true);
                expect(existsSync(join(workDir, '1-ingest/docs.json'))).toBe(false);
                expect(existsSync(join(workDir, '1-ingest/last30days-docs.json'))).toBe(false);
                expect(existsSync(join(workDir, `1-ingest/horizon-docs-${runDate}.json`))).toBe(false);
                expect(existsSync(join(workDir, '2-facts/content.json'))).toBe(true);
                expect(existsSync(join(workDir, '2-facts/core-facts.md'))).toBe(true);
                expect(existsSync(join(workDir, '2-plan/content.json'))).toBe(true);
                expect(existsSync(join(workDir, '2-plan/plan.json'))).toBe(true);
                expect(existsSync(join(workDir, '2-plan/annotated.json'))).toBe(true);
                expect(existsSync(join(workDir, '2-plan/candidates.json'))).toBe(true);
                expect(existsSync(join(workDir, '2-plan/candidates.rejected.json'))).toBe(true);
                expect(existsSync(join(workDir, `2-article/content-${runDate}.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-article/article-${runDate}.md`))).toBe(true);
                expect(existsSync(join(workDir, `2-script/content-${runDate}.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-script/voicescript-${runDate}.yaml`))).toBe(true);
                expect(existsSync(join(workDir, '3-audio/docs.json'))).toBe(true);
                expect(existsSync(join(workDir, '3-audio/content.json'))).toBe(true);
                expect(existsSync(join(workDir, '3-audio/content.wav'))).toBe(true);
                if (voiceGenerator) {
                    const swapped = JSON.parse(readFileSync(join(workDir, '3-audio/content.json'), 'utf8'));
                    expect(swapped.metadata.generator).toBe('kk:omni-voice-gen');
                }

                const calls = readFileSync(callLog, 'utf8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line));
                expect(calls.map((call) => call.plugin)).toEqual([
                    'aihot-ingest',
                    'last30days-ingest',
                    'horizon-ingest',
                    'fan-in',
                    'core-facts-gen',
                    'episode-plan-gen',
                    'episode-plan-gen',
                    'daily-article-gen',
                    'dailynews-gen',
                    voiceGenerator ?? 'voice-gen',
                ]);
                // 0097: plan run then QC filter run — the filter rides EPISODE_PLAN_MODE because
                // kk executor run forwards only --in/--out (0092 spawn contract).
                expect(calls.filter((call) => call.plugin === 'episode-plan-gen').map((call) => call.mode)).toEqual([
                    'plan',
                    'filter',
                ]);
                const scriptCall = calls.find((call) => call.plugin === 'dailynews-gen');
                expect(scriptCall).toMatchObject({ language: 'en', title: 'AI Today', voiceProfile: 'Alex' });
                expect(scriptCall?.inPath).toContain('plan.json');
                // fan-in has no --plugins-path flag (0097: collect must not forward one) — only run calls do.
                expect(calls.find((call) => call.plugin === 'fan-in')?.pluginsPath).toBeUndefined();
                expect(
                    calls
                        .filter((call) => call.via === 'run')
                        .every((call) => call.pluginsPath === join(testRoot, 'plugin root')),
                ).toBe(true);

                const wrappedDocs = JSON.parse(readFileSync(join(workDir, '3-audio/docs.json'), 'utf8'));
                expect(wrappedDocs[0].metadata.voiceProfile).toBe('Alex');
            } finally {
                rmSync(testRoot, { recursive: true, force: true });
            }
        }
    }, 30000);
});
