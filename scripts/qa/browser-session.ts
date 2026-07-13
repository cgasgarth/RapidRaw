import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, chromium } from '@playwright/test';
import { z } from 'zod';
import { allocateFreeTcpPort } from '../lib/dev-server-port';
import type { QaDaemonJob, QaLifecycleAdapter } from './daemon-engine';
import type { QaDaemonMetrics } from './daemon-model';
import type { QaArtifactRecord, QaScenarioResult } from './model';
import { selectScenarios, shardScenarios, validateScenarioArtifacts, validateScenarioCapabilities } from './planner';
import { qaScenarios } from './scenarios';

interface BrowserSession {
  browser: Browser;
  server: ChildProcess;
  baseUrl: string;
  log: string;
}

async function installHarnessHtmlRoute(
  context: Awaited<ReturnType<Browser['newContext']>>,
  baseUrl: string,
): Promise<void> {
  await context.route(`${baseUrl}/`, async (route) => {
    const response = await route.fetch();
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
      response,
      body,
      headers: { ...response.headers(), 'content-length': String(Buffer.byteLength(body)) },
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
      screenshot: z.string().optional(),
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
        browser = await chromium.launch({
          args: ['--disable-features=LocalNetworkAccessChecks'],
          headless: !identity.headed,
        });
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
      await Promise.allSettled([session.browser.close(), terminate(session.server)]);
      session.server.stdout?.destroy();
      session.server.stderr?.destroy();
    },
    async refresh(session, _identity, metrics) {
      const context = await session.browser.newContext({ baseURL: session.baseUrl });
      metrics.contextsCreated += 1;
      try {
        await installHarnessHtmlRoute(context, session.baseUrl);
        const page = await context.newPage();
        await page.goto('/', { waitUntil: 'networkidle', timeout: 30_000 });
        await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
        await Bun.sleep(100);
      } finally {
        await context.close();
        metrics.contextsClosed += 1;
      }
    },
    async run(session, job: QaDaemonJob, metrics: QaDaemonMetrics, signal: AbortSignal) {
      const selected = shardScenarios(
        selectScenarios(qaScenarios, { ids: job.scenarioIds }),
        job.shard.index,
        job.shard.total,
      );
      const results: QaScenarioResult[] = [];
      await mkdir(artifactRoot, { recursive: true });
      for (const scenario of selected) {
        signal.throwIfAborted();
        validateScenarioCapabilities(scenario, new Set(['browser-tauri-harness']));
        const context = await session.browser.newContext({
          baseURL: session.baseUrl,
          viewport: { height: 720, width: 1280 },
        });
        metrics.contextsCreated += 1;
        await installHarnessHtmlRoute(context, session.baseUrl);
        const abort = () => void context.close();
        signal.addEventListener('abort', abort, { once: true });
        const page = await context.newPage();
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
          results.push({
            id: scenario.id,
            status: 'passed',
            durationMs: Math.round(performance.now() - started),
            artifacts,
          });
        } catch (error) {
          const screenshot = resolve(artifactRoot, `${scenario.id}-${Date.now()}.png`);
          await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
          const harnessCalls = await page
            .evaluate(() => JSON.stringify(Reflect.get(window, '__RAWENGINE_BROWSER_TAURI_HARNESS__') ?? null))
            .catch(() => undefined);
          results.push({
            id: scenario.id,
            status: 'failed',
            durationMs: Math.round(performance.now() - started),
            error: `${error instanceof Error ? error.message : String(error)}\nHarness state: ${harnessCalls?.slice(-4_000) ?? 'unavailable'}`,
            screenshot,
            artifacts,
          });
        } finally {
          signal.removeEventListener('abort', abort);
          await context.close();
          metrics.contextsClosed += 1;
        }
      }
      const liveContexts = session.browser.contexts().length;
      metrics.leakedContexts += liveContexts;
      if (liveContexts !== 0) throw new Error(`QA browser leaked ${liveContexts} context(s).`);
      return { browserVersion: session.browser.version(), results };
    },
  };
}
