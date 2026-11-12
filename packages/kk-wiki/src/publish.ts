import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { VaultIndex } from './graph';

/**
 * `publish` mechanics (task 0359): project `content/` into a Quartz-compatible tree.
 *
 * Quartz stays an upstream dependency of the consuming repository — this module copies the vault's
 * relative structure unchanged (wikilinks intact) and nothing else. It never deletes from the target
 * and refuses a target inside the vault.
 */

/** Outcome of one publish. */
export interface PublishResult {
    files: string[];
    refused?: 'target-inside-vault';
}

function isInside(parent: string, child: string): boolean {
    const rel = relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Copy `<vault>/content/**` to `<target>/content/**`, preserving relative paths. */
export async function publishVault(
    index: VaultIndex,
    options: { target: string; fileSystem: FileSystem },
): Promise<PublishResult> {
    const targetRoot = resolve(options.target);
    // Publishing into the vault itself would recurse over the very tree being read.
    if (isInside(resolve(index.contentDir), targetRoot)) return { files: [], refused: 'target-inside-vault' };
    const fs = options.fileSystem;
    const files: string[] = [];
    for (const page of index.pages) {
        const source = join(index.contentDir, page.path);
        const destination = join(targetRoot, 'content', page.path);
        await fs.ensureDir(dirname(destination));
        await fs.writeFile(destination, await fs.readFile(source));
        files.push(join('content', page.path));
    }
    return { files: files.sort() };
}
