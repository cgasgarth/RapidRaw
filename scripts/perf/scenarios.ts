import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import { requestQaDaemon } from '../qa/daemon-client';
import { type QaDaemonMetrics, qaDaemonMetricsSchema } from '../qa/daemon-model';
import { readLiveDaemonState } from '../qa/daemon-state';
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

export const performanceScenarios: readonly PerformanceScenario[] = [
  previewScheduling,
  browserQaScenario('browser.editor-open', 'browser.editor.chrome'),
  browserQaScenario('browser.editor-compare', 'browser.editor.compare'),
  browserQaScenario('browser.editor-crop', 'browser.editor.crop'),
  browserQaScenario('browser.library-open', 'browser.library.open'),
];

export function getPerformanceScenario(id: string): PerformanceScenario {
  const scenario = performanceScenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Unknown performance scenario: ${id}`);
  return scenario;
}
