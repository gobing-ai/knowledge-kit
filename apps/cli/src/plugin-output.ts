import type { FileSystem } from '@gobing-ai/ts-runtime';

interface IssueLike {
    path: PropertyKey[];
    message: string;
}

interface SafeParser<T> {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: IssueLike[] } };
}

/** Render zod issues as `a.b: msg; root: msg` — the single format every executor error uses. */
export function formatIssues(error: { issues: ReadonlyArray<IssueLike> }): string {
    return error.issues.map((i) => `${i.path.map(String).join('.') || 'root'}: ${i.message}`).join('; ');
}

/**
 * Read a plugin's temp output as JSON and validate it.
 * @param label message prefix naming the producer, e.g. `Plugin 'x'`
 * @param violation phrase for schema failures, e.g. `wrote an invalid Result`
 * @throws Error naming `label` on invalid JSON or schema violation
 */
export async function readPluginJson<T>(
    fs: FileSystem,
    path: string,
    schema: SafeParser<T>,
    label: string,
    violation: string,
): Promise<T> {
    let json: unknown;
    try {
        json = JSON.parse(await fs.readFile(path));
    } catch (err: unknown) {
        throw new Error(`${label} wrote invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${label} ${violation}: ${formatIssues(parsed.error)}`);
    return parsed.data;
}
