import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { registerContentVerbs } from '../../src/commands/content';

describe('content command module', () => {
    it('registers the shared noun verbs on the supplied command', () => {
        const program = new Command();
        registerContentVerbs(program, 'article', 'itc');

        const noun = program.commands.find((command) => command.name() === 'article');
        // 0367: the article noun shares only the two generate step verbs (`generate-check`,
        // `generate-bundle`); the news-only five are registered on `kk news` alone (design §1.3 R1).
        expect(noun?.commands.map((command) => command.name()).sort()).toEqual([
            'generate',
            'generate-bundle',
            'generate-check',
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

    it('registers all seven generate step verbs on the news noun', () => {
        const program = new Command();
        registerContentVerbs(program, 'news', 'news');

        const noun = program.commands.find((command) => command.name() === 'news');
        expect(noun?.commands.map((command) => command.name()).sort()).toEqual([
            // `digest` is the news-only day digest (G83, task 0439): the same DailyDigest the
            // Board's Today tab reads, rendered as markdown or JSON (04_DESIGN §1.14).
            'digest',
            // `edit` is the G84 draft-edit verb (task 0444): news-only, like `digest`.
            'edit',
            'generate',
            'generate-bundle',
            'generate-cards',
            'generate-check',
            'generate-render',
            'generate-voice',
            'new',
            'prepare',
            'publish',
            'publish-check',
            'publish-plan',
            'publish-report',
            'publish-send',
            'publish-settle',
            'report',
            'status',
        ]);
    });
});
