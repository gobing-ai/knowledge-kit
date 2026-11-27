import { isAbsolute, join, resolve } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { nodeFileSystem } from './fs';

/**
 * Input resolution for one daily AI news run: the plugin reads the same work-dir artifacts the
 * voice and cover stages already wrote (no second source of truth, no re-encode). All IO goes
 * through the ts-runtime FileSystem seam, which is also the tests' injection point.
 */

/** One curated plan item; `lead` is the fact sentence the teaser hook is cut from. */
export interface ScriptPlanItem {
    id: string;
    lead: string;
    insight?: string;
}

/** The subset of the curated script plan this plugin needs. */
export interface ScriptPlan {
    items: ScriptPlanItem[];
    headline?: string;
    tags: string[];
}

/** Everything one run renders from. */
export interface VideoInputs {
    audioPath: string;
    planPath: string;
    plan: ScriptPlan;
    coverPath: string;
    cardPaths: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function metadataOf(value: unknown): Record<string, unknown> | null {
    return asRecord(asRecord(value)?.metadata);
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function resolveFrom(workDir: string, path: string): string {
    return isAbsolute(path) ? path : resolve(workDir, path);
}

async function exists(fs: FileSystem, path: string): Promise<boolean> {
    return (await fs.exists(path)) === true;
}

async function readJson(fs: FileSystem, path: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(path)) as unknown;
}

async function readPlan(fs: FileSystem, planPath: string): Promise<ScriptPlan> {
    if (!(await exists(fs, planPath))) {
        throw new Error(`video-gen: curated script plan not found at ${planPath} (run the script stage first)`);
    }
    const raw = asRecord(await readJson(fs, planPath));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const parsed: ScriptPlanItem[] = [];
    for (const entry of items) {
        const item = asRecord(entry);
        const id = nonEmptyString(item?.id);
        const lead = nonEmptyString(item?.lead);
        if (!id || !lead) continue;
        const insight = nonEmptyString(item?.insight);
        parsed.push({ id, lead, ...(insight === undefined ? {} : { insight }) });
    }
    if (parsed.length === 0) {
        throw new Error(`video-gen: script plan at ${planPath} carries no usable items (id + lead)`);
    }
    const cover = asRecord(raw?.cover);
    const cards = asRecord(raw?.cards);
    const headline = nonEmptyString(cover?.headline) ?? nonEmptyString(cards?.title) ?? parsed[0]?.lead;
    const tags = Array.isArray(raw?.tags)
        ? raw.tags.filter((tag): tag is string => nonEmptyString(tag) !== undefined)
        : [];
    return { items: parsed, ...(headline === undefined ? {} : { headline }), tags };
}

async function readCardPaths(fs: FileSystem, cardsPath: string): Promise<string[]> {
    if (!(await exists(fs, cardsPath))) return [];
    const images = metadataOf(await readJson(fs, cardsPath))?.images;
    if (!Array.isArray(images)) return [];
    const paths: string[] = [];
    for (const entry of images) {
        const path = nonEmptyString(asRecord(entry)?.path);
        if (path !== undefined) paths.push(path);
    }
    return paths;
}

/**
 * Resolve every input for `runDate` from `workDir`, failing closed when the episode audio or the
 * cover is missing — before anything expensive is spawned (R6).
 */
export async function resolveVideoInputs(
    workDir: string,
    runDate: string,
    fs: FileSystem = nodeFileSystem,
): Promise<VideoInputs> {
    const prepPath = join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`);
    const voicePath = join(workDir, '30-audio', `${runDate}_11_generate_content.json`);
    const prepAudio = (await exists(fs, prepPath))
        ? nonEmptyString(metadataOf(await readJson(fs, prepPath))?.audioFile)
        : undefined;
    const voice = (await exists(fs, voicePath)) ? metadataOf(await readJson(fs, voicePath)) : null;
    const voiceAudio = nonEmptyString(voice?.mp3Path) ?? nonEmptyString(voice?.audioPath);
    const audioRaw = prepAudio ?? voiceAudio;
    if (audioRaw === undefined) {
        throw new Error(
            `video-gen: no episode audio recorded in ${prepPath} (metadata.audioFile) or ${voicePath} (metadata.mp3Path/audioPath)`,
        );
    }
    const audioPath = resolveFrom(workDir, audioRaw);
    try {
        const audio = await fs.stat(audioPath);
        if (
            audio === null ||
            !audio.isFile() ||
            (await Bun.file(audioPath).slice(0, 1).arrayBuffer()).byteLength === 0
        ) {
            throw new Error('no readable audio bytes');
        }
    } catch {
        throw new Error(`video-gen: episode audio ${audioPath} is missing or unreadable`);
    }

    const coverPath = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
    if (!(await exists(fs, coverPath))) {
        throw new Error(`video-gen: cover artwork not found at ${coverPath} (run the cover stage first)`);
    }

    const planPath = join(workDir, '24-script', `${runDate}_08_script-write_plan.json`);
    const plan = await readPlan(fs, planPath);
    const candidates = await readCardPaths(fs, join(workDir, '25-xhs', 'content.json'));
    const cardPaths: string[] = [];
    for (const candidate of candidates) {
        const resolved = resolveFrom(workDir, candidate);
        if (await exists(fs, resolved)) cardPaths.push(resolved);
    }

    return { audioPath, planPath, plan, coverPath, cardPaths };
}
