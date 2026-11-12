import { dirname, isAbsolute, join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { VaultIndex } from './graph';

/**
 * `gc` mechanics (task 0358): reclaim unreferenced layer-1 snapshots.
 *
 * Scope is deliberately narrow. Only `raw/<type>/` snapshots this tool wrote and `raw/tmp/` are
 * candidates; any directory listed in `wiki.mirrors` is skipped wholesale, because an external
 * mirror (rclone into the treasury vault) owns those files and would simply re-download them.
 */

/** Files that would be deleted and files that are kept, with the mirrors skipped. */
export interface GcPlan {
    delete: string[];
    keep: string[];
    skippedMirrors: string[];
}

/** Compute the gc plan from the index and the raw tree. */
export async function planGc(
    index: VaultIndex,
    options: { rawDir: string; mirrors?: string[]; fileSystem: FileSystem },
): Promise<GcPlan> {
    const fs = options.fileSystem;
    const root = dirname(options.rawDir);
    // Mirrors are declared vault-relative (`raw/karakeep`); resolve them once for both the skip
    // list and the per-candidate check.
    const mirrorPaths = (options.mirrors ?? []).map((mirror) => (isAbsolute(mirror) ? mirror : join(root, mirror)));
    const referenced = new Set<string>();
    for (const page of index.pages) {
        for (const source of page.frontmatter.sources) referenced.add(source.trim());
    }
    const candidates: string[] = [];
    for (const type of ['url', 'pdf', 'html', 'rss']) {
        const dir = join(options.rawDir, type);
        if (!(await fs.exists(dir))) continue;
        for (const name of await fs.readDir(dir)) candidates.push(join(dir, name));
    }
    const tmpDir = join(options.rawDir, 'tmp');
    if (await fs.exists(tmpDir)) {
        for (const name of await fs.readDir(tmpDir)) candidates.push(join(tmpDir, name));
    }
    const skippedMirrors = (options.mirrors ?? []).filter((_, index) => {
        const path = mirrorPaths[index];
        return path !== undefined && (fs.exists(path) as boolean);
    });
    const plan: GcPlan = { delete: [], keep: [], skippedMirrors };
    for (const path of candidates) {
        if (mirrorPaths.some((mirror) => path.startsWith(mirror))) continue;
        const snapshotId = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
        if (referenced.has(snapshotId) || referenced.has(path)) plan.keep.push(path);
        else plan.delete.push(path);
    }
    plan.delete.sort();
    plan.keep.sort();
    return plan;
}

/** Delete the planned files (callers gate this behind an explicit `--yes`). */
export async function applyGc(plan: GcPlan, fileSystem: FileSystem): Promise<{ deleted: string[] }> {
    for (const path of plan.delete) await fileSystem.deleteFile(path);
    return { deleted: [...plan.delete] };
}
