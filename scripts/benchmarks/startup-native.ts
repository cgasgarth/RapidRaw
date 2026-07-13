#!/usr/bin/env bun

import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { type StartupTraceSnapshot, startupTraceSnapshotSchema } from '../../src/utils/startup/startupTraceReporter.ts';
import {
  assertColdWarmInteractiveRegression,
  assertResponseDistribution,
  percentile95,
  resolveStartupHardwarePolicy,
} from './startup-hardware-class.ts';

const FIRST_PAINT_BUDGET_MS = 750;
const DEFAULT_PAIRS = 30;
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
if (!Number.isInteger(pairs) || pairs < 30 || pairs > 30) throw new Error('--pairs must be exactly 30.');
const hardwarePolicy = resolveStartupHardwarePolicy(
  valueAfter('--hardware-class') ?? process.env.RAWENGINE_STARTUP_HARDWARE_CLASS,
);

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

  const shellOrdered = [
    phase(snapshot, 'processStarted'),
    phase(snapshot, 'windowCreated'),
    phase(snapshot, 'windowVisible'),
    phase(snapshot, 'frontendShellVisible'),
    phase(snapshot, 'frontendInteractive'),
    phase(snapshot, 'frontendSettingsHydrated'),
    phase(snapshot, 'frontendLibraryReady'),
  ];
  for (let index = 1; index < shellOrdered.length; index += 1) {
    const previous = shellOrdered[index - 1];
    const current = shellOrdered[index];
    if (!previous || !current || previous.elapsedMs > current.elapsedMs) {
      throw new Error(`${kind}: startup phases are not monotonic at index ${index}`);
    }
  }
  const settings = phase(snapshot, 'minimalSettingsLoaded');
  if (
    settings.elapsedMs < phase(snapshot, 'processStarted').elapsedMs ||
    settings.elapsedMs > phase(snapshot, 'frontendSettingsHydrated').elapsedMs
  ) {
    throw new Error(`${kind}: minimal settings were not loaded between process start and frontend hydration`);
  }
  const shellDetail = phase(snapshot, 'frontendShellVisible').detail ?? '';
  const frontendReadyMatch = shellDetail.match(/frontend_ready_ms=(\d+)/u);
  const frontendReadyMs = frontendReadyMatch?.[1] === undefined ? Number.NaN : Number(frontendReadyMatch[1]);
  if (!Number.isFinite(frontendReadyMs)) throw new Error(`${kind}: frontend_ready response receipt is missing`);
  const visibleAt = phase(snapshot, 'windowVisible').elapsedMs;
  const interactiveAt = phase(snapshot, 'frontendInteractive').elapsedMs;
  for (const deferred of snapshot.phases.filter((entry) =>
    ['gpuReady', 'libraryServicesReady'].includes(entry.phase),
  )) {
    if (deferred.elapsedMs < visibleAt) throw new Error(`${kind}: ${deferred.phase} ran before WindowVisible`);
    if (deferred.elapsedMs < interactiveAt) {
      throw new Error(`${kind}: ${deferred.phase} completion gated the interactive shell receipt`);
    }
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
  for (const [name, service] of [
    ['gpuReady', 'gpu'],
    ['libraryServicesReady', 'lensfun'],
  ] as const) {
    const detail = phase(snapshot, name).detail ?? '';
    if (!detail.includes(`${service}:priority=editor_demand:starts=1`)) {
      throw new Error(`${kind}: ${service} editor-demand single-flight proof missing (${detail})`);
    }
  }
};

const assertHardwareClassDistribution = (runs: StartupRun[]): void => {
  const samples = runs
    .filter(({ kind }) => kind !== 'degraded')
    .map(({ kind, snapshot }) => {
      const rustEntryAt = phase(snapshot, 'processStarted').elapsedMs;
      return {
        appControlledInteractiveMs: phase(snapshot, 'frontendInteractive').elapsedMs - rustEntryAt,
        appControlledVisibleMs: phase(snapshot, 'windowVisible').elapsedMs - rustEntryAt,
        firstPaintMs: phase(snapshot, 'windowVisible').elapsedMs,
        frontendReadyResponseMs: Number(
          phase(snapshot, 'frontendShellVisible').detail?.match(/frontend_ready_ms=(\d+)/u)?.[1],
        ),
        interactionResponseMs:
          phase(snapshot, 'frontendInteractive').elapsedMs - phase(snapshot, 'frontendShellVisible').elapsedMs,
        kind,
      };
    });
  const distributions = new Map<'cold' | 'warm', { appControlledInteractiveMs: number }>();
  for (const kind of ['cold', 'warm'] as const) {
    const kindSamples = samples.filter((sample) => sample.kind === kind);
    if (kindSamples.length < 30) throw new Error(`${kind}: expected at least 30 startup samples`);
    const p95 = {
      appControlledInteractiveMs: percentile95(kindSamples.map((sample) => sample.appControlledInteractiveMs)),
      appControlledVisibleMs: percentile95(kindSamples.map((sample) => sample.appControlledVisibleMs)),
      firstPaintMs: percentile95(kindSamples.map((sample) => sample.firstPaintMs)),
      frontendReadyResponseMs: assertResponseDistribution(
        kindSamples.map((sample) => sample.frontendReadyResponseMs),
        hardwarePolicy.interactionResponseMs,
      ),
      interactionResponseMs: percentile95(kindSamples.map((sample) => sample.interactionResponseMs)),
    };
    if (
      p95.firstPaintMs > hardwarePolicy.firstPaintMs ||
      p95.appControlledVisibleMs > hardwarePolicy.appControlledVisibleMs ||
      p95.appControlledInteractiveMs > hardwarePolicy.appControlledInteractiveMs ||
      p95.interactionResponseMs > hardwarePolicy.interactionResponseMs
    ) {
      throw new Error(
        `${kind}: p95 startup distribution failed; p95=${JSON.stringify(p95)}; samples=${JSON.stringify(kindSamples)}`,
      );
    }
    distributions.set(kind, p95);
  }
  const cold = distributions.get('cold');
  const warm = distributions.get('warm');
  if (!cold || !warm) throw new Error('startup cold/warm distributions are incomplete');
  assertColdWarmInteractiveRegression(cold.appControlledInteractiveMs, warm.appControlledInteractiveMs, hardwarePolicy);
};

const waitForReport = async (path: string, process: Bun.Subprocess): Promise<StartupTraceSnapshot> => {
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      return startupTraceSnapshotSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if (process.exitCode !== null) {
        throw new Error(`RapidRAW exited before startup report (${process.exitCode})`, { cause: error });
      }
      await Bun.sleep(25);
    }
  }
  throw new Error(`Timed out after ${REPORT_TIMEOUT_MS}ms waiting for ${basename(path)}.`);
};

const collectOutput = async (stream: ReadableStream<Uint8Array> | number | undefined): Promise<string> => {
  if (!(stream instanceof ReadableStream)) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return `${output}${decoder.decode()}`.slice(-4_000);
    output = `${output}${decoder.decode(value, { stream: true })}`.slice(-4_000);
  }
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
  const processOriginEpochMs = Date.now();
  const process = Bun.spawn([binary], {
    env: {
      ...processEnv,
      HOME: home,
      RAWENGINE_STARTUP_BENCHMARK_REPORT: reportPath,
      RAWENGINE_STARTUP_INJECT_GPU_FAILURE: injectFailures ? '1' : '0',
      RAWENGINE_STARTUP_INJECT_LENSFUN_FAILURE: injectFailures ? '1' : '0',
      RAWENGINE_STARTUP_BENCHMARK_ORIGIN_EPOCH_MS: String(processOriginEpochMs),
      RAWENGINE_STARTUP_BENCHMARK_EDITOR_DEMAND: '1',
      RUST_LOG: 'warn',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const stderr = collectOutput(process.stderr);
  const stdout = collectOutput(process.stdout);
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
  } catch (error) {
    await stopProcess(process);
    const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr]);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}; child_stdout=${JSON.stringify(capturedStdout)}; child_stderr=${JSON.stringify(capturedStderr)}`,
      { cause: error },
    );
  } finally {
    await stopProcess(process);
    await Promise.all([stdout, stderr]);
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

    assertHardwareClassDistribution(runs);

    const traceIds = new Set(runs.map(({ snapshot }) => snapshot.traceId));
    if (traceIds.size !== runs.length) throw new Error('Startup benchmark reused a trace ID across processes.');
    const summary = runs.map(({ kind, snapshot }) => ({
      firstPaintMs: phase(snapshot, 'windowVisible').elapsedMs,
      absoluteTargetMet: snapshot.firstPaintBudgetMet,
      appControlledVisibleMs: phase(snapshot, 'windowVisible').elapsedMs - phase(snapshot, 'processStarted').elapsedMs,
      appControlledInteractiveMs:
        phase(snapshot, 'frontendInteractive').elapsedMs - phase(snapshot, 'processStarted').elapsedMs,
      frontendReadyMs: phase(snapshot, 'frontendShellVisible').elapsedMs,
      interactionResponseMs:
        phase(snapshot, 'frontendInteractive').elapsedMs - phase(snapshot, 'frontendShellVisible').elapsedMs,
      kind,
    }));
    console.log(
      `native startup benchmark ok (${runs.length} bounded runs; hardware_class=${hardwarePolicy.hardwareClass}): ${JSON.stringify(summary)}`,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

void main().catch((error: unknown) => {
  console.error('native startup benchmark failed');
  console.error(error);
  process.exitCode = 1;
});
