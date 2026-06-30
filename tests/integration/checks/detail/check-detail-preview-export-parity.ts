#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  detailPreviewExportParityManifestSchema,
  parseDetailPreviewExportParityManifest,
} from '../../../../src/schemas/detailValidationSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const makeVerticalEdge = ({ width, height, leftValue, rightValue }) => {
  const pixels = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x < Math.floor(width / 2) ? leftValue : rightValue;
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return pixels;
};

const boxBlur3x3 = (pixels, width, height) => {
  const blurred = new Float32Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
              continue;
            }
            sum += pixels[(sy * width + sx) * 3 + channel];
            count += 1;
          }
        }
        blurred[(y * width + x) * 3 + channel] = sum / count;
      }
    }
  }
  return blurred;
};

const applySyntheticSharpen = (pixels, width, height, { amount, threshold }) => {
  if (amount <= 0) {
    return new Float32Array(pixels);
  }
  const blurred = boxBlur3x3(pixels, width, height);
  const output = new Float32Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 3) {
    const detailR = pixels[index] - blurred[index];
    const detailG = pixels[index + 1] - blurred[index + 1];
    const detailB = pixels[index + 2] - blurred[index + 2];
    const detailLuma = Math.abs(0.299 * detailR + 0.587 * detailG + 0.114 * detailB);
    const gain = detailLuma >= threshold ? amount : 0;
    output[index] = clamp01(pixels[index] + detailR * gain);
    output[index + 1] = clamp01(pixels[index + 1] + detailG * gain);
    output[index + 2] = clamp01(pixels[index + 2] + detailB * gain);
  }
  return output;
};

const maxAbsDiff = (left, right) => {
  let max = 0;
  for (let index = 0; index < left.length; index += 1) {
    max = Math.max(max, Math.abs(left[index] - right[index]));
  }
  return max;
};

const runCase = (parityCase) => {
  const { width, height } = parityCase.syntheticFixture;
  const baseline = makeVerticalEdge(parityCase.syntheticFixture);
  const preview = applySyntheticSharpen(baseline, width, height, parityCase.tuning);
  const exportImage =
    parityCase.exportPath === 'shared_detail_stage'
      ? applySyntheticSharpen(baseline, width, height, parityCase.tuning)
      : applySyntheticSharpen(preview, width, height, parityCase.tuning);

  const previewExportDiff = maxAbsDiff(preview, exportImage);
  const baselinePreviewDelta = maxAbsDiff(baseline, preview);
  const baselineExportDelta = maxAbsDiff(baseline, exportImage);

  return {
    baselineExportDelta,
    baselinePreviewDelta,
    previewExportDiff,
  };
};

const manifest = parseDetailPreviewExportParityManifest(
  await readJson('fixtures/detail/proofs/preview-export-parity.json'),
);
const invalidCases = await readJson('fixtures/detail/invalid/proofs/invalid-preview-export-parity.json');
const failures = [];

for (const parityCase of manifest.cases) {
  const result = runCase(parityCase);

  if (parityCase.claim === 'enabled_synthetic_parity') {
    if (result.previewExportDiff > parityCase.maxAllowedChannelDiff) {
      failures.push(`${parityCase.caseId}: preview/export synthetic diff ${result.previewExportDiff}.`);
    }
    if (result.baselinePreviewDelta < parityCase.minRequiredPixelDelta) {
      failures.push(`${parityCase.caseId}: expected enabled detail stage to change pixels.`);
    }
  }

  if (parityCase.claim === 'disabled_noop_parity' && result.baselinePreviewDelta !== 0) {
    failures.push(`${parityCase.caseId}: disabled detail stage changed pixels.`);
  }

  if (parityCase.claim === 'export_intent_separated') {
    if (result.baselineExportDelta < parityCase.minRequiredPixelDelta) {
      failures.push(`${parityCase.caseId}: expected export intent stage to change exported pixels.`);
    }
    if (result.previewExportDiff <= parityCase.maxAllowedChannelDiff) {
      failures.push(`${parityCase.caseId}: output sharpening must remain export-intent separated.`);
    }
  }
}

for (const invalidCase of invalidCases) {
  const result = detailPreviewExportParityManifestSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected detail preview/export parity rejection.`);
  }
}

if (failures.length > 0) {
  console.error('Detail preview/export parity validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${manifest.cases.length} detail preview/export parity cases and ${invalidCases.length} invalid cases.`,
);
