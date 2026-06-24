import { useUser, useAuth } from '@clerk/react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  pointerWithin,
} from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Circle,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FileEdit,
  Loader2,
  Minus,
  Plus,
  PlusSquare,
  RotateCcw,
  Trash2,
  Wand2,
  Send,
  FolderOpen,
  SquaresIntersect,
} from 'lucide-react';
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { useTranslation } from 'react-i18next';

import AgentChatShell from './AgentChatShell';
import {
  getMaskLikeContainerDropClass,
  getMaskLikeSubMaskDropClass,
  isMaskLikeContainerDrag,
  type MaskLikeDragData,
  useDelayedHover,
} from './maskPanelRowHelpers';
import {
  Mask,
  type MaskType,
  type SubMask,
  SubMaskMode,
  ToolType,
  MASK_ICON_MAP,
  AI_PANEL_CREATION_TYPES,
  AI_SUB_MASK_COMPONENT_TYPES,
  formatMaskTypeName,
  getSubMaskName,
} from './Masks';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { useAiMasking } from '../../../hooks/useAiMasking';
import { useEditorActions } from '../../../hooks/useEditorActions';
import { useManagedFocus } from '../../../hooks/useManagedFocus';
import {
  AiProviderId,
  normalizeAiProviderId,
  resolveAiEditApprovalPolicy,
  resolveAiProviderRuntimeState,
  type AiProviderId as AiProviderIdType,
} from '../../../schemas/aiProviderSchemas';
import { cloudUsageSchema, type CloudUsage } from '../../../schemas/cloudUsageSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import { useProcessStore } from '../../../store/useProcessStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import { TEXT_COLOR_KEYS, TextColors, TextVariants, TextWeights } from '../../../types/typography';
import {
  cloneMaskLikeContainerForPaste,
  cloneSubMaskForPaste,
  createMaskLikeClipboardActions,
  insertMaskLikeContainerAt,
  insertSubMaskAt,
  moveSubMaskBetweenContainers,
  reorderMaskListContainers,
  splitSubMaskToContainer,
} from '../../../utils/maskClipboard';
import { getMaskParameterNumber, mergeMaskParameters, toMaskParameterRecord } from '../../../utils/maskParameterAccess';
import { createSubMask } from '../../../utils/maskUtils';
import { type BrushSettings, OPTION_SEPARATOR, type Option } from '../../ui/AppProperties';
import Button from '../../ui/Button';
import CollapsibleSection from '../../ui/CollapsibleSection';
import Input from '../../ui/Input';
import Slider from '../../ui/Slider';
import Switch from '../../ui/Switch';
import UiText from '../../ui/Text';

import type { AgentChatTranscript } from '../../../schemas/agentChatTranscriptSchemas';
import type { Adjustments, AiPatch } from '../../../utils/adjustments';

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
const getImageLabelFromPath = (path: string): string => {
  const cleanPath = path.split('?')[0] ?? path;
  return cleanPath.split(/[\\/]/u).pop() || cleanPath || 'selected RAW';
};

const buildLiveAgentTranscript = (selectedImagePath: string | undefined): AgentChatTranscript => {
  const targetLabel = selectedImagePath ? getImageLabelFromPath(selectedImagePath) : 'No image selected';
  const targetSummary = selectedImagePath
    ? `Ready to plan a local app-server edit for ${targetLabel}.`
    : 'Select an image before asking the agent to plan or apply edits.';

  return {
    id: selectedImagePath ? `live-agent-${targetLabel}` : 'live-agent-no-selection',
    messages: [
      {
        body: targetSummary,
        id: 'live-agent-current-context',
        role: 'system',
        timestamp: 'now',
      },
    ],
    runtimeStatus: 'ui_only_demo',
    sessionTitle: selectedImagePath ? `Current image: ${targetLabel}` : 'No image selected',
    toolCalls: [
      {
        approvalState: 'not_required',
        id: 'live-agent-current-context-readiness',
        mode: 'read',
        provenance: {
          requestHash: 'sha256:0000000000000000',
          runtime: 'codex_app_server',
          schema: 'liveAgentCurrentContext.v1',
        },
        status: selectedImagePath ? 'succeeded' : 'blocked',
        summary: targetSummary,
        timestamp: 'now',
        title: selectedImagePath ? 'Current image context' : 'Waiting for image selection',
        toolName: 'rawengine.live_context',
      },
    ],
  };
};

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
  const [isHovered, setIsHovered] = useState(false);

  let statusColor: string;
  let statusText: string;
  let titleText: string;
  let hoverContent: React.ReactNode;

  if (aiProvider === AiProviderId.Cloud) {
    titleText = t('editor.ai.connection.cloudLabel');
    if (isSignedIn && isPro) {
      statusColor = 'bg-green-500';
      statusText = t('editor.ai.connection.ready');

      const reqs = cloudUsage?.requests ?? 0;
      const limit = cloudUsage?.limit ?? 500;
      const percent = Math.min(100, (reqs / limit) * 100);

      hoverContent = (
        <div className="w-full mt-1">
          <div className="flex justify-between items-center mb-1.5">
            <UiText variant={TextVariants.small}>{t('editor.ai.connection.monthlyUsage')}</UiText>
            <UiText variant={TextVariants.small}>
              {t('settings.processing.ai.cloud.signedIn.usageStats', { requests: reqs, limit: limit })}
            </UiText>
          </div>
          <div className="w-full bg-bg-tertiary rounded-full h-1.5 border border-border-color">
            <div
              className="bg-accent h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      );
    } else if (isSignedIn && !isPro) {
      statusColor = 'bg-red-500';
      statusText = t('editor.ai.connection.upgradeRequired');
      hoverContent = <UiText variant={TextVariants.small}>{t('editor.ai.connection.proRequiredDesc')}</UiText>;
    } else {
      statusColor = 'bg-red-500';
      statusText = t('editor.ai.connection.notLoggedIn');
      hoverContent = <UiText variant={TextVariants.small}>{t('editor.ai.connection.loginRequiredDesc')}</UiText>;
    }
  } else if (aiProvider === AiProviderId.Connector) {
    titleText = t('editor.ai.connection.connectorLabel');
    if (isAIConnectorConnected) {
      statusColor = 'bg-green-500';
      statusText = t('editor.ai.connection.ready');
      hoverContent = <UiText variant={TextVariants.small}>{t('editor.ai.connection.connectorConnectedDesc')}</UiText>;
    } else {
      statusColor = 'bg-red-500';
      statusText = t('editor.ai.connection.notDetected');
      hoverContent = (
        <UiText variant={TextVariants.small}>{t('editor.ai.connection.connectorDisconnectedDesc')}</UiText>
      );
    }
  } else {
    titleText = t('editor.ai.connection.builtinLabel');
    statusColor = 'bg-green-500';
    statusText = t('editor.ai.connection.ready');
    hoverContent = <UiText variant={TextVariants.small}>{t('editor.ai.connection.builtinDesc')}</UiText>;
  }

  return (
    <div
      className="bg-surface rounded-lg"
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      <div className="flex items-center gap-2 px-4 pt-2">
        <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
        <UiText variant={TextVariants.label}>{titleText}</UiText>
        <UiText
          variant={TextVariants.label}
          weight={TextWeights.bold}
          className={statusColor === 'bg-green-500' ? 'text-green-500' : 'text-red-500'}
        >
          {statusText}
        </UiText>
      </div>
      <div className="px-4 pb-3">
        <motion.div
          animate={{ height: isHovered ? 'auto' : 0, opacity: isHovered ? 1 : 0, marginTop: isHovered ? '2px' : 0 }}
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0, marginTop: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          {hoverContent}
        </motion.div>
      </div>
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
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const setEditor = useEditorStore((s) => s.setEditor);

  const aiModelDownloadStatus = useProcessStore((s) => s.aiModelDownloadStatus);
  const setCustomEscapeHandler = useUIStore((s) => s.setCustomEscapeHandler);

  const { setAdjustments } = useEditorActions();
  const { handleGenerativeReplace, handleDeleteAiPatch, handleGenerateAiForegroundMask } = useAiMasking();
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
  const selectBrushToolForNewMask = useCallback(() => {
    setEditor((state) => ({
      brushSettings: {
        ...(state.brushSettings ?? { size: 50, feather: 50, tool: ToolType.Brush }),
        tool: ToolType.Brush,
      },
    }));
  }, [setEditor]);

  const onSelectPatchContainer = useCallback(
    (id: string | null) => {
      setEditor({ activeAiPatchContainerId: id });
    },
    [setEditor],
  );
  const onSelectSubMask = useCallback(
    (id: string | null) => {
      setEditor({ activeAiSubMaskId: id });
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
  const [isSettingsPanelEverOpened, setIsSettingsPanelEverOpened] = useState(false);
  const hasPerformedInitialSelection = useRef(false);
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

  const activeContainer = adjustments.aiPatches.find((p) => p.id === activePatchContainerId);
  const activeSubMaskData = activeContainer?.subMasks.find((sm) => sm.id === activeSubMaskId);
  const isAiMask =
    activeSubMaskData && [Mask.AiSubject, Mask.AiForeground, Mask.AiSky].includes(activeSubMaskData.type);

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
    if (activePatchContainerId) {
      const patchExists = adjustments.aiPatches.some((p) => p.id === activePatchContainerId);
      if (!patchExists) {
        onSelectPatchContainer(null);
        onSelectSubMask(null);
      }
    }
  }, [adjustments.aiPatches, activePatchContainerId, onSelectPatchContainer, onSelectSubMask]);

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      const hasPatches = adjustments.aiPatches.length > 0;

      if (hasPatches) {
        setIsSettingsPanelEverOpened(true);
      }

      if (activePatchContainerId) {
        const shouldAutoExpand = !hasPerformedInitialSelection.current || activeSubMaskId;
        if (shouldAutoExpand) {
          setExpandedContainers((prev) => {
            if (prev.has(activePatchContainerId)) return prev;
            return new Set(prev).add(activePatchContainerId);
          });
        }
        hasPerformedInitialSelection.current = true;
        setIsSettingsPanelEverOpened(true);
      }
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [activePatchContainerId, activeSubMaskId, adjustments.aiPatches, onSelectPatchContainer, onSelectSubMask]);

  useEffect(() => {
    const handler = () => {
      if (renamingId) {
        setRenamingId(null);
        setTempName('');
      } else if (activeSubMaskId) onSelectSubMask(null);
      else if (activePatchContainerId) onSelectPatchContainer(null);
    };
    if (activePatchContainerId || renamingId) setCustomEscapeHandler(() => handler);
    else setCustomEscapeHandler(null);
    return () => {
      setCustomEscapeHandler(null);
    };
  }, [
    activePatchContainerId,
    activeSubMaskId,
    renamingId,
    onSelectPatchContainer,
    onSelectSubMask,
    setCustomEscapeHandler,
  ]);

  const handleDeselect = () => {
    onSelectPatchContainer(null);
    onSelectSubMask(null);
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
    handleDeselect();
    setAdjustments((prev: Adjustments) => ({ ...prev, aiPatches: [] }));
  };

  const createMaskLogic = (type: Mask, mode: SubMaskMode = SubMaskMode.Additive) => {
    if (!selectedImage) return createSubMask(type, { width: 1000, height: 1000 }, mode);
    const subMask = createSubMask(type, selectedImage, mode);

    const steps = adjustments.orientationSteps;
    const isRotated = steps === 1 || steps === 3;
    const imgW = isRotated ? selectedImage.height || 1000 : selectedImage.width || 1000;
    const imgH = isRotated ? selectedImage.width || 1000 : selectedImage.height || 1000;
    const parameters = toMaskParameterRecord(subMask.parameters);

    const config = SUB_MASK_CONFIG[type];
    if (config && config.parameters) {
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
    subMask.parameters = parameters;
    return subMask;
  };

  const handleAddAiPatchContainer = (type: Mask) => {
    const subMask = createMaskLogic(type);

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

    setAdjustments((prev: Adjustments) => ({ ...prev, aiPatches: [...prev.aiPatches, newContainer] }));
    onSelectPatchContainer(newContainer.id);
    onSelectSubMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(newContainer.id));
    if (type === Mask.Brush) selectBrushToolForNewMask();

    if (type === Mask.AiForeground) void handleGenerateAiForegroundMask(subMask.id);
  };

  const handleAddSubMask = (
    containerId: string,
    type: Mask,
    mode: SubMaskMode = SubMaskMode.Additive,
    insertIndex: number = -1,
  ) => {
    const subMask = createMaskLogic(type, mode);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      aiPatches: prev.aiPatches.map((c: AiPatch) => {
        if (c.id === containerId) {
          const newSubMasks = [...c.subMasks];
          if (insertIndex >= 0) newSubMasks.splice(insertIndex, 0, subMask);
          else newSubMasks.push(subMask);
          return { ...c, subMasks: newSubMasks };
        }
        return c;
      }),
    }));
    onSelectPatchContainer(containerId);
    onSelectSubMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(containerId));
    if (type === Mask.Brush) selectBrushToolForNewMask();
    if (type === Mask.AiForeground) void handleGenerateAiForegroundMask(subMask.id);
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
              handleAddSubMask(targetContainerId, maskType.type, mode);
            } else {
              handleAddAiPatchContainer(maskType.type);
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
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      aiPatches: prev.aiPatches.map((p) => (p.id === id ? { ...p, ...data } : p)),
    }));
  };

  const updateSubMask = (id: string, data: Partial<SubMask>) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      aiPatches: prev.aiPatches.map((p) => ({
        ...p,
        subMasks: p.subMasks.map((sm) => (sm.id === id ? { ...sm, ...data } : sm)),
      })),
    }));
  };

  const handleDeleteContainer = (id: string) => {
    if (activePatchContainerId === id) handleDeselect();
    handleDeleteAiPatch(id);
  };

  const handleDeleteSubMask = (containerId: string, subMaskId: string) => {
    if (activeSubMaskId === subMaskId) onSelectSubMask(null);
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      aiPatches: prev.aiPatches.map((p) =>
        p.id === containerId ? { ...p, subMasks: p.subMasks.filter((sm) => sm.id !== subMaskId) } : p,
      ),
    }));
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
    setAdjustments((prev: Adjustments) => {
      return { ...prev, aiPatches: insertMaskLikeContainerAt(prev.aiPatches, container, insertIndex) };
    });

    onSelectPatchContainer(container.id);
    onSelectSubMask(null);
    setExpandedContainers((prev) => new Set(prev).add(container.id));
  };

  const insertSubMaskIntoContainer = (containerId: string, subMask: SubMask, insertIndex?: number) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      aiPatches: prev.aiPatches.map((container) => {
        if (container.id !== containerId) {
          return container;
        }

        return { ...container, subMasks: insertSubMaskAt(container.subMasks, subMask, insertIndex) };
      }),
    }));

    onSelectPatchContainer(containerId);
    onSelectSubMask(subMask.id);
    setExpandedContainers((prev) => new Set(prev).add(containerId));
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
        handleAddAiPatchContainer(maskType.type);
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

      setAdjustments((prev: Adjustments) => {
        const draggedItem = dragData.item;
        if (!draggedItem) return prev;

        let newIndex = -1;

        if (overId === 'ai-list-root') newIndex = prev.aiPatches.length - 1;
        else if (overData?.type === 'Container') newIndex = prev.aiPatches.findIndex((p) => p.id === overId);
        else if (overData?.type === 'SubMask') newIndex = prev.aiPatches.findIndex((p) => p.id === overData.parentId);

        const reorderedPatches = reorderMaskListContainers(
          prev.aiPatches,
          draggedItem.id,
          prev.aiPatches[newIndex]?.id ?? '',
        );
        return reorderedPatches ? { ...prev, aiPatches: reorderedPatches } : prev;
      });
      return;
    }

    if (dragData.type === 'SubMask') {
      const sourceContainerId = dragData.parentId;
      if (!sourceContainerId) return;

      if (over?.id === 'ai-list-root' || !over) {
        setAdjustments((prev: Adjustments) => {
          const draggedItem = dragData.item;
          if (!draggedItem) return prev;

          const result = splitSubMaskToContainer(
            prev.aiPatches,
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
          if (!result) return prev;

          const { container: newContainer, containers: newPatches, subMask: movedSubMask } = result;

          setTimeout(() => {
            onSelectPatchContainer(newContainer.id);
            onSelectSubMask(movedSubMask.id);
            setExpandedContainers((p) => new Set(p).add(newContainer.id));
          }, 0);
          return { ...prev, aiPatches: newPatches };
        });
        return;
      }

      let targetContainerId: string | null = null;
      if (overData?.type === 'Container') targetContainerId = overData.item?.id ?? null;
      else if (overData?.type === 'SubMask') targetContainerId = overData.parentId || null;

      if (targetContainerId) {
        const expandedTargetContainerId = targetContainerId;
        setAdjustments((prev: Adjustments) => {
          const draggedItem = dragData.item;
          if (!draggedItem) return prev;

          const newPatches = moveSubMaskBetweenContainers(
            prev.aiPatches,
            sourceContainerId,
            expandedTargetContainerId,
            draggedItem.id,
            overData?.type === 'SubMask' ? String(over.id) : undefined,
          );
          if (!newPatches) return prev;

          if (sourceContainerId !== targetContainerId) {
            setExpandedContainers((p) => new Set(p).add(expandedTargetContainerId));
          }
          return { ...prev, aiPatches: newPatches };
        });
      }
    }
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
          <UiText variant={TextVariants.title}>{t('editor.ai.inpaintingTitle')}</UiText>
          <button
            className="p-2 rounded-full hover:bg-surface transition-colors"
            onClick={handleResetAllAiEdits}
            data-tooltip={t('editor.ai.resetInpaintingTooltip')}
          >
            <RotateCcw size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0 p-4">
          <AnimatePresence mode="wait">
            {adjustments.aiPatches.length === 0 ? (
              <motion.div
                key="ai-grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="z-10 shrink-0"
                onClick={handleDeselect}
              >
                {!selectedImage ? (
                  <UiText
                    variant={TextVariants.heading}
                    color={TextColors.secondary}
                    weight={TextWeights.normal}
                    className="text-center mt-4"
                  >
                    {t('editor.ai.noImageSelected')}
                  </UiText>
                ) : (
                  <>
                    <ConnectionStatus
                      aiProvider={aiProvider}
                      isAIConnectorConnected={isAIConnectorConnected}
                      isSignedIn={isSignedIn ?? false}
                      isPro={isPro}
                      cloudUsage={cloudUsage}
                    />
                    <UiText variant={TextVariants.heading} className="mb-2 mt-8">
                      {t('editor.ai.createNewTitle')}
                    </UiText>
                    <div
                      className="grid grid-cols-3 gap-2"
                      role="presentation"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {AI_PANEL_CREATION_TYPES.map((maskType: MaskType) => (
                        <DraggableGridItem
                          key={maskType.type}
                          maskType={maskType}
                          isGenerating={isGeneratingAi}
                          onClick={() => {
                            handleAddAiPatchContainer(maskType.type);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="ai-list"
                ref={setRootDroppableRef}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex flex-col transition-colors ${isRootOver ? 'bg-surface' : ''}`}
                onClick={handleDeselect}
              >
                <UiText variant={TextVariants.heading} className="mb-2">
                  {t('editor.ai.editsTitle')}
                </UiText>

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
                  {adjustments.aiPatches.map((container) => (
                    <ContainerRow
                      key={container.id}
                      container={container}
                      isSelected={activePatchContainerId === container.id && activeSubMaskId === null}
                      hasActiveChild={activePatchContainerId === container.id && activeSubMaskId !== null}
                      isExpanded={expandedContainers.has(container.id)}
                      onToggle={() => {
                        handleToggleExpand(container.id);
                      }}
                      onSelect={() => {
                        onSelectPatchContainer(container.id);
                        onSelectSubMask(null);
                      }}
                      renamingId={renamingId}
                      setRenamingId={setRenamingId}
                      tempName={tempName}
                      setTempName={setTempName}
                      updateContainer={updatePatch}
                      handleDelete={handleDeleteContainer}
                      handleDuplicate={handleDuplicatePatchContainer}
                      handleDuplicateAndInvert={handleDuplicateAndInvertPatchContainer}
                      handlePastePatch={handlePastePatch}
                      copyPatchToClipboard={copyPatchToClipboard}
                      copiedPatch={copiedPatch}
                      activeDragItem={activeDragItem}
                      activeSubMaskId={activeSubMaskId}
                      onSelectContainer={onSelectPatchContainer}
                      onSelectSubMask={onSelectSubMask}
                      updateSubMask={updateSubMask}
                      handleDeleteSubMask={handleDeleteSubMask}
                      handleDuplicateSubMask={handleDuplicateSubMask}
                      handleDuplicateAndInvertSubMask={handleDuplicateAndInvertSubMask}
                      handlePasteSubMask={handlePasteSubMask}
                      copySubMaskToClipboard={copySubMaskToClipboard}
                      copiedSubMask={copiedSubMask}
                      analyzingSubMaskId={analyzingSubMaskId}
                      onAddComponent={(e: React.MouseEvent) => {
                        handleAddAiContextMenu(e, container.id);
                      }}
                    />
                  ))}
                </AnimatePresence>

                <AnimatePresence>
                  {activeDragItem?.type === 'Creation' && adjustments.aiPatches.length > 0 && (
                    <NewMaskDropZone isOver={isRootOver} />
                  )}
                </AnimatePresence>

                <UiText
                  as="div"
                  weight={TextWeights.medium}
                  className="flex items-center gap-2 p-2 rounded-md transition-colors transition-opacity opacity-70 hover:opacity-100 hover:bg-card-active cursor-pointer hover:text-text-primary"
                  onClick={(e: ReactMouseEvent<HTMLElement>) => {
                    handleAddAiContextMenu(e, null);
                  }}
                  onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    handleAddAiContextMenu(e, null);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="p-0.5">
                    <Plus size={18} />
                  </div>
                  <span>{t('editor.ai.addNewEdit')}</span>
                </UiText>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-4 shrink-0 w-full" role="presentation" onClick={handleDeselect} />

          <AnimatePresence>
            {isSettingsPanelEverOpened && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex-1 min-h-0"
              >
                <UiText variant={TextVariants.heading} className="mb-2">
                  {t('editor.ai.editSettingsTitle')}
                </UiText>
                <SettingsPanel
                  container={activeContainer || null}
                  activeSubMask={activeSubMaskData}
                  aiModelDownloadStatus={aiModelDownloadStatus}
                  brushSettings={brushSettings}
                  setBrushSettings={setBrushSettings}
                  updateContainer={updatePatch}
                  updateSubMask={updateSubMask}
                  isGeneratingAi={isGeneratingAi}
                  isGeneratingAiMask={isGeneratingAiMask}
                  aiProvider={aiProviderRuntimeState.effectiveProvider}
                  onGenerativeReplace={handleGenerativeReplace}
                  collapsibleState={collapsibleState}
                  setCollapsibleState={setCollapsibleState}
                  isGenerativeAvailable={isGenerativeAvailable}
                  selectedImagePath={selectedImage?.path}
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
      className={`p-4 rounded-lg text-center ${isOver ? 'border border-accent/80 bg-bg-tertiary/50' : ''}`}
    >
      <UiText weight={TextWeights.medium}>{t('editor.ai.dropzoneText')}</UiText>
    </motion.div>
  );
}

interface DraggableGridItemProps {
  isGenerating: boolean;
  maskType: MaskType;
  onClick: () => void;
}

function DraggableGridItem({ maskType, isGenerating, onClick }: DraggableGridItemProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `create-ai-${maskType.type}`,
    data: { type: 'Creation', maskType: maskType.type },
    disabled: isGenerating,
  });
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick();
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
      className={`bg-surface text-text-primary rounded-lg p-2 flex flex-col items-center justify-center gap-2 aspect-square transition-colors
            ${
              maskType.disabled || isGenerating
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-card-active active:bg-accent/20'
            }
            ${isDragging ? 'opacity-50' : ''}`}
      data-tooltip={
        maskType.disabled ? t('editor.ai.comingSoon') : t('editor.ai.createNewTooltip', { name: maskType.name })
      }
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <maskType.icon size={24} />{' '}
      <UiText as="span" variant={TextVariants.small} color={TextColors.primary}>
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
  onSelect: () => void;
  onSelectContainer: (id: string | null) => void;
  onSelectSubMask: (id: string | null) => void;
  onToggle: () => void;
  renamingId: string | null;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setTempName: Dispatch<SetStateAction<string>>;
  tempName: string;
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
  onSelectContainer,
  onSelectSubMask,
  updateSubMask,
  handleDeleteSubMask,
  handleDuplicateSubMask,
  handleDuplicateAndInvertSubMask,
  handlePasteSubMask,
  copySubMaskToClipboard,
  copiedSubMask,
  analyzingSubMaskId,
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
          {isExpanded ? <FolderOpen size={18} /> : <Wand2 size={18} />}
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
            data-tooltip={container.visible ? t('editor.ai.actions.hideEdit') : t('editor.ai.actions.showEdit')}
            onClick={(e) => {
              e.stopPropagation();
              updateContainer(container.id, { visible: !container.visible });
            }}
          >
            {container.visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button
            className="p-1 hover:text-red-500 text-text-secondary"
            data-tooltip={t('editor.ai.actions.deleteEdit')}
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
                  isActive={activeSubMaskId === subMask.id}
                  parentVisible={container.visible}
                  activeDragItem={activeDragItem}
                  onSelect={() => {
                    onSelectContainer(container.id);
                    onSelectSubMask(subMask.id);
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
  selectedImagePath?: string | undefined;
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
  selectedImagePath,
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
      activeSubMask.type === Mask.AiSky);

  const handleGenerateClick = () => {
    if (!container) return;
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
      className={`space-y-2 transition-opacity duration-300 ${!isActive ? 'opacity-50 pointer-events-none' : ''}`}
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <AgentChatShell transcript={buildLiveAgentTranscript(selectedImagePath)} />

      <CollapsibleSection
        title={t('editor.ai.settings.generativeReplaceTitle')}
        isOpen={collapsibleState.generative}
        onToggle={() => {
          handleToggleSection('generative');
        }}
        canToggleVisibility={false}
        isContentVisible={true}
      >
        <div className="space-y-4 pt-2">
          {aiModelDownloadStatus && aiModelDownloadStatus.includes('Inpainting') && (
            <UiText
              as="div"
              variant={TextVariants.small}
              color={TextColors.accent}
              weight={TextWeights.medium}
              className="p-3 bg-card-active rounded-md border border-surface flex items-center gap-3"
            >
              <Loader2 size={16} className="animate-spin shrink-0" />
              <div className="leading-relaxed">
                <UiText variant={TextVariants.small}>{t('editor.ai.settings.downloading')}</UiText>
                <span>{aiModelDownloadStatus}</span>
              </div>
            </UiText>
          )}

          <UiText variant={TextVariants.small}>
            {isQuickErasePatch
              ? t('editor.ai.settings.quickEraseDesc')
              : useFastInpaint
                ? t('editor.ai.settings.fastInpaintDesc')
                : t('editor.ai.settings.generativeDesc')}
          </UiText>

          <div>
            <Switch
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
                  animate={{ opacity: 1, height: 'auto', marginTop: '0.75rem' }}
                  className="overflow-hidden"
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      className="grow"
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
            className="w-full"
            disabled={isGeneratingAi || displayContainer.isLoading || displayContainer.subMasks.length === 0}
            onClick={handleGenerateClick}
          >
            {isGeneratingAi || displayContainer.isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            <span className="ml-2">
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
        <div className="space-y-4 pt-2">
          <Switch
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
                <UiText
                  as="div"
                  variant={TextVariants.small}
                  color={TextColors.accent}
                  weight={TextWeights.medium}
                  className="p-3 bg-card-active rounded-md border border-surface flex items-center gap-3"
                >
                  <Loader2 size={16} className="animate-spin shrink-0" />
                  <div className="leading-relaxed">
                    <UiText variant={TextVariants.small}>{t('editor.ai.settings.aiModelDownloading')}</UiText>
                    <span>{aiModelDownloadStatus}</span>
                  </div>
                </UiText>
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
