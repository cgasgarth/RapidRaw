import type { MetricSample, PerformanceRunReceipt } from './model';

export interface MetricSummary {
  iqr: number;
  mad: number;
  median: number;
  medianConfidence95: { lower: number; method: 'deterministic-bootstrap-2000'; upper: number };
  p90: number;
  p95: number;
  samples: number;
}

const quantile = (values: readonly number[], probability: number): number => {
  if (values.length === 0) throw new Error('Cannot summarize an empty metric sample.');
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error('Metric quantile index is out of bounds.');
  return lower + (upper - lower) * (position - lowerIndex);
};

const bootstrapMedianConfidence95 = (values: readonly number[]): { lower: number; upper: number } => {
  let state = values.reduce(
    (hash, value) => Math.imul(hash ^ Math.round(value * 1_000_000), 16_777_619) >>> 0,
    2_166_136_261,
  );
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const medians = Array.from({ length: 2_000 }, () =>
    quantile(
      Array.from({ length: values.length }, () => values[Math.floor(next() * values.length)] ?? values[0] ?? 0),
      0.5,
    ),
  );
  return { lower: quantile(medians, 0.025), upper: quantile(medians, 0.975) };
};

export function summarizeMetric(values: readonly number[]): MetricSummary {
  const median = quantile(values, 0.5);
  const confidence = bootstrapMedianConfidence95(values);
  return {
    iqr: quantile(values, 0.75) - quantile(values, 0.25),
    mad: quantile(
      values.map((value) => Math.abs(value - median)),
      0.5,
    ),
    median,
    medianConfidence95: { ...confidence, method: 'deterministic-bootstrap-2000' },
    p90: quantile(values, 0.9),
    p95: quantile(values, 0.95),
    samples: values.length,
  };
}

export function groupMetricSamples(samples: readonly MetricSample[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const sample of samples) {
    const values = grouped.get(sample.metric) ?? [];
    values.push(sample.value);
    grouped.set(sample.metric, values);
  }
  return grouped;
}

export function assertComparableReceipts(baseline: PerformanceRunReceipt, candidate: PerformanceRunReceipt): void {
  if (baseline.status === 'invalid' || candidate.status === 'invalid')
    throw new Error('Invalid performance receipts cannot be compared.');
  const fields = [
    ['scenario ID', baseline.scenario.id, candidate.scenario.id],
    ['scenario version', baseline.scenario.version, candidate.scenario.version],
    ['fixture', baseline.scenario.fixtureDigest, candidate.scenario.fixtureDigest],
    ['cache mode', baseline.scenario.cacheMode, candidate.scenario.cacheMode],
    ['hardware class', baseline.identity.hardware.classId, candidate.identity.hardware.classId],
    ['build profile', baseline.identity.build.profile, candidate.identity.build.profile],
  ] as const;
  const mismatch = fields.find(([, left, right]) => left !== right);
  if (mismatch !== undefined)
    throw new Error(`Incompatible performance ${mismatch[0]}: baseline=${mismatch[1]} candidate=${mismatch[2]}`);
}

export interface HardwareCompatibility {
  compatible: boolean;
  mode: 'exact-class' | 'portable-work-count' | 'incompatible';
  reason: string;
}

export function classifyHardwareCompatibility(
  baseline: PerformanceRunReceipt,
  candidate: PerformanceRunReceipt,
  metricUnits: readonly MetricSample['unit'][],
): HardwareCompatibility {
  if (baseline.identity.hardware.classId === candidate.identity.hardware.classId)
    return { compatible: true, mode: 'exact-class', reason: 'Hardware class IDs match.' };
  if (metricUnits.length > 0 && metricUnits.every((unit) => unit === 'count'))
    return {
      compatible: true,
      mode: 'portable-work-count',
      reason: 'Deterministic work-count metrics are portable across hardware classes.',
    };
  return {
    compatible: false,
    mode: 'incompatible',
    reason: `Latency/throughput comparison requires one hardware class (${baseline.identity.hardware.classId} != ${candidate.identity.hardware.classId}).`,
  };
}

export function assertStableMetric(metric: string, values: readonly number[], maxRelativeMad: number): void {
  const summary = summarizeMetric(values);
  const relativeMad =
    summary.median === 0 ? (summary.mad === 0 ? 0 : Number.MAX_SAFE_INTEGER) : summary.mad / summary.median;
  if (relativeMad > maxRelativeMad)
    throw new Error(
      `Metric ${metric} is too noisy: relative MAD ${relativeMad.toFixed(3)} exceeds ${maxRelativeMad.toFixed(3)}.`,
    );
}

export function compareMetricSamples(
  metric: string,
  baselineValues: readonly number[],
  candidateValues: readonly number[],
  threshold: { absolute: number; relative: number },
) {
  const baseline = summarizeMetric(baselineValues);
  const candidate = summarizeMetric(candidateValues);
  const absoluteDelta = candidate.p95 - baseline.p95;
  const relativeDelta =
    baseline.p95 === 0 ? (candidate.p95 === 0 ? 0 : Number.MAX_SAFE_INTEGER) : absoluteDelta / baseline.p95;
  return {
    absoluteDelta,
    baseline,
    candidate,
    metric,
    regressed: absoluteDelta > threshold.absolute && relativeDelta > threshold.relative,
    relativeDelta,
    threshold,
  };
}
