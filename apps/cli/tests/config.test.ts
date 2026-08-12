import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLI_CONFIG } from '../src/config';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8')) as {
    version: string;
};

describe('CLI_CONFIG', () => {
    it('names the kk binary', () => {
        expect(CLI_CONFIG.binaryName).toBe('kk');
    });

    it('loads the package version, never the hard-coded 0.0.0', () => {
        expect(CLI_CONFIG.binaryVersion).toBe(pkg.version);
        expect(CLI_CONFIG.binaryVersion).not.toBe('0.0.0');
    });
});
