import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { invoke } from '@tauri-apps/api/core';
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  ChartArea,
  Circle,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FileEdit,
  Folder as FolderIcon,
  FolderOpen,
  Loader2,
  Minus,
  Plus,
  PlusSquare,
  RotateCcw,
  SquaresIntersect,
  SwatchBook,
  Trash2,
} from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useContextMenu } from '../../../../context/ContextMenuContext';
import { useAiMasking } from '../../../../hooks/ai/useAiMasking';
import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { type UserPreset, usePresets } from '../../../../hooks/editor/usePresets';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import { useManagedFocus } from '../../../../hooks/ui/useManagedFocus';
import type { MaskOverlaySettings } from '../../../../schemas/masks/maskOverlaySchemas';
import {
  aiDepthMaskParametersSchema,
  type MaskRefinementParameters,
} from '../../../../schemas/masks/maskParameterSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useProcessStore } from '../../../../store/useProcessStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { useUIStore } from '../../../../store/useUIStore';
import { Invokes } from '../../../../tauri/commands';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../../types/typography';
import {
  ADJUSTMENT_SECTIONS,
  type Adjustments,
  hasAdjustmentValueChanges,
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  INITIAL_MASK_CONTAINER,
  type MaskContainer,
} from '../../../../utils/adjustments';
import { createEditorSubMaskFallback, createEditorSubMaskForImage } from '../../../../utils/editorSubMaskFactory';
import { readBrushLocalAdjustmentReceipt } from '../../../../utils/layers/brushLocalAdjustmentCommandFlow';
import {
  cloneMaskContainerForPaste,
  cloneSubMaskForPaste,
  createMaskLikeClipboardActions,
  insertMaskContainerAt,
  insertSubMaskAt,
  moveSubMaskBetweenContainers,
  reorderMaskListContainers,
  splitSubMaskToContainer,
} from '../../../../utils/mask/maskClipboard';
import {
  nextMaskOverlayHotkeySettings,
  saveMaskOverlaySettingsPreference,
} from '../../../../utils/mask/maskOverlayPreferences';
import {
  getMaskParameterNumber,
  mergeMaskParameters,
  toMaskParameterRecord,
} from '../../../../utils/mask/maskParameterAccess';
import {
  createMaskRefinementCommand,
  dispatchMaskRefinementCommand,
  readMaskRefinementReplayReceipt,
} from '../../../../utils/mask/maskRefinementCommandBus';
import {
  type AiObjectMaskProposal,
  acceptObjectMaskProposal,
  buildObjectMaskProposalCommandInput,
  clearObjectPromptCanvasState,
  type ObjectPromptMode,
  readObjectMaskProposalReplayReceipt,
  readObjectPromptCanvasState,
  setObjectPromptMode,
  writeObjectPromptCanvasState,
} from '../../../../utils/mask/objectMaskPromptCanvas';
import AdjustmentSlider from '../../../adjustments/AdjustmentSlider';
import BasicAdjustments from '../../../adjustments/Basic';
import ColorPanel from '../../../adjustments/Color';
import CurveGraph, { type ChannelConfig } from '../../../adjustments/Curves';
import DetailsPanel from '../../../adjustments/Details';
import EffectsPanel from '../../../adjustments/Effects';
import {
  type AppSettings,
  type BrushSettings,
  OPTION_SEPARATOR,
  type Option,
  Orientation,
  Theme,
} from '../../../ui/AppProperties';
import CollapsibleSection from '../../../ui/CollapsibleSection';
import Switch from '../../../ui/primitives/Switch';
import UiText from '../../../ui/primitives/Text';
import Resizer from '../../../ui/Resizer';
import Waveform from '../../editor/Waveform';
import { AiPeoplePartPickerStatus } from '../ai/AiPeoplePartPickerStatus';
import LayerStackPanel from './LayerStackPanel';
import { MaskOverlayReviewControls } from './MaskOverlayReviewControls';
import {
  formatMaskTypeName,
  getMaskTypeName,
  getSubMaskName,
  MASK_ICON_MAP,
  MASK_PANEL_CREATION_TYPES,
  Mask,
  type MaskType,
  OTHERS_MASK_TYPES,
  type SubMask,
  SubMaskMode,
  ToolType,
} from './Masks';
import {
  getMaskLikeContainerDropClass,
  getMaskLikeSubMaskDropClass,
  isMaskLikeContainerDrag,
  type MaskLikeDragData,
  useDelayedHover,
} from './maskPanelRowHelpers';
import { ObjectPromptControls } from './ObjectPromptControls';

type NumericMaskParameterPatch<TKey extends string> = Partial<Record<TKey, number>>;
type SubMaskControlParameterKey = 'feather' | 'flow' | 'grow' | 'tolerance';
type LinearGradientControlParameterKey = 'endY' | 'imageHeight' | 'range' | 'startY';
type AiDepthControlParameterKey = 'maxDepth' | 'maxFade' | 'minDepth' | 'minFade';
type MaskRefinementParameterKey = keyof MaskRefinementParameters;
type PanelMaskParameterKey =
  | AiDepthControlParameterKey
  | LinearGradientControlParameterKey
  | MaskRefinementParameterKey
  | SubMaskControlParameterKey;

interface NumericParameterConfig<TKey extends string> {
  defaultValue: number;
  key: TKey;
  max: number;
  min: number;
  multiplier?: number;
  step: number;
}

type SubMaskParameterConfig = NumericParameterConfig<SubMaskControlParameterKey>;

interface MaskRefinementParameterConfig extends NumericParameterConfig<MaskRefinementParameterKey> {
  labelKey:
    | 'editor.masks.refinement.density'
    | 'editor.masks.refinement.edgeContrast'
    | 'editor.masks.refinement.edgeShiftPx'
    | 'editor.masks.refinement.featherPx'
    | 'editor.masks.refinement.hairDetail'
    | 'editor.masks.refinement.smoothness';
}

interface SubMaskConfig {
  parameters?: Array<SubMaskParameterConfig>;
  showBrushTools?: boolean;
  showFlowControl?: boolean;
}

type BrushSettingsUpdater = BrushSettings | ((settings: BrushSettings | null) => BrushSettings);

type CollapsibleState = Record<string, boolean>;
type MaskContainerPatch = Partial<MaskContainer>;
type SubMaskPatch = Partial<SubMask>;
type MaskPropertyValue = boolean | number | string;
type MaskAdjustmentPatch = Partial<Adjustments>;
type MaskAdjustmentUpdater = MaskAdjustmentPatch | ((adjustments: Adjustments) => Adjustments);
type AdjustmentsUpdater = (updater: (adjustments: Adjustments) => Adjustments) => void;
type MaskContainerWithId = MaskContainer;
type SetState<T> = (value: T | ((previous: T) => T)) => void;
type PresetMenuItem = UserPreset & {
  adjustments?: Partial<Adjustments> | undefined;
  folder?: { children?: Array<PresetMenuItem> | undefined; name?: string | undefined } | undefined;
  preset?: { adjustments: Partial<Adjustments>; name?: string | undefined } | undefined;
};

const getPanelMaskParameterNumber = (parameters: unknown, key: PanelMaskParameterKey, fallback = 0): number =>
  getMaskParameterNumber(parameters, key, fallback);

const mergePanelMaskParameters = <TKey extends PanelMaskParameterKey>(
  parameters: unknown,
  patch: NumericMaskParameterPatch<TKey>,
) => mergeMaskParameters(parameters, patch);

const MASK_REFINEMENT_PARAMETERS: Array<MaskRefinementParameterConfig> = [
  {
    key: 'density',
    labelKey: 'editor.masks.refinement.density',
    min: 0,
    max: 100,
    step: 1,
    multiplier: 100,
    defaultValue: 100,
  },
  { key: 'featherPx', labelKey: 'editor.masks.refinement.featherPx', min: 0, max: 80, step: 1, defaultValue: 0 },
  {
    key: 'edgeShiftPx',
    labelKey: 'editor.masks.refinement.edgeShiftPx',
    min: -80,
    max: 80,
    step: 1,
    defaultValue: 0,
  },
  {
    key: 'edgeContrast',
    labelKey: 'editor.masks.refinement.edgeContrast',
    min: 0,
    max: 100,
    step: 1,
    multiplier: 100,
    defaultValue: 0,
  },
  {
    key: 'hairDetail',
    labelKey: 'editor.masks.refinement.hairDetail',
    min: 0,
    max: 100,
    step: 1,
    multiplier: 100,
    defaultValue: 0,
  },
  {
    key: 'smoothness',
    labelKey: 'editor.masks.refinement.smoothness',
    min: 0,
    max: 100,
    step: 1,
    multiplier: 100,
    defaultValue: 0,
  },
];

const MASK_REFINEMENT_WARNING_LABEL_KEYS = {
  densityLow: 'editor.masks.refinement.warnings.densityLow',
  featherHigh: 'editor.masks.refinement.warnings.featherHigh',
  hairDetailHigh: 'editor.masks.refinement.warnings.hairDetailHigh',
  shiftLarge: 'editor.masks.refinement.warnings.shiftLarge',
} as const;

type MaskRefinementWarning = keyof typeof MASK_REFINEMENT_WARNING_LABEL_KEYS;

function readAdjustmentValue(adjustments: Partial<Adjustments> | null | undefined, key: string): unknown {
  return adjustments ? (adjustments as Record<string, unknown>)[key] : undefined;
}

function writeAdjustmentPatchValue(patch: MaskAdjustmentPatch, key: string, value: unknown): void {
  (patch as Record<string, unknown>)[key] = structuredClone(value);
}

const getObjectMaskTransformAdjustments = (adjustments: Adjustments) => ({
  lensDistortionAmount: adjustments.lensDistortionAmount,
  lensDistortionEnabled: adjustments.lensDistortionEnabled,
  lensDistortionParams: adjustments.lensDistortionParams,
  lensMaker: adjustments.lensMaker,
  lensModel: adjustments.lensModel,
  lensTcaAmount: adjustments.lensTcaAmount,
  lensTcaEnabled: adjustments.lensTcaEnabled,
  lensVignetteAmount: adjustments.lensVignetteAmount,
  lensVignetteEnabled: adjustments.lensVignetteEnabled,
  transformAspect: adjustments.transformAspect,
  transformDistortion: adjustments.transformDistortion,
  transformHorizontal: adjustments.transformHorizontal,
  transformRotate: adjustments.transformRotate,
  transformScale: adjustments.transformScale,
  transformVertical: adjustments.transformVertical,
  transformXOffset: adjustments.transformXOffset,
  transformYOffset: adjustments.transformYOffset,
});

interface CopiedSectionAdjustments {
  section: string;
  values: MaskAdjustmentPatch;
}

interface DraggableGridItemProps {
  activeMaskContainerId: string | null;
  isDraggable: boolean;
  maskType: MaskType;
  onClick: (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => void;
  onRightClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

interface ContainerRowProps {
  activeDragItem: DragData | null;
  activeMaskId: string | null;
  analyzingSubMaskId: string | null;
  container: MaskContainerWithId;
  copiedMask: MaskContainer | null;
  copiedSubMask: SubMask | null;
  copyMaskToClipboard: (container: MaskContainer) => void;
  copySubMaskToClipboard: (subMask: SubMask) => void;
  handleDelete: (containerId: string) => void;
  handleDeleteSubMask: (containerId: string, subMaskId: string) => void;
  handleDuplicate: (container: MaskContainer) => void;
  handleDuplicateAndInvert: (container: MaskContainer) => void;
  handleDuplicateAndInvertSubMask: (containerId: string, subMask: SubMask) => void;
  handleDuplicateSubMask: (containerId: string, subMask: SubMask, insertIndex: number) => void;
  handlePasteMask: (containerId?: string) => void;
  handlePasteSubMask: (containerId: string, insertIndex?: number) => void;
  hasActiveChild: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  onAddComponent: (event: ReactMouseEvent<HTMLElement>) => void;
  onSelect: () => void;
  onSelectContainer: (containerId: string | null) => void;
  onSelectMask: (subMaskId: string | null) => void;
  onToggle: () => void;
  presets: Array<PresetMenuItem>;
  renamingId: string | null;
  setAdjustments: AdjustmentsUpdater;
  setIsMaskControlHovered: (isHovered: boolean) => void;
  setRenamingId: (id: string | null) => void;
  setTempName: (name: string) => void;
  tempName: string;
  updateContainer: (id: string, data: MaskContainerPatch) => void;
  updateSubMask: (id: string, data: SubMaskPatch) => void;
}

interface MaskListProps {
  activeDragItem: DragData | null;
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  analyzingSubMaskId: string | null;
  containers: Array<MaskContainerWithId>;
  copiedMask: MaskContainer | null;
  copiedSubMask: SubMask | null;
  copyMaskToClipboard: (container: MaskContainer) => void;
  copySubMaskToClipboard: (subMask: SubMask) => void;
  expandedContainers: Set<string>;
  handleDeleteContainer: (containerId: string) => void;
  handleDeleteSubMask: (containerId: string, subMaskId: string) => void;
  handleDuplicateAndInvertContainer: (container: MaskContainer) => void;
  handleDuplicateAndInvertSubMask: (containerId: string, subMask: SubMask) => void;
  handleDuplicateContainer: (container: MaskContainer) => void;
  handleDuplicateSubMask: (containerId: string, subMask: SubMask, insertIndex: number) => void;
  handlePasteMask: (containerId?: string) => void;
  handlePasteSubMask: (containerId: string, insertIndex?: number) => void;
  isRootOver: boolean;
  onAddComponent: (
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>,
    containerId: string | null,
  ) => void;
  onExitComplete: () => void;
  onRootClick: () => void;
  onSelectContainer: (containerId: string | null) => void;
  onSelectMask: (subMaskId: string | null) => void;
  onToggleContainer: (containerId: string) => void;
  presets: Array<PresetMenuItem>;
  renamingId: string | null;
  rootDroppableRef: (element: HTMLElement | null) => void;
  setAdjustments: AdjustmentsUpdater;
  setIsMaskControlHovered: (isHovered: boolean) => void;
  setRenamingId: (id: string | null) => void;
  setTempName: (name: string) => void;
  tempName: string;
  updateContainer: (id: string, data: MaskContainerPatch) => void;
  updateSubMask: (id: string, data: SubMaskPatch) => void;
}

interface SubMaskRowProps {
  activeDragItem: DragData | null;
  analyzingSubMaskId: string | null;
  containerId: string;
  handleCopy: () => void;
  handleDelete: () => void;
  handleDuplicate: () => void;
  handleDuplicateAndInvert: () => void;
  handlePaste: () => void;
  hasCopiedSubMask: boolean;
  index: number;
  isActive: boolean;
  onSelect: () => void;
  parentVisible: boolean;
  renamingId: string | null;
  setIsMaskControlHovered: (isHovered: boolean) => void;
  setRenamingId: (id: string | null) => void;
  setTempName: (name: string) => void;
  subMask: SubMask;
  tempName: string;
  totalCount: number;
  updateSubMask: (id: string, data: SubMaskPatch) => void;
}

interface SettingsPanelProps {
  activeSubMask: SubMask | null;
  aiModelDownloadStatus: string | null;
  appSettings: AppSettings | null;
  brushSettings: BrushSettings | null;
  collapsibleState: CollapsibleState;
  container: MaskContainerWithId | null;
  copiedSectionAdjustments: CopiedSectionAdjustments | null;
  handleLutSelect: (path: string) => void;
  histogram: ChannelConfig | null;
  isGeneratingAiMask: boolean;
  isSettingsSectionOpen: boolean;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  presets: Array<PresetMenuItem>;
  setBrushSettings: (updater: BrushSettingsUpdater) => void;
  setCollapsibleState: SetState<CollapsibleState>;
  setCopiedSectionAdjustments: (adjustments: CopiedSectionAdjustments | null) => void;
  setIsMaskControlHovered: (isHovered: boolean) => void;
  setSettingsSectionOpen: (isOpen: boolean) => void;
  updateContainer: (id: string, data: MaskContainerPatch) => void;
  updateSubMask: (id: string, data: SubMaskPatch) => void;
}

interface DragData extends MaskLikeDragData {
  type: 'Container' | 'SubMask' | 'Creation';
  item?: MaskContainer | SubMask;
  maskType?: Mask;
  parentId?: string;
}

const SUB_MASK_CONFIG: Record<Mask, SubMaskConfig> = {
  [Mask.Radial]: {
    parameters: [{ key: 'feather', min: 0, max: 100, step: 1, multiplier: 100, defaultValue: 50 }],
  },
  [Mask.Brush]: { showBrushTools: true },
  [Mask.Flow]: { showBrushTools: true, showFlowControl: true },
  [Mask.Linear]: { parameters: [] },
  [Mask.Color]: {
    parameters: [
      { key: 'tolerance', min: 1, max: 100, step: 1, defaultValue: 20 },
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 35 },
    ],
  },
  [Mask.Luminance]: {
    parameters: [
      { key: 'tolerance', min: 1, max: 100, step: 1, defaultValue: 20 },
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 35 },
    ],
  },
  [Mask.All]: { parameters: [] },
  [Mask.AiDepth]: {
    parameters: [{ key: 'feather', min: 0, max: 100, step: 1, defaultValue: 15 }],
  },
  [Mask.AiSubject]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.AiForeground]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.AiPerson]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.AiObject]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.AiSky]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.QuickEraser]: { parameters: [] },
};

const parameterLabelFallback = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());

const getMaskParameterString = (parameters: unknown, ...keys: Array<string>): string | null => {
  const record = toMaskParameterRecord(parameters);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
};

const getAiPersonTargetPart = (parameters: unknown): string | null => {
  const record = toMaskParameterRecord(parameters);
  const target = record['target'];
  if (target && typeof target === 'object' && 'part' in target) {
    const part = (target as Record<string, unknown>)['part'];
    if (typeof part === 'string' && part.trim().length > 0) return part;
  }
  return getMaskParameterString(parameters, 'targetPart', 'target_part');
};

function AiPersonMaskProvenance({ parameters }: { parameters: unknown }) {
  const { t } = useTranslation();
  const record = toMaskParameterRecord(parameters);
  const targetPart = getAiPersonTargetPart(parameters);
  const providerTier = getMaskParameterString(parameters, 'providerTier', 'providerId', 'provider_id');
  const modelId = getMaskParameterString(parameters, 'modelId', 'model_id');
  const modelSha256 = getMaskParameterString(parameters, 'modelSha256', 'model_sha256');
  const classIds = Array.isArray(record['classIds'])
    ? record['classIds']
    : Array.isArray(record['class_ids'])
      ? record['class_ids']
      : [];
  const hasMaskData = typeof record['maskDataBase64'] === 'string' || typeof record['mask_data_base64'] === 'string';

  if (targetPart === null && providerTier === null && modelId === null) return null;

  return (
    <div
      className="grid gap-1 rounded-md border border-surface bg-bg-secondary p-2 text-[11px]"
      data-class-ids={classIds.join(',')}
      data-has-mask-data={String(hasMaskData)}
      data-model-id={modelId ?? ''}
      data-model-sha256={modelSha256 ?? ''}
      data-provider-tier={providerTier ?? ''}
      data-target-part={targetPart ?? ''}
      data-testid="ai-person-mask-provenance"
    >
      <UiText variant={TextVariants.small} color={TextColors.secondary} className="font-medium">
        {t('editor.masks.aiPeopleParts.provenanceTitle')}
      </UiText>
      <div className="grid grid-cols-2 gap-1">
        <span className="truncate text-text-tertiary">{t('editor.masks.aiPeopleParts.target')}</span>
        <span className="truncate text-text-secondary">{targetPart ?? t('editor.masks.aiPeopleParts.unknown')}</span>
        <span className="truncate text-text-tertiary">{t('editor.masks.aiPeopleParts.provider')}</span>
        <span className="truncate text-text-secondary">{providerTier ?? t('editor.masks.aiPeopleParts.unknown')}</span>
        <span className="truncate text-text-tertiary">{t('editor.masks.aiPeopleParts.model')}</span>
        <span className="truncate text-text-secondary">{modelId ?? t('editor.masks.aiPeopleParts.notAvailable')}</span>
        <span className="truncate text-text-tertiary">{t('editor.masks.aiPeopleParts.classes')}</span>
        <span className="truncate text-text-secondary">
          {classIds.length > 0 ? classIds.join(', ') : t('editor.masks.aiPeopleParts.notAvailable')}
        </span>
      </div>
    </div>
  );
}

const BrushTools = ({
  settings,
  onSettingsChange,
  onDragStateChange,
}: {
  settings: BrushSettings;
  onSettingsChange: (updater: BrushSettingsUpdater) => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}) => {
  const { t } = useTranslation();

  return (
    <div>
      <AdjustmentSlider
        defaultValue={100}
        label={t('editor.masks.brush.size')}
        max={200}
        min={1}
        onValueChange={(value) => {
          onSettingsChange((settings) => ({
            ...(settings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
            size: value,
          }));
        }}
        step={1}
        value={settings.size}
        fillOrigin="min"
        onDragStateChange={onDragStateChange}
      />
      <AdjustmentSlider
        defaultValue={50}
        label={t('editor.masks.brush.feather')}
        max={100}
        min={0}
        onValueChange={(value) => {
          onSettingsChange((settings) => ({
            ...(settings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
            feather: value,
          }));
        }}
        step={1}
        value={settings.feather}
        fillOrigin="min"
        onDragStateChange={onDragStateChange}
      />
      <div className="grid grid-cols-2 gap-2 pt-2">
        <button
          className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === ToolType.Brush ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}
          onClick={() => {
            onSettingsChange((settings) => ({
              ...(settings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
              tool: ToolType.Brush,
            }));
          }}
        >
          {t('editor.masks.brush.brush')}
        </button>
        <button
          className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${settings.tool === ToolType.Eraser ? 'text-primary bg-surface' : 'bg-surface text-text-secondary hover:bg-card-active'}`}
          onClick={() => {
            onSettingsChange((settings) => ({
              ...(settings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
              tool: ToolType.Eraser,
            }));
          }}
        >
          {t('editor.masks.brush.eraser')}
        </button>
      </div>
    </div>
  );
};

const FlowBrushTool = ({
  flow,
  onFlowChange,
  settings,
  onSettingsChange,
  onDragStateChange,
}: {
  flow: number;
  onFlowChange: (flow: number) => void;
  settings: BrushSettings;
  onSettingsChange: (updater: BrushSettingsUpdater) => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 border-t border-surface">
      <AdjustmentSlider
        defaultValue={10}
        label={t('editor.masks.brush.flow')}
        max={100}
        min={0}
        onValueChange={(value) => {
          onFlowChange(value);
        }}
        step={1}
        value={flow}
        fillOrigin="min"
        onDragStateChange={onDragStateChange}
      />
      <BrushTools settings={settings} onSettingsChange={onSettingsChange} onDragStateChange={onDragStateChange} />
    </div>
  );
};

function DepthRangePicker({
  minDepth,
  maxDepth,
  minFade,
  maxFade,
  onChange,
  onDragStateChange,
}: {
  minDepth: number;
  maxDepth: number;
  minFade: number;
  maxFade: number;
  onChange: (values: { minDepth: number; maxDepth: number; minFade: number; maxFade: number }) => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [dragValues, setDragValues] = useState<{
    minDepth: number;
    maxDepth: number;
    minFade: number;
    maxFade: number;
  } | null>(null);
  const [isLabelHovered, setIsLabelHovered] = useState(false);

  const vals = dragValues ?? { minDepth, maxDepth, minFade, maxFade };
  const fadeLeftEdge = Math.max(0, vals.minDepth - vals.minFade);
  const fadeRightEdge = Math.min(100, vals.maxDepth + vals.maxFade);

  const getVal = (trackElement: HTMLDivElement, e: { clientX: number }): number => {
    const rect = trackElement.getBoundingClientRect();
    return Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
  };

  const compute = (
    handle: string,
    val: number,
    init: { minDepth: number; maxDepth: number; minFade: number; maxFade: number; startVal: number },
  ): { minDepth: number; maxDepth: number; minFade: number; maxFade: number } => {
    switch (handle) {
      case 'minDepth': {
        const v = Math.max(0, Math.min(val, init.maxDepth));
        return { minDepth: v, maxDepth: init.maxDepth, minFade: Math.min(init.minFade, v), maxFade: init.maxFade };
      }
      case 'maxDepth': {
        const v = Math.max(init.minDepth, Math.min(100, val));
        return {
          minDepth: init.minDepth,
          maxDepth: v,
          minFade: init.minFade,
          maxFade: Math.min(init.maxFade, 100 - v),
        };
      }
      case 'fadeLeft': {
        const edge = Math.max(0, Math.min(val, init.minDepth));
        return {
          minDepth: init.minDepth,
          maxDepth: init.maxDepth,
          minFade: init.minDepth - edge,
          maxFade: init.maxFade,
        };
      }
      case 'fadeRight': {
        const edge = Math.max(init.maxDepth, Math.min(100, val));
        return {
          minDepth: init.minDepth,
          maxDepth: init.maxDepth,
          minFade: init.minFade,
          maxFade: edge - init.maxDepth,
        };
      }
      case 'range': {
        const delta = val - init.startVal;
        const width = init.maxDepth - init.minDepth;
        let nMin = Math.round(init.minDepth + delta);
        let nMax = Math.round(init.maxDepth + delta);
        if (nMin < 0) {
          nMin = 0;
          nMax = width;
        }
        if (nMax > 100) {
          nMax = 100;
          nMin = 100 - width;
        }
        return {
          minDepth: nMin,
          maxDepth: nMax,
          minFade: Math.min(init.minFade, nMin),
          maxFade: Math.min(init.maxFade, 100 - nMax),
        };
      }
      default:
        return { minDepth: init.minDepth, maxDepth: init.maxDepth, minFade: init.minFade, maxFade: init.maxFade };
    }
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget.dataset['handle'];
    if (!handle) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const trackElement = trackRef.current;
    if (!trackElement) return;
    setActiveHandle(handle);
    onDragStateChange?.(true);

    const init = { ...vals, startVal: getVal(trackElement, e) };
    let latest = { ...vals };
    let pending = false;
    let animationFrame: number | null = null;
    const pointerId = e.pointerId;
    const previousTouchAction = document.documentElement.style.touchAction;
    const previousUserSelect = document.documentElement.style.userSelect;

    const target = e.currentTarget;

    target.setPointerCapture(pointerId);
    document.documentElement.style.touchAction = 'none';
    document.documentElement.style.userSelect = 'none';

    const onMove = (me: PointerEvent) => {
      if (me.pointerId !== pointerId) return;
      if (me.cancelable) me.preventDefault();
      latest = compute(handle, getVal(trackElement, me), init);
      setDragValues(latest);

      if (!pending) {
        pending = true;
        animationFrame = requestAnimationFrame(() => {
          onChange(latest);
          pending = false;
          animationFrame = null;
        });
      }
    };

    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      setActiveHandle(null);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      onChange(latest);
      onDragStateChange?.(false);
      document.documentElement.style.touchAction = previousTouchAction;
      document.documentElement.style.userSelect = previousUserSelect;

      requestAnimationFrame(() => {
        setDragValues(null);
      });

      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  const handleColor = (handle: string, isMain: boolean) =>
    activeHandle === handle
      ? 'var(--color-accent, #818cf8)'
      : isMain
        ? 'rgba(255,255,255,0.85)'
        : 'rgba(255,255,255,0.45)';

  const handleReset = () => {
    onChange({ minDepth: 20, maxDepth: 100, minFade: 15, maxFade: 15 });
  };

  const isDragging = activeHandle !== null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="grid w-fit cursor-pointer bg-transparent p-0 text-left"
        onClick={handleReset}
        onMouseEnter={() => {
          setIsLabelHovered(true);
        }}
        onMouseLeave={() => {
          setIsLabelHovered(false);
        }}
      >
        <UiText
          variant={TextVariants.label}
          aria-hidden={isLabelHovered}
          className={`col-start-1 row-start-1 select-none transition-opacity duration-200 ease-in-out ${
            isLabelHovered ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {t('editor.masks.depthRange.title')}
        </UiText>
        <UiText
          variant={TextVariants.label}
          aria-hidden={!isLabelHovered}
          className={`col-start-1 row-start-1 select-none transition-opacity duration-200 ease-in-out pointer-events-none ${
            isLabelHovered ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('editor.masks.depthRange.reset')}
        </UiText>
      </button>
      <div ref={trackRef} className="relative rounded-md overflow-hidden mt-2 select-none" style={{ height: 44 }}>
        {isDragging && (
          <div
            className="fixed inset-0 z-[9999]"
            style={{ cursor: activeHandle === 'range' ? 'grabbing' : 'ew-resize' }}
          />
        )}

        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to right, #ddd 0%, #bbb 20%, #999 35%, #666 55%, #333 80%, #111 100%)',
          }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-black/60 pointer-events-none"
          style={{ width: `${fadeLeftEdge}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/60 pointer-events-none"
          style={{ width: `${100 - fadeRightEdge}%` }}
        />

        {vals.minFade > 0.5 && (
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${fadeLeftEdge}%`,
              width: `${vals.minFade}%`,
              background: 'linear-gradient(to right, rgba(0,0,0,0.6), transparent)',
            }}
          />
        )}
        {vals.maxFade > 0.5 && (
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${vals.maxDepth}%`,
              width: `${vals.maxFade}%`,
              background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.6))',
            }}
          />
        )}

        {[0, 1].map((i) => (
          <div
            key={i}
            className="absolute h-px pointer-events-none"
            style={{
              left: `${vals.minDepth}%`,
              width: `${Math.max(0, vals.maxDepth - vals.minDepth)}%`,
              background: 'rgba(255,255,255,0.3)',
              ...(i === 0 ? { top: 0 } : { bottom: 0 }),
            }}
          />
        ))}

        {[
          { pos: fadeLeftEdge, key: 'fadeLeft', main: false },
          { pos: vals.minDepth, key: 'minDepth', main: true },
          { pos: vals.maxDepth, key: 'maxDepth', main: true },
          { pos: fadeRightEdge, key: 'fadeRight', main: false },
        ].map(({ pos, key, main }) => (
          <div
            key={`line-${key}`}
            className="absolute inset-y-0 pointer-events-none"
            style={{
              left: `${pos}%`,
              transform: 'translateX(-50%)',
              width: main ? 2 : 1,
              background: handleColor(key, main),
              transition: activeHandle ? 'none' : 'background 0.15s',
            }}
          />
        ))}

        <div
          className="absolute inset-y-0"
          style={{
            left: `${vals.minDepth}%`,
            width: `${Math.max(0, vals.maxDepth - vals.minDepth)}%`,
            cursor: activeHandle === 'range' ? 'grabbing' : 'grab',
            zIndex: 5,
          }}
          data-handle="range"
          onPointerDown={handlePointerDown}
        />

        {[
          { pos: fadeLeftEdge, key: 'fadeLeft' },
          { pos: fadeRightEdge, key: 'fadeRight' },
        ].map(({ pos, key }) => (
          <div
            key={key}
            className="absolute flex items-start justify-center cursor-ew-resize"
            style={{ left: `${pos}%`, transform: 'translateX(-50%)', top: 0, height: '50%', width: 28, zIndex: 15 }}
            data-handle={key}
            onPointerDown={handlePointerDown}
          >
            <svg width="8" height="5" viewBox="0 0 8 5" style={{ marginTop: 3 }}>
              <polygon points="4,5 8,0 0,0" fill={handleColor(key, false)} />
            </svg>
          </div>
        ))}

        {[
          { pos: vals.minDepth, key: 'minDepth' },
          { pos: vals.maxDepth, key: 'maxDepth' },
        ].map(({ pos, key }) => (
          <div
            key={key}
            className="absolute flex items-end justify-center cursor-ew-resize"
            style={{ left: `${pos}%`, transform: 'translateX(-50%)', bottom: 0, height: '50%', width: 28, zIndex: 20 }}
            data-handle={key}
            onPointerDown={handlePointerDown}
          >
            <svg width="10" height="6" viewBox="0 0 10 6" style={{ marginBottom: 3 }}>
              <polygon points="5,0 10,6 0,6" fill={handleColor(key, true)} />
            </svg>
          </div>
        ))}
      </div>
      <UiText as="div" variant={TextVariants.small} className="flex justify-between select-none px-1">
        <span>{t('editor.masks.depthRange.near')}</span>
        <span>{t('editor.masks.depthRange.far')}</span>
      </UiText>
    </div>
  );
}

function MaskRefinementControls({
  parameters,
  onChange,
  onReset,
  onDragStateChange,
}: {
  parameters: unknown;
  onChange: (changes: NumericMaskParameterPatch<MaskRefinementParameterKey>) => void;
  onReset: () => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const replayReceipt = readMaskRefinementReplayReceipt(parameters);
  const warningIds: Array<MaskRefinementWarning> =
    replayReceipt === null
      ? []
      : [
          ...(replayReceipt.density <= 0.1 ? (['densityLow'] as const) : []),
          ...(replayReceipt.featherPx >= 40 ? (['featherHigh'] as const) : []),
          ...(Math.abs(replayReceipt.edgeShiftPx) >= 48 ? (['shiftLarge'] as const) : []),
          ...(replayReceipt.hairDetail >= 0.75 ? (['hairDetailHigh'] as const) : []),
        ];

  return (
    <div
      className="space-y-3 rounded-md border border-surface p-3"
      data-refinement-warning-count={warningIds.length}
      data-testid="mask-refinement-controls"
    >
      <div className="flex items-center justify-between gap-3">
        <UiText variant={TextVariants.label} className="select-none">
          {t('editor.masks.refinement.title')}
        </UiText>
        <button
          type="button"
          className="text-xs text-text-secondary transition-colors hover:text-text-primary"
          onClick={onReset}
        >
          {t('editor.masks.refinement.reset')}
        </button>
      </div>
      {MASK_REFINEMENT_PARAMETERS.map((param) => {
        const multiplier = param.multiplier ?? 1;
        return (
          <div
            key={param.key}
            data-refinement-parameter={param.key}
            data-testid={`mask-refinement-control-${param.key}`}
          >
            <AdjustmentSlider
              label={t(param.labelKey)}
              min={param.min}
              max={param.max}
              step={param.step}
              defaultValue={param.defaultValue}
              value={getPanelMaskParameterNumber(parameters, param.key, param.defaultValue / multiplier) * multiplier}
              onValueChange={(value) => {
                onChange({ [param.key]: value / multiplier });
              }}
              {...(param.min >= 0 && { fillOrigin: 'min' })}
              onDragStateChange={onDragStateChange}
            />
          </div>
        );
      })}
      {warningIds.length > 0 && (
        <div className="space-y-1" data-testid="mask-refinement-warning-list">
          {warningIds.map((warningId) => (
            <UiText
              key={warningId}
              as="p"
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="text-[11px]"
              data-mask-refinement-warning={warningId}
            >
              {t(MASK_REFINEMENT_WARNING_LABEL_KEYS[warningId])}
            </UiText>
          ))}
        </div>
      )}
      {replayReceipt !== null && (
        <UiText
          as="div"
          variant={TextVariants.small}
          color={TextColors.secondary}
          className="truncate text-[11px]"
          data-density={replayReceipt.density}
          data-edge-contrast={replayReceipt.edgeContrast}
          data-edge-shift-px={replayReceipt.edgeShiftPx}
          data-feather-px={replayReceipt.featherPx}
          data-hair-detail={replayReceipt.hairDetail}
          data-mask-id={replayReceipt.maskId}
          data-receipt-version={replayReceipt.receiptVersion}
          data-schema-version={replayReceipt.schemaVersion}
          data-smoothness={replayReceipt.smoothness}
          data-testid="mask-refinement-replay-receipt"
        >
          {t('editor.masks.refinement.replayReceipt', {
            edgeShiftPx: replayReceipt.edgeShiftPx,
            featherPx: replayReceipt.featherPx,
            smoothness: Math.round(replayReceipt.smoothness * 100),
          })}
        </UiText>
      )}
    </div>
  );
}

function LinearGradientMaskControls({
  parameters,
  onChange,
  onDragStateChange,
}: {
  onChange: (changes: NumericMaskParameterPatch<LinearGradientControlParameterKey>) => void;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  parameters: unknown;
}) {
  const imageHeight = Math.max(1, getPanelMaskParameterNumber(parameters, 'imageHeight', 1000));
  const startYPercent = Math.round((getPanelMaskParameterNumber(parameters, 'startY') / imageHeight) * 100);
  const endYPercent = Math.round((getPanelMaskParameterNumber(parameters, 'endY') / imageHeight) * 100);
  const range = getPanelMaskParameterNumber(parameters, 'range', 120);

  return (
    <div
      className="space-y-3 rounded-md border border-surface p-3"
      data-end-y-percent={endYPercent}
      data-gradient-command-type="layerMask.createGradientMask"
      data-range={range}
      data-start-y-percent={startYPercent}
      data-testid="linear-gradient-mask-controls"
    >
      <AdjustmentSlider
        defaultValue={12}
        fillOrigin="min"
        label={parameterLabelFallback('startY')}
        max={100}
        min={0}
        onDragStateChange={onDragStateChange}
        onValueChange={(value) => {
          onChange({ startY: value * 0.01 * imageHeight });
        }}
        step={1}
        value={startYPercent}
      />
      <AdjustmentSlider
        defaultValue={72}
        fillOrigin="min"
        label={parameterLabelFallback('endY')}
        max={100}
        min={0}
        onDragStateChange={onDragStateChange}
        onValueChange={(value) => {
          onChange({ endY: value * 0.01 * imageHeight });
        }}
        step={1}
        value={endYPercent}
      />
      <AdjustmentSlider
        defaultValue={120}
        fillOrigin="min"
        label={parameterLabelFallback('range')}
        max={1000}
        min={0}
        onDragStateChange={onDragStateChange}
        onValueChange={(value) => {
          onChange({ range: value });
        }}
        step={1}
        value={range}
      />
    </div>
  );
}

export function MasksPanel() {
  const { t } = useTranslation();
  const { setAdjustments, handleLutSelect } = useEditorActions();
  const {
    handleGenerateAiDepthMask,
    handleGenerateAiForegroundMask,
    handleGenerateAiPersonPartMask,
    handleGenerateAiSkyMask,
    handleGenerateAiWholePersonMask,
  } = useAiMasking();
  const setCustomEscapeHandler = useUIStore((s) => s.setCustomEscapeHandler);
  const { appSettings } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
    })),
  );

  const { aiModelDownloadStatus } = useProcessStore(
    useShallow((state) => ({
      aiModelDownloadStatus: state.aiModelDownloadStatus,
    })),
  );

  const {
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    brushSettings,
    copiedMask,
    histogram,
    isGeneratingAiMask,
    maskOverlaySettings,
    previewScopeStatus,
    selectedImage,
    isWaveformVisible,
    waveform,
    activeWaveformChannel,
    waveformHeight,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      activeMaskContainerId: state.activeMaskContainerId,
      activeMaskId: state.activeMaskId,
      adjustments: state.adjustments,
      brushSettings: state.brushSettings,
      copiedMask: state.copiedMask,
      histogram: state.histogram,
      isGeneratingAiMask: state.isGeneratingAiMask,
      maskOverlaySettings: state.maskOverlaySettings,
      previewScopeStatus: state.previewScopeStatus,
      selectedImage: state.selectedImage,
      isWaveformVisible: state.isWaveformVisible,
      waveform: state.waveform,
      activeWaveformChannel: state.activeWaveformChannel,
      waveformHeight: state.waveformHeight,
      setEditor: state.setEditor,
    })),
  );

  const { isResizingWaveform, onToggleWaveform, setActiveWaveformChannel, handleWaveformResize } =
    useWaveformControls();

  const setBrushSettings = useCallback(
    (updater: BrushSettingsUpdater) => {
      setEditor((state) => ({ brushSettings: typeof updater === 'function' ? updater(state.brushSettings) : updater }));
    },
    [setEditor],
  );
  const selectBrushToolForNewMask = useCallback(() => {
    setEditor((state) => ({
      brushSettings: {
        ...(state.brushSettings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
        tool: ToolType.Brush,
      },
    }));
  }, [setEditor]);

  const setCopiedMask = useCallback(
    (mask: MaskContainer) => {
      setEditor({ copiedMask: mask });
    },
    [setEditor],
  );
  const setIsMaskControlHovered = useCallback(
    (hovered: boolean) => {
      setEditor({ isMaskControlHovered: hovered });
    },
    [setEditor],
  );
  const onDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );
  const setMaskOverlaySettings = useCallback(
    (settings: MaskOverlaySettings) => {
      setEditor({ maskOverlaySettings: saveMaskOverlaySettingsPreference(settings) });
    },
    [setEditor],
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (
        isEditableTarget ||
        event.defaultPrevented ||
        !event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.code !== 'KeyO'
      ) {
        return;
      }

      event.preventDefault();
      setMaskOverlaySettings(nextMaskOverlayHotkeySettings(useEditorStore.getState().maskOverlaySettings));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setMaskOverlaySettings]);
  const onSelectContainer = useCallback(
    (id: string | null) => {
      setEditor({ activeMaskContainerId: id });
    },
    [setEditor],
  );
  const onSelectMask = useCallback(
    (id: string | null) => {
      setEditor({ activeMaskId: id });
    },
    [setEditor],
  );

  const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set());
  const [activeDragItem, setActiveDragItem] = useState<DragData | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [copiedSubMask, setCopiedSubMask] = useState<SubMask | null>(null);
  const [collapsibleState, setCollapsibleState] = useState<CollapsibleState>({
    basic: true,
    curves: false,
    color: false,
    details: false,
    effects: false,
  });
  const [copiedSectionAdjustments, setCopiedSectionAdjustments] = useState<CopiedSectionAdjustments | null>(null);
  const [isSettingsSectionOpen, setSettingsSectionOpen] = useState(true);
  const [isSettingsPanelEverOpened, setIsSettingsPanelEverOpened] = useState(false);
  const hasPerformedInitialSelection = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [analyzingSubMaskId, setAnalyzingSubMaskId] = useState<string | null>(null);

  const { showContextMenu } = useContextMenu();
  const { presets } = usePresets(adjustments);

  const { setNodeRef: setRootDroppableRef, isOver: isRootOver } = useDroppable({ id: 'mask-list-root' });

  const activeContainer = adjustments.masks.find((m) => m.id === activeMaskContainerId);
  const activeSubMaskData = activeContainer?.subMasks.find((sm) => sm.id === activeMaskId);
  const activeMaskHasBrush = activeContainer?.subMasks.some((subMask) => subMask.type === Mask.Brush) ?? false;
  const activeMaskHasGradient =
    activeContainer?.subMasks.some((subMask) => subMask.type === Mask.Linear || subMask.type === Mask.Radial) ?? false;
  const activeMaskHasRange =
    activeContainer?.subMasks.some((subMask) => subMask.type === Mask.Color || subMask.type === Mask.Luminance) ??
    false;
  const isAiMask =
    activeSubMaskData &&
    [Mask.AiSubject, Mask.AiForeground, Mask.AiPerson, Mask.AiSky, Mask.AiDepth].includes(activeSubMaskData.type);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setAnalyzingSubMaskId(isGeneratingAiMask && isAiMask ? activeMaskId : null);
      },
      isGeneratingAiMask && isAiMask ? 200 : 0,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [isGeneratingAiMask, isAiMask, activeMaskId]);

  useEffect(() => {
    if (activeMaskContainerId) {
      const containerExists = adjustments.masks.some((m) => m.id === activeMaskContainerId);
      if (!containerExists) {
        onSelectContainer(null);
        onSelectMask(null);
      }
    }
  }, [adjustments.masks, activeMaskContainerId, onSelectContainer, onSelectMask]);

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      if (!hasPerformedInitialSelection.current && !activeMaskContainerId && adjustments.masks.length > 0) {
        const lastMask = adjustments.masks[adjustments.masks.length - 1];
        if (lastMask) {
          onSelectContainer(lastMask.id);
          onSelectMask(null);
        }
      }

      if (activeMaskContainerId) {
        const shouldAutoExpand = !hasPerformedInitialSelection.current || activeMaskId;

        if (shouldAutoExpand) {
          setExpandedContainers((prev) => {
            if (prev.has(activeMaskContainerId)) {
              return prev;
            }
            return new Set(prev).add(activeMaskContainerId);
          });
        }

        hasPerformedInitialSelection.current = true;
      }

      if (activeMaskContainerId || adjustments.masks.length > 0) {
        setIsSettingsPanelEverOpened(true);
      }
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [activeMaskContainerId, activeMaskId, adjustments.masks, onSelectContainer, onSelectMask]);

  useEffect(() => {
    const handler = () => {
      if (renamingId) {
        setRenamingId(null);
        setTempName('');
      } else if (activeMaskId) onSelectMask(null);
      else if (activeMaskContainerId) onSelectContainer(null);
    };
    if (activeMaskContainerId || renamingId) setCustomEscapeHandler(() => handler);
    else setCustomEscapeHandler(null);
    return () => {
      setCustomEscapeHandler(null);
    };
  }, [activeMaskContainerId, activeMaskId, renamingId, onSelectContainer, onSelectMask, setCustomEscapeHandler]);

  const handleDeselect = () => {
    onSelectContainer(null);
    onSelectMask(null);
  };

  const handleToggleExpand = (id: string) => {
    setExpandedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResetAllMasks = () => {
    handleDeselect();
    setAdjustments((prev: Adjustments) => ({ ...prev, masks: [] }));
  };

  const createMaskLogic = (
    type: Mask,
    mode: SubMaskMode = SubMaskMode.Additive,
    personPart?: MaskType['personPart'],
  ) => {
    if (!selectedImage) return createEditorSubMaskFallback(type, mode);
    return createEditorSubMaskForImage({
      type,
      imageDimensions: selectedImage,
      mode,
      orientationSteps: adjustments.orientationSteps,
      personPart,
      faceName: t('masks.types.face'),
    });
  };

  const handleAddMaskContainer = (maskTypeOrType: MaskType | Mask) => {
    const type = typeof maskTypeOrType === 'string' ? maskTypeOrType : maskTypeOrType.type;
    const personPart = typeof maskTypeOrType === 'string' ? undefined : maskTypeOrType.personPart;
    const subMask = createMaskLogic(type, SubMaskMode.Additive, personPart);
    const count = adjustments.masks.length + 1;
    const newContainer = {
      ...INITIAL_MASK_CONTAINER,
      id: crypto.randomUUID(),
      name: t('editor.masks.patches.maskName', { count }),
      subMasks: [subMask],
    };
    setAdjustments((prev: Adjustments) => ({ ...prev, masks: [...prev.masks, newContainer] }));
    onSelectContainer(newContainer.id);
    onSelectMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(newContainer.id));
    if (type === Mask.Brush || type === Mask.Flow) selectBrushToolForNewMask();
    if (type === Mask.AiForeground) void handleGenerateAiForegroundMask(subMask.id);
    else if (type === Mask.AiPerson && personPart !== undefined)
      void handleGenerateAiPersonPartMask(subMask.id, personPart);
    else if (type === Mask.AiPerson) void handleGenerateAiWholePersonMask(subMask.id);
    else if (type === Mask.AiSky) void handleGenerateAiSkyMask(subMask.id);
    else if (type === Mask.AiDepth)
      void handleGenerateAiDepthMask(subMask.id, aiDepthMaskParametersSchema.parse(subMask.parameters));
  };

  const handleAddSubMask = (
    containerId: string,
    maskTypeOrType: MaskType | Mask,
    mode: SubMaskMode = SubMaskMode.Additive,
    insertIndex: number = -1,
  ) => {
    const type = typeof maskTypeOrType === 'string' ? maskTypeOrType : maskTypeOrType.type;
    const personPart = typeof maskTypeOrType === 'string' ? undefined : maskTypeOrType.personPart;
    const subMask = createMaskLogic(type, mode, personPart);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((c: MaskContainer) => {
        if (c.id === containerId) {
          const newSubMasks = [...c.subMasks];
          if (insertIndex >= 0) {
            newSubMasks.splice(insertIndex, 0, subMask);
          } else {
            newSubMasks.push(subMask);
          }
          return { ...c, subMasks: newSubMasks };
        }
        return c;
      }),
    }));
    onSelectContainer(containerId);
    onSelectMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(containerId));
    if (type === Mask.Brush || type === Mask.Flow) selectBrushToolForNewMask();
    if (type === Mask.AiForeground) void handleGenerateAiForegroundMask(subMask.id);
    else if (type === Mask.AiPerson && personPart !== undefined)
      void handleGenerateAiPersonPartMask(subMask.id, personPart);
    else if (type === Mask.AiPerson) void handleGenerateAiWholePersonMask(subMask.id);
    else if (type === Mask.AiSky) void handleGenerateAiSkyMask(subMask.id);
    else if (type === Mask.AiDepth)
      void handleGenerateAiDepthMask(subMask.id, aiDepthMaskParametersSchema.parse(subMask.parameters));
  };

  const handleGridClick = (maskTypeOrType: MaskType | Mask, forceNewMaskContainer: boolean = false) => {
    if (!forceNewMaskContainer && activeMaskContainerId) handleAddSubMask(activeMaskContainerId, maskTypeOrType);
    else handleAddMaskContainer(maskTypeOrType);
  };

  const handleGridRightClick = (event: ReactMouseEvent<HTMLElement>, maskTypeOrType: MaskType | Mask | null) => {
    if (event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    if (!maskTypeOrType) return;
    handleGridClick(maskTypeOrType, true);
  };

  const handleAddOthersMask = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const options = OTHERS_MASK_TYPES.map((maskType) => ({
      label: getMaskTypeName(maskType),
      icon: maskType.icon,
      onClick: () => {
        handleGridClick(maskType);
      },
      onRightClick: () => {
        handleGridClick(maskType, true);
      },
    }));
    showContextMenu(rect.left, rect.bottom + 5, options);
  };

  const handleAddMaskContextMenu = (
    event: ReactMouseEvent | ReactKeyboardEvent<HTMLElement>,
    targetContainerId?: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();

    const buildMenu = (types: MaskType[], mode: SubMaskMode = SubMaskMode.Additive) =>
      types.map((maskType: MaskType) => ({
        label: getMaskTypeName(maskType),
        icon: maskType.icon,
        disabled: maskType.disabled,
        onClick: () => {
          if (targetContainerId) {
            handleAddSubMask(targetContainerId, maskType, mode);
          } else {
            handleAddMaskContainer(maskType);
          }
        },
      }));

    const container = targetContainerId ? adjustments.masks.find((m) => m.id === targetContainerId) : null;
    const hasComponents = container && container.subMasks.length > 0;

    const buildModeSubmenu = (label: string, icon: LucideIcon, mode: SubMaskMode): Option => ({
      label,
      icon,
      submenu: MASK_PANEL_CREATION_TYPES.map((maskType) => {
        if (maskType.id === 'others') {
          return {
            label: getMaskTypeName(maskType),
            icon: maskType.icon,
            submenu: buildMenu(OTHERS_MASK_TYPES, mode),
          };
        }
        return {
          label: getMaskTypeName(maskType),
          icon: maskType.icon,
          disabled: maskType.disabled,
          onClick: () => {
            if (!targetContainerId) return;
            handleAddSubMask(targetContainerId, maskType, mode);
          },
        };
      }),
    });

    const options: Array<Option> = buildMenu(
      MASK_PANEL_CREATION_TYPES.filter((m) => m.id !== 'others'),
      SubMaskMode.Additive,
    );
    const others = MASK_PANEL_CREATION_TYPES.find((m) => m.id === 'others');
    if (others) {
      options.push({
        label: getMaskTypeName(others),
        icon: others.icon,
        submenu: buildMenu(OTHERS_MASK_TYPES, SubMaskMode.Additive),
      });
    }

    if (targetContainerId && hasComponents) {
      options.push(
        { type: OPTION_SEPARATOR },
        buildModeSubmenu(t('editor.masks.actions.subtractFromMask'), Minus, SubMaskMode.Subtractive),
        buildModeSubmenu(t('editor.masks.actions.intersectMaskWith'), SquaresIntersect, SubMaskMode.Intersect),
      );
    }

    showContextMenu(rect.left, rect.bottom + 5, options);
  };

  const updateContainer = (id: string, data: MaskContainerPatch) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((m) => (m.id === id ? { ...m, ...data } : m)),
    }));
  };
  const updateSubMask = (id: string, data: SubMaskPatch) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((m) => ({
        ...m,
        subMasks: m.subMasks.map((sm) => (sm.id === id ? { ...sm, ...data } : sm)),
      })),
    }));
  };

  const handleDeleteContainer = (id: string) => {
    if (activeMaskContainerId === id) handleDeselect();
    setAdjustments((prev: Adjustments) => ({ ...prev, masks: prev.masks.filter((m) => m.id !== id) }));
  };

  const handleDeleteSubMask = (containerId: string, subMaskId: string) => {
    if (activeMaskId === subMaskId) onSelectMask(null);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((m) =>
        m.id === containerId ? { ...m, subMasks: m.subMasks.filter((sm) => sm.id !== subMaskId) } : m,
      ),
    }));
  };

  const cloneMaskContainerData = (
    container: MaskContainer,
    options: { invert?: boolean; rename?: boolean; resetAdjustments?: boolean } = {},
  ): MaskContainer =>
    cloneMaskContainerForPaste(container, () => crypto.randomUUID(), {
      invert: options.invert,
      renameTo: options.rename === false ? undefined : t('editor.masks.patches.copyName', { name: container.name }),
      resetAdjustments: options.resetAdjustments,
    });

  const cloneSubMaskData = (subMask: SubMask, options: { invert?: boolean; rename?: boolean } = {}): SubMask =>
    cloneSubMaskForPaste(subMask, () => crypto.randomUUID(), {
      invert: options.invert,
      renameTo:
        options.rename === false ? undefined : t('editor.masks.patches.copyName', { name: getSubMaskName(subMask) }),
    });

  const copyMaskToClipboard = (container: MaskContainer) => {
    setCopiedMask(structuredClone(container));
  };

  const copySubMaskToClipboard = (subMask: SubMask) => {
    setCopiedSubMask(structuredClone(subMask));
  };

  const insertMaskContainer = (container: MaskContainer, insertIndex?: number) => {
    setAdjustments((prev: Adjustments) => {
      return { ...prev, masks: insertMaskContainerAt(prev.masks, container, insertIndex) };
    });

    onSelectContainer(container.id);
    onSelectMask(null);
    setExpandedContainers((prev) => new Set(prev).add(container.id));
  };

  const insertSubMaskIntoContainer = (containerId: string, subMask: SubMask, insertIndex?: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      masks: prev.masks.map((container) => {
        if (container.id !== containerId) {
          return container;
        }

        return { ...container, subMasks: insertSubMaskAt(container.subMasks, subMask, insertIndex) };
      }),
    }));

    onSelectContainer(containerId);
    onSelectMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(containerId));
  };

  const clipboardActions = createMaskLikeClipboardActions({
    cloneContainerForDuplicate: (container, options) =>
      cloneMaskContainerData(container, { ...options, resetAdjustments: true }),
    cloneContainerForInvertedSubMask: (container) =>
      cloneMaskContainerData(container, { rename: false, resetAdjustments: true }),
    cloneContainerForPaste: (container) => cloneMaskContainerData(container, { rename: false }),
    cloneSubMaskForDuplicate: (subMask, options) => cloneSubMaskData(subMask, options),
    cloneSubMaskForPaste: (subMask) => cloneSubMaskData(subMask, { rename: false }),
    containers: adjustments.masks,
    copiedContainer: copiedMask,
    copiedSubMask,
    insertContainer: insertMaskContainer,
    insertSubMask: insertSubMaskIntoContainer,
    invertedContainerName: (container) => t('editor.masks.patches.invertedName', { name: container.name }),
    invertedSubMaskContainerName: (subMask) =>
      t('editor.masks.patches.invertedName', { name: getSubMaskName(subMask) }),
  });

  const handleDuplicateContainer = clipboardActions.duplicateContainer;
  const handleDuplicateAndInvertContainer = clipboardActions.duplicateAndInvertContainer;
  const handlePasteMask = clipboardActions.pasteContainer;
  const handleDuplicateSubMask = clipboardActions.duplicateSubMask;
  const handleDuplicateAndInvertSubMask = clipboardActions.duplicateAndInvertSubMask;
  const handlePasteSubMask = clipboardActions.pasteSubMask;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragItem(event.active.data.current as DragData);
    onDragStateChange(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dragData = active.data.current as DragData;
    const overData = over?.data.current as DragData | undefined;

    const creationMaskType = dragData.type === 'Creation' ? dragData.maskType : undefined;
    if (creationMaskType) {
      const creationFn = () => {
        const overItem = overData?.item;
        if (overData?.type === 'Container' && overItem) {
          handleAddSubMask(overItem.id, creationMaskType);
        } else if (overData?.type === 'SubMask') {
          const container = adjustments.masks.find((m) => m.id === overData.parentId);
          const parentId = overData.parentId;
          if (container && over && parentId) {
            const targetIndex = container.subMasks.findIndex((sm) => sm.id === over.id);
            handleAddSubMask(parentId, creationMaskType, SubMaskMode.Additive, targetIndex);
          }
        } else {
          handleAddMaskContainer(creationMaskType);
        }
      };

      if (adjustments.masks.length > 0) {
        setPendingAction(() => creationFn);
      } else {
        creationFn();
      }

      setActiveDragItem(null);
      onDragStateChange(false);
      return;
    }

    setActiveDragItem(null);
    onDragStateChange(false);

    if (dragData.type === 'Container') {
      const overId = over?.id;
      if (!overId || active.id === overId) return;

      setAdjustments((prev: Adjustments) => {
        const draggedItem = dragData.item;
        if (!draggedItem) return prev;

        let newIndex = -1;

        if (overId === 'mask-list-root') {
          newIndex = prev.masks.length - 1;
        } else if (overData?.type === 'Container') {
          newIndex = prev.masks.findIndex((m) => m.id === overId);
        } else if (overData?.type === 'SubMask') {
          newIndex = prev.masks.findIndex((m) => m.id === overData.parentId);
        }

        const reorderedMasks = reorderMaskListContainers(prev.masks, draggedItem.id, prev.masks[newIndex]?.id ?? '');
        return reorderedMasks ? { ...prev, masks: reorderedMasks } : prev;
      });
      return;
    }

    if (dragData.type === 'SubMask') {
      const sourceContainerId = dragData.parentId;
      if (!sourceContainerId) return;

      if (over?.id === 'mask-list-root' || !over) {
        setAdjustments((prev: Adjustments) => {
          const draggedItem = dragData.item;
          if (!draggedItem) return prev;

          const result = splitSubMaskToContainer(
            prev.masks,
            sourceContainerId,
            draggedItem.id,
            (movedSubMask, count) => ({
              ...INITIAL_MASK_CONTAINER,
              id: crypto.randomUUID(),
              name: `Mask ${count + 1}`,
              subMasks: [movedSubMask],
            }),
          );
          if (!result) return prev;

          const { container: newContainer, containers: newMasks, subMask: movedSubMask } = result;
          setTimeout(() => {
            onSelectContainer(newContainer.id);
            onSelectMask(movedSubMask.id);
            setExpandedContainers((p) => new Set(p).add(newContainer.id));
          }, 0);
          return { ...prev, masks: newMasks };
        });
        return;
      }

      let targetContainerId: string | null = null;
      if (overData?.type === 'Container') targetContainerId = overData.item?.id ?? null;
      else if (overData?.type === 'SubMask' && overData.parentId) targetContainerId = overData.parentId;

      if (targetContainerId) {
        const expandedTargetContainerId = targetContainerId;
        setAdjustments((prev: Adjustments) => {
          const draggedItem = dragData.item;
          if (!draggedItem) return prev;

          const newMasks = moveSubMaskBetweenContainers(
            prev.masks,
            sourceContainerId,
            expandedTargetContainerId,
            draggedItem.id,
            overData?.type === 'SubMask' ? String(over.id) : undefined,
          );
          if (!newMasks) return prev;

          if (sourceContainerId !== targetContainerId) {
            setExpandedContainers((p) => new Set(p).add(expandedTargetContainerId));
          }
          return { ...prev, masks: newMasks };
        });
      }
    }
  };

  const handlePanelContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    const allTypes = [...MASK_PANEL_CREATION_TYPES.filter((m) => m.id !== 'others'), ...OTHERS_MASK_TYPES];
    const newMaskSubMenu = allTypes.map((m) => ({
      label: getMaskTypeName(m),
      icon: m.icon,
      onClick: () => {
        handleAddMaskContainer(m.type);
      },
    }));
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.masks.actions.pasteMask'),
        icon: ClipboardPaste,
        disabled: !copiedMask,
        onClick: () => {
          handlePasteMask();
        },
      },
      { label: t('editor.masks.addNewMask'), icon: Plus, submenu: newMaskSubMenu },
    ]);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      collisionDetection={pointerWithin}
    >
      <div className="flex flex-col h-full select-none overflow-hidden" onContextMenu={handlePanelContextMenu}>
        <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
          <UiText variant={TextVariants.title}>{t('editor.masks.maskingTitle')}</UiText>
          <div className="flex items-center gap-1">
            <button
              className={cx(
                'p-2 rounded-full transition-colors',
                isWaveformVisible ? 'bg-surface hover:bg-card-active' : 'hover:bg-surface',
              )}
              onClick={onToggleWaveform}
              data-tooltip={t('editor.masks.toggleAnalyticsTooltip')}
            >
              <ChartArea size={18} />
            </button>
            <button
              className="p-2 rounded-full hover:bg-surface transition-colors"
              onClick={handleResetAllMasks}
              data-tooltip={t('editor.masks.resetMaskingTooltip')}
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        <LayerStackPanel
          activeMaskContainerId={activeMaskContainerId}
          masks={adjustments.masks}
          onSelectMaskContainer={onSelectContainer}
          onSetMaskContainers={(masks) => {
            setAdjustments((prev: Adjustments) => ({ ...prev, masks }));
          }}
        />

        <div className="shrink-0 border-b border-surface p-4">
          <MaskOverlayReviewControls
            settings={maskOverlaySettings}
            onChange={setMaskOverlaySettings}
            onDragStateChange={onDragStateChange}
            hotkeyHint="Shift+O"
          />
        </div>

        <AnimatePresence initial={false}>
          {isWaveformVisible && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: waveformHeight || 256, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: isResizingWaveform ? 0 : 0.2, ease: 'easeOut' }}
              className="shrink-0 flex flex-col relative border-b border-surface overflow-hidden"
            >
              <div className="grow w-full h-full p-4 pb-2 min-h-0">
                <Waveform
                  waveformData={waveform || null}
                  histogram={histogram}
                  previewScopeStatus={previewScopeStatus}
                  displayMode={activeWaveformChannel}
                  setDisplayMode={setActiveWaveformChannel}
                  showClipping={adjustments.showClipping || false}
                  onToggleClipping={() => {
                    setAdjustments((prev: Adjustments) => ({
                      ...prev,
                      showClipping: !prev.showClipping,
                    }));
                  }}
                />
              </div>
              <Resizer direction={Orientation.Horizontal} onMouseDown={handleWaveformResize} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0 p-4">
          <AnimatePresence mode="wait">
            {adjustments.masks.length === 0 ? (
              <motion.div
                key="empty-masks-grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="z-10 shrink-0"
                onClick={handleDeselect}
              >
                <UiText variant={TextVariants.heading} className="mb-2">
                  {t('editor.masks.createNewTitle')}
                </UiText>
                <div
                  className="grid grid-cols-3 gap-2"
                  role="presentation"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {MASK_PANEL_CREATION_TYPES.map((maskType: MaskType) => (
                    <DraggableGridItem
                      key={maskType.id ?? maskType.type}
                      maskType={maskType}
                      onClick={(e) => {
                        if (maskType.id === 'others') {
                          handleAddOthersMask(e);
                        } else {
                          handleGridClick(maskType);
                        }
                      }}
                      onRightClick={(e: ReactMouseEvent<HTMLElement>) => {
                        handleGridRightClick(e, maskType);
                      }}
                      isDraggable={maskType.id !== 'others' && maskType.personPart === undefined}
                      activeMaskContainerId={activeMaskContainerId}
                    />
                  ))}
                </div>
              </motion.div>
            ) : (
              <MaskList
                activeDragItem={activeDragItem}
                activeMaskContainerId={activeMaskContainerId}
                activeMaskId={activeMaskId}
                analyzingSubMaskId={analyzingSubMaskId}
                containers={adjustments.masks}
                copiedMask={copiedMask}
                copiedSubMask={copiedSubMask}
                copyMaskToClipboard={copyMaskToClipboard}
                copySubMaskToClipboard={copySubMaskToClipboard}
                expandedContainers={expandedContainers}
                handleDeleteContainer={handleDeleteContainer}
                handleDeleteSubMask={handleDeleteSubMask}
                handleDuplicateAndInvertContainer={handleDuplicateAndInvertContainer}
                handleDuplicateAndInvertSubMask={handleDuplicateAndInvertSubMask}
                handleDuplicateContainer={handleDuplicateContainer}
                handleDuplicateSubMask={handleDuplicateSubMask}
                handlePasteMask={handlePasteMask}
                handlePasteSubMask={handlePasteSubMask}
                isRootOver={isRootOver}
                onAddComponent={handleAddMaskContextMenu}
                onExitComplete={() => {
                  if (pendingAction) {
                    pendingAction();
                    setPendingAction(null);
                  }
                }}
                onRootClick={handleDeselect}
                onSelectContainer={onSelectContainer}
                onSelectMask={onSelectMask}
                onToggleContainer={handleToggleExpand}
                presets={presets}
                renamingId={renamingId}
                rootDroppableRef={setRootDroppableRef}
                setAdjustments={setAdjustments}
                setIsMaskControlHovered={setIsMaskControlHovered}
                setRenamingId={setRenamingId}
                setTempName={setTempName}
                tempName={tempName}
                updateContainer={updateContainer}
                updateSubMask={updateSubMask}
              />
            )}
          </AnimatePresence>

          <div className="h-4 shrink-0 w-full" role="presentation" onClick={handleDeselect} />

          <AnimatePresence>
            {isSettingsPanelEverOpened && (
              <motion.div
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex-1 min-h-0"
              >
                <UiText variant={TextVariants.heading} className="mb-2">
                  {t('editor.masks.maskAdjustmentsTitle')}
                </UiText>
                {activeContainer && (
                  <div className="mb-3 space-y-2">
                    <div
                      className="grid grid-cols-4 gap-2 rounded-md border border-surface bg-bg-secondary p-2 text-[11px]"
                      data-component-count={activeContainer.subMasks.length}
                      data-has-brush={String(activeMaskHasBrush)}
                      data-has-gradient={String(activeMaskHasGradient)}
                      data-has-range={String(activeMaskHasRange)}
                      data-testid="mask-readiness-summary"
                    >
                      <div className="min-w-0 rounded bg-bg-primary px-2 py-1" data-testid="mask-readiness-components">
                        <span className="block truncate text-text-tertiary">{t('editor.masks.masksTitle')}</span>
                        <span className="block truncate text-text-secondary">{activeContainer.subMasks.length}</span>
                      </div>
                      <div className="min-w-0 rounded bg-bg-primary px-2 py-1" data-testid="mask-readiness-brush">
                        <span className="block truncate text-text-tertiary">{formatMaskTypeName(Mask.Brush)}</span>
                        <span className="block truncate text-text-secondary">
                          {activeMaskHasBrush ? t('editor.masks.maskAdjustmentsTitle') : t('editor.masks.addNewMask')}
                        </span>
                      </div>
                      <div className="min-w-0 rounded bg-bg-primary px-2 py-1" data-testid="mask-readiness-gradient">
                        <span className="block truncate text-text-tertiary">{formatMaskTypeName(Mask.Linear)}</span>
                        <span className="block truncate text-text-secondary">
                          {activeMaskHasGradient
                            ? t('editor.masks.maskAdjustmentsTitle')
                            : t('editor.masks.addNewMask')}
                        </span>
                      </div>
                      <div className="min-w-0 rounded bg-bg-primary px-2 py-1" data-testid="mask-readiness-range">
                        <span className="block truncate text-text-tertiary">{formatMaskTypeName(Mask.Color)}</span>
                        <span className="block truncate text-text-secondary">
                          {activeMaskHasRange ? t('editor.masks.maskAdjustmentsTitle') : t('editor.masks.addNewMask')}
                        </span>
                      </div>
                    </div>
                    <div
                      className="grid grid-cols-3 gap-2 rounded-md border border-surface bg-bg-secondary p-2"
                      data-testid="mask-component-quick-add"
                    >
                      {[
                        {
                          disabled: activeMaskHasBrush,
                          label: t('editor.masks.quickAddBrush'),
                          testId: 'mask-quick-add-brush',
                          type: Mask.Brush,
                        },
                        {
                          disabled: activeMaskHasGradient,
                          label: t('editor.masks.quickAddGradient'),
                          testId: 'mask-quick-add-gradient',
                          type: Mask.Linear,
                        },
                        {
                          disabled: activeMaskHasRange,
                          label: t('editor.masks.quickAddRange'),
                          testId: 'mask-quick-add-range',
                          type: Mask.Color,
                        },
                      ].map((action) => (
                        <button
                          className="min-w-0 rounded border border-surface bg-bg-primary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-card-active hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                          data-testid={action.testId}
                          disabled={action.disabled}
                          key={action.testId}
                          onClick={() => {
                            handleAddSubMask(activeContainer.id, action.type);
                          }}
                          type="button"
                        >
                          <span className="block truncate">
                            {action.disabled ? t('editor.masks.quickAddComplete') : action.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <SettingsPanel
                  container={activeContainer ?? null}
                  activeSubMask={activeSubMaskData || null}
                  aiModelDownloadStatus={aiModelDownloadStatus}
                  brushSettings={brushSettings}
                  setBrushSettings={setBrushSettings}
                  updateContainer={updateContainer}
                  updateSubMask={updateSubMask}
                  histogram={histogram}
                  appSettings={appSettings}
                  isGeneratingAiMask={isGeneratingAiMask}
                  setIsMaskControlHovered={setIsMaskControlHovered}
                  collapsibleState={collapsibleState}
                  setCollapsibleState={setCollapsibleState}
                  copiedSectionAdjustments={copiedSectionAdjustments}
                  setCopiedSectionAdjustments={setCopiedSectionAdjustments}
                  onDragStateChange={onDragStateChange}
                  isSettingsSectionOpen={isSettingsSectionOpen}
                  setSettingsSectionOpen={setSettingsSectionOpen}
                  presets={presets}
                  handleLutSelect={(path) => {
                    void handleLutSelect(path);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeDragItem ? (
          <div className="w-(--sidebar-width,280px) pointer-events-none">
            {activeDragItem.type === 'Container' && activeDragItem.item && (
              <UiText
                as="div"
                color={TextColors.primary}
                weight={TextWeights.medium}
                className="flex items-center gap-2 p-2 rounded-md bg-surface shadow-2xl opacity-90 ring-1 ring-black/10"
              >
                <FolderIcon size={18} className={TEXT_COLOR_KEYS[TextColors.secondary]} />
                <span className="flex-1 truncate">{(activeDragItem.item as MaskContainer).name}</span>
              </UiText>
            )}

            {activeDragItem.type === 'SubMask' && activeDragItem.item && (
              <UiText
                as="div"
                color={TextColors.primary}
                weight={TextWeights.medium}
                className="flex items-center gap-2 p-2 rounded-md bg-surface shadow-2xl opacity-90 ring-1 ring-black/10 ml-3.75"
              >
                {(() => {
                  const sm = activeDragItem.item as SubMask;
                  const Icon = MASK_ICON_MAP[sm.type];
                  return <Icon size={16} className={`shrink-0 ml-1 ${TEXT_COLOR_KEYS[TextColors.secondary]}`} />;
                })()}
                <span className="flex-1 truncate">{getSubMaskName(activeDragItem.item as SubMask)}</span>
              </UiText>
            )}

            {activeDragItem.type === 'Creation' && (
              <UiText
                as="div"
                variant={TextVariants.small}
                color={TextColors.primary}
                className="bg-surface rounded-lg gap-2 p-2 flex flex-col items-center justify-center aspect-square w-20 shadow-xl opacity-90"
              >
                {(() => {
                  const maskType =
                    MASK_PANEL_CREATION_TYPES.find((m) => m.type === activeDragItem.maskType) ||
                    OTHERS_MASK_TYPES.find((m) => m.type === activeDragItem.maskType);
                  const Icon = maskType?.icon || Circle;
                  return (
                    <>
                      <Icon size={24} />
                      <span className="text-center">
                        {activeDragItem.maskType ? formatMaskTypeName(activeDragItem.maskType) : 'Mask'}
                      </span>
                    </>
                  );
                })()}
              </UiText>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default MasksPanel;

function NewMaskDropZone({ isOver }: { isOver: boolean }) {
  const { t } = useTranslation();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 'auto', marginTop: '4px' }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`p-4 rounded-lg text-center ${isOver ? 'border border-accent/80 bg-bg-tertiary/50' : ''}`}
    >
      <UiText weight={TextWeights.medium}>{t('editor.masks.dropzoneText')}</UiText>
    </motion.div>
  );
}

function DraggableGridItem({
  maskType,
  onClick,
  onRightClick,
  isDraggable,
  activeMaskContainerId,
}: DraggableGridItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `create-${maskType.id || maskType.type}`,
    data: { type: 'Creation', maskType: maskType.type },
    disabled: !isDraggable,
  });

  const tooltip = maskType.disabled
    ? t('editor.masks.comingSoon')
    : maskType.id === 'others'
      ? t('editor.masks.tooltips.showMore')
      : activeMaskContainerId
        ? t('editor.masks.tooltips.addToCurrent', { name: getMaskTypeName(maskType) })
        : t('editor.masks.tooltips.createNew', { name: getMaskTypeName(maskType) });
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick(event);
  };

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.button !== 2) return;
        onRightClick(event);
      }}
      className={`bg-surface text-text-primary rounded-lg p-2 flex flex-col items-center justify-center gap-2 aspect-square transition-colors
                ${maskType.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-card-active active:bg-accent/20'} ${isDragging ? 'opacity-50' : ''}`}
      data-tooltip={tooltip}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <maskType.icon size={24} />{' '}
      <UiText as="span" variant={TextVariants.small} color={TextColors.primary}>
        {getMaskTypeName(maskType)}
      </UiText>
    </motion.div>
  );
}

function MaskList({
  activeDragItem,
  activeMaskContainerId,
  activeMaskId,
  analyzingSubMaskId,
  containers,
  copiedMask,
  copiedSubMask,
  copyMaskToClipboard,
  copySubMaskToClipboard,
  expandedContainers,
  handleDeleteContainer,
  handleDeleteSubMask,
  handleDuplicateAndInvertContainer,
  handleDuplicateAndInvertSubMask,
  handleDuplicateContainer,
  handleDuplicateSubMask,
  handlePasteMask,
  handlePasteSubMask,
  isRootOver,
  onAddComponent,
  onExitComplete,
  onRootClick,
  onSelectContainer,
  onSelectMask,
  onToggleContainer,
  presets,
  renamingId,
  rootDroppableRef,
  setAdjustments,
  setIsMaskControlHovered,
  setRenamingId,
  setTempName,
  tempName,
  updateContainer,
  updateSubMask,
}: MaskListProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      key="masks-list-container"
      ref={rootDroppableRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex-col transition-colors ${isRootOver ? 'bg-surface' : ''}`}
      onClick={onRootClick}
    >
      <UiText variant={TextVariants.heading} className="mb-2">
        {t('editor.masks.masksTitle')}
      </UiText>

      <AnimatePresence initial={false} mode="popLayout" onExitComplete={onExitComplete}>
        {containers.map((container) => (
          <ContainerRow
            key={container.id}
            container={container}
            isSelected={activeMaskContainerId === container.id && activeMaskId === null}
            hasActiveChild={activeMaskContainerId === container.id && activeMaskId !== null}
            isExpanded={expandedContainers.has(container.id)}
            onToggle={() => {
              onToggleContainer(container.id);
            }}
            onSelect={() => {
              onSelectContainer(container.id);
              onSelectMask(null);
            }}
            renamingId={renamingId}
            setRenamingId={setRenamingId}
            tempName={tempName}
            setTempName={setTempName}
            updateContainer={updateContainer}
            handleDelete={handleDeleteContainer}
            handleDuplicate={handleDuplicateContainer}
            handleDuplicateAndInvert={handleDuplicateAndInvertContainer}
            handlePasteMask={handlePasteMask}
            copyMaskToClipboard={copyMaskToClipboard}
            copiedMask={copiedMask}
            presets={presets}
            setAdjustments={setAdjustments}
            activeDragItem={activeDragItem}
            activeMaskId={activeMaskId}
            onSelectContainer={onSelectContainer}
            onSelectMask={onSelectMask}
            updateSubMask={updateSubMask}
            handleDeleteSubMask={handleDeleteSubMask}
            handleDuplicateSubMask={handleDuplicateSubMask}
            handleDuplicateAndInvertSubMask={handleDuplicateAndInvertSubMask}
            handlePasteSubMask={handlePasteSubMask}
            copySubMaskToClipboard={copySubMaskToClipboard}
            copiedSubMask={copiedSubMask}
            analyzingSubMaskId={analyzingSubMaskId}
            setIsMaskControlHovered={setIsMaskControlHovered}
            onAddComponent={(event: ReactMouseEvent<HTMLElement>) => {
              onAddComponent(event, container.id);
            }}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {activeDragItem?.type === 'Creation' && containers.length > 0 && <NewMaskDropZone isOver={isRootOver} />}
      </AnimatePresence>

      <UiText
        as="div"
        weight={TextWeights.medium}
        className="flex items-center gap-2 p-2 rounded-md transition-colors transition-opacity opacity-70 hover:opacity-100 hover:bg-card-active cursor-pointer hover:text-text-primary"
        onClick={(event: ReactMouseEvent<HTMLElement>) => {
          onAddComponent(event, null);
        }}
        onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onAddComponent(event, null);
        }}
        role="button"
        tabIndex={0}
      >
        <div className="p-0.5">
          <Plus size={18} />
        </div>
        <span>{t('editor.masks.addNewMask')}</span>
      </UiText>
    </motion.div>
  );
}

function ContainerRow({
  container,
  isSelected,
  hasActiveChild,
  isExpanded,
  onToggle,
  onSelect,
  renamingId,
  setRenamingId,
  tempName,
  setTempName,
  updateContainer,
  handleDelete,
  handleDuplicate,
  handleDuplicateAndInvert,
  handlePasteMask,
  copyMaskToClipboard,
  copiedMask,
  presets,
  setAdjustments,
  activeDragItem,
  activeMaskId,
  onSelectContainer,
  onSelectMask,
  updateSubMask,
  handleDeleteSubMask,
  handleDuplicateSubMask,
  handleDuplicateAndInvertSubMask,
  handlePasteSubMask,
  copySubMaskToClipboard,
  copiedSubMask,
  analyzingSubMaskId,
  setIsMaskControlHovered,
  onAddComponent,
}: ContainerRowProps) {
  const { t } = useTranslation();
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: container.id,
    data: { type: 'Container', item: container },
  });
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({ id: container.id, data: { type: 'Container', item: container } });
  const { showContextMenu } = useContextMenu();
  const renameInputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(renameInputRef, renamingId === container.id);

  const setCombinedRef = (node: HTMLElement | null) => {
    setDroppableRef(node);
    setDraggableRef(node);
  };

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      const newName = tempName.trim();
      setAdjustments((prev: Adjustments) => {
        const updatedMasks = prev.masks.map((mask: MaskContainer) =>
          mask.id === container.id ? { ...mask, name: newName } : mask,
        );
        return { ...prev, masks: updatedMasks };
      });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const generatePresetSubmenu = (list: Array<PresetMenuItem>): Array<Option> =>
      list
        .map((item): Option | null => {
          if (item.folder)
            return {
              label: item.folder.name ?? '',
              icon: FolderIcon,
              submenu: generatePresetSubmenu(item.folder.children),
            };
          const presetAdjustments = item.adjustments ?? item.preset?.adjustments;
          if (presetAdjustments)
            return {
              label: item.name || item.preset?.name || '',
              onClick: () => {
                const newAdj = { ...container.adjustments, ...presetAdjustments };
                newAdj.sectionVisibility = { ...container.adjustments.sectionVisibility, ...newAdj.sectionVisibility };
                updateContainer(container.id, { adjustments: newAdj });
              },
            };
          return null;
        })
        .filter((option): option is Option => option !== null);

    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.masks.actions.rename'),
        icon: FileEdit,
        onClick: () => {
          setRenamingId(container.id);
          setTempName(container.name);
        },
      },
      {
        label: t('editor.masks.actions.duplicateMask'),
        icon: PlusSquare,
        onClick: () => {
          handleDuplicate(container);
        },
      },
      {
        label: t('editor.masks.actions.duplicateAndInvertMask'),
        icon: RotateCcw,
        onClick: () => {
          handleDuplicateAndInvert(container);
        },
      },
      {
        label: t('editor.masks.actions.copyMask'),
        icon: Copy,
        onClick: () => {
          copyMaskToClipboard(container);
        },
      },
      {
        label: t('editor.masks.actions.pasteMask'),
        icon: ClipboardPaste,
        disabled: !copiedMask,
        onClick: () => {
          handlePasteMask(container.id);
        },
      },
      {
        label: t('editor.masks.actions.pasteMaskAdjustments'),
        icon: ClipboardPaste,
        disabled: !copiedMask,
        onClick: () => {
          if (copiedMask) {
            updateContainer(container.id, { adjustments: structuredClone(copiedMask.adjustments) });
          }
        },
      },
      {
        label: t('editor.masks.actions.applyPreset'),
        icon: SwatchBook,
        submenu: generatePresetSubmenu(presets).length
          ? generatePresetSubmenu(presets)
          : [{ label: t('editor.masks.actions.noPresets'), disabled: true }],
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.masks.actions.resetMaskAdjustments'),
        icon: RotateCcw,
        onClick: () => {
          updateContainer(container.id, { adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS) });
        },
      },
      {
        label: t('editor.masks.actions.deleteMask'),
        icon: Trash2,
        isDestructive: true,
        onClick: () => {
          handleDelete(container.id);
        },
      },
    ]);
  };

  const borderClass = getMaskLikeContainerDropClass({ activeDragItem, containerId: container.id, isOver });
  const handleContainerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect();
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: isDragging ? 0.4 : 1, height: 'auto' }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      ref={setCombinedRef}
      className="overflow-hidden"
    >
      <div
        {...listeners}
        {...attributes}
        className={`flex items-center gap-2 p-2 rounded-md transition-colors group
             ${isSelected ? 'bg-surface' : 'hover:bg-card-active'}
             ${borderClass}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onKeyDown={handleContainerKeyDown}
        onContextMenu={onContextMenu}
        role="button"
        tabIndex={0}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`p-0.5 rounded transition-colors cursor-pointer bg-transparent ${
            TEXT_COLOR_KEYS[hasActiveChild || isExpanded ? TextColors.primary : TextColors.secondary]
          }`}
        >
          {isExpanded ? <FolderOpen size={18} /> : <FolderIcon size={18} />}
        </button>
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {renamingId === container.id ? (
            <input
              className="bg-bg-primary text-sm w-full rounded-sm px-1 outline-hidden border border-accent"
              value={tempName}
              onChange={(e) => {
                setTempName(e.target.value);
              }}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameSubmit();
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              ref={renameInputRef}
            />
          ) : (
            <UiText color={TextColors.primary} weight={TextWeights.medium} className="truncate select-none">
              {container.name}
            </UiText>
          )}
        </div>
        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 hover:text-text-primary text-text-secondary"
            onMouseEnter={() => {
              setIsMaskControlHovered(true);
            }}
            onMouseLeave={() => {
              setIsMaskControlHovered(false);
            }}
            data-tooltip={container.visible ? t('editor.masks.actions.hideMask') : t('editor.masks.actions.showMask')}
            onClick={(e) => {
              e.stopPropagation();
              updateContainer(container.id, { visible: !container.visible });
            }}
          >
            {container.visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button
            className="p-1 hover:text-red-500 text-text-secondary"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(container.id);
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden pl-2 border-l-[1.5px] border-border-color/50 ml-3.75"
            layout
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {container.subMasks.map((subMask: SubMask, index: number) => (
                <SubMaskRow
                  key={subMask.id}
                  subMask={subMask}
                  index={index + 1}
                  totalCount={container.subMasks.length}
                  containerId={container.id}
                  isActive={activeMaskId === subMask.id}
                  parentVisible={container.visible}
                  activeDragItem={activeDragItem}
                  onSelect={() => {
                    onSelectContainer(container.id);
                    onSelectMask(subMask.id);
                  }}
                  updateSubMask={updateSubMask}
                  handleDelete={() => {
                    handleDeleteSubMask(container.id, subMask.id);
                  }}
                  handleDuplicate={() => {
                    handleDuplicateSubMask(container.id, subMask, index + 1);
                  }}
                  handleDuplicateAndInvert={() => {
                    handleDuplicateAndInvertSubMask(container.id, subMask);
                  }}
                  handlePaste={() => {
                    handlePasteSubMask(container.id, index + 1);
                  }}
                  handleCopy={() => {
                    copySubMaskToClipboard(subMask);
                  }}
                  hasCopiedSubMask={!!copiedSubMask}
                  analyzingSubMaskId={analyzingSubMaskId}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                  tempName={tempName}
                  setTempName={setTempName}
                  setIsMaskControlHovered={setIsMaskControlHovered}
                />
              ))}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {(isSelected || hasActiveChild || container.subMasks.length === 0) && (
                <motion.div
                  key="add-component-btn"
                  layout="position"
                  initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                  animate={{ opacity: 1, height: 'auto', overflow: 'hidden' }}
                  exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                  transition={{ duration: 0.2 }}
                >
                  <UiText
                    as="div"
                    weight={TextWeights.medium}
                    className="flex items-center gap-2 p-2 rounded-md transition-colors transition-opacity opacity-70 hover:opacity-100 hover:bg-card-active cursor-pointer hover:text-text-primary"
                    onClick={(e: ReactMouseEvent<HTMLElement>) => {
                      e.stopPropagation();
                      onAddComponent(e);
                    }}
                  >
                    <div className="relative w-4 h-4 ml-1 shrink-0 flex items-center justify-center">
                      <Plus size={16} />
                    </div>
                    <span className="select-none">{t('editor.masks.actions.addNewComponent')}</span>
                  </UiText>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SubMaskRow({
  subMask,
  index,
  totalCount,
  containerId,
  isActive,
  parentVisible,
  onSelect,
  updateSubMask,
  handleDelete,
  handleDuplicate,
  handleDuplicateAndInvert,
  handlePaste,
  handleCopy,
  hasCopiedSubMask,
  activeDragItem,
  analyzingSubMaskId,
  renamingId,
  setRenamingId,
  tempName,
  setTempName,
  setIsMaskControlHovered,
}: SubMaskRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: subMask.id,
    data: { type: 'SubMask', item: subMask, parentId: containerId },
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: subMask.id,
    data: { type: 'SubMask', item: subMask, parentId: containerId },
  });
  const setCombinedRef = (node: HTMLElement | null) => {
    setNodeRef(node);
    setDroppableRef(node);
  };
  const maskType = subMask.type;
  const MaskIcon = MASK_ICON_MAP[maskType];
  const { showContextMenu } = useContextMenu();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { handleMouseEnter, handleMouseLeave, isHovered } = useDelayedHover();

  useManagedFocus(renameInputRef, renamingId === subMask.id);

  const isDraggingContainer = isMaskLikeContainerDrag(activeDragItem);
  const dropClass = getMaskLikeSubMaskDropClass(activeDragItem, isOver);
  const isAnalyzing = subMask.id === analyzingSubMaskId;

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      const newName = tempName.trim();
      updateSubMask(subMask.id, { name: newName });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.masks.actions.rename'),
        icon: FileEdit,
        onClick: () => {
          setRenamingId(subMask.id);
          setTempName(getSubMaskName(subMask));
        },
      },
      { label: t('editor.masks.actions.duplicateComponent'), icon: PlusSquare, onClick: handleDuplicate },
      {
        label: t('editor.masks.actions.duplicateAndInvertComponent'),
        icon: RotateCcw,
        onClick: handleDuplicateAndInvert,
      },
      { label: t('editor.masks.actions.copyComponent'), icon: Copy, onClick: handleCopy },
      {
        label: t('editor.masks.actions.pasteComponent'),
        icon: ClipboardPaste,
        disabled: !hasCopiedSubMask,
        onClick: handlePaste,
      },
      { type: OPTION_SEPARATOR },
      { label: t('editor.masks.actions.deleteComponent'), icon: Trash2, isDestructive: true, onClick: handleDelete },
    ]);
  };

  const showNumber = isHovered && totalCount > 1;

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -15, scale: 0.95, transition: { duration: 0.2 } }}
      ref={setCombinedRef}
      {...attributes}
      {...listeners}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex items-center gap-2 p-2 rounded-md transition-colors group cursor-pointer
            ${isActive ? 'bg-surface' : 'hover:bg-card-active'}
            ${dropClass}
            ${isDragging ? 'opacity-40 z-50' : ''}
            ${!parentVisible ? 'opacity-50' : ''}
            ${isDraggingContainer ? 'opacity-30 pointer-events-none' : ''}
            transition-opacity duration-300`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onContextMenu={onContextMenu}
    >
      <UiText
        as="div"
        variant={TextVariants.small}
        weight={TextWeights.bold}
        className="relative w-4 h-4 ml-1 shrink-0 flex items-center justify-center"
      >
        <AnimatePresence mode="wait" initial={false}>
          {isAnalyzing ? (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <Loader2 size={16} className="animate-spin" />
            </motion.div>
          ) : showNumber ? (
            <motion.span
              key="number"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              {index}
            </motion.span>
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className="absolute"
            >
              <MaskIcon size={16} />
            </motion.div>
          )}
        </AnimatePresence>
      </UiText>
      {renamingId === subMask.id ? (
        <input
          className="bg-bg-primary text-sm w-full rounded px-1 outline-none border border-accent"
          value={tempName}
          onChange={(e) => {
            setTempName(e.target.value);
          }}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleRenameSubmit();
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
          ref={renameInputRef}
        />
      ) : (
        <UiText color={TextColors.primary} className="flex-1 truncate select-none">
          {getSubMaskName(subMask)}
        </UiText>
      )}
      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
        {index > 1 && (
          <button
            className="p-1 hover:text-text-primary text-text-secondary"
            data-tooltip={
              subMask.mode === SubMaskMode.Additive
                ? t('editor.masks.actions.switchToSubtract')
                : subMask.mode === SubMaskMode.Subtractive
                  ? t('editor.masks.actions.switchToIntersect')
                  : t('editor.masks.actions.switchToAdd')
            }
            onClick={(e) => {
              e.stopPropagation();
              updateSubMask(subMask.id, {
                mode:
                  subMask.mode === SubMaskMode.Additive
                    ? SubMaskMode.Subtractive
                    : subMask.mode === SubMaskMode.Subtractive
                      ? SubMaskMode.Intersect
                      : SubMaskMode.Additive,
              });
            }}
          >
            {subMask.mode === SubMaskMode.Additive ? (
              <Plus size={16} />
            ) : subMask.mode === SubMaskMode.Subtractive ? (
              <Minus size={16} />
            ) : (
              <SquaresIntersect size={16} />
            )}
          </button>
        )}
        <button
          className="p-1 hover:text-text-primary text-text-secondary"
          data-tooltip={
            subMask.visible ? t('editor.masks.actions.hideComponent') : t('editor.masks.actions.showComponent')
          }
          onMouseEnter={() => {
            setIsMaskControlHovered(true);
          }}
          onMouseLeave={() => {
            setIsMaskControlHovered(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            updateSubMask(subMask.id, { visible: !subMask.visible });
          }}
        >
          {subMask.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button
          className="p-1 hover:text-red-500 text-text-secondary"
          data-tooltip={t('editor.ai.actions.deleteComponent')}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </motion.div>
  );
}

function SettingsPanel({
  container,
  activeSubMask,
  aiModelDownloadStatus,
  brushSettings,
  setBrushSettings,
  updateContainer,
  updateSubMask,
  histogram,
  appSettings,
  isGeneratingAiMask: _isGeneratingAiMask,
  setIsMaskControlHovered,
  collapsibleState,
  setCollapsibleState,
  copiedSectionAdjustments,
  setCopiedSectionAdjustments,
  onDragStateChange,
  isSettingsSectionOpen,
  setSettingsSectionOpen,
  presets,
  handleLutSelect,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const isActive = !!container;
  const presetButtonRef = useRef<HTMLButtonElement>(null);
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const [isGeneratingObjectProposal, setIsGeneratingObjectProposal] = useState(false);

  const placeholderContainer = {
    ...INITIAL_MASK_CONTAINER,
    adjustments: INITIAL_MASK_ADJUSTMENTS,
  };
  const displayContainer = container || placeholderContainer;
  const displayAdjustments: Adjustments = { ...INITIAL_ADJUSTMENTS, ...displayContainer.adjustments };

  const handleApplyPresetToMask = (presetAdjustments: Partial<Adjustments>) => {
    if (!container) return;
    const currentAdjustments = container.adjustments;
    const newMaskAdjustments = {
      ...currentAdjustments,
      ...presetAdjustments,
      sectionVisibility: {
        ...currentAdjustments.sectionVisibility,
        ...(presetAdjustments.sectionVisibility || {}),
      },
    };
    updateContainer(container.id, { adjustments: newMaskAdjustments });
  };

  const generatePresetSubmenu = (presetList: Array<PresetMenuItem>): Array<Option> => {
    return presetList
      .map((item): Option | null => {
        if (item.folder) {
          return {
            label: item.folder.name ?? '',
            icon: FolderIcon,
            submenu: generatePresetSubmenu(item.folder.children),
          };
        }
        const presetAdjustments = item.adjustments ?? item.preset?.adjustments;
        if (presetAdjustments) {
          return {
            label: item.name || item.preset?.name || '',
            onClick: () => {
              handleApplyPresetToMask(presetAdjustments);
            },
          };
        }
        return null;
      })
      .filter((option): option is Option => option !== null);
  };

  const handlePresetSelectClick = () => {
    if (presetButtonRef.current) {
      const rect = presetButtonRef.current.getBoundingClientRect();
      const presetSubmenu = generatePresetSubmenu(presets);
      const options =
        presetSubmenu.length > 0
          ? presetSubmenu
          : [{ label: t('editor.masks.settings.noPresetsFound'), disabled: true }];
      showContextMenu(rect.left, rect.bottom + 5, options);
    }
  };

  const handleMaskPropertyChange = (key: keyof Pick<MaskContainer, 'invert' | 'opacity'>, value: MaskPropertyValue) => {
    if (!isActive) return;
    updateContainer(container.id, { [key]: value });
  };

  const handleSubMaskParametersChange = (changes: NumericMaskParameterPatch<PanelMaskParameterKey>) => {
    if (!isActive || !activeSubMask) return;
    const newParams = mergePanelMaskParameters(activeSubMask.parameters, changes);
    updateSubMask(activeSubMask.id, { parameters: newParams });
  };

  const handleMaskRefinementParametersChange = (changes: NumericMaskParameterPatch<MaskRefinementParameterKey>) => {
    if (!isActive || !activeSubMask) return;
    const command = createMaskRefinementCommand(activeSubMask.id, activeSubMask.parameters, changes);
    const refinedParameters = dispatchMaskRefinementCommand(command);
    const newParams = mergeMaskParameters(activeSubMask.parameters, refinedParameters);
    updateSubMask(activeSubMask.id, { parameters: newParams });
  };

  const handleResetMaskRefinement = () => {
    if (!isActive || !activeSubMask) return;
    const command = createMaskRefinementCommand(activeSubMask.id, activeSubMask.parameters, {
      density: 1,
      edgeContrast: 0,
      edgeShiftPx: 0,
      featherPx: 0,
      hairDetail: 0,
      smoothness: 0,
    });
    const newParams = mergeMaskParameters(activeSubMask.parameters, dispatchMaskRefinementCommand(command));
    updateSubMask(activeSubMask.id, { parameters: newParams });
  };

  const handleDepthRangeChange = (values: Record<AiDepthControlParameterKey, number>) => {
    if (!isActive || !activeSubMask) return;

    const newParams = mergePanelMaskParameters(activeSubMask.parameters, {
      minDepth: 100 - values.maxDepth,
      maxDepth: 100 - values.minDepth,
      minFade: values.maxFade,
      maxFade: values.minFade,
    });
    updateSubMask(activeSubMask.id, { parameters: newParams });
  };

  const activeSubMaskType = activeSubMask?.type;
  const subMaskConfig = activeSubMaskType ? SUB_MASK_CONFIG[activeSubMaskType] : {};
  const objectPromptState =
    activeSubMaskType === Mask.AiObject && activeSubMask !== null
      ? readObjectPromptCanvasState(activeSubMask.parameters)
      : null;
  const objectPromptCommandInput =
    objectPromptState !== null && selectedImage !== null
      ? buildObjectMaskProposalCommandInput(objectPromptState, {
          height: selectedImage.height,
          orientationSteps: displayAdjustments.orientationSteps,
          width: selectedImage.width,
        })
      : null;
  const objectPromptProviderStatus = toMaskParameterRecord(activeSubMask?.parameters)['providerStatus'];
  const objectPromptProviderStatusText =
    typeof objectPromptProviderStatus === 'string' ? objectPromptProviderStatus : 'empty';
  const objectPromptReplayReceipt =
    activeSubMaskType === Mask.AiObject && activeSubMask !== null
      ? readObjectMaskProposalReplayReceipt(activeSubMask.parameters)
      : null;
  const brushLocalAdjustmentReceipt =
    activeSubMaskType === Mask.Brush && activeSubMask !== null
      ? readBrushLocalAdjustmentReceipt(activeSubMask.parameters)
      : null;
  const handleObjectPromptModeChange = (mode: ObjectPromptMode) => {
    if (!activeSubMask || objectPromptState === null) return;
    updateSubMask(activeSubMask.id, {
      parameters: writeObjectPromptCanvasState(activeSubMask.parameters, setObjectPromptMode(objectPromptState, mode)),
    });
  };
  const handleClearObjectPrompts = () => {
    if (!activeSubMask || objectPromptState === null) return;
    updateSubMask(activeSubMask.id, {
      parameters: writeObjectPromptCanvasState(
        activeSubMask.parameters,
        clearObjectPromptCanvasState(objectPromptState),
      ),
    });
  };
  const handleGenerateObjectProposal = async () => {
    if (!activeSubMask || objectPromptState === null || objectPromptCommandInput === null || !selectedImage?.path)
      return;
    setIsGeneratingObjectProposal(true);
    useEditorStore.getState().setEditor({ isGeneratingAiMask: true });
    try {
      const proposal = await invoke<AiObjectMaskProposal>(Invokes.GenerateAiObjectMaskProposal, {
        endPoint: objectPromptCommandInput.endPoint,
        flipHorizontal: displayAdjustments.flipHorizontal,
        flipVertical: displayAdjustments.flipVertical,
        jsAdjustments: getObjectMaskTransformAdjustments(displayAdjustments),
        orientationSteps: displayAdjustments.orientationSteps,
        path: selectedImage.path,
        rotation: displayAdjustments.rotation,
        startPoint: objectPromptCommandInput.startPoint,
      });
      updateSubMask(activeSubMask.id, {
        parameters: acceptObjectMaskProposal(activeSubMask.parameters, objectPromptState, proposal),
      });
    } catch (error) {
      updateSubMask(activeSubMask.id, {
        parameters: {
          ...toMaskParameterRecord(activeSubMask.parameters),
          objectPromptError: error instanceof Error ? error.message : String(error),
          providerStatus: 'local_sam_proposal_failed',
        },
      });
    } finally {
      setIsGeneratingObjectProposal(false);
      useEditorStore.getState().setEditor({ isGeneratingAiMask: false });
    }
  };
  const isAiMask =
    activeSubMaskType !== undefined &&
    ['ai-subject', 'ai-foreground', 'ai-person', 'ai-sky', 'ai-depth'].includes(activeSubMaskType);
  const isComponentMode = !!activeSubMask;

  const setMaskContainerAdjustments = (updater: MaskAdjustmentUpdater) => {
    if (!isActive) return;
    const currentAdjustments: Adjustments = { ...INITIAL_ADJUSTMENTS, ...container.adjustments };
    const newAdjustments =
      typeof updater === 'function' ? updater(currentAdjustments) : { ...currentAdjustments, ...updater };
    updateContainer(container.id, { adjustments: newAdjustments });
  };

  const handleToggleSection = (section: string) => {
    setCollapsibleState((prev: CollapsibleState) => {
      const isOpening = !prev[section];
      if (appSettings?.enableFocusMode && isOpening) {
        setSettingsSectionOpen(false);
        const newState = { ...prev };
        Object.keys(newState).forEach((key) => {
          newState[key] = false;
        });
        newState[section] = true;
        return newState;
      }
      return { ...prev, [section]: !prev[section] };
    });
  };

  const handleToggleVisibility = (sectionName: string) => {
    if (!isActive) return;
    const cur = container.adjustments;
    const vis = cur.sectionVisibility;
    updateContainer(container.id, {
      adjustments: { ...cur, sectionVisibility: { ...vis, [sectionName]: !vis[sectionName] } },
    });
  };

  const handleSectionContextMenu = (event: ReactMouseEvent, sectionName: string) => {
    if (!isActive) return;
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];
    if (!sectionKeys) return;

    const handleCopy = () => {
      const adjustmentsToCopy: MaskAdjustmentPatch = {};
      for (const key of sectionKeys) {
        const adjustmentValue = readAdjustmentValue(container.adjustments, key);
        if (adjustmentValue !== undefined) {
          writeAdjustmentPatchValue(adjustmentsToCopy, key, adjustmentValue);
        }
      }
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      if (!copiedSectionAdjustments || copiedSectionAdjustments.section !== sectionName) return;

      setMaskContainerAdjustments((prev: Adjustments) => ({
        ...prev,
        ...copiedSectionAdjustments.values,
        sectionVisibility: {
          ...prev.sectionVisibility,
          [sectionName]: true,
        },
      }));
    };

    const handleReset = () => {
      const resetValues: MaskAdjustmentPatch = {};
      for (const key of sectionKeys) {
        const resetValue = readAdjustmentValue(INITIAL_MASK_ADJUSTMENTS, key);
        if (resetValue !== undefined) {
          writeAdjustmentPatchValue(resetValues, key, resetValue);
        }
      }
      setMaskContainerAdjustments((prev: Adjustments) => ({
        ...prev,
        ...resetValues,
        sectionVisibility: {
          ...prev.sectionVisibility,
          [sectionName]: true,
        },
      }));
    };

    const isPasteAllowed = copiedSectionAdjustments && copiedSectionAdjustments.section === sectionName;
    const sectionTitle = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);

    const pasteLabel = copiedSectionAdjustments
      ? t('editor.masks.settings.pasteSectionSettings', { section: sectionTitle })
      : t('editor.masks.settings.pasteSettings');

    showContextMenu(event.clientX, event.clientY, [
      {
        icon: Copy,
        label: t('editor.masks.settings.copySectionSettings', { section: sectionTitle }),
        onClick: handleCopy,
      },
      { label: pasteLabel, icon: ClipboardPaste, onClick: handlePaste, disabled: !isPasteAllowed },
      { type: OPTION_SEPARATOR },
      {
        icon: RotateCcw,
        label: t('editor.masks.settings.resetSectionSettings', { section: sectionTitle }),
        onClick: handleReset,
      },
    ]);
  };

  const renderAdjustmentSection = (sectionName: string) => {
    const sharedProps = {
      adjustments: displayAdjustments,
      setAdjustments: setMaskContainerAdjustments,
      isForMask: true,
      onDragStateChange,
    };

    switch (sectionName) {
      case 'basic':
        return <BasicAdjustments {...sharedProps} appSettings={appSettings} />;
      case 'curves':
        return (
          <CurveGraph
            adjustments={displayAdjustments}
            histogram={histogram}
            isForMask
            setAdjustments={setMaskContainerAdjustments}
            theme={appSettings?.theme ?? Theme.Dark}
            onDragStateChange={onDragStateChange}
          />
        );
      case 'color':
        return <ColorPanel {...sharedProps} appSettings={appSettings} />;
      case 'details':
        return <DetailsPanel {...sharedProps} appSettings={appSettings} />;
      case 'effects':
        return <EffectsPanel {...sharedProps} appSettings={appSettings} handleLutSelect={handleLutSelect} />;
      default:
        return null;
    }
  };

  const sectionVisibility = displayContainer.adjustments.sectionVisibility;

  return (
    <div
      className={`space-y-2 transition-opacity duration-300 ${!isActive ? 'opacity-50 pointer-events-none' : ''}`}
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <CollapsibleSection
        title={
          isComponentMode
            ? t('editor.masks.settings.componentPropertiesTitle', { name: getSubMaskName(activeSubMask) })
            : t('editor.masks.settings.maskPropertiesTitle')
        }
        isOpen={isSettingsSectionOpen}
        onToggle={() => {
          const isOpening = !isSettingsSectionOpen;
          setSettingsSectionOpen(isOpening);
          if (appSettings?.enableFocusMode && isOpening) {
            setCollapsibleState((prev: CollapsibleState) => {
              const newState = { ...prev };
              Object.keys(newState).forEach((key) => {
                newState[key] = false;
              });
              return newState;
            });
          }
        }}
        canToggleVisibility={false}
        isContentVisible={true}
      >
        <div className="space-y-4 pt-2">
          <Switch
            checked={isComponentMode ? activeSubMask.invert : displayContainer.invert}
            label={isComponentMode ? t('editor.masks.settings.invertComponent') : t('editor.masks.settings.invertMask')}
            onChange={(v) => {
              if (isComponentMode) {
                updateSubMask(activeSubMask.id, { invert: v });
              } else {
                handleMaskPropertyChange('invert', v);
              }
            }}
          />

          {!isComponentMode && (
            <div className="flex justify-between items-center">
              <UiText variant={TextVariants.label} className="select-none">
                {t('editor.masks.settings.applyPreset')}
              </UiText>
              <button
                ref={presetButtonRef}
                onClick={handlePresetSelectClick}
                className="text-sm text-text-primary text-right select-none cursor-pointer hover:text-accent transition-colors"
                data-tooltip={t('editor.masks.settings.selectPresetTooltip')}
              >
                {t('editor.masks.settings.select')}
              </button>
            </div>
          )}

          <AdjustmentSlider
            defaultValue={100}
            label={t('editor.masks.settings.opacity')}
            max={100}
            min={0}
            value={isComponentMode ? activeSubMask.opacity : displayContainer.opacity}
            onValueChange={(value) => {
              if (isComponentMode) {
                updateSubMask(activeSubMask.id, { opacity: value });
              } else {
                handleMaskPropertyChange('opacity', value);
              }
            }}
            step={1}
            fillOrigin="min"
            onDragStateChange={onDragStateChange}
          />

          {isComponentMode && (
            <>
              {brushLocalAdjustmentReceipt !== null && (
                <div
                  className="rounded-md border border-surface bg-card/40 p-3 text-xs text-text-secondary"
                  data-after-preview-hash={brushLocalAdjustmentReceipt.afterPreviewHash}
                  data-before-preview-hash={brushLocalAdjustmentReceipt.beforePreviewHash}
                  data-brush-content-hash={brushLocalAdjustmentReceipt.brushContentHash}
                  data-brush-mask-id={brushLocalAdjustmentReceipt.brushMaskId}
                  data-coordinate-space={brushLocalAdjustmentReceipt.coordinateSpace}
                  data-graph-revision={brushLocalAdjustmentReceipt.graphRevision}
                  data-layer-id={brushLocalAdjustmentReceipt.layerId}
                  data-receipt-version={brushLocalAdjustmentReceipt.receiptVersion}
                  data-replay-key={brushLocalAdjustmentReceipt.replayKey}
                  data-rollback-graph-revision={brushLocalAdjustmentReceipt.rollbackGraphRevision}
                  data-stroke-count={brushLocalAdjustmentReceipt.brushStrokeCount}
                  data-testid="brush-local-adjustment-receipt"
                >
                  <UiText variant={TextVariants.small} weight={TextWeights.medium} className="block text-text-primary">
                    {t('editor.masks.settings.brushLocalAdjustmentReceiptTitle')}
                  </UiText>
                  <UiText variant={TextVariants.small} className="block text-text-tertiary">
                    {t('editor.masks.settings.brushLocalAdjustmentReceiptSummary', {
                      count: brushLocalAdjustmentReceipt.brushStrokeCount,
                    })}
                  </UiText>
                </div>
              )}

              {isAiMask && aiModelDownloadStatus && (
                <UiText
                  as="div"
                  variant={TextVariants.small}
                  color={TextColors.accent}
                  weight={TextWeights.medium}
                  className="p-3 bg-card-active rounded-md border border-surface flex items-center gap-3"
                >
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <div className="leading-relaxed">
                    <UiText variant={TextVariants.small}>{t('editor.masks.settings.aiModelDownloading')}</UiText>
                    <span>{aiModelDownloadStatus}</span>
                  </div>
                </UiText>
              )}

              {activeSubMask.type === Mask.AiDepth && (
                <DepthRangePicker
                  minDepth={100 - getPanelMaskParameterNumber(activeSubMask.parameters, 'maxDepth', 100)}
                  maxDepth={100 - getPanelMaskParameterNumber(activeSubMask.parameters, 'minDepth')}
                  minFade={getPanelMaskParameterNumber(activeSubMask.parameters, 'maxFade', 15)}
                  maxFade={getPanelMaskParameterNumber(activeSubMask.parameters, 'minFade', 15)}
                  onChange={handleDepthRangeChange}
                  onDragStateChange={onDragStateChange}
                />
              )}

              {activeSubMask.type === Mask.AiPerson && (
                <>
                  <AiPeoplePartPickerStatus />
                  <AiPersonMaskProvenance parameters={activeSubMask.parameters} />
                </>
              )}

              {objectPromptState !== null && (
                <ObjectPromptControls
                  commandInput={objectPromptCommandInput}
                  isGenerating={isGeneratingObjectProposal}
                  onClear={handleClearObjectPrompts}
                  onGenerate={() => {
                    void handleGenerateObjectProposal();
                  }}
                  onModeChange={handleObjectPromptModeChange}
                  providerStatusText={objectPromptProviderStatusText}
                  replayReceipt={objectPromptReplayReceipt}
                  selectedImagePath={selectedImage?.path}
                  state={objectPromptState}
                  t={t}
                />
              )}

              {activeSubMask.type === Mask.Linear && (
                <LinearGradientMaskControls
                  parameters={toMaskParameterRecord(activeSubMask.parameters)}
                  onChange={handleSubMaskParametersChange}
                  onDragStateChange={onDragStateChange}
                />
              )}

              {subMaskConfig.parameters?.map((param) => (
                <AdjustmentSlider
                  key={param.key}
                  label={
                    param.key === 'feather' && activeSubMask.type === Mask.AiDepth
                      ? t('editor.masks.params.globalFeather')
                      : t('editor.masks.params.' + param.key, { defaultValue: parameterLabelFallback(param.key) })
                  }
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  defaultValue={param.defaultValue}
                  value={getPanelMaskParameterNumber(activeSubMask.parameters, param.key) * (param.multiplier || 1)}
                  onValueChange={(value) => {
                    handleSubMaskParametersChange({
                      [param.key]: value / (param.multiplier || 1),
                    });
                  }}
                  {...(param.key !== 'grow' && { fillOrigin: 'min' })}
                  onDragStateChange={onDragStateChange}
                />
              ))}

              <MaskRefinementControls
                parameters={toMaskParameterRecord(activeSubMask.parameters)}
                onChange={handleMaskRefinementParametersChange}
                onReset={handleResetMaskRefinement}
                onDragStateChange={onDragStateChange}
              />

              {subMaskConfig.showBrushTools &&
                brushSettings &&
                (activeSubMask.type === Mask.Flow ? (
                  <FlowBrushTool
                    flow={getPanelMaskParameterNumber(activeSubMask.parameters, 'flow', 10)}
                    onFlowChange={(flow: number) => {
                      handleSubMaskParametersChange({ flow });
                    }}
                    settings={brushSettings}
                    onSettingsChange={setBrushSettings}
                    onDragStateChange={onDragStateChange}
                  />
                ) : (
                  <BrushTools
                    settings={brushSettings}
                    onSettingsChange={setBrushSettings}
                    onDragStateChange={onDragStateChange}
                  />
                ))}
            </>
          )}
        </div>
      </CollapsibleSection>

      <div
        onMouseEnter={() => {
          setIsMaskControlHovered(true);
        }}
        onMouseLeave={() => {
          setIsMaskControlHovered(false);
        }}
        className="flex flex-col gap-2"
      >
        {Object.keys(ADJUSTMENT_SECTIONS).map((sectionName) => {
          const title = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
          return (
            <CollapsibleSection
              key={sectionName}
              title={title}
              isOpen={collapsibleState[sectionName] ?? false}
              isContentVisible={sectionVisibility[sectionName] ?? true}
              isDirty={hasAdjustmentValueChanges(
                ADJUSTMENT_SECTIONS[sectionName] ?? [],
                displayAdjustments,
                INITIAL_MASK_ADJUSTMENTS,
              )}
              onToggle={() => {
                handleToggleSection(sectionName);
              }}
              onToggleVisibility={() => {
                handleToggleVisibility(sectionName);
              }}
              onContextMenu={(e: ReactMouseEvent) => {
                handleSectionContextMenu(e, sectionName);
              }}
            >
              {renderAdjustmentSection(sectionName)}
            </CollapsibleSection>
          );
        })}
      </div>
    </div>
  );
}
