#!/usr/bin/env bun
/**
 * Music stage runner — the composition owner for `plugins/kk/workflows/kk-music.yaml`
 * (task 0403, feature D8; ADR-115 keeps each YAML action one bounded call).
 *
 *   music-prepare     <works> <topic> <idea_file> <format> <theme> <directions> <force> <run_id>
 *   music-explore     <run_dir> <directions> <force> <force_reason> <dry_run> <run_id> [<kk_bin>]
 *   music-select      <run_dir> <choice> <auto>
 *   music-analyze     <run_dir> <dry_run> [<kk_bin>]
 *   music-judge-input <run_dir>
 *   music-finalize    <run_dir> <delivery_profile> <format> <run_id>
 *
 * **Why this file exists.** The workflow's states are `prepare -> brief -> explore -> select ->
 * analyze -> check -> judge -> master -> finalize`. Five of those are one `kk music` verb
 * (`check`, `master`) or one `agent.run` (`brief`, `judge`), but four are a *fan-out* or an
 * *assembly*: authoring the run directory, taking one paid take per differentiated brief,
 * binding the selected take and analyzing only it, assembling the judge bundle, and writing the
 * run report. The engine executes one state at a time, so a fan-out is a verb — and each of those
 * bodies is more than the five logical commands ADR-115 allows a shell action.
 *
 * **Money.** This file owns no spend rule. Every paid call is one `kk music gen` / `kk music
 * analyze` child process, so 0400's estimate, confirmation, run-scoped dedupe and take cap decide
 * everything. The stage adds exactly one thing on top: a brief whose take is already on disk is
 * *adopted* (sidecar + artifact present → no child process at all), which is R5's resume rule and
 * R2's "re-running explore pays only for briefs without a take".
 *
 * **No instance traffic of its own.** Node/Bun builtins only — no `@gobing-ai/*`, no HTTP, no
 * ffmpeg. `KK_MUSIC_DRY_RUN` is inherited by the children, and the workflow's `dry_run` var
 * forces it, so a dry run reaches the same code path as a paid one.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

/** The shipped format presets (`kk music presets`): each one names its own model. */
export const MUSIC_FORMATS = ['song', 'jingle', 'underscore', 'clip', 'loop'] as const;

/** Hard cap on directions — 0400's `HARD_TAKES_CAP` (the brief schema's `MAX_TAKES`). */
export const MAX_DIRECTIONS = 4;

/** Default directions: two differentiated briefs (0400's default `takesCap`). */
export const DEFAULT_DIRECTIONS = 2;

/** Run-report and selection file names, under the run directory. */
export const SELECTION_FILE = '3-takes/selection.json';
export const EXPLORE_FILE = '3-takes/explore.json';
export const JUDGE_INPUT_FILE = '4-judge-input.md';
export const VERDICT_FILE = '4-verdict-music.json';
export const REPORT_FILE = '5-run-report.md';
export const REPORT_JSON_FILE = '5-run-report.json';

/** Fail loudly: one message on stderr, exit 1 (the stage contract every sibling runner uses). */
export function fail(message: string): never {
    console.error(`music: ${message}`);
    process.exit(1);
}

/** `01`..`04` — the two-digit brief number the run-directory contract uses. */
export function briefNumber(n: number): string {
    return String(n).padStart(2, '0');
}

/** kebab-case a title into a directory-safe slug (the same rule the artifact names use). */
export function topicSlug(raw: string): string {
    const slug = raw
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return slug === '' ? 'music' : slug.slice(0, 48).replace(/-+$/, '');
}

/** Read + parse a JSON file, failing with the exact path when it is missing or malformed. */
export function readJson<T>(path: string): T {
    if (!existsSync(path)) fail(`missing artifact ${path}`);
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch (error: unknown) {
        return fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Write a JSON artifact the way every kk artifact is written: 4-space JSON plus one newline. */
export function writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

/**
 * Resolve the `kk` invocation a paid child runs under.
 *
 * Precedence: the explicit stage argument, then `KK_MUSIC_KK_BIN`, then `kk` on `PATH`. A checkout
 * entry (`…/apps/cli/src/index.ts`) runs under this process's own Bun, so a test or a pre-release
 * probe exercises this tree's verbs instead of whatever `kk` the install left on PATH (task 1110).
 */
export function kkArgv(bin: string | undefined): string[] {
    const chosen = (bin ?? '').trim() || (process.env.KK_MUSIC_KK_BIN ?? '').trim() || 'kk';
    return chosen.endsWith('.ts') || chosen.endsWith('.js') ? [process.execPath, chosen] : [chosen];
}

/** One take as `content-<nn>.json` records it. */
export interface TakeRecord {
    takeIndex: number;
    instanceId: string;
    model: string;
    format: string;
    digest: string;
    artifactPath: string;
    sidecarPath: string;
    unitPrice: number | null;
    [key: string]: unknown;
}

/** The single take a run delivers: what `select` binds and every later state reads. */
export interface Selection {
    schemaVersion: 1;
    brief: string;
    auto: boolean;
    take: TakeRecord;
}

/** Read `content-<nn>.json`'s take records, keeping only the ones whose artifact is on disk. */
export function existingTakes(contentPath: string): TakeRecord[] {
    if (!existsSync(contentPath)) return [];
    const parsed = readJson<{ metadata?: { takes?: TakeRecord[] } }>(contentPath);
    const takes = parsed.metadata?.takes ?? [];
    return takes.filter((take) => typeof take.artifactPath === 'string' && existsSync(take.artifactPath));
}

/** The run directory for one idea: `<works>/kk-music/<topic-slug>/`. */
export function runDirFor(works: string, topic: string, ideaFile: string): string {
    const label = topic.trim() !== '' ? topic : basename(ideaFile).replace(/\.[^.]+$/, '');
    return join(resolve(works), 'kk-music', topicSlug(label));
}

/** Write the selection and the two single-token projections `analyze`/`check`/`master` read. */
export function writeSelection(runDir: string, selection: Selection): void {
    writeJson(join(runDir, SELECTION_FILE), selection);
    writeFileSync(join(runDir, '3-takes/.take-file'), `${basename(selection.take.artifactPath)}\n`);
    writeFileSync(join(runDir, '3-takes/.instance-id'), `${selection.take.instanceId}\n`);
    writeFileSync(join(runDir, '3-takes/.brief'), `${selection.brief}\n`);
}

/** Read the recorded selection, failing on a run that has not passed the gate yet. */
export function readSelection(runDir: string): Selection {
    const selection = readJson<Selection>(join(runDir, SELECTION_FILE));
    if (typeof selection.take?.artifactPath !== 'string' || !existsSync(selection.take.artifactPath)) {
        fail(`selection names a take that is not on disk: ${String(selection.take?.artifactPath)}`);
    }
    return selection;
}

/**
 * `music-prepare` — resolve the run directory, stage its subdirectories, write `idea.md` and
 * publish the run-bound path the workflow projects back into `vars.run_dir`.
 */
export function musicPrepare(args: string[]): void {
    const [worksRaw = '', topic = '', ideaFile = '', format = 'song', theme = '', directionsRaw = '', , runId = ''] =
        args;
    if (topic.trim() === '' && ideaFile.trim() === '') {
        fail('a topic (or an idea file) is required: pass topic="<one line idea>" or idea_file=<path>');
    }
    if (ideaFile.trim() !== '' && !existsSync(resolve(ideaFile))) {
        fail(`idea file not found: ${resolve(ideaFile)}`);
    }
    if ((MUSIC_FORMATS as readonly string[]).includes(format) === false) {
        fail(`unknown format "${format}" (use one of ${MUSIC_FORMATS.join(', ')} — see kk music presets)`);
    }
    if (theme.trim() === '') {
        fail('a theme preset is required (see kk music presets for the shipped themes)');
    }
    const directions = directionsRaw.trim() === '' ? DEFAULT_DIRECTIONS : Number(directionsRaw);
    if (!Number.isInteger(directions) || directions < 1 || directions > MAX_DIRECTIONS) {
        fail(`directions ${directionsRaw} is not a whole number between 1 and ${MAX_DIRECTIONS}`);
    }

    const runDir = runDirFor(worksRaw === '' ? '.works' : worksRaw, topic, ideaFile);
    mkdirSync(join(runDir, '1-brief'), { recursive: true });
    mkdirSync(join(runDir, '3-takes'), { recursive: true });

    const ideaPath = join(runDir, 'idea.md');
    if (!existsSync(ideaPath)) {
        if (ideaFile.trim() !== '') {
            copyFileSync(resolve(ideaFile), ideaPath);
        } else {
            writeFileSync(ideaPath, `${topic.trim()}\n`);
        }
    }

    // Two projections, one value: the operator-facing pointer beside the runs, and the run-bound
    // file the workflow reads into `vars.run_dir` (the smart-seo preflight pattern).
    const musicRoot = dirname(runDir);
    writeFileSync(join(musicRoot, '.run-dir.txt'), `${runDir}\n`);
    mkdirSync(resolve('.spur/run'), { recursive: true });
    writeFileSync(resolve('.spur/run', `${runId}-music-run-dir.txt`), `${runDir}\n`);

    console.error(
        `music run directory: ${runDir} (format ${format}, theme ${theme}, directions ${String(directions)})`,
    );
}

/** `music-explore` — one paid take per differentiated brief, adopting any brief already taken (R2/R5). */
export function musicExplore(args: string[]): void {
    const [runDirRaw = '', directionsRaw = '', forceRaw = '', forceReason = '', dryRunRaw = '', runId = '', kkBin] =
        args;
    const runDir = resolve(runDirRaw === '' ? '.' : runDirRaw);
    if (!existsSync(runDir)) fail(`run directory not found: ${runDir}`);
    const directions = directionsRaw.trim() === '' ? DEFAULT_DIRECTIONS : Number(directionsRaw);
    if (!Number.isInteger(directions) || directions < 1 || directions > MAX_DIRECTIONS) {
        fail(`directions ${directionsRaw} is not a whole number between 1 and ${MAX_DIRECTIONS}`);
    }
    const force = forceRaw === 'true';
    if (force && forceReason.trim() === '') {
        fail('force needs a force_reason: a paid re-roll is never silent (0400 --force --reason <text>)');
    }
    const dryRun = dryRunRaw === 'true';

    const briefs: Record<string, unknown>[] = [];
    const takes: TakeRecord[] = [];
    for (let index = 1; index <= directions; index += 1) {
        const nn = briefNumber(index);
        const briefPath = join(runDir, '1-brief', `brief-${nn}.yaml`);
        const contentPath = join(runDir, '3-takes', `content-${nn}.json`);
        if (!existsSync(briefPath)) {
            fail(`missing brief ${briefPath} — author every direction before exploring (task's brief state)`);
        }
        const adopted = existingTakes(contentPath);
        if (adopted.length > 0) {
            const take = adopted[0] as TakeRecord;
            takes.push(take);
            briefs.push({
                brief: briefPath,
                content: contentPath,
                status: 'adopted',
                paid: false,
                instanceId: take.instanceId,
                model: take.model,
                digest: take.digest,
                unitPrice: take.unitPrice,
                artifactPath: take.artifactPath,
            });
            console.error(`brief ${nn}: adopted ${take.artifactPath} (sidecar on disk — no paid request)`);
            continue;
        }

        const command = [
            ...kkArgv(kkBin),
            'music',
            'gen',
            '--in',
            briefPath,
            '--out',
            contentPath,
            '--takes',
            '1',
            '--yes',
            ...(force ? ['--force', '--reason', forceReason] : []),
        ];
        const child = spawnSync(command[0] as string, command.slice(1), {
            encoding: 'utf-8',
            env: { ...process.env, ...(dryRun ? { KK_MUSIC_DRY_RUN: '1' } : {}) },
        });
        if (child.status !== 0) {
            fail(`brief ${nn}: kk music gen failed (exit ${String(child.status)}): ${child.stderr.trim()}`);
        }
        const generated = existingTakes(contentPath);
        if (generated.length === 0) {
            fail(`brief ${nn}: kk music gen wrote no take beside ${contentPath}`);
        }
        const take = generated[0] as TakeRecord;
        takes.push(take);
        briefs.push({
            brief: briefPath,
            content: contentPath,
            status: 'generated',
            paid: true,
            instanceId: take.instanceId,
            model: take.model,
            digest: take.digest,
            unitPrice: take.unitPrice,
            artifactPath: take.artifactPath,
        });
        console.error(`brief ${nn}: generated ${take.artifactPath} (instance ${take.instanceId}, model ${take.model})`);
    }

    // The single take a run has is not a choice: record it so `auto` can skip the operator gate.
    // With two or more takes the selection needs the operator (`select`), never a guess.
    if (takes.length === 1) {
        writeSelection(runDir, { schemaVersion: 1, brief: briefNumber(1), auto: true, take: takes[0] as TakeRecord });
    }

    writeJson(join(runDir, EXPLORE_FILE), {
        schemaVersion: 1,
        runId,
        directions,
        takes: takes.length,
        dryRun: dryRun || takes.some((take) => take.artifactPath.includes('offline')),
        briefs,
    });
    console.error(`explore: ${String(takes.length)} take(s) across ${String(directions)} direction(s)`);
}

/** `music-select` — the operator's pick, validated against the takes actually on disk (the only gate). */
export function musicSelect(args: string[]): void {
    const [runDirRaw = '', choiceRaw = '', autoRaw = 'false'] = args;
    const runDir = resolve(runDirRaw === '' ? '.' : runDirRaw);
    const choice = choiceRaw.trim();
    if (choice === '') {
        // The auto path: explore already bound the single take. Validate it is still whole.
        const selection = readSelection(runDir);
        console.error(`select: auto — brief ${selection.brief}, ${selection.take.artifactPath}`);
        return;
    }
    const nn = /^\d$/.test(choice) ? briefNumber(Number(choice)) : choice;
    if (!existsSync(join(runDir, '1-brief', `brief-${nn}.yaml`))) {
        fail(`selection ${choice} names no authored brief (1-brief/brief-${nn}.yaml is missing)`);
    }
    const takes = existingTakes(join(runDir, '3-takes', `content-${nn}.json`));
    if (takes.length === 0) {
        fail(`selection ${choice} names no take on disk (3-takes/content-${nn}.json has no existing artifact)`);
    }
    const take = takes[0] as TakeRecord;
    writeSelection(runDir, { schemaVersion: 1, brief: nn, auto: autoRaw === 'true', take });
    console.error(`select: brief ${nn} → ${take.artifactPath} (instance ${take.instanceId})`);
}

/**
 * `music-analyze` — pay for the selected take's instance analysis, once.
 *
 * A cached `analysis-<instanceId>.json` is adopted without a call (R5), and a take whose sidecar
 * says `dryRun` gets the synthetic offline analysis spelled out as such: `KK_MUSIC_DRY_RUN=1` must
 * stay free (AC5) and the file must never look like a paid measurement.
 */
export function musicAnalyze(args: string[]): void {
    const [runDirRaw = '', dryRunRaw = 'false', kkBin] = args;
    const runDir = resolve(runDirRaw === '' ? '.' : runDirRaw);
    const selection = readSelection(runDir);
    const instanceId = selection.take.instanceId;
    const analysisPath = join(runDir, '3-takes', `analysis-${instanceId}.json`);
    if (existsSync(analysisPath) && statSync(analysisPath).size > 0) {
        console.error(`analyze: adopted ${analysisPath} (cached — no paid request)`);
        return;
    }
    const sidecar = readJson<{ dryRun?: boolean; model?: string }>(selection.take.sidecarPath);
    if (dryRunRaw === 'true' || sidecar.dryRun === true) {
        writeJson(analysisPath, {
            dryRun: true,
            provider: 'offline',
            model: sidecar.model ?? selection.take.model,
            summary: 'offline: synthetic analysis, no instance was called',
            durationSeconds: 1,
        });
        console.error(`analyze: dry run — wrote the synthetic analysis to ${analysisPath} (no instance was called)`);
        return;
    }
    const command = [...kkArgv(kkBin), 'music', 'analyze', instanceId, '--yes', '--json'];
    const child = spawnSync(command[0] as string, command.slice(1), { encoding: 'utf-8', env: { ...process.env } });
    if (child.status !== 0) {
        fail(`kk music analyze ${instanceId} failed (exit ${String(child.status)}): ${child.stderr.trim()}`);
    }
    writeFileSync(analysisPath, child.stdout);
    console.error(`analyze: charged the instance analysis for ${instanceId} → ${analysisPath}`);
}

/** The analysis object of an `analysis-<id>.json` file: the verb's `--json` envelope or a bare object. */
export function analysisObject(raw: string): Record<string, unknown> {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nested = parsed.analysis;
    return typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : parsed;
}

/** `music-judge-input` — assemble `4-judge-input.md` from the five verbatim inputs (0402's contract). */
export function musicJudgeInput(args: string[]): void {
    const [runDirRaw = ''] = args;
    const runDir = resolve(runDirRaw === '' ? '.' : runDirRaw);
    const selection = readSelection(runDir);
    const nn = selection.brief;
    const required: Record<string, string> = {
        brief: join(runDir, '1-brief', `brief-${nn}.yaml`),
        prompt: join(runDir, '1-brief', `brief-${nn}.prompt.txt`),
        analysis: join(runDir, '3-takes', `analysis-${selection.take.instanceId}.json`),
        checks: `${selection.take.artifactPath}.checks.json`,
        provenance: selection.take.sidecarPath,
    };
    for (const [id, path] of Object.entries(required)) {
        if (!existsSync(path)) {
            fail(`judge bundle input "${id}" is missing: ${path} — the bundle is never written with a hole in it`);
        }
    }
    const rows = readJson<{ id: string; result: string; measured: unknown; unit: string; source: string }[]>(
        required.checks as string,
    );
    const failed = rows.filter((row) => row.result === 'fail');
    if (failed.length > 0) {
        fail(
            `checks.json carries a fail row (${failed
                .map((row) => `${row.id} measured ${String(row.measured)} ${row.unit} from ${row.source}`)
                .join('; ')}) — the take is not judgeable`,
        );
    }

    const read = (path: string): string => readFileSync(path, 'utf-8').replace(/\n+$/, '');
    const briefText = read(required.brief as string);
    const title = /^title:\s*(.+)$/m.exec(briefText)?.[1]?.trim() ?? basename(runDir);
    const language = /^language:\s*(.+)$/m.exec(briefText)?.[1]?.trim() ?? 'EN';
    const instrumental = /^instrumental:\s*true\s*$/m.test(briefText);
    const lyricsPath = join(runDir, '2-lyrics.md');
    const lyrics = instrumental
        ? 'instrumental brief — no lyric text is sent'
        : existsSync(lyricsPath)
          ? read(lyricsPath)
          : 'model-authored lyrics are not in the bundle';
    const sidecar = readJson<Record<string, unknown>>(required.provenance as string);

    const bundle = [
        `# Music judge input — ${title} / brief ${nn}`,
        '',
        `Judged take: ${selection.take.artifactPath}`,
        'Rubric: music-quality',
        `Verdict path: ${VERDICT_FILE}`,
        '',
        'Every number in this bundle comes from section 5 (`checks.json`) with the `unit` and `source` it was',
        'recorded with. The take’s audio is not attached: nothing here may be graded by ear.',
        '',
        '## 1. brief',
        '',
        '```yaml',
        briefText,
        '```',
        '',
        '## 2. prompt',
        '',
        '```text',
        read(required.prompt as string),
        '```',
        '',
        '## 3. lyrics',
        '',
        `Language: ${language}`,
        '',
        '```text',
        lyrics,
        '```',
        '',
        '## 4. analysis',
        '',
        '```json',
        JSON.stringify(analysisObject(read(required.analysis as string)), null, 4),
        '```',
        '',
        '## 5. checks',
        '',
        '```json',
        read(required.checks as string),
        '```',
        '',
        '## 6. provenance',
        '',
        `- content_ref: \`${selection.take.artifactPath}\``,
        `- checks: \`${required.checks}\``,
        `- sidecar: \`${required.provenance}\``,
        `- digest: \`${String(sidecar.digest ?? selection.take.digest)}\``,
        `- instanceId: \`${selection.take.instanceId}\``,
        `- model: \`${selection.take.model}\``,
        `- unitPrice: \`${String(sidecar.unitPrice ?? selection.take.unitPrice ?? 'unpriced')}\``,
        `- runId: \`${String(sidecar.runId ?? '')}\``,
        '',
    ].join('\n');
    writeFileSync(join(runDir, JUDGE_INPUT_FILE), bundle);
    console.error(`judge bundle written: ${join(runDir, JUDGE_INPUT_FILE)}`);
}

/**
 * `music-finalize` — the run report (R4): spend summed from the take sidecars, the instance ids,
 * the verdict, the delivery profile with its measured loudness, and the final artifact path.
 */
export function musicFinalize(args: string[]): void {
    const [runDirRaw = '', profile = 'streaming', format = 'song', runId = ''] = args;
    const runDir = resolve(runDirRaw === '' ? '.' : runDirRaw);
    const selection = readSelection(runDir);
    const verdictPath = join(runDir, VERDICT_FILE);
    const verdict = readJson<{ verdict?: string; confidence?: string; score?: number; feedback?: string }>(verdictPath);

    const takeDir = join(runDir, '3-takes');
    const sidecars = readdirSync(takeDir)
        .filter((name) => name.endsWith('.take.json'))
        .sort()
        .map((name) => ({ name, sidecar: readJson<Record<string, unknown>>(join(takeDir, name)) }));
    const priced = sidecars
        .map((entry) => entry.sidecar.unitPrice)
        .filter((price): price is number => typeof price === 'number');
    const spend = priced.reduce((sum, price) => sum + price, 0);
    const unpriced = sidecars.length - priced.length;

    const checksPath = `${selection.take.artifactPath}.checks.json`;
    const checks =
        readJson<{ id: string; measured: unknown; unit: string; threshold: unknown; result: string }[]>(checksPath);
    const delivery = checks.filter((row) => row.id.startsWith('delivery.'));
    if (delivery.length === 0) {
        fail(`no delivery.* row in ${checksPath} — master must write the delivery check before finalize`);
    }
    const loudness = delivery.find((row) => row.id === 'delivery.integrated_loudness');
    const truePeak = delivery.find((row) => row.id === 'delivery.true_peak');

    const extension = extname(selection.take.artifactPath);
    const stem = basename(selection.take.artifactPath, extension);
    const masteredName = readdirSync(takeDir)
        .filter((name) => name.startsWith(`${stem}.${profile}.`))
        .sort()
        .pop();
    if (masteredName === undefined) {
        fail(`no mastered file for ${selection.take.artifactPath} with profile "${profile}" — run kk music master`);
    }
    const masteredPath = join(takeDir, masteredName);

    const report = [
        `# Music run report — brief ${selection.brief}`,
        '',
        `- run: \`${runId}\``,
        `- format: \`${format}\``,
        `- delivery profile: \`${profile}\``,
        `- final artifact: \`${masteredPath}\``,
        '',
        '## Spend',
        '',
        `Total: $${spend.toFixed(2)} across ${String(sidecars.length)} take(s)${
            unpriced === 0 ? '' : ` (${String(unpriced)} unpriced)`
        }.`,
        '',
        '| take | instance id | model | unit price | sidecar |',
        '| --- | --- | --- | --- | --- |',
        ...sidecars.map(
            ({ name, sidecar }) =>
                `| ${String(sidecar.artifactPath ?? name)} | ${String(sidecar.instanceId ?? '')} | ${String(
                    sidecar.model ?? '',
                )} | ${typeof sidecar.unitPrice === 'number' ? `$${sidecar.unitPrice.toFixed(2)}` : 'unpriced'} | \`${name}\` |`,
        ),
        '',
        '## Verdict',
        '',
        `- verdict: \`${String(verdict.verdict ?? '')}\``,
        `- confidence: \`${String(verdict.confidence ?? '')}\``,
        `- score: \`${String(verdict.score ?? '')}\``,
        ...(verdict.feedback === undefined ? [] : ['', `Feedback: ${verdict.feedback}`]),
        '',
        '## Delivery',
        '',
        '| row | measured | unit | threshold | result | source |',
        '| --- | --- | --- | --- | --- | --- |',
        ...delivery.map(
            (row) =>
                `| ${row.id} | ${String(row.measured)} | ${row.unit} | ${String(row.threshold)} | ${row.result} | ${String(
                    (row as { source?: string }).source ?? '',
                )} |`,
        ),
        '',
        `- measured loudness: ${String(loudness?.measured ?? 'n/a')} LUFS`,
        `- measured true peak: ${String(truePeak?.measured ?? 'n/a')} dBTP`,
        '',
        '## Artifacts',
        '',
        `- idea: \`idea.md\``,
        `- briefs: \`1-brief/brief-${selection.brief}.yaml\` + \`1-brief/brief-${selection.brief}.prompt.txt\``,
        `- take: \`${selection.take.artifactPath}\` (+ \`${basename(selection.take.sidecarPath)}\`)`,
        `- checks: \`${checksPath}\``,
        `- analysis: \`3-takes/analysis-${selection.take.instanceId}.json\``,
        `- judge input: \`${JUDGE_INPUT_FILE}\``,
        `- verdict: \`${VERDICT_FILE}\``,
        `- mastered: \`${masteredPath}\``,
        '',
    ].join('\n');
    writeFileSync(join(runDir, REPORT_FILE), report);
    writeJson(join(runDir, REPORT_JSON_FILE), {
        schemaVersion: 1,
        runId,
        format,
        profile,
        finalArtifact: masteredPath,
        spend: { total: spend, takes: sidecars.length, unpriced },
        takes: sidecars.map(({ sidecar }) => ({
            instanceId: sidecar.instanceId,
            model: sidecar.model,
            unitPrice: sidecar.unitPrice,
            artifactPath: sidecar.artifactPath,
        })),
        verdict: { verdict: verdict.verdict ?? null, confidence: verdict.confidence ?? null },
        delivery: {
            integratedLoudness: loudness?.measured ?? null,
            truePeak: truePeak?.measured ?? null,
            rows: delivery,
        },
    });
    console.error(
        `run report written: ${join(runDir, REPORT_FILE)} ($${spend.toFixed(2)}, ${String(sidecars.length)} take(s))`,
    );
}

/** Dispatch one `music-*` stage (the `kk stage run` entry point). */
export function runMusicStage(stage: string, args: string[]): void {
    switch (stage) {
        case 'music-prepare':
            musicPrepare(args);
            return;
        case 'music-explore':
            musicExplore(args);
            return;
        case 'music-select':
            musicSelect(args);
            return;
        case 'music-analyze':
            musicAnalyze(args);
            return;
        case 'music-judge-input':
            musicJudgeInput(args);
            return;
        case 'music-finalize':
            musicFinalize(args);
            return;
        default:
            fail(`unknown music stage "${stage}"`);
    }
}
