import { basename, extname, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { nodeFileSystem } from './fs';
import type { AvatarReelProps, EditorialReelProps, HybridPipReelProps } from './props';

/**
 * Asset staging + render invocation. The Remotion call itself is injected (`RenderVideo`) so the
 * fast tier asserts the handoff — public dir, props, output path — without a browser (AC3/AC2), and
 * file IO goes through the ts-runtime FileSystem seam.
 */

/** Staged public-dir-relative asset names used by the composition. */
export interface StagedAssets {
    imageNames: string[];
    audioName: string;
}

/** Audio file name inside the public dir. */
export const STAGED_AUDIO_NAME = 'teaser.wav';

/**
 * Copy the stills and the teaser into `publicDir`, where `staticFile()` can serve them to the
 * browser. Names are positional (`still-0.png`, …) so the composition never parses episode paths.
 */
export async function stageAssets(args: {
    images: string[];
    audioPath: string;
    publicDir: string;
    fs?: FileSystem;
}): Promise<StagedAssets> {
    const fs = args.fs ?? nodeFileSystem;
    if (args.images.length === 0) {
        throw new Error('video-gen: no stills to stage for the render');
    }
    await fs.ensureDir(args.publicDir);
    const imageNames: string[] = [];
    for (const [position, source] of args.images.entries()) {
        const name = `still-${position}${extname(source) || '.png'}`;
        await fs.copy(source, join(args.publicDir, name));
        imageNames.push(name);
    }
    await fs.copy(args.audioPath, join(args.publicDir, STAGED_AUDIO_NAME));
    return { imageNames, audioName: STAGED_AUDIO_NAME };
}

/** One render request handed to the Remotion engine. */
export interface RenderArgs {
    /** Composition to render: the editorial shell or one of 0452's avatar shells. */
    compositionId: string;
    /** Whatever the chosen composition declares; the engine passes it through as input props. */
    props: EditorialReelProps | AvatarReelProps | HybridPipReelProps;
    publicDir: string;
    outputPath: string;
    entryPoint: string;
}

/** Renders the composition to `outputPath`; the engine owns bundling and Chromium. */
export type RenderVideo = (args: RenderArgs) => Promise<void>;

/**
 * Render the reel and prove it exists: a renderer that resolves without writing a non-empty file
 * would hand the publishers a dangling path, so the artifact is verified here.
 */
export async function renderReel(
    args: RenderArgs & { render: RenderVideo; fs?: FileSystem },
): Promise<{ outputPath: string; sizeBytes: number }> {
    const fs = args.fs ?? nodeFileSystem;
    await args.render({
        compositionId: args.compositionId,
        props: args.props,
        publicDir: args.publicDir,
        outputPath: args.outputPath,
        entryPoint: args.entryPoint,
    });
    if (!(await fs.exists(args.outputPath))) {
        throw new Error(`video-gen: renderer finished without writing ${args.outputPath}`);
    }
    const stats = await fs.stat(args.outputPath);
    const sizeBytes = stats?.size ?? 0;
    if (sizeBytes <= 0) {
        throw new Error(`video-gen: rendered file ${basename(args.outputPath)} is empty`);
    }
    return { outputPath: args.outputPath, sizeBytes };
}

/**
 * Point a browser-cache failure at the one-time local provisioning command.
 */
export function describeRenderFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/chrome|chromium|browser/i.test(message)) {
        return `Remotion browser setup failed. From the video-gen directory, run: bun -e 'import { ensureBrowser } from "@remotion/renderer"; await ensureBrowser();' (${message})`;
    }
    return message;
}
