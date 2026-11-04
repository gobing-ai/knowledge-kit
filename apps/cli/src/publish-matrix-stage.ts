import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import {
    checkPublishMatrix,
    planPublishMatrix,
    runPublishMatrixBundle,
    runPublishMatrixClassify,
    runPublishMatrixRssGate,
    runPublishMatrixSettle,
    runPublishMatrixValidate,
    runPublishMatrixWaitUntil,
    sendPublishMatrix,
} from './publish-matrix';

/**
 * Handle the `publish-matrix-*` workflow stages.
 *
 * Returns the process exit code for an intercepted matrix stage, or `undefined` for any other stage
 * name (which then falls through to the generic stage runner in `commands/stage.ts`).
 */
export async function runPublishMatrixStage(
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
): Promise<number | undefined> {
    const [stageName, ...rest] = args;
    switch (stageName) {
        case 'publish-matrix-plan':
            return planPublishMatrix(rest, { fs });
        case 'publish-matrix-validate':
            return runPublishMatrixValidate(rest, { fs });
        case 'publish-matrix-check':
            return checkPublishMatrix(rest, { fs });
        case 'publish-matrix-send':
            return sendPublishMatrix(rest, { fs });
        case 'publish-matrix-classify':
            return runPublishMatrixClassify(rest, { fs });
        case 'publish-matrix-bundle':
            return runPublishMatrixBundle(rest, { fs });
        case 'publish-matrix-rss-gate':
            return runPublishMatrixRssGate(rest, { fs });
        case 'publish-matrix-wait-until':
            return runPublishMatrixWaitUntil(rest);
        case 'publish-matrix-settle':
            return runPublishMatrixSettle(rest, { fs });
        default:
            return undefined;
    }
}
