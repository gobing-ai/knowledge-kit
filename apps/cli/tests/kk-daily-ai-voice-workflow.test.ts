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
 */
describe('kk-daily-ai-voice workflow (0074)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-daily-ai-voice.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R1 & R5 — walks state machine states with done/failed terminals', () => {
        expect(stateIds).toEqual([
            'prepare',
            'fetch',
            'ingest-last30days',
            'ingest-horizon',
            'blend-facts',
            'plan',
            'plan-translate',
            'article',
            'cover',
            'script',
            'review',
            'wrap-docs',
            'generate',
            'quality-control',
            'show-notes',
            'publish-prep',
            'publish',
            'translate-en',
            'translate-en-agent',
            'translate-ja',
            'translate-ja-agent',
            'translate-sync',
            'done',
            'failed',
        ]);
        expect(yaml).toContain('name: kk-daily-ai-voice');
        expect(yaml).toContain('kind: state-machine');
        expect(yaml).toContain('"$schema":');
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
        // last30days disable routes fetch directly to Horizon (F61 speed-up).
        expect(yaml).toContain('test "$' + '{vars.last30days_enabled}" != "true"');
        // Date-stamped caching: article/script/cover outputs carry $' + '{vars.run_date}.
        expect(yaml).toContain('article-$' + '{vars.run_date}.md');
        expect(yaml).toContain('voicescript-$' + '{vars.run_date}.yaml');
        expect(yaml).toContain('cover-$' + '{vars.run_date}.png');
        // Audio is cached when the day's content.json exists and QC passed.
        // Publish fan-out shells into postsurfing's own spur workflow — unset the recursion guard.
        expect(yaml).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE');
    });

    it('R3 & R5 — invokes the pipeline plugins through kk executor (incl. fan-in/fan-out)', () => {
        expect(yaml).toContain('kk executor run aihot-ingest');
        expect(yaml).toContain('kk executor run last30days-ingest');
        expect(yaml).toContain('kk executor run horizon-ingest');
        expect(yaml).toContain('kk executor fan-in');
        expect(yaml).toContain('kk executor run core-facts-gen');
        expect(yaml).toContain('kk executor run daily-article-gen');
        expect(yaml).toContain('kk executor run dailynews-gen');
        expect(yaml).toContain('kk executor run voice-gen');
        expect(yaml).toContain('kk executor fan-out');
        expect(yaml).toContain('kind: hitl.confirm');

        expect(yaml).toContain('pause: true');
    });

    it('R5 — supports review bypass via skip_review=true', () => {
        expect(yaml).toContain('test "$' + '{vars.skip_review}" = "true"');
    });

    it('R5 — executes all plugin commands and creates pipeline artifacts', () => {
        if (!Bun.which('spur', { PATH: process.env.PATH })) {
            return;
        }
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
const inPath = flag('--in');
const outPath = flag('--out');
if (args[0] !== 'executor') process.exit(2);

if (args[1] === 'fan-in') {
    const ins = flags('--in');
    if (!ins.length || !outPath) process.exit(2);
    const merged = ins.flatMap((p) => JSON.parse(readFileSync(p, 'utf8')));
    mkdirSync(dirname(outPath), { recursive: true });
    appendFileSync(process.env.KK_TEST_CALL_LOG, JSON.stringify({ plugin: 'fan-in', inPath: ins.join('+'), outPath, pluginsPath: flag('--plugins-path') }) + '\\n');
    writeFileSync(outPath, JSON.stringify(merged));
    process.exit(0);
}

const plugin = args[2];
if (args[1] !== 'run' || !plugin || !inPath || !outPath) process.exit(2);
mkdirSync(dirname(outPath), { recursive: true });
appendFileSync(process.env.KK_TEST_CALL_LOG, JSON.stringify({
    plugin,
    inPath,
    outPath,
    pluginsPath: flag('--plugins-path'),
    language: process.env.DAILYNEWS_LANGUAGE,
    title: process.env.DAILYNEWS_TITLE,
    voiceProfile: process.env.VOICEBOX_DEFAULT_PROFILE,
}) + '\\n');

const DOC = (id) => [{ id, title: 'AI News ' + id, sourceUri: 'https://example.com/' + id, body: 'Body ' + id, mediaType: 'text/markdown' }];

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
            });
            const result = Bun.spawnSync(
                ['spur', 'workflow', 'run', workflowPath, '--vars', vars, '--run-id', runId, '--json'],
                {
                    cwd: join(import.meta.dir, '../../..'),
                    env: {
                        ...process.env,
                        KK_TEST_CALL_LOG: callLog,
                        PATH: `${binDir}:${process.env.PATH ?? ''}`,
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            );

            expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
            expect(existsSync(join(workDir, '1-ingest/source.json'))).toBe(true);
            expect(existsSync(join(workDir, '1-ingest/docs.json'))).toBe(true);
            expect(existsSync(join(workDir, '1-ingest/last30days-docs.json'))).toBe(true);
            const runDate = readFileSync(join(workDir, 'run-date.txt'), 'utf8').trim();
            expect(existsSync(join(workDir, `1-ingest/horizon-docs-${runDate}.json`))).toBe(true);
            expect(existsSync(join(workDir, '1-ingest/blended.json'))).toBe(true);
            expect(existsSync(join(workDir, '2-facts/content.json'))).toBe(true);
            expect(existsSync(join(workDir, '2-facts/core-facts.md'))).toBe(true);
            expect(existsSync(join(workDir, '2-plan/content.json'))).toBe(true);
            expect(existsSync(join(workDir, '2-plan/plan.json'))).toBe(true);
            expect(existsSync(join(workDir, `2-article/content-${runDate}.json`))).toBe(true);
            expect(existsSync(join(workDir, `2-article/article-${runDate}.md`))).toBe(true);
            expect(existsSync(join(workDir, `2-script/content-${runDate}.json`))).toBe(true);
            expect(existsSync(join(workDir, `2-script/voicescript-${runDate}.yaml`))).toBe(true);
            expect(existsSync(join(workDir, '3-audio/docs.json'))).toBe(true);
            expect(existsSync(join(workDir, '3-audio/content.json'))).toBe(true);
            expect(existsSync(join(workDir, '3-audio/content.wav'))).toBe(true);

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
                'daily-article-gen',
                'dailynews-gen',
                'voice-gen',
            ]);
            const scriptCall = calls.find((call) => call.plugin === 'dailynews-gen');
            expect(scriptCall).toMatchObject({ language: 'en', title: 'AI Today', voiceProfile: 'Alex' });
            expect(scriptCall?.inPath).toContain('plan.json');
            expect(calls.every((call) => call.pluginsPath === join(testRoot, 'plugin root'))).toBe(true);

            const wrappedDocs = JSON.parse(readFileSync(join(workDir, '3-audio/docs.json'), 'utf8'));
            expect(wrappedDocs[0].metadata.voiceProfile).toBe('Alex');
        } finally {
            rmSync(testRoot, { recursive: true, force: true });
        }
    });
});
