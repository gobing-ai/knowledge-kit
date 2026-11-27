import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

/**
 * The plugin's default filesystem: ts-runtime's node seam (runtime-boundaries rule), so every read,
 * copy and stat in this plugin goes through the documented abstraction instead of `node:fs`.
 */
export const nodeFileSystem: FileSystem = createNodeFileSystem();
