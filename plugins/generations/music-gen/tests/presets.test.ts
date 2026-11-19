import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMusicBrief } from '../src/brief';
import {
    assertPresetPortable,
    BUILTIN_DEFAULTS,
    explainJob,
    FORBIDDEN_PRESET_KEYS,
    JobResolutionError,
    loadPresetFile,
    PresetContractViolation,
    parsePresetDocument,
    resolveJob,
} from '../src/presets';
import { loadGoldenBrief } from './goldens';

/**
 * AC4 — preset resolution is precedence-defined (R4): brief > workflow preset
 * > theme preset > format preset > built-in default, over portable `format ×
 * theme` data. A preset declaring a provider, model id or price is rejected by
 * the loader with a non-zero exit.
 */

const PRESET_FIXTURES = join(import.meta.dir, 'fixtures', 'presets');

function baseBrief(overrides: Record<string, unknown> = {}): ReturnType<typeof parseMusicBrief> {
    return parseMusicBrief({
        title: 'Precedence',
        format: 'song',
        theme: 'lofi',
        style: 'Brief direction.',
        ...overrides,
    });
}

describe('AC4 — preset resolution precedence', () => {
    test('brief beats every preset layer', () => {
        const job = resolveJob(
            baseBrief({ model: 'clip', duration_target: '0:30', style: 'Brief style.', language: 'ja' }),
            {
                workflow: {
                    name: 'wf',
                    model: 'pro',
                    duration_target: '1:00',
                    style: 'Workflow style.',
                    language: 'fr',
                },
                theme: { name: 'th', style: 'Theme style.', language: 'de' },
                format: { name: 'fm', model: 'pro', duration_target: '2:00', style: 'Format style.', language: 'es' },
            },
        );
        expect(job.model.value).toBe('clip');
        expect(job.model.source).toBe('brief');
        expect(job.duration_target.value).toBe('0:30');
        expect(job.language.value).toBe('ja');
        expect(job.style.value).toBe('Brief style.');
    });

    test('workflow preset beats the theme, format and built-in layers', () => {
        const job = resolveJob(baseBrief({ duration_target: '0:30', style: undefined }), {
            workflow: { name: 'wf', style: 'Workflow style.', language: 'fr', instrumental: true },
            theme: { name: 'th', style: 'Theme style.', language: 'de' },
            format: { name: 'fm', style: 'Format style.', language: 'es' },
        });
        expect(job.style.value).toBe('Workflow style.');
        expect(job.style.source).toBe('workflow');
        expect(job.style.origin).toBe('wf');
        expect(job.language.value).toBe('fr');
        expect(job.instrumental.value).toBe(true);
        expect(job.instrumental.source).toBe('workflow');
    });

    test('theme preset beats the format preset', () => {
        const job = resolveJob(baseBrief({ duration_target: '0:30', style: undefined }), {
            theme: { name: 'th', style: 'Theme style.', language: 'de' },
            format: { name: 'fm', style: 'Format style.', language: 'es' },
        });
        expect(job.style.value).toBe('Theme style.');
        expect(job.style.source).toBe('theme');
        expect(job.language.value).toBe('de');
    });

    test('format preset supplies the model and duration skeleton when the brief is silent', () => {
        const job = resolveJob(baseBrief(), {
            format: {
                name: 'song',
                model: 'pro',
                duration_target: '2:30',
                style: 'Format style.',
                structure: [{ at: '0:00', section: 'Intro' }],
            },
        });
        expect(job.model.value).toBe('pro');
        expect(job.model.source).toBe('format');
        expect(job.duration_target.value).toBe('2:30');
        expect(job.duration_target.source).toBe('format');
        expect(job.structure.value).toEqual([{ at: '0:00', section: 'Intro' }]);
        expect(job.structure.source).toBe('format');
    });

    test('built-in defaults are the last link of the chain', () => {
        const job = resolveJob(baseBrief({ duration_target: '0:30' }));
        expect(job.language).toEqual({ value: 'EN', source: 'builtin', origin: undefined });
        expect(job.instrumental.value).toBe(false);
        expect(job.instrumental.source).toBe('builtin');
        expect(job.audio_format.value).toBe(BUILTIN_DEFAULTS.audio_format);
        expect(job.audio_format.source).toBe('builtin');
    });

    test('the full chain reports a contributing source per field', () => {
        const job = resolveJob(
            baseBrief({ style: undefined, avoid: ['authored cliché'], structure: [{ at: '0:00', section: 'Intro' }] }),
            {
                workflow: { name: 'wf', language: 'fr' },
                theme: { name: 'cinematic', style: 'Theme direction.', avoid: ['authored cliché', 'stingers'] },
                format: { name: 'underscore', model: 'pro', duration_target: '0:45', instrumental: true },
            },
        );
        const lines = explainJob(job);
        expect(lines).toContain('model: pro (format preset "underscore")');
        expect(lines).toContain('duration_target: 0:45 (format preset "underscore")');
        expect(lines).toContain('language: fr (workflow preset "wf")');
        expect(lines).toContain('instrumental: true (format preset "underscore")');
        expect(lines).toContain('style: Theme direction. (theme preset "cinematic")');
        expect(lines).toContain('avoid: 2 entries (brief)');
        expect(lines).toContain('structure: 1 section(s) (brief)');
        expect(lines.some((line) => line.startsWith('title: Precedence (brief)'))).toBe(true);
    });

    test('avoid is additive across layers, de-duplicated case-insensitively', () => {
        const job = resolveJob(baseBrief({ duration_target: '0:30', avoid: ['Hard drops'] }), {
            workflow: { name: 'wf', avoid: ['bossanova'] },
            theme: { name: 'th', avoid: ['hard drops', 'stingers'] },
            format: { name: 'fm', avoid: ['stingers', 'spoken word'] },
        });
        expect(job.avoid.value).toEqual(['Hard drops', 'bossanova', 'stingers', 'spoken word']);
        expect(job.avoid.source).toBe('brief');
    });

    test('structure replaces rather than merges', () => {
        const job = resolveJob(baseBrief({ duration_target: '0:30', structure: [{ at: '0:00', section: 'Custom' }] }), {
            format: { name: 'fm', structure: [{ at: '0:00', section: 'Skeleton' }] },
        });
        expect(job.structure.value).toEqual([{ at: '0:00', section: 'Custom' }]);
    });

    test('a format lyrics_policy resolves instrumental', () => {
        const job = resolveJob(baseBrief({ duration_target: '0:30' }), {
            format: { name: 'underscore', lyrics_policy: 'forbidden' },
        });
        expect(job.instrumental.value).toBe(true);
        expect(job.lyrics).toBe('');
    });

    test('an unresolved Pro duration target fails loudly instead of accepting 3:00', () => {
        expect(() => resolveJob(baseBrief({ style: 'Direction.' }))).toThrow(JobResolutionError);
        try {
            resolveJob(baseBrief({ style: 'Direction.' }));
        } catch (error) {
            expect((error as Error).message).toContain('duration_target is unresolved for a Pro job');
            expect((error as Error).message).toContain('3:00');
        }
    });

    test('a clip job needs no duration target', () => {
        const job = resolveJob(baseBrief({ model: 'clip', style: 'Direction.' }));
        expect(job.duration_target.value).toBeUndefined();
        expect(job.duration_target.source).toBe('builtin');
    });

    test('an unresolved style fails loudly', () => {
        const noStyle = parseMusicBrief({ title: 'T', format: 'song', theme: 'lofi', duration_target: '0:30' });
        expect(() => resolveJob(noStyle)).toThrow(/style is unresolved/);
    });

    test('a format lyrics policy may not silently discard authored lyrics', () => {
        const withLyrics = parseMusicBrief({
            title: 'T',
            format: 'underscore',
            theme: 'cinematic',
            model: 'pro',
            duration_target: '0:45',
            style: 'Direction.',
            lyrics: '[Verse]\nwords',
        });
        expect(() => resolveJob(withLyrics, { format: { name: 'underscore', lyrics_policy: 'forbidden' } })).toThrow(
            /brief carries lyrics/,
        );
        expect(resolveJob(withLyrics, { format: { name: 'underscore', lyrics_policy: 'allowed' } }).lyrics).toBe(
            '[Verse]\nwords',
        );
    });

    test('invalid preset data is rejected, not trusted', () => {
        const noStyle = parseMusicBrief({ title: 'T', format: 'song', theme: 'th', duration_target: '0:30' });
        expect(() => resolveJob(noStyle, { theme: { name: 'th', style: '   ' } })).toThrow(
            /style from theme preset "th" is empty/,
        );
        expect(() => resolveJob(baseBrief({ model: 'clip', style: 'Direction.', duration_target: '2:30' }))).toThrow(
            /cannot apply to a clip job/,
        );
    });

    test('a portable preset file loads', async () => {
        const document = await loadPresetFile(join(PRESET_FIXTURES, 'valid-format.preset.yaml'));
        expect(document.name).toBe('jingle');
        expect(document.model).toBe('pro');
    });
});

describe('AC4 — preset portability is enforced', () => {
    test('a price, provider or API model id is rejected with exit code 2', () => {
        for (const file of [
            'invalid-price.preset.yaml',
            'invalid-provider.preset.yaml',
            'invalid-nested.preset.yaml',
        ]) {
            const path = join(PRESET_FIXTURES, file);
            try {
                parsePresetDocument(readFileSync(path, 'utf8'), path);
                throw new Error(`${file} should have been rejected`);
            } catch (error) {
                expect(error).toBeInstanceOf(PresetContractViolation);
                expect((error as PresetContractViolation).exitCode).toBe(2);
            }
        }
    });

    test('the violation names every offending dotted key', () => {
        const path = join(PRESET_FIXTURES, 'invalid-nested.preset.yaml');
        try {
            parsePresetDocument(readFileSync(path, 'utf8'), path);
        } catch (error) {
            expect((error as PresetContractViolation).violations).toEqual(['options.transport.base_url']);
            expect((error as PresetContractViolation).message).toContain('options.transport.base_url');
        }
        const providerPath = join(PRESET_FIXTURES, 'invalid-provider.preset.yaml');
        try {
            parsePresetDocument(readFileSync(providerPath, 'utf8'), providerPath);
        } catch (error) {
            expect((error as PresetContractViolation).violations).toEqual(['provider', 'api_model_id']);
        }
    });

    test('every forbidden key is refused at any depth', () => {
        for (const key of FORBIDDEN_PRESET_KEYS) {
            expect(() => assertPresetPortable({ name: 'x', nested: [{ [key]: 1 }] }, 'inline')).toThrow(
                PresetContractViolation,
            );
        }
        expect(() =>
            assertPresetPortable({ name: 'x', model: 'pro', duration_target: '0:30' }, 'inline'),
        ).not.toThrow();
    });

    test('the loader exits non-zero for a non-portable preset file', () => {
        const modulePath = join(import.meta.dir, '..', 'src', 'presets.ts');
        const presetPath = join(PRESET_FIXTURES, 'invalid-price.preset.yaml');
        const script = [
            `import { loadPresetFile } from ${JSON.stringify(modulePath)};`,
            `try { await loadPresetFile(${JSON.stringify(presetPath)}); process.exit(0); }`,
            `catch (error) { console.error(error.message); process.exit(error.exitCode ?? 1); }`,
        ].join('\n');
        const result = Bun.spawnSync([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
        expect(result.exitCode).toBe(2);
        expect(result.stderr.toString()).toContain('price');
    });

    test('a malformed preset document is a contract violation too', () => {
        expect(() => parsePresetDocument('name: [unclosed', 'inline')).toThrow(PresetContractViolation);
        expect(() => parsePresetDocument('- just\n- a list\n', 'inline')).toThrow(PresetContractViolation);
    });

    test('the golden briefs stay portable — no price or provider leaks through the brief', () => {
        const brief = loadGoldenBrief('pro-with-lyrics');
        expect(JSON.stringify(brief)).not.toContain('provider');
        expect(JSON.stringify(brief)).not.toContain('price');
    });
});
