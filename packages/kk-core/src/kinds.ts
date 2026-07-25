import { z } from 'zod';
import { ContentSchema, DocListSchema, ResultSchema } from './schemas';

/** Plugin lifecycle kinds supported by the kk platform. */
export const PLUGIN_KINDS = ['ingestion', 'generator', 'publish'] as const;

/** Zod schema for {@link PluginKind}. */
export const PluginKindSchema = z.enum(PLUGIN_KINDS);

/** One of the three plugin lifecycle kinds. */
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** Resolved I/O schemas for a plugin kind (data contract, not class methods). */
export interface KindContract {
    kind: PluginKind;
    /** Ingestion has no Doc input; source path is an invoke concern. */
    input: z.ZodType | null;
    output: z.ZodType;
}

const CONTRACTS: Record<PluginKind, KindContract> = {
    ingestion: { kind: 'ingestion', input: null, output: DocListSchema },
    generator: { kind: 'generator', input: DocListSchema, output: ContentSchema },
    publish: { kind: 'publish', input: ContentSchema, output: ResultSchema },
};

/**
 * Resolve the data contract for a plugin kind.
 * @throws {Error} when `kind` is not a known PluginKind
 */
export function kindContract(kind: string): KindContract {
    if (!isPluginKind(kind)) {
        throw new Error(`Unknown plugin kind: ${kind}`);
    }
    return CONTRACTS[kind];
}

/** Type guard for {@link PluginKind}. */
export function isPluginKind(value: string): value is PluginKind {
    return (PLUGIN_KINDS as readonly string[]).includes(value);
}
