/**
 * Rewrite git's auto-generated merge subject into a Conventional Commit.
 *
 * The `commit-msg` hook runs `cog verify`, which parses every message as a Conventional Commit —
 * merges included. `git pull` / `git merge` write `Merge branch 'main' of <url>`, so the merge
 * auto-commit is rejected, the merge stays open with `MERGE_HEAD` set, and every later pull dies with
 * "You have not concluded your merge". Rewriting the subject here (git's own text is kept in the
 * body, where cog ignores it) keeps `git pull`, `git pull -a` and `git merge` working unchanged.
 *
 * Deliberately fail-open: this is a message cosmetic, not a gate. Anything that is not a generated
 * merge subject is left exactly as written, so a human's message is never touched.
 *
 * Usage (from the `prepare-commit-msg` hook): `<message-file> <source> [merge-head-sha] [branch]`
 */

const [file, source, sha, branch] = process.argv.slice(2);

if ((source === 'merge' || source === 'squash') && file) {
    const text = await Bun.file(file).text();
    const [header, ...rest] = text.split('\n');

    if (/^Merge\b/.test(header)) {
        const body = rest.join('\n').replace(/^\n+/, '');
        const subject = `chore: merge ${sha || 'inbound'} into ${branch || 'HEAD'}`;
        await Bun.write(file, `${subject}\n\n${header}\n\n${body}`);
    }
}
