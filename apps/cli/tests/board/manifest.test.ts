/**
 * G8/0252 — the fixed artifact manifest, the capture settings allowlists and the pure
 * availability/path rules. No HTTP server here.
 */

import { describe, expect, it } from 'bun:test';
import {
    allowlistedKeys,
    artifactById,
    artifactsFor,
    COLLECT_ARTIFACTS,
    expandPattern,
    resolveAvailability,
    resolveWithin,
    WORKFLOW_NAMES,
    WORKFLOW_SETTINGS,
} from '../../src/board/manifest';

describe('workflow allowlists', () => {
    it('names the three workflows and their capturable keys only', () => {
        expect([...WORKFLOW_NAMES]).toEqual(['kk-collect', 'kk-daily-ai-voice2', 'kk-itc']);
        expect(allowlistedKeys('kk-collect')).toEqual(['limit', 'horizon_hours']);
        expect(WORKFLOW_SETTINGS['kk-collect'].limit).toEqual({ kind: 'integer' });
        // Free text and provider blocks are uncapturable by construction.
        expect(Object.keys(WORKFLOW_SETTINGS['kk-daily-ai-voice2'])).not.toContain('topic');
        expect(Object.keys(WORKFLOW_SETTINGS['kk-itc'])).not.toContain('title');
    });
});

describe('artifact manifest', () => {
    it('pins the four collect artifacts to their producer action keys', () => {
        expect(COLLECT_ARTIFACTS.map((spec) => spec.producerActionKey)).toEqual([
            'collect:onEnter:0',
            'collect:onEnter:1',
            'store:onEnter:0',
            'label:onEnter:0',
        ]);
        expect(artifactsFor('kk-itc')).toEqual([]);
        expect(artifactById('kk-collect', 'facts')?.producerNode).toBe('collect');
        expect(artifactById('kk-collect', 'nope')).toBeUndefined();
    });

    it('expands the stamp and refuses traversal or an absolute pattern', () => {
        expect(expandPattern('10-ingest/{stamp}_02_collect_blended.json', 'S1')).toBe(
            '10-ingest/S1_02_collect_blended.json',
        );
        expect(resolveWithin('/ws', 'a/b.json')).toBe('/ws/a/b.json');
        expect(resolveWithin('/ws', '../outside.json')).toBeNull();
        expect(resolveWithin('/ws', '/etc/passwd')).toBeNull();
    });
});

describe('resolveAvailability', () => {
    it('never returns available without an owned marker, a successful producer and a file', () => {
        expect(resolveAvailability('owned', 'success', 'present', true)).toBe('available');
        expect(resolveAvailability('foreign', 'success', 'present', true)).toBe('superseded');
        expect(resolveAvailability('absent', 'success', 'present', true)).toBe('unverified');
        expect(resolveAvailability('invalid', 'success', 'present', true)).toBe('invalid');
        expect(resolveAvailability('owned', 'unknown', 'present', true)).toBe('unverified');
        expect(resolveAvailability('owned', 'failure', 'present', true)).toBe('missing');
        expect(resolveAvailability('owned', 'success', 'absent', true)).toBe('missing');
        expect(resolveAvailability('owned', 'success', 'too-large', true)).toBe('oversized');
        expect(resolveAvailability('owned', 'success', 'unreadable', true)).toBe('invalid');
        expect(resolveAvailability('owned', 'pending', 'absent', false)).toBe('pending');
        expect(resolveAvailability('owned', 'pending', 'absent', true)).toBe('missing');
    });
});
