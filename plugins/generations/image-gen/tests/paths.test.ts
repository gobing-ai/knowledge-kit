import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { artifactPath, outStemFor } from '../src/paths';

const PLUGIN_DIR = resolve(import.meta.dir, '..');
const OUT = '/tmp/kk-image-gen-test/run/deep/content.json';

describe('R3 — deterministic, collision-safe artefact naming', () => {
    test('the NN index is zero-padded from 01', () => {
        expect(artifactPath(OUT, 'content', 'cover', 1, 'png')).toBe(
            '/tmp/kk-image-gen-test/run/deep/content-cover-01.png',
        );
        expect(artifactPath(OUT, 'content', 'cover', 9, 'png')).toBe(
            '/tmp/kk-image-gen-test/run/deep/content-cover-09.png',
        );
        expect(artifactPath(OUT, 'content', 'cover', 10, 'png')).toBe(
            '/tmp/kk-image-gen-test/run/deep/content-cover-10.png',
        );
    });

    test('the name is deterministic: same inputs, same path; distinct indices never collide', () => {
        const a = artifactPath(OUT, 'content', 'illustration', 2, 'png');
        const b = artifactPath(OUT, 'content', 'illustration', 2, 'png');
        expect(a).toBe(b);
        const names = [1, 2, 3].map((i) => artifactPath(OUT, 'content', 'illustration', i, 'png'));
        expect(new Set(names).size).toBe(3);
    });

    test('the path resolves against --out, never against the plugin directory (cwd = plugin dir)', () => {
        const path = artifactPath(OUT, 'content', 'cover', 1, 'png');
        expect(path.startsWith(PLUGIN_DIR)).toBe(false);
        expect(path.startsWith(dirname(OUT))).toBe(true);
        expect(resolve(path)).toBe(path);
    });

    test('outStemFor defaults to the --out basename without extension', () => {
        expect(outStemFor(OUT)).toBe('content');
        expect(outStemFor('/tmp/x/my.content.json')).toBe('my.content');
    });

    test('outputStem override wins over the --out basename', () => {
        expect(outStemFor(OUT, 'custom-stem')).toBe('custom-stem');
        expect(artifactPath(OUT, outStemFor(OUT, 'hero'), 'cover', 1, 'png')).toBe(
            join(dirname(OUT), 'hero-cover-01.png'),
        );
    });
});
