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
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation, Trans } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import { usePreviewViewport } from '../../hooks/usePreviewViewport';
import {
  negativeBaseFogEstimateSchema,
  negativeBaseFogSampleReadoutSchema,
  negativeConversionSavedPathsSchema,
  type NegativeBaseFogDensitometerReadout,
  type NegativeBaseFogEstimate,
  type NegativeLabBaseFogSampleRect,
  type NegativeLabPresetParams,
} from '../../schemas/negativeLabPresetCatalogSchemas';
import { parsePathProgressPayload } from '../../schemas/tauriEventSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import { NegativeLabAppServerCommandName } from '../../utils/negativeLabAppServerCommandNames';
import { buildNegativeBaseFogDensitometerReadout } from '../../utils/negativeLabDensitometer';
import {
  buildNegativeLabDustScratchReviewReport,
  buildNegativeLabQcProofReport,
} from '../../utils/negativeLabDustScratchReview';
import {
  buildNegativeLabBatchDryRunSummary,
  buildNegativeLabFrameHealthReport,
  getNegativeLabScanLabel,
} from '../../utils/negativeLabFrameHealth';
import {
  NegativeLabOutputFormatId,
  NEGATIVE_LAB_OUTPUT_FORMAT_SELECTOR_IDS,
  type NegativeLabOutputFormatId as NegativeOutputFormat,
} from '../../utils/negativeLabOutputFormatIds';
import { buildNegativeLabAcceptedPlanIdentity, buildNegativeLabPlanHash } from '../../utils/negativeLabPlanIdentity';
import {
  DEFAULT_NEGATIVE_LAB_UI_PRESET,
  NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG,
} from '../../utils/negativeLabPresetCatalog';
import { buildNegativeLabProfileBrowserRows } from '../../utils/negativeLabProfileBrowserRows';
import { buildNegativeLabQcContactSheetArtifact } from '../../utils/negativeLabQcContactSheetArtifact';
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
} from '../../schemas/negativeLabFrameHealthSchemas';
import type { NegativeLabRuntimeProfileBrowserRow } from '../../schemas/negativeLabMeasuredProfileSchemas';
import type { NegativeLabWorkspaceProof } from '../../schemas/negativeLabWorkspaceSchemas';

type NegativeParams = NegativeLabPresetParams;
type NegativeConversionScope = 'active' | 'all';
type NegativeLabProfileFilter = 'all' | 'black_and_white_silver' | 'color_negative' | 'measured';
type NegativeLabProfileSort = 'catalog' | 'evidence_desc' | 'name_asc' | 'runtime_applied';
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
  accepted: 'Dry-run accepted',
  blocked: 'Dry-run blocked',
  ready: 'Dry-run ready',
} satisfies Record<NegativeLabAgentDryRunState, string>;
const NEGATIVE_LAB_AGENT_COMMIT_LABELS = {
  committing: 'Committing',
  not_committed: 'Not committed',
  ready_to_commit: 'Ready to commit',
} satisfies Record<NegativeLabAgentCommitState, string>;
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
  | 'modals.negativeConversion.acquisitionWarningLossy'
  | 'modals.negativeConversion.acquisitionWarningMixed'
  | 'modals.negativeConversion.acquisitionWarningUnknown';

const DEFAULT_PARAMS: NegativeParams = DEFAULT_NEGATIVE_LAB_UI_PRESET.params;
const DEFAULT_SAVE_OPTIONS = {
  outputFormat: NegativeLabOutputFormatId.Tiff16 as NegativeOutputFormat,
  suffix: 'Positive',
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
    String(profile.params.blue_weight),
    String(profile.params.contrast),
    String(profile.params.exposure),
    String(profile.params.green_weight),
    String(profile.params.red_weight),
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
const ACQUISITION_SOURCE_FAMILY_LABEL_KEYS = {
  jpeg_lossy: 'modals.negativeConversion.acquisitionSourceJpeg',
  raw_like: 'modals.negativeConversion.acquisitionSourceRaw',
  tiff_scan: 'modals.negativeConversion.acquisitionSourceTiff',
  unknown: 'modals.negativeConversion.acquisitionSourceUnknown',
} satisfies Record<NegativeLabAcquisitionSourceFamily, AcquisitionSourceFamilyLabelKey>;
const ACQUISITION_WARNING_LABEL_KEYS = {
  lossy_source_for_negative_lab: 'modals.negativeConversion.acquisitionWarningLossy',
  mixed_source_families: 'modals.negativeConversion.acquisitionWarningMixed',
  unknown_acquisition_state: 'modals.negativeConversion.acquisitionWarningUnknown',
} satisfies Record<NegativeLabAcquisitionWarningCode, AcquisitionWarningLabelKey>;
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
  const [baseFogReadoutCopied, setBaseFogReadoutCopied] = useState(false);
  const [patchProbeEstimate, setPatchProbeEstimate] = useState<NegativeBaseFogEstimate | null>(null);
  const [patchProbeRect, setPatchProbeRect] = useState<NegativeLabBaseFogSampleRect | null>(null);
  const [patchProbeLabel, setPatchProbeLabel] = useState<string | null>(null);
  const [isSamplingPatchProbe, setIsSamplingPatchProbe] = useState(false);
  const [customBaseSampleRect, setCustomBaseSampleRect] =
    useState<NegativeLabBaseFogSampleRect>(CUSTOM_BASE_SAMPLE_DEFAULT);
  const [customBaseSampleEstimate, setCustomBaseSampleEstimate] = useState<NegativeBaseFogEstimate | null>(null);
  const [isMeasuringCustomBaseSample, setIsMeasuringCustomBaseSample] = useState(false);
  const [copiedBatchPlanJson, setCopiedBatchPlanJson] = useState<string | null>(null);
  const [acceptedBatchPlanJson, setAcceptedBatchPlanJson] = useState<string | null>(null);
  const [activeBaseFogSampleLabel, setActiveBaseFogSampleLabel] = useState<string | null>(null);
  const [baseFogSampleUndoStack, setBaseFogSampleUndoStack] = useState<BaseFogSampleUndoEntry[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [saveOptions, setSaveOptions] = useState(DEFAULT_SAVE_OPTIONS);
  const [conversionScope, setConversionScope] = useState<NegativeConversionScope>('all');
  const [includedPathSet, setIncludedPathSet] = useState<Set<string>>(() => getInitialIncludedPaths(targetPaths));
  const [activePathIndex, setActivePathIndex] = useState(0);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [profileFilter, setProfileFilter] = useState<NegativeLabProfileFilter>('all');
  const [profileSort, setProfileSort] = useState<NegativeLabProfileSort>('catalog');

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
  const effectiveActivePathIndex = targetPaths[activePathIndex] === undefined ? 0 : activePathIndex;
  const selectedImagePath = targetPaths[effectiveActivePathIndex] ?? null;
  const hasMultipleScans = targetPaths.length > 1;
  const pathsToConvert = useMemo(() => {
    if (conversionScope === 'active' && selectedImagePath !== null) return [selectedImagePath];
    return targetPaths.filter((path) => includedPathSet.has(path));
  }, [conversionScope, includedPathSet, selectedImagePath, targetPaths]);
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

  const selectedPreset = useMemo(
    () =>
      NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.find((preset) => preset.presetId === selectedPresetId) ?? null,
    [selectedPresetId],
  );
  const selectedProfile = useMemo(
    () => NEGATIVE_LAB_PROFILE_BROWSER_ROWS.find((profile) => profile.presetId === selectedPresetId) ?? null,
    [selectedPresetId],
  );
  const selectedProfileProvenanceHash = useMemo(() => {
    if (selectedProfile === null) return null;

    return `fnv1a32:${buildNegativeLabPlanHash(
      JSON.stringify({
        claimLevel: selectedProfile.claimLevel,
        claimPolicy: selectedProfile.claimPolicy,
        displayName: selectedProfile.displayName,
        doesNotProve: selectedProfile.doesNotProve,
        evidenceFixtureCount: selectedProfile.evidenceFixtureCount,
        measurementProfileId: selectedProfile.measurementProfileId,
        params: selectedProfile.params,
        presetId: selectedProfile.presetId,
        profileStatus: selectedProfile.profileStatus,
        runtimeStatus: selectedProfile.runtimeStatus,
        sourceGenericPresetId: selectedProfile.sourceGenericPresetId,
      }),
    )}`;
  }, [selectedProfile]);
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
        includedPathSet,
        previewReady: previewUrl !== null,
        targetPaths,
      }),
    [baseFogConfidence, effectiveActivePathIndex, includedPathSet, previewUrl, targetPaths],
  );
  const batchDryRunSummary = useMemo(() => buildNegativeLabBatchDryRunSummary(frameHealthReport), [frameHealthReport]);
  const dustScratchReviewReport = useMemo(
    () => buildNegativeLabDustScratchReviewReport(frameHealthReport, previewUrl !== null),
    [frameHealthReport, previewUrl],
  );
  const batchDryRunPlanJson = useMemo(() => JSON.stringify(batchDryRunSummary, null, 2), [batchDryRunSummary]);
  const acceptedBatchPlanIdentity = useMemo(
    () => buildNegativeLabAcceptedPlanIdentity(batchDryRunPlanJson),
    [batchDryRunPlanJson],
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
  const requiresAcceptedBatchPlan = hasMultipleScans && conversionScope === 'all';
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
          contrast: params.contrast.toFixed(2),
          exposure: params.exposure.toFixed(2),
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
      throttle(async (currentParams: NegativeParams, isInitialLoad: boolean = false) => {
        if (!selectedImagePath) return;
        try {
          const result: string = await invoke(Invokes.PreviewNegativeConversion, {
            path: selectedImagePath,
            params: currentParams,
          });
          setPreviewUrl(result);
          if (isInitialLoad) {
            setIsLoading(false);
          }
        } catch (e) {
          console.error('Negative preview failed', e);
          if (isInitialLoad) {
            setIsLoading(false);
          }
        }
      }, 100),
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
      setBaseFogReadoutCopied(false);
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
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, resetViewport, selectedImagePath, targetPaths, updatePreview]);

  const handleParamChange = (key: keyof NegativeParams, value: number) => {
    const newParams = { ...params, [key]: value };
    setSelectedPresetId('');
    if (key !== 'base_fog_strength') {
      setBaseFogConfidence(null);
      setActiveBaseFogSampleLabel(null);
    }
    setParams(newParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(newParams);
  };

  const handlePresetSelect = (preset: NegativeLabRuntimeProfileBrowserRow) => {
    if (!preset.isSelectable) return;

    setSelectedPresetId(preset.presetId);
    setBaseFogConfidence(null);
    setBaseFogEstimate(null);
    setBaseFogReadoutCopied(false);
    setActiveBaseFogSampleLabel(null);
    setBaseFogSampleUndoStack([]);
    setParams(preset.params);
    updatePreview(preset.params);
  };

  const pushBaseFogSampleUndoEntry = () => {
    setBaseFogSampleUndoStack((stack) => [
      ...stack,
      {
        activeBaseFogSampleLabel,
        baseFogConfidence,
        baseFogEstimate,
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
    setBaseFogReadoutCopied(false);
    setActiveBaseFogSampleLabel(previous.activeBaseFogSampleLabel);
    setSelectedPresetId(previous.selectedPresetId);
    setParams(previous.params);
    setAcceptedBatchPlanJson(null);
    updatePreview(previous.params);
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
      pushBaseFogSampleUndoEntry();
      setBaseFogConfidence(estimate.confidence);
      setBaseFogEstimate(estimate);
      setBaseFogReadoutCopied(false);
      setActiveBaseFogSampleLabel(t('modals.negativeConversion.sampleFullFrame'));
      setSelectedPresetId('');
      setParams(nextParams);
      setAcceptedBatchPlanJson(null);
      updatePreview(nextParams);
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
      pushBaseFogSampleUndoEntry();
      setBaseFogConfidence(estimate.confidence);
      setBaseFogEstimate(estimate);
      setBaseFogReadoutCopied(false);
      setActiveBaseFogSampleLabel(t(labelKey));
      setSelectedPresetId('');
      setParams(nextParams);
      setAcceptedBatchPlanJson(null);
      updatePreview(nextParams);
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
    if (customBaseSampleEstimate === null) return;
    const nextParams = {
      ...params,
      base_fog_strength: 1,
      base_fog_sample: customBaseSampleRect,
      blue_weight: customBaseSampleEstimate.blueWeight,
      green_weight: customBaseSampleEstimate.greenWeight,
      red_weight: customBaseSampleEstimate.redWeight,
    };
    pushBaseFogSampleUndoEntry();
    setBaseFogConfidence(customBaseSampleEstimate.confidence);
    setBaseFogEstimate(customBaseSampleEstimate);
    setBaseFogReadoutCopied(false);
    setActiveBaseFogSampleLabel(t('modals.negativeConversion.customBaseSample'));
    setSelectedPresetId('');
    setParams(nextParams);
    setAcceptedBatchPlanJson(null);
    updatePreview(nextParams);
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
    } catch (e) {
      console.error('Patch probe sample failed', e);
    } finally {
      setIsSamplingPatchProbe(false);
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
            ...(selectedProfileProvenanceHash === null ? {} : { profileProvenanceHash: selectedProfileProvenanceHash }),
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
    setActivePathIndex(frameIndex);
    resetViewport();
  };

  const handleStepFrame = (step: -1 | 1) => {
    handleSelectFrameIndex(effectiveActivePathIndex + step);
  };

  const renderRollFrameNavigator = () => (
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
                  data-frame-id={frame.frameId}
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
                      data-testid={`negative-lab-roll-frame-runtime-${index}`}
                    >
                      {framePreviewReady
                        ? t('modals.negativeConversion.previewReady')
                        : t('modals.negativeConversion.previewPending')}
                    </span>
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

  const renderBatchReadiness = () => (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      data-planned-apply-count={batchDryRunSummary.plannedApplyCount}
      data-review-count={dustScratchReviewReport.reviewCount}
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
                  warningCount: frameHealthReport.warningCodes.length,
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
            <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-batch-workload-summary">
              {t('modals.negativeConversion.batchWorkloadSummary', {
                applyCount: batchDryRunSummary.plannedApplyCount,
                reviewCount: dustScratchReviewReport.reviewCount,
                skippedCount: batchDryRunSummary.skippedFrameIds.length,
              })}
            </span>
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
          <div className="grid gap-1">
            {frameHealthReport.frames.map((row, index) => (
              <div
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
                data-warning-count={row.warningCodes.length}
                data-testid={`negative-lab-frame-health-row-${index}`}
                key={row.frameId}
              >
                <span className="truncate text-text-secondary">{row.scanLabel}</span>
                <span
                  className={cx(
                    'rounded px-1.5 py-0.5',
                    row.healthStatus === 'active' && 'bg-accent/15 text-text-primary',
                    row.healthStatus === 'queued' && 'bg-surface text-text-secondary',
                    row.healthStatus === 'skipped' && 'bg-bg-primary text-text-tertiary',
                  )}
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
                    ? t('modals.negativeConversion.baseReady', { confidence: Math.round(row.baseConfidence * 100) })
                    : t('modals.negativeConversion.basePending')}
                </span>
                {row.warningCodes.length > 0 && (
                  <span
                    className="col-span-3 flex flex-wrap gap-1"
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
      data-testid="negative-lab-agent-activity"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-text-primary">{t('modals.negativeConversion.agentActivity')}</span>
      </div>
      <div className="truncate" data-testid="negative-lab-agent-command-source">
        {agentCommandSource}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-dry-run-state">
          {NEGATIVE_LAB_AGENT_DRY_RUN_LABELS[agentDryRunState]}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-commit-state">
          {NEGATIVE_LAB_AGENT_COMMIT_LABELS[agentCommitState]}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-affected-frames">
          {t('modals.negativeConversion.agentAffectedFrames', {
            frameCount: batchDryRunSummary.affectedFrameIds.length,
          })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-agent-warning-count">
          {t('modals.negativeConversion.frameHealthWarningCount', {
            warningCount: frameHealthReport.warningCodes.length,
          })}
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
              <div className="grid grid-cols-2 gap-2" data-testid="negative-lab-conversion-scope">
                {(['all', 'active'] satisfies Array<NegativeConversionScope>).map((scope) => (
                  <button
                    aria-pressed={conversionScope === scope}
                    className={cx(
                      'rounded-md border px-2 py-1.5 text-xs transition-colors',
                      conversionScope === scope
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
                    )}
                    data-testid={scope === 'all' ? 'negative-lab-scope-all' : 'negative-lab-scope-active'}
                    key={scope}
                    onClick={() => {
                      setConversionScope(scope);
                    }}
                    type="button"
                  >
                    {t(
                      scope === 'all' ? 'modals.negativeConversion.scopeAll' : 'modals.negativeConversion.scopeActive',
                    )}
                  </button>
                ))}
              </div>
            )}
            {renderAcquisitionHealth()}
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
              <span>{t('modals.negativeConversion.contrast')}</span>
              <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-recipe-contrast">
                {params.contrast.toFixed(2)}
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
            {baseFogConfidence !== null && (
              <UiText data-testid="negative-lab-confidence" variant={TextVariants.small} className="text-text-tertiary">
                {t('modals.negativeConversion.baseFogConfidence', {
                  confidence: Math.round(baseFogConfidence * 100),
                })}
              </UiText>
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
                  </div>
                )}
            </div>
            {renderDustScratchReview()}
            {renderQcProofReport()}
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
                {t(
                  conversionScope === 'all'
                    ? 'modals.negativeConversion.scopeAll'
                    : 'modals.negativeConversion.scopeActive',
                )}
              </span>
              <span className="text-right text-text-secondary" data-testid="negative-lab-export-summary-count">
                {t('modals.negativeConversion.queuedScans', { queuedCount: pathsToConvert.length })}
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
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="origin-center" style={imageTransformStyle}>
                <div className="relative inline-block shadow-2xl">
                  <img
                    src={isCompareActive && originalUrl ? originalUrl : previewUrl || ''}
                    className="block object-contain"
                    style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                    alt={t('modals.negativeConversion.previewAlt')}
                    draggable={false}
                  />
                  {renderCustomBaseSampleOverlay()}
                  {renderBaseFogSampleOverlay()}
                  {renderPatchProbeOverlay()}
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
