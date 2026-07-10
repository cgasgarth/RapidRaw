import type { SelectedImage } from '../../../components/ui/AppProperties';
import type { ActiveDisplayProfile, DisplayPreviewLutStatus } from '../../../schemas/displayProfileSchemas';
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

export type PreviewBoundWarningState = 'current' | 'error' | 'stale' | 'unavailable' | 'unsupported';

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
  warningCodes?: string[];
}

export interface PreviewScopeFreshnessStatus {
  state: PreviewBoundWarningState;
  statusLabel: string;
}

export type ColorOutputDiagnosticState = PreviewBoundWarningState | 'loading' | 'error';

export interface ColorOutputProofingDiagnosticsSummary {
  codes: string[];
  displayProfileHash: string | null;
  displayProfileLabel: string;
  displayProfileSource: string | null;
  displayProfileState: ColorOutputDiagnosticState;
  gamutCoverageLabel: string;
  gamutCoverageRatio: number;
  gamutWarningPixelCount: number;
  lutSampleCount: number;
  lutSize: number;
  lutState: ColorOutputDiagnosticState;
  lutStatusLabel: string;
  outputProfileLabel: string;
  previewProofState: PreviewBoundWarningState;
  previewProofStatusLabel: string;
  previewScopeState: PreviewBoundWarningState;
  previewScopeStatusLabel: string;
  renderingIntentLabel: string;
  softProofRecipeId: string | null;
  transformApplied: boolean | null;
  transformLabel: string;
  transformPolicyFingerprint: string | null;
  workingSpaceLabel: string;
}

export interface ColorOutputProofingDiagnosticRow {
  code: string;
  fingerprint: string | null;
  label: string;
  state: PreviewBoundWarningState;
}

export const buildColorOutputProofingDiagnosticRow = (
  diagnostics: ColorOutputProofingDiagnosticsSummary,
): ColorOutputProofingDiagnosticRow => ({
  code: `preview_scope_${diagnostics.previewScopeState}`,
  fingerprint: diagnostics.transformPolicyFingerprint,
  label: diagnostics.previewScopeStatusLabel,
  state: diagnostics.previewScopeState,
});

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

const editorChromeStatusPriority: Record<EditorChromeStatusChipId, number> = {
  'shadow-clipping': 0,
  'highlight-clipping': 1,
  'gamut-warning': 2,
  'soft-proof': 3,
  'preview-scopes': 4,
};

const editorChromeTonePriority: Record<EditorChromeStatusChipTone, number> = {
  danger: 0,
  warning: 1,
  info: 2,
  neutral: 3,
  success: 4,
};

/**
 * Surface only the diagnostics that need canvas-adjacent feedback, ordered by
 * urgency so the compact status lane cannot bury clipping behind routine state.
 */
export const getEditorChromeStatusStripChips = (chips: EditorChromeStatusChip[]): EditorChromeStatusChip[] =>
  chips
    .filter(
      (chip) =>
        chip.active &&
        (chip.tone === 'danger' || chip.tone === 'warning' || chip.id === 'soft-proof' || chip.id === 'preview-scopes'),
    )
    .sort(
      (left, right) =>
        editorChromeTonePriority[left.tone] - editorChromeTonePriority[right.tone] ||
        editorChromeStatusPriority[left.id] - editorChromeStatusPriority[right.id],
    );

export type EditorClippingStatusChip = EditorChromeStatusChip & {
  id: 'shadow-clipping' | 'highlight-clipping';
};

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

  if (previewScopeStatus.warningCodes?.some((code) => /error|fail/iu.test(code))) {
    return { state: 'error', statusLabel: 'Scopes error' };
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

const shortHash = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = /^sha256:([a-f0-9]{64})$/u.exec(value);
  return match ? `sha256:${match[1]!.slice(0, 12)}` : value;
};

const activeDisplayProfileStatusLabel = (status: ActiveDisplayProfile['status']): string => {
  switch (status) {
    case 'active_profile_loaded':
      return 'ColorSync active display profile';
    case 'fallback_no_active_profile':
      return 'sRGB fallback display profile';
    case 'unsupported_platform':
      return 'Display profile unsupported';
  }
};

const displayProfileState = (status: ActiveDisplayProfile['status']): PreviewBoundWarningState => {
  switch (status) {
    case 'active_profile_loaded':
      return 'current';
    case 'fallback_no_active_profile':
      return 'stale';
    case 'unsupported_platform':
      return 'unsupported';
  }
};

const displayPreviewLutStatusLabel = (status: DisplayPreviewLutStatus['status']): string => {
  switch (status) {
    case 'active_display_transform':
      return 'Active display LUT';
    case 'srgb_fallback_transform':
      return 'sRGB fallback LUT';
    case 'unsupported_platform':
      return 'Display LUT unsupported';
  }
};

const displayPreviewLutState = (status: DisplayPreviewLutStatus['status']): PreviewBoundWarningState => {
  switch (status) {
    case 'active_display_transform':
      return 'current';
    case 'srgb_fallback_transform':
      return 'stale';
    case 'unsupported_platform':
      return 'unsupported';
  }
};

const proofStateCode = (state: PreviewBoundWarningState): string => {
  switch (state) {
    case 'current':
      return 'preview_proof_current';
    case 'error':
      return 'preview_proof_error';
    case 'stale':
      return 'preview_proof_stale';
    case 'unsupported':
      return 'preview_proof_unsupported';
    case 'unavailable':
      return 'preview_proof_unavailable';
  }
};

export const buildColorOutputProofingDiagnostics = ({
  activeDisplayProfile,
  currentGamutWarningOverlay,
  displayProfileError,
  displayProfileLoading,
  displayPreviewLutStatus,
  exportSoftProofRecipeId,
  exportSoftProofTransform,
  previewScopeFreshnessStatus,
  previewScopeWarningCodes = [],
  renderedPreviewWarningStatus,
}: {
  activeDisplayProfile: ActiveDisplayProfile | null;
  currentGamutWarningOverlay: GamutWarningOverlayPayload | null;
  displayProfileError: string | null;
  displayProfileLoading: boolean;
  displayPreviewLutStatus: DisplayPreviewLutStatus | null;
  exportSoftProofRecipeId: string | null;
  exportSoftProofTransform: ExportSoftProofTransformForGamutWarning | null;
  previewScopeFreshnessStatus: PreviewScopeFreshnessStatus;
  previewScopeWarningCodes?: string[];
  renderedPreviewWarningStatus: RenderedPreviewWarningStatus;
}): ColorOutputProofingDiagnosticsSummary => {
  const displayProfile = activeDisplayProfile ?? displayPreviewLutStatus?.profile ?? null;
  const displayHash = shortHash(displayProfile?.iccSha256);
  const displayProfileLabel =
    displayProfileError !== null
      ? 'Display profile unavailable'
      : displayProfileLoading
        ? 'Display profile loading'
        : displayProfile
          ? activeDisplayProfileStatusLabel(displayProfile.status)
          : 'Display profile unavailable';
  const resolvedDisplayProfileState: ColorOutputDiagnosticState =
    displayProfileError !== null
      ? 'error'
      : displayProfileLoading
        ? 'loading'
        : displayProfile
          ? displayProfileState(displayProfile.status)
          : 'unavailable';
  const lutStatusLabel =
    displayProfileError !== null
      ? 'Display LUT unavailable'
      : displayProfileLoading
        ? 'Display LUT loading'
        : displayPreviewLutStatus
          ? displayPreviewLutStatusLabel(displayPreviewLutStatus.status)
          : 'Display LUT unavailable';
  const resolvedLutState: ColorOutputDiagnosticState =
    displayProfileError !== null
      ? 'error'
      : displayProfileLoading
        ? 'loading'
        : displayPreviewLutStatus
          ? displayPreviewLutState(displayPreviewLutStatus.status)
          : 'unavailable';
  const outputProfileLabel =
    exportSoftProofTransform?.effectiveColorProfile ??
    renderedPreviewWarningStatus.exportProfileLabel ??
    renderedPreviewWarningStatus.displayProfileLabel;
  const renderingIntentLabel = exportSoftProofTransform?.effectiveRenderingIntent ?? 'Preview intent unavailable';
  const transformLabel =
    exportSoftProofTransform?.colorManagedTransform ?? renderedPreviewWarningStatus.renderTargetLabel;
  const coverageRatio = currentGamutWarningOverlay?.coverage_ratio ?? 0;
  const warningPixelCount = currentGamutWarningOverlay?.warning_pixel_count ?? 0;
  const codes = new Set<string>([
    proofStateCode(renderedPreviewWarningStatus.state),
    `preview_scope_${previewScopeFreshnessStatus.state}`,
    `display_profile_${resolvedDisplayProfileState}`,
    `display_lut_${resolvedLutState}`,
    warningPixelCount > 0 ? 'gamut_warning_present' : 'gamut_warning_clear',
    exportSoftProofTransform?.transformApplied === true
      ? 'soft_proof_transform_applied'
      : 'soft_proof_transform_pending',
    ...previewScopeWarningCodes,
  ]);

  if (displayProfile?.status) codes.add(`display_profile_${displayProfile.status}`);
  if (displayPreviewLutStatus?.status) codes.add(`display_lut_${displayPreviewLutStatus.status}`);
  if (currentGamutWarningOverlay?.transform_policy_fingerprint) codes.add('gamut_warning_transform_matched');

  return {
    codes: [...codes].sort(),
    displayProfileHash: displayHash,
    displayProfileLabel,
    displayProfileSource: displayProfile?.source ?? null,
    displayProfileState: resolvedDisplayProfileState,
    gamutCoverageLabel: formatGamutWarningCoverage(currentGamutWarningOverlay),
    gamutCoverageRatio: coverageRatio,
    gamutWarningPixelCount: warningPixelCount,
    lutSampleCount: displayPreviewLutStatus?.sampleCount ?? 0,
    lutSize: displayPreviewLutStatus?.size ?? 0,
    lutState: resolvedLutState,
    lutStatusLabel,
    outputProfileLabel,
    previewProofState: renderedPreviewWarningStatus.state,
    previewProofStatusLabel: renderedPreviewWarningStatus.statusLabel,
    previewScopeState: previewScopeFreshnessStatus.state,
    previewScopeStatusLabel: previewScopeFreshnessStatus.statusLabel,
    renderingIntentLabel,
    softProofRecipeId: exportSoftProofRecipeId,
    transformApplied: exportSoftProofTransform?.transformApplied ?? null,
    transformLabel,
    transformPolicyFingerprint: exportSoftProofTransform?.transformPolicyFingerprint ?? null,
    workingSpaceLabel: 'linear-raw-to-working-rgb',
  };
};

const previewStateToTone = (state: PreviewBoundWarningState): EditorChromeStatusChipTone => {
  switch (state) {
    case 'current':
      return 'success';
    case 'error':
      return 'danger';
    case 'stale':
      return 'warning';
    case 'unsupported':
      return 'neutral';
    case 'unavailable':
      return 'info';
  }
};

const softProofStateToTone = (state: RenderedPreviewWarningStatus['state']): EditorChromeStatusChipTone => {
  if (state === 'error') return 'danger';
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
  const hasCurrentGamutWarning =
    renderedPreviewWarningStatus.state === 'current' &&
    gamutWarningOverlay !== null &&
    gamutWarningOverlay.warning_pixel_count > 0;

  return [
    ...getEditorClippingStatusChips(adjustments),
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
      active: previewScopeStatus !== null,
      detail: previewScopeStatus?.renderBasis ?? 'Scopes pending',
      id: 'preview-scopes',
      label: 'Scopes',
      state: previewScopeFreshnessStatus.state,
      tone: previewStateToTone(previewScopeFreshnessStatus.state),
      value: previewScopeFreshnessStatus.statusLabel.replace(/^Scopes\s+/u, ''),
    },
  ];
};

export const getEditorClippingStatusChips = (adjustments: Pick<Adjustments, 'levels'>): EditorClippingStatusChip[] => {
  const levels = adjustments.levels;
  const isShadowClipping = levels.inputBlack > 0;
  const isHighlightClipping = levels.inputWhite < 1;

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
  ];
};
