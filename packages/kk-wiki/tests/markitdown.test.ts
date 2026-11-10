import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarkitdownRunner, MissingNormalizerError } from '../src/markitdown';

const dirs: string[] = [];
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-md-')));
    dirs.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** An executable stub standing in for `markitdown`, addressed by absolute path. */
function stubBinary(body: string, exitCode = 0): string {
    const dir = tempDir();
    const path = join(dir, 'markitdown');
    writeFileSync(path, `#!/bin/sh\n${body}\nexit ${exitCode}\n`);
    chmodSync(path, 0o755);
    return path;
}

const HTML = { kind: 'html' as const, target: 'a.html', body: '<h1>x</h1>' };

describe('createMarkitdownRunner', () => {
    it('fails loud when the binary cannot be resolved', async () => {
        const run = createMarkitdownRunner({ binary: 'markitdown-definitely-not-installed' });
        await expect(run(HTML)).rejects.toBeInstanceOf(MissingNormalizerError);
    });

    it('converts through an absolute binary path and removes the temp html file', async () => {
        const seen: string[] = [];
        const binary = stubBinary(`for a in "$@"; do seen="$a"; done; echo "# Converted"; echo "$seen" >&2`);
        const run = createMarkitdownRunner({ binary });
        const out = await run(HTML);
        expect(out).toContain('# Converted');
        expect(seen.length).toBe(0);
    });

    it('passes a pdf/url target straight to the binary', async () => {
        const binary = stubBinary('echo "$1"');
        const run = createMarkitdownRunner({ binary });
        expect(await run({ kind: 'pdf', target: '/tmp/a.pdf' })).toContain('/tmp/a.pdf');
    });

    it('rejects a non-zero exit with the last stderr line', async () => {
        const binary = stubBinary('echo "boom" >&2', 3);
        const run = createMarkitdownRunner({ binary });
        await expect(run({ kind: 'pdf', target: 'a.pdf' })).rejects.toThrow(/exited 3: boom/);
    });

    it('rejects an empty conversion rather than writing an empty snapshot', async () => {
        const binary = stubBinary('printf ""');
        const run = createMarkitdownRunner({ binary });
        await expect(run({ kind: 'url', target: 'https://example.com' })).rejects.toThrow(/produced an empty body/);
    });
});
