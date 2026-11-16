import { join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/** A JSON object the status verbs emit. */
export type StatusObject = Record<string, unknown>;

const parseJson = JSON.parse.bind(JSON);

/** A string field, or null when the artifact carries something else. */
function optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

/** Read one JSON artifact, or null when it is absent or malformed. */
async function readJson(fs: FileSystem, path: string): Promise<StatusObject | null> {
    if (!(await fs.exists(path))) return null;
    try {
        const value: unknown = parseJson(await fs.readFile(path));
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as StatusObject) : null;
    } catch {
        return null;
    }
}

/** One recorded stage of a run, from the JSONL `step-timing.json` the stages append to. */
export interface RecordedStep {
    step: string;
    startedAt?: string;
    endedAt?: string;
}

/**
 * The run's own stage stream (`step-timing.json`, one JSON object per line). A malformed or missing
 * line is skipped rather than failing the command: status must answer on a half-written run.
 */
export async function recordedSteps(fs: FileSystem, workDir: string): Promise<RecordedStep[]> {
    const path = join(workDir, 'step-timing.json');
    if (!(await fs.exists(path))) return [];
    const text = await fs.readFile(path);
    return text.split('\n').flatMap((line: string) => {
        const trimmed = line.trim();
        if (trimmed === '') return [];
        try {
            const parsed = JSON.parse(trimmed) as RecordedStep;
            return typeof parsed.step === 'string' ? [parsed] : [];
        } catch {
            return [];
        }
    });
}

/**
 * Generation progress for one run: how many stages have recorded, which one is current, and how long
 * the run has been going (0378 R1). `running` is derived from the last step having no `endedAt`.
 */
export async function progressPayload(fs: FileSystem, workDir: string): Promise<StatusObject> {
    const steps = await recordedSteps(fs, workDir);
    if (steps.length === 0) return { stages: 0, current: null, state: 'not-started', elapsedMs: null };
    const last = steps[steps.length - 1] as RecordedStep;
    const first = steps[0] as RecordedStep;
    const startedAt = first.startedAt ?? null;
    const lastEndedAt = last.endedAt ?? null;
    const endMs = lastEndedAt === null ? Date.now() : Date.parse(lastEndedAt);
    const startMs = startedAt === null ? Number.NaN : Date.parse(startedAt);
    return {
        stages: steps.length,
        completed: steps.filter((step) => typeof step.endedAt === 'string').length,
        current: last.step,
        state: lastEndedAt === null ? 'running' : 'settled',
        startedAt,
        lastEndedAt,
        elapsedMs: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null,
    };
}

/**
 * The generation gate's own verdict for this run: the pool gate the workflow writes, the pre-spend
 * floor refusal (with the ladder rung and ratio that produced it), so a `no-content` day is
 * explainable from status alone (0378 R1, 0377 R3).
 */
export async function gatePayload(fs: FileSystem, workDir: string): Promise<StatusObject> {
    const pool = await readJson(fs, join(workDir, 'pool-gate.json'));
    const ladder = await readJson(fs, join(workDir, '10-collect', 'ladder.json'));
    const planDir = join(workDir, '21-plan');
    let refusal: StatusObject | null = null;
    if (await fs.exists(planDir)) {
        const refusalFile = (await fs.readDir(planDir))
            .filter((entry: string) => entry.endsWith('_04_quality-control-content_floor-refusal.json'))
            .sort()
            .at(-1);
        if (refusalFile !== undefined) {
            const raw = await readJson(fs, join(planDir, refusalFile));
            refusal =
                raw === null
                    ? null
                    : {
                          estimatedMinutes: raw.estimatedMinutes ?? null,
                          minMinutes: raw.minMinutes ?? null,
                          expansion: raw.expansion ?? null,
                          reason: optionalString(raw.reason),
                      };
        }
    }
    return {
        pool: pool === null ? null : (optionalString(pool.status) ?? null),
        floorRefusal: refusal,
        ladder:
            ladder === null
                ? null
                : {
                      chosen: optionalString(ladder.chosen),
                      ratioUsed: typeof ladder.ratioUsed === 'number' ? ladder.ratioUsed : null,
                      ratioSource: optionalString(ladder.ratioSource),
                      rungs: Array.isArray(ladder.rungs) ? ladder.rungs : [],
                  },
    };
}
