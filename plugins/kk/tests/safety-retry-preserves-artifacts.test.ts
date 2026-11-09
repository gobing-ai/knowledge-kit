import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0338 regression: a successful safety producer must not lose its artifact to an unavailable retry.
 *
 * The real Spur agent.run implementation removes every declared expectFile before dispatching the
 * action. The safety state machine used to put the primary and retry in one onEnter sequence with no
 * action-level condition, so a successful pi review/verdict was deleted before the claude retry ran.
 * This test uses the installed Spur dispatcher and the checkout's stage runner, but local PATH
 * doubles for the two agents and the decision maker, so it is fast and unattended.
 */

const REPO = join(import.meta.dir, '../../..');
const ACTIVE_SAFETY_WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-daily-safety.yaml');
const SAFETY_WORKFLOW = process.env.KK_SAFETY_WORKFLOW ?? ACTIVE_SAFETY_WORKFLOW;
const STAGE_RUNNER = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');
const SAFETY_CHECKER = join(REPO, 'plugins/kk/scripts/safety-artifact-check.ts');
const VOICESCRIPT_VALIDATOR = join(REPO, 'plugins/kk/scripts/validate-voicescript.ts');
const STAMP = '20261101';

const tempDirs: string[] = [];

type AgentStubMode =
    | 'valid'
    | 'invalid'
    | 'retry-valid'
    | 'minimal-pass-retry'
    | 'contradictory-pass-retry'
    | 'admission-noop'
    | 'escalated';

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function writeExecutable(path: string, body: string): void {
    writeFileSync(path, `${body}\n`);
    chmodSync(path, 0o755);
}

/** Test agents cover valid artifacts, invalid/repaired retries, and no-op remediation. */
function writeAgentStubs(binDir: string, calls: string, mode: AgentStubMode): void {
    const invalidOutput = mode === 'invalid' || mode === 'retry-valid' ? '1' : '0';
    const admissionOnly = mode === 'admission-noop' ? '1' : '0';
    const actualEscalate = mode === 'escalated' ? '1' : '0';
    const stub = `#!/bin/bash
set -u
me="$(basename "$0")"
probe=0
for arg in "$@"; do
    case "$arg" in
        --version|--list-models|--help) probe=1 ;;
    esac
done
if [ "$probe" = "1" ]; then
    echo "$me 1.0.0"
    exit 0
fi
printf '%s\\n' "$me" >> "${calls}"
if [ "$me" = "claude" ] && [ "${mode}" != "retry-valid" ] && [ "${mode}" != "minimal-pass-retry" ] && [ "${mode}" != "contradictory-pass-retry" ]; then
    printf '%s\\n' 'simulated unavailable retry' >&2
    exit 3
fi
prompt="$*"
out="$(printf '%s\\n' "$prompt" | grep -oE '[^ ]+_09_safety-(review_report|judge_verdict)\\.json' | tail -1)"
if [ -z "$out" ]; then
    printf '%s\\n' 'safety-test-agent: expected output path missing' >&2
    exit 2
fi
mkdir -p "$(dirname "$out")"
if [ "${mode}" = "retry-valid" ] && [ "$me" = "claude" ] && [[ "$out" == *_09_safety-review_report.json ]]; then
        printf '%s\\n' '{"platforms":[{"platform":"xiaoyuzhou","decision":"OK","findings":[]}],"escalate":false,"confidence":"HIGH"}' > "$out"
        exit 0
fi
if [ "${mode}" = "retry-valid" ] && [ "$me" = "pi" ] && [[ "$out" == *_09_safety-judge_verdict.json ]]; then
    printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":1,"summary":"All compliance criteria pass.","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"No prohibited claims found."},{"criterion":"disclosure-presence","status":"pass","detail":"Required disclosures are present or not applicable."},{"criterion":"jurisdictional-rules","status":"pass","detail":"Verified jurisdictional rules are satisfied."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":[],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
    exit 0
fi
if [ "${mode}" = "minimal-pass-retry" ] && [ "$me" = "pi" ] && [[ "$out" == *_09_safety-judge_verdict.json ]]; then
    printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","findings":[]}' > "$out"
    exit 0
fi
if [ "${mode}" = "minimal-pass-retry" ] && [ "$me" = "claude" ] && [[ "$out" == *_09_safety-judge_verdict.json ]]; then
    printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":1,"summary":"All compliance criteria pass.","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"No prohibited claims found."},{"criterion":"disclosure-presence","status":"pass","detail":"Required disclosures are present or not applicable."},{"criterion":"jurisdictional-rules","status":"pass","detail":"Verified jurisdictional rules are satisfied."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":[],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
    exit 0
fi
if [ "${mode}" = "contradictory-pass-retry" ] && [ "$me" = "pi" ] && [[ "$out" == *_09_safety-judge_verdict.json ]]; then
    printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":1,"summary":"The model claims all criteria pass despite a contradictory failure finding.","findings":[{"criterion":"no-prohibited-claims","status":"fail","detail":"A prohibited claim was found."},{"criterion":"disclosure-presence","status":"pass","detail":"Required disclosures are present or not applicable."},{"criterion":"jurisdictional-rules","status":"pass","detail":"Verified jurisdictional rules are satisfied."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":["Resolve the prohibited claim."],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
    exit 0
fi
if [ "${mode}" = "contradictory-pass-retry" ] && [ "$me" = "claude" ] && [[ "$out" == *_09_safety-judge_verdict.json ]]; then
    printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":1,"summary":"All compliance criteria pass.","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"No prohibited claims found."},{"criterion":"disclosure-presence","status":"pass","detail":"Required disclosures are present or not applicable."},{"criterion":"jurisdictional-rules","status":"pass","detail":"Verified jurisdictional rules are satisfied."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":[],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
    exit 0
fi
if [ "${invalidOutput}" = "1" ]; then
    printf '%s\\n' '{"invalid":true}' > "$out"
    exit 0
fi
if [ "${admissionOnly}" = "1" ]; then
    case "$out" in
        *_09_safety-review_report.json)
            printf '%s\\n' '{"platforms":[{"platform":"xiaoyuzhou","decision":"BLOCK","findings":[{"item":"broadcast-form","category":1,"disposition":"fix"}]}],"escalate":false,"confidence":"HIGH"}' > "$out"
            ;;
        *_09_safety-judge_verdict.json)
            printf '%s\\n' '{"verdict":"FAIL","confidence":"HIGH","rubric":"compliance","score":0.8,"summary":"An admission-only platform rule remains unresolved.","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"No prohibited claims found."},{"criterion":"disclosure-presence","status":"pass","detail":"Required disclosures are present or not applicable."},{"criterion":"jurisdictional-rules","status":"fail","detail":"The named platform admission rule is not satisfied."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":["Exclude the affected platform."],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
            ;;
        *)
            printf '%s\\n' 'safety-test-agent: unexpected output path' >&2
            exit 2
            ;;
    esac
    exit 0
fi
if [ "${actualEscalate}" = "1" ]; then
    case "$out" in
        *_09_safety-review_report.json)
            printf '%s\\n' '{"platforms":[{"platform":"xiaoyuzhou","decision":"RISK","findings":[{"item":"verified-gap","disposition":"escalate","evidenceGap":true}]}],"escalate":false,"confidence":"HIGH"}' > "$out"
            ;;
        *_09_safety-judge_verdict.json)
            printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":0.9,"summary":"No confirmed must-pass violation; one platform evidence gap requires human review.","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"No prohibited claims found."},{"criterion":"disclosure-presence","status":"warn","detail":"Disclosure evidence is incomplete and needs review."},{"criterion":"jurisdictional-rules","status":"warn","detail":"A platform rule evidence gap requires review."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":["Verify the platform evidence gap before unattended publication."],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
            ;;
        *)
            printf '%s\\n' 'safety-test-agent: unexpected output path' >&2
            exit 2
            ;;
    esac
    exit 0
fi
case "$out" in
    *_09_safety-review_report.json)
        printf '%s\\n' '{"platforms":[{"platform":"xiaoyuzhou","decision":"OK","findings":[]}],"escalate":false,"confidence":"HIGH"}' > "$out"
        ;;
    *_09_safety-judge_verdict.json)
        printf '%s\\n' '{"verdict":"PASS","confidence":"HIGH","rubric":"compliance","score":1,"summary":"All compliance criteria pass.","findings":[{"criterion":"no-prohibited-claims","status":"pass","detail":"No prohibited claims found."},{"criterion":"disclosure-presence","status":"pass","detail":"Required disclosures are present or not applicable."},{"criterion":"jurisdictional-rules","status":"pass","detail":"Verified jurisdictional rules are satisfied."},{"criterion":"data-handling","status":"pass","detail":"No sensitive data was disclosed."}],"feedback":[],"content_ref":"22-article/content.json + 24-script/voicescript.yaml","evaluated_at":"2026-11-01T00:00:00Z"}' > "$out"
        ;;
    *)
        printf '%s\\n' 'safety-test-agent: unexpected output path' >&2
        exit 2
        ;;
esac
exit 0`;
    for (const name of ['pi', 'claude']) writeExecutable(join(binDir, name), stub);
}

function writeKkSourceShim(binDir: string): void {
    const bun = JSON.stringify(process.execPath);
    const runner = JSON.stringify(STAGE_RUNNER);
    writeExecutable(
        join(binDir, 'kk'),
        `#!/bin/bash
if [ "${'$'}1" != "stage" ]; then
    printf '%s\\n' 'safety-test-kk: only stage is supported' >&2
    exit 2
fi
shift
exec ${bun} ${runner} "${'$'}@"`,
    );
}

function seedSafetyWorkspace(workDir: string, projectDir: string): void {
    for (const name of ['21-plan', '22-article', '24-script']) mkdirSync(join(workDir, name), { recursive: true });
    writeFileSync(
        join(workDir, '21-plan', `${STAMP}_03_plan_plan.json`),
        JSON.stringify({ metadata: { docs: [] }, docs: [] }),
    );
    writeFileSync(
        join(workDir, '22-article', `${STAMP}_06_article_content.json`),
        JSON.stringify({ title: '每日AI乱炖 · 2026-11-01', format: 'markdown', body: '正文。', metadata: {} }),
    );
    writeFileSync(
        join(workDir, '24-script', `${STAMP}_08_script_voicescript.yaml`),
        'title: 每日AI乱炖 · 2026-11-01\nsegments:\n  - text: 大家好，欢迎收听。\n',
    );
    mkdirSync(join(projectDir, 'plugins/kk/scripts'), { recursive: true });
    copyFileSync(SAFETY_CHECKER, join(projectDir, 'plugins/kk/scripts/safety-artifact-check.ts'));
    copyFileSync(VOICESCRIPT_VALIDATOR, join(projectDir, 'plugins/kk/scripts/validate-voicescript.ts'));
    mkdirSync(join(projectDir, '.spur'), { recursive: true });
    writeFileSync(
        join(projectDir, '.spur', 'config.yaml'),
        [
            '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
            'version: "1.2"',
            'name: safety-retry-regression',
            'agent:',
            '  executors:',
            '    # The retry must reach the PATH stub even when the operator quota-disabled claude.',
            '    - name: claude',
            '      agent: claude',
            '      model: claude-opus-5-5',
            '      tier: capable-3',
            '      disabled: false',
            'decisions:',
            '  paths:',
            `    - ${join(REPO, 'plugins/kk/decisions')}`,
            '  maker: typesafe',
            '',
        ].join('\n'),
    );
}

function runSafety(
    projectDir: string,
    workDir: string,
    binDir: string,
    calls: string,
    mode: AgentStubMode,
    maxRevise = '0',
    unattended = 'false',
): { exitCode: number; stdout: string; stderr: string } {
    writeAgentStubs(binDir, calls, mode);
    writeKkSourceShim(binDir);
    const runId = `safety-retry-${mode}-${Date.now()}`;
    const result = Bun.spawnSync(
        [
            'spur',
            'workflow',
            'run',
            SAFETY_WORKFLOW,
            '--run-id',
            runId,
            '--quiet',
            '--json',
            '--vars',
            JSON.stringify({
                work_dir: workDir,
                run_date: STAMP,
                safety_max_revise: maxRevise,
                safety_platforms: 'xiaoyuzhou',
                agent: 'pi',
                agent_retry: 'claude',
                unattended,
            }),
        ],
        {
            cwd: projectDir,
            env: {
                ...process.env,
                PATH: `${binDir}:${process.env.PATH ?? ''}`,
                SAFETY_TEST_INVALID: mode === 'invalid' ? '1' : '0',
                TYPESAFE_API_KEY: undefined,
                SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
            },
            stdout: 'pipe',
            stderr: 'pipe',
        },
    );
    return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
    };
}

function summaryOf(stdout: string): { status?: string } {
    try {
        return JSON.parse(stdout) as { status?: string };
    } catch {
        return {};
    }
}

describe('kk-daily-safety retry recovery (0338)', () => {
    it('keeps valid primary report and verdict when the retry executor is unavailable', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-retry-project-');
        const workDir = tempDir('kk-safety-retry-work-');
        const binDir = tempDir('kk-safety-retry-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'valid');
        const summary = summaryOf(result.stdout);

        const report = join(workDir, '24-script', `${STAMP}_09_safety-review_report.json`);
        const verdict = join(workDir, '24-script', `${STAMP}_09_safety-judge_verdict.json`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('done');
        expect(existsSync(report)).toBe(true);
        expect(existsSync(verdict)).toBe(true);
        expect(JSON.parse(readFileSync(report, 'utf-8'))).toMatchObject({ confidence: 'HIGH' });
        expect(JSON.parse(readFileSync(verdict, 'utf-8'))).toMatchObject({ verdict: 'PASS' });
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'pi']);

        // The decision catalog may fall back to escalate, but an admitted gate status remains
        // publish-valid. The predicate must inspect the gate status, not the decision value.
        writeFileSync(
            join(workDir, '24-script', `${STAMP}_09_safety-verdict.decision`),
            JSON.stringify({ value: 'escalate' }),
        );
        const fallback = Bun.spawnSync([process.execPath, SAFETY_CHECKER, 'publish-valid', workDir, STAMP, 'true'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(fallback.exitCode).toBe(0);
    });

    it('repairs an invalid primary report with the bounded retry before judging', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-report-retry-project-');
        const workDir = tempDir('kk-safety-report-retry-work-');
        const binDir = tempDir('kk-safety-report-retry-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'retry-valid');
        const summary = summaryOf(result.stdout);

        const report = join(workDir, '24-script', `${STAMP}_09_safety-review_report.json`);
        const verdict = join(workDir, '24-script', `${STAMP}_09_safety-judge_verdict.json`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('done');
        expect(JSON.parse(readFileSync(report, 'utf-8'))).toMatchObject({ confidence: 'HIGH' });
        expect(JSON.parse(readFileSync(verdict, 'utf-8'))).toMatchObject({ verdict: 'PASS' });
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'claude', 'pi']);
    });

    it('rejects a minimal PASS verdict and repairs it with the bounded judge retry', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-verdict-retry-project-');
        const workDir = tempDir('kk-safety-verdict-retry-work-');
        const binDir = tempDir('kk-safety-verdict-retry-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'minimal-pass-retry');
        const summary = summaryOf(result.stdout);

        const verdict = join(workDir, '24-script', `${STAMP}_09_safety-judge_verdict.json`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('done');
        expect(JSON.parse(readFileSync(verdict, 'utf-8'))).toMatchObject({
            verdict: 'PASS',
            rubric: 'compliance',
            score: 1,
        });
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'pi', 'claude']);
    });

    it('rejects a contradictory PASS verdict and repairs it with the bounded judge retry', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-contradictory-pass-project-');
        const workDir = tempDir('kk-safety-contradictory-pass-work-');
        const binDir = tempDir('kk-safety-contradictory-pass-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'contradictory-pass-retry');
        const summary = summaryOf(result.stdout);

        const verdict = join(workDir, '24-script', `${STAMP}_09_safety-judge_verdict.json`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('done');
        expect(JSON.parse(readFileSync(verdict, 'utf-8'))).toMatchObject({ verdict: 'PASS', score: 1 });
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'pi', 'claude']);
    });

    it('lets an attended real escalation reach the caller pause path', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-attended-escalate-project-');
        const workDir = tempDir('kk-safety-attended-escalate-work-');
        const binDir = tempDir('kk-safety-attended-escalate-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'escalated', '0', 'false');
        const summary = summaryOf(result.stdout);

        const status = join(workDir, '24-script', `${STAMP}_09_safety-judge_status.txt`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('done');
        expect(readFileSync(status, 'utf-8')).toBe('escalate');
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'pi']);
    });

    it('blocks a real escalation before unattended publication', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-unattended-escalate-project-');
        const workDir = tempDir('kk-safety-unattended-escalate-work-');
        const binDir = tempDir('kk-safety-unattended-escalate-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'escalated', '0', 'true');
        const summary = summaryOf(result.stdout);

        const status = join(workDir, '24-script', `${STAMP}_09_safety-judge_status.txt`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(1);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('failed');
        expect(readFileSync(status, 'utf-8')).toBe('escalate');
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'pi']);
    });

    it('blocks and records failure when both safety attempts produce invalid artifacts', { timeout: 60_000 }, () => {
        const projectDir = tempDir('kk-safety-invalid-project-');
        const workDir = tempDir('kk-safety-invalid-work-');
        const binDir = tempDir('kk-safety-invalid-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'invalid');
        const summary = summaryOf(result.stdout);
        const status = join(workDir, '24-script', `${STAMP}_09_safety-judge_status.txt`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(1);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('failed');
        expect(readFileSync(status, 'utf-8')).toBe('block');
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'claude']);
    });

    it('spends the budget after a no-op remediation and admits an admission-only exclusion', {
        timeout: 60_000,
    }, () => {
        const projectDir = tempDir('kk-safety-noop-project-');
        const workDir = tempDir('kk-safety-noop-work-');
        const binDir = tempDir('kk-safety-noop-bin-');
        const calls = join(projectDir, 'agent-calls.log');
        seedSafetyWorkspace(workDir, projectDir);
        const result = runSafety(projectDir, workDir, binDir, calls, 'admission-noop', '1');
        const summary = summaryOf(result.stdout);

        const report = join(workDir, '24-script', `${STAMP}_09_safety-review_report.json`);
        const verdict = join(workDir, '24-script', `${STAMP}_09_safety-judge_verdict.json`);
        const status = join(workDir, '24-script', `${STAMP}_09_safety-judge_status.txt`);
        expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(summary.status, `${result.stdout}\n${result.stderr}`).toBe('done');
        expect(readFileSync(status, 'utf-8')).toBe('exclude');
        expect(readFileSync(join(workDir, '.safety-revise-count'), 'utf-8')).toBe('1\n');
        expect(JSON.parse(readFileSync(report, 'utf-8'))).toMatchObject({ confidence: 'HIGH' });
        expect(JSON.parse(readFileSync(verdict, 'utf-8'))).toMatchObject({ verdict: 'FAIL' });
        expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual(['pi', 'pi', 'pi', 'claude', 'pi', 'pi']);
    });
});
