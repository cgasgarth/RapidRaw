#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { allocateFreeTcpPort } from '../lib/dev-server-port';
import { selectImpactedScenarioIds } from './impacted';
import type { QaRunReceipt, QaScenarioResult } from './model';
import { selectScenarios, shardScenarios } from './planner';
import { qaScenarios } from './scenarios';

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const list = (flag: string) =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ''] : [])).filter(Boolean);
if (args.includes('--list')) {
  for (const scenario of qaScenarios) console.log(`${scenario.id}\t${scenario.tags.join(',')}\t${scenario.isolation}`);
  process.exit(0);
}
const total = Number(value('--shard-total') ?? '1');
const index = Number(value('--shard-index') ?? '0');
const impactedBase = args[0] === 'impacted' ? (value('--base') ?? 'origin/main') : undefined;
const impactedIds =
  impactedBase === undefined
    ? []
    : selectImpactedScenarioIds(
        Bun.spawnSync(['git', 'diff', '--name-only', `${impactedBase}...HEAD`])
          .stdout.toString()
          .trim()
          .split('\n')
          .filter(Boolean),
        qaScenarios,
      );
const selected = shardScenarios(
  selectScenarios(qaScenarios, { ids: [...list('--scenario'), ...impactedIds], tags: list('--tag') }),
  index,
  total,
);
const host = '127.0.0.1';
const port = await allocateFreeTcpPort(host);
const baseUrl = `http://${host}:${port}`;
const startedAt = new Date();
const gitSha = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
const worktree = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel']).stdout.toString().trim();
const dirty = Bun.spawnSync(['git', 'status', '--porcelain=v1']).stdout.toString();
const lock = await readFile('bun.lock', 'utf8');
const buildIdentity = createHash('sha256').update(lock).update(gitSha).digest('hex');
const runId = `${startedAt.toISOString().replaceAll(/[:.]/gu, '-')}-${gitSha.slice(0, 8)}-s${index}`;
const artifactRoot = resolve('private-artifacts/qa', runId);
await mkdir(artifactRoot, { recursive: true });

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: { ...process.env, RAWENGINE_DEV_SERVER_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverLog = '';
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk: Buffer) => {
    serverLog = `${serverLog}${chunk.toString()}`.slice(-16_000);
  });
const waitForServer = async () => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${serverLog}`);
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      /* starting */
    }
    await Bun.sleep(500);
  }
  throw new Error(`Vite did not become ready:\n${serverLog}`);
};
const browser = await chromium.launch({ headless: !args.includes('--headed') });
const results: QaScenarioResult[] = [];
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
try {
  await waitForServer();
  for (const scenario of selected) {
    const context = await browser.newContext({ baseURL: baseUrl, viewport: { height: 720, width: 1280 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', (route) =>
      route.fulfill({ json: { tag_name: 'v0.0.0-qa' }, status: 200 }),
    );
    const scenarioStarted = performance.now();
    try {
      await withTimeout(scenario.run({ baseUrl, context, page }), scenario.timeoutMs);
      if (errors.length > 0) throw new Error(`Browser errors:\n${errors.join('\n')}`);
      results.push({ id: scenario.id, status: 'passed', durationMs: Math.round(performance.now() - scenarioStarted) });
    } catch (error) {
      const screenshot = resolve(artifactRoot, `${scenario.id}.png`);
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
      results.push({
        id: scenario.id,
        status: 'failed',
        durationMs: Math.round(performance.now() - scenarioStarted),
        error: error instanceof Error ? error.message : String(error),
        screenshot,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (server.pid !== undefined) {
    process.kill(-server.pid, 'SIGTERM');
    await Promise.race([
      new Promise<void>((done) => server.once('exit', () => done())),
      Bun.sleep(5_000).then(() => {
        if (server.pid !== undefined && server.exitCode === null) process.kill(-server.pid, 'SIGKILL');
      }),
    ]);
  }
  server.stdout.destroy();
  server.stderr.destroy();
}
const failedIds = results.filter(({ status }) => status === 'failed').map(({ id }) => id);
const receipt: QaRunReceipt = {
  schemaVersion: 1,
  runId,
  gitSha,
  worktree,
  dirtyDigest: createHash('sha256').update(dirty).digest('hex'),
  buildIdentity,
  browserVersion: browser.version(),
  platform: `${process.platform}-${process.arch}`,
  shard: { index, total },
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  scenarios: results,
  rerunCommand: `bun qa run ${failedIds.map((id) => `--scenario ${id}`).join(' ') || selected.map(({ id }) => `--scenario ${id}`).join(' ')}`,
};
const receiptPath = resolve(artifactRoot, 'run.json');
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
for (const result of results)
  console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.id} (${result.durationMs}ms)`);
console.log(`receipt ${receiptPath}`);
if (failedIds.length > 0) process.exit(1);
