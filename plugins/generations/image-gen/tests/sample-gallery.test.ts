import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Task 0340: README.md indexes one sample per shipped format × style pair.
const PLUGIN_DIR = join(import.meta.dir, '..');
const SAMPLE_DIR = join(PLUGIN_DIR, 'assets', 'sample');
const stems = (axis: string): string[] =>
    readdirSync(join(PLUGIN_DIR, 'presets', axis))
        .filter((entry) => entry.endsWith('.yaml'))
        .map((entry) => entry.slice(0, -'.yaml'.length));

describe('preset sample gallery', () => {
    const formats = stems('formats');
    const styles = stems('styles');
    const pairs = formats.flatMap((format) => styles.map((style) => `${format}__${style}.jpg`));
    const readme = readFileSync(join(PLUGIN_DIR, 'README.md'), 'utf8');

    test('every shipped format × style pair has exactly one sample on disk', () => {
        expect(pairs.filter((file) => !existsSync(join(SAMPLE_DIR, file)))).toEqual([]);
        expect(
            readdirSync(SAMPLE_DIR)
                .filter((file) => file.endsWith('.jpg'))
                .sort(),
        ).toEqual([...pairs].sort());
    });

    test('every sample records its actual provider and model', () => {
        const provenance = JSON.parse(readFileSync(join(SAMPLE_DIR, 'provenance.json'), 'utf8')) as Record<
            string,
            { provider?: string; model?: string }
        >;
        for (const file of pairs) {
            expect(provenance[file]?.provider).toBeString();
            expect(provenance[file]?.provider).not.toBe('');
            expect(provenance[file]?.model).toBeString();
            expect(provenance[file]?.model).not.toBe('');
        }
    });

    test('the README embeds every sample and links nothing missing', () => {
        const linked = [...readme.matchAll(/src="assets\/sample\/([^"]+)"/g)].map((match) => match[1]);
        expect([...linked].sort()).toEqual([...pairs].sort());
    });

    test('the README lists every shipped format and style by name', () => {
        for (const name of [...formats, ...styles]) {
            expect(readme).toContain(`\`${name}\``);
        }
    });
});
