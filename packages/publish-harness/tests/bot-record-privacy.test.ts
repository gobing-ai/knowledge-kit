import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRail } from '../src/bot-codegen';
import { readTranscript } from '../src/bot-record';

const fixtures = join(import.meta.dir, 'fixtures', 'bot-record');

/** Values that must never appear in a committed transcript or a generated rail. */
const SECRET_SHAPES: readonly { label: string; pattern: RegExp }[] = [
    { label: 'bearer token', pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
    { label: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
    { label: 'cookie header', pattern: /(set-)?cookie:/i },
    { label: 'auth header', pattern: /authorization:/i },
    { label: 'password literal', pattern: /"password"\s*:\s*"(?!<redacted>)/ },
    { label: 'auth_token literal', pattern: /"auth_?token"\s*:\s*"(?!<redacted>)/ },
];

describe('committed fixtures', () => {
    const files = readdirSync(fixtures).filter((name) => name.endsWith('.json'));

    test('the fixture set is the three the task names', () => {
        expect(files.sort()).toEqual(['local-post.json', 'threads.json', 'x.json']);
    });

    for (const file of files) {
        test(`${file} carries no credential-shaped value`, () => {
            const text = readFileSync(join(fixtures, file), 'utf8');
            for (const { label, pattern } of SECRET_SHAPES) {
                expect(text, `${file} contains a ${label}`).not.toMatch(pattern);
            }
        });

        test(`${file} is marked redacted`, async () => {
            expect((await readTranscript(join(fixtures, file))).redacted).toBe(true);
        });
    }
});

describe('generated rails', () => {
    test('a generated rail never carries a credential, even from a response body that does', async () => {
        const transcript = await readTranscript(join(fixtures, 'local-post.json'));

        const { source } = generateRail(transcript, { plugin: 'local-pub', operation: 'post' });
        for (const { label, pattern } of SECRET_SHAPES) {
            expect(source, `generated rail contains a ${label}`).not.toMatch(pattern);
        }
    });
});
