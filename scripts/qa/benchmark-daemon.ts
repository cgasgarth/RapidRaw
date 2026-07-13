#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { requestQaDaemon } from './daemon-client';
import { readLiveDaemonState } from './daemon-state';

const args = process.argv.slice(2);
const scenario = args[args.indexOf('--scenario') + 1] ?? 'browser.library.open';
const worktree = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel']).stdout.toString().trim();
const receiptSchema = z.object({
  scenarios: z.array(z.object({ id: z.string(), status: z.enum(['passed', 'failed']) })),
  metrics: z.object({
    serverStarts: z.number(),
    browserStarts: z.number(),
    contextsCreated: z.number(),
    contextsClosed: z.number(),
  }),
});

async function shutdownIfRunning(): Promise<void> {
  if ((await readLiveDaemonState(worktree)) === undefined) return;
  await requestQaDaemon(worktree, { id: crypto.randomUUID(), method: 'shutdown' });
  for (let attempt = 0; attempt < 100 && (await readLiveDaemonState(worktree)) !== undefined; attempt += 1) {
    await Bun.sleep(25);
  }
}

async function measure(persistent: boolean): Promise<{
  elapsedMs: number;
  receipt: z.infer<typeof receiptSchema>;
}> {
  const started = performance.now();
  const child = Bun.spawn(
    ['bun', 'scripts/qa/run.ts', ...(persistent ? ['--persistent'] : []), '--scenario', scenario],
    { cwd: worktree, stderr: 'pipe', stdout: 'pipe' },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`QA benchmark run failed:\n${stdout}\n${stderr}`);
  const receiptPath = stdout.match(/^receipt (.+?) starts=/mu)?.[1];
  if (receiptPath === undefined) throw new Error(`QA benchmark did not emit a receipt:\n${stdout}`);
  return {
    elapsedMs: Math.round(performance.now() - started),
    receipt: receiptSchema.parse(JSON.parse(await readFile(receiptPath, 'utf8'))),
  };
}

await shutdownIfRunning();
try {
  const oneShot = await measure(false);
  const persistentCold = await measure(true);
  const persistentWarm = await measure(true);
  const expected = oneShot.receipt.scenarios.map(({ id, status }) => ({ id, status }));
  for (const candidate of [persistentCold, persistentWarm]) {
    const actual = candidate.receipt.scenarios.map(({ id, status }) => ({ id, status }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('One-shot and persistent results differ.');
    if (candidate.receipt.metrics.contextsCreated !== candidate.receipt.metrics.contextsClosed) {
      throw new Error('Persistent benchmark leaked a browser context.');
    }
  }
  const warmRatio = persistentWarm.elapsedMs / oneShot.elapsedMs;
  console.log(
    JSON.stringify({
      scenario,
      oneShotMs: oneShot.elapsedMs,
      persistentColdMs: persistentCold.elapsedMs,
      persistentWarmMs: persistentWarm.elapsedMs,
      warmRatio: Number(warmRatio.toFixed(3)),
      serverStartsAfterWarmRun: persistentWarm.receipt.metrics.serverStarts,
      browserStartsAfterWarmRun: persistentWarm.receipt.metrics.browserStarts,
    }),
  );
  if (warmRatio > 0.75) throw new Error(`Persistent warm ratio ${warmRatio.toFixed(3)} exceeds the 0.750 budget.`);
} finally {
  await shutdownIfRunning();
}
