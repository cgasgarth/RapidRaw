import {
  type ColorNegativeDataset,
  calibrateColorNegativeDataset,
} from '../../../../scripts/film/calibrate-color-negative';

const samples = Array.from({ length: 10 }, (_, index) => {
  const exposureEv = -4 + (index % 5) * 2;
  const density = 0.2 + exposureEv * 0.03;
  const transmittance = 10 ** -density;
  return {
    id: `sample-${index}`,
    split: index < 5 ? ('train' as const) : ('holdout' as const),
    exposureEv,
    transmittanceRgb: [transmittance, transmittance * 0.99, transmittance * 1.01] as [number, number, number],
  };
});
const dataset: ColorNegativeDataset = {
  schemaVersion: 1,
  datasetId: 'contract-test-measured-negative',
  status: 'measured',
  licenseSpdx: ['CC0-1.0'],
  sourceSha256: `sha256:${'a'.repeat(64)}`,
  samples,
};
const report = calibrateColorNegativeDataset(dataset);
if (report.trainSampleIds.some((id) => report.holdoutSampleIds.includes(id)))
  throw new Error('Holdout leakage detected.');
if (!Number.isFinite(report.holdoutDensityRmse) || report.holdoutDensityRmse > 0.03)
  throw new Error(`Unexpected holdout RMSE: ${report.holdoutDensityRmse}`);
if (
  report.densityKnots.some(
    (knot, index) =>
      index > 0 && knot.some((value, channel) => value < (report.densityKnots[index - 1]?.[channel] ?? value)),
  )
)
  throw new Error('Fitted density response must be monotone.');
console.log('measured color-negative calibration contract ok');
