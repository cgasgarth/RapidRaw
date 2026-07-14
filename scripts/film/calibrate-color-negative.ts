/**
 * Deterministic, fail-closed calibration core for project-owned color-negative data.
 * This command never invents measurements: a rights-reviewed manifest and explicit
 * train/holdout labels are required before any curve or metric is emitted.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ColorNegativeSample = {
  id: string;
  split: 'train' | 'holdout';
  exposureEv: number;
  transmittanceRgb: [number, number, number];
};

export type ColorNegativeDataset = {
  schemaVersion: 1;
  datasetId: string;
  status: 'measured';
  licenseSpdx: string[];
  sourceSha256: `sha256:${string}`;
  samples: ColorNegativeSample[];
};

export type ColorNegativeCalibrationReport = {
  schemaVersion: 1;
  datasetId: string;
  sourceSha256: string;
  trainSampleIds: string[];
  holdoutSampleIds: string[];
  exposureKnotsEv: number[];
  densityKnots: [number, number, number][];
  holdoutDensityRmse: number;
  neutralChromaMean: number;
  fitInputSha256: string;
  limitations: string[];
};

const EPSILON = 1e-6;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const canonical = (value: unknown): string => JSON.stringify(value);

export const validateColorNegativeDataset = (dataset: ColorNegativeDataset): void => {
  if (dataset.schemaVersion !== 1 || dataset.status !== 'measured') throw new Error('dataset_not_measured');
  if (!dataset.datasetId.trim() || dataset.licenseSpdx.length === 0) throw new Error('dataset_rights_incomplete');
  if (!/^sha256:[a-f0-9]{64}$/u.test(dataset.sourceSha256)) throw new Error('dataset_hash_invalid');
  if (dataset.samples.length < 10) throw new Error('dataset_too_small');
  const ids = new Set<string>();
  for (const sample of dataset.samples) {
    if (ids.has(sample.id)) throw new Error(`duplicate_sample:${sample.id}`);
    ids.add(sample.id);
    if (
      !Number.isFinite(sample.exposureEv) ||
      sample.transmittanceRgb.some((value) => !Number.isFinite(value) || value <= 0)
    )
      throw new Error(`sample_invalid:${sample.id}`);
  }
  const train = dataset.samples.filter((sample) => sample.split === 'train');
  const holdout = dataset.samples.filter((sample) => sample.split === 'holdout');
  if (train.length < 5 || holdout.length < 5) throw new Error('train_holdout_insufficient');
};

const density = (transmittance: number): number => -Math.log10(Math.max(transmittance, EPSILON));

const fitMonotoneKnots = (
  samples: ColorNegativeSample[],
): { exposures: number[]; densities: [number, number, number][] } => {
  const byExposure = new Map<number, ColorNegativeSample[]>();
  for (const sample of samples)
    byExposure.set(sample.exposureEv, [...(byExposure.get(sample.exposureEv) ?? []), sample]);
  const exposures = [...byExposure.keys()].sort((left, right) => left - right);
  const densities = exposures.map((exposure) => {
    const group = byExposure.get(exposure) ?? [];
    const mean = [0, 1, 2].map(
      (channel) =>
        group.reduce((sum, sample) => sum + density(sample.transmittanceRgb[channel] ?? EPSILON), 0) / group.length,
    ) as [number, number, number];
    return mean;
  });
  for (let channel = 0; channel < 3; channel += 1) {
    let previous = Number.NEGATIVE_INFINITY;
    for (const knot of densities) {
      knot[channel] = Math.max(knot[channel] ?? previous, previous);
      previous = knot[channel] ?? previous;
    }
  }
  return { exposures, densities };
};

const interpolate = (
  value: number,
  exposures: number[],
  knots: [number, number, number][],
  channel: number,
): number => {
  if (value <= (exposures[0] ?? value)) return knots[0]?.[channel] ?? 0;
  const last = exposures.length - 1;
  if (value >= (exposures[last] ?? value)) return knots[last]?.[channel] ?? 0;
  const index = exposures.findIndex((exposure) => value <= exposure) - 1;
  const left = exposures[index] ?? exposures[0] ?? 0;
  const right = exposures[index + 1] ?? left + 1;
  const amount = (value - left) / (right - left);
  return (knots[index]?.[channel] ?? 0) * (1 - amount) + (knots[index + 1]?.[channel] ?? 0) * amount;
};

export const calibrateColorNegativeDataset = (dataset: ColorNegativeDataset): ColorNegativeCalibrationReport => {
  validateColorNegativeDataset(dataset);
  const train = dataset.samples.filter((sample) => sample.split === 'train');
  const holdout = dataset.samples.filter((sample) => sample.split === 'holdout');
  const fit = fitMonotoneKnots(train);
  const errors: number[] = [];
  let chroma = 0;
  for (const sample of holdout) {
    const measured = sample.transmittanceRgb.map(density);
    const predicted = [0, 1, 2].map((channel) => interpolate(sample.exposureEv, fit.exposures, fit.densities, channel));
    errors.push(...predicted.map((value, channel) => value - (measured[channel] ?? 0)));
    const mean = measured.reduce((sum, value) => sum + value, 0) / measured.length;
    chroma += Math.hypot(...measured.map((value) => value - mean));
  }
  const fitInputSha256 = `sha256:${sha256(canonical(train))}`;
  return {
    schemaVersion: 1,
    datasetId: dataset.datasetId,
    sourceSha256: dataset.sourceSha256,
    trainSampleIds: train.map((sample) => sample.id),
    holdoutSampleIds: holdout.map((sample) => sample.id),
    exposureKnotsEv: fit.exposures,
    densityKnots: fit.densities,
    holdoutDensityRmse: Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length),
    neutralChromaMean: chroma / holdout.length,
    fitInputSha256,
    limitations: [
      'Measured data is valid only for the declared dataset, process, and illuminant.',
      'Print, grain, and halation stages require separately evidenced measurements.',
    ],
  };
};

const parseArgs = (args: string[]): { dataset: string; out?: string; verifyHoldout: boolean } => {
  const dataset = args[args.indexOf('--dataset') + 1];
  if (!dataset) throw new Error('missing_--dataset');
  return {
    dataset,
    out: args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined,
    verifyHoldout: args.includes('--verify-holdout'),
  };
};

if (import.meta.main) {
  const { dataset, out, verifyHoldout } = parseArgs(Bun.argv.slice(2));
  const input = JSON.parse(await readFile(join(dataset, 'dataset.json'), 'utf8')) as ColorNegativeDataset;
  const report = calibrateColorNegativeDataset(input);
  if (verifyHoldout && !Number.isFinite(report.holdoutDensityRmse)) throw new Error('holdout_metrics_non_finite');
  if (out) {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'calibration-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(
    JSON.stringify({
      datasetId: report.datasetId,
      holdoutDensityRmse: report.holdoutDensityRmse,
      fitInputSha256: report.fitInputSha256,
    }),
  );
}
