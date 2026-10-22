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
// 20261012: fail EVERY call from this index on — a persistent failure, where FAIL_AT fails one.
const failFrom = process.env.KK_SHIM_FAIL_FROM ? parseInt(process.env.KK_SHIM_FAIL_FROM, 10) : -1;
const callIndex = process.env.KK_SHIM_CALL_INDEX_FILE ? parseInt(await Bun.file(process.env.KK_SHIM_CALL_INDEX_FILE).text().catch(() => '0'), 10) : 0;

if (process.env.KK_SHIM_CALL_INDEX_FILE) {
    writeFileSync(process.env.KK_SHIM_CALL_INDEX_FILE, String(callIndex + 1));
}

const plugin = args[2] ?? '';
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

if ((failAt >= 0 && callIndex === failAt) || (failFrom >= 0 && callIndex >= failFrom)) {
    if (logFile) {
        appendFileSync(logFile, JSON.stringify({ event: 'fail', index: callIndex, time: Date.now() }) + '\\n');
    }
    process.exit(1);
}

if (outPath) {
    const wavPath = outPath.replace(/\\.json$/, '.wav');
    // Generate a clean 1s mono WAV; rate is overridable so the 24 kHz regression and the
    // 0257 48 kHz native-rate join both run through the same harness.
    const rate = process.env.KK_SHIM_SAMPLE_RATE ?? '24000';
    spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1:sample_rate=' + rate, '-c:a', 'pcm_s16le', '-ac', '1', wavPath]);
    writeFileSync(outPath, JSON.stringify({
        title: 'Section',
        body: '',
        format: 'audio',
        references: [],
        mediaType: 'audio/wav',
        audioPath: wavPath,
        metadata: {
            // 0257 R2: section reuse requires the driving generator's identity, so the fake
            // executor stamps the real provenance the driver would (kk:<plugin>).
            generator: 'kk:' + plugin,
            audioPath: wavPath,
            duration: 1.0,
            // The real driver stamps one entry per spoken segment; the join must carry them into the
            // joined Content or podcast-pub's timeline renders 0:00 for every item.
            segments: [{ duration: 1.0, transcription: 'セクション' }],
            qc: {
                passed: true,
                overallScore: 100,
                totalDuration: 1.0,
                segmentAudits: [{ segmentIndex: 0, duration: 1.0, passed: true }],
                criticalIssues: []
            }
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

/** Rewrite the fixture VoiceScript so its spoken text totals ~`target` characters. */
function writeScriptTotal(yamlPath: string, target: number): void {
    const vs = Bun.YAML.parse(readFileSync(yamlPath, 'utf-8')) as { segments: Array<{ text: string }> };
    const others = vs.segments.slice(1).reduce((acc, s) => acc + [...s.text].length, 0);
    const head = vs.segments[0];
    if (head) head.text = '补'.repeat(Math.max(1, target - others));
    writeFileSync(yamlPath, Bun.YAML.stringify(vs));
}

/** Minimal `daily-episode-duration` input: a final content at `seconds` plus a non-empty kept pool. */
function setupDurationFixture(workDir: string, runDate: string, seconds: number): void {
    const audioDir = join(workDir, '30-audio');
    const planDir = join(workDir, '21-plan');
    mkdirSync(audioDir, { recursive: true });
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
        join(audioDir, `${runDate}_11_generate_content.json`),
        JSON.stringify({ title: 'Daily AI News', body: '', metadata: { duration: seconds } }),
    );
    writeFileSync(
        join(planDir, `${runDate}_04_quality-control-content_candidates.json`),
        JSON.stringify({
            metadata: {
                docs: [
                    { id: 'doc-1', title: '重磅模型架构发布', body: '这是一项重大突破。'.repeat(10) },
                    { id: 'doc-2', title: '开源权重更新', body: '开源社区迎来全新权重发布。' },
                ],
            },
        }),
    );
}

function startEvents(logFile: string): Array<{ args: string[]; outPath: string }> {
    return readFileSync(logFile, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { event: string; args: string[]; outPath: string })
        .filter((entry) => entry.event === 'start');
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
    }, 30_000);

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
    }, 30_000);

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

            // Verify five-arg command compatibility (voice1 untouched, 1 call). The sectioned join
            // left a valid QC-passing cache at the same path, so drop it to exercise the whole-
            // document render path (0257 R2: a valid cache should otherwise be reused).
            rmSync(contentFile, { force: true });
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
    }, 30_000);

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
    }, 30_000);

    it('AC5b — the estimate is calibrated to the measured driver rate (production-length scripts pass)', () => {
        // Regression: the shipped style-sidecar figures (gemini 3.3, voicebox 6.3 字/秒) made the gate
        // refuse a script that renders inside the window. Three shipped episodes measure the real
        // rate as 5.33-5.62 字/秒 (20261004 gemini 5466 chars/1026 s, 20261007 gemini 5970/1096,
        // 20261006 voice-gen 6376/1135), i.e. a 20-minute ceiling of ~6400 characters.
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const yamlPath = join(dir, '24-script', `${date}_08_script_voicescript.yaml`);
            const writeTotal = (target: number) => writeScriptTotal(yamlPath, target);

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
    }, 30_000);

    it('AC5c — a widened `episode_max_minutes` raises the pre-spend ceiling', () => {
        // The workflow passes its `episode_max_minutes` to the stage, so the estimate and the measured
        // `daily-episode-duration` gate share one ceiling (operator decision 2026-10-09: 25 min, because
        // the ingested bodies are spoken in full and real pools rendered 22-46 minutes).
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const yamlPath = join(dir, '24-script', `${date}_08_script_voicescript.yaml`);

            // 7100 chars = 22.1 min: refused at the 20-minute default (AC5b), admitted at 25.
            writeScriptTotal(yamlPath, 7100);
            const widened = runStage(['daily-generate', dir, date, '', '', 'gemini', '1', '25'], binDir, logFile);
            expect(widened.status, widened.stderr).toBe(0);
            expect(existsSync(logFile)).toBe(true);

            // 8300 chars = 25.7 min is still refused, and the message names the ceiling it exceeded.
            writeScriptTotal(yamlPath, 8300);
            rmSync(logFile, { force: true });
            const over = runStage(['daily-generate', dir, date, '', '', 'gemini', '1', '25'], binDir, logFile);
            expect(over.status).not.toBe(0);
            expect(over.stderr + over.stdout).toMatch(/exceeds 25 min/);
            expect(existsSync(logFile)).toBe(false);
        });
    }, 30_000);

    it('refuses a non-numeric `episode_max_minutes` before any synthesis instead of defaulting to 20', () => {
        // A typo'd workflow var must not silently fall back to the 20-minute default while the
        // measured `daily-episode-duration` gate fails on the same value.
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const bad = runStage(['daily-generate', dir, date, '', '', 'gemini', '1', '2O'], binDir, logFile);
            expect(bad.status).not.toBe(0);
            expect(bad.stderr + bad.stdout).toMatch(/invalid episode_max_minutes: 2O/);
            expect(existsSync(logFile)).toBe(false);
        });
    }, 30_000);

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
    }, 30_000);

    it('AC6 — a section that fails once is retried and the episode still completes (0269-shape)', () => {
        // 20261012 hardening: one failed section used to cost the whole episode, which is the one
        // artefact nothing can publish without. A transient driver failure (a 429 once the quota
        // window drains, a network blip) now spends one extra request on that section instead.
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const runFail = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile, {
                KK_SHIM_FAIL_AT: '3',
            });
            expect(runFail.status, runFail.stderr).toBe(0);
            expect(runFail.stdout).toContain('retrying it once');
            const secDir = join(dir, '30-audio', 'sections', date);
            // Every section rendered, including the one that failed first time and the later ones
            // the old behaviour never reached.
            for (const stem of [
                '00-opening',
                '01-item',
                '02-item',
                '03-item',
                '04-item',
                '05-item',
                '06-item',
                '07-closing',
            ]) {
                expect(existsSync(join(secDir, `${stem}.wav`)), `${stem} rendered`).toBe(true);
            }
        });
    }, 30_000);

    it('AC6b — a section that keeps failing stops the run, retains sections 00-02 and does not switch driver', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);

            // Fail at call index 3 AND every call after it: the bounded retry must not become an
            // unbounded one, and a driver switch mid-episode would mix two voices.
            const runFail = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile, {
                KK_SHIM_FAIL_FROM: '3',
            });
            expect(runFail.status).not.toBe(0);
            expect(runFail.stderr).toContain('section synthesis failed for 03-item');

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
    }, 30_000);

    it('gemini quota probe runs once per generate path and a failure falls the whole run back to voicebox', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const ok = runStage(['daily-generate', dir, date, '', '', 'gemini', '1'], binDir, logFile);
            expect(ok.status, ok.stderr).toBe(0);
            const starts = startEvents(logFile);
            expect(starts[0]?.outPath).toContain('.gemini-probe-out.json');
            expect(starts[0]?.args).toContain('gemini-tts');
            expect(starts.slice(1)).toHaveLength(8);
            expect(starts.slice(1).every((call) => call.args.includes('gemini-tts'))).toBe(true);
            expect(existsSync(join(dir, '30-audio', '.gemini-probe-in.json'))).toBe(false);
            expect(existsSync(join(dir, '30-audio', '.gemini-probe-out.json'))).toBe(false);
        });

        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const failed = runStage(['daily-generate', dir, date, '', '', 'gemini', '1'], binDir, logFile, {
                KK_SHIM_FAIL_AT: '0',
            });
            expect(failed.status, failed.stderr).toBe(0);
            expect(failed.stdout).toContain('falling back to voicebox');
            const starts = startEvents(logFile);
            expect(starts[0]?.args).toContain('gemini-tts');
            expect(starts.slice(1)).toHaveLength(8);
            expect(starts.slice(1).every((call) => call.args.includes('voice-gen'))).toBe(true);
        });

        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const voice1 = runStage(['daily-generate', dir, date, '', '', 'gemini'], binDir, logFile);
            expect(voice1.status, voice1.stderr).toBe(0);
            const starts = startEvents(logFile);
            expect(starts).toHaveLength(2);
            expect(starts[0]?.outPath).toContain('.gemini-probe-out.json');
            expect(starts[1]?.args).toContain('gemini-tts');
            expect(starts[1]?.outPath).toContain(`${date}_11_generate_content.json`);
            expect(existsSync(join(dir, '30-audio', '.gemini-probe-in.json'))).toBe(false);
        });

        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const voice1 = runStage(['daily-generate', dir, date, '', '', 'gemini'], binDir, logFile, {
                KK_SHIM_FAIL_AT: '0',
            });
            expect(voice1.status, voice1.stderr).toBe(0);
            expect(voice1.stdout).toContain('falling back to voicebox');
            const starts = startEvents(logFile);
            expect(starts).toHaveLength(2);
            expect(starts[0]?.args).toContain('gemini-tts');
            expect(starts[1]?.args).toContain('voice-gen');
        });
    }, 30_000);
});

describe('publish MP3 for a driver without native MP3 output (0171 R2 / voice2 first publishing tick)', () => {
    // The scheduled voice2 run failed at `daily-publish-prep`: vdriver=gemini writes WAV only,
    // `VOICE_GEN_MP3` is honoured by voice-gen alone, so metadata.mp3Path was never recorded and the
    // stage refused the enclosure. `transcode_mp3` is the workflow's contract, so generate owns it.
    it('daily-generate writes the sibling MP3 and records metadata.mp3Path when transcode_mp3 is true', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const contentPath = join(dir, '30-audio', `${date}_11_generate_content.json`);
            const mp3Path = join(dir, '30-audio', `${date}_11_generate_content.mp3`);
            const res = runStage(['daily-generate', dir, date, '', 'true', 'voicebox', '1'], binDir, logFile);
            expect(res.status, res.stderr).toBe(0);
            expect(res.stdout).toContain(`generate: wrote publish MP3 ${mp3Path}`);
            expect(existsSync(mp3Path)).toBe(true);
            const meta = (JSON.parse(readFileSync(contentPath, 'utf-8')) as { metadata: Record<string, unknown> })
                .metadata;
            expect(meta.mp3Path).toBe(mp3Path);
        });
    }, 30_000);

    it('the sectioned join carries metadata.segments so show-notes offsets are real', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const res = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(res.status, res.stderr).toBe(0);
            const meta = (
                JSON.parse(readFileSync(join(dir, '30-audio', `${date}_11_generate_content.json`), 'utf-8')) as {
                    metadata: Record<string, unknown>;
                }
            ).metadata;
            const segments = meta.segments as Array<{ duration?: number; transcription?: string }>;
            // 8 driver calls = opening + 6 items + closing, one sidecar each.
            expect(segments).toHaveLength(8);
            expect(segments.every((s) => typeof s.duration === 'number')).toBe(true);
        });
    }, 30_000);

    it('daily-generate leaves the WAV-only content untouched when transcode_mp3 is off', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const res = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(res.status, res.stderr).toBe(0);
            expect(existsSync(join(dir, '30-audio', `${date}_11_generate_content.mp3`))).toBe(false);
            const meta = (
                JSON.parse(readFileSync(join(dir, '30-audio', `${date}_11_generate_content.json`), 'utf-8')) as {
                    metadata: Record<string, unknown>;
                }
            ).metadata;
            expect(meta.mp3Path).toBeUndefined();
        });
    }, 30_000);
});

describe('0257 — VoxCPM wiring: driver-aware whole-document and sectioned audio reuse', () => {
    const contentPath = (dir: string, date: string): string =>
        join(dir, '30-audio', `${date}_11_generate_content.json`);
    const probeScalar = (file: string, entries: string): string =>
        spawnSync(
            'ffprobe',
            ['-v', 'error', '-select_streams', 'a:0', '-show_entries', entries, '-of', 'csv=p=0', file],
            {
                encoding: 'utf-8',
            },
        ).stdout.trim();
    const probeSamples = (file: string): number => parseInt(probeScalar(file, 'stream=duration_ts'), 10);

    it('AC1 — whole-document vdriver=voxcpm renders voxcpm-tts with no Gemini probe', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const res = runStage(['daily-generate', dir, date, '', '', 'voxcpm'], binDir, logFile);
            expect(res.status, res.stderr).toBe(0);
            const starts = startEvents(logFile);
            expect(starts).toHaveLength(1);
            expect(starts[0]?.args).toContain('voxcpm-tts');
            expect(starts[0]?.args).not.toContain('gemini-tts');
            expect(res.stdout).not.toContain('gemini quota probe');
            const meta = (
                JSON.parse(readFileSync(contentPath(dir, date), 'utf-8')) as { metadata: Record<string, unknown> }
            ).metadata;
            expect(meta.generator).toBe('kk:voxcpm-tts');
        });
    }, 30_000);

    it('AC1/R2 — a matching whole-document cache reuses without a probe; a missing MP3 is repaired with zero generator calls', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const first = runStage(['daily-generate', dir, date, '', 'true', 'voicebox'], binDir, logFile);
            expect(first.status, first.stderr).toBe(0);
            const contentFile = contentPath(dir, date);
            const mp3Path = contentFile.replace(/\.json$/, '.mp3');
            expect(existsSync(mp3Path)).toBe(true);

            // Valid matching cache → reuse, 0 generator calls.
            rmSync(logFile, { force: true });
            const second = runStage(['daily-generate', dir, date, '', 'true', 'voicebox'], binDir, logFile);
            expect(second.status, second.stderr).toBe(0);
            expect(second.stdout).toContain('audio cached');
            expect(existsSync(logFile)).toBe(false);

            // Matching valid speech missing only the derivative → transcode, no resynthesis.
            rmSync(mp3Path, { force: true });
            const seeded = JSON.parse(readFileSync(contentFile, 'utf-8')) as { metadata: Record<string, unknown> };
            seeded.metadata.mp3Path = '';
            writeFileSync(contentFile, JSON.stringify(seeded));
            rmSync(logFile, { force: true });
            const third = runStage(['daily-generate', dir, date, '', 'true', 'voicebox'], binDir, logFile);
            expect(third.status, third.stderr).toBe(0);
            expect(third.stdout).toContain('wrote publish MP3');
            expect(existsSync(logFile)).toBe(false); // zero generator calls
            expect(existsSync(mp3Path)).toBe(true);
        });
    }, 30_000);

    it('AC3 — foreign, legacy and corrupt whole-document caches regenerate', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const contentFile = contentPath(dir, date);
            const wavPath = join(dir, '30-audio', 'cached.wav');
            spawnSync('ffmpeg', [
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'sine=frequency=700:duration=1:sample_rate=24000',
                '-c:a',
                'pcm_s16le',
                '-ac',
                '1',
                wavPath,
            ]);
            const seed = (metadata: Record<string, unknown>) => {
                writeFileSync(
                    contentFile,
                    JSON.stringify({ title: 'cached', body: '', format: 'audio', audioPath: wavPath, metadata }),
                );
                rmSync(logFile, { force: true });
                const res = runStage(['daily-generate', dir, date, '', '', 'voicebox'], binDir, logFile);
                expect(res.status, res.stderr).toBe(0);
                expect(startEvents(logFile)).toHaveLength(1); // miss → one voice-gen render
            };
            // foreign driver identity
            seed({ generator: 'kk:gemini-tts', audioPath: wavPath, duration: 1, qc: { passed: true } });
            // legacy metadata without a generator
            seed({ audioPath: wavPath, duration: 1, qc: { passed: true } });
            // matching identity but a missing/corrupt WAV
            seed({
                generator: 'kk:voice-gen',
                audioPath: join(dir, '30-audio', 'missing.wav'),
                duration: 1,
                qc: { passed: true },
            });
        });
    }, 30_000);

    it('AC2/R4 — 48 kHz sections join at 48 kHz with native sample counts and gaps', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const res = runStage(['daily-generate', dir, date, '', 'true', 'voxcpm', '1'], binDir, logFile, {
                KK_SHIM_SAMPLE_RATE: '48000',
            });
            expect(res.status, res.stderr).toBe(0);
            const final = JSON.parse(readFileSync(contentPath(dir, date), 'utf-8')) as {
                audioPath: string;
                metadata: Record<string, unknown>;
            };
            expect(final.metadata.generator).toBe('kk:voxcpm-tts');
            expect(probeScalar(final.audioPath, 'stream=sample_rate')).toBe('48000');

            const secDir = join(dir, '30-audio', 'sections', date);
            const scriptYaml = Bun.YAML.parse(
                readFileSync(join(dir, '24-script', `${date}_08_script_voicescript.yaml`), 'utf-8'),
            ) as { segments: Array<{ gap_ms?: number }> };
            let expectedSamples = 0;
            for (let i = 0; i <= 7; i++) {
                const role = i === 0 ? 'opening' : i === 7 ? 'closing' : 'item';
                const stem = `${String(i).padStart(2, '0')}-${role}`;
                expectedSamples += probeSamples(join(secDir, `${stem}.wav`));
                if (i < 7) {
                    const gapMs = i === 0 ? (scriptYaml.segments[0]?.gap_ms ?? 1200) : 1200;
                    expectedSamples += Math.round(48000 * (gapMs / 1000));
                }
            }
            expect(Math.abs(probeSamples(final.audioPath) - expectedSamples)).toBeLessThanOrEqual(1);
            expect(final.metadata.segments).toHaveLength(8);
            expect(existsSync(final.metadata.mp3Path as string)).toBe(true);
        });
    }, 30_000);

    it('AC3 — a stale or foreign joined final is rejoint from cached sections with no model calls', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const first = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(first.status, first.stderr).toBe(0);
            const contentFile = contentPath(dir, date);
            const readFinal = () =>
                JSON.parse(readFileSync(contentFile, 'utf-8')) as { metadata: Record<string, unknown> };
            expect((readFinal().metadata.sectionHashes as string[]).length).toBe(8);

            // Sections stay valid; only the frozen join identity is stale.
            const stale = readFinal();
            stale.metadata.sectionHashes = [];
            writeFileSync(contentFile, JSON.stringify(stale));
            rmSync(logFile, { force: true });
            const resumed = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(resumed.status, resumed.stderr).toBe(0);
            expect(existsSync(logFile)).toBe(false); // rejoined cached sections, no synthesis
            expect((readFinal().metadata.sectionHashes as string[]).length).toBe(8);

            // Foreign joined Content with matching section files must not early-return either.
            const foreign = readFinal();
            foreign.metadata.generator = 'kk:gemini-tts';
            writeFileSync(contentFile, JSON.stringify(foreign));
            rmSync(logFile, { force: true });
            const fixed = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1'], binDir, logFile);
            expect(fixed.status, fixed.stderr).toBe(0);
            expect(existsSync(logFile)).toBe(false);
            expect(readFinal().metadata.generator).toBe('kk:voice-gen');
        });
    }, 30_000);

    it('AC3 — matching valid sections with only the joined MP3 missing transcode once with zero generator calls', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const first = runStage(['daily-generate', dir, date, '', 'true', 'voicebox', '1'], binDir, logFile);
            expect(first.status, first.stderr).toBe(0);
            const contentFile = contentPath(dir, date);
            const meta = (JSON.parse(readFileSync(contentFile, 'utf-8')) as { metadata: Record<string, unknown> })
                .metadata;
            const mp3Path = meta.mp3Path as string;
            expect(existsSync(mp3Path)).toBe(true);

            rmSync(mp3Path, { force: true });
            rmSync(logFile, { force: true });
            const second = runStage(['daily-generate', dir, date, '', 'true', 'voicebox', '1'], binDir, logFile);
            expect(second.status, second.stderr).toBe(0);
            expect(second.stdout).toContain('joined speech reused');
            expect(existsSync(logFile)).toBe(false); // zero generator calls
            expect(existsSync(mp3Path)).toBe(true);
        });
    }, 30_000);

    it('AC2/AC3 — a fresh join rebuilds the ordered timeline and leaks no previous-run metadata', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const first = runStage(['daily-generate', dir, date, '', 'true', 'voicebox', '1'], binDir, logFile);
            expect(first.status, first.stderr).toBe(0);
            const contentFile = contentPath(dir, date);

            // Poison the final with previous-run junk, then change one section's text to force a
            // fresh join (that section's hash changes → it resynthesises).
            const poisoned = JSON.parse(readFileSync(contentFile, 'utf-8')) as { metadata: Record<string, unknown> };
            poisoned.metadata.generator = 'kk:gemini-tts';
            poisoned.metadata.qc = { passed: false, criticalIssues: ['stale'] };
            poisoned.metadata.mp3Path = '/nope.mp3';
            poisoned.metadata.introMerged = true;
            poisoned.metadata.segments = [{ duration: 999, transcription: 'STALE' }];
            writeFileSync(contentFile, JSON.stringify(poisoned));

            const yamlPath = join(dir, '24-script', `${date}_08_script_voicescript.yaml`);
            const vs = Bun.YAML.parse(readFileSync(yamlPath, 'utf-8')) as { segments: Array<{ text: string }> };
            const target = vs.segments[3];
            if (target === undefined) throw new Error('fixture drift: the script has no 4th segment to modify');
            target.text = '修改后的简短内容。';
            writeFileSync(yamlPath, Bun.YAML.stringify(vs));

            rmSync(logFile, { force: true });
            const second = runStage(['daily-generate', dir, date, '', 'true', 'voicebox', '1'], binDir, logFile);
            expect(second.status, second.stderr).toBe(0);
            expect(startEvents(logFile)).toHaveLength(1); // only the changed section

            const final = JSON.parse(readFileSync(contentFile, 'utf-8')) as { metadata: Record<string, unknown> };
            expect(final.metadata.generator).toBe('kk:voice-gen');
            expect(final.metadata.introMerged).toBeUndefined();
            expect((final.metadata.qc as { passed: boolean }).passed).toBe(true);
            const segments = final.metadata.segments as Array<{ duration?: number; transcription?: string }>;
            expect(segments).toHaveLength(8);
            expect(segments.every((s) => typeof s.duration === 'number')).toBe(true);
            expect(segments.some((s) => s.transcription === 'STALE')).toBe(false);
            expect(final.metadata.mp3Path).not.toBe('/nope.mp3');
            expect(existsSync(final.metadata.mp3Path as string)).toBe(true);
            expect((final.metadata.sectionHashes as string[]).length).toBe(8);
        });
    }, 30_000);

    it('AC2 — daily-intro merges the joined output and daily-episode-duration reads the merged length', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            const gen = runStage(['daily-generate', dir, date, '', 'true', 'voicebox', '1'], binDir, logFile);
            expect(gen.status, gen.stderr).toBe(0);
            const contentFile = contentPath(dir, date);
            const readMeta = () =>
                (JSON.parse(readFileSync(contentFile, 'utf-8')) as { metadata: Record<string, unknown> }).metadata;
            const before = readMeta();
            expect(typeof before.mp3Path).toBe('string');

            const introPath = join(dir, 'intro.wav');
            spawnSync('ffmpeg', [
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'sine=frequency=330:duration=0.5:sample_rate=24000',
                '-c:a',
                'pcm_s16le',
                '-ac',
                '1',
                introPath,
            ]);
            const intro = runStage(['daily-intro', dir, date, introPath], binDir, logFile);
            expect(intro.status, intro.stderr).toBe(0);
            const after = readMeta();
            expect(after.introMerged).toBe(true);
            expect((after.audioPath as string).endsWith('.intro.wav')).toBe(true);
            expect(existsSync(after.audioPath as string)).toBe(true);
            expect(after.duration as number).toBeGreaterThan(before.duration as number);
            // the publish MP3 is re-transcoded from the merged audio at the same recorded path
            expect(after.mp3Path).toBe(before.mp3Path);
            expect(existsSync(after.mp3Path as string)).toBe(true);

            // the duration gate consumes the merged metadata: an ~8.5 s episode is under the floor,
            // which since 0266 refuses-and-closes (exit 0 + refusal artifact) instead of aborting
            const dur = runStage(['daily-episode-duration', dir, date, '15', '20', 'voicebox'], binDir, logFile);
            expect(dur.status, dur.stderr).toBe(0);
            const refusalPath = join(dir, '30-audio', `${date}_11_generate_content_duration-refusal.json`);
            const refusal = JSON.parse(readFileSync(refusalPath, 'utf-8')) as {
                measuredMinutes: number;
            };
            // the refusal records the merged length the gate read (intro sting included)
            expect(refusal.measuredMinutes).toBeCloseTo(Math.round(((after.duration as number) / 60) * 10) / 10, 5);
            expect(refusal.measuredMinutes).toBeLessThan(15);
            expect(dur.stderr + dur.stdout).toContain('below the 15');
        });
    }, 30_000);
});

describe('0266 — post-spend duration refusal closes the run as no-content', () => {
    const candidatesPath = (dir: string, date: string) =>
        join(dir, '21-plan', `${date}_04_quality-control-content_candidates.json`);
    const refusalPath = (dir: string, date: string) =>
        join(dir, '30-audio', `${date}_11_generate_content_duration-refusal.json`);

    it('AC2 — an under-floor episode writes the refusal artifact, empties the candidates and exits 0', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupDurationFixture(dir, date, 510); // 8.5 min — under the 15-min floor, post-spend
            const dur = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(dur.status, dur.stderr).toBe(0);
            const refusal = JSON.parse(readFileSync(refusalPath(dir, date), 'utf-8')) as Record<string, unknown>;
            expect(refusal.measuredMinutes).toBe(8.5);
            expect(refusal.minMinutes).toBe(15);
            expect(refusal.keptCount).toBe(2);
            expect(refusal.candidateChars).toBeGreaterThan(0);
            expect(typeof refusal.estimatedMinutes).toBe('number');
            const kept = JSON.parse(readFileSync(candidatesPath(dir, date), 'utf-8')) as {
                metadata: { docs: unknown[] };
            };
            expect(kept.metadata.docs).toEqual([]);
            expect(dur.stderr + dur.stdout).toContain('below the 15');
        });
    });

    it('AC2 — a rerun with the refusal artifact already present changes nothing (idempotency)', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupDurationFixture(dir, date, 510);
            const first = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(first.status, first.stderr).toBe(0);
            const refusalBefore = readFileSync(refusalPath(dir, date), 'utf-8');
            const candidatesBefore = readFileSync(candidatesPath(dir, date), 'utf-8');
            const second = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(second.status, second.stderr).toBe(0);
            expect(readFileSync(refusalPath(dir, date), 'utf-8')).toBe(refusalBefore);
            expect(readFileSync(candidatesPath(dir, date), 'utf-8')).toBe(candidatesBefore);
        });
    });

    it('AC2 — a rerun after a kill between the refusal and the candidates write still empties the candidates', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupDurationFixture(dir, date, 510);
            const candidatesBefore = readFileSync(candidatesPath(dir, date), 'utf-8');
            const first = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(first.status, first.stderr).toBe(0);
            const refusalBefore = readFileSync(refusalPath(dir, date), 'utf-8');
            // Simulate the crash window: the refusal landed, the candidates write did not.
            writeFileSync(candidatesPath(dir, date), candidatesBefore);
            const second = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(second.status, second.stderr).toBe(0);
            expect(readFileSync(refusalPath(dir, date), 'utf-8')).toBe(refusalBefore);
            const kept = JSON.parse(readFileSync(candidatesPath(dir, date), 'utf-8')) as {
                metadata: { docs: unknown[] };
            };
            expect(kept.metadata.docs).toEqual([]);
        });
    });

    it('AC2 — a passing gate leaves a duration verdict artifact (2026-10-22)', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupDurationFixture(dir, date, 17 * 60); // 17 min — inside the 15–25 min window
            const dur = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(dur.status, dur.stderr).toBe(0);
            // An 8.4-min episode published on 2026-10-20 with nothing on disk saying whether this
            // gate ran, passed, or was a stale stage body — the pass now leaves its own record.
            const verdict = JSON.parse(
                readFileSync(join(dir, '30-audio', `${date}_11_generate_content_duration.json`), 'utf-8'),
            ) as Record<string, unknown>;
            expect(verdict).toEqual({ measuredMinutes: 17, minMinutes: 15, maxMinutes: 25, ok: true });
            expect(existsSync(refusalPath(dir, date))).toBe(false);
        });
    });

    it('AC2 — an over-max episode still fails loud and writes no refusal artifact', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupDurationFixture(dir, date, 26 * 60); // 26 min — above the 25-min ceiling
            const dur = runStage(['daily-episode-duration', dir, date, '15', '25', 'voicebox'], binDir, logFile);
            expect(dur.status).not.toBe(0);
            expect(dur.stderr + dur.stdout).toContain('above the 15–25');
            expect(existsSync(refusalPath(dir, date))).toBe(false);
        });
    });
});

/**
 * 2026-10-22: `daily-generate` gates the authored VoiceScript before the TTS spend. QC's
 * candidate-text estimate cannot predict the spoken length (20261020 planned for 31.6 min and
 * rendered 8.4), so a thin day used to pay for the full synthesis and only then be refused.
 */
describe('2026-10-22 — pre-spend script floor gate in daily-generate', () => {
    const refusalPath = (dir: string, date: string) =>
        join(dir, '30-audio', `${date}_11_generate_content_duration-refusal.json`);
    const candidatesPath = (dir: string, date: string) =>
        join(dir, '21-plan', `${date}_04_quality-control-content_candidates.json`);

    it('refuses a thin script before any TTS call: script refusal artifact, emptied candidates, exit 0', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            setupDurationFixture(dir, date, 510);
            // ~2000 spoken chars ≈ 6 min at the 5.6 字/秒 voicebox band — far under the 15-min floor.
            writeScriptTotal(join(dir, '24-script', `${date}_08_script_voicescript.yaml`), 2000);
            rmSync(logFile, { force: true });

            const res = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1', '25', '15'], binDir, logFile);
            expect(res.status, res.stderr).toBe(0);
            expect(res.stderr + res.stdout).toContain('below the 15 min floor');
            // Nothing was synthesized: the driver was never invoked.
            expect(existsSync(logFile) ? startEvents(logFile).length : 0).toBe(0);

            const refusal = JSON.parse(readFileSync(refusalPath(dir, date), 'utf-8')) as Record<string, unknown>;
            expect(refusal.stage).toBe('script');
            expect(refusal.minMinutes).toBe(15);
            expect(refusal.measuredMinutes).toBeUndefined();
            expect(refusal.estimatedMinutes as number).toBeLessThan(15);
            expect(refusal.keptCount).toBe(2);
            const kept = JSON.parse(readFileSync(candidatesPath(dir, date), 'utf-8')) as {
                metadata: { docs: unknown[] };
            };
            expect(kept.metadata.docs).toEqual([]);
        });
    }, 30_000);

    it('lets a script that clears the floor through to the driver, and writes no refusal', () => {
        withFixtureDir(({ dir, binDir, date, logFile }) => {
            setupSixItemFixture(dir, date, 6);
            setupDurationFixture(dir, date, 510);
            // ~6500 spoken chars ≈ 19.5 min — clears the floor, so the synthesis must proceed.
            writeScriptTotal(join(dir, '24-script', `${date}_08_script_voicescript.yaml`), 6500);
            rmSync(logFile, { force: true });

            const res = runStage(['daily-generate', dir, date, '', '', 'voicebox', '1', '25', '15'], binDir, logFile);
            expect(res.status, res.stderr).toBe(0);
            expect(res.stdout).toContain('script floor ok');
            expect(startEvents(logFile).length).toBeGreaterThan(0);
            expect(existsSync(refusalPath(dir, date))).toBe(false);
        });
    }, 30_000);
});
