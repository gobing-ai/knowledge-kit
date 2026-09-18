import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createProgram } from '../src/cli';

describe('leftover publish harvest operator surface (0147)', () => {
    it('ships a thin kk publish skill that does not add a first-layer kk noun', () => {
        expect(existsSync(join(import.meta.dir, '../../../plugins/kk/skills/publish/SKILL.md'))).toBe(true);
        expect(
            existsSync(join(import.meta.dir, '../../../plugins/kk/workflows/leftover-publish-fanout-example.yaml')),
        ).toBe(true);
        const names = createProgram().commands.map((command) => command.name());
        expect(names).not.toContain('publish');
        expect(names).toContain('executor');
        expect(names).toContain('plugin');
    });
});
