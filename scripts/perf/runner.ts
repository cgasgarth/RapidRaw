import type { MetricSample, PerformanceIdentity, PerformanceRunReceipt, PerformanceScenario } from './model';
import { performanceRunReceiptSchema } from './model';
import {
  assertComparableReceipts,
  assertStableMetric,
  classifyHardwareCompatibility,
  compareMetricSamples,
  groupMetricSamples,
} from './statistics';

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function comparePerformanceReceipts(
  baseline: PerformanceRunReceipt,
  candidate: PerformanceRunReceipt,
  budgets: PerformanceScenario['budgets'],
) {
  const baselineMetrics = groupMetricSamples(baseline.samples);
  const candidateMetrics = groupMetricSamples(candidate.samples);
  const units = new Map(candidate.samples.map(({ metric, unit }) => [metric, unit]));
  const compatibility = classifyHardwareCompatibility(
    baseline,
    candidate,
    Object.keys(budgets).flatMap((metric) => {
      const unit = units.get(metric);
      return unit === undefined ? [] : [unit];
    }),
  );
  if (!compatibility.compatible) throw new Error(compatibility.reason);
  if (compatibility.mode === 'exact-class') assertComparableReceipts(baseline, candidate);
  else {
    const portableBaseline = {
      ...baseline,
      identity: {
        ...baseline.identity,
        hardware: { ...baseline.identity.hardware, classId: candidate.identity.hardware.classId },
      },
    };
    assertComparableReceipts(portableBaseline, candidate);
  }
  return Object.entries(budgets).map(([metric, threshold]) => {
    const baselineValues = baselineMetrics.get(metric);
    const candidateValues = candidateMetrics.get(metric);
    if (baselineValues === undefined || candidateValues === undefined)
      throw new Error(`Comparable receipts are missing required metric ${metric}.`);
    return compareMetricSamples(metric, baselineValues, candidateValues, threshold);
  });
}

export async function runPerformanceScenario(options: {
  scenario: PerformanceScenario;
  identity: PerformanceIdentity;
  baseline?: PerformanceRunReceipt | undefined;
  now?: (() => Date) | undefined;
}): Promise<PerformanceRunReceipt> {
  const { scenario } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const runId = `${startedAt.toISOString().replaceAll(/[:.]/gu, '-')}-${options.identity.git.commit.slice(0, 8)}-${scenario.id}`;
  const rerunCommand = ['bun', 'perf', 'run', scenario.id].map(quote).join(' ');
  const samples: MetricSample[] = [];
  let assertions = 0;
  try {
    for (let run = 0; run < scenario.warmupRuns + scenario.measuredRuns; run += 1) {
      const result = await scenario.runSample(run);
      if (run < scenario.warmupRuns) continue;
      assertions += result.assertions;
      for (const [metric, value] of Object.entries(result.metrics)) {
        const unit = scenario.metricUnits[metric];
        if (unit === undefined) throw new Error(`Scenario ${scenario.id} emitted undeclared metric ${metric}.`);
        samples.push({ metric, run: run - scenario.warmupRuns, unit, value });
      }
    }
    const draft: PerformanceRunReceipt = {
      schemaVersion: 1,
      runId,
      scenario: {
        id: scenario.id,
        version: scenario.version,
        fixtureDigest: scenario.fixtureDigest,
        cacheMode: scenario.cacheMode,
      },
      identity: options.identity,
      protocol: { warmupRuns: scenario.warmupRuns, measuredRuns: scenario.measuredRuns },
      samples,
      correctness: { assertions, passed: assertions >= scenario.measuredRuns },
      comparison: [],
      status: 'pass',
      startedAt: startedAt.toISOString(),
      endedAt: now().toISOString(),
      rerunCommand,
    };
    if (!draft.correctness.passed) throw new Error('Scenario did not prove correctness for every measured run.');
    const measured = groupMetricSamples(samples);
    for (const metric of Object.keys(scenario.budgets)) {
      const values = measured.get(metric);
      if (values === undefined) throw new Error(`Scenario ${scenario.id} omitted budgeted metric ${metric}.`);
      assertStableMetric(metric, values, scenario.maxRelativeMad);
    }
    const comparison =
      options.baseline === undefined ? [] : comparePerformanceReceipts(options.baseline, draft, scenario.budgets);
    return performanceRunReceiptSchema.parse({
      ...draft,
      comparison,
      status: comparison.some(({ regressed }) => regressed) ? 'regression' : 'pass',
    });
  } catch (error) {
    return performanceRunReceiptSchema.parse({
      schemaVersion: 1,
      runId,
      scenario: {
        id: scenario.id,
        version: scenario.version,
        fixtureDigest: scenario.fixtureDigest,
        cacheMode: scenario.cacheMode,
      },
      identity: options.identity,
      protocol: { warmupRuns: scenario.warmupRuns, measuredRuns: scenario.measuredRuns },
      samples,
      correctness: { assertions, passed: false },
      comparison: [],
      status: 'invalid',
      invalidReason: error instanceof Error ? error.message : String(error),
      startedAt: startedAt.toISOString(),
      endedAt: now().toISOString(),
      rerunCommand,
    });
  }
}

export const bisectExitCode = (status: PerformanceRunReceipt['status']): 0 | 1 | 125 =>
  status === 'pass' ? 0 : status === 'regression' ? 1 : 125;
