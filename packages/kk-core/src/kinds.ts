import { z } from 'zod';
import { ContentSchema, DocListSchema, ResultSchema } from './schemas';

/** Plugin lifecycle kinds supported by the kk platform. */
export const PLUGIN_KINDS = ['ingestion', 'generator', 'publish'] as const;

/** Zod schema for {@link PluginKind}. */
export const PluginKindSchema = z.enum(PLUGIN_KINDS);

/** One of the three plugin lifecycle kinds. */
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/**
 * Kind-collection directory names under `plugins/` (ADR-009).
 * Folder names are the plural collection labels, not the `kind` enum values.
 */
export const PLUGIN_KIND_COLLECTIONS = {
    ingestion: 'ingestions',
    generator: 'generations',
    publish: 'publishings',
} as const satisfies Record<PluginKind, string>;

/** Reverse map: collection directory name → plugin kind. */
export const PLUGIN_COLLECTION_KINDS = {
    ingestions: 'ingestion',
    generations: 'generator',
    publishings: 'publish',
} as const;

/** Claude Code capability collection — never a kk-core registry plugin (ADR-009). */
export const KK_CAPABILITY_COLLECTION = 'kk';

/** Directory name of a kind collection (`ingestions` / `generations` / `publishings`). */
export type PluginKindCollection = (typeof PLUGIN_KIND_COLLECTIONS)[PluginKind];

/** Collection directory for a plugin kind. */
export function collectionForKind(kind: PluginKind): PluginKindCollection {
    return PLUGIN_KIND_COLLECTIONS[kind];
}

/**
 * Plugin kind for a collection directory name, or `undefined` if it is not a kind collection.
 * Own-key check (0155 R1): `in` would walk `Object.prototype`, so a plugins-root directory
 * named `constructor` / `toString` / `__proto__` would be misread as a kind collection.
 */
export function kindForCollection(name: string): PluginKind | undefined {
    return Object.hasOwn(PLUGIN_COLLECTION_KINDS, name)
        ? PLUGIN_COLLECTION_KINDS[name as PluginKindCollection]
        : undefined;
}

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
    // 0110 I3: publish input is the ordinary Content object again. The bare episode-plan
    // Doc[] show-notes form (0095) is reachable only through a manifest-declared auxiliary
    // operation (see `operations` in PluginManifestSchema, honored by invoke.ts). With the
    // kind-level union (0100) every publish plugin accepted arbitrary arrays and its output
    // bypassed Result validation — the executor cannot know an undeclared form is safe.
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
