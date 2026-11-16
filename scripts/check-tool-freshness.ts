/**
 * Freshness guard for the never-pinned global tools (AGENTS.md "Tool versions"):
 * warns when the installed `spur`/`superskill` is behind npm latest, when a
 * stale second copy shadows the newest binary on PATH, or when the installed
 * `kk` package's `plugins/kk/{workflows,scripts}` has drifted from this checkout.
 * Warn-only by design — the offline gate must not depend on the network.
 * `--strict` turns warnings into a nonzero exit (for scheduled runs that want teeth).
 *
 * WHY the kk section (incident 2026-11-16): commit 5fd38638 changed
 * `plugins/kk/scripts/daily-stages.ts` at 00:00, the installed copy was last synced
 * at 23:30, and nothing compared the two. `kk news generate`'s launch preflight does
 * compare them — so the 04:30 tick was refused with exit 5, no episode was produced,
 * and the divergence was only discovered by reading the failed job. The preflight
 * must keep refusing (the executed stage body is the installed one, so a silent run
 * would execute the stale code); what was missing is a report that surfaces the same
 * comparison *before* the tick. This script is that report — it makes the identical
 * check, prints the exact sync commands, and never mutates anything.
 *
 * Usage: bun scripts/check-tool-freshness.ts [--strict]
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const TOOLS = [
    { bin: 'spur', pkg: '@gobing-ai/spur' },
    { bin: 'superskill', pkg: '@gobing-ai/superskill' },
] as const;

/** The one package whose executed plugin bodies are read from the install, not the checkout. */
const KK_PACKAGE = '@gobing-ai/knowledge-kit';

/** Trees the launch preflight compares (`apps/cli/src/launch.ts` → `runPreflight`). */
const KK_DIVERGENCE_TREES = ['plugins/kk/workflows', 'plugins/kk/scripts'] as const;

interface ToolReport {
    bin: string;
    binaries: { path: string; version: string }[];
    latest: string | undefined;
    warnings: string[];
}

function run(cmd: string, args: string[]): string | undefined {
    try {
        const proc = Bun.spawnSync([cmd, ...args], { env: process.env, stdout: 'pipe', stderr: 'pipe' });
        const out = proc.stdout.toString().trim();
        if (proc.exitCode !== 0 || !out) return undefined;
        return out;
    } catch {
        return undefined;
    }
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

/** Every regular file under `root`, keyed by its path relative to `root`. */
function treeFiles(root: string): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    if (!existsSync(root)) return files;
    const walk = (dir: string, rel: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            // `.DS_Store`/editor debris and run logs never reach the install; comparing them would
            // report a divergence the preflight does not.
            if (entry.name.startsWith('.') || entry.name.endsWith('.log')) continue;
            const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
            if (entry.isDirectory()) walk(join(dir, entry.name), relPath);
            else if (entry.isFile()) files.set(relPath, readFileSync(join(dir, entry.name)));
        }
    };
    walk(root, '');
    return files;
}

/**
 * Relative paths that differ between two trees: content differs, or the file exists on one side
 * only. The same answer `diffDirs` gives the launch preflight, so a clean report means the
 * preflight will not refuse.
 */
export function treeDiffs(checkoutDir: string, installDir: string): string[] {
    const checkout = treeFiles(checkoutDir);
    const install = treeFiles(installDir);
    const names = [...new Set([...checkout.keys(), ...install.keys()])].sort();
    return names.filter((name) => {
        const a = checkout.get(name);
        const b = install.get(name);
        return a === undefined || b === undefined || !a.equals(b);
    });
}

/**
 * The package root owning the `kk` on PATH — the AGENTS.md resolution (the binary lives at
 * `<root>/dist/index.js`). Null when `kk` is absent or the winner is not this package (a
 * checkout shim, a shim wrapper), rather than guessing a directory to compare against.
 */
export function installRootOf(binPath: string): string | null {
    let real: string;
    try {
        real = realpathSync(binPath);
    } catch {
        return null;
    }
    const root = dirname(dirname(real));
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string };
        return pkg.name === KK_PACKAGE ? root : null;
    } catch {
        return null;
    }
}

/** The kk checkout-vs-install section: one warning listing every drifted file, or none. */
export function kkDivergenceWarnings(checkoutRoot: string, installRoot: string | null): string[] {
    if (installRoot === null) return ['kk not found on PATH (or not an installed @gobing-ai/knowledge-kit package)'];
    const drifts = KK_DIVERGENCE_TREES.flatMap((tree) => {
        const diffs = treeDiffs(join(checkoutRoot, tree), join(installRoot, tree));
        return diffs.map((name) => `${tree}/${name}`);
    });
    if (drifts.length === 0) return [];
    return [
        `checkout diverges from installed kk (${installRoot}): ${drifts.join(', ')}`,
        // The preflight refuses on this, so the next scheduled run produces nothing until the
        // install carries the checkout's stage bodies. Same commands as AGENTS.md.
        `  the scheduled run refuses (exit 5) until these are synced: rsync -a plugins/kk/scripts/ "${installRoot}/plugins/kk/scripts/" && rsync -a plugins/kk/workflows/ "${installRoot}/plugins/kk/workflows/"`,
    ];
}

/** Resolve the `kk` binaries the way a shell would: every PATH entry, in order. */
function kkBinPaths(): string[] {
    return (
        run('which', ['-a', 'kk'])
            ?.split('\n')
            .map((l) => l.trim())
            .filter(Boolean) ?? []
    );
}

/**
 * Distinct package roots among those binaries, in PATH order. This machine carries two installs
 * (AGENTS.md: the live bun-global one and a stale `~/node_modules` one) and `bun run` prepends
 * ancestor `node_modules/.bin` dirs, so the PATH winner here is NOT necessarily the binary the
 * scheduler's launchd PATH picks. Comparing every resolved root is what keeps the report honest.
 */
export function kkInstallRoots(binPaths: string[]): string[] {
    const roots = binPaths.map((path) => installRootOf(path)).filter((root): root is string => root !== null);
    return [...new Set(roots)];
}

/** Run the report; returns the exit code (1 when anything needs attention and `--strict`). */
export function main(argv: string[], checkoutRoot = resolve(import.meta.dir, '..')): number {
    const strict = argv.includes('--strict');
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
            warnings.push(
                `${binaries.length} ${bin} binaries on PATH — keep one (see AGENTS.md "Single global install")`,
            );
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
            warnings.push(
                `${bin} ${installed} is behind npm latest ${latest} — upgrade (bun install -g ${pkg}@latest)`,
            );
        }
        reports.push({ bin, binaries, latest, warnings });
    }

    for (const r of reports) {
        const resolved = r.binaries[0]?.version ?? 'not found';
        console.log(`${r.bin}: resolved ${resolved}${r.latest ? ` · npm latest ${r.latest}` : ''}`);
        for (const b of r.binaries.slice(1)) console.log(`  shadow: ${b.version} at ${b.path}`);
        for (const w of r.warnings) console.log(`  WARN ${w}`);
    }

    const kkRoots = kkInstallRoots(kkBinPaths());
    const kkWarnings: string[] = [];
    if (kkRoots.length === 0) {
        kkWarnings.push('kk not found on PATH (or not an installed @gobing-ai/knowledge-kit package)');
    }
    for (const root of kkRoots) {
        console.log(`kk: install ${root}`);
        const warnings = kkDivergenceWarnings(checkoutRoot, root);
        for (const w of warnings) console.log(`  WARN ${w}`);
        kkWarnings.push(...warnings);
    }
    if (kkRoots.length === 0) console.log(`kk: install unresolved`);
    if (kkRoots.length > 1) {
        const shadow = `kk: ${kkRoots.length} installs on PATH (${kkRoots.join(', ')}) — keep one (AGENTS.md "Single global install")`;
        console.log(`  WARN ${shadow}`);
        kkWarnings.push(shadow);
    }

    const failed = reports.some((r) => r.warnings.length > 0) || kkWarnings.length > 0;
    return failed && strict ? 1 : 0;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
