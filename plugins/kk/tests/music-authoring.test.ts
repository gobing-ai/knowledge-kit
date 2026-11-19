/**
 * The `kk:music-authoring` skill and its `music-quality` rubric (task 0402, feature D8 R1–R5).
 *
 * Failure-first list (written before the assertions):
 *  1. The skill drifts away from the four operations — an operation loses its operator gate or its
 *     resume rule, so a resumed run re-authors or re-pays for work it already owns.
 *  2. The skill promises something the instance cannot do (an exact duration, a `negative_prompt`
 *     parameter, an in-place edit, Clip as a Pro preview), which becomes a spend commitment an agent
 *     cannot honour.
 *  3. The documented brief does not parse against the 0397 schema, or `kk music render` emits the
 *     instance-owned prompt markers that kk must never write.
 *  4. The skill names a `kk music` verb the CLI does not ship (a documentation-only command).
 *  5. The music rubric grows a second must-pass, weights that do not sum to 1.0, or a measurement
 *     rule that lets the judge re-score from the prompt instead of quoting `checks.json`.
 *  6. The rubric emits a second verdict shape: a `music-verdict.json` or an extra top-level field
 *     that the confidence-aware gates would read as `PASS!`.
 *
 * The behavioural halves spawn the real CLI (`apps/cli/src/index.ts`) because the skill's whole
 * value is that its documented commands run: `render` (free, no instance traffic) and `check`
 * (ffmpeg-only, no instance traffic).
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const SKILL_REL = 'plugins/kk/skills/music-authoring/SKILL.md';
const BUNDLE_REL = 'plugins/kk/skills/music-authoring/references/judge-input.md';
const RUBRIC_REL = 'plugins/kk/skills/content-judge/references/music-quality-rubric.md';
const JUDGE_SKILL_REL = 'plugins/kk/skills/content-judge/SKILL.md';
const CLI_REL = 'apps/cli/src/commands/music/index.ts';
const KK_ENTRY = join(REPO, 'apps/cli/src/index.ts');

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf-8');

const skill = read(SKILL_REL);
const bundleRef = read(BUNDLE_REL);
const rubric = read(RUBRIC_REL);
const judgeSkill = read(JUDGE_SKILL_REL);

const tempDirs: string[] = [];
afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

/** The body after the frontmatter block (the byte budget and the scans read the body). */
function body(text: string): string {
    const lines = text.split('\n');
    const end = lines.indexOf('---', 1);
    return lines.slice(end + 1).join('\n');
}

/** One `### <heading>` section of the skill, up to the next heading of the same or higher rank. */
function operationSection(id: string): string {
    const lines = skill.split('\n');
    const start = lines.findIndex((line) => line.trim() === `### ${id}`);
    if (start === -1) return '';
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{2,3} /.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** The first fenced block of a language, without its fences. */
function fenced(text: string, lang: string): string {
    const match = text.match(new RegExp(`\\\`\\\`\\\`${lang}\\n([\\s\\S]*?)\\n\\\`\\\`\\\``));
    if (match?.[1] === undefined) throw new Error(`no ${lang} fence in the file`);
    return match[1];
}

/** Run a `kk music` verb from the checkout and return its output + status. */
function kkMusic(args: string[]): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [KK_ENTRY, 'music', ...args], {
        cwd: REPO,
        encoding: 'utf-8',
        env: { ...process.env, KK_MUSIC_DRY_RUN: '1' },
        timeout: 120_000,
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** A brief in the authoring form the skill documents (a `song` direction, `pro`, 0:30). */
const SAMPLE_BRIEF = `title: Midnight Cable Car
format: song
theme: synthwave
model: pro
duration_target: "0:30"
language: EN
instrumental: true
audio_format: wav
style: |-
  Warm analog synthwave at 92 BPM in A minor: detuned pad, gated snare, round sub bass.
avoid:
  - trap hi-hats
structure:
  - at: "0:00"
    section: Intro
    note: filtered pad, no drums for four bars
  - at: "0:20"
    section: Chorus
    note: gated snare opens up
takes: 1
`;

describe('the skill covers the authoring loop (R1)', () => {
    const OPERATIONS = ['brief', 'lyric', 'iterate', 'review'] as const;

    it('declares all four operations and nothing else', () => {
        const declared = [...skill.matchAll(/^### ([a-z]+)$/gm)].map((match) => match[1]);
        expect(declared).toEqual([...OPERATIONS]);
    });

    it.each(OPERATIONS)('`%s` names its operator gate and its resume rule', (operation) => {
        const section = operationSection(operation);
        expect(section.length).toBeGreaterThan(200);
        // Every operation stops for a human decision and knows how to continue an interrupted run.
        expect(section).toMatch(/\*\*Gate\*\*/);
        expect(section).toMatch(/\*\*Resume\*\*|\*\*Prerequisite\*\*/);
        // ... and it drives real verbs, not prose.
        expect(section).toMatch(/kk music [a-z]+/);
    });

    it('keeps the body inside the 20,000-byte skill budget', () => {
        const bytes = Buffer.byteLength(body(skill), 'utf-8');
        expect(bytes).toBeGreaterThan(5_000);
        expect(bytes).toBeLessThanOrEqual(20_000);
    });

    it('renders the documented brief through the 0397 schema (free, no instance traffic)', () => {
        const dir = tempDir('kk-music-brief-');
        const briefPath = join(dir, 'brief-01.yaml');
        const promptPath = join(dir, 'brief-01.prompt.txt');
        writeFileSync(briefPath, SAMPLE_BRIEF);

        const { status, output } = kkMusic(['render', '--in', briefPath, '--out', promptPath]);
        expect(output).toContain(`prompt written to ${promptPath}`);
        expect(status).toBe(0);

        const prompt = readFileSync(promptPath, 'utf-8');
        // The resolved technical direction, the merged deny-list and the timestamped structure.
        expect(prompt).toContain('Warm analog synthwave at 92 BPM in A minor');
        expect(prompt).toContain('Avoid: trap hi-hats');
        expect(prompt).toContain('[0:20] Chorus — gated snare opens up');
        // The instance owns these two markers; kk writing them would duplicate the request fields.
        expect(prompt).not.toContain('Total running time');
        expect(prompt).not.toContain('Lyrics (sing in');
    });

    it('measures a take into checks.json with every row carrying its source', () => {
        const dir = tempDir('kk-music-check-');
        const takePath = join(dir, 'midnight-cable-car-pro-probe.wav');
        const made = spawnSync(
            'ffmpeg',
            [
                '-v',
                'error',
                '-f',
                'lavfi',
                '-i',
                'sine=frequency=220:duration=30',
                '-ar',
                '44100',
                '-ac',
                '2',
                '-c:a',
                'pcm_s16le',
                takePath,
            ],
            { encoding: 'utf-8' },
        );
        expect(made.status).toBe(0);

        const { output } = kkMusic([
            'check',
            takePath,
            '--model',
            'pro',
            '--duration-target',
            '0:30',
            '--style',
            'Warm analog synthwave at 92 BPM in A minor',
            '--sections',
            '2',
        ]);
        expect(output).toContain(`checks written to ${takePath}.checks.json`);

        const rows = JSON.parse(readFileSync(`${takePath}.checks.json`, 'utf-8')) as Array<Record<string, unknown>>;
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            // 0405 R2's field set: the rubric's citation rule depends on all six.
            for (const field of ['id', 'measured', 'threshold', 'unit', 'source', 'result']) {
                expect(Object.keys(row)).toContain(field);
            }
            expect(String(row.source).length).toBeGreaterThan(0);
        }
        const duration = rows.find((row) => row.id === 'duration.target');
        expect(duration?.result).toBe('pass');
        expect(duration?.unit).toBe('s');
        // The measured facts the rubric quotes, present whether or not an analysis landed.
        expect(rows.map((row) => row.id)).toContain('analysis.present');
        // The skill must tell the operator that this row is the analyze step's precondition.
        expect(skill).toContain('analysis.present');
    });
});

describe("the skill states the model's real limits (R2)", () => {
    const CONSTRAINTS = [
        'prompt-is-the-only-control-surface',
        'duration-is-a-target',
        'clip-is-not-a-pro-preview',
        'no-negative-prompt',
        'every-take-is-a-new-paid-request',
        'no-in-place-edit',
    ];

    it.each(CONSTRAINTS)('the limits table carries `%s` exactly once', (id) => {
        const occurrences = skill.split(`\`${id}\``).length - 1;
        expect(occurrences).toBe(1);
    });

    it('names the Clip model as a different model, not a preview of Pro', () => {
        expect(skill).toMatch(/`clip` is a \*\*different model\*\*/);
        expect(skill).toMatch(/fixed at about 30 s/);
        expect(skill).toMatch(/not a Pro preview|not a preview of the Pro take/i);
    });

    it('says every take is paid and immutable, and that an edit is a full re-generation', () => {
        expect(skill).toMatch(/paid, non-idempotent/);
        expect(skill).toMatch(/immutable/);
        expect(skill).toMatch(/full re-generation/);
    });

    it('states the duration tolerance the checks actually apply', () => {
        // ±20% or ±10 s, whichever is larger — the numbers that make a 0:30 target a 0:20–0:40 band.
        expect(skill).toMatch(/±20% \*\*or ±10 s, whichever is larger\*\*/);
        expect(skill).toContain('PRO_DURATION_TOLERANCE_RATIO');
    });

    it('forbids a negative_prompt parameter rather than teaching one', () => {
        expect(skill).toMatch(/There is no `negative_prompt` field/);
        expect(skill).not.toMatch(/negative_prompt:/);
    });
});

describe('every verb the skill names is one the CLI ships (anti-drift)', () => {
    const shipped = new Set([...read(CLI_REL).matchAll(/\.command\('([a-z]+)/g)].map((match) => match[1]));

    it('parses the shipped verb list', () => {
        // `music` itself is the noun registration; the seven verbs below it are the flow's vocabulary.
        expect([...shipped].sort()).toEqual([
            'analyze',
            'check',
            'gen',
            'library',
            'master',
            'music',
            'presets',
            'render',
        ]);
    });

    it('names only shipped verbs, and names the ones the flow needs', () => {
        const named = new Set([...skill.matchAll(/kk music ([a-z]+)/g)].map((match) => match[1]));
        const unknown = [...named].filter((verb) => !shipped.has(verb));
        expect(unknown).toEqual([]);
        for (const verb of ['render', 'gen', 'check', 'analyze', 'master']) {
            expect(named.has(verb)).toBe(true);
        }
    });
});

describe('the review bundle is one path with five verbatim inputs (R5)', () => {
    const SECTIONS = ['brief', 'prompt', 'lyrics', 'analysis', 'checks', 'provenance'];

    it.each(SECTIONS)('section `%s` is in the skill table and the reference headings', (id) => {
        expect(skill).toMatch(new RegExp(`\\| \\\`${id}\\\` \\|`));
        expect(bundleRef).toMatch(new RegExp(`## \\d\\. ${id}\\b`));
    });

    it('requires the inputs verbatim and forbids re-derivation', () => {
        expect(bundleRef).toMatch(/Verbatim means pasted/);
        expect(bundleRef).toMatch(/Never hand-edited/);
        expect(bundleRef).toMatch(/One take per bundle/);
    });

    it('hands the bundle to the existing judge with the music rubric', () => {
        expect(bundleRef).toContain('Skill(skill="kk:content-judge")');
        expect(bundleRef).toMatch(/rubric:\s+music-quality/);
        expect(bundleRef).toMatch(/4-verdict-music\.json/);
    });
});

describe('the music-quality rubric defers measurement to checks.json (R3)', () => {
    /** The scoring table's criterion rows: id, weight, must-pass. */
    const criteria = [...rubric.matchAll(/^\| `([a-z.-]+)`[^|]*\| ([0-9.]+) \| (yes|no) \|$/gm)].map((match) => ({
        id: match[1] ?? '',
        weight: Number(match[2]),
        mustPass: match[3] === 'yes',
    }));

    it('declares the six criteria and the craft dimensions the task names', () => {
        expect(criteria.map((row) => row.id)).toEqual([
            'checks.clean',
            'brief-adherence',
            'arrangement',
            'lyric-intelligibility',
            'hook',
            'production-artefacts',
        ]);
    });

    it('weights sum to 1.0 and `checks.clean` is the only must-pass', () => {
        const total = criteria.reduce((sum, row) => sum + row.weight, 0);
        expect(Math.round(total * 100) / 100).toBe(1);
        expect(criteria.filter((row) => row.mustPass).map((row) => row.id)).toEqual(['checks.clean']);
        expect(rubric).toContain('pass_threshold = 0.75');
    });

    it('a checks.json fail row is a FAIL verdict, quoted with its unit and source', () => {
        expect(rubric).toMatch(/result: "fail"/);
        expect(rubric).toMatch(/the verdict is `FAIL`/);
        // Anti-hallucination: numbers are quoted from the row, never re-derived or scored by ear.
        expect(rubric).toMatch(/never re-derived/);
        expect(rubric).toMatch(/Never score by ear/);
        expect(rubric).toContain('`source` is the authority');
        expect(rubric).toMatch(/`warn` row never becomes a `fail`/);
    });

    it('is wired into the content-judge rubric table and its resources', () => {
        expect(judgeSkill).toMatch(/\| `music-quality` \|/);
        expect(judgeSkill).toContain('references/music-quality-rubric.md');
        expect(read('plugins/kk/skills/content-judge/references/rubrics.md')).toContain('## music-quality');
    });
});

describe('the verdict contract is unchanged (R4)', () => {
    const contract = JSON.parse(fenced(judgeSkill, 'json')) as Record<string, unknown>;
    const emitted = JSON.parse(fenced(rubric, 'json')) as Record<string, unknown>;

    it("emits exactly the contract's top-level fields, in no new shape", () => {
        expect(Object.keys(emitted).sort()).toEqual(Object.keys(contract).sort());
    });

    it('emits the same finding fields as the contract', () => {
        const contractFinding = (contract.findings as Array<Record<string, unknown>>)[0] ?? {};
        const emittedFinding = (emitted.findings as Array<Record<string, unknown>>)[0] ?? {};
        expect(Object.keys(emittedFinding).sort()).toEqual(Object.keys(contractFinding).sort());
    });

    it('names the rubric and takes findings only from its own criteria', () => {
        expect(emitted.rubric).toBe('music-quality');
        expect(emitted.content_ref).toBe('<the take path>');
        const allowed = [...rubric.matchAll(/^\| `([a-z.-]+)`[^|]*\| [0-9.]+ \| (?:yes|no) \|$/gm)].map(
            (match) => match[1],
        );
        const declared = String((emitted.findings as Array<Record<string, unknown>>)[0]?.criterion ?? '').split(' | ');
        expect(declared).toEqual(allowed);
    });

    it('carries the confidence enum the gates refuse to guess', () => {
        // The producer half of the contract: missing confidence turns a PASS into `PASS!`.
        expect(rubric).toMatch(/"confidence"\s*:\s*"HIGH\s*\|\s*MEDIUM\s*\|\s*LOW"/);
        expect(rubric).toContain('`HIGH`');
        expect(rubric).toContain('`MEDIUM`');
        expect(rubric).toContain('`LOW`');
    });

    it('ships no second verdict file', () => {
        // Neither the skill nor the bundle may name one, and the rubric may only forbid it.
        expect(skill).not.toContain('music-verdict');
        expect(bundleRef).not.toContain('music-verdict');
        expect(rubric.split('music-verdict').length - 1).toBe(1);
        expect(rubric).toMatch(/Do not write a\s+`music-verdict\.json`/);
    });
});
