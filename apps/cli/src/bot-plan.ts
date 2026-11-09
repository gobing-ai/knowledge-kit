/**
 * `kk bot plan` plan-file decoding. It lives outside `commands/` because the
 * `cli-no-parse-at-module-scope` rule matches every `.parse(` in a command module. The shape of
 * the plan itself is validated by the harness (`runBotCollection` → `normalizePlan`), so this only
 * reports "not JSON" and "not an object".
 */
export type DecodedBotPlan =
    | { ok: true; plan: Record<string, unknown> }
    | { ok: false; reason: 'invalid-json' | 'not-object' };

/** Decode plan-file text into a JSON object, or name why it is not one. */
export function decodeBotPlan(raw: string): DecodedBotPlan {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, reason: 'invalid-json' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false, reason: 'not-object' };
    }
    return { ok: true, plan: parsed as Record<string, unknown> };
}
