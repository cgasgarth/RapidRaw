import { useAuth, useUser } from '@clerk/react';
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
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  ClipboardPaste,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  FileEdit,
  FolderOpen,
  GitCompareArrows,
  Loader2,
  Minus,
  Plus,
  PlusSquare,
  RotateCcw,
  Send,
  SquaresIntersect,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  type ChangeEvent,
  type Dispatch,
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useContextMenu } from '../../../../context/ContextMenuContext';
import { useAiMasking } from '../../../../hooks/ai/useAiMasking';
import { useManagedFocus } from '../../../../hooks/ui/useManagedFocus';
import {
  AiProviderId,
  type AiProviderId as AiProviderIdType,
  normalizeAiProviderId,
  resolveAiEditApprovalPolicy,
  resolveAiProviderRuntimeState,
} from '../../../../schemas/ai/aiProviderSchemas';
import { type CloudUsage, cloudUsageSchema } from '../../../../schemas/cloudUsageSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useProcessStore } from '../../../../store/useProcessStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { useUIStore } from '../../../../store/useUIStore';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../../types/typography';
import type { AiPatch } from '../../../../utils/adjustments';
import {
  type AiEditCommand,
  type AiEditSelection,
  resolveAiEditSelection,
  selectionAfterPatchDeletion,
  selectionAfterSubMaskDeletion,
} from '../../../../utils/aiEditSelection';
import {
  cloneMaskLikeContainerForPaste,
  cloneSubMaskForPaste,
  createMaskLikeClipboardActions,
  insertMaskLikeContainerAt,
  insertSubMaskAt,
  moveSubMaskBetweenContainers,
  reorderMaskListContainers,
  splitSubMaskToContainer,
} from '../../../../utils/mask/maskClipboard';
import { saveMaskOverlaySettingsPreference } from '../../../../utils/mask/maskOverlayPreferences';
import {
  getMaskParameterNumber,
  mergeMaskParameters,
  toMaskParameterRecord,
} from '../../../../utils/mask/maskParameterAccess';
import { createSubMask } from '../../../../utils/mask/maskUtils';
import { type BrushSettings, OPTION_SEPARATOR, type Option } from '../../../ui/AppProperties';
import CollapsibleSection from '../../../ui/CollapsibleSection';
import { editorChromeStatusChipClassName } from '../../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import Button from '../../../ui/primitives/Button';
import Input from '../../../ui/primitives/Input';
import Slider from '../../../ui/primitives/Slider';
import Switch from '../../../ui/primitives/Switch';
import UiText from '../../../ui/primitives/Text';
import InspectorPanelFrame, { type InspectorPanelStatus } from '../inspector/InspectorPanelFrame';
import {
  AI_PANEL_CREATION_TYPES,
  AI_SUB_MASK_COMPONENT_TYPES,
  formatMaskTypeName,
  getSubMaskName,
  MASK_ICON_MAP,
  Mask,
  type MaskType,
  type SubMask,
  SubMaskMode,
  ToolType,
} from '../layers/Masks';
import {
  getMaskLikeContainerDropClass,
  getMaskLikeSubMaskDropClass,
  isMaskLikeContainerDrag,
  type MaskLikeDragData,
  useDelayedHover,
} from '../layers/maskPanelRowHelpers';

const AiPeoplePartPickerStatus = lazy(() =>
  import('./AiPeoplePartPickerStatus.js').then((module) => ({ default: module.AiPeoplePartPickerStatus })),
);

function AiPanelLazyFallback() {
  return (
    <div
      className="rounded-md border border-surface bg-bg-primary p-2"
      aria-busy="true"
      data-testid="ai-panel-lazy-fallback"
    >
      <div className="h-3 w-28 rounded bg-editor-panel-raised" />
      <div className="mt-2 h-7 rounded bg-editor-panel-well" />
    </div>
  );
}

interface DragData extends MaskLikeDragData {
  type: 'Container' | 'SubMask' | 'Creation';
  item?: AiPatch | SubMask;
  maskType?: Mask;
  parentId?: string;
}

interface SubMaskParameterConfig {
  defaultValue: number;
  key: string;
  max: number;
  min: number;
  multiplier?: number;
  step: number;
}

interface SubMaskConfig {
  parameters?: SubMaskParameterConfig[];
  showBrushTools?: boolean;
}

type BrushSettingsUpdater = BrushSettings | ((settings: BrushSettings) => BrushSettings);
type NumericChangeEvent = ChangeEvent<HTMLInputElement> | { target: { value: number | string } };
type UpdatePatch = (id: string, data: Partial<AiPatch>) => void;
type UpdateSubMask = (id: string, data: Partial<SubMask>) => void;

interface AiPanelCollapsibleState {
  generative: boolean;
  properties: boolean;
}

const DEFAULT_BRUSH_SETTINGS: BrushSettings = { size: 50, feather: 50, tool: ToolType.Brush };
const getNumericEventValue = (event: NumericChangeEvent): number => Number(event.target.value);

const PLACEHOLDER_PATCH: AiPatch = {
  id: 'placeholder',
  invert: false,
  isLoading: false,
  name: '',
  prompt: '',
  subMasks: [],
  visible: true,
  patchData: null,
};

const SUB_MASK_CONFIG: Partial<Record<Mask, SubMaskConfig>> = {
  [Mask.Radial]: {
    parameters: [{ key: 'feather', min: 0, max: 100, step: 1, multiplier: 100, defaultValue: 50 }],
  },
  [Mask.Brush]: { showBrushTools: true },
  [Mask.Linear]: { parameters: [] },
  [Mask.AiSubject]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 50 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 25 },
    ],
  },
  [Mask.AiForeground]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 50 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 25 },
    ],
  },
  [Mask.AiPerson]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 50 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 25 },
    ],
  },
  [Mask.AiSky]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  [Mask.QuickEraser]: {
    parameters: [
      { key: 'grow', min: -100, max: 100, step: 1, defaultValue: 75 },
      { key: 'feather', min: 0, max: 100, step: 1, defaultValue: 75 },
    ],
  },
};

const parameterLabelFallback = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());

interface BrushToolsProps {
  settings: BrushSettings;
  onSettingsChange: (updater: BrushSettingsUpdater) => void;
}

const BrushTools = ({ settings, onSettingsChange }: BrushToolsProps) => {
  const { t } = useTranslation();

  return (
    <div>
      <Slider
        defaultValue={100}
        label={t('editor.ai.brush.size')}
        max={200}
        min={1}
        onChange={(event: NumericChangeEvent) => {
          onSettingsChange((settings) => ({ ...settings, size: getNumericEventValue(event) }));
        }}
        step={1}
        value={settings.size}
        fillOrigin="min"
      />
      <Slider
        defaultValue={50}
        label={t('editor.ai.brush.feather')}
        max={100}
        min={0}
        onChange={(event: NumericChangeEvent) => {
          onSettingsChange((settings) => ({ ...settings, feather: getNumericEventValue(event) }));
        }}
        step={1}
        value={settings.feather}
        fillOrigin="min"
      />
      <div className="grid grid-cols-2 gap-2 pt-2">
        <button
          className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            settings.tool === ToolType.Brush
              ? 'text-primary bg-surface'
              : 'bg-surface text-text-secondary hover:bg-card-active'
          }`}
          onClick={() => {
            onSettingsChange((settings) => ({ ...settings, tool: ToolType.Brush }));
          }}
        >
          {t('editor.ai.brush.add')}
        </button>
        <button
          className={`p-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            settings.tool === ToolType.Eraser
              ? 'text-primary bg-surface'
              : 'bg-surface text-text-secondary hover:bg-card-active'
          }`}
          onClick={() => {
            onSettingsChange((settings) => ({ ...settings, tool: ToolType.Eraser }));
          }}
        >
          {t('editor.ai.brush.erase')}
        </button>
      </div>
    </div>
  );
};

interface ConnectionStatusProps {
  aiProvider: AiProviderIdType;
  isAIConnectorConnected: boolean;
  isSignedIn: boolean;
  isPro: boolean;
  cloudUsage: CloudUsage | null;
}

const ConnectionStatus = ({
  aiProvider,
  isAIConnectorConnected,
  isSignedIn,
  isPro,
  cloudUsage,
}: ConnectionStatusProps) => {
  const { t } = useTranslation();

  let statusColor: string;
  let statusText: string;
  let titleText: string;
  let detailText: string | null = null;

  if (aiProvider === AiProviderId.Cloud) {
    titleText = t('editor.ai.connection.cloudLabel');
    if (isSignedIn && isPro) {
      statusColor = 'bg-green-500';
      statusText = t('editor.ai.connection.ready');

      const reqs = cloudUsage?.requests ?? 0;
      const limit = cloudUsage?.limit ?? 500;
      detailText = t('settings.processing.ai.cloud.signedIn.usageStats', { requests: reqs, limit: limit });
    } else if (isSignedIn && !isPro) {
      statusColor = 'bg-red-500';
      statusText = t('editor.ai.connection.upgradeRequired');
    } else {
      statusColor = 'bg-red-500';
      statusText = t('editor.ai.connection.notLoggedIn');
    }
  } else if (aiProvider === AiProviderId.Connector) {
    titleText = t('editor.ai.connection.connectorLabel');
    if (isAIConnectorConnected) {
      statusColor = 'bg-green-500';
      statusText = t('editor.ai.connection.ready');
    } else {
      statusColor = 'bg-red-500';
      statusText = t('editor.ai.connection.notDetected');
    }
  } else {
    titleText = t('editor.ai.connection.builtinLabel');
    statusColor = 'bg-green-500';
    statusText = t('editor.ai.connection.ready');
  }

  return (
    <div
      aria-label={`${titleText}: ${statusText}`}
      className="flex min-h-7 items-center gap-2 rounded border border-editor-border bg-editor-panel-well px-2 py-1"
      role="status"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
      <UiText className="min-w-0 flex-1 truncate text-[11px] leading-4" variant={TextVariants.small}>
        {titleText}
      </UiText>
      {detailText ? (
        <UiText className="shrink-0 text-[10px] leading-4 text-text-tertiary" variant={TextVariants.small}>
          {detailText}
        </UiText>
      ) : null}
      <span
        className={cx(
          editorChromeStatusChipClassName(statusColor === 'bg-green-500' ? 'success' : 'warning'),
          'shrink-0',
        )}
      >
        {statusText}
      </span>
    </div>
  );
};

export function AIPanel() {
  const { t } = useTranslation();
  const activePatchContainerId = useEditorStore((s) => s.activeAiPatchContainerId);
  const activeSubMaskId = useEditorStore((s) => s.activeAiSubMaskId);
  const adjustments = useEditorStore((s) => s.adjustments);
  const brushSettings = useEditorStore((s) => s.brushSettings);
  const isAIConnectorConnected = useEditorStore((s) => s.isAIConnectorConnected);
  const isGeneratingAi = useEditorStore((s) => s.isGeneratingAi);
  const isGeneratingAiMask = useEditorStore((s) => s.isGeneratingAiMask);
  const maskOverlaySettings = useEditorStore((s) => s.maskOverlaySettings);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const compare = useEditorStore((s) => s.compare);
  const showOriginal = compare.isOriginalHeld || compare.mode === 'hold-original';
  const dispatchCompare = useEditorStore((s) => s.dispatchCompare);
  const setEditor = useEditorStore((s) => s.setEditor);
  const applyAiEditCommand = useEditorStore((s) => s.applyAiEditCommand);

  const aiModelDownloadStatus = useProcessStore((s) => s.aiModelDownloadStatus);
  const setCustomEscapeHandler = useUIStore((s) => s.setCustomEscapeHandler);

  const {
    handleGenerativeReplace,
    handleGenerateAiForegroundMask,
    handleGenerateAiPersonPartMask,
    handleGenerateAiWholePersonMask,
  } = useAiMasking();
  const appSettings = useSettingsStore((s) => s.appSettings);
  const aiProvider = normalizeAiProviderId(appSettings?.aiProvider);

  const { user, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const isPro = user?.publicMetadata['plan'] === 'pro';
  const [cloudUsage, setCloudUsage] = useState<CloudUsage | null>(null);

  const aiProviderRuntimeState = resolveAiProviderRuntimeState({
    aiProvider,
    isAIConnectorConnected,
    isPro,
    isSignedIn: isSignedIn ?? false,
  });
  const isGenerativeAvailable = aiProviderRuntimeState.generativeEditAvailable;

  useEffect(() => {
    if (aiProvider !== AiProviderId.Cloud || !isSignedIn || !isPro) return;

    const fetchUsage = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const res = await fetch('https://getrapidraw.com/api/usage', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const usageJson: unknown = await res.json();
          setCloudUsage(cloudUsageSchema.parse(usageJson));
        }
      } catch (e) {
        console.error('Failed to fetch cloud usage', e);
      }
    };

    void fetchUsage();
  }, [aiProvider, isSignedIn, isPro, getToken]);

  const setBrushSettings = useCallback(
    (updater: BrushSettingsUpdater) => {
      setEditor((state) => ({
        brushSettings: typeof updater === 'function' ? updater(state.brushSettings ?? DEFAULT_BRUSH_SETTINGS) : updater,
      }));
    },
    [setEditor],
  );
  const onDragStateChange = useCallback(
    (isDragging: boolean) => {
      setEditor({ isSliderDragging: isDragging });
    },
    [setEditor],
  );

  const [expandedContainers, setExpandedContainers] = useState<Set<string>>(new Set());
  const [activeDragItem, setActiveDragItem] = useState<DragData | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [analyzingSubMaskId, setAnalyzingSubMaskId] = useState<string | null>(null);
  const [copiedPatch, setCopiedPatch] = useState<AiPatch | null>(null);
  const [copiedSubMask, setCopiedSubMask] = useState<SubMask | null>(null);

  const [collapsibleState, setCollapsibleState] = useState<AiPanelCollapsibleState>({
    generative: true,
    properties: true,
  });

  const { showContextMenu } = useContextMenu();
  const { setNodeRef: setRootDroppableRef, isOver: isRootOver } = useDroppable({ id: 'ai-list-root' });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const commitAiEditCommand = useCallback(
    (command: AiEditCommand, expandSelection = false): AiEditSelection | null => {
      const selection = applyAiEditCommand(command);
      if (expandSelection && selection?.containerId) {
        const containerId = selection.containerId;
        setExpandedContainers((previous) => {
          if (previous.has(containerId)) return previous;
          return new Set(previous).add(containerId);
        });
      }
      return selection;
    },
    [applyAiEditCommand],
  );

  const selectAiEdit = useCallback(
    (requested: AiEditSelection, expandSelection = false) => {
      let selection: AiEditSelection = { containerId: null, subMaskId: null };
      setEditor((state) => {
        selection = resolveAiEditSelection(state.adjustments.aiPatches, requested);
        return {
          activeAiPatchContainerId: selection.containerId,
          activeAiSubMaskId: selection.subMaskId,
        };
      });
      if (expandSelection && selection.containerId) {
        const containerId = selection.containerId;
        setExpandedContainers((previous) =>
          previous.has(containerId) ? previous : new Set(previous).add(containerId),
        );
      }
    },
    [setEditor],
  );

  const activeContainer = adjustments.aiPatches.find((p) => p.id === activePatchContainerId);
  const activeSubMaskData = activeContainer?.subMasks.find((sm) => sm.id === activeSubMaskId);
  const reviewContainer =
    activeContainer !== undefined && activeContainer.patchData !== null
      ? activeContainer
      : (adjustments.aiPatches.findLast((patch) => patch.patchData !== null) ?? null);
  const isAiMask =
    activeSubMaskData &&
    [Mask.AiSubject, Mask.AiForeground, Mask.AiPerson, Mask.AiSky].includes(activeSubMaskData.type);
  const panelStatus = useMemo<InspectorPanelStatus>(() => {
    if (selectedImage === null) {
      return { label: t('editor.ai.noImageSelected'), tone: 'neutral' };
    }
    if (!selectedImage.isReady) {
      return { label: t('editor.ai.workspace.imagePreparing'), tone: 'info' };
    }
    if (isGeneratingAi || activeContainer?.isLoading) {
      return { label: t('editor.ai.workspace.generating'), tone: 'info' };
    }
    if (aiModelDownloadStatus) {
      return { label: t('editor.ai.workspace.modelPreparing'), tone: 'info' };
    }
    if (!isGenerativeAvailable) {
      return { label: t('editor.ai.workspace.basicOnly'), tone: 'warning' };
    }
    if (activeContainer?.patchData) {
      return { label: t('editor.ai.workspace.previewApplied'), tone: 'success' };
    }
    if (activeContainer) {
      return {
        label:
          activeContainer.subMasks.length === 0
            ? t('editor.ai.workspace.targetNeeded')
            : t('editor.ai.workspace.readyToGenerate'),
        tone: activeContainer.subMasks.length === 0 ? 'warning' : 'neutral',
      };
    }
    return { label: t('editor.ai.connection.ready'), tone: 'neutral' };
  }, [activeContainer, aiModelDownloadStatus, isGenerativeAvailable, isGeneratingAi, selectedImage, t]);
  const panelNotice =
    selectedImage === null
      ? {
          kind: 'empty' as const,
          label: t('editor.ai.noImageSelected'),
        }
      : selectedImage.isReady
        ? undefined
        : {
            kind: 'loading' as const,
            label: t('editor.ai.workspace.imagePreparing'),
          };

  useEffect(() => {
    const timer = setTimeout(
      () => {
        setAnalyzingSubMaskId(isGeneratingAiMask && isAiMask ? activeSubMaskId : null);
      },
      isGeneratingAiMask && isAiMask ? 200 : 0,
    );

    return () => {
      clearTimeout(timer);
    };
  }, [isGeneratingAiMask, isAiMask, activeSubMaskId]);

  useEffect(() => {
    const handler = () => {
      if (renamingId) {
        setRenamingId(null);
        setTempName('');
      } else if (activeSubMaskId) selectAiEdit({ containerId: activePatchContainerId, subMaskId: null });
      else if (activePatchContainerId) selectAiEdit({ containerId: null, subMaskId: null });
    };
    if (activePatchContainerId || renamingId) setCustomEscapeHandler(() => handler);
    else setCustomEscapeHandler(null);
    return () => {
      setCustomEscapeHandler(null);
    };
  }, [activePatchContainerId, activeSubMaskId, renamingId, selectAiEdit, setCustomEscapeHandler]);

  const handleDeselect = () => {
    selectAiEdit({ containerId: null, subMaskId: null });
  };

  const handleToggleExpand = (id: string) => {
    setExpandedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResetAllAiEdits = () => {
    if (isGeneratingAi) return;
    commitAiEditCommand(() => ({
      aiPatches: [],
      selection: { containerId: null, subMaskId: null },
    }));
    setExpandedContainers(new Set());
  };

  const movePatchContainer = (id: string, direction: 'down' | 'up') => {
    commitAiEditCommand(({ aiPatches, selection }) => {
      const currentIndex = aiPatches.findIndex((patch) => patch.id === id);
      const targetIndex = currentIndex + (direction === 'up' ? -1 : 1);
      const target = aiPatches[targetIndex];
      if (currentIndex < 0 || !target) return null;

      const reorderedPatches = reorderMaskListContainers(aiPatches, id, target.id);
      return reorderedPatches ? { aiPatches: reorderedPatches, selection } : null;
    });
  };

  const moveSubMask = (containerId: string, subMaskId: string, direction: 'down' | 'up') => {
    commitAiEditCommand(({ aiPatches, selection }) => {
      const container = aiPatches.find((patch) => patch.id === containerId);
      if (!container) return null;

      const currentIndex = container.subMasks.findIndex((subMask) => subMask.id === subMaskId);
      const targetIndex = currentIndex + (direction === 'up' ? -1 : 1);
      if (currentIndex < 0 || !container.subMasks[targetIndex]) return null;

      const reorderedSubMasks = [...container.subMasks];
      const [movedSubMask] = reorderedSubMasks.splice(currentIndex, 1);
      if (!movedSubMask) return null;
      reorderedSubMasks.splice(targetIndex, 0, movedSubMask);

      return {
        aiPatches: aiPatches.map((patch) =>
          patch.id === containerId ? { ...patch, subMasks: reorderedSubMasks } : patch,
        ),
        selection,
      };
    });
  };

  const toggleTargetOverlay = useCallback(() => {
    setEditor((state) => ({
      maskOverlaySettings: saveMaskOverlaySettingsPreference({
        ...state.maskOverlaySettings,
        mode: state.maskOverlaySettings.mode === 'hidden' ? 'rubylith' : 'hidden',
      }),
    }));
  }, [setEditor]);

  const createMaskLogic = (
    type: Mask,
    mode: SubMaskMode = SubMaskMode.Additive,
    personPart?: MaskType['personPart'],
  ) => {
    if (!selectedImage) return createSubMask(type, { width: 1000, height: 1000 }, mode);
    const subMask = createSubMask(type, selectedImage, mode);

    const steps = adjustments.orientationSteps;
    const isRotated = steps === 1 || steps === 3;
    const imgW = isRotated ? selectedImage.height || 1000 : selectedImage.width || 1000;
    const imgH = isRotated ? selectedImage.width || 1000 : selectedImage.height || 1000;
    const parameters = toMaskParameterRecord(subMask.parameters);

    const config = SUB_MASK_CONFIG[type];
    if (config?.parameters) {
      config.parameters.forEach((param) => {
        parameters[param.key] = param.defaultValue / (param.multiplier || 1);
      });
    }

    if (type === Mask.Linear) {
      parameters['range'] = Math.min(imgW, imgH) * 0.1;
    }

    if (type === Mask.Linear || type === Mask.Radial) {
      parameters['isInitialDraw'] = true;
      parameters['startX'] = -10000;
      parameters['startY'] = -10000;
      parameters['endX'] = -10000;
      parameters['endY'] = -10000;
      parameters['centerX'] = -10000;
      parameters['centerY'] = -10000;
      parameters['radiusX'] = 0;
      parameters['radiusY'] = 0;
    }
    subMask.parameters =
      personPart === undefined ? parameters : { ...parameters, target: { part: personPart, personId: null } };
    if (personPart === 'face') subMask.name = t('masks.types.face');
    return subMask;
  };

  const handleAddAiPatchContainer = (maskTypeOrType: MaskType | Mask) => {
    const type = typeof maskTypeOrType === 'string' ? maskTypeOrType : maskTypeOrType.type;
    const personPart = typeof maskTypeOrType === 'string' ? undefined : maskTypeOrType.personPart;
    const subMask = createMaskLogic(type, SubMaskMode.Additive, personPart);

    let name: string;
    if (type === Mask.QuickEraser) {
      const count =
        adjustments.aiPatches.filter((p: AiPatch) => p.subMasks.some((sm: SubMask) => sm.type === Mask.QuickEraser))
          .length + 1;
      name = t('editor.ai.patches.quickErase', { count });
    } else {
      const count = adjustments.aiPatches.length + 1;
      name = t('editor.ai.patches.aiEdit', { count });
    }

    const newContainer: AiPatch = {
      id: crypto.randomUUID(),
      invert: false,
      isLoading: false,
      name: name,
      patchData: null,
      prompt: '',
      subMasks: [subMask],
      visible: true,
    };

    commitAiEditCommand(
      ({ aiPatches }) => ({
        aiPatches: [...aiPatches, newContainer],
        selection: { containerId: newContainer.id, subMaskId: subMask.id },
        selectBrushTool: type === Mask.Brush,
      }),
      true,
    );

    if (type === Mask.AiForeground) void handleGenerateAiForegroundMask(subMask.id);
    else if (type === Mask.AiPerson && personPart !== undefined)
      void handleGenerateAiPersonPartMask(subMask.id, personPart);
    else if (type === Mask.AiPerson) void handleGenerateAiWholePersonMask(subMask.id);
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
    const committed = commitAiEditCommand(({ aiPatches }) => {
      if (!aiPatches.some((container) => container.id === containerId)) return null;
      return {
        aiPatches: aiPatches.map((c: AiPatch) => {
          if (c.id === containerId) {
            const newSubMasks = [...c.subMasks];
            if (insertIndex >= 0) newSubMasks.splice(insertIndex, 0, subMask);
            else newSubMasks.push(subMask);
            return { ...c, subMasks: newSubMasks };
          }
          return c;
        }),
        selection: { containerId, subMaskId: subMask.id },
        selectBrushTool: type === Mask.Brush,
      };
    }, true);
    if (!committed || committed.subMaskId !== subMask.id) return;
    if (type === Mask.AiForeground) void handleGenerateAiForegroundMask(subMask.id);
    else if (type === Mask.AiPerson && personPart !== undefined)
      void handleGenerateAiPersonPartMask(subMask.id, personPart);
    else if (type === Mask.AiPerson) void handleGenerateAiWholePersonMask(subMask.id);
  };

  const handleAddAiContextMenu = (
    event: React.MouseEvent | ReactKeyboardEvent<HTMLElement>,
    targetContainerId?: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();

    const buildMenu = (types: MaskType[], mode: SubMaskMode = SubMaskMode.Additive) =>
      types
        .filter((mt) => !mt.disabled)
        .map((maskType: MaskType) => ({
          label: maskType.name,
          icon: maskType.icon,
          onClick: () => {
            if (targetContainerId) {
              handleAddSubMask(targetContainerId, maskType, mode);
            } else {
              handleAddAiPatchContainer(maskType);
            }
          },
        }));

    const container = targetContainerId ? adjustments.aiPatches.find((m) => m.id === targetContainerId) : null;
    const hasComponents = container && container.subMasks.length > 0;

    let options: Option[];

    if (!targetContainerId) {
      options = buildMenu(AI_PANEL_CREATION_TYPES, SubMaskMode.Additive);
    } else {
      options = buildMenu(AI_SUB_MASK_COMPONENT_TYPES, SubMaskMode.Additive);

      if (hasComponents) {
        options.push(
          { type: OPTION_SEPARATOR },
          {
            label: t('editor.ai.actions.subtractFromEdit'),
            icon: Minus,
            submenu: buildMenu(AI_SUB_MASK_COMPONENT_TYPES, SubMaskMode.Subtractive),
          },
          {
            label: t('editor.ai.actions.intersectEditWith'),
            icon: SquaresIntersect,
            submenu: buildMenu(AI_SUB_MASK_COMPONENT_TYPES, SubMaskMode.Intersect),
          },
        );
      }
    }

    showContextMenu(rect.left, rect.bottom + 5, options);
  };

  const updatePatch = (id: string, data: Partial<AiPatch>) => {
    commitAiEditCommand(({ aiPatches, selection }) => {
      if (!aiPatches.some((patch) => patch.id === id)) return null;
      return {
        aiPatches: aiPatches.map((p) => (p.id === id ? { ...p, ...data } : p)),
        selection,
      };
    });
  };

  const updateSubMask = (id: string, data: Partial<SubMask>) => {
    commitAiEditCommand(({ aiPatches, selection }) => {
      if (!aiPatches.some((patch) => patch.subMasks.some((subMask) => subMask.id === id))) return null;
      return {
        aiPatches: aiPatches.map((p) => ({
          ...p,
          subMasks: p.subMasks.map((sm) => (sm.id === id ? { ...sm, ...data } : sm)),
        })),
        selection,
      };
    });
  };

  const handleDeleteContainer = (id: string) => {
    const committed = commitAiEditCommand(({ aiPatches, selection }) => {
      if (!aiPatches.some((patch) => patch.id === id)) return null;
      return {
        aiPatches: aiPatches.filter((patch) => patch.id !== id),
        selection: selectionAfterPatchDeletion(aiPatches, selection, id),
      };
    });
    if (committed) {
      setExpandedContainers((previous) => {
        if (!previous.has(id)) return previous;
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDeleteSubMask = (containerId: string, subMaskId: string) => {
    const nextSelection = commitAiEditCommand(({ aiPatches, selection }) => {
      const container = aiPatches.find((patch) => patch.id === containerId);
      if (!container?.subMasks.some((subMask) => subMask.id === subMaskId)) return null;
      return {
        aiPatches: aiPatches.map((p) =>
          p.id === containerId ? { ...p, subMasks: p.subMasks.filter((sm) => sm.id !== subMaskId) } : p,
        ),
        selection: selectionAfterSubMaskDeletion(aiPatches, selection, containerId, subMaskId),
      };
    });
    if (nextSelection?.subMaskId) {
      setExpandedContainers((previous) => (previous.has(containerId) ? previous : new Set(previous).add(containerId)));
    }
  };

  const clonePatchData = (container: AiPatch, options: { invert?: boolean; rename?: boolean } = {}): AiPatch =>
    cloneMaskLikeContainerForPaste(container, () => crypto.randomUUID(), {
      invert: options.invert,
      renameTo: options.rename === false ? undefined : `${container.name} Copy`,
      resetContainer: (clonedContainer) => {
        clonedContainer.isLoading = false;
        clonedContainer.patchData = null;
      },
    });

  const cloneSubMaskData = (subMask: SubMask, options: { invert?: boolean; rename?: boolean } = {}): SubMask =>
    cloneSubMaskForPaste(subMask, () => crypto.randomUUID(), {
      invert: options.invert,
      renameTo: options.rename === false ? undefined : `${getSubMaskName(subMask)} Copy`,
    });

  const copyPatchToClipboard = (container: AiPatch) => {
    setCopiedPatch(structuredClone(container));
  };

  const copySubMaskToClipboard = (subMask: SubMask) => {
    setCopiedSubMask(structuredClone(subMask));
  };

  const insertPatchContainer = (container: AiPatch, insertIndex?: number) => {
    commitAiEditCommand(
      ({ aiPatches }) => ({
        aiPatches: insertMaskLikeContainerAt(aiPatches, container, insertIndex),
        selection: { containerId: container.id, subMaskId: null },
      }),
      true,
    );
  };

  const insertSubMaskIntoContainer = (containerId: string, subMask: SubMask, insertIndex?: number) => {
    commitAiEditCommand(({ aiPatches }) => {
      if (!aiPatches.some((candidate) => candidate.id === containerId)) return null;
      return {
        aiPatches: aiPatches.map((container) => {
          if (container.id !== containerId) {
            return container;
          }

          return { ...container, subMasks: insertSubMaskAt(container.subMasks, subMask, insertIndex) };
        }),
        selection: { containerId, subMaskId: subMask.id },
      };
    }, true);
  };

  const clipboardActions = createMaskLikeClipboardActions({
    cloneContainerForDuplicate: (container, options) => clonePatchData(container, options),
    cloneContainerForInvertedSubMask: (container) => clonePatchData(container, { rename: false }),
    cloneContainerForPaste: (container) => clonePatchData(container, { rename: false }),
    cloneSubMaskForDuplicate: (subMask, options) => cloneSubMaskData(subMask, options),
    cloneSubMaskForPaste: (subMask) => cloneSubMaskData(subMask, { rename: false }),
    containers: adjustments.aiPatches,
    copiedContainer: copiedPatch,
    copiedSubMask,
    insertContainer: insertPatchContainer,
    insertSubMask: insertSubMaskIntoContainer,
    invertedContainerName: (container) => t('editor.ai.patches.invertedName', { name: container.name }),
    invertedSubMaskContainerName: (subMask) => t('editor.ai.patches.invertedName', { name: getSubMaskName(subMask) }),
  });

  const handleDuplicatePatchContainer = clipboardActions.duplicateContainer;
  const handleDuplicateAndInvertPatchContainer = clipboardActions.duplicateAndInvertContainer;
  const handlePastePatch = clipboardActions.pasteContainer;
  const handleDuplicateSubMask = clipboardActions.duplicateSubMask;
  const handleDuplicateAndInvertSubMask = clipboardActions.duplicateAndInvertSubMask;
  const handlePasteSubMask = clipboardActions.pasteSubMask;

  const handlePanelContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectedImage) {
      return;
    }

    const newEditSubMenu = AI_PANEL_CREATION_TYPES.filter((maskType) => !maskType.disabled).map((maskType) => ({
      label: maskType.name,
      icon: maskType.icon,
      onClick: () => {
        handleAddAiPatchContainer(maskType);
      },
    }));

    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.ai.actions.pasteEdit'),
        icon: ClipboardPaste,
        disabled: !copiedPatch,
        onClick: () => {
          handlePastePatch();
        },
      },
      {
        label: t('editor.ai.addNewEdit'),
        icon: Plus,
        submenu: newEditSubMenu,
      },
    ]);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragItem(event.active.data.current as DragData);
    onDragStateChange(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dragData = active.data.current as DragData;
    const overData = over?.data.current as DragData | undefined;

    setActiveDragItem(null);
    onDragStateChange(false);

    const creationMaskType = dragData.type === 'Creation' ? dragData.maskType : undefined;
    if (creationMaskType) {
      const creationFn = () => {
        const overItem = overData?.item;
        if (overData?.type === 'Container' && overItem) {
          handleAddSubMask(overItem.id, creationMaskType);
        } else if (overData?.type === 'SubMask') {
          const container = adjustments.aiPatches.find((p) => p.id === overData.parentId);
          const parentId = overData.parentId;
          if (container && over && parentId) {
            const targetIndex = container.subMasks.findIndex((sm) => sm.id === over.id);
            handleAddSubMask(parentId, creationMaskType, SubMaskMode.Additive, targetIndex);
          }
        } else {
          handleAddAiPatchContainer(creationMaskType);
        }
      };

      if (adjustments.aiPatches.length > 0) setPendingAction(() => creationFn);
      else creationFn();
      return;
    }

    if (dragData.type === 'Container') {
      const overId = over?.id;
      if (!overId || active.id === overId) return;

      commitAiEditCommand(({ aiPatches, selection }) => {
        const draggedItem = dragData.item;
        if (!draggedItem || !aiPatches.some((patch) => patch.id === draggedItem.id)) return null;

        let newIndex = -1;

        if (overId === 'ai-list-root') newIndex = aiPatches.length - 1;
        else if (overData?.type === 'Container') newIndex = aiPatches.findIndex((p) => p.id === overId);
        else if (overData?.type === 'SubMask') newIndex = aiPatches.findIndex((p) => p.id === overData.parentId);
        if (newIndex < 0) return null;

        const reorderedPatches = reorderMaskListContainers(aiPatches, draggedItem.id, aiPatches[newIndex]?.id ?? '');
        return reorderedPatches ? { aiPatches: reorderedPatches, selection } : null;
      });
      return;
    }

    if (dragData.type === 'SubMask') {
      const sourceContainerId = dragData.parentId;
      if (!sourceContainerId) return;

      if (over?.id === 'ai-list-root' || !over) {
        commitAiEditCommand(({ aiPatches }) => {
          const draggedItem = dragData.item;
          if (!draggedItem) return null;

          const result = splitSubMaskToContainer(
            aiPatches,
            sourceContainerId,
            draggedItem.id,
            (movedSubMask, count) => ({
              id: crypto.randomUUID(),
              invert: false,
              isLoading: false,
              name: t('editor.ai.patches.aiEdit', { count: count + 1 }),
              patchData: null,
              prompt: '',
              subMasks: [movedSubMask],
              visible: true,
            }),
          );
          if (!result) return null;

          const { container: newContainer, containers: newPatches, subMask: movedSubMask } = result;
          return {
            aiPatches: newPatches,
            selection: { containerId: newContainer.id, subMaskId: movedSubMask.id },
          };
        }, true);
        return;
      }

      let targetContainerId: string | null = null;
      if (overData?.type === 'Container') targetContainerId = overData.item?.id ?? null;
      else if (overData?.type === 'SubMask') targetContainerId = overData.parentId || null;

      if (targetContainerId) {
        const expandedTargetContainerId = targetContainerId;
        const committed = commitAiEditCommand(({ aiPatches, selection }) => {
          const draggedItem = dragData.item;
          if (!draggedItem) return null;

          const newPatches = moveSubMaskBetweenContainers(
            aiPatches,
            sourceContainerId,
            expandedTargetContainerId,
            draggedItem.id,
            overData?.type === 'SubMask' ? String(over.id) : undefined,
          );
          if (!newPatches) return null;
          const movedSelection =
            selection.subMaskId === draggedItem.id
              ? { containerId: expandedTargetContainerId, subMaskId: draggedItem.id }
              : selection;
          return { aiPatches: newPatches, selection: movedSelection };
        });
        if (committed?.containerId === expandedTargetContainerId && committed.subMaskId === dragData.item?.id) {
          setExpandedContainers((previous) =>
            previous.has(expandedTargetContainerId) ? previous : new Set(previous).add(expandedTargetContainerId),
          );
        }
      }
    }
  };

  return (
    <InspectorPanelFrame
      actions={
        <button
          aria-label={t('editor.ai.resetInpaintingTooltip')}
          className={professionalInspectorDensityTokens.frame.actionButton}
          data-tooltip={t('editor.ai.resetInpaintingTooltip')}
          disabled={isGeneratingAi || adjustments.aiPatches.length === 0}
          onClick={handleResetAllAiEdits}
          type="button"
        >
          <RotateCcw size={15} />
        </button>
      }
      icon={Wand2}
      label={t('editor.ai.inpaintingTitle')}
      notice={panelNotice}
      status={panelStatus}
      testId="inpaint-workspace-panel"
    >
      <DndContext
        collisionDetection={pointerWithin}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <div
          className="flex min-h-0 flex-1 select-none flex-col overflow-hidden"
          onContextMenu={handlePanelContextMenu}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-2">
            {selectedImage ? (
              <div className="space-y-2.5">
                <ConnectionStatus
                  aiProvider={aiProvider}
                  cloudUsage={cloudUsage}
                  isAIConnectorConnected={isAIConnectorConnected}
                  isPro={isPro}
                  isSignedIn={isSignedIn ?? false}
                />

                <section
                  aria-label={t('editor.ai.editsTitle')}
                  className={professionalInspectorDensityTokens.card.nestedPanel}
                  data-testid="inpaint-edit-list"
                >
                  <div className={professionalInspectorDensityTokens.sectionHeader.root}>
                    <UiText
                      className={professionalInspectorDensityTokens.sectionHeader.title}
                      variant={TextVariants.label}
                    >
                      {t('editor.ai.editsTitle')}
                    </UiText>
                    <div className="flex items-center gap-1">
                      <span
                        className={editorChromeStatusChipClassName('neutral')}
                        data-testid="inpaint-edit-count"
                        title={t('editor.ai.workspace.editCount', { count: adjustments.aiPatches.length })}
                      >
                        {adjustments.aiPatches.length}
                      </span>
                      <button
                        aria-label={t('editor.ai.addNewEdit')}
                        className={professionalInspectorDensityTokens.actionButton.quiet}
                        data-tooltip={t('editor.ai.addNewEdit')}
                        disabled={isGeneratingAi}
                        onClick={(event) => {
                          handleAddAiContextMenu(event, null);
                        }}
                        type="button"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    {adjustments.aiPatches.length === 0 ? (
                      <motion.div
                        key="inpaint-create"
                        animate={{ opacity: 1 }}
                        className="space-y-1.5"
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <UiText
                          className="block px-1 text-[11px] leading-4 text-text-secondary"
                          variant={TextVariants.small}
                        >
                          {t('editor.ai.workspace.createEditHint')}
                        </UiText>
                        <div
                          className="grid grid-cols-2 gap-1"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          role="presentation"
                        >
                          {AI_PANEL_CREATION_TYPES.map((maskType: MaskType) => (
                            <DraggableGridItem
                              isGenerating={isGeneratingAi}
                              key={maskType.id ?? maskType.type}
                              maskType={maskType}
                              onClick={() => {
                                handleAddAiPatchContainer(maskType);
                              }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="inpaint-list"
                        animate={{ opacity: 1 }}
                        className={cx('flex flex-col transition-colors', isRootOver && 'bg-editor-selected-quiet')}
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        onClick={handleDeselect}
                        ref={setRootDroppableRef}
                        transition={{ duration: 0.15 }}
                      >
                        <AnimatePresence
                          initial={false}
                          mode="popLayout"
                          onExitComplete={() => {
                            if (pendingAction) {
                              pendingAction();
                              setPendingAction(null);
                            }
                          }}
                        >
                          {adjustments.aiPatches.map((container, index) => (
                            <ContainerRow
                              activeDragItem={activeDragItem}
                              activeSubMaskId={activeSubMaskId}
                              analyzingSubMaskId={analyzingSubMaskId}
                              container={container}
                              copiedPatch={copiedPatch}
                              copiedSubMask={copiedSubMask}
                              copyPatchToClipboard={copyPatchToClipboard}
                              copySubMaskToClipboard={copySubMaskToClipboard}
                              handleDelete={handleDeleteContainer}
                              handleDeleteSubMask={handleDeleteSubMask}
                              handleDuplicate={handleDuplicatePatchContainer}
                              handleDuplicateAndInvert={handleDuplicateAndInvertPatchContainer}
                              handleDuplicateAndInvertSubMask={handleDuplicateAndInvertSubMask}
                              handleDuplicateSubMask={handleDuplicateSubMask}
                              handlePastePatch={handlePastePatch}
                              handlePasteSubMask={handlePasteSubMask}
                              hasActiveChild={activePatchContainerId === container.id && activeSubMaskId !== null}
                              isExpanded={expandedContainers.has(container.id)}
                              isSelected={activePatchContainerId === container.id && activeSubMaskId === null}
                              key={container.id}
                              onAddComponent={(event: React.MouseEvent) => {
                                handleAddAiContextMenu(event, container.id);
                              }}
                              onMove={(direction) => {
                                movePatchContainer(container.id, direction);
                              }}
                              onMoveSubMask={(subMaskId, direction) => {
                                moveSubMask(container.id, subMaskId, direction);
                              }}
                              onSelect={() => {
                                selectAiEdit({ containerId: container.id, subMaskId: null });
                              }}
                              onSelectAiEdit={(subMaskId) => {
                                selectAiEdit({ containerId: container.id, subMaskId }, subMaskId !== null);
                              }}
                              onToggle={() => {
                                handleToggleExpand(container.id);
                              }}
                              position={index}
                              renamingId={renamingId}
                              setRenamingId={setRenamingId}
                              setTempName={setTempName}
                              tempName={tempName}
                              totalCount={adjustments.aiPatches.length}
                              updateContainer={updatePatch}
                              updateSubMask={updateSubMask}
                            />
                          ))}
                        </AnimatePresence>

                        <AnimatePresence>
                          {activeDragItem?.type === 'Creation' && <NewMaskDropZone isOver={isRootOver} />}
                        </AnimatePresence>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>

                {activeContainer ? (
                  <>
                    <InpaintTargetSummary
                      activeSubMask={activeSubMaskData}
                      container={activeContainer}
                      isOverlayVisible={maskOverlaySettings.mode !== 'hidden'}
                      onToggleOverlay={toggleTargetOverlay}
                    />
                    <section
                      aria-label={t('editor.ai.editSettingsTitle')}
                      className={professionalInspectorDensityTokens.card.nestedPanel}
                      data-testid="inpaint-generation-settings"
                    >
                      <div className={professionalInspectorDensityTokens.sectionHeader.root}>
                        <UiText
                          className={professionalInspectorDensityTokens.sectionHeader.title}
                          variant={TextVariants.label}
                        >
                          {t('editor.ai.editSettingsTitle')}
                        </UiText>
                        <span
                          className={editorChromeStatusChipClassName(activeContainer.patchData ? 'success' : 'neutral')}
                        >
                          {activeContainer.patchData
                            ? t('editor.ai.workspace.previewApplied')
                            : t('editor.ai.workspace.readyToGenerate')}
                        </span>
                      </div>
                      <SettingsPanel
                        activeSubMask={activeSubMaskData}
                        aiModelDownloadStatus={aiModelDownloadStatus}
                        aiProvider={aiProviderRuntimeState.effectiveProvider}
                        brushSettings={brushSettings}
                        collapsibleState={collapsibleState}
                        container={activeContainer}
                        isGenerativeAvailable={isGenerativeAvailable}
                        isGeneratingAi={isGeneratingAi}
                        isGeneratingAiMask={isGeneratingAiMask}
                        onGenerativeReplace={handleGenerativeReplace}
                        setBrushSettings={setBrushSettings}
                        setCollapsibleState={setCollapsibleState}
                        updateContainer={updatePatch}
                        updateSubMask={updateSubMask}
                      />
                    </section>
                  </>
                ) : null}

                <InpaintReviewActions
                  container={reviewContainer}
                  isShowingOriginal={showOriginal}
                  onSelect={(id) => {
                    selectAiEdit({ containerId: id, subMaskId: null });
                  }}
                  onToggleOriginal={() => {
                    dispatchCompare({ type: 'toggle-original' });
                  }}
                  onToggleVisibility={(id) => {
                    updatePatch(id, {
                      visible: !adjustments.aiPatches.find((patch) => patch.id === id)?.visible,
                    });
                  }}
                />
              </div>
            ) : null}
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
                  <Wand2 size={18} className={TEXT_COLOR_KEYS[TextColors.secondary]} />
                  <span className="flex-1 truncate">{(activeDragItem.item as AiPatch).name}</span>
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
                    const maskType = AI_PANEL_CREATION_TYPES.find((m) => m.type === activeDragItem.maskType);
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
    </InspectorPanelFrame>
  );
}

export default AIPanel;

function NewMaskDropZone({ isOver }: { isOver: boolean }) {
  const { t } = useTranslation();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: 'auto', marginTop: '4px' }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`rounded border border-dashed px-2 py-1.5 text-center ${
        isOver ? 'border-editor-primary-active bg-editor-selected-quiet' : 'border-editor-border'
      }`}
    >
      <UiText className="text-[11px] leading-4" variant={TextVariants.small} weight={TextWeights.medium}>
        {t('editor.ai.dropzoneText')}
      </UiText>
    </motion.div>
  );
}

interface InpaintTargetSummaryProps {
  activeSubMask: SubMask | undefined;
  container: AiPatch;
  isOverlayVisible: boolean;
  onToggleOverlay: () => void;
}

function InpaintTargetSummary({
  activeSubMask,
  container,
  isOverlayVisible,
  onToggleOverlay,
}: InpaintTargetSummaryProps) {
  const { t } = useTranslation();
  const fallbackTarget = container.subMasks[0];
  const displayedTarget = activeSubMask ?? fallbackTarget;
  const TargetIcon = displayedTarget ? MASK_ICON_MAP[displayedTarget.type] : Crosshair;
  const targetState = activeSubMask ? 'active' : displayedTarget ? 'available' : 'empty';
  const targetSummary =
    targetState === 'empty'
      ? t('editor.ai.workspace.targetNeeded')
      : targetState === 'active'
        ? t('editor.ai.workspace.targetActive')
        : t('editor.ai.workspace.targetAvailable', { count: container.subMasks.length });

  return (
    <section
      aria-label={t('editor.ai.workspace.targetTitle')}
      className={professionalInspectorDensityTokens.card.nestedPanel}
      data-target-state={targetState}
      data-testid="inpaint-target-summary"
    >
      <div className={professionalInspectorDensityTokens.sectionHeader.root}>
        <UiText className={professionalInspectorDensityTokens.sectionHeader.title} variant={TextVariants.label}>
          {t('editor.ai.workspace.targetTitle')}
        </UiText>
        <button
          aria-label={t('editor.ai.workspace.toggleTargetOverlay')}
          aria-pressed={isOverlayVisible}
          className={cx(
            professionalInspectorDensityTokens.actionButton.quiet,
            isOverlayVisible && professionalInspectorDensityTokens.actionButton.selectedQuiet,
          )}
          data-tooltip={t('editor.ai.workspace.toggleTargetOverlay')}
          disabled={!displayedTarget}
          onClick={onToggleOverlay}
          type="button"
        >
          {isOverlayVisible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      </div>
      <div className="flex min-h-8 items-center gap-2 rounded border border-editor-border bg-editor-panel px-2 py-1">
        <TargetIcon aria-hidden="true" className="shrink-0 text-text-secondary" size={15} />
        <div className="min-w-0 flex-1">
          <UiText className="truncate text-[11px] font-medium leading-4" variant={TextVariants.small}>
            {displayedTarget ? getSubMaskName(displayedTarget) : container.name}
          </UiText>
          <UiText className="block truncate text-[10px] leading-3 text-text-tertiary" variant={TextVariants.small}>
            {targetSummary}
          </UiText>
        </div>
        {displayedTarget ? (
          <Crosshair aria-hidden="true" className="shrink-0 text-editor-primary-active" size={14} />
        ) : null}
      </div>
    </section>
  );
}

interface InpaintReviewActionsProps {
  container: AiPatch | null;
  isShowingOriginal: boolean;
  onSelect: (id: string) => void;
  onToggleOriginal: () => void;
  onToggleVisibility: (id: string) => void;
}

function InpaintReviewActions({
  container,
  isShowingOriginal,
  onSelect,
  onToggleOriginal,
  onToggleVisibility,
}: InpaintReviewActionsProps) {
  const { t } = useTranslation();

  if (!container) return null;

  return (
    <section
      aria-label={t('editor.ai.workspace.reviewTitle')}
      className={professionalInspectorDensityTokens.card.nestedPanel}
      data-testid="inpaint-review-actions"
    >
      <div className={professionalInspectorDensityTokens.sectionHeader.root}>
        <UiText className={professionalInspectorDensityTokens.sectionHeader.title} variant={TextVariants.label}>
          {t('editor.ai.workspace.reviewTitle')}
        </UiText>
        <span className={editorChromeStatusChipClassName(container.visible ? 'success' : 'neutral')}>
          {container.visible ? t('editor.ai.workspace.previewApplied') : t('editor.ai.workspace.previewHidden')}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 pb-1">
        <CheckCircle2 aria-hidden="true" className="shrink-0 text-editor-success" size={15} />
        <UiText
          className="min-w-0 flex-1 truncate text-[11px] leading-4 text-text-secondary"
          variant={TextVariants.small}
        >
          {container.name}
        </UiText>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <button
          aria-label={t('editor.ai.workspace.compareOriginal')}
          aria-pressed={isShowingOriginal}
          className={cx(
            professionalInspectorDensityTokens.actionButton.base,
            professionalInspectorDensityTokens.actionButton.inactive,
            'min-w-0 gap-1 px-1.5',
            isShowingOriginal && professionalInspectorDensityTokens.actionButton.selectedQuiet,
          )}
          data-tooltip={t('editor.ai.workspace.compareOriginal')}
          onClick={onToggleOriginal}
          type="button"
        >
          <GitCompareArrows aria-hidden="true" size={13} />
          <span className="truncate">{t('editor.ai.workspace.compare')}</span>
        </button>
        <button
          aria-label={container.visible ? t('editor.ai.workspace.hidePreview') : t('editor.ai.workspace.showPreview')}
          aria-pressed={container.visible}
          className={cx(
            professionalInspectorDensityTokens.actionButton.base,
            professionalInspectorDensityTokens.actionButton.inactive,
            'min-w-0 gap-1 px-1.5',
          )}
          data-tooltip={container.visible ? t('editor.ai.workspace.hidePreview') : t('editor.ai.workspace.showPreview')}
          onClick={() => {
            onToggleVisibility(container.id);
          }}
          type="button"
        >
          {container.visible ? <EyeOff aria-hidden="true" size={13} /> : <Eye aria-hidden="true" size={13} />}
          <span className="truncate">
            {container.visible ? t('editor.ai.workspace.hide') : t('editor.ai.workspace.show')}
          </span>
        </button>
        <button
          aria-label={t('editor.ai.workspace.refineEdit')}
          className={cx(
            professionalInspectorDensityTokens.actionButton.base,
            professionalInspectorDensityTokens.actionButton.inactive,
            'min-w-0 gap-1 px-1.5',
          )}
          data-tooltip={t('editor.ai.workspace.refineEdit')}
          onClick={() => {
            onSelect(container.id);
          }}
          type="button"
        >
          <Wand2 aria-hidden="true" size={13} />
          <span className="truncate">{t('editor.ai.workspace.refine')}</span>
        </button>
      </div>
    </section>
  );
}

interface DraggableGridItemProps {
  isGenerating: boolean;
  maskType: MaskType;
  onClick: () => void;
}

function DraggableGridItem({ maskType, isGenerating, onClick }: DraggableGridItemProps) {
  const { t } = useTranslation();
  const isDisabled = maskType.disabled || isGenerating || maskType.personPart !== undefined;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `create-ai-${maskType.id ?? maskType.type}`,
    data: { type: 'Creation', maskType: maskType.type },
    disabled: isDisabled,
  });
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isDisabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onClick();
  };

  return (
    <motion.div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-disabled={isDisabled}
      aria-label={t('editor.ai.createNewTooltip', { name: maskType.name })}
      onClick={() => {
        if (!isDisabled) onClick();
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      className={cx(
        'flex min-h-10 items-center gap-2 rounded border border-editor-border bg-editor-panel px-2 py-1.5 text-left transition-colors',
        isDisabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-editor-panel-raised active:bg-editor-selected-quiet',
        isDragging && 'opacity-50',
      )}
      data-tooltip={
        maskType.disabled ? t('editor.ai.comingSoon') : t('editor.ai.createNewTooltip', { name: maskType.name })
      }
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <maskType.icon aria-hidden="true" className="shrink-0 text-text-secondary" size={16} />
      <UiText
        as="span"
        className="truncate text-[11px] leading-4"
        color={TextColors.primary}
        variant={TextVariants.small}
      >
        {maskType.name}
      </UiText>
    </motion.div>
  );
}

interface ContainerRowProps {
  activeDragItem: DragData | null;
  activeSubMaskId: string | null;
  analyzingSubMaskId: string | null;
  container: AiPatch;
  copiedPatch: AiPatch | null;
  copiedSubMask: SubMask | null;
  copyPatchToClipboard: (container: AiPatch) => void;
  copySubMaskToClipboard: (subMask: SubMask) => void;
  handleDelete: (id: string) => void;
  handleDeleteSubMask: (containerId: string, subMaskId: string) => void;
  handleDuplicate: (container: AiPatch) => void;
  handleDuplicateAndInvert: (container: AiPatch) => void;
  handleDuplicateAndInvertSubMask: (containerId: string, subMask: SubMask) => void;
  handleDuplicateSubMask: (containerId: string, subMask: SubMask, insertIndex?: number) => void;
  handlePastePatch: (insertAfterContainerId?: string) => void;
  handlePasteSubMask: (containerId: string, insertIndex?: number) => void;
  hasActiveChild: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  onAddComponent: (event: React.MouseEvent) => void;
  onMove: (direction: 'down' | 'up') => void;
  onMoveSubMask: (subMaskId: string, direction: 'down' | 'up') => void;
  onSelect: () => void;
  onSelectAiEdit: (subMaskId: string | null) => void;
  onToggle: () => void;
  position: number;
  renamingId: string | null;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setTempName: Dispatch<SetStateAction<string>>;
  tempName: string;
  totalCount: number;
  updateContainer: UpdatePatch;
  updateSubMask: UpdateSubMask;
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
  handlePastePatch,
  copyPatchToClipboard,
  copiedPatch,
  activeDragItem,
  activeSubMaskId,
  onSelectAiEdit,
  updateSubMask,
  handleDeleteSubMask,
  handleDuplicateSubMask,
  handleDuplicateAndInvertSubMask,
  handlePasteSubMask,
  copySubMaskToClipboard,
  copiedSubMask,
  analyzingSubMaskId,
  onAddComponent,
  onMove,
  onMoveSubMask,
  position,
  totalCount,
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
      updateContainer(container.id, { name: tempName.trim() });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.ai.actions.rename'),
        icon: FileEdit,
        onClick: () => {
          setRenamingId(container.id);
          setTempName(container.name);
        },
      },
      {
        label: t('editor.ai.actions.duplicateEdit'),
        icon: PlusSquare,
        onClick: () => {
          handleDuplicate(container);
        },
      },
      {
        label: t('editor.ai.actions.duplicateAndInvertEdit'),
        icon: RotateCcw,
        onClick: () => {
          handleDuplicateAndInvert(container);
        },
      },
      {
        label: t('editor.ai.actions.copyEdit'),
        icon: Copy,
        onClick: () => {
          copyPatchToClipboard(container);
        },
      },
      {
        label: t('editor.ai.actions.pasteEdit'),
        icon: ClipboardPaste,
        disabled: !copiedPatch,
        onClick: () => {
          handlePastePatch(container.id);
        },
      },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.ai.actions.resetSelection'),
        icon: RotateCcw,
        onClick: () => {
          updateContainer(container.id, { subMasks: [] });
        },
      },
      {
        label: t('editor.ai.actions.deleteEdit'),
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
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      onMove(event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
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
        aria-label={t('editor.ai.workspace.editPosition', {
          name: container.name,
          position: position + 1,
          total: totalCount,
        })}
        aria-pressed={isSelected || hasActiveChild}
        className={cx(
          'group flex min-h-8 items-center gap-1.5 rounded border px-1.5 py-1 transition-colors',
          isSelected || hasActiveChild
            ? 'border-editor-primary-active bg-editor-selected-quiet'
            : 'border-editor-border bg-editor-panel hover:bg-editor-panel-raised',
          borderClass,
        )}
        data-inpaint-edit-state={container.isLoading ? 'generating' : container.patchData ? 'generated' : 'ready'}
        data-testid={`inpaint-edit-${container.id}`}
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
          aria-label={isExpanded ? t('editor.ai.workspace.collapseEdit') : t('editor.ai.workspace.expandEdit')}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cx(
            professionalInspectorDensityTokens.actionButton.quiet,
            TEXT_COLOR_KEYS[hasActiveChild || isExpanded ? TextColors.primary : TextColors.secondary],
          )}
        >
          {isExpanded ? <FolderOpen size={15} /> : <Wand2 size={15} />}
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
            <UiText
              className="truncate select-none text-[11px] leading-4"
              color={TextColors.primary}
              weight={TextWeights.medium}
            >
              {container.name}
            </UiText>
          )}
        </div>
        {container.isLoading ? (
          <Loader2
            aria-label={t('editor.ai.workspace.generating')}
            className="shrink-0 animate-spin text-editor-info"
            size={14}
          />
        ) : null}
        {!container.isLoading && container.patchData ? (
          <CheckCircle2
            aria-label={t('editor.ai.workspace.previewApplied')}
            className="shrink-0 text-editor-success"
            size={14}
          />
        ) : null}
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            aria-label={t('editor.ai.workspace.moveEditUp')}
            className={professionalInspectorDensityTokens.actionButton.quiet}
            data-tooltip={t('editor.ai.workspace.moveEditUp')}
            disabled={position === 0}
            onClick={(event) => {
              event.stopPropagation();
              onMove('up');
            }}
            type="button"
          >
            <ArrowUp size={14} />
          </button>
          <button
            aria-label={t('editor.ai.workspace.moveEditDown')}
            className={professionalInspectorDensityTokens.actionButton.quiet}
            data-tooltip={t('editor.ai.workspace.moveEditDown')}
            disabled={position === totalCount - 1}
            onClick={(event) => {
              event.stopPropagation();
              onMove('down');
            }}
            type="button"
          >
            <ArrowDown size={14} />
          </button>
          <button
            aria-label={container.visible ? t('editor.ai.actions.hideEdit') : t('editor.ai.actions.showEdit')}
            className={professionalInspectorDensityTokens.actionButton.quiet}
            data-tooltip={container.visible ? t('editor.ai.actions.hideEdit') : t('editor.ai.actions.showEdit')}
            onClick={(e) => {
              e.stopPropagation();
              updateContainer(container.id, { visible: !container.visible });
            }}
            type="button"
          >
            {container.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            aria-label={t('editor.ai.actions.deleteEdit')}
            className={cx(professionalInspectorDensityTokens.actionButton.quiet, 'hover:text-editor-danger')}
            data-tooltip={t('editor.ai.actions.deleteEdit')}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(container.id);
            }}
            type="button"
          >
            <Trash2 size={14} />
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
                  isActive={activeSubMaskId === subMask.id}
                  parentVisible={container.visible}
                  activeDragItem={activeDragItem}
                  onSelect={() => {
                    onSelectAiEdit(subMask.id);
                  }}
                  onMove={(direction) => {
                    onMoveSubMask(subMask.id, direction);
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
                  isParentLoading={container.isLoading}
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
                    <span className="select-none">{t('editor.ai.actions.addNewComponent')}</span>
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
  isParentLoading: boolean;
  onMove: (direction: 'down' | 'up') => void;
  onSelect: () => void;
  parentVisible: boolean;
  renamingId: string | null;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setTempName: Dispatch<SetStateAction<string>>;
  subMask: SubMask;
  tempName: string;
  totalCount: number;
  updateSubMask: UpdateSubMask;
}

function SubMaskRow({
  subMask,
  index,
  totalCount,
  containerId,
  isActive,
  parentVisible,
  onMove,
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
  isParentLoading,
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
  const isDraggingContainer = isMaskLikeContainerDrag(activeDragItem);
  const dropClass = getMaskLikeSubMaskDropClass(activeDragItem, isOver);
  const isAnalyzing = subMask.id === analyzingSubMaskId || (isParentLoading && subMask.type === Mask.QuickEraser);

  useManagedFocus(renameInputRef, renamingId === subMask.id);

  const handleRenameSubmit = () => {
    if (tempName.trim()) {
      const newName = tempName.trim();
      updateSubMask(subMask.id, { name: newName });
    }
    setRenamingId(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t('editor.ai.actions.rename'),
        icon: FileEdit,
        onClick: () => {
          setRenamingId(subMask.id);
          setTempName(getSubMaskName(subMask));
        },
      },
      { label: t('editor.ai.actions.duplicateComponent'), icon: PlusSquare, onClick: handleDuplicate },
      { label: t('editor.ai.actions.duplicateAndInvertComponent'), icon: RotateCcw, onClick: handleDuplicateAndInvert },
      { label: t('editor.ai.actions.copyComponent'), icon: Copy, onClick: handleCopy },
      {
        label: t('editor.ai.actions.pasteComponent'),
        icon: ClipboardPaste,
        disabled: !hasCopiedSubMask,
        onClick: handlePaste,
      },
      { type: OPTION_SEPARATOR },
      { label: t('editor.ai.actions.deleteComponent'), icon: Trash2, isDestructive: true, onClick: handleDelete },
    ]);
  };
  const showNumber = isHovered && totalCount > 1;
  const handleSubMaskKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      onMove(event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -15 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -15, scale: 0.95, transition: { duration: 0.2 } }}
      ref={setCombinedRef}
      {...attributes}
      {...listeners}
      aria-label={t('editor.ai.workspace.targetPosition', {
        name: getSubMaskName(subMask),
        position: index,
        total: totalCount,
      })}
      aria-pressed={isActive}
      data-testid={`inpaint-target-${subMask.id}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cx(
        'group flex min-h-7 items-center gap-1.5 rounded px-1.5 py-1 transition-colors',
        isActive ? 'bg-editor-selected-quiet text-editor-selected-quiet-text' : 'hover:bg-editor-panel-raised',
        dropClass,
        isDragging && 'z-50 opacity-40',
        !parentVisible && 'opacity-50',
        isDraggingContainer && 'pointer-events-none opacity-30',
      )}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={handleSubMaskKeyDown}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
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
        <UiText className="flex-1 truncate select-none text-[11px] leading-4" color={TextColors.primary}>
          {getSubMaskName(subMask)}
        </UiText>
      )}
      <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          aria-label={t('editor.ai.workspace.moveTargetUp')}
          className={professionalInspectorDensityTokens.actionButton.quiet}
          data-tooltip={t('editor.ai.workspace.moveTargetUp')}
          disabled={index === 1}
          onClick={(event) => {
            event.stopPropagation();
            onMove('up');
          }}
          type="button"
        >
          <ArrowUp size={13} />
        </button>
        <button
          aria-label={t('editor.ai.workspace.moveTargetDown')}
          className={professionalInspectorDensityTokens.actionButton.quiet}
          data-tooltip={t('editor.ai.workspace.moveTargetDown')}
          disabled={index === totalCount}
          onClick={(event) => {
            event.stopPropagation();
            onMove('down');
          }}
          type="button"
        >
          <ArrowDown size={13} />
        </button>
        {index > 1 && (
          <button
            aria-label={
              subMask.mode === SubMaskMode.Additive
                ? t('editor.ai.actions.switchToSubtract')
                : subMask.mode === SubMaskMode.Subtractive
                  ? t('editor.ai.actions.switchToIntersect')
                  : t('editor.ai.actions.switchToAdd')
            }
            className={professionalInspectorDensityTokens.actionButton.quiet}
            data-tooltip={
              subMask.mode === SubMaskMode.Additive
                ? t('editor.ai.actions.switchToSubtract')
                : subMask.mode === SubMaskMode.Subtractive
                  ? t('editor.ai.actions.switchToIntersect')
                  : t('editor.ai.actions.switchToAdd')
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
            type="button"
          >
            {subMask.mode === SubMaskMode.Additive ? (
              <Plus size={13} />
            ) : subMask.mode === SubMaskMode.Subtractive ? (
              <Minus size={13} />
            ) : (
              <SquaresIntersect size={13} />
            )}
          </button>
        )}
        <button
          aria-label={t('editor.ai.actions.deleteComponent')}
          className={cx(professionalInspectorDensityTokens.actionButton.quiet, 'hover:text-editor-danger')}
          data-tooltip={t('editor.ai.actions.deleteComponent')}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          type="button"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </motion.div>
  );
}

interface AiSettingsPanelProps {
  activeSubMask?: SubMask | undefined;
  aiModelDownloadStatus: string | null;
  brushSettings: BrushSettings | null;
  collapsibleState: AiPanelCollapsibleState;
  container: AiPatch | null | undefined;
  isGeneratingAi: boolean;
  isGeneratingAiMask: boolean;
  isGenerativeAvailable: boolean;
  aiProvider: AiProviderIdType;
  onGenerativeReplace: (containerId: string, prompt: string, useFastInpaint: boolean) => void | Promise<void>;
  setBrushSettings: (updater: BrushSettingsUpdater) => void;
  setCollapsibleState: Dispatch<SetStateAction<AiPanelCollapsibleState>>;
  updateContainer: UpdatePatch;
  updateSubMask: UpdateSubMask;
}

function SettingsPanel({
  container,
  activeSubMask,
  aiModelDownloadStatus,
  brushSettings,
  setBrushSettings,
  updateContainer,
  updateSubMask,
  isGeneratingAi,
  isGeneratingAiMask: _isGeneratingAiMask,
  onGenerativeReplace,
  collapsibleState,
  setCollapsibleState,
  isGenerativeAvailable,
  aiProvider,
}: AiSettingsPanelProps) {
  const { t } = useTranslation();
  const setUI = useUIStore((state) => state.setUI);
  const isActive = !!container;
  const isComponentMode = !!activeSubMask;
  const displayContainer = container || PLACEHOLDER_PATCH;
  const [prompt, setPrompt] = useState(displayContainer.prompt || '');
  const [useFastInpaint, setUseFastInpaint] = useState(!isGenerativeAvailable);
  const prevContainerId = useRef<string | null>(null);

  useEffect(() => {
    if (!container) return;

    const syncTimer = setTimeout(() => {
      setPrompt(container.prompt || '');
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [container]);

  const isQuickErasePatch = displayContainer.subMasks.some((sm: SubMask) => sm.type === Mask.QuickEraser);

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      if (!container) return;

      if (!isGenerativeAvailable) {
        setUseFastInpaint(true);
      } else if (container.id !== prevContainerId.current) {
        setUseFastInpaint(isQuickErasePatch);
        prevContainerId.current = container.id;
      }
    }, 0);

    if (!container) {
      prevContainerId.current = null;
    }

    return () => {
      clearTimeout(syncTimer);
    };
  }, [isGenerativeAvailable, container, isQuickErasePatch]);

  const subMaskConfig = activeSubMask ? SUB_MASK_CONFIG[activeSubMask.type] || {} : {};
  const isAiMask =
    activeSubMask &&
    (activeSubMask.type === Mask.AiSubject ||
      activeSubMask.type === Mask.AiForeground ||
      activeSubMask.type === Mask.AiPerson ||
      activeSubMask.type === Mask.AiSky);

  const handleGenerateClick = () => {
    if (!container || isGeneratingAi || container.isLoading || container.subMasks.length === 0) return;
    const runGenerativeEdit = () => {
      updateContainer(container.id, { prompt });
      void onGenerativeReplace(container.id, prompt, useFastInpaint);
    };
    const approvalPolicy = resolveAiEditApprovalPolicy({ aiProvider, useFastInpaint });

    if (!approvalPolicy.requiresApproval) {
      runGenerativeEdit();
      return;
    }

    setUI({
      confirmModalState: {
        confirmText: t('editor.ai.approval.confirm'),
        isOpen: true,
        message:
          approvalPolicy.approvalReason === 'cloud_ai'
            ? t('editor.ai.approval.cloudMessage')
            : t('editor.ai.approval.connectorMessage'),
        onConfirm: runGenerativeEdit,
        title: t('editor.ai.approval.title'),
      },
    });
  };

  const handleToggleSection = (section: keyof AiPanelCollapsibleState) => {
    setCollapsibleState((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div
      className={`space-y-1 transition-opacity duration-300 ${!isActive ? 'pointer-events-none opacity-50' : ''}`}
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <CollapsibleSection
        title={t('editor.ai.settings.generativeReplaceTitle')}
        isOpen={collapsibleState.generative}
        onToggle={() => {
          handleToggleSection('generative');
        }}
        canToggleVisibility={false}
        isContentVisible={true}
      >
        <div className="space-y-2 pt-1">
          {aiModelDownloadStatus?.includes('Inpainting') && (
            <div
              aria-live="polite"
              className="flex items-center gap-2 rounded border border-editor-info/35 bg-editor-info-surface px-2 py-1.5 text-editor-info"
              role="status"
            >
              <Loader2 aria-hidden="true" className="shrink-0 animate-spin" size={14} />
              <UiText className="text-[11px] leading-4" variant={TextVariants.small}>
                {t('editor.ai.workspace.modelPreparing')}
              </UiText>
            </div>
          )}

          {activeSubMask?.type === Mask.AiPerson && (
            <Suspense fallback={<AiPanelLazyFallback />}>
              <AiPeoplePartPickerStatus />
            </Suspense>
          )}

          <UiText className="block text-[11px] leading-4 text-text-secondary" variant={TextVariants.small}>
            {isQuickErasePatch
              ? t('editor.ai.settings.quickEraseDesc')
              : useFastInpaint
                ? t('editor.ai.settings.fastInpaintDesc')
                : t('editor.ai.settings.generativeDesc')}
          </UiText>

          <div>
            <Switch
              chrome="editor"
              checked={useFastInpaint}
              disabled={!isGenerativeAvailable}
              label={t('editor.ai.settings.useBasicInpaint')}
              onChange={setUseFastInpaint}
              tooltip={
                !isGenerativeAvailable
                  ? t('editor.ai.settings.basicInpaintTooltipDisabled')
                  : t('editor.ai.settings.basicInpaintTooltipEnabled')
              }
            />

            <AnimatePresence>
              {!useFastInpaint && (
                <motion.div
                  animate={{ opacity: 1, height: 'auto', marginTop: '0.5rem' }}
                  className="overflow-hidden"
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      chrome="editor"
                      className="grow"
                      density="compact"
                      disabled={isGeneratingAi || displayContainer.isLoading}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        setPrompt(event.target.value);
                      }}
                      onBlur={() => {
                        if (isActive) {
                          updateContainer(container.id, { prompt });
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleGenerateClick();
                      }}
                      placeholder={t('editor.ai.settings.placeholder')}
                      type="text"
                      value={prompt}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Button
            aria-busy={isGeneratingAi || displayContainer.isLoading}
            className="w-full"
            disabled={isGeneratingAi || displayContainer.isLoading || displayContainer.subMasks.length === 0}
            data-tooltip={displayContainer.subMasks.length === 0 ? t('editor.ai.workspace.targetNeeded') : undefined}
            onClick={handleGenerateClick}
            variant="editorPrimary"
          >
            {isGeneratingAi || displayContainer.isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            <span>
              {isGeneratingAi || displayContainer.isLoading
                ? t('editor.ai.settings.generating')
                : useFastInpaint
                  ? t('editor.ai.settings.inpaintSelectionButton')
                  : t('editor.ai.settings.generateWithAiButton')}
            </span>
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={
          isComponentMode
            ? t('editor.ai.settings.componentPropertiesTitle', { name: getSubMaskName(activeSubMask) })
            : t('editor.ai.settings.selectionPropertiesTitle')
        }
        isOpen={collapsibleState.properties}
        onToggle={() => {
          handleToggleSection('properties');
        }}
        canToggleVisibility={false}
        isContentVisible={true}
      >
        <div className="space-y-2 pt-1">
          <Switch
            chrome="editor"
            checked={isComponentMode ? activeSubMask.invert : displayContainer.invert}
            label={isComponentMode ? t('editor.ai.settings.invertComponent') : t('editor.ai.settings.invertSelection')}
            onChange={(v) => {
              if (isComponentMode) {
                updateSubMask(activeSubMask.id, { invert: v });
              } else if (container) {
                updateContainer(container.id, { invert: v });
              }
            }}
          />

          {isComponentMode && (
            <>
              {isAiMask && aiModelDownloadStatus && (
                <div
                  aria-live="polite"
                  className="flex items-center gap-2 rounded border border-editor-info/35 bg-editor-info-surface px-2 py-1.5 text-editor-info"
                  role="status"
                >
                  <Loader2 aria-hidden="true" className="shrink-0 animate-spin" size={14} />
                  <UiText className="text-[11px] leading-4" variant={TextVariants.small}>
                    {t('editor.ai.workspace.modelPreparing')}
                  </UiText>
                </div>
              )}

              {subMaskConfig.parameters?.map((param) => (
                <Slider
                  key={param.key}
                  label={t('editor.ai.params.' + param.key, { defaultValue: parameterLabelFallback(param.key) })}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  defaultValue={param.defaultValue}
                  value={getMaskParameterNumber(activeSubMask.parameters, param.key) * (param.multiplier || 1)}
                  onChange={(event: NumericChangeEvent) => {
                    updateSubMask(activeSubMask.id, {
                      parameters: mergeMaskParameters(activeSubMask.parameters, {
                        [param.key]: getNumericEventValue(event) / (param.multiplier || 1),
                      }),
                    });
                  }}
                  {...(param.key !== 'grow' && { fillOrigin: 'min' })}
                />
              ))}

              {subMaskConfig.showBrushTools && brushSettings && (
                <BrushTools settings={brushSettings} onSettingsChange={setBrushSettings} />
              )}
            </>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
