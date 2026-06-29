#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');
const enLocale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const messages = enLocale.modals?.negativeConversion ?? {};

const requiredModalMarkers = [
  'DEFAULT_NEGATIVE_LAB_PRINT_CURVE_V2_PARAMS',
  'handleSetPrintCurveV2Enabled',
  'handlePrintCurveV2ParamChange',
  'data-testid="negative-lab-v2-qc-readouts"',
  'data-testid="negative-lab-v2-algorithm-toggle"',
  'data-testid="negative-lab-v2-crosstalk-status"',
  'data-testid="negative-lab-v2-auto-suggestion-status"',
  'data-testid="negative-lab-v2-density-range-status"',
  'data-testid="negative-lab-v2-preview-export-status"',
  'data-testid="negative-lab-v2-print-curve-controls"',
  "selectedProfile?.filmClass === 'black_and_white_silver'",
  "data-preview-export-parity-state={workspaceProof.exportReady ? 'ready_for_receipt' : 'blocked'}",
  "handlePrintCurveV2ParamChange('contrast_grade'",
  "handlePrintCurveV2ParamChange('toe_strength'",
  "handlePrintCurveV2ParamChange('shoulder_strength'",
  "handlePrintCurveV2ParamChange('density_offset'",
];

const requiredLocaleKeys = [
  'v2AlgorithmDisabled',
  'v2AlgorithmEnabled',
  'v2AutoSuggestionStatus',
  'v2ContrastGrade',
  'v2CrosstalkStatus',
  'v2DensityOffset',
  'v2DensityRangeStatus',
  'v2PreviewExportBlocked',
  'v2PreviewExportReady',
  'v2QcReadouts',
  'v2ShoulderStrength',
  'v2ToeStrength',
];

const failures = [];

for (const marker of requiredModalMarkers) {
  if (!modalSource.includes(marker)) failures.push(`missing modal marker: ${marker}`);
}

for (const key of requiredLocaleKeys) {
  if (typeof messages[key] !== 'string' || messages[key].length === 0) {
    failures.push(`missing en locale key: modals.negativeConversion.${key}`);
  }
}

if (failures.length > 0) {
  console.error(`Negative Lab v2 UI/QC readout check failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('negative lab v2 UI/QC readouts ok');
