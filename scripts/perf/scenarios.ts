import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
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

const browserFixtureSources = ['../qa/scenarios.ts', '../../src/validation/browserTauriHarness.mts'].map((path) =>
  readFileSync(resolve(import.meta.dir, path)),
);
const browserFixtureDigest = (scenarioId: string) => {
  const hash = createHash('sha256').update(`browser-qa-fixture-v2:${scenarioId}\0`);
  for (const source of browserFixtureSources) hash.update(source).update('\0');
  return `sha256:${hash.digest('hex')}` as const;
};

const browserQaScenario = (id: string, qaScenarioId: string): PerformanceScenario => ({
  id,
  version: 1,
  fixtureDigest: browserFixtureDigest(qaScenarioId),
  cacheMode: 'cold',
  warmupRuns: 1,
  measuredRuns: 5,
  budgets: { interactionMs: { absolute: 200, relative: 0.15 } },
  maxRelativeMad: 0.35,
  metricUnits: { harnessSetupMs: 'ms', interactionMs: 'ms', processStarts: 'count' },
  async runSample() {
    const started = performance.now();
    const child = Bun.spawn(['bun', 'qa', 'run', '--scenario', qaScenarioId], {
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
    const receiptPath = stdout.match(/^receipt (.+)$/mu)?.[1];
    if (receiptPath === undefined) throw new Error(`${qaScenarioId} did not emit a QA receipt path.`);
    const receipt = qaReceiptSchema.parse(JSON.parse(await readFile(resolve(receiptPath), 'utf8')));
    const result = receipt.scenarios[0];
    if (result?.id !== qaScenarioId || result.status !== 'passed')
      throw new Error(`${qaScenarioId} terminal correctness failed: ${result?.error ?? result?.status ?? 'missing'}`);
    const elapsedMs = performance.now() - started;
    return {
      assertions: 3,
      metrics: {
        harnessSetupMs: Math.max(0, elapsedMs - result.durationMs),
        interactionMs: result.durationMs,
        processStarts: 2,
      },
      spans: [
        {
          source: 'runner',
          stage: 'qa.harness-setup',
          startOffsetMs: 0,
          durationMs: Math.max(0, elapsedMs - result.durationMs),
        },
        {
          source: 'qa-browser',
          stage: qaScenarioId,
          startOffsetMs: Math.max(0, elapsedMs - result.durationMs),
          durationMs: result.durationMs,
        },
      ],
    };
  },
});

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
