import { fileURLToPath } from 'node:url';

/**
 * Release tag helper, mirroring the spur-new release UX (`bump-ver` / `drop-tags`
 * + a tag→CI→npm-publish flow). The release tag is
 * `@gobing-ai/knowledge-kit-v<version>`; pushing it triggers the Publish workflow
 * (.github/workflows/publish.yml). Single releasable package: apps/cli.
 */

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const PACKAGE = {
    packageDir: 'apps/cli',
    packageName: '@gobing-ai/knowledge-kit',
    tagVersionSeparator: '-v',
    publishWorkflow: 'publish.yml',
    releaseCommitType: 'chore',
    releaseCommitScope: 'release',
    releaseCommitSubject: (version: string) => `bump knowledge-kit to ${version}`,
    releaseTagMessage: (tag: string) => `release: ${tag}`,
} as const;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

/** The git tag that, when pushed, triggers the Publish workflow. */
function releaseTag(version: string): string {
    return `${PACKAGE.packageName}${PACKAGE.tagVersionSeparator}${version}`;
}

/** Run a command synchronously, capturing stdout; never throws (caller checks `ok`). */
function run(cmd: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = Bun.spawnSync(cmd, { cwd: repoRoot });
    return {
        ok: result.exitCode === 0,
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
    };
}

/** Run git and return trimmed stdout; throws with context on failure. */
function git(args: string[]): string {
    const result = run(['git', ...args]);
    if (!result.ok) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** True if `name@version` is already on the npm registry (never re-tag a published version). */
function npmViewVersion(version: string): boolean {
    const result = run(['npm', 'view', `${PACKAGE.packageName}@${version}`, 'version']);
    return result.ok && result.stdout === version;
}

function assertCleanTreeOnBranch(): string {
    if (git(['status', '--porcelain']) !== '') {
        throw new Error('working tree is not clean. Commit or stash changes before releasing.');
    }
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') {
        throw new Error('detached HEAD — checkout a branch before releasing.');
    }
    return branch;
}

function assertTagFree(tag: string, version: string): void {
    const localTags = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        throw new Error(`tag already exists locally: ${tag}. Run "bun run drop-tags ${version}" first.`);
    }
    // Remote clash is best-effort: a missing/unreachable origin must not block a
    // release (the push step would surface a genuine remote problem anyway).
    const remote = run(['git', 'ls-remote', '--tags', 'origin']);
    if (remote.ok && remote.stdout.includes(`refs/tags/${tag}`)) {
        throw new Error(`tag already exists on origin: ${tag}. Run "bun run drop-tags ${version} --remote" first.`);
    }
    if (!remote.ok) {
        console.warn('warning: could not check origin for tag clashes (remote unreachable); continuing.');
    }
}

async function bumpVersion(version: string, options: { push: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.1).`);
    }

    const tag = releaseTag(version);
    const branch = assertCleanTreeOnBranch();
    assertTagFree(tag, version);

    if (npmViewVersion(version)) {
        throw new Error(`${PACKAGE.packageName}@${version} is already published on npm. Use a new version.`);
    }
    const manifestPath = `${repoRoot}${PACKAGE.packageDir}/package.json`;
    const manifest = await Bun.file(manifestPath).json();
    const previous: string = manifest.version;
    manifest.version = version;
    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
    console.log(`${PACKAGE.packageName}: ${previous} -> ${version}`);

    const staged = [`${PACKAGE.packageDir}/package.json`];
    if (Bun.file(`${repoRoot}bun.lock`).size > 0) staged.push('bun.lock');
    git(['add', ...staged]);

    const message = `${PACKAGE.releaseCommitType}(${PACKAGE.releaseCommitScope}): ${PACKAGE.releaseCommitSubject(version)}`;
    git(['commit', '-m', message]);
    console.log(`Committed: ${message}`);

    git(['tag', '-a', tag, '-m', PACKAGE.releaseTagMessage(tag)]);
    console.log(`Tagged: ${tag}`);

    if (!options.push) {
        console.log('\nDone (local). Review, then push to release:');
        console.log(`  git push origin ${branch}`);
        console.log(`  git push origin ${tag}`);
        console.log('Or re-run with --push next time to do this automatically.');
        return;
    }

    console.log(`\nPushing branch ${branch} (tags excluded)...`);
    git(['push', 'origin', branch]);
    console.log(`Pushing release trigger tag ${tag}...`);
    git(['push', 'origin', tag]);

    console.log(`\nReleased ${version}. The Publish workflow should now be running:`);
    console.log(`  gh run list --workflow=${PACKAGE.publishWorkflow} --limit 5`);
}

async function dropTags(version: string, options: { remote: boolean }): Promise<void> {
    if (!SEMVER.test(version)) {
        throw new Error(`"${version}" is not a valid semver version (expected e.g. 0.1.1).`);
    }
    const tag = releaseTag(version);

    const localTags = new Set(git(['tag', '-l']).split('\n').filter(Boolean));
    if (localTags.has(tag)) {
        git(['tag', '-d', tag]);
        console.log(`Deleted local tag ${tag}`);
    } else {
        console.log(`No local tag ${tag}`);
    }

    if (options.remote) {
        const result = run(['git', 'push', 'origin', `:refs/tags/${tag}`]);
        console.log(result.ok ? `Deleted remote tag ${tag}` : `Remote tag ${tag} not present or already removed`);
    }
}

function usage(message?: string): never {
    if (message) console.error(`error: ${message}\n`);
    console.error('Usage:');
    console.error(`  bun run bump-ver <version> [--push]     bump version, commit, tag, optionally push`);
    console.error(`  bun run drop-tags <version> [--remote]  delete the release tag`);
    process.exit(message ? 1 : 0);
}

const [subcommand, ...args] = process.argv.slice(2);
try {
    switch (subcommand) {
        case 'bump-ver': {
            const positional = args.filter((arg) => !arg.startsWith('--'));
            const version = positional[0];
            if (!version || !SEMVER.test(version)) usage('bump-ver <version> [--push]');
            await bumpVersion(version, { push: args.includes('--push') });
            break;
        }
        case 'drop-tags': {
            const positional = args.filter((arg) => !arg.startsWith('--'));
            const version = positional[0];
            if (!version || !SEMVER.test(version)) usage('drop-tags <version> [--remote]');
            await dropTags(version, { remote: args.includes('--remote') });
            break;
        }
        default:
            usage(subcommand ? `unknown command "${subcommand}"` : undefined);
    }
} catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
