import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerContentPublishCommand, registerContentPublishVerbs } from '../../src/commands/content-publish';

describe('content publish command module', () => {
    it('registers all five named-flag publish steps', () => {
        const noun = new Command('article');
        registerContentPublishVerbs(noun, 'itc');

        expect(noun.commands.map((command) => command.name()).sort()).toEqual([
            'publish-check',
            'publish-plan',
            'publish-report',
            'publish-send',
            'publish-settle',
        ]);
        expect(noun.commands.every((command) => command.options.some((option) => option.long === '--work-dir'))).toBe(
            true,
        );
    });

    it('keeps the host-integration registration alias on the same five-verb surface', () => {
        const noun = new Command('news');
        registerContentPublishCommand(noun, 'news');

        expect(noun.commands.map((command) => command.name()).sort()).toEqual([
            'publish-check',
            'publish-plan',
            'publish-report',
            'publish-send',
            'publish-settle',
        ]);
    });
});
