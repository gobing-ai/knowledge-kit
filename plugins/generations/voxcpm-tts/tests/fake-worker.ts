/**
 * Real-framing NDJSON fake inference worker for the voxcpm-tts tests. Speaks the exact worker
 * protocol (`{id, op}` in, one JSON object per line out) with a fake model — no downloads, no uv.
 * The mode argument selects an error/cleanup scenario; `descendant` spawns an owned child and
 * stays alive after stdin EOF so the client's process-group teardown is what reaps it.
 */
const mode = process.argv[2] ?? 'ok';
const sampleRate = 48_000;

function wavBytes(seconds: number, channels = 1, bits = 16): Uint8Array {
    const samples = Math.max(0, Math.round(sampleRate * seconds));
    const bytesPerSample = bits / 8;
    const blockAlign = channels * bytesPerSample;
    const dataSize = samples * blockAlign;
    const buf = new Uint8Array(44 + dataSize);
    const view = new DataView(buf.buffer);
    const ascii = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bits, true);
    ascii(36, 'data');
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < samples; i++) {
        for (let c = 0; c < channels; c++) {
            const offset = 44 + (i * channels + c) * bytesPerSample;
            if (bits === 8) {
                buf[offset] = i % 2 ? 160 : 96; // 8-bit PCM is unsigned, centred on 128
            } else {
                view.setInt16(offset, i % 2 ? 3000 : -3000, true);
            }
        }
    }
    return buf;
}

function respond(payload: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function writeWav(dest: string | undefined, seconds = 1, channels = 1, bits = 16): void {
    if (dest) {
        Bun.write(dest, wavBytes(seconds, channels, bits));
    }
}

if (mode === 'crash') {
    process.exit(3);
}
if (mode === 'crash-stderr') {
    process.stderr.write('Traceback (most recent call last):\nRuntimeError: Metal OOM\n');
    process.exit(137);
}
if (mode === 'exit0') {
    process.exit(0);
}

if (mode === 'descendant') {
    const child = Bun.spawn(['sleep', '300'], { stdio: ['ignore', 'ignore', 'ignore'] });
    const pidFile = process.env.FAKE_CHILD_PID_FILE;
    if (pidFile) {
        await Bun.write(pidFile, String(child.pid));
    }
}

if (mode === 'stubborn') {
    // `trap '' TERM` sets an inherited SIG_IGN, so this descendant (and its `sleep`) survive a
    // group SIGTERM — the client must escalate to SIGKILL to reap the owned group.
    const child = Bun.spawn(['sh', '-c', 'trap "" TERM; sleep 300'], { stdio: ['ignore', 'ignore', 'ignore'] });
    const pidFile = process.env.FAKE_CHILD_PID_FILE;
    if (pidFile) {
        await Bun.write(pidFile, String(child.pid));
    }
}

const decoder = new TextDecoder();
let buffer = '';

for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        const request = JSON.parse(line) as { id: number; op: string; dest?: string };
        const dest = request.dest;
        if (mode === 'bad-json' && request.op === 'render') {
            process.stdout.write('not json at all\n');
        } else if (mode === 'oversize' && request.op === 'render') {
            process.stdout.write(`${'x'.repeat(1_100_000)}\n`);
        } else if (mode === 'oversize-no-newline' && request.op === 'render') {
            // No newline at all: the per-line cap in onLine never runs, so only a bound on the
            // in-progress buffer stops this. Keep streaming so the reader must react.
            for (let i = 0; i < 12; i++) {
                process.stdout.write('y'.repeat(100_000));
            }
        } else if (mode === 'wrong-id' && request.op === 'render') {
            respond({ id: request.id + 100, ok: true, wav_path: dest, duration: 1 });
        } else if (mode === 'hang' && request.op === 'render') {
            // deliberately never respond
        } else if (mode === 'health-error' && request.op === 'health') {
            respond({ id: request.id, ok: false, error: 'model load failed' });
        } else if (mode === 'render-error' && request.op === 'render') {
            writeWav(dest);
            respond({ id: request.id, ok: false, error: 'backend exploded' });
        } else if (mode === 'no-id' && request.op === 'render') {
            writeWav(dest);
            respond({ ok: true, wav_path: dest, duration: 1, sample_rate: sampleRate });
        } else if (mode === 'blank-line' && request.op === 'render') {
            process.stdout.write('\n');
            writeWav(dest);
            respond({ id: request.id, ok: true, wav_path: dest, duration: 1, sample_rate: sampleRate });
        } else if (mode === 'garbage-wav' && request.op === 'render') {
            if (dest) Bun.write(dest, 'this is not a RIFF/WAVE buffer at all');
            respond({ id: request.id, ok: true, wav_path: dest, duration: 1, sample_rate: sampleRate });
        } else if (mode === 'u8-wav' && request.op === 'render') {
            writeWav(dest, 1, 1, 8);
            respond({ id: request.id, ok: true, wav_path: dest, duration: 1, sample_rate: sampleRate });
        } else {
            writeWav(dest, mode === 'empty-wav' ? 0 : 1, mode === 'bad-wav' ? 2 : 1);
            respond({
                id: request.id,
                ok: true,
                duration: mode === 'empty-wav' ? 0 : 1,
                wav_path: dest,
                sample_rate: sampleRate,
                model: { path: '/fake/model', revision: 'fake-rev', package: '2.0.3' },
            });
        }
    }
}

if (mode === 'descendant' || mode === 'stubborn') {
    // Keep running after stdin EOF so the client's teardown (not the worker) reaps the tree.
    await new Promise(() => {});
}
