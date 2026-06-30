import type { GamutWarningOverlayPayload } from '../../../schemas/tauriEventSchemas';

interface ExportSoftProofTransformForGamutWarning {
  blackPointCompensation: string | null;
  colorManagedTransform: string | null;
  effectiveColorProfile: string | null;
  effectiveRenderingIntent: string | null;
  policyStatus: string | null;
  policyVersion: string | null;
  sourcePrecisionPath: string | null;
  transformApplied: boolean | null;
  transformPolicyFingerprint: string | null;
}

interface ExportSoftProofOverlayContext {
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformForGamutWarning | null;
  isExportSoftProofEnabled: boolean;
  selectedImagePath: string | null;
}

export const formatGamutWarningCoverage = (overlay: GamutWarningOverlayPayload | null): string => {
  if (!overlay || overlay.warning_pixel_count === 0) return 'Clear';

  const percent = overlay.coverage_ratio * 100;
  if (percent < 0.1) return '<0.1%';
  if (percent >= 99.95) return '100%';
  return `${percent.toFixed(1)}%`;
};

const matchesNullableString = (left: string, right: string | null): boolean => right !== null && left === right;

export const isCurrentExportSoftProofGamutWarningOverlay = (
  overlay: GamutWarningOverlayPayload | null,
  context: ExportSoftProofOverlayContext,
): overlay is GamutWarningOverlayPayload => {
  const transform = context.exportSoftProofTransform;
  if (!overlay || !context.isExportSoftProofEnabled || transform === null) return false;
  if (overlay.preview_basis !== 'export_preview') return false;
  if (overlay.warning_pixel_count <= 0 || overlay.coverage_ratio <= 0) return false;
  if (overlay.source_image_path !== context.selectedImagePath) return false;
  if (overlay.export_soft_proof_recipe_id !== context.exportSoftProofRecipeId) return false;

  return (
    matchesNullableString(overlay.black_point_compensation, transform.blackPointCompensation) &&
    matchesNullableString(overlay.color_managed_transform, transform.colorManagedTransform) &&
    matchesNullableString(overlay.effective_color_profile, transform.effectiveColorProfile) &&
    matchesNullableString(overlay.effective_rendering_intent, transform.effectiveRenderingIntent) &&
    matchesNullableString(overlay.policy_status, transform.policyStatus) &&
    matchesNullableString(overlay.policy_version, transform.policyVersion) &&
    matchesNullableString(overlay.source_precision_path, transform.sourcePrecisionPath) &&
    overlay.transform_applied === transform.transformApplied &&
    matchesNullableString(overlay.transform_policy_fingerprint, transform.transformPolicyFingerprint)
  );
};

export const isPendingExportSoftProofGamutWarningOverlay = (
  overlay: GamutWarningOverlayPayload | null,
  context: ExportSoftProofOverlayContext,
): overlay is GamutWarningOverlayPayload => {
  if (!overlay || !context.isExportSoftProofEnabled) return false;
  if (overlay.preview_basis !== 'export_preview') return false;
  if (overlay.source_image_path !== context.selectedImagePath) return false;
  if (overlay.export_soft_proof_recipe_id !== context.exportSoftProofRecipeId) return false;
  return context.exportSoftProofTransform === null || isCurrentExportSoftProofGamutWarningOverlay(overlay, context);
};
