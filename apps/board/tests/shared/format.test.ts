import { describe, expect, it } from 'bun:test';
import type { Availability } from '../../src/contracts';
import {
    availabilityLabel,
    availabilityTone,
    dedupeDiagnostics,
    diagnosticLine,
    formatBytes,
    formatElapsed,
    formatTimestamp,
} from '../../src/shared/format';

const VOCABULARY: Availability[] = [
    'available',
    'pending',
    'missing',
    'invalid',
    'oversized',
    'superseded',
    'unverified',
];

describe('availability formatting', () => {
    it('gives every availability its own label and tone (no two states collapse)', () => {
        const labels = VOCABULARY.map(availabilityLabel);
        expect(new Set(labels).size).toBe(VOCABULARY.length);
        expect(availabilityLabel('superseded')).toBe('Superseded by a later run');
        expect(availabilityTone('available')).toBe('ok');
        expect(availabilityTone('invalid')).toBe('error');
        expect(availabilityTone('missing')).toBe('warn');
    });
});

describe('bounded formatting', () => {
    it('states unknown instead of guessing a size or a time', () => {
        expect(formatBytes(undefined)).toBe('size unknown');
        expect(formatBytes(500)).toBe('500 B');
        expect(formatBytes(2048)).toBe('2 KiB');
        expect(formatElapsed(undefined, Date.now())).toBe('elapsed unknown');
        expect(formatTimestamp(null)).toBe('time unknown');
        expect(formatTimestamp('not-a-date')).toBe('time unknown');
    });

    it('renders elapsed time and a UTC detail', () => {
        expect(formatElapsed('2026-10-11T12:00:00Z', Date.parse('2026-10-11T12:00:30Z'))).toBe('30s');
        expect(formatTimestamp('2026-10-11T12:00:00Z')).toContain('2026-10-11T12:00:00.000Z');
    });

    it('renders a diagnostic as code: message', () => {
        expect(diagnosticLine({ code: 'board.x', message: 'bounded' })).toBe('board.x: bounded');
    });
});

describe('dedupeDiagnostics', () => {
    it('keeps one row per code so a flapping reader cannot grow duplicate keys', () => {
        const rows = dedupeDiagnostics([
            { code: 'board.reader.unavailable', message: 'first failure' },
            { code: 'board.reader.unavailable', message: 'second failure' },
            { code: 'board.marker.invalid', message: 'marker' },
        ]);
        expect(rows.map((row) => row.code)).toEqual(['board.reader.unavailable', 'board.marker.invalid']);
        // First occurrence wins: the earliest message is the informative one.
        expect(rows[0]?.message).toBe('first failure');
        expect(dedupeDiagnostics([])).toEqual([]);
    });
});
