import type { SelectedImage } from '../../../components/ui/AppProperties';
import type { GamutWarningOverlayPayload } from '../../../schemas/tauriEventSchemas';
import type { Adjustments } from '../../adjustments';

export interface ProofDimensions {
  height: number;
  width: number;
}

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

export type PreviewBoundWarningState = 'current' | 'stale' | 'unavailable' | 'unsupported';

export interface RenderedPreviewWarningStatus {
  coverageLabel: string;
  displayProfileLabel: string;
  exportProfileLabel: string | null;
  renderTargetLabel: string;
  state: PreviewBoundWarningState;
  statusLabel: string;
}

export interface PreviewScopeFreshnessInput {
  histogramReady: boolean;
  path: string;
  renderBasis: string;
  softProofTransformApplied: boolean;
  waveformReady: boolean;
}

export interface PreviewScopeFreshnessStatus {
  state: PreviewBoundWarningState;
  statusLabel: string;
}

export type EditorChromeStatusChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type EditorChromeStatusChipId =
  | 'shadow-clipping'
  | 'highlight-clipping'
  | 'gamut-warning'
  | 'soft-proof'
  | 'preview-scopes';

export interface EditorChromeStatusChip {
  active: boolean;
  detail: string;
  id: EditorChromeStatusChipId;
  label: string;
  state: PreviewBoundWarningState;
  tone: EditorChromeStatusChipTone;
  value: string;
}

export const formatGamutWarningCoverage = (overlay: GamutWarningOverlayPayload | null): string => {
  if (!overlay || overlay.warning_pixel_count === 0) return 'Clear';

  const percent = overlay.coverage_ratio * 100;
  if (percent < 0.1) return '<0.1%';
  if (percent >= 99.95) return '100%';
  return `${percent.toFixed(1)}%`;
};

const matchesNullableString = (left: string, right: string | null): boolean => right !== null && left === right;

export const resolveGamutWarningProofDimensions = (
  overlay: GamutWarningOverlayPayload | null,
  selectedImage: SelectedImage | null,
): ProofDimensions => {
  if (overlay) {
    return { height: overlay.height, width: overlay.width };
  }

  const runtimeDimensions = selectedImage?.rawDevelopmentReport?.runtime?.outputDimensions;
  if (runtimeDimensions && runtimeDimensions[0] > 0 && runtimeDimensions[1] > 0) {
    return { height: runtimeDimensions[1], width: runtimeDimensions[0] };
  }

  if (selectedImage && selectedImage.width > 0 && selectedImage.height > 0) {
    return { height: selectedImage.height, width: selectedImage.width };
  }

  return { height: 0, width: 0 };
};

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

const cleanProfileLabel = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export const getRenderedPreviewWarningStatus = (
  overlay: GamutWarningOverlayPayload | null,
  context: ExportSoftProofOverlayContext,
): RenderedPreviewWarningStatus => {
  const transform = context.exportSoftProofTransform;
  const currentOverlay = isCurrentExportSoftProofGamutWarningOverlay(overlay, context) ? overlay : null;
  const exportProfileLabel = cleanProfileLabel(
    currentOverlay?.effective_color_profile ?? transform?.effectiveColorProfile ?? null,
  );
  const displayProfileLabel = exportProfileLabel ?? 'Display profile unavailable';

  if (!context.isExportSoftProofEnabled) {
    return {
      coverageLabel: 'Clear',
      displayProfileLabel,
      exportProfileLabel,
      renderTargetLabel: 'Editor preview',
      state: 'unavailable',
      statusLabel: 'Soft proof disabled',
    };
  }

  if (transform === null) {
    return {
      coverageLabel: formatGamutWarningCoverage(overlay),
      displayProfileLabel,
      exportProfileLabel,
      renderTargetLabel: 'Export preview pending',
      state: 'unavailable',
      statusLabel: 'Preview render pending',
    };
  }

  if (transform.transformApplied !== true) {
    return {
      coverageLabel: 'Clear',
      displayProfileLabel,
      exportProfileLabel,
      renderTargetLabel: exportProfileLabel ? `Export preview -> ${exportProfileLabel}` : 'Export preview',
      state: 'unsupported',
      statusLabel: 'Soft proof unsupported',
    };
  }

  if (currentOverlay !== null) {
    return {
      coverageLabel: formatGamutWarningCoverage(currentOverlay),
      displayProfileLabel,
      exportProfileLabel,
      renderTargetLabel: `Export preview -> ${currentOverlay.effective_color_profile}`,
      state: 'current',
      statusLabel: 'Rendered preview current',
    };
  }

  return {
    coverageLabel: formatGamutWarningCoverage(overlay),
    displayProfileLabel,
    exportProfileLabel,
    renderTargetLabel: exportProfileLabel ? `Export preview -> ${exportProfileLabel}` : 'Export preview',
    state: overlay === null ? 'unavailable' : 'stale',
    statusLabel: overlay === null ? 'Gamut mask unavailable' : 'Gamut mask stale',
  };
};

export const getPreviewScopeFreshnessStatus = (
  previewScopeStatus: PreviewScopeFreshnessInput | null,
  selectedImagePath: string | null,
): PreviewScopeFreshnessStatus => {
  if (previewScopeStatus === null) {
    return { state: 'unavailable', statusLabel: 'Scopes unavailable' };
  }

  if (previewScopeStatus.renderBasis === 'export_preview' && !previewScopeStatus.softProofTransformApplied) {
    return { state: 'unsupported', statusLabel: 'Soft proof scopes unsupported' };
  }

  if (previewScopeStatus.path !== selectedImagePath) {
    return { state: 'stale', statusLabel: 'Scopes stale' };
  }

  if (!previewScopeStatus.histogramReady || !previewScopeStatus.waveformReady) {
    return { state: 'unavailable', statusLabel: 'Scopes updating' };
  }

  return { state: 'current', statusLabel: 'Scopes current' };
};

const previewStateToTone = (state: PreviewBoundWarningState): EditorChromeStatusChipTone => {
  switch (state) {
    case 'current':
      return 'success';
    case 'stale':
      return 'warning';
    case 'unsupported':
      return 'neutral';
    case 'unavailable':
      return 'info';
  }
};

const softProofStateToTone = (state: RenderedPreviewWarningStatus['state']): EditorChromeStatusChipTone => {
  if (state === 'current') return 'success';
  if (state === 'stale') return 'warning';
  if (state === 'unsupported') return 'neutral';
  return 'info';
};

export const getEditorChromeStatusChips = ({
  adjustments,
  gamutWarningOverlay,
  previewScopeStatus,
  proofContext,
}: {
  adjustments: Pick<Adjustments, 'levels'>;
  gamutWarningOverlay: GamutWarningOverlayPayload | null;
  previewScopeStatus: PreviewScopeFreshnessInput | null;
  proofContext: ExportSoftProofOverlayContext;
}): EditorChromeStatusChip[] => {
  const renderedPreviewWarningStatus = getRenderedPreviewWarningStatus(gamutWarningOverlay, proofContext);
  const previewScopeFreshnessStatus = getPreviewScopeFreshnessStatus(
    previewScopeStatus,
    proofContext.selectedImagePath,
  );
  const levels = adjustments.levels;
  const isShadowClipping = levels.inputBlack > 0;
  const isHighlightClipping = levels.inputWhite < 1;
  const hasCurrentGamutWarning =
    renderedPreviewWarningStatus.state === 'current' &&
    gamutWarningOverlay !== null &&
    gamutWarningOverlay.warning_pixel_count > 0;

  return [
    {
      active: isShadowClipping,
      detail: isShadowClipping ? `Input black ${Math.round(levels.inputBlack * 100)}%` : 'Input black at 0%',
      id: 'shadow-clipping',
      label: 'Shadows',
      state: isShadowClipping ? 'current' : 'unavailable',
      tone: isShadowClipping ? 'danger' : 'neutral',
      value: isShadowClipping ? 'Clipping' : 'Clean',
    },
    {
      active: isHighlightClipping,
      detail: isHighlightClipping ? `Input white ${Math.round(levels.inputWhite * 100)}%` : 'Input white at 100%',
      id: 'highlight-clipping',
      label: 'Highlights',
      state: isHighlightClipping ? 'current' : 'unavailable',
      tone: isHighlightClipping ? 'danger' : 'neutral',
      value: isHighlightClipping ? 'Clipping' : 'Clean',
    },
    {
      active: hasCurrentGamutWarning,
      detail: renderedPreviewWarningStatus.renderTargetLabel,
      id: 'gamut-warning',
      label: 'Gamut',
      state: renderedPreviewWarningStatus.state,
      tone: hasCurrentGamutWarning ? 'warning' : softProofStateToTone(renderedPreviewWarningStatus.state),
      value:
        renderedPreviewWarningStatus.state === 'current'
          ? renderedPreviewWarningStatus.coverageLabel
          : renderedPreviewWarningStatus.statusLabel,
    },
    {
      active: proofContext.isExportSoftProofEnabled,
      detail: renderedPreviewWarningStatus.renderTargetLabel,
      id: 'soft-proof',
      label: 'Soft proof',
      state: renderedPreviewWarningStatus.state,
      tone: softProofStateToTone(renderedPreviewWarningStatus.state),
      value: proofContext.isExportSoftProofEnabled ? renderedPreviewWarningStatus.statusLabel : 'Off',
    },
    {
      active: previewScopeFreshnessStatus.state === 'current',
      detail: previewScopeStatus?.renderBasis ?? 'Scopes pending',
      id: 'preview-scopes',
      label: 'Scopes',
      state: previewScopeFreshnessStatus.state,
      tone: previewStateToTone(previewScopeFreshnessStatus.state),
      value: previewScopeFreshnessStatus.statusLabel.replace(/^Scopes\s+/u, ''),
    },
  ];
};
