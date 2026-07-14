/** Rights-gated direct-positive reversal calibration. No dataset means no profile. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ReversalSample = {
  id: string;
  split: 'train' | 'holdout';
  exposureEv: number;
  transmittanceRgb: [number, number, number];
  highlightReferenceEv?: number;
};
export type ReversalDataset = {
  schemaVersion: 1;
  datasetId: string;
  status: 'measured';
  licenseSpdx: string[];
  sourceSha256: `sha256:${string}`;
  samples: ReversalSample[];
};
export type ReversalCalibrationReport = {
  schemaVersion: 1;
  datasetId: string;
  sourceSha256: string;
  trainSampleIds: string[];
  holdoutSampleIds: string[];
  exposureKnotsEv: number[];
  densityKnots: [number, number, number][];
  holdoutDensityRmse: number;
  highlightReferenceErrorEv: number;
  ap1ExcursionCount: number;
  fitInputSha256: string;
  limitations: string[];
};
const EPSILON = 1e-6;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const density = (value: number): number => -Math.log10(Math.max(value, EPSILON));
const canonical = (value: unknown): string => JSON.stringify(value);

export const validateReversalDataset = (dataset: ReversalDataset): void => {
  if (dataset.schemaVersion !== 1 || dataset.status !== 'measured' || !dataset.datasetId.trim())
    throw new Error('reversal_dataset_invalid_identity');
  if (!dataset.licenseSpdx.length || !/^sha256:[a-f0-9]{64}$/u.test(dataset.sourceSha256))
    throw new Error('reversal_dataset_rights_or_hash_invalid');
  if (dataset.samples.length < 10) throw new Error('reversal_dataset_too_small');
  const ids = new Set<string>();
  for (const sample of dataset.samples) {
    if (
      ids.has(sample.id) ||
      !Number.isFinite(sample.exposureEv) ||
      sample.transmittanceRgb.some((value) => !Number.isFinite(value) || value <= 0)
    )
      throw new Error(`reversal_sample_invalid:${sample.id}`);
    ids.add(sample.id);
  }
  if (
    dataset.samples.filter((sample) => sample.split === 'train').length < 5 ||
    dataset.samples.filter((sample) => sample.split === 'holdout').length < 5
  )
    throw new Error('reversal_train_holdout_insufficient');
};

export const calibrateReversalDataset = (dataset: ReversalDataset): ReversalCalibrationReport => {
  validateReversalDataset(dataset);
  const train = dataset.samples.filter((sample) => sample.split === 'train');
  const holdout = dataset.samples.filter((sample) => sample.split === 'holdout');
  const exposures = [...new Set(train.map((sample) => sample.exposureEv))].sort((a, b) => a - b);
  const knots = exposures.map((exposure) => {
    const group = train.filter((sample) => sample.exposureEv === exposure);
    return [0, 1, 2].map(
      (channel) =>
        group.reduce((sum, sample) => sum + density(sample.transmittanceRgb[channel] ?? EPSILON), 0) / group.length,
    ) as [number, number, number];
  });
  // Direct-positive response must not reverse locally: higher exposure cannot increase density.
  for (let channel = 0; channel < 3; channel += 1) {
    let previous = Number.POSITIVE_INFINITY;
    for (const knot of knots) {
      knot[channel] = Math.min(knot[channel] ?? previous, previous);
      previous = knot[channel] ?? previous;
    }
  }
  const predict = (exposure: number, channel: number): number => {
    if (exposure <= (exposures[0] ?? exposure)) return knots[0]?.[channel] ?? 0;
    const last = exposures.length - 1;
    if (exposure >= (exposures[last] ?? exposure)) return knots[last]?.[channel] ?? 0;
    const index = exposures.findIndex((value) => exposure <= value) - 1;
    const amount = (exposure - (exposures[index] ?? 0)) / ((exposures[index + 1] ?? 1) - (exposures[index] ?? 0));
    return (knots[index]?.[channel] ?? 0) * (1 - amount) + (knots[index + 1]?.[channel] ?? 0) * amount;
  };
  const errors: number[] = [];
  let highlightReferenceErrorEv = 0;
  for (const sample of holdout) {
    for (let channel = 0; channel < 3; channel += 1)
      errors.push(predict(sample.exposureEv, channel) - density(sample.transmittanceRgb[channel] ?? EPSILON));
    if (sample.highlightReferenceEv !== undefined)
      highlightReferenceErrorEv = Math.max(
        highlightReferenceErrorEv,
        Math.abs(sample.exposureEv - sample.highlightReferenceEv),
      );
  }
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    sourceSha256: dataset.sourceSha256,
    trainSampleIds: train.map((sample) => sample.id),
    holdoutSampleIds: holdout.map((sample) => sample.id),
    exposureKnotsEv: exposures,
    densityKnots: knots,
    holdoutDensityRmse: Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length),
    highlightReferenceErrorEv,
    ap1ExcursionCount: holdout.filter((sample) => sample.transmittanceRgb.some((value) => value < 0 || value > 1))
      .length,
    fitInputSha256: `sha256:${sha256(canonical(train))}`,
    limitations: [
      'Measured only for declared process, batch, and illuminant.',
      'Projection/scan, grain, and halation require separately evidenced measurements.',
    ],
  };
};

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const datasetPath = args[args.indexOf('--dataset') + 1];
  if (!datasetPath) throw new Error('missing_--dataset');
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
  const report = calibrateReversalDataset(
    JSON.parse(await readFile(join(datasetPath, 'dataset.json'), 'utf8')) as ReversalDataset,
  );
  if (
    args.includes('--verify-holdout') &&
    (!Number.isFinite(report.holdoutDensityRmse) || report.holdoutDensityRmse > 0.025)
  )
    throw new Error('reversal_holdout_threshold_failed');
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'calibration-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(
    JSON.stringify({
      datasetId: report.datasetId,
      holdoutDensityRmse: report.holdoutDensityRmse,
      highlightReferenceErrorEv: report.highlightReferenceErrorEv,
    }),
  );
}
