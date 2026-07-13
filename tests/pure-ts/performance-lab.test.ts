import { describe, expect, test } from 'bun:test';
import type { PerformanceIdentity, PerformanceScenario } from '../../scripts/perf/model';
import { performanceRunReceiptSchema } from '../../scripts/perf/model';
import { bisectExitCode, comparePerformanceReceipts, runPerformanceScenario } from '../../scripts/perf/runner';
import {
  assertComparableReceipts,
  assertStableMetric,
  compareMetricSamples,
  summarizeMetric,
} from '../../scripts/perf/statistics';

const identity: PerformanceIdentity = {
  git: { commit: 'a'.repeat(40), dirtyDigest: 'b'.repeat(64) },
  build: { profile: 'test', runtime: 'bun-test' },
  hardware: { classId: 'c'.repeat(64), cpuCores: 8 },
  environment: { arch: 'arm64', os: 'test-os' },
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
  test('retains robust median, p95, and median absolute deviation', () => {
    expect(summarizeMetric([1, 2, 3, 4, 5])).toEqual({ mad: 1, median: 3, p95: 4.8, samples: 5 });
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
  });

  test('compares only compatible identities and produces a regression result', async () => {
    const baseline = await runPerformanceScenario({ scenario: scenario([0, 10, 10, 10]), identity, now: clock() });
    const candidate = await runPerformanceScenario({ scenario: scenario([0, 14, 14, 14]), identity, now: clock() });
    const comparison = comparePerformanceReceipts(baseline, candidate, scenario([0, 1]).budgets);
    expect(comparison.find(({ metric }) => metric === 'latencyMs')?.regressed).toBe(true);
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
