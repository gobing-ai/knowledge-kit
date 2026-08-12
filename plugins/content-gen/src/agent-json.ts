/**
 * Extract the JSON an agent returned: prefer the first fenced block anywhere, then fall
 * back to the outermost {...} span, then the raw stdout. Shared by the owned STORM stages
 * (tasks 0046-0047) so the tolerance logic lives in one place.
 */
export function parseAgentJson(stdout: string): unknown {
    const fenced = stdout.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    const candidate = fenced?.[1] ?? (start !== -1 && end > start ? stdout.slice(start, end + 1) : stdout);
    return JSON.parse(candidate);
}
