import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerContentVerbs } from '../../src/commands/content';

describe('content command module', () => {
    it('registers the shared noun verbs on the supplied command', () => {
        const program = new Command();
        registerContentVerbs(program, 'article', 'itc');

        const noun = program.commands.find((command) => command.name() === 'article');
        expect(noun?.commands.map((command) => command.name()).sort()).toEqual([
            'generate',
            'new',
            'publish',
            'publish-check',
            'publish-plan',
            'publish-report',
            'publish-send',
            'publish-settle',
            'status',
        ]);
    });
});
