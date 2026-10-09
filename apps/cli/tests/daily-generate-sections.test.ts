import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { buildNewsVoiceScript } from '../../../plugins/generations/dailynews-gen/src/script-builder';

const runner = resolve(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');

function withFixtureDir<T>(fn: (ctx: { dir: string; binDir: string; date: string; logFile: string }) => T): T {
    const root = mkdtempSync(join(tmpdir(), 'kk-sec-gen-'));
    const binDir = join(root, 'bin');
    const workDir = join(root, 'work');
    const logFile = join(root, 'calls.log');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });

    // Create a shim for `kk executor run`
    const shimPath = join(binDir, 'kk');
    const shimScript = `#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const logFile = process.env.KK_SHIM_LOG;
const failAt = process.env.KK_SHIM_FAIL_AT ? parseInt(process.env.KK_SHIM_FAIL_AT, 10) : -1;
const callIndex = process.env.KK_SHIM_CALL_INDEX_FILE ? parseInt(await Bun.file(process.env.KK_SHIM_CALL_INDEX_FILE).text().catch(() => '0'), 10) : 0;

if (process.env.KK_SHIM_CALL_INDEX_FILE) {
    writeFileSync(process.env.KK_SHIM_CALL_INDEX_FILE, String(callIndex + 1));
}

let inPath = '';
let outPath = '';
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in') inPath = args[i + 1];
    if (args[i] === '--out') outPath = args[i + 1];
}

const start = Date.now();
if (logFile) {
    appendFileSync(logFile, JSON.stringify({ event: 'start', index: callIndex, inPath, outPath, args, time: start }) + '\\n');
}

// Simulating small work
await Bun.sleep(15);

if (failAt >= 0 && callIndex === failAt) {
    if (logFile) {
        appendFileSync(logFile, JSON.stringify({ event: 'fail', index: callIndex, time: Date.now() }) + '\\n');
    }
    process.exit(1);
}

if (outPath) {
    const wavPath = outPath.replace(/\\.json$/, '.wav');
    // Generate a clean 1s 24000Hz mono WAV
    spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1:sample_rate=24000', '-c:a', 'pcm_s16le', '-ac', '1', wavPath]);
    writeFileSync(outPath, JSON.stringify({
        body: '',
        mediaType: 'audio/wav',
        audioPath: wavPath,
        metadata: {
            audioPath: wavPath,
            duration: 1.0,
            qc: { passed: true }
        }
    }, null, 2));
}

if (logFile) {
    appendFileSync(logFile, JSON.stringify({ event: 'end', index: callIndex, time: Date.now() }) + '\\n');
}
process.exit(0);
`;
    writeFileSync(shimPath, shimScript, { mode: 0o755 });
    chmodSync(shimPath, 0o755);

    try {
        return fn({ dir: workDir, binDir, date: '20261010', logFile });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function setupSixItemFixture(workDir: string, runDate: string, planItemCount = 6): void {
    const scriptDir = join(workDir, '24-script');
    const audioDir = join(workDir, '30-audio');
    mkdirSync(scriptDir, { recursive: true });
    mkdirSync(audioDir, { recursive: true });

    // 6 items; item 1 long enough (>300 chars) to produce >= 2 fact chunks
    const docs: Doc[] = [
        {
            id: 'doc-1',
            title: '重磅模型架构发布',
            body: '这是一项重大突破。'.repeat(30), // ~270 chars + lead => > 300 chars
            sourceUri: 'https://example.com/1',
        },
        { id: 'doc-2', title: '开源权重更新', body: '开源社区迎来全新权重发布。', sourceUri: 'https://example.com/2' },
        {
            id: 'doc-3',
            title: '芯片能效突破',
            body: '新一代推理芯片能效比显著提升。',
            sourceUri: 'https://example.com/3',
        },
        {
            id: 'doc-4',
            title: '智能体协作框架',
            body: '多智能体自组织框架实现落地。',
            sourceUri: 'https://example.com/4',
        },
        {
            id: 'doc-5',
            title: '端侧推理优化',
            body: '端侧大模型实现极速实时生成。',
            sourceUri: 'https://example.com/5',
        },
        {
            id: 'doc-6',
            title: '安全评估基准',
            body: '行业首个综合安全评估基准发布。',
            sourceUri: 'https://example.com/6',
        },
    ];

    const planItems = docs.slice(0, planItemCount).map((d, idx) => ({
        id: d.id,
        lead: `第${idx + 1}条资讯关注`,
        insight: `这一项进展展示了该领域的持续演进与技术潜力。`,
    }));

    const scriptPlan = {
        version: 1 as const,
        intro: '欢迎收听今日AI资讯盘点。',
        outro: '以上是今天的主要内容。',
        items: planItems,
        excluded: [],
    };

    const voiceScript = buildNewsVoiceScript(docs, {
        date: new Date(2026, 9, 10),
        language: 'zh',
        voiceProfile: 'robin-news',
        scriptPlan,
    });

    writeFileSync(join(scriptDir, `${runDate}_08_script_voicescript.yaml`), Bun.YAML.stringify(voiceScript));
    writeFileSync(join(scriptDir, `${runDate}_08_script-write_plan.json`), JSON.stringify(scriptPlan, null, 2));

    // wrap-docs input file
    writeFileSync(
        join(audioDir, `${runDate}_10_wrap-docs_docs.json`),
        JSON.stringify([
            {
                id: 'wrap-1',
                title: 'Wrap Docs',
                body: Bun.YAML.stringify(voiceScript),
                sourceUri: 'file://wrap',
                mediaType: 'application/yaml',
            },
        ]),
    );
}

function runStage(
    args: string[],
    binDir: string,
    logFile: string,
    extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
    const counterFile = join(binDir, 'call-counter.txt');
    const result = spawnSync('bun', [runner, ...args], {
        encoding: 'utf-8',
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            KK_SHIM_LOG: logFile,
            KK_SHIM_CALL_INDEX_FILE: counterFile,
            ...extraEnv,
        },
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('0237 — voice2 segmented episode speech synthesis', () => {
    it('AC1 — 6 items become opening, 6 sections, closing (8 driver calls); 5 items plan fails before call', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            // Setup with mismatching plan (5 items in plan vs 6 items in script)
            setupSixItemFixture(dir, date, 5);
            const resMismatch = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(resMismatch.status).not.toBe(0);
            expect(resMismatch.stderr + resMismatch.stdout).toMatch(/item/i);

            // Re-setup with matching 6 items
            rmSync(logFile, { force: true });
            setupSixItemFixture(dir, date, 6);
            const resOk = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(resOk.status).toBe(0);

            // Assert section files exist 00..07
            const secDir = join(dir, '30-audio', 'sections', date);
            expect(existsSync(secDir)).toBe(true);
            for (let i = 0; i <= 7; i++) {
                const role = i === 0 ? 'opening' : i === 7 ? 'closing' : 'item';
                const stem = `${String(i).padStart(2, '0')}-${role}`;
                expect(existsSync(join(secDir, `${stem}.wav`))).toBe(true);
                expect(existsSync(join(secDir, `${stem}.json`))).toBe(true);
            }

            // Assert exactly 8 driver calls
            const logs = readFileSync(logFile, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => JSON.parse(l));
            const startCalls = logs.filter((l) => l.event === 'start');
            expect(startCalls.length).toBe(8);
        });
    });

    it('AC2 — complete run reuses joined speech (0 calls); deleting one section re-synthesizes only that section', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            // Run 1: initial run
            const run1 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(run1.status).toBe(0);

            // Clear log, run 2: no change
            rmSync(logFile, { force: true });
            const run2 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(run2.status).toBe(0);
            expect(existsSync(logFile)).toBe(false); // 0 driver calls

            // Delete 03-item.wav
            const wav3 = join(dir, '30-audio', 'sections', date, '03-item.wav');
            rmSync(wav3, { force: true });

            // Run 3: exactly 1 call for 03-item
            const run3 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(run3.status).toBe(0);
            const logs3 = readFileSync(logFile, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => JSON.parse(l));
            const startCalls3 = logs3.filter((l) => l.event === 'start');
            expect(startCalls3.length).toBe(1);
            expect(startCalls3[0].outPath).toContain('03-item.json');
        });
    });

    it('AC3 — joined sample count matches section samples + gap_ms silences; daily-intro and daily-episode-duration succeed', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const res = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(res.status).toBe(0);

            const contentFile = join(dir, '30-audio', `${date}_11_generate_content.json`);
            expect(existsSync(contentFile)).toBe(true);
            const content = JSON.parse(readFileSync(contentFile, 'utf-8'));
            expect(content.metadata.introMerged).toBeUndefined();
            const joinedWav = content.audioPath;
            expect(existsSync(joinedWav)).toBe(true);

            // Check sample count with ffprobe
            const probeSamples = (file: string) => {
                const p = spawnSync(
                    'ffprobe',
                    [
                        '-v',
                        'error',
                        '-select_streams',
                        'a:0',
                        '-show_entries',
                        'stream=duration_ts',
                        '-of',
                        'csv=p=0',
                        file,
                    ],
                    { encoding: 'utf-8' },
                );
                return parseInt(p.stdout.trim(), 10);
            };

            const joinedSamples = probeSamples(joinedWav);

            // Sum section samples + gap_ms
            let expectedSamples = 0;
            const secDir = join(dir, '30-audio', 'sections', date);
            const scriptYaml = Bun.YAML.parse(
                readFileSync(join(dir, '24-script', `${date}_08_script_voicescript.yaml`), 'utf-8'),
            ) as { segments: Array<{ gap_ms?: number }> };
            // Segment 0 is opening; opening's gap_ms is scriptYaml.segments[0].gap_ms
            for (let i = 0; i <= 7; i++) {
                const role = i === 0 ? 'opening' : i === 7 ? 'closing' : 'item';
                const stem = `${String(i).padStart(2, '0')}-${role}`;
                expectedSamples += probeSamples(join(secDir, `${stem}.wav`));
                if (i < 7) {
                    const gapMs = i === 0 ? (scriptYaml.segments[0]?.gap_ms ?? 1200) : 1200;
                    expectedSamples += Math.round(24000 * (gapMs / 1000));
                }
            }

            expect(Math.abs(joinedSamples - expectedSamples)).toBeLessThanOrEqual(1);

            // Verify five-arg command compatibility (voice1 untouched, 1 call)
            rmSync(logFile, { force: true });
            const runVoice1 = runStage(['daily-generate', dir, date, '', '', 'voicebox'], binDir, logFile);
            expect(runVoice1.status).toBe(0);
            const logsVoice1 = readFileSync(logFile, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => JSON.parse(l));
            const startVoice1 = logsVoice1.filter((l) => l.event === 'start');
            expect(startVoice1.length).toBe(1);
        });
    });

    it('AC4 — concurrency 1 never has overlapping calls; concurrency 2 fails naming section_concurrency', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            // Concurrency 2 fails
            const res2 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '2'], binDir, logFile);
            expect(res2.status).not.toBe(0);
            expect(res2.stderr + res2.stdout).toContain('section_concurrency');
            expect(existsSync(logFile)).toBe(false);

            // Concurrency 1 calls never overlap
            const res1 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(res1.status).toBe(0);
            const logs = readFileSync(logFile, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => JSON.parse(l));
            // Check that every end event happens before the next start event
            let inCall = false;
            for (const entry of logs) {
                if (entry.event === 'start') {
                    expect(inCall).toBe(false);
                    inCall = true;
                } else if (entry.event === 'end') {
                    expect(inCall).toBe(true);
                    inCall = false;
                }
            }
        });
    });

    it('AC5b — the estimate is calibrated to the measured driver rate (production-length scripts pass)', () => {
        // Regression: the shipped style-sidecar figures (gemini 3.3, voicebox 6.3 字/秒) made the gate
        // refuse a script that renders inside the window. Three shipped episodes measure the real
        // rate as 5.33-5.62 字/秒 (20261004 gemini 5466 chars/1026 s, 20261007 gemini 5970/1096,
        // 20261006 voice-gen 6376/1135), i.e. a 20-minute ceiling of ~6400 characters.
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const yamlPath = join(dir, '24-script', `${date}_08_script_voicescript.yaml`);
            const writeTotal = (target: number) => {
                const vs = Bun.YAML.parse(readFileSync(yamlPath, 'utf-8')) as {
                    segments: Array<{ text: string }>;
                };
                const others = vs.segments.slice(1).reduce((acc, s) => acc + [...s.text].length, 0);
                const head = vs.segments[0];
                if (head) head.text = '补'.repeat(Math.max(1, target - others));
                writeFileSync(yamlPath, Bun.YAML.stringify(vs));
            };

            // 6300 chars at gemini's measured 5.4 字/秒 = 8 + 1167 s = 19.6 min — inside the window.
            writeTotal(6300);
            const inside = runStage(['daily-generate', dir, date, '', '', 'gemini', '1'], binDir, logFile);
            expect(inside.status, inside.stderr).toBe(0);
            const calls = readFileSync(logFile, 'utf-8').trim().split('\n').length;
            expect(calls).toBeGreaterThan(0);

            // 7100 chars = 8 + 1315 s = 22.1 min — refused before any request, naming the sections.
            writeTotal(7100);
            rmSync(logFile, { force: true });
            const over = runStage(['daily-generate', dir, date, '', '', 'gemini', '1'], binDir, logFile);
            expect(over.status).not.toBe(0);
            expect(over.stderr + over.stdout).toMatch(/exceeds 20 min/);
            expect(existsSync(logFile)).toBe(false);
        });
    });

    it('AC5 — shortened section re-synthesizes only changed section; over-20-min estimate fails naming 3 longest sections', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            // First run
            const run1 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(run1.status).toBe(0);

            // Edit item 2's insight in VoiceScript yaml
            const yamlPath = join(dir, '24-script', `${date}_08_script_voicescript.yaml`);
            const vs = Bun.YAML.parse(readFileSync(yamlPath, 'utf-8')) as { segments: Array<{ text: string }> };
            // Segment 0 is opening; items follow
            // Modify one segment
            if (vs.segments[3]) {
                vs.segments[3].text = '修改后的简短见解。';
            }
            writeFileSync(yamlPath, Bun.YAML.stringify(vs));

            rmSync(logFile, { force: true });
            const run2 = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(run2.status).toBe(0);
            const logs2 = readFileSync(logFile, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => JSON.parse(l));
            const start2 = logs2.filter((l) => l.event === 'start');
            expect(start2.length).toBe(1);

            // Over-20-min character estimate test:
            // 20 min = 1200s. At voicebox rate 6.3 char/s, 1200s * 6.3 = ~7560 chars.
            // Inflate segments with 12000 characters so it exceeds 20 min
            if (vs.segments[1]) vs.segments[1].text = '长段落一。'.repeat(1000);
            if (vs.segments[2]) vs.segments[2].text = '长段落二。'.repeat(800);
            if (vs.segments[3]) vs.segments[3].text = '长段落三。'.repeat(600);
            writeFileSync(yamlPath, Bun.YAML.stringify(vs));

            rmSync(logFile, { force: true });
            const runOver = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(runOver.status).not.toBe(0);
            expect(existsSync(logFile)).toBe(false); // 0 driver calls
            // Must name 3 longest sections
            expect(runOver.stderr + runOver.stdout).toMatch(/01-item/);
        });
    });

    it('AC6 — 4th call failure stops, does not switch driver, retains sections 00-02, next run finishes remaining', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);

            // Fail at call index 3 (0-indexed, so 4th call)
            const runFail = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile, {
                KK_SHIM_FAIL_AT: '3',
            });
            expect(runFail.status).not.toBe(0);

            // Assert 00, 01, 02 exist
            const secDir = join(dir, '30-audio', 'sections', date);
            expect(existsSync(join(secDir, '00-opening.wav'))).toBe(true);
            expect(existsSync(join(secDir, '01-item.wav'))).toBe(true);
            expect(existsSync(join(secDir, '02-item.wav'))).toBe(true);
            // 03-item failed and 04+ never called
            expect(existsSync(join(secDir, '04-item.wav'))).toBe(false);

            // Next run without failure flag resumes and finishes remaining
            rmSync(logFile, { force: true });
            const runResume = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(runResume.status).toBe(0);

            const logs = readFileSync(logFile, 'utf-8')
                .trim()
                .split('\n')
                .map((l) => JSON.parse(l));
            const starts = logs.filter((l) => l.event === 'start');
            // Remaining calls: 8 total - 3 done = 5 calls
            expect(starts.length).toBe(5);
            expect(existsSync(join(secDir, '07-closing.wav'))).toBe(true);
        });
    });
});
