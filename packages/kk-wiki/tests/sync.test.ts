import { describe, expect, it } from 'bun:test';
import { resolveRemote, UnknownRemoteError } from '../src/sync';

const remotes = {
    r2: { command: 'rclone sync {content} {remote}', remote: 'r2:treasury/raw' },
    git: { command: 'git -C {content} push {remote}', remote: 'origin' },
};

describe('resolveRemote', () => {
    it('substitutes {content} and {remote} into the declared command', () => {
        const resolved = resolveRemote(remotes, 'r2', { content: '/vault/content' });
        expect(resolved.argv).toEqual(['rclone', 'sync', '/vault/content', 'r2:treasury/raw']);
        expect(resolved.remote).toBe('r2:treasury/raw');
    });

    it('resolves a second remote independently', () => {
        expect(resolveRemote(remotes, 'git', { content: '/vault/content' }).argv).toEqual([
            'git',
            '-C',
            '/vault/content',
            'push',
            'origin',
        ]);
    });

    it('names the undeclared remote and lists what is declared', () => {
        expect(() => resolveRemote(remotes, 'dropbox', { content: '/v' })).toThrow(UnknownRemoteError);
        expect(() => resolveRemote(remotes, 'dropbox', { content: '/v' })).toThrow(/declared: git, r2/);
        expect(() => resolveRemote({}, 'x', { content: '/v' })).toThrow(/declared: none/);
    });
});
