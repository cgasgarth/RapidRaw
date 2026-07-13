import { z } from 'zod';
import { metricComparisonSchema, type PerformanceRunReceipt } from './model';
import { groupMetricSamples, summarizeMetric } from './statistics';

export const performanceRegressionArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  baseline: z.object({ runId: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/u) }),
  candidate: z.object({ runId: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/u) }),
  scenarioId: z.string().min(1),
  regressions: z.array(metricComparisonSchema.extend({ unit: z.enum(['ms', 'bytes', 'count', 'per-second']) })).min(1),
  likelyDivergentMetric: z.string().min(1),
  likelyDivergentStage: z
    .object({
      absoluteDeltaMs: z.number().finite(),
      baselineP95Ms: z.number().nonnegative(),
      candidateP95Ms: z.number().nonnegative(),
      relativeDelta: z.number().finite(),
      source: z.string().min(1),
      stage: z.string().min(1),
    })
    .optional(),
  likelyWorkAmplification: z
    .object({
      baselineMedian: z.number().nonnegative(),
      candidateMedian: z.number().nonnegative(),
      metric: z.string().min(1),
      relativeDelta: z.number().finite(),
      unit: z.enum(['bytes', 'count']),
    })
    .optional(),
  rerunCommand: z.string().min(1),
  bisectPlanCommand: z.string().min(1),
});

const divergentStage = (baseline: PerformanceRunReceipt, candidate: PerformanceRunReceipt) => {
  const group = (receipt: PerformanceRunReceipt) => {
    const grouped = new Map<string, { source: string; stage: string; values: number[] }>();
    for (const span of receipt.observability?.spans ?? []) {
      if (span.source === 'runner' && span.stage === 'scenario.sample') continue;
      const key = `${span.source}:${span.stage}`;
      const entry = grouped.get(key) ?? { source: span.source, stage: span.stage, values: [] };
      entry.values.push(span.durationMs);
      grouped.set(key, entry);
    }
    return grouped;
  };
  const baselineStages = group(baseline);
  return [...group(candidate).entries()]
    .flatMap(([key, stage]) => {
      const prior = baselineStages.get(key);
      if (prior === undefined) return [];
      const baselineP95Ms = summarizeMetric(prior.values).p95;
      const candidateP95Ms = summarizeMetric(stage.values).p95;
      const absoluteDeltaMs = candidateP95Ms - baselineP95Ms;
      const relativeDelta = baselineP95Ms === 0 ? Number.MAX_SAFE_INTEGER : absoluteDeltaMs / baselineP95Ms;
      return absoluteDeltaMs > 0 ? [{ ...stage, absoluteDeltaMs, baselineP95Ms, candidateP95Ms, relativeDelta }] : [];
    })
    .sort((left, right) => right.relativeDelta - left.relativeDelta || right.absoluteDeltaMs - left.absoluteDeltaMs)[0];
};

const workAmplification = (baseline: PerformanceRunReceipt, candidate: PerformanceRunReceipt) => {
  const baselineMetrics = groupMetricSamples(baseline.samples);
  const units = new Map(candidate.samples.map(({ metric, unit }) => [metric, unit]));
  return [...groupMetricSamples(candidate.samples)]
    .flatMap(([metric, values]) => {
      const unit = units.get(metric);
      const prior = baselineMetrics.get(metric);
      if ((unit !== 'bytes' && unit !== 'count') || prior === undefined) return [];
      const baselineMedian = summarizeMetric(prior).median;
      const candidateMedian = summarizeMetric(values).median;
      const relativeDelta =
        baselineMedian === 0 ? Number.MAX_SAFE_INTEGER : (candidateMedian - baselineMedian) / baselineMedian;
      return candidateMedian > baselineMedian ? [{ baselineMedian, candidateMedian, metric, relativeDelta, unit }] : [];
    })
    .sort((left, right) => right.relativeDelta - left.relativeDelta)[0];
};

export function createRegressionArtifact(
  baseline: PerformanceRunReceipt,
  candidate: PerformanceRunReceipt,
  baselineSource: { flag: '--baseline' | '--history'; path: string },
) {
  const units = new Map(candidate.samples.map(({ metric, unit }) => [metric, unit]));
  const regressions = candidate.comparison
    .filter(({ regressed }) => regressed)
    .map((comparison) => {
      const unit = units.get(comparison.metric);
      if (unit === undefined) throw new Error(`Regression metric ${comparison.metric} has no declared unit.`);
      return { ...comparison, unit };
    });
  const likely = [...regressions].sort((left, right) => right.relativeDelta - left.relativeDelta)[0];
  if (likely === undefined) throw new Error('A regression artifact requires at least one regressed metric.');
  return performanceRegressionArtifactSchema.parse({
    schemaVersion: 1,
    baseline: { runId: baseline.runId, commit: baseline.identity.git.commit },
    candidate: { runId: candidate.runId, commit: candidate.identity.git.commit },
    scenarioId: candidate.scenario.id,
    regressions,
    likelyDivergentMetric: likely.metric,
    likelyDivergentStage: divergentStage(baseline, candidate),
    likelyWorkAmplification: workAmplification(baseline, candidate),
    rerunCommand: candidate.rerunCommand,
    bisectPlanCommand: [
      'bun',
      'perf',
      'bisect-plan',
      '--scenario',
      candidate.scenario.id,
      '--good',
      baseline.identity.git.commit,
      '--bad',
      candidate.identity.git.commit,
      baselineSource.flag,
      baselineSource.path,
    ]
      .map((value) => `'${value.replaceAll("'", "'\\''")}'`)
      .join(' '),
  });
}
