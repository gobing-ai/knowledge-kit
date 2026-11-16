/**
 * K3/task-0380: render and score blind format × subject comparisons for six
 * candidate styles. Default mode renders only missing pairs; --dry-run validates
 * the 48-call plan without spawning kk; --report unblinds a completed scores file.
 *
 * Run from the repo root:
 *   bun plugins/generations/image-gen/scripts/eval-style-presets.ts --dry-run
 *   bun plugins/generations/image-gen/scripts/eval-style-presets.ts
 *   bun plugins/generations/image-gen/scripts/eval-style-presets.ts --report
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { StylePresetSchema } from '../src/presets';

const PROVIDER = 'minimax';
const MODEL = 'image-01';
const DIMENSIONS = [
    'subjectFidelity',
    'composition',
    'visualCoherence',
    'constraintAdherence',
    'artifactControl',
] as const;
type Dimension = (typeof DIMENSIONS)[number];
type Arm = 'candidate' | 'baseline';
type Side = 'A' | 'B';
type Format = 'free' | 'cover';
type ScoreArm = Record<Dimension, number | null>;
type CompleteScoreArm = Record<Dimension, number>;

interface Candidate {
    name: string;
    baseline: string;
}

interface Subject {
    id: string;
    free: string;
    cover: { title: string; subtitle: string; topics: string };
}

interface Job {
    pair: string;
    candidate: string;
    baseline: string;
    format: Format;
    subject: Subject;
    arm: Arm;
    side: Side;
    style: string;
    runDir: string;
    input: string;
    output: string;
    blindImage: string;
}

interface PairScore {
    pair: string;
    preferred: Side | 'tie' | null;
    scores: Record<Side, ScoreArm>;
    critical: Record<Side, string[]>;
    notes: string;
}

interface ScoreFile {
    reviewer: string;
    reviewedAt: string;
    pairs: PairScore[];
}

const CANDIDATES: Candidate[] = [
    { name: 'limited-ink-risograph-editorial', baseline: 'editorial' },
    { name: 'layered-papercraft-diorama', baseline: 'sketch' },
    { name: 'minimalist-ink-wash-negative-space', baseline: 'minimalist' },
    { name: 'notion-editorial-line-art', baseline: 'technical-diagram' },
    { name: 'product-exploded-identity', baseline: 'technical-diagram' },
    { name: 'handcrafted-clay-character', baseline: 'cute' },
];
const SUBJECTS: Subject[] = [
    {
        id: 'microservices',
        free: 'a request flowing through an API gateway to three microservices',
        cover: {
            title: 'Building Reliable AI Agents',
            subtitle: 'Patterns for production',
            topics: 'AI agents, API gateways, microservices',
        },
    },
    {
        id: 'semiconductor',
        free: 'a robotic arm inspecting a glowing semiconductor wafer in a dark cleanroom',
        cover: {
            title: 'Inside Modern Semiconductors',
            subtitle: 'From wafer to package',
            topics: 'semiconductor manufacturing, robotic inspection, advanced packaging',
        },
    },
];
const FORMATS: Format[] = ['free', 'cover'];

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string, fallback: string): string => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const PLUGIN_DIR = join(import.meta.dir, '..');
const WORK = option('--work', join(REPO_ROOT, '.works', 'tmp', 'k3-style-eval'));
const CANDIDATE_ROOT = option('--candidates', join(WORK, 'presets'));
const BLIND = join(WORK, 'blind');
const SCORES = option('--scores', join(BLIND, 'scores.json'));

function readYaml(path: string): unknown {
    return Bun.YAML.parse(readFileSync(path, 'utf8'));
}

function blankArm(): ScoreArm {
    return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, null])) as ScoreArm;
}

function buildJobs(): Job[] {
    for (const candidate of CANDIDATES) {
        const path = join(CANDIDATE_ROOT, 'styles', `${candidate.name}.yaml`);
        const style = StylePresetSchema.parse(readYaml(path));
        const operative = `${style.modifiers}\n${style.negative ?? ''}`;
        if (
            /[{[](?:SUBJECT|PRODUCT|ASPECT RATIO|USE|PLACE|CITY|WORD|CHARACTERS|ACCENT|PALETTE|SAFE AREA)/.test(
                operative,
            )
        ) {
            throw new Error(`${candidate.name}: unexpanded upstream slot`);
        }
        if (/(?:21:9|16:9|4:5|4:3|3:4|1:1)/.test(operative)) {
            throw new Error(`${candidate.name}: aspect-ratio override`);
        }
        if (!style.negative) throw new Error(`${candidate.name}: negative constraints required`);
        StylePresetSchema.parse(readYaml(join(PLUGIN_DIR, 'presets', 'styles', `${candidate.baseline}.yaml`)));
    }

    const jobs: Job[] = [];
    let sequence = 0;
    for (const candidate of CANDIDATES) {
        for (const subject of SUBJECTS) {
            for (const format of FORMATS) {
                sequence++;
                const pair = `P${String(sequence).padStart(2, '0')}`;
                const digest = createHash('sha256').update(`${candidate.name}:${subject.id}:${format}`).digest();
                const candidateSide: Side = digest[0] % 2 === 0 ? 'A' : 'B';
                for (const arm of ['candidate', 'baseline'] as const) {
                    const side: Side = arm === 'candidate' ? candidateSide : candidateSide === 'A' ? 'B' : 'A';
                    const runDir = join(WORK, 'runs', pair, arm);
                    jobs.push({
                        pair,
                        candidate: candidate.name,
                        baseline: candidate.baseline,
                        format,
                        subject,
                        arm,
                        side,
                        style: arm === 'candidate' ? candidate.name : candidate.baseline,
                        runDir,
                        input: join(runDir, 'in.json'),
                        output: join(runDir, 'content.json'),
                        blindImage: join(BLIND, pair, `${side}.jpg`),
                    });
                }
            }
        }
    }
    if (jobs.length !== 48 || new Set(jobs.map((job) => job.pair)).size !== 24) {
        throw new Error(
            `evaluation plan drifted: ${jobs.length} jobs / ${new Set(jobs.map((job) => job.pair)).size} pairs`,
        );
    }
    for (const candidate of CANDIDATES) {
        const cells = jobs.filter((job) => job.candidate === candidate.name && job.arm === 'candidate');
        if (cells.length !== 4 || new Set(cells.map((job) => job.side)).size !== 2) {
            throw new Error(`${candidate.name}: expected four cells and both blind sides`);
        }
    }
    return jobs;
}

async function writeJson(path: string, value: unknown): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function envelope(job: Job): unknown[] {
    const imageGen: Record<string, unknown> = {
        job: job.format,
        format: job.format,
        style: job.style,
        provider: PROVIDER,
        model: MODEL,
        maxImages: 1,
    };
    if (job.format === 'free') imageGen.vars = { subject: job.subject.free };
    else imageGen.vars = job.subject.cover;
    return [
        {
            id: `${job.pair}-${job.arm}`,
            title: job.subject.cover.title,
            body: job.format === 'free' ? job.subject.free : '',
            metadata: { imageGen },
        },
    ];
}

async function render(job: Job): Promise<void> {
    if (!flag('--force') && existsSync(job.output) && existsSync(job.blindImage)) {
        console.log(`skip ${job.pair}/${job.arm}`);
        return;
    }
    mkdirSync(job.runDir, { recursive: true });
    mkdirSync(dirname(job.blindImage), { recursive: true });
    await writeJson(job.input, envelope(job));
    const operatorConfig = process.env.KK_CONFIG ?? join(homedir(), '.config', 'kk', 'config.yaml');
    const home = join(WORK, 'home');
    const project = join(WORK, 'project');
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    const run = Bun.spawn(['kk', 'executor', 'run', 'image-gen', '--in', job.input, '--out', job.output], {
        cwd: REPO_ROOT,
        env: {
            ...process.env,
            HOME: home,
            KK_CONFIG: operatorConfig,
            KNOWLEDGE_KIT_PROJECT_ROOT: project,
            KK_IMAGE_PRESET_PATH: CANDIDATE_ROOT,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [code, stderr] = await Promise.all([run.exited, new Response(run.stderr).text()]);
    if (code !== 0) throw new Error(`kk exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
    const output = (await Bun.file(job.output).json()) as {
        metadata?: { images?: Array<{ path?: string }> };
    };
    const source = output.metadata?.images?.[0]?.path;
    if (!source) throw new Error(`${job.output}: metadata.images[0].path missing`);
    const thumb = Bun.spawnSync([
        'sips',
        '-Z',
        '900',
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '85',
        source,
        '--out',
        job.blindImage,
    ]);
    if (thumb.exitCode !== 0)
        throw new Error(`sips failed for ${job.pair}/${job.arm}: ${thumb.stderr.toString().trim()}`);
    console.log(`ok   ${job.pair}/${job.arm} → ${job.side}`);
}

async function writeReviewPackage(jobs: Job[]): Promise<number> {
    const pairs = [...new Set(jobs.map((job) => job.pair))].sort();
    const ready = pairs.filter((pair) => ['A', 'B'].every((side) => existsSync(join(BLIND, pair, `${side}.jpg`))));
    const manifest = ready.map((pair) => {
        const jobsForPair = jobs.filter((job) => job.pair === pair);
        return {
            pair,
            format: jobsForPair[0]?.format,
            subject: jobsForPair[0]?.subject.id,
            A: `${pair}/A.jpg`,
            B: `${pair}/B.jpg`,
        };
    });
    await writeJson(join(BLIND, 'manifest.json'), { schema_version: 'k3-blind-v1', pairs: manifest });
    await writeJson(join(WORK, 'mapping.json'), {
        schema_version: 'k3-mapping-v1',
        provider: PROVIDER,
        model: MODEL,
        jobs,
    });
    if (!existsSync(SCORES)) {
        const scores: ScoreFile = {
            reviewer: '',
            reviewedAt: '',
            pairs: ready.map((pair) => ({
                pair,
                preferred: null,
                scores: { A: blankArm(), B: blankArm() },
                critical: { A: [], B: [] },
                notes: '',
            })),
        };
        await writeJson(SCORES, scores);
    }
    return ready.length;
}

function completeArm(arm: ScoreArm, pair: string, side: Side): CompleteScoreArm {
    for (const dimension of DIMENSIONS) {
        const score = arm[dimension];
        if (typeof score !== 'number' || score < 1 || score > 5) {
            throw new Error(`${pair}/${side}.${dimension} must be a number from 1 to 5`);
        }
    }
    return arm as CompleteScoreArm;
}

function average(scores: CompleteScoreArm[]): CompleteScoreArm {
    return Object.fromEntries(
        DIMENSIONS.map((dimension) => [
            dimension,
            Math.round((scores.reduce((sum, score) => sum + score[dimension], 0) / scores.length) * 100) / 100,
        ]),
    ) as CompleteScoreArm;
}

async function report(jobs: Job[]): Promise<void> {
    const scoreFile = JSON.parse(await Bun.file(SCORES).text()) as ScoreFile;
    const scoreByPair = new Map(scoreFile.pairs.map((score) => [score.pair, score]));
    const rows = [];
    for (const candidate of CANDIDATES) {
        const candidateJobs = jobs.filter((job) => job.candidate === candidate.name && job.arm === 'candidate');
        const cells = [];
        let wins = 0;
        let baselineWins = 0;
        let ties = 0;
        const critical: object[] = [];
        const candidateScores: CompleteScoreArm[] = [];
        const baselineScores: CompleteScoreArm[] = [];
        for (const candidateJob of candidateJobs) {
            const score = scoreByPair.get(candidateJob.pair);
            if (!score?.preferred) throw new Error(`${candidateJob.pair}: missing preferred A/B/tie`);
            const candidateSide = candidateJob.side;
            const baselineSide: Side = candidateSide === 'A' ? 'B' : 'A';
            const candidateScore = completeArm(score.scores[candidateSide], score.pair, candidateSide);
            const baselineScore = completeArm(score.scores[baselineSide], score.pair, baselineSide);
            candidateScores.push(candidateScore);
            baselineScores.push(baselineScore);
            const preferred =
                score.preferred === 'tie' ? 'tie' : score.preferred === candidateSide ? 'candidate' : 'baseline';
            if (preferred === 'candidate') wins++;
            else if (preferred === 'baseline') baselineWins++;
            else ties++;
            if (score.critical[candidateSide].length > 0) {
                critical.push({
                    pair: score.pair,
                    format: candidateJob.format,
                    subject: candidateJob.subject.id,
                    violations: score.critical[candidateSide],
                });
            }
            cells.push({
                pair: score.pair,
                format: candidateJob.format,
                subject: candidateJob.subject.id,
                preferred,
                candidateScores: candidateScore,
                baselineScores: baselineScore,
                candidateCritical: score.critical[candidateSide],
                baselineCritical: score.critical[baselineSide],
                notes: score.notes,
            });
        }
        const accepted = wins >= 3 && critical.length === 0;
        rows.push({
            candidate: candidate.name,
            baseline: candidate.baseline,
            decision: accepted ? 'generation-reviewed / accepted' : 'rejected',
            wins,
            baselineWins,
            ties,
            critical,
            candidateAverage: average(candidateScores),
            baselineAverage: average(baselineScores),
            cells,
        });
    }
    const accepted = rows.filter((row) => row.decision.includes('accepted')).map((row) => row.candidate);
    const rejected = rows.filter((row) => !row.decision.includes('accepted')).map((row) => row.candidate);
    const payload = {
        schema_version: 'k3-evaluation-v1',
        provider: PROVIDER,
        model: MODEL,
        reviewer: scoreFile.reviewer,
        reviewedAt: scoreFile.reviewedAt,
        gate: 'candidate wins >= 3 of 4 cells and zero candidate critical violations',
        crossProviderClaim: false,
        acceptedCandidates: accepted,
        rejectedCandidates: rejected,
        results: rows,
    };
    const markdown = [
        '# K3 image-style evaluation',
        '',
        `- Provider/model: \`${PROVIDER}/${MODEL}\` (only configured provider; no cross-provider claim)`,
        `- Reviewer: ${scoreFile.reviewer || 'unrecorded'}; reviewed at: ${scoreFile.reviewedAt || 'unrecorded'}`,
        '- Gate: candidate wins at least 3 of 4 pairwise cells and has zero critical violations.',
        '',
        '| Candidate | Baseline | Wins | Baseline wins | Ties | Critical groups | Decision |',
        '| --- | --- | ---: | ---: | ---: | ---: | --- |',
        ...rows.map(
            (row) =>
                `| \`${row.candidate}\` | \`${row.baseline}\` | ${row.wins} | ${row.baselineWins} | ${row.ties} | ${row.critical.length} | ${row.decision} |`,
        ),
        '',
        '## Cell details',
        '',
        '| Candidate | Pair | Format | Subject | Preferred | Candidate critical | Notes |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows.flatMap((row) =>
            row.cells.map(
                (cell) =>
                    `| \`${row.candidate}\` | ${cell.pair} | ${cell.format} | ${cell.subject} | ${cell.preferred} | ${cell.candidateCritical.join('; ') || 'none'} | ${cell.notes.replaceAll('|', '\\|')} |`,
            ),
        ),
        '',
        'Exact prompts and raw provider artifacts are under `runs/`; blind A/B assignment is in `mapping.json`.',
        '',
    ].join('\n');
    await writeJson(join(WORK, 'evaluation-report.json'), payload);
    await Bun.write(join(WORK, 'evaluation-report.md'), markdown);
    for (const row of rows) console.log(`${row.decision}: ${row.candidate} (${row.wins}/4 wins)`);
    console.log(`wrote ${join(WORK, 'evaluation-report.md')}`);
}

const jobs = buildJobs();
if (flag('--dry-run')) {
    console.log(
        `evaluation plan OK: ${jobs.length} provider calls / ${new Set(jobs.map((job) => job.pair)).size} blind pairs`,
    );
    for (const candidate of CANDIDATES)
        console.log(`${candidate.name} vs ${candidate.baseline}: free + cover × microservices + semiconductor`);
} else if (flag('--report')) {
    await report(jobs);
} else {
    const queue = [...jobs];
    const failed: string[] = [];
    const worker = async (): Promise<void> => {
        for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
            try {
                await render(job);
            } catch (error) {
                failed.push(`${job.pair}/${job.arm}`);
                console.error(`FAIL ${job.pair}/${job.arm}: ${error instanceof Error ? error.message : error}`);
            }
        }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    const ready = await writeReviewPackage(jobs);
    console.log(`${ready}/24 blind pairs ready; scores: ${SCORES}`);
    if (failed.length > 0) {
        console.error(`failed jobs: ${failed.join(', ')}`);
        process.exit(1);
    }
}
