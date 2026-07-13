import { z } from 'zod';

export const startupHardwareClassSchema = z.enum(['default-macos-arm64', 'github-hosted-macos-arm64']);
export type StartupHardwareClass = z.infer<typeof startupHardwareClassSchema>;

export interface StartupHardwarePolicy {
  appControlledInteractiveMs: number;
  appControlledVisibleMs: number;
  firstPaintMs: number;
  hardwareClass: StartupHardwareClass;
  interactionResponseMs: number;
  maxColdToWarmInteractiveRatio: number | null;
  maxColdToWarmInteractiveSlackMs: number;
}

const policies: Record<StartupHardwareClass, StartupHardwarePolicy> = {
  'default-macos-arm64': {
    appControlledInteractiveMs: 750,
    appControlledVisibleMs: 250,
    firstPaintMs: 750,
    hardwareClass: 'default-macos-arm64',
    interactionResponseMs: 100,
    maxColdToWarmInteractiveRatio: null,
    maxColdToWarmInteractiveSlackMs: 0,
  },
  'github-hosted-macos-arm64': {
    appControlledInteractiveMs: 2_000,
    appControlledVisibleMs: 250,
    firstPaintMs: 750,
    hardwareClass: 'github-hosted-macos-arm64',
    interactionResponseMs: 100,
    maxColdToWarmInteractiveRatio: 1.25,
    maxColdToWarmInteractiveSlackMs: 100,
  },
};

export const resolveStartupHardwarePolicy = (value: string | undefined): StartupHardwarePolicy => {
  const hardwareClass = startupHardwareClassSchema.parse(value ?? 'default-macos-arm64');
  return policies[hardwareClass];
};

export const percentile95 = (values: number[]): number => {
  const sorted = values.toSorted((left, right) => left - right);
  const value = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (value === undefined) throw new Error('startup distribution has no samples');
  return value;
};

export const assertResponseDistribution = (values: number[], budgetMs: number): number => {
  const p95 = percentile95(values);
  if (p95 > budgetMs) throw new Error(`startup response p95 ${p95}ms exceeded ${budgetMs}ms`);
  return p95;
};

export const assertColdWarmInteractiveRegression = (
  coldP95: number,
  warmP95: number,
  policy: StartupHardwarePolicy,
): void => {
  if (policy.maxColdToWarmInteractiveRatio === null) return;
  const limit = warmP95 * policy.maxColdToWarmInteractiveRatio + policy.maxColdToWarmInteractiveSlackMs;
  if (coldP95 > limit) {
    throw new Error(
      `${policy.hardwareClass}: cold interactive p95 ${coldP95}ms exceeded warm-relative limit ${limit}ms`,
    );
  }
};
