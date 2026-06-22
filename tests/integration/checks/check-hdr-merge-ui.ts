#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { DEFAULT_HDR_MERGE_UI_SETTINGS, hdrMergeUiSettingsSchema } from '../../../src/schemas/hdrMergeUiSchemas.ts';

const requiredLocaleKeys = [
  'alignment.auto',
  'alignment.homography',
  'alignment.none',
  'alignment.translation',
  'alignmentLabel',
  'apiPending',
  'bracketDetectionMethod.caller_declared_ev',
  'bracketDetectionMethod.luminance_estimate',
  'bracketDetectionMethod.manual_order',
  'bracketDetectionMethod.metadata_exposure_compensation',
  'bracketDetectionMethod.metadata_exposure_time_iso_aperture',
  'bracketPreflightAccepted',
  'bracketPreflightBlocked',
  'bracketPreflightBlockedDetail',
  'bracketPreflightConfidence',
  'bracketPreflightConfidenceValue',
  'bracketPreflightManual',
  'bracketPreflightMethod',
  'bracketPreflightSpan',
  'bracketPreflightSpanValue',
  'bracketPreflightTitle',
  'bracketPreflightWarning',
  'bracketRole.over_exposed',
  'bracketRole.reference',
  'bracketRole.under_exposed',
  'bracketRole.unknown',
  'bracketValidation.required',
  'bracketValidation.warn',
  'bracketValidationLabel',
  'deghosting.high',
  'deghosting.low',
  'deghosting.medium',
  'deghosting.off',
  'deghostingLabel',
  'previewBudgetLabel',
  'previewMemory',
  'previewPixels',
  'previewWorkload',
  'quality.balanced',
  'quality.best',
  'quality.preview',
  'qualityLabel',
  'reviewAlignment',
  'reviewDeghost',
  'reviewDiagnosticsLimit',
  'reviewDiagnosticsTitle',
  'reviewRisk.high',
  'reviewRisk.low',
  'reviewRisk.medium',
  'reviewRisk.none',
  'reviewSeverity.blocked',
  'reviewSeverity.ok',
  'reviewSeverity.review',
  'reviewTone',
  'sourceCountBlocked',
  'strategy.exposureFusion',
  'strategy.sceneLinear',
  'strategyLabel',
  'summaryAlignment',
  'summaryBlocked',
  'summaryDeghosting',
  'summaryMemory',
  'summaryOff',
  'summaryOn',
  'summaryPreviewBudget',
  'summaryQuality',
  'summaryReady',
  'summarySourceCount_one',
  'summarySourceCount_other',
  'summarySources',
  'summaryStrategy',
  'summaryToneMapPreview',
  'summaryWorkload',
  'toneMapPreview',
  'uiOnlyNotice',
  'workflowStatus',
  'workflowTitle',
];

const getValue = (root, path) =>
  path.split('.').reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), root);

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const missingKeys = requiredLocaleKeys.filter((key) => typeof getValue(locale.modals?.hdr, key) !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing HDR UI locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const valid = hdrMergeUiSettingsSchema.safeParse(DEFAULT_HDR_MERGE_UI_SETTINGS);
if (!valid.success) {
  console.error(valid.error.message);
  process.exit(1);
}

const invalid = hdrMergeUiSettingsSchema.safeParse({
  ...DEFAULT_HDR_MERGE_UI_SETTINGS,
  maxPreviewDimensionPx: 16_384,
});
if (invalid.success) {
  console.error('HDR UI schema accepted an oversized preview budget.');
  process.exit(1);
}

const source = readFileSync('src/components/modals/HdrModal.tsx', 'utf8');
for (const marker of [
  'hdr-setup-summary',
  'hdr-setup-summary-chip',
  'estimatedPreviewMemoryMb',
  'data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}',
  'data-estimated-preview-megapixels={estimatedPreviewMegapixels}',
  'data-preview-source-count={imageCount ?? 0}',
  'hdr-readiness-summary',
  'hdr-readiness-sources',
  'hdr-readiness-validation',
  'hdr-readiness-alignment',
  'hdr-readiness-merge',
  'hdr-bracket-preflight',
  'hdr-bracket-source-row',
  'hdr-bracket-source-role',
  'getBracketRoleLabel(source.resolvedBracketRole)',
  'hdr-review-diagnostics-panel',
  'hdr-review-diagnostic-row',
  'data-review-decision={reviewDiagnostics.reviewDecision}',
  'data-warning-severity={reviewDiagnostics.warningSeverity}',
  'data-clipping-risk={reviewDiagnostics.tone.clippingRisk}',
  'data-motion-risk={reviewDiagnostics.deghost.motionRisk}',
  'data-merge-ready={String(isMergeReady)}',
  'data-bracket-accepted=',
  'data-bracket-method=',
  'data-bracket-span-ev=',
  'data-bracket-confidence=',
  'data-bracket-validation={settings.bracketValidation}',
  'buildHdrBracketPreflight',
  'modals.hdr.summarySources',
  'modals.hdr.bracketPreflightTitle',
  'modals.hdr.bracketPreflightAccepted',
  'modals.hdr.summarySourceCount',
  'modals.hdr.summaryReady',
  'modals.hdr.summaryStrategy',
  'modals.hdr.summaryToneMapPreview',
  'modals.hdr.summaryWorkload',
  'modals.hdr.summaryMemory',
  'modals.hdr.previewMemory',
  'modals.hdr.previewWorkload',
  'modals.hdr.summaryAlignment',
  'settings.maxPreviewDimensionPx',
]) {
  if (!source.includes(marker)) {
    console.error(`HDR modal missing setup summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('hdr merge UI ok');
