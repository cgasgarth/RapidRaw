import { describe, expect, test } from 'bun:test';
import { capturePerformanceIdentity } from '../../scripts/perf/identity';
import type { PerformanceIdentity, PerformanceScenario } from '../../scripts/perf/model';
import { performanceRunReceiptSchema } from '../../scripts/perf/model';
import { bisectExitCode, comparePerformanceReceipts, runPerformanceScenario } from '../../scripts/perf/runner';
import { performanceScenarios } from '../../scripts/perf/scenarios';
import {
  assertComparableReceipts,
  assertStableMetric,
  compareMetricSamples,
  summarizeMetric,
} from '../../scripts/perf/statistics';

const identity: PerformanceIdentity = {
  git: { commit: 'a'.repeat(40), dirtyDigest: 'b'.repeat(64) },
  build: { profile: 'test', runtime: 'bun-test' },
  hardware: { classId: 'c'.repeat(64), cpuCores: 8, cpuModelHash: 'd'.repeat(64), memoryGiB: 16 },
  environment: { arch: 'arm64', bun: 'test', os: 'test-os' },
};

const clock = () => {
  let milliseconds = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, milliseconds++));
};

const scenario = (values: readonly number[], assertions = 1): PerformanceScenario => ({
  id: 'editor.synthetic-proof',
  version: 2,
  fixtureDigest: `sha256:${'d'.repeat(64)}`,
  cacheMode: 'warm',
  warmupRuns: 1,
  measuredRuns: values.length - 1,
  budgets: { latencyMs: { absolute: 2, relative: 0.15 } },
  maxRelativeMad: 0.35,
  metricUnits: { latencyMs: 'ms', work: 'count' },
  async runSample(run) {
    const latencyMs = values[run];
    if (latencyMs === undefined) throw new Error('missing synthetic value');
    return { assertions, metrics: { latencyMs, work: 4 } };
  },
});

describe('performance lab statistics', () => {
  test('captures privacy-filtered hardware and runtime identity', () => {
    const captured = capturePerformanceIdentity('test');
    expect(captured.hardware).toMatchObject({
      displayClassHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      gpuClassHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      storageClassHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(captured.environment).toMatchObject({
      loadAverage1m: expect.any(Number),
      node: expect.any(String),
      powerSource: expect.any(String),
      rustc: expect.any(String),
      thermalState: expect.any(String),
    });
  });

  test('retains robust percentiles, dispersion, and deterministic median confidence', () => {
    const first = summarizeMetric([1, 2, 3, 4, 5]);
    expect(first).toEqual({
      iqr: 2,
      mad: 1,
      median: 3,
      medianConfidence95: { lower: 1, method: 'deterministic-bootstrap-2000', upper: 5 },
      p90: 4.6,
      p95: 4.8,
      samples: 5,
    });
    expect(summarizeMetric([1, 2, 3, 4, 5])).toEqual(first);
  });

  test('requires both absolute and relative p95 regression thresholds', () => {
    expect(compareMetricSamples('latency', [100, 100], [116, 116], { absolute: 20, relative: 0.15 }).regressed).toBe(
      false,
    );
    expect(compareMetricSamples('latency', [100, 100], [121, 121], { absolute: 20, relative: 0.15 }).regressed).toBe(
      true,
    );
  });

  test('rejects unstable samples using a relative MAD policy', () => {
    expect(() => assertStableMetric('latency', [10, 10, 11, 11], 0.1)).not.toThrow();
    expect(() => assertStableMetric('latency', [1, 1, 100, 100], 0.35)).toThrow('too noisy');
  });
});

describe('performance lab runner', () => {
  test('registers versioned synthetic and end-to-end browser scenarios', () => {
    expect(performanceScenarios.map(({ id }) => id)).toEqual([
      'editor.preview-scheduling',
      'browser.editor-open',
      'browser.editor-compare',
      'browser.library-open',
    ]);
    expect(performanceScenarios.every(({ version, measuredRuns }) => version > 0 && measuredRuns >= 5)).toBeTrue();
  });

  test('preview scheduling records CPU, memory, filesystem, and work metrics', async () => {
    const preview = performanceScenarios.find(({ id }) => id === 'editor.preview-scheduling');
    if (preview === undefined) throw new Error('preview performance scenario missing');
    const result = await preview.runSample(0);
    expect(result.metrics).toMatchObject({
      cpuMs: expect.any(Number),
      dispatches: 20_000,
      filesystemReadOps: expect.any(Number),
      filesystemWriteOps: expect.any(Number),
      residentBytes: expect.any(Number),
    });
  });

  test('excludes warmups, retains raw metrics, and proves every measured run', async () => {
    const runs: number[] = [];
    const executable = scenario([99, 10, 11, 12]);
    const receipt = await runPerformanceScenario({
      scenario: {
        ...executable,
        async runSample(run) {
          runs.push(run);
          return await executable.runSample(run);
        },
      },
      identity,
      now: clock(),
    });
    expect(runs).toEqual([0, 1, 2, 3]);
    expect(receipt.status).toBe('pass');
    expect(receipt.correctness).toEqual({ assertions: 3, passed: true });
    expect(receipt.samples.filter(({ metric }) => metric === 'latencyMs').map(({ value }) => value)).toEqual([
      10, 11, 12,
    ]);
    expect(receipt.samples.every(({ run }) => run >= 0 && run < 3)).toBe(true);
    expect(receipt.observability?.clock).toEqual({ domain: 'runner-monotonic', unit: 'ms' });
    expect(receipt.observability?.spans).toHaveLength(3);
    expect(receipt.observability?.spans.every(({ run }) => run >= 0 && run < 3)).toBeTrue();
  });

  test('marks broken correctness or undeclared metrics invalid for bisect', async () => {
    const broken = await runPerformanceScenario({ scenario: scenario([0, 10], 0), identity, now: clock() });
    expect(broken.status).toBe('invalid');
    expect(broken.invalidReason).toContain('correctness');
    expect(bisectExitCode(broken.status)).toBe(125);
    const undeclared = scenario([0, 10]);
    const invalid = await runPerformanceScenario({
      scenario: { ...undeclared, metricUnits: {} },
      identity,
      now: clock(),
    });
    expect(invalid.status).toBe('invalid');
    const noisy = await runPerformanceScenario({
      scenario: scenario([0, 1, 1, 100, 100]),
      identity,
      now: clock(),
    });
    expect(noisy).toMatchObject({ status: 'invalid', invalidReason: expect.stringContaining('too noisy') });
    const invalidTrace = scenario([0, 10]);
    const traced = await runPerformanceScenario({
      scenario: {
        ...invalidTrace,
        async runSample(run) {
          const result = await invalidTrace.runSample(run);
          return {
            ...result,
            spans: [{ source: 'frontend' as const, stage: 'impossible', startOffsetMs: 0, durationMs: 60_000 }],
          };
        },
      },
      identity,
      now: clock(),
    });
    expect(traced).toMatchObject({ status: 'invalid', invalidReason: expect.stringContaining('exceeds its sample') });
  });

  test('compares only compatible identities and produces a regression result', async () => {
    const baseline = await runPerformanceScenario({ scenario: scenario([0, 10, 10, 10]), identity, now: clock() });
    const candidate = await runPerformanceScenario({ scenario: scenario([0, 14, 14, 14]), identity, now: clock() });
    const comparison = comparePerformanceReceipts(baseline, candidate, scenario([0, 1]).budgets);
    expect(comparison.find(({ metric }) => metric === 'latencyMs')?.regressed).toBe(true);
    const legacyComparison = comparison.map(({ baseline: left, candidate: right, ...entry }) => ({
      ...entry,
      baseline: { mad: left.mad, median: left.median, p95: left.p95, samples: left.samples },
      candidate: { mad: right.mad, median: right.median, p95: right.p95, samples: right.samples },
    }));
    expect(
      performanceRunReceiptSchema.parse({ ...candidate, comparison: legacyComparison, status: 'regression' }).status,
    ).toBe('regression');
    expect(() =>
      assertComparableReceipts(baseline, {
        ...candidate,
        identity: { ...candidate.identity, hardware: { ...candidate.identity.hardware, classId: 'e'.repeat(64) } },
      }),
    ).toThrow('hardware class');
  });

  test('rejects a passing receipt without samples or correctness evidence', async () => {
    const valid = await runPerformanceScenario({ scenario: scenario([0, 10]), identity, now: clock() });
    expect(() =>
      performanceRunReceiptSchema.parse({
        ...valid,
        correctness: { assertions: 0, passed: false },
        samples: [],
        status: 'pass',
      }),
    ).toThrow('require samples and correctness proof');
    expect(bisectExitCode('pass')).toBe(0);
    expect(bisectExitCode('regression')).toBe(1);
  });
});
