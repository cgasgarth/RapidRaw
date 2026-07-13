import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import { z } from 'zod';
import { allocateFreeTcpPort } from '../lib/dev-server-port';
import type { QaDaemonJob, QaLifecycleAdapter } from './daemon-engine';
import type { QaDaemonMetrics } from './daemon-model';
import type { QaArtifactRecord, QaPerformanceSpan, QaScenarioResult } from './model';
import { selectScenarios, shardScenarios, validateScenarioArtifacts, validateScenarioCapabilities } from './planner';
import { qaScenarios } from './scenarios';

interface BrowserSession {
  browser: Browser;
  server: ChildProcess;
  baseUrl: string;
  log: string;
}

const collectPerformanceSpans = async (page: Page): Promise<QaPerformanceSpan[]> =>
  page.evaluate(() => {
    const trace = window.__RAWENGINE_QA_PERFORMANCE_TRACE__;
    if (trace === undefined) return [];
    trace.observer.disconnect();
    const spans: QaPerformanceSpan[] = [];
    if (trace.firstMutationMs !== null && trace.lastMutationMs !== null)
      spans.push({
        durationMs: Math.max(0, trace.lastMutationMs - trace.firstMutationMs),
        source: 'frontend',
        stage: 'react-dom-mutation-window',
        startOffsetMs: Math.max(0, trace.firstMutationMs - trace.startedAtMs),
        workCount: trace.mutationCount,
      });
    const callsByCommand = new Map<string, { count: number; endedAtMs: number; startedAtMs: number }>();
    for (const call of (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? []).slice(trace.callIndex)) {
      const endedAtMs = call.endedAtMs ?? performance.now();
      const existing = callsByCommand.get(call.command);
      callsByCommand.set(call.command, {
        count: (existing?.count ?? 0) + 1,
        endedAtMs: Math.max(existing?.endedAtMs ?? endedAtMs, endedAtMs),
        startedAtMs: Math.min(existing?.startedAtMs ?? call.startedAtMs, call.startedAtMs),
      });
    }
    for (const [command, calls] of callsByCommand)
      spans.push({
        durationMs: Math.max(0, calls.endedAtMs - calls.startedAtMs),
        source: 'tauri-ipc',
        stage: `invoke.${command}`,
        startOffsetMs: Math.max(0, calls.startedAtMs - trace.startedAtMs),
        workCount: calls.count,
      });
    return spans;
  });

const launchBrowser = (headed: boolean): Promise<Browser> =>
  chromium.launch({
    args: ['--disable-features=LocalNetworkAccessChecks'],
    headless: !headed,
  });

async function installHarnessHtmlRoute(
  context: Awaited<ReturnType<Browser['newContext']>>,
  baseUrl: string,
): Promise<void> {
  await context.route(`${baseUrl}/`, async (route) => {
    const response = await fetch(route.request().url());
    let body = await response.text();
    if (!body.includes('installBrowserTauriHarness')) {
      const main = /<script type="module" src="\/src\/main\.tsx[^>]*><\/script>/u;
      const match = body.match(main)?.[0];
      if (match === undefined) throw new Error('QA harness could not locate the Vite application entrypoint.');
      const harness = [
        '<script type="module">',
        'import { installBrowserTauriHarness } from "/src/validation/browserTauriHarness.mts";',
        'installBrowserTauriHarness();',
        '</script>',
      ].join('\n');
      body = body.replace(match, `${harness}\n${match}`);
    }
    await route.fulfill({
      status: response.status,
      body,
      headers: {
        'cache-control': 'no-cache',
        'content-length': String(Buffer.byteLength(body)),
        'content-type': response.headers.get('content-type') ?? 'text/html; charset=utf-8',
      },
    });
  });
}

export interface BrowserJobResult {
  browserVersion: string;
  results: QaScenarioResult[];
}

export const browserJobResultSchema: z.ZodType<BrowserJobResult> = z.object({
  browserVersion: z.string(),
  results: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['passed', 'failed']),
      durationMs: z.number().nonnegative(),
      error: z.string().optional(),
      log: z.string().optional(),
      screenshot: z.string().optional(),
      trace: z.string().optional(),
      video: z.string().optional(),
      performanceSpans: z
        .array(
          z.object({
            durationMs: z.number().nonnegative(),
            source: z.enum(['frontend', 'tauri-ipc']),
            stage: z.string().min(1),
            startOffsetMs: z.number().nonnegative(),
            workCount: z.number().int().positive().optional(),
          }),
        )
        .optional(),
      artifacts: z
        .array(
          z.object({
            id: z.string(),
            kind: z.enum(['download', 'json-report', 'screenshot', 'terminal-assertion']),
            path: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

async function terminate(process: ChildProcess): Promise<void> {
  if (process.pid === undefined || process.exitCode !== null) return;
  try {
    globalThis.process.kill(-process.pid, 'SIGTERM');
    await Promise.race([new Promise<void>((done) => process.once('exit', () => done())), Bun.sleep(5_000)]);
    if (process.exitCode === null) globalThis.process.kill(-process.pid, 'SIGKILL');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ESRCH') throw error;
  }
}

const withTimeout = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const CLEANUP_TIMEOUT_MS = 10_000;

export function createBrowserLifecycleAdapter(
  artifactRoot: string,
): QaLifecycleAdapter<BrowserSession, BrowserJobResult> {
  return {
    async start(identity) {
      const host = '127.0.0.1';
      const port = await allocateFreeTcpPort(host);
      const baseUrl = `http://${host}:${port}`;
      const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
        cwd: identity.worktree,
        env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      let browser: Browser | undefined;
      try {
        browser = await launchBrowser(identity.headed);
      } catch (error) {
        await terminate(server);
        throw error;
      }
      const session: BrowserSession = { browser, server, baseUrl, log: '' };
      for (const stream of [server.stdout, server.stderr])
        stream?.on('data', (chunk: Buffer) => {
          session.log = `${session.log}${chunk.toString()}`.slice(-16_000);
        });
      try {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          if (server.exitCode !== null) throw new Error(`Vite exited early:\n${session.log}`);
          try {
            if ((await fetch(baseUrl)).ok) return session;
          } catch {
            // Vite is starting.
          }
          await Bun.sleep(500);
        }
        throw new Error(`Vite did not become ready:\n${session.log}`);
      } catch (error) {
        await Promise.allSettled([session.browser.close(), terminate(server)]);
        session.server.stdout?.destroy();
        session.server.stderr?.destroy();
        throw error;
      }
    },
    async stop(session) {
      await Promise.allSettled([withTimeout(session.browser.close(), CLEANUP_TIMEOUT_MS), terminate(session.server)]);
      session.server.stdout?.destroy();
      session.server.stderr?.destroy();
    },
    async refresh(session, identity, metrics) {
      await Promise.allSettled([withTimeout(session.browser.close(), CLEANUP_TIMEOUT_MS), terminate(session.server)]);
      session.server.stdout?.destroy();
      session.server.stderr?.destroy();
      await Bun.sleep(500);
      const replacement = await createBrowserLifecycleAdapter(artifactRoot).start(identity);
      session.browser = replacement.browser;
      session.server = replacement.server;
      session.baseUrl = replacement.baseUrl;
      session.log = replacement.log;
      metrics.serverStarts += 1;
      metrics.browserStarts += 1;
      return { browserRestarted: true, serverRestarted: true };
    },
    async run(session, job: QaDaemonJob, metrics: QaDaemonMetrics, signal: AbortSignal) {
      const selected = shardScenarios(
        selectScenarios(qaScenarios, { ids: job.scenarioIds }),
        job.shard.index,
        job.shard.total,
      );
      const results: QaScenarioResult[] = [];
      await mkdir(artifactRoot, { recursive: true });
      const videoRoot = resolve(artifactRoot, 'video');
      for (const scenario of selected) {
        signal.throwIfAborted();
        validateScenarioCapabilities(scenario, new Set(['browser-tauri-harness']));
        const context = await withTimeout(
          session.browser.newContext({
            baseURL: session.baseUrl,
            ...(process.env.RAWENGINE_QA_VIDEO === '1'
              ? { recordVideo: { dir: videoRoot, size: { height: 720, width: 1280 } } }
              : {}),
            viewport: { height: 720, width: 1280 },
          }),
          scenario.timeoutMs,
        );
        metrics.contextsCreated += 1;
        await context.addInitScript(() => {
          const startedAtMs = performance.now();
          const trace = {
            callIndex: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.length ?? 0,
            firstMutationMs: null,
            lastMutationMs: null,
            mutationCount: 0,
            observer: new MutationObserver((records) => {
              if (records.length === 0) return;
              const now = performance.now();
              trace.firstMutationMs ??= now;
              trace.lastMutationMs = now;
              trace.mutationCount += records.length;
            }),
            startedAtMs,
          };
          trace.observer.observe(document, { attributes: true, characterData: true, childList: true, subtree: true });
          window.__RAWENGINE_QA_PERFORMANCE_TRACE__ = trace;
        });
        const scenarioDeadline = setTimeout(() => void context.close(), scenario.timeoutMs);
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        let tracingStopped = false;
        await installHarnessHtmlRoute(context, session.baseUrl);
        const abort = () => void context.close();
        signal.addEventListener('abort', abort, { once: true });
        const page = await context.newPage();
        const video = page.video();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', (route) =>
          route.fulfill({ json: { tag_name: 'v0.0.0-qa' }, status: 200 }),
        );
        const started = performance.now();
        const artifacts: QaArtifactRecord[] = [];
        let result: QaScenarioResult | undefined;
        try {
          await withTimeout(
            scenario.run({
              baseUrl: session.baseUrl,
              context,
              page,
              recordArtifact(artifact) {
                artifacts.push(artifact);
              },
            }),
            scenario.timeoutMs,
          );
          validateScenarioArtifacts(scenario, artifacts);
          if (errors.length > 0) throw new Error(`Browser errors:\n${errors.join('\n')}`);
          const performanceSpans = await collectPerformanceSpans(page);
          result = {
            id: scenario.id,
            status: 'passed',
            durationMs: Math.round(performance.now() - started),
            artifacts,
            performanceSpans,
          };
          results.push(result);
        } catch (error) {
          const screenshotPath = resolve(artifactRoot, `${scenario.id}-${Date.now()}.png`);
          const screenshot = await page
            .screenshot({ path: screenshotPath, fullPage: true })
            .then(() => screenshotPath)
            .catch(() => undefined);
          const tracePath = resolve(artifactRoot, `${scenario.id}-${Date.now()}.zip`);
          const trace = await withTimeout(context.tracing.stop({ path: tracePath }), CLEANUP_TIMEOUT_MS)
            .then(() => tracePath)
            .catch(() => undefined);
          tracingStopped = true;
          const harnessCalls = await page
            .evaluate(() => JSON.stringify(Reflect.get(window, '__RAWENGINE_BROWSER_TAURI_HARNESS__') ?? null))
            .catch(() => undefined);
          result = {
            id: scenario.id,
            status: 'failed',
            durationMs: Math.round(performance.now() - started),
            error: `${error instanceof Error ? error.message : String(error)}\nHarness state: ${harnessCalls?.slice(-4_000) ?? 'unavailable'}`,
            log: session.log,
            screenshot,
            trace,
            artifacts,
          };
          results.push(result);
        } finally {
          clearTimeout(scenarioDeadline);
          signal.removeEventListener('abort', abort);
          if (!tracingStopped) await withTimeout(context.tracing.stop(), CLEANUP_TIMEOUT_MS).catch(() => undefined);
          await withTimeout(context.close(), CLEANUP_TIMEOUT_MS);
          metrics.contextsClosed += 1;
          const videoPath =
            video === null ? undefined : await withTimeout(video.path(), CLEANUP_TIMEOUT_MS).catch(() => undefined);
          if (result?.status === 'failed') result.video = videoPath;
          else if (videoPath !== undefined) await rm(videoPath, { force: true });
          if (result !== undefined) {
            const paths = new Set([
              result.screenshot,
              result.trace,
              result.video,
              ...(result.artifacts ?? []).map(({ path }) => path),
            ]);
            for (const path of paths) {
              if (path === undefined) continue;
              metrics.artifactBytes += await stat(path)
                .then(({ size }) => size)
                .catch(() => 0);
            }
          }
        }
      }
      const liveContexts = session.browser.contexts().length;
      metrics.leakedContexts += liveContexts;
      if (liveContexts !== 0) throw new Error(`QA browser leaked ${liveContexts} context(s).`);
      return { browserVersion: session.browser.version(), results };
    },
  };
}
