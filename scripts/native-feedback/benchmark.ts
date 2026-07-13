import { createHash } from 'node:crypto';
import type { NativeFeedbackProfile, NativeFeedbackReceipt, NativeFeedbackSample } from './model';
import { nativeFeedbackReceiptSchema, nativeFeedbackSampleSchema } from './model';

const scenarios = ['clean', 'noop', 'leaf-edit', 'core-edit'] as const;

const quantile = (values: readonly number[], probability: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) throw new Error('Native feedback distribution has no samples.');
  const position = (sorted.length - 1) * probability;
  const lower = sorted[Math.floor(position)];
  const upper = sorted[Math.ceil(position)];
  if (lower === undefined || upper === undefined) throw new Error('Native feedback quantile is out of range.');
  return lower + (upper - lower) * (position - Math.floor(position));
};

const distribution = (values: readonly number[]) => ({
  median: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  samples: values.length,
});

export interface NativeFeedbackExecutor {
  run(input: {
    scenario: (typeof scenarios)[number];
    iteration: number;
    measured: boolean;
    profile: NativeFeedbackProfile;
  }): Promise<NativeFeedbackSample>;
}

export async function runNativeFeedbackBenchmark(options: {
  profile: NativeFeedbackProfile;
  executor: NativeFeedbackExecutor;
  identity: NativeFeedbackReceipt['identity'];
  warmupRuns: number;
  measuredRuns: number;
  startedAt: string;
  validationCacheKey: string;
  rerunCommand: string;
}): Promise<NativeFeedbackReceipt> {
  if (!Number.isInteger(options.warmupRuns) || options.warmupRuns < 0)
    throw new Error('warmupRuns must be nonnegative.');
  if (!Number.isInteger(options.measuredRuns) || options.measuredRuns < 3)
    throw new Error('measuredRuns must be at least 3.');
  const samples: NativeFeedbackSample[] = [];
  for (let iteration = 0; iteration < options.warmupRuns + options.measuredRuns; iteration += 1) {
    for (const scenario of scenarios) {
      const sample = nativeFeedbackSampleSchema.parse(
        await options.executor.run({
          scenario,
          iteration,
          measured: iteration >= options.warmupRuns,
          profile: options.profile,
        }),
      );
      if (sample.scenario !== scenario || sample.iteration !== iteration)
        throw new Error(`Executor returned the wrong sample identity for ${scenario}/${iteration}.`);
      if (iteration >= options.warmupRuns) samples.push({ ...sample, iteration: iteration - options.warmupRuns });
    }
  }
  const summary = Object.fromEntries(
    scenarios.map((scenario) => {
      const matching = samples.filter((sample) => sample.scenario === scenario);
      return [
        scenario,
        {
          wallMs: distribution(matching.map(({ wallMs }) => wallMs)),
          timeToTestMs: distribution(matching.map(({ timeToTestMs }) => timeToTestMs)),
        },
      ];
    }),
  );
  const runId = `${options.startedAt.replaceAll(/[:.]/gu, '-')}-${options.identity.gitCommit.slice(0, 8)}-${options.profile.id}`;
  return nativeFeedbackReceiptSchema.parse({
    schemaVersion: 1,
    runId,
    profile: options.profile,
    identity: options.identity,
    protocol: { warmupRuns: options.warmupRuns, measuredRuns: options.measuredRuns },
    samples,
    summary,
    status: 'pass',
    integrations: {
      performanceArtifact: {
        schemaVersion: 1,
        kind: 'performance-run-adapter',
        scenarioId: `native.feedback.${options.profile.id}`,
        hardwareClass: options.identity.hardwareClass,
        rawSampleCount: samples.length,
        metricNames: [
          'wallMs',
          'criticalPathMs',
          'rebuiltCrates',
          'linkMs',
          'peakRssBytes',
          'artifactBytes',
          'timeToTestMs',
        ],
        retentionDays: 30,
      },
      validationNode: {
        schemaVersion: 1,
        kind: 'validation-node-result',
        nodeId: `native-feedback:${options.profile.id}`,
        cacheKey: options.validationCacheKey,
      },
    },
    rerunCommand: options.rerunCommand,
  });
}

export function compareNativeFeedbackReceipts(
  baseline: NativeFeedbackReceipt,
  candidate: NativeFeedbackReceipt,
  policy = {
    majorReductionRelative: 0.3,
    majorReductionAbsoluteMs: 2_000,
    regressionRelative: 0.1,
    regressionAbsoluteMs: 1_000,
  },
) {
  const compatibleProfiles =
    baseline.profile.id === candidate.profile.id ||
    (baseline.profile.id === 'dev-baseline' && candidate.profile.id === 'rapid-dev-fast');
  if (
    !compatibleProfiles ||
    baseline.identity.hardwareClass !== candidate.identity.hardwareClass ||
    baseline.identity.rustc !== candidate.identity.rustc
  )
    throw new Error('Native feedback receipts are not identity-compatible.');
  const comparisons = scenarios.map((scenario) => {
    const before = baseline.summary[scenario].timeToTestMs.median;
    const after = candidate.summary[scenario].timeToTestMs.median;
    const deltaMs = after - before;
    const relativeDelta = before === 0 ? 0 : deltaMs / before;
    return {
      scenario,
      beforeMs: before,
      afterMs: after,
      deltaMs,
      relativeDelta,
      regressed: deltaMs > policy.regressionAbsoluteMs && relativeDelta > policy.regressionRelative,
      majorReduction: -deltaMs > policy.majorReductionAbsoluteMs && -relativeDelta > policy.majorReductionRelative,
    };
  });
  const common = comparisons.filter(({ scenario }) => scenario === 'noop' || scenario === 'leaf-edit');
  const regressed = comparisons.filter((comparison) => comparison.regressed);
  const majorCommonFeedbackReduction = common.every(({ majorReduction }) => majorReduction);
  return {
    schemaVersion: 1 as const,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    comparisons,
    status: regressed.length > 0 ? ('regression' as const) : ('pass' as const),
    majorCommonFeedbackReduction,
    nextAction:
      regressed.length > 0
        ? `Investigate native feedback regression in ${regressed.map(({ scenario }) => scenario).join(', ')}.`
        : majorCommonFeedbackReduction
          ? 'Common edit-to-test reduction meets the promotion threshold.'
          : 'Collect or improve no-op and leaf-edit feedback before profile promotion.',
    artifactDigest: createHash('sha256')
      .update(JSON.stringify({ baseline: baseline.runId, candidate: candidate.runId, comparisons }))
      .digest('hex'),
  };
}
