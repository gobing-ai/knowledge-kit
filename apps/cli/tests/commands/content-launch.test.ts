/**
 * `content-launch` unit surface (task 0365 R6, R7): the two pure rules the plain launch verbs own —
 * the run-date normalizer and the CN-consent/window validation ported from
 * the retired publish-window launcher — plus the workflow-path resolution the
 * `workflows_dir` override feeds.
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { Command, CommanderError } from 'commander';
import {
    normalizeRunDate,
    registerContentLaunchVerbs,
    resolveWorkflowPath,
    validateLiveTokens,
} from '../../src/commands/content-launch';
import { silenceOutput } from '../capture';

const preset = {
    targets: [
        { plugin: 'weibo-pub', window: 'cn-peak', mode: 'live' },
        { plugin: 'xhs-pub', window: 'cn-peak', mode: 'off' },
        { plugin: 'podcast-pub', window: 'after-generate', mode: 'live' },
    ],
};

function refusal(run: () => void): CommanderError {
    try {
        run();
    } catch (error) {
        if (error instanceof CommanderError) return error;
        throw error;
    }
    throw new Error('expected a CommanderError refusal');
}

describe('normalizeRunDate (0365 R3)', () => {
    it('accepts both spellings of a real calendar day and rejects everything else', () => {
        expect(normalizeRunDate('20260101')).toBe('20260101');
        expect(normalizeRunDate('2026-01-01')).toBe('20260101');
        expect(normalizeRunDate(' 2026-12-31 ')).toBe('20261231');
        expect(normalizeRunDate('20261332')).toBeUndefined();
        expect(normalizeRunDate('2026-02-30')).toBeUndefined();
        expect(normalizeRunDate('tomorrow')).toBeUndefined();
    });
});

describe('validateLiveTokens (0365 R7, design §3.3)', () => {
    it('accepts a token the requested window carries as a live row', () => {
        const silence = silenceOutput();
        try {
            expect(() => validateLiveTokens(preset, 'cn-peak', ['weibo-pub'], 'daily-ai-voice')).not.toThrow();
        } finally {
            silence();
        }
    });

    it('refuses a token whose row is off, unknown, or outside the window', () => {
        const silence = silenceOutput();
        try {
            expect(() => validateLiveTokens(preset, 'cn-peak', ['xhs-pub'], 'daily-ai-voice')).toThrow(
                "live token(s) xhs-pub have no active row in window 'cn-peak' of preset 'daily-ai-voice'",
            );
            expect(() => validateLiveTokens(preset, 'cn-peak', ['nope-pub'], 'daily-ai-voice')).toThrow(
                'have no active row',
            );
            expect(() => validateLiveTokens(preset, 'overseas-rss', ['podcast-pub'], 'daily-ai-voice')).toThrow(
                'have no active row',
            );
            expect(() => validateLiveTokens(preset, 'cn-peak', ['weibo-pub'], 'daily-ai-voice')).not.toThrow();
        } finally {
            silence();
        }
    });

    it('refuses every token when the preset cannot be read, and allows an empty token list', () => {
        const silence = silenceOutput();
        try {
            expect(() => validateLiveTokens(null, 'cn-peak', [], 'missing')).not.toThrow();
            const refused = refusal(() => validateLiveTokens(null, 'cn-peak', ['weibo-pub'], 'missing'));
            expect(refused.exitCode).toBe(5);
            expect(refused.message).toContain("preset 'missing' was not found");
        } finally {
            silence();
        }
    });

    it('accepts a plugin when an earlier row in the window is off and another row is active', () => {
        const multiRow = {
            targets: [
                { plugin: 'weibo-pub', operation: 'article', window: 'cn-peak', mode: 'off' },
                { plugin: 'weibo-pub', operation: 'post', window: 'cn-peak', mode: 'live' },
            ],
        };
        const silence = silenceOutput();
        try {
            expect(() => validateLiveTokens(multiRow, 'cn-peak', ['weibo-pub'], 'daily-ai-voice')).not.toThrow();
        } finally {
            silence();
        }
    });
});

describe('resolveWorkflowPath (0365 R6)', () => {
    it('prefers the workflows_dir override and falls back to the package root', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-workflow-path-'));
        const override = join(root, 'workflows');
        mkdirSync(override, { recursive: true });
        writeFileSync(join(override, 'kk-publish.yaml'), 'name: kk-publish\n');
        const fs = createNodeFileSystem();

        expect(await resolveWorkflowPath('kk-publish', { workflows_dir: override }, fs)).toBe(
            join(override, 'kk-publish.yaml'),
        );
        const fallback = await resolveWorkflowPath('kk-publish', { workflows_dir: override }, fs);
        expect(fallback).toBe(join(override, 'kk-publish.yaml'));

        const shipped = await resolveWorkflowPath('kk-news-generate', { workflows_dir: override }, fs);
        expect(shipped).toEndWith(join('plugins', 'kk', 'workflows', 'kk-news-generate.yaml'));
        const empty = await resolveWorkflowPath('kk-news-generate', {}, fs);
        expect(empty).toEndWith(join('plugins', 'kk', 'workflows', 'kk-news-generate.yaml'));
    });
});

describe('registerContentLaunchVerbs (0365 R6)', () => {
    it('attaches generate and publish with named flags only', () => {
        const noun = new Command('article');
        registerContentLaunchVerbs(noun, 'article', 'itc');

        expect(noun.commands.map((command) => command.name()).sort()).toEqual(['generate', 'publish']);
        for (const command of noun.commands) {
            expect(command.registeredArguments).toHaveLength(0);
            expect(command.options.some((option) => option.long === '--dry-run')).toBe(true);
        }
        const publish = noun.commands.find((command) => command.name() === 'publish');
        expect(publish?.options.some((option) => option.long === '--unattended')).toBe(true);
        expect(publish?.options.some((option) => option.long === '--work-dir')).toBe(true);
    });
});
