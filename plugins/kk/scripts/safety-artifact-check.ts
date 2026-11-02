#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
/**
 * Pure safety-workflow transition predicates.
 *
 * The safety state machine cannot put a condition on an individual action. These predicates keep
 * retry routing outside the agent actions: a successful primary artifact is preserved, while a
 * missing or malformed artifact takes the bounded retry edge. The revision predicate also uses the
 * safety request digest rather than Spur's Git working-tree `requireDiff` contract because daily
 * drafts live under the ignored `.works` tree. The publish predicate keeps a real safety escalation
 * out of unattended publication without mistaking a catalog fallback value for one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPORT_DECISIONS = new Set(['OK', 'RISK', 'BLOCK']);
const CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);
const FINDING_DISPOSITIONS = new Set(['note', 'fix', 'gap', 'escalate']);
const FINDING_STATUSES = new Set(['pass', 'fail', 'warn']);
const COMPLIANCE_CRITERIA = new Set([
    'no-prohibited-claims',
    'disclosure-presence',
    'jurisdictional-rules',
    'data-handling',
]);
const VERDICTS = new Set(['PASS', 'FAIL', 'NEEDS_REVISION']);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path: string): JsonObject | null {
    try {
        const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return isObject(value) ? value : null;
    } catch {
        return null;
    }
}

function safetyPath(workDir: string, runDate: string, name: string): string {
    return join(workDir, '24-script', `${runDate}_09_${name}`);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

function stringList(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some((entry) => !nonEmptyString(entry))) return null;
    return value.map((entry) => String(entry));
}

function sortedUnique(values: string[]): string[] | null {
    const unique = [...new Set(values)];
    return unique.length === values.length ? unique.sort() : null;
}

function reportValid(workDir: string, runDate: string): string | null {
    const request = readJson(safetyPath(workDir, runDate, 'safety-review_request.json'));
    const report = readJson(safetyPath(workDir, runDate, 'safety-review_report.json'));
    if (request === null || report === null) return 'review request or report is missing/invalid JSON';

    const requested = stringList(request.platforms);
    const platforms = report.platforms;
    if (requested === null || !Array.isArray(platforms) || platforms.length === 0) {
        return 'review request platforms or report platforms[] is missing/empty';
    }
    const requestedNames = sortedUnique(requested);
    const actualNames: string[] = [];
    for (const platform of platforms) {
        if (!isObject(platform) || !nonEmptyString(platform.platform)) return 'report platform entry is malformed';
        const name = String(platform.platform);
        if (!REPORT_DECISIONS.has(String(platform.decision))) return `invalid platform decision for ${name}`;
        if (!Array.isArray(platform.findings)) return `findings[] is missing for ${name}`;
        for (const finding of platform.findings) {
            if (!isObject(finding)) return `finding entry is malformed for ${name}`;
            if (finding.disposition !== undefined && !FINDING_DISPOSITIONS.has(String(finding.disposition))) {
                return `invalid finding disposition for ${name}`;
            }
            if (finding.evidenceGap !== undefined && typeof finding.evidenceGap !== 'boolean') {
                return `evidenceGap must be boolean for ${name}`;
            }
        }
        actualNames.push(name);
    }
    const actualNamesSorted = sortedUnique(actualNames);
    if (
        requestedNames === null ||
        actualNamesSorted === null ||
        requestedNames.join('\0') !== actualNamesSorted.join('\0')
    ) {
        return 'report platforms do not exactly match the requested platforms';
    }
    if (!CONFIDENCE.has(String(report.confidence))) return 'report confidence is missing/invalid';
    if (typeof report.escalate !== 'boolean') return 'report escalate must be boolean';
    return null;
}

function judgeValid(workDir: string, runDate: string): string | null {
    const verdict = readJson(safetyPath(workDir, runDate, 'safety-judge_verdict.json'));
    if (verdict === null) return 'judge verdict is missing/invalid JSON';
    if (!VERDICTS.has(String(verdict.verdict))) return 'judge verdict value is invalid';
    if (!CONFIDENCE.has(String(verdict.confidence))) return 'judge confidence is missing/invalid';
    if (verdict.rubric !== 'compliance') return 'judge rubric must be compliance';
    if (
        typeof verdict.score !== 'number' ||
        !Number.isFinite(verdict.score) ||
        verdict.score < 0 ||
        verdict.score > 1
    ) {
        return 'judge score must be a finite number from 0 through 1';
    }
    if (!nonEmptyString(verdict.summary)) return 'judge summary is missing/empty';
    if (!Array.isArray(verdict.findings) || verdict.findings.length === 0) return 'judge findings[] is missing/empty';
    const criteria = new Set<string>();
    for (const finding of verdict.findings) {
        if (!isObject(finding)) return 'judge finding entry is malformed';
        if (!nonEmptyString(finding.criterion)) return 'judge finding criterion is missing/empty';
        if (!FINDING_STATUSES.has(String(finding.status))) return 'judge finding status is invalid';
        if (!nonEmptyString(finding.detail)) return 'judge finding detail is missing/empty';
        criteria.add(String(finding.criterion));
    }
    if (
        verdict.verdict === 'PASS' &&
        verdict.findings.some((finding) => isObject(finding) && finding.status === 'fail')
    ) {
        return 'PASS verdict cannot contain a fail finding';
    }
    for (const criterion of COMPLIANCE_CRITERIA) {
        if (!criteria.has(criterion)) return `judge findings omit compliance criterion ${criterion}`;
    }
    if (!Array.isArray(verdict.feedback) || verdict.feedback.some((entry) => !nonEmptyString(entry))) {
        return 'judge feedback[] is missing or contains an empty/non-string entry';
    }
    if (!nonEmptyString(verdict.content_ref)) return 'judge content_ref is missing/empty';
    if (!nonEmptyString(verdict.evaluated_at) || !/^\d{4}-\d{2}-\d{2}T/.test(verdict.evaluated_at)) {
        return 'judge evaluated_at must be an ISO-8601 timestamp';
    }
    if (!Number.isFinite(Date.parse(verdict.evaluated_at))) return 'judge evaluated_at is not a valid timestamp';
    return null;
}

/**
 * The catalog decision may fall back to `escalate` even when the gate admitted `pass` or `exclude`.
 * Only the gate's persisted status represents a real content-safety escalation, so unattended mode
 * rejects that status while attended mode leaves it for the caller's pause node.
 */
function publishValid(workDir: string, runDate: string, unattendedArg: string): string | null {
    if (unattendedArg !== 'true' && unattendedArg !== 'false') return 'unattended must be true or false';
    const verdictToken = safetyPath(workDir, runDate, 'safety-verdict.status');
    const gateStatusPath = safetyPath(workDir, runDate, 'safety-judge_status.txt');
    let token = '';
    let gateStatus = '';
    try {
        token = readFileSync(verdictToken, 'utf8').trim();
        gateStatus = readFileSync(gateStatusPath, 'utf8').trim();
    } catch {
        return 'safety verdict token or gate status is missing/unreadable';
    }
    if (token !== 'accept') return `safety verdict token is ${token || 'missing'}, not accept`;
    if (!new Set(['pass', 'exclude', 'escalate']).has(gateStatus)) {
        return `gate status ${gateStatus || 'missing'} is not publish-valid`;
    }
    if (unattendedArg === 'true' && gateStatus === 'escalate') {
        return 'unattended run refuses a real safety escalation; attended review is required';
    }
    return null;
}

function draftDigest(workDir: string, runDate: string): string | null {
    const article = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    const script = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
    try {
        const hash = createHash('sha256');
        hash.update(readFileSync(article)).update('\0');
        hash.update(readFileSync(script)).update('\0');
        return hash.digest('hex');
    } catch {
        return null;
    }
}

function revisionValid(workDir: string, runDate: string): string | null {
    const request = readJson(safetyPath(workDir, runDate, 'safety-review_request.json'));
    const articlePath = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    const scriptPath = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
    if (request === null || !nonEmptyString(request.digest)) return 'review request digest is missing';
    if (draftDigest(workDir, runDate) === null) return 'revised article or VoiceScript is missing/unreadable';
    if (draftDigest(workDir, runDate) === request.digest) return 'draft digest is unchanged';

    const article = readJson(articlePath);
    if (article === null || !nonEmptyString(article.title) || !nonEmptyString(article.body)) {
        return 'revised article title/body is missing';
    }

    const validator = join(import.meta.dir, 'validate-voicescript.ts');
    const result = spawnSync(process.execPath, [validator, '--in', scriptPath], {
        encoding: 'utf8',
        stdio: 'ignore',
    });
    if (result.status !== 0) return 'revised VoiceScript failed content validation';
    return null;
}

function main(): number {
    const [kind = '', workDir = '', runDate = '', unattended = 'false'] = process.argv.slice(2);
    if (!kind || !workDir || !runDate) {
        console.error(
            'usage: safety-artifact-check.ts <report-valid|judge-valid|revision-valid|publish-valid> <work_dir> <run_date> [unattended]',
        );
        return 2;
    }
    const reason =
        kind === 'report-valid'
            ? reportValid(workDir, runDate)
            : kind === 'judge-valid'
              ? judgeValid(workDir, runDate)
              : kind === 'revision-valid'
                ? revisionValid(workDir, runDate)
                : kind === 'publish-valid'
                  ? publishValid(workDir, runDate, unattended)
                  : 'unknown predicate';
    if (reason !== null) {
        console.error(`safety-artifact-check: ${kind}: ${reason}`);
        return 1;
    }
    console.log(`safety-artifact-check: ${kind}: ok`);
    return 0;
}

process.exitCode = main();
