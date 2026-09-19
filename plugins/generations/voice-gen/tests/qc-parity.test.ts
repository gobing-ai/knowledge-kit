import { describe, expect, it } from 'bun:test';
import parityVectors from '../../omni-voice-gen/tests/fixtures/qc-parity-vectors.json';
import { auditVoiceSegments, type VoiceboxClient, type VoiceScript } from '../src/index';

interface ParityVector {
    name: string;
    text: string;
    language: string;
    duration: number;
    transcription?: string;
    expectRepetitionDetected: boolean;
    expectFlagged: boolean;
}

// 0148 R9: omni-voice-gen qc.py is a port of this canonical battery. The shared golden
// vectors pin both implementations to identical repetition/corroboration outcomes.
describe('QC parity vectors (shared with omni-voice-gen qc.py)', () => {
    it('matches the shared repetition-battery contract', async () => {
        for (const v of parityVectors.vectors as ParityVector[]) {
            const script: VoiceScript = {
                title: v.name,
                language: v.language,
                segments: [{ text: v.text, gap_ms: 0 }],
            };
            const meta: Record<string, unknown> = { generationId: 'g1', profile: 'Robin', duration: v.duration };
            if (v.transcription !== undefined) meta.transcription = v.transcription;
            const neverClient = {
                transcribe: async () => {
                    throw new Error('transcription must come from metadata in parity vectors');
                },
            } as unknown as VoiceboxClient;

            const report = await auditVoiceSegments(script, [new Uint8Array(100)], [meta], neverClient);

            const audit = report.segmentAudits[0];
            expect(audit?.repetitionDetected).toBe(v.expectRepetitionDetected);
            const flagged = (audit?.issues ?? []).some((issue) => issue.includes('Repetition'));
            expect(flagged).toBe(v.expectFlagged);
        }
    });
});
