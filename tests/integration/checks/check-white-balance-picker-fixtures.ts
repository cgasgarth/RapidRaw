#!/usr/bin/env bun

import { technicalWhiteBalanceMatrix } from '../../../src/utils/color/whiteBalance.ts';
import { buildWhiteBalancePickerAdjustmentCommand } from '../../../src/utils/whiteBalancePicker.ts';

const samples = [
  { blue: 128, green: 128, red: 128 },
  { blue: 180, green: 120, red: 90 },
  { blue: 80, green: 90, red: 240 },
] as const;

for (const [index, averageRgb] of samples.entries()) {
  const command = buildWhiteBalancePickerAdjustmentCommand({
    averageRgb,
    coordinates: { imageX: index, imageY: index, previewPixelX: index, previewPixelY: index },
    previewIdentity: `preview:${String(index)}`,
    selectedImagePath: `/fixtures/wb-${String(index)}.dng`,
  });
  const whiteBalance = command.patch.whiteBalanceTechnical;
  if (whiteBalance.mode !== 'chromaticity' || whiteBalance.source !== 'picker') {
    throw new Error(`Picker sample ${String(index)} did not produce current technical WB authority.`);
  }
  if (command.receipt.resultingKelvin !== whiteBalance.kelvin || command.receipt.resultingDuv !== whiteBalance.duv) {
    throw new Error(`Picker sample ${String(index)} receipt diverged from render authority.`);
  }
  if (!technicalWhiteBalanceMatrix(whiteBalance).flat().every(Number.isFinite)) {
    throw new Error(`Picker sample ${String(index)} produced a non-finite render matrix.`);
  }
}

console.log(`Validated ${String(samples.length)} technical white balance picker samples.`);
