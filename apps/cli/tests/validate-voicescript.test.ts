import { describe, expect, it } from 'bun:test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-validate-voicescript-test-'));
    return fn(dir).finally(() => {
        rmSync(dir, { recursive: true, force: true });
    });
}

describe('validate-voicescript CLI helper', () => {
    const helperPath = join(import.meta.dir, '../../../plugins/kk/scripts/validate-voicescript.ts');
    const helperSource = readFileSync(helperPath, 'utf-8');

    it('is builtins-only so a copy under ~/.config/kk/workflows can run', () => {
        expect(helperSource).not.toMatch(/from ['"]@gobing-ai/);
        expect(helperSource).not.toMatch(/from ['"]\.\.\//);
        expect(helperSource).not.toContain('docs/design');
        expect(helperSource).toContain('~/.config/kk/workflows');
        expect(helperSource).toMatch(/^import \{ readFileSync \} from 'node:fs';$/m);
        expect(helperSource).toMatch(/^import \{ parseArgs \} from 'node:util';$/m);
    });

    it('exits 0 after copy into a runtime workflows_dir', async () => {
        await withTempDir(async (dir) => {
            const destHelper = join(dir, 'validate-voicescript.ts');
            copyFileSync(helperPath, destHelper);
            const filePath = join(dir, 'voicescript.yaml');
            writeFileSync(
                filePath,
                [
                    'title: "Episode 1"',
                    'language: "en"',
                    'default_profile: "Robin"',
                    'segments:',
                    '  - text: "Hello and welcome to the episode."',
                ].join('\n'),
            );

            const proc = Bun.spawnSync([process.execPath, destHelper, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });

            expect(proc.exitCode).toBe(0);
        });
    });

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

describe('validate-voicescript content checks (0139 R3)', () => {
    const contentHelperPath = join(import.meta.dir, '../../../plugins/kk/scripts/validate-voicescript.ts');

    /** Run the CLI helper over a voicescript body and return its exit code + stderr. */
    function validate(body: string): { code: number; err: string } {
        const dir = mkdtempSync(join(tmpdir(), 'kk-validate-content-'));
        try {
            const filePath = join(dir, 'voicescript.yaml');
            writeFileSync(filePath, body);
            const proc = Bun.spawnSync([process.execPath, contentHelperPath, '--in', filePath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });
            return { code: proc.exitCode ?? 1, err: new TextDecoder().decode(proc.stderr) };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    const script = (...segments: string[]) =>
        ['language: en', 'segments:', ...segments.map((text) => `  - text: ${JSON.stringify(text)}`), ''].join('\n');

    // The real 2026-09-16 segment 1 (HITL copy): the lead's 【…】 content reappears verbatim in the
    // body. Its cleaned form — what 0139 R1's stripLeadingTitleEcho emits — is the passing case.
    const ECHOED =
        '首先来聊聊大家非常关注的【Nvidia 黄仁勋表示，AI 不需要监管，安全应由厂商自行负责】。Nvidia 黄仁勋表示，AI 不需要监管，安全应由厂商自行负责 黄仁勋认为，安全可以由每一家 AI 产品厂商自行设计。';
    const CLEANED =
        '首先来聊聊大家非常关注的【Nvidia 黄仁勋表示，AI 不需要监管，安全应由厂商自行负责】。黄仁勋认为，安全可以由每一家 AI 产品厂商自行设计。';

    it('rejects a title echo, naming the segment and the reason', () => {
        const { code, err } = validate(script(ECHOED));
        expect(code).toBe(1);
        expect(err).toContain('content check failed');
        expect(err).toContain('segment 0');
        expect(err).toContain('repeats its 【Nvidia 黄仁勋表示，AI 不需要监管，安全应由厂商自行负责】 title');
    });

    it('accepts the cleaned 2026-09-16 voicescript', () => {
        expect(validate(script(CLEANED)).code).toBe(0);
    });

    it('rejects duplicate segment text', () => {
        const { code, err } = validate(script('Hello there.', 'Hello there.'));
        expect(code).toBe(1);
        expect(err).toContain('segment 1');
        expect(err).toContain('duplicates segment 0 verbatim');
    });

    it('rejects every scaffold-label pattern that reached spoken copy', () => {
        for (const label of ['背景', '潜在影响', '可做角度', '为什么现在值得注意', '社区讨论']) {
            const withLabel = validate(script(`${label}：Gemini Live 是 Google 推出的实时语音模型系列。`));
            expect(withLabel.code, label).toBe(1);
            expect(withLabel.err, label).toContain('content check failed');
            expect(withLabel.err, label).toContain('research scaffold label');
            const withBoldLabel = validate(script(`**「${label}」** Gemini Live 是 Google 推出的实时语音模型系列。`));
            expect(withBoldLabel.code, `**「${label}」**`).toBe(1);
            expect(withBoldLabel.err, `**「${label}」**`).toContain('research scaffold label');
        }
    });

    it('rejects a 标签 metadata tail at the end of the segment', () => {
        const { code, err } = validate(script('正文内容。标签，ai、google'));
        expect(code).toBe(1);
        expect(err).toContain('segment 0');
        expect(err).toContain('标签 metadata tail');
    });

    it('rejects a 标签 tail with comma-separated tags', () => {
        const { code } = validate(script('正文内容。标签，ai，google'));
        expect(code).toBe(1);
    });

    it('allows 标签 as prose when the sentence continues past the punctuation', () => {
        // 2026-09-28 daily run: segment 14 spoke 「硬件标签」 as a common noun.
        const prose = '一个推了两年的硬件标签，突然从新品上消失了。';
        expect(validate(script(prose)).code).toBe(0);
        expect(validate(script('新 Surface 依然满足硬件要求，公司却选择不贴这个标签，说明卖点变了。')).code).toBe(0);
    });

    it('rejects a colon-mangled URL', () => {
        const { code, err } = validate(script('正文见 wss，//generativelanguage.googleapis.com/ws'));
        expect(code).toBe(1);
        expect(err).toContain('segment 0');
        expect(err).toContain('colon-mangled URL');
    });
});
