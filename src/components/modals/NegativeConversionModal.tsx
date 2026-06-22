import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Save,
  Loader2,
  Eye,
  EyeOff,
  Info,
  WandSparkles,
  Copy,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
} from 'lucide-react';
import { useState, useEffect, useMemo, useRef, type PointerEvent } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import { usePreviewViewport } from '../../hooks/usePreviewViewport';
import {
  negativeLabHighlightPatchExposureSuggestionSchema,
  type NegativeLabHighlightPatchExposureSuggestion,
} from '../../schemas/negativeLabHighlightPatchExposureSuggestionSchemas';
import {
  negativeLabNeutralPatchSuggestionSchema,
  type NegativeLabNeutralPatchSuggestion,
} from '../../schemas/negativeLabNeutralPatchSuggestionSchemas';
import {
  negativeBaseFogEstimateSchema,
  negativeBaseFogSampleReadoutSchema,
  negativeConversionSavedPathsSchema,
  type NegativeBaseFogDensitometerReadout,
  type NegativeBaseFogEstimate,
  type NegativeLabBaseFogSampleRect,
  type NegativeLabPresetParams,
} from '../../schemas/negativeLabPresetCatalogSchemas';
import {
  negativeLabShadowPatchBlackPointSuggestionSchema,
  type NegativeLabShadowPatchBlackPointSuggestion,
} from '../../schemas/negativeLabShadowPatchBlackPointSuggestionSchemas';
import { parsePathProgressPayload } from '../../schemas/tauriEventSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import { NegativeLabAppServerCommandName } from '../../utils/negativeLabAppServerCommandNames';
import {
  buildNegativeLabBaseSamplePreviewProof,
  type NegativeLabBaseSampleWarningCode,
  type NegativeLabBaseSamplePreviewProof,
  type NegativeLabBaseSamplePreviewProofContext,
} from '../../utils/negativeLabBaseSampleCommandBridge';
import { buildNegativeBaseFogDensitometerReadout } from '../../utils/negativeLabDensitometer';
import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../utils/negativeLabDustScratchReview';
import {
  buildNegativeLabFrameExposureOverridePayload,
  getNegativeLabEffectiveFrameExposure,
  snapNegativeLabFrameExposureOffset,
} from '../../utils/negativeLabFrameExposureOverrides';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
  getNegativeLabScanLabel,
} from '../../utils/negativeLabFrameHealth';
import {
  DEFAULT_NEGATIVE_LAB_FRAME_RGB_BALANCE_OFFSET,
  buildNegativeLabFrameRgbBalanceOverridePayload,
  getNegativeLabEffectiveFrameRgbBalance,
  negativeLabFrameRgbBalanceOffsetIsZero,
  snapNegativeLabFrameRgbBalanceOffsets,
} from '../../utils/negativeLabFrameRgbBalanceOverrides';
import {
  NegativeLabOutputFormatId,
  NEGATIVE_LAB_OUTPUT_FORMAT_SELECTOR_IDS,
  type NegativeLabOutputFormatId as NegativeOutputFormat,
} from '../../utils/negativeLabOutputFormatIds';
import { buildNegativeLabPickedPatchRect, type NegativeLabPatchPickerPoint } from '../../utils/negativeLabPatchPicker';
import { buildNegativeLabAcceptedPlanIdentity } from '../../utils/negativeLabPlanIdentity';
import {
  DEFAULT_NEGATIVE_LAB_UI_PRESET,
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
} from '../../utils/negativeLabPresetCatalog';
import { buildNegativeLabProfileBrowserRows } from '../../utils/negativeLabProfileBrowserRows';
import {
  buildNegativeLabBrowserProfileProvenanceHash,
  buildNegativeLabProfileBoundPlanIdentity,
  buildNegativeLabProfileComparisonRows,
  buildNegativeLabSelectedProfileSnapshot,
} from '../../utils/negativeLabProfileComparison';
import { buildNegativeLabQcContactSheetArtifact } from '../../utils/negativeLabQcContactSheetArtifact';
import { buildNegativeLabRollNormalizationPlan } from '../../utils/negativeLabRollNormalizationPlan';
import {
  NEGATIVE_LAB_STOCK_METADATA_CATALOG,
  buildNegativeLabStockMetadataCounts,
  listNegativeLabStockMetadataReferencesForPreset,
} from '../../utils/negativeLabStockMetadataCatalog';
import { NEGATIVE_LAB_STOCK_REGISTRY, buildNegativeLabStockRegistryCounts } from '../../utils/negativeLabStockRegistry';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { throttle } from '../../utils/timing';
import { Invokes } from '../ui/AppProperties';
import Button from '../ui/Button';
import Slider from '../ui/Slider';
import UiText from '../ui/Text';

import type {
  NegativeLabAcquisitionHealthReport,
  NegativeLabAcquisitionSourceFamily,
  NegativeLabAcquisitionWarningCode,
  NegativeLabFrameCropStatus,
  NegativeLabFrameHealthEntry,
  NegativeLabFrameWarningSeverity,
} from '../../schemas/negativeLabFrameHealthSchemas';
import type { NegativeLabFrameRgbBalanceOffset } from '../../schemas/negativeLabFrameRgbBalanceOverrideSchemas';
import type { NegativeLabRuntimeProfileBrowserRow } from '../../schemas/negativeLabMeasuredProfileSchemas';
import type { NegativeLabSelectedProfileSnapshot } from '../../schemas/negativeLabProfileComparisonSchemas';
import type { NegativeLabWorkspaceProof } from '../../schemas/negativeLabWorkspaceSchemas';

type NegativeParams = NegativeLabPresetParams;
type NegativeConversionScope = 'active' | 'all' | 'ready';
type NegativeLabProfileFilter = 'all' | 'black_and_white_silver' | 'color_negative' | 'measured';
type NegativeLabProfileSort = 'catalog' | 'evidence_desc' | 'name_asc' | 'runtime_applied';
type NegativeLabPatchRole = 'highlight' | 'neutral';
type NegativeLabBaseSampleStudioDecision = 'accepted' | 'candidate' | 'rejected';
type NegativeLabQcDecision = 'approved' | 'pending' | 'rejected';
type NegativeLabProfileFilterLabelKey =
  | 'modals.negativeConversion.profileFilterAll'
  | 'modals.negativeConversion.profileFilterBlackAndWhite'
  | 'modals.negativeConversion.profileFilterColorNegative'
  | 'modals.negativeConversion.profileFilterMeasured';
type NegativeLabProfileSortLabelKey =
  | 'modals.negativeConversion.profileSortCatalog'
  | 'modals.negativeConversion.profileSortEvidence'
  | 'modals.negativeConversion.profileSortName'
  | 'modals.negativeConversion.profileSortRuntime';
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
const NEGATIVE_LAB_PROFILE_FILTERS = [
  { id: 'all', labelKey: 'modals.negativeConversion.profileFilterAll' },
  { id: 'color_negative', labelKey: 'modals.negativeConversion.profileFilterColorNegative' },
  { id: 'black_and_white_silver', labelKey: 'modals.negativeConversion.profileFilterBlackAndWhite' },
  { id: 'measured', labelKey: 'modals.negativeConversion.profileFilterMeasured' },
] satisfies Array<{ id: NegativeLabProfileFilter; labelKey: NegativeLabProfileFilterLabelKey }>;
const NEGATIVE_LAB_PROFILE_FILTER_TEST_IDS = {
  all: 'negative-lab-profile-filter-all',
  black_and_white_silver: 'negative-lab-profile-filter-black_and_white_silver',
  color_negative: 'negative-lab-profile-filter-color_negative',
  measured: 'negative-lab-profile-filter-measured',
} satisfies Record<NegativeLabProfileFilter, string>;
const NEGATIVE_LAB_PROFILE_SORTS = [
  { id: 'catalog', labelKey: 'modals.negativeConversion.profileSortCatalog' },
  { id: 'name_asc', labelKey: 'modals.negativeConversion.profileSortName' },
  { id: 'evidence_desc', labelKey: 'modals.negativeConversion.profileSortEvidence' },
  { id: 'runtime_applied', labelKey: 'modals.negativeConversion.profileSortRuntime' },
] satisfies Array<{ id: NegativeLabProfileSort; labelKey: NegativeLabProfileSortLabelKey }>;
const NEGATIVE_LAB_PROFILE_SORT_TEST_IDS = {
  catalog: 'negative-lab-profile-sort-catalog',
  evidence_desc: 'negative-lab-profile-sort-evidence_desc',
  name_asc: 'negative-lab-profile-sort-name_asc',
  runtime_applied: 'negative-lab-profile-sort-runtime_applied',
} satisfies Record<NegativeLabProfileSort, string>;
type BaseFogSampleLabelKey = 'modals.negativeConversion.sampleCenterPatch' | 'modals.negativeConversion.sampleLeftEdge';
type DensitometerPatchLabelKey =
  | BaseFogSampleLabelKey
  | 'modals.negativeConversion.sampleHighlightPatch'
  | 'modals.negativeConversion.sampleShadowPatch';
type AcquisitionSourceFamilyLabelKey =
  | 'modals.negativeConversion.acquisitionSourceJpeg'
  | 'modals.negativeConversion.acquisitionSourceRaw'
  | 'modals.negativeConversion.acquisitionSourceTiff'
  | 'modals.negativeConversion.acquisitionSourceUnknown';
type AcquisitionWarningLabelKey =
  | 'modals.negativeConversion.acquisitionWarningLabProcessed'
  | 'modals.negativeConversion.acquisitionWarningLossy'
  | 'modals.negativeConversion.acquisitionWarningMixed'
  | 'modals.negativeConversion.acquisitionWarningUnknown';
type BatchDispositionLabelKey =
  | 'modals.negativeConversion.batchDispositionApply'
  | 'modals.negativeConversion.batchDispositionReview'
  | 'modals.negativeConversion.batchDispositionSkip';
type BatchDispositionReasonLabelKey =
  | 'modals.negativeConversion.batchDispositionReasonAcquisition'
  | 'modals.negativeConversion.batchDispositionReasonBase'
  | 'modals.negativeConversion.batchDispositionReasonExcluded'
  | 'modals.negativeConversion.batchDispositionReasonPreview'
  | 'modals.negativeConversion.batchDispositionReasonReady';
type ConversionScopeLabelKey =
  | 'modals.negativeConversion.scopeActive'
  | 'modals.negativeConversion.scopeAll'
  | 'modals.negativeConversion.scopeReady';
type QcDecisionLabelKey =
  | 'modals.negativeConversion.qcDecisionApproved'
  | 'modals.negativeConversion.qcDecisionPending'
  | 'modals.negativeConversion.qcDecisionRejected';
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
const DEFAULT_SAVE_OPTIONS = {
  outputFormat: NegativeLabOutputFormatId.Tiff16 as NegativeOutputFormat,
  suffix: 'Positive',
  writeConversionBundle: true,
};
const CUSTOM_BASE_SAMPLE_DEFAULT = {
  height: 0.18,
  width: 0.18,
  x: 0.25,
  y: 0.25,
} satisfies NegativeLabBaseFogSampleRect;
const NEGATIVE_LAB_WORKSPACE_UI_SCHEMA_VERSION = 1 satisfies NegativeLabWorkspaceProof['schemaVersion'];
const getInitialIncludedPaths = (paths: string[]) => new Set(paths);
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
const NEGATIVE_LAB_PROFILE_BROWSER_ROWS = buildNegativeLabProfileBrowserRows();
const NEGATIVE_LAB_PROFILE_BROWSER_ROW_BY_ID = new Map(
  NEGATIVE_LAB_PROFILE_BROWSER_ROWS.map((row) => [row.presetId, row]),
);
const NEGATIVE_LAB_STOCK_REGISTRY_COUNTS = buildNegativeLabStockRegistryCounts(NEGATIVE_LAB_STOCK_REGISTRY);
const NEGATIVE_LAB_STOCK_METADATA_COUNTS = buildNegativeLabStockMetadataCounts(NEGATIVE_LAB_STOCK_METADATA_CATALOG);
const formatStockRegistryToken = (value: string) => value.split('_').join(' ');
const getNegativeLabProfileSearchText = (profile: NegativeLabRuntimeProfileBrowserRow) =>
  [
    profile.claimLevel,
    profile.claimPolicy,
    profile.displayName,
    profile.filmClass,
    profile.measurementProfileId ?? '',
    profile.presetId,
    profile.processFamily,
    profile.profileStatus,
    profile.provenanceSummary,
    profile.runtimeStatus,
    profile.sourceGenericPresetId ?? '',
    String(profile.evidenceFixtureCount),
    String(profile.params.base_fog_strength),
    String(profile.params.black_point),
    String(profile.params.blue_weight),
    String(profile.params.contrast),
    String(profile.params.exposure),
    String(profile.params.green_weight),
    String(profile.params.red_weight),
    String(profile.params.white_point),
    ...profile.doesNotProve,
  ]
    .join(' ')
    .toLocaleLowerCase('en-US');
const matchesNegativeLabProfileFilter = (
  profile: NegativeLabRuntimeProfileBrowserRow,
  filter: NegativeLabProfileFilter,
) => {
  if (filter === 'all') return true;
  if (filter === 'measured') return profile.profileStatus === 'fixture_measured';
  return profile.filmClass === filter;
};
const compareNegativeLabProfileNames = (
  left: NegativeLabRuntimeProfileBrowserRow,
  right: NegativeLabRuntimeProfileBrowserRow,
) => left.displayName.localeCompare(right.displayName, 'en-US', { sensitivity: 'base' });
const sortNegativeLabProfiles = (
  profiles: Array<NegativeLabRuntimeProfileBrowserRow>,
  sortMode: NegativeLabProfileSort,
) => {
  if (sortMode === 'name_asc') {
    return profiles.toSorted(compareNegativeLabProfileNames);
  }

  if (sortMode === 'evidence_desc') {
    return profiles.toSorted(
      (left, right) =>
        right.evidenceFixtureCount - left.evidenceFixtureCount || compareNegativeLabProfileNames(left, right),
    );
  }

  if (sortMode === 'runtime_applied') {
    return profiles.toSorted((left, right) => {
      const leftScore = left.runtimeStatus === 'runtime_parameter_applied' ? 1 : 0;
      const rightScore = right.runtimeStatus === 'runtime_parameter_applied' ? 1 : 0;
      return rightScore - leftScore || compareNegativeLabProfileNames(left, right);
    });
  }

  return profiles;
};
const isNegativeLabProfileSort = (value: string): value is NegativeLabProfileSort =>
  NEGATIVE_LAB_PROFILE_SORTS.some((sort) => sort.id === value);
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
type NegativeLabFrameHealthFilter = 'all' | NegativeLabFrameWarningSeverity;
type NegativeLabFrameHealthSort = 'roll_order' | 'warning_severity';
const NEGATIVE_LAB_FRAME_HEALTH_FILTERS = ['all', 'review', 'info', 'ok'] satisfies Array<NegativeLabFrameHealthFilter>;
const NEGATIVE_LAB_FRAME_HEALTH_SORTS = ['roll_order', 'warning_severity'] satisfies Array<NegativeLabFrameHealthSort>;
const FRAME_WARNING_SEVERITY_SCORE = {
  info: 1,
  ok: 0,
  review: 2,
} satisfies Record<NegativeLabFrameWarningSeverity, number>;
const getNegativeLabFrameWarningCount = (frame: NegativeLabFrameHealthEntry) =>
  frame.warningCodes.length + frame.acquisitionWarningCodes.length;
const ACQUISITION_SOURCE_FAMILY_LABEL_KEYS = {
  jpeg_lossy: 'modals.negativeConversion.acquisitionSourceJpeg',
  raw_like: 'modals.negativeConversion.acquisitionSourceRaw',
  tiff_scan: 'modals.negativeConversion.acquisitionSourceTiff',
  unknown: 'modals.negativeConversion.acquisitionSourceUnknown',
} satisfies Record<NegativeLabAcquisitionSourceFamily, AcquisitionSourceFamilyLabelKey>;
const ACQUISITION_WARNING_LABEL_KEYS = {
  lab_processed_input_for_negative_lab: 'modals.negativeConversion.acquisitionWarningLabProcessed',
  lossy_source_for_negative_lab: 'modals.negativeConversion.acquisitionWarningLossy',
  mixed_source_families: 'modals.negativeConversion.acquisitionWarningMixed',
  unknown_acquisition_state: 'modals.negativeConversion.acquisitionWarningUnknown',
} satisfies Record<NegativeLabAcquisitionWarningCode, AcquisitionWarningLabelKey>;
const BATCH_DISPOSITION_LABEL_KEYS = {
  apply: 'modals.negativeConversion.batchDispositionApply',
  review: 'modals.negativeConversion.batchDispositionReview',
  skip: 'modals.negativeConversion.batchDispositionSkip',
} satisfies Record<NegativeLabFrameHealthEntry['batchDisposition'], BatchDispositionLabelKey>;
const BATCH_DISPOSITION_REASON_LABEL_KEYS = {
  acquisition_review_required: 'modals.negativeConversion.batchDispositionReasonAcquisition',
  base_not_estimated: 'modals.negativeConversion.batchDispositionReasonBase',
  excluded_from_batch: 'modals.negativeConversion.batchDispositionReasonExcluded',
  preview_required: 'modals.negativeConversion.batchDispositionReasonPreview',
  ready_to_apply: 'modals.negativeConversion.batchDispositionReasonReady',
} satisfies Record<NegativeLabFrameHealthEntry['batchDispositionReason'], BatchDispositionReasonLabelKey>;
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
const QC_DECISION_LABEL_KEYS = {
  approved: 'modals.negativeConversion.qcDecisionApproved',
  pending: 'modals.negativeConversion.qcDecisionPending',
  rejected: 'modals.negativeConversion.qcDecisionRejected',
} satisfies Record<NegativeLabQcDecision, QcDecisionLabelKey>;
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
const isNegativeLabFrameHealthFilter = (value: string): value is NegativeLabFrameHealthFilter =>
  NEGATIVE_LAB_FRAME_HEALTH_FILTERS.some((filter) => filter === value);
const isNegativeLabFrameHealthSort = (value: string): value is NegativeLabFrameHealthSort =>
  NEGATIVE_LAB_FRAME_HEALTH_SORTS.some((sort) => sort === value);
const BASE_FOG_SAMPLE_PRESETS = [
  {
    labelKey: 'modals.negativeConversion.sampleLeftEdge',
    rect: { height: 0.6, width: 0.12, x: 0.02, y: 0.2 },
  },
  {
    labelKey: 'modals.negativeConversion.sampleCenterPatch',
    rect: { height: 0.22, width: 0.22, x: 0.39, y: 0.39 },
  },
] satisfies Array<{ labelKey: BaseFogSampleLabelKey; rect: NegativeLabBaseFogSampleRect }>;
const DENSITOMETER_PATCH_PRESETS = [
  {
    labelKey: 'modals.negativeConversion.sampleLeftEdge',
    rect: { height: 0.6, width: 0.12, x: 0.02, y: 0.2 },
    testId: 'negative-lab-patch-probe-left-edge',
  },
  {
    labelKey: 'modals.negativeConversion.sampleCenterPatch',
    rect: { height: 0.22, width: 0.22, x: 0.39, y: 0.39 },
    testId: 'negative-lab-patch-probe-center-patch',
  },
  {
    labelKey: 'modals.negativeConversion.sampleShadowPatch',
    rect: { height: 0.18, width: 0.18, x: 0.18, y: 0.62 },
    testId: 'negative-lab-patch-probe-shadow-patch',
  },
  {
    labelKey: 'modals.negativeConversion.sampleHighlightPatch',
    rect: { height: 0.16, width: 0.16, x: 0.66, y: 0.18 },
    testId: 'negative-lab-patch-probe-highlight-patch',
  },
] satisfies Array<{ labelKey: DensitometerPatchLabelKey; rect: NegativeLabBaseFogSampleRect; testId: string }>;

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
  onSave: (savedPaths: string[]) => void;
}

interface BaseFogSampleUndoEntry {
  activeBaseFogSampleLabel: string | null;
  baseFogConfidence: number | null;
  baseFogEstimate: NegativeBaseFogEstimate | null;
  baseFogPreviewProof: NegativeLabBaseSamplePreviewProof | null;
  baseFogScope: 'frame' | 'roll';
  baseSampleStudioDecision: NegativeLabBaseSampleStudioDecision;
  params: NegativeParams;
  selectedPresetId: string;
}

export function NegativeConversionModal({ isOpen, onClose, targetPaths, onSave }: NegativeConversionModalProps) {
  const { t } = useTranslation();
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
  const [activeBaseFogSampleLabel, setActiveBaseFogSampleLabel] = useState<string | null>(null);
  const [baseFogScope, setBaseFogScope] = useState<'frame' | 'roll'>('frame');
  const [baseFogSampleUndoStack, setBaseFogSampleUndoStack] = useState<BaseFogSampleUndoEntry[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [saveOptions, setSaveOptions] = useState(DEFAULT_SAVE_OPTIONS);
  const [conversionScope, setConversionScope] = useState<NegativeConversionScope>('all');
  const [includedPathSet, setIncludedPathSet] = useState<Set<string>>(() => getInitialIncludedPaths(targetPaths));
  const [activePathIndex, setActivePathIndex] = useState(0);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [profileFilter, setProfileFilter] = useState<NegativeLabProfileFilter>('all');
  const [profileSort, setProfileSort] = useState<NegativeLabProfileSort>('catalog');
  const [frameHealthFilter, setFrameHealthFilter] = useState<NegativeLabFrameHealthFilter>('all');
  const [frameHealthSort, setFrameHealthSort] = useState<NegativeLabFrameHealthSort>('roll_order');
  const [qcDecisionByFrameId, setQcDecisionByFrameId] = useState<Record<string, NegativeLabQcDecision>>({});
  const [cropStatusByFrameId, setCropStatusByFrameId] = useState<Record<string, NegativeLabFrameCropStatus>>({});
  const [frameExposureOffsetByFrameId, setFrameExposureOffsetByFrameId] = useState<Record<string, number>>({});
  const [frameRgbBalanceOffsetByFrameId, setFrameRgbBalanceOffsetByFrameId] = useState<
    Record<string, NegativeLabFrameRgbBalanceOffset>
  >({});

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
  const selectedProfile = useMemo(
    () => NEGATIVE_LAB_PROFILE_BROWSER_ROWS.find((profile) => profile.presetId === selectedPresetId) ?? null,
    [selectedPresetId],
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
  const normalizedProfileSearchQuery = profileSearchQuery.trim().toLocaleLowerCase('en-US');
  const profileFilterCounts = useMemo(
    () =>
      NEGATIVE_LAB_PROFILE_FILTERS.reduce<Record<NegativeLabProfileFilter, number>>(
        (counts, filter) => ({
          ...counts,
          [filter.id]: NEGATIVE_LAB_PROFILE_BROWSER_ROWS.filter((profile) =>
            matchesNegativeLabProfileFilter(profile, filter.id),
          ).length,
        }),
        {
          all: 0,
          black_and_white_silver: 0,
          color_negative: 0,
          measured: 0,
        },
      ),
    [],
  );
  const visibleProfileRows = useMemo(() => {
    const filteredProfiles = NEGATIVE_LAB_PROFILE_BROWSER_ROWS.filter((profile) => {
      if (!matchesNegativeLabProfileFilter(profile, profileFilter)) {
        return false;
      }

      if (normalizedProfileSearchQuery.length === 0) {
        return true;
      }

      return getNegativeLabProfileSearchText(profile).includes(normalizedProfileSearchQuery);
    });

    return sortNegativeLabProfiles(filteredProfiles, profileSort);
  }, [normalizedProfileSearchQuery, profileFilter, profileSort]);
  const selectedProfileStockReferences = useMemo(() => {
    if (selectedProfile === null) return [];
    return listNegativeLabStockMetadataReferencesForPreset(
      selectedProfile.sourceGenericPresetId ?? selectedProfile.presetId,
    );
  }, [selectedProfile]);
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
  const dustScratchReviewReport = useMemo(
    () => buildNegativeLabDustScratchReviewReport(frameHealthReport, previewUrl !== null),
    [frameHealthReport, previewUrl],
  );
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
          qcDecisions: qcDecisionByFrameId,
          rollNormalizationPlan,
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
      qcDecisionByFrameId,
      rollNormalizationPlan,
      selectedProfileSnapshot,
    ],
  );
  const acceptedBatchPlanIdentity = useMemo(() => {
    if (selectedProfileSnapshot === null) {
      return buildNegativeLabAcceptedPlanIdentity(batchDryRunPlanJson);
    }
    return buildNegativeLabProfileBoundPlanIdentity(batchDryRunSummaryJson, selectedProfileSnapshot);
  }, [batchDryRunPlanJson, batchDryRunSummaryJson, selectedProfileSnapshot]);
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
  const requiresAcceptedBatchPlan = hasMultipleScans && conversionScope !== 'active';
  const canSave =
    !isSaving &&
    !isLoading &&
    previewUrl !== null &&
    pathsToConvert.length > 0 &&
    (!requiresAcceptedBatchPlan || isBatchPlanAccepted);
  const qcProofReport = useMemo(
    () =>
      buildNegativeLabQcProofReport(
        dustScratchReviewReport,
        previewUrl !== null,
        canSave && pathsToConvert.length === targetPaths.length,
      ),
    [canSave, dustScratchReviewReport, pathsToConvert.length, previewUrl, targetPaths.length],
  );
  const qcProofArtifact = useMemo(() => {
    const sourcePathsByFrameId = new Map(
      frameHealthReport.frames.map((frame) => [frame.frameId, frame.sourcePath] as const),
    );

    return buildNegativeLabQcContactSheetArtifact({
      report: qcProofReport,
      sessionId: `negative_lab_session_${targetPaths.length}_${pathsToConvert.length}`,
      sourcePathsByFrameId,
    });
  }, [frameHealthReport.frames, pathsToConvert.length, qcProofReport, targetPaths.length]);
  const activePositiveVariant = useMemo(
    () =>
      qcProofArtifact.positiveVariants.find((variant) => variant.frameId === frameHealthReport.activeFrameId) ??
      qcProofArtifact.positiveVariants[0] ??
      null,
    [frameHealthReport.activeFrameId, qcProofArtifact.positiveVariants],
  );
  const workspaceProof = useMemo(
    (): NegativeLabWorkspaceProof => ({
      activeStage: canSave ? 'export' : previewUrl === null ? 'colorInversion' : 'inspection',
      exportReady: canSave,
      previewReady: previewUrl !== null,
      queuedCount: pathsToConvert.length,
      reviewReport: dustScratchReviewReport,
      schemaVersion: NEGATIVE_LAB_WORKSPACE_UI_SCHEMA_VERSION,
      targetCount: targetPaths.length,
    }),
    [canSave, dustScratchReviewReport, pathsToConvert.length, previewUrl, targetPaths.length],
  );

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
        isComplete: true,
        label: t('modals.negativeConversion.workflowColorTiming'),
      },
      {
        detail: t('modals.negativeConversion.workflowInspectionDetail', {
          reviewCount: dustScratchReviewReport.reviewCount,
          retouchCount: dustScratchReviewReport.retouchCount,
        }),
        id: 'inspection',
        isComplete: previewUrl !== null && dustScratchReviewReport.retouchCount === 0,
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
        isComplete: !isLoading && previewUrl !== null && pathsToConvert.length > 0,
        label: t('modals.negativeConversion.workflowExport'),
      },
    ],
    [
      isLoading,
      isSaving,
      params,
      pathsToConvert.length,
      previewUrl,
      saveOptions.outputFormat,
      selectedProfile,
      dustScratchReviewReport.reviewCount,
      dustScratchReviewReport.retouchCount,
      t,
      targetPaths.length,
    ],
  );

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
      setIsLoading(true);
      setProgress(null);
      setSaveOptions(DEFAULT_SAVE_OPTIONS);
      setConversionScope('all');
      setIncludedPathSet(getInitialIncludedPaths(targetPaths));
      setFrameExposureOffsetByFrameId({});
      setFrameRgbBalanceOffsetByFrameId({});
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
    if (baseFogConfidence === null || baseFogScope === 'roll') return;
    pushBaseFogSampleUndoEntry();
    setBaseFogScope('roll');
    setBaseSampleStudioDecision('accepted');
    setAcceptedBatchPlanJson(null);
  };

  const handleAcceptBaseSample = () => {
    if (baseFogConfidence === null) return;
    setBaseSampleStudioDecision('accepted');
    setRejectedBaseSampleLabel(null);
  };

  const handleRejectBaseSample = () => {
    if (activeBaseFogSampleLabel === null) return;
    const rejectedLabel = activeBaseFogSampleLabel;
    handleUndoBaseFogSample();
    setRejectedBaseSampleLabel(rejectedLabel);
    setBaseSampleStudioDecision('rejected');
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
  };

  const handleApplyRollNormalizationPlan = () => {
    if (rollNormalizationPlan.affectedFrameIds.length === 0) return;

    const exposureOverrideFrameIds = new Set(
      rollNormalizationPlan.exposureOverrides.overrides.map((override) => override.frameId),
    );
    const nextExposureOffsets = Object.fromEntries(
      Object.entries(frameExposureOffsetByFrameId).filter(([frameId]) => !exposureOverrideFrameIds.has(frameId)),
    );
    for (const override of rollNormalizationPlan.exposureOverrides.overrides) {
      const snappedOffset = snapNegativeLabFrameExposureOffset(override.exposureOffset);
      if (snappedOffset !== 0) {
        nextExposureOffsets[override.frameId] = snappedOffset;
      }
    }

    const rgbOverrideFrameIds = new Set(
      rollNormalizationPlan.rgbBalanceOverrides.overrides.map((override) => override.frameId),
    );
    const nextRgbOffsetsByFrameId = Object.fromEntries(
      Object.entries(frameRgbBalanceOffsetByFrameId).filter(([frameId]) => !rgbOverrideFrameIds.has(frameId)),
    );
    for (const override of rollNormalizationPlan.rgbBalanceOverrides.overrides) {
      const snappedOffset = snapNegativeLabFrameRgbBalanceOffsets({
        baselineParams: params,
        offsets: override.rgbBalanceOffset,
      });
      if (!negativeLabFrameRgbBalanceOffsetIsZero(snappedOffset)) {
        nextRgbOffsetsByFrameId[override.frameId] = snappedOffset;
      }
    }

    setFrameExposureOffsetByFrameId(nextExposureOffsets);
    setFrameRgbBalanceOffsetByFrameId(nextRgbOffsetsByFrameId);
    setAcceptedBatchPlanJson(null);
    updatePreview(
      buildParamsWithFrameOverrides(
        params,
        frameHealthReport.activeFrameId,
        nextExposureOffsets,
        nextRgbOffsetsByFrameId,
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
    if (
      frameHealthReport.activeFrameId === null ||
      neutralPatchSuggestion === null ||
      !neutralPatchSuggestion.applyAllowed
    )
      return;
    const nextOffset = snapNegativeLabFrameRgbBalanceOffsets({
      baselineParams: params,
      offsets: neutralPatchSuggestion.suggestedRgbBalanceOffset,
    });
    const nextOffsetsByFrameId = negativeLabFrameRgbBalanceOffsetIsZero(nextOffset)
      ? Object.fromEntries(
          Object.entries(frameRgbBalanceOffsetByFrameId).filter(([key]) => key !== frameHealthReport.activeFrameId),
        )
      : { ...frameRgbBalanceOffsetByFrameId, [frameHealthReport.activeFrameId]: nextOffset };
    setFrameRgbBalanceOffsetByFrameId(nextOffsetsByFrameId);
    setAcceptedBatchPlanJson(null);
    updatePreview(
      buildParamsWithFrameOverrides(
        params,
        frameHealthReport.activeFrameId,
        frameExposureOffsetByFrameId,
        nextOffsetsByFrameId,
      ),
    );
  };

  const handleApplyHighlightPatchExposureSuggestion = () => {
    if (
      frameHealthReport.activeFrameId === null ||
      highlightPatchExposureSuggestion === null ||
      !highlightPatchExposureSuggestion.applyAllowed
    )
      return;
    handleFrameExposureOffsetChange(
      frameHealthReport.activeFrameId,
      highlightPatchExposureSuggestion.suggestedFrameExposureOffset,
    );
  };

  const handleApplyShadowPatchBlackPointSuggestion = () => {
    if (shadowPatchBlackPointSuggestion === null || !shadowPatchBlackPointSuggestion.applyAllowed) return;
    const nextParams = {
      ...params,
      black_point: Number(
        Math.min(shadowPatchBlackPointSuggestion.projectedBlackPoint, params.white_point - 0.05).toFixed(2),
      ),
    };
    setSelectedPresetId('');
    setParams(nextParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(buildParamsWithFrameOverrides(nextParams));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    setProgress(null);
    try {
      const savedPaths = await invokeWithSchema(
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
            omittedDispositionFrameIds,
            qcApprovedFrameIds: approvedQcFrameIds,
            qcRejectedFrameIds: rejectedQcFrameIds,
            reviewFrameIds: batchDryRunSummary.reviewFrameIds,
            acquisitionSourceFamilies: frameHealthReport.acquisitionHealth.sourceFamilies,
            acquisitionWarningCodes: frameHealthReport.acquisitionHealth.warningCodes,
            ...(selectedProfileProvenanceHash === null ? {} : { profileProvenanceHash: selectedProfileProvenanceHash }),
            ...(selectedProfileSnapshot === null ? {} : { selectedProfile: selectedProfileSnapshot }),
          },
        },
        negativeConversionSavedPathsSchema,
      );
      onSave(savedPaths);
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
          data-active-frame-id={frameHealthReport.activeFrameId ?? ''}
          data-preview-ready={String(previewUrl !== null)}
          data-testid="negative-lab-roll-frame-navigator"
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
            data-active-frame-id={activeFrame?.frameId ?? ''}
            data-base-scope={baseFogScope}
            data-base-status={activeFrame?.baseStatus ?? 'pending'}
            data-export-ready={String(workspaceProof.exportReady)}
            data-planned-apply-count={batchDryRunSummary.plannedApplyCount}
            data-profile-id={selectedProfile?.presetId ?? 'custom'}
            data-review-frame-count={batchDryRunSummary.reviewFrameIds.length}
            data-testid="negative-lab-roll-queue-summary"
            data-warning-count={activeFrame === null ? 0 : getNegativeLabFrameWarningCount(activeFrame)}
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
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" data-testid="negative-lab-roll-frame-strip">
              {frameHealthReport.frames.map((frame, index) => {
                const framePreviewReady = frame.active && previewUrl !== null;

                return (
                  <button
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
                        {framePreviewReady
                          ? t('modals.negativeConversion.previewReady')
                          : t('modals.negativeConversion.previewPending')}
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
        data-acquisition-severity={acquisitionHealth.severity}
        data-lossy-count={acquisitionHealth.lossyCount}
        data-raw-like-count={acquisitionHealth.rawLikeCount}
        data-tiff-scan-count={acquisitionHealth.tiffScanCount}
        data-unknown-count={acquisitionHealth.unknownCount}
        data-warning-count={acquisitionHealth.warningCodes.length}
        data-warning-codes={acquisitionHealth.warningCodes.join(',')}
        data-testid="negative-lab-acquisition-health"
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
      data-preflight-basis="path_extension_only"
      data-testid="negative-lab-scan-input-guidance"
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

  const renderBatchReadiness = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      data-planned-apply-count={batchDryRunSummary.plannedApplyCount}
      data-review-count={dustScratchReviewReport.reviewCount}
      data-roll-normalization-affected-count={rollNormalizationPlan.affectedFrameIds.length}
      data-roll-normalization-exposure-delta={rollNormalizationPlan.proposedExposureDeltaEv}
      data-roll-normalization-mode={rollNormalizationPlan.mode}
      data-roll-normalization-positive-count={rollNormalizationPlan.positiveVariantIds.length}
      data-roll-normalization-unaffected-count={rollNormalizationPlan.unaffectedFrameIds.length}
      data-roll-normalization-white-balance-delta={rollNormalizationPlan.proposedWhiteBalanceDelta}
      data-skipped-frame-count={batchDryRunSummary.skippedFrameIds.length}
      data-testid="negative-lab-batch-readiness"
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
          {previewUrl === null
            ? t('modals.negativeConversion.previewPending')
            : t('modals.negativeConversion.previewReady')}
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
      {frameHealthReport.frames.length > 0 && (
        <div className="space-y-1" data-testid="negative-lab-frame-health-grid">
          <div className="flex items-center justify-between gap-2">
            <UiText variant={TextVariants.small} className="text-text-tertiary">
              {t('modals.negativeConversion.frameHealth')}
            </UiText>
            <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
              <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-frame-count">
                {t('modals.negativeConversion.frameHealthFrameCount', { frameCount: frameHealthReport.frames.length })}
              </span>
              <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-roll-warning-count">
                {t('modals.negativeConversion.frameHealthWarningCount', {
                  warningCount: rollWarningCount,
                })}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[11px] text-text-tertiary">
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-planned-apply-count">
              {t('modals.negativeConversion.batchPlanApplyCount', {
                applyCount: batchDryRunSummary.plannedApplyCount,
              })}
            </span>
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-skipped-frame-count">
              {t('modals.negativeConversion.batchPlanSkippedCount', {
                skippedCount: batchDryRunSummary.skippedFrameIds.length,
              })}
            </span>
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-review-frame-count">
              {t('modals.negativeConversion.batchPlanReviewCount', {
                reviewCount: batchDryRunSummary.reviewFrameIds.length,
              })}
            </span>
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-approved-count">
              {t('modals.negativeConversion.qcApprovedCount', {
                approvedCount: approvedQcFrameIds.length,
              })}
            </span>
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-rejected-count">
              {t('modals.negativeConversion.qcRejectedCount', {
                rejectedCount: rejectedQcFrameIds.length,
              })}
            </span>
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-batch-workload-summary">
              {t('modals.negativeConversion.batchWorkloadSummary', {
                applyCount: batchDryRunSummary.plannedApplyCount,
                reviewCount: dustScratchReviewReport.reviewCount,
                skippedCount: batchDryRunSummary.skippedFrameIds.length,
              })}
            </span>
            <span
              className="col-span-3 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary"
              data-testid="negative-lab-roll-normalization-plan"
            >
              {`${rollNormalizationPlan.affectedFrameIds.length} frames ${rollNormalizationPlan.proposedExposureDeltaEv >= 0 ? '+' : ''}${rollNormalizationPlan.proposedExposureDeltaEv.toFixed(2)} EV / WB ${rollNormalizationPlan.proposedWhiteBalanceDelta.toFixed(2)}`}
            </span>
            <button
              type="button"
              className="col-span-3 inline-flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="negative-lab-apply-roll-normalization"
              disabled={rollNormalizationPlan.affectedFrameIds.length === 0}
              onClick={handleApplyRollNormalizationPlan}
            >
              <WandSparkles size={11} />
              {t('modals.negativeConversion.applyRollNormalizationPlan')}
            </button>
            <button
              type="button"
              className="col-span-3 inline-flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface"
              data-testid="negative-lab-copy-batch-plan"
              onClick={() => {
                void handleCopyBatchPlan();
              }}
            >
              <Copy size={11} />
              {isBatchPlanCopied
                ? t('modals.negativeConversion.batchPlanCopied')
                : t('modals.negativeConversion.copyBatchPlan')}
            </button>
            <button
              type="button"
              className={cx(
                'col-span-3 inline-flex items-center justify-center rounded px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                isBatchPlanAccepted
                  ? 'bg-accent/15 text-text-primary'
                  : 'bg-bg-secondary text-text-secondary hover:bg-surface',
              )}
              data-testid="negative-lab-accept-batch-plan"
              disabled={batchDryRunSummary.blocked}
              onClick={handleAcceptBatchPlan}
            >
              {isBatchPlanAccepted
                ? t('modals.negativeConversion.batchPlanAccepted')
                : t('modals.negativeConversion.acceptBatchPlan')}
            </button>
          </div>
          <div
            className="grid grid-cols-2 gap-2 rounded-sm bg-bg-secondary p-2 text-[11px]"
            data-filter={frameHealthFilter}
            data-sort={frameHealthSort}
            data-testid="negative-lab-frame-health-controls"
          >
            <label className="space-y-1">
              <span className="block text-text-tertiary">
                {t('modals.negativeConversion.frameHealthSeverityFilter')}
              </span>
              <select
                className="w-full rounded border border-surface bg-bg-primary px-2 py-1 text-text-secondary"
                data-testid="negative-lab-frame-health-filter"
                onChange={(event) => {
                  if (isNegativeLabFrameHealthFilter(event.target.value)) {
                    setFrameHealthFilter(event.target.value);
                  }
                }}
                value={frameHealthFilter}
              >
                {NEGATIVE_LAB_FRAME_HEALTH_FILTERS.map((filter) => (
                  <option key={filter} value={filter}>
                    {t(`modals.negativeConversion.frameHealthFilter.${filter}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-text-tertiary">{t('modals.negativeConversion.frameHealthSort')}</span>
              <select
                className="w-full rounded border border-surface bg-bg-primary px-2 py-1 text-text-secondary"
                data-testid="negative-lab-frame-health-sort"
                onChange={(event) => {
                  if (isNegativeLabFrameHealthSort(event.target.value)) {
                    setFrameHealthSort(event.target.value);
                  }
                }}
                value={frameHealthSort}
              >
                {NEGATIVE_LAB_FRAME_HEALTH_SORTS.map((sort) => (
                  <option key={sort} value={sort}>
                    {t(`modals.negativeConversion.frameHealthSortModes.${sort}`)}
                  </option>
                ))}
              </select>
            </label>
            <span className="col-span-2 text-text-tertiary" data-testid="negative-lab-frame-health-visible-count">
              {t('modals.negativeConversion.frameHealthVisibleCount', {
                total: frameHealthReport.frames.length,
                visibleCount: visibleFrameHealthRows.length,
              })}
            </span>
            <div
              className="col-span-2 grid grid-cols-3 gap-1"
              data-visible-frame-count={visibleFrameHealthRows.length}
              data-testid="negative-lab-qc-visible-actions"
            >
              {(
                [
                  {
                    decision: 'approved',
                    label: t('modals.negativeConversion.qcDecisionApproveVisible', {
                      count: visibleFrameHealthRows.length,
                    }),
                    testId: 'negative-lab-qc-approved-visible',
                  },
                  {
                    decision: 'rejected',
                    label: t('modals.negativeConversion.qcDecisionRejectVisible', {
                      count: visibleFrameHealthRows.length,
                    }),
                    testId: 'negative-lab-qc-rejected-visible',
                  },
                  {
                    decision: 'pending',
                    label: t('modals.negativeConversion.qcDecisionResetVisible', {
                      count: visibleFrameHealthRows.length,
                    }),
                    testId: 'negative-lab-qc-pending-visible',
                  },
                ] satisfies Array<{
                  decision: NegativeLabQcDecision;
                  label: string;
                  testId: string;
                }>
              ).map(({ decision, label, testId }) => (
                <button
                  className="rounded bg-bg-primary px-1.5 py-1 text-text-tertiary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={testId}
                  disabled={visibleFrameHealthRows.length === 0}
                  key={decision}
                  onClick={() => {
                    handleSetVisibleQcDecision(decision);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1">
            {visibleFrameHealthRows.map((row: NegativeLabFrameHealthEntry, index) => (
              <div
                className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto_auto_auto] items-center gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
                data-acquisition-source={row.acquisitionSourceFamily}
                data-conversion-status={row.conversionStatus}
                data-crop-status={row.cropStatus}
                data-disposition={row.batchDisposition}
                data-qc-status={row.qcStatus}
                data-severity={row.warningSeverity}
                data-warning-count={getNegativeLabFrameWarningCount(row)}
                data-testid={`negative-lab-frame-health-row-${index}`}
                key={row.frameId}
              >
                <span className="truncate text-text-secondary">{row.scanLabel}</span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5',
                    row.acquisitionWarningCodes.length > 0
                      ? 'bg-yellow-500/15 text-yellow-200'
                      : 'bg-surface text-text-secondary',
                  )}
                  data-testid={`negative-lab-frame-source-${index}`}
                >
                  {t(ACQUISITION_SOURCE_FAMILY_LABEL_KEYS[row.acquisitionSourceFamily])}
                </span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5',
                    row.warningSeverity === 'review' && 'bg-yellow-500/15 text-yellow-200',
                    row.warningSeverity === 'info' && 'bg-blue-500/15 text-blue-200',
                    row.warningSeverity === 'ok' && 'bg-surface text-text-secondary',
                  )}
                  data-testid={`negative-lab-frame-severity-${index}`}
                >
                  {t(`modals.negativeConversion.frameWarningSeverity.${row.warningSeverity}`)}
                </span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5',
                    row.healthStatus === 'active' && 'bg-accent/15 text-text-primary',
                    row.healthStatus === 'queued' && 'bg-surface text-text-secondary',
                    row.healthStatus === 'skipped' && 'bg-bg-primary text-text-tertiary',
                  )}
                  data-testid={`negative-lab-frame-health-status-${index}`}
                >
                  {t(
                    row.healthStatus === 'skipped'
                      ? 'modals.negativeConversion.frameHealthSkipped'
                      : row.healthStatus === 'active'
                        ? 'modals.negativeConversion.frameHealthActive'
                        : 'modals.negativeConversion.frameHealthQueued',
                  )}
                </span>
                <span className="text-text-tertiary">
                  {row.baseStatus === 'estimated' && row.baseConfidence !== null
                    ? t(
                        row.baseScope === 'roll'
                          ? 'modals.negativeConversion.baseReadyRoll'
                          : 'modals.negativeConversion.baseReadyFrame',
                        { confidence: Math.round(row.baseConfidence * 100) },
                      )
                    : t('modals.negativeConversion.basePending')}
                </span>
                <span
                  className="flex items-center gap-1 text-text-tertiary"
                  data-testid={`negative-lab-frame-crop-status-${index}`}
                >
                  <span>{t(`modals.negativeConversion.frameCropStatus.${row.cropStatus}`)}</span>
                  {row.active && (
                    <span className="inline-flex gap-1" data-testid="negative-lab-active-frame-crop-actions">
                      <button
                        className="rounded bg-bg-primary px-1 py-0.5 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="negative-lab-accept-detected-crop"
                        disabled={isSaving}
                        onClick={() => {
                          handleSetActiveFrameCropStatus('detected_frame');
                        }}
                        type="button"
                      >
                        {t('modals.negativeConversion.acceptDetectedCrop')}
                      </button>
                      <button
                        className="rounded bg-bg-primary px-1 py-0.5 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="negative-lab-set-manual-crop"
                        disabled={isSaving}
                        onClick={() => {
                          handleSetActiveFrameCropStatus('manual_override');
                        }}
                        type="button"
                      >
                        {t('modals.negativeConversion.manualCrop')}
                      </button>
                      <button
                        className="rounded bg-bg-primary px-1 py-0.5 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="negative-lab-reset-frame-crop"
                        disabled={isSaving || row.cropStatus === 'active_frame_editable'}
                        onClick={() => {
                          handleSetActiveFrameCropStatus('active_frame_editable');
                        }}
                        type="button"
                      >
                        {t('modals.negativeConversion.resetFrameCrop')}
                      </button>
                    </span>
                  )}
                </span>
                <span className="text-text-tertiary" data-testid={`negative-lab-frame-conversion-status-${index}`}>
                  {t(`modals.negativeConversion.frameConversionStatus.${row.conversionStatus}`)}
                </span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5',
                    row.batchDisposition === 'apply' && 'bg-accent/15 text-text-primary',
                    row.batchDisposition === 'review' && 'bg-yellow-500/15 text-yellow-200',
                    row.batchDisposition === 'skip' && 'bg-bg-primary text-text-tertiary',
                  )}
                  data-testid={`negative-lab-frame-disposition-${index}`}
                  title={t(BATCH_DISPOSITION_REASON_LABEL_KEYS[row.batchDispositionReason])}
                >
                  {t(BATCH_DISPOSITION_LABEL_KEYS[row.batchDisposition])}
                </span>
                <span className="text-text-tertiary" data-testid={`negative-lab-frame-qc-status-${index}`}>
                  {t(`modals.negativeConversion.frameQcStatus.${row.qcStatus}`)}
                </span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5 tabular-nums',
                    snapNegativeLabFrameExposureOffset(frameExposureOffsetByFrameId[row.frameId] ?? 0) === 0
                      ? 'bg-bg-primary text-text-tertiary'
                      : 'bg-blue-500/15 text-blue-200',
                  )}
                  data-exposure-offset={snapNegativeLabFrameExposureOffset(
                    frameExposureOffsetByFrameId[row.frameId] ?? 0,
                  )}
                  data-testid={`negative-lab-frame-exposure-override-${index}`}
                >
                  {formatSignedRecipeValue(
                    snapNegativeLabFrameExposureOffset(frameExposureOffsetByFrameId[row.frameId] ?? 0),
                  )}
                </span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5 tabular-nums',
                    negativeLabFrameRgbBalanceOffsetIsZero(
                      snapNegativeLabFrameRgbBalanceOffsets({
                        baselineParams: params,
                        offsets: frameRgbBalanceOffsetByFrameId[row.frameId],
                      }),
                    )
                      ? 'bg-bg-primary text-text-tertiary'
                      : 'bg-fuchsia-500/15 text-fuchsia-200',
                  )}
                  data-testid={`negative-lab-frame-rgb-balance-override-${index}`}
                >
                  {negativeLabFrameRgbBalanceOffsetIsZero(
                    snapNegativeLabFrameRgbBalanceOffsets({
                      baselineParams: params,
                      offsets: frameRgbBalanceOffsetByFrameId[row.frameId],
                    }),
                  )
                    ? 'RGB 0.00'
                    : `RGB ${formatSignedRecipeValue(
                        snapNegativeLabFrameRgbBalanceOffsets({
                          baselineParams: params,
                          offsets: frameRgbBalanceOffsetByFrameId[row.frameId],
                        }).redWeight,
                      )}`}
                </span>
                <span
                  className="col-span-10 flex flex-wrap items-center gap-1 text-[11px]"
                  data-qc-decision={qcDecisionByFrameId[row.frameId] ?? 'pending'}
                  data-testid={`negative-lab-frame-qc-decision-${index}`}
                >
                  <span className="mr-1 text-text-tertiary">
                    {t(QC_DECISION_LABEL_KEYS[qcDecisionByFrameId[row.frameId] ?? 'pending'])}
                  </span>
                  {(['approved', 'rejected', 'pending'] satisfies Array<NegativeLabQcDecision>).map((decision) => (
                    <button
                      className={cx(
                        'rounded px-1.5 py-0.5 transition-colors',
                        (qcDecisionByFrameId[row.frameId] ?? 'pending') === decision
                          ? 'bg-accent/15 text-text-primary'
                          : 'bg-bg-primary text-text-tertiary hover:bg-surface',
                      )}
                      data-testid={`negative-lab-frame-qc-${decision}-${row.frameId}`}
                      key={decision}
                      onClick={() => {
                        handleSetQcDecision(row.frameId, decision);
                      }}
                      type="button"
                    >
                      {t(QC_DECISION_LABEL_KEYS[decision])}
                    </button>
                  ))}
                </span>
                {getNegativeLabFrameWarningCount(row) > 0 && (
                  <span
                    className="col-span-8 flex flex-wrap gap-1"
                    data-testid={`negative-lab-frame-warning-row-${index}`}
                  >
                    {row.warningCodes.map((warningCode) => (
                      <span
                        className="rounded bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-tertiary"
                        data-testid={`negative-lab-frame-warning-chip-${warningCode}`}
                        key={warningCode}
                      >
                        {warningCode === 'base_estimate_active_frame_only'
                          ? t('modals.negativeConversion.frameWarningBaseEstimateActiveOnly')
                          : warningCode === 'excluded_from_batch'
                            ? t('modals.negativeConversion.frameWarningExcluded')
                            : t('modals.negativeConversion.frameWarningPreviewNotReady')}
                      </span>
                    ))}
                    {row.acquisitionWarningCodes.map((warningCode) => (
                      <span
                        className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[11px] text-yellow-200"
                        data-testid={`negative-lab-frame-acquisition-warning-chip-${warningCode}`}
                        key={warningCode}
                      >
                        {t(ACQUISITION_WARNING_LABEL_KEYS[warningCode])}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderAgentActivityPanel = () => (
    <div
      className="rounded-md border border-surface bg-bg-primary p-2 text-[11px] text-text-tertiary"
      data-agent-command-source={agentCommandSource}
      data-agent-commit-state={agentCommitState}
      data-agent-dry-run-state={agentDryRunState}
      data-agent-plan-id={agentPlanId}
      data-agent-proof-hash={agentProofHash}
      data-agent-rollback-target={agentRollbackTarget}
      data-affected-frame-count={batchDryRunSummary.affectedFrameIds.length}
      data-testid="negative-lab-agent-activity"
      data-warning-count={rollWarningCount}
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
      </div>
    </div>
  );

  const renderDustScratchReview = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      data-testid="negative-lab-dust-review"
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
        </div>
      </div>
      <UiText variant={TextVariants.small} className="text-text-tertiary">
        {t('modals.negativeConversion.dustScratchReviewHint')}
      </UiText>
      <div className="space-y-1">
        {dustScratchReviewReport.frames.map((frame, index) => (
          <div
            className="grid grid-cols-[1fr_auto] gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
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
          </div>
        ))}
      </div>
    </div>
  );

  const renderQcProofReport = () => (
    <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2" data-testid="negative-lab-qc-proof">
      <div className="flex items-center justify-between gap-2">
        <UiText variant={TextVariants.small} className="font-medium text-text-primary">
          {t('modals.negativeConversion.qcProofReport')}
        </UiText>
        <div className="flex gap-1 text-[11px] text-text-tertiary">
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-proof-frame-count">
            {t('modals.negativeConversion.frameHealthFrameCount', { frameCount: qcProofReport.totalFrameCount })}
          </span>
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-proof-review-count">
            {t('modals.negativeConversion.dustReviewCount', { reviewCount: qcProofReport.reviewFrameCount })}
          </span>
        </div>
      </div>
      <UiText variant={TextVariants.small} className="text-text-tertiary">
        {t('modals.negativeConversion.qcProofHint')}
      </UiText>
      <div
        className="grid grid-cols-2 gap-1 rounded-sm bg-bg-secondary p-2 text-[11px] text-text-tertiary"
        data-contact-sheet-hash={qcProofArtifact.contactSheet.artifact.contentHash}
        data-testid="negative-lab-qc-proof-artifact"
      >
        <span>
          {t('modals.negativeConversion.qcProofArtifactHash', {
            hash: qcProofArtifact.contactSheet.artifact.contentHash,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactGrid', {
            columns: qcProofArtifact.contactSheet.columns,
            rows: qcProofArtifact.contactSheet.rows,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactWarnings', {
            warningCount: qcProofArtifact.warnings.length,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactVariants', {
            variantCount: qcProofArtifact.positiveVariants.length,
          })}
        </span>
      </div>
      <div
        className="grid gap-1"
        data-contact-sheet-columns={qcProofReport.contactSheetColumnCount}
        data-export-ready={qcProofReport.exportReady ? 'true' : 'false'}
      >
        {qcProofReport.frames.map((frame) => (
          <div
            className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
            data-blocked={frame.exportBlockedReason === null ? 'false' : 'true'}
            data-testid={`negative-lab-qc-proof-row-${frame.contactSheetSlot - 1}`}
            key={frame.frameId}
          >
            <span className="rounded bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-tertiary">
              {frame.contactSheetSlot}
            </span>
            <span className="min-w-0 truncate text-text-secondary">{frame.scanLabel}</span>
            <span
              className={cx(
                'rounded px-1.5 py-0.5',
                frame.needsReview ? 'bg-surface text-text-secondary' : 'bg-accent/15 text-text-primary',
              )}
            >
              {frame.needsReview
                ? t(DUST_SCRATCH_SEVERITY_LABEL_KEYS.review)
                : t('modals.negativeConversion.previewReady')}
            </span>
            <span className="col-span-3 text-[11px] text-text-tertiary">
              {frame.exportBlockedReason ?? frame.recommendedAction}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPositiveVariantHandoff = () => {
    if (activePositiveVariant === null) return null;

    const handoffReady = canSave && qcProofReport.exportReady && activePositiveVariant.warnings.length === 0;
    const baseScopeLabelKey =
      baseFogScope === 'roll' ? 'modals.negativeConversion.baseScopeRoll' : 'modals.negativeConversion.baseScopeFrame';
    const selectedProfileId = selectedProfile?.presetId ?? 'custom';
    const provenanceLink = qcProofArtifact.proofId;

    return (
      <div
        className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
        data-base-scope={baseFogScope}
        data-export-ready={handoffReady ? 'true' : 'false'}
        data-output-format={saveOptions.outputFormat}
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
        </div>
      </div>
    );
  };

  const renderControls = () => (
    <div className="modal-adjustments-pane w-80 shrink-0 bg-bg-secondary flex flex-col border-l border-surface h-full z-10">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText variant={TextVariants.title}>{t('modals.negativeConversion.title')}</UiText>
        <button
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
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
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
                  >
                    <button
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
                      aria-pressed={isIncludedScan}
                      className={cx(
                        'rounded px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        isIncludedScan
                          ? 'bg-accent/15 text-text-primary'
                          : 'bg-bg-primary text-text-secondary hover:bg-surface',
                      )}
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
            {hasMultipleScans && (
              <div className="grid grid-cols-3 gap-2" data-testid="negative-lab-conversion-scope">
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
                const isSelectableFamily =
                  mappedProfile !== null && mappedProfile !== undefined && mappedProfile.isSelectable;

                return (
                  <button
                    aria-current={isActiveFamily ? 'true' : undefined}
                    className={cx(
                      'rounded-md border p-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      isActiveFamily
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary',
                      isSelectableFamily && !isActiveFamily && 'hover:bg-surface',
                    )}
                    data-testid={`negative-lab-stock-family-${entry.registryId}`}
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
                      <span className="shrink-0 text-[10px] text-text-tertiary">
                        {formatStockRegistryToken(entry.claimTier)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-text-tertiary">
                      <span>{formatStockRegistryToken(entry.processFamily)}</span>
                      <span>{formatStockRegistryToken(entry.legalNamingStatus)}</span>
                      <span>{formatStockRegistryToken(entry.fixtureStatus)}</span>
                    </div>
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
                const isSuggestedProfileSelectable =
                  mappedProfile !== null && mappedProfile !== undefined && mappedProfile.isSelectable;

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
          <div
            className="mb-3 rounded-md border border-surface bg-bg-primary p-3"
            data-active-frame={profileComparisonRows[0]?.frameScope.activeFrameLabel ?? ''}
            data-candidate-count={profileComparisonRows.length}
            data-queued-count={profileComparisonRows[0]?.frameScope.queuedCount ?? 0}
            data-selected-profile-id={selectedProfile?.presetId ?? ''}
            data-selected-profile-provenance-hash={selectedProfileProvenanceHash ?? ''}
            data-testid="negative-lab-profile-comparison-matrix"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <UiText variant={TextVariants.small} className="font-semibold text-text-primary">
                  {t('modals.negativeConversion.workflowPreset')}
                </UiText>
                <UiText variant={TextVariants.small} className="text-text-tertiary">
                  {t('modals.negativeConversion.profileResultCount', {
                    totalCount: NEGATIVE_LAB_PROFILE_BROWSER_ROWS.length,
                    visibleCount: profileComparisonRows.length,
                  })}
                </UiText>
              </div>
              <span
                className="rounded border border-surface bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary"
                data-testid="negative-lab-profile-comparison-active-frame"
              >
                {profileComparisonRows[0]?.frameScope.activeFrameLabel ?? ''}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {profileComparisonRows.map((candidate) => {
                const profile = candidate.profile;
                const isSelected = selectedPresetId === profile.presetId;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={cx(
                      'rounded-md border p-2 text-left transition-colors',
                      isSelected
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    data-claim-policy={profile.claimPolicy}
                    data-comparison-preview={candidate.previewSwatch.deltaCss}
                    data-delta-summary={candidate.deltaSummary}
                    data-evidence-fixture-count={profile.evidenceFixtureCount}
                    data-profile-provenance-hash={candidate.selectedProfileSnapshot.profileProvenanceHash}
                    data-profile-status={profile.profileStatus}
                    data-runtime-status={profile.runtimeStatus}
                    data-selected={String(isSelected)}
                    data-testid={`negative-lab-profile-comparison-row-${profile.presetId}`}
                    key={profile.presetId}
                    onClick={() => {
                      handlePresetSelect(profile);
                    }}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-semibold">{profile.displayName}</span>
                      <span
                        className="shrink-0 rounded border border-surface bg-bg-primary px-2 py-0.5 text-[10px]"
                        data-testid={`negative-lab-profile-comparison-claim-${profile.presetId}`}
                      >
                        {profile.claimLevel === 'measured_profile'
                          ? t('modals.negativeConversion.presetClaimMeasured')
                          : profile.claimLevel === 'user_profile'
                            ? t('modals.negativeConversion.presetClaimUser')
                            : t('modals.negativeConversion.presetClaimGeneric')}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="mt-2 block h-6 rounded border border-surface"
                      data-preview-candidate-color={candidate.previewSwatch.candidateCss}
                      data-preview-current-color={candidate.previewSwatch.currentCss}
                      data-preview-tone-bias={candidate.previewSwatch.toneBias}
                      data-testid={`negative-lab-profile-comparison-preview-${profile.presetId}`}
                      style={{ background: candidate.previewSwatch.deltaCss }}
                    />
                    <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-text-tertiary">
                      <span data-testid={`negative-lab-profile-comparison-runtime-${profile.presetId}`}>
                        {profile.runtimeStatus === 'runtime_parameter_applied'
                          ? t('modals.negativeConversion.presetRuntimeApplied')
                          : t('modals.negativeConversion.presetRuntimeCatalogOnly')}
                      </span>
                      <span data-testid={`negative-lab-profile-comparison-evidence-${profile.presetId}`}>
                        {t('modals.negativeConversion.profileEvidenceCount', {
                          fixtureCount: profile.evidenceFixtureCount,
                        })}
                      </span>
                    </span>
                    <span
                      className="mt-1 block truncate text-[10px] text-text-tertiary"
                      data-testid={`negative-lab-profile-comparison-delta-${profile.presetId}`}
                    >
                      {candidate.deltaSummary}
                    </span>
                    <span
                      className="mt-1 block truncate text-[10px] text-text-tertiary"
                      data-testid={`negative-lab-profile-comparison-nonclaim-${profile.presetId}`}
                    >
                      {profile.doesNotProve.join(', ')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
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
            data-testid="negative-lab-profile-filter-tabs"
            role="group"
          >
            {NEGATIVE_LAB_PROFILE_FILTERS.map((filter) => {
              const isActive = profileFilter === filter.id;

              return (
                <button
                  aria-pressed={isActive}
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
          <div className="grid grid-cols-1 gap-2">
            {visibleProfileRows.map((preset) => {
              const isSelected = selectedPresetId === preset.presetId;

              return (
                <button
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
                  <span className="block truncate text-text-secondary">
                    {workspaceProof.previewReady
                      ? t('modals.negativeConversion.previewReady')
                      : t('modals.negativeConversion.workflowExportBlocked')}
                  </span>
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
            <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
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
              data-decision={baseSampleStudioDecision}
              data-testid="negative-lab-base-sampling-studio"
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
                data-sample-edit-mode={baseFogPreviewProof.command.parameters.sampleEditMode}
                data-sample-id={baseFogPreviewProof.command.parameters.sampleRecords[0]?.sampleId ?? ''}
                data-sample-source={baseFogPreviewProof.sampleSource}
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
            <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
              <div>
                <UiText variant={TextVariants.small} className="text-text-secondary">
                  {t('modals.negativeConversion.patchSampler')}
                </UiText>
                <UiText variant={TextVariants.small} className="text-text-tertiary">
                  {t('modals.negativeConversion.patchSamplerHint')}
                </UiText>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {DENSITOMETER_PATCH_PRESETS.map((samplePreset) => (
                  <button
                    key={samplePreset.labelKey}
                    type="button"
                    data-testid={samplePreset.testId}
                    onClick={() => {
                      void handleSamplePatchProbe(samplePreset.labelKey, samplePreset.rect);
                    }}
                    disabled={!selectedImagePath || isSamplingPatchProbe || isSaving}
                    className="rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t(samplePreset.labelKey)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2" data-testid="negative-lab-patch-role-selector">
                {(['neutral', 'highlight'] satisfies NegativeLabPatchRole[]).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={cx(
                      'rounded-md border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      patchRole === role
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    data-testid={`negative-lab-patch-role-${role}`}
                    disabled={isSaving}
                    onClick={() => {
                      setPatchRole(role);
                      setNeutralPatchSuggestion(null);
                      setHighlightPatchExposureSuggestion(null);
                      setShadowPatchBlackPointSuggestion(null);
                    }}
                  >
                    {t(`modals.negativeConversion.patchRole.${role}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="negative-lab-pick-viewer-patch"
                data-picking={String(isPickingPatch)}
                disabled={!selectedImagePath || isSaving}
                onClick={() => {
                  setIsPickingPatch((current) => !current);
                  setPatchDragStart(null);
                  setDraftPatchRect(null);
                }}
              >
                {t(
                  isPickingPatch
                    ? 'modals.negativeConversion.cancelPatchPick'
                    : 'modals.negativeConversion.pickViewerPatch',
                )}
              </button>
              {patchProbeEstimate !== null &&
                patchProbeDensitometerReadout !== null &&
                patchProbeSampleReadout !== null && (
                  <div
                    className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
                    data-testid="negative-lab-patch-probe-readout"
                  >
                    <span className="text-text-secondary">{patchProbeSampleReadout.label}</span>
                    <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-area">
                      {t('modals.negativeConversion.baseSampleArea', {
                        area: formatPercentValue(patchProbeSampleReadout.areaPercent),
                      })}
                    </span>
                    <span className="text-text-secondary">{t('modals.negativeConversion.baseRgb')}</span>
                    <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-rgb">
                      {patchProbeEstimate.baseRgb.map(formatRgbValue).join(' / ')}
                    </span>
                    <span className="text-text-secondary">{t('modals.negativeConversion.densitometer')}</span>
                    <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-density-spread">
                      {formatDensityValue(patchProbeDensitometerReadout.densityRange)}
                    </span>
                    <span className="text-text-secondary">{t('modals.negativeConversion.densitometerDominant')}</span>
                    <span className="text-right" data-testid="negative-lab-patch-probe-dominant-channel">
                      {t(DENSITOMETER_CHANNEL_LABEL_KEYS[patchProbeDensitometerReadout.dominantChannel])}
                    </span>
                    <button
                      type="button"
                      className="col-span-2 mt-1 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="negative-lab-suggest-neutral-patch-rgb"
                      disabled={isSuggestingNeutralPatchRgb || isSaving}
                      onClick={() => {
                        void handleSuggestNeutralPatchRgb();
                      }}
                    >
                      {isSuggestingNeutralPatchRgb ? <Loader2 size={12} className="animate-spin" /> : null}
                      {t('modals.negativeConversion.suggestNeutralPatchRgb')}
                    </button>
                    <button
                      type="button"
                      className="col-span-2 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="negative-lab-analyze-highlight-recovery"
                      disabled={isSuggestingHighlightPatchExposure || isSaving}
                      onClick={() => {
                        void handleSuggestHighlightPatchExposure();
                      }}
                    >
                      {isSuggestingHighlightPatchExposure ? <Loader2 size={12} className="animate-spin" /> : null}
                      {t('modals.negativeConversion.analyzeHighlightRecovery')}
                    </button>
                    <button
                      type="button"
                      className="col-span-2 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="negative-lab-analyze-shadow-black-point"
                      disabled={isSuggestingShadowPatchBlackPoint || isSaving}
                      onClick={() => {
                        void handleSuggestShadowPatchBlackPoint();
                      }}
                    >
                      {isSuggestingShadowPatchBlackPoint ? <Loader2 size={12} className="animate-spin" /> : null}
                      {t('modals.negativeConversion.analyzeShadowBlackPoint')}
                    </button>
                  </div>
                )}
              {shadowPatchBlackPointSuggestion !== null && (
                <div
                  className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
                  data-application-risk={shadowPatchBlackPointSuggestion.applicationRisk}
                  data-apply-allowed={String(shadowPatchBlackPointSuggestion.applyAllowed)}
                  data-status={shadowPatchBlackPointSuggestion.status}
                  data-testid="negative-lab-shadow-black-point-suggestion"
                >
                  <span className="text-text-secondary">
                    {t('modals.negativeConversion.shadowBlackPointSuggestion')}
                  </span>
                  <span className="text-right" data-testid="negative-lab-shadow-black-point-status">
                    {t(`modals.negativeConversion.highlightRecoveryStatus.${shadowPatchBlackPointSuggestion.status}`)}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.blackPoint')}</span>
                  <span className="text-right tabular-nums" data-testid="negative-lab-shadow-black-point-value">
                    {shadowPatchBlackPointSuggestion.projectedBlackPoint.toFixed(2)}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.shadowBlackPointP01')}</span>
                  <span className="text-right tabular-nums" data-testid="negative-lab-shadow-black-point-p01">
                    {t('modals.negativeConversion.highlightRecoveryValueTransition', {
                      from: shadowPatchBlackPointSuggestion.currentSampleP01MinChannel.toFixed(3),
                      to: shadowPatchBlackPointSuggestion.projectedSampleP01MinChannel.toFixed(3),
                    })}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.applicationRisk')}</span>
                  <span className="text-right" data-testid="negative-lab-shadow-black-point-risk">
                    {t(
                      `modals.negativeConversion.neutralityRiskLevels.${shadowPatchBlackPointSuggestion.applicationRisk}`,
                    )}
                  </span>
                  {shadowPatchBlackPointSuggestion.endpointClamped || !shadowPatchBlackPointSuggestion.applyAllowed ? (
                    <span
                      className="col-span-2 text-[11px] text-warning"
                      data-testid="negative-lab-shadow-black-point-apply-warning"
                    >
                      {t('modals.negativeConversion.shadowBlackPointApplyWarning')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="col-span-2 mt-1 inline-flex items-center justify-center rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="negative-lab-apply-shadow-black-point"
                    disabled={isSaving || !shadowPatchBlackPointSuggestion.applyAllowed}
                    onClick={handleApplyShadowPatchBlackPointSuggestion}
                  >
                    {t('modals.negativeConversion.applyShadowBlackPoint')}
                  </button>
                </div>
              )}
              {highlightPatchExposureSuggestion !== null && (
                <div
                  className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
                  data-application-risk={highlightPatchExposureSuggestion.applicationRisk}
                  data-apply-allowed={String(highlightPatchExposureSuggestion.applyAllowed)}
                  data-status={highlightPatchExposureSuggestion.status}
                  data-testid="negative-lab-highlight-recovery-suggestion"
                >
                  <span className="text-text-secondary">
                    {t('modals.negativeConversion.highlightRecoverySuggestion')}
                  </span>
                  <span className="text-right" data-testid="negative-lab-highlight-recovery-status">
                    {t(`modals.negativeConversion.highlightRecoveryStatus.${highlightPatchExposureSuggestion.status}`)}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.highlightRecoveryOffset')}</span>
                  <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-offset">
                    {formatSignedRecipeValue(highlightPatchExposureSuggestion.suggestedFrameExposureOffset)}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.highlightRecoveryP99')}</span>
                  <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-p99">
                    {t('modals.negativeConversion.highlightRecoveryValueTransition', {
                      from: highlightPatchExposureSuggestion.currentSampleP99MaxChannel.toFixed(3),
                      to: highlightPatchExposureSuggestion.projectedSampleP99MaxChannel.toFixed(3),
                    })}
                  </span>
                  <span className="text-text-secondary">
                    {t('modals.negativeConversion.highlightRecoveryPatchClipped')}
                  </span>
                  <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-patch-clipped">
                    {t('modals.negativeConversion.highlightRecoveryValueTransition', {
                      from: formatPercentValue(highlightPatchExposureSuggestion.currentSampleClippedFraction * 100),
                      to: formatPercentValue(highlightPatchExposureSuggestion.projectedSampleClippedFraction * 100),
                    })}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.applicationRisk')}</span>
                  <span className="text-right" data-testid="negative-lab-highlight-recovery-risk">
                    {t(
                      `modals.negativeConversion.neutralityRiskLevels.${highlightPatchExposureSuggestion.applicationRisk}`,
                    )}
                  </span>
                  {highlightPatchExposureSuggestion.offsetClamped || !highlightPatchExposureSuggestion.applyAllowed ? (
                    <span
                      className="col-span-2 text-[11px] text-warning"
                      data-testid="negative-lab-highlight-recovery-apply-warning"
                    >
                      {t('modals.negativeConversion.highlightRecoveryApplyWarning')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="col-span-2 mt-1 inline-flex items-center justify-center rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="negative-lab-apply-highlight-recovery"
                    disabled={
                      frameHealthReport.activeFrameId === null ||
                      isSaving ||
                      !highlightPatchExposureSuggestion.applyAllowed
                    }
                    onClick={handleApplyHighlightPatchExposureSuggestion}
                  >
                    {t('modals.negativeConversion.applyHighlightRecovery')}
                  </button>
                </div>
              )}
              {neutralPatchSuggestion !== null && (
                <div
                  className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
                  data-application-risk={neutralPatchSuggestion.applicationRisk}
                  data-apply-allowed={String(neutralPatchSuggestion.applyAllowed)}
                  data-neutrality-risk={neutralPatchSuggestion.neutralityRisk}
                  data-testid="negative-lab-neutral-patch-rgb-suggestion"
                >
                  <span className="text-text-secondary">
                    {t('modals.negativeConversion.neutralPatchRgbSuggestion')}
                  </span>
                  <span className="text-right tabular-nums" data-testid="negative-lab-neutral-patch-rgb-offset">
                    {t('modals.negativeConversion.effectiveFrameRgbBalance', {
                      blue: formatSignedRecipeValue(neutralPatchSuggestion.suggestedRgbBalanceOffset.blueWeight),
                      green: formatSignedRecipeValue(neutralPatchSuggestion.suggestedRgbBalanceOffset.greenWeight),
                      red: formatSignedRecipeValue(neutralPatchSuggestion.suggestedRgbBalanceOffset.redWeight),
                    })}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.neutralityRisk')}</span>
                  <span className="text-right" data-testid="negative-lab-neutral-patch-risk">
                    {t(`modals.negativeConversion.neutralityRiskLevels.${neutralPatchSuggestion.neutralityRisk}`)}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.applicationRisk')}</span>
                  <span className="text-right" data-testid="negative-lab-neutral-patch-application-risk">
                    {t(`modals.negativeConversion.neutralityRiskLevels.${neutralPatchSuggestion.applicationRisk}`)}
                  </span>
                  <span className="text-text-secondary">{t('modals.negativeConversion.correctionMagnitude')}</span>
                  <span
                    className="text-right tabular-nums"
                    data-testid="negative-lab-neutral-patch-correction-magnitude"
                  >
                    {formatSignedRecipeValue(neutralPatchSuggestion.correctionMagnitude)}
                  </span>
                  {neutralPatchSuggestion.offsetClamped || !neutralPatchSuggestion.applyAllowed ? (
                    <span
                      className="col-span-2 text-[11px] text-warning"
                      data-testid="negative-lab-neutral-patch-apply-warning"
                    >
                      {t('modals.negativeConversion.neutralPatchApplyWarning')}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="col-span-2 mt-1 inline-flex items-center justify-center rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid="negative-lab-apply-neutral-patch-rgb"
                    disabled={
                      frameHealthReport.activeFrameId === null || isSaving || !neutralPatchSuggestion.applyAllowed
                    }
                    onClick={handleApplyNeutralPatchRgbSuggestion}
                  >
                    {t('modals.negativeConversion.applyNeutralPatchRgb')}
                  </button>
                </div>
              )}
            </div>
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
            <div className="grid grid-cols-2 gap-2">
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
          data-preview-ready={String(workspaceProof.previewReady)}
          data-testid="negative-lab-workflow-readiness-strip"
        >
          <span className="truncate rounded-sm bg-white/5 px-2 py-1" data-testid="negative-lab-workflow-queued">
            {t('modals.negativeConversion.queuedScans', { queuedCount: workspaceProof.queuedCount })}
          </span>
          <span className="truncate rounded-sm bg-white/5 px-2 py-1" data-testid="negative-lab-workflow-preview">
            {workspaceProof.previewReady
              ? t('modals.negativeConversion.previewReady')
              : t('modals.negativeConversion.previewPending')}
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

          {(previewUrl || originalUrl) && (
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
                    src={isCompareActive && originalUrl ? originalUrl : previewUrl || ''}
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
                  {isCompareActive && (
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
              onClick={zoomIn}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.zoomInTooltip')}
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.negativeConversion.resetViewTooltip')}
            >
              <Maximize size={16} />
            </button>
            <div className="w-px h-5 bg-white/20 mx-1"></div>
            <button
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
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="grow min-h-0 overflow-hidden">{renderContent()}</div>

            <div className="shrink-0 p-4 flex justify-end gap-3 border-t border-surface bg-bg-secondary z-20">
              <button
                disabled={isSaving}
                onClick={onClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('modals.negativeConversion.cancel')}
              </button>
              <Button
                onClick={() => {
                  void handleSave();
                }}
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
