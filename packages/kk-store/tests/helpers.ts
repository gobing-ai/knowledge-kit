import { Database } from 'bun:sqlite';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { openStore, type Store } from '../src/index';

/** Repo root, resolved from this file (packages/kk-store/tests). */
export const REPO_ROOT = join(import.meta.dir, '../../..');
/** Where the E2E run leaves its repeatable evidence. */
export const ARTIFACT_DIR = join(REPO_ROOT, '.works/test-artifacts/0206');
/** The CLI entry the E2E spawns as a process. */
export const CLI_ENTRY = join(REPO_ROOT, 'apps/cli/src/index.ts');

/** Hex sha256, recomputed here so the digest contract is asserted independently of the package. */
export function sha256Hex(input: string): string {
    return new Bun.CryptoHasher('sha256').update(input).digest('hex');
}

const tempDirs: string[] = [];
const openStores: Store[] = [];

/**
 * A fresh temp dir, tracked for {@link cleanupTempState}. Real-pathed because macOS
 * `tmpdir()` returns `/var/...` while `process.cwd()` returns the resolved `/private/var/...`.
 */
export function makeTempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-store-')));
    tempDirs.push(dir);
    return dir;
}

/** Keep a live store per test so a failed assertion cannot leak a file handle. */
export async function openTempStore(dir: string, name = 'kk.db'): Promise<{ store: Store; dbPath: string }> {
    const dbPath = join(dir, name);
    const store = await openStore({ path: dbPath });
    openStores.push(store);
    return { store, dbPath };
}

/** Close every store this file opened and remove every temp dir it created. */
export async function cleanupTempState(): Promise<void> {
    for (const store of openStores.splice(0)) {
        await store.close();
    }
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Raw read-only reader used only for evidence (pragmas, journal, DDL). */
export function readRaw(dbPath: string): Database {
    return new Database(dbPath, { readonly: true });
}

/** Docs used across the item/upsert assertions. */
export const DOC_WITH_URL: Doc = {
    id: 'doc-1',
    title: 'Attention Is All You Need',
    body: '# paper\n\nbody v1',
    sourceUri: 'https://Example.com/papers/attention/?utm_source=newsletter&utm_medium=email#intro',
    mediaType: 'text/markdown',
    metadata: { source: 'web-search', publishedAt: '2026-10-01T00:00:00Z' },
};
export const DOC_WITHOUT_URL: Doc = { id: 'doc-2', title: 'Local note', body: 'notes without a URL' };
