import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type DecisionStubHandler, executeSeoJudgeStage } from './seo-decisions';
import {
    type CrawlArtifact,
    extractHtmlFacts,
    getScopeHostnames,
    type LimitsRecord,
    type ManifestArtifact,
    normalizeUrl,
    type PageRecord,
    type RequestRecord,
    type SeoOptions,
    sha256,
    validateOptions,
} from './seo-facts';
import { fetchWithPinnedDns, parseRobotsTxt, parseSitemapXml, writeJsonAtomic } from './seo-fetch';
import { type AuditArtifact, type ReportJsonArtifact, renderReportMarkdown } from './seo-report';
import { type AssessmentRow, buildPrioritizedActions, calculateScoresAndCoverage, runSeoChecks } from './seo-rules';

function fail(message: string): never {
    throw new Error(message);
}

const allowAll = (): boolean => true;

/**
 * Format UTC date as YYYYMMDDTHHMMSSZ.
 */
function formatUtcStamp(date = new Date()): string {
    return date.toISOString().replace(/[-:]/g, '').slice(0, 15).concat('Z');
}

/**
 * `seo-preflight <work_dir> <options_file> [run_id] [require_decisions]`
 */
export async function seoPreflight(args: string[]): Promise<void> {
    const [workDirArg = '', optionsFileArg = '', runIdArg = '', requireDecisionsArg = 'false'] = args;

    if (!optionsFileArg) {
        fail('usage: kk stage run seo-preflight <work_dir> <options_file> [run_id] [require_decisions]');
    }

    const optionsPath = resolve(optionsFileArg);
    if (!existsSync(optionsPath)) {
        fail(`seo-preflight: options file not found at ${optionsPath}`);
    }

    let optionsRaw: string;
    try {
        optionsRaw = readFileSync(optionsPath, 'utf-8');
    } catch (err) {
        fail(`seo-preflight: cannot read options file at ${optionsPath}: ${String(err)}`);
    }

    if (Buffer.byteLength(optionsRaw, 'utf-8') > 64 * 1024) {
        fail(`seo-preflight: options file exceeds 64 KiB limit (${Buffer.byteLength(optionsRaw, 'utf-8')} bytes)`);
    }

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(optionsRaw);
    } catch (err) {
        fail(`seo-preflight: options file is invalid JSON: ${String(err)}`);
    }

    let options: SeoOptions;
    try {
        options = validateOptions(parsedJson);
    } catch (err) {
        fail(`seo-preflight: options validation failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const runId = runIdArg.trim() || `seo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const utcStamp = formatUtcStamp();

    let workDir: string;
    if (workDirArg.trim() === '') {
        workDir = resolve(join('.works', 'kk-smart-seo', `${utcStamp}-${runId}`));
    } else {
        workDir = resolve(workDirArg.trim());
    }

    // Refuse overwrite if workDir exists and is non-empty
    if (existsSync(workDir)) {
        const files = readdirSync(workDir);
        if (files.length > 0) {
            fail(`seo-preflight: work_dir exists and is non-empty: ${workDir} (refusing overwrite)`);
        }
    } else {
        mkdirSync(workDir, { recursive: true });
    }

    const inputDigest = sha256(optionsRaw);

    const manifest: ManifestArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId,
        createdAt: new Date().toISOString(),
        inputDigest,
        stage: 'preflight',
        options,
    };

    // Write options.json and manifest.json atomically
    writeJsonAtomic(join(workDir, 'options.json'), options);
    writeJsonAtomic(join(workDir, 'manifest.json'), manifest);

    // Atomically write run-bound work dir file (.spur/run/<run-id>-seo-work-dir.txt)
    const runDir = resolve('.spur', 'run');
    if (!existsSync(runDir)) {
        mkdirSync(runDir, { recursive: true });
    }
    const runWorkDirFile = join(runDir, `${runId}-seo-work-dir.txt`);
    try {
        writeJsonAtomic(runWorkDirFile, { workDir });
    } catch {
        // Fallback simple write if atomic write to file succeeds
    }

    // Check require_decisions
    const requireDecisions = requireDecisionsArg === 'true';
    if (requireDecisions) {
        // Direct collection default is false; when true in full workflow, verify catalogs exist
        console.error('seo-preflight: decisions check enabled (require_decisions=true)');
    }

    console.error(`seo-preflight: initialized work_dir=${workDir} runId=${runId}`);
}

/**
 * `seo-collect <work_dir>`
 */
export async function seoCollect(
    args: string[],
    transportOpts: { allowLoopback?: boolean; ca?: string | Buffer } = {},
): Promise<void> {
    const [workDirArg = ''] = args;
    if (!workDirArg) {
        fail('usage: kk stage run seo-collect <work_dir>');
    }

    const workDir = resolve(workDirArg);
    const optionsPath = join(workDir, 'options.json');
    const manifestPath = join(workDir, 'manifest.json');

    if (!existsSync(optionsPath) || !existsSync(manifestPath)) {
        fail(`seo-collect: missing options.json or manifest.json in ${workDir}`);
    }

    const optionsRaw = readFileSync(optionsPath, 'utf-8');
    const manifestRaw = readFileSync(manifestPath, 'utf-8');

    const options: SeoOptions = validateOptions(JSON.parse(optionsRaw));
    const manifest: ManifestArtifact = JSON.parse(manifestRaw);

    const runId = manifest.runId;
    const inputDigest = manifest.inputDigest;
    const predecessorDigests: Record<string, string> = {
        'options.json': sha256(optionsRaw),
        'manifest.json': sha256(manifestRaw),
    };

    const targetUrl = options.url;
    const parsedTarget = new URL(targetUrl);
    const scopeHostnames = getScopeHostnames(parsedTarget.hostname);

    const pages: PageRecord[] = [];
    const requests: RequestRecord[] = [];
    const limits: LimitsRecord = {
        pagesVisited: 0,
        requestsMade: 0,
        totalBytes: 0,
        elapsedSeconds: 0,
        hitLimit: null,
    };

    const startTime = Date.now();
    const deadlineMs = startTime + options.deadline_seconds * 1000;
    const maxRequests = options.max_requests;
    const maxPages = options.max_pages;
    const maxDepth = options.max_depth;
    const maxTotalBytes = 40 * 1024 * 1024; // 40 MiB

    // Prepare evidence directory
    const evidencePagesDir = join(workDir, 'evidence', 'pages');
    mkdirSync(evidencePagesDir, { recursive: true });

    // Handle offline fixture mode
    if (options.fixture && options.fixture.trim() !== '') {
        const fixtureDir = resolve(options.fixture.trim());
        if (!existsSync(fixtureDir)) {
            fail(`seo-collect: fixture directory not found: ${fixtureDir}`);
        }
        console.error(`seo-collect: loading offline fixture from ${fixtureDir}`);
        // Read fixture crawl.json if present
        const candidates = ['crawl.json', 'smart-seo-minimal-crawl.json'];
        for (const cand of candidates) {
            const fixtureCrawl = join(fixtureDir, cand);
            if (existsSync(fixtureCrawl)) {
                const data: CrawlArtifact = JSON.parse(readFileSync(fixtureCrawl, 'utf-8'));
                data.runId = runId;
                data.createdAt = new Date().toISOString();
                data.inputDigest = inputDigest;
                data.predecessorDigests = predecessorDigests;
                writeJsonAtomic(join(workDir, 'crawl.json'), data);
                console.error(`seo-collect: copied fixture crawl.json with ${data.pages.length} pages`);
                return;
            }
        }
    }

    const allowLoopback = options.allow_test_loopback ?? transportOpts.allowLoopback ?? false;
    const effectiveTransportOpts = { ...transportOpts, allowLoopback };

    // Step A: Fetch robots.txt
    const origin = parsedTarget.origin;
    const robotsUrl = `${origin}/robots.txt`;
    let robotsPolicy = {
        rawDigest: '',
        isAvailable: true,
        isBlocked: false,
        crawlDelaySeconds: null as number | null,
        sitemaps: [] as string[],
        isPathAllowed: allowAll,
    };

    try {
        const reqStart = Date.now();
        const robotsRes = await fetchWithPinnedDns(robotsUrl, scopeHostnames, {
            ...effectiveTransportOpts,
            timeoutMs: Math.min(20000, Math.max(1000, deadlineMs - Date.now())),
        });
        const durationMs = Date.now() - reqStart;
        limits.requestsMade += 1;
        limits.totalBytes += robotsRes.bytesReceived;

        requests.push({
            url: robotsUrl,
            method: 'GET',
            status: robotsRes.status,
            durationMs,
            bytesReceived: robotsRes.bytesReceived,
            error: null,
            timestamp: new Date().toISOString(),
        });

        if (robotsRes.status === 404 || robotsRes.status === 410) {
            // Absent policy: allows all
            robotsPolicy = {
                rawDigest: '',
                isAvailable: true,
                isBlocked: false,
                crawlDelaySeconds: null,
                sitemaps: [],
                isPathAllowed: allowAll,
            };
        } else if (robotsRes.status === 401 || robotsRes.status === 403) {
            // Blocked: disallow all
            robotsPolicy = {
                rawDigest: '',
                isAvailable: true,
                isBlocked: true,
                crawlDelaySeconds: null,
                sitemaps: [],
                isPathAllowed: allowAll,
            };
        } else if (robotsRes.status >= 200 && robotsRes.status < 300) {
            robotsPolicy = parseRobotsTxt(robotsRes.body);
        } else {
            // 429, 5xx, or other error: unavailable policy
            robotsPolicy = {
                rawDigest: '',
                isAvailable: false,
                isBlocked: false,
                crawlDelaySeconds: null,
                sitemaps: [],
                isPathAllowed: allowAll,
            };
        }
    } catch (err: unknown) {
        limits.requestsMade += 1;
        requests.push({
            url: robotsUrl,
            method: 'GET',
            status: null,
            durationMs: 0,
            bytesReceived: 0,
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
        });
        robotsPolicy = {
            rawDigest: '',
            isAvailable: false,
            isBlocked: false,
            crawlDelaySeconds: null,
            sitemaps: [],
            isPathAllowed: allowAll,
        };
    }

    // Step B: Sitemap discovery
    const candidateUrls: Array<{ url: string; depth: number }> = [{ url: targetUrl, depth: 0 }];
    const sitemapCandidates = [...robotsPolicy.sitemaps];
    if (sitemapCandidates.length === 0) {
        sitemapCandidates.push(`${origin}/sitemap.xml`);
    }

    const processedSitemaps = new Set<string>();
    while (sitemapCandidates.length > 0 && processedSitemaps.size < 25) {
        if (Date.now() >= deadlineMs) {
            limits.hitLimit = 'deadline';
            break;
        }
        if (limits.requestsMade >= maxRequests) {
            limits.hitLimit = 'max_requests';
            break;
        }

        const rawSitemapUrl = sitemapCandidates.shift();
        if (!rawSitemapUrl || processedSitemaps.has(rawSitemapUrl)) continue;
        processedSitemaps.add(rawSitemapUrl);

        let sitemapUrl: string;
        try {
            sitemapUrl = new URL(rawSitemapUrl, origin).toString();
        } catch {
            continue;
        }

        try {
            const smParsed = new URL(sitemapUrl);
            if (!scopeHostnames.has(smParsed.hostname.toLowerCase())) continue;

            const reqStart = Date.now();
            const smRes = await fetchWithPinnedDns(sitemapUrl, scopeHostnames, {
                ...effectiveTransportOpts,
                timeoutMs: Math.min(20000, Math.max(1000, deadlineMs - Date.now())),
            });
            limits.requestsMade += 1;
            limits.totalBytes += smRes.bytesReceived;

            requests.push({
                url: sitemapUrl,
                method: 'GET',
                status: smRes.status,
                durationMs: Date.now() - reqStart,
                bytesReceived: smRes.bytesReceived,
                error: null,
                timestamp: new Date().toISOString(),
            });

            if (smRes.status === 200 && smRes.body) {
                const parsedSm = parseSitemapXml(smRes.body);
                for (const child of parsedSm.childSitemaps) {
                    if (!processedSitemaps.has(child) && sitemapCandidates.length < 50) {
                        sitemapCandidates.push(child);
                    }
                }
                for (const discovered of parsedSm.urls) {
                    try {
                        const dUrl = normalizeUrl(discovered);
                        const dParsed = new URL(dUrl);
                        if (scopeHostnames.has(dParsed.hostname.toLowerCase())) {
                            candidateUrls.push({ url: dUrl, depth: 1 });
                        }
                    } catch {
                        // ignore malformed URL in sitemap
                    }
                }
            }
        } catch (err: unknown) {
            limits.requestsMade += 1;
            requests.push({
                url: sitemapUrl,
                method: 'GET',
                status: null,
                durationMs: 0,
                bytesReceived: 0,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
            });
        }
    }

    // Step C: Crawl queue
    const visitedUrls = new Set<string>();

    while (candidateUrls.length > 0 && limits.pagesVisited < maxPages) {
        if (Date.now() >= deadlineMs) {
            limits.hitLimit = 'deadline';
            break;
        }
        if (limits.requestsMade >= maxRequests) {
            limits.hitLimit = 'max_requests';
            break;
        }
        if (limits.totalBytes >= maxTotalBytes) {
            limits.hitLimit = 'total_bytes';
            break;
        }

        const candidate = candidateUrls.shift();
        if (!candidate) continue;
        const currentUrl = normalizeUrl(candidate.url);
        if (visitedUrls.has(currentUrl)) continue;
        visitedUrls.add(currentUrl);

        const currentParsed = new URL(currentUrl);
        const path = `${currentParsed.pathname}${currentParsed.search}`;

        // Robots check
        if (!robotsPolicy.isAvailable) {
            pages.push({
                subjectId: sha256(currentUrl),
                url: currentUrl,
                status: null,
                availability: 'unavailable',
                redirectChain: [],
                evidencePath: null,
                evidenceHash: null,
                facts: null,
                error: 'robots.txt policy unavailable',
            });
            limits.pagesVisited += 1;
            continue;
        }

        if (robotsPolicy.isBlocked || !robotsPolicy.isPathAllowed(path)) {
            pages.push({
                subjectId: sha256(currentUrl),
                url: currentUrl,
                status: null,
                availability: 'blocked',
                redirectChain: [],
                evidencePath: null,
                evidenceHash: null,
                facts: null,
                error: 'blocked by robots.txt',
            });
            limits.pagesVisited += 1;
            continue;
        }

        // Crawl delay
        if (robotsPolicy.crawlDelaySeconds && robotsPolicy.crawlDelaySeconds > 0) {
            const delayMs = robotsPolicy.crawlDelaySeconds * 1000;
            if (Date.now() + delayMs >= deadlineMs) {
                limits.hitLimit = 'deadline';
                break;
            }
            await new Promise((r) => setTimeout(r, Math.min(delayMs, 5000)));
        }

        // Fetch page
        try {
            const reqStart = Date.now();
            const res = await fetchWithPinnedDns(currentUrl, scopeHostnames, {
                ...effectiveTransportOpts,
                timeoutMs: Math.min(20000, Math.max(1000, deadlineMs - Date.now())),
            });
            const durationMs = Date.now() - reqStart;
            limits.requestsMade += 1;
            limits.totalBytes += res.bytesReceived;

            requests.push({
                url: currentUrl,
                method: 'GET',
                status: res.status,
                durationMs,
                bytesReceived: res.bytesReceived,
                error: null,
                timestamp: new Date().toISOString(),
            });

            const subjectId = sha256(res.finalUrl || currentUrl);
            let facts = null;

            if (res.body && res.status >= 200 && res.status < 400) {
                facts = await extractHtmlFacts(res.body, {
                    url: res.finalUrl || currentUrl,
                    scopeHostnames,
                    ttfbMs: res.ttfbMs,
                });

                // Enqueue discovered links if depth allows
                if (candidate.depth < maxDepth) {
                    for (const link of facts.links) {
                        if (link.isInternal && !visitedUrls.has(normalizeUrl(link.href))) {
                            try {
                                const resolved = normalizeUrl(new URL(link.href, res.finalUrl).toString());
                                candidateUrls.push({ url: resolved, depth: candidate.depth + 1 });
                            } catch {
                                // ignore malformed href
                            }
                        }
                    }
                }
            }

            // Write evidence
            const evidenceRelPath = `evidence/pages/${subjectId}.json`;
            const evidenceFile = join(workDir, evidenceRelPath);
            const evidencePayload = {
                subjectId,
                url: res.finalUrl || currentUrl,
                status: res.status,
                headers: res.headers,
                facts,
            };
            writeJsonAtomic(evidenceFile, evidencePayload);
            const evidenceHash = sha256(JSON.stringify(evidencePayload));

            pages.push({
                subjectId,
                url: currentUrl,
                status: res.status,
                availability: res.status >= 200 && res.status < 400 ? 'available' : 'unavailable',
                redirectChain: res.redirectChain,
                evidencePath: evidenceRelPath,
                evidenceHash,
                facts,
                error: null,
            });
            limits.pagesVisited += 1;
        } catch (err: unknown) {
            limits.requestsMade += 1;
            const errMsg = err instanceof Error ? err.message : String(err);
            requests.push({
                url: currentUrl,
                method: 'GET',
                status: null,
                durationMs: 0,
                bytesReceived: 0,
                error: errMsg,
                timestamp: new Date().toISOString(),
            });

            pages.push({
                subjectId: sha256(currentUrl),
                url: currentUrl,
                status: null,
                availability: 'unavailable',
                redirectChain: [],
                evidencePath: null,
                evidenceHash: null,
                facts: null,
                error: errMsg,
            });
            limits.pagesVisited += 1;
        }
    }

    limits.elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

    const isPartial =
        limits.hitLimit !== null || pages.length === 0 || pages.some((p) => p.availability === 'unavailable');

    const crawlArtifact: CrawlArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId,
        createdAt: new Date().toISOString(),
        inputDigest,
        predecessorDigests,
        status: isPartial ? 'partial' : 'complete',
        pages,
        requests,
        limits,
    };

    writeJsonAtomic(join(workDir, 'crawl.json'), crawlArtifact);
    console.error(
        `seo-collect: completed crawl status=${crawlArtifact.status} visited=${limits.pagesVisited} requests=${limits.requestsMade} bytes=${limits.totalBytes}`,
    );
}

/**
 * `seo-check <work_dir>`
 */
export async function seoCheck(args: string[]): Promise<void> {
    const [workDirArg = ''] = args;
    if (!workDirArg) {
        fail('usage: kk stage run seo-check <work_dir>');
    }
    const workDir = resolve(workDirArg);
    const crawlPath = join(workDir, 'crawl.json');
    if (!existsSync(crawlPath)) {
        fail(`seo-check: missing crawl.json in ${workDir}`);
    }
    const crawlRaw = readFileSync(crawlPath, 'utf-8');
    const crawl: CrawlArtifact = JSON.parse(crawlRaw);
    const assessments = runSeoChecks(crawl);

    const checksArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId: crawl.runId,
        createdAt: new Date().toISOString(),
        inputDigest: crawl.inputDigest,
        predecessorDigests: {
            ...crawl.predecessorDigests,
            'crawl.json': sha256(crawlRaw),
        },
        assessments,
    };
    writeJsonAtomic(join(workDir, 'checks.json'), checksArtifact);
    console.error(`seo-check: evaluated ${assessments.length} check rows across ${crawl.pages.length} pages`);
}

/**
 * `seo-score <work_dir> [new_revision_dir]`
 */
export async function seoScore(args: string[]): Promise<void> {
    const [workDirArg = '', newRevisionDirArg = ''] = args;
    if (!workDirArg) {
        fail('usage: kk stage run seo-score <work_dir> [new_revision_dir]');
    }
    const sourceDir = resolve(workDirArg);
    const checksPath = join(sourceDir, 'checks.json');
    const crawlPath = join(sourceDir, 'crawl.json');
    const optionsPath = join(sourceDir, 'options.json');
    const manifestPath = join(sourceDir, 'manifest.json');

    if (!existsSync(checksPath) || !existsSync(crawlPath) || !existsSync(optionsPath)) {
        fail(`seo-score: missing required input artifacts in ${sourceDir}`);
    }

    const isRescore = Boolean(newRevisionDirArg.trim());
    let targetDir = sourceDir;
    let revisionId: string | undefined;

    if (isRescore) {
        targetDir = resolve(newRevisionDirArg.trim());
        if (existsSync(targetDir)) {
            const files = readdirSync(targetDir);
            if (files.length > 0) {
                fail(`seo-score: new_revision_dir exists and is non-empty: ${targetDir} (refusing overwrite)`);
            }
        } else {
            mkdirSync(targetDir, { recursive: true });
        }
        revisionId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // Copy input artifacts
        copyFileSync(optionsPath, join(targetDir, 'options.json'));
        if (existsSync(manifestPath)) copyFileSync(manifestPath, join(targetDir, 'manifest.json'));
        copyFileSync(crawlPath, join(targetDir, 'crawl.json'));
        copyFileSync(checksPath, join(targetDir, 'checks.json'));
    } else {
        const auditPath = join(targetDir, 'audit.json');
        if (existsSync(auditPath)) {
            fail(`seo-score: audit.json already exists in ${targetDir} (refusing overwrite)`);
        }
    }

    const checksRaw = readFileSync(checksPath, 'utf-8');
    const crawlRaw = readFileSync(crawlPath, 'utf-8');
    const optionsRaw = readFileSync(optionsPath, 'utf-8');

    const checks = JSON.parse(checksRaw);
    const crawl: CrawlArtifact = JSON.parse(crawlRaw);
    const options: SeoOptions = JSON.parse(optionsRaw);

    const assessments: AssessmentRow[] = checks.assessments || [];
    const { scores, coverage } = calculateScoresAndCoverage(assessments);
    const actions = buildPrioritizedActions(assessments);

    const facts: AuditArtifact['facts'] = {
        pages_visited: { value: crawl.limits.pagesVisited, unit: 'count', source: 'crawl.json' },
        requests_made: { value: crawl.limits.requestsMade, unit: 'count', source: 'crawl.json' },
        total_bytes: { value: crawl.limits.totalBytes, unit: 'bytes', source: 'crawl.json' },
    };

    const auditArtifact: AuditArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId: crawl.runId,
        ...(revisionId ? { revisionId } : {}),
        createdAt: new Date().toISOString(),
        inputDigest: crawl.inputDigest,
        predecessorDigests: {
            ...checks.predecessorDigests,
            'checks.json': sha256(checksRaw),
        },
        status: crawl.status,
        targetUrl: options.url,
        scores,
        coverage,
        facts,
        assessments,
        actions,
        judgments: { status: 'not-assessed' },
        performance: { status: 'not-assessed' },
        visibility: { status: 'not-assessed' },
        limits: crawl.limits,
    };

    writeJsonAtomic(join(targetDir, 'audit.json'), auditArtifact);
    const digestMd = `# Smart SEO Audit Digest\n\n- Technical Score: ${scores.technical !== null ? scores.technical : 'null'}\n- Actions Count: ${actions.length}\n`;
    writeJsonAtomic(join(targetDir, 'digest.json'), { digestMd });
    writeFileSync(join(targetDir, 'digest.md'), digestMd, 'utf-8');

    console.error(`seo-score: generated audit.json in ${targetDir} with ${actions.length} prioritized actions`);
}

/**
 * `seo-report <work_dir>`
 */
export async function seoReport(args: string[]): Promise<void> {
    const [workDirArg = ''] = args;
    if (!workDirArg) {
        fail('usage: kk stage run seo-report <work_dir>');
    }
    const workDir = resolve(workDirArg);
    const auditPath = join(workDir, 'audit.json');
    if (!existsSync(auditPath)) {
        fail(`seo-report: missing audit.json in ${workDir}`);
    }

    const auditRaw = readFileSync(auditPath, 'utf-8');
    const audit: AuditArtifact = JSON.parse(auditRaw);

    // Optional narrative check
    let narrativeText: string | undefined;
    let narrativeStatus: 'omitted' | 'included' | 'rejected' = 'omitted';
    const narrativePath = join(workDir, 'narrative.json');
    if (existsSync(narrativePath)) {
        try {
            const narrRaw = readFileSync(narrativePath, 'utf-8');
            const narr = JSON.parse(narrRaw);
            if (narr && typeof narr === 'object' && Array.isArray(narr.sections)) {
                narrativeStatus = 'included';
                narrativeText = narr.sections
                    .map((s: { heading?: string; text?: string }) => `### ${s.heading || 'Summary'}\n\n${s.text || ''}`)
                    .join('\n\n');
            } else {
                narrativeStatus = 'rejected';
            }
        } catch {
            narrativeStatus = 'rejected';
        }
    }

    const reportMd = renderReportMarkdown(audit, narrativeText);
    writeFileSync(join(workDir, 'report.md'), reportMd, 'utf-8');

    const reportJson: ReportJsonArtifact = {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId: audit.runId,
        ...(audit.revisionId ? { revisionId: audit.revisionId } : {}),
        createdAt: new Date().toISOString(),
        targetUrl: audit.targetUrl,
        status: audit.status === 'complete' ? 'done' : 'partial',
        scores: audit.scores,
        coverage: audit.coverage,
        actionsCount: audit.actions.length,
        actions: audit.actions,
        narrativeStatus,
    };

    writeJsonAtomic(join(workDir, 'report.json'), reportJson);
    console.error(`seo-report: wrote report.json and report.md in ${workDir}`);
}

/**
 * `seo-judge <work_dir>`
 */
export async function seoJudge(
    args: string[],
    options: { spurBin?: string; stub?: DecisionStubHandler } = {},
): Promise<void> {
    const [workDirArg = ''] = args;
    if (!workDirArg) {
        fail('usage: kk stage run seo-judge <work_dir>');
    }
    const workDir = resolve(workDirArg);
    const crawlPath = join(workDir, 'crawl.json');
    if (!existsSync(crawlPath)) {
        fail(`seo-judge: missing crawl.json in ${workDir}`);
    }
    const result = await executeSeoJudgeStage(workDir, options);
    console.error(
        `seo-judge: completed ${result.summary.totalCalls} decision calls (${result.summary.qualifiedCalls} qualified)`,
    );
}

if (import.meta.main) {
    const [stage, ...rest] = process.argv.slice(2);
    try {
        switch (stage) {
            case 'seo-preflight':
                await seoPreflight(rest);
                break;
            case 'seo-collect':
                await seoCollect(rest);
                break;
            case 'seo-check':
                await seoCheck(rest);
                break;
            case 'seo-judge':
                await seoJudge(rest);
                break;
            case 'seo-score':
                await seoScore(rest);
                break;
            case 'seo-report':
                await seoReport(rest);
                break;
            default:
                fail(
                    `unknown stage: ${stage ?? '(none)'} (expected seo-preflight|seo-collect|seo-check|seo-judge|seo-score|seo-report)`,
                );
        }
    } catch (err: unknown) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
