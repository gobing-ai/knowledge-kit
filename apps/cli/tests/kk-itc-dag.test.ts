import { describe, expect, it } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const ITC_DAG = join(REPO, 'plugins/kk/workflows/kk-itc.yaml');
const ITC_AUTHOR = join(REPO, 'plugins/kk/workflows/kk-itc-author.yaml');

describe('kk-itc DAG workflow (0302 / G21 R6)', () => {
    it('is a valid kind: dag workflow with version 2', () => {
        const raw = readFileSync(ITC_DAG, 'utf-8');
        const parsed = Bun.YAML.parse(raw) as {
            name: string;
            kind: string;
            version: string;
            nodes: Array<{ id: string; dependsOn?: string[] }>;
        };

        expect(parsed.name).toBe('kk-itc');
        expect(parsed.kind).toBe('dag');
        expect(parsed.version).toBe('2');
        expect(Array.isArray(parsed.nodes)).toBe(true);

        const nodeIds = parsed.nodes.map((n) => n.id);
        expect(nodeIds).toContain('prepare');
        // 0360 R4 (ADR-053 §5): the traffic probe is the sole root node, so no work starts on a dead executor.
        expect(nodeIds[0]).toBe('executor-probe');
        expect(parsed.nodes.filter((node) => (node.dependsOn ?? []).length === 0).map((node) => node.id)).toEqual([
            'executor-probe',
        ]);
        expect(parsed.nodes.find((node) => node.id === 'prepare')?.dependsOn).toContain('executor-probe');
        expect(nodeIds).toContain('child-author');
        expect(nodeIds).toContain('verify-child-freeze');
        expect(nodeIds).toContain('materialize-plan');
        expect(nodeIds).toContain('adapt');
        expect(nodeIds).toContain('check-targets');
        expect(nodeIds).toContain('send-confirm');
        expect(nodeIds).toContain('fanout-send');
        expect(nodeIds).toContain('fanout-recovery');
        expect(nodeIds).toContain('reconcile-settle');
        expect(nodeIds).toContain('seo');
        expect(nodeIds).toContain('report');

        // Topological ordering check: every node's dependsOn must precede it in declaration order
        const seen = new Set<string>();
        for (const node of parsed.nodes) {
            for (const dep of node.dependsOn ?? []) {
                expect(seen.has(dep), `node '${node.id}' depends on '${dep}' declared after it`).toBe(true);
            }
            seen.add(node.id);
        }

        // report depends on verify-child-freeze so all-skipped publication branches still produce report
        const reportNode = parsed.nodes.find((n) => n.id === 'report');
        expect(reportNode?.dependsOn).toContain('verify-child-freeze');
        // ...and on every branch tail, so the report never races an unfinished send or SEO export.
        expect(reportNode?.dependsOn).toEqual(['verify-child-freeze', 'reconcile-settle', 'seo']);
    });

    it('validates kk-itc-author child workflow exists and is state-machine with version 2', () => {
        expect(existsSync(ITC_AUTHOR)).toBe(true);
        const raw = readFileSync(ITC_AUTHOR, 'utf-8');
        const parsed = Bun.YAML.parse(raw) as {
            name: string;
            kind: string;
            version: string;
            initialState: string;
            terminalStates: string[];
            states: Array<{ id: string }>;
        };

        expect(parsed.name).toBe('kk-itc-author');
        expect(parsed.kind).toBe('state-machine');
        expect(parsed.version).toBe('2');
        expect(parsed.initialState).toBe('author-init');
        expect(parsed.terminalStates).toContain('done');
        expect(parsed.terminalStates).toContain('failed');

        const stateIds = parsed.states.map((s) => s.id);
        expect(stateIds).toContain('outline-write');
        expect(stateIds).toContain('outline-select');
        expect(stateIds).toContain('outline-commit');
        expect(stateIds).toContain('draft-write');
        expect(stateIds).toContain('unslop');
        expect(stateIds).toContain('draft-review');
        expect(stateIds).toContain('draft-revise');
        expect(stateIds).toContain('draft-autorevise');
        expect(stateIds).toContain('judge');
        expect(stateIds).toContain('author-finish');
    });

    it('passes spur workflow validate for both kk-itc DAG and kk-itc-author FSM', () => {
        const resDag = Bun.spawnSync(['spur', 'workflow', 'validate', ITC_DAG], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(resDag.exitCode).toBe(0);

        const resAuthor = Bun.spawnSync(['spur', 'workflow', 'validate', ITC_AUTHOR], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(resAuthor.exitCode).toBe(0);
    });
});

describe('kk-itc child launch (0301 R2 / 0302 R6)', () => {
    const node = (
        Bun.YAML.parse(readFileSync(ITC_DAG, 'utf-8')) as {
            nodes: Array<{ id: string; action: { options: { command: string } } }>;
        }
    ).nodes.find((n) => n.id === 'child-author');
    // `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet
    const commandFor = (workDir: string): string =>
        (node?.action.options.command ?? '').replace(/\$\{vars\.(\w+)\}/g, (_, name: string) =>
            name === '__runId' ? 'parent-1' : name === 'work_dir' ? workDir : `v-${name}`,
        );
    // The frozen snapshot is the child's only source for the config-backed options.
    const seedOptions = (dir: string): void =>
        writeFileSync(
            join(dir, 'itc-options.json'),
            JSON.stringify({
                writer: 'itc-generating',
                playbook: 'generic',
                auto: true,
                unslop: false,
                judge: false,
                maxRevisions: 3,
                optionsDigest: 'od-1',
            }),
        );

    // A stub `spur` whose child run status is a file: `run`/`continue` log their argv and move
    // the status to what the scenario says the child reaches next.
    // `cwdLine` defaults to the checkout so the child definition hits the same-tree branch; pass
    // a temp dir to exercise the installed-package fallback instead.
    function launch(
        before: string,
        after: string,
        cwd = REPO,
        prependPath?: string,
    ): { exitCode: number; calls: string[]; stderr: string } {
        const dir = mkdtempSync(join(tmpdir(), 'kk-itc-child-'));
        try {
            const status = join(dir, 'status');
            writeFileSync(status, before);
            writeFileSync(
                join(dir, 'spur'),
                [
                    '#!/bin/sh',
                    `echo "$*" >> "${join(dir, 'calls')}"`,
                    `case "$2" in`,
                    `  trace) s=$(cat "${status}"); [ -n "$s" ] || exit 1; printf '{"run":{"status":"%s"}}' "$s" ;;`,
                    `  run|continue) printf '%s' "${after}" > "${status}" ;;`,
                    'esac',
                ].join('\n'),
            );
            chmodSync(join(dir, 'spur'), 0o755);
            seedOptions(dir);
            const result = Bun.spawnSync(['sh', '-c', commandFor(dir)], {
                cwd,
                env: {
                    ...process.env,
                    PATH: `${prependPath ? `${prependPath}:` : ''}${dir}:${process.env.PATH ?? ''}`,
                },
                stderr: 'pipe',
            });
            const calls = readFileSync(join(dir, 'calls'), 'utf-8')
                .trim()
                .split('\n')
                .filter((c) => !c.startsWith('workflow trace'));
            return { exitCode: result.exitCode, calls, stderr: result.stderr.toString() };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('launches a fresh child under the id derived from the parent run', () => {
        const { exitCode, calls } = launch('', 'done');
        expect(exitCode).toBe(0);
        expect(calls).toHaveLength(1);
        // From the checkout cwd the tree branch resolves the relative definition.
        expect(calls[0]?.split(' ')[2]).toBe('plugins/kk/workflows/kk-itc-author.yaml');
        // Child vars come from the frozen snapshot, stringified for the FSM's string vars.
        expect(calls[0]).toContain('"writer":"itc-generating"');
        expect(calls[0]).toContain('"auto":"true"');
        expect(calls[0]).toContain('"max_revisions":"3"');
        expect(calls[0]).toContain('"options_digest":"od-1"');
        expect(calls[0]).toContain('"child_run_id":"parent-1-author"');
    });

    it('a cancelled parent stops the owned child and cancels its run', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-itc-cancel-'));
        try {
            const calls = join(dir, 'calls');
            writeFileSync(
                join(dir, 'spur'),
                [
                    '#!/bin/sh',
                    `echo "$*" >> "${calls}"`,
                    `case "$2" in`,
                    '  trace) exit 1 ;;',
                    `  run) echo $$ > "${join(dir, 'child.pid')}"; exec sleep 30 ;;`,
                    'esac',
                ].join('\n'),
            );
            chmodSync(join(dir, 'spur'), 0o755);
            seedOptions(dir);
            const parent = Bun.spawn(['sh', '-c', commandFor(dir)], {
                env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
                stderr: 'pipe',
            });
            const pidFile = join(dir, 'child.pid');
            for (let i = 0; i < 100 && !existsSync(pidFile); i++) await Bun.sleep(20);
            const childPid = Number(readFileSync(pidFile, 'utf-8').trim());
            parent.kill('SIGTERM');
            expect(await parent.exited).toBe(143);
            const alive = (): boolean => {
                try {
                    process.kill(childPid, 0);
                    return true;
                } catch {
                    return false;
                }
            };
            for (let i = 0; i < 50 && alive(); i++) await Bun.sleep(20);
            expect(alive()).toBe(false);
            expect(readFileSync(calls, 'utf-8')).toContain('workflow cancel parent-1-author');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('continues the same paused child instead of starting a second one', () => {
        const { exitCode, calls } = launch('paused', 'done');
        expect(exitCode).toBe(0);
        expect(calls).toEqual(['workflow continue parent-1-author --yes']);
    });

    it('reports a child that pauses again as a distinct non-success naming the child', () => {
        const { exitCode, stderr } = launch('paused', 'paused');
        expect(exitCode).toBe(1);
        expect(stderr).toContain('child parent-1-author paused');
    });

    it('resolves the child definition from the kk package root when the cwd has no checkout (item 6)', () => {
        // Fake install the resolution snippet walks up through: `<pkg>/bin/kk` with a shipped
        // workflow tree, exposed on PATH via a symlink whose realpath resolves back into the pkg.
        // The run cwd has no kk tree at all, so the kk-binary branch must produce the path.
        // Canonical path: the snippet realpaths the kk binary (/private/var on macOS, not tmpdir()'s /var).
        const pkg = realpathSync(mkdtempSync(join(tmpdir(), 'kk-itc-pkg-')));
        const emptyDir = mkdtempSync(join(tmpdir(), 'kk-itc-noworktree-'));
        try {
            mkdirSync(join(pkg, 'bin'), { recursive: true });
            mkdirSync(join(pkg, 'plugins/kk/workflows'), { recursive: true });
            writeFileSync(join(pkg, 'bin/kk'), '#!/bin/sh\necho kk-stub\n');
            chmodSync(join(pkg, 'bin/kk'), 0o755);
            symlinkSync(join(pkg, 'bin/kk'), join(pkg, 'kk'));
            writeFileSync(join(pkg, 'plugins/kk/workflows/kk-itc-author.yaml'), 'placeholder\n');
            const { exitCode, calls } = launch('', 'done', emptyDir, pkg);
            expect(exitCode).toBe(0);
            expect(calls[0]).toContain(
                `workflow run ${join(pkg, 'plugins/kk/workflows/kk-itc-author.yaml')} --run-id parent-1-author`,
            );
        } finally {
            rmSync(pkg, { recursive: true, force: true });
            rmSync(emptyDir, { recursive: true, force: true });
        }
    });

    it('refuses to launch when no kk tree resolves from the cwd and no kk binary exists', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-itc-nokk-'));
        try {
            seedOptions(dir);
            const result = Bun.spawnSync(['sh', '-c', commandFor(dir)], {
                cwd: dir,
                // The system tool dirs keep sh/jq; neither carries a kk binary, so both
                // resolution branches fail and the node must fail loud instead of guessing.
                env: { ...process.env, PATH: '/usr/bin:/bin' },
                stderr: 'pipe',
            });
            expect(result.exitCode).toBe(1);
            expect(result.stderr.toString()).toContain('kk-itc-author.yaml');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('never relaunches a completed or failed child', () => {
        expect(launch('done', 'done')).toMatchObject({ exitCode: 0, calls: [] });
        const failed = launch('failed', 'failed');
        expect(failed.exitCode).toBe(1);
        expect(failed.calls).toEqual([]);
        expect(failed.stderr).toContain('refusing to relaunch');
    });
});

describe('kk-itc prepare node (0303 R2-R5)', () => {
    const node = (
        Bun.YAML.parse(readFileSync(ITC_DAG, 'utf-8')) as {
            nodes: Array<{ id: string; action: { options: { command: string } } }>;
        }
    ).nodes.find((n) => n.id === 'prepare');
    const vars = (workDir: string, extra: Record<string, string>): Record<string, string> => ({
        work_dir: workDir,
        __runId: 'run-p',
        force: 'false',
        ...extra,
    });
    const commandFor = (v: Record<string, string>): string =>
        (node?.action.options.command ?? '').replace(/\$\{vars\.(\w+)\}/g, (_, name: string) => v[name] ?? '');

    // A stub `kk` that logs argv; `itc-prepare` freezes its request as the snapshot, like the real stage.
    function run(v: Record<string, string>, snapshot?: Record<string, unknown>) {
        const dir = mkdtempSync(join(tmpdir(), 'kk-itc-prep-'));
        try {
            const wd = v.work_dir === '' ? '' : join(dir, 'ws');
            if (wd !== '') Bun.spawnSync(['mkdir', '-p', wd]);
            if (snapshot) writeFileSync(join(wd, 'itc-options.json'), JSON.stringify(snapshot));
            const calls = join(dir, 'calls');
            writeFileSync(
                join(dir, 'kk'),
                [
                    '#!/bin/sh',
                    `echo "$*" >> "${calls}"`,
                    `if [ "$3" = itc-prepare ]; then jq '. + {sourceKind:"topic", sourceValue:.topic}' "$5" > "${wd}/itc-options.json"; cp "$5" "${dir}/request.json"; fi`,
                ].join('\n'),
            );
            chmodSync(join(dir, 'kk'), 0o755);
            const result = Bun.spawnSync(['sh', '-c', commandFor({ ...v, work_dir: wd })], {
                env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` },
                stderr: 'pipe',
            });
            const read = (f: string): string => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf-8') : '');
            return {
                exitCode: result.exitCode,
                stderr: result.stderr.toString(),
                calls: read('calls').trim().split('\n').filter(Boolean),
                request: read('request.json'),
            };
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('a direct launch freezes the options via itc-prepare, dropping unset vars, then prepares the brief', () => {
        const r = run(vars('x', { topic: 'reliable-workflows', auto: 'true', max_revisions: '2' }));
        expect(r.exitCode).toBe(0);
        expect(r.calls[0]).toStartWith('stage run itc-prepare --request');
        expect(JSON.parse(r.request)).toEqual({
            topic: 'reliable-workflows',
            workDir: expect.any(String),
            parentRunId: 'run-p',
            auto: true,
            force: false,
            maxRevisions: 2,
        });
        expect(r.calls[1]).toMatch(/^stage run prepare-itc \S+ reliable-workflows {2}false$/);
    });

    it("refuses another run's snapshot unless force adopts it", () => {
        const foreign = { parentRunId: 'run-old', sourceKind: 'topic', sourceValue: 't' };
        const refused = run(vars('x', {}), foreign);
        expect(refused.exitCode).toBe(1);
        expect(refused.stderr).toContain("belongs to run 'run-old'");
        expect(refused.calls).toEqual([]);
        expect(run(vars('x', { force: 'true' }), foreign).exitCode).toBe(0);
    });

    it('a collected topic prepares under its display title, an input file under its path', () => {
        const collected = run(vars('x', {}), {
            parentRunId: 'run-p',
            sourceKind: 'from_collect',
            sourceValue: 'rust-weekly',
            displayTitle: 'Async Rust',
        });
        expect(collected.calls).toEqual([expect.stringMatching(/prepare-itc \S+ Async Rust {2}false$/)]);
        const file = run(vars('x', {}), { parentRunId: 'run-p', sourceKind: 'input_file', sourceValue: '/in.md' });
        expect(file.calls).toEqual([expect.stringMatching(/prepare-itc \S+ {2}\/in\.md false$/)]);
    });

    it('requires work_dir', () => {
        const r = run(vars('', {}));
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('work_dir is required');
    });
});
