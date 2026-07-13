import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import { requestQaDaemon } from '../qa/daemon-client';
import { type QaDaemonMetrics, qaDaemonMetricsSchema } from '../qa/daemon-model';
import { readLiveDaemonState } from '../qa/daemon-state';
import {
  type NativeQaControlRecord,
  readLiveNativeQaControlRecord,
  requestNativeQaControl,
} from '../qa/native-control';
import type { PerformanceScenario } from './model';

const DISPATCHES = 20_000;
const MAX_LIGHT_INSTRUMENTATION_OVERHEAD_MS = 5;
const fixture = structuredClone(INITIAL_ADJUSTMENTS);
fixture.masks = Array.from({ length: 16 }, (_, index) => ({
  id: `perf-mask-${index}`,
  name: `Performance mask ${index}`,
  enabled: true,
  adjustments: {},
  subMasks: [],
})) as typeof fixture.masks;
const snapshot = publishAdjustmentSnapshot(null, fixture);
const fixtureDigest = `sha256:${createHash('sha256').update(JSON.stringify(fixture)).digest('hex')}` as const;

const previewScheduling: PerformanceScenario = {
  id: 'editor.preview-scheduling',
  version: 1,
  fixtureDigest,
  cacheMode: 'warm',
  warmupRuns: 2,
  measuredRuns: 9,
  budgets: {
    interactionDispatchMs: { absolute: 0.25, relative: 0.15 },
    snapshotInstrumentationOverheadMs: { absolute: 1, relative: 0.25 },
  },
  maxRelativeMad: 0.35,
  metricUnits: {
    controlDispatchMs: 'ms',
    cpuMs: 'ms',
    dispatches: 'count',
    filesystemReadOps: 'count',
    filesystemWriteOps: 'count',
    interactionDispatchMs: 'ms',
    residentBytes: 'bytes',
    snapshotInstrumentationOverheadMs: 'ms',
  },
  async runSample(run) {
    const resourceBefore = process.resourceUsage();
    let controlSink = 0;
    const controlStarted = performance.now();
    for (let index = 0; index < DISPATCHES; index += 1)
      controlSink += snapshot.adjustmentRevision + index + snapshot.patchRevision;
    const controlDispatchMs = performance.now() - controlStarted;
    let sink = 0;
    const started = performance.now();
    for (let index = 0; index < DISPATCHES; index += 1) {
      const request = {
        snapshot,
        scope: [run, snapshot.adjustmentRevision, snapshot.geometryRevision, index, 2048, 'wgpu'] as const,
      };
      sink += request.scope[1] + request.scope[3] + request.snapshot.patchRevision;
    }
    const interactionDispatchMs = performance.now() - started;
    const expected =
      DISPATCHES * (snapshot.adjustmentRevision + snapshot.patchRevision) + (DISPATCHES * (DISPATCHES - 1)) / 2;
    if (sink !== expected || controlSink !== expected)
      throw new Error(`Preview scheduling correctness sink mismatch: ${sink}/${controlSink} != ${expected}.`);
    const snapshotInstrumentationOverheadMs = Math.max(0, interactionDispatchMs - controlDispatchMs);
    const resourceAfter = process.resourceUsage();
    if (snapshotInstrumentationOverheadMs > MAX_LIGHT_INSTRUMENTATION_OVERHEAD_MS)
      throw new Error(
        `Light snapshot instrumentation overhead ${snapshotInstrumentationOverheadMs.toFixed(3)}ms exceeded ${MAX_LIGHT_INSTRUMENTATION_OVERHEAD_MS}ms.`,
      );
    return {
      assertions: 2,
      metrics: {
        controlDispatchMs,
        cpuMs:
          Math.max(0, resourceAfter.userCPUTime - resourceBefore.userCPUTime) / 1_000 +
          Math.max(0, resourceAfter.systemCPUTime - resourceBefore.systemCPUTime) / 1_000,
        dispatches: DISPATCHES,
        filesystemReadOps: Math.max(0, resourceAfter.fsRead - resourceBefore.fsRead),
        filesystemWriteOps: Math.max(0, resourceAfter.fsWrite - resourceBefore.fsWrite),
        interactionDispatchMs,
        residentBytes: process.memoryUsage().rss,
        snapshotInstrumentationOverheadMs,
      },
      spans: [
        { source: 'frontend', stage: 'preview.control-dispatch', startOffsetMs: 0, durationMs: controlDispatchMs },
        {
          source: 'frontend',
          stage: 'preview.instrumented-dispatch',
          startOffsetMs: controlDispatchMs,
          durationMs: interactionDispatchMs,
        },
      ],
    };
  },
};

const qaReceiptSchema = z.object({
  metrics: qaDaemonMetricsSchema,
  scenarios: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(['passed', 'failed']),
        durationMs: z.number().int().positive(),
        error: z.string().optional(),
      }),
    )
    .length(1),
});

const daemonHealthSchema = z.object({ metrics: qaDaemonMetricsSchema });
const emptyDaemonMetrics = (): QaDaemonMetrics => ({
  artifactBytes: 0,
  browserStarts: 0,
  browserStartsAvoided: 0,
  configurationRestarts: 0,
  contextsClosed: 0,
  contextsCreated: 0,
  jobs: 0,
  leakedContexts: 0,
  scenarioMs: 0,
  serverStarts: 0,
  serverStartsAvoided: 0,
  sessionRecoveries: 0,
  setupMs: 0,
  sourceRefreshes: 0,
  sourceReuses: 0,
  worktreeWaitMs: 0,
});
const subtractDaemonMetrics = (current: QaDaemonMetrics, prior: QaDaemonMetrics): QaDaemonMetrics => ({
  artifactBytes: Math.max(0, current.artifactBytes - prior.artifactBytes),
  browserStarts: Math.max(0, current.browserStarts - prior.browserStarts),
  browserStartsAvoided: Math.max(0, current.browserStartsAvoided - prior.browserStartsAvoided),
  configurationRestarts: Math.max(0, current.configurationRestarts - prior.configurationRestarts),
  contextsClosed: Math.max(0, current.contextsClosed - prior.contextsClosed),
  contextsCreated: Math.max(0, current.contextsCreated - prior.contextsCreated),
  jobs: Math.max(0, current.jobs - prior.jobs),
  leakedContexts: Math.max(0, current.leakedContexts - prior.leakedContexts),
  scenarioMs: Math.max(0, current.scenarioMs - prior.scenarioMs),
  serverStarts: Math.max(0, current.serverStarts - prior.serverStarts),
  serverStartsAvoided: Math.max(0, current.serverStartsAvoided - prior.serverStartsAvoided),
  sessionRecoveries: Math.max(0, current.sessionRecoveries - prior.sessionRecoveries),
  setupMs: Math.max(0, current.setupMs - prior.setupMs),
  sourceRefreshes: Math.max(0, current.sourceRefreshes - prior.sourceRefreshes),
  sourceReuses: Math.max(0, current.sourceReuses - prior.sourceReuses),
  worktreeWaitMs: Math.max(0, current.worktreeWaitMs - prior.worktreeWaitMs),
});

const browserFixtureSources = [
  '../qa/fixtures.ts',
  '../qa/scenarios.ts',
  '../../src/validation/browserTauriHarness.mts',
].map((path) => readFileSync(resolve(import.meta.dir, path)));
const browserFixtureDigest = (scenarioId: string) => {
  const hash = createHash('sha256').update(`browser-qa-fixture-v2:${scenarioId}\0`);
  for (const source of browserFixtureSources) hash.update(source).update('\0');
  return `sha256:${hash.digest('hex')}` as const;
};

const browserQaScenario = (id: string, qaScenarioId: string): PerformanceScenario => {
  const worktree = process.cwd();
  let daemonProcess: ReturnType<typeof Bun.spawn> | undefined;
  let startedDaemon = false;
  let previousMetrics = emptyDaemonMetrics();
  return {
    id,
    version: 1,
    fixtureDigest: browserFixtureDigest(qaScenarioId),
    cacheMode: 'cold',
    warmupRuns: 1,
    measuredRuns: 5,
    budgets: { interactionMs: { absolute: 200, relative: 0.15 } },
    maxRelativeMad: 0.35,
    metricUnits: {
      artifactBytes: 'bytes',
      contextsClosed: 'count',
      contextsCreated: 'count',
      harnessSetupMs: 'ms',
      interactionMs: 'ms',
      leakedContexts: 'count',
      processStarts: 'count',
      processStartsAvoided: 'count',
      runnerOverheadMs: 'ms',
      sessionRecoveries: 'count',
      sourceRefreshes: 'count',
      sourceReuses: 'count',
      worktreeWaitMs: 'ms',
    },
    async beforeAll() {
      if ((await readLiveDaemonState(worktree)) === undefined) {
        daemonProcess = Bun.spawn(['bun', 'scripts/qa/daemon.ts'], {
          cwd: worktree,
          stderr: 'ignore',
          stdout: 'ignore',
        });
        startedDaemon = true;
        for (let attempt = 0; attempt < 200 && (await readLiveDaemonState(worktree)) === undefined; attempt += 1)
          await Bun.sleep(25);
        if ((await readLiveDaemonState(worktree)) === undefined) throw new Error('Persistent QA daemon did not start.');
      }
      const health = await requestQaDaemon(worktree, { id: crypto.randomUUID(), method: 'health' });
      if (!health.ok) throw new Error(health.error ?? 'Persistent QA daemon health failed.');
      previousMetrics = daemonHealthSchema.parse(health.result).metrics;
    },
    async afterAll() {
      if (!startedDaemon) return;
      const shutdown = await requestQaDaemon(worktree, { id: crypto.randomUUID(), method: 'shutdown' });
      if (!shutdown.ok) throw new Error(shutdown.error ?? 'Persistent QA daemon shutdown failed.');
      if (daemonProcess !== undefined)
        await Promise.race([
          daemonProcess.exited,
          Bun.sleep(15_000).then(() => {
            throw new Error('Persistent QA daemon did not exit after shutdown.');
          }),
        ]);
    },
    async runSample() {
      const started = performance.now();
      const child = Bun.spawn(['bun', 'qa', 'run', '--persistent', '--scenario', qaScenarioId], {
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) throw new Error(`${qaScenarioId} failed:\n${`${stdout}\n${stderr}`.trim().slice(-8_000)}`);
      const receiptPath = stdout.match(/^receipt (.+?)(?: starts=|$)/mu)?.[1];
      if (receiptPath === undefined) throw new Error(`${qaScenarioId} did not emit a QA receipt path.`);
      const receipt = qaReceiptSchema.parse(JSON.parse(await readFile(resolve(receiptPath), 'utf8')));
      const result = receipt.scenarios[0];
      if (result?.id !== qaScenarioId || result.status !== 'passed')
        throw new Error(`${qaScenarioId} terminal correctness failed: ${result?.error ?? result?.status ?? 'missing'}`);
      const elapsedMs = performance.now() - started;
      const metrics = subtractDaemonMetrics(receipt.metrics, previousMetrics);
      previousMetrics = receipt.metrics;
      if (metrics.contextsCreated !== metrics.contextsClosed || metrics.leakedContexts !== 0)
        throw new Error(
          `${qaScenarioId} leaked browser contexts: ${metrics.contextsClosed}/${metrics.contextsCreated}, leaked=${metrics.leakedContexts}.`,
        );
      const harnessSetupMs = metrics.setupMs;
      return {
        assertions: 5,
        metrics: {
          artifactBytes: metrics.artifactBytes,
          contextsClosed: metrics.contextsClosed,
          contextsCreated: metrics.contextsCreated,
          harnessSetupMs,
          interactionMs: result.durationMs,
          leakedContexts: metrics.leakedContexts,
          processStarts: metrics.serverStarts + metrics.browserStarts,
          processStartsAvoided: metrics.serverStartsAvoided + metrics.browserStartsAvoided,
          runnerOverheadMs: Math.max(0, elapsedMs - result.durationMs - harnessSetupMs),
          sessionRecoveries: metrics.sessionRecoveries,
          sourceRefreshes: metrics.sourceRefreshes,
          sourceReuses: metrics.sourceReuses,
          worktreeWaitMs: metrics.worktreeWaitMs,
        },
        spans: [
          {
            source: 'runner',
            stage: 'qa.harness-setup',
            startOffsetMs: 0,
            durationMs: harnessSetupMs,
          },
          {
            source: 'qa-browser',
            stage: qaScenarioId,
            startOffsetMs: harnessSetupMs,
            durationMs: result.durationMs,
          },
        ],
      };
    },
  };
};

const nativeResourceSchema = z.object({
  peakResidentBytes: z.number().nonnegative(),
  filesystemReadOps: z.number().nonnegative(),
  filesystemWriteOps: z.number().nonnegative(),
  userCpuMicros: z.number().nonnegative(),
  systemCpuMicros: z.number().nonnegative(),
});
const nativeSchedulerSchema = z.object({
  interactiveSubmissions: z.number().nonnegative(),
  settledSubmissions: z.number().nonnegative(),
  pendingReplacements: z.number().nonnegative(),
  activeCancellations: z.number().nonnegative(),
  renderedInteractive: z.number().nonnegative(),
  renderedSettled: z.number().nonnegative(),
  maxResidentRequests: z.number().nonnegative(),
});
const nativeDiagnosticsSchema = z.object({
  activeNativeSource: z.string().nullable(),
  cache: z.object({ total_known_cpu_cache_bytes: z.number().nonnegative() }),
  cacheMode: z.enum(['cold', 'warm']),
  processResources: nativeResourceSchema,
  scheduler: nativeSchedulerSchema.nullable(),
  sessionRevision: z.number().int().nonnegative(),
  renderRevision: z.number().int().nonnegative(),
  preview: z
    .object({
      backendGeneration: z.number().nonnegative(),
      height: z.number().positive(),
      imageSession: z.number().int().positive(),
      source: z.string().min(1),
      width: z.number().positive(),
    })
    .nullable(),
  gpuExecution: z
    .object({
      blurDispatchCount: z.number().nonnegative(),
      commandBufferCount: z.number().nonnegative(),
      cpuEncodeMicros: z.number().nonnegative(),
      estimatedPeakResourceBytes: z.number().nonnegative(),
      executionSequence: z.number().int().nonnegative(),
      graphFingerprint: z.number().nonnegative(),
      queueSubmitCount: z.number().nonnegative(),
      renderPassCount: z.number().nonnegative(),
      stageBits: z.number().nonnegative(),
    })
    .nullable(),
});

const subtractNativeResources = (
  current: z.infer<typeof nativeResourceSchema>,
  prior: z.infer<typeof nativeResourceSchema>,
) => ({
  filesystemReadOps: Math.max(0, current.filesystemReadOps - prior.filesystemReadOps),
  filesystemWriteOps: Math.max(0, current.filesystemWriteOps - prior.filesystemWriteOps),
  peakResidentBytes: current.peakResidentBytes,
  systemCpuMicros: Math.max(0, current.systemCpuMicros - prior.systemCpuMicros),
  userCpuMicros: Math.max(0, current.userCpuMicros - prior.userCpuMicros),
});

const subtractNativeScheduler = (
  current: z.infer<typeof nativeSchedulerSchema> | null,
  prior: z.infer<typeof nativeSchedulerSchema> | null,
) => {
  const empty = {
    activeCancellations: 0,
    interactiveSubmissions: 0,
    maxResidentRequests: 0,
    pendingReplacements: 0,
    renderedInteractive: 0,
    renderedSettled: 0,
    settledSubmissions: 0,
  };
  const after = current ?? empty;
  const before = prior ?? empty;
  return {
    activeCancellations: Math.max(0, after.activeCancellations - before.activeCancellations),
    interactiveSubmissions: Math.max(0, after.interactiveSubmissions - before.interactiveSubmissions),
    maxResidentRequests: after.maxResidentRequests,
    pendingReplacements: Math.max(0, after.pendingReplacements - before.pendingReplacements),
    renderedInteractive: Math.max(0, after.renderedInteractive - before.renderedInteractive),
    renderedSettled: Math.max(0, after.renderedSettled - before.renderedSettled),
    settledSubmissions: Math.max(0, after.settledSubmissions - before.settledSubmissions),
  };
};

const nativeFixture = process.env.RAWENGINE_PERF_NATIVE_FIXTURE;
const nativeFixtureDigest = `sha256:${createHash('sha256')
  .update(
    nativeFixture !== undefined && isAbsolute(nativeFixture)
      ? readFileSync(nativeFixture)
      : Buffer.from('native-private-fixture-unconfigured'),
  )
  .digest('hex')}` as const;

const nativeRawOpenScenario = (cacheMode: 'cold' | 'warm'): PerformanceScenario => {
  const worktree = process.cwd();
  const recordPath = resolve('private-artifacts/qa/native-control.json');
  let record: NativeQaControlRecord | undefined;
  const required = async (method: string, parameters: Readonly<Record<string, unknown>> = {}) => {
    if (record === undefined) throw new Error('Native performance control record is unavailable.');
    const response = await requestNativeQaControl(record, method, parameters);
    if (!response.ok) throw new Error(`${method} failed: ${response.error ?? 'unknown error'}`);
    return response.result;
  };
  return {
    id: `native.editor-raw-open-${cacheMode}`,
    version: 1,
    fixtureDigest: nativeFixtureDigest,
    cacheMode,
    warmupRuns: 1,
    measuredRuns: 5,
    budgets: { interactionMs: { absolute: 250, relative: 0.15 } },
    maxRelativeMad: 0.5,
    metricUnits: {
      activeCancellations: 'count',
      backendGeneration: 'count',
      cacheKnownCpuBytes: 'bytes',
      commandBufferCount: 'count',
      cpuMs: 'ms',
      estimatedGpuResourceBytes: 'bytes',
      filesystemReadOps: 'count',
      filesystemWriteOps: 'count',
      interactionMs: 'ms',
      pendingReplacements: 'count',
      pixels: 'count',
      queueSubmitCount: 'count',
      renderPassCount: 'count',
      peakResidentBytes: 'bytes',
      sourceBytes: 'bytes',
    },
    async beforeAll() {
      if (nativeFixture === undefined || !isAbsolute(nativeFixture))
        throw new Error('RAWENGINE_PERF_NATIVE_FIXTURE must be an absolute private RAW path.');
      await stat(nativeFixture);
      const launcherArgs = ['scripts/dev/start-native-qa-app.ts', '--validation-harness'];
      if (process.env.RAWENGINE_PERF_NATIVE_NO_BUILD === '1') launcherArgs.push('--no-build');
      const launcher = Bun.spawn(['bun', ...launcherArgs], {
        cwd: worktree,
        stderr: 'pipe',
        stdout: 'pipe',
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(launcher.stdout).text(),
        new Response(launcher.stderr).text(),
        launcher.exited,
      ]);
      if (exitCode !== 0)
        throw new Error(`Native performance launcher failed:\n${`${stdout}\n${stderr}`.trim().slice(-8_000)}`);
      record = await readLiveNativeQaControlRecord(recordPath, worktree);
      if (record === undefined) throw new Error('Native performance control record did not become live.');
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const health = await requestNativeQaControl(record, 'health').catch(() => undefined);
        if (health?.ok && z.object({ ready: z.literal(true) }).safeParse(health.result).success) {
          await Bun.sleep(500);
          return;
        }
        await Bun.sleep(50);
      }
      throw new Error('Native performance app did not become frontend-ready.');
    },
    async afterAll() {
      if (record === undefined) return;
      await required('shutdown');
      for (let attempt = 0; attempt < 400; attempt += 1) {
        if ((await readLiveNativeQaControlRecord(recordPath, worktree)) === undefined) return;
        await Bun.sleep(25);
      }
      throw new Error('Native performance app did not shut down cleanly.');
    },
    async runSample() {
      if (nativeFixture === undefined) throw new Error('Native performance fixture missing.');
      await required('reset', { mode: 'empty' });
      await required('setCacheMode', { mode: cacheMode });
      const before = nativeDiagnosticsSchema.parse(await required('diagnostics'));
      const started = performance.now();
      const opened = z
        .object({ path: z.string(), sessionRevision: z.number().int().positive() })
        .parse(await required('openFixture', { path: nativeFixture }));
      let after: z.infer<typeof nativeDiagnosticsSchema> | undefined;
      for (let attempt = 0; attempt < 800; attempt += 1) {
        after = nativeDiagnosticsSchema.parse(await required('diagnostics'));
        if (
          after.activeNativeSource === opened.path &&
          after.preview?.source === opened.path &&
          (after.gpuExecution?.executionSequence ?? 0) > (before.gpuExecution?.executionSequence ?? 0) &&
          after.gpuExecution !== null
        )
          break;
        await Bun.sleep(25);
      }
      const interactionMs = performance.now() - started;
      if (
        after === undefined ||
        after.activeNativeSource !== opened.path ||
        after.preview?.source !== opened.path ||
        after.gpuExecution === null ||
        after.gpuExecution.executionSequence <= (before.gpuExecution?.executionSequence ?? 0)
      )
        throw new Error('Native RAW open did not reach an authoritative preview with a GPU execution receipt.');
      const resources = subtractNativeResources(after.processResources, before.processResources);
      const scheduler = subtractNativeScheduler(after.scheduler, before.scheduler);
      const sourceBytes = (await stat(nativeFixture)).size;
      const gpu = after.gpuExecution;
      return {
        assertions: 6,
        metrics: {
          activeCancellations: scheduler.activeCancellations,
          backendGeneration: after.preview.backendGeneration,
          cacheKnownCpuBytes: after.cache.total_known_cpu_cache_bytes,
          commandBufferCount: gpu.commandBufferCount,
          cpuMs: (resources.userCpuMicros + resources.systemCpuMicros) / 1_000,
          estimatedGpuResourceBytes: gpu.estimatedPeakResourceBytes,
          filesystemReadOps: resources.filesystemReadOps,
          filesystemWriteOps: resources.filesystemWriteOps,
          interactionMs,
          pendingReplacements: scheduler.pendingReplacements,
          pixels: after.preview.width * after.preview.height,
          queueSubmitCount: gpu.queueSubmitCount,
          renderPassCount: gpu.renderPassCount,
          peakResidentBytes: resources.peakResidentBytes,
          sourceBytes,
        },
        spans: [
          { source: 'native', stage: 'raw-open-to-authoritative-preview', startOffsetMs: 0, durationMs: interactionMs },
          {
            source: 'gpu',
            stage: 'command-encode',
            startOffsetMs: Math.max(0, interactionMs - gpu.cpuEncodeMicros / 1_000),
            durationMs: gpu.cpuEncodeMicros / 1_000,
          },
          { source: 'io', stage: 'source-observed', startOffsetMs: 0, durationMs: 0 },
        ],
      };
    },
  };
};

export const performanceScenarios: readonly PerformanceScenario[] = [
  previewScheduling,
  browserQaScenario('browser.editor-open', 'browser.editor.chrome'),
  browserQaScenario('browser.editor-navigation', 'browser.editor.navigation'),
  browserQaScenario('browser.editor-culling-navigation', 'browser.editor.culling-navigation'),
  browserQaScenario('browser.editor-exposure-flood', 'browser.editor.exposure-flood'),
  browserQaScenario('browser.editor-pan-zoom', 'browser.editor.pan-zoom'),
  browserQaScenario('browser.editor-compare', 'browser.editor.compare'),
  browserQaScenario('browser.editor-crop', 'browser.editor.crop'),
  browserQaScenario('browser.editor-copy-paste-settings', 'browser.editor.copy-paste-settings'),
  browserQaScenario('browser.library-open', 'browser.library.open'),
  nativeRawOpenScenario('cold'),
  nativeRawOpenScenario('warm'),
];

export function getPerformanceScenario(id: string): PerformanceScenario {
  const scenario = performanceScenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Unknown performance scenario: ${id}`);
  return scenario;
}
