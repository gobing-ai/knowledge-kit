/**
 * Resolve one authored brief through the shipped presets and print the trace
 * (task 0399 R3). This is the surface 0401's `kk music presets` verb wraps, and
 * the one a test or a probe drives to prove the exit codes:
 *
 *   bun plugins/generations/music-gen/scripts/resolve-preset.ts --in brief.yaml
 *   bun plugins/generations/music-gen/scripts/resolve-preset.ts --in brief.yaml --root /tmp/presets
 *   bun plugins/generations/music-gen/scripts/resolve-preset.ts --in brief.yaml --json
 *
 * Exit 0 resolved · 1 unparseable brief or unknown format/theme · 2 invalid preset file.
 * An unknown name never falls back: it prints the valid names and the trace the
 * layers that did exist produced.
 */
import { readFileSync } from 'node:fs';
import { parseMusicBriefYaml } from '../src/brief';
import { explainJob, loadMusicPresets, PresetDataError, resolveNamedJob, UnknownPresetError } from '../src/presets';
import { renderGenerateRequest } from '../src/request';

function option(argv: readonly string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    const value = index >= 0 ? argv[index + 1] : undefined;
    return value === undefined ? undefined : value;
}

export async function main(argv: readonly string[]): Promise<number> {
    const briefPath = option(argv, '--in');
    if (briefPath === undefined) {
        console.error('usage: resolve-preset.ts --in <brief.yaml> [--root <preset-root>] [--json]');
        return 1;
    }
    let brief: ReturnType<typeof parseMusicBriefYaml>;
    try {
        brief = parseMusicBriefYaml(readFileSync(briefPath, 'utf8'));
    } catch (error) {
        console.error(`invalid brief ${briefPath}: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
    const root = option(argv, '--root');
    try {
        const presets = await loadMusicPresets(root === undefined ? {} : { root });
        const job = resolveNamedJob(brief, presets);
        for (const line of explainJob(job)) {
            console.log(line);
        }
        if (argv.includes('--json')) {
            console.log(JSON.stringify(renderGenerateRequest(job), null, 2));
        }
        return 0;
    } catch (error) {
        if (error instanceof UnknownPresetError) {
            console.error(error.report);
            return error.exitCode;
        }
        if (error instanceof PresetDataError) {
            console.error(error.message);
            return error.exitCode;
        }
        throw error;
    }
}

if (import.meta.main) {
    process.exit(await main(process.argv.slice(2)));
}
