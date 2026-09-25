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
    // 0133: the stage bodies (paths, cache predicates, plugin argv) live in the shared runner.
    const runnerSource = readFileSync(
        join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts'),
        'utf-8',
    );
    // 0144: absolute path injected into the integration fake kk's `stage` delegation.
    const stagesAbs = join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R1 & R5 — walks state machine states with done/failed terminals', () => {
        expect(stateIds).toEqual([
            'prepare',
            'collect',
            'plan',
            'quality-control-content',
            'plan-translate',
            'article-write',
            'article',
            'cover',
            'script-write',
            'script',
            'review',
            'wrap-docs',
            'generate',
            'intro-music',
            'quality-control',
            'publish-prep',
            'publish-surfdash',
            'show-notes',
            'publish-podcast',
            'publish',
            'patch-surfdash',
            'publish-partial',
            'run-report',
            'translate',
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
        // F614 0163: the cover render pins provider+model in vars — the pin is part of the style
        // contract (each provider has its own look), and stays a var because the right value
        // depends on which credentials the machine has.
        expect(yaml).toContain('cover_provider: "minimax"');
        expect(yaml).toContain('cover_model: "image-01"');
        // F613 0162 R3: script-write authors the per-item plan; "false" routes straight to script.
        expect(yaml).toContain('script_write_enabled: "true"');
        expect(yaml).toContain('publish_enabled: "false"');
        expect(yaml).toContain('last30days_enabled: "false"');
        expect(yaml).toContain('run_date: ""');
        expect(yaml).toContain('agent: "inline"');
        // last30days disable writes an empty last30days input in prepare (fan-in --source tolerates it).
        // 0133: the parameter validation + source-config writes live in the stage runner;
        // 0144: the YAML delegates through `kk stage` (the kbin/pkg/st prelude is gone).
        expect(yaml).toContain('kk stage daily-prepare');
        expect(runnerSource).toContain("last30daysEnabled !== 'true'");
        expect(runnerSource).toContain("'1-ingest/last30days-docs.json'");
        expect(yaml).toContain('vdriver: "voicebox"');
        expect(yaml).toContain('intro_music: ".works/kk-daily-ai-voice/AI每日资讯_8秒播客片头.mp3"');
        expect(yaml).toContain('surfdash_root: "/Users/robin/xprojects/surfdash"');
        // Content QC thresholds ride the plugin env channel (0099-calibrated DEFAULT_FILTER_CONFIG).
        expect(yaml).toContain('qc_categories: "ai-news,ai-technical,ai-research,ai-industry"');
        expect(yaml).toContain('qc_min_quality: "2"');
        expect(yaml).toContain('qc_min_importance: "3"');
        expect(yaml).toContain('qc_min_urgency: "2"');
        expect(yaml).toContain('qc_min_impact: "1"');
        // 0133: the QC filter mode rides the plugin env the runner's daily-qc-content stage sets.
        expect(runnerSource).toContain("EPISODE_PLAN_MODE: 'filter'");
        // Step-output naming convention: {run_date}_{NN}_{step_name}_{artifact}.{ext} (redo-by-delete;
        // see docs/design/kk-daily-ai-voice.md section 4).
        expect(yaml).toContain(`\${vars.run_date}_06_article-write_body.md`);
        expect(yaml).toContain(`\${vars.run_date}_08_script_voicescript.yaml`);
        expect(yaml).toContain(`\${vars.run_date}_07_cover_cover.png`);
        // Audio is cached when the day's content.json exists and QC passed (daily-generate).
        expect(runnerSource).toContain('qc?.passed === true');
        // Publish fan-out shells into postsurfing's own spur workflow — the runner unsets both
        // async-launcher vars (run-active guard + digest binding) at the nested-spur boundary.
        expect(runnerSource).toContain('const NESTED_SPUR_UNSET = [');
        expect(runnerSource).toContain("'SPUR_WORKFLOW_RUN_ACTIVE', 'SPUR_EXPECTED_DEFINITION_DIGEST'");
        expect(runnerSource).toContain('unset: NESTED_SPUR_UNSET');
    });

    it('R2/R6 (F614 0163) — cover state writes the lead-item brief then renders through the pinned daily-cover stage', () => {
        // F614: the agent authors ONLY the subject brief; format/style/provider/model are pinned
        // by the stage, so the old kk:image-authoring skill invocation must be gone entirely —
        // keeping it would leave a second, style-drifting path to the same cover.
        expect(yaml).not.toContain('kk:image-authoring');
        expect(yaml).not.toContain('--format cover');
        expect(yaml).not.toContain('KK_IMAGE_AUTO_CONFIRM=1');
        const workDir = '$' + '{vars.work_dir}';
        const runDate = '$' + '{vars.run_date}';
        const block = yaml.match(/- id: cover\n[\s\S]*?(?=\n {2}- id: )/)?.[0] ?? '';
        expect(block).not.toBe('');
        // R2: the brief step reads the lead plan item, caps itself at 240 chars, writes JSON.
        expect(block).toContain('onError: continue');
        expect(block).toContain('allowAppend: false');
        expect(block).toContain(`expectFile: ${workDir}/2-cover/${runDate}_07_cover-brief.json`);
        expect(block).toContain(`2-plan/\${vars.run_date}_03_plan_plan.json`);
        expect(block).toContain('≤240 characters');
        expect(block).toContain('{"subject": "..."}');
        // R3: the stage owns the pinned render; normalize is unchanged.
        expect(block).toContain(
            `kk stage daily-cover "${workDir}" "${runDate}" "${'$'}{vars.plugins_path}" "${'$'}{vars.cover_provider}" "${'$'}{vars.cover_model}"`,
        );
        expect(block).toContain(`kk stage daily-cover-normalize "${workDir}" "${runDate}"`);
        // The canonical downstream artifact keeps its name (podcast + surfdash read it).
        expect(yaml).toContain(`${runDate}_07_cover_cover.png`);
        expect(yaml).not.toContain('wt-image-cover');
    });

    it('R2/R3 (0144) — every delegated action is a one-line `kk stage` call and the prompts stay under the cap', () => {
        // 0144: the six-line kbin/pkg/st prelude moved into the `kk stage` verb (apps/cli/src/stage.ts),
        // which resolves the shipped stages script from the installed package. The YAML must carry no
        // prelude remnants and exactly one delegation call per stage (22 -> 23 sites: daily-cover
        // joined in F614 0163 R3).
        for (const remnant of ['kbin="$(command -v kk', 'st="$pkg/plugins/kk/scripts', 'not found at $st']) {
            expect(yaml, `prelude remnant ${remnant}`).not.toContain(remnant);
        }
        expect(yaml.split('kk stage daily-').length - 1).toBe(23);
        // ADR-115 R3: the trimmed prompts stay under the 1000-char error tier (cover brief: F614 0163).
        for (const [step, cap] of [
            ['plan-translate', 1000],
            ['cover', 1000],
            ['script-write', 1000],
        ] as const) {
            const block = yaml.match(new RegExp(`- id: ${step}\\n[\\s\\S]*?(?=\\n  - id: )`))?.[0] ?? '';
            const input = block.split('input: |')[1]?.split('expectFile:')[0] ?? '';
            expect(input.length, `${step} prompt chars`).toBeLessThanOrEqual(cap);
        }
    });

    it('R4 (0138) — the plan-translate prompt carries the copy-discipline contract', () => {
        // The prompt is the primary defence against research scaffolding reaching published copy;
        // the deterministic strip in daily-article-gen is the fallback. Naming each scaffold label
        // and hedging marker here is what keeps the prompt from silently losing the contract.
        const block = yaml.match(/- id: plan-translate\n[\s\S]*?(?=\n {2}- id: )/)?.[0] ?? '';
        expect(block).not.toBe('');
        for (const marker of [
            'Copy discipline',
            'reader-facing news copy',
            'duplicated labels',
            '可做角度',
            '为什么现在值得注意',
            '社区讨论',
            '背景',
            '潜在影响',
            '影响',
            '读者宜另行核实',
            '仍待验证',
        ]) {
            expect(block, `${marker} in the plan-translate prompt`).toContain(marker);
        }
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
        // 0133: every kk invocation moved into the runner; 0144: the YAML keeps one-line
        // `kk stage` delegation calls. Every delegated action's call line, with the argv it
        // must carry: a swapped argument order at any of the twenty sites would otherwise
        // pass this suite.
        for (const call of [
            `kk stage daily-prepare "\${vars.work_dir}" "\${vars.limit}" "\${vars.cursor}" "\${vars.state_file}" "\${vars.last30days_enabled}" "\${vars.last30days_topic}" "\${vars.horizon_hours}" "\${vars.run_date}"`,
            `kk stage daily-collect-facts "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}"`,
            `kk stage daily-plan "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.plan_max_items}"`,
            `kk stage daily-qc-content "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.qc_categories}" "\${vars.qc_min_quality}" "\${vars.qc_min_importance}" "\${vars.qc_min_urgency}" "\${vars.qc_min_impact}"`,
            `kk stage daily-article "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}"`,
            `kk stage daily-cover "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.cover_provider}" "\${vars.cover_model}"`,
            `kk stage daily-cover-normalize "\${vars.work_dir}" "\${vars.run_date}"`,
            `kk stage daily-script-style "\${vars.work_dir}" "\${vars.run_date}"`,
            `kk stage daily-script "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.language}" "\${vars.title}" "\${vars.voice_profile}"`,
            `kk stage daily-wrap-docs "\${vars.work_dir}" "\${vars.run_date}" "\${vars.voice_profile}"`,
            `OMNIVOICE_SPEED=1.06 kk stage daily-generate "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.transcode_mp3}" "\${vars.vdriver}"`,
            `kk stage daily-intro "\${vars.work_dir}" "\${vars.run_date}" "\${vars.intro_music}"`,
            `kk stage daily-quality-report "\${vars.work_dir}" "\${vars.run_date}"`,
            `kk stage daily-publish-prep "\${vars.work_dir}" "\${vars.run_date}"`,
            `kk stage daily-publish-surfdash "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}"`,
            `kk stage daily-show-notes "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.title}"`,
            `kk stage daily-publish-podcast "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}"`,
            `kk stage daily-publish-classify "\${vars.work_dir}" "\${vars.run_date}"`,
            `kk stage daily-patch-surfdash "\${vars.work_dir}" "\${vars.run_date}" "\${vars.surfdash_root}"`,
            `kk stage daily-publish-partial "\${vars.work_dir}" "\${vars.run_date}"`,
            `kk stage daily-run-report "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.qc_min_quality}" "\${vars.qc_min_importance}" "\${vars.qc_min_urgency}" "\${vars.qc_min_impact}"`,
            `kk stage daily-translate-localize "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}"`,
            `kk stage daily-translate-sync "\${vars.work_dir}" "\${vars.run_date}" "\${vars.plugins_path}" "\${vars.work_dir}/3-publish/\${vars.run_date}_20_translate-localize_zh-post-path.txt"`,
        ]) {
            expect(yaml, call.slice(12, 40)).toContain(call);
        }
        expect(runnerSource).toContain("'core-facts-gen'");
        expect(runnerSource).toContain("'episode-plan-gen'");
        expect(runnerSource).toContain("'daily-article-gen'");
        expect(runnerSource).toContain("'dailynews-gen'");
        expect(runnerSource).toContain('voiceGenerator');
        expect(runnerSource).toContain("'fan-out',");
        expect(runnerSource).toContain("'--target',");
        expect(runnerSource).toContain("'podcast-pub'");
        expect(runnerSource).toContain("'surfdash-pub'");
        expect(yaml).toContain('kind: hitl.confirm');

        expect(yaml).toContain('pause: true');
        // 0097: an empty QC'd candidate set routes to its own terminal, not failed.
        expect(yaml).toContain('done-no-content');
    });

    it('R5 — supports review bypass via skip_review=true', () => {
        expect(yaml).toContain('test "$' + '{vars.skip_review}" = "true"');
    });

    it('R3 (0140) — the quality-control edges carry no qc.passed gate and no failed fallthrough', () => {
        // Branch A (operator-ratified 2026-09-17): warn-only. The old conjunct could never fail —
        // jq's `//` treats false as empty, so `.metadata.qc.passed // true` printed "true" for a
        // failing audit — so the gate is deleted rather than left reading as a live safety check.
        // Assert on guard COMMAND text, not the whole file: the yaml carries an explanatory comment
        // naming qc.passed so a future reader does not restore the broken expression.
        const guardCommands = [...yaml.matchAll(/^ {8}command: '([^']*)'$/gm)].map((m) => m[1] ?? '');
        expect(guardCommands.filter((c) => c.includes('qc.passed'))).toEqual([]);
        const qcState = yaml.slice(yaml.indexOf('  - from: generate'), yaml.indexOf('  - from: publish-prep'));
        expect(qcState).toContain('  - from: quality-control\n    to: publish-prep');
        expect(qcState).toContain('  - from: quality-control\n    to: done');
        expect(qcState).not.toContain('  - from: quality-control\n    to: failed');
    });

    it('F613 (0162) — script-write state and first-match transitions sit behind the enabled/zh/resume guards', () => {
        const block = yaml.match(/- id: script-write\n[\s\S]*?(?=\n {2}- id: )/)?.[0] ?? '';
        // R1/R2: the shell snapshots the shipped style sidecar into the work dir; the agent
        // authors the plan and never halts the run on failure (the builder falls back to
        // templates), and its artifact is pinned.
        expect(block).toContain(`kk stage daily-script-style "\${vars.work_dir}" "\${vars.run_date}"`);
        expect(block).toContain('onError: continue');
        expect(block).toContain('allowAppend: false');
        expect(block).toContain(`expectFile: \${vars.work_dir}/2-script/\${vars.run_date}_08_script-write_plan.json`);

        const edges = [...yaml.matchAll(/from: ([\w-]+)\n\s+to: ([\w-]+)/gm)].map((m) => `${m[1]}->${m[2]}`);
        // First match wins: cover stays the first article edge, script-write sits above the
        // always `-> script` edges on both parents, and script-write always drains into script.
        expect(edges.indexOf('article->cover')).toBeLessThan(edges.indexOf('article->script-write'));
        expect(edges.indexOf('article->script-write')).toBeLessThan(edges.indexOf('article->script'));
        expect(edges.indexOf('cover->script-write')).toBeLessThan(edges.indexOf('cover->script'));
        expect(edges).toContain('script-write->script');

        // R3: each script-write edge requires enabled+zh AND a clean resume state — neither
        // today's plan file nor the VoiceScript YAML may exist yet.
        const guardFor = (edge: string) => {
            const [from, to] = edge.split('->');
            const m = yaml.match(new RegExp(`from: ${from}\\n\\s+to: ${to}\\n[\\s\\S]*?command: '([^']+)'`));
            return m?.[1] ?? '';
        };
        for (const edge of ['article->script-write', 'cover->script-write']) {
            const guard = guardFor(edge);
            expect(guard, `${edge} guard`).toContain(`test "\${vars.script_write_enabled}" = "true"`);
            expect(guard, `${edge} guard`).toContain(`test "\${vars.language}" = "zh"`);
            expect(guard, `${edge} guard`).toContain(
                `test ! -f "\${vars.work_dir}/2-script/\${vars.run_date}_08_script-write_plan.json"`,
            );
            expect(guard, `${edge} guard`).toContain(
                `test ! -f "\${vars.work_dir}/2-script/\${vars.run_date}_08_script_voicescript.yaml"`,
            );
        }
    });

    it('R5 — executes all plugin commands and creates pipeline artifacts', () => {
        if (!Bun.which('spur', { PATH: process.env.PATH })) {
            // Fail loud: a silent return made a green suite indistinguishable from a skipped run.
            throw new Error(
                'kk-daily-ai-voice integration test requires `spur` on PATH (the repo quality gate installs it); refusing to skip silently',
            );
        }
        // unset -> workflow default vdriver 'voicebox' (voice-gen, flipped from
        // ominivoice 2026-09-20 after the matched-rate A/B); explicit 'ominivoice'
        // keeps covering the omni-voice-gen branch (generator swap + call log).
        // 0140: the third case drives a degradation-class audit (`passed:false`, no
        // `repetition_detected`) through the real engine — Branch A publishes it warn-only.
        for (const [vdriver, qcPassed] of [
            [undefined, true],
            ['ominivoice', true],
            ['gemini', true],
            [undefined, false],
        ] as const) {
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
if (args[0] === 'stage') {
    // 0144: kk stage <daily-*> delegates to the real shipped runner — the integration
    // exercises the actual stages logic, not a stub of it.
    const stages = '${stagesAbs}';
    const res = Bun.spawnSync(['bun', stages, ...args.slice(1)], { stdio: ['inherit', 'pipe', 'pipe'] });
    process.exit(res.exitCode ?? 1);
}
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
// 0140: a degradation-class audit (passed:false, no repetition) — the input the removed
// qc.passed guard was meant to gate. KK_TEST_QC_PASSED=false makes the stub emit it.
const qc = process.env.KK_TEST_QC_PASSED === 'false'
    ? { passed: false, overallScore: 50, totalDuration: 1, segmentAudits: [{ segmentIndex: 0, issues: ['loudness_dip:unknown'] }] }
    : { passed: true, overallScore: 100, totalDuration: 1, segmentAudits: [] };
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
    const title = process.env.DAILYNEWS_TITLE;
    // Block-style YAML, mirroring dailynews-gen's own formatVoiceScriptToYaml. Bun.YAML.stringify
    // emits a flow mapping like {title: x, segments: [...]}, which is valid YAML but is neither
    // JSON nor the shape the real plugin writes — and the 0139 validator now runs over this file.
    const body = [
        'title: "' + title + '"',
        'language: "' + process.env.DAILYNEWS_LANGUAGE + '"',
        'default_profile: "' + process.env.VOICEBOX_DEFAULT_PROFILE + '"',
        'segments:',
        '  - text: "' + String(docs[0].body).replace(/"/g, '\\"') + '"',
        '    gap_ms: 100',
        '',
    ].join('\\n');
    writeFileSync(outPath, JSON.stringify({
        title,
        body,
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
        metadata: { audioPath: wavPath, qc },
    }));
} else if (plugin === 'omni-voice-gen') {
    readFileSync(inPath, 'utf8');
    const wavPath = join(dirname(outPath), 'content.wav');
    writeFileSync(wavPath, 'RIFF-fake-wave');
    writeFileSync(outPath, JSON.stringify({
        title: 'Daily AI News',
        body: wavPath,
        format: 'audio',
        metadata: { audioPath: wavPath, generator: 'kk:omni-voice-gen', qc },
    }));
} else if (plugin === 'gemini-tts') {
    readFileSync(inPath, 'utf8');
    const wavPath = join(dirname(outPath), 'content.wav');
    writeFileSync(wavPath, 'RIFF-fake-wave');
    writeFileSync(outPath, JSON.stringify({
        title: 'Daily AI News',
        body: wavPath,
        format: 'audio',
        metadata: { audioPath: wavPath, generator: 'kk:gemini-tts', qc },
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
                    article_write_enabled: 'false',
                    publish_enabled: 'false',
                    last30days_enabled: 'true',
                    plugins_path: join(testRoot, 'plugin root'),
                    vdriver,
                    // 0149: generate now really routes into daily-intro; the stub's wav is fake
                    // bytes no ffprobe can read, so point the intro var at the stage's blank
                    // skip branch and exercise the merge itself only in live runs. A bare ''
                    // override is rejected by spur (blanking a declared non-empty default), so
                    // the skip rides the runner's trim-based blank check instead.
                    intro_music: ' ',
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
                            KK_TEST_QC_PASSED: qcPassed ? 'true' : 'false',
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
                expect(existsSync(join(workDir, `1-ingest/${runDate}_02_collect_blended.json`))).toBe(true);
                expect(existsSync(join(workDir, '1-ingest/docs.json'))).toBe(false);
                expect(existsSync(join(workDir, '1-ingest/last30days-docs.json'))).toBe(false);
                expect(existsSync(join(workDir, `1-ingest/horizon-docs-${runDate}.json`))).toBe(false);
                expect(existsSync(join(workDir, `2-facts/${runDate}_02_collect_content.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-facts/${runDate}_02_collect_core-facts.md`))).toBe(true);
                expect(existsSync(join(workDir, `2-plan/${runDate}_03_plan_content.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-plan/${runDate}_03_plan_plan.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-plan/${runDate}_04_quality-control-content_annotated.json`))).toBe(
                    true,
                );
                expect(existsSync(join(workDir, `2-plan/${runDate}_04_quality-control-content_candidates.json`))).toBe(
                    true,
                );
                expect(
                    existsSync(join(workDir, `2-plan/${runDate}_04_quality-control-content_candidates.rejected.json`)),
                ).toBe(true);
                expect(existsSync(join(workDir, `2-article/${runDate}_06_article_content.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-article/${runDate}_06_article_article.md`))).toBe(true);
                expect(existsSync(join(workDir, `2-script/${runDate}_08_script_content.json`))).toBe(true);
                expect(existsSync(join(workDir, `2-script/${runDate}_08_script_voicescript.yaml`))).toBe(true);
                expect(existsSync(join(workDir, `3-audio/${runDate}_10_wrap-docs_docs.json`))).toBe(true);
                expect(existsSync(join(workDir, `3-audio/${runDate}_11_generate_content.json`))).toBe(true);
                expect(existsSync(join(workDir, '3-audio/content.wav'))).toBe(true);
                const generated = JSON.parse(
                    readFileSync(join(workDir, `3-audio/${runDate}_11_generate_content.json`), 'utf8'),
                );
                const generatorByDriver: Record<string, string> = {
                    ominivoice: 'kk:omni-voice-gen',
                    gemini: 'kk:gemini-tts',
                };
                if (typeof vdriver === 'string' && generatorByDriver[vdriver]) {
                    expect(generated.metadata.generator).toBe(generatorByDriver[vdriver]);
                }
                expect(generated.metadata.qc.passed).toBe(qcPassed);

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
                    vdriver === 'ominivoice' ? 'omni-voice-gen' : vdriver === 'gemini' ? 'gemini-tts' : 'voice-gen',
                ]);
                // 0097: plan run then QC filter run — the filter rides EPISODE_PLAN_MODE because
                // kk executor run forwards only --in/--out (0092 spawn contract).
                expect(calls.filter((call) => call.plugin === 'episode-plan-gen').map((call) => call.mode)).toEqual([
                    'plan',
                    'filter',
                ]);
                // 0140 Branch A: with `passed:false` on disk the run must still reach its normal
                // terminal. publish_enabled=false leaves exactly two non-failed edges, so a clean
                // exit plus no publish-plugin call proves the `done` terminal was taken, warn-only.
                if (!qcPassed) {
                    expect(generated.metadata.qc.passed).toBe(false);
                    expect(result.exitCode).toBe(0);
                    expect(calls.map((call) => call.plugin)).not.toContain('surfdash-pub');
                    expect(calls.map((call) => call.plugin)).not.toContain('podcast-pub');
                }
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

                const wrappedDocs = JSON.parse(
                    readFileSync(join(workDir, `3-audio/${runDate}_10_wrap-docs_docs.json`), 'utf8'),
                );
                expect(wrappedDocs[0].metadata.voiceProfile).toBe('Alex');
            } finally {
                rmSync(testRoot, { recursive: true, force: true });
            }
        }
        // 4 real workflow executions (spur engine + bun subprocesses per state): the old 30s
        // budget tripped under load (30985ms timeout flake). 160s leaves headroom for the gemini row.
    }, 160_000);

    // --- 0128 R3: the flattening enumeration ---------------------------------

    it('R3 (0128) — every daily stage emits >= 2 files, so no stage is flattened', () => {
        // 0133: the stage directories are created and addressed by the runner, so the enumeration
        // reads the runner's `join(workDir, '<stage>', `${runDate}_NN_step_name`)` calls.
        const stages = ['1-ingest', '2-facts', '2-plan', '2-article', '2-cover', '2-script', '3-audio', '3-publish'];
        for (const stage of stages) {
            // Count distinct artifact references the runner builds for this stage: either the
            // `'<stage>/<file>'` literal form or a `join(workDir, '<stage>', …)` call.
            const files = new Set([
                ...[...runnerSource.matchAll(new RegExp(`'${stage}/[^']+'`, 'g'))].map((m) => m[0]),
                ...[...runnerSource.matchAll(new RegExp(`join\\(workDir, '${stage}', [^)]+\\)`, 'g'))].map((m) => m[0]),
            ]);
            // A stage emitting exactly one file would be flattened to <step>-<name>; enumerate
            // rather than assume, so a future single-file stage fails here instead of drifting.
            expect(files.size, `${stage} file count`).toBeGreaterThanOrEqual(2);
        }
        // The YAML keeps no flattened <step>-<name> reference. The runner is checked by the
        // file-count enumeration above instead of by a name pattern: legitimate step names carry
        // dashes (`translate-sync`, `publish-prep`, `run-report`), so a `[a-z-]+-[^.]+` pattern
        // matches healthy names and cannot distinguish a flattening.
        expect(yaml).not.toMatch(/\$\{vars\.work_dir\}\/[0-9]-[^/\s]+-[^/\s]*\.[A-Za-z]/);
    });

    it('transitions run translate before patch-surfdash so all locales get patched (0148 R7)', () => {
        const edges = [...yaml.matchAll(/from: ([\w-]+)\n\s+to: ([\w-]+)/gm)].map((m) => `${m[1]}->${m[2]}`);
        expect(edges).toContain('publish->translate');
        expect(edges).toContain('translate->patch-surfdash');
        expect(edges).toContain('patch-surfdash->run-report');
        // done is reachable from run-report under both full and partial publish statuses.
        expect(edges.filter((e) => e === 'run-report->done').length).toBe(2);
        // The pre-0148 chain must be gone: patch ran before translate, leaving en/ja unpatched.
        expect(edges).not.toContain('publish->patch-surfdash');
        expect(edges).not.toContain('run-report->translate');
        expect(edges).not.toContain('translate->done');
        // The publish exit fan-out stays explicitly guarded full|partial|none.
        expect(edges).toContain('publish->publish-partial');
        expect(edges).toContain('publish->failed');
    });

    it('generate routes through intro-music before quality-control (0149: intro state was orphaned)', () => {
        const edges = [...yaml.matchAll(/from: ([\w-]+)\n\s+to: ([\w-]+)/gm)].map((m) => `${m[1]}->${m[2]}`);
        expect(edges).toContain('generate->intro-music');
        expect(edges).toContain('intro-music->quality-control');
        // The pre-0149 shortcut must stay gone: it left every episode without the intro sting.
        expect(edges).not.toContain('generate->quality-control');
    });
});
