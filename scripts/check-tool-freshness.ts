/**
 * Freshness guard for the never-pinned global tools (AGENTS.md "Tool versions"):
 * warns when the installed `spur`/`superskill` is behind npm latest, or when a
 * stale second copy shadows the newest binary on PATH. Warn-only by design —
 * the offline gate must not depend on the network. `--strict` turns warnings
 * into a nonzero exit (for scheduled runs that want teeth).
 *
 * Usage: bun scripts/check-tool-freshness.ts [--strict]
 */

import { realpathSync } from 'node:fs';

const TOOLS = [
    { bin: 'spur', pkg: '@gobing-ai/spur' },
    { bin: 'superskill', pkg: '@gobing-ai/superskill' },
] as const;

interface ToolReport {
    bin: string;
    binaries: { path: string; version: string }[];
    latest: string | undefined;
    warnings: string[];
}

const strict = process.argv.includes('--strict');

function run(cmd: string, args: string[]): string | undefined {
    const proc = Bun.spawnSync([cmd, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const out = proc.stdout.toString().trim();
    if (proc.exitCode !== 0 || !out) return undefined;
    return out;
}

/** The version is the last non-empty stdout line (spur prints banner art first). */
function versionOf(binPath: string): string | undefined {
    const out = run(binPath, ['--version']);
    if (!out) return undefined;
    const lines = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    return lines.at(-1);
}

/** Naive dotted-numeric compare is enough: warn-only, same tool, near releases. */
function isNewer(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff > 0;
    }
    return false;
}

const reports: ToolReport[] = [];
for (const { bin, pkg } of TOOLS) {
    const warnings: string[] = [];
    const paths = [
        ...new Set(
            run('which', ['-a', bin])
                ?.split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                // `bun run` prepends ancestor node_modules/.bin dirs, so one install can appear via several symlinks.
                .map((l) => realpathSync(l)) ?? [],
        ),
    ];
    const binaries = paths.map((path) => ({ path, version: versionOf(path) ?? 'unknown' }));
    if (binaries.length === 0) {
        warnings.push(`${bin} not found on PATH`);
    } else if (binaries.length > 1) {
        warnings.push(`${binaries.length} ${bin} binaries on PATH — keep one (see AGENTS.md "Single global install")`);
    }
    const newest = binaries.reduce<{ path: string; version: string } | undefined>(
        (acc, b) => (!acc || isNewer(b.version, acc.version) ? b : acc),
        undefined,
    );
    const winner = binaries[0];
    if (newest && winner && winner.version !== newest.version) {
        warnings.push(
            `PATH resolves ${bin} to ${winner.version} (${winner.path}) but ${newest.version} exists at ${newest.path} — stale shadow`,
        );
    }
    const latest = run('npm', ['view', pkg, 'version']);
    const installed = winner?.version;
    if (latest && installed && installed !== 'unknown' && isNewer(latest, installed)) {
        warnings.push(`${bin} ${installed} is behind npm latest ${latest} — upgrade (bun install -g ${pkg}@latest)`);
    }
    reports.push({ bin, binaries, latest, warnings });
}

for (const r of reports) {
    const resolved = r.binaries[0]?.version ?? 'not found';
    console.log(`${r.bin}: resolved ${resolved}${r.latest ? ` · npm latest ${r.latest}` : ''}`);
    for (const b of r.binaries.slice(1)) console.log(`  shadow: ${b.version} at ${b.path}`);
    for (const w of r.warnings) console.log(`  WARN ${w}`);
}

const failed = reports.some((r) => r.warnings.length > 0);
if (failed && strict) process.exit(1);
