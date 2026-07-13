import { z } from 'zod';
import type { BaselineHistory } from './history';
import { selectApprovedBaseline } from './history';
import { metricComparisonSchema, type PerformanceRunReceipt, type PerformanceScenario } from './model';
import { comparePerformanceReceipts } from './runner';
import { classifyHardwareCompatibility } from './statistics';

export const performanceCiTrendGateSchema = z.object({
  schemaVersion: z.literal(1),
  scenarioId: z.string().min(1),
  candidateRunId: z.string().min(1),
  baselineRunId: z.string().min(1),
  hardware: z.object({
    compatible: z.boolean(),
    mode: z.enum(['exact-class', 'portable-work-count', 'incompatible']),
    reason: z.string().min(1),
  }),
  comparison: z.array(metricComparisonSchema),
  status: z.enum(['pass', 'regression', 'invalid']),
  annotation: z.object({ title: z.string().min(1), summary: z.string().min(1) }),
});

export function createPerformanceCiTrendGate(
  history: BaselineHistory,
  candidate: PerformanceRunReceipt,
  scenario: PerformanceScenario,
) {
  try {
    const candidateUnits = new Map(candidate.samples.map(({ metric, unit }) => [metric, unit]));
    const budgetUnits = Object.keys(scenario.budgets).flatMap((metric) => {
      const unit = candidateUnits.get(metric);
      return unit === undefined ? [] : [unit];
    });
    const baseline = selectApprovedBaseline(history, candidate, {
      allowCrossHardware: budgetUnits.length > 0 && budgetUnits.every((unit) => unit === 'count'),
    }).receipt;
    const hardware = classifyHardwareCompatibility(baseline, candidate, budgetUnits);
    if (!hardware.compatible) throw new Error(hardware.reason);
    const comparison = comparePerformanceReceipts(baseline, candidate, scenario.budgets);
    const regressions = comparison.filter(({ regressed }) => regressed);
    const status = regressions.length > 0 ? 'regression' : 'pass';
    return performanceCiTrendGateSchema.parse({
      schemaVersion: 1,
      scenarioId: scenario.id,
      candidateRunId: candidate.runId,
      baselineRunId: baseline.runId,
      hardware,
      comparison,
      status,
      annotation: {
        title: status === 'pass' ? 'Performance trend gate passed' : 'Performance regression detected',
        summary:
          status === 'pass'
            ? `${scenario.id} passed ${comparison.length} metric budget(s) against ${baseline.runId}.`
            : `${scenario.id} regressed: ${regressions.map(({ metric }) => metric).join(', ')}.`,
      },
    });
  } catch (error) {
    return performanceCiTrendGateSchema.parse({
      schemaVersion: 1,
      scenarioId: scenario.id,
      candidateRunId: candidate.runId,
      baselineRunId: 'unavailable',
      hardware: {
        compatible: false,
        mode: 'incompatible',
        reason: error instanceof Error ? error.message : String(error),
      },
      comparison: [],
      status: 'invalid',
      annotation: {
        title: 'Performance trend gate invalid',
        summary: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export const ciTrendGateExitCode = (status: 'pass' | 'regression' | 'invalid'): 0 | 1 | 2 =>
  status === 'pass' ? 0 : status === 'regression' ? 1 : 2;
