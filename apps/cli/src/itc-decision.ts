import { dirname } from 'node:path';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { z } from 'zod';

export const ItcDecisionCandidateSchema = z
    .object({
        id: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export type ItcDecisionCandidate = z.infer<typeof ItcDecisionCandidateSchema>;

export const ItcDecisionRequestSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        parentRunId: z.string().min(1),
        decisionId: z.enum(['kk-itc-topic-choice', 'kk-itc-outline-choice', 'kk-itc-preset-choice']),
        candidateDigest: z.string().min(1),
        candidates: z.array(ItcDecisionCandidateSchema).min(1),
        evidenceFiles: z.array(z.string()).default([]),
        outPath: z.string().min(1),
        maker: z.string().optional(),
        explicitChoice: z.string().optional(),
    })
    .strict();

export type ItcDecisionRequest = z.input<typeof ItcDecisionRequestSchema>;

export interface ItcDecisionResult {
    schemaVersion: 1;
    parentRunId: string;
    decisionId: string;
    candidateDigest: string;
    value: string;
    source: 'model' | 'default' | 'explicit';
    reason: string;
    maker: string;
    selected: boolean;
    confidence?: number | null;
}

interface CompactEvidence {
    file: string;
    originalLength: number;
    retainedLength: number;
    truncated: boolean;
    content: string;
}

/**
 * Compact evidence file content to <=1800 UTF-16 units per file with explicit length flags.
 */
async function compactEvidenceFile(fs: FileSystem, filePath: string): Promise<CompactEvidence | undefined> {
    if (!(await fs.exists(filePath))) return undefined;
    try {
        const text = await fs.readFile(filePath);
        const originalLength = text.length;
        const truncated = originalLength > 1800;
        const content = text.slice(0, 1800);
        return {
            file: filePath,
            originalLength,
            retainedLength: content.length,
            truncated,
            content,
        };
    } catch {
        return undefined;
    }
}

/**
 * Native substantive handler for itc-decision.
 * Evaluates semantic decisions against candidates and writes the served outcome.
 */
export async function itcDecision(
    request: ItcDecisionRequest,
    fs: FileSystem = createNodeFileSystem(),
    executor: ProcessExecutor = new NodeProcessExecutor(),
): Promise<ItcDecisionResult> {
    const fallback = request.decisionId === 'kk-itc-preset-choice' ? 'none' : 'defer';
    const validCandidateIds = new Set(request.candidates.map((c) => c.id));

    // Allowed output values
    const allowedValues = new Set<string>();
    if (request.decisionId === 'kk-itc-preset-choice') {
        allowedValues.add('suggested');
        allowedValues.add('none');
    } else {
        for (const id of validCandidateIds) {
            allowedValues.add(id);
        }
        allowedValues.add('defer');
    }

    await fs.ensureDir(dirname(request.outPath));

    // Handle explicit operator choice bypass
    if (request.explicitChoice !== undefined) {
        const choice = request.explicitChoice.trim();
        const isValid = allowedValues.has(choice);
        const selectedValue = isValid ? choice : fallback;
        const result: ItcDecisionResult = {
            schemaVersion: 1,
            parentRunId: request.parentRunId,
            decisionId: request.decisionId,
            candidateDigest: request.candidateDigest,
            value: selectedValue,
            source: isValid ? 'explicit' : 'default',
            reason: isValid
                ? 'explicit operator choice'
                : `explicit choice '${choice}' was not allowed; fell back to '${fallback}'`,
            maker: 'operator',
            selected: selectedValue !== fallback,
        };
        await fs.writeFile(request.outPath, `${JSON.stringify(result, null, 2)}\n`);
        return result;
    }

    // Compact evidence files into temporary files
    const tmpEvidenceFiles: string[] = [];
    const evidenceArgs: string[] = [];
    const evidenceFiles = request.evidenceFiles ?? [];
    for (const [index, ef] of evidenceFiles.entries()) {
        const compacted = await compactEvidenceFile(fs, ef);
        if (compacted) {
            const tmpPath = `${request.outPath}.evidence-${index}.json`;
            await fs.writeFile(tmpPath, JSON.stringify(compacted));
            tmpEvidenceFiles.push(tmpPath);
            evidenceArgs.push('--evidence', tmpPath);
        }
    }

    // Format param for catalog
    let paramKey = 'candidates';
    if (request.decisionId === 'kk-itc-outline-choice') paramKey = 'options';
    if (request.decisionId === 'kk-itc-preset-choice') paramKey = 'suggestion';

    const paramValue = request.candidates.map((c) => `${c.id}: ${c.title ?? c.description ?? c.id}`).join('; ');

    const spurBin = process.env.SPUR_BIN || 'spur';
    const argv = [
        'decision',
        'run',
        request.decisionId,
        '--param',
        `${paramKey}=${paramValue}`,
        ...evidenceArgs,
        ...(request.maker ? ['--maker', request.maker] : []),
        '--json',
    ];

    let resultValue = fallback;
    let resultSource: 'model' | 'default' = 'default';
    let resultReason = 'decision run invocation failed';
    let resultMaker = 'catalog-fallback';
    let resultConfidence: number | null = null;

    try {
        const res = await executor.run({
            command: spurBin,
            args: argv,
            env: process.env as Record<string, string>,
            timeout: 30_000,
        });
        const stdout = typeof res.stdout === 'string' ? res.stdout : '';
        const stderr = typeof res.stderr === 'string' ? res.stderr : '';

        if (res.exitCode === 0 && stdout !== '') {
            try {
                const parsed = JSON.parse(stdout) as {
                    value?: unknown;
                    source?: unknown;
                    reason?: unknown;
                    maker?: unknown;
                    confidence?: unknown;
                };
                const val = typeof parsed.value === 'string' ? parsed.value.trim() : String(parsed.value ?? '');
                if (allowedValues.has(val)) {
                    resultValue = val;
                    resultSource = parsed.source === 'default' ? 'default' : 'model';
                    resultReason = typeof parsed.reason === 'string' ? parsed.reason : 'model decision';
                    resultMaker = typeof parsed.maker === 'string' ? parsed.maker : 'model';
                    resultConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : null;
                } else {
                    resultValue = fallback;
                    resultSource = 'default';
                    resultReason = `model output "${val}" is not among valid candidates [${[...validCandidateIds].join(', ')}]`;
                    resultMaker = typeof parsed.maker === 'string' ? parsed.maker : 'catalog-fallback';
                }
            } catch (jsonErr: unknown) {
                resultReason = `failed to parse decision json: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`;
            }
        } else {
            resultReason = `spur decision run exited with code ${res.exitCode ?? 1}: ${stderr.trim() || 'unknown error'}`;
        }
    } catch (spawnErr: unknown) {
        resultReason = `failed to spawn spur decision run: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`;
    } finally {
        for (const tf of tmpEvidenceFiles) {
            try {
                await fs.deleteFile(tf);
            } catch {
                // ignore cleanup errors
            }
        }
    }

    const decisionResult: ItcDecisionResult = {
        schemaVersion: 1,
        parentRunId: request.parentRunId,
        decisionId: request.decisionId,
        candidateDigest: request.candidateDigest,
        value: resultValue,
        source: resultSource,
        reason: resultReason,
        maker: resultMaker,
        selected: resultValue !== fallback,
        ...(resultConfidence !== null ? { confidence: resultConfidence } : {}),
    };

    await fs.writeFile(request.outPath, `${JSON.stringify(decisionResult, null, 2)}\n`);
    return decisionResult;
}
