#!/usr/bin/env bun

import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { type StartupTraceSnapshot, startupTraceSnapshotSchema } from '../../src/utils/startup/startupTraceReporter.ts';

const FIRST_PAINT_BUDGET_MS = 750;
const DEFAULT_PAIRS = 2;
const REPORT_TIMEOUT_MS = 20_000;

interface StartupRun {
  kind: 'cold' | 'degraded' | 'warm';
  snapshot: StartupTraceSnapshot;
}

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const binaryArg = valueAfter('--binary');
if (!binaryArg) throw new Error('Missing --binary <RapidRAW executable>.');
const binary = resolve(binaryArg);
const pairs = Number.parseInt(valueAfter('--pairs') ?? String(DEFAULT_PAIRS), 10);
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 5) throw new Error('--pairs must be an integer from 1 through 5.');

const phase = (snapshot: StartupTraceSnapshot, name: StartupTraceSnapshot['phases'][number]['phase']) => {
  const receipt = snapshot.phases.find((entry) => entry.phase === name);
  if (!receipt) throw new Error(`${snapshot.traceId}: missing startup phase ${name}`);
  return receipt;
};

const traceDiagnostic = (snapshot: StartupTraceSnapshot): string =>
  JSON.stringify({
    firstPaintBudgetMet: snapshot.firstPaintBudgetMet,
    firstPaintBudgetMs: snapshot.firstPaintBudgetMs,
    phases: snapshot.phases.map(({ detail, elapsedMs, phase: name, status }) => ({ detail, elapsedMs, name, status })),
    processId: snapshot.processId,
    traceId: snapshot.traceId,
  });

const assertTrace = (run: StartupRun): void => {
  const { kind, snapshot } = run;
  if (!snapshot.criticalPathOrderValid) throw new Error(`${kind}: native critical-path ordering failed`);
  if (snapshot.firstPaintBudgetMs !== FIRST_PAINT_BUDGET_MS) {
    throw new Error(`${kind}: unexpected first-paint budget ${snapshot.firstPaintBudgetMs}`);
  }
  if (snapshot.firstPaintBudgetMet !== true) {
    throw new Error(
      `${kind}: first-paint budget missed (${phase(snapshot, 'windowVisible').elapsedMs}ms/${FIRST_PAINT_BUDGET_MS}ms)`,
    );
  }

  const ordered = [
    phase(snapshot, 'processStarted'),
    phase(snapshot, 'minimalSettingsLoaded'),
    phase(snapshot, 'windowCreated'),
    phase(snapshot, 'windowVisible'),
    phase(snapshot, 'frontendShellVisible'),
    phase(snapshot, 'frontendSettingsHydrated'),
    phase(snapshot, 'frontendLibraryReady'),
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current || previous.elapsedMs > current.elapsedMs) {
      throw new Error(`${kind}: startup phases are not monotonic at index ${index}`);
    }
  }
  if (phase(snapshot, 'windowVisible').elapsedMs > FIRST_PAINT_BUDGET_MS) {
    throw new Error(`${kind}: WindowVisible exceeded ${FIRST_PAINT_BUDGET_MS}ms`);
  }
  const visibleAt = phase(snapshot, 'windowVisible').elapsedMs;
  for (const deferred of snapshot.phases.filter((entry) =>
    ['gpuReady', 'libraryServicesReady'].includes(entry.phase),
  )) {
    if (deferred.elapsedMs < visibleAt) throw new Error(`${kind}: ${deferred.phase} ran before WindowVisible`);
  }

  if (kind === 'degraded') {
    for (const [name, service] of [
      ['gpuReady', 'gpu'],
      ['libraryServicesReady', 'lensfun'],
    ] as const) {
      const receipt = phase(snapshot, name);
      if (receipt.status !== 'degraded' || !receipt.detail?.includes(`injected ${service}`)) {
        throw new Error(`degraded: ${service} did not produce the injected degraded receipt`);
      }
    }
  }
};

const waitForReport = async (path: string, process: Bun.Subprocess): Promise<StartupTraceSnapshot> => {
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      return startupTraceSnapshotSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if (process.exitCode !== null) {
        const stderr = process.stderr instanceof ReadableStream ? await new Response(process.stderr).text() : '';
        throw new Error(`RapidRAW exited before startup report (${process.exitCode}): ${stderr.slice(-2_000)}`, {
          cause: error,
        });
      }
      await Bun.sleep(25);
    }
  }
  throw new Error(`Timed out after ${REPORT_TIMEOUT_MS}ms waiting for ${basename(path)}.`);
};

const stopProcess = async (process: Bun.Subprocess): Promise<void> => {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  const exited = await Promise.race([process.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
  if (!exited && process.exitCode === null) {
    process.kill('SIGKILL');
    await process.exited;
  }
};

const runOnce = async ({
  home,
  injectFailures,
  kind,
  reportPath,
}: {
  home: string;
  injectFailures: boolean;
  kind: StartupRun['kind'];
  reportPath: string;
}): Promise<StartupRun> => {
  await rm(reportPath, { force: true });
  const process = Bun.spawn([binary], {
    env: {
      ...processEnv,
      HOME: home,
      RAWENGINE_STARTUP_BENCHMARK_REPORT: reportPath,
      RAWENGINE_STARTUP_INJECT_GPU_FAILURE: injectFailures ? '1' : '0',
      RAWENGINE_STARTUP_INJECT_LENSFUN_FAILURE: injectFailures ? '1' : '0',
      RUST_LOG: 'warn',
    },
    stderr: 'pipe',
    stdout: 'ignore',
  });
  try {
    const run = { kind, snapshot: await waitForReport(reportPath, process) };
    if (run.snapshot.processId !== process.pid) {
      throw new Error(
        `${kind}: startup report PID ${run.snapshot.processId} did not match launched child PID ${process.pid}`,
      );
    }
    try {
      assertTrace(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}; startup_trace=${traceDiagnostic(run.snapshot)}`, { cause: error });
    }
    return run;
  } finally {
    await stopProcess(process);
  }
};

const processEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

const main = async (): Promise<void> => {
  await access(binary);
  const root = await mkdtemp(join(tmpdir(), 'rawengine-startup-benchmark-'));
  const runs: StartupRun[] = [];

  try {
    for (let pair = 0; pair < pairs; pair += 1) {
      const home = join(root, `pair-${pair}`, 'home');
      await mkdir(home, { recursive: true });
      runs.push(
        await runOnce({
          home,
          injectFailures: false,
          kind: 'cold',
          reportPath: join(root, `cold-${pair}.json`),
        }),
      );
      runs.push(
        await runOnce({
          home,
          injectFailures: false,
          kind: 'warm',
          reportPath: join(root, `warm-${pair}.json`),
        }),
      );
    }

    const degradedHome = join(root, 'degraded', 'home');
    await mkdir(degradedHome, { recursive: true });
    runs.push(
      await runOnce({
        home: degradedHome,
        injectFailures: true,
        kind: 'degraded',
        reportPath: join(root, 'degraded.json'),
      }),
    );

    const traceIds = new Set(runs.map(({ snapshot }) => snapshot.traceId));
    if (traceIds.size !== runs.length) throw new Error('Startup benchmark reused a trace ID across processes.');
    const summary = runs.map(({ kind, snapshot }) => ({
      firstPaintMs: phase(snapshot, 'windowVisible').elapsedMs,
      frontendReadyMs: phase(snapshot, 'frontendShellVisible').elapsedMs,
      kind,
    }));
    console.log(`native startup benchmark ok (${runs.length} bounded runs): ${JSON.stringify(summary)}`);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

void main().catch((error: unknown) => {
  console.error('native startup benchmark failed');
  console.error(error);
  process.exitCode = 1;
});
