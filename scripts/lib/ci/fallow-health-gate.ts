import type { HealthScore } from 'fallow/types';
import { z } from 'zod';

export const DEFAULT_FALLOW_HEALTH_THRESHOLD = 85;

type GateHealthScore = Pick<HealthScore, 'grade' | 'score'> & { penalties: Record<string, number> };

const fallowHealthReportSchema: z.ZodType<{ health_score: GateHealthScore }> = z.object({
  health_score: z.object({
    grade: z.string().min(1),
    penalties: z.record(z.string(), z.number().finite().nonnegative()),
    score: z.number().finite().min(0).max(100),
  }),
});

const thresholdSchema = z.coerce.number().finite().min(0).max(100);

export interface FallowHealthGateResult {
  exitCode: 0 | 1;
  message: string;
}

export const parseFallowHealthThreshold = (value?: string): number =>
  thresholdSchema.parse(value ?? DEFAULT_FALLOW_HEALTH_THRESHOLD);

const decimal = (value: number): string => value.toFixed(1);

export const evaluateFallowHealthReport = (report: unknown, threshold: number): FallowHealthGateResult => {
  const { health_score: health } = fallowHealthReportSchema.parse(report);
  if (health.score >= threshold) {
    return {
      exitCode: 0,
      message: `fallow health ok (score=${decimal(health.score)} threshold=${decimal(threshold)} grade=${health.grade})`,
    };
  }
  const regressions = Object.entries(health.penalties)
    .filter(([, penalty]) => penalty > 0)
    .sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName))
    .slice(0, 3)
    .map(([name, penalty]) => `${name}:${decimal(penalty)}`)
    .join(',');
  return {
    exitCode: 1,
    message: `fallow health failed (score=${decimal(health.score)} threshold=${decimal(threshold)} top=${regressions || 'none'})`,
  };
};

export const evaluateFallowHealthOutput = (stdout: string, thresholdText?: string): FallowHealthGateResult => {
  const threshold = parseFallowHealthThreshold(thresholdText);
  return evaluateFallowHealthReport(JSON.parse(stdout) as unknown, threshold);
};
