import { describe, expect, it } from 'bun:test';
import {
    auditVoiceSegments,
    computeExpectedDurationRange,
    detectRepetitions,
    type VoiceboxClient,
    type VoiceScript,
} from '../src/index';

describe('Voice Quality Control (QC)', () => {
    it('detectRepetitions accurately detects repetition loops and stuttering', () => {
        // Repeated single characters
        expect(detectRepetitions('酒酒酒酒酒酒酒')).toBe(true);
        expect(detectRepetitions('诶诶诶诶诶诶')).toBe(true);
        expect(detectRepetitions('啊啊啊啊啊')).toBe(true);

        // Repeated phrase loop (hallucination)
        expect(detectRepetitions('这种这种这种这种这种这种')).toBe(true);
        expect(detectRepetitions('我会帮您收拾到最新的节目我会帮您收拾到最新的节目我会帮您收拾到最新的节目')).toBe(
            true,
        );
        expect(detectRepetitions('一个阶段在这里的一个阶段在这里的一个阶段在这里')).toBe(true);

        // Normal clean sentences
        expect(detectRepetitions('大家好，欢迎收听今日AI快讯。')).toBe(false);
        expect(
            detectRepetitions(
                '首先来看第一条重点消息。Sora 2。OpenAI发布Sora应用，集成Sora 2模型，支持快速创作、分享和观看视频。',
            ),
        ).toBe(false);
        expect(detectRepetitions('short')).toBe(false);
    });

    it('computeExpectedDurationRange computes reasonable min and max boundaries', () => {
        const [zhMin, zhMax] = computeExpectedDurationRange('这是一条测试中文新闻动态，用于验证语速计算。', 'zh');
        expect(zhMin).toBeGreaterThan(1.0);
        expect(zhMax).toBeGreaterThan(zhMin);
        expect(zhMax).toBeLessThan(20.0);

        const [enMin, enMax] = computeExpectedDurationRange('Hello world, this is a test audio segment.', 'en');
        expect(enMin).toBeGreaterThan(1.0);
        expect(enMax).toBeGreaterThan(enMin);
    });

    it('auditVoiceSegments detects duration anomalies and repetition loops', async () => {
        const script: VoiceScript = {
            title: 'Test Script',
            language: 'zh',
            segments: [
                {
                    text: '正常短句播报。',
                    gap_ms: 300,
                },
                {
                    text: '这是一段很短的结尾致谢词语。',
                    gap_ms: 300,
                },
            ],
        };

        const segmentWavs = [new Uint8Array(100), new Uint8Array(100)];
        const segmentMetadata = [
            { generationId: 'g1', profile: 'Robin', duration: 3.5 }, // Normal
            { generationId: 'g2', profile: 'Robin', duration: 16.8 }, // Anomalously long (16.8s for 14 chars)
        ];

        let callCount = 0;
        const mockClient: Partial<VoiceboxClient> = {
            transcribe: async (_audio, _lang) => {
                callCount++;
                if (callCount === 1) {
                    return { text: '正常短句播报。' };
                }
                return { text: '这是一段很短的结尾致谢词语。酒酒酒酒酒酒酒酒酒' };
            },
        };

        const report = await auditVoiceSegments(script, segmentWavs, segmentMetadata, mockClient as VoiceboxClient);

        expect(report.passed).toBe(false);
        expect(report.overallScore).toBe(50); // 1 passed out of 2
        expect(report.criticalIssues.length).toBeGreaterThan(0);
        expect(report.criticalIssues[0]).toContain('Duration anomaly');
        expect(report.criticalIssues[0]).toContain('Repetition hallucination');
        expect(report.segmentAudits[0]?.passed).toBe(true);
        expect(report.segmentAudits[1]?.passed).toBe(false);
    });

    it('auditVoiceSegments passes cleanly when all segments are healthy', async () => {
        const script: VoiceScript = {
            title: 'Healthy Script',
            language: 'zh',
            segments: [
                { text: '大家好，欢迎收听今日快讯。', gap_ms: 400 },
                { text: '感谢您的收听，祝您拥有美好的一天。', gap_ms: 200 },
            ],
        };

        const segmentWavs = [new Uint8Array(100), new Uint8Array(100)];
        const segmentMetadata = [
            { generationId: 'g1', profile: 'Robin', duration: 3.2 },
            { generationId: 'g2', profile: 'Robin', duration: 4.1 },
        ];

        const mockClient: Partial<VoiceboxClient> = {
            transcribe: async (_audio, _lang) => {
                return { text: '大家好，欢迎收听今日快讯。' };
            },
        };

        const report = await auditVoiceSegments(script, segmentWavs, segmentMetadata, mockClient as VoiceboxClient);

        expect(report.passed).toBe(true);
        expect(report.overallScore).toBe(100);
        expect(report.criticalIssues.length).toBe(0);
    });
});
