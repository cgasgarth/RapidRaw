import { calibrateReversalDataset, type ReversalDataset } from '../../../../scripts/film/calibrate-reversal';

const samples = Array.from({ length: 10 }, (_, index) => {
  const exposureEv = -4 + (index % 5) * 2;
  const transmittance = 10 ** -(1.5 - exposureEv * 0.08);
  return {
    id: `sample-${index}`,
    split: index < 5 ? ('train' as const) : ('holdout' as const),
    exposureEv,
    transmittanceRgb: [transmittance, transmittance * 0.99, transmittance * 1.01] as [number, number, number],
    highlightReferenceEv: exposureEv >= 2 ? exposureEv : undefined,
  };
});
const dataset: ReversalDataset = {
  schemaVersion: 1,
  datasetId: 'contract-test-measured-reversal',
  status: 'measured',
  licenseSpdx: ['CC0-1.0'],
  sourceSha256: `sha256:${'a'.repeat(64)}`,
  samples,
};
const report = calibrateReversalDataset(dataset);
if (report.trainSampleIds.some((id) => report.holdoutSampleIds.includes(id)))
  throw new Error('Holdout leakage detected.');
if (!Number.isFinite(report.holdoutDensityRmse) || report.holdoutDensityRmse > 0.025)
  throw new Error('Reversal holdout threshold failed.');
if (report.highlightReferenceErrorEv > 1 / 6) throw new Error('Shoulder reference error exceeded.');
console.log('measured reversal calibration contract ok');
