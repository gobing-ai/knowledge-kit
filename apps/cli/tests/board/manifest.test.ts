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
    CONFIDENCE_LEVELS,
    DAILY_VOICE_ARTIFACTS,
    expandPattern,
    ITC_ARTIFACTS,
    isConfidenceLevel,
    NEWS_GENERATE_ARTIFACTS,
    resolveAvailability,
    resolveWithin,
    WORKFLOW_NAMES,
    WORKFLOW_SETTINGS,
} from '../../src/board/manifest';

describe('workflow allowlists', () => {
    it('names the three workflows and their capturable keys only', () => {
        expect([...WORKFLOW_NAMES]).toEqual([
            'kk-collect',
            'kk-daily-ai-voice2',
            'kk-itc',
            'kk-news-generate',
            'kk-article-generate',
        ]);
        // 0369 R8 / AC5: a G61 successor reuses its predecessor's manifest and settings —
        // superseded for news by 0391: the news DAG owns its artifact map (same file shapes, news
        // node ids); the settings allowlist still follows the voice2 family.
        expect(artifactsFor('kk-news-generate')).toBe(NEWS_GENERATE_ARTIFACTS);
        expect(artifactsFor('kk-article-generate')).toBe(artifactsFor('kk-itc'));
        expect(allowlistedKeys('kk-news-generate')).toEqual(allowlistedKeys('kk-daily-ai-voice2'));
        expect(allowlistedKeys('kk-article-generate')).toEqual(allowlistedKeys('kk-itc'));
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
        expect(artifactsFor('kk-itc')).toBe(ITC_ARTIFACTS);
        expect(artifactById('kk-collect', 'facts')?.producerNode).toBe('collect');
        expect(artifactById('kk-collect', 'nope')).toBeUndefined();
    });

    it('registers the ITC fixed artifacts with their state-machine producer keys (0254)', () => {
        expect(ITC_ARTIFACTS.map((spec) => spec.id)).toEqual([
            'outline-a',
            'outline-b',
            'outline-c',
            'outline-approved',
            'draft',
            'judge-verdict',
            'cover',
            'publish-plan',
            'report',
        ]);
        expect(artifactById('kk-itc', 'judge-verdict')?.producerActionKey).toBe('judge:onEnter:0');
        expect(artifactById('kk-itc', 'draft')?.pattern).toBe('3-draft-draft-article.md');
        expect(artifactById('kk-itc', 'nope')).toBeUndefined();
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

describe('daily episode-funnel artifacts (G82/0320)', () => {
    const byId = new Map(DAILY_VOICE_ARTIFACTS.map((spec) => [spec.id, spec]));
    it("pins the funnel specs to the workflow's fixed relative paths and DAG producers", () => {
        expect(byId.get('episode-pool')).toMatchObject({
            pattern: '10-collect/pool.json',
            producerNode: 'extract',
        });
        expect(byId.get('episode-annotated')).toMatchObject({
            pattern: '21-plan/{stamp}_04_quality-control-content_annotated.json',
            producerNode: 'qc-content',
        });
        expect(byId.get('episode-qc-rejections')).toMatchObject({
            pattern: '21-plan/{stamp}_04_quality-control-content_candidates.rejected.json',
            producerNode: 'qc-content',
        });
        expect(byId.get('episode-exclusions')).toMatchObject({
            pattern: '21-plan/{stamp}_04_quality-control-content_exclusions.json',
            producerNode: 'qc-content',
        });
        expect(byId.get('episode-candidates')).toMatchObject({
            pattern: '21-plan/{stamp}_04_quality-control-content_candidates.json',
            producerNode: 'qc-content',
        });
        expect(byId.get('episode-plan')).toMatchObject({
            pattern: '21-plan/{stamp}_03_plan_plan.json',
            producerNode: 'plan',
        });
        expect(byId.get('episode-floor-refusal')).toMatchObject({
            pattern: '21-plan/{stamp}_04_quality-control-content_floor-refusal.json',
            producerNode: 'qc-content',
        });
        expect(byId.get('episode-duration')).toMatchObject({
            pattern: '30-audio/{stamp}_11_generate_content_duration.json',
            producerNode: 'duration',
        });
    });

    it('shares one refusal file across three specs with distinct producer nodes', () => {
        const refusal = '30-audio/{stamp}_11_generate_content_duration-refusal.json';
        expect(byId.get('episode-duration-refusal')).toMatchObject({ pattern: refusal, producerNode: 'duration' });
        expect(byId.get('episode-script-refusal')).toMatchObject({ pattern: refusal, producerNode: 'generate' });
        expect(byId.get('episode-script-refusal-fallback')).toMatchObject({
            pattern: refusal,
            producerNode: 'generate-fallback',
        });
        expect(byId.get('episode-script-refusal-fallback2')).toMatchObject({
            pattern: refusal,
            producerNode: 'generate-fallback2',
        });
        // Every funnel spec is DAG-node identified: no state-machine action keys sneak in.
        for (const id of [
            'episode-pool',
            'episode-annotated',
            'episode-qc-rejections',
            'episode-exclusions',
            'episode-candidates',
            'episode-plan',
            'episode-floor-refusal',
            'episode-duration-refusal',
            'episode-script-refusal',
            'episode-script-refusal-fallback',
            'episode-script-refusal-fallback2',
            'episode-duration',
        ]) {
            expect(byId.get(id)?.producerActionKey, id).toBeUndefined();
        }
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

describe('confidence vocabulary', () => {
    it('recognizes exactly the three judge spellings and refuses everything else', () => {
        for (const level of CONFIDENCE_LEVELS) {
            expect(isConfidenceLevel(level)).toBe(true);
        }
        for (const other of ['high', 'CERTAIN', '', null, undefined, 0, 'HIGH '] as unknown[]) {
            expect(isConfidenceLevel(other)).toBe(false);
        }
    });
});
