import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Use the shipped script author's dependencies in a real DAG run. Slow article authoring and
// ready translation/style nodes make the missing article dependency fail deterministically.
test('daily script authoring waits for article exclusions in voice2 and voice3', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kk-script-ordering-'));
    const results: Record<string, unknown>[] = [];
    try {
        for (const version of ['2', '3']) {
            const path = resolve(import.meta.dir, `../../../plugins/kk/workflows/kk-daily-ai-voice${version}.yaml`);
            const workflow = Bun.YAML.parse(await Bun.file(path).text()) as {
                nodes: Array<{ id: string; dependsOn?: string[] }>;
            };
            const dependencies = workflow.nodes.find((node) => node.id === 'script-write')?.dependsOn ?? [];
            const article = join(root, `article-${version}.json`);
            const output = join(root, `script-${version}.json`);
            const shell = (id: string, command: string, dependsOn?: string[]) => ({
                id,
                ...(dependsOn ? { dependsOn } : {}),
                action: { kind: 'shell', options: { command } },
            });
            const fixture = {
                name: `script-ordering-${version}`,
                kind: 'dag',
                nodes: [
                    shell('script-style', 'true'),
                    ...(dependencies.includes('curate-final')
                        ? [shell('curate-final', `printf '%s' '{"excluded":["finance"]}' > '${article}'`)]
                        : [
                              shell('plan-translate', 'true'),
                              shell('plan-translate-retry', 'true'),
                              shell('article-write', `sleep 1; printf '%s' '{"excluded":["finance"]}' > '${article}'`),
                              shell('article', `test -s '${article}'`, ['article-write']),
                          ]),
                    // voice3's script-write also waits on pool-gate (0238/voice3 union); declare it so
                    // the replayed dependencies stay valid in this minimal DAG.
                    ...(dependencies.includes('pool-gate') ? [shell('pool-gate', 'true')] : []),
                    shell('script-write', `test -s '${article}' && cp '${article}' '${output}'`, dependencies),
                ],
            };
            const fixturePath = join(root, `ordering-${version}.yaml`);
            await writeFile(fixturePath, Bun.YAML.stringify(fixture));
            const child = Bun.spawn(['spur', '--no-logo', 'workflow', 'run', fixturePath, '--quiet', '--no-plan'], {
                cwd: root,
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const stdout = new Response(child.stdout).text();
            const stderr = new Response(child.stderr).text();
            const exitCode = await child.exited;
            const detail = `${await stdout}\n${await stderr}`;
            expect(exitCode, `voice${version}: ${detail}`).toBe(0);
            expect(await Bun.file(output).json()).toEqual({ excluded: ['finance'] });
            results.push({ version, dependencies, exitCode, excludedCopied: true });
        }
        await Bun.write(
            resolve(import.meta.dir, '../../../.works/tmp/test-script-ordering/summary.json'),
            JSON.stringify({ version: 1, results }, null, 2),
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30000);

test('daily voice fallback runs after primary failure using the shipped error policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kk-voice-fallback-'));
    try {
        for (const version of ['2', '3']) {
            const path = resolve(import.meta.dir, `../../../plugins/kk/workflows/kk-daily-ai-voice${version}.yaml`);
            const workflow = Bun.YAML.parse(await Bun.file(path).text()) as {
                nodes: Array<{
                    id: string;
                    action: { kind: string; onError?: string; options: Record<string, unknown> };
                }>;
            };
            const primary = workflow.nodes.find((node) => node.id === 'generate');
            if (!primary) throw new Error('missing primary generate node');
            const output = join(root, `fallback-${version}.json`);
            const fixture = {
                name: `voice-fallback-${version}`,
                kind: 'dag',
                nodes: [
                    {
                        id: 'generate',
                        action: { ...primary.action, options: { ...primary.action.options, command: 'exit 1' } },
                    },
                    {
                        id: 'generate-fallback',
                        dependsOn: ['generate'],
                        action: {
                            kind: 'shell',
                            options: { command: `printf '%s' '{"fallback":true}' > '${output}'` },
                        },
                    },
                ],
            };
            const fixturePath = join(root, `fallback-${version}.yaml`);
            await writeFile(fixturePath, Bun.YAML.stringify(fixture));
            const child = Bun.spawn(['spur', '--no-logo', 'workflow', 'run', fixturePath, '--quiet', '--no-plan'], {
                cwd: root,
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const stdout = new Response(child.stdout).text();
            const stderr = new Response(child.stderr).text();
            const exitCode = await child.exited;
            expect(exitCode, `voice${version}: ${await stdout}\n${await stderr}`).toBe(0);
            expect(await Bun.file(output).json()).toEqual({ fallback: true });
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
