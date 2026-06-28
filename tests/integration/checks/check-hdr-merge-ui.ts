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
  'deghostReviewApproveAction',
  'deghostReviewApproved',
  'deghostReviewApprovedAction',
  'deghostConfidenceMapToggle',
  'deghostRegionIntensityValue',
  'deghostReviewMask',
  'deghostReviewConfidenceMapValue',
  'deghostReviewMaskValue',
  'deghostReviewMotion',
  'deghostReviewReference',
  'deghostReviewReferenceValue',
  'deghostReviewRequired',
  'deghostReviewTitle',
  'exposureWeighting.balanced',
  'exposureWeighting.liftShadows',
  'exposureWeighting.protectHighlights',
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
  'summaryDeghostConfidenceMap',
  'summaryDeghosting',
  'summaryDeghostRegionIntensity',
  'summaryMemory',
  'summaryOff',
  'summaryOn',
  'summaryPreviewBudget',
  'summaryQuality',
  'summaryReady',
  'summarySourceCount_one',
  'summarySourceCount_other',
  'summarySources',
  'summaryStartState',
  'summaryStrategy',
  'summaryToneMapPreview',
  'summaryToneMappingPreset',
  'summaryWorkload',
  'toneMappingPreset.custom',
  'toneMappingPreset.fastPreview',
  'toneMappingPreset.highlightDetail',
  'toneMappingPreset.interiorLift',
  'toneMappingPreset.natural',
  'toneMappingPresetLabel',
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

const invalidPreset = hdrMergeUiSettingsSchema.safeParse({
  ...DEFAULT_HDR_MERGE_UI_SETTINGS,
  toneMappingPreset: 'tone_crush',
});
if (invalidPreset.success) {
  console.error('HDR UI schema accepted an unknown tone-mapping preset.');
  process.exit(1);
}

const source = readFileSync('src/components/modals/HdrModal.tsx', 'utf8');
for (const marker of [
  'hdr-setup-summary',
  'hdr-setup-summary-chip',
  'estimatedPreviewMemoryMb',
  'data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}',
  'data-estimated-preview-megapixels={estimatedPreviewMegapixels}',
  'data-preview-source-count={selectedSourceCount}',
  'hdr-readiness-summary',
  'hdr-readiness-sources',
  'hdr-readiness-validation',
  'hdr-readiness-alignment',
  'hdr-readiness-merge',
  'hdr-bracket-preflight',
  'hdr-bracket-source-row',
  'hdr-bracket-source-role',
  'hdr-exposure-weighting-mode',
  'data-bracket-selected={String(selectedSourceIndexes.has(source.sourceIndex))}',
  'data-exposure-weight-multiplier={getSourceWeightMultiplier(source)}',
  'getBracketRoleLabel(source.resolvedBracketRole)',
  'hdr-review-diagnostics-panel',
  'hdr-review-diagnostic-row',
  'hdr-deghost-review-gate',
  'hdr-deghost-motion-overlay',
  'hdr-deghost-confidence-map-toggle',
  'hdr-deghost-region-intensity',
  'hdr-deghost-review-approve',
  'hdr-tone-mapping-presets',
  'hdr-tone-mapping-preset-${preset.id}',
  'applyHdrToneMappingPreset',
  'data-review-decision={reviewDiagnostics.reviewDecision}',
  'data-warning-severity={reviewDiagnostics.warningSeverity}',
  'data-review-approved={String(isDeghostReviewApproved)}',
  'data-clipping-risk={reviewDiagnostics.tone.clippingRisk}',
  'data-motion-risk={reviewDiagnostics.deghost.motionRisk}',
  'data-deghost-confidence-map-visible={String(reviewDiagnostics.deghost.confidenceMapVisible)}',
  'data-deghost-region-intensity-percent={reviewDiagnostics.deghost.regionIntensityPercent}',
  'data-merge-ready={String(isMergeReady)}',
  'data-bracket-accepted=',
  'data-bracket-method=',
  'data-bracket-span-ev=',
  'data-bracket-confidence=',
  'data-bracket-validation={settings.bracketValidation}',
  'exposureWeightingMode',
  'buildHdrBracketPreflight',
  'modals.hdr.summarySources',
  'modals.hdr.bracketPreflightTitle',
  'modals.hdr.bracketPreflightAccepted',
  'modals.hdr.summarySourceCount',
  'modals.hdr.summaryReady',
  'modals.hdr.summaryStartState',
  'modals.hdr.summaryStrategy',
  'modals.hdr.summaryToneMapPreview',
  'modals.hdr.summaryToneMappingPreset',
  'modals.hdr.toneMappingPresetLabel',
  'modals.hdr.summaryWorkload',
  'modals.hdr.summaryMemory',
  'modals.hdr.previewMemory',
  'modals.hdr.previewWorkload',
  'modals.hdr.summaryAlignment',
  'settings.maxPreviewDimensionPx',
  'applyReadinessLabel',
  'isApplyReady',
]) {
  if (!source.includes(marker)) {
    console.error(`HDR modal missing setup summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('hdr merge UI ok');
