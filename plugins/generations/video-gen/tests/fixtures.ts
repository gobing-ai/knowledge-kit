import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Fixture daily work dir for the video-gen fast tier: the same artifact layout a real daily run
 * leaves behind, so input resolution is exercised against the production paths, not a re-invented one.
 */

/** One materialised fake daily run. */
export interface FixtureRun {
    workDir: string;
    runDate: string;
    audioPath: string;
    coverPath: string;
    planPath: string;
    cardPath?: string;
}

const PLAN_ITEMS = [
    { id: 'n1', lead: 'OpenAI 发布新一代推理模型，延迟降低三成。', insight: '成本仍是门槛。' },
    { id: 'n2', lead: '国产开源权重模型登上排行榜首。' },
];

/** Write a daily run into a fresh temp work dir; options let a test break one artifact at a time. */
export function makeFixtureRun(
    options: {
        runDate?: string;
        withCards?: boolean;
        withPrepContent?: boolean;
        withCover?: boolean;
        withPlan?: boolean;
        audioInVoiceContent?: boolean;
    } = {},
): FixtureRun {
    const runDate = options.runDate ?? '20261126';
    // `<works>/<run>`: the parent is the works root, which is where the CCU ledger lives
    // (`resolveLedgerPath`), so each fixture keeps its own budget history.
    const workDir = join(mkdtempSync(join(tmpdir(), 'kk-video-gen-')), 'run');
    mkdirSync(workDir, { recursive: true });
    const audioPath = join(workDir, `${runDate}_episode.wav`);
    writeFileSync(audioPath, 'RIFF');

    const coverPath = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
    if (options.withCover !== false) {
        mkdirSync(join(workDir, '23-cover'), { recursive: true });
        writeFileSync(coverPath, 'PNG');
    }

    const planPath = join(workDir, '24-script', `${runDate}_08_script-write_plan.json`);
    if (options.withPlan !== false) {
        mkdirSync(join(workDir, '24-script'), { recursive: true });
        writeFileSync(
            planPath,
            JSON.stringify({
                version: 1,
                intro: 'intro',
                outro: 'outro',
                items: PLAN_ITEMS,
                cover: { headline: 'AI 日报 1126' },
                tags: ['ai', 'daily'],
            }),
        );
    }

    if (options.withPrepContent !== false) {
        mkdirSync(join(workDir, '31-publish'), { recursive: true });
        writeFileSync(
            join(workDir, '31-publish', `${runDate}_13_publish-prep_content.json`),
            JSON.stringify({ format: 'audio', metadata: { audioFile: audioPath } }),
        );
    }
    if (options.audioInVoiceContent === true) {
        mkdirSync(join(workDir, '30-audio'), { recursive: true });
        writeFileSync(
            join(workDir, '30-audio', `${runDate}_11_generate_content.json`),
            JSON.stringify({ format: 'audio', metadata: { audioPath } }),
        );
    }

    let cardPath: string | undefined;
    if (options.withCards === true) {
        cardPath = join(workDir, '25-xhs', 'card-1.png');
        mkdirSync(join(workDir, '25-xhs'), { recursive: true });
        writeFileSync(cardPath, 'PNG');
        writeFileSync(
            join(workDir, '25-xhs', 'content.json'),
            JSON.stringify({ metadata: { images: [{ path: cardPath }] } }),
        );
    }

    return {
        workDir,
        runDate,
        audioPath,
        coverPath,
        planPath,
        ...(cardPath === undefined ? {} : { cardPath }),
    };
}

/** A request payload matching {@link FixtureRun}. */
export function fixtureRequest(run: FixtureRun, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { workDir: run.workDir, runDate: run.runDate, visualMode: 'editorial', ...overrides };
}

/** The `Doc[]` envelope `kk executor run` validates a generator's `--in` against. */
export function docListInput(request: Record<string, unknown>): Record<string, unknown>[] {
    return [{ id: 'video-gen-request', body: '', metadata: request }];
}
