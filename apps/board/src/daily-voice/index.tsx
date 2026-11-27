import {
    Badge,
    type BadgeVariant,
    Button,
    Card,
    CardBody,
    Diagnostic,
    EmptyState,
    Loading,
    ModuleHeader,
    ModuleShell,
    ModuleTabs,
    withBase,
} from '@gobing-ai/spur/board/ui';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyDigest, DayArtifactDocument, DaySummary, Recipe, RunEvidence } from '../contracts';
import { type BoardClient, createBoardClient } from '../shared/api';
import { dedupeDiagnostics, formatTimestamp } from '../shared/format';
import {
    type AttentionRow,
    actionLogRows,
    actionPlaneEnabled,
    attentionRows,
    CONSOLE_TAB_LABELS,
    CONSOLE_TABS,
    type ConsoleTab,
    consoleHash,
    durationTrend,
    formatDuration,
    generationFacts,
    historyRange,
    historyRows,
    parseConsoleHash,
    recipeText,
    windowRows,
} from './day-view';
import { generationDetail, NODE_DIAGNOSTIC_CAP, provenanceWord, publishingDetail } from './detail-view';

/**
 * The day-centric Daily AI Voice console (G83, task 0440) at the module's existing route id.
 *
 * One day is one episode: the console reads `GET /api/days/<day>` (the same projection
 * `kk news digest` renders) and `GET /api/days?from&until` for History, and renders five tabs —
 * Today, Generation, Publishing, History, Actions log. The selected day lives in the URL hash so a
 * History click deep-links straight into Today.
 *
 * The retired run-centric Summary layout, the voice2 fallback panels and the G82 supply-context
 * panel are gone (feature R2): the console never lists runs, it lists days. Per-run drill-down for
 * the Generation and Publishing tabs arrives in 0441 on the existing per-run routes; the action
 * plane behind the Actions log tab arrives in 0442.
 */

/** The host route the module is mounted at — unchanged so existing bookmarks keep working. */
const MODULE_PATH = '/board/modules/kk-daily-ai-voice2';

/** The tab strip identity: buttons are `${…}-${id}`, panels `${…}-panel-${id}`. */
const CONSOLE_TABS_ID = 'daily-voice-console';

/** Kit badge variant for a recorded state tone. */
const TONE_BADGE: Record<string, BadgeVariant> = {
    info: 'info',
    success: 'success',
    warn: 'warning',
    error: 'error',
    neutral: 'neutral',
};

/** The installed host's contribution ABI (`@gobing-ai/spur/board/index.d.ts`, apiVersion 1). */
interface BoardContribution {
    readonly apiVersion: 1;
    readonly component: ComponentType;
}

/** The module's read state: the selected day, its digest and the History list. */
interface ConsoleState {
    loading: boolean;
    digest: DailyDigest | null;
    days: DaySummary[];
    error: string | null;
    searchedPath: string | null;
}

const INITIAL: ConsoleState = { loading: true, digest: null, days: [], error: null, searchedPath: null };

/** A fetch that never reached the reader reads as offline, not as missing data. */
function isOfflineError(message: string): boolean {
    return message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('ECONNREFUSED');
}

/** Today's headline strip: the day, its status word and where the reader last answered. */
function StatusBanner({
    digest,
    fetchedAt,
    onRefresh,
}: {
    digest: DailyDigest;
    fetchedAt: number | null;
    onRefresh: () => void;
}) {
    const facts = generationFacts(digest);
    const status = facts[0];
    return (
        <div className="kk-board-module-banner" data-testid="day-status">
            <Badge variant={TONE_BADGE[status?.tone ?? 'neutral']} size="md">
                {status?.value ?? 'unknown'}
            </Badge>
            <span className="kk-board-state">
                {digest.day} · {digest.attention.length} attention item(s) · read{' '}
                {formatTimestamp(fetchedAtIso(fetchedAt))}
            </span>
            <Button variant="ghost" size="xs" onClick={onRefresh}>
                Refresh
            </Button>
        </div>
    );
}

/** An epoch-ms reading as the ISO string the shared formatter takes; null stays null. */
function fetchedAtIso(fetchedAt: number | null): string | null {
    return fetchedAt === null ? null : new Date(fetchedAt).toISOString();
}

/** One recipe: the copyable command plus a copy button. Never rebuilt client-side. */
function RecipeLine({ argv, label, dryRun }: { argv: string[]; label: string; dryRun?: string[] }) {
    const [copied, setCopied] = useState(false);
    const text = recipeText(argv);
    return (
        <div className="kk-board-recipe">
            <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                    void navigator.clipboard?.writeText(text).then(() => {
                        setCopied(true);
                        globalThis.setTimeout(() => setCopied(false), 1500);
                    });
                }}
            >
                {copied ? 'copied' : 'copy'}
            </Button>
            <code data-testid="recipe-argv">{text}</code>
            {dryRun === undefined ? null : <span className="kk-board-state">dry run: {recipeText(dryRun)}</span>}
            <span className="kk-board-state">({label})</span>
        </div>
    );
}

/** The attention list, severity-ordered by the projection, each item with its recipes. */
function AttentionList({ rows }: { rows: AttentionRow[] }) {
    if (rows.length === 0) {
        return (
            <EmptyState testId="attention-all-clear">All clear — nothing on this day needs the operator.</EmptyState>
        );
    }
    return (
        <ul className="kk-board-attention" data-testid="attention-list">
            {rows.map((row) => (
                <li key={`${row.kind}:${row.subject}`} className={`kk-board-attention-${row.severity}`}>
                    <Badge variant={TONE_BADGE[row.tone]} size="sm">
                        {row.severity}
                    </Badge>
                    <strong>{row.kind}</strong> <span className="kk-board-state">({row.subject})</span>
                    <p>{row.message}</p>
                    {row.evidence === null ? null : (
                        <p className="kk-board-state">
                            evidence: <code>{row.evidence}</code>
                        </p>
                    )}
                    {row.recipes.length === 0 ? (
                        <p className="kk-board-state">no recipe — the evidence above names what is missing</p>
                    ) : (
                        <ul>
                            {row.recipes.map((recipe) => (
                                <li key={`${recipe.kind}:${recipe.argv.join(' ')}`}>
                                    <RecipeLine argv={recipe.argv} label={recipe.label} dryRun={recipe.dryRunArgv} />
                                </li>
                            ))}
                        </ul>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** The Today tab: status banner, generation card, window strip, safety line, attention list. */
function TodayPanel({
    digest,
    onRefresh,
    fetchedAt,
}: {
    digest: DailyDigest;
    onRefresh: () => void;
    fetchedAt: number | null;
}) {
    const facts = generationFacts(digest);
    const windows = windowRows(digest);
    const attention = attentionRows(digest);
    const diagnostics = dedupeDiagnostics(digest.diagnostics);
    return (
        <div data-testid="today-panel">
            <StatusBanner digest={digest} fetchedAt={fetchedAt} onRefresh={onRefresh} />
            <div className="kk-board-facts" data-testid="generation-card">
                {facts.map((fact) => (
                    <div key={fact.label} className="kk-board-fact">
                        <span className="kk-board-state">{fact.label}</span>
                        <Badge variant={TONE_BADGE[fact.tone] ?? 'neutral'} size="sm">
                            {fact.value}
                        </Badge>
                    </div>
                ))}
            </div>
            <h2>Publish windows</h2>
            <ul className="kk-board-windows" data-testid="window-strip">
                {windows.map((window) => (
                    <li key={window.window}>
                        <strong>{window.label}</strong>{' '}
                        <Badge variant={TONE_BADGE[window.tone] ?? 'neutral'} size="sm">
                            {window.launch}
                        </Badge>{' '}
                        <span className="kk-board-state">
                            outcome {window.recorded}
                            {window.unknownReason === null ? '' : ` — ${window.unknownReason}`}
                            {window.targets.length === 0 ? '' : ` · ${window.targets.length} target(s)`}
                        </span>
                        {window.targets.length === 0 ? null : (
                            <ul>
                                {window.targets.map((target) => (
                                    <li key={target.id}>
                                        {target.id} — {target.status} · effect {target.effect}
                                        {target.error === '' ? '' : ` — ${target.error}`}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
            <h2>Safety</h2>
            <p data-testid="safety-line">
                verdict {digest.safety.verdict ?? `unknown (${digest.safety.unknownReason ?? 'unrecorded'})`} · judge{' '}
                {digest.safety.judge ?? 'unknown'}
            </p>
            <h2>Attention</h2>
            <AttentionList rows={attention} />
            {diagnostics.length === 0 ? null : (
                <div className="kk-board-diagnostics">
                    {diagnostics.map((diagnostic) => (
                        <Diagnostic key={diagnostic.code} title={diagnostic.code} detail={diagnostic.message} />
                    ))}
                </div>
            )}
        </div>
    );
}

/** The Generation tab: the attempt picker plus one attempt's node-level evidence, on demand. */
function GenerationPanel({
    digest,
    client,
    recipes,
    onChanged,
}: {
    digest: DailyDigest;
    client: BoardClient;
    recipes: (subject: string) => Recipe[];
    /** One digest refetch after a confirmed write (G84/0445 R2). */
    onChanged: () => void;
}) {
    const attempts = useMemo(() => [...digest.generation.attempts].reverse(), [digest.generation.attempts]);
    const [selected, setSelected] = useState<string | null>(attempts[0]?.runId ?? null);
    const [evidence, setEvidence] = useState<RunEvidence | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (selected === null) return;
        let cancelled = false;
        setError(null);
        void client
            .evidence('kk-news-generate', selected)
            .then((next) => {
                if (!cancelled) setEvidence(next);
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setEvidence(null);
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [client, selected]);

    const detail = evidence === null ? null : generationDetail(evidence, digest);
    return (
        <div data-testid="generation-panel">
            <div className="kk-board-attempt-picker">
                <label htmlFor="daily-voice-attempt">attempt</label>
                <select
                    id="daily-voice-attempt"
                    value={selected ?? ''}
                    onChange={(event) => setSelected(event.target.value)}
                >
                    {attempts.length === 0 ? <option value="">no captured attempt</option> : null}
                    {attempts.map((attempt) => (
                        <option key={attempt.runId} value={attempt.runId}>
                            {attempt.runId} — {attempt.status ?? 'status unknown'}
                        </option>
                    ))}
                </select>
            </div>
            {error === null ? null : (
                <Diagnostic
                    title="The attempt evidence could not be read"
                    detail={error}
                    code="board.reader.unavailable"
                />
            )}
            {detail === null ? null : (
                <>
                    <p className="kk-board-state">
                        capture {detail.captureState} · availability {detail.availability}
                        {detail.unknownReason === null ? '' : ` · unknown (${detail.unknownReason})`}
                    </p>
                    <div className="kk-board-facts" data-testid="attempt-facts">
                        {detail.facts.map((fact) => (
                            <div key={fact.label} className="kk-board-fact">
                                <span className="kk-board-state">{fact.label}</span>
                                <span>{fact.value === '' ? 'unknown' : fact.value}</span>
                            </div>
                        ))}
                    </div>
                    <h2>Node timeline</h2>
                    {detail.timeline.length === 0 ? (
                        <EmptyState>No node was recorded for this attempt.</EmptyState>
                    ) : (
                        <table className="kk-board-timeline" data-testid="node-timeline">
                            <thead>
                                <tr>
                                    <th>node</th>
                                    <th>state</th>
                                    <th>attempts</th>
                                    <th>step duration</th>
                                    <th>recipe</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detail.timeline.map((node) => (
                                    <tr key={node.id}>
                                        <td>
                                            {node.label}
                                            {node.engine ? (
                                                <span className="kk-board-state"> (voice chain)</span>
                                            ) : null}
                                        </td>
                                        <td>
                                            <Badge variant={TONE_BADGE[node.tone] ?? 'neutral'} size="sm">
                                                {node.word}
                                            </Badge>
                                        </td>
                                        <td>{node.timing ?? 'timing unknown'}</td>
                                        <td>{formatDuration(node.durationMs)}</td>
                                        <td>
                                            {recipes(node.id).map((recipe) => (
                                                <RecipeLine
                                                    key={recipe.argv.join(' ')}
                                                    argv={recipe.argv}
                                                    label={recipe.label}
                                                    dryRun={recipe.dryRunArgv}
                                                />
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <h2>Engine chain</h2>
                    {detail.engines.length === 0 ? (
                        <EmptyState>No engine was recorded for this attempt.</EmptyState>
                    ) : (
                        <ul data-testid="engine-chain">
                            {detail.engines.map((engine) => (
                                <li key={engine.node}>
                                    {engine.label} — {engine.state} · {engine.attempts} attempt(s)
                                    {engine.lastTiming === null ? '' : ` · ${engine.lastTiming}`}
                                </li>
                            ))}
                        </ul>
                    )}
                    <h2>Artifacts</h2>
                    {detail.artifacts.length === 0 ? (
                        <EmptyState>This attempt recorded no artifact.</EmptyState>
                    ) : (
                        <ul data-testid="attempt-artifacts">
                            {detail.artifacts.map((artifact) => (
                                <li key={artifact.id}>
                                    {artifact.label} —{' '}
                                    {artifact.availability === 'available' ? (
                                        <a href={client.artifactUrl('kk-news-generate', detail.runId, artifact.id)}>
                                            available
                                        </a>
                                    ) : (
                                        <span className="kk-board-state">
                                            {artifact.availability}
                                            {artifact.reason === null ? '' : ` (${artifact.reason})`}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    <h2>Diagnostics</h2>
                    {detail.diagnostics.length === 0 ? (
                        <EmptyState>No diagnostic was recorded for this attempt.</EmptyState>
                    ) : (
                        <>
                            {detail.diagnostics.map((diagnostic) => (
                                <Diagnostic key={diagnostic.code} title={diagnostic.code} detail={diagnostic.message} />
                            ))}
                            {detail.diagnostics.length >= NODE_DIAGNOSTIC_CAP ? (
                                <p className="kk-board-state">
                                    truncated — the first {NODE_DIAGNOSTIC_CAP} diagnostics are shown.
                                </p>
                            ) : null}
                        </>
                    )}
                </>
            )}
            <ArtifactEditor
                day={digest.day}
                artifact="article"
                digest={digest}
                client={client}
                onChanged={() => onChanged()}
            />
            <ArtifactEditor
                day={digest.day}
                artifact="script"
                digest={digest}
                client={client}
                onChanged={() => onChanged()}
            />
        </div>
    );
}

/**
 * The Generation tab's draft editor (G84/0445 — design §10).
 *
 * Plain textarea plus the server-computed diff: no editor dependency, and the digest, the sha and the
 * argv all come from the reader, so the browser never invents a second source of truth. The one
 * client-side rule that matters is that `draft` is never derived from a refetch — that is what keeps
 * an operator's unsaved text across a conflict.
 */
function ArtifactEditor({
    day,
    artifact,
    digest,
    client,
    onChanged,
}: {
    day: string;
    artifact: 'article' | 'script';
    digest: DailyDigest;
    client: BoardClient;
    onChanged: () => void;
}) {
    const [document, setDocument] = useState<DayArtifactDocument | null>(null);
    const [draft, setDraft] = useState<string>('');
    const [preview, setPreview] = useState<{ token: string; diff: string; argv: string[] } | null>(null);
    const [banner, setBanner] = useState<{ tone: 'info' | 'error'; text: string; conflict: boolean } | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setBusy(true);
        try {
            const next = await client.dayArtifact(day, artifact);
            setDocument(next);
            setDraft((current) => (current === '' ? (next.text ?? '') : current));
            setPreview(null);
        } catch (cause) {
            setBanner({ tone: 'error', text: cause instanceof Error ? cause.message : String(cause), conflict: false });
        } finally {
            setBusy(false);
        }
    }, [artifact, client, day]);

    useEffect(() => {
        void load();
    }, [load]);

    if (document === null) {
        return (
            <div data-testid={`editor-${artifact}`}>
                <h2>{artifact === 'article' ? 'Article body' : 'Voice script'}</h2>
                <p className="kk-board-state">Loading the current draft…</p>
            </div>
        );
    }

    const params = { day, artifact, ...(document.sha256 === null ? {} : { baseSha: document.sha256 }) };
    const post = async (body: Record<string, unknown>): Promise<{ status: number; body: unknown }> =>
        client.action('edit-artifact', body);

    const ask = async (): Promise<void> => {
        setBusy(true);
        try {
            const answer = await post({ params, body: draft });
            const payload = (answer.body ?? {}) as Record<string, unknown>;
            if (answer.status !== 200) {
                setBanner({
                    tone: 'error',
                    text: String(payload.message ?? payload.code ?? answer.status),
                    conflict: answer.status === 409,
                });
                return;
            }
            setPreview({
                token: String(payload.token ?? ''),
                diff: String(payload.dryRun ?? ''),
                argv: Array.isArray(payload.argv) ? (payload.argv as string[]) : [],
            });
            setBanner(null);
        } finally {
            setBusy(false);
        }
    };

    const confirm = async (): Promise<void> => {
        if (preview === null) return;
        setBusy(true);
        try {
            const answer = await post({ params, body: draft, token: preview.token });
            const payload = (answer.body ?? {}) as Record<string, unknown>;
            if (answer.status !== 200) {
                setBanner({
                    tone: 'error',
                    text: String(payload.message ?? payload.code ?? answer.status),
                    conflict: answer.status === 409,
                });
                return;
            }
            setPreview(null);
            setBanner({ tone: 'info', text: 'saved — the day digest was refetched once', conflict: false });
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    const revert = async (): Promise<void> => {
        setBusy(true);
        try {
            const answer = await client.action('revert-artifact', { params: { day, artifact } });
            const payload = (answer.body ?? {}) as Record<string, unknown>;
            if (answer.status !== 200) {
                setBanner({
                    tone: 'error',
                    text: String(payload.message ?? payload.code ?? answer.status),
                    conflict: answer.status === 409,
                });
                return;
            }
            const token = String(payload.token ?? '');
            const applied = await client.action('revert-artifact', {
                params: { day, artifact },
                token,
            });
            if (applied.status !== 200) {
                const refusal = (applied.body ?? {}) as Record<string, unknown>;
                setBanner({
                    tone: 'error',
                    text: String(refusal.message ?? refusal.code ?? applied.status),
                    conflict: applied.status === 409,
                });
                return;
            }
            setPreview(null);
            setBanner({ tone: 'info', text: 'reverted — the day digest was refetched once', conflict: false });
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="kk-board-editor" data-testid={`editor-${artifact}`}>
            <h2>{artifact === 'article' ? 'Article body' : 'Voice script'}</h2>
            <p className="kk-board-state">
                {document.path} · {document.sha256 === null ? 'no bytes yet' : `sha ${document.sha256.slice(0, 12)}…`}
                {document.backup === null ? '' : ` · backup ${document.backup}`}
            </p>
            {document.editable ? (
                <>
                    <textarea
                        aria-label={`${artifact} draft`}
                        data-testid={`editor-${artifact}-draft`}
                        value={draft}
                        spellCheck={false}
                        rows={12}
                        onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="kk-board-editor-actions">
                        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void ask()}>
                            preview
                        </Button>
                        {preview === null ? null : (
                            <Button variant="primary" size="xs" disabled={busy} onClick={() => void confirm()}>
                                confirm
                            </Button>
                        )}
                        {document.revertRecipe === null ? null : (
                            <Button variant="ghost" size="xs" disabled={busy} onClick={() => void revert()}>
                                revert
                            </Button>
                        )}
                    </div>
                </>
            ) : (
                <p className="kk-board-state">
                    Actions are disabled — recipes only.{' '}
                    {document.recipe === null ? null : (
                        <code data-testid={`editor-${artifact}-recipe`}>{recipeText(document.recipe.argv)}</code>
                    )}
                </p>
            )}
            {banner === null ? null : (
                <div
                    data-testid={`editor-${artifact}-banner`}
                    className={`kk-board-state kk-board-banner-${banner.tone}`}
                >
                    {banner.text}
                    {banner.conflict ? (
                        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void load()}>
                            reload current bytes
                        </Button>
                    ) : null}
                </div>
            )}
            {preview === null ? null : (
                <pre data-testid={`editor-${artifact}-diff`} className="kk-board-diff">
                    {preview.diff}
                </pre>
            )}
            <StaleNotice digest={digest} artifact={artifact} />
        </div>
    );
}

/**
 * The re-armed gate, shown where the operator edited (G84/0445 R2).
 *
 * A confirmed write leaves the recorded safety verdict covering bytes that no longer exist, so the
 * digest refetch reports `safety.stale` and raises `artifact-edited` for this artifact. The steps are
 * rendered in the order that re-certifies the day — the operator should not have to derive it.
 */
function StaleNotice({ digest, artifact }: { digest: DailyDigest; artifact: 'article' | 'script' }) {
    const items = digest.attention.filter((item) => item.kind === 'artifact-edited' && item.subject === artifact);
    if (items.length === 0 && digest.safety.stale !== true) return null;
    return (
        <div data-testid={`editor-${artifact}-stale`} className="kk-board-state">
            <p>
                safety: <strong>{digest.safety.stale === true ? 'stale' : 'fresh'}</strong>
                {digest.safety.staleReason == null ? '' : ` — ${digest.safety.staleReason}`}
            </p>
            {items.map((item) => (
                <div key={`${item.kind}:${item.subject}`}>
                    <Badge variant={TONE_BADGE[item.severity === 'error' ? 'error' : 'warn']} size="sm">
                        {item.kind}
                    </Badge>{' '}
                    <span>{item.message}</span>
                    {item.recipes.map((recipe) => (
                        <RecipeLine key={recipe.argv.join(' ')} argv={recipe.argv} label={recipe.label} />
                    ))}
                </div>
            ))}
        </div>
    );
}

/** The Publishing tab: the window × target matrix with provenance, receipts rendered as text. */
function PublishingPanel({ digest, recipes }: { digest: DailyDigest; recipes: (subject: string) => Recipe[] }) {
    const windows = publishingDetail(digest);
    return (
        <div data-testid="publishing-panel">
            {windows.map((window) => (
                <Card key={window.window} variant="bordered">
                    <CardBody>
                        <h2>
                            {window.label}{' '}
                            <Badge variant={TONE_BADGE[window.tone] ?? 'neutral'} size="sm">
                                {window.launch}
                            </Badge>
                        </h2>
                        <p className="kk-board-state">
                            outcome {window.recorded}
                            {window.unknownReason === null ? '' : ` — unknown (${window.unknownReason})`}
                            {window.runId === null ? '' : ` · run ${window.runId}`}
                        </p>
                        <p className="kk-board-state" data-testid="window-provenance">
                            provenance:{' '}
                            {window.provenance.map((row) => `${row.label} ${provenanceWord(row.matched)}`).join(' · ')}
                        </p>
                        {window.rows.length === 0 ? (
                            <EmptyState>
                                {window.notRun
                                    ? 'This window recorded no plan and no launch receipt.'
                                    : 'This window planned no target.'}
                            </EmptyState>
                        ) : (
                            <table className="kk-board-matrix" data-testid="target-matrix">
                                <thead>
                                    <tr>
                                        <th>target</th>
                                        <th>tier</th>
                                        <th>mode</th>
                                        <th>status</th>
                                        <th>effect</th>
                                        <th>url</th>
                                        <th>error</th>
                                        <th>evidence</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {window.rows.map((row) => (
                                        <tr key={row.id}>
                                            <td>{row.id}</td>
                                            <td>{row.tier}</td>
                                            <td>{row.mode}</td>
                                            <td>
                                                <Badge variant={TONE_BADGE[row.tone] ?? 'neutral'} size="sm">
                                                    {row.status}
                                                </Badge>
                                            </td>
                                            <td>{row.effect}</td>
                                            <td>
                                                {row.url === null ? (
                                                    '—'
                                                ) : (
                                                    <a href={row.url} rel="noreferrer noopener" target="_blank">
                                                        {row.url}
                                                    </a>
                                                )}
                                            </td>
                                            <td>{row.error === '' ? '—' : row.error}</td>
                                            <td>
                                                <code>{row.evidence}</code>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                        {recipes(window.window).map((recipe) => (
                            <RecipeLine
                                key={recipe.argv.join(' ')}
                                argv={recipe.argv}
                                label={recipe.label}
                                dryRun={recipe.dryRunArgv}
                            />
                        ))}
                    </CardBody>
                </Card>
            ))}
            <p className="kk-board-state">
                Receipts and plans are text, never links. Only a public http(s) result URL becomes a link.
            </p>
        </div>
    );
}

/** The History tab: the day strip with per-node duration trend; a click opens that day in Today. */
function HistoryPanel({
    days,
    selected,
    onSelect,
}: {
    days: DaySummary[];
    selected: string | null;
    onSelect: (day: string) => void;
}) {
    const rows = historyRows(days);
    const trend = durationTrend(days);
    if (rows.length === 0) {
        return <EmptyState testId="history-empty">No recorded day in the selected range.</EmptyState>;
    }
    return (
        <div data-testid="history-panel">
            <table className="kk-board-history">
                <thead>
                    <tr>
                        <th>day</th>
                        <th>status</th>
                        <th>run</th>
                        <th>windows</th>
                        <th>generation time</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.day} className={row.day === selected ? 'kk-board-selected' : undefined}>
                            <td>
                                <Button variant="ghost" size="xs" onClick={() => onSelect(row.day)}>
                                    {row.day}
                                </Button>
                            </td>
                            <td>
                                <Badge variant={TONE_BADGE[row.tone] ?? 'neutral'} size="sm">
                                    {row.word}
                                </Badge>
                            </td>
                            <td>{row.runId ?? 'unknown'}</td>
                            <td>
                                {row.windows.length === 0
                                    ? 'none'
                                    : row.windows.map((window) => `${window.window}: ${window.launch}`).join(', ')}
                            </td>
                            <td>{formatDuration(row.totalMs)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <h2>Per-node duration trend</h2>
            <table className="kk-board-trend" data-testid="duration-trend">
                <thead>
                    <tr>
                        <th>step</th>
                        <th>latest</th>
                        <th>days</th>
                    </tr>
                </thead>
                <tbody>
                    {trend.map((series) => (
                        <tr key={series.step}>
                            <td>{series.step}</td>
                            <td>{formatDuration(series.latestMs)}</td>
                            <td>
                                {series.points.map((point) => `${point.day}: ${formatDuration(point.ms)}`).join(' · ')}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** One launch surface: preview (argv + dry run + token), then confirm, then the recorded line. */
function ActionLauncher({
    client,
    recipe,
    day,
    onLaunched,
}: {
    client: BoardClient;
    recipe: Recipe;
    day: string;
    onLaunched: () => void;
}) {
    const [preview, setPreview] = useState<{ token: string; dryRun: string | null; argv: string[] } | null>(null);
    const [confirm, setConfirm] = useState('');
    const [state, setState] = useState<string | null>(null);

    const post = async (body: Record<string, unknown>): Promise<void> => {
        const answer = await client.action(recipe.kind, body);
        const payload = (answer.body ?? {}) as Record<string, unknown>;
        if (answer.status !== 200 && answer.status !== 202) {
            setState(`refused: ${String(payload.code ?? answer.status)}`);
            return;
        }
        if (answer.status === 202) {
            setState('launched — see Actions log');
            onLaunched();
            return;
        }
        setPreview({
            token: String(payload.token ?? ''),
            dryRun: typeof payload.dryRun === 'string' ? payload.dryRun : null,
            argv: Array.isArray(payload.argv) ? (payload.argv as string[]) : [],
        });
        setState(null);
    };

    return (
        <div className="kk-board-action">
            {preview === null ? (
                <Button variant="ghost" size="xs" onClick={() => void post({ params: recipe.params })}>
                    preview
                </Button>
            ) : (
                <>
                    <code data-testid="action-preview-argv">{preview.argv.join(' ')}</code>
                    {preview.dryRun === null ? null : <pre className="kk-board-state">{preview.dryRun}</pre>}
                    {recipe.live ? (
                        <label>
                            type {day} to send live
                            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} />
                        </label>
                    ) : null}
                    <Button
                        variant="primary"
                        size="xs"
                        onClick={() =>
                            void post({
                                params: recipe.params,
                                token: preview.token,
                                ...(recipe.live ? { typedConfirm: confirm } : {}),
                            })
                        }
                    >
                        run
                    </Button>
                </>
            )}
            {state === null ? null : <span className="kk-board-state">{state}</span>}
        </div>
    );
}

/** The Actions log tab: the day's recorded lines, plus launch buttons when the plane is on. */
function ActionsPanel({
    digest,
    client,
    recipes,
    onLaunched,
}: {
    digest: DailyDigest;
    client: BoardClient;
    recipes: Recipe[];
    onLaunched: () => void;
}) {
    const rows = actionLogRows(digest);
    const enabled = actionPlaneEnabled(digest);
    return (
        <div data-testid="actions-panel">
            {enabled ? null : (
                <Diagnostic
                    title="Actions are disabled — recipes only"
                    detail="Set board.actions.enabled: true in ~/.config/kk/config.yaml, then restart the reader, to launch from here."
                    hint="Every launch is previewed, confirmed with a single-use token and audited; nothing is sent silently."
                />
            )}
            {recipes.length === 0 ? (
                <EmptyState>This day offered no recipe.</EmptyState>
            ) : (
                <ul data-testid="action-recipes">
                    {recipes.map((recipe) => (
                        <li key={`${recipe.kind}:${recipe.argv.join(' ')}`}>
                            <RecipeLine argv={recipe.argv} label={recipe.label} dryRun={recipe.dryRunArgv} />
                            {enabled ? (
                                <ActionLauncher
                                    client={client}
                                    recipe={recipe}
                                    day={digest.day}
                                    onLaunched={onLaunched}
                                />
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
            <h2>Recorded actions</h2>
            {rows.length === 0 ? (
                <EmptyState testId="actions-empty">No action was recorded for this day.</EmptyState>
            ) : (
                <table className="kk-board-action-log" data-testid="actions-log">
                    <thead>
                        <tr>
                            <th>when</th>
                            <th>kind</th>
                            <th>result</th>
                            <th>argv</th>
                            <th>run</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={`${row.ts}:${row.argv}`}>
                                <td>{formatTimestamp(row.ts)}</td>
                                <td>{row.kind}</td>
                                <td>
                                    <Badge variant={TONE_BADGE[row.tone] ?? 'neutral'} size="sm">
                                        {row.word}
                                    </Badge>
                                </td>
                                <td>
                                    <code>{row.argv}</code>
                                </td>
                                <td>{row.runId === null ? '—' : <code>{row.runId}</code>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

/** The mounted module: hash-driven day/tab state over the two day routes. */
export function DailyVoiceModule() {
    const clientRef = useRef<BoardClient | null>(null);
    const [location, setLocation] = useState(() => parseConsoleHash(globalThis.location?.hash ?? ''));
    const [state, setState] = useState<ConsoleState>(INITIAL);
    const [fetchedAt, setFetchedAt] = useState<number | null>(null);

    if (clientRef.current === null) {
        clientRef.current = createBoardClient({
            moduleId: 'kk-daily-ai-voice2',
            boardOrigin: window.location.origin,
            pathname: window.location.pathname,
        });
    }

    const load = useCallback(async () => {
        const client = clientRef.current;
        if (client === null) return;
        setState((prior) => ({ ...prior, loading: true, error: null }));
        const until = location.day ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const range = historyRange(until);
        try {
            const days = await client.days(range.from, range.until);
            const day = location.day ?? days[0]?.day ?? null;
            const digest = day === null ? null : await client.day(day);
            setFetchedAt(Date.now());
            setState({ loading: false, digest, days, error: null, searchedPath: day });
            if (location.day === null && day !== null) setLocation((prior) => ({ ...prior, day }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setState((prior) => ({
                loading: false,
                digest: null,
                days: prior.days,
                error: isOfflineError(message) ? 'The Board module API could not be reached.' : message,
                searchedPath: null,
            }));
        }
    }, [location.day]);

    useEffect(() => {
        void load();
    }, [load]);

    // The hash is the console's state: a History click rewrites it and the browser's own back
    // button then returns to the previous day/tab without any extra routing.
    useEffect(() => {
        const next = consoleHash(location.day, location.tab);
        if (globalThis.location !== undefined && globalThis.location.hash !== next) {
            globalThis.location.hash = next;
        }
    }, [location.day, location.tab]);

    // A row's action is the recipe the projection already resolved for that subject, so a clicked
    // command and a copied command are the same argv (design §5).
    const recipesFor = useCallback(
        (subject: string): Recipe[] =>
            state.digest === null
                ? []
                : state.digest.attention.filter((item) => item.subject === subject).flatMap((item) => item.recipes),
        [state.digest],
    );

    const setTab = (tab: ConsoleTab): void => setLocation((prior) => ({ ...prior, tab }));
    const setDay = (day: string): void => setLocation({ day, tab: 'today' });

    const header = (
        <ModuleHeader
            icon={<span aria-hidden="true">◉</span>}
            title="Daily AI Voice"
            subtitle="One day, one episode: generation, publish windows, safety and what needs you."
            status={
                state.digest === null ? null : (
                    <Badge variant={TONE_BADGE[generationFacts(state.digest)[0]?.tone ?? 'neutral']} size="sm">
                        {generationFacts(state.digest)[0]?.value ?? 'unknown'}
                    </Badge>
                )
            }
            filters={
                <div className="kk-board-day-picker">
                    <label htmlFor={`${CONSOLE_TABS_ID}-day`}>day</label>
                    <select
                        id={`${CONSOLE_TABS_ID}-day`}
                        value={location.day ?? ''}
                        onChange={(event) => setDay(event.target.value)}
                    >
                        {state.days.length === 0 && location.day !== null ? (
                            <option value={location.day}>{location.day}</option>
                        ) : null}
                        {state.days.map((day) => (
                            <option key={day.day} value={day.day}>
                                {day.day} — {day.status}
                            </option>
                        ))}
                    </select>
                    <Button variant="ghost" size="xs" onClick={() => void load()}>
                        Reload
                    </Button>
                </div>
            }
            tabs={
                <ModuleTabs
                    tabs={CONSOLE_TABS.map((id) => ({ id, label: CONSOLE_TAB_LABELS[id] }))}
                    value={location.tab}
                    onChange={(id) => setTab(id as ConsoleTab)}
                    label="Daily AI Voice views"
                    idPrefix={CONSOLE_TABS_ID}
                />
            }
        />
    );

    return (
        // `kk-board-daily-voice` is the module's host identity class (the Board's module list and
        // the installed-board E2E key on it), exactly like `kk-board-collect` / `kk-board-itc`.
        <div className="kk-board kk-board-daily-voice">
            <ModuleShell>
                {header}
                {state.error === null ? null : (
                    <Diagnostic
                        title="The day could not be read"
                        detail={state.error}
                        code={state.searchedPath === null ? undefined : `day ${state.searchedPath}`}
                        hint="A day with no directory answers 404 and names the path it looked up."
                    />
                )}
                {state.loading ? <Loading size="sm" /> : null}
                <div role="tabpanel" id={`${CONSOLE_TABS_ID}-panel-${location.tab}`}>
                    {state.digest === null ? (
                        state.loading ? null : (
                            <EmptyState testId="no-day">
                                No day is selected. Pick one from the day picker, or open History.
                            </EmptyState>
                        )
                    ) : location.tab === 'today' ? (
                        <TodayPanel digest={state.digest} onRefresh={() => void load()} fetchedAt={fetchedAt} />
                    ) : location.tab === 'generation' ? (
                        <GenerationPanel
                            digest={state.digest}
                            client={clientRef.current as BoardClient}
                            recipes={recipesFor}
                            onChanged={() => void load()}
                        />
                    ) : location.tab === 'publishing' ? (
                        <PublishingPanel digest={state.digest} recipes={recipesFor} />
                    ) : location.tab === 'history' ? (
                        <HistoryPanel days={state.days} selected={location.day} onSelect={setDay} />
                    ) : (
                        <ActionsPanel
                            digest={state.digest}
                            client={clientRef.current as BoardClient}
                            recipes={state.digest.attention.flatMap((item) => item.recipes)}
                            onLaunched={() => void load()}
                        />
                    )}
                </div>
                <p className="kk-board-state">
                    Day projection shared with <code>kk news digest</code> ·{' '}
                    <a href={withBase('/board/settings/workflows')}>Settings → Workflows</a>
                </p>
            </ModuleShell>
        </div>
    );
}

/** Entry the host mounts (`{ apiVersion: 1, component }`). */
export const webModule: BoardContribution = { apiVersion: 1, component: DailyVoiceModule };

/** The route id this module is registered at (kept for the host's route table and tests). */
export const modulePath = MODULE_PATH;
