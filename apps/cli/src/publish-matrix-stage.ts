import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { checkPublishMatrix, planPublishMatrix, runPublishMatrixClassify, sendPublishMatrix } from './publish-matrix';

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
        case 'publish-matrix-check':
            return checkPublishMatrix(rest, { fs });
        case 'publish-matrix-send':
            return sendPublishMatrix(rest, { fs });
        case 'publish-matrix-classify':
            return runPublishMatrixClassify(rest, { fs });
        default:
            return undefined;
    }
}
