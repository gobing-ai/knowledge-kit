export interface CapturedProcessOutput {
    stdout: string;
    stderr: string;
}

function createCapture(output: CapturedProcessOutput, key: 'stdout' | 'stderr') {
    return (chunk: string | Uint8Array): boolean => {
        output[key] += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
    };
}

/** Capture direct process.stdout/stderr writes without hiding them from the test's assertions. */
export function captureMain(run: () => number): { code: number } & CapturedProcessOutput {
    const output = { stdout: '', stderr: '' };
    const originalOut = process.stdout.write;
    const originalErr = process.stderr.write;
    process.stdout.write = createCapture(output, 'stdout') as typeof process.stdout.write;
    process.stderr.write = createCapture(output, 'stderr') as typeof process.stderr.write;
    try {
        return { code: run(), ...output };
    } finally {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
    }
}

/** Async counterpart to {@link captureMain} for async script entrypoints. */
export async function captureMainAsync(run: () => Promise<number>): Promise<{ code: number } & CapturedProcessOutput> {
    const output = { stdout: '', stderr: '' };
    const originalOut = process.stdout.write;
    const originalErr = process.stderr.write;
    process.stdout.write = createCapture(output, 'stdout') as typeof process.stdout.write;
    process.stderr.write = createCapture(output, 'stderr') as typeof process.stderr.write;
    try {
        return { code: await run(), ...output };
    } finally {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
    }
}

/** Force a spawned CLI into pipes while retaining its output for assertions and dots hygiene. */
export function captureSpawn(output: CapturedProcessOutput): typeof Bun.spawnSync {
    return ((command: string[], options: { stdout: 'pipe'; stderr: 'pipe' }) => {
        const result = Bun.spawnSync(command, { ...options, stdout: 'pipe', stderr: 'pipe' });
        output.stdout += new TextDecoder().decode(result.stdout);
        output.stderr += new TextDecoder().decode(result.stderr);
        return result;
    }) as typeof Bun.spawnSync;
}
