import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { describeRenderFailure, type RenderVideo } from '../render';

function requireCachedBrowser(): never {
    throw new Error('video-gen: Chromium cache is missing');
}

/**
 * The only module that touches Remotion's native side. The plugin entry loads it lazily so the fast
 * test tier never pays for webpack/Chromium and coverage is judged on the pure modules.
 */
export const remotionRender: RenderVideo = async (args) => {
    const inputProps = args.props as unknown as Record<string, unknown>;
    try {
        const serveUrl = await bundle({ entryPoint: args.entryPoint, publicDir: args.publicDir });
        await renderWith(serveUrl, args.compositionId, inputProps, args.outputPath);
    } catch (error: unknown) {
        throw new Error(describeRenderFailure(error));
    }
};

/** Bundle → select → render; split out so the failure mapping wraps the whole chain. */
async function renderWith(
    serveUrl: string,
    compositionId: string,
    inputProps: Record<string, unknown>,
    outputPath: string,
): Promise<void> {
    const composition = await selectComposition({
        serveUrl,
        id: compositionId,
        inputProps,
        onBrowserDownload: requireCachedBrowser,
    });
    await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        audioCodec: 'aac',
        outputLocation: outputPath,
        inputProps,
        onBrowserDownload: requireCachedBrowser,
        chromiumOptions: { gl: 'swangle' },
        concurrency: 2,
    });
}
