import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0074 (F6) — kk-daily-ai-voice workflow static and structural invariants.
 * Verifies states (prepare, fetch, script, review, wrap-docs, generate, done, failed),
 * plugin execution commands (aihot-ingest, dailynews-gen, voice-gen),
 * variables, transitions, and HITL confirm step.
 */
describe('kk-daily-ai-voice workflow (0074)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-daily-ai-voice.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R1 & R5 — walks state machine states with done/failed terminals', () => {
        expect(stateIds).toEqual([
            'prepare',
            'fetch',
            'script',
            'review',
            'wrap-docs',
            'generate',
            'quality-control',
            'done',
            'failed',
        ]);
        expect(yaml).toContain('name: kk-daily-ai-voice');
        expect(yaml).toContain('kind: state-machine');
        expect(yaml).toContain('"$schema":');
        expect(existsSync(workflowPath)).toBe(true);
    });

    it('R2 — defines standard variables for configuration', () => {
        expect(yaml).toContain('work_dir: ""');
        expect(yaml).toContain('limit: "10"');
        expect(yaml).toContain('language: "zh"');
        expect(yaml).toContain('voice_profile: "Robin"');
        expect(yaml).toContain('skip_review: "false"');
        expect(yaml).toContain('transcode_mp3: "false"');
    });

    it('R3 & R5 — invokes aihot-ingest, dailynews-gen, and voice-gen through kk executor', () => {
        expect(yaml).toContain('kk executor run aihot-ingest');
        expect(yaml).toContain('kk executor run dailynews-gen');
        expect(yaml).toContain('kk executor run voice-gen');
        expect(yaml).toContain('kind: hitl.confirm');
        expect(yaml).toContain('pause: true');
    });

    it('R5 — supports review bypass via skip_review=true', () => {
        expect(yaml).toContain('test "$' + '{vars.skip_review}" = "true"');
    });

    it('R5 — executes all three plugin commands and creates pipeline artifacts', () => {
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
const plugin = args[2];
const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const inPath = flag('--in');
const outPath = flag('--out');
if (args[0] !== 'executor' || args[1] !== 'run' || !plugin || !inPath || !outPath) process.exit(2);
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

if (plugin === 'aihot-ingest') {
    const config = JSON.parse(readFileSync(inPath, 'utf8'));
    if (config.limit !== 2 || config.cursor !== 'cursor-1') process.exit(3);
    writeFileSync(outPath, JSON.stringify([{
        id: 'news-1',
        title: 'AI News',
        sourceUri: 'https://example.com/news-1',
        body: 'News summary',
        mediaType: 'text/markdown',
    }]));
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
            expect(existsSync(join(workDir, '2-script/content.json'))).toBe(true);
            expect(existsSync(join(workDir, '2-script/voicescript.yaml'))).toBe(true);
            expect(existsSync(join(workDir, '3-audio/docs.json'))).toBe(true);
            expect(existsSync(join(workDir, '3-audio/content.json'))).toBe(true);
            expect(existsSync(join(workDir, '3-audio/content.wav'))).toBe(true);

            const calls = readFileSync(callLog, 'utf8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            expect(calls.map((call) => call.plugin)).toEqual(['aihot-ingest', 'dailynews-gen', 'voice-gen']);
            expect(calls[1]).toMatchObject({ language: 'en', title: 'AI Today', voiceProfile: 'Alex' });
            expect(calls.every((call) => call.pluginsPath === join(testRoot, 'plugin root'))).toBe(true);

            const wrappedDocs = JSON.parse(readFileSync(join(workDir, '3-audio/docs.json'), 'utf8'));
            expect(wrappedDocs[0].metadata.voiceProfile).toBe('Alex');
        } finally {
            rmSync(testRoot, { recursive: true, force: true });
        }
    });
});
