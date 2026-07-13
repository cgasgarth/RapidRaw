#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type BrowserJobResult, browserJobResultSchema, createBrowserLifecycleAdapter } from './browser-session';
import { requestQaDaemon } from './daemon-client';
import { QaDaemonEngine } from './daemon-engine';
import { type QaDaemonMetrics, qaDaemonMetricsSchema } from './daemon-model';
import { readLiveDaemonState } from './daemon-state';
import { createQaDaemonIdentity } from './identity';
import { selectImpactedScenarioIds } from './impacted';
import type { QaRunReceipt } from './model';
import { selectScenarios, shardScenarios } from './planner';
import { qaScenarios } from './scenarios';

const args = process.argv.slice(2);
const worktree = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel']).stdout.toString().trim();
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

if (args[0] === 'daemon') {
  const method = args[1] === 'shutdown' ? 'shutdown' : 'health';
  if (method === 'shutdown' && (await readLiveDaemonState(worktree)) === undefined) {
    console.log('QA daemon is not running.');
  } else {
    const response = await requestQaDaemon(worktree, { id: crypto.randomUUID(), method });
    console.log(JSON.stringify(response.result));
    if (!response.ok) throw new Error(response.error ?? `QA daemon ${method} failed.`);
  }
  process.exit(0);
}

if (args[0] === 'benchmark') {
  const child = Bun.spawn(['bun', 'scripts/qa/benchmark-daemon.ts', ...args.slice(1)], {
    cwd: worktree,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  process.exit(await child.exited);
}

const total = Number(value('--shard-total') ?? '1');
const index = Number(value('--shard-index') ?? '0');
const gitSha = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
const dirty = Bun.spawnSync(['git', 'status', '--porcelain=v1']).stdout.toString();
const startedAt = new Date();
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
const selection = selectScenarios(qaScenarios, {
  ids: [...list('--scenario'), ...impactedIds],
  tags: list('--tag'),
});
const selected = shardScenarios(selection, index, total);
const scenarioIds = selection.map(({ id }) => id);
const identity = await createQaDaemonIdentity(worktree, args.includes('--headed'));
const runId = `${startedAt.toISOString().replaceAll(/[:.]/gu, '-')}-${gitSha.slice(0, 8)}-s${index}`;
const artifactRoot = resolve('private-artifacts/qa', runId);
await mkdir(artifactRoot, { recursive: true });

let jobResult: BrowserJobResult;
let metrics: QaDaemonMetrics;
if (args.includes('--persistent')) {
  const response = await requestQaDaemon(worktree, {
    id: crypto.randomUUID(),
    method: 'run',
    identity,
    scenarioIds,
    shard: { index, total },
  });
  if (!response.ok) throw new Error(response.error ?? 'QA daemon request failed.');
  const result = response.result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('results' in result) ||
    !('browserVersion' in result) ||
    !('metrics' in result)
  ) {
    throw new Error('QA daemon returned an invalid run result.');
  }
  jobResult = browserJobResultSchema.parse(result);
  metrics = qaDaemonMetricsSchema.parse(result.metrics);
} else {
  const engine = new QaDaemonEngine(worktree, createBrowserLifecycleAdapter(artifactRoot));
  try {
    jobResult = await engine.run(identity, { scenarioIds, shard: { index, total } });
    metrics = { ...engine.metrics };
  } finally {
    await engine.close();
  }
}

const failedIds = jobResult.results.filter(({ status }) => status === 'failed').map(({ id }) => id);
const receipt: QaRunReceipt = {
  schemaVersion: 1,
  runId,
  gitSha,
  worktree,
  dirtyDigest: createHash('sha256').update(dirty).digest('hex'),
  buildIdentity: identity.configuration,
  browserVersion: jobResult.browserVersion,
  platform: `${process.platform}-${process.arch}`,
  shard: { index, total },
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  scenarios: jobResult.results,
  metrics,
  rerunCommand: `bun qa run ${args.includes('--persistent') ? '--persistent ' : ''}${(failedIds.length > 0 ? failedIds : selected.map(({ id }) => id)).map((id) => `--scenario ${id}`).join(' ')}`,
};
const receiptPath = resolve(artifactRoot, 'run.json');
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
for (const result of jobResult.results)
  console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.id} (${result.durationMs}ms)`);
console.log(
  `receipt ${receiptPath} starts=${metrics.serverStarts}/${metrics.browserStarts} reused=${metrics.sourceReuses} contexts=${metrics.contextsClosed}/${metrics.contextsCreated}`,
);
if (failedIds.length > 0) process.exit(1);
