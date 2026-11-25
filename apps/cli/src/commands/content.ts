import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { type Command, CommanderError } from 'commander';
import {
    type ContentTypeConfig,
    ContentTypeSkillMissingError,
    ContentTypeUnknownError,
    resolveContentType,
    resolveRun,
} from '../content-types';
import { runItcStage } from '../itc-stage';
import { consoleOutput } from '../output';
import { resolveConfigPath } from '../publish-core';
import { resolveBundlePath } from '../publish-matrix';
import { gatePayload, progressPayload } from '../status-progress';
import { registerContentGenerateVerbs } from './content-generate';
import { registerContentLaunchVerbs } from './content-launch';
import { registerContentPublishVerbs } from './content-publish';

interface NewOptions {
    type?: string;
    topic?: string;
    from?: string;
    slug?: string;
    runDate?: string;
    locale?: string;
    title?: string;
    tags?: string;
    description?: string;
    cover?: string;
    variant?: string[];
    workDir?: string;
}

interface StatusOptions {
    type?: string;
    slug?: string;
    runDate?: string;
    window?: string;
    workDir?: string;
}

/** Config fields needed by the shared content commands. */
export interface ContentConfigDocument extends ContentTypeConfig {
    works_dir?: unknown;
    /** User-override root for workflow YAMLs (design §1.1 R6, `04_DESIGN` §2). */
    workflows_dir?: unknown;
    /** Per-workflow settings (design §2: everything `content_types` does not answer). */
    workflows?: unknown;
}

const parseJson = JSON.parse.bind(JSON);
const parseYaml = Bun.YAML.parse.bind(Bun.YAML);

interface JsonObject {
    [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve the operator's active configuration file. */
export function configPath(): string {
    return resolveConfigPath(process.env, homedir());
}

/** Read the content configuration, using defaults when no file exists. */
export async function readConfig(
    path: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<ContentConfigDocument> {
    if (!(await fs.exists(path))) return {};
    try {
        const parsed: unknown = parseYaml(await fs.readFile(path));
        if (!isObject(parsed)) throw new Error('expected a YAML mapping');
        return parsed as ContentConfigDocument;
    } catch (error) {
        throw new Error(`cannot read config ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Expand a leading `~` or `$HOME` so a config path may be written either way. */
export function expandHome(value: string): string {
    if (value === '~') return homedir();
    if (value.startsWith('~/')) return join(homedir(), value.slice(2));
    if (value === '$HOME') return homedir();
    if (value.startsWith('$HOME/')) return join(homedir(), value.slice('$HOME/'.length));
    return value;
}

/** Resolve the works root relative to the configuration file. */
export function resolveWorksDir(config: ContentConfigDocument, path: string): string {
    const fromEnv = process.env.KK_WORKS_DIR;
    if (fromEnv !== undefined && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()));
    if (typeof config.works_dir === 'string' && config.works_dir.trim() !== '') {
        const configured = expandHome(config.works_dir.trim());
        return isAbsolute(configured) ? configured : resolve(dirname(path), configured);
    }
    return resolve(process.cwd(), '.works');
}

function fail(code: number, id: string, message: string): never {
    consoleOutput.error(message);
    throw new CommanderError(code, id, message);
}

function knownError(error: unknown, configFile: string): never {
    if (error instanceof ContentTypeUnknownError) fail(2, 'kk.content.unknown-type', error.message);
    if (error instanceof ContentTypeSkillMissingError) fail(5, 'kk.content.skill-missing', error.message);
    const message = error instanceof Error ? error.message : String(error);
    fail(2, 'kk.content.invalid-type', `invalid content type configuration in ${configFile}: ${message}`);
}

async function resolveType(type: string, config: ContentConfigDocument, configFile: string, preset?: string) {
    try {
        return await resolveContentType(type, config, { configPath: configFile, ...(preset ? { preset } : {}) });
    } catch (error) {
        return knownError(error, configFile);
    }
}

function validCalendarDate(value: string): boolean {
    if (!/^\d{8}$/.test(value)) return false;
    const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10).replaceAll('-', '') === value;
}

function parseTags(raw: string | undefined): string[] | undefined {
    if (raw === undefined) return undefined;
    return raw
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== '');
}

async function parseVariants(
    raw: string[] | undefined,
    command: string,
    fs: FileSystem,
): Promise<Record<string, string> | undefined> {
    if (raw === undefined || raw.length === 0) return undefined;
    const variants: Record<string, string> = {};
    for (const entry of raw) {
        const split = entry.indexOf('=');
        if (split < 1 || split === entry.length - 1) fail(2, command, `--variant must be <name=path>, got '${entry}'`);
        const name = entry.slice(0, split).trim();
        const path = entry.slice(split + 1).trim();
        if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(2, command, `invalid variant name '${name}'`);
        const absolutePath = resolve(expandHome(path));
        if (!(await fs.exists(absolutePath))) fail(2, command, `variant source not found: ${path}`);
        variants[name] = absolutePath;
    }
    return variants;
}

function requestValue(value: unknown): unknown {
    return value === undefined || value === '' ? undefined : value;
}

function requestObject(
    type: string,
    resolved: Awaited<ReturnType<typeof resolveContentType>>,
    run: ReturnType<typeof resolveRun>,
    options: NewOptions,
    locale: string,
    variants: Record<string, string> | undefined,
    workDir: string,
): JsonObject {
    return {
        schemaVersion: 1,
        type,
        workflow: resolved.workflow,
        run: run.run,
        workDir,
        ...(requestValue(options.slug) !== undefined ? { slug: options.slug } : {}),
        ...(requestValue(options.runDate) !== undefined ? { runDate: options.runDate } : {}),
        ...(requestValue(options.topic) !== undefined ? { topic: options.topic } : {}),
        ...(requestValue(options.from) !== undefined ? { from: resolve(expandHome(options.from as string)) } : {}),
        locale,
        ...(requestValue(options.title) !== undefined ? { title: options.title } : {}),
        ...(requestValue(options.tags) !== undefined ? { tags: parseTags(options.tags) } : {}),
        ...(requestValue(options.description) !== undefined ? { description: options.description } : {}),
        ...(requestValue(options.cover) !== undefined ? { cover: resolve(expandHome(options.cover as string)) } : {}),
        ...(variants !== undefined ? { variants } : {}),
    };
}

function splitMarkdown(
    markdown: string,
    fallbackTitle: string,
    titleOverride?: string,
): { title: string; body: string } {
    const lines = markdown.split('\n');
    const heading = lines.findIndex((line) => /^#\s+\S/.test(line));
    const title =
        titleOverride?.trim() || (heading >= 0 ? (lines[heading] ?? '').replace(/^#\s+/, '').trim() : fallbackTitle);
    const body = (heading >= 0 ? [...lines.slice(0, heading), ...lines.slice(heading + 1)] : lines).join('\n').trim();
    return { title, body };
}

async function writeSeededContent(
    fs: FileSystem,
    workDir: string,
    locale: string,
    markdown: string,
    options: NewOptions,
    coverDest?: string,
    variants?: Record<string, string>,
): Promise<void> {
    const contentDir = join(workDir, 'content', locale);
    await fs.ensureDir(contentDir);
    await fs.writeFile(join(contentDir, 'article.md'), markdown);
    await fs.writeFile(join(workDir, '3-draft-draft-article.md'), markdown);

    const fallbackTitle = options.slug?.replaceAll('-', ' ') ?? 'article';
    const article = splitMarkdown(markdown, fallbackTitle, options.title);
    if (article.body === '') fail(2, 'kk.content.new', `source file is empty: ${options.from ?? '(source)'}`);
    const metadata: JsonObject = {
        published: false,
        ...(parseTags(options.tags) !== undefined ? { tags: parseTags(options.tags) } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(coverDest !== undefined ? { coverImage: coverDest } : {}),
    };
    const content: JsonObject = {
        title: article.title,
        format: 'markdown',
        body: article.body,
        metadata,
    };
    const publishDir = join(workDir, '4-publish');
    await fs.ensureDir(publishDir);
    await fs.writeFile(join(publishDir, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);

    if (variants !== undefined) {
        for (const [name, sourcePath] of Object.entries(variants)) {
            const variantMd = await fs.readFile(sourcePath);
            const split = splitMarkdown(variantMd, article.title);
            if (split.body === '') fail(2, 'kk.content.new', `variant file is empty: ${sourcePath}`);
            const variantContent: JsonObject = {
                title: split.title,
                format: 'markdown',
                body: split.body,
                metadata,
            };
            await fs.writeFile(
                join(publishDir, `content.${name}.json`),
                `${JSON.stringify(variantContent, null, 2)}\n`,
            );
        }
    }
}

async function seedItcPreparation(
    fs: FileSystem,
    workDir: string,
    run: ReturnType<typeof resolveRun>,
    options: NewOptions,
    preset: string,
): Promise<void> {
    const launchPath = join(workDir, '.content-itc-prepare.json');
    // 0368: the frozen snapshot carries the content type's publish preset, so the generate steps plan
    // against exactly the channel set this run was created for (`itc-options.json` is the single
    // source every downstream stage reads, and the article freeze validates the bundle against it).
    const launch = {
        topic: options.slug ?? run.run,
        sourceLocale: options.locale ?? 'en',
        publishPreset: preset,
        workDir,
        projectRoot: process.cwd(),
        parentRunId: `kk-content-${run.run}`,
        ...(options.runDate !== undefined ? { runDate: options.runDate } : {}),
        force: true,
    };
    await fs.writeFile(launchPath, `${JSON.stringify(launch, null, 2)}\n`);
    const restore = setDefaultOutputTargets({ stdout: { write() {} }, stderr: { write() {} } });
    try {
        const code = await runItcStage(['itc-prepare', '--request', launchPath], fs);
        if (code !== 0) fail(1, 'kk.content.new', `itc-prepare failed for ${workDir}`);
    } finally {
        restore();
        if (await fs.exists(launchPath)) await fs.deleteFile(launchPath);
    }
}

async function newAction(defaultType: string, options: NewOptions, article: boolean): Promise<void> {
    const fs = createNodeFileSystem();
    const type = options.type ?? defaultType;
    const configFile = configPath();
    let config: ContentConfigDocument;
    try {
        config = await readConfig(configFile, fs);
    } catch (error) {
        fail(2, 'kk.content.config', error instanceof Error ? error.message : String(error));
    }
    const resolved = await resolveType(type, config, configFile);
    if ((options.topic === undefined) === (options.from === undefined)) {
        fail(2, 'kk.content.new', 'exactly one of --topic or --from is required');
    }
    if (article && (options.slug === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug))) {
        fail(2, 'kk.content.new', '--slug is required for article content and must be a lowercase slug');
    }
    if (options.runDate !== undefined && !validCalendarDate(options.runDate)) {
        fail(2, 'kk.content.new', '--run-date must be a real calendar date as YYYYMMDD');
    }
    const locale = options.locale ?? 'en';
    if (!['en', 'zh', 'ja'].includes(locale)) fail(2, 'kk.content.new', '--locale must be one of en|zh|ja');
    const worksDir = resolveWorksDir(config, configFile);
    const run = resolveRun({
        type,
        slug: options.slug,
        runDate: options.runDate,
        workDir: options.workDir === undefined ? undefined : resolve(expandHome(options.workDir)),
        worksDir,
        workflow: resolved.workflow,
        config,
    });
    const requestPath = join(run.workDir, 'request.json');
    if (await fs.exists(requestPath)) {
        consoleOutput.write(JSON.stringify({ workDir: run.workDir, run: run.run, type, created: false }));
        return;
    }
    const fromPath = options.from === undefined ? undefined : resolve(expandHome(options.from));
    if (fromPath !== undefined && !(await fs.exists(fromPath)))
        fail(2, 'kk.content.new', `source file not found: ${fromPath}`);
    const variants = await parseVariants(options.variant, 'kk.content.new', fs);
    if (options.cover !== undefined && !(await fs.exists(resolve(expandHome(options.cover))))) {
        fail(2, 'kk.content.new', `cover file not found: ${options.cover}`);
    }
    await fs.ensureDir(run.workDir);
    if (article) await seedItcPreparation(fs, run.workDir, run, options, resolved.publish_preset);
    let coverDest: string | undefined;
    if (options.cover !== undefined) {
        const coverPath = resolve(expandHome(options.cover));
        const coverDir = join(run.workDir, '4-illustrations');
        await fs.ensureDir(coverDir);
        coverDest = join(coverDir, `cover${extname(coverPath) || '.png'}`);
        await fs.copy(coverPath, coverDest);
    }
    if (fromPath !== undefined) {
        await writeSeededContent(fs, run.workDir, locale, await fs.readFile(fromPath), options, coverDest, variants);
    }
    const request = requestObject(type, resolved, run, options, locale, variants, run.workDir);
    await fs.writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    consoleOutput.write(JSON.stringify({ workDir: run.workDir, run: run.run, type, created: true }));
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

async function readJson(fs: FileSystem, path: string): Promise<JsonObject | null> {
    if (!(await fs.exists(path))) return null;
    try {
        const value: unknown = parseJson(await fs.readFile(path));
        return isObject(value) ? value : null;
    } catch {
        return null;
    }
}

/** How many variants a bundle summary advertises, or null when the map is not shaped like one. */
function variantCount(variants: unknown): number | null {
    if (Array.isArray(variants)) return variants.length;
    if (isObject(variants)) return Object.keys(variants).length;
    return null;
}

async function statusPayload(
    fs: FileSystem,
    workDir: string,
    type: string,
    selectedWindow?: string,
): Promise<JsonObject> {
    const receipt = await readJson(fs, join(workDir, 'schedule-receipt.json'));
    const generate =
        receipt === null
            ? null
            : {
                  status: optionalString(receipt.status),
                  runId: optionalString(receipt.runId),
                  executor: optionalString(receipt.executor),
                  checkoutCommit: optionalString(receipt.checkoutCommit),
              };
    // 0435: one bundle location rule for the whole CLI. `resolveBundlePath` prefers the run root
    // because the news freeze writes the bundle there (0382) and resolves every variant path
    // relative to it, so reading a hard-coded `4-publish/bundle.json` reported `bundle: null` for a
    // frozen, already-published news run — the status surface said "nothing shipped" exactly when
    // something had. A bundle resolved at the run root is frozen by construction: only the freeze
    // writes one there. The `4-publish/` article layout keeps the exact summary shape it had before
    // this change (R3), which is why the count is an addition to the root shape alone.
    const bundlePath = await resolveBundlePath(fs, workDir);
    const bundle = await readJson(fs, bundlePath);
    const atRunRoot = bundlePath === join(workDir, 'bundle.json');
    const bundleSummary =
        bundle === null
            ? null
            : {
                  frozen: typeof bundle.frozen === 'boolean' ? bundle.frozen : atRunRoot ? true : null,
                  runId: optionalString(bundle.runId),
                  variants: bundle.variants ?? null,
                  ...(atRunRoot ? { variantCount: variantCount(bundle.variants) } : {}),
              };
    const windows: JsonObject = {};
    const publishDir = join(workDir, '4-publish');
    if (await fs.exists(publishDir)) {
        for (const name of (await fs.readDir(publishDir))
            .filter((entry) => /^outcome\.[^.]+\.json$/.test(entry))
            .sort()) {
            const outcome = await readJson(fs, join(publishDir, name));
            if (outcome === null) continue;
            const window = optionalString(outcome.window) ?? name.slice('outcome.'.length, -'.json'.length);
            if (selectedWindow !== undefined && selectedWindow !== window) continue;
            windows[window] = {
                status: optionalString(outcome.status),
                published: outcome.published ?? null,
                targets: outcome.targets ?? null,
            };
        }
    }
    return {
        workDir,
        type,
        generate,
        // 0378 keeps every existing key's shape: `bundle` stays the summary or null, and the new
        // `progress` / `gate` keys answer the questions a caller used to re-derive from the logs.
        bundle: bundleSummary,
        windows: Object.keys(windows).length === 0 ? null : windows,
        progress: await progressPayload(fs, workDir),
        gate: await gatePayload(fs, workDir),
    };
}

async function statusAction(defaultType: string, options: StatusOptions): Promise<void> {
    const fs = createNodeFileSystem();
    const type = options.type ?? defaultType;
    const configFile = configPath();
    let config: ContentConfigDocument;
    try {
        config = await readConfig(configFile, fs);
    } catch (error) {
        fail(2, 'kk.content.config', error instanceof Error ? error.message : String(error));
    }
    const resolved = await resolveType(type, config, configFile);
    const worksDir = resolveWorksDir(config, configFile);
    const suppliedWorkDir = options.workDir === undefined ? undefined : resolve(expandHome(options.workDir));
    const slug = options.slug ?? (suppliedWorkDir === undefined ? undefined : basename(suppliedWorkDir));
    const runDate = options.runDate;
    if (runDate !== undefined && !validCalendarDate(runDate)) {
        fail(2, 'kk.content.status', '--run-date must be a real calendar date as YYYYMMDD');
    }
    const run = resolveRun({
        type,
        slug: type === 'news' ? 'run' : slug,
        runDate,
        workDir: suppliedWorkDir,
        worksDir,
        workflow: resolved.workflow,
        config,
    });
    const payload = await statusPayload(fs, run.workDir, type, options.window);
    consoleOutput.write(JSON.stringify(payload));
    if (!(await fs.exists(run.workDir)))
        fail(1, 'kk.content.status.missing', `content run directory does not exist: ${run.workDir}`);
}

function configureNew(command: Command, noun: string, defaultType: string): void {
    if (noun === 'article') command.option('--type <type>', 'content type', defaultType);
    command
        .option('--topic <text>', 'topic or brief text')
        .option('--from <file.md>', 'seed from Markdown')
        .option('--locale <locale>', 'source locale', 'en')
        .option('--title <title>', 'title override')
        .option('--tags <tags>', 'comma-separated tags')
        .option('--description <text>', 'description or excerpt')
        .option('--cover <path>', 'cover image path')
        .option(
            '--variant <name=path>',
            'additional locale variant',
            (value: string, prior: string[]) => [...prior, value],
            [],
        )
        .option('--work-dir <dir>', 'explicit run directory');
    if (noun === 'article') command.option('--slug <slug>', 'article run slug');
    else command.option('--run-date <YYYYMMDD>', 'news run date');
    command.action((options: NewOptions) => newAction(defaultType, options, noun === 'article'));
}

function configureStatus(command: Command, noun: string, defaultType: string): void {
    if (noun === 'article') {
        command.option('--type <type>', 'content type', defaultType).option('--slug <slug>', 'article run slug');
    } else {
        command.option('--run-date <YYYYMMDD>', 'news run date');
    }
    command.option('--work-dir <dir>', 'explicit run directory').option('--window <window>', 'publish window');
    command.action((options: StatusOptions) => statusAction(defaultType, options));
}

/**
 * Register the plain verbs (`new`, `status`, `generate`, `publish`) and the `publish-*` step verbs
 * for one content noun (design §1.1–1.2, ADR-053 §2).
 */
export function registerContentVerbs(program: Command, noun: string, defaultType: string): void {
    const group = program.command(noun).description(`${noun} content operations`);
    configureNew(group.command('new').description('create a content run request'), noun, defaultType);
    configureStatus(group.command('status').description('inspect a content run'), noun, defaultType);
    registerContentLaunchVerbs(group, noun, defaultType);
    registerContentPublishVerbs(group, defaultType);
    registerContentGenerateVerbs(group, noun, defaultType);
}

/** Command-module registration seam used by the CLI surface rule and host integrations. */
export function registerContentCommand(program: Command, noun: string, defaultType: string): void {
    registerContentVerbs(program, noun, defaultType);
}
