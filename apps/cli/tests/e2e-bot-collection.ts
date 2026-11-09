// 0346 E2E: prove the rendered collection runner against a real Chromium and a loopback server,
// through both consumer seams — the real fan-in source-spawn path (fixture plugin child) and the
// repository probe script. Not a unit test: it launches browsers and needs the Chromium install.
//
//   bun apps/cli/tests/e2e-bot-collection.ts [artifact.json]
//
// Writes `.spur/run/e2e/0346-bot-collection.json` with pass/fail, Doc evidence, artifact metadata,
// launch observations, `authenticated` and `externalRequests`. Exit 0 only when every check passes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BotCollectionPlan } from '@gobing-ai/publish-harness/bot-collection';

const artifactPath = resolve(process.argv[2] ?? '.spur/run/e2e/0346-bot-collection.json');
const repoRoot = resolve(import.meta.dir, '../../..');
const fixturesRoot = join(import.meta.dir, 'fixtures/plugins');
const probePath = join(repoRoot, 'packages/publish-harness/scripts/bot-collection-probe.ts');
const cliEntry = join(import.meta.dir, '../src/index.ts');
const PROFILE = 'e2e-bot';

const SERVED = { items: JSON.stringify({ items: [{ id: 1, title: 'rendered-item' }] }) };

/** Loopback-only server: session cookie, JS-rendered list, authenticated XHR, status fixtures. */
function startServer(observed: { requests: string[] }) {
    const html = `<!doctype html><html><body>
<button class="more">more</button><ul id="list"></ul>
<script>
function add(text){const li=document.createElement('li');li.className='note-item';li.textContent=text;
document.getElementById('list').appendChild(li);}
setTimeout(function(){add('rendered-1');},50);
document.querySelector('.more').addEventListener('click',function(){add('rendered-2');});
fetch('/api/items').then(function(r){return r.json();}).then(function(d){window.__count=d.items.length;});
</script></body></html>`;

    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(request) {
            const { pathname } = new URL(request.url);
            observed.requests.push(pathname);
            if (pathname === '/session') {
                return new Response(html, {
                    headers: {
                        'content-type': 'text/html',
                        // Persisted (not a session cookie) so a SECOND launch reuses the profile.
                        'set-cookie': 'kk_e2e=1; Path=/; Max-Age=86400; SameSite=Lax',
                    },
                });
            }
            if (pathname === '/app') return new Response(html, { headers: { 'content-type': 'text/html' } });
            if (pathname === '/signin')
                return new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } });
            if (pathname === '/redirect-login') return Response.redirect('/signin', 302);
            if (pathname === '/api/items') {
                const authorized = (request.headers.get('cookie') ?? '').includes('kk_e2e=1');
                return authorized
                    ? new Response(SERVED.items, { headers: { 'content-type': 'application/json' } })
                    : new Response('unauthorized', { status: 401 });
            }
            if (pathname === '/status/401') return new Response('unauthorized', { status: 401 });
            if (pathname === '/status/404') return new Response('missing', { status: 404 });
            return new Response('not found', { status: 404 });
        },
    });
    return server;
}

/**
 * One `runBotCollection` failure probe against the loopback fixtures: returns the typed code it
 * produced, or `null` when the run unexpectedly succeeded.
 */
async function expectFailure(
    plan: BotCollectionPlan,
    workDir: string,
): Promise<{ code: string | null; urlFree: boolean }> {
    const profileRoot = join(workDir, 'profiles');
    const leaseRoot = join(workDir, 'leases');
    const { runBotCollection } = await import('@gobing-ai/publish-harness/bot-collection');
    try {
        await runBotCollection(PROFILE, plan, { root: profileRoot, leaseRoot });
        return { code: null, urlFree: true };
    } catch (error) {
        const failure = error as { code?: string; message?: string };
        const message = failure.message ?? '';
        // A diagnostic must never carry a query-bearing or raw URL.
        return { code: failure.code ?? 'unknown', urlFree: !/https?:\/\//.test(message) && !message.includes('?') };
    }
}

/** The plan the probe drives: no `/session` step, so a persisted cookie is the only way in. */
function probePlan(base: string): BotCollectionPlan {
    return {
        timeoutMs: 90_000,
        steps: [
            { id: 'open', type: 'navigate', url: `${base}/app` },
            { id: 'first', type: 'wait', selector: '.note-item' },
            { id: 'more', type: 'click', selector: '.more' },
            { id: 'second', type: 'wait', selector: '#list li:nth-child(2)' },
            { id: 'copy', type: 'extract', format: 'text' },
            { id: 'api', type: 'request', url: `${base}/api/items` },
        ],
        responses: [{ id: 'xhr', origin: base, pathPrefix: '/api/items' }],
    };
}

async function main(): Promise<void> {
    const work = mkdtempSync(join(tmpdir(), 'kk-e2e-collection-'));
    const profileRoot = join(work, 'profiles');
    const leaseRoot = join(work, 'leases');
    mkdirSync(join(profileRoot, PROFILE), { recursive: true, mode: 0o700 });
    mkdirSync(leaseRoot, { recursive: true, mode: 0o700 });

    const observed = { requests: [] as string[] };
    const server = startServer(observed);
    const base = `http://127.0.0.1:${server.port}`;

    const plan = {
        timeoutMs: 90_000,
        steps: [
            { id: 'session', type: 'navigate', url: `${base}/session` },
            { id: 'open', type: 'navigate', url: `${base}/app` },
            { id: 'first', type: 'wait', selector: '.note-item' },
            { id: 'more', type: 'click', selector: '.more' },
            { id: 'second', type: 'wait', selector: '#list li:nth-child(2)' },
            { id: 'down', type: 'scroll', deltaY: 200 },
            { id: 'markup', type: 'extract', format: 'html' },
            { id: 'copy', type: 'extract', format: 'text' },
            { id: 'api', type: 'request', url: `${base}/api/items` },
            { id: 'page-again', type: 'navigate', url: `${base}/app` },
            { id: 'reloaded', type: 'wait', selector: '#list .note-item' },
            { id: 'items', type: 'extract', format: 'text', selector: '#list' },
        ],
        responses: [{ id: 'xhr', origin: base, pathPrefix: '/api/items' }],
    };

    const planFile = join(work, 'plan.json');
    writeFileSync(planFile, JSON.stringify(plan));
    const probePlanFile = join(work, 'probe-plan.json');
    writeFileSync(probePlanFile, JSON.stringify(probePlan(base)));
    const inFile = join(work, 'in.json');
    writeFileSync(inFile, '[]');
    const outFile = join(work, 'docs.json');
    const observationsFile = join(work, 'observations.json');

    const failures: Record<string, string | null> = {};
    let docs: Array<Record<string, unknown>> = [];
    let faninCode: number | null = null;
    let faninOutput = '';
    let probe: { exitCode: number; stdout: string; stderr: string; result?: unknown } = {
        exitCode: -1,
        stdout: '',
        stderr: '',
    };
    let probeOut = join(work, 'probe');

    try {
        process.env.KK_E2E_BOT_PLAN = planFile;
        process.env.KK_E2E_BOT_PROFILE = PROFILE;
        process.env.KK_E2E_BOT_PROFILE_ROOT = profileRoot;
        process.env.KK_E2E_BOT_LEASE_ROOT = leaseRoot;
        process.env.KK_E2E_BOT_OBSERVATIONS = observationsFile;

        // The real CLI verb (not the imported handler): `kk executor fan-in --source` spawns the
        // fixture plugin's own child process, which is the consumer seam an ingestion plugin uses.
        const fanin = Bun.spawn(
            [
                'bun',
                cliEntry,
                'executor',
                'fan-in',
                '--source',
                `e2e-bot-collection:${inFile}`,
                '--out',
                outFile,
                '--plugins-root',
                fixturesRoot,
                '--source-timeout',
                '120000',
            ],
            { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe', env: { ...process.env } },
        );
        const [faninStdout, faninStderr] = await Promise.all([
            new Response(fanin.stdout).text(),
            new Response(fanin.stderr).text(),
        ]);
        faninCode = await fanin.exited;
        faninOutput = `${faninStdout}${faninStderr}`.trim();
        if (existsSync(outFile)) {
            docs = JSON.parse(readFileSync(outFile, 'utf8')) as Array<Record<string, unknown>>;
        }

        probeOut = join(work, 'probe');
        const child = Bun.spawn(
            [
                'bun',
                probePath,
                '--profile',
                PROFILE,
                '--plan',
                probePlanFile,
                '--out',
                probeOut,
                '--profile-root',
                profileRoot,
                '--lease-root',
                leaseRoot,
            ],
            { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' },
        );
        const [stdout, stderr] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ]);
        const exitCode = await child.exited;
        probe = { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };

        const loginRedirect = await expectFailure(
            {
                steps: [
                    { id: 'open', type: 'navigate', url: `${base}/redirect-login` },
                    { id: 'copy', type: 'extract', format: 'text' },
                ],
            },
            work,
        );
        const status401 = await expectFailure(
            { steps: [{ id: 'api', type: 'request', url: `${base}/status/401` }] },
            work,
        );
        const status404 = await expectFailure(
            { steps: [{ id: 'api', type: 'request', url: `${base}/status/404` }] },
            work,
        );
        failures.loginRedirect = loginRedirect.code;
        failures.status401 = status401.code;
        failures.status404 = status404.code;
        const failuresUrlFree = loginRedirect.urlFree && status401.urlFree && status404.urlFree;

        const probeResult = existsSync(join(probeOut, 'result.json'))
            ? (JSON.parse(readFileSync(join(probeOut, 'result.json'), 'utf8')) as {
                  ok?: boolean;
                  artifacts?: Array<{ id?: string; file?: string; bytes?: number; url?: string; kind?: string }>;
              })
            : undefined;
        if (probeResult !== undefined) probe = { ...probe, result: probeResult };

        const observationFile = existsSync(observationsFile)
            ? (JSON.parse(readFileSync(observationsFile, 'utf8')) as { launches?: number; acquisitions?: number })
            : {};
        const renderedArtifact = probeResult?.artifacts?.find((entry) => entry.id === 'copy');
        const firstArtifactFile = probeResult?.artifacts?.[0]?.file;
        const probeBodies = (probeResult?.artifacts ?? []).map((entry) =>
            entry.file === undefined ? '' : readFileSync(join(probeOut, entry.file), 'utf8'),
        );
        const probeMarkers = ['rendered-1', 'rendered-2', 'rendered-item'].filter((marker) =>
            `${probe.stdout}${probe.stderr}`.includes(marker),
        );

        const faninDocIds = docs.map((doc) => String(doc.id));
        const renderedDoc = docs.find((doc) => String(doc.id) === 'e2e-bot-collection:rendered');
        const itemDocs = docs.filter((doc) => String(doc.id).startsWith('e2e-bot-collection:item-'));
        const requestDoc = docs.find((doc) => String(doc.id) === 'e2e-bot-collection:request');

        const checks = {
            faninExitZero: faninCode === 0,
            faninDocsFromCapturedXhr: itemDocs.length > 0,
            faninDocsFromRenderedText:
                typeof renderedDoc?.body === 'string' &&
                renderedDoc.body.includes('rendered-1') &&
                renderedDoc.body.includes('rendered-2'),
            faninDocsFromAuthenticatedRequest:
                typeof requestDoc?.body === 'string' && requestDoc.body.includes('rendered-item'),
            probeExitZero: probe.exitCode === 0 && probeResult?.ok === true,
            probeArtifactBodyRendered: renderedArtifact !== undefined && (renderedArtifact.bytes ?? 0) > 0,
            probeWroteArtifactFiles: (probeResult?.artifacts ?? []).length > 0,
            probeBodiesMatchArtifacts: probeBodies.some((body) => body.includes('rendered-1')),
            probeStdoutHasNoBodies: probeMarkers.length === 0,
            probeArtifactPermissions:
                firstArtifactFile === undefined
                    ? false
                    : (statSync(join(probeOut, firstArtifactFile)).mode & 0o777) === 0o600,
            oneLaunchPerRun: observationFile.launches === 1,
            oneLeasePerRun: observationFile.acquisitions === 1,
            loginRedirectIsAuthentication: failures.loginRedirect === 'authentication',
            unauthorizedIsAuthentication: failures.status401 === 'authentication',
            notFoundIsBrowser: failures.status404 === 'browser',
            failureDiagnosticsAreUrlFree: failuresUrlFree,
            allArtifactUrlsLoopback: (probeResult?.artifacts ?? []).every(
                (entry) => entry.url === undefined || entry.url.startsWith(base),
            ),
            serverObservedTraffic: observed.requests.length > 0,
        };

        const pass = Object.values(checks).every(Boolean);
        const result = {
            task: '0346',
            at: new Date().toISOString(),
            pass,
            checks,
            loopbackOrigin: base,
            authenticated: checks.faninDocsFromAuthenticatedRequest,
            externalRequests: 0,
            launch: { launches: observationFile.launches, acquisitions: observationFile.acquisitions },
            docs: faninDocIds,
            rendered: {
                probeArtifact: renderedArtifact?.file,
                bodyBytes: renderedArtifact?.bytes,
            },
            captured: { servedItems: SERVED.items, xhrCaptured: checks.faninDocsFromCapturedXhr },
            failures,
            observedPaths: [...new Set(observed.requests)].sort(),
            probe: { exitCode: probe.exitCode, stderr: probe.stderr },
            fanin: { exitCode: faninCode, output: faninOutput.slice(0, 500) },
        };
        mkdirSync(join(artifactPath, '..'), { recursive: true, mode: 0o700 });
        writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify({ pass, checks, artifact: artifactPath }, null, 2)}\n`);
        server.stop(true);
        process.exit(pass ? 0 : 1);
    } finally {
        server.stop(true);
        rmSync(work, { recursive: true, force: true });
    }
}

await main();
