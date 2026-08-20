import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-validate-voicescript-test-'));
    return fn(dir).finally(() => {
        rmSync(dir, { recursive: true, force: true });
    });
}

describe('validate-voicescript CLI helper', () => {
    const helperPath = join(import.meta.dir, '../../../plugins/kk/lib/validate-voicescript.ts');

    it('exits 0 for valid VoiceScript YAML', async () => {
        await withTempDir(async (dir) => {
            const filePath = join(dir, 'voicescript.yaml');
            writeFileSync(
                filePath,
                [
                    'title: "Episode 1"',
                    'language: "en"',
                    'default_profile: "Robin"',
                    'segments:',
                    '  - text: "Hello and welcome to the episode."',
                    '    gap_ms: 500',
                    '  - text: "Today we talk about system design."',
                ].join('\n'),
            );

            const proc = Bun.spawnSync([process.execPath, helperPath, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            expect(proc.exitCode).toBe(0);
        });
    });

    it('exits 0 for valid VoiceScript JSON', async () => {
        await withTempDir(async (dir) => {
            const filePath = join(dir, 'voicescript.json');
            writeFileSync(
                filePath,
                JSON.stringify({
                    title: 'JSON Episode',
                    language: 'zh',
                    default_profile: 'Robin',
                    segments: [{ text: '你好，欢迎收听本期节目。' }],
                }),
            );

            const proc = Bun.spawnSync([process.execPath, helperPath, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            expect(proc.exitCode).toBe(0);
        });
    });

    it('exits 1 for empty segments array', async () => {
        await withTempDir(async (dir) => {
            const filePath = join(dir, 'empty-segments.yaml');
            writeFileSync(filePath, 'title: "No Segments"\nsegments: []\n');

            const proc = Bun.spawnSync([process.execPath, helperPath, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            expect(proc.exitCode).toBe(1);
            expect(new TextDecoder().decode(proc.stderr)).toContain('non-empty segments array');
        });
    });

    it('exits 1 when a segment text length exceeds 50,000 characters', async () => {
        await withTempDir(async (dir) => {
            const filePath = join(dir, 'too-long.yaml');
            const longText = 'a'.repeat(50001);
            writeFileSync(filePath, `segments:\n  - text: "${longText}"\n`);

            const proc = Bun.spawnSync([process.execPath, helperPath, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            expect(proc.exitCode).toBe(1);
            expect(new TextDecoder().decode(proc.stderr)).toContain(
                'exceeds the 50,000-character Voicebox /generate cap',
            );
        });
    });

    it('exits 1 when default_engine is unknown', async () => {
        await withTempDir(async (dir) => {
            const filePath = join(dir, 'bad-engine.yaml');
            writeFileSync(filePath, ['default_engine: "not-an-engine"', 'segments:', '  - text: "Hello"'].join('\n'));

            const proc = Bun.spawnSync([process.execPath, helperPath, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            expect(proc.exitCode).toBe(1);
            expect(new TextDecoder().decode(proc.stderr)).toContain('engine must be one of');
        });
    });

    it('exits 1 when --in argument is missing', () => {
        const proc = Bun.spawnSync([process.execPath, helperPath], {
            stdout: 'pipe',
            stderr: 'pipe',
        });

        expect(proc.exitCode).toBe(1);
        expect(new TextDecoder().decode(proc.stderr)).toContain('missing required --in');
    });

    it('exits 1 when target file does not exist', () => {
        const proc = Bun.spawnSync([process.execPath, helperPath, '--in', '/non/existent/path.yaml'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });

        expect(proc.exitCode).toBe(1);
        expect(new TextDecoder().decode(proc.stderr)).toContain('unreadable input file');
    });
});
