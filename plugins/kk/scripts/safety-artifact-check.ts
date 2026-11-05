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

/** 0331: scope-aware artifact root — `24-script` (or empty) keeps the drafts paths byte-identical. */
function safetyPath(workDir: string, scopeDir: string, runDate: string, name: string): string {
    const dir = scopeDir.trim() === '' || scopeDir.trim() === '24-script' ? '24-script' : scopeDir.trim();
    return join(workDir, dir, `${runDate}_09_${name}`);
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

function reportValid(workDir: string, scopeDir: string, runDate: string): string | null {
    const request = readJson(safetyPath(workDir, scopeDir, runDate, 'safety-review_request.json'));
    const report = readJson(safetyPath(workDir, scopeDir, runDate, 'safety-review_report.json'));
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

function judgeValid(workDir: string, scopeDir: string, runDate: string): string | null {
    const verdict = readJson(safetyPath(workDir, scopeDir, runDate, 'safety-judge_verdict.json'));
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
function publishValid(workDir: string, scopeDir: string, runDate: string, unattendedArg: string): string | null {
    if (unattendedArg !== 'true' && unattendedArg !== 'false') return 'unattended must be true or false';
    const verdictToken = safetyPath(workDir, scopeDir, runDate, 'safety-verdict.status');
    const gateStatusPath = safetyPath(workDir, scopeDir, runDate, 'safety-judge_status.txt');
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

function draftDigest(workDir: string, scopeDir: string, runDate: string): string | null {
    const hash = createHash('sha256');
    if (scopeDir.trim() === '' || scopeDir.trim() === '24-script') {
        const article = join(workDir, '22-article', `${runDate}_06_article_content.json`);
        const script = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
        try {
            hash.update(readFileSync(article)).update('\0');
            hash.update(readFileSync(script)).update('\0');
            return hash.digest('hex');
        } catch {
            return null;
        }
    }
    // Variants scope: digest over the manifest's sorted keys + current bytes (mirrors the
    // daily-stages scopeDigest algorithm, so request/guard/verdict all bind the same bytes).
    try {
        const manifest = readJson(join(workDir, '4-safety-variants', 'manifest.json')) as {
            variants?: Record<string, { path?: unknown }>;
        } | null;
        if (manifest === null || !isObject(manifest.variants)) return null;
        for (const key of Object.keys(manifest.variants).sort()) {
            const path = join(workDir, String(manifest.variants[key].path));
            hash.update(key).update('\0').update(readFileSync(path)).update('\0');
        }
        return hash.digest('hex');
    } catch {
        return null;
    }
}

function revisionValid(workDir: string, scopeDir: string, runDate: string): string | null {
    const request = readJson(safetyPath(workDir, scopeDir, runDate, 'safety-review_request.json'));
    if (request === null || !nonEmptyString(request.digest)) return 'review request digest is missing';
    const isVariants = scopeDir.trim() !== '' && scopeDir.trim() !== '24-script';
    const digest = draftDigest(workDir, scopeDir, runDate);
    if (digest === null) {
        return isVariants
            ? 'a manifest-listed variant is missing/unreadable'
            : 'revised article or VoiceScript is missing/unreadable';
    }
    if (digest === request.digest) return isVariants ? 'variant digest is unchanged' : 'draft digest is unchanged';
    if (isVariants) {
        const manifest = readJson(join(workDir, '4-safety-variants', 'manifest.json')) as {
            variants?: Record<string, { path?: unknown }>;
        } | null;
        if (manifest === null || !isObject(manifest.variants)) return 'variants manifest is missing/malformed';
        for (const entry of Object.values(manifest.variants)) {
            const value = readJson(join(workDir, String(entry.path)));
            if (value === null || !nonEmptyString(value.title) || !nonEmptyString(value.body)) {
                return 'revised variant title/body is missing';
            }
        }
        return null;
    }
    const articlePath = join(workDir, '22-article', `${runDate}_06_article_content.json`);
    const scriptPath = join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`);
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
    // 0331: an optional trailing scope dir re-roots every artifact path (variants review reads
    // 4-safety-variants); publish-valid keeps `unattended` in the 4th slot it has always had.
    const [kind = '', workDir = '', runDate = '', fourth = '', fifth = ''] = process.argv.slice(2);
    const isPublish = kind === 'publish-valid';
    const unattended = isPublish ? fourth : 'false';
    const scopeDir = isPublish ? fifth : fourth;
    if (!kind || !workDir || !runDate) {
        console.error(
            'usage: safety-artifact-check.ts <report-valid|judge-valid|revision-valid|publish-valid> <work_dir> <run_date> [unattended] [scope_dir]',
        );
        return 2;
    }
    const reason =
        kind === 'report-valid'
            ? reportValid(workDir, scopeDir, runDate)
            : kind === 'judge-valid'
              ? judgeValid(workDir, scopeDir, runDate)
              : kind === 'revision-valid'
                ? revisionValid(workDir, scopeDir, runDate)
                : kind === 'publish-valid'
                  ? publishValid(workDir, scopeDir, runDate, unattended)
                  : 'unknown predicate';
    if (reason !== null) {
        console.error(`safety-artifact-check: ${kind}: ${reason}`);
        return 1;
    }
    console.log(`safety-artifact-check: ${kind}: ok`);
    return 0;
}

process.exitCode = main();
