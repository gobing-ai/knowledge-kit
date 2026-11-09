// Repository probe for the rendered collection runner (task 0346 R6, ADR-038 amendment).
// Drives the same JSON plan an ingestion plugin would, without adding a `kk` command: the
// scheduled path stays plugin-owned, and this is the hand-debugging surface.
//
//   bun packages/publish-harness/scripts/bot-collection-probe.ts \
//     --profile <name> --plan <plan.json> --out <dir> [--profile-root <dir> --lease-root <dir>]
//
// Writes each body to `<out>/<n>-<id>.txt` (0600) and `<out>/result.json` without bodies. On
// failure it writes `<out>/error.json` with the typed code/message/step id only. It never prints a
// body, a query-bearing URL, or a supplied plan value — an ingest plan can carry a token.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BotError } from '../src/bot';
import { type BotCollectionOptions, type BotCollectionPlan, runBotCollection } from '../src/bot-collection';

const USAGE =
    'usage: bun packages/publish-harness/scripts/bot-collection-probe.ts --profile <name> --plan <plan.json> ' +
    '--out <dir> [--profile-root <dir> --lease-root <dir>]';

interface ProbeArgs {
    profile: string;
    planPath: string;
    outDir: string;
    profileRoot?: string;
    leaseRoot?: string;
}

/** Parse argv, naming only flags: a supplied value can carry a grant. */
function parseArgs(argv: string[]): ProbeArgs {
    const values = new Map<string, string>();
    const known = new Set(['--profile', '--plan', '--out', '--profile-root', '--lease-root']);
    for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (flag === undefined || !known.has(flag))
            throw new BotError('usage', `unknown argument: ${flag ?? '(none)'}`);
        if (value === undefined || value.startsWith('--')) throw new BotError('usage', `missing value for ${flag}`);
        values.set(flag, value);
    }
    const required = (flag: string): string => {
        const value = values.get(flag);
        if (value === undefined) throw new BotError('usage', `missing required flag ${flag}`);
        return value;
    };
    return {
        profile: required('--profile'),
        planPath: required('--plan'),
        outDir: required('--out'),
        ...(values.has('--profile-root') ? { profileRoot: values.get('--profile-root') as string } : {}),
        ...(values.has('--lease-root') ? { leaseRoot: values.get('--lease-root') as string } : {}),
    };
}

/** Read and parse the plan file; a parse failure names the file, never its content. */
async function readPlan(path: string): Promise<BotCollectionPlan> {
    let raw: string;
    try {
        raw = await readFile(path, 'utf8');
    } catch {
        throw new BotError('usage', 'plan file could not be read');
    }
    try {
        return JSON.parse(raw) as BotCollectionPlan;
    } catch {
        throw new BotError('usage', 'plan file is not valid JSON');
    }
}

/** Artifact bodies are written to files; ids are already safe, but keep the file name separated. */
function artifactFileName(index: number, id: string): string {
    return `${String(index).padStart(2, '0')}-${id.replace(/[^A-Za-z0-9_-]/g, '-')}.txt`;
}

async function main(): Promise<void> {
    let args: ProbeArgs;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (error) {
        const failure = error instanceof BotError ? error : new BotError('usage', 'invalid arguments');
        process.stdout.write(
            `${JSON.stringify({ ok: false, error: { code: failure.code, message: failure.message } })}\n`,
        );
        process.stdout.write(`${USAGE}\n`);
        process.exit(2);
    }

    try {
        const plan = await readPlan(args.planPath);
        const options: BotCollectionOptions = {
            ...(args.profileRoot === undefined ? {} : { root: args.profileRoot }),
            ...(args.leaseRoot === undefined ? {} : { leaseRoot: args.leaseRoot }),
        };
        const result = await runBotCollection(args.profile, plan, options);

        await mkdir(args.outDir, { recursive: true, mode: 0o700 });
        const artifacts: Array<Record<string, unknown>> = [];
        for (const [index, artifact] of result.artifacts.entries()) {
            const file = artifactFileName(index, artifact.id);
            await writeFile(join(args.outDir, file), artifact.body, { encoding: 'utf8', mode: 0o600 });
            artifacts.push({
                id: artifact.id,
                kind: artifact.kind,
                file,
                bytes: Buffer.byteLength(artifact.body, 'utf8'),
                ...(artifact.status === undefined ? {} : { status: artifact.status }),
                ...(artifact.url === undefined ? {} : { url: artifact.url }),
                ...(artifact.stepIndex === undefined ? {} : { stepIndex: artifact.stepIndex }),
            });
        }
        const summary = { ok: true, profile: args.profile, steps: result.steps, artifacts };
        await writeFile(join(args.outDir, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
        });
        process.stdout.write(`${JSON.stringify(summary)}\n`);
    } catch (error) {
        const failure =
            error instanceof BotError
                ? error
                : new BotError('browser', error instanceof Error ? error.name : 'collection probe failed');
        const payload = {
            ok: false,
            error: {
                code: failure.code,
                message: failure.message,
                ...(failure.details.stepIndex === undefined ? {} : { stepIndex: failure.details.stepIndex }),
                ...(failure.details.stepId === undefined ? {} : { stepId: failure.details.stepId }),
            },
        };
        try {
            await mkdir(args.outDir, { recursive: true, mode: 0o700 });
            await writeFile(join(args.outDir, 'error.json'), `${JSON.stringify(payload, null, 2)}\n`, {
                encoding: 'utf8',
                mode: 0o600,
            });
        } catch {
            // A probe that cannot write its error artifact still reports the typed failure below.
        }
        process.stdout.write(`${JSON.stringify(payload)}\n`);
        process.exit(failure.code === 'usage' ? 2 : 1);
    }
}

await main();
