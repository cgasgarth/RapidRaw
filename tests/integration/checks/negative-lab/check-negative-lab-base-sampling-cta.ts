import { readFileSync } from 'node:fs';

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const enLocale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const negativeConversionLocale = enLocale.modals?.negativeConversion ?? {};

const requiredModalMarkers = [
  'positivePreviewReady',
  'previewReadinessLabel',
  'baseSamplingActionLabelKey',
  'negative-lab-base-sampling-cta',
  'negative-lab-base-sampling-cta-status',
  'negative-lab-base-sampling-cta-preview',
  'negative-lab-base-sampling-cta-export',
  'negative-lab-base-sampling-primary-action',
  'negative-lab-base-sampling-left-edge-action',
  'data-positive-preview-ready={String(positivePreviewReady)}',
  "t('modals.negativeConversion.baseSampleRequired')",
  "t('modals.negativeConversion.saveBlockedByReason'",
  'void handleAutoBaseFog();',
  'handleAcceptBaseSample();',
  'renderBaseSamplingCta()',
  'isComplete: baseReady',
  'isComplete: canSave',
] as const;

for (const marker of requiredModalMarkers) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab base sampling CTA marker missing: ${marker}`);
  }
}

if (
  modalSource.includes(
    "workspaceProof.previewReady\n              ? t('modals.negativeConversion.previewReady')\n              : t('modals.negativeConversion.previewPending')",
  )
) {
  throw new Error('Negative Lab workflow rail still presents raw previewReady as the main preview success state.');
}

for (const key of [
  'baseSampleAccepted',
  'baseSampleRequired',
  'baseSamplingCtaAcceptHint',
  'baseSamplingCtaEstimateHint',
  'baseSamplingCtaReadyHint',
  'baseSamplingCtaReadyTitle',
  'baseSamplingCtaTitle',
  'estimateBaseSample',
  'saveBlockedByReason',
] as const) {
  if (typeof negativeConversionLocale[key] !== 'string' || negativeConversionLocale[key].length === 0) {
    throw new Error(`Negative Lab base sampling CTA locale key missing: ${key}`);
  }
}

console.log('negative lab base sampling cta ok');
