import cx from 'clsx';
import type { TFunction } from 'i18next';
import {
  Aperture,
  ChartArea,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Info,
  Pin,
  PinOff,
  RotateCcw,
  ScanSearch,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { useShallow } from 'zustand/react/shallow';

import { useContextMenu } from '../../../../context/ContextMenuContext';
import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import type { RawDevelopmentReport } from '../../../../schemas/imageLoaderSchemas';
import {
  type RawReconstructionComparisonResult,
  rawReconstructionComparisonResultSchema,
} from '../../../../schemas/rawReconstructionComparisonSchemas';
import { emptyTauriResponseSchema } from '../../../../schemas/tauriResponseSchemas';
import { type CopiedSectionAdjustments, useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { type CollapsibleSectionsState, useUIStore } from '../../../../store/useUIStore';
import { Invokes } from '../../../../tauri/commands';
import { TextVariants } from '../../../../types/typography';
import {
  ActiveChannel,
  ADJUSTMENT_SECTIONS,
  type Adjustments,
  BasicAdjustment,
  CreativeAdjustment,
  DetailsAdjustment,
  Effect,
  hasAdjustmentValueChanges,
  INITIAL_ADJUSTMENTS,
  LensAdjustment,
  type ParametricCurve,
  type ParametricCurveSettings,
  pickAdjustmentValues,
  TransformAdjustment,
} from '../../../../utils/adjustments';
import { getEditorClippingStatusChips } from '../../../../utils/color/runtime/gamutWarningDisplay';
import { formatUnknownError } from '../../../../utils/errorFormatting';
import {
  getRawProcessingModeDisplayCopy,
  getRawProcessingModeProvenance,
  normalizeRawProcessingMode,
  RAW_PROCESSING_MODES,
  type RawProcessingMode,
} from '../../../../utils/rawProcessingModes';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import { getLensCorrectionAvailability } from '../../../../utils/transformLensControls';
import AdjustmentSlider from '../../../adjustments/AdjustmentSlider';
import BasicAdjustments from '../../../adjustments/Basic';
import CurveGraph from '../../../adjustments/Curves';
import DetailsPanel from '../../../adjustments/Details';
import EffectsPanel from '../../../adjustments/Effects';
import TransformLens from '../../../adjustments/TransformLens';
import { OPTION_SEPARATOR, type Option } from '../../../ui/AppProperties';
import CollapsibleSection, { type CollapsibleSectionHeaderAction } from '../../../ui/CollapsibleSection';
import { editorChromeStatusChipClassName } from '../../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import Dropdown, { type OptionItem } from '../../../ui/primitives/Dropdown';
import Input from '../../../ui/primitives/Input';
import Switch from '../../../ui/primitives/Switch';
import UiText from '../../../ui/primitives/Text';
import PanelScopesStrip from '../inspector/PanelScopesStrip';

const ADJUSTMENT_SECTION_NAMES = ['basic', 'curves', 'transformLens', 'details', 'effects'] as const;
type AdjustmentSectionName = (typeof ADJUSTMENT_SECTION_NAMES)[number];
type RawProcessingModeOverrideOption = RawProcessingMode | 'inherit';
type RawReconstructionComparisonModeResult = RawReconstructionComparisonResult['modes'][number];
type CollapsibleSectionsUpdater =
  | CollapsibleSectionsState
  | ((prev: CollapsibleSectionsState) => CollapsibleSectionsState);
interface AppliedRawReconstructionModeReceipt {
  cropHash: string;
  decodeElapsedMs: number;
  mode: RawProcessingMode;
  proofBoundary: RawReconstructionComparisonResult['proofBoundary'];
  savedOverrideValue: RawProcessingMode;
}
interface AdjustmentSectionActions {
  headerActions: CollapsibleSectionHeaderAction[];
  menuOptions: Option[];
}
interface DevelopPanelControl {
  id: string;
  isDirty: boolean;
  label: string;
  render: () => ReactNode;
  searchText: string;
  sectionName: AdjustmentSectionName;
}

type NumericAdjustmentKey = keyof {
  [Key in keyof Adjustments as Adjustments[Key] extends number ? Key : never]: Adjustments[Key];
};

const ADJUSTMENT_SECTION_LABEL_FALLBACKS: Record<AdjustmentSectionName, string> = {
  basic: 'Basic Tone',
  curves: 'Tone Curves',
  details: 'Detail',
  effects: 'Effects & Looks',
  transformLens: 'Transform & Lens',
};
const TRANSFORM_LENS_CONTROL_LABELS = {
  correctionAmount: 'Correction amount',
  distortionAmount: 'Distortion amount',
  horizontal: 'Horizontal perspective',
  opticalDistortion: 'Optical distortion',
  rotation: 'Rotation',
  scale: 'Scale',
  vertical: 'Vertical perspective',
  vignetteAmount: 'Vignette amount',
  xOffset: 'X offset',
  yOffset: 'Y offset',
};
const RAW_RECONSTRUCTION_COMPARISON_CROP_SIZE = 256;
const PANEL_ACTION_ICON_SIZE = 14;
const PINNED_CONTROLS_LIMIT = 8;
const DEVELOP_PANEL_SEARCH_NORMALIZER = /\s+/g;
const DEVELOP_PANEL_FOCUSABLE_SELECTOR =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const normalizeDevelopPanelSearchText = (value: string) =>
  value.trim().toLowerCase().replace(DEVELOP_PANEL_SEARCH_NORMALIZER, ' ');

const escapeDevelopPanelSelectorValue = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

const getLumaParametricCurve = (adjustments: Adjustments): ParametricCurveSettings =>
  (adjustments.parametricCurve ?? INITIAL_ADJUSTMENTS.parametricCurve)?.[ActiveChannel.Luma] ?? {
    blackLevel: 0,
    darks: 0,
    highlights: 0,
    lights: 0,
    shadows: 0,
    split1: 25,
    split2: 50,
    split3: 75,
    whiteLevel: 0,
  };

const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
};

const hasRawProcessingStatusRequiringAttention = (report: RawDevelopmentReport | null | undefined): boolean => {
  const cameraProfile = report?.cameraProfile;
  if (!cameraProfile) return false;

  return (
    cameraProfile.warningCodes.length > 0 ||
    cameraProfile.fallbackReason != null ||
    cameraProfile.status === 'fallback' ||
    cameraProfile.status === 'unavailable' ||
    cameraProfile.colorCheckerGate?.status === 'gated_fail' ||
    cameraProfile.colorCheckerGate?.status === 'gated_warn' ||
    cameraProfile.colorCheckerGate?.fallbackReason != null ||
    report.demosaicPath === 'fast' ||
    report.demosaicPath === 'linear_bypass'
  );
};

const getAdjustmentSectionLabel = (t: TFunction, sectionName: AdjustmentSectionName): string => {
  switch (sectionName) {
    case 'basic':
      return String(
        t('editor.adjustments.scopedSections.basic', { defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS.basic }),
      );
    case 'curves':
      return String(
        t('editor.adjustments.scopedSections.curves', { defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS.curves }),
      );
    case 'details':
      return String(
        t('editor.adjustments.scopedSections.details', { defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS.details }),
      );
    case 'effects':
      return String(
        t('editor.adjustments.scopedSections.effects', { defaultValue: ADJUSTMENT_SECTION_LABEL_FALLBACKS.effects }),
      );
    case 'transformLens':
      return ADJUSTMENT_SECTION_LABEL_FALLBACKS.transformLens;
  }
};

const toHeaderAction = (option: Option, testId: string): CollapsibleSectionHeaderAction | null => {
  if (option.type === OPTION_SEPARATOR || !option.icon || !option.label || !option.onClick) {
    return null;
  }

  return {
    ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
    icon: option.icon,
    label: option.label,
    onClick: option.onClick,
    testId,
  };
};

export default function Controls() {
  const { t } = useTranslation();
  const density = professionalInspectorDensityTokens;
  const { showContextMenu } = useContextMenu();
  const { onToggleWaveform } = useWaveformControls();
  const { setAdjustments, handleAutoAdjustments, handleLutSelect } = useEditorActions();
  const [rawReconstructionComparison, setRawReconstructionComparison] =
    useState<RawReconstructionComparisonResult | null>(null);
  const [appliedRawReconstructionModeReceipt, setAppliedRawReconstructionModeReceipt] =
    useState<AppliedRawReconstructionModeReceipt | null>(null);
  const [isComparingRawReconstruction, setIsComparingRawReconstruction] = useState(false);
  const [applyingRawProcessingMode, setApplyingRawProcessingMode] = useState<RawProcessingMode | null>(null);
  const [isRawProcessingModeProvenanceVisible, setIsRawProcessingModeProvenanceVisible] = useState(false);
  const [isRawProcessingControlsOpen, setIsRawProcessingControlsOpen] = useState(false);
  const [developPanelSearchQuery, setDevelopPanelSearchQuery] = useState('');
  const developPanelScrollRootRef = useRef<HTMLDivElement | null>(null);

  const { appSettings, theme } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      theme: state.theme,
    })),
  );

  const rawProcessingModeOverrideOptions = useMemo<Array<OptionItem<RawProcessingModeOverrideOption>>>(
    () => [
      {
        label: t('editor.adjustments.rawProcessingModeOverride.inherit', {
          mode: t(`settings.processing.rawModes.${normalizeRawProcessingMode(appSettings?.rawProcessingMode)}.label`),
        }),
        value: 'inherit',
      },
      ...RAW_PROCESSING_MODES.map((mode) => ({
        label: t(`settings.processing.rawModes.${mode}.label`),
        value: mode,
      })),
    ],
    [appSettings?.rawProcessingMode, t],
  );

  const { collapsibleSectionsState, developPanelPinnedControlIds, setDevelopPanelPinnedControlIds, setUI } = useUIStore(
    useShallow((state) => ({
      collapsibleSectionsState: state.collapsibleSectionsState,
      developPanelPinnedControlIds: state.developPanelPinnedControlIds,
      setDevelopPanelPinnedControlIds: state.setDevelopPanelPinnedControlIds,
      setUI: state.setUI,
    })),
  );

  const { adjustments, copiedSectionAdjustments, histogram, selectedImage, isWaveformVisible, setEditor } =
    useEditorStore(
      useShallow((state) => ({
        adjustments: state.adjustments,
        copiedSectionAdjustments: state.copiedSectionAdjustments,
        histogram: state.histogram,
        selectedImage: state.selectedImage,
        isWaveformVisible: state.isWaveformVisible,
        setEditor: state.setEditor,
      })),
    );

  const rawProcessingModeDisplay = useMemo(
    () =>
      getRawProcessingModeDisplayCopy(
        adjustments.rawProcessingModeOverride ?? normalizeRawProcessingMode(appSettings?.rawProcessingMode),
        t,
      ),
    [adjustments.rawProcessingModeOverride, appSettings?.rawProcessingMode, t],
  );

  const isRawProcessingStatusAttentionRequired = useMemo(
    () => selectedImage?.isRaw === true && hasRawProcessingStatusRequiringAttention(selectedImage.rawDevelopmentReport),
    [selectedImage?.isRaw, selectedImage?.rawDevelopmentReport],
  );
  const activeClippingStatusChips = useMemo(
    () => getEditorClippingStatusChips(adjustments).filter((chip) => chip.active),
    [adjustments],
  );
  const clippingWarningState =
    activeClippingStatusChips.length === 0 ? 'clean' : activeClippingStatusChips.map((chip) => chip.id).join(' ');

  useEffect(() => {
    setIsRawProcessingControlsOpen(isRawProcessingStatusAttentionRequired);
    setIsRawProcessingModeProvenanceVisible(false);
    setRawReconstructionComparison(null);
    setAppliedRawReconstructionModeReceipt(null);
  }, [isRawProcessingStatusAttentionRequired, selectedImage?.path]);

  const onDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );

  const developPanelControls = useMemo<DevelopPanelControl[]>(() => {
    const buildSearchText = (sectionName: AdjustmentSectionName, label: string, aliases: string[] = []) =>
      normalizeDevelopPanelSearchText([getAdjustmentSectionLabel(t, sectionName), label, ...aliases].join(' '));

    const handleNumericAdjustmentChange = (key: NumericAdjustmentKey, value: number, truncate = false) => {
      setAdjustments((prev: Adjustments) => ({ ...prev, [key]: truncate ? Math.trunc(value) : value }));
    };

    const handleBooleanAdjustmentChange = (key: keyof Adjustments, value: boolean) => {
      setAdjustments((prev: Adjustments) => ({ ...prev, [key]: value }));
    };

    const handleLumaParametricCurveChange = (key: keyof ParametricCurveSettings, value: number) => {
      setAdjustments((prev: Adjustments) => {
        const currentParametricCurve = (prev.parametricCurve ?? INITIAL_ADJUSTMENTS.parametricCurve) as ParametricCurve;
        const currentLumaCurve = currentParametricCurve[ActiveChannel.Luma];
        return {
          ...prev,
          curveMode: 'parametric',
          parametricCurve: {
            ...currentParametricCurve,
            [ActiveChannel.Luma]: {
              ...currentLumaCurve,
              [key]: value,
            },
          },
        };
      });
    };

    const sliderControl = ({
      aliases,
      defaultValue,
      disabled,
      fillOrigin,
      id,
      key,
      label,
      max,
      min,
      sectionName,
      step,
      suffix,
      truncate = false,
    }: {
      aliases?: string[];
      defaultValue?: number;
      disabled?: boolean;
      fillOrigin?: 'default' | 'min';
      id: string;
      key: NumericAdjustmentKey;
      label: string;
      max: number;
      min: number;
      sectionName: AdjustmentSectionName;
      step: number;
      suffix?: string;
      truncate?: boolean;
    }): DevelopPanelControl => ({
      id,
      isDirty: adjustments[key] !== INITIAL_ADJUSTMENTS[key],
      label,
      render: () => (
        <AdjustmentSlider
          {...(defaultValue === undefined ? {} : { defaultValue })}
          density="compact"
          {...(disabled === undefined ? {} : { disabled })}
          {...(fillOrigin === undefined ? {} : { fillOrigin })}
          label={label}
          max={max}
          min={min}
          onDragStateChange={onDragStateChange}
          onValueChange={(value) => {
            handleNumericAdjustmentChange(key, value, truncate);
          }}
          step={step}
          {...(suffix === undefined ? {} : { suffix })}
          testId={`develop-pinned-control-${id}`}
          value={Number(adjustments[key] ?? 0)}
        />
      ),
      searchText: buildSearchText(sectionName, label, aliases),
      sectionName,
    });

    const lumaCurveSliderControl = ({
      aliases,
      id,
      key,
      label,
      max,
      min,
    }: {
      aliases?: string[];
      id: string;
      key: keyof ParametricCurveSettings;
      label: string;
      max: number;
      min: number;
    }): DevelopPanelControl => {
      const lumaCurve = getLumaParametricCurve(adjustments);
      const defaultLumaCurve = getLumaParametricCurve(INITIAL_ADJUSTMENTS);
      return {
        id,
        isDirty: lumaCurve[key] !== defaultLumaCurve[key],
        label,
        render: () => (
          <AdjustmentSlider
            defaultValue={0}
            density="compact"
            label={label}
            max={max}
            min={min}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              handleLumaParametricCurveChange(key, value);
            }}
            step={1}
            testId={`develop-pinned-control-${id}`}
            value={lumaCurve[key]}
          />
        ),
        searchText: buildSearchText('curves', label, ['curve', 'luma', 'parametric', ...(aliases ?? [])]),
        sectionName: 'curves',
      };
    };

    const basicControls = [
      sliderControl({
        aliases: ['ev', 'exposure'],
        id: BasicAdjustment.Exposure,
        key: BasicAdjustment.Exposure,
        label: t('adjustments.basic.evShift'),
        max: 5,
        min: -5,
        sectionName: 'basic',
        step: 0.01,
      }),
      sliderControl({
        aliases: ['exposure'],
        id: BasicAdjustment.Brightness,
        key: BasicAdjustment.Brightness,
        label: t('adjustments.basic.brightness', { defaultValue: t('adjustments.basic.exposure') }),
        max: 5,
        min: -5,
        sectionName: 'basic',
        step: 0.01,
      }),
      sliderControl({
        id: BasicAdjustment.Contrast,
        key: BasicAdjustment.Contrast,
        label: t('adjustments.basic.contrast'),
        max: 100,
        min: -100,
        sectionName: 'basic',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: BasicAdjustment.Highlights,
        key: BasicAdjustment.Highlights,
        label: t('adjustments.basic.highlights'),
        max: 100,
        min: -100,
        sectionName: 'basic',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: BasicAdjustment.Shadows,
        key: BasicAdjustment.Shadows,
        label: t('adjustments.basic.shadows'),
        max: 100,
        min: -100,
        sectionName: 'basic',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: BasicAdjustment.Whites,
        key: BasicAdjustment.Whites,
        label: t('adjustments.basic.whites'),
        max: 100,
        min: -100,
        sectionName: 'basic',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: BasicAdjustment.Blacks,
        key: BasicAdjustment.Blacks,
        label: t('adjustments.basic.blacks'),
        max: 100,
        min: -100,
        sectionName: 'basic',
        step: 1,
        truncate: true,
      }),
    ];

    const curveControls = [
      lumaCurveSliderControl({
        id: 'curves.luma.whiteLevel',
        key: 'whiteLevel',
        label: t('adjustments.curves.params.whiteLevel'),
        max: 0,
        min: -100,
      }),
      lumaCurveSliderControl({
        id: 'curves.luma.highlights',
        key: 'highlights',
        label: t('adjustments.curves.params.highlights'),
        max: 100,
        min: -100,
      }),
      lumaCurveSliderControl({
        id: 'curves.luma.lights',
        key: 'lights',
        label: t('adjustments.curves.params.lights'),
        max: 100,
        min: -100,
      }),
      lumaCurveSliderControl({
        id: 'curves.luma.darks',
        key: 'darks',
        label: t('adjustments.curves.params.darks'),
        max: 100,
        min: -100,
      }),
      lumaCurveSliderControl({
        id: 'curves.luma.shadows',
        key: 'shadows',
        label: t('adjustments.curves.params.shadows'),
        max: 100,
        min: -100,
      }),
      lumaCurveSliderControl({
        id: 'curves.luma.blackLevel',
        key: 'blackLevel',
        label: t('adjustments.curves.params.blackLevel'),
        max: 100,
        min: 0,
      }),
    ];

    const lensAvailability = getLensCorrectionAvailability(adjustments.lensDistortionParams);
    const transformLensControls: DevelopPanelControl[] = [
      sliderControl({
        aliases: ['keystone', 'perspective'],
        id: TransformAdjustment.TransformVertical,
        key: TransformAdjustment.TransformVertical,
        label: TRANSFORM_LENS_CONTROL_LABELS.vertical,
        max: 100,
        min: -100,
        sectionName: 'transformLens',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        aliases: ['keystone', 'perspective'],
        id: TransformAdjustment.TransformHorizontal,
        key: TransformAdjustment.TransformHorizontal,
        label: TRANSFORM_LENS_CONTROL_LABELS.horizontal,
        max: 100,
        min: -100,
        sectionName: 'transformLens',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        aliases: ['angle'],
        id: TransformAdjustment.TransformRotate,
        key: TransformAdjustment.TransformRotate,
        label: TRANSFORM_LENS_CONTROL_LABELS.rotation,
        max: 45,
        min: -45,
        sectionName: 'transformLens',
        step: 0.1,
        suffix: '°',
      }),
      sliderControl({
        fillOrigin: 'min',
        id: TransformAdjustment.TransformScale,
        key: TransformAdjustment.TransformScale,
        label: TRANSFORM_LENS_CONTROL_LABELS.scale,
        max: 150,
        min: 50,
        sectionName: 'transformLens',
        step: 1,
        suffix: '%',
        truncate: true,
      }),
      sliderControl({
        aliases: ['shift'],
        id: TransformAdjustment.TransformXOffset,
        key: TransformAdjustment.TransformXOffset,
        label: TRANSFORM_LENS_CONTROL_LABELS.xOffset,
        max: 100,
        min: -100,
        sectionName: 'transformLens',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        aliases: ['shift'],
        id: TransformAdjustment.TransformYOffset,
        key: TransformAdjustment.TransformYOffset,
        label: TRANSFORM_LENS_CONTROL_LABELS.yOffset,
        max: 100,
        min: -100,
        sectionName: 'transformLens',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        aliases: ['optical', 'warp'],
        id: TransformAdjustment.TransformDistortion,
        key: TransformAdjustment.TransformDistortion,
        label: TRANSFORM_LENS_CONTROL_LABELS.opticalDistortion,
        max: 100,
        min: -100,
        sectionName: 'transformLens',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        aliases: ['lens', 'profile'],
        disabled: !lensAvailability.distortion || !adjustments.lensDistortionEnabled,
        fillOrigin: 'min',
        id: LensAdjustment.LensDistortionAmount,
        key: LensAdjustment.LensDistortionAmount,
        label: TRANSFORM_LENS_CONTROL_LABELS.distortionAmount,
        max: 200,
        min: 0,
        sectionName: 'transformLens',
        step: 1,
        suffix: '%',
        truncate: true,
      }),
      sliderControl({
        aliases: ['lens', 'ca', 'chromatic aberration'],
        disabled: !lensAvailability.tca || !adjustments.lensTcaEnabled,
        fillOrigin: 'min',
        id: LensAdjustment.LensTcaAmount,
        key: LensAdjustment.LensTcaAmount,
        label: TRANSFORM_LENS_CONTROL_LABELS.correctionAmount,
        max: 200,
        min: 0,
        sectionName: 'transformLens',
        step: 1,
        suffix: '%',
        truncate: true,
      }),
      sliderControl({
        aliases: ['lens', 'vignette'],
        disabled: !lensAvailability.vignetting || !adjustments.lensVignetteEnabled,
        fillOrigin: 'min',
        id: LensAdjustment.LensVignetteAmount,
        key: LensAdjustment.LensVignetteAmount,
        label: TRANSFORM_LENS_CONTROL_LABELS.vignetteAmount,
        max: 200,
        min: 0,
        sectionName: 'transformLens',
        step: 1,
        suffix: '%',
        truncate: true,
      }),
    ];

    const detailControls: DevelopPanelControl[] = [
      {
        id: DetailsAdjustment.DeblurEnabled,
        isDirty: adjustments.deblurEnabled !== INITIAL_ADJUSTMENTS.deblurEnabled,
        label: t('adjustments.details.enableDeblur'),
        render: () => (
          <Switch
            checked={adjustments.deblurEnabled}
            chrome="editor"
            className="min-h-5"
            label={t('adjustments.details.enableDeblur')}
            onChange={(checked) => {
              handleBooleanAdjustmentChange(DetailsAdjustment.DeblurEnabled, checked);
            }}
          />
        ),
        searchText: buildSearchText('details', t('adjustments.details.enableDeblur'), ['deblur']),
        sectionName: 'details',
      },
      sliderControl({
        disabled: !adjustments.deblurEnabled,
        fillOrigin: 'min',
        id: DetailsAdjustment.DeblurStrength,
        key: DetailsAdjustment.DeblurStrength,
        label: t('adjustments.details.amount'),
        max: 100,
        min: 0,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        defaultValue: 0.8,
        disabled: !adjustments.deblurEnabled,
        id: DetailsAdjustment.DeblurSigmaPx,
        key: DetailsAdjustment.DeblurSigmaPx,
        label: t('adjustments.details.blurRadius'),
        max: 1.35,
        min: 0.45,
        sectionName: 'details',
        step: 0.05,
        suffix: ' px',
      }),
      sliderControl({
        id: DetailsAdjustment.Sharpness,
        key: DetailsAdjustment.Sharpness,
        label: t('adjustments.details.sharpness'),
        max: 100,
        min: -100,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        defaultValue: 15,
        fillOrigin: 'min',
        id: DetailsAdjustment.SharpnessThreshold,
        key: DetailsAdjustment.SharpnessThreshold,
        label: t('adjustments.details.threshold'),
        max: 80,
        min: 0,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: DetailsAdjustment.Clarity,
        key: DetailsAdjustment.Clarity,
        label: t('adjustments.details.clarity'),
        max: 100,
        min: -100,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: DetailsAdjustment.Dehaze,
        key: DetailsAdjustment.Dehaze,
        label: t('adjustments.details.dehaze'),
        max: 100,
        min: -100,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: DetailsAdjustment.Structure,
        key: DetailsAdjustment.Structure,
        label: t('adjustments.details.structure'),
        max: 100,
        min: -100,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        aliases: ['center'],
        id: DetailsAdjustment.Centré,
        key: DetailsAdjustment.Centré,
        label: t('adjustments.details.centre'),
        max: 100,
        min: -100,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: DetailsAdjustment.LumaNoiseReduction,
        key: DetailsAdjustment.LumaNoiseReduction,
        label: t('adjustments.details.luminance'),
        max: 100,
        min: 0,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: DetailsAdjustment.ColorNoiseReduction,
        key: DetailsAdjustment.ColorNoiseReduction,
        label: t('adjustments.details.color'),
        max: 100,
        min: 0,
        sectionName: 'details',
        step: 1,
        truncate: true,
      }),
    ];

    const effectControls = [
      sliderControl({
        fillOrigin: 'min',
        id: CreativeAdjustment.GlowAmount,
        key: CreativeAdjustment.GlowAmount,
        label: t('adjustments.effects.glow'),
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        fillOrigin: 'min',
        id: CreativeAdjustment.HalationAmount,
        key: CreativeAdjustment.HalationAmount,
        label: t('adjustments.effects.halation'),
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        fillOrigin: 'min',
        id: CreativeAdjustment.FlareAmount,
        key: CreativeAdjustment.FlareAmount,
        label: t('adjustments.effects.lightFlares'),
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        id: Effect.VignetteAmount,
        key: Effect.VignetteAmount,
        label: `${t('adjustments.effects.vignette')} ${t('adjustments.effects.amount')}`,
        max: 100,
        min: -100,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        defaultValue: 50,
        fillOrigin: 'min',
        id: Effect.VignetteMidpoint,
        key: Effect.VignetteMidpoint,
        label: `${t('adjustments.effects.vignette')} ${t('adjustments.effects.midpoint')}`,
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        fillOrigin: 'min',
        id: Effect.GrainAmount,
        key: Effect.GrainAmount,
        label: `${t('adjustments.effects.grain')} ${t('adjustments.effects.amount')}`,
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        defaultValue: 25,
        fillOrigin: 'min',
        id: Effect.GrainSize,
        key: Effect.GrainSize,
        label: `${t('adjustments.effects.grain')} ${t('adjustments.effects.size')}`,
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
      sliderControl({
        defaultValue: 50,
        fillOrigin: 'min',
        id: Effect.GrainRoughness,
        key: Effect.GrainRoughness,
        label: `${t('adjustments.effects.grain')} ${t('adjustments.effects.roughness')}`,
        max: 100,
        min: 0,
        sectionName: 'effects',
        step: 1,
        truncate: true,
      }),
    ];

    return [...basicControls, ...curveControls, ...transformLensControls, ...detailControls, ...effectControls];
  }, [adjustments, onDragStateChange, setAdjustments, t]);

  const normalizedDevelopPanelSearchQuery = useMemo(
    () => normalizeDevelopPanelSearchText(developPanelSearchQuery),
    [developPanelSearchQuery],
  );
  const isDevelopPanelSearching = normalizedDevelopPanelSearchQuery.length > 0;
  const developPanelControlById = useMemo(
    () => new Map(developPanelControls.map((control) => [control.id, control])),
    [developPanelControls],
  );
  const pinnedDevelopPanelControls = useMemo(
    () =>
      developPanelPinnedControlIds
        .map((controlId) => developPanelControlById.get(controlId))
        .filter((control): control is DevelopPanelControl => control !== undefined),
    [developPanelControlById, developPanelPinnedControlIds],
  );
  const filteredDevelopPanelControls = useMemo(
    () =>
      isDevelopPanelSearching
        ? developPanelControls.filter((control) => control.searchText.includes(normalizedDevelopPanelSearchQuery))
        : [],
    [developPanelControls, isDevelopPanelSearching, normalizedDevelopPanelSearchQuery],
  );
  const matchingDevelopPanelSections = useMemo(
    () => new Set(filteredDevelopPanelControls.map((control) => control.sectionName)),
    [filteredDevelopPanelControls],
  );

  const isDevelopPanelControlPinned = useCallback(
    (controlId: string) => developPanelPinnedControlIds.includes(controlId),
    [developPanelPinnedControlIds],
  );

  const toggleDevelopPanelPinnedControl = useCallback(
    (controlId: string) => {
      const nextPinnedControlIds = developPanelPinnedControlIds.includes(controlId)
        ? developPanelPinnedControlIds.filter((pinnedControlId) => pinnedControlId !== controlId)
        : [...developPanelPinnedControlIds, controlId].slice(-PINNED_CONTROLS_LIMIT);
      setDevelopPanelPinnedControlIds(nextPinnedControlIds);
    },
    [developPanelPinnedControlIds, setDevelopPanelPinnedControlIds],
  );

  const setCopiedSectionAdjustments = useCallback(
    (val: CopiedSectionAdjustments | null) => {
      setEditor({ copiedSectionAdjustments: val });
    },
    [setEditor],
  );

  const setCollapsibleState = useCallback(
    (updater: CollapsibleSectionsUpdater) => {
      setUI((state) => ({
        collapsibleSectionsState: typeof updater === 'function' ? updater(state.collapsibleSectionsState) : updater,
      }));
    },
    [setUI],
  );

  const focusDevelopPanelPinnedControl = useCallback((controlId: string) => {
    window.requestAnimationFrame(() => {
      const escapedControlId = escapeDevelopPanelSelectorValue(controlId);
      const control = document.querySelector<HTMLElement>(`[data-testid="develop-pinned-control-${escapedControlId}"]`);
      const focusTarget =
        control?.querySelector<HTMLElement>(`[data-testid="develop-pinned-control-${escapedControlId}-range"]`) ??
        control?.querySelector<HTMLElement>(DEVELOP_PANEL_FOCUSABLE_SELECTOR) ??
        control;
      focusTarget?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      focusTarget?.focus({ preventScroll: true });
    });
  }, []);

  const focusCanonicalDevelopPanelControl = useCallback((control: DevelopPanelControl) => {
    window.requestAnimationFrame(() => {
      const section = document.querySelector<HTMLElement>(
        `[data-testid="adjustments-section-${escapeDevelopPanelSelectorValue(control.sectionName)}"]`,
      );
      const labelledFocusTarget = Array.from(
        section?.querySelectorAll<HTMLElement>(DEVELOP_PANEL_FOCUSABLE_SELECTOR) ?? [],
      ).find((element) => {
        const ariaLabel = element.getAttribute('aria-label');
        return ariaLabel === control.label || ariaLabel === `${control.label} value`;
      });
      const focusTarget = labelledFocusTarget ?? section?.querySelector<HTMLElement>(DEVELOP_PANEL_FOCUSABLE_SELECTOR);
      focusTarget?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      focusTarget?.focus({ preventScroll: true });
    });
  }, []);

  const activateDevelopPanelSearchResult = useCallback(
    (control: DevelopPanelControl) => {
      const wasPinned = developPanelPinnedControlIds.includes(control.id);
      const nextPinnedControlIds = wasPinned
        ? developPanelPinnedControlIds.filter((pinnedControlId) => pinnedControlId !== control.id)
        : [...developPanelPinnedControlIds, control.id].slice(-PINNED_CONTROLS_LIMIT);

      setDevelopPanelPinnedControlIds(nextPinnedControlIds);
      setCollapsibleState((prev) => (prev[control.sectionName] ? prev : { ...prev, [control.sectionName]: true }));

      if (wasPinned) {
        focusCanonicalDevelopPanelControl(control);
      } else {
        focusDevelopPanelPinnedControl(control.id);
      }
    },
    [
      developPanelPinnedControlIds,
      focusCanonicalDevelopPanelControl,
      focusDevelopPanelPinnedControl,
      setCollapsibleState,
      setDevelopPanelPinnedControlIds,
    ],
  );

  const handleDevelopPanelSearchResultKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, control: DevelopPanelControl) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      activateDevelopPanelSearchResult(control);
    },
    [activateDevelopPanelSearchResult],
  );

  useEffect(() => {
    if (!isDevelopPanelSearching || matchingDevelopPanelSections.size === 0) {
      return;
    }

    setCollapsibleState((prev) => {
      let didChange = false;
      const nextState = { ...prev };
      matchingDevelopPanelSections.forEach((sectionName) => {
        if (!nextState[sectionName]) {
          nextState[sectionName] = true;
          didChange = true;
        }
      });
      return didChange ? nextState : prev;
    });
  }, [isDevelopPanelSearching, matchingDevelopPanelSections, setCollapsibleState]);

  const handleToggleVisibility = (sectionName: AdjustmentSectionName) => {
    setAdjustments((prev: Adjustments) => {
      const currentVisibility = prev.sectionVisibility;
      return {
        ...prev,
        sectionVisibility: {
          ...currentVisibility,
          [sectionName]: !currentVisibility[sectionName],
        },
      };
    });
  };

  const handleRawProcessingModeOverrideChange = useCallback(
    async (mode: RawProcessingModeOverrideOption): Promise<boolean> => {
      if (!selectedImage?.path) return false;

      const rawProcessingModeOverride = mode === 'inherit' ? null : mode;
      const nextAdjustments = { ...adjustments, rawProcessingModeOverride };
      setApplyingRawProcessingMode(rawProcessingModeOverride);

      try {
        await invokeWithSchema(
          Invokes.SaveMetadataAndUpdateThumbnail,
          { adjustments: nextAdjustments, path: selectedImage.path },
          emptyTauriResponseSchema,
        );
        await invokeWithSchema(Invokes.ClearImageCaches, {}, emptyTauriResponseSchema);
        setAdjustments(nextAdjustments);
        setEditor((state) =>
          state.selectedImage?.path === selectedImage.path
            ? {
                finalPreviewUrl: null,
                interactivePatch: null,
                previewScopeStatus: null,
                selectedImage: { ...state.selectedImage, isReady: false },
                transformedOriginalUrl: null,
                uncroppedAdjustedPreviewUrl: null,
              }
            : {},
        );
        return true;
      } catch (error) {
        toast.error(t('editor.adjustments.rawProcessingModeOverride.error', { error: formatUnknownError(error) }));
        return false;
      } finally {
        setApplyingRawProcessingMode(null);
      }
    },
    [adjustments, selectedImage, setAdjustments, setEditor, t],
  );

  const handleCompareRawReconstructionModes = useCallback(async () => {
    if (!selectedImage?.path || !selectedImage.isRaw) return;

    setIsComparingRawReconstruction(true);
    try {
      const comparison = await invokeWithSchema(
        Invokes.CompareRawReconstructionModes,
        { cropSize: RAW_RECONSTRUCTION_COMPARISON_CROP_SIZE, path: selectedImage.path },
        rawReconstructionComparisonResultSchema,
      );
      setRawReconstructionComparison(comparison);
      setAppliedRawReconstructionModeReceipt(null);
    } catch (error) {
      toast.error(t('editor.adjustments.rawReconstructionComparison.error', { error: formatUnknownError(error) }));
    } finally {
      setIsComparingRawReconstruction(false);
    }
  }, [selectedImage, t]);

  const handleApplyRawReconstructionComparisonMode = useCallback(
    async (modeResult: RawReconstructionComparisonModeResult) => {
      const didApply = await handleRawProcessingModeOverrideChange(modeResult.mode);
      if (!didApply) return;

      setAppliedRawReconstructionModeReceipt({
        cropHash: modeResult.cropHash,
        decodeElapsedMs: modeResult.decodeElapsedMs,
        mode: modeResult.mode,
        proofBoundary: rawReconstructionComparison?.proofBoundary ?? 'runtime_raw_reconstruction_mode_crop_comparison',
        savedOverrideValue: modeResult.mode,
      });
    },
    [handleRawProcessingModeOverrideChange, rawReconstructionComparison?.proofBoundary],
  );

  const handleResetAdjustments = () => {
    const resetValues = pickAdjustmentValues(Object.values(ADJUSTMENT_SECTIONS).flat(), INITIAL_ADJUSTMENTS);

    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...resetValues,
      sectionVisibility: { ...INITIAL_ADJUSTMENTS.sectionVisibility },
    }));
  };

  const handleResetClippingEndpoints = () => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      levels: {
        ...prev.levels,
        inputBlack: INITIAL_ADJUSTMENTS.levels.inputBlack,
        inputWhite: INITIAL_ADJUSTMENTS.levels.inputWhite,
      },
    }));
  };

  const handleToggleSection = (section: AdjustmentSectionName) => {
    setCollapsibleState((prev) => {
      const isOpening = !prev[section];
      if (appSettings?.enableFocusMode && isOpening) {
        const newState = { ...prev };
        ADJUSTMENT_SECTION_NAMES.forEach((key) => {
          newState[key] = false;
        });
        newState[section] = true;
        return newState;
      }
      return { ...prev, [section]: !prev[section] };
    });
  };

  const buildSectionActions = (sectionName: AdjustmentSectionName): AdjustmentSectionActions => {
    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];

    const handleCopy = () => {
      const adjustmentsToCopy = pickAdjustmentValues(sectionKeys, adjustments, { requireExistingKey: true });
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      const copiedSection = copiedSectionAdjustments;
      if (!copiedSection || copiedSection.section !== sectionName) {
        return;
      }
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...copiedSection.values,
        sectionVisibility: {
          ...prev.sectionVisibility,
          [sectionName]: true,
        },
      }));
    };

    const handleReset = () => {
      const resetValues = pickAdjustmentValues(sectionKeys, INITIAL_ADJUSTMENTS);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...resetValues,
        sectionVisibility: {
          ...prev.sectionVisibility,
          [sectionName]: true,
        },
      }));
    };

    const copiedSection = copiedSectionAdjustments;
    const isPasteAllowed = copiedSection?.section === sectionName;
    const translatedSection = getAdjustmentSectionLabel(t, sectionName);

    const pasteLabel = copiedSection
      ? t('editor.adjustments.actions.pasteLabel', { section: translatedSection })
      : t('editor.adjustments.actions.pasteSettings');

    const copyOption: Option = {
      label: t('editor.adjustments.actions.copySectionSettings', { section: translatedSection }),
      icon: Copy,
      onClick: handleCopy,
    };
    const pasteOption: Option = {
      label: pasteLabel,
      icon: ClipboardPaste,
      onClick: handlePaste,
      disabled: !isPasteAllowed,
    };
    const resetOption: Option = {
      label: t('editor.adjustments.actions.resetSectionSettings', { section: translatedSection }),
      icon: RotateCcw,
      onClick: handleReset,
    };
    const menuOptions: Option[] = [copyOption, pasteOption, { type: OPTION_SEPARATOR }, resetOption];

    return {
      headerActions: (
        [
          [copyOption, 'copy'],
          [pasteOption, 'paste'],
          [resetOption, 'reset'],
        ] satisfies Array<[Option, string]>
      ).flatMap(([option, actionName]) => {
        const action = toHeaderAction(option, `adjustments-section-${sectionName}-action-${String(actionName)}`);
        return action ? [action] : [];
      }),
      menuOptions,
    };
  };

  const openSectionActionsMenu = (x: number, y: number, sectionName: AdjustmentSectionName) => {
    showContextMenu(x, y, buildSectionActions(sectionName).menuOptions);
  };

  const handleSectionContextMenu = (event: MouseEvent<HTMLDivElement>, sectionName: AdjustmentSectionName) => {
    event.preventDefault();
    event.stopPropagation();
    openSectionActionsMenu(event.clientX, event.clientY, sectionName);
  };

  const renderSectionComponent = (sectionName: AdjustmentSectionName): ReactNode => {
    switch (sectionName) {
      case 'basic':
        return (
          <>
            {activeClippingStatusChips.length > 0 && (
              <div
                className="mb-2 rounded border border-editor-danger/40 bg-editor-danger-surface px-2 py-2 text-xs"
                data-clipping-state={clippingWarningState}
                data-testid="adjustments-clipping-warning"
                role="status"
              >
                <div className="flex items-start gap-2">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-editor-danger" size={14} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-editor-danger">
                      {t('editor.adjustments.clippingWarning.title')}
                    </div>
                    <div className="text-text-secondary">
                      {activeClippingStatusChips.map((chip) => chip.detail).join(' · ')}
                    </div>
                  </div>
                  <button
                    className="shrink-0 rounded border border-editor-danger/50 px-2 py-1 font-medium text-editor-danger transition-colors hover:bg-editor-danger/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                    data-testid="adjustments-clipping-reset-endpoints"
                    onClick={handleResetClippingEndpoints}
                    type="button"
                  >
                    {t('editor.adjustments.clippingWarning.action')}
                  </button>
                </div>
              </div>
            )}
            <BasicAdjustments
              adjustments={adjustments}
              setAdjustments={setAdjustments}
              appSettings={appSettings}
              onDragStateChange={onDragStateChange}
            />
          </>
        );
      case 'curves':
        return (
          <CurveGraph
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            histogram={histogram}
            theme={theme}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'transformLens':
        return (
          <TransformLens
            adjustments={adjustments}
            selectedImage={selectedImage}
            setAdjustments={setAdjustments}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'details':
        return (
          <DetailsPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'effects':
        return (
          <EffectsPanel
            adjustments={adjustments}
            setAdjustments={setAdjustments}
            isForMask={false}
            handleLutSelect={(path) => {
              void handleLutSelect(path);
            }}
            appSettings={appSettings}
            onDragStateChange={onDragStateChange}
          />
        );
    }
  };

  return (
    <div className="flex h-full flex-col bg-editor-panel text-text-primary">
      <div className={density.panelHeader.root}>
        <UiText as="h2" variant={TextVariants.heading} className={density.panelHeader.title}>
          {t('editor.adjustments.title')}
        </UiText>
        <div className="flex items-center gap-1">
          <button
            aria-label={t('editor.adjustments.tooltips.autoAdjust')}
            className={density.panelHeader.actionButton}
            disabled={!selectedImage?.isReady}
            onClick={() => {
              void handleAutoAdjustments();
            }}
            data-tooltip={t('editor.adjustments.tooltips.autoAdjust')}
            type="button"
          >
            <Aperture size={PANEL_ACTION_ICON_SIZE} />
          </button>
          <button
            aria-label={t('editor.adjustments.tooltips.toggleAnalytics')}
            aria-pressed={isWaveformVisible}
            className={cx(
              density.panelHeader.actionButton,
              isWaveformVisible && density.panelHeader.actionButtonActive,
            )}
            data-state={isWaveformVisible ? 'open' : 'closed'}
            onClick={onToggleWaveform}
            data-testid="adjustments-panel-scopes-toggle"
            data-tooltip={t('editor.adjustments.tooltips.toggleAnalytics')}
            type="button"
          >
            <ChartArea size={PANEL_ACTION_ICON_SIZE} />
          </button>
          <button
            aria-label={t('editor.adjustments.tooltips.resetAdjustments')}
            className={density.panelHeader.actionButton}
            disabled={!selectedImage}
            onClick={() => {
              handleResetAdjustments();
            }}
            data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
            type="button"
          >
            <RotateCcw size={PANEL_ACTION_ICON_SIZE} />
          </button>
        </div>
      </div>

      {selectedImage?.isRaw && (
        <div
          className={density.rawProcessing.root}
          data-attention={isRawProcessingStatusAttentionRequired}
          data-testid="raw-processing-mode-override-control"
        >
          <button
            aria-expanded={isRawProcessingControlsOpen}
            className={density.rawProcessing.disclosure}
            onClick={() => {
              setIsRawProcessingControlsOpen((previous) => !previous);
            }}
            type="button"
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <UiText as="span" variant={TextVariants.small} className={density.rawProcessing.label}>
                {t('editor.adjustments.rawProcessingModeOverride.label')}
              </UiText>
              <UiText as="span" variant={TextVariants.small} className={density.rawProcessing.statusValue}>
                {t('editor.adjustments.rawProcessingModeOverride.currentValue', {
                  mode: rawProcessingModeDisplay,
                })}
              </UiText>
              {isRawProcessingStatusAttentionRequired && (
                <span className={editorChromeStatusChipClassName('warning')}>
                  {t('editor.adjustments.rawProcessingModeOverride.attention', { defaultValue: 'Check' })}
                </span>
              )}
            </span>
            <ChevronDown
              className={cx('shrink-0 text-accent/90 transition-transform duration-200', {
                'rotate-180': isRawProcessingControlsOpen,
              })}
              size={16}
            />
          </button>

          {isRawProcessingControlsOpen && (
            <div className={density.rawProcessing.body}>
              <div className="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-2 max-[380px]:grid-cols-1">
                <UiText as="div" variant={TextVariants.small} className={density.rawProcessing.description}>
                  {t('editor.adjustments.rawProcessingModeOverride.description')}
                </UiText>
                <Dropdown
                  chrome="editor"
                  className="w-full shrink-0"
                  onChange={(mode) => {
                    void handleRawProcessingModeOverrideChange(mode);
                  }}
                  options={rawProcessingModeOverrideOptions}
                  value={adjustments.rawProcessingModeOverride ?? 'inherit'}
                />
              </div>
              <div className="flex items-center justify-end">
                <button
                  className={density.rawProcessing.provenanceButton}
                  onClick={() => {
                    setIsRawProcessingModeProvenanceVisible((previous) => !previous);
                  }}
                  type="button"
                >
                  <Info size={12} />
                  {isRawProcessingModeProvenanceVisible
                    ? t('editor.adjustments.rawProcessingModeOverride.hideRecipeId')
                    : t('editor.adjustments.rawProcessingModeOverride.showRecipeId')}
                </button>
              </div>
              {isRawProcessingModeProvenanceVisible ? (
                <UiText as="div" variant={TextVariants.small} className={density.rawProcessing.provenanceValue}>
                  {getRawProcessingModeProvenance(
                    adjustments.rawProcessingModeOverride ?? normalizeRawProcessingMode(appSettings?.rawProcessingMode),
                  )}
                </UiText>
              ) : null}
              <button
                className={density.rawProcessing.compareButton}
                data-testid="raw-reconstruction-comparison-run"
                disabled={isComparingRawReconstruction || !selectedImage.isReady}
                aria-busy={isComparingRawReconstruction}
                onClick={() => {
                  void handleCompareRawReconstructionModes();
                }}
                type="button"
              >
                <ScanSearch size={14} />
                {isComparingRawReconstruction
                  ? t('editor.adjustments.rawReconstructionComparison.running')
                  : t('editor.adjustments.rawReconstructionComparison.action')}
              </button>
              {rawReconstructionComparison !== null && (
                <div
                  className={density.rawProcessing.resultCard}
                  data-crop-size={rawReconstructionComparison.cropSize}
                  data-testid="raw-reconstruction-comparison-result"
                >
                  <div className="flex items-center justify-between gap-2">
                    <UiText variant={TextVariants.small} className="font-medium">
                      {t('editor.adjustments.rawReconstructionComparison.title')}
                    </UiText>
                    <UiText variant={TextVariants.small} className="font-mono text-text-secondary">
                      {t('editor.adjustments.rawReconstructionComparison.cropSizeLabel', {
                        size: rawReconstructionComparison.cropSize,
                      })}
                    </UiText>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {rawReconstructionComparison.modes.map((mode) => (
                      <div
                        className={cx(density.rawProcessing.resultMetric, {
                          'ring-1 ring-editor-focus-ring':
                            appliedRawReconstructionModeReceipt?.savedOverrideValue === mode.mode,
                        })}
                        data-applied={appliedRawReconstructionModeReceipt?.savedOverrideValue === mode.mode}
                        data-crop-hash={mode.cropHash}
                        data-decode-ms={mode.decodeElapsedMs}
                        data-mode={mode.mode}
                        data-testid={`raw-reconstruction-comparison-mode-${mode.mode}`}
                        key={mode.mode}
                      >
                        <img
                          alt={t('editor.adjustments.rawReconstructionComparison.cropAlt', {
                            mode: t(`settings.processing.rawModes.${mode.mode}.label`),
                          })}
                          className="aspect-square w-full rounded border border-editor-border object-cover"
                          src={mode.cropDataUrl}
                        />
                        <UiText
                          as="div"
                          variant={TextVariants.small}
                          className="truncate text-[11px] font-medium leading-4"
                        >
                          {t(`settings.processing.rawModes.${mode.mode}.label`)}
                        </UiText>
                        <UiText
                          as="div"
                          variant={TextVariants.small}
                          className="font-mono text-[10px] leading-3 text-text-secondary"
                        >
                          {t('editor.adjustments.rawReconstructionComparison.decodeMsLabel', {
                            ms: mode.decodeElapsedMs,
                          })}
                        </UiText>
                        <UiText
                          as="div"
                          variant={TextVariants.small}
                          className="truncate font-mono text-[10px] leading-3 text-text-secondary"
                        >
                          {formatBytes(mode.estimatedMemoryBytes)}
                        </UiText>
                        <button
                          className="mt-1 flex min-h-6 w-full items-center justify-center rounded bg-editor-selected-quiet px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-editor-selected-quiet-text transition-colors hover:bg-editor-selected-quiet/80 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                          data-testid={`raw-reconstruction-comparison-apply-${mode.mode}`}
                          disabled={
                            applyingRawProcessingMode !== null ||
                            adjustments.rawProcessingModeOverride === mode.mode ||
                            !selectedImage.isReady
                          }
                          onClick={() => {
                            void handleApplyRawReconstructionComparisonMode(mode);
                          }}
                          type="button"
                        >
                          {applyingRawProcessingMode === mode.mode
                            ? t('editor.adjustments.rawReconstructionComparison.applying')
                            : adjustments.rawProcessingModeOverride === mode.mode
                              ? t('editor.adjustments.rawReconstructionComparison.applied')
                              : t('editor.adjustments.rawReconstructionComparison.applyMode')}
                        </button>
                      </div>
                    ))}
                  </div>
                  {appliedRawReconstructionModeReceipt !== null && (
                    <div
                      className="space-y-1 rounded border border-editor-focus-ring/50 bg-editor-selected-quiet px-1.5 py-1"
                      data-crop-hash={appliedRawReconstructionModeReceipt.cropHash}
                      data-decode-ms={appliedRawReconstructionModeReceipt.decodeElapsedMs}
                      data-proof-boundary={appliedRawReconstructionModeReceipt.proofBoundary}
                      data-saved-override-value={appliedRawReconstructionModeReceipt.savedOverrideValue}
                      data-testid="raw-reconstruction-comparison-applied-receipt"
                    >
                      <UiText as="div" variant={TextVariants.small} className="text-[11px] font-semibold leading-4">
                        {t('editor.adjustments.rawReconstructionComparison.appliedReceiptTitle', {
                          mode: t(`settings.processing.rawModes.${appliedRawReconstructionModeReceipt.mode}.label`),
                        })}
                      </UiText>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                        <UiText variant={TextVariants.small} className="text-[10px] leading-3 text-text-secondary">
                          {t('editor.adjustments.rawReconstructionComparison.receiptSavedOverride')}
                        </UiText>
                        <UiText
                          variant={TextVariants.small}
                          className="truncate font-mono text-[10px] leading-3 text-text-primary"
                        >
                          {appliedRawReconstructionModeReceipt.savedOverrideValue}
                        </UiText>
                        <UiText variant={TextVariants.small} className="text-[10px] leading-3 text-text-secondary">
                          {t('editor.adjustments.rawReconstructionComparison.receiptCropHash')}
                        </UiText>
                        <UiText
                          variant={TextVariants.small}
                          className="truncate font-mono text-[10px] leading-3 text-text-primary"
                        >
                          {appliedRawReconstructionModeReceipt.cropHash}
                        </UiText>
                        <UiText variant={TextVariants.small} className="text-[10px] leading-3 text-text-secondary">
                          {t('editor.adjustments.rawReconstructionComparison.receiptDecodeMs')}
                        </UiText>
                        <UiText
                          variant={TextVariants.small}
                          className="font-mono text-[10px] leading-3 text-text-primary"
                        >
                          {t('editor.adjustments.rawReconstructionComparison.decodeMsLabel', {
                            ms: appliedRawReconstructionModeReceipt.decodeElapsedMs,
                          })}
                        </UiText>
                      </div>
                      <UiText as="div" variant={TextVariants.small} className="break-all font-mono text-[10px]">
                        {appliedRawReconstructionModeReceipt.proofBoundary}
                      </UiText>
                    </div>
                  )}
                  <UiText as="div" variant={TextVariants.small} className="break-all font-mono text-text-secondary">
                    {rawReconstructionComparison.proofBoundary}
                  </UiText>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <PanelScopesStrip testId="adjustments-panel-scopes-strip" />

      <div className="shrink-0 border-b border-editor-border bg-editor-panel px-2 py-1.5">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"
            size={13}
          />
          <Input
            aria-label={t('editor.adjustments.search.label', { defaultValue: 'Search adjustment controls' })}
            chrome="editor"
            className="h-6 pl-7 pr-7 text-[11px]"
            density="compact"
            onChange={(event) => {
              setDevelopPanelSearchQuery(event.currentTarget.value);
            }}
            placeholder={t('editor.adjustments.search.placeholder', { defaultValue: 'Search controls' })}
            type="search"
            value={developPanelSearchQuery}
          />
          {developPanelSearchQuery.length > 0 && (
            <button
              aria-label={t('editor.adjustments.search.clear', { defaultValue: 'Clear search' })}
              className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
              onClick={() => {
                setDevelopPanelSearchQuery('');
              }}
              type="button"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {isDevelopPanelSearching && (
          <div
            className="mt-1 flex max-h-20 flex-wrap gap-1 overflow-y-auto"
            data-testid="develop-panel-search-results"
          >
            {filteredDevelopPanelControls.length > 0 ? (
              filteredDevelopPanelControls.map((control) => {
                const isPinned = isDevelopPanelControlPinned(control.id);
                const PinIcon = isPinned ? PinOff : Pin;
                return (
                  <button
                    aria-pressed={isPinned}
                    className={cx(
                      'inline-flex min-h-6 max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
                      isPinned
                        ? 'border-editor-focus-ring bg-editor-selected-quiet text-editor-selected-quiet-text'
                        : 'border-editor-border bg-editor-panel-well text-text-secondary hover:border-editor-focus-ring hover:text-text-primary',
                    )}
                    data-testid={`develop-panel-search-result-${control.id}`}
                    key={control.id}
                    onClick={() => {
                      activateDevelopPanelSearchResult(control);
                    }}
                    onKeyDown={(event) => {
                      handleDevelopPanelSearchResultKeyDown(event, control);
                    }}
                    type="button"
                  >
                    <PinIcon className="shrink-0" size={12} />
                    <span className="truncate">{control.label}</span>
                    {control.isDirty && (
                      <span className={cx(editorChromeStatusChipClassName('info'), 'ml-0.5 px-1 text-[9px] leading-3')}>
                        {t('ui.collapsibleSection.dirtyBadge', { defaultValue: 'Edited' })}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <UiText
                as="div"
                variant={TextVariants.small}
                className="px-0.5 text-[11px] leading-5 text-text-secondary"
              >
                {t('editor.adjustments.search.noResults', { defaultValue: 'No matching controls' })}
              </UiText>
            )}
          </div>
        )}

        {pinnedDevelopPanelControls.length > 0 && (
          <div
            className="mt-1 max-h-44 min-w-0 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5"
            data-testid="develop-panel-pinned-controls"
          >
            <div className="flex items-center justify-between gap-2">
              <UiText
                as="div"
                variant={TextVariants.small}
                className="text-[10px] font-semibold uppercase leading-4 text-text-secondary"
              >
                {t('editor.adjustments.pinnedControls.title', { defaultValue: 'Pinned' })}
              </UiText>
              <UiText
                as="div"
                variant={TextVariants.small}
                className="font-mono text-[10px] leading-4 text-text-tertiary"
              >
                {pinnedDevelopPanelControls.length}/{PINNED_CONTROLS_LIMIT}
              </UiText>
            </div>
            {pinnedDevelopPanelControls.map((control) => (
              <div
                className={cx(
                  'grid min-w-0 grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-1 rounded border border-editor-border bg-editor-panel-well px-1 py-0.5',
                  control.isDirty && 'border-editor-focus-ring/70',
                )}
                data-dirty={control.isDirty}
                data-testid={`develop-panel-pinned-control-row-${control.id}`}
                key={control.id}
              >
                <div className="min-w-0">{control.render()}</div>
                <button
                  aria-label={t('editor.adjustments.pinnedControls.unpin', {
                    control: control.label,
                    defaultValue: `Unpin ${control.label}`,
                  })}
                  className="flex h-5 w-5 items-center justify-center rounded text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring"
                  data-tooltip={t('editor.adjustments.pinnedControls.unpin', {
                    control: control.label,
                    defaultValue: `Unpin ${control.label}`,
                  })}
                  onClick={() => {
                    toggleDevelopPanelPinnedControl(control.id);
                  }}
                  type="button"
                >
                  <PinOff size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grow overflow-y-auto px-2 py-1.5 flex flex-col gap-1" ref={developPanelScrollRootRef}>
        {ADJUSTMENT_SECTION_NAMES.map((sectionName) => {
          if (isDevelopPanelSearching && !matchingDevelopPanelSections.has(sectionName)) {
            return null;
          }

          const title = getAdjustmentSectionLabel(t, sectionName);
          const sectionVisibility = adjustments.sectionVisibility;
          const sectionActions = buildSectionActions(sectionName);
          const canToggleVisibility = sectionName !== 'transformLens';
          const isContentVisible = canToggleVisibility ? sectionVisibility[sectionName] : true;

          return (
            <div className="shrink-0 group" data-testid={`adjustments-section-${sectionName}`} key={sectionName}>
              <CollapsibleSection
                actionsMenuLabel={sectionActions.headerActions.map((action) => action.label).join(', ')}
                actionsMenuTestId={`adjustments-section-${sectionName}-actions-menu`}
                canToggleVisibility={canToggleVisibility}
                headerActions={sectionActions.headerActions}
                isContentVisible={isContentVisible}
                isDirty={hasAdjustmentValueChanges(ADJUSTMENT_SECTIONS[sectionName], adjustments)}
                isOpen={collapsibleSectionsState[sectionName]}
                onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
                  handleSectionContextMenu(event, sectionName);
                }}
                onToggle={() => {
                  handleToggleSection(sectionName);
                }}
                onOpenActionsMenu={(x, y) => {
                  showContextMenu(x, y, sectionActions.menuOptions);
                }}
                onToggleVisibility={() => {
                  if (canToggleVisibility) {
                    handleToggleVisibility(sectionName);
                  }
                }}
                title={title}
              >
                {renderSectionComponent(sectionName)}
              </CollapsibleSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}
