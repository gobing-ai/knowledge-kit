/**
 * Codegen: a recorded transcript in, a rail skeleton out (task 0382 R3/R4).
 *
 * The skeleton is a diffable draft, never a live rail: it names its source transcript, emits the
 * selector table and the ordered steps over the harness helpers, and derives its receipt from the
 * submit response the site actually returned. A receipt that compares rendered DOM text is the bug
 * this exists to prevent — measured 2026-11-16, the X rail reported "not published" for a post the
 * site had published, because the id was in the response the whole time.
 *
 * A step with no stable selector aborts the whole generation. Emitting a brittle selector would move
 * the guessing into the generated file, which is exactly where it must not survive.
 */
import type { BotTranscript, TranscriptStep } from './bot-record';

/** Options for {@link generateRail}. */
export interface CodegenOptions {
    /** Target plugin directory name under `plugins/publishings/`. */
    plugin: string;
    /** Operation slug; the exported runner is `run<Operation>`. */
    operation: string;
    /** Dot path of the publish id inside the receipt body; picked when omitted. */
    receiptPath?: string;
    /** Transcript path recorded in the header comment. */
    transcriptPath?: string;
}

/** Generated source plus anything the operator must finish by hand. */
export interface CodegenResult {
    source: string;
    warnings: string[];
}

/** Field names that carry a publish id or url, strongest first. */
const RECEIPT_FIELDS = ['rest_id', 'id', 'url'];

/** True for the fields a publish id is allowed to hide in (`id`, `*_id`, `rest_id`, `url`). */
function isReceiptField(name: string): boolean {
    return name === 'rest_id' || name === 'id' || name.endsWith('_id') || name === 'url';
}

/** Depth-first search for the first id/url string field; returns its dot path. */
function pickReceiptPath(value: unknown, prefix: string[] = []): string | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    const entries = Object.entries(value as Record<string, unknown>);
    const ranked = [...entries].sort(([a], [b]) => {
        const rank = (name: string) => {
            const index = RECEIPT_FIELDS.indexOf(name);
            return index === -1 ? RECEIPT_FIELDS.length : index;
        };
        return rank(a) - rank(b);
    });
    for (const [key, entry] of ranked) {
        if (typeof entry === 'string' && isReceiptField(key) && entry !== '') return [...prefix, key].join('.');
    }
    for (const [key, entry] of ranked) {
        const nested = pickReceiptPath(entry, [...prefix, key]);
        if (nested !== undefined) return nested;
    }
    return undefined;
}

type ResponseStep = Extract<TranscriptStep, { kind: 'response' }>;

const endpoint = (step: ResponseStep): string => `${step.method} ${new URL(step.url).pathname}`;

/**
 * The receipt response: the last mutating response after the last click whose endpoint the click
 * introduced. Live sites poll the same endpoints before and after the submit — x's HomeTimeline and
 * update_subscriptions land after CreateTweet, Threads' graphql/query carries other users' post ids
 * (2026-11-17) — and a matcher on a polled endpoint would fire on the first poll. Only when every
 * post-click endpoint was already polling does it fall back to the last response.
 */
function receiptResponse(transcript: BotTranscript): ResponseStep | undefined {
    // Step indexes, not array positions: a converted fixture may hold steps out of position order.
    const lastClick = transcript.steps.filter((step) => step.kind === 'click').at(-1)?.i ?? -1;
    const responses = transcript.steps.filter((step): step is ResponseStep => step.kind === 'response');
    const polled = new Set(responses.filter((step) => step.i < lastClick).map(endpoint));
    const after = responses.filter((step) => step.i > lastClick);
    return after.findLast((step) => !polled.has(endpoint(step))) ?? after.at(-1);
}

/** camelCase one operation slug for the exported runner name (`post-thread` → `PostThread`). */
function pascalCase(value: string): string {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter((part) => part !== '')
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join('');
}

/** The selector a step must resolve, or a generation-blocking reason. */
function stepSelector(step: TranscriptStep, index: number): string | { abort: string } {
    if (!('target' in step)) return { abort: `step ${index} carries no target` };
    if ('ambiguous' in step.target) {
        return { abort: `step ${index} is ambiguous (${step.target.candidates.join(' | ')}) — resolve it by hand` };
    }
    if (step.target.rank === 'path') {
        return { abort: `step ${index} has a structural-only selector (${step.target.selector}) — re-record it` };
    }
    return step.target.selector;
}

/** Render one recorded step as the harness call it replays as. */
function renderStep(step: TranscriptStep, key: string | undefined): string[] {
    // A response is where the receipt comes from, not a step the rail repeats.
    if (step.kind === 'response') return [];
    if (step.kind === 'navigate') return [`    await page.goto('${step.url}');`];
    const selector = key === undefined ? undefined : `SELECTORS.${key} as string`;
    const lines: string[] = [];
    if (selector !== undefined) lines.push(`    const ${key} = await resolveSelector(page, [${selector}]);`);
    switch (step.kind) {
        case 'click':
            lines.push(`    await page.click(${key as string});`);
            break;
        case 'key':
            lines.push(`    await page.keyboard.press('${step.key}');`);
            break;
        case 'type':
            lines.push(`    await page.click(${key as string});`);
            lines.push('    await page.keyboard.type(input.text);');
            break;
        case 'file':
            lines.push(`    await uploadFile(page, ${key as string}, input.filePath);`);
            break;
    }
    return lines;
}

/** `navigate`/`response` steps carry no selector, so they never take a table entry. */
function node(step: TranscriptStep): boolean {
    return step.kind === 'navigate' || step.kind === 'response';
}

/** Generate a rail skeleton from one transcript. Throws when a step cannot be expressed stably. */
export function generateRail(transcript: BotTranscript, options: CodegenOptions): CodegenResult {
    const warnings: string[] = [];
    const selectorLines: string[] = [];
    const bodyLines: string[] = [];
    const receipt = receiptResponse(transcript);
    const keys = new Map<number, string>();

    for (const step of transcript.steps) {
        if (node(step)) continue;
        const selector = stepSelector(step, step.i);
        if (typeof selector !== 'string') throw new Error(selector.abort);
        const key = `step${step.i}`;
        keys.set(step.i, key);
        selectorLines.push(`    ${key}: '${selector.replaceAll("'", "\\'")}',`);
    }

    if (receipt !== undefined) {
        const path = options.receiptPath ?? pickReceiptPath(receipt.body);
        const pathname = new URL(receipt.url).pathname;
        if (path === undefined) {
            warnings.push(
                `receipt: the ${receipt.method} ${pathname} response carries no id/url field — pass --receipt-path`,
            );
            bodyLines.push('    // TODO receipt: name the id path inside the captured response (see --receipt-path)');
        } else {
            bodyLines.push('    // receipt');
            bodyLines.push('    // Armed before the submit click: the response can land before the click returns.');
            bodyLines.push('    const pending = page.waitForResponse(');
            bodyLines.push(
                `        (candidate) => candidate.request().method() === '${receipt.method}' && new URL(candidate.url()).pathname === '${pathname}',`,
            );
            bodyLines.push('    );');
        }
        if (path !== undefined) bodyLines.push(`    const receiptPath = '${path}';`);
    } else {
        warnings.push('receipt: the transcript holds no mutating response after the submit click — emitting a TODO');
        bodyLines.push('    // TODO receipt: re-record the submit so codegen can emit a response matcher');
    }
    bodyLines.push('');

    for (const step of transcript.steps) {
        for (const line of renderStep(step, keys.get(step.i))) bodyLines.push(line);
    }

    const picksReceipt = receipt !== undefined && (options.receiptPath ?? pickReceiptPath(receipt.body)) !== undefined;
    if (picksReceipt) {
        bodyLines.push('');
        bodyLines.push('    // receipt');
        bodyLines.push('    const response = await pending;');
        bodyLines.push('    const evidence = pick(await response.json(), receiptPath);');
        bodyLines.push('    return expectOutcome(async () => evidence ?? null, {');
        bodyLines.push('        timeoutMs: 15000,');
        bodyLines.push(`        label: '${options.plugin} ${options.operation} receipt',`);
        bodyLines.push('    });');
    }

    const runner = pascalCase(options.operation);
    const source = [
        ...(options.transcriptPath === undefined ? [] : [`// transcript: ${options.transcriptPath}`]),
        '// generated by kk bot codegen — promote by hand; this file is a diffable draft, not a live rail',
        "import type { Page } from 'playwright';",
        // Only the helpers the body calls: an unused import fails noUnusedLocals once the draft is promoted.
        `import { ${['expectOutcome', 'resolveSelector', ...(bodyLines.some((line) => line.includes('uploadFile(')) ? ['uploadFile'] : [])].join(', ')} } from '@gobing-ai/publish-harness/browser';`,
        '',
        '/** Selectors measured from the recorded session, keyed by the transcript step they replay. */',
        'export const SELECTORS = {',
        ...selectorLines,
        '} as const;',
        '',
        '/** Read a dot path out of the captured response body. */',
        'function pick(body: unknown, path: string): string | undefined {',
        '    let cursor: unknown = body;',
        "    for (const key of path.split('.')) {",
        "        if (cursor === null || typeof cursor !== 'object') return undefined;",
        '        cursor = (cursor as Record<string, unknown>)[key];',
        '    }',
        "    return typeof cursor === 'string' ? cursor : undefined;",
        '}',
        '',
        `/** Replay the recorded ${options.operation} steps for ${options.plugin}. */`,
        `export async function run${runner}(`,
        '    page: Page,',
        '    input: { text: string; filePath: string },',
        '): ReturnType<typeof expectOutcome> {',
        ...bodyLines,
        '}',
        '',
    ].join('\n');

    return { source, warnings };
}
