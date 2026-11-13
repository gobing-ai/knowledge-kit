/**
 * XHS automation-risk guard (ADR-025, 2026-09-28).
 *
 * XHS warned the operator about automated login/publish activity. This channel is the only target
 * in the repo that drives an interactive creator console from a browser, so a repeated or runaway
 * visit is an account-level risk rather than a failed run. The guard bounds console visits with two
 * independent 2h budgets — one headed publish cycle and one read-only session check — recorded in
 * a small state file.
 *
 * Semantics that matter:
 *  - The `publish` budget is consumed at the single headed launch, including session-readiness
 *    refusal. Offline checks spend nothing; explicit headed checks consume the check budget.
 *  - `login` is deliberately uncapped. It is operator-interactive by construction (a human types the
 *    credentials into the opened window), so capping it would only block recovery.
 *  - An unreadable or unparsable state file is REFUSED, not treated as empty: the guard cannot prove
 *    the window is clean, and a silent reset is the one failure mode that defeats it.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

// File IO goes through the ts-runtime FileSystem seam (rule no-direct-fs-io). The node backend uses
// sync fs APIs and `writeFile` creates missing parents; the interface unions Promise for CF stubs,
// so pin the sync shape once here (same pin as image-gen's presets.ts).
const fs = createNodeFileSystem() as unknown as {
    exists(path: string): boolean;
    readFile(path: string): string;
    writeFile(path: string, content: string): void;
};

/** The capped automation events. `login` is intentionally absent — see the module comment. */
export type XhsAutomationEvent = 'check' | 'publish';

/** One headed publish cycle and one read-only session check per window. */
export const CAP_WINDOW_MS = 2 * 60 * 60 * 1000;

/** State-file override for tests and multi-account machines; default is the shared kk config dir. */
export const AUTOMATION_STATE_ENV = 'KK_XHS_AUTOMATION_STATE';

export interface AutomationVerdict {
    allowed: boolean;
    /** Empty when allowed; the operator-facing refusal reason otherwise. */
    reason: string;
}

export interface AutomationGuard {
    /** Refuse when this event already ran inside the window. Reads only — never consumes. */
    allow(event: XhsAutomationEvent): AutomationVerdict;
    /** Consume the event's budget. Call immediately before the console visit it pays for. */
    record(event: XhsAutomationEvent): void;
}

export function resolveAutomationStatePath(override?: string): string {
    const explicit = override ?? process.env[AUTOMATION_STATE_ENV];
    if (explicit !== undefined && explicit !== '') return resolve(explicit);
    // process.env.HOME directly: Bun snapshots os.homedir() at startup, so a runtime HOME override
    // (tests) would be invisible through homedir(). Mirrors image-gen's preset-root resolution.
    return join(process.env.HOME ?? homedir(), '.config', 'kk', 'xhs-automation.json');
}

type AutomationState = Partial<Record<XhsAutomationEvent, string>>;

function resetHint(path: string): string {
    return `delete ${path} to reset the automation window (the guard cannot prove the window is clean)`;
}

/**
 * `ok: true` only for an absent file (the legitimate first run) or a readable JSON object. Every
 * other outcome is a refusal the operator can act on, so a corrupt file cannot silently grant a
 * fresh budget.
 */
function readState(path: string): { ok: true; state: AutomationState } | { ok: false; reason: string } {
    // An absent file is the first run; anything present but unreadable (a directory, a permission
    // failure) is refused rather than treated as empty.
    if (!fs.exists(path)) return { ok: true, state: {} };
    let raw: string;
    try {
        raw = fs.readFile(path);
    } catch (error) {
        return { ok: false, reason: `state file ${path} is unreadable: ${(error as Error).message}` };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, reason: `state file ${path} is not valid JSON` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: `state file ${path} is not a JSON object` };
    }
    return { ok: true, state: parsed as AutomationState };
}

export function createAutomationGuard(options?: { statePath?: string; now?: () => Date }): AutomationGuard {
    const statePath = resolveAutomationStatePath(options?.statePath);
    const now = options?.now ?? (() => new Date());
    return {
        allow(event) {
            const read = readState(statePath);
            if (!read.ok) return { allowed: false, reason: `${read.reason} — ${resetHint(statePath)}` };
            const last = read.state[event];
            if (last === undefined) return { allowed: true, reason: '' };
            const lastMs = Date.parse(last);
            if (!Number.isFinite(lastMs)) {
                return {
                    allowed: false,
                    reason: `state file ${statePath} records an unparsable '${event}' timestamp ('${last}') — ${resetHint(statePath)}`,
                };
            }
            const elapsed = now().getTime() - lastMs;
            if (elapsed >= CAP_WINDOW_MS) return { allowed: true, reason: '' };
            const waitMinutes = Math.ceil((CAP_WINDOW_MS - elapsed) / 60_000);
            return {
                allowed: false,
                reason: `'${event}' already ran ${Math.round(elapsed / 60_000)}min ago; the cap allows one per ${CAP_WINDOW_MS / 3_600_000}h — retry in ${waitMinutes}min, or set ${AUTOMATION_STATE_ENV} to a separate state file for a deliberate second profile`,
            };
        },
        record(event) {
            const read = readState(statePath);
            // `allow` already gated this call, so a corrupt file reaching here is being repaired,
            // not trusted: the new state replaces it wholesale.
            const state: AutomationState = read.ok ? read.state : {};
            state[event] = now().toISOString();
            fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
        },
    };
}
