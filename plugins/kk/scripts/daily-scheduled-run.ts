#!/usr/bin/env bun
/** Supervise one scheduled daily run and persist its terminal outcome even after a deadline. */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { TriageReceipt, TriageReport } from './daily-triage-core';
import { collectTriage, summarizeTriage } from './daily-triage-core';

const { values } = parseArgs({
    options: {
        repo: { type: 'string', default: process.cwd() },
        'works-dir': { type: 'string' },
        'run-id': { type: 'string' },
        'timeout-ms': { type: 'string', default: '13500000' },
        receipt: { type: 'string' },
        agent: { type: 'string', default: 'inline' },
        'retry-agent': { type: 'string', default: 'claude' },
        'required-channels': { type: 'string', default: 'wechat,locales,cms-resync' },
        'wechat-live': { type: 'boolean', default: false },
        workflow: { type: 'string', default: 'kk-daily-ai-voice2' },
        'generate-only': { type: 'boolean', default: false },
        window: { type: 'string' },
        'publish-preset': { type: 'string' },
        'publish-live-channels': { type: 'string' },
        'allow-dirty': { type: 'boolean', default: false },
        'skip-probe': { type: 'boolean', default: false },
    },
});
const timeoutMs = Number(values['timeout-ms']);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    console.error('daily-scheduled-run: --timeout-ms must be a positive integer');
    process.exit(2);
}
const repo = resolve(values.repo);
const now = new Date();
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
const runId = values['run-id'] ?? `daily-ai-voice-${stamp}-${now.getTime()}`;
const workDir = join(resolve(values['works-dir'] ?? join(repo, '.works')), 'kk-daily-ai-voice2', stamp);
const receiptPath = resolve(values.receipt ?? join(workDir, 'schedule-receipt.json'));
const startedAt = now.toISOString();
mkdirSync(workDir, { recursive: true });
mkdirSync(dirname(receiptPath), { recursive: true });
// voice3 shares the voice2 workspace (F08); only the vars and the publish seam differ.
const isVoice3 = values.workflow === 'kk-daily-ai-voice3';
const generateOnly = values['generate-only'] === true;
if (generateOnly && !isVoice3) {
    console.error('daily-scheduled-run: --generate-only requires --workflow kk-daily-ai-voice3');
    process.exit(2);
}
const vars = isVoice3
    ? {
          auto_publish: generateOnly ? 'false' : 'true',
          ...(values['publish-preset'] !== undefined ? { publish_preset: values['publish-preset'] } : {}),
          ...(values['publish-live-channels'] !== undefined
              ? { publish_live_channels: values['publish-live-channels'] }
              : {}),
          ...(values.window ? { window: values.window } : {}),
          skip_review: 'true',
          agent: values.agent,
          agent_retry: values['retry-agent'],
          work_dir: workDir,
          run_date: stamp,
      }
    : {
          publish_enabled: 'true',
          skip_review: 'true',
          agent: values.agent,
          agent_retry: values['retry-agent'],
          wechat_live: values['wechat-live'] === true ? 'true' : 'false',
          work_dir: workDir,
          run_date: stamp,
      };
// ------------------------------------------------------------------
// Preflight (0347 F1, 2026-11-10). Fail fast at minute one with named
// reasons instead of burning the window on a doomed run (2026-11-09: 80
// minutes died on a quota-dead executor chain a probe would have refused,
// on workflow bytes that had already diverged from the installed kk).
// ------------------------------------------------------------------

interface Preflight {
    ok: boolean;
    reasons: string[];
    warnings: string[];
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

function harnessDirtyPaths(): string[] {
    const git = spawnSync('git', ['status', '--porcelain', '--', 'plugins/kk', '.spur/workflows'], {
        cwd: repo,
        encoding: 'utf-8',
        timeout: 10_000,
    });
    if (git.status !== 0) return [];
    // Keep the full porcelain line (XY + path): the refusal must show whether a byte is staged,
    // unstaged or untracked — 20261111 a16 spent a fix loop guessing that from bare paths.
    return git.stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);
}

/** Package root of the kk binary this machine resolves `kk` to, or null. */
function kkPackageRoot(): string | null {
    const which = spawnSync('sh', ['-c', 'command -v kk'], { encoding: 'utf-8', timeout: 5_000 });
    const bin = which.stdout.trim();
    if (which.status !== 0 || bin === '') return null;
    try {
        const real = realpathSync(bin);
        // <pkg>/dist/index.js -> <pkg>
        return dirname(dirname(real));
    } catch {
        return null;
    }
}

function diffDirs(a: string, b: string): string[] {
    if (!existsSync(a) || !existsSync(b)) return [];
    const diff = spawnSync('diff', ['-rq', a, b], { encoding: 'utf-8', timeout: 20_000 });
    if (diff.status === 0) return [];
    if (diff.error || (diff.status !== 1 && diff.status !== null)) return []; // unavailable: warn elsewhere, never false-refuse
    return diff.stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => line.replace(a, 'checkout').replace(b, 'install'))
        .slice(0, 5);
}

/**
 * One minimal real agent round-trip. `spur agent doctor` reports usable:true for accounts whose
 * quota is exhausted (2026-11-09 R3), so executor health must be proven with traffic, not probes.
 */
function executorProbe(agentName: string): { ok: boolean; detail: string } {
    const probeCwd = mkdtempSync(join(tmpdir(), 'kk-preflight-'));
    try {
        const probe = spawnSync(
            'spur',
            ['agent', 'run', '--agent', agentName, '--mode', 'text', '--json', 'Reply with exactly: OK'],
            { cwd: probeCwd, encoding: 'utf-8', timeout: 120_000 },
        );
        if (probe.status === 0) return { ok: true, detail: 'ok' };
        const text = `${probe.stderr ?? ''}${probe.stdout ?? ''}`.replace(ANSI_RE, '').trim();
        const named = text
            .split('\n')
            .filter((line) => line.trim() !== '')
            .slice(-2)
            .join(' | ')
            .slice(-240);
        return { ok: false, detail: named !== '' ? named : `exit ${probe.status ?? '?'}` };
    } finally {
        rmSync(probeCwd, { recursive: true, force: true });
    }
}

function runPreflight(): Preflight {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const dirty = harnessDirtyPaths();
    if (dirty.length > 0 && values['allow-dirty'] !== true) {
        reasons.push(
            `working tree dirty on harness paths (git status --porcelain):\n  ${dirty.slice(0, 10).join('\n  ')}`,
        );
    }
    const install = kkPackageRoot();
    if (install === null) {
        warnings.push('kk binary not found on PATH; executed-vs-installed sync not checked');
    } else {
        const diffs = [
            ...diffDirs(join(repo, 'plugins', 'kk', 'workflows'), join(install, 'plugins', 'kk', 'workflows')),
            ...diffDirs(join(repo, 'plugins', 'kk', 'scripts'), join(install, 'plugins', 'kk', 'scripts')),
        ];
        if (diffs.length > 0) {
            reasons.push(`checkout diverges from installed kk (${install}): ${diffs.join('; ')}`);
        }
    }
    if (values['skip-probe'] !== true) {
        if (values.agent !== 'inline') {
            const probe = executorProbe(values.agent);
            if (!probe.ok) reasons.push(`executor probe failed for primary '${values.agent}': ${probe.detail}`);
        }
        const retry = values['retry-agent'];
        if (retry !== undefined && retry !== 'inline') {
            const retryProbe = executorProbe(retry);
            if (!retryProbe.ok) {
                warnings.push(`executor probe failed for retry '${retry}': ${retryProbe.detail}`);
            }
        }
    }
    return { ok: reasons.length === 0, reasons, warnings };
}

const preflight = runPreflight();
if (!preflight.ok) {
    const refused = {
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'preflight-refused',
        exitCode: 5,
        agent: values.agent,
        retryAgent: values['retry-agent'],
        workDir,
        preflight: { reasons: preflight.reasons, warnings: preflight.warnings },
        error: preflight.reasons[0] ?? 'preflight refused',
    };
    writeFileSync(receiptPath, `${JSON.stringify(refused, null, 2)}\n`);
    console.error(`daily-scheduled-run: preflight refused run ${runId}`);
    for (const reason of preflight.reasons) console.error(`  ! ${reason}`);
    for (const warning of preflight.warnings) console.error(`  ~ ${warning}`);
    process.exit(5);
}
writeFileSync(
    receiptPath,
    JSON.stringify(
        {
            runId,
            startedAt,
            status: 'running',
            workDir,
            preflight: { warnings: preflight.warnings, probes: values['skip-probe'] === true ? 'skipped' : 'passed' },
        },
        null,
        2,
    ),
);
let interrupted = false;
let timedOut = false;
let spawnError = '';
let forceKill: ReturnType<typeof setTimeout> | undefined;
const child = spawn(
    'spur',
    [
        '--no-logo',
        'workflow',
        'run',
        `plugins/kk/workflows/${values.workflow}.yaml`,
        '--run-id',
        runId,
        '--vars',
        JSON.stringify(vars),
        '--quiet',
    ],
    { cwd: repo, detached: true, stdio: 'inherit' },
);

const ownedPids = new Set<number>();
/** Snapshot descendants before the root exits, including workers that created their own groups. */
function rememberDescendants(): void {
    if (child.pid === undefined) return;
    ownedPids.add(child.pid);
    const snapshot = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf-8', timeout: 5000 });
    const rows = snapshot.stdout
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number));
    const descendants = new Set([child.pid]);
    let added = true;
    while (added) {
        added = false;
        for (const [pid, parent] of rows) {
            if (pid !== undefined && parent !== undefined && descendants.has(parent) && !descendants.has(pid)) {
                descendants.add(pid);
                added = true;
            }
        }
    }
    for (const pid of descendants) ownedPids.add(pid);
}

/** Stop only the recorded owned tree; process-group signals also catch late same-group forks. */
function signalOwned(signal: NodeJS.Signals): void {
    if (child.pid === undefined) return;
    rememberDescendants();
    for (const pid of [...ownedPids].reverse()) {
        try {
            process.kill(-pid, signal);
        } catch {}
        try {
            process.kill(pid, signal);
        } catch {}
    }
}

function terminate(): void {
    signalOwned('SIGTERM');
    if (forceKill === undefined) {
        forceKill = setTimeout(() => {
            signalOwned('SIGKILL');
        }, 300);
    }
}
const onSignal = (): void => {
    interrupted = true;
    terminate();
};
process.once('SIGTERM', onSignal);
process.once('SIGINT', onSignal);
const deadline = setTimeout(() => {
    timedOut = true;
    terminate();
}, timeoutMs);
const exitCode = await new Promise<number>((done) => {
    child.once('error', (error) => {
        spawnError = error.message;
        done(1);
    });
    child.once('close', (code) => done(code ?? 1));
});
clearTimeout(deadline);
if (forceKill !== undefined) clearTimeout(forceKill);
// A killed shell can leave owned descendants that ignore TERM. Always finish the group before
// recording a terminal outcome; no detached grandchild may continue to publish after a timeout.
if (child.pid !== undefined && (timedOut || interrupted || exitCode !== 0)) {
    terminate();
    await Bun.sleep(300);
    signalOwned('SIGKILL');
    await Bun.sleep(100);
}
const workflowStatus = timedOut ? 'timed-out' : interrupted ? 'interrupted' : exitCode === 0 ? 'done' : 'failed';
const primaryPublishStatus = isVoice3
    ? readOptional(join(workDir, '4-publish', 'publish-status.after-generate.txt'))
    : readOptional(join(workDir, '31-publish', `${stamp}_17_publish_publish-status.txt`));
const runSummary = readOptional(join(workDir, 'run-report.summary.txt'));
const cleanup: { command: string; exitCode: number | null }[] = [];
let reservationRecovery: { status: string; reason: string; released?: number } = {
    status: 'retained',
    reason: 'workflow completed; publication settlement owns its reservations',
};
if (workflowStatus !== 'done' || runSummary?.startsWith('no-content:')) {
    // The caller gives the nested safety run this exact id. Unknown/already-terminal ids are
    // harmless cleanup failures; they never override the original workflow failure.
    if (workflowStatus !== 'done') {
        for (const id of [`${runId}-safety`, runId]) {
            const result = spawnSync('spur', ['workflow', 'cancel', id, '--json'], {
                cwd: repo,
                encoding: 'utf-8',
                timeout: 20000,
            });
            cleanup.push({ command: `spur workflow cancel ${id}`, exitCode: result.status });
        }
    }
    // Only a complete trace proving no channel send began permits recycling reservations. A
    // missing receipt alone is insufficient: a remote send may have succeeded before it crashed.
    const trace = spawnSync('spur', ['workflow', 'trace', runId, '--json'], {
        cwd: repo,
        encoding: 'utf-8',
        timeout: 20000,
    });
    reservationRecovery = { status: 'retained', reason: 'publication state could not be established' };
    try {
        const parsed = JSON.parse(trace.stdout) as {
            run?: { runId?: string; workflowName?: string; status?: string; startedAt?: string };
            events?: { kind?: string; node?: string; status?: string }[];
        };
        const sendNodes = isVoice3
            ? new Set(['publish', 'send', 'send-retry', 'repair', 'send-confirm'])
            : new Set([
                  'publish-surfdash',
                  'publish-podcast',
                  'xhs-publish',
                  'wechat-publish',
                  'translate-localize',
                  'translate',
                  'translate-retry',
                  'translate-sync',
                  'publish-classify',
              ]);
        const validTrace =
            trace.status === 0 &&
            parsed.run?.runId === runId &&
            parsed.run?.workflowName === values.workflow &&
            parsed.run?.status === (workflowStatus === 'done' ? 'done' : 'failed') &&
            Date.parse(parsed.run.startedAt ?? '') >= Date.parse(startedAt) - 1000 &&
            Date.parse(parsed.run.startedAt ?? '') <= Date.now() &&
            Array.isArray(parsed.events) &&
            parsed.events.length > 0;
        const sendStarted = parsed.events?.some(
            (event) => event.kind === 'action' && sendNodes.has(event.node ?? '') && event.status !== 'skipped',
        );
        if (validTrace && !sendStarted) {
            // Cancellation is durable before reuse. Require a second stable snapshot after the
            // owned processes are gone, so an in-flight or partially finalized row cannot pass.
            await Bun.sleep(200);
            const secondTrace = spawnSync('spur', ['workflow', 'trace', runId, '--json'], {
                cwd: repo,
                encoding: 'utf-8',
                timeout: 20000,
            });
            const second = JSON.parse(secondTrace.stdout) as typeof parsed;
            if (
                secondTrace.status !== 0 ||
                JSON.stringify(second.run) !== JSON.stringify(parsed.run) ||
                JSON.stringify(second.events) !== JSON.stringify(parsed.events)
            ) {
                throw new Error('failed-run trace is not stable after cancellation');
            }
            const release = spawnSync('kk', ['store', 'release', '--topic', 'ai-news', '--run', runId], {
                cwd: repo,
                encoding: 'utf-8',
                timeout: 20000,
            });
            cleanup.push({ command: 'kk store release (verified pre-publication failure)', exitCode: release.status });
            const result = release.status === 0 ? (JSON.parse(release.stdout) as { released?: unknown }) : null;
            reservationRecovery =
                result !== null && typeof result.released === 'number'
                    ? { status: 'released', reason: 'trace proves no channel send began', released: result.released }
                    : { status: 'retained', reason: 'reservation release did not produce a valid receipt' };
        } else if (sendStarted) {
            reservationRecovery = { status: 'retained', reason: 'a channel send began; preserve uncertain delivery' };
        }
    } catch {
        // Unreadable/truncated evidence or an unexpected CLI shape must never cause reuse of a
        // potentially aired story. Keep the reservation and the original failure visible.
    }
}
const ledger = spawnSync('kk', ['ledger', 'sync', '--workflow', values.workflow, '--work-dir', workDir], {
    cwd: repo,
    encoding: 'utf-8',
    timeout: 20000,
});
cleanup.push({ command: 'kk ledger sync', exitCode: ledger.status });
function readOptional(path: string): string | null {
    try {
        return readFileSync(path, 'utf-8').trim();
    } catch {
        return null;
    }
}
const requiredChannels = values['required-channels']
    .split(',')
    .map((channel) => channel.trim())
    .filter(Boolean);
let channelCompleteness: { channel: string; state: string; detail?: string; required?: boolean; dummy?: boolean }[] =
    [];
try {
    if (isVoice3) {
        const outcome = JSON.parse(
            readOptional(join(workDir, '4-publish', 'outcome.after-generate.json')) ?? 'null',
        ) as { rows?: unknown } | null;
        if (Array.isArray(outcome?.rows)) {
            channelCompleteness = outcome.rows.flatMap(
                (row): { channel: string; state: string; required: boolean; dummy: boolean }[] => {
                    if (row === null || typeof row !== 'object') return [];
                    const r = row as { id?: unknown; required?: unknown; dummy?: unknown; status?: unknown };
                    if (typeof r.id !== 'string' || typeof r.status !== 'string') return [];
                    return [
                        {
                            channel: r.id,
                            state: r.status === 'succeeded' ? 'done' : r.status,
                            required: r.required === true,
                            dummy: r.dummy === true,
                        },
                    ];
                },
            );
        }
    } else {
        const parsed = JSON.parse(
            readOptional(join(workDir, '31-publish', `${stamp}_17_publish_completeness.json`)) ?? 'null',
        ) as { rows?: unknown } | null;
        if (Array.isArray(parsed?.rows)) {
            channelCompleteness = parsed.rows.filter(
                (row): row is { channel: string; state: string; detail?: string } =>
                    row !== null &&
                    typeof row === 'object' &&
                    typeof row.channel === 'string' &&
                    typeof row.state === 'string',
            );
        }
    }
} catch {}
const missingRequiredChannels = isVoice3
    ? channelCompleteness
          .filter((row) => row.required === true && row.dummy !== true)
          .filter((row) => row.state !== 'done')
          .map((row) => row.channel)
    : requiredChannels.filter((channel) => {
          const rows = channelCompleteness.filter((row) => row.channel === channel);
          return rows.length !== 1 || rows[0]?.state !== 'done';
      });
/** Generate-only receipts use the same fail-closed bundle admission as posting and validation. */
function inspectGenerationOnly(): { status: string; reason: string } {
    const inspector = join(repo, 'scripts/daily-ai-news.ts');
    if (!existsSync(inspector)) return { status: 'incomplete', reason: `bundle inspector not found: ${inspector}` };
    // The child is terminal, but our initial receipt still says running. Mark the inspection phase so
    // the shared admission check does not mistake this supervisor for a concurrent active run.
    writeFileSync(receiptPath, JSON.stringify({ runId, startedAt, status: 'inspecting', workDir }, null, 2));
    const probe = spawnSync(process.execPath, [inspector, 'inspect', '--work-dir', workDir, '--run-date', stamp], {
        cwd: repo,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 1024 * 1024,
    });
    try {
        const parsed = JSON.parse(probe.stdout) as { status?: unknown; reason?: unknown };
        if (typeof parsed.status === 'string') {
            return {
                status: probe.status === 0 && parsed.status === 'complete' ? 'complete' : 'incomplete',
                reason: typeof parsed.reason === 'string' ? parsed.reason : `inspector exited ${probe.status ?? 1}`,
            };
        }
    } catch {}
    return {
        status: 'incomplete',
        reason: probe.stderr.trim() || probe.error?.message || `bundle inspector exited ${probe.status ?? 1}`,
    };
}
const generationInspection =
    generateOnly && workflowStatus === 'done' && !runSummary?.startsWith('no-content:')
        ? inspectGenerationOnly()
        : null;
// A terminal green workflow can mean "no content" or failed delivery. Make that observable to
// the scheduler instead of equating the workflow's process exit with a published edition.
// A voice3 outcome classified 'full' already proves every non-dummy row succeeded (0326 R2).
const status =
    workflowStatus !== 'done'
        ? workflowStatus
        : runSummary?.startsWith('no-content:')
          ? 'no-content'
          : generateOnly
            ? generationInspection?.status === 'complete'
                ? 'done'
                : 'incomplete'
            : primaryPublishStatus === 'full' && !(!isVoice3 && missingRequiredChannels.length > 0)
              ? 'done'
              : 'incomplete';
function buildTriage(finalStatus: string, exitCode: number): TriageReport | null {
    try {
        const inlineReceipt: TriageReceipt = {
            status: finalStatus,
            startedAt,
            completedAt: new Date().toISOString(),
            workDir,
            agent: values.agent,
            retryAgent: values['retry-agent'],
            exitCode,
            error: spawnError || null,
        };
        const report = collectTriage(repo, runId, { receipt: inlineReceipt, workflow: values.workflow });
        console.error('daily-scheduled-run: triage summary');
        for (const line of summarizeTriage(report)) console.error(`  ${line}`);
        return report;
    } catch (error) {
        console.error(`daily-scheduled-run: triage collection failed: ${String(error)}`);
        return null;
    }
}

const terminalExitCode = timedOut ? 124 : interrupted ? 143 : exitCode !== 0 ? exitCode : status === 'done' ? 0 : 4;
const triage =
    status === 'failed' || status === 'timed-out' || status === 'interrupted' || status === 'incomplete'
        ? buildTriage(status, terminalExitCode)
        : null;
const receipt = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    generateOnly,
    generationInspection,
    exitCode: terminalExitCode,
    workDir,
    timeoutMs,
    agent: values.agent,
    retryAgent: values['retry-agent'],
    error: spawnError || null,
    primaryPublishStatus,
    channelCompleteness,
    missingRequiredChannels,
    runSummary,
    reservationRecovery,
    cleanup,
    triage,
};
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
process.removeListener('SIGTERM', onSignal);
process.removeListener('SIGINT', onSignal);
process.exit(receipt.exitCode);
