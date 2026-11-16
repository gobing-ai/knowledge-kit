import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.cwd();
const work = join(repo, '.works/tmp/k3-style-eval-h3-local');
const scorePath = join(work, 'blind/scores.json');
const files = process.argv.slice(2);
if (files.length === 0) throw new Error('pass reviewer JSON files');
const dimensions = ['subjectFidelity', 'composition', 'visualCoherence', 'constraintAdherence', 'artifactControl'];
const scores = JSON.parse(readFileSync(scorePath, 'utf8'));
const byPair = new Map(scores.pairs.map((pair) => [pair.pair, pair]));
const seen = new Set();

for (const file of files) {
    const envelope = JSON.parse(readFileSync(join(repo, file), 'utf8'));
    if (envelope.exitCode !== 0) throw new Error(`${file}: reviewer exit ${envelope.exitCode}`);
    const stdout = envelope.stdout.trim();
    const isArray = stdout.includes('[{"pair"');
    const start = isArray ? stdout.indexOf('[{"pair"') : stdout.indexOf('{"pair"');
    const end = isArray ? stdout.lastIndexOf(']') : stdout.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error(`${file}: no JSON score payload`);
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    for (const entry of isArray ? parsed : [parsed]) {
        const target = byPair.get(entry.pair);
        if (!target) throw new Error(`${file}: unexpected ${entry.pair}`);
        if (seen.has(entry.pair) || target.preferred) throw new Error(`${file}: duplicate ${entry.pair}`);
        if (!['A', 'B', 'tie'].includes(entry.preferred)) throw new Error(`${entry.pair}: invalid preference`);
        for (const side of ['A', 'B']) {
            for (const dimension of dimensions) {
                const value = entry.scores?.[side]?.[dimension];
                if (typeof value !== 'number' || value < 1 || value > 5) {
                    throw new Error(`${entry.pair}/${side}.${dimension}: invalid score ${value}`);
                }
            }
            if (!Array.isArray(entry.critical?.[side])) throw new Error(`${entry.pair}/${side}: critical must be an array`);
        }
        Object.assign(target, entry);
        seen.add(entry.pair);
    }
}
scores.reviewer = 'grok-4.7 via spur agent run; blind images only';
scores.reviewedAt = new Date().toISOString();
await Bun.write(scorePath, `${JSON.stringify(scores, null, 2)}\n`);
console.log(`validated and merged ${seen.size} H3 blind pair reviews into ${scorePath}`);
