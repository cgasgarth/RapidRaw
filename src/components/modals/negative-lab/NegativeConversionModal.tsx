import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Maximize,
  RotateCcw,
  Save,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { LayerStackSidecarLayerV1 } from '../../../../packages/rawengine-schema/src';
import {
  isNegativeLabProfileSort,
  NEGATIVE_LAB_PROFILE_BROWSER_ROW_BY_ID,
  NEGATIVE_LAB_PROFILE_BROWSER_ROWS,
  NEGATIVE_LAB_PROFILE_FILTER_TEST_IDS,
  NEGATIVE_LAB_PROFILE_FILTERS,
  NEGATIVE_LAB_PROFILE_SORT_TEST_IDS,
  NEGATIVE_LAB_PROFILE_SORTS,
  type NegativeLabProfileFilter,
  type NegativeLabProfileSort,
  useNegativeLabProfileBrowser,
} from '../../../hooks/editor/useNegativeLabProfileBrowser';
import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { usePreviewViewport } from '../../../hooks/viewport/usePreviewViewport';
import type { NegativeLabAcquisitionProfileId } from '../../../schemas/negative-lab/negativeLabAcquisitionProfileSchemas';
import { negativeLabAcquisitionProfileIdSchema } from '../../../schemas/negative-lab/negativeLabAcquisitionProfileSchemas';
import type {
  NegativeLabAcquisitionHealthReport,
  NegativeLabFrameCropStatus,
} from '../../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import type { NegativeLabFrameRgbBalanceOffset } from '../../../schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas';
import {
  type NegativeLabHighlightPatchExposureSuggestion,
  negativeLabHighlightPatchExposureSuggestionSchema,
} from '../../../schemas/negative-lab/negativeLabHighlightPatchExposureSuggestionSchemas';
import type { NegativeLabRuntimeProfileBrowserRow } from '../../../schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import {
  type NegativeLabNeutralPatchSuggestion,
  negativeLabNeutralPatchSuggestionSchema,
} from '../../../schemas/negative-lab/negativeLabNeutralPatchSuggestionSchemas';
import {
  type NegativeBaseFogDensitometerReadout,
  type NegativeBaseFogEstimate,
  type NegativeLabBaseFogSampleRect,
  type NegativeLabPresetParams,
  negativeBaseFogEstimateSchema,
  negativeBaseFogSampleReadoutSchema,
  negativeConversionSavedPositiveHandoffsSchema,
} from '../../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabSelectedProfileSnapshot } from '../../../schemas/negative-lab/negativeLabProfileComparisonSchemas';
import {
  type NegativeLabShadowPatchBlackPointSuggestion,
  negativeLabShadowPatchBlackPointSuggestionSchema,
} from '../../../schemas/negative-lab/negativeLabShadowPatchBlackPointSuggestionSchemas';
import type { NegativeLabWorkspaceProof } from '../../../schemas/negative-lab/negativeLabWorkspaceSchemas';
import { parsePathProgressPayload } from '../../../schemas/tauriEventSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import { Invokes } from '../../../tauri/commands';
import { TextColors, TextVariants } from '../../../types/typography';
import { buildDustCandidateHealLayer, buildDustHealCorrectionMetrics } from '../../../utils/dustCandidateHealLayer';
import { buildLayerStackSidecarFromMasks } from '../../../utils/layers/layerStackCommandBridge';
import { NegativeLabAppServerCommandName } from '../../../utils/negative-lab/app-server/negativeLabAppServerCommandNames';
import {
  DEFAULT_NEGATIVE_LAB_ACQUISITION_PROFILE_ID,
  getNegativeLabAcquisitionProfile,
  NEGATIVE_LAB_ACQUISITION_PROFILES,
} from '../../../utils/negative-lab/negativeLabAcquisitionProfiles';
import {
  buildNegativeLabBaseSampleDecisionProof,
  buildNegativeLabBaseSamplePreviewProof,
  type NegativeLabBaseSamplePreviewProof,
  type NegativeLabBaseSamplePreviewProofContext,
  type NegativeLabBaseSampleWarningCode,
} from '../../../utils/negative-lab/negativeLabBaseSampleCommandBridge';
import {
  buildNegativeLabBatchApplyReceipt,
  type NegativeLabBatchApplyReceipt,
} from '../../../utils/negative-lab/negativeLabBatchApplyReceipt';
import { buildNegativeBaseFogDensitometerReadout } from '../../../utils/negative-lab/negativeLabDensitometer';
import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../../utils/negative-lab/negativeLabDustScratchReview';
import type { NegativeConversionEditorHandoff } from '../../../utils/negative-lab/negativeLabEditorHandoff';
import {
  buildNegativeLabCanSave,
  buildNegativeLabPositiveHandoffReadiness,
  buildNegativeLabSaveBlockedReason,
  buildNegativeLabWorkspaceProof,
  selectNegativeLabActivePositiveVariant,
} from '../../../utils/negative-lab/negativeLabExportHandoff';
import {
  buildNegativeLabFrameExposureOverridePayload,
  getNegativeLabEffectiveFrameExposure,
  snapNegativeLabFrameExposureOffset,
} from '../../../utils/negative-lab/negativeLabFrameExposureOverrides';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
  getNegativeLabScanLabel,
} from '../../../utils/negative-lab/negativeLabFrameHealth';
import {
  buildNegativeLabFrameRgbBalanceOverridePayload,
  DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET,
  getNegativeLabEffectiveFrameRgbBalance,
  negativeLabFrameRgbBalanceOffsetIsZero,
  snapNegativeLabFrameRgbBalanceOffsets,
} from '../../../utils/negative-lab/negativeLabFrameRgbBalanceOverrides';
import {
  NEGATIVE_LAB_OUTPUT_FORMAT_SELECTOR_IDS,
  NegativeLabOutputFormatId,
  type NegativeLabOutputFormatId as NegativeOutputFormat,
} from '../../../utils/negative-lab/negativeLabOutputFormatIds';
import {
  buildNegativeLabPickedPatchRect,
  type NegativeLabPatchPickerPoint,
} from '../../../utils/negative-lab/negativeLabPatchPicker';
import {
  appendNegativeLabPatchSamplerCorrection,
  buildNegativeLabBaseFogPatchSamplerCorrection,
  buildNegativeLabHighlightPatchSamplerCorrection,
  buildNegativeLabNeutralPatchSamplerCorrection,
  buildNegativeLabShadowPatchSamplerCorrection,
  EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD,
  type NegativeLabPatchSamplerCorrectionPayload,
  removeNegativeLabPatchSamplerCorrections,
} from '../../../utils/negative-lab/negativeLabPatchSamplerCorrections';
import {
  buildNegativeLabAcceptedPlanIdentity,
  buildNegativeLabPlanHash,
} from '../../../utils/negative-lab/negativeLabPlanIdentity';
import {
  DEFAULT_NEGATIVE_LAB_UI_PRESET,
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
} from '../../../utils/negative-lab/negativeLabPresetCatalog';
import {
  buildNegativeLabBrowserProfileProvenanceHash,
  buildNegativeLabProfileBoundPlanIdentity,
  buildNegativeLabProfileComparisonRows,
  buildNegativeLabSelectedProfileSnapshot,
} from '../../../utils/negative-lab/negativeLabProfileComparison';
import {
  buildNegativeLabQcContactSheetArtifact,
  type NegativeLabQcOverlayVisibility,
} from '../../../utils/negative-lab/negativeLabQcContactSheetArtifact';
import {
  applyNegativeLabRollNormalizationPlan,
  type NegativeLabRollNormalizationApplyReceipt,
  type NegativeLabRollNormalizationRestoreReceipt,
  restoreNegativeLabRollNormalizationOverrides,
} from '../../../utils/negative-lab/negativeLabRollNormalizationApply';
import { buildNegativeLabRollNormalizationPlan } from '../../../utils/negative-lab/negativeLabRollNormalizationPlan';
import {
  buildNegativeLabStockMetadataCounts,
  NEGATIVE_LAB_STOCK_METADATA_CATALOG,
} from '../../../utils/negative-lab/negativeLabStockMetadataCatalog';
import {
  buildNegativeLabStockRegistryCounts,
  NEGATIVE_LAB_STOCK_REGISTRY,
} from '../../../utils/negative-lab/negativeLabStockRegistry';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import { throttle } from '../../../utils/timing';
import Button from '../../ui/primitives/Button';
import Slider from '../../ui/primitives/Slider';
import UiText from '../../ui/primitives/Text';
import {
  type DensitometerPatchLabelKey,
  type NegativeLabPatchRole,
  NegativeLabPatchSamplerPanel,
} from './NegativeLabPatchSamplerPanel';
import {
  NegativeLabProfileComparisonGrid,
  type NegativeLabRenderedProfileCandidatePreview,
} from './NegativeLabProfileComparisonGrid';
import { NegativeLabQcProofPanel } from './NegativeLabQcProofPanel';
import {
  ACQUISITION_SOURCE_FAMILY_LABEL_KEYS,
  ACQUISITION_WARNING_LABEL_KEYS,
  BATCH_DISPOSITION_LABEL_KEYS,
  FRAME_WARNING_SEVERITY_SCORE,
  getNegativeLabFrameWarningCount,
  type NegativeLabFrameHealthFilter,
  type NegativeLabFrameHealthSort,
  type NegativeLabQcDecision,
} from './NegativeLabRollHealthModel';
import { NegativeLabRollHealthPanel } from './NegativeLabRollHealthPanel';

type NegativeParams = NegativeLabPresetParams;
type NegativeConversionScope = 'active' | 'all' | 'ready';
type NegativeLabBaseSampleStudioDecision = 'accepted' | 'candidate' | 'rejected';
type NegativeLabAgentCommitState = 'committing' | 'not_committed' | 'ready_to_commit';
type NegativeLabAgentDryRunState = 'accepted' | 'blocked' | 'ready';
const NEGATIVE_LAB_AGENT_DRY_RUN_LABELS = {
  accepted: 'modals.negativeConversion.agentDryRunAccepted',
  blocked: 'modals.negativeConversion.agentDryRunBlocked',
  ready: 'modals.negativeConversion.agentDryRunReady',
} satisfies Record<NegativeLabAgentDryRunState, `modals.negativeConversion.${string}`>;
const NEGATIVE_LAB_AGENT_COMMIT_LABELS = {
  committing: 'modals.negativeConversion.agentCommitCommitting',
  not_committed: 'modals.negativeConversion.agentCommitNotCommitted',
  ready_to_commit: 'modals.negativeConversion.agentCommitReady',
} satisfies Record<NegativeLabAgentCommitState, `modals.negativeConversion.${string}`>;
const NEGATIVE_LAB_AGENT_READ_ONLY_SEQUENCE = [
  'inspect',
  'conversion_plan',
  'roll_normalization_plan',
  'qc_proof',
  'stock_family_plan',
] as const;
const NEGATIVE_LAB_RUNTIME_PREVIEW_TOOL_NAME = 'negativelab.preview_conversion';
type BaseFogSampleLabelKey = 'modals.negativeConversion.sampleCenterPatch' | 'modals.negativeConversion.sampleLeftEdge';
type ConversionScopeLabelKey =
  | 'modals.negativeConversion.scopeActive'
  | 'modals.negativeConversion.scopeAll'
  | 'modals.negativeConversion.scopeReady';
type BaseSampleWarningLabelKey =
  | 'modals.negativeConversion.baseSampleWarningClipped'
  | 'modals.negativeConversion.baseSampleWarningLowConfidence'
  | 'modals.negativeConversion.baseSampleWarningMissingBase'
  | 'modals.negativeConversion.baseSampleWarningUneven';
type BaseSampleDecisionLabelKey =
  | 'modals.negativeConversion.baseSampleDecision.accepted'
  | 'modals.negativeConversion.baseSampleDecision.candidate'
  | 'modals.negativeConversion.baseSampleDecision.rejected';

const DEFAULT_PARAMS: NegativeParams = DEFAULT_NEGATIVE_LAB_UI_PRESET.params;
const NEGATIVE_LAB_PROFILE_CANDIDATE_RENDER_LIMIT = 3;
const DEFAULT_NEGATIVE_LAB_PRINT_CURVE_V2_PARAMS = {
  contrast_grade: 1,
  density_offset: 0,
  midtone_shape: 0,
  schema_version: 1,
  shoulder_strength: 0.25,
  target_black_density: 1.65,
  target_white_density: 0.04,
  toe_strength: 0.25,
} satisfies NonNullable<NegativeParams['print_curve_v2']>;
const DEFAULT_SAVE_OPTIONS = {
  outputFormat: NegativeLabOutputFormatId.Tiff16 as NegativeOutputFormat,
  suffix: 'Positive',
  writeConversionBundle: true,
};
const buildNegativeLabRenderedCandidateHash = (payload: unknown): `fnv1a32:${string}` =>
  `fnv1a32:${buildNegativeLabPlanHash(JSON.stringify(payload))}`;
const getNegativeLabProfileBaseSampleId = (params: NegativeParams): string =>
  params.base_fog_sample === null ? 'active-frame:pending-base-fog-sample' : 'profile:embedded-base-fog-sample';
const getNegativeLabRenderedCandidateError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const NEGATIVE_LAB_QC_OVERLAY_STORAGE_KEY = 'rawengine.negativeLab.qcOverlayVisibility.v1';
const DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY = {
  densityWarnings: true,
  frameBounds: true,
  rejectedMarkers: true,
} satisfies NegativeLabQcOverlayVisibility;
const negativeLabQcOverlayVisibilitySchema = z
  .object({
    densityWarnings: z.boolean().optional(),
    frameBounds: z.boolean().optional(),
    rejectedMarkers: z.boolean().optional(),
  })
  .strict();
const CUSTOM_BASE_SAMPLE_DEFAULT = {
  height: 0.18,
  width: 0.18,
  x: 0.25,
  y: 0.25,
} satisfies NegativeLabBaseFogSampleRect;
const getInitialIncludedPaths = (paths: string[]) => new Set(paths);
const readNegativeLabQcOverlayVisibility = (): NegativeLabQcOverlayVisibility => {
  if (typeof window === 'undefined') return DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY;

  try {
    const stored = window.localStorage.getItem(NEGATIVE_LAB_QC_OVERLAY_STORAGE_KEY);
    if (stored === null) return DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY;
    const parsed = negativeLabQcOverlayVisibilitySchema.parse(JSON.parse(stored));
    return {
      densityWarnings:
        typeof parsed.densityWarnings === 'boolean'
          ? parsed.densityWarnings
          : DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY.densityWarnings,
      frameBounds:
        typeof parsed.frameBounds === 'boolean'
          ? parsed.frameBounds
          : DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY.frameBounds,
      rejectedMarkers:
        typeof parsed.rejectedMarkers === 'boolean'
          ? parsed.rejectedMarkers
          : DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY.rejectedMarkers,
    };
  } catch {
    return DEFAULT_NEGATIVE_LAB_QC_OVERLAY_VISIBILITY;
  }
};
const clampSampleValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const normalizeSampleRect = (rect: NegativeLabBaseFogSampleRect): NegativeLabBaseFogSampleRect => {
  const width = clampSampleValue(rect.width, 0.02, 1);
  const height = clampSampleValue(rect.height, 0.02, 1);

  return {
    height,
    width,
    x: clampSampleValue(rect.x, 0, 1 - width),
    y: clampSampleValue(rect.y, 0, 1 - height),
  };
};
const formatPercentValue = (value: number) => `${Math.round(value)}%`;
const formatDensityValue = (value: number) => value.toFixed(3);
const formatRgbValue = (value: number) => `${Math.round(value * 255)}`;
const formatSignedRecipeValue = (value: number) => (value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2));
const NEGATIVE_LAB_STOCK_REGISTRY_COUNTS = buildNegativeLabStockRegistryCounts(NEGATIVE_LAB_STOCK_REGISTRY);
const NEGATIVE_LAB_STOCK_METADATA_COUNTS = buildNegativeLabStockMetadataCounts(NEGATIVE_LAB_STOCK_METADATA_CATALOG);
const formatStockRegistryToken = (value: string) => value.split('_').join(' ');
const NEGATIVE_LAB_STOCK_PROFILE_STATUS_LABEL_KEYS = {
  heuristic: 'modals.negativeConversion.stockProfileStatusHeuristic',
  measured: 'modals.negativeConversion.stockProfileStatusMeasured',
  needs_fixture: 'modals.negativeConversion.stockProfileStatusNeedsFixture',
  placeholder: 'modals.negativeConversion.stockProfileStatusPlaceholder',
} as const;
const formatStockMetadataIso = (
  nominalIso: (typeof NEGATIVE_LAB_STOCK_METADATA_CATALOG.entries)[number]['nominalIso'],
) => (nominalIso === null ? 'ISO -' : `${nominalIso.unit} ${nominalIso.value}`);
const DENSITOMETER_CHANNEL_LABEL_KEYS: Record<
  NegativeBaseFogDensitometerReadout['dominantChannel'],
  | 'modals.negativeConversion.densitometerChannelRed'
  | 'modals.negativeConversion.densitometerChannelGreen'
  | 'modals.negativeConversion.densitometerChannelBlue'
> = {
  blue: 'modals.negativeConversion.densitometerChannelBlue',
  green: 'modals.negativeConversion.densitometerChannelGreen',
  red: 'modals.negativeConversion.densitometerChannelRed',
};
const DENSITOMETER_STATUS_LABEL_KEYS: Record<
  NegativeBaseFogDensitometerReadout['status'],
  | 'modals.negativeConversion.densitometerStatusBalanced'
  | 'modals.negativeConversion.densitometerStatusMinorCast'
  | 'modals.negativeConversion.densitometerStatusStrongCast'
> = {
  balanced: 'modals.negativeConversion.densitometerStatusBalanced',
  minor_cast: 'modals.negativeConversion.densitometerStatusMinorCast',
  strong_cast: 'modals.negativeConversion.densitometerStatusStrongCast',
};
const DUST_SCRATCH_SEVERITY_LABEL_KEYS = {
  clear: 'modals.negativeConversion.dustSeverity.clear',
  retouch: 'modals.negativeConversion.dustSeverity.retouch',
  review: 'modals.negativeConversion.dustSeverity.review',
} as const;
const DUST_SCRATCH_CANDIDATE_KIND_LABEL_KEYS = {
  dust_spot: 'modals.negativeConversion.dustCandidate.dustSpot',
  emulsion_scratch: 'modals.negativeConversion.dustCandidate.emulsionScratch',
} as const;
const DUST_SCRATCH_CANDIDATE_STATUS_LABEL_KEYS = {
  acknowledged: 'modals.negativeConversion.dustCandidateStatus.acknowledged',
  ignored: 'modals.negativeConversion.dustCandidateStatus.ignored',
  pending: 'modals.negativeConversion.dustCandidateStatus.pending',
} as const;
type NegativeLabDustCandidateDecision = 'accepted' | 'rejected';
type NegativeLabDustCandidateFilter = 'accepted' | 'all' | 'pending' | 'rejected';
type NegativeLabDustScratchFrame = ReturnType<typeof buildNegativeLabDustScratchReviewReport>['frames'][number];
type NegativeLabDustScratchCandidate = NegativeLabDustScratchFrame['candidates'][number];
const NEGATIVE_LAB_DUST_CANDIDATE_FILTERS = [
  'all',
  'pending',
  'accepted',
  'rejected',
] satisfies Array<NegativeLabDustCandidateFilter>;
const DUST_CANDIDATE_FILTER_LABEL_KEYS = {
  accepted: 'modals.negativeConversion.dustCandidateFilter.accepted',
  all: 'modals.negativeConversion.dustCandidateFilter.all',
  pending: 'modals.negativeConversion.dustCandidateFilter.pending',
  rejected: 'modals.negativeConversion.dustCandidateFilter.rejected',
} as const satisfies Record<NegativeLabDustCandidateFilter, `modals.negativeConversion.${string}`>;
const getDustCandidateFilterState = (
  candidateId: string,
  dustCandidateDecisionById: Record<string, NegativeLabDustCandidateDecision>,
): Exclude<NegativeLabDustCandidateFilter, 'all'> => dustCandidateDecisionById[candidateId] ?? 'pending';
const CONVERSION_SCOPE_LABEL_KEYS = {
  active: 'modals.negativeConversion.scopeActive',
  all: 'modals.negativeConversion.scopeAll',
  ready: 'modals.negativeConversion.scopeReady',
} satisfies Record<NegativeConversionScope, ConversionScopeLabelKey>;
const CONVERSION_SCOPE_TEST_IDS = {
  active: 'negative-lab-scope-active',
  all: 'negative-lab-scope-all',
  ready: 'negative-lab-scope-ready',
} satisfies Record<NegativeConversionScope, string>;
const BASE_SAMPLE_WARNING_LABEL_KEYS = {
  clipped_base_channel: 'modals.negativeConversion.baseSampleWarningClipped',
  low_acquisition_confidence: 'modals.negativeConversion.baseSampleWarningLowConfidence',
  missing_visible_base: 'modals.negativeConversion.baseSampleWarningMissingBase',
  uneven_illumination: 'modals.negativeConversion.baseSampleWarningUneven',
} satisfies Record<NegativeLabBaseSampleWarningCode, BaseSampleWarningLabelKey>;
const BASE_SAMPLE_DECISION_LABEL_KEYS = {
  accepted: 'modals.negativeConversion.baseSampleDecision.accepted',
  candidate: 'modals.negativeConversion.baseSampleDecision.candidate',
  rejected: 'modals.negativeConversion.baseSampleDecision.rejected',
} satisfies Record<NegativeLabBaseSampleStudioDecision, BaseSampleDecisionLabelKey>;
const BASE_FOG_LEFT_EDGE_SAMPLE_RECT = {
  height: 0.6,
  width: 0.12,
  x: 0.02,
  y: 0.2,
} satisfies NegativeLabBaseFogSampleRect;
const BASE_FOG_SAMPLE_PRESETS = [
  {
    labelKey: 'modals.negativeConversion.sampleLeftEdge',
    rect: BASE_FOG_LEFT_EDGE_SAMPLE_RECT,
  },
  {
    labelKey: 'modals.negativeConversion.sampleCenterPatch',
    rect: { height: 0.22, width: 0.22, x: 0.39, y: 0.39 },
  },
] satisfies Array<{ labelKey: BaseFogSampleLabelKey; rect: NegativeLabBaseFogSampleRect }>;
type NegativeLabWorkflowStageId = 'setup' | 'preset' | 'colorTiming' | 'inspection' | 'printGrade' | 'export';

interface NegativeLabWorkflowStage {
  detail: string;
  id: NegativeLabWorkflowStageId;
  isComplete: boolean;
  label: string;
}

interface NegativeConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetPaths: string[];
  onSave: (savedPaths: string[], handoff: NegativeConversionEditorHandoff) => void;
}

interface BaseFogSampleUndoEntry {
  activeBaseFogSampleLabel: string | null;
  baseFogConfidence: number | null;
  baseFogEstimate: NegativeBaseFogEstimate | null;
  baseFogPreviewProof: NegativeLabBaseSamplePreviewProof | null;
  baseFogScope: 'frame' | 'roll';
  baseSampleStudioDecision: NegativeLabBaseSampleStudioDecision;
  params: NegativeParams;
  patchSamplerCorrectionPayload: NegativeLabPatchSamplerCorrectionPayload;
  selectedPresetId: string;
}

export function NegativeConversionModal({ isOpen, onClose, targetPaths, onSave }: NegativeConversionModalProps) {
  const { t } = useTranslation();
  const selectedEditorImage = useEditorStore((state) => state.selectedImage);
  const [params, setParams] = useState<NegativeParams>(DEFAULT_PARAMS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEstimatingBaseFog, setIsEstimatingBaseFog] = useState(false);
  const [baseFogConfidence, setBaseFogConfidence] = useState<number | null>(null);
  const [baseFogEstimate, setBaseFogEstimate] = useState<NegativeBaseFogEstimate | null>(null);
  const [baseFogPreviewProof, setBaseFogPreviewProof] = useState<NegativeLabBaseSamplePreviewProof | null>(null);
  const [baseFogReadoutCopied, setBaseFogReadoutCopied] = useState(false);
  const [baseSampleStudioDecision, setBaseSampleStudioDecision] =
    useState<NegativeLabBaseSampleStudioDecision>('candidate');
  const [rejectedBaseSampleLabel, setRejectedBaseSampleLabel] = useState<string | null>(null);
  const [patchProbeEstimate, setPatchProbeEstimate] = useState<NegativeBaseFogEstimate | null>(null);
  const [patchProbeRect, setPatchProbeRect] = useState<NegativeLabBaseFogSampleRect | null>(null);
  const [patchProbeLabel, setPatchProbeLabel] = useState<string | null>(null);
  const [patchRole, setPatchRole] = useState<NegativeLabPatchRole>('neutral');
  const [isPickingPatch, setIsPickingPatch] = useState(false);
  const [patchDragStart, setPatchDragStart] = useState<NegativeLabPatchPickerPoint | null>(null);
  const [draftPatchRect, setDraftPatchRect] = useState<NegativeLabBaseFogSampleRect | null>(null);
  const [isSamplingPatchProbe, setIsSamplingPatchProbe] = useState(false);
  const [neutralPatchSuggestion, setNeutralPatchSuggestion] = useState<NegativeLabNeutralPatchSuggestion | null>(null);
  const [isSuggestingNeutralPatchRgb, setIsSuggestingNeutralPatchRgb] = useState(false);
  const [highlightPatchExposureSuggestion, setHighlightPatchExposureSuggestion] =
    useState<NegativeLabHighlightPatchExposureSuggestion | null>(null);
  const [isSuggestingHighlightPatchExposure, setIsSuggestingHighlightPatchExposure] = useState(false);
  const [shadowPatchBlackPointSuggestion, setShadowPatchBlackPointSuggestion] =
    useState<NegativeLabShadowPatchBlackPointSuggestion | null>(null);
  const [isSuggestingShadowPatchBlackPoint, setIsSuggestingShadowPatchBlackPoint] = useState(false);
  const [customBaseSampleRect, setCustomBaseSampleRect] =
    useState<NegativeLabBaseFogSampleRect>(CUSTOM_BASE_SAMPLE_DEFAULT);
  const [customBaseSampleEstimate, setCustomBaseSampleEstimate] = useState<NegativeBaseFogEstimate | null>(null);
  const [isMeasuringCustomBaseSample, setIsMeasuringCustomBaseSample] = useState(false);
  const [copiedBatchPlanJson, setCopiedBatchPlanJson] = useState<string | null>(null);
  const [acceptedBatchPlanJson, setAcceptedBatchPlanJson] = useState<string | null>(null);
  const [batchApplyReceipt, setBatchApplyReceipt] = useState<NegativeLabBatchApplyReceipt | null>(null);
  const [rollNormalizationApplyReceipt, setRollNormalizationApplyReceipt] =
    useState<NegativeLabRollNormalizationApplyReceipt | null>(null);
  const [rollNormalizationRestoreReceipt, setRollNormalizationRestoreReceipt] =
    useState<NegativeLabRollNormalizationRestoreReceipt | null>(null);
  const [rollNormalizationRestoreRevision, setRollNormalizationRestoreRevision] = useState(0);
  const [activeBaseFogSampleLabel, setActiveBaseFogSampleLabel] = useState<string | null>(null);
  const [baseFogScope, setBaseFogScope] = useState<'frame' | 'roll'>('frame');
  const [baseFogSampleUndoStack, setBaseFogSampleUndoStack] = useState<BaseFogSampleUndoEntry[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [saveOptions, setSaveOptions] = useState(DEFAULT_SAVE_OPTIONS);
  const [openSavedPositiveInEditor, setOpenSavedPositiveInEditor] = useState(true);
  const [conversionScope, setConversionScope] = useState<NegativeConversionScope>('all');
  const [selectedAcquisitionProfileId, setSelectedAcquisitionProfileId] = useState<NegativeLabAcquisitionProfileId>(
    DEFAULT_NEGATIVE_LAB_ACQUISITION_PROFILE_ID,
  );
  const [includedPathSet, setIncludedPathSet] = useState<Set<string>>(() => getInitialIncludedPaths(targetPaths));
  const [activePathIndex, setActivePathIndex] = useState(0);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [profileFilter, setProfileFilter] = useState<NegativeLabProfileFilter>('all');
  const [profileSort, setProfileSort] = useState<NegativeLabProfileSort>('catalog');
  const [browsedComparisonProfileId, setBrowsedComparisonProfileId] = useState<string | null>(null);
  const [renderedProfileCandidatePreviewById, setRenderedProfileCandidatePreviewById] = useState<
    Record<string, NegativeLabRenderedProfileCandidatePreview>
  >({});
  const [frameHealthFilter, setFrameHealthFilter] = useState<NegativeLabFrameHealthFilter>('all');
  const [frameHealthSort, setFrameHealthSort] = useState<NegativeLabFrameHealthSort>('roll_order');
  const [qcOverlayVisibility, setQcOverlayVisibility] = useState<NegativeLabQcOverlayVisibility>(
    readNegativeLabQcOverlayVisibility,
  );
  const [qcDecisionByFrameId, setQcDecisionByFrameId] = useState<Record<string, NegativeLabQcDecision>>({});
  const [dustCandidateDecisionById, setDustCandidateDecisionById] = useState<
    Record<string, NegativeLabDustCandidateDecision>
  >({});
  const [dustCandidateFilter, setDustCandidateFilter] = useState<NegativeLabDustCandidateFilter>('all');
  const [dustHealLayerByCandidateId, setDustHealLayerByCandidateId] = useState<
    Record<string, ReturnType<typeof buildDustCandidateHealLayer>>
  >({});
  const [cropStatusByFrameId, setCropStatusByFrameId] = useState<Record<string, NegativeLabFrameCropStatus>>({});
  const [frameExposureOffsetByFrameId, setFrameExposureOffsetByFrameId] = useState<Record<string, number>>({});
  const [frameRgbBalanceOffsetByFrameId, setFrameRgbBalanceOffsetByFrameId] = useState<
    Record<string, NegativeLabFrameRgbBalanceOffset>
  >({});
  const [patchSamplerCorrectionPayload, setPatchSamplerCorrectionPayload] =
    useState<NegativeLabPatchSamplerCorrectionPayload>(EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD);

  const { isMounted, show } = useModalTransition(isOpen);
  const [isCompareActive, setIsCompareActive] = useState(false);
  const {
    containerRef,
    handleMouseDown,
    handleResetZoom,
    handleWheel,
    imageTransformStyle,
    resetViewport,
    zoom,
    zoomIn,
    zoomOut,
  } = usePreviewViewport({ maxZoom: 8, minZoom: 0.1, zoomStep: 0.25 });
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewImageUrl = isCompareActive && originalUrl !== null ? originalUrl : previewUrl;
  const effectiveActivePathIndex = targetPaths[activePathIndex] === undefined ? 0 : activePathIndex;
  const selectedImagePath = targetPaths[effectiveActivePathIndex] ?? null;
  const hasMultipleScans = targetPaths.length > 1;
  const baseFogSampleReadout = useMemo(() => {
    if (params.base_fog_sample === null || activeBaseFogSampleLabel === null) return null;

    const sampleRect = params.base_fog_sample;
    return negativeBaseFogSampleReadoutSchema.parse({
      areaPercent: sampleRect.width * sampleRect.height * 100,
      confidencePercent: baseFogConfidence === null ? null : Math.round(baseFogConfidence * 100),
      heightPercent: sampleRect.height * 100,
      label: activeBaseFogSampleLabel,
      widthPercent: sampleRect.width * 100,
      xPercent: sampleRect.x * 100,
      yPercent: sampleRect.y * 100,
    });
  }, [activeBaseFogSampleLabel, baseFogConfidence, params.base_fog_sample]);
  const densitometerReadout = useMemo(
    () => (baseFogEstimate === null ? null : buildNegativeBaseFogDensitometerReadout(baseFogEstimate)),
    [baseFogEstimate],
  );
  const patchProbeDensitometerReadout = useMemo(
    () => (patchProbeEstimate === null ? null : buildNegativeBaseFogDensitometerReadout(patchProbeEstimate)),
    [patchProbeEstimate],
  );
  const patchProbeSampleReadout = useMemo(() => {
    if (patchProbeRect === null || patchProbeLabel === null) return null;

    return negativeBaseFogSampleReadoutSchema.parse({
      areaPercent: patchProbeRect.width * patchProbeRect.height * 100,
      confidencePercent: patchProbeEstimate === null ? null : Math.round(patchProbeEstimate.confidence * 100),
      heightPercent: patchProbeRect.height * 100,
      label: patchProbeLabel,
      widthPercent: patchProbeRect.width * 100,
      xPercent: patchProbeRect.x * 100,
      yPercent: patchProbeRect.y * 100,
    });
  }, [patchProbeEstimate, patchProbeLabel, patchProbeRect]);
  const customBaseSampleReadout = useMemo(
    () =>
      negativeBaseFogSampleReadoutSchema.parse({
        areaPercent: customBaseSampleRect.width * customBaseSampleRect.height * 100,
        confidencePercent:
          customBaseSampleEstimate === null ? null : Math.round(customBaseSampleEstimate.confidence * 100),
        heightPercent: customBaseSampleRect.height * 100,
        label: t('modals.negativeConversion.customBaseSample'),
        widthPercent: customBaseSampleRect.width * 100,
        xPercent: customBaseSampleRect.x * 100,
        yPercent: customBaseSampleRect.y * 100,
      }),
    [customBaseSampleEstimate, customBaseSampleRect, t],
  );
  const baseSampleStudioComparison = useMemo(() => {
    if (baseFogEstimate === null || customBaseSampleEstimate === null) return null;
    const densityDelta = Math.max(
      ...baseFogEstimate.baseDensity.map((density, index) =>
        Math.abs(density - (customBaseSampleEstimate.baseDensity[index] ?? density)),
      ),
    );
    const confidenceDelta = customBaseSampleEstimate.confidence - baseFogEstimate.confidence;

    return {
      confidenceDelta,
      densityDelta,
      rgbDelta: Math.max(
        ...baseFogEstimate.baseRgb.map((channel, index) =>
          Math.abs(channel - (customBaseSampleEstimate.baseRgb[index] ?? channel)),
        ),
      ),
    };
  }, [baseFogEstimate, customBaseSampleEstimate]);
  const activeBaseSampleWarningCodes = baseFogPreviewProof?.warningCodes ?? [];

  const selectedPreset = useMemo(
    () =>
      NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.find((preset) => preset.presetId === selectedPresetId) ?? null,
    [selectedPresetId],
  );
  const { profileFilterCounts, selectedProfile, selectedProfileStockReferences, visibleProfileRows } =
    useNegativeLabProfileBrowser({
      profileFilter,
      profileSearchQuery,
      profileSort,
      selectedPresetId,
    });
  const selectedAcquisitionProfile = useMemo(
    () => getNegativeLabAcquisitionProfile(selectedAcquisitionProfileId),
    [selectedAcquisitionProfileId],
  );
  const profileProvenanceHashById = useMemo(
    () =>
      new Map(
        NEGATIVE_LAB_PROFILE_BROWSER_ROWS.map((profile) => [
          profile.presetId,
          buildNegativeLabBrowserProfileProvenanceHash(profile),
        ]),
      ),
    [],
  );
  const selectedProfileProvenanceHash = useMemo(() => {
    if (selectedProfile === null) return null;

    return profileProvenanceHashById.get(selectedProfile.presetId) ?? null;
  }, [profileProvenanceHashById, selectedProfile]);
  const selectedProfileSnapshot = useMemo<NegativeLabSelectedProfileSnapshot | null>(() => {
    if (selectedProfile === null || selectedProfileProvenanceHash === null) return null;
    return buildNegativeLabSelectedProfileSnapshot(selectedProfile, selectedProfileProvenanceHash);
  }, [selectedProfile, selectedProfileProvenanceHash]);
  const selectedPresetFilmClass =
    selectedProfile?.filmClass === 'black_and_white_silver' ? 'Black and white silver' : 'Color negative';
  const selectedPresetClaimLabel =
    selectedProfile?.claimLevel === 'measured_profile'
      ? t('modals.negativeConversion.presetClaimMeasured')
      : t('modals.negativeConversion.presetClaimGeneric');
  const selectedPresetRuntimeLabel =
    selectedProfile?.runtimeStatus === 'runtime_parameter_applied'
      ? t('modals.negativeConversion.presetRuntimeApplied')
      : t('modals.negativeConversion.presetRuntimeCatalogOnly');
  const frameHealthReport = useMemo(
    () =>
      buildNegativeLabFrameHealthReport({
        activePathIndex: effectiveActivePathIndex,
        baseFogConfidence,
        baseScope: baseFogScope,
        cropStatusByFrameId,
        includedPathSet,
        previewReady: previewUrl !== null,
        targetPaths,
      }),
    [
      baseFogConfidence,
      baseFogScope,
      cropStatusByFrameId,
      effectiveActivePathIndex,
      includedPathSet,
      previewUrl,
      targetPaths,
    ],
  );
  const visibleFrameHealthRows = useMemo(() => {
    const filteredRows =
      frameHealthFilter === 'all'
        ? frameHealthReport.frames
        : frameHealthReport.frames.filter((frame) => frame.warningSeverity === frameHealthFilter);

    if (frameHealthSort === 'warning_severity') {
      return [...filteredRows].toSorted(
        (left, right) =>
          FRAME_WARNING_SEVERITY_SCORE[right.warningSeverity] - FRAME_WARNING_SEVERITY_SCORE[left.warningSeverity] ||
          left.pathIndex - right.pathIndex,
      );
    }

    return filteredRows;
  }, [frameHealthFilter, frameHealthReport.frames, frameHealthSort]);
  const batchDryRunSummary = useMemo(() => buildNegativeLabBatchDryRunSummary(frameHealthReport), [frameHealthReport]);
  const rollNormalizationPlan = useMemo(
    () =>
      buildNegativeLabRollNormalizationPlan({
        anchorFrameIds: [
          frameHealthReport.activeFrameId ?? frameHealthReport.frames[0]?.frameId ?? 'negative-lab-frame-1',
        ],
        baselineExposure: params.exposure,
        frameHealthReport,
        mode: 'density_and_balance',
        preserveCreativeAdjustments: true,
        selectedFrameIds: batchDryRunSummary.affectedFrameIds,
      }),
    [batchDryRunSummary.affectedFrameIds, frameHealthReport, params.exposure],
  );
  const frameExposureOverridePayload = useMemo(
    () =>
      buildNegativeLabFrameExposureOverridePayload({
        baselineExposure: params.exposure,
        frameHealthRows: frameHealthReport.frames,
        offsetsByFrameId: frameExposureOffsetByFrameId,
      }),
    [frameExposureOffsetByFrameId, frameHealthReport.frames, params.exposure],
  );
  const frameRgbBalanceOverridePayload = useMemo(
    () =>
      buildNegativeLabFrameRgbBalanceOverridePayload({
        baselineParams: params,
        frameHealthRows: frameHealthReport.frames,
        offsetsByFrameId: frameRgbBalanceOffsetByFrameId,
      }),
    [frameHealthReport.frames, frameRgbBalanceOffsetByFrameId, params],
  );
  const activeFrameExposureOffset = useMemo(
    () =>
      frameHealthReport.activeFrameId === null
        ? 0
        : snapNegativeLabFrameExposureOffset(frameExposureOffsetByFrameId[frameHealthReport.activeFrameId] ?? 0),
    [frameExposureOffsetByFrameId, frameHealthReport.activeFrameId],
  );
  const effectiveActiveExposure = useMemo(
    () =>
      getNegativeLabEffectiveFrameExposure({
        baselineExposure: params.exposure,
        frameId: frameHealthReport.activeFrameId,
        offsetsByFrameId: frameExposureOffsetByFrameId,
      }),
    [frameExposureOffsetByFrameId, frameHealthReport.activeFrameId, params.exposure],
  );
  const activeFrameRgbBalanceOffset = useMemo(
    () =>
      frameHealthReport.activeFrameId === null
        ? DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET
        : snapNegativeLabFrameRgbBalanceOffsets({
            baselineParams: params,
            offsets: frameRgbBalanceOffsetByFrameId[frameHealthReport.activeFrameId],
          }),
    [frameHealthReport.activeFrameId, frameRgbBalanceOffsetByFrameId, params],
  );
  const effectiveActiveFrameRgbBalance = useMemo(
    () =>
      getNegativeLabEffectiveFrameRgbBalance({
        baselineParams: params,
        frameId: frameHealthReport.activeFrameId,
        offsetsByFrameId: frameRgbBalanceOffsetByFrameId,
      }),
    [frameHealthReport.activeFrameId, frameRgbBalanceOffsetByFrameId, params],
  );
  const approvedQcFrameIds = useMemo(
    () =>
      Object.entries(qcDecisionByFrameId)
        .filter(([, decision]) => decision === 'approved')
        .map(([frameId]) => frameId),
    [qcDecisionByFrameId],
  );
  const rejectedQcFrameIds = useMemo(
    () =>
      Object.entries(qcDecisionByFrameId)
        .filter(([, decision]) => decision === 'rejected')
        .map(([frameId]) => frameId),
    [qcDecisionByFrameId],
  );
  const readyOnlyPathsToConvert = useMemo(
    () =>
      frameHealthReport.frames
        .filter(
          (frame) =>
            qcDecisionByFrameId[frame.frameId] !== 'rejected' &&
            (frame.batchDisposition === 'apply' || qcDecisionByFrameId[frame.frameId] === 'approved'),
        )
        .map((frame) => frame.sourcePath),
    [frameHealthReport.frames, qcDecisionByFrameId],
  );
  const pathsToConvert = useMemo(() => {
    if (conversionScope === 'active' && selectedImagePath !== null) {
      const activeFrame = frameHealthReport.frames[effectiveActivePathIndex];
      return activeFrame !== undefined && qcDecisionByFrameId[activeFrame.frameId] !== 'rejected'
        ? [selectedImagePath]
        : [];
    }
    if (conversionScope === 'ready') return readyOnlyPathsToConvert;
    return frameHealthReport.frames
      .filter((frame) => frame.included && qcDecisionByFrameId[frame.frameId] !== 'rejected')
      .map((frame) => frame.sourcePath);
  }, [
    conversionScope,
    effectiveActivePathIndex,
    frameHealthReport.frames,
    qcDecisionByFrameId,
    readyOnlyPathsToConvert,
    selectedImagePath,
  ]);
  const omittedDispositionFrameIds = useMemo(
    () =>
      conversionScope === 'ready'
        ? frameHealthReport.frames
            .filter(
              (frame) =>
                qcDecisionByFrameId[frame.frameId] === 'rejected' ||
                (frame.batchDisposition !== 'apply' && qcDecisionByFrameId[frame.frameId] !== 'approved'),
            )
            .map((frame) => frame.frameId)
        : [],
    [conversionScope, frameHealthReport.frames, qcDecisionByFrameId],
  );
  const rollWarningCount = frameHealthReport.warningCodes.length + batchDryRunSummary.acquisitionReviewFrameIds.length;
  const batchApplyFrameCount = batchDryRunSummary.dispositionCounts.apply;
  const batchReviewFrameCount = batchDryRunSummary.dispositionCounts.review;
  const batchSkippedFrameCount = batchDryRunSummary.dispositionCounts.skip;
  const dustScratchReviewReport = useMemo(
    () => buildNegativeLabDustScratchReviewReport(frameHealthReport, previewUrl !== null),
    [frameHealthReport, previewUrl],
  );
  const dustCandidateFilterCounts = useMemo(() => {
    const counts: Record<NegativeLabDustCandidateFilter, number> = { accepted: 0, all: 0, pending: 0, rejected: 0 };
    for (const frame of dustScratchReviewReport.frames) {
      for (const candidate of frame.candidates) {
        const filterState = getDustCandidateFilterState(candidate.candidateId, dustCandidateDecisionById);
        counts.all += 1;
        counts[filterState] += 1;
      }
    }
    return counts;
  }, [dustCandidateDecisionById, dustScratchReviewReport.frames]);
  const visibleDustScratchReviewFrames = useMemo(
    () =>
      dustScratchReviewReport.frames
        .map((frame) => ({
          ...frame,
          candidates:
            dustCandidateFilter === 'all'
              ? frame.candidates
              : frame.candidates.filter(
                  (candidate) =>
                    getDustCandidateFilterState(candidate.candidateId, dustCandidateDecisionById) ===
                    dustCandidateFilter,
                ),
        }))
        .filter((frame) => dustCandidateFilter === 'all' || frame.candidates.length > 0),
    [dustCandidateDecisionById, dustCandidateFilter, dustScratchReviewReport.frames],
  );
  const dustHealLayerCount = Object.keys(dustHealLayerByCandidateId).length;
  const dustHealCorrectionMetrics = useMemo(
    () =>
      buildDustHealCorrectionMetrics({
        decisionByCandidateId: dustCandidateDecisionById,
        healLayerByCandidateId: dustHealLayerByCandidateId,
        reviewReport: dustScratchReviewReport,
      }),
    [dustCandidateDecisionById, dustHealLayerByCandidateId, dustScratchReviewReport],
  );
  const bulkAcceptDustCandidateCount = useMemo(
    () =>
      dustScratchReviewReport.frames.reduce(
        (count, frame) =>
          count +
          frame.candidates.filter(
            (candidate) =>
              candidate.kind === 'dust_spot' &&
              (dustCandidateDecisionById[candidate.candidateId] ?? candidate.status) !== 'accepted',
          ).length,
        0,
      ),
    [dustCandidateDecisionById, dustScratchReviewReport.frames],
  );
  const resolveDustHealImageSize = (frameId: string) => {
    const sourcePath = frameHealthReport.frames.find((frame) => frame.frameId === frameId)?.sourcePath ?? null;
    if (
      sourcePath !== null &&
      selectedEditorImage?.path === sourcePath &&
      selectedEditorImage.width > 0 &&
      selectedEditorImage.height > 0
    ) {
      return {
        imageHeight: selectedEditorImage.height,
        imageWidth: selectedEditorImage.width,
        source: 'selected_editor_image',
      } as const;
    }

    return { imageHeight: 1000, imageWidth: 1000, source: 'normalized_fallback' } as const;
  };
  const handleAcceptDustCandidate = (
    frame: NegativeLabDustScratchFrame,
    candidate: NegativeLabDustScratchCandidate,
  ) => {
    if (candidate.kind !== 'dust_spot') {
      setDustCandidateDecisionById((previous) => ({ ...previous, [candidate.candidateId]: 'rejected' }));
      return;
    }

    const dustHealImageSize = resolveDustHealImageSize(frame.frameId);
    const healLayer = buildDustCandidateHealLayer({
      candidate,
      frameId: frame.frameId,
      imageHeight: dustHealImageSize.imageHeight,
      imageWidth: dustHealImageSize.imageWidth,
    });
    setDustHealLayerByCandidateId((previous) => ({ ...previous, [candidate.candidateId]: healLayer }));
    setDustCandidateDecisionById((previous) => ({ ...previous, [candidate.candidateId]: 'accepted' }));
  };
  const handleAcceptAllDustCandidates = () => {
    for (const frame of dustScratchReviewReport.frames) {
      for (const candidate of frame.candidates) {
        const candidateDecision = dustCandidateDecisionById[candidate.candidateId] ?? candidate.status;
        if (candidate.kind === 'dust_spot' && candidateDecision !== 'accepted') {
          handleAcceptDustCandidate(frame, candidate);
        }
      }
    }
  };
  const handleClearAcceptedDustCandidates = () => {
    setDustHealLayerByCandidateId({});
    setDustCandidateDecisionById((previous) => {
      const next: typeof previous = {};
      for (const [candidateId, decision] of Object.entries(previous)) {
        if (decision !== 'accepted') {
          next[candidateId] = decision;
        }
      }
      return next;
    });
  };
  const handleRejectDustCandidate = (candidate: NegativeLabDustScratchCandidate) => {
    setDustHealLayerByCandidateId((previous) => {
      const next: typeof previous = {};
      for (const [candidateId, healLayer] of Object.entries(previous)) {
        if (candidateId !== candidate.candidateId) {
          next[candidateId] = healLayer;
        }
      }
      return next;
    });
    setDustCandidateDecisionById((previous) => ({ ...previous, [candidate.candidateId]: 'rejected' }));
  };
  const batchDryRunSummaryJson = useMemo(() => JSON.stringify(batchDryRunSummary), [batchDryRunSummary]);
  const batchDryRunPlanJson = useMemo(
    () =>
      JSON.stringify(
        {
          batchScope: conversionScope,
          cropStatusByFrameId,
          dryRunSummary: batchDryRunSummary,
          frameExposureOverrides: frameExposureOverridePayload,
          frameRgbBalanceOverrides: frameRgbBalanceOverridePayload,
          omittedDispositionFrameIds,
          patchSamplerCorrections: patchSamplerCorrectionPayload,
          qcDecisions: qcDecisionByFrameId,
          rollNormalizationPlan,
          selectedAcquisitionProfile,
          selectedProfile: selectedProfileSnapshot,
        },
        null,
        2,
      ),
    [
      batchDryRunSummary,
      conversionScope,
      cropStatusByFrameId,
      frameExposureOverridePayload,
      frameRgbBalanceOverridePayload,
      omittedDispositionFrameIds,
      patchSamplerCorrectionPayload,
      qcDecisionByFrameId,
      rollNormalizationPlan,
      selectedAcquisitionProfile,
      selectedProfileSnapshot,
    ],
  );
  const acceptedBatchPlanIdentity = useMemo(() => {
    if (selectedProfileSnapshot === null) {
      return buildNegativeLabAcceptedPlanIdentity(batchDryRunPlanJson);
    }
    return buildNegativeLabProfileBoundPlanIdentity(batchDryRunSummaryJson, selectedProfileSnapshot);
  }, [batchDryRunPlanJson, batchDryRunSummaryJson, selectedProfileSnapshot]);
  const visibleRollNormalizationApplyReceipt =
    rollNormalizationApplyReceipt?.acceptedDryRunPlanHash === acceptedBatchPlanIdentity.acceptedDryRunPlanHash
      ? rollNormalizationApplyReceipt
      : null;
  const visibleRollNormalizationRestoreReceipt =
    rollNormalizationRestoreReceipt?.acceptedDryRunPlanHash === acceptedBatchPlanIdentity.acceptedDryRunPlanHash
      ? rollNormalizationRestoreReceipt
      : null;
  const visibleBatchApplyReceipt =
    batchApplyReceipt?.acceptedDryRunPlanHash === acceptedBatchPlanIdentity.acceptedDryRunPlanHash
      ? batchApplyReceipt
      : null;
  const profileComparisonRows = useMemo(
    () =>
      buildNegativeLabProfileComparisonRows({
        activeFrameLabel: getNegativeLabScanLabel(
          selectedImagePath ?? targetPaths[effectiveActivePathIndex] ?? '',
          effectiveActivePathIndex,
        ),
        currentParams: params,
        profiles: NEGATIVE_LAB_PROFILE_BROWSER_ROWS,
        profileProvenanceHashById,
        queuedCount: Math.max(1, frameHealthReport.queuedCount),
        selectedPresetId,
      }),
    [
      effectiveActivePathIndex,
      frameHealthReport.queuedCount,
      params,
      profileProvenanceHashById,
      selectedImagePath,
      selectedPresetId,
      targetPaths,
    ],
  );
  const isBatchPlanCopied = copiedBatchPlanJson === batchDryRunPlanJson;
  const isBatchPlanAccepted = acceptedBatchPlanJson === batchDryRunPlanJson && !batchDryRunSummary.blocked;
  const canApplyRollNormalizationPlan = isBatchPlanAccepted && rollNormalizationPlan.affectedFrameIds.length > 0;
  const agentDryRunState: NegativeLabAgentDryRunState = batchDryRunSummary.blocked
    ? 'blocked'
    : isBatchPlanAccepted
      ? 'accepted'
      : 'ready';
  const agentCommitState: NegativeLabAgentCommitState = isSaving
    ? 'committing'
    : isBatchPlanAccepted
      ? 'ready_to_commit'
      : 'not_committed';
  const agentCommandSource = isBatchPlanAccepted
    ? NegativeLabAppServerCommandName.AcceptBatchPlan
    : NegativeLabAppServerCommandName.BatchSummary;
  const agentPlanId = isBatchPlanAccepted
    ? acceptedBatchPlanIdentity.acceptedDryRunPlanId
    : 'negative_lab_batch_plan_pending_acceptance';
  const agentProofHash = isBatchPlanAccepted
    ? acceptedBatchPlanIdentity.acceptedDryRunPlanHash
    : 'fnv1a32:pending_acceptance';
  const agentRollbackTarget = isBatchPlanAccepted
    ? acceptedBatchPlanIdentity.acceptedDryRunPlanId
    : 'accept_dry_run_plan_first';
  const runtimePreviewArtifactStatus = previewUrl === null ? 'pending_render' : 'rendered_positive_preview';
  const runtimePreviewBaseFogStatus = baseFogEstimate === null ? 'pending_base_fog' : 'base_fog_estimated';
  const runtimePreviewDensityStatus =
    selectedProfile?.params.print_curve_algorithm === undefined ? 'density_curve_pending' : 'density_curve_selected';
  const requiresAcceptedBatchPlan = hasMultipleScans && conversionScope !== 'active';
  const exportReadinessInput = {
    baseReady: baseFogEstimate !== null,
    batchPlanAccepted: isBatchPlanAccepted,
    isLoading,
    isSaving,
    pathCount: pathsToConvert.length,
    previewReady: previewUrl !== null,
    requiresAcceptedBatchPlan,
  };
  const canSave = buildNegativeLabCanSave(exportReadinessInput);
  const saveBlockedReasonKey = buildNegativeLabSaveBlockedReason({ ...exportReadinessInput, canSave });
  const baseReady = baseFogEstimate !== null;
  const positivePreviewReady = previewUrl !== null && baseReady;
  const baseSamplingActionLabelKey =
    baseFogConfidence === null
      ? 'modals.negativeConversion.estimateBaseSample'
      : baseSampleStudioDecision === 'accepted'
        ? 'modals.negativeConversion.baseSampleAccepted'
        : 'modals.negativeConversion.acceptBaseSample';
  const previewReadinessLabel = positivePreviewReady
    ? t('modals.negativeConversion.previewReady')
    : previewUrl === null
      ? t('modals.negativeConversion.previewPending')
      : t('modals.negativeConversion.baseSampleRequired');
  const qcProofReport = useMemo(() => {
    const exportReady = buildNegativeLabCanSave({
      baseReady: baseFogEstimate !== null,
      batchPlanAccepted: isBatchPlanAccepted,
      isLoading,
      isSaving,
      pathCount: pathsToConvert.length,
      previewReady: previewUrl !== null,
      requiresAcceptedBatchPlan,
    });

    return buildNegativeLabQcProofReport(
      dustScratchReviewReport,
      previewUrl !== null,
      exportReady && pathsToConvert.length === targetPaths.length,
    );
  }, [
    baseFogEstimate,
    dustScratchReviewReport,
    isBatchPlanAccepted,
    isLoading,
    isSaving,
    pathsToConvert.length,
    previewUrl,
    requiresAcceptedBatchPlan,
    targetPaths.length,
  ]);
  const qcProofArtifact = useMemo(() => {
    const sourcePathsByFrameId = new Map(
      frameHealthReport.frames.map((frame) => [frame.frameId, frame.sourcePath] as const),
    );

    return buildNegativeLabQcContactSheetArtifact({
      overlayVisibility: qcOverlayVisibility,
      qcDecisionByFrameId,
      report: qcProofReport,
      sessionId: `negative_lab_session_${targetPaths.length}_${pathsToConvert.length}`,
      sourcePathsByFrameId,
    });
  }, [
    frameHealthReport.frames,
    pathsToConvert.length,
    qcDecisionByFrameId,
    qcOverlayVisibility,
    qcProofReport,
    targetPaths.length,
  ]);
  const activePositiveVariant = useMemo(
    () => selectNegativeLabActivePositiveVariant(qcProofArtifact.positiveVariants, frameHealthReport.activeFrameId),
    [frameHealthReport.activeFrameId, qcProofArtifact.positiveVariants],
  );
  const workspaceProof = useMemo((): NegativeLabWorkspaceProof => {
    const exportReady = buildNegativeLabCanSave({
      baseReady: baseFogEstimate !== null,
      batchPlanAccepted: isBatchPlanAccepted,
      isLoading,
      isSaving,
      pathCount: pathsToConvert.length,
      previewReady: previewUrl !== null,
      requiresAcceptedBatchPlan,
    });

    return buildNegativeLabWorkspaceProof({
      canSave: exportReady,
      previewReady: previewUrl !== null,
      queuedCount: pathsToConvert.length,
      reviewReport: dustScratchReviewReport,
      targetCount: targetPaths.length,
    });
  }, [
    baseFogEstimate,
    dustScratchReviewReport,
    isBatchPlanAccepted,
    isLoading,
    isSaving,
    pathsToConvert.length,
    previewUrl,
    requiresAcceptedBatchPlan,
    targetPaths.length,
  ]);

  const workflowStages = useMemo<NegativeLabWorkflowStage[]>(
    () => [
      {
        detail:
          targetPaths.length === 1
            ? t('modals.negativeConversion.workflowSetupDetailSingle')
            : t('modals.negativeConversion.workflowSetupDetailMultiple', { scanCount: targetPaths.length }),
        id: 'setup',
        isComplete: targetPaths.length > 0,
        label: t('modals.negativeConversion.workflowSetup'),
      },
      {
        detail: selectedProfile?.displayName ?? t('modals.negativeConversion.workflowCustomPresetDetail'),
        id: 'preset',
        isComplete: true,
        label: t('modals.negativeConversion.workflowPreset'),
      },
      {
        detail: t('modals.negativeConversion.workflowColorDetail', {
          base: Math.round(params.base_fog_strength * 100),
          blue: params.blue_weight.toFixed(2),
          green: params.green_weight.toFixed(2),
          red: params.red_weight.toFixed(2),
        }),
        id: 'colorTiming',
        isComplete: baseReady,
        label: t('modals.negativeConversion.workflowColorTiming'),
      },
      {
        detail: t('modals.negativeConversion.workflowInspectionDetail', {
          reviewCount: dustScratchReviewReport.reviewCount,
          retouchCount: dustScratchReviewReport.retouchCount,
        }),
        id: 'inspection',
        isComplete: positivePreviewReady && dustScratchReviewReport.retouchCount === 0,
        label: t('modals.negativeConversion.workflowInspection'),
      },
      {
        detail: t('modals.negativeConversion.workflowPrintDetail', {
          blackPoint: params.black_point.toFixed(2),
          contrast: params.contrast.toFixed(2),
          exposure: params.exposure.toFixed(2),
          whitePoint: params.white_point.toFixed(2),
        }),
        id: 'printGrade',
        isComplete: true,
        label: t('modals.negativeConversion.workflowPrintGrade'),
      },
      {
        detail: isSaving
          ? t('modals.negativeConversion.workflowExportConverting')
          : t('modals.negativeConversion.workflowExportReadyCount', {
              format: t(
                saveOptions.outputFormat === NegativeLabOutputFormatId.Tiff16
                  ? 'modals.negativeConversion.outputFormats.tiff16'
                  : 'modals.negativeConversion.outputFormats.jpeg_proof',
              ),
              queuedCount: pathsToConvert.length,
            }),
        id: 'export',
        isComplete: canSave,
        label: t('modals.negativeConversion.workflowExport'),
      },
    ],
    [
      baseReady,
      canSave,
      isLoading,
      isSaving,
      params,
      pathsToConvert.length,
      positivePreviewReady,
      previewUrl,
      saveOptions.outputFormat,
      selectedProfile,
      dustScratchReviewReport.reviewCount,
      dustScratchReviewReport.retouchCount,
      t,
      targetPaths.length,
    ],
  );
  const walkthroughClosureReady =
    workspaceProof.previewReady &&
    workspaceProof.exportReady &&
    selectedProfile !== null &&
    qcProofReport.exportReady &&
    activePositiveVariant !== null;
  const walkthroughClosureRows = [
    {
      id: 'setup',
      isReady: targetPaths.length > 0,
      label: t('modals.negativeConversion.workflowSetup'),
      value:
        targetPaths.length === 1
          ? t('modals.negativeConversion.workflowSetupDetailSingle')
          : t('modals.negativeConversion.workflowSetupDetailMultiple', { scanCount: targetPaths.length }),
    },
    {
      id: 'profile',
      isReady: selectedProfile !== null,
      label: t('modals.negativeConversion.workflowPreset'),
      value: selectedProfile?.displayName ?? t('modals.negativeConversion.workflowCustomPresetDetail'),
    },
    {
      id: 'inversion',
      isReady: positivePreviewReady,
      label: t('modals.negativeConversion.workflowColorTiming'),
      value: previewReadinessLabel,
    },
    {
      id: 'qc',
      isReady: qcProofReport.exportReady,
      label: t('modals.negativeConversion.workflowInspection'),
      value: t('modals.negativeConversion.workflowInspectionDetail', {
        reviewCount: qcProofReport.reviewFrameCount,
        retouchCount: dustScratchReviewReport.retouchCount,
      }),
    },
    {
      id: 'handoff',
      isReady: activePositiveVariant !== null,
      label: t('modals.negativeConversion.positiveHandoff'),
      value:
        activePositiveVariant === null
          ? t('modals.negativeConversion.positiveHandoffReview')
          : t('modals.negativeConversion.positiveHandoffReady'),
    },
    {
      id: 'export',
      isReady: workspaceProof.exportReady,
      label: t('modals.negativeConversion.workflowExport'),
      value: workspaceProof.exportReady
        ? t('modals.negativeConversion.workflowExportReadyCount', {
            format: t(
              saveOptions.outputFormat === NegativeLabOutputFormatId.Tiff16
                ? 'modals.negativeConversion.outputFormats.tiff16'
                : 'modals.negativeConversion.outputFormats.jpeg_proof',
            ),
            queuedCount: workspaceProof.queuedCount,
          })
        : t('modals.negativeConversion.workflowExportBlocked'),
    },
  ] as const;

  useEffect(() => {
    const unlisten = listen<unknown>('negative-batch-progress', (event) => {
      const payload = parsePathProgressPayload(event.payload);
      setProgress({ current: payload.current, total: payload.total });
    });
    return () => {
      void unlisten
        .then((f) => {
          f();
        })
        .catch((err: unknown) => {
          console.error('Failed to remove negative batch progress listener:', err);
        });
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(NEGATIVE_LAB_QC_OVERLAY_STORAGE_KEY, JSON.stringify(qcOverlayVisibility));
  }, [qcOverlayVisibility]);

  const updatePreview = useMemo(
    () =>
      throttle(
        async (
          currentParams: NegativeParams,
          isInitialLoad: boolean = false,
          baseSampleProofContext: NegativeLabBaseSamplePreviewProofContext | null = null,
        ) => {
          if (!selectedImagePath) return;
          const previewRevision = 1;
          try {
            const result: string = await invoke(Invokes.PreviewNegativeConversion, {
              path: selectedImagePath,
              params: currentParams,
            });
            setPreviewUrl(result);
            if (baseSampleProofContext !== null) {
              setBaseFogPreviewProof(
                buildNegativeLabBaseSamplePreviewProof(
                  baseSampleProofContext,
                  result,
                  buildNegativeBaseFogDensitometerReadout(baseSampleProofContext.estimate),
                  previewRevision,
                ),
              );
            }
            if (isInitialLoad) {
              setIsLoading(false);
            }
          } catch (e) {
            console.error('Negative preview failed', e);
            if (isInitialLoad) {
              setIsLoading(false);
            }
          }
        },
        100,
      ),
    [selectedImagePath],
  );

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        setIsLoading(true);
        updatePreview(DEFAULT_PARAMS, true);
      }, 0);

      if (selectedImagePath) {
        invoke<number[]>(Invokes.GeneratePreviewForPath, {
          path: selectedImagePath,
          jsAdjustments: {},
        })
          .then((res) => {
            const blob = new Blob([new Uint8Array(res)], { type: 'image/jpeg' });
            setOriginalUrl(URL.createObjectURL(blob));
          })
          .catch(console.error);
      }
      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setPreviewUrl(null);
      setOriginalUrl(null);
      setParams(DEFAULT_PARAMS);
      setSelectedPresetId(DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId);
      setSelectedAcquisitionProfileId(DEFAULT_NEGATIVE_LAB_ACQUISITION_PROFILE_ID);
      resetViewport();
      setBaseFogConfidence(null);
      setBaseFogEstimate(null);
      setBaseFogScope('frame');
      setBaseFogPreviewProof(null);
      setBaseFogReadoutCopied(false);
      setNeutralPatchSuggestion(null);
      setShadowPatchBlackPointSuggestion(null);
      setHighlightPatchExposureSuggestion(null);
      setPatchRole('neutral');
      setIsPickingPatch(false);
      setPatchDragStart(null);
      setDraftPatchRect(null);
      setActiveBaseFogSampleLabel(null);
      setBaseFogSampleUndoStack([]);
      setCustomBaseSampleRect(CUSTOM_BASE_SAMPLE_DEFAULT);
      setCustomBaseSampleEstimate(null);
      setActivePathIndex(0);
      setBrowsedComparisonProfileId(null);
      setIsLoading(true);
      setProgress(null);
      setSaveOptions(DEFAULT_SAVE_OPTIONS);
      setOpenSavedPositiveInEditor(true);
      setConversionScope('all');
      setIncludedPathSet(getInitialIncludedPaths(targetPaths));
      setFrameExposureOffsetByFrameId({});
      setFrameRgbBalanceOffsetByFrameId({});
      setPatchSamplerCorrectionPayload(EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD);
      setQcDecisionByFrameId({});
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, resetViewport, selectedImagePath, targetPaths, updatePreview]);

  useEffect(() => {
    if (!isPickingPatch) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsPickingPatch(false);
      setPatchDragStart(null);
      setDraftPatchRect(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickingPatch]);

  const buildParamsWithFrameOverrides = (
    baseParams: NegativeParams,
    frameId: string | null = frameHealthReport.activeFrameId,
    offsetsByFrameId: Readonly<Record<string, number>> = frameExposureOffsetByFrameId,
    rgbOffsetsByFrameId: Readonly<Record<string, NegativeLabFrameRgbBalanceOffset>> = frameRgbBalanceOffsetByFrameId,
  ): NegativeParams => ({
    ...baseParams,
    ...(() => {
      const effectiveRgbBalance = getNegativeLabEffectiveFrameRgbBalance({
        baselineParams: baseParams,
        frameId,
        offsetsByFrameId: rgbOffsetsByFrameId,
      });
      return {
        blue_weight: effectiveRgbBalance.blueWeight,
        green_weight: effectiveRgbBalance.greenWeight,
        red_weight: effectiveRgbBalance.redWeight,
      };
    })(),
    exposure: getNegativeLabEffectiveFrameExposure({
      baselineExposure: baseParams.exposure,
      frameId,
      offsetsByFrameId,
    }),
  });

  useEffect(() => {
    if (!isOpen || selectedImagePath === null) {
      setRenderedProfileCandidatePreviewById({});
      return;
    }

    const candidateRows = [
      ...profileComparisonRows.slice(0, NEGATIVE_LAB_PROFILE_CANDIDATE_RENDER_LIMIT),
      ...profileComparisonRows.filter((row) => row.profile.presetId === browsedComparisonProfileId),
    ].filter(
      (row, index, candidates) =>
        candidates.findIndex((candidate) => candidate.profile.presetId === row.profile.presetId) === index,
    );

    let cancelled = false;

    const renderingPreviewById: Record<string, NegativeLabRenderedProfileCandidatePreview> = {};
    for (const row of candidateRows) {
      renderingPreviewById[row.profile.presetId] = {
        baseSampleId: getNegativeLabProfileBaseSampleId(row.profile.params),
        identicalOutputReason: null,
        imageHash: buildNegativeLabRenderedCandidateHash({
          profileProvenanceHash: row.selectedProfileSnapshot.profileProvenanceHash,
          status: row.profile.isSelectable ? 'rendering' : 'blocked',
        }),
        previewHash: row.renderEvidence.previewHash as `fnv1a32:${string}`,
        renderError: row.profile.isSelectable ? null : (row.profile.disabledReason ?? 'profile_not_runtime_selectable'),
        status: row.profile.isSelectable ? 'rendering' : 'blocked',
        url: null,
      };
    }
    setRenderedProfileCandidatePreviewById(renderingPreviewById);

    void Promise.all(
      candidateRows.map(async (row) => {
        if (!row.profile.isSelectable) {
          return {
            baseSampleId: getNegativeLabProfileBaseSampleId(row.profile.params),
            identicalOutputReason: null,
            imageHash: buildNegativeLabRenderedCandidateHash({
              profileProvenanceHash: row.selectedProfileSnapshot.profileProvenanceHash,
              status: 'blocked',
            }),
            previewHash: row.renderEvidence.previewHash as `fnv1a32:${string}`,
            renderError: row.profile.disabledReason ?? 'profile_not_runtime_selectable',
            status: 'blocked',
            url: null,
          } satisfies NegativeLabRenderedProfileCandidatePreview;
        }

        const candidateParams = buildParamsWithFrameOverrides(row.profile.params);
        const baseSampleId = getNegativeLabProfileBaseSampleId(candidateParams);

        try {
          const url: string = await invoke(Invokes.PreviewNegativeConversion, {
            params: candidateParams,
            path: selectedImagePath,
          });
          const imageHash = buildNegativeLabRenderedCandidateHash({
            pipeline: Invokes.PreviewNegativeConversion,
            profileProvenanceHash: row.selectedProfileSnapshot.profileProvenanceHash,
            url,
          });

          return {
            baseSampleId,
            identicalOutputReason: null,
            imageHash,
            previewHash: buildNegativeLabRenderedCandidateHash({
              algorithm: row.renderEvidence.densityAlgorithm,
              baseSampleId,
              imageHash,
              outputTag: row.renderEvidence.outputTag,
              profileProvenanceHash: row.selectedProfileSnapshot.profileProvenanceHash,
            }),
            renderError: null,
            status: 'ready',
            url,
          } satisfies NegativeLabRenderedProfileCandidatePreview;
        } catch (error) {
          const renderError = getNegativeLabRenderedCandidateError(error);
          return {
            baseSampleId,
            identicalOutputReason: null,
            imageHash: buildNegativeLabRenderedCandidateHash({
              profileProvenanceHash: row.selectedProfileSnapshot.profileProvenanceHash,
              renderError,
            }),
            previewHash: row.renderEvidence.previewHash as `fnv1a32:${string}`,
            renderError,
            status: 'failed',
            url: null,
          } satisfies NegativeLabRenderedProfileCandidatePreview;
        }
      }),
    ).then((previews) => {
      if (cancelled) return;

      const readyImageHashCounts = new Map<string, number>();
      for (const preview of previews) {
        if (preview.status === 'ready') {
          readyImageHashCounts.set(preview.imageHash, (readyImageHashCounts.get(preview.imageHash) ?? 0) + 1);
        }
      }

      const previewById: Record<string, NegativeLabRenderedProfileCandidatePreview> = {};
      for (const [index, row] of candidateRows.entries()) {
        const preview = previews[index];
        if (preview === undefined) continue;
        previewById[row.profile.presetId] =
          preview.status === 'ready' && (readyImageHashCounts.get(preview.imageHash) ?? 0) > 1
            ? {
                ...preview,
                identicalOutputReason: 'backend_preview_returned_identical_pixels_for_candidate_params',
              }
            : preview;
      }
      setRenderedProfileCandidatePreviewById(previewById);
    });

    return () => {
      cancelled = true;
    };
  }, [
    browsedComparisonProfileId,
    frameExposureOffsetByFrameId,
    frameHealthReport.activeFrameId,
    frameRgbBalanceOffsetByFrameId,
    isOpen,
    profileComparisonRows,
    selectedImagePath,
  ]);

  const handleParamChange = (key: keyof NegativeParams, value: number) => {
    const newParams = { ...params, [key]: value };
    setSelectedPresetId('');
    if (key === 'red_weight' || key === 'green_weight' || key === 'blue_weight') {
      setBaseFogConfidence(null);
      setBaseFogPreviewProof(null);
      setActiveBaseFogSampleLabel(null);
    }
    setParams(newParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(newParams));
  };

  const handleEndpointReset = () => {
    const newParams = { ...params, black_point: DEFAULT_PARAMS.black_point, white_point: DEFAULT_PARAMS.white_point };
    setSelectedPresetId('');
    setParams(newParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(newParams));
  };

  const handleSetPrintCurveV2Enabled = (enabled: boolean) => {
    const newParams: NegativeParams = enabled
      ? {
          ...params,
          print_curve_algorithm: 'negative_density_print_v2',
          print_curve_output_tag: 'preview_display',
          print_curve_v2: params.print_curve_v2 ?? DEFAULT_NEGATIVE_LAB_PRINT_CURVE_V2_PARAMS,
        }
      : {
          ...params,
          print_curve_algorithm: 'density_rgb_v1',
          print_curve_output_tag: 'preview_display',
          print_curve_v2: null,
        };
    setSelectedPresetId('');
    setParams(newParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(newParams));
  };

  const handlePrintCurveV2ParamChange = (key: keyof NonNullable<NegativeParams['print_curve_v2']>, value: number) => {
    const currentV2Params = params.print_curve_v2 ?? DEFAULT_NEGATIVE_LAB_PRINT_CURVE_V2_PARAMS;
    const newParams: NegativeParams = {
      ...params,
      print_curve_algorithm: 'negative_density_print_v2',
      print_curve_output_tag: 'preview_display',
      print_curve_v2: {
        ...currentV2Params,
        [key]: value,
      },
    };
    setSelectedPresetId('');
    setParams(newParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(newParams));
  };

  const handlePresetSelect = (preset: NegativeLabRuntimeProfileBrowserRow) => {
    if (!preset.isSelectable) return;

    setSelectedPresetId(preset.presetId);
    setBaseFogConfidence(null);
    setBaseFogEstimate(null);
    setBaseFogScope('frame');
    setBaseFogPreviewProof(null);
    setBaseFogReadoutCopied(false);
    setBaseSampleStudioDecision('candidate');
    setRejectedBaseSampleLabel(null);
    setActiveBaseFogSampleLabel(null);
    setBaseFogSampleUndoStack([]);
    setParams(preset.params);
    setPatchSamplerCorrectionPayload(EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(preset.params));
  };

  const pushBaseFogSampleUndoEntry = () => {
    setBaseFogSampleUndoStack((stack) => [
      ...stack,
      {
        activeBaseFogSampleLabel,
        baseFogConfidence,
        baseFogEstimate,
        baseFogPreviewProof,
        baseFogScope,
        baseSampleStudioDecision,
        params,
        patchSamplerCorrectionPayload,
        selectedPresetId,
      },
    ]);
  };

  const handleUndoBaseFogSample = () => {
    const previous = baseFogSampleUndoStack.at(-1);
    if (previous === undefined) return;
    setBaseFogSampleUndoStack((stack) => stack.slice(0, -1));
    setBaseFogConfidence(previous.baseFogConfidence);
    setBaseFogEstimate(previous.baseFogEstimate);
    setBaseFogScope(previous.baseFogScope);
    setBaseFogPreviewProof(previous.baseFogPreviewProof);
    setBaseFogReadoutCopied(false);
    setBaseSampleStudioDecision(previous.baseSampleStudioDecision);
    setRejectedBaseSampleLabel(null);
    setActiveBaseFogSampleLabel(previous.activeBaseFogSampleLabel);
    setSelectedPresetId(previous.selectedPresetId);
    setParams(previous.params);
    setPatchSamplerCorrectionPayload(previous.patchSamplerCorrectionPayload);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(previous.params));
  };

  const handleAutoBaseFog = async () => {
    if (!selectedImagePath) return;
    setIsEstimatingBaseFog(true);
    try {
      const estimate = await invokeWithSchema(
        Invokes.EstimateNegativeBaseFog,
        {
          path: selectedImagePath,
          sampleRect: null,
        },
        negativeBaseFogEstimateSchema,
      );
      const nextParams = {
        ...params,
        base_fog_strength: 1,
        base_fog_sample: null,
        blue_weight: estimate.blueWeight,
        green_weight: estimate.greenWeight,
        red_weight: estimate.redWeight,
      };
      const proofContext: NegativeLabBaseSamplePreviewProofContext = {
        estimate,
        frameId: `frame_${effectiveActivePathIndex + 1}`,
        imagePath: selectedImagePath,
        previewBeforeUrl: previewUrl,
        sampleRect: null,
        source: 'auto_full_frame',
      };
      pushBaseFogSampleUndoEntry();
      setBaseFogConfidence(estimate.confidence);
      setBaseFogEstimate(estimate);
      setBaseFogScope('frame');
      setBaseFogReadoutCopied(false);
      setBaseSampleStudioDecision('candidate');
      setRejectedBaseSampleLabel(null);
      setActiveBaseFogSampleLabel(t('modals.negativeConversion.sampleFullFrame'));
      setParams(nextParams);
      setAcceptedBatchPlanJson(null);
      updatePreview(buildParamsWithFrameOverrides(nextParams), false, proofContext);
    } catch (e) {
      console.error('Negative base/fog estimate failed', e);
    } finally {
      setIsEstimatingBaseFog(false);
    }
  };

  const handleSampleBaseFog = async (labelKey: BaseFogSampleLabelKey, sampleRect: NegativeLabBaseFogSampleRect) => {
    if (!selectedImagePath) return;
    setIsEstimatingBaseFog(true);
    try {
      const estimate = await invokeWithSchema(
        Invokes.EstimateNegativeBaseFog,
        {
          path: selectedImagePath,
          sampleRect,
        },
        negativeBaseFogEstimateSchema,
      );
      const nextParams = {
        ...params,
        base_fog_strength: 1,
        base_fog_sample: sampleRect,
        blue_weight: estimate.blueWeight,
        green_weight: estimate.greenWeight,
        red_weight: estimate.redWeight,
      };
      const proofContext: NegativeLabBaseSamplePreviewProofContext = {
        estimate,
        frameId: `frame_${effectiveActivePathIndex + 1}`,
        imagePath: selectedImagePath,
        previewBeforeUrl: previewUrl,
        sampleRect,
        source: 'preset_rect',
      };
      pushBaseFogSampleUndoEntry();
      setBaseFogConfidence(estimate.confidence);
      setBaseFogEstimate(estimate);
      setBaseFogScope('frame');
      setBaseFogReadoutCopied(false);
      setBaseSampleStudioDecision('candidate');
      setRejectedBaseSampleLabel(null);
      setActiveBaseFogSampleLabel(t(labelKey));
      setParams(nextParams);
      setAcceptedBatchPlanJson(null);
      updatePreview(buildParamsWithFrameOverrides(nextParams), false, proofContext);
    } catch (e) {
      console.error('Base/fog sample failed', e);
    } finally {
      setIsEstimatingBaseFog(false);
    }
  };

  const handleCustomBaseSampleRectChange = (key: keyof NegativeLabBaseFogSampleRect, valuePercent: number) => {
    const normalizedValue = Number.isFinite(valuePercent) ? valuePercent / 100 : CUSTOM_BASE_SAMPLE_DEFAULT[key];
    const nextRect = normalizeSampleRect({ ...customBaseSampleRect, [key]: normalizedValue });
    setCustomBaseSampleRect(nextRect);
    setCustomBaseSampleEstimate(null);
  };

  const handleMeasureCustomBaseSample = async () => {
    if (!selectedImagePath) return;
    setIsMeasuringCustomBaseSample(true);
    try {
      const estimate = await invokeWithSchema(
        Invokes.EstimateNegativeBaseFog,
        {
          path: selectedImagePath,
          sampleRect: customBaseSampleRect,
        },
        negativeBaseFogEstimateSchema,
      );
      setCustomBaseSampleEstimate(estimate);
    } catch (e) {
      console.error('Custom base sample failed', e);
    } finally {
      setIsMeasuringCustomBaseSample(false);
    }
  };

  const handleApplyCustomBaseSample = () => {
    if (customBaseSampleEstimate === null || selectedImagePath === null) return;
    const nextParams = {
      ...params,
      base_fog_strength: 1,
      base_fog_sample: customBaseSampleRect,
      blue_weight: customBaseSampleEstimate.blueWeight,
      green_weight: customBaseSampleEstimate.greenWeight,
      red_weight: customBaseSampleEstimate.redWeight,
    };
    const proofContext: NegativeLabBaseSamplePreviewProofContext = {
      estimate: customBaseSampleEstimate,
      frameId: `frame_${effectiveActivePathIndex + 1}`,
      imagePath: selectedImagePath,
      previewBeforeUrl: previewUrl,
      sampleRect: customBaseSampleRect,
      source: 'custom_rect',
    };
    pushBaseFogSampleUndoEntry();
    setBaseFogConfidence(customBaseSampleEstimate.confidence);
    setBaseFogEstimate(customBaseSampleEstimate);
    setBaseFogScope('frame');
    setBaseFogReadoutCopied(false);
    setBaseSampleStudioDecision('candidate');
    setRejectedBaseSampleLabel(null);
    setActiveBaseFogSampleLabel(t('modals.negativeConversion.customBaseSample'));
    setParams(nextParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(nextParams), false, proofContext);
  };

  const handlePromoteBaseFogToRoll = () => {
    if (baseFogConfidence === null || baseFogEstimate === null || selectedImagePath === null || baseFogScope === 'roll')
      return;
    const frameId = frameHealthReport.activeFrameId ?? `frame_${effectiveActivePathIndex + 1}`;
    pushBaseFogSampleUndoEntry();
    setBaseFogScope('roll');
    setBaseSampleStudioDecision('accepted');
    setBaseFogPreviewProof((proof) =>
      proof === null ? null : buildNegativeLabBaseSampleDecisionProof(proof, 'accepted', 'roll'),
    );
    setPatchSamplerCorrectionPayload((payload) =>
      appendNegativeLabPatchSamplerCorrection(
        payload,
        buildNegativeLabBaseFogPatchSamplerCorrection({
          estimate: baseFogEstimate,
          frameId,
          sampleRect: params.base_fog_sample,
          sourcePath: selectedImagePath,
        }),
      ),
    );
    setAcceptedBatchPlanJson(null);
  };

  const handleAcceptBaseSample = () => {
    if (baseFogConfidence === null || baseFogEstimate === null || selectedImagePath === null) return;
    const frameId = frameHealthReport.activeFrameId ?? `frame_${effectiveActivePathIndex + 1}`;
    setBaseSampleStudioDecision('accepted');
    setBaseFogPreviewProof((proof) =>
      proof === null ? null : buildNegativeLabBaseSampleDecisionProof(proof, 'accepted', baseFogScope),
    );
    setRejectedBaseSampleLabel(null);
    setPatchSamplerCorrectionPayload((payload) =>
      appendNegativeLabPatchSamplerCorrection(
        payload,
        buildNegativeLabBaseFogPatchSamplerCorrection({
          estimate: baseFogEstimate,
          frameId,
          sampleRect: params.base_fog_sample,
          sourcePath: selectedImagePath,
        }),
      ),
    );
  };

  const handleRejectBaseSample = () => {
    if (activeBaseFogSampleLabel === null) return;
    const rejectedLabel = activeBaseFogSampleLabel;
    const rejectedProof =
      baseFogPreviewProof === null
        ? null
        : buildNegativeLabBaseSampleDecisionProof(baseFogPreviewProof, 'rejected', baseFogScope, 'manual');
    handleUndoBaseFogSample();
    setRejectedBaseSampleLabel(rejectedLabel);
    setBaseFogPreviewProof(rejectedProof);
    setBaseSampleStudioDecision('rejected');
    const activeFrameId = frameHealthReport.activeFrameId;
    if (activeFrameId !== null) {
      setPatchSamplerCorrectionPayload((payload) =>
        removeNegativeLabPatchSamplerCorrections(payload, activeFrameId, ['base_fog']),
      );
    }
  };

  const handleSamplePatchProbe = async (
    labelKey: DensitometerPatchLabelKey,
    sampleRect: NegativeLabBaseFogSampleRect,
  ) => {
    if (!selectedImagePath) return;
    setIsSamplingPatchProbe(true);
    try {
      const estimate = await invokeWithSchema(
        Invokes.EstimateNegativeBaseFog,
        {
          path: selectedImagePath,
          sampleRect,
        },
        negativeBaseFogEstimateSchema,
      );
      setPatchProbeEstimate(estimate);
      setPatchProbeRect(sampleRect);
      setPatchProbeLabel(t(labelKey));
      setPatchRole(labelKey === 'modals.negativeConversion.sampleHighlightPatch' ? 'highlight' : 'neutral');
      setNeutralPatchSuggestion(null);
      setHighlightPatchExposureSuggestion(null);
      setShadowPatchBlackPointSuggestion(null);
    } catch (e) {
      console.error('Patch probe sample failed', e);
    } finally {
      setIsSamplingPatchProbe(false);
    }
  };

  const buildPickedPatchRectFromPointer = (start: NegativeLabPatchPickerPoint, event: PointerEvent) => {
    const imageBounds = previewImageRef.current?.getBoundingClientRect();
    if (imageBounds === undefined) return null;

    return buildNegativeLabPickedPatchRect(start, { x: event.clientX, y: event.clientY }, imageBounds);
  };

  const handlePatchPickPointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (!isPickingPatch || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startPoint = { x: event.clientX, y: event.clientY };
    setPatchDragStart(startPoint);
    setDraftPatchRect(buildPickedPatchRectFromPointer(startPoint, event));
  };

  const handlePatchPickPointerMove = (event: PointerEvent<HTMLImageElement>) => {
    if (!isPickingPatch || patchDragStart === null) return;
    event.preventDefault();
    event.stopPropagation();
    setDraftPatchRect(buildPickedPatchRectFromPointer(patchDragStart, event));
  };

  const handlePatchPickPointerUp = (event: PointerEvent<HTMLImageElement>) => {
    if (!isPickingPatch || patchDragStart === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const nextRect = buildPickedPatchRectFromPointer(patchDragStart, event);
    setIsPickingPatch(false);
    setPatchDragStart(null);
    setDraftPatchRect(null);
    if (nextRect !== null) {
      void handleSamplePatchProbe(
        patchRole === 'highlight'
          ? 'modals.negativeConversion.sampleHighlightPatch'
          : 'modals.negativeConversion.sampleCenterPatch',
        nextRect,
      );
    }
  };

  const handleSuggestNeutralPatchRgb = async () => {
    if (selectedImagePath === null || patchProbeRect === null) return;
    setIsSuggestingNeutralPatchRgb(true);
    try {
      const suggestion = await invokeWithSchema(
        Invokes.SuggestNegativeLabNeutralPatchRgbBalance,
        {
          params,
          path: selectedImagePath,
          sampleRect: patchProbeRect,
        },
        negativeLabNeutralPatchSuggestionSchema,
      );
      setNeutralPatchSuggestion(suggestion);
      setHighlightPatchExposureSuggestion(null);
      setShadowPatchBlackPointSuggestion(null);
    } catch (error) {
      console.error('Neutral patch RGB suggestion failed', error);
      setNeutralPatchSuggestion(null);
    } finally {
      setIsSuggestingNeutralPatchRgb(false);
    }
  };

  const handleSuggestHighlightPatchExposure = async () => {
    if (selectedImagePath === null || patchProbeRect === null) return;
    setIsSuggestingHighlightPatchExposure(true);
    try {
      const suggestion = await invokeWithSchema(
        Invokes.SuggestNegativeLabHighlightPatchExposure,
        {
          currentFrameExposureOffset: activeFrameExposureOffset,
          params,
          path: selectedImagePath,
          sampleRect: patchProbeRect,
        },
        negativeLabHighlightPatchExposureSuggestionSchema,
      );
      setHighlightPatchExposureSuggestion(suggestion);
      setNeutralPatchSuggestion(null);
      setShadowPatchBlackPointSuggestion(null);
    } catch (error) {
      console.error('Highlight patch exposure suggestion failed', error);
      setHighlightPatchExposureSuggestion(null);
    } finally {
      setIsSuggestingHighlightPatchExposure(false);
    }
  };

  const handleSuggestShadowPatchBlackPoint = async () => {
    if (selectedImagePath === null || patchProbeRect === null) return;
    setIsSuggestingShadowPatchBlackPoint(true);
    try {
      const suggestion = await invokeWithSchema(
        Invokes.SuggestNegativeLabShadowPatchBlackPoint,
        {
          params,
          path: selectedImagePath,
          sampleRect: patchProbeRect,
        },
        negativeLabShadowPatchBlackPointSuggestionSchema,
      );
      setShadowPatchBlackPointSuggestion(suggestion);
      setHighlightPatchExposureSuggestion(null);
      setNeutralPatchSuggestion(null);
    } catch (error) {
      console.error('Shadow patch black point suggestion failed', error);
      setShadowPatchBlackPointSuggestion(null);
    } finally {
      setIsSuggestingShadowPatchBlackPoint(false);
    }
  };

  const handleCopyBaseFogReadout = async () => {
    if (baseFogEstimate === null || selectedImagePath === null) return;

    const payload = {
      baseDensity: baseFogEstimate.baseDensity,
      baseRgb: baseFogEstimate.baseRgb,
      confidence: baseFogEstimate.confidence,
      imagePath: selectedImagePath,
      sampleLabel: activeBaseFogSampleLabel,
      sampleRect: params.base_fog_sample,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBaseFogReadoutCopied(true);
    } catch (error) {
      console.error('Negative Lab readout copy failed', error);
      setBaseFogReadoutCopied(false);
    }
  };

  const handleCopyBatchPlan = async () => {
    try {
      await navigator.clipboard.writeText(batchDryRunPlanJson);
      setCopiedBatchPlanJson(batchDryRunPlanJson);
    } catch (error) {
      console.error('Negative Lab batch plan copy failed', error);
      setCopiedBatchPlanJson(null);
    }
  };

  const handleAcceptBatchPlan = () => {
    if (batchDryRunSummary.blocked) return;
    setAcceptedBatchPlanJson(batchDryRunPlanJson);
    setBatchApplyReceipt(null);
  };

  const handleApplyBatchPlan = () => {
    if (!isBatchPlanAccepted) return;
    setBatchApplyReceipt(
      buildNegativeLabBatchApplyReceipt({
        acceptedPlanIdentity: acceptedBatchPlanIdentity,
        dryRunSummary: batchDryRunSummary,
        openInEditor: openSavedPositiveInEditor,
        qcProofArtifact,
      }),
    );
  };

  const handleApplyRollNormalizationPlan = () => {
    if (!canApplyRollNormalizationPlan) return;

    const { nextState, receipt } = applyNegativeLabRollNormalizationPlan({
      acceptedPlanIdentity: acceptedBatchPlanIdentity,
      baselineParams: params,
      currentState: {
        frameExposureOffsetByFrameId,
        frameRgbBalanceOffsetByFrameId,
      },
      plan: rollNormalizationPlan,
      restoreRevision: rollNormalizationRestoreRevision + 1,
      reviewFrameCount: batchReviewFrameCount,
      skippedFrameCount: batchSkippedFrameCount,
    });
    setFrameExposureOffsetByFrameId(nextState.frameExposureOffsetByFrameId);
    setFrameRgbBalanceOffsetByFrameId(nextState.frameRgbBalanceOffsetByFrameId);
    setRollNormalizationApplyReceipt(receipt);
    setRollNormalizationRestoreReceipt(null);
    setRollNormalizationRestoreRevision(receipt.restoreRevision);
    setAcceptedBatchPlanJson(null);
    updatePreview(
      buildParamsWithFrameOverrides(
        params,
        frameHealthReport.activeFrameId,
        nextState.frameExposureOffsetByFrameId,
        nextState.frameRgbBalanceOffsetByFrameId,
      ),
    );
  };

  const handleRestoreRollNormalizationPlan = () => {
    if (visibleRollNormalizationApplyReceipt === null || visibleRollNormalizationApplyReceipt.restored) return;

    const { nextState, receipt } = restoreNegativeLabRollNormalizationOverrides(visibleRollNormalizationApplyReceipt);
    setFrameExposureOffsetByFrameId(nextState.frameExposureOffsetByFrameId);
    setFrameRgbBalanceOffsetByFrameId(nextState.frameRgbBalanceOffsetByFrameId);
    setRollNormalizationApplyReceipt({
      ...visibleRollNormalizationApplyReceipt,
      restored: true,
    });
    setRollNormalizationRestoreReceipt(receipt);
    setAcceptedBatchPlanJson(null);
    updatePreview(
      buildParamsWithFrameOverrides(
        params,
        frameHealthReport.activeFrameId,
        nextState.frameExposureOffsetByFrameId,
        nextState.frameRgbBalanceOffsetByFrameId,
      ),
    );
  };

  const handleSetQcDecision = (frameId: string, decision: NegativeLabQcDecision) => {
    setQcDecisionByFrameId((currentDecisions) => {
      if (decision === 'pending') {
        const { [frameId]: _removedDecision, ...nextDecisions } = currentDecisions;
        return nextDecisions;
      }
      const nextDecisions = { ...currentDecisions };
      nextDecisions[frameId] = decision;
      return nextDecisions;
    });
    setAcceptedBatchPlanJson(null);
  };

  const handleSetVisibleQcDecision = (decision: NegativeLabQcDecision) => {
    const visibleFrameIds = visibleFrameHealthRows.map((row) => row.frameId);
    if (visibleFrameIds.length === 0) return;

    setQcDecisionByFrameId((currentDecisions) => {
      if (decision === 'pending') {
        const visibleFrameIdSet = new Set(visibleFrameIds);
        return Object.fromEntries(
          Object.entries(currentDecisions).filter(([frameId]) => !visibleFrameIdSet.has(frameId)),
        );
      }
      const nextDecisions = { ...currentDecisions };
      for (const frameId of visibleFrameIds) {
        nextDecisions[frameId] = decision;
      }
      return nextDecisions;
    });
    setAcceptedBatchPlanJson(null);
  };

  const handleToggleQcOverlay = (overlayKey: keyof NegativeLabQcOverlayVisibility) => {
    setQcOverlayVisibility((currentVisibility) => ({
      ...currentVisibility,
      [overlayKey]: !currentVisibility[overlayKey],
    }));
    setAcceptedBatchPlanJson(null);
  };

  const handleSetActiveFrameCropStatus = (cropStatus: NegativeLabFrameCropStatus) => {
    const activeFrameId = frameHealthReport.activeFrameId;
    if (activeFrameId === null) return;
    setCropStatusByFrameId((currentStatuses) => {
      if (cropStatus === 'active_frame_editable') {
        const { [activeFrameId]: _removedStatus, ...nextStatuses } = currentStatuses;
        return nextStatuses;
      }
      return { ...currentStatuses, [activeFrameId]: cropStatus };
    });
    setAcceptedBatchPlanJson(null);
  };

  const handleFrameExposureOffsetChange = (frameId: string, value: number) => {
    const snappedOffset = snapNegativeLabFrameExposureOffset(value);
    const nextOffsets =
      snappedOffset === 0
        ? Object.fromEntries(Object.entries(frameExposureOffsetByFrameId).filter(([key]) => key !== frameId))
        : { ...frameExposureOffsetByFrameId, [frameId]: snappedOffset };
    setFrameExposureOffsetByFrameId(nextOffsets);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(params, frameId, nextOffsets));
  };

  const handleFrameRgbBalanceOffsetChange = (
    frameId: string,
    channel: keyof NegativeLabFrameRgbBalanceOffset,
    value: number,
  ) => {
    const currentOffsets = frameRgbBalanceOffsetByFrameId[frameId] ?? DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET;
    const nextOffset = snapNegativeLabFrameRgbBalanceOffsets({
      baselineParams: params,
      offsets: { ...currentOffsets, [channel]: value },
    });
    const nextOffsetsByFrameId = negativeLabFrameRgbBalanceOffsetIsZero(nextOffset)
      ? Object.fromEntries(Object.entries(frameRgbBalanceOffsetByFrameId).filter(([key]) => key !== frameId))
      : { ...frameRgbBalanceOffsetByFrameId, [frameId]: nextOffset };
    setFrameRgbBalanceOffsetByFrameId(nextOffsetsByFrameId);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(params, frameId, frameExposureOffsetByFrameId, nextOffsetsByFrameId));
  };

  const handleResetFrameRgbBalance = (frameId: string) => {
    const nextOffsetsByFrameId = Object.fromEntries(
      Object.entries(frameRgbBalanceOffsetByFrameId).filter(([key]) => key !== frameId),
    );
    setFrameRgbBalanceOffsetByFrameId(nextOffsetsByFrameId);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(params, frameId, frameExposureOffsetByFrameId, nextOffsetsByFrameId));
  };

  const handleApplyNeutralPatchRgbSuggestion = () => {
    const activeFrameId = frameHealthReport.activeFrameId;
    if (
      activeFrameId === null ||
      neutralPatchSuggestion === null ||
      selectedImagePath === null ||
      !neutralPatchSuggestion.applyAllowed
    )
      return;
    const nextOffset = snapNegativeLabFrameRgbBalanceOffsets({
      baselineParams: params,
      offsets: neutralPatchSuggestion.suggestedRgbBalanceOffset,
    });
    const nextOffsetsByFrameId = negativeLabFrameRgbBalanceOffsetIsZero(nextOffset)
      ? Object.fromEntries(Object.entries(frameRgbBalanceOffsetByFrameId).filter(([key]) => key !== activeFrameId))
      : { ...frameRgbBalanceOffsetByFrameId, [activeFrameId]: nextOffset };
    setFrameRgbBalanceOffsetByFrameId(nextOffsetsByFrameId);
    setPatchSamplerCorrectionPayload((payload) =>
      appendNegativeLabPatchSamplerCorrection(
        payload,
        buildNegativeLabNeutralPatchSamplerCorrection({
          frameId: activeFrameId,
          sourcePath: selectedImagePath,
          suggestion: neutralPatchSuggestion,
        }),
      ),
    );
    setAcceptedBatchPlanJson(null);
    updatePreview(
      buildParamsWithFrameOverrides(params, activeFrameId, frameExposureOffsetByFrameId, nextOffsetsByFrameId),
    );
  };

  const handleApplyHighlightPatchExposureSuggestion = () => {
    const activeFrameId = frameHealthReport.activeFrameId;
    if (
      activeFrameId === null ||
      highlightPatchExposureSuggestion === null ||
      selectedImagePath === null ||
      !highlightPatchExposureSuggestion.applyAllowed
    )
      return;
    setPatchSamplerCorrectionPayload((payload) =>
      appendNegativeLabPatchSamplerCorrection(
        payload,
        buildNegativeLabHighlightPatchSamplerCorrection({
          frameId: activeFrameId,
          sourcePath: selectedImagePath,
          suggestion: highlightPatchExposureSuggestion,
        }),
      ),
    );
    handleFrameExposureOffsetChange(activeFrameId, highlightPatchExposureSuggestion.suggestedFrameExposureOffset);
  };

  const handleApplyShadowPatchBlackPointSuggestion = () => {
    const activeFrameId = frameHealthReport.activeFrameId;
    if (
      activeFrameId === null ||
      selectedImagePath === null ||
      shadowPatchBlackPointSuggestion === null ||
      !shadowPatchBlackPointSuggestion.applyAllowed
    )
      return;
    const nextParams = {
      ...params,
      black_point: Number(
        Math.min(shadowPatchBlackPointSuggestion.projectedBlackPoint, params.white_point - 0.05).toFixed(2),
      ),
    };
    setSelectedPresetId('');
    setParams(nextParams);
    setPatchSamplerCorrectionPayload((payload) =>
      appendNegativeLabPatchSamplerCorrection(
        payload,
        buildNegativeLabShadowPatchSamplerCorrection({
          frameId: activeFrameId,
          sourcePath: selectedImagePath,
          suggestion: shadowPatchBlackPointSuggestion,
        }),
      ),
    );
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(nextParams));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setProgress(null);
    try {
      const acceptedDustHealLayers = Object.values(dustHealLayerByCandidateId);
      const frameIdBySourcePath = new Map(frameHealthReport.frames.map((frame) => [frame.sourcePath, frame.frameId]));
      const acceptedDustHealLayersBySourcePath = Object.fromEntries(
        pathsToConvert
          .map((sourcePath) => {
            const sourceFrameId = frameIdBySourcePath.get(sourcePath);
            if (sourceFrameId === undefined) return null;
            const sourceLayers = acceptedDustHealLayers.filter(
              (layer) => layer.retouchCloneSource?.candidateProvenance?.sourceFrameId === sourceFrameId,
            );
            if (sourceLayers.length === 0) return null;
            const sidecar = buildLayerStackSidecarFromMasks(sourceLayers, {
              graphRevision: `graph_negative_lab_dust_heal_save_${sourceFrameId}`,
              imagePath: sourcePath,
              operationId: `negative_lab_dust_heal_save_${sourceFrameId}`,
              sessionId: 'negative_lab_dust_heal_save_session',
            });
            return [sourcePath, sidecar.layers] as [string, Array<LayerStackSidecarLayerV1>];
          })
          .filter((entry): entry is [string, Array<LayerStackSidecarLayerV1>] => entry !== null),
      );
      const savedPositiveHandoffs = await invokeWithSchema(
        Invokes.ConvertNegatives,
        {
          paths: pathsToConvert,
          params,
          options: {
            ...saveOptions,
            ...(requiresAcceptedBatchPlan ? acceptedBatchPlanIdentity : {}),
            batchDisposition: batchDryRunSummary.dispositionCounts,
            batchScope: conversionScope,
            frameExposureOverrides: frameExposureOverridePayload,
            frameRgbBalanceOverrides: frameRgbBalanceOverridePayload,
            patchSamplerCorrections: patchSamplerCorrectionPayload,
            acceptedDustHealLayersBySourcePath,
            omittedDispositionFrameIds,
            qcApprovedFrameIds: approvedQcFrameIds,
            qcRejectedFrameIds: rejectedQcFrameIds,
            reviewFrameIds: batchDryRunSummary.reviewFrameIds,
            acquisitionSourceFamilies: frameHealthReport.acquisitionHealth.sourceFamilies,
            acquisitionWarningCodes: frameHealthReport.acquisitionHealth.warningCodes,
            selectedAcquisitionProfile,
            ...(selectedProfileProvenanceHash === null ? {} : { profileProvenanceHash: selectedProfileProvenanceHash }),
            ...(selectedProfileSnapshot === null ? {} : { selectedProfile: selectedProfileSnapshot }),
          },
        },
        negativeConversionSavedPositiveHandoffsSchema,
      );
      const savedPaths = savedPositiveHandoffs.map((handoff) => handoff.path);
      const activePositivePath =
        savedPositiveHandoffs.find((handoff) => handoff.sourcePath === activePositiveVariant?.sourcePath)?.path ??
        savedPaths[0] ??
        null;
      const savedBatchApplyReceipt = buildNegativeLabBatchApplyReceipt({
        acceptedPlanIdentity: acceptedBatchPlanIdentity,
        activePositivePath,
        dryRunSummary: batchDryRunSummary,
        openInEditor: openSavedPositiveInEditor,
        qcProofArtifact,
        savedPositiveHandoffs,
      });
      setBatchApplyReceipt(savedBatchApplyReceipt);
      const acceptedDustHealLayersBySavedPath = Object.fromEntries(
        savedPaths
          .map((savedPath, savedPathIndex) => {
            const sourcePath = pathsToConvert[savedPathIndex];
            const sourceFrameId = sourcePath === undefined ? undefined : frameIdBySourcePath.get(sourcePath);
            const sourceLayers =
              sourceFrameId === undefined
                ? []
                : acceptedDustHealLayers.filter(
                    (layer) => layer.retouchCloneSource?.candidateProvenance?.sourceFrameId === sourceFrameId,
                  );
            return sourceLayers.length > 0 ? [savedPath, sourceLayers] : null;
          })
          .filter((entry): entry is [string, typeof acceptedDustHealLayers] => entry !== null),
      );
      onSave(savedPaths, {
        acceptedDustHealLayers,
        acceptedDustHealLayersBySavedPath,
        ...(activePositivePath === null ? {} : { activePositivePath }),
        savedPositiveHandoffs,
        openInEditor: openSavedPositiveInEditor,
      });
      onClose();
    } catch (e) {
      console.error('Failed to batch save negatives', e);
    } finally {
      setIsSaving(false);
      setProgress(null);
    }
  };

  const handleToggleIncludedPath = (path: string) => {
    setIncludedPathSet((currentIncludedPaths) => {
      const nextIncludedPaths = new Set(currentIncludedPaths);
      if (nextIncludedPaths.has(path)) {
        nextIncludedPaths.delete(path);
      } else {
        nextIncludedPaths.add(path);
      }
      return nextIncludedPaths;
    });
  };

  const handleSelectFrameIndex = (frameIndex: number) => {
    if (targetPaths[frameIndex] === undefined) return;
    const nextFrameId = frameHealthReport.frames.find((frame) => frame.pathIndex === frameIndex)?.frameId ?? null;
    setActivePathIndex(frameIndex);
    updatePreview(buildParamsWithFrameOverrides(params, nextFrameId));
    resetViewport();
  };

  const handleStepFrame = (step: -1 | 1) => {
    handleSelectFrameIndex(effectiveActivePathIndex + step);
  };

  const renderRollFrameNavigator = () => {
    const activeFrame = frameHealthReport.frames.find((frame) => frame.active) ?? null;
    const outputFormatLabel = t(
      saveOptions.outputFormat === NegativeLabOutputFormatId.Tiff16
        ? 'modals.negativeConversion.outputFormats.tiff16'
        : 'modals.negativeConversion.outputFormats.jpeg_proof',
    );

    return (
      <div className="absolute bottom-24 left-4 right-4 z-20 pointer-events-none">
        <div
          className="pointer-events-auto rounded-md border border-white/10 bg-black/70 p-2 shadow-xl backdrop-blur-md"
          aria-label={t('modals.negativeConversion.frameHealth')}
          data-active-frame-id={frameHealthReport.activeFrameId ?? ''}
          data-preview-ready={String(previewUrl !== null)}
          data-testid="negative-lab-roll-frame-navigator"
          role="region"
        >
          <div
            className="sr-only"
            data-active-frame-id={frameHealthReport.activeFrameId ?? ''}
            data-frame-count={frameHealthReport.frames.length}
            data-preview-ready={String(previewUrl !== null)}
            data-runtime-status="runtime_state_backed"
            data-testid="negative-lab-roll-frame-navigator-proof"
          />
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-white/75">
            <span className="font-semibold text-white">{t('modals.negativeConversion.frameHealth')}</span>
            <span data-testid="negative-lab-roll-frame-count">
              {t('modals.negativeConversion.frameHealthFrameCount', { frameCount: frameHealthReport.frames.length })}
            </span>
          </div>
          <div
            className="mb-2 grid grid-cols-5 gap-1 text-[11px] text-white/70"
            aria-label={t('modals.negativeConversion.batchReadiness')}
            data-active-frame-id={activeFrame?.frameId ?? ''}
            data-base-scope={baseFogScope}
            data-base-status={activeFrame?.baseStatus ?? 'pending'}
            data-export-ready={String(workspaceProof.exportReady)}
            data-planned-apply-count={batchDryRunSummary.plannedApplyCount}
            data-profile-id={selectedProfile?.presetId ?? 'custom'}
            data-review-frame-count={batchDryRunSummary.reviewFrameIds.length}
            data-testid="negative-lab-roll-queue-summary"
            data-warning-count={activeFrame === null ? 0 : getNegativeLabFrameWarningCount(activeFrame)}
            role="status"
          >
            <span className="truncate rounded bg-white/5 px-2 py-1" data-testid="negative-lab-roll-selected-frame">
              {activeFrame?.scanLabel ?? t('modals.negativeConversion.frameHealth')}
            </span>
            <span className="truncate rounded bg-white/5 px-2 py-1" data-testid="negative-lab-roll-selected-preset">
              {selectedProfile?.displayName ?? t('modals.negativeConversion.workflowCustomPresetDetail')}
            </span>
            <span className="truncate rounded bg-white/5 px-2 py-1" data-testid="negative-lab-roll-selected-base">
              {baseFogConfidence === null
                ? t('modals.negativeConversion.basePending')
                : t(
                    baseFogScope === 'roll'
                      ? 'modals.negativeConversion.baseReadyRoll'
                      : 'modals.negativeConversion.baseReadyFrame',
                    { confidence: Math.round(baseFogConfidence * 100) },
                  )}
            </span>
            <span className="truncate rounded bg-white/5 px-2 py-1" data-testid="negative-lab-roll-selected-export">
              {workspaceProof.exportReady
                ? t('modals.negativeConversion.workflowExportReadyCount', {
                    format: outputFormatLabel,
                    queuedCount: workspaceProof.queuedCount,
                  })
                : t('modals.negativeConversion.workflowExportBlocked')}
            </span>
            <span
              className="truncate rounded bg-white/5 px-2 py-1"
              data-testid="negative-lab-roll-selected-disposition"
            >
              {activeFrame === null
                ? t('modals.negativeConversion.batchDispositionReview')
                : t(BATCH_DISPOSITION_LABEL_KEYS[activeFrame.batchDisposition])}
            </span>
            <span
              className="col-span-5 truncate rounded bg-white/5 px-2 py-1"
              data-testid="negative-lab-roll-selected-warnings"
            >
              {t('modals.negativeConversion.frameHealthWarningCount', {
                warningCount: activeFrame === null ? 0 : getNegativeLabFrameWarningCount(activeFrame),
              })}
            </span>
          </div>
          <div className="flex items-stretch gap-2">
            <button
              aria-label={t('modals.negativeConversion.previousFrameTooltip')}
              className="rounded bg-white/10 px-2 text-white/70 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="negative-lab-roll-frame-prev"
              data-tooltip={t('modals.negativeConversion.previousFrameTooltip')}
              disabled={effectiveActivePathIndex <= 0 || isSaving || isEstimatingBaseFog}
              onClick={() => {
                handleStepFrame(-1);
              }}
              type="button"
            >
              <ChevronLeft size={16} />
            </button>
            <div
              aria-label={t('modals.negativeConversion.frameHealth')}
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
              data-testid="negative-lab-roll-frame-strip"
              role="group"
            >
              {frameHealthReport.frames.map((frame, index) => {
                const framePreviewReady = frame.active && previewUrl !== null;

                return (
                  <button
                    aria-label={`${frame.scanLabel}, ${t(
                      frame.healthStatus === 'skipped'
                        ? 'modals.negativeConversion.frameHealthSkipped'
                        : frame.healthStatus === 'active'
                          ? 'modals.negativeConversion.frameHealthActive'
                          : 'modals.negativeConversion.frameHealthQueued',
                    )}, ${t(BATCH_DISPOSITION_LABEL_KEYS[frame.batchDisposition])}`}
                    aria-current={frame.active ? 'true' : undefined}
                    className={cx(
                      'min-w-32 rounded border px-2 py-1.5 text-left text-xs transition-colors',
                      frame.active
                        ? 'border-accent bg-accent/20 text-white'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                      !frame.included && 'opacity-60',
                    )}
                    data-acquisition-source={frame.acquisitionSourceFamily}
                    data-base-status={frame.baseStatus}
                    data-base-scope={frame.baseScope}
                    data-frame-id={frame.frameId}
                    data-warning-count={getNegativeLabFrameWarningCount(frame)}
                    data-testid={`negative-lab-roll-frame-${index}`}
                    disabled={isSaving || isEstimatingBaseFog}
                    key={frame.frameId}
                    onClick={() => {
                      handleSelectFrameIndex(frame.pathIndex);
                    }}
                    title={frame.sourcePath}
                    type="button"
                  >
                    <span className="block truncate font-medium">{frame.scanLabel}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span
                        className="rounded bg-black/30 px-1.5 py-0.5 text-[11px]"
                        data-testid={`negative-lab-roll-frame-status-${index}`}
                      >
                        {t(
                          frame.healthStatus === 'skipped'
                            ? 'modals.negativeConversion.frameHealthSkipped'
                            : frame.healthStatus === 'active'
                              ? 'modals.negativeConversion.frameHealthActive'
                              : 'modals.negativeConversion.frameHealthQueued',
                        )}
                      </span>
                      <span
                        className="rounded bg-black/30 px-1.5 py-0.5 text-[11px]"
                        data-testid={`negative-lab-roll-frame-source-${index}`}
                      >
                        {t(ACQUISITION_SOURCE_FAMILY_LABEL_KEYS[frame.acquisitionSourceFamily])}
                      </span>
                      {frame.acquisitionWarningCodes.map((warningCode) => (
                        <span
                          className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[11px] text-yellow-100"
                          data-testid={`negative-lab-roll-frame-acquisition-warning-${warningCode}`}
                          key={warningCode}
                        >
                          {t(ACQUISITION_WARNING_LABEL_KEYS[warningCode])}
                        </span>
                      ))}
                      <span
                        className="rounded bg-black/30 px-1.5 py-0.5 text-[11px]"
                        data-disposition={frame.batchDisposition}
                        data-testid={`negative-lab-roll-frame-runtime-${index}`}
                      >
                        {framePreviewReady ? previewReadinessLabel : t('modals.negativeConversion.previewPending')}
                      </span>
                      <span
                        className={cx(
                          'rounded px-1.5 py-0.5 text-[11px]',
                          frame.batchDisposition === 'apply' && 'bg-accent/15 text-white',
                          frame.batchDisposition === 'review' && 'bg-yellow-500/15 text-yellow-100',
                          frame.batchDisposition === 'skip' && 'bg-black/30 text-white/60',
                        )}
                        data-testid={`negative-lab-roll-frame-disposition-${index}`}
                      >
                        {t(BATCH_DISPOSITION_LABEL_KEYS[frame.batchDisposition])}
                      </span>
                      {snapNegativeLabFrameExposureOffset(frameExposureOffsetByFrameId[frame.frameId] ?? 0) !== 0 && (
                        <span
                          className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] text-blue-100"
                          data-testid={`negative-lab-roll-frame-exposure-override-${index}`}
                        >
                          {formatSignedRecipeValue(
                            snapNegativeLabFrameExposureOffset(frameExposureOffsetByFrameId[frame.frameId] ?? 0),
                          )}
                        </span>
                      )}
                      {!negativeLabFrameRgbBalanceOffsetIsZero(
                        snapNegativeLabFrameRgbBalanceOffsets({
                          baselineParams: params,
                          offsets: frameRgbBalanceOffsetByFrameId[frame.frameId],
                        }),
                      ) && (
                        <span
                          className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[11px] text-fuchsia-100"
                          data-testid={`negative-lab-roll-frame-rgb-balance-override-${index}`}
                        >
                          {t('modals.negativeConversion.frameRgbBalanceBadge')}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              aria-label={t('modals.negativeConversion.nextFrameTooltip')}
              className="rounded bg-white/10 px-2 text-white/70 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="negative-lab-roll-frame-next"
              data-tooltip={t('modals.negativeConversion.nextFrameTooltip')}
              disabled={effectiveActivePathIndex >= targetPaths.length - 1 || isSaving || isEstimatingBaseFog}
              onClick={() => {
                handleStepFrame(1);
              }}
              type="button"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderAcquisitionHealth = () => {
    const acquisitionHealth: NegativeLabAcquisitionHealthReport = frameHealthReport.acquisitionHealth;

    return (
      <div
        className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
        aria-label={t('modals.negativeConversion.acquisitionHealth')}
        data-acquisition-severity={acquisitionHealth.severity}
        data-lossy-count={acquisitionHealth.lossyCount}
        data-raw-like-count={acquisitionHealth.rawLikeCount}
        data-tiff-scan-count={acquisitionHealth.tiffScanCount}
        data-unknown-count={acquisitionHealth.unknownCount}
        data-warning-count={acquisitionHealth.warningCodes.length}
        data-warning-codes={acquisitionHealth.warningCodes.join(',')}
        data-testid="negative-lab-acquisition-health"
        role="status"
      >
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.small} className="font-medium text-text-primary">
            {t('modals.negativeConversion.acquisitionHealth')}
          </UiText>
          <span
            className={cx(
              'rounded px-1.5 py-0.5 text-[11px]',
              acquisitionHealth.severity === 'ok' ? 'bg-accent/15 text-text-primary' : 'bg-surface text-text-secondary',
            )}
            data-testid="negative-lab-acquisition-severity"
          >
            {t(
              acquisitionHealth.severity === 'ok'
                ? 'modals.negativeConversion.acquisitionSeverityOk'
                : 'modals.negativeConversion.acquisitionSeverityReview',
            )}
          </span>
        </div>
        <UiText variant={TextVariants.small} className="text-text-tertiary">
          {t('modals.negativeConversion.acquisitionHealthHint')}
        </UiText>
        <UiText variant={TextVariants.small} className="text-text-tertiary">
          {t('modals.negativeConversion.acquisitionHealthLimit')}
        </UiText>
        <div className="flex flex-wrap gap-1 text-[11px] text-text-tertiary">
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-acquisition-total">
            {t('modals.negativeConversion.acquisitionTotal', { totalCount: acquisitionHealth.totalCount })}
          </span>
          {acquisitionHealth.sourceFamilies.map((sourceFamily) => (
            <span
              className="rounded bg-bg-secondary px-1.5 py-0.5"
              data-testid={`negative-lab-acquisition-source-${sourceFamily}`}
              key={sourceFamily}
            >
              {t(ACQUISITION_SOURCE_FAMILY_LABEL_KEYS[sourceFamily])}
            </span>
          ))}
        </div>
        {acquisitionHealth.warningCodes.length > 0 && (
          <div className="flex flex-wrap gap-1 text-[11px] text-text-tertiary">
            {acquisitionHealth.warningCodes.map((warningCode) => (
              <span
                className="rounded bg-bg-secondary px-1.5 py-0.5"
                data-testid={`negative-lab-acquisition-warning-${warningCode}`}
                key={warningCode}
              >
                {t(ACQUISITION_WARNING_LABEL_KEYS[warningCode])}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderScanInputGuidance = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      aria-label={t('modals.negativeConversion.scanInputGuidanceTitle')}
      data-preflight-basis="path_extension_only"
      data-testid="negative-lab-scan-input-guidance"
      role="region"
    >
      <UiText variant={TextVariants.small} className="font-medium text-text-primary">
        {t('modals.negativeConversion.scanInputGuidanceTitle')}
      </UiText>
      <ul className="space-y-1 text-xs text-text-tertiary">
        <li className="flex gap-2" data-testid="negative-lab-scan-input-guidance-scanInputGuidancePreferred">
          <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{t('modals.negativeConversion.scanInputGuidancePreferred')}</span>
        </li>
        <li className="flex gap-2" data-testid="negative-lab-scan-input-guidance-scanInputGuidanceDisableAuto">
          <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{t('modals.negativeConversion.scanInputGuidanceDisableAuto')}</span>
        </li>
        <li className="flex gap-2" data-testid="negative-lab-scan-input-guidance-scanInputGuidancePreserveBorders">
          <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{t('modals.negativeConversion.scanInputGuidancePreserveBorders')}</span>
        </li>
        <li className="flex gap-2" data-testid="negative-lab-scan-input-guidance-scanInputGuidanceAvoidPositive">
          <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{t('modals.negativeConversion.scanInputGuidanceAvoidPositive')}</span>
        </li>
        <li className="flex gap-2" data-testid="negative-lab-scan-input-guidance-scanInputGuidanceAvoidProofs">
          <span aria-hidden="true" className="mt-1 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{t('modals.negativeConversion.scanInputGuidanceAvoidProofs')}</span>
        </li>
      </ul>
      <UiText variant={TextVariants.small} className="text-text-tertiary">
        {t('modals.negativeConversion.scanInputGuidanceLimit')}
      </UiText>
    </div>
  );

  const renderBatchReadiness = () => {
    const printCurveV2Params = params.print_curve_v2 ?? DEFAULT_NEGATIVE_LAB_PRINT_CURVE_V2_PARAMS;
    const isPrintCurveV2 = params.print_curve_algorithm === 'negative_density_print_v2';
    const crosstalkProfile = selectedProfileSnapshot?.crosstalkProfile ?? null;
    const crosstalkState =
      selectedProfile?.filmClass === 'black_and_white_silver'
        ? 'hidden_for_bw'
        : crosstalkProfile === null
          ? 'identity'
          : crosstalkProfile.provenance;
    const autoSuggestionState =
      isBatchPlanAccepted && rollNormalizationPlan.autoDensitySuggestionRun !== null
        ? 'accepted_into_plan'
        : (rollNormalizationPlan.autoDensitySuggestionRun?.state ?? 'suggested_only');

    return (
      <div
        className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
        aria-label={t('modals.negativeConversion.batchReadiness')}
        data-planned-apply-count={batchDryRunSummary.plannedApplyCount}
        data-review-count={dustScratchReviewReport.reviewCount}
        data-roll-normalization-affected-count={rollNormalizationPlan.affectedFrameIds.length}
        data-roll-normalization-suggestion-count={
          rollNormalizationPlan.autoDensitySuggestionRun?.frameSuggestions.length ?? 0
        }
        data-roll-normalization-suggestion-state={
          isBatchPlanAccepted && rollNormalizationPlan.autoDensitySuggestionRun !== null
            ? 'accepted_into_plan'
            : (rollNormalizationPlan.autoDensitySuggestionRun?.state ?? 'suggested_only')
        }
        data-roll-normalization-exposure-delta={rollNormalizationPlan.proposedExposureDeltaEv}
        data-roll-normalization-mode={rollNormalizationPlan.mode}
        data-roll-normalization-positive-count={rollNormalizationPlan.positiveVariantIds.length}
        data-roll-normalization-unaffected-count={rollNormalizationPlan.unaffectedFrameIds.length}
        data-roll-normalization-white-balance-delta={rollNormalizationPlan.proposedWhiteBalanceDelta}
        data-skipped-frame-count={batchDryRunSummary.skippedFrameIds.length}
        data-testid="negative-lab-batch-readiness"
        role="status"
      >
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.small} className="font-medium text-text-primary">
            {t('modals.negativeConversion.batchReadiness')}
          </UiText>
          <UiText data-testid="negative-lab-queued-count" variant={TextVariants.small} className="text-text-tertiary">
            {t('modals.negativeConversion.queuedScans', { queuedCount: pathsToConvert.length })}
          </UiText>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <span
            className="rounded-sm bg-bg-secondary px-2 py-1 text-text-secondary"
            data-testid="negative-lab-preview-status"
          >
            {previewReadinessLabel}
          </span>
          <span
            className="rounded-sm bg-bg-secondary px-2 py-1 text-text-secondary"
            data-testid="negative-lab-base-status"
          >
            {baseFogConfidence === null
              ? t('modals.negativeConversion.basePending')
              : t('modals.negativeConversion.baseReady', { confidence: Math.round(baseFogConfidence * 100) })}
          </span>
          <span
            className="rounded-sm bg-bg-secondary px-2 py-1 text-text-secondary"
            data-testid="negative-lab-included-status"
          >
            {t('modals.negativeConversion.includedScans', { includedCount: includedPathSet.size })}
          </span>
        </div>
        <div
          className="rounded-md border border-surface bg-bg-secondary p-2"
          aria-label={t('modals.negativeConversion.v2QcReadouts')}
          data-algorithm={params.print_curve_algorithm}
          data-auto-suggestion-state={autoSuggestionState}
          data-crosstalk-state={crosstalkState}
          data-density-range-state={baseFogConfidence === null ? 'pending_base' : 'ready'}
          data-preview-export-parity-state={workspaceProof.exportReady ? 'ready_for_receipt' : 'blocked'}
          data-print-curve-v2={String(isPrintCurveV2)}
          data-testid="negative-lab-v2-qc-readouts"
          role="region"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <UiText variant={TextVariants.small} className="font-medium text-text-primary">
              {t('modals.negativeConversion.v2QcReadouts')}
            </UiText>
            <button
              aria-pressed={isPrintCurveV2}
              className={cx(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                isPrintCurveV2
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-surface bg-bg-primary text-text-secondary hover:bg-surface',
              )}
              data-testid="negative-lab-v2-algorithm-toggle"
              onClick={() => {
                handleSetPrintCurveV2Enabled(!isPrintCurveV2);
              }}
              type="button"
            >
              {isPrintCurveV2
                ? t('modals.negativeConversion.v2AlgorithmEnabled')
                : t('modals.negativeConversion.v2AlgorithmDisabled')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
            <span className="rounded bg-bg-primary px-2 py-1" data-testid="negative-lab-v2-crosstalk-status">
              {t('modals.negativeConversion.v2CrosstalkStatus', { state: crosstalkState })}
            </span>
            <span className="rounded bg-bg-primary px-2 py-1" data-testid="negative-lab-v2-auto-suggestion-status">
              {t('modals.negativeConversion.v2AutoSuggestionStatus', { state: autoSuggestionState })}
            </span>
            <span className="rounded bg-bg-primary px-2 py-1" data-testid="negative-lab-v2-density-range-status">
              {t('modals.negativeConversion.v2DensityRangeStatus', {
                confidence: baseFogConfidence === null ? 0 : Math.round(baseFogConfidence * 100),
              })}
            </span>
            <span className="rounded bg-bg-primary px-2 py-1" data-testid="negative-lab-v2-preview-export-status">
              {workspaceProof.exportReady
                ? t('modals.negativeConversion.v2PreviewExportReady')
                : t('modals.negativeConversion.saveBlockedByReason', {
                    reason:
                      saveBlockedReasonKey === null
                        ? t('modals.negativeConversion.v2PreviewExportBlocked')
                        : t(saveBlockedReasonKey),
                  })}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2" data-testid="negative-lab-v2-print-curve-controls">
            <Slider
              defaultValue={1}
              disabled={!isPrintCurveV2 || isSaving}
              fillOrigin="min"
              label={t('modals.negativeConversion.v2ContrastGrade')}
              max={2}
              min={0.5}
              onChange={(event) => {
                handlePrintCurveV2ParamChange('contrast_grade', Number(event.target.value));
              }}
              step={0.05}
              value={printCurveV2Params.contrast_grade}
            />
            <Slider
              defaultValue={0.25}
              disabled={!isPrintCurveV2 || isSaving}
              fillOrigin="min"
              label={t('modals.negativeConversion.v2ToeStrength')}
              max={1}
              min={0}
              onChange={(event) => {
                handlePrintCurveV2ParamChange('toe_strength', Number(event.target.value));
              }}
              step={0.05}
              value={printCurveV2Params.toe_strength}
            />
            <Slider
              defaultValue={0.25}
              disabled={!isPrintCurveV2 || isSaving}
              fillOrigin="min"
              label={t('modals.negativeConversion.v2ShoulderStrength')}
              max={1}
              min={0}
              onChange={(event) => {
                handlePrintCurveV2ParamChange('shoulder_strength', Number(event.target.value));
              }}
              step={0.05}
              value={printCurveV2Params.shoulder_strength}
            />
            <Slider
              defaultValue={0}
              disabled={!isPrintCurveV2 || isSaving}
              label={t('modals.negativeConversion.v2DensityOffset')}
              max={0.5}
              min={-0.5}
              onChange={(event) => {
                handlePrintCurveV2ParamChange('density_offset', Number(event.target.value));
              }}
              step={0.05}
              value={printCurveV2Params.density_offset}
            />
          </div>
        </div>
        <NegativeLabRollHealthPanel
          approvedQcFrameIds={approvedQcFrameIds}
          batchApplyFrameCount={batchApplyFrameCount}
          batchDryRunSummary={batchDryRunSummary}
          batchApplyReceipt={visibleBatchApplyReceipt}
          batchReviewFrameCount={batchReviewFrameCount}
          batchSkippedFrameCount={batchSkippedFrameCount}
          frameExposureOffsetByFrameId={frameExposureOffsetByFrameId}
          frameHealthFilter={frameHealthFilter}
          frameHealthReport={frameHealthReport}
          frameHealthSort={frameHealthSort}
          frameRgbBalanceOffsetByFrameId={frameRgbBalanceOffsetByFrameId}
          handleAcceptBatchPlan={handleAcceptBatchPlan}
          handleApplyBatchPlan={handleApplyBatchPlan}
          handleApplyRollNormalizationPlan={handleApplyRollNormalizationPlan}
          handleCopyBatchPlan={handleCopyBatchPlan}
          handleRestoreRollNormalizationPlan={handleRestoreRollNormalizationPlan}
          handleSetActiveFrameCropStatus={handleSetActiveFrameCropStatus}
          handleSetQcDecision={handleSetQcDecision}
          handleSetVisibleQcDecision={handleSetVisibleQcDecision}
          isBatchPlanAccepted={isBatchPlanAccepted}
          isBatchPlanCopied={isBatchPlanCopied}
          isRollNormalizationPlanAccepted={canApplyRollNormalizationPlan}
          isSaving={isSaving}
          params={params}
          qcDecisionByFrameId={qcDecisionByFrameId}
          rejectedQcFrameIds={rejectedQcFrameIds}
          rollNormalizationApplyReceipt={visibleRollNormalizationApplyReceipt}
          rollNormalizationPlan={rollNormalizationPlan}
          rollNormalizationRestoreReceipt={visibleRollNormalizationRestoreReceipt}
          rollWarningCount={rollWarningCount}
          setFrameHealthFilter={setFrameHealthFilter}
          setFrameHealthSort={setFrameHealthSort}
          t={t}
          visibleFrameHealthRows={visibleFrameHealthRows}
        />
      </div>
    );
  };

  const renderWalkthroughClosure = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      aria-label={t('modals.negativeConversion.walkthroughClosureTitle')}
      data-export-ready={String(workspaceProof.exportReady)}
      data-handoff-ready={String(activePositiveVariant !== null)}
      data-positive-preview-ready={String(positivePreviewReady)}
      data-preview-ready={String(workspaceProof.previewReady)}
      data-profile-ready={String(selectedProfile !== null)}
      data-qc-export-ready={String(qcProofReport.exportReady)}
      data-ready={String(walkthroughClosureReady)}
      data-testid="negative-lab-import-export-walkthrough"
      role="status"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <UiText variant={TextVariants.small} className="font-medium text-text-primary">
            {t('modals.negativeConversion.walkthroughClosureTitle')}
          </UiText>
          <UiText variant={TextVariants.small} className="text-text-tertiary">
            {t('modals.negativeConversion.walkthroughClosureHint')}
          </UiText>
        </div>
        <span
          className={cx(
            'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
            walkthroughClosureReady ? 'bg-accent/15 text-text-primary' : 'bg-bg-secondary text-text-secondary',
          )}
          data-testid="negative-lab-walkthrough-status"
        >
          {walkthroughClosureReady
            ? t('modals.negativeConversion.walkthroughClosureReady')
            : t('modals.negativeConversion.walkthroughClosureReview')}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-text-tertiary">
        {walkthroughClosureRows.map((row) => (
          <span
            className="min-w-0 rounded bg-bg-secondary px-1.5 py-1"
            data-ready={String(row.isReady)}
            data-testid={`negative-lab-walkthrough-${row.id}`}
            key={row.id}
          >
            <span className="block truncate font-medium text-text-secondary">{row.label}</span>
            <span className="block truncate">{row.value}</span>
          </span>
        ))}
      </div>
      <UiText
        variant={TextVariants.small}
        className="text-text-tertiary"
        data-testid="negative-lab-walkthrough-proof-boundary"
      >
        {t('modals.negativeConversion.walkthroughClosureProofBoundary')}
      </UiText>
    </div>
  );

  const renderBaseSamplingCta = () => {
    const blockedReasonLabel = saveBlockedReasonKey === null ? null : t(saveBlockedReasonKey);
    const baseSamplingHint =
      baseFogConfidence === null
        ? t('modals.negativeConversion.baseSamplingCtaEstimateHint')
        : baseSampleStudioDecision === 'accepted'
          ? t('modals.negativeConversion.baseSamplingCtaReadyHint')
          : t('modals.negativeConversion.baseSamplingCtaAcceptHint');

    return (
      <div
        className={cx(
          'space-y-2 rounded-md border p-3',
          canSave ? 'border-accent bg-accent/10' : 'border-surface bg-bg-primary',
        )}
        aria-label={t('modals.negativeConversion.baseSamplingCtaTitle')}
        data-base-ready={String(baseReady)}
        data-can-save={canSave ? 'true' : 'false'}
        data-preview-positive-ready={String(positivePreviewReady)}
        data-sample-decision={baseSampleStudioDecision}
        data-save-blocked-reason={saveBlockedReasonKey ?? ''}
        data-testid="negative-lab-base-sampling-cta"
        role="status"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
              {canSave
                ? t('modals.negativeConversion.baseSamplingCtaReadyTitle')
                : t('modals.negativeConversion.baseSamplingCtaTitle')}
            </UiText>
            <UiText variant={TextVariants.small} className="mt-1 text-text-secondary">
              {baseSamplingHint}
            </UiText>
          </div>
          <span
            className={cx(
              'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
              canSave ? 'bg-accent/15 text-text-primary' : 'bg-bg-primary text-text-secondary',
            )}
            data-testid="negative-lab-base-sampling-cta-status"
          >
            {canSave
              ? t('modals.negativeConversion.baseSamplingCtaReadyTitle')
              : (blockedReasonLabel ?? previewReadinessLabel)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
          <span className="rounded bg-bg-primary px-2 py-1" data-testid="negative-lab-base-sampling-cta-preview">
            {previewReadinessLabel}
          </span>
          <span className="rounded bg-bg-primary px-2 py-1" data-testid="negative-lab-base-sampling-cta-export">
            {canSave
              ? t('modals.negativeConversion.workflowExportReadyCount', {
                  format: t(
                    saveOptions.outputFormat === NegativeLabOutputFormatId.Tiff16
                      ? 'modals.negativeConversion.outputFormats.tiff16'
                      : 'modals.negativeConversion.outputFormats.jpeg_proof',
                  ),
                  queuedCount: workspaceProof.queuedCount,
                })
              : t('modals.negativeConversion.saveBlockedByReason', {
                  reason: blockedReasonLabel ?? t('modals.negativeConversion.workflowExportBlocked'),
                })}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-md border border-accent bg-accent/10 px-2 py-1.5 text-xs text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-base-sampling-primary-action"
            disabled={
              !selectedImagePath ||
              isEstimatingBaseFog ||
              isSaving ||
              (baseReady && baseSampleStudioDecision === 'accepted')
            }
            onClick={() => {
              if (baseFogConfidence === null) {
                void handleAutoBaseFog();
                return;
              }
              handleAcceptBaseSample();
            }}
          >
            {isEstimatingBaseFog ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />}
            {t(baseSamplingActionLabelKey)}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 rounded-md border border-surface bg-bg-primary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-base-sampling-left-edge-action"
            disabled={!selectedImagePath || isEstimatingBaseFog || isSaving}
            onClick={() => {
              void handleSampleBaseFog('modals.negativeConversion.sampleLeftEdge', BASE_FOG_LEFT_EDGE_SAMPLE_RECT);
            }}
          >
            <CheckCircle2 size={13} />
            {t('modals.negativeConversion.sampleLeftEdge')}
          </button>
        </div>
      </div>
    );
  };

  const renderAgentActivityPanel = () => (
    <div
      className="rounded-md border border-surface bg-bg-primary p-2 text-[11px] text-text-tertiary"
      aria-label={t('modals.negativeConversion.agentActivity')}
      data-agent-command-source={agentCommandSource}
      data-agent-commit-state={agentCommitState}
      data-agent-dry-run-state={agentDryRunState}
      data-agent-plan-id={agentPlanId}
      data-agent-proof-hash={agentProofHash}
      data-agent-readonly-mutates="false"
      data-agent-readonly-sequence={NEGATIVE_LAB_AGENT_READ_ONLY_SEQUENCE.join('|')}
      data-agent-rollback-target={agentRollbackTarget}
      data-affected-frame-count={batchDryRunSummary.affectedFrameIds.length}
      data-base-fog-runtime-status={runtimePreviewBaseFogStatus}
      data-density-curve-runtime-status={runtimePreviewDensityStatus}
      data-preview-artifact-status={runtimePreviewArtifactStatus}
      data-runtime-dry-run-command={NEGATIVE_LAB_RUNTIME_PREVIEW_TOOL_NAME}
      data-runtime-dry-run-mode="runtime_preview_non_mutating"
      data-runtime-dry-run-mutates="false"
      data-runtime-preview-plan-hash={agentProofHash}
      data-runtime-preview-rendered={String(previewUrl !== null)}
      data-testid="negative-lab-agent-activity"
      data-warning-count={rollWarningCount}
      role="status"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-text-primary">{t('modals.negativeConversion.agentActivity')}</span>
      </div>
      <div className="truncate" data-testid="negative-lab-agent-command-source">
        {agentCommandSource}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-dry-run-state">
          {t(NEGATIVE_LAB_AGENT_DRY_RUN_LABELS[agentDryRunState])}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-commit-state">
          {t(NEGATIVE_LAB_AGENT_COMMIT_LABELS[agentCommitState])}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-affected-frames">
          {t('modals.negativeConversion.agentAffectedFrames', {
            frameCount: batchDryRunSummary.affectedFrameIds.length,
          })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-warning-count">
          {t('modals.negativeConversion.frameHealthWarningCount', {
            warningCount: rollWarningCount,
          })}
        </span>
        <span
          className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
          data-testid="negative-lab-agent-plan-id"
          title={agentPlanId}
        >
          {t('modals.negativeConversion.agentPlanId', { planId: agentPlanId })}
        </span>
        <span
          className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
          data-testid="negative-lab-agent-proof-hash"
          title={agentProofHash}
        >
          {t('modals.negativeConversion.agentProofHash', { proofHash: agentProofHash })}
        </span>
        <span
          className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
          data-testid="negative-lab-agent-rollback-target"
          title={agentRollbackTarget}
        >
          {t('modals.negativeConversion.agentRollbackTarget', { rollbackTarget: agentRollbackTarget })}
        </span>
        <span
          className="col-span-2 truncate rounded bg-bg-secondary px-1.5 py-0.5"
          data-testid="negative-lab-agent-readonly-sequence"
          title={NEGATIVE_LAB_AGENT_READ_ONLY_SEQUENCE.join(' -> ')}
        >
          {t('modals.negativeConversion.agentReadOnlySequence', {
            sequence: NEGATIVE_LAB_AGENT_READ_ONLY_SEQUENCE.join(' -> '),
          })}
        </span>
        <span
          className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
          data-testid="negative-lab-runtime-dry-run-command"
          title={NEGATIVE_LAB_RUNTIME_PREVIEW_TOOL_NAME}
        >
          {NEGATIVE_LAB_RUNTIME_PREVIEW_TOOL_NAME}
        </span>
        <span
          className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
          data-testid="negative-lab-runtime-preview-status"
          title={runtimePreviewArtifactStatus}
        >
          {runtimePreviewArtifactStatus}
        </span>
      </div>
    </div>
  );

  const renderDustScratchReview = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      aria-label={t('modals.negativeConversion.dustScratchReview')}
      data-testid="negative-lab-dust-review"
      role="region"
    >
      <div className="flex items-center justify-between gap-2">
        <UiText variant={TextVariants.small} className="font-medium text-text-primary">
          {t('modals.negativeConversion.dustScratchReview')}
        </UiText>
        <div className="flex gap-1 text-[11px] text-text-tertiary">
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-review-count">
            {t('modals.negativeConversion.dustReviewCount', { reviewCount: dustScratchReviewReport.reviewCount })}
          </span>
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-retouch-count">
            {t('modals.negativeConversion.dustRetouchCount', { retouchCount: dustScratchReviewReport.retouchCount })}
          </span>
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-dust-heal-layer-count">
            {t('modals.negativeConversion.dustHealLayerCount', { count: dustHealLayerCount })}
          </span>
          <button
            className="rounded border border-yellow-200/40 px-1.5 py-0.5 text-yellow-100 disabled:cursor-not-allowed disabled:opacity-40"
            data-bulk-accept-count={bulkAcceptDustCandidateCount}
            data-testid="negative-lab-accept-all-dust-candidates"
            disabled={bulkAcceptDustCandidateCount === 0}
            onClick={handleAcceptAllDustCandidates}
            type="button"
          >
            {t('modals.negativeConversion.acceptAllDustCandidates', { candidateCount: bulkAcceptDustCandidateCount })}
          </button>
          <button
            className="rounded border border-yellow-200/40 px-1.5 py-0.5 text-yellow-100 disabled:cursor-not-allowed disabled:opacity-40"
            data-clear-accepted-count={dustHealLayerCount}
            data-testid="negative-lab-clear-accepted-dust-candidates"
            disabled={dustHealLayerCount === 0}
            onClick={handleClearAcceptedDustCandidates}
            type="button"
          >
            {t('modals.negativeConversion.clearAcceptedDustCandidates')}
          </button>
        </div>
      </div>
      <UiText variant={TextVariants.small} className="text-text-tertiary">
        {t('modals.negativeConversion.dustScratchReviewHint')}
      </UiText>
      <div
        className="grid grid-cols-2 gap-1 rounded-sm border border-yellow-200/20 bg-bg-secondary px-2 py-1 text-[11px] text-yellow-100 sm:grid-cols-4"
        data-accepted-candidate-count={dustHealCorrectionMetrics.acceptedCandidateCount}
        data-editable-heal-layer-count={dustHealCorrectionMetrics.editableHealLayerCount}
        data-generated-heal-layer-count={dustHealCorrectionMetrics.generatedHealLayerCount}
        data-mean-accepted-confidence={dustHealCorrectionMetrics.meanAcceptedConfidence ?? ''}
        data-pending-candidate-count={dustHealCorrectionMetrics.pendingCandidateCount}
        data-rejected-candidate-count={dustHealCorrectionMetrics.rejectedCandidateCount}
        data-runtime-proof-status={dustHealCorrectionMetrics.runtimeProofStatus}
        data-source-ready-count={dustHealCorrectionMetrics.sourceReadyCount}
        data-testid="negative-lab-dust-heal-correction-metrics"
        data-unresolved-source-count={dustHealCorrectionMetrics.unresolvedSourceCount}
      >
        <span>{t('modals.negativeConversion.dustHealMetricsAccepted', dustHealCorrectionMetrics)}</span>
        <span>{t('modals.negativeConversion.dustHealMetricsRejected', dustHealCorrectionMetrics)}</span>
        <span>{t('modals.negativeConversion.dustHealMetricsEditable', dustHealCorrectionMetrics)}</span>
        <span>{t('modals.negativeConversion.dustHealMetricsSourceReady', dustHealCorrectionMetrics)}</span>
        <span className="col-span-2 text-yellow-100/70 sm:col-span-4">
          {t(`modals.negativeConversion.dustHealRuntimeProofStatus.${dustHealCorrectionMetrics.runtimeProofStatus}`)}
        </span>
      </div>
      <div
        className="flex flex-wrap gap-1 text-[11px]"
        aria-label={t('modals.negativeConversion.dustScratchReview')}
        data-active-filter={dustCandidateFilter}
        data-testid="negative-lab-dust-candidate-filter"
        role="group"
      >
        {NEGATIVE_LAB_DUST_CANDIDATE_FILTERS.map((filter) => (
          <button
            className={cx(
              'rounded border px-1.5 py-0.5 tabular-nums',
              dustCandidateFilter === filter
                ? 'border-yellow-200 bg-yellow-200 text-black'
                : 'border-yellow-200/40 text-yellow-100',
            )}
            data-filter-count={dustCandidateFilterCounts[filter]}
            data-filter-id={filter}
            data-testid={`negative-lab-dust-candidate-filter-${filter}`}
            key={filter}
            onClick={() => {
              setDustCandidateFilter(filter);
            }}
            type="button"
          >
            {t(DUST_CANDIDATE_FILTER_LABEL_KEYS[filter])} {dustCandidateFilterCounts[filter]}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        {visibleDustScratchReviewFrames.map((frame, index) => (
          <div
            className="grid grid-cols-[1fr_auto] gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
            data-visible-candidate-count={frame.candidates.length}
            data-testid={`negative-lab-dust-review-row-${index}`}
            key={frame.frameId}
          >
            <span className="min-w-0 truncate text-text-secondary">{frame.scanLabel}</span>
            <span
              className={cx(
                'rounded px-1.5 py-0.5',
                frame.severity === 'clear' && 'bg-accent/15 text-text-primary',
                frame.severity === 'review' && 'bg-surface text-text-secondary',
                frame.severity === 'retouch' && 'bg-bg-primary text-text-tertiary',
              )}
            >
              {t(DUST_SCRATCH_SEVERITY_LABEL_KEYS[frame.severity])}
            </span>
            <span className="col-span-2 text-[11px] text-text-tertiary">{frame.recommendation}</span>
            {frame.candidates.length > 0 && (
              <div
                className="col-span-2 grid gap-1"
                data-candidate-count={frame.candidates.length}
                data-testid={`negative-lab-dust-candidate-list-${index}`}
              >
                {frame.candidates.map((candidate) => {
                  const candidateDecision = dustCandidateDecisionById[candidate.candidateId] ?? candidate.status;
                  const healLayer = dustHealLayerByCandidateId[candidate.candidateId];
                  const dustHealImageSize = resolveDustHealImageSize(frame.frameId);
                  const canAccept = candidate.kind === 'dust_spot';

                  return (
                    <div
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-1 rounded border border-yellow-300/30 bg-yellow-300/10 px-1.5 py-1 text-[11px] text-yellow-100"
                      data-candidate-confidence={candidate.confidence.toFixed(2)}
                      data-candidate-filter-state={getDustCandidateFilterState(
                        candidate.candidateId,
                        dustCandidateDecisionById,
                      )}
                      data-candidate-kind={candidate.kind}
                      data-candidate-review-decision={candidateDecision}
                      data-candidate-status={candidate.status}
                      data-generated-heal-confidence={
                        healLayer?.retouchCloneSource?.candidateProvenance?.confidence ?? ''
                      }
                      data-generated-heal-image-height={dustHealImageSize.imageHeight}
                      data-generated-heal-image-size-source={dustHealImageSize.source}
                      data-generated-heal-image-width={dustHealImageSize.imageWidth}
                      data-generated-heal-layer-id={healLayer?.id ?? ''}
                      data-generated-heal-radius-px={healLayer?.retouchCloneSource?.radiusPx ?? ''}
                      data-generated-heal-source-x={healLayer?.retouchCloneSource?.sourcePoint.x ?? ''}
                      data-generated-heal-source-y={healLayer?.retouchCloneSource?.sourcePoint.y ?? ''}
                      data-generated-heal-target-x={healLayer?.retouchCloneSource?.targetPoint.x ?? ''}
                      data-generated-heal-target-y={healLayer?.retouchCloneSource?.targetPoint.y ?? ''}
                      data-testid={`negative-lab-dust-candidate-${candidate.candidateId}`}
                      key={candidate.candidateId}
                    >
                      <span className="min-w-0 truncate">
                        {t(DUST_SCRATCH_CANDIDATE_KIND_LABEL_KEYS[candidate.kind])}
                        {' / '}
                        {t(DUST_SCRATCH_CANDIDATE_STATUS_LABEL_KEYS[candidate.status])}
                      </span>
                      <button
                        className="rounded bg-yellow-200 px-1.5 py-0.5 font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
                        data-testid={`negative-lab-accept-dust-candidate-${candidate.candidateId}`}
                        disabled={!canAccept || candidateDecision === 'accepted'}
                        onClick={() => {
                          handleAcceptDustCandidate(frame, candidate);
                        }}
                        type="button"
                      >
                        {t('modals.negativeConversion.acceptDustCandidate')}
                      </button>
                      <button
                        className="rounded border border-yellow-200/40 px-1.5 py-0.5 text-yellow-100 disabled:cursor-not-allowed disabled:opacity-40"
                        data-testid={`negative-lab-reject-dust-candidate-${candidate.candidateId}`}
                        disabled={candidateDecision === 'rejected'}
                        onClick={() => {
                          handleRejectDustCandidate(candidate);
                        }}
                        type="button"
                      >
                        {t('modals.negativeConversion.rejectDustCandidate')}
                      </button>
                      {healLayer?.retouchCloneSource !== undefined && (
                        <span
                          className="col-span-3 truncate tabular-nums text-yellow-100/75"
                          data-testid={`negative-lab-dust-candidate-heal-geometry-${candidate.candidateId}`}
                        >
                          {t('editor.layers.retouchSource.targetX')}/{t('editor.layers.retouchSource.targetY')}
                          {': '}
                          {healLayer.retouchCloneSource.targetPoint.x.toFixed(3)},{' '}
                          {healLayer.retouchCloneSource.targetPoint.y.toFixed(3)}
                          {' | '}
                          {t('editor.layers.retouchSource.sourceX')}/{t('editor.layers.retouchSource.sourceY')}
                          {': '}
                          {healLayer.retouchCloneSource.sourcePoint.x.toFixed(3)},{' '}
                          {healLayer.retouchCloneSource.sourcePoint.y.toFixed(3)}
                          {' | '}
                          {t('editor.layers.retouchSource.radius')} {healLayer.retouchCloneSource.radiusPx?.toFixed(1)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {visibleDustScratchReviewFrames.length === 0 && (
          <div
            className="rounded-sm border border-yellow-200/20 bg-bg-secondary px-2 py-1 text-xs text-text-tertiary"
            data-testid="negative-lab-dust-candidate-filter-empty"
          >
            {t('modals.negativeConversion.dustCandidateFilter.empty')}
          </div>
        )}
      </div>
    </div>
  );

  const renderQcProofReport = () => (
    <NegativeLabQcProofPanel
      onToggleQcOverlay={handleToggleQcOverlay}
      qcDecisionByFrameId={qcDecisionByFrameId}
      qcOverlayVisibility={qcOverlayVisibility}
      qcProofArtifact={qcProofArtifact}
      qcProofReport={qcProofReport}
    />
  );

  const renderPositiveVariantHandoff = () => {
    if (activePositiveVariant === null) return null;

    const handoffReady = buildNegativeLabPositiveHandoffReadiness({
      activePositiveVariant,
      canSave,
      qcExportReady: qcProofReport.exportReady,
    });
    const baseScopeLabelKey =
      baseFogScope === 'roll' ? 'modals.negativeConversion.baseScopeRoll' : 'modals.negativeConversion.baseScopeFrame';
    const selectedProfileId = selectedProfile?.presetId ?? 'custom';
    const provenanceLink = qcProofArtifact.proofId;

    return (
      <div
        className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
        data-base-scope={baseFogScope}
        data-export-ready={handoffReady ? 'true' : 'false'}
        data-accepted-dust-heal-layer-count={dustHealLayerCount}
        data-accepted-dust-heals-open-in-editor={dustHealLayerCount > 0 && openSavedPositiveInEditor ? 'true' : 'false'}
        data-output-format={saveOptions.outputFormat}
        data-open-saved-positive-in-editor={openSavedPositiveInEditor ? 'true' : 'false'}
        data-profile-id={selectedProfileId}
        data-provenance-link={provenanceLink}
        data-source-frame-id={activePositiveVariant.frameId}
        data-testid="negative-lab-positive-handoff"
      >
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.small} className="font-medium text-text-primary">
            {t('modals.negativeConversion.positiveHandoff')}
          </UiText>
          <span
            className={cx(
              'rounded px-1.5 py-0.5 text-[11px]',
              handoffReady ? 'bg-accent/15 text-text-primary' : 'bg-bg-secondary text-text-tertiary',
            )}
            data-testid="negative-lab-positive-handoff-readiness"
          >
            {t(
              handoffReady
                ? 'modals.negativeConversion.positiveHandoffReady'
                : 'modals.negativeConversion.positiveHandoffReview',
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1 text-[11px] text-text-tertiary">
          <span className="truncate rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-positive-frame">
            {t('modals.negativeConversion.positiveHandoffFrame', { frameId: activePositiveVariant.frameId })}
          </span>
          <span
            className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
            data-testid="negative-lab-positive-profile"
            title={selectedProfileId}
          >
            {t('modals.negativeConversion.positiveHandoffProfile', { profileId: selectedProfileId })}
          </span>
          <span className="truncate rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-positive-base">
            {t(baseScopeLabelKey)}
          </span>
          <span className="truncate rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-positive-format">
            {t(`modals.negativeConversion.outputFormats.${saveOptions.outputFormat}`)}
          </span>
          <span
            className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
            data-testid="negative-lab-positive-sidecar"
            title={activePositiveVariant.outputArtifact.artifactId}
          >
            {t('modals.negativeConversion.positiveHandoffSidecar', {
              artifactId: activePositiveVariant.outputArtifact.artifactId,
            })}
          </span>
          <span
            className="truncate rounded bg-bg-secondary px-1.5 py-0.5"
            data-testid="negative-lab-positive-provenance"
            title={provenanceLink}
          >
            {t('modals.negativeConversion.positiveHandoffProvenance', { proofId: provenanceLink })}
          </span>
          <span
            className={cx(
              'truncate rounded px-1.5 py-0.5',
              dustHealLayerCount > 0 && openSavedPositiveInEditor
                ? 'bg-yellow-300/10 text-yellow-100'
                : 'bg-bg-secondary',
            )}
            data-open-in-editor={dustHealLayerCount > 0 && openSavedPositiveInEditor ? 'true' : 'false'}
            data-testid="negative-lab-positive-dust-heal-handoff"
          >
            {t('modals.negativeConversion.dustHealLayerCount', { count: dustHealLayerCount })}
          </span>
          <label className="col-span-2 flex items-center justify-between gap-2 rounded bg-bg-secondary px-1.5 py-0.5">
            <span className="truncate">{t('modals.negativeConversion.positiveHandoffOpenInEditor')}</span>
            <input
              checked={openSavedPositiveInEditor}
              className="h-3 w-3 accent-accent"
              data-testid="negative-lab-positive-open-in-editor"
              onChange={(event) => {
                setOpenSavedPositiveInEditor(event.currentTarget.checked);
              }}
              type="checkbox"
            />
          </label>
        </div>
      </div>
    );
  };

  const renderControls = () => (
    <div className="modal-adjustments-pane w-80 shrink-0 bg-bg-secondary flex flex-col border-l border-surface h-full z-10">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText id="negative-lab-dialog-title" variant={TextVariants.title}>
          {t('modals.negativeConversion.title')}
        </UiText>
        <button
          aria-label={t('modals.negativeConversion.resetTooltip')}
          onClick={() => {
            setParams(DEFAULT_PARAMS);
            setSelectedPresetId(DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId);
            setBaseFogConfidence(null);
            setActiveBaseFogSampleLabel(null);
            setFrameExposureOffsetByFrameId({});
            updatePreview(DEFAULT_PARAMS);
          }}
          disabled={isSaving || isEstimatingBaseFog}
          data-tooltip={t('modals.negativeConversion.resetTooltip')}
          className="p-2 rounded-full hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw size={18} />
        </button>
      </div>

      <div className="grow overflow-y-auto p-4 flex flex-col gap-8">
        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.workflowSetup')}
          </UiText>
          <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
            <UiText variant={TextVariants.small} className="text-text-secondary">
              {targetPaths.length === 1
                ? t('modals.negativeConversion.workflowSetupDetailSingle')
                : t('modals.negativeConversion.workflowSetupDetailMultiple', { scanCount: targetPaths.length })}
            </UiText>
            <div
              aria-label={t('modals.negativeConversion.workflowSetup')}
              className="max-h-44 space-y-1 overflow-y-auto pr-1"
              role="list"
            >
              {targetPaths.map((path, index) => {
                const isActiveScan = index === effectiveActivePathIndex;
                const isIncludedScan = includedPathSet.has(path);
                const scanLabel = getNegativeLabScanLabel(path, index);

                return (
                  <div
                    className={cx(
                      'grid grid-cols-[1fr_auto] gap-2 rounded-md border p-1 text-xs transition-colors',
                      isActiveScan
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    key={`${path}-${index}`}
                    role="listitem"
                  >
                    <button
                      aria-label={`${scanLabel}${isActiveScan ? `, ${t('modals.negativeConversion.frameHealthActive')}` : ''}`}
                      aria-current={isActiveScan ? 'true' : undefined}
                      className="flex min-w-0 items-center justify-between gap-2 rounded px-1.5 py-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`negative-lab-active-scan-${index}`}
                      disabled={isSaving || isEstimatingBaseFog}
                      onClick={() => {
                        setActivePathIndex(index);
                        resetViewport();
                      }}
                      title={path}
                      type="button"
                    >
                      <span className={cx('truncate', !isIncludedScan && 'line-through opacity-60')}>{scanLabel}</span>
                      {isActiveScan && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />}
                    </button>
                    <button
                      aria-label={t(
                        isIncludedScan
                          ? 'modals.negativeConversion.excludeScan'
                          : 'modals.negativeConversion.includeScan',
                      )}
                      className={cx(
                        'rounded px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        isIncludedScan
                          ? 'bg-accent/15 text-text-primary'
                          : 'bg-bg-primary text-text-secondary hover:bg-surface',
                      )}
                      data-included={String(isIncludedScan)}
                      data-testid={`negative-lab-include-toggle-${index}`}
                      disabled={isSaving || isEstimatingBaseFog}
                      onClick={() => {
                        handleToggleIncludedPath(path);
                      }}
                      type="button"
                    >
                      {t(
                        isIncludedScan
                          ? 'modals.negativeConversion.excludeScan'
                          : 'modals.negativeConversion.includeScan',
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            <label className="block space-y-1">
              <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
                {t('modals.negativeConversion.acquisitionProfile')}
              </UiText>
              <select
                aria-label={t('modals.negativeConversion.acquisitionProfile')}
                className="w-full rounded-md border border-surface bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                data-channel-basis={selectedAcquisitionProfile.channelBasis}
                data-input-transform={selectedAcquisitionProfile.inputTransform}
                data-testid="negative-lab-acquisition-profile"
                onChange={(event) => {
                  setSelectedAcquisitionProfileId(
                    negativeLabAcquisitionProfileIdSchema.parse(event.currentTarget.value),
                  );
                  setAcceptedBatchPlanJson(null);
                }}
                value={selectedAcquisitionProfileId}
              >
                {NEGATIVE_LAB_ACQUISITION_PROFILES.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.displayName}
                  </option>
                ))}
              </select>
              <UiText
                variant={TextVariants.small}
                className="text-text-tertiary"
                data-testid="negative-lab-acquisition-profile-summary"
              >
                {selectedAcquisitionProfile.provenanceSummary}
              </UiText>
            </label>
            {hasMultipleScans && (
              <div
                aria-label={t('modals.negativeConversion.exportOptions')}
                className="grid grid-cols-3 gap-2"
                data-testid="negative-lab-conversion-scope"
                role="group"
              >
                {(['all', 'ready', 'active'] satisfies Array<NegativeConversionScope>).map((scope) => (
                  <button
                    aria-pressed={conversionScope === scope}
                    className={cx(
                      'rounded-md border px-2 py-1.5 text-xs transition-colors',
                      conversionScope === scope
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    data-testid={CONVERSION_SCOPE_TEST_IDS[scope]}
                    key={scope}
                    onClick={() => {
                      setConversionScope(scope);
                    }}
                    type="button"
                  >
                    {t(CONVERSION_SCOPE_LABEL_KEYS[scope])}
                  </button>
                ))}
              </div>
            )}
            {renderAcquisitionHealth()}
            {renderScanInputGuidance()}
            {renderBatchReadiness()}
            {renderBaseSamplingCta()}
            {renderWalkthroughClosure()}
            {renderAgentActivityPanel()}
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.genericPresets')}
          </UiText>
          <div
            className="mb-3 rounded-md border border-surface bg-bg-primary p-3"
            data-testid="negative-lab-stock-registry"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
                  {t('modals.negativeConversion.stockRegistry')}
                </UiText>
                <UiText variant={TextVariants.small} className="text-text-tertiary">
                  {t('modals.negativeConversion.stockRegistrySummary', {
                    referenceOnlyCount: NEGATIVE_LAB_STOCK_REGISTRY_COUNTS.referenceOnlyCount,
                    runtimeSafeCount: NEGATIVE_LAB_STOCK_REGISTRY_COUNTS.runtimeSafeCount,
                  })}
                </UiText>
              </div>
              <span className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary">
                {t('modals.negativeConversion.stockRegistryVersion', {
                  version: NEGATIVE_LAB_STOCK_REGISTRY.registryVersion,
                })}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {NEGATIVE_LAB_STOCK_REGISTRY.entries.map((entry) => {
                const isActiveFamily = entry.genericPresetId !== null && entry.genericPresetId === selectedPresetId;
                const mappedProfile =
                  entry.genericPresetId === null
                    ? null
                    : NEGATIVE_LAB_PROFILE_BROWSER_ROW_BY_ID.get(entry.genericPresetId);
                const isSelectableFamily = mappedProfile?.isSelectable === true;

                return (
                  <button
                    aria-current={isActiveFamily ? 'true' : undefined}
                    aria-label={`${entry.stockFamilyDescriptor}, ${t(
                      NEGATIVE_LAB_STOCK_PROFILE_STATUS_LABEL_KEYS[entry.profileStatus],
                    )}`}
                    className={cx(
                      'rounded-md border p-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      isActiveFamily
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary',
                      isSelectableFamily && !isActiveFamily && 'hover:bg-surface',
                    )}
                    data-testid={`negative-lab-stock-family-${entry.registryId}`}
                    data-profile-status={entry.profileStatus}
                    data-provenance-source={entry.provenance.measurementSource}
                    disabled={!isSelectableFamily}
                    key={entry.registryId}
                    onClick={() => {
                      if (mappedProfile !== null && mappedProfile !== undefined) {
                        handlePresetSelect(mappedProfile);
                      }
                    }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-text-primary">{entry.stockFamilyDescriptor}</span>
                      <span
                        className="shrink-0 rounded bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-tertiary"
                        data-testid="negative-lab-stock-profile-status"
                      >
                        {t(NEGATIVE_LAB_STOCK_PROFILE_STATUS_LABEL_KEYS[entry.profileStatus])}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-text-tertiary">
                      <span>{formatStockRegistryToken(entry.claimTier)}</span>
                      <span>{formatStockRegistryToken(entry.processFamily)}</span>
                      <span>{formatStockRegistryToken(entry.legalNamingStatus)}</span>
                      <span>{formatStockRegistryToken(entry.fixtureStatus)}</span>
                    </div>
                    <UiText variant={TextVariants.small} className="mt-1 text-text-tertiary">
                      {entry.provenance.legalNote}
                    </UiText>
                  </button>
                );
              })}
            </div>
          </div>
          <div
            className="mb-3 rounded-md border border-surface bg-bg-primary p-3"
            data-testid="negative-lab-stock-metadata"
          >
            <div className="mb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
                    {t('modals.negativeConversion.stockMetadata')}
                  </UiText>
                  <UiText variant={TextVariants.small} className="text-text-tertiary">
                    {t('modals.negativeConversion.stockMetadataSummary', {
                      blackAndWhiteCount: NEGATIVE_LAB_STOCK_METADATA_COUNTS.blackAndWhiteNegativeCount,
                      cinemaCount: NEGATIVE_LAB_STOCK_METADATA_COUNTS.cinemaNegativeCount,
                      colorCount: NEGATIVE_LAB_STOCK_METADATA_COUNTS.colorNegativeCount,
                      slideCount: NEGATIVE_LAB_STOCK_METADATA_COUNTS.slideReversalCount,
                    })}
                  </UiText>
                </div>
                <span className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary">
                  {t('modals.negativeConversion.stockRegistryVersion', {
                    version: NEGATIVE_LAB_STOCK_METADATA_CATALOG.version,
                  })}
                </span>
              </div>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1" data-testid="negative-lab-stock-metadata-list">
              {NEGATIVE_LAB_STOCK_METADATA_CATALOG.entries.map((entry) => {
                const mappedProfile =
                  entry.suggestedGenericPresetId === null
                    ? null
                    : NEGATIVE_LAB_PROFILE_BROWSER_ROW_BY_ID.get(entry.suggestedGenericPresetId);
                const isSuggestedProfileSelectable = mappedProfile?.isSelectable === true;

                return (
                  <div
                    className="rounded-md border border-surface bg-bg-secondary p-2 text-xs"
                    data-runtime-status={entry.runtimeStatus}
                    data-testid={`negative-lab-stock-metadata-entry-${entry.entryId}`}
                    key={entry.entryId}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <UiText variant={TextVariants.small} className="truncate font-medium text-text-primary">
                          {entry.displayName}
                        </UiText>
                        <UiText variant={TextVariants.small} className="text-text-tertiary">
                          {entry.stockFamilyDescriptor}
                        </UiText>
                      </div>
                      <span className="shrink-0 rounded bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                        {formatStockMetadataIso(entry.nominalIso)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-text-tertiary">
                      <span>{formatStockRegistryToken(entry.stockClass)}</span>
                      <span>{formatStockRegistryToken(entry.processFamily)}</span>
                      <span>{t('modals.negativeConversion.stockMetadataOnly')}</span>
                    </div>
                    <UiText variant={TextVariants.small} className="mt-1 text-text-tertiary">
                      {entry.colorResponseNotes}
                    </UiText>
                    <button
                      className="mt-2 w-full rounded border border-surface bg-bg-primary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`negative-lab-stock-metadata-suggested-preset-${entry.entryId}`}
                      disabled={!isSuggestedProfileSelectable}
                      onClick={() => {
                        if (mappedProfile !== null && mappedProfile !== undefined) {
                          handlePresetSelect(mappedProfile);
                        }
                      }}
                      type="button"
                    >
                      {isSuggestedProfileSelectable
                        ? t('modals.negativeConversion.stockMetadataUseSuggestedPreset', {
                            presetName: mappedProfile.displayName,
                          })
                        : t('modals.negativeConversion.stockMetadataNoRuntimePreset')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="mb-3 rounded-md border border-surface bg-bg-primary p-3"
            data-testid="negative-lab-stock-metadata-policy"
          >
            <div>
              <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
                {t('modals.negativeConversion.stockMetadataPolicy')}
              </UiText>
              <UiText variant={TextVariants.small} className="text-text-tertiary">
                {t('modals.negativeConversion.stockMetadataPolicyDetail')}
              </UiText>
            </div>
          </div>
          <NegativeLabProfileComparisonGrid
            browsedProfileId={browsedComparisonProfileId}
            onBrowseProfile={setBrowsedComparisonProfileId}
            onUseProfile={handlePresetSelect}
            renderedPreviewByProfileId={renderedProfileCandidatePreviewById}
            rows={profileComparisonRows}
            selectedPresetId={selectedPresetId}
            selectedProfileProvenanceHash={selectedProfileProvenanceHash}
            totalProfileCount={NEGATIVE_LAB_PROFILE_BROWSER_ROWS.length}
          />
          <div className="relative mb-3">
            <input
              aria-label={t('modals.negativeConversion.profileSearch')}
              className="w-full rounded-md border border-surface bg-bg-primary px-3 py-2 pr-10 text-sm text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent"
              data-testid="negative-lab-profile-search"
              onChange={(event) => {
                setProfileSearchQuery(event.currentTarget.value);
              }}
              placeholder={t('modals.negativeConversion.profileSearch')}
              type="search"
              value={profileSearchQuery}
            />
            <button
              aria-label={t('modals.negativeConversion.profileSearchClear')}
              className="absolute right-1 top-1 h-8 w-8 rounded text-text-secondary transition-colors hover:bg-surface hover:text-text-primary disabled:pointer-events-none disabled:opacity-0"
              data-testid="negative-lab-profile-search-clear"
              data-tooltip={t('modals.negativeConversion.profileSearchClear')}
              disabled={profileSearchQuery.length === 0}
              onClick={() => {
                setProfileSearchQuery('');
              }}
              type="button"
            >
              <X aria-hidden="true" className="mx-auto" size={14} />
            </button>
          </div>
          <label className="mb-3 block space-y-1">
            <UiText variant={TextVariants.small} className="uppercase tracking-normal text-text-secondary">
              {t('modals.negativeConversion.profileSort')}
            </UiText>
            <select
              aria-label={t('modals.negativeConversion.profileSort')}
              className="w-full rounded-md border border-surface bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              data-testid="negative-lab-profile-sort"
              onChange={(event) => {
                const nextSort = event.currentTarget.value;
                if (isNegativeLabProfileSort(nextSort)) {
                  setProfileSort(nextSort);
                }
              }}
              value={profileSort}
            >
              {NEGATIVE_LAB_PROFILE_SORTS.map((sort) => (
                <option data-testid={NEGATIVE_LAB_PROFILE_SORT_TEST_IDS[sort.id]} key={sort.id} value={sort.id}>
                  {t(sort.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <div
            className="mb-3 flex gap-2 overflow-x-auto pb-1"
            aria-label={t('modals.negativeConversion.profileSearch')}
            data-testid="negative-lab-profile-filter-tabs"
            role="tablist"
          >
            {NEGATIVE_LAB_PROFILE_FILTERS.map((filter) => {
              const isActive = profileFilter === filter.id;

              return (
                <button
                  aria-pressed={isActive}
                  aria-selected={isActive}
                  className={cx(
                    'shrink-0 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                    isActive
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-surface bg-bg-primary text-text-secondary hover:bg-surface',
                  )}
                  data-testid={NEGATIVE_LAB_PROFILE_FILTER_TEST_IDS[filter.id]}
                  key={filter.id}
                  onClick={() => {
                    setProfileFilter(filter.id);
                  }}
                  type="button"
                  role="tab"
                >
                  <span className="block font-medium">{t(filter.labelKey)}</span>
                  <span className="block tabular-nums opacity-70">{profileFilterCounts[filter.id]}</span>
                </button>
              );
            })}
          </div>
          <UiText
            variant={TextVariants.small}
            className="mb-3 block tabular-nums text-text-tertiary"
            data-testid="negative-lab-profile-result-count"
          >
            {t('modals.negativeConversion.profileResultCount', {
              totalCount: NEGATIVE_LAB_PROFILE_BROWSER_ROWS.length,
              visibleCount: visibleProfileRows.length,
            })}
          </UiText>
          {visibleProfileRows.length === 0 && (
            <div
              className="rounded-md border border-dashed border-surface bg-bg-primary p-3 text-center"
              data-testid="negative-lab-profile-search-empty"
            >
              <UiText variant={TextVariants.small} className="text-text-secondary">
                {t('modals.negativeConversion.profileSearchEmpty')}
              </UiText>
            </div>
          )}
          <div
            aria-label={t('modals.negativeConversion.genericPresets')}
            className="grid grid-cols-1 gap-2"
            role="group"
          >
            {visibleProfileRows.map((preset) => {
              const isSelected = selectedPresetId === preset.presetId;

              return (
                <button
                  aria-label={`${preset.displayName}, ${
                    preset.runtimeStatus === 'runtime_parameter_applied'
                      ? t('modals.negativeConversion.presetRuntimeApplied')
                      : t('modals.negativeConversion.presetRuntimeCatalogOnly')
                  }`}
                  aria-current={isSelected ? 'true' : undefined}
                  key={preset.presetId}
                  type="button"
                  onClick={() => {
                    handlePresetSelect(preset);
                  }}
                  disabled={!preset.isSelectable}
                  data-testid={`negative-lab-profile-row-${preset.presetId}`}
                  className={cx(
                    'text-left rounded-md border p-3 transition-colors disabled:cursor-not-allowed disabled:opacity-55',
                    isSelected
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-surface bg-bg-primary hover:bg-surface text-text-secondary',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{preset.displayName}</span>
                    {preset.profileStatus === 'fixture_measured' && (
                      <span
                        className="shrink-0 rounded border border-surface bg-bg-secondary px-2 py-0.5 text-[10px] text-text-tertiary"
                        data-testid="negative-lab-profile-measured-badge"
                      >
                        {t('modals.negativeConversion.profileMeasuredBadge')}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-text-tertiary">
                    <span data-testid="negative-lab-profile-runtime-status">
                      {preset.runtimeStatus === 'runtime_parameter_applied'
                        ? t('modals.negativeConversion.presetRuntimeApplied')
                        : t('modals.negativeConversion.presetRuntimeCatalogOnly')}
                    </span>
                    <span data-testid="negative-lab-profile-evidence-count">
                      {t('modals.negativeConversion.profileEvidenceCount', {
                        fixtureCount: preset.evidenceFixtureCount,
                      })}
                    </span>
                    {preset.disabledReason !== null && (
                      <span data-testid="negative-lab-profile-disabled-reason">
                        {t(`modals.negativeConversion.profileDisabledReasons.${preset.disabledReason}`)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedProfile !== null && (
            <div
              className="mt-3 rounded-md border border-surface bg-bg-primary p-3"
              data-testid="negative-lab-preset-inspector"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
                    {selectedProfile.displayName}
                  </UiText>
                  <UiText
                    data-testid="negative-lab-preset-process"
                    variant={TextVariants.small}
                    className="text-text-tertiary"
                  >
                    {selectedPreset === null
                      ? formatStockRegistryToken(selectedProfile.processFamily)
                      : `${selectedPreset.processHint} / ${selectedPreset.stockFamilyDescriptor}`}
                  </UiText>
                </div>
                <span
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
                  data-testid="negative-lab-preset-film-class"
                >
                  {selectedPresetFilmClass}
                </span>
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                <span
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
                  data-testid="negative-lab-preset-claim-level"
                >
                  {selectedPresetClaimLabel}
                </span>
                <span
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
                  data-testid="negative-lab-preset-runtime-status"
                >
                  {selectedPresetRuntimeLabel}
                </span>
              </div>
              <div
                className="mb-2 grid grid-cols-3 gap-2 rounded-md border border-surface bg-bg-secondary p-2 text-[11px]"
                data-export-ready={String(workspaceProof.exportReady)}
                data-positive-preview-ready={String(positivePreviewReady)}
                data-preview-ready={String(workspaceProof.previewReady)}
                data-profile-status={selectedProfile.profileStatus}
                data-runtime-status={selectedProfile.runtimeStatus}
                data-testid="negative-lab-selected-stock-readiness"
              >
                <div
                  className="min-w-0 rounded bg-bg-primary px-2 py-1"
                  data-testid="negative-lab-stock-readiness-profile"
                >
                  <span className="block truncate text-text-tertiary">
                    {t('modals.negativeConversion.workflowPreset')}
                  </span>
                  <span className="block truncate text-text-secondary">{selectedPresetClaimLabel}</span>
                </div>
                <div
                  className="min-w-0 rounded bg-bg-primary px-2 py-1"
                  data-testid="negative-lab-stock-readiness-preview"
                >
                  <span className="block truncate text-text-tertiary">
                    {t('modals.negativeConversion.workflowColorTiming')}
                  </span>
                  <span className="block truncate text-text-secondary">{previewReadinessLabel}</span>
                </div>
                <div
                  className="min-w-0 rounded bg-bg-primary px-2 py-1"
                  data-testid="negative-lab-stock-readiness-export"
                >
                  <span className="block truncate text-text-tertiary">
                    {t('modals.negativeConversion.workflowExport')}
                  </span>
                  <span className="block truncate text-text-secondary">
                    {workspaceProof.exportReady
                      ? t('modals.negativeConversion.presetRuntimeApplied')
                      : t('modals.negativeConversion.workflowExportBlocked')}
                  </span>
                </div>
              </div>
              <div
                className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-[11px] text-text-tertiary"
                data-testid="negative-lab-preset-metadata"
              >
                <span>{t('modals.negativeConversion.presetSpeedClass')}</span>
                <span className="text-right text-text-secondary" data-testid="negative-lab-preset-speed-class">
                  {selectedPreset?.nominalSpeedClass ?? t('modals.negativeConversion.profileMeasuredBadge')}
                </span>
                <span>{t('modals.negativeConversion.presetContrastCurve')}</span>
                <span className="text-right text-text-secondary" data-testid="negative-lab-preset-contrast-curve">
                  {selectedPreset?.contrastCurveDescriptor ??
                    t('modals.negativeConversion.profileEvidenceCount', {
                      fixtureCount: selectedProfile.evidenceFixtureCount,
                    })}
                </span>
                <span>{t('modals.negativeConversion.presetGrainModel')}</span>
                <span className="text-right text-text-secondary" data-testid="negative-lab-preset-grain-model">
                  {selectedPreset?.grainModelDescriptor ??
                    selectedProfile.measurementProfileId ??
                    t('modals.negativeConversion.presetRuntimeCatalogOnly')}
                </span>
              </div>
              <div
                className="mb-2 rounded-md border border-surface bg-bg-secondary p-2 text-[11px]"
                data-reference-count={selectedProfileStockReferences.length}
                data-testid="negative-lab-selected-stock-references"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium text-text-secondary">
                    {t('modals.negativeConversion.stockReferenceCoverage')}
                  </span>
                  <span
                    className="rounded bg-bg-primary px-1.5 py-0.5 text-[10px] tabular-nums text-text-tertiary"
                    data-testid="negative-lab-selected-stock-reference-count"
                  >
                    {selectedProfileStockReferences.length}
                  </span>
                </div>
                <UiText variant={TextVariants.small} className="text-text-tertiary">
                  {selectedProfileStockReferences.length > 0
                    ? t('modals.negativeConversion.stockReferenceCoverageSummary', {
                        referenceCount: selectedProfileStockReferences.length,
                      })
                    : t('modals.negativeConversion.stockReferenceCoverageEmpty')}
                </UiText>
                {selectedProfileStockReferences.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="negative-lab-selected-stock-reference-list">
                    {selectedProfileStockReferences.map((entry) => (
                      <span
                        className="rounded border border-surface bg-bg-primary px-2 py-1 text-[10px] text-text-secondary"
                        data-testid={`negative-lab-selected-stock-reference-${entry.entryId}`}
                        key={entry.entryId}
                      >
                        {entry.displayName} - {formatStockMetadataIso(entry.nominalIso)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {selectedPreset !== null && (
                <UiText
                  data-testid="negative-lab-preset-intent"
                  variant={TextVariants.small}
                  className="text-text-secondary"
                >
                  {selectedPreset.intent}
                </UiText>
              )}
              <UiText
                data-testid="negative-lab-preset-color-response"
                variant={TextVariants.small}
                className="mt-1 text-text-tertiary"
              >
                {t('modals.negativeConversion.presetColorResponse')}:{' '}
                {selectedPreset?.colorResponseNotes ?? selectedProfile.provenanceSummary}
              </UiText>
              <UiText
                data-testid="negative-lab-preset-claim-policy"
                variant={TextVariants.small}
                className="mt-2 text-text-tertiary"
              >
                {selectedPreset?.legalNote ?? t('modals.negativeConversion.profileMeasuredClaimPolicy')}
              </UiText>
              <UiText
                data-testid="negative-lab-preset-provenance"
                variant={TextVariants.small}
                className="mt-1 text-text-tertiary"
              >
                {selectedProfile.provenanceSummary}
              </UiText>
              <UiText
                data-testid="negative-lab-profile-non-claims"
                variant={TextVariants.small}
                className="mt-1 text-text-tertiary"
              >
                {selectedProfile.doesNotProve.join(', ')}
              </UiText>
            </div>
          )}
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <UiText variant={TextVariants.heading}>{t('modals.negativeConversion.colorTiming')}</UiText>
            <button
              type="button"
              onClick={() => {
                void handleAutoBaseFog();
              }}
              disabled={!selectedImagePath || isEstimatingBaseFog || isSaving}
              data-testid="negative-lab-auto-base-fog"
              data-tooltip={t('modals.negativeConversion.autoBaseFogTooltip')}
              className="inline-flex items-center gap-1 rounded-md border border-surface bg-bg-primary px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEstimatingBaseFog ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />}
              {t('modals.negativeConversion.autoBaseFog')}
            </button>
          </div>
          <div className="space-y-3">
            <div
              className="grid grid-cols-2 gap-2 rounded-md border border-surface bg-bg-primary p-2 text-[11px] text-text-tertiary"
              data-testid="negative-lab-recipe-summary"
            >
              <span className="col-span-2 font-semibold text-text-secondary">
                {t('modals.negativeConversion.colorTiming')}
              </span>
              <span>{t('modals.negativeConversion.baseFogStrength')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-base">
                {formatPercentValue(params.base_fog_strength * 100)}
              </span>
              <span>{t('modals.negativeConversion.redWeight')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-red">
                {params.red_weight.toFixed(2)}
              </span>
              <span>{t('modals.negativeConversion.greenWeight')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-green">
                {params.green_weight.toFixed(2)}
              </span>
              <span>{t('modals.negativeConversion.blueWeight')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-blue">
                {params.blue_weight.toFixed(2)}
              </span>
              <span>{t('modals.negativeConversion.exposure')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-exposure">
                {formatSignedRecipeValue(params.exposure)}
              </span>
              <span>{t('modals.negativeConversion.frameExposureOffset')}</span>
              <span
                className="text-right tabular-nums text-text-secondary"
                data-effective-exposure={effectiveActiveExposure}
                data-testid="negative-lab-recipe-frame-exposure-offset"
              >
                {formatSignedRecipeValue(activeFrameExposureOffset)}
              </span>
              <span>{t('modals.negativeConversion.frameRgbBalanceOffset')}</span>
              <span
                className="text-right tabular-nums text-text-secondary"
                data-effective-blue-weight={effectiveActiveFrameRgbBalance.blueWeight}
                data-effective-green-weight={effectiveActiveFrameRgbBalance.greenWeight}
                data-effective-red-weight={effectiveActiveFrameRgbBalance.redWeight}
                data-testid="negative-lab-recipe-frame-rgb-balance-offset"
              >
                {t('modals.negativeConversion.effectiveFrameRgbBalance', {
                  blue: formatSignedRecipeValue(activeFrameRgbBalanceOffset.blueWeight),
                  green: formatSignedRecipeValue(activeFrameRgbBalanceOffset.greenWeight),
                  red: formatSignedRecipeValue(activeFrameRgbBalanceOffset.redWeight),
                })}
              </span>
              <span>{t('modals.negativeConversion.contrast')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-contrast">
                {params.contrast.toFixed(2)}
              </span>
              <span>{t('modals.negativeConversion.blackPoint')}</span>
              <span
                className="text-right tabular-nums text-text-secondary"
                data-testid="negative-lab-recipe-black-point"
              >
                {params.black_point.toFixed(2)}
              </span>
              <span>{t('modals.negativeConversion.whitePoint')}</span>
              <span
                className="text-right tabular-nums text-text-secondary"
                data-testid="negative-lab-recipe-white-point"
              >
                {params.white_point.toFixed(2)}
              </span>
            </div>
            <Slider
              label={t('modals.negativeConversion.baseFogStrength')}
              value={params.base_fog_strength}
              min={0}
              max={1.25}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('base_fog_strength', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <div
              aria-label={t('modals.negativeConversion.baseFogSample')}
              className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
              role="group"
            >
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.baseFogSample')}
                </UiText>
                {activeBaseFogSampleLabel !== null && (
                  <UiText variant={TextVariants.small} className="truncate text-text-tertiary">
                    {activeBaseFogSampleLabel}
                  </UiText>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BASE_FOG_SAMPLE_PRESETS.map((samplePreset) => (
                  <button
                    key={samplePreset.labelKey}
                    type="button"
                    data-testid={
                      samplePreset.labelKey === 'modals.negativeConversion.sampleLeftEdge'
                        ? 'negative-lab-sample-left-edge'
                        : 'negative-lab-sample-center-patch'
                    }
                    onClick={() => {
                      void handleSampleBaseFog(samplePreset.labelKey, samplePreset.rect);
                    }}
                    disabled={!selectedImagePath || isEstimatingBaseFog || isSaving}
                    className="rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t(samplePreset.labelKey)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                data-testid="negative-lab-undo-base-sample"
                data-tooltip={t('contextMenus.editor.undo')}
                disabled={baseFogSampleUndoStack.length === 0 || isEstimatingBaseFog || isSaving}
                onClick={handleUndoBaseFogSample}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={13} />
                {t('contextMenus.editor.undo')}
              </button>
            </div>
            <div
              className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
              aria-label={t('modals.negativeConversion.baseSamplingStudio')}
              data-decision={baseSampleStudioDecision}
              data-testid="negative-lab-base-sampling-studio"
              role="group"
            >
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.baseSamplingStudio')}
                </UiText>
                <span className="rounded border border-surface bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-tertiary">
                  {t(BASE_SAMPLE_DECISION_LABEL_KEYS[baseSampleStudioDecision])}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-text-tertiary">
                <span>{t('modals.negativeConversion.baseSampleActive')}</span>
                <span className="truncate text-right" data-testid="negative-lab-base-sample-active-label">
                  {activeBaseFogSampleLabel ?? rejectedBaseSampleLabel ?? t('modals.negativeConversion.basePending')}
                </span>
                <span>{t('modals.negativeConversion.baseSampleWarnings')}</span>
                <span className="text-right" data-testid="negative-lab-base-sample-warning-count">
                  {activeBaseSampleWarningCodes.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1" data-testid="negative-lab-base-sample-warning-list">
                {activeBaseSampleWarningCodes.length === 0 ? (
                  <span className="rounded border border-surface bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-tertiary">
                    {t('modals.negativeConversion.baseSampleNoWarnings')}
                  </span>
                ) : (
                  activeBaseSampleWarningCodes.map((warningCode) => (
                    <span
                      key={warningCode}
                      className="rounded border border-yellow-300/40 bg-yellow-300/10 px-1.5 py-0.5 text-[11px] text-yellow-100"
                      data-testid={`negative-lab-base-sample-warning-${warningCode}`}
                    >
                      {t(BASE_SAMPLE_WARNING_LABEL_KEYS[warningCode])}
                    </span>
                  ))
                )}
              </div>
              {baseSampleStudioComparison !== null && (
                <div
                  className="grid grid-cols-2 gap-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
                  data-confidence-delta={baseSampleStudioComparison.confidenceDelta.toFixed(3)}
                  data-density-delta={baseSampleStudioComparison.densityDelta.toFixed(3)}
                  data-rgb-delta={baseSampleStudioComparison.rgbDelta.toFixed(3)}
                  data-testid="negative-lab-base-sample-comparison"
                >
                  <span>{t('modals.negativeConversion.baseSampleDensityDelta')}</span>
                  <span className="text-right tabular-nums">
                    {formatDensityValue(baseSampleStudioComparison.densityDelta)}
                  </span>
                  <span>{t('modals.negativeConversion.baseSampleConfidenceDelta')}</span>
                  <span className="text-right tabular-nums">
                    {formatSignedRecipeValue(baseSampleStudioComparison.confidenceDelta)}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-accent bg-accent/10 px-2 py-1.5 text-xs text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-accept-base-sample"
                  disabled={baseFogConfidence === null || isSaving || baseSampleStudioDecision === 'accepted'}
                  onClick={handleAcceptBaseSample}
                >
                  <CheckCircle2 size={13} />
                  {t('modals.negativeConversion.acceptBaseSample')}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-reject-base-sample"
                  disabled={activeBaseFogSampleLabel === null || baseFogSampleUndoStack.length === 0 || isSaving}
                  onClick={handleRejectBaseSample}
                >
                  <X size={13} />
                  {t('modals.negativeConversion.rejectBaseSample')}
                </button>
              </div>
            </div>
            {baseFogConfidence !== null && (
              <div
                className="grid gap-2 rounded-md border border-surface bg-bg-primary p-2"
                data-base-scope={baseFogScope}
                data-testid="negative-lab-base-scope"
              >
                <UiText
                  data-testid="negative-lab-confidence"
                  variant={TextVariants.small}
                  className="text-text-tertiary"
                >
                  {t('modals.negativeConversion.baseFogConfidence', {
                    confidence: Math.round(baseFogConfidence * 100),
                  })}
                </UiText>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-text-secondary" data-testid="negative-lab-base-scope-label">
                    {t(
                      baseFogScope === 'roll'
                        ? 'modals.negativeConversion.baseScopeRoll'
                        : 'modals.negativeConversion.baseScopeFrame',
                    )}
                  </span>
                  <button
                    className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="negative-lab-promote-base-roll"
                    disabled={baseFogScope === 'roll' || isSaving || isEstimatingBaseFog}
                    onClick={handlePromoteBaseFogToRoll}
                    type="button"
                  >
                    {t('modals.negativeConversion.promoteBaseToRoll')}
                  </button>
                </div>
              </div>
            )}
            {baseFogPreviewProof !== null && (
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-surface bg-bg-primary p-2 text-xs text-text-tertiary"
                data-after-preview-hash={baseFogPreviewProof.previewAfterHash}
                data-before-preview-hash={baseFogPreviewProof.previewBeforeHash ?? ''}
                data-command-type={baseFogPreviewProof.command.commandType}
                data-confidence={baseFogPreviewProof.confidence}
                data-preview-changed={String(baseFogPreviewProof.previewChanged)}
                data-preview-revision={baseFogPreviewProof.previewRevision}
                data-rejection-reason={baseFogPreviewProof.rejectionReason ?? ''}
                data-sample-command-status={
                  baseFogPreviewProof.command.parameters.sampleRecords[0]?.status ?? baseFogPreviewProof.sampleStatus
                }
                data-sample-edit-mode={baseFogPreviewProof.command.parameters.sampleEditMode}
                data-sample-id={baseFogPreviewProof.command.parameters.sampleRecords[0]?.sampleId ?? ''}
                data-sample-scope={baseFogPreviewProof.sampleScope}
                data-sample-source={baseFogPreviewProof.sampleSource}
                data-sample-status={baseFogPreviewProof.sampleStatus}
                data-testid="negative-lab-base-preview-proof"
                data-warning-codes={baseFogPreviewProof.warningCodes.join(',')}
              >
                <span className="text-text-secondary">{t('modals.negativeConversion.baseFogSample')}</span>
                <span className="text-right">{activeBaseFogSampleLabel}</span>
                <span className="text-text-secondary">{t('modals.negativeConversion.previewReady')}</span>
                <span className="text-right tabular-nums">{baseFogPreviewProof.previewChanged ? 'yes' : 'no'}</span>
              </div>
            )}
            {baseFogSampleReadout !== null && (
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-surface bg-bg-primary p-2 text-xs text-text-tertiary"
                data-testid="negative-lab-base-sample-readout"
              >
                <span className="truncate text-text-secondary">{baseFogSampleReadout.label}</span>
                <span className="text-right" data-testid="negative-lab-base-sample-area">
                  {t('modals.negativeConversion.baseSampleArea', {
                    area: formatPercentValue(baseFogSampleReadout.areaPercent),
                  })}
                </span>
                <span data-testid="negative-lab-base-sample-origin">
                  {t('modals.negativeConversion.baseSampleOrigin', {
                    x: formatPercentValue(baseFogSampleReadout.xPercent),
                    y: formatPercentValue(baseFogSampleReadout.yPercent),
                  })}
                </span>
                <span className="text-right" data-testid="negative-lab-base-sample-size">
                  {t('modals.negativeConversion.baseSampleSize', {
                    height: formatPercentValue(baseFogSampleReadout.heightPercent),
                    width: formatPercentValue(baseFogSampleReadout.widthPercent),
                  })}
                </span>
              </div>
            )}
            {baseFogEstimate !== null && (
              <div
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-primary p-2 text-xs text-text-tertiary"
                data-testid="negative-lab-density-readout"
              >
                <span className="text-text-secondary">{t('modals.negativeConversion.baseRgb')}</span>
                <span className="text-right tabular-nums" data-testid="negative-lab-base-rgb-readout">
                  {baseFogEstimate.baseRgb.map(formatRgbValue).join(' / ')}
                </span>
                <span className="text-text-secondary">{t('modals.negativeConversion.baseDensity')}</span>
                <span className="text-right tabular-nums" data-testid="negative-lab-base-density-readout">
                  {baseFogEstimate.baseDensity.map(formatDensityValue).join(' / ')}
                </span>
                <button
                  type="button"
                  className="col-span-2 mt-1 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface"
                  data-testid="negative-lab-copy-readout"
                  onClick={() => {
                    void handleCopyBaseFogReadout();
                  }}
                >
                  <Copy size={12} />
                  {baseFogReadoutCopied
                    ? t('modals.negativeConversion.readoutCopied')
                    : t('modals.negativeConversion.copyReadout')}
                </button>
              </div>
            )}
            {densitometerReadout !== null && (
              <div
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-primary p-2 text-xs text-text-tertiary"
                data-testid="negative-lab-densitometer-readout"
              >
                <span className="text-text-secondary">{t('modals.negativeConversion.densitometer')}</span>
                <span className="text-right tabular-nums" data-testid="negative-lab-density-spread">
                  {formatDensityValue(densitometerReadout.densityRange)}
                </span>
                <span className="text-text-secondary">{t('modals.negativeConversion.densitometerDominant')}</span>
                <span className="text-right" data-testid="negative-lab-dominant-density-channel">
                  {t(DENSITOMETER_CHANNEL_LABEL_KEYS[densitometerReadout.dominantChannel])}
                </span>
                <span className="text-text-secondary">{t('modals.negativeConversion.densitometerNeutrality')}</span>
                <span className="text-right" data-testid="negative-lab-neutrality-status">
                  {t(DENSITOMETER_STATUS_LABEL_KEYS[densitometerReadout.status])}
                </span>
              </div>
            )}
            <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
              <div>
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.customBaseSample')}
                </UiText>
                <UiText variant={TextVariants.small} className="text-text-tertiary">
                  {t('modals.negativeConversion.customBaseSampleHint')}
                </UiText>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y', 'width', 'height'] satisfies Array<keyof NegativeLabBaseFogSampleRect>).map((field) => (
                  <label key={field} className="block text-[11px] text-text-tertiary">
                    <span className="mb-1 block">{t(`modals.negativeConversion.customSample.${field}`)}</span>
                    <input
                      className="w-full rounded-md border border-surface bg-bg-secondary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
                      data-testid={`negative-lab-custom-base-${field}`}
                      max={field === 'x' || field === 'y' ? 98 : 100}
                      min={field === 'x' || field === 'y' ? 0 : 2}
                      onChange={(event) => {
                        handleCustomBaseSampleRectChange(field, Number(event.target.value));
                      }}
                      step={1}
                      type="number"
                      value={Math.round(customBaseSampleRect[field] * 100)}
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-measure-custom-base"
                  disabled={!selectedImagePath || isMeasuringCustomBaseSample || isSaving}
                  onClick={() => {
                    void handleMeasureCustomBaseSample();
                  }}
                >
                  {isMeasuringCustomBaseSample ? <Loader2 size={13} className="animate-spin" /> : null}
                  {t('modals.negativeConversion.measureCustomBase')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-accent bg-accent/10 px-2 py-1.5 text-xs text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-apply-custom-base"
                  disabled={customBaseSampleEstimate === null || isSaving}
                  onClick={handleApplyCustomBaseSample}
                >
                  {t('modals.negativeConversion.applyCustomBase')}
                </button>
              </div>
              <div
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
                data-testid="negative-lab-custom-base-readout"
              >
                <span className="text-text-secondary">{customBaseSampleReadout.label}</span>
                <span className="text-right tabular-nums" data-testid="negative-lab-custom-base-area">
                  {t('modals.negativeConversion.baseSampleArea', {
                    area: formatPercentValue(customBaseSampleReadout.areaPercent),
                  })}
                </span>
                <span>
                  {t('modals.negativeConversion.baseSampleOrigin', {
                    x: formatPercentValue(customBaseSampleReadout.xPercent),
                    y: formatPercentValue(customBaseSampleReadout.yPercent),
                  })}
                </span>
                <span className="text-right">
                  {t('modals.negativeConversion.baseSampleSize', {
                    height: formatPercentValue(customBaseSampleReadout.heightPercent),
                    width: formatPercentValue(customBaseSampleReadout.widthPercent),
                  })}
                </span>
                {customBaseSampleEstimate !== null && (
                  <>
                    <span className="text-text-secondary">{t('modals.negativeConversion.baseRgb')}</span>
                    <span className="text-right tabular-nums" data-testid="negative-lab-custom-base-rgb">
                      {customBaseSampleEstimate.baseRgb.map(formatRgbValue).join(' / ')}
                    </span>
                    <span className="text-text-secondary">{t('modals.negativeConversion.baseDensity')}</span>
                    <span className="text-right tabular-nums" data-testid="negative-lab-custom-base-density">
                      {customBaseSampleEstimate.baseDensity.map(formatDensityValue).join(' / ')}
                    </span>
                  </>
                )}
              </div>
            </div>
            <NegativeLabPatchSamplerPanel
              activeFrameId={frameHealthReport.activeFrameId}
              formatDensityValue={formatDensityValue}
              formatPercentValue={formatPercentValue}
              formatRgbValue={formatRgbValue}
              formatSignedRecipeValue={formatSignedRecipeValue}
              highlightPatchExposureSuggestion={highlightPatchExposureSuggestion}
              isPickingPatch={isPickingPatch}
              isSamplingPatchProbe={isSamplingPatchProbe}
              isSaving={isSaving}
              isSuggestingHighlightPatchExposure={isSuggestingHighlightPatchExposure}
              isSuggestingNeutralPatchRgb={isSuggestingNeutralPatchRgb}
              isSuggestingShadowPatchBlackPoint={isSuggestingShadowPatchBlackPoint}
              neutralPatchSuggestion={neutralPatchSuggestion}
              onApplyHighlightPatchExposureSuggestion={handleApplyHighlightPatchExposureSuggestion}
              onApplyNeutralPatchRgbSuggestion={handleApplyNeutralPatchRgbSuggestion}
              onApplyShadowPatchBlackPointSuggestion={handleApplyShadowPatchBlackPointSuggestion}
              onPatchRoleChange={(nextPatchRole) => {
                setPatchRole(nextPatchRole);
                setNeutralPatchSuggestion(null);
                setHighlightPatchExposureSuggestion(null);
                setShadowPatchBlackPointSuggestion(null);
              }}
              onSamplePatchProbe={(labelKey, sampleRect) => {
                void handleSamplePatchProbe(labelKey, sampleRect);
              }}
              onSuggestHighlightPatchExposure={() => {
                void handleSuggestHighlightPatchExposure();
              }}
              onSuggestNeutralPatchRgb={() => {
                void handleSuggestNeutralPatchRgb();
              }}
              onSuggestShadowPatchBlackPoint={() => {
                void handleSuggestShadowPatchBlackPoint();
              }}
              onTogglePatchPick={() => {
                setIsPickingPatch((current) => !current);
                setPatchDragStart(null);
                setDraftPatchRect(null);
              }}
              patchProbeDensitometerReadout={patchProbeDensitometerReadout}
              patchProbeEstimate={patchProbeEstimate}
              patchProbeSampleReadout={patchProbeSampleReadout}
              patchRole={patchRole}
              selectedImagePath={selectedImagePath}
              shadowPatchBlackPointSuggestion={shadowPatchBlackPointSuggestion}
            />
            {renderDustScratchReview()}
            {renderQcProofReport()}
            {renderPositiveVariantHandoff()}
            <Slider
              label={t('modals.negativeConversion.redWeight')}
              value={params.red_weight}
              min={0.5}
              max={2.0}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('red_weight', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <Slider
              label={t('modals.negativeConversion.greenWeight')}
              value={params.green_weight}
              min={0.5}
              max={2.0}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('green_weight', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <Slider
              label={t('modals.negativeConversion.blueWeight')}
              value={params.blue_weight}
              min={0.5}
              max={2.0}
              step={0.01}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('blue_weight', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <div
              className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
              data-active-frame-id={frameHealthReport.activeFrameId ?? ''}
              data-effective-blue-weight={effectiveActiveFrameRgbBalance.blueWeight}
              data-effective-green-weight={effectiveActiveFrameRgbBalance.greenWeight}
              data-effective-red-weight={effectiveActiveFrameRgbBalance.redWeight}
              data-testid="negative-lab-frame-rgb-balance-override-control"
            >
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.frameRgbBalanceOffset')}
                </UiText>
                <button
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-reset-frame-rgb-balance"
                  disabled={
                    frameHealthReport.activeFrameId === null ||
                    negativeLabFrameRgbBalanceOffsetIsZero(activeFrameRgbBalanceOffset) ||
                    isSaving
                  }
                  onClick={() => {
                    if (frameHealthReport.activeFrameId !== null) {
                      handleResetFrameRgbBalance(frameHealthReport.activeFrameId);
                    }
                  }}
                  type="button"
                >
                  {t('modals.negativeConversion.resetFrameRgbBalance')}
                </button>
              </div>
              <Slider
                label={t('modals.negativeConversion.frameRedWeightOffset')}
                value={activeFrameRgbBalanceOffset.redWeight}
                min={-1.5}
                max={1.5}
                step={0.01}
                defaultValue={0}
                disabled={frameHealthReport.activeFrameId === null || isSaving}
                onChange={(event) => {
                  if (frameHealthReport.activeFrameId !== null) {
                    handleFrameRgbBalanceOffsetChange(
                      frameHealthReport.activeFrameId,
                      'redWeight',
                      Number(event.target.value),
                    );
                  }
                }}
              />
              <Slider
                label={t('modals.negativeConversion.frameGreenWeightOffset')}
                value={activeFrameRgbBalanceOffset.greenWeight}
                min={-1.5}
                max={1.5}
                step={0.01}
                defaultValue={0}
                disabled={frameHealthReport.activeFrameId === null || isSaving}
                onChange={(event) => {
                  if (frameHealthReport.activeFrameId !== null) {
                    handleFrameRgbBalanceOffsetChange(
                      frameHealthReport.activeFrameId,
                      'greenWeight',
                      Number(event.target.value),
                    );
                  }
                }}
              />
              <Slider
                label={t('modals.negativeConversion.frameBlueWeightOffset')}
                value={activeFrameRgbBalanceOffset.blueWeight}
                min={-1.5}
                max={1.5}
                step={0.01}
                defaultValue={0}
                disabled={frameHealthReport.activeFrameId === null || isSaving}
                onChange={(event) => {
                  if (frameHealthReport.activeFrameId !== null) {
                    handleFrameRgbBalanceOffsetChange(
                      frameHealthReport.activeFrameId,
                      'blueWeight',
                      Number(event.target.value),
                    );
                  }
                }}
              />
              <UiText variant={TextVariants.small} className="text-text-tertiary">
                {t('modals.negativeConversion.effectiveFrameRgbBalance', {
                  blue: effectiveActiveFrameRgbBalance.blueWeight.toFixed(2),
                  green: effectiveActiveFrameRgbBalance.greenWeight.toFixed(2),
                  red: effectiveActiveFrameRgbBalance.redWeight.toFixed(2),
                })}
              </UiText>
            </div>
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.printGrade')}
          </UiText>
          <div className="space-y-3">
            <Slider
              label={t('modals.negativeConversion.exposure')}
              value={params.exposure}
              min={-2.0}
              max={2.0}
              step={0.05}
              defaultValue={0}
              onChange={(e) => {
                handleParamChange('exposure', Number(e.target.value));
              }}
            />
            <div
              className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
              data-active-frame-id={frameHealthReport.activeFrameId ?? ''}
              data-effective-exposure={effectiveActiveExposure}
              data-exposure-offset={activeFrameExposureOffset}
              data-testid="negative-lab-frame-exposure-override-control"
            >
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.frameExposureOffset')}
                </UiText>
                <button
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-reset-frame-exposure"
                  disabled={frameHealthReport.activeFrameId === null || activeFrameExposureOffset === 0 || isSaving}
                  onClick={() => {
                    if (frameHealthReport.activeFrameId !== null) {
                      handleFrameExposureOffsetChange(frameHealthReport.activeFrameId, 0);
                    }
                  }}
                  type="button"
                >
                  {t('modals.negativeConversion.resetFrameExposure')}
                </button>
              </div>
              <Slider
                label={t('modals.negativeConversion.frameExposureOffset')}
                value={activeFrameExposureOffset}
                min={-2}
                max={2}
                step={0.05}
                defaultValue={0}
                disabled={frameHealthReport.activeFrameId === null || isSaving}
                onChange={(event) => {
                  if (frameHealthReport.activeFrameId !== null) {
                    handleFrameExposureOffsetChange(frameHealthReport.activeFrameId, Number(event.target.value));
                  }
                }}
              />
              <UiText variant={TextVariants.small} className="text-text-tertiary">
                {t('modals.negativeConversion.effectiveFrameExposure', {
                  exposure: formatSignedRecipeValue(effectiveActiveExposure),
                })}
              </UiText>
            </div>
            <Slider
              label={t('modals.negativeConversion.contrast')}
              value={params.contrast}
              min={0.5}
              max={2.5}
              step={0.05}
              defaultValue={1}
              onChange={(e) => {
                handleParamChange('contrast', Number(e.target.value));
              }}
              fillOrigin="min"
            />
            <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
              <div className="flex items-center justify-between gap-2">
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.printEndpoints')}
                </UiText>
                <button
                  className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="negative-lab-reset-print-endpoints"
                  disabled={params.black_point === 0 && params.white_point === 1}
                  onClick={handleEndpointReset}
                  type="button"
                >
                  {t('modals.negativeConversion.resetPrintEndpoints')}
                </button>
              </div>
              <div data-testid="negative-lab-black-point-control">
                <Slider
                  label={t('modals.negativeConversion.blackPoint')}
                  value={params.black_point}
                  min={0}
                  max={0.95}
                  step={0.01}
                  defaultValue={0}
                  onChange={(e) => {
                    const nextBlackPoint = Math.min(Number(e.target.value), params.white_point - 0.05);
                    handleParamChange('black_point', Number(nextBlackPoint.toFixed(2)));
                  }}
                  fillOrigin="min"
                />
              </div>
              <div data-testid="negative-lab-white-point-control">
                <Slider
                  label={t('modals.negativeConversion.whitePoint')}
                  value={params.white_point}
                  min={0.05}
                  max={1}
                  step={0.01}
                  defaultValue={1}
                  onChange={(e) => {
                    const nextWhitePoint = Math.max(Number(e.target.value), params.black_point + 0.05);
                    handleParamChange('white_point', Number(nextWhitePoint.toFixed(2)));
                  }}
                  fillOrigin="min"
                />
              </div>
            </div>
          </div>
        </div>

        <div className={cx('transition-opacity duration-200', isSaving && 'opacity-50 pointer-events-none grayscale')}>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.negativeConversion.exportOptions')}
          </UiText>
          <div className="space-y-3">
            <div
              className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-primary p-2 text-xs text-text-tertiary"
              data-testid="negative-lab-export-summary"
            >
              <span>{t('modals.negativeConversion.exportOptions')}</span>
              <span className="text-right text-text-secondary" data-testid="negative-lab-export-summary-format">
                {t(`modals.negativeConversion.outputFormats.${saveOptions.outputFormat}`)}
              </span>
              <span>{t('modals.negativeConversion.outputSuffix')}</span>
              <span className="text-right text-text-secondary" data-testid="negative-lab-export-summary-suffix">
                {saveOptions.suffix || '-'}
              </span>
              <span data-testid="negative-lab-export-summary-scope">
                {t(CONVERSION_SCOPE_LABEL_KEYS[conversionScope])}
              </span>
              <span className="text-right text-text-secondary" data-testid="negative-lab-export-summary-count">
                {t('modals.negativeConversion.queuedScans', { queuedCount: pathsToConvert.length })}
              </span>
              <span>{t('modals.negativeConversion.conversionBundle')}</span>
              <span className="text-right text-text-secondary" data-testid="negative-lab-export-summary-bundle">
                {t(
                  saveOptions.writeConversionBundle
                    ? 'modals.negativeConversion.conversionBundleEnabled'
                    : 'modals.negativeConversion.conversionBundleDisabled',
                )}
              </span>
            </div>
            <div
              aria-label={t('modals.negativeConversion.exportOptions')}
              className="grid grid-cols-2 gap-2"
              role="group"
            >
              {NEGATIVE_LAB_OUTPUT_FORMAT_SELECTOR_IDS.map((format) => (
                <button
                  key={format}
                  type="button"
                  data-testid={
                    format === NegativeLabOutputFormatId.Tiff16
                      ? 'negative-lab-export-tiff16'
                      : 'negative-lab-export-jpeg-proof'
                  }
                  aria-pressed={saveOptions.outputFormat === format}
                  onClick={() => {
                    setSaveOptions((current) => ({ ...current, outputFormat: format }));
                  }}
                  className={cx(
                    'rounded-md border px-3 py-2 text-sm transition-colors',
                    saveOptions.outputFormat === format
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-surface bg-bg-primary text-text-secondary hover:bg-surface',
                  )}
                >
                  {t(`modals.negativeConversion.outputFormats.${format}`)}
                </button>
              ))}
            </div>
            <label className="block">
              <UiText as="span" variant={TextVariants.small} className="mb-1 block text-text-secondary">
                {t('modals.negativeConversion.outputSuffix')}
              </UiText>
              <input
                aria-label={t('modals.negativeConversion.outputSuffix')}
                className="w-full rounded-md border border-surface bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                maxLength={40}
                onChange={(event) => {
                  setSaveOptions((current) => ({ ...current, suffix: event.target.value }));
                }}
                value={saveOptions.suffix}
              />
            </label>
            <div className="flex items-start gap-3 rounded-md border border-surface bg-bg-primary p-3">
              <input
                checked={saveOptions.writeConversionBundle}
                className="mt-1"
                data-testid="negative-lab-export-conversion-bundle"
                id="negative-lab-export-conversion-bundle"
                onChange={(event) => {
                  setSaveOptions((current) => ({ ...current, writeConversionBundle: event.target.checked }));
                }}
                type="checkbox"
              />
              <span className="min-w-0">
                <label
                  htmlFor="negative-lab-export-conversion-bundle"
                  className="block text-sm font-medium text-text-secondary"
                >
                  {t('modals.negativeConversion.conversionBundle')}
                </label>
                <span className="block text-xs leading-tight text-text-tertiary">
                  {t('modals.negativeConversion.conversionBundleHint')}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-4 space-y-2">
          <UiText
            as="div"
            variant={TextVariants.small}
            className="p-3 bg-surface rounded-md border border-surface flex items-center gap-3"
          >
            <Info size={16} className="shrink-0" />
            <div className="text-xs text-text-tertiary leading-tight space-y-1">
              <Trans i18nKey="modals.negativeConversion.noticeText">
                Inversion logic inspired by{' '}
                <a
                  href="https://github.com/marcinz606/NegPy"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary transition-colors"
                >
                  NegPy
                </a>{' '}
                created by marcinz606 (
                <a
                  href="https://github.com/marcinz606/NegPy/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary transition-colors"
                >
                  GPL-3.0
                </a>
                ).
              </Trans>
            </div>
          </UiText>
        </div>
      </div>
    </div>
  );

  const renderWorkflowRail = () => (
    <div className="absolute top-4 left-4 right-4 z-20 pointer-events-none">
      <div
        className="pointer-events-auto rounded-md border border-white/10 bg-black/65 p-2 shadow-xl backdrop-blur-md"
        data-testid="negative-lab-workflow-rail"
      >
        <div className="grid grid-cols-6 gap-2">
          {workflowStages.map((stage) => {
            return (
              <div key={stage.id} className="min-w-0 rounded-sm bg-white/5 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-white">
                  <span
                    className={cx('shrink-0', stage.isComplete ? 'text-accent' : 'text-white/35')}
                    aria-hidden="true"
                  >
                    <span
                      className={cx(
                        'block size-3 rounded-full border',
                        stage.isComplete ? 'border-accent bg-accent' : 'border-white/35',
                      )}
                    />
                  </span>
                  <span className="truncate text-xs font-semibold">{stage.label}</span>
                </div>
                <div className="mt-1 truncate text-[11px] leading-tight text-white/60">{stage.detail}</div>
              </div>
            );
          })}
        </div>
        <div
          className="mt-2 grid grid-cols-3 gap-2 border-t border-white/10 pt-2 text-[11px] text-white/65"
          data-export-ready={String(workspaceProof.exportReady)}
          data-positive-preview-ready={String(positivePreviewReady)}
          data-preview-ready={String(workspaceProof.previewReady)}
          data-testid="negative-lab-workflow-readiness-strip"
        >
          <span className="truncate rounded-sm bg-white/5 px-2 py-1" data-testid="negative-lab-workflow-queued">
            {t('modals.negativeConversion.queuedScans', { queuedCount: workspaceProof.queuedCount })}
          </span>
          <span className="truncate rounded-sm bg-white/5 px-2 py-1" data-testid="negative-lab-workflow-preview">
            {previewReadinessLabel}
          </span>
          <span className="truncate rounded-sm bg-white/5 px-2 py-1" data-testid="negative-lab-workflow-export">
            {workspaceProof.exportReady
              ? t('modals.negativeConversion.workflowExportReadyCount', {
                  format: t(
                    saveOptions.outputFormat === NegativeLabOutputFormatId.Tiff16
                      ? 'modals.negativeConversion.outputFormats.tiff16'
                      : 'modals.negativeConversion.outputFormats.jpeg_proof',
                  ),
                  queuedCount: workspaceProof.queuedCount,
                })
              : t('modals.negativeConversion.workflowExportBlocked')}
          </span>
        </div>
      </div>
    </div>
  );

  const renderBaseFogSampleOverlay = () => {
    if (params.base_fog_sample === null) return null;

    const sampleRect = params.base_fog_sample;

    return (
      <div
        aria-label={t('modals.negativeConversion.sampleOverlayLabel')}
        className="absolute border-2 border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
        data-testid="negative-lab-base-sample-overlay"
        style={{
          height: `${sampleRect.height * 100}%`,
          left: `${sampleRect.x * 100}%`,
          top: `${sampleRect.y * 100}%`,
          width: `${sampleRect.width * 100}%`,
        }}
      >
        <span className="absolute left-0 top-0 -translate-y-full rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-medium text-button-text shadow">
          {activeBaseFogSampleLabel ?? t('modals.negativeConversion.baseFogSample')}
        </span>
      </div>
    );
  };

  const renderPatchProbeOverlay = () => {
    if (patchProbeRect === null) return null;

    return (
      <div
        aria-label={t('modals.negativeConversion.patchSampleOverlayLabel')}
        className="absolute border-2 border-yellow-300 bg-yellow-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
        data-testid="negative-lab-patch-probe-overlay"
        style={{
          height: `${patchProbeRect.height * 100}%`,
          left: `${patchProbeRect.x * 100}%`,
          top: `${patchProbeRect.y * 100}%`,
          width: `${patchProbeRect.width * 100}%`,
        }}
      >
        <span className="absolute bottom-0 left-0 translate-y-full rounded-sm bg-yellow-300 px-1.5 py-0.5 text-[10px] font-medium text-black shadow">
          {patchProbeLabel ?? t('modals.negativeConversion.patchSampler')}
        </span>
      </div>
    );
  };

  const renderDraftPatchOverlay = () => {
    if (draftPatchRect === null) return null;

    return (
      <div
        aria-label={t('modals.negativeConversion.patchPickDraftOverlayLabel')}
        className="absolute border-2 border-dashed border-yellow-200 bg-yellow-200/10 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
        data-testid="negative-lab-patch-pick-draft-overlay"
        style={{
          height: `${draftPatchRect.height * 100}%`,
          left: `${draftPatchRect.x * 100}%`,
          top: `${draftPatchRect.y * 100}%`,
          width: `${draftPatchRect.width * 100}%`,
        }}
      />
    );
  };

  const renderCustomBaseSampleOverlay = () => (
    <div
      aria-label={t('modals.negativeConversion.customBaseSampleOverlayLabel')}
      className="absolute border-2 border-cyan-300 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
      data-testid="negative-lab-custom-base-overlay"
      style={{
        height: `${customBaseSampleRect.height * 100}%`,
        left: `${customBaseSampleRect.x * 100}%`,
        top: `${customBaseSampleRect.y * 100}%`,
        width: `${customBaseSampleRect.width * 100}%`,
      }}
    >
      <span className="absolute right-0 top-0 -translate-y-full rounded-sm bg-cyan-300 px-1.5 py-0.5 text-[10px] font-medium text-black shadow">
        {t('modals.negativeConversion.customBaseSample')}
      </span>
    </div>
  );

  const renderContent = () => (
    <div className="modal-preview-adjustments flex flex-row h-full w-full overflow-hidden">
      <div
        className="sr-only"
        data-active-stage={workspaceProof.activeStage}
        data-export-ready={String(workspaceProof.exportReady)}
        data-positive-preview-ready={String(positivePreviewReady)}
        data-preview-ready={String(workspaceProof.previewReady)}
        data-queued-count={workspaceProof.queuedCount}
        data-review-count={workspaceProof.reviewReport.reviewCount}
        data-retouch-count={workspaceProof.reviewReport.retouchCount}
        data-schema-version={workspaceProof.schemaVersion}
        data-target-count={workspaceProof.targetCount}
        data-testid="negative-lab-workspace-proof"
      />
      <div className="modal-preview-pane grow flex flex-col relative min-h-0 bg-[#0f0f0f] overflow-hidden">
        {renderWorkflowRail()}
        {renderRollFrameNavigator()}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          role="presentation"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          ></div>

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-30">
              <Loader2 className="w-12 h-12 text-accent animate-spin" />
            </div>
          )}

          {previewImageUrl !== null && (
            <div
              className={cx(
                'absolute inset-0 flex items-center justify-center',
                isPickingPatch ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none',
              )}
              data-testid="negative-lab-preview-image-layer"
            >
              <div className="origin-center" style={imageTransformStyle}>
                <div className="relative inline-block shadow-2xl">
                  <img
                    ref={previewImageRef}
                    src={previewImageUrl}
                    className="block object-contain"
                    data-testid="negative-lab-preview-image"
                    style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                    alt={t('modals.negativeConversion.previewAlt')}
                    draggable={false}
                    onPointerDown={handlePatchPickPointerDown}
                    onPointerMove={handlePatchPickPointerMove}
                    onPointerUp={handlePatchPickPointerUp}
                  />
                  {renderCustomBaseSampleOverlay()}
                  {renderBaseFogSampleOverlay()}
                  {renderPatchProbeOverlay()}
                  {renderDraftPatchOverlay()}
                  {isCompareActive && originalUrl !== null && (
                    <UiText
                      as="div"
                      variant={TextVariants.small}
                      color={TextColors.button}
                      className="absolute top-4 left-4 bg-accent px-2 py-1 rounded-sm shadow-lg z-20"
                    >
                      {t('modals.negativeConversion.originalLabel')}
                    </UiText>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-xl z-20 pointer-events-auto"
            role="presentation"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              aria-label={t('modals.negativeConversion.zoomOutTooltip')}
              onClick={zoomOut}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.zoomOutTooltip')}
            >
              <ZoomOut size={18} />
            </button>
            <span className="text-xs font-mono text-white/90 w-12 text-center select-none pointer-events-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              aria-label={t('modals.negativeConversion.zoomInTooltip')}
              onClick={zoomIn}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.zoomInTooltip')}
            >
              <ZoomIn size={18} />
            </button>
            <button
              aria-label={t('modals.negativeConversion.resetViewTooltip')}
              onClick={handleResetZoom}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.resetViewTooltip')}
            >
              <Maximize size={16} />
            </button>
            <div className="w-px h-5 bg-white/20 mx-1"></div>
            <button
              aria-label={t('modals.negativeConversion.compareTooltip')}
              onMouseDown={() => {
                setIsCompareActive(true);
              }}
              onMouseUp={() => {
                setIsCompareActive(false);
              }}
              onMouseLeave={() => {
                setIsCompareActive(false);
              }}
              className={cx(
                'p-2 rounded-full transition-colors select-none',
                isCompareActive ? 'bg-accent text-button-text' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
              data-tooltip={t('modals.negativeConversion.compareTooltip')}
            >
              {isCompareActive ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      </div>
      {renderControls()}
    </div>
  );

  if (!isMounted) return null;

  return (
    <div
      className={cx(
        'fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-xs transition-opacity duration-300',
        show ? 'opacity-100' : 'opacity-0',
      )}
      role="presentation"
      onMouseDown={onClose}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
            data-testid="negative-lab-workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby="negative-lab-dialog-title"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="grow min-h-0 overflow-hidden">{renderContent()}</div>

            <div className="shrink-0 p-4 flex items-center justify-end gap-3 border-t border-surface bg-bg-secondary z-20">
              {saveBlockedReasonKey !== null && (
                <UiText
                  variant={TextVariants.small}
                  color={TextColors.secondary}
                  className="mr-auto rounded-sm border border-surface bg-surface/70 px-2 py-1"
                  data-testid="negative-lab-convert-save-blocked-reason"
                  id="negative-lab-convert-save-blocked-reason"
                >
                  {t(saveBlockedReasonKey)}
                </UiText>
              )}
              <button
                aria-label={t('modals.negativeConversion.cancel')}
                disabled={isSaving}
                onClick={onClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('modals.negativeConversion.cancel')}
              </button>
              <Button
                aria-label={
                  hasMultipleScans && conversionScope === 'all'
                    ? t('modals.negativeConversion.convertAndSaveAll', { count: targetPaths.length })
                    : hasMultipleScans && conversionScope === 'ready'
                      ? t('modals.negativeConversion.convertAndSaveReady', { count: pathsToConvert.length })
                      : hasMultipleScans
                        ? t('modals.negativeConversion.convertAndSaveActive')
                        : t('modals.negativeConversion.convertAndSave')
                }
                onClick={() => {
                  void handleSave();
                }}
                aria-describedby={
                  saveBlockedReasonKey !== null ? 'negative-lab-convert-save-blocked-reason' : undefined
                }
                className={cx(
                  !canSave &&
                    'border border-surface bg-surface text-text-tertiary shadow-none ring-1 ring-white/5 disabled:opacity-100',
                )}
                data-can-save={canSave ? 'true' : 'false'}
                data-save-blocked-reason={saveBlockedReasonKey ?? ''}
                data-testid="negative-lab-convert-save-action"
                disabled={!canSave}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    {progress && progress.total > 1
                      ? t('modals.negativeConversion.convertingProgress', {
                          current: progress.current,
                          total: progress.total,
                        })
                      : t('modals.negativeConversion.converting')}
                  </>
                ) : (
                  <>
                    <Save className="mr-2" size={16} />
                    {hasMultipleScans && conversionScope === 'all'
                      ? t('modals.negativeConversion.convertAndSaveAll', { count: targetPaths.length })
                      : hasMultipleScans && conversionScope === 'ready'
                        ? t('modals.negativeConversion.convertAndSaveReady', { count: pathsToConvert.length })
                        : hasMultipleScans
                          ? t('modals.negativeConversion.convertAndSaveActive')
                          : t('modals.negativeConversion.convertAndSave')}
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
