import type { RawDevelopmentReport } from '../schemas/imageLoaderSchemas';
import type { TFunction } from 'i18next';

export interface RawWarningReceiptInput {
  policyStatus?: string | null | undefined;
  rawDevelopmentReport?: RawDevelopmentReport | null | undefined;
  resolvedDisabledReason?: string | null | undefined;
  transformApplied?: boolean | null | undefined;
}

export interface RawWarningChip {
  code: string;
  label: string;
  tone: 'caution' | 'warning';
}

const normalizeWarningCode = (code: string): string =>
  code
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_');

const addChip = (chips: RawWarningChip[], code: string, label: string, tone: RawWarningChip['tone']) => {
  const normalizedCode = normalizeWarningCode(code);
  if (normalizedCode.length === 0 || chips.some((chip) => chip.code === normalizedCode)) return;
  chips.push({ code: normalizedCode, label, tone });
};

export function buildRawWarningChips(input: RawWarningReceiptInput, t: TFunction): RawWarningChip[] {
  const chips: RawWarningChip[] = [];
  const report = input.rawDevelopmentReport ?? null;

  for (const warningCode of report?.cameraProfile.warningCodes ?? []) {
    addChip(chips, warningCode, warningCode, 'warning');
  }
  if (report?.cameraProfile.fallbackReason) {
    addChip(chips, report.cameraProfile.fallbackReason, report.cameraProfile.fallbackReason, 'warning');
  }
  if (report?.cameraProfile.status === 'fallback' || report?.cameraProfile.status === 'unavailable') {
    addChip(chips, `profile_${report.cameraProfile.status}`, report.cameraProfile.status, 'warning');
  }
  if (report?.demosaicPath === 'fast' || report?.demosaicPath === 'linear_bypass') {
    addChip(chips, `demosaic_${report.demosaicPath}`, report.demosaicPath, 'caution');
  }
  if (input.policyStatus && input.policyStatus !== 'applied') {
    addChip(chips, `color_policy_${input.policyStatus}`, input.policyStatus, 'caution');
  }
  if (input.resolvedDisabledReason) {
    addChip(chips, input.resolvedDisabledReason, input.resolvedDisabledReason, 'caution');
  }
  if (input.transformApplied === false && input.policyStatus === 'applied') {
    addChip(
      chips,
      'color_transform_not_applied',
      t('editor.metadata.cameraProfile.warning.colorTransformNotApplied'),
      'caution',
    );
  }

  return chips;
}
