import { z } from 'zod';
import { metricComparisonSchema, type PerformanceRunReceipt } from './model';

export const performanceRegressionArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  baseline: z.object({ runId: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/u) }),
  candidate: z.object({ runId: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/u) }),
  scenarioId: z.string().min(1),
  regressions: z.array(metricComparisonSchema.extend({ unit: z.enum(['ms', 'bytes', 'count', 'per-second']) })).min(1),
  likelyDivergentMetric: z.string().min(1),
  rerunCommand: z.string().min(1),
  bisectPlanCommand: z.string().min(1),
});

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
