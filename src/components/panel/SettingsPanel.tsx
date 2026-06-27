import { Show, SignIn, useUser, useAuth, useClerk } from '@clerk/react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from '@tauri-apps/plugin-shell';
import cx from 'clsx';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  ArrowLeft,
  Cpu,
  ExternalLink as ExternalLinkIcon,
  Server,
  Info,
  Trash2,
  Wifi,
  WifiOff,
  Plus,
  X,
  SlidersHorizontal,
  Keyboard,
  Bookmark,
  Scaling,
  Image as ImageIcon,
  Mouse,
  Touchpad,
  type LucideIcon,
} from 'lucide-react';
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useOsPlatform } from '../../hooks/useOsPlatform';
import {
  AiProviderId,
  normalizeAiProviderId,
  type AiProviderId as AiProviderIdType,
} from '../../schemas/aiProviderSchemas';
import { cloudUsageSchema, type CloudUsage } from '../../schemas/cloudUsageSchemas';
import { normalizeKeyboardShortcutMap, parseKeyboardShortcutCombo } from '../../schemas/keyboardShortcutSchemas';
import { TextColors, TextVariants, TextWeights } from '../../types/typography';
import {
  buildCaptureSharpeningProcessingPatch,
  CAPTURE_SHARPENING_PRESETS,
  findMatchingCaptureSharpeningPreset,
} from '../../utils/captureSharpeningPresets';
import {
  formatKeyCode,
  type KeybindDefinition,
  KEYBIND_DEFINITIONS,
  KEYBIND_SECTIONS,
  normalizeCombo,
} from '../../utils/keyboardUtils';
import {
  buildRawProcessingModePatch,
  normalizeRawProcessingMode,
  RAW_PROCESSING_MODES,
  RAW_PROCESSING_MODE_RECIPES,
  type RawProcessingMode,
} from '../../utils/rawProcessingModes';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';
import { type ThemeProps, THEMES } from '../../utils/themes';
import ConfirmModal from '../modals/ConfirmModal';
import { type AppSettings, Invokes, type Theme } from '../ui/AppProperties';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import Input from '../ui/Input';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import UiText from '../ui/Text';

import type { TFunction } from 'i18next';

interface ConfirmModalState {
  confirmText: string;
  confirmVariant: string;
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  title: string;
}

interface DataActionItemProps {
  buttonAction: () => void;
  buttonText: string;
  description: ReactNode;
  disabled?: boolean;
  icon: ReactNode;
  isProcessing: boolean;
  message: string;
  title: string;
}

interface KeybindRowProps {
  def: KeybindDefinition;
  currentCombo?: string[] | undefined;
  osPlatform: string;
  onSave: (action: string, combo: string[]) => void;
  recordingAction: string | null;
  onStartRecording: (action: string) => void;
  isConflicting: boolean;
}

interface SettingItemProps {
  children: ReactNode;
  description?: string;
  label: string;
}

interface DropdownSettingProps<T extends string | number> {
  description: string;
  label: string;
  onChange: (value: T) => void;
  options: OptionItem<T>[];
  value: T;
}

interface SwitchSettingProps {
  checked: boolean;
  description: string;
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
  switchLabel: string;
}

interface SettingsPanelProps {
  appSettings: AppSettings;
  onBack: () => void;
  onLibraryRefresh: () => void;
  onSettingsChange: (settings: AppSettings) => Promise<void>;
  rootPaths: string[];
}

interface TestStatus {
  message: string;
  success: boolean | null;
  testing: boolean;
}

interface MyLens {
  maker: string;
  model: string;
}

interface ProcessingSettings {
  applyPreprocessingToNonRaws: boolean;
  editorPreviewResolution: number;
  highResZoomMultiplier: number;
  imageCacheSize: number;
  linuxGpuOptimization: boolean;
  processingBackend: string;
  rawProcessingMode: RawProcessingMode;
  rawHighlightCompression: number;
  rawPreprocessingColorNr: number;
  rawPreprocessingSharpening: number;
  rawPreprocessingSharpeningDetail: number;
  rawPreprocessingSharpeningEdgeMasking: number;
  rawPreprocessingSharpeningRadius: number;
  thumbnailResolution: number;
  thumbnailWorkerThreads: number;
  useFullDpiRendering: boolean;
  useWgpuRenderer: boolean;
}

type ProcessingSettingKey = keyof ProcessingSettings;
type NumericChangeEvent = ChangeEvent<HTMLInputElement> | { target: { value: number | string } };

const getNumericEventValue = (event: NumericChangeEvent): number => Number(event.target.value);
const getIntegerEventValue = (event: NumericChangeEvent): number => parseInt(String(event.target.value), 10);
const formatUnknownError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const shouldDefaultWgpuRenderer = (osPlatform: string): boolean => osPlatform !== 'linux' && osPlatform !== 'android';
const buildProcessingSettings = (appSettings: AppSettings, osPlatform: string): ProcessingSettings => ({
  applyPreprocessingToNonRaws: appSettings.applyPreprocessingToNonRaws ?? false,
  editorPreviewResolution: appSettings.editorPreviewResolution || 1920,
  highResZoomMultiplier: appSettings.highResZoomMultiplier || 1.0,
  imageCacheSize: appSettings.imageCacheSize ?? 5,
  linuxGpuOptimization: appSettings.linuxGpuOptimization ?? false,
  processingBackend: appSettings.processingBackend || 'auto',
  rawProcessingMode: normalizeRawProcessingMode(appSettings.rawProcessingMode),
  rawHighlightCompression: appSettings.rawHighlightCompression ?? 2.5,
  rawPreprocessingColorNr: appSettings.rawPreprocessingColorNr ?? 0.5,
  rawPreprocessingSharpening: appSettings.rawPreprocessingSharpening ?? 0.35,
  rawPreprocessingSharpeningDetail: appSettings.rawPreprocessingSharpeningDetail ?? 0.45,
  rawPreprocessingSharpeningEdgeMasking: appSettings.rawPreprocessingSharpeningEdgeMasking ?? 0.3,
  rawPreprocessingSharpeningRadius: appSettings.rawPreprocessingSharpeningRadius ?? 2,
  thumbnailResolution: appSettings.thumbnailResolution || 720,
  thumbnailWorkerThreads: appSettings.thumbnailWorkerThreads ?? 4,
  useFullDpiRendering: appSettings.useFullDpiRendering ?? false,
  useWgpuRenderer: appSettings.useWgpuRenderer ?? shouldDefaultWgpuRenderer(osPlatform),
});

const EXECUTE_TIMEOUT = 3000;
const stringArraySchema = z.array(z.string());
const pathSchema = z.string().min(1);
const countSchema = z.number().int().nonnegative();
const emptyResponseSchema = z.unknown();
const translateDynamicKey = (translate: TFunction, key: string): string => translate(key, { defaultValue: key });
const KEYBIND_ACTIONS = new Set(KEYBIND_DEFINITIONS.map((definition) => definition.action));
const CUSTOM_CAPTURE_SHARPENING_PRESET_ID = 'custom_capture_sharpening';

const adjustmentVisibilityDefaults = {
  sharpening: true,
  presence: true,
  noiseReduction: true,
  chromaticAberration: false,
  vignette: true,
  colorCalibration: false,
  grain: true,
};

const resolutions: OptionItem<number>[] = [
  { value: 720, label: '720px' },
  { value: 1280, label: '1280px' },
  { value: 1920, label: '1920px' },
  { value: 2560, label: '2560px' },
  { value: 3840, label: '3840px' },
];

const thumbnailResolutions: OptionItem<number>[] = [
  { value: 640, label: '640px' },
  { value: 720, label: '720px' },
  { value: 960, label: '960px' },
  { value: 1080, label: '1080px' },
];

const zoomMultiplierOptions: OptionItem<number>[] = [
  { value: 1.0, label: '1.0x (Native)' },
  { value: 0.75, label: '0.75x' },
  { value: 0.5, label: '0.50x (Half)' },
  { value: 0.25, label: '0.25x' },
];

const KeybindRow = ({
  def,
  currentCombo,
  osPlatform,
  onSave,
  recordingAction,
  onStartRecording,
  isConflicting,
}: KeybindRowProps) => {
  const { t } = useTranslation();
  const recording = recordingAction === def.action;

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSave(def.action, []);
        onStartRecording('');
        return;
      }
      e.preventDefault();
      const parts = normalizeCombo(e, osPlatform);
      const lastPart = parts[parts.length - 1];
      if (parts.length > 0 && lastPart !== undefined && !['ctrl', 'shift', 'alt'].includes(lastPart)) {
        onSave(def.action, parts);
        onStartRecording('');
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler, { capture: true });
    };
  }, [recording, def.action, onSave, onStartRecording, osPlatform]);

  const displayCombo = currentCombo !== undefined ? (currentCombo.length ? currentCombo : null) : def.defaultCombo;

  return (
    <div className="flex justify-between items-center py-2">
      <UiText variant={TextVariants.label}>{translateDynamicKey(t, def.description)}</UiText>
      <div className="flex items-center gap-1">
        {isConflicting && <span className="text-yellow-400 text-xs">⚠</span>}
        <button
          onClick={() => {
            onStartRecording(def.action);
          }}
          className="flex items-center gap-1 flex-wrap shrink-0"
        >
          {recording ? (
            <UiText
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.accent}
              weight={TextWeights.semibold}
              className="px-2 py-1 font-sans bg-bg-primary border border-accent rounded-md animate-pulse"
            >
              {t('settings.controls.pressKey')}
            </UiText>
          ) : (
            <UiText
              as="kbd"
              variant={TextVariants.small}
              color={TextColors.primary}
              weight={TextWeights.semibold}
              className={`px-2 py-1 font-sans bg-bg-primary border rounded-md cursor-pointer hover:border-accent transition-colors ${isConflicting ? 'border-yellow-400' : 'border-border-color'}`}
            >
              {displayCombo ? (
                displayCombo.map((k) => formatKeyCode(k, osPlatform)).join(' + ')
              ) : (
                <span className="text-text-secondary italic">{t('settings.controls.notAssigned')}</span>
              )}
            </UiText>
          )}
        </button>
      </div>
    </div>
  );
};

const SettingItem = ({ children, description, label }: SettingItemProps) => (
  <div>
    <UiText variant={TextVariants.heading} className="block mb-2">
      {label}
    </UiText>
    {children}
    {description && (
      <UiText variant={TextVariants.small} className="mt-2">
        {description}
      </UiText>
    )}
  </div>
);

const DropdownSetting = <T extends string | number>({
  description,
  label,
  onChange,
  options,
  value,
}: DropdownSettingProps<T>) => (
  <SettingItem description={description} label={label}>
    <Dropdown onChange={onChange} options={options} value={value} triggerClassName="bg-bg-primary" />
  </SettingItem>
);

const SwitchSetting = ({
  checked,
  description,
  disabled = false,
  id,
  label,
  onChange,
  switchLabel,
}: SwitchSettingProps) => (
  <SettingItem description={description} label={label}>
    <Switch checked={checked} disabled={disabled} id={id} label={switchLabel} onChange={onChange} />
  </SettingItem>
);

const DataActionItem = ({
  buttonAction,
  buttonText,
  description,
  disabled = false,
  icon,
  isProcessing,
  message,
  title,
}: DataActionItemProps) => {
  const { t } = useTranslation();

  return (
    <div className="pb-8 border-b border-border-color last:border-b-0 last:pb-0">
      <UiText variant={TextVariants.heading} className="mb-2">
        {title}
      </UiText>
      <UiText variant={TextVariants.small} className="mb-3">
        {description}
      </UiText>
      <Button variant="destructive" onClick={buttonAction} disabled={isProcessing || disabled}>
        {icon}
        {isProcessing ? t('settings.data.statuses.processing') : buttonText}
      </Button>
      {message && (
        <UiText color={TextColors.accent} className="mt-3">
          {message}
        </UiText>
      )}
    </div>
  );
};

interface AiProviderSwitchProps {
  selectedProvider: AiProviderIdType;
  onProviderChange: (provider: AiProviderIdType) => void;
}

const AiProviderSwitch = ({ selectedProvider, onProviderChange }: AiProviderSwitchProps) => {
  const { t } = useTranslation();

  const aiProviders = useMemo<Array<{ id: AiProviderIdType; label: string; icon: LucideIcon }>>(
    () => [
      { id: AiProviderId.Local, label: t('settings.processing.ai.providers.cpu'), icon: Cpu },
      { id: AiProviderId.Connector, label: t('settings.processing.ai.providers.aiConnector'), icon: Server },
      //{ id: 'cloud', label: t('settings.processing.ai.providers.cloud'), icon: Cloud },
    ],
    [t],
  );

  return (
    <div className="relative flex w-full p-1 bg-bg-primary rounded-md border border-border-color">
      {aiProviders.map((provider) => (
        <button
          key={provider.id}
          onClick={() => {
            onProviderChange(provider.id);
          }}
          className={cx(
            'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            {
              'text-text-primary hover:bg-surface': selectedProvider !== provider.id,
              'text-button-text': selectedProvider === provider.id,
            },
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {selectedProvider === provider.id && (
            <motion.span
              layoutId="ai-provider-switch-bubble"
              className="absolute inset-0 z-0 bg-accent"
              style={{ borderRadius: 6 }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            />
          )}
          <span className="relative z-10 flex items-center">
            <provider.icon size={16} className="mr-2" />
            {provider.label}
          </span>
        </button>
      ))}
    </div>
  );
};

const CloudDashboard = () => {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch('https://getrapidraw.com/api/usage', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const usageJson: unknown = await res.json();
          setUsage(cloudUsageSchema.parse(usageJson));
        }
      } catch (e) {
        console.error('Failed to fetch cloud usage', e);
      }
    };
    void fetchUsage();
  }, [getToken]);

  const isPro = user?.publicMetadata['plan'] === 'pro';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border-color pb-4">
        <div className="flex items-center gap-3">
          <div>
            <UiText variant={TextVariants.heading}>{user?.fullName || user?.primaryEmailAddress?.emailAddress}</UiText>
            <UiText variant={TextVariants.small} color={isPro ? TextColors.success : TextColors.error}>
              {isPro
                ? t('settings.processing.ai.cloud.signedIn.active')
                : t('settings.processing.ai.cloud.signedIn.inactive')}
            </UiText>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface border-none shadow-none"
            onClick={() => {
              void open('https://www.getrapidraw.com/dashboard');
            }}
          >
            {t('settings.processing.ai.cloud.signedIn.manage')} <ExternalLinkIcon size={14} className="ml-1" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void signOut();
            }}
          >
            {t('settings.processing.ai.cloud.signedIn.logout')}
          </Button>
        </div>
      </div>

      {isPro ? (
        <div className="bg-surface p-4 rounded-md">
          <div className="flex justify-between items-center mb-2">
            <UiText variant={TextVariants.label}>{t('settings.processing.ai.cloud.signedIn.usage')}</UiText>
            <UiText variant={TextVariants.small}>
              {t('settings.processing.ai.cloud.signedIn.usageStats', {
                requests: usage?.requests ?? 0,
                limit: usage?.limit ?? 500,
              })}
            </UiText>
          </div>
          <div className="w-full bg-bg-primary rounded-full h-2">
            <div
              className="bg-accent h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, ((usage?.requests ?? 0) / (usage?.limit ?? 500)) * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="bg-red-900/10 border border-red-500/50 p-4 rounded-md text-center">
          <UiText className="mb-3">{t('settings.processing.ai.cloud.signedOut.upgradeDesc')}</UiText>
          <Button
            onClick={() => {
              void open('https://www.getrapidraw.com/cloud');
            }}
          >
            {t('settings.processing.ai.cloud.signedOut.upgradeBtn')}
          </Button>
        </div>
      )}
    </div>
  );
};

interface CanvasInputModeSwitchProps {
  mode: 'mouse' | 'trackpad';
  onModeChange: (mode: 'mouse' | 'trackpad') => void;
}

const CanvasInputModeSwitch = ({ mode, onModeChange }: CanvasInputModeSwitchProps) => {
  const { t } = useTranslation();

  const canvasInputModes = useMemo<Array<{ id: 'mouse' | 'trackpad'; label: string; icon: LucideIcon }>>(
    () => [
      { id: 'mouse', label: t('settings.controls.modes.mouse'), icon: Mouse },
      { id: 'trackpad', label: t('settings.controls.modes.trackpad'), icon: Touchpad },
    ],
    [t],
  );

  return (
    <div className="relative flex w-full p-1 bg-bg-primary rounded-md border border-border-color">
      {canvasInputModes.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            onModeChange(item.id);
          }}
          className={cx(
            'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            {
              'text-text-primary hover:bg-surface': mode !== item.id,
              'text-button-text': mode === item.id,
            },
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {mode === item.id && (
            <motion.span
              layoutId="canvas-input-mode-switch-bubble"
              className="absolute inset-0 z-0 bg-accent"
              style={{ borderRadius: 6 }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            />
          )}
          <span className="relative z-10 flex items-center">
            <item.icon size={16} className="mr-2" />
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
};

interface PreviewModeSwitchProps {
  mode: 'static' | 'dynamic';
  onModeChange: (mode: 'static' | 'dynamic') => void;
}

const PreviewModeSwitch = ({ mode, onModeChange }: PreviewModeSwitchProps) => {
  const { t } = useTranslation();

  const previewModes = useMemo<Array<{ id: 'static' | 'dynamic'; label: string; icon: LucideIcon }>>(
    () => [
      { id: 'static', label: t('settings.processing.modes.static'), icon: ImageIcon },
      { id: 'dynamic', label: t('settings.processing.modes.dynamic'), icon: Scaling },
    ],
    [t],
  );

  return (
    <div className="relative flex w-full p-1 bg-bg-primary rounded-md border border-border-color">
      {previewModes.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            onModeChange(item.id);
          }}
          className={cx(
            'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            {
              'text-text-primary hover:bg-surface': mode !== item.id,
              'text-button-text': mode === item.id,
            },
          )}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {mode === item.id && (
            <motion.span
              layoutId="preview-mode-switch-bubble"
              className="absolute inset-0 z-0 bg-accent"
              style={{ borderRadius: 6 }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            />
          )}
          <span className="relative z-10 flex items-center">
            <item.icon size={16} className="mr-2" />
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
};

export function SettingsPanel({
  appSettings,
  onBack,
  onLibraryRefresh,
  onSettingsChange,
  rootPaths,
}: SettingsPanelProps) {
  const { user: _user } = useUser();
  const { t } = useTranslation();
  const [isClearing, setIsClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState('');
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheClearMessage, setCacheClearMessage] = useState('');
  const [isClearingAiTags, setIsClearingAiTags] = useState(false);
  const [aiTagsClearMessage, setAiTagsClearMessage] = useState('');
  const [isClearingTags, setIsClearingTags] = useState(false);
  const [tagsClearMessage, setTagsClearMessage] = useState('');
  const [confirmModalState, setConfirmModalState] = useState<ConfirmModalState>({
    confirmText: t('settings.data.modals.confirmClear'),
    confirmVariant: 'primary',
    isOpen: false,
    message: '',
    onConfirm: () => {},
    title: '',
  });
  const [testStatus, setTestStatus] = useState<TestStatus>({ message: '', success: null, testing: false });
  const [hasInteractedWithLivePreview, setHasInteractedWithLivePreview] = useState(false);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  const [aiProvider, setAiProvider] = useState<AiProviderIdType>(() => normalizeAiProviderId(appSettings.aiProvider));
  const [aiConnectorAddress, setAiConnectorAddress] = useState<string>(appSettings.aiConnectorAddress || '');
  const [newShortcut, setNewShortcut] = useState('');
  const [newAiTag, setNewAiTag] = useState('');

  const [lensMakers, setLensMakers] = useState<string[]>([]);
  const [lensModels, setLensModels] = useState<string[]>([]);
  const [tempLensMaker, setTempLensMaker] = useState<string>('');
  const [tempLensModel, setTempLensModel] = useState<string>('');

  const osPlatform = useOsPlatform();
  const [processingSettings, setProcessingSettings] = useState<ProcessingSettings>(() =>
    buildProcessingSettings(appSettings, osPlatform),
  );
  const [restartRequired, setRestartRequired] = useState(false);
  const [activeCategory, setActiveCategory] = useState('general');
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logPathLoading, setLogPathLoading] = useState(true);
  const [logPathError, setLogPathError] = useState(false);
  const [dpr, setDpr] = useState(() => (typeof window !== 'undefined' ? window.devicePixelRatio : 1));
  const saveSettings = useCallback(
    (settings: AppSettings) => {
      void onSettingsChange(settings);
    },
    [onSettingsChange],
  );

  const settingCategories = useMemo(
    () => [
      { id: 'general', label: t('settings.categories.general'), icon: SlidersHorizontal },
      { id: 'processing', label: t('settings.categories.processing'), icon: Cpu },
      { id: 'shortcuts', label: t('settings.categories.shortcuts'), icon: Keyboard },
    ],
    [t],
  );

  const livePreviewQualityOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'full', label: t('settings.processing.qualities.full') },
      { value: 'high', label: t('settings.processing.qualities.high') },
      { value: 'performance', label: t('settings.processing.qualities.performance') },
    ],
    [t],
  );

  const filteredBackendOptions = useMemo<OptionItem<string>[]>(() => {
    const rawOptions = [
      { value: 'auto', label: t('settings.processing.backends.auto') },
      { value: 'vulkan', label: t('settings.processing.backends.vulkan') },
      { value: 'dx12', label: t('settings.processing.backends.dx12') },
      { value: 'metal', label: t('settings.processing.backends.metal') },
      { value: 'gl', label: t('settings.processing.backends.gl') },
    ];
    return rawOptions.filter((opt) => {
      if (opt.value === 'metal' && osPlatform !== 'macos') return false;
      if (opt.value === 'dx12' && osPlatform === 'macos') return false;
      return true;
    });
  }, [t, osPlatform]);

  const rawProcessingModeOptions = useMemo<OptionItem<RawProcessingMode>[]>(
    () =>
      RAW_PROCESSING_MODES.map((mode) => ({
        value: mode,
        label: t(`settings.processing.rawModes.${mode}.label`),
      })),
    [t],
  );

  const linearRawOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'auto', label: t('settings.processing.preprocessing.linearOptions.auto') },
      { value: 'gamma', label: t('settings.processing.preprocessing.linearOptions.gamma') },
      { value: 'skip_calib', label: t('settings.processing.preprocessing.linearOptions.skip_calib') },
      { value: 'gamma_skip_calib', label: t('settings.processing.preprocessing.linearOptions.gamma_skip_calib') },
    ],
    [t],
  );

  const tonemapperOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'agx', label: t('settings.processing.preprocessing.tonemapperOptions.agx') },
      { value: 'basic', label: t('settings.processing.preprocessing.tonemapperOptions.basic') },
    ],
    [t],
  );
  const captureSharpeningPresetOptions = useMemo<OptionItem<string>[]>(
    () => [
      {
        value: CUSTOM_CAPTURE_SHARPENING_PRESET_ID,
        label: t('settings.processing.preprocessing.captureSharpeningCustom'),
      },
      ...CAPTURE_SHARPENING_PRESETS.map((preset) => ({
        value: preset.id,
        label: preset.name,
      })),
    ],
    [t],
  );

  const fontOptions = useMemo<OptionItem<string>[]>(
    () => [
      { value: 'poppins', label: t('settings.general.poppins') },
      { value: 'system', label: t('settings.general.system') },
    ],
    [t],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateDpr = () => {
      setDpr(window.devicePixelRatio);
    };

    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener('change', updateDpr);

    window.addEventListener('resize', updateDpr);

    return () => {
      mediaQuery.removeEventListener('change', updateDpr);
      window.removeEventListener('resize', updateDpr);
    };
  }, []);

  const customAiTags = Array.from(new Set<string>(appSettings.customAiTags || []));
  const taggingShortcuts = Array.from(new Set<string>(appSettings.taggingShortcuts || []));

  useEffect(() => {
    const syncTimer = setTimeout(() => {
      setAiConnectorAddress((current) =>
        appSettings.aiConnectorAddress !== current ? appSettings.aiConnectorAddress || '' : current,
      );
      setAiProvider((current) => {
        const nextProvider = normalizeAiProviderId(appSettings.aiProvider);
        return nextProvider !== current ? nextProvider : current;
      });
      setProcessingSettings(buildProcessingSettings(appSettings, osPlatform));
      setRestartRequired(false);
    }, 0);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [appSettings, osPlatform]);

  useEffect(() => {
    const fetchLogPath = async () => {
      try {
        const path = await invokeWithSchema(Invokes.GetLogFilePath, {}, pathSchema);
        setLogPath(path);
      } catch (error) {
        console.error('Failed to get log file path:', error);
        setLogPathError(true);
      } finally {
        setLogPathLoading(false);
      }
    };
    void fetchLogPath();
  }, []);

  useEffect(() => {
    invokeWithSchema(Invokes.GetLensfunMakers, {}, stringArraySchema).then(setLensMakers).catch(console.error);
  }, []);

  const handleProcessingSettingChange = async <K extends ProcessingSettingKey>(
    key: K,
    value: ProcessingSettings[K],
  ) => {
    setProcessingSettings((prev) => ({ ...prev, [key]: value }));

    if (
      key === 'processingBackend' ||
      key === 'linuxGpuOptimization' ||
      key === 'useWgpuRenderer' ||
      key === 'thumbnailWorkerThreads'
    ) {
      setRestartRequired(true);
    } else {
      await onSettingsChange({ ...appSettings, [key]: value });
      if (
        key === 'rawHighlightCompression' ||
        key === 'rawPreprocessingColorNr' ||
        key === 'rawPreprocessingSharpening' ||
        key === 'rawPreprocessingSharpeningDetail' ||
        key === 'rawPreprocessingSharpeningEdgeMasking' ||
        key === 'rawPreprocessingSharpeningRadius' ||
        key === 'applyPreprocessingToNonRaws'
      ) {
        await invokeWithSchema(Invokes.ClearImageCaches, {}, emptyResponseSchema);
      }
    }
  };

  const handleProcessingSettingChangeVoid = <K extends ProcessingSettingKey>(key: K, value: ProcessingSettings[K]) => {
    void handleProcessingSettingChange(key, value);
  };

  const handleCaptureSharpeningPresetChange = async (presetId: string) => {
    const preset = CAPTURE_SHARPENING_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;

    const patch = buildCaptureSharpeningProcessingPatch(preset);
    setProcessingSettings((prev) => ({ ...prev, ...patch }));
    await onSettingsChange({ ...appSettings, ...patch });
    await invokeWithSchema(Invokes.ClearImageCaches, {}, emptyResponseSchema);
  };

  const handleCaptureSharpeningPresetChangeVoid = (presetId: string) => {
    void handleCaptureSharpeningPresetChange(presetId);
  };

  const handleRawProcessingModeChange = async (mode: RawProcessingMode) => {
    const patch = buildRawProcessingModePatch(mode);
    const settingsPatch = {
      applyPreprocessingToNonRaws: patch.applyPreprocessingToNonRaws,
      rawHighlightCompression: patch.rawHighlightCompression,
      rawPreprocessingColorNr: patch.rawPreprocessingColorNr,
      rawPreprocessingSharpening: patch.rawPreprocessingSharpening,
      rawPreprocessingSharpeningDetail: patch.rawPreprocessingSharpeningDetail,
      rawPreprocessingSharpeningEdgeMasking: patch.rawPreprocessingSharpeningEdgeMasking,
      rawPreprocessingSharpeningRadius: patch.rawPreprocessingSharpeningRadius,
    };
    const nextSettings = { ...appSettings, ...settingsPatch, rawProcessingMode: mode };
    setProcessingSettings((prev) => ({ ...prev, ...settingsPatch, rawProcessingMode: mode }));
    await onSettingsChange(nextSettings);
    await invokeWithSchema(Invokes.ClearImageCaches, {}, emptyResponseSchema);
  };

  const handleRawProcessingModeChangeVoid = (mode: RawProcessingMode) => {
    void handleRawProcessingModeChange(mode);
  };

  const handleSaveAndRelaunch = async () => {
    await onSettingsChange({
      ...appSettings,
      ...processingSettings,
    });
    await relaunch();
  };

  const handleProviderChange = (provider: AiProviderIdType) => {
    setAiProvider(provider);
    saveSettings({ ...appSettings, aiProvider: provider });
  };

  const handlePreviewModeChange = (mode: 'static' | 'dynamic') => {
    const enableZoomHifi = mode === 'dynamic';
    saveSettings({ ...appSettings, enableZoomHifi });
  };

  const handleTempMakerChange = (maker: string) => {
    setTempLensMaker(maker);
    setTempLensModel('');
    setLensModels([]);
    if (maker) {
      invokeWithSchema(Invokes.GetLensfunLensesForMaker, { maker }, stringArraySchema)
        .then(setLensModels)
        .catch(console.error);
    }
  };

  const handleAddLens = () => {
    if (tempLensMaker && tempLensModel) {
      const currentLenses: MyLens[] = appSettings.myLenses || [];
      if (!currentLenses.some((l) => l.maker === tempLensMaker && l.model === tempLensModel)) {
        const newLenses = [...currentLenses, { maker: tempLensMaker, model: tempLensModel }];

        newLenses.sort((a, b) => {
          const makerComp = a.maker.localeCompare(b.maker);
          if (makerComp !== 0) return makerComp;
          return a.model.localeCompare(b.model);
        });

        saveSettings({
          ...appSettings,
          myLenses: newLenses,
        });
        setTempLensMaker('');
        setTempLensModel('');
        setLensModels([]);
      }
    }
  };

  const handleRemoveLens = (index: number) => {
    const currentLenses: MyLens[] = appSettings.myLenses || [];
    const newLenses = [...currentLenses];
    newLenses.splice(index, 1);
    saveSettings({ ...appSettings, myLenses: newLenses });
  };

  const effectiveRootPaths = rootPaths.length > 0 ? rootPaths : appSettings.rootFolders || [];

  const executeClearSidecars = async () => {
    setIsClearing(true);
    setClearMessage(t('settings.data.statuses.deleting'));
    try {
      let totalCount = 0;
      for (const root of effectiveRootPaths) {
        const count = await invokeWithSchema(Invokes.ClearAllSidecars, { rootPath: root }, countSchema);
        totalCount += count;
      }
      setClearMessage(t('settings.data.statuses.sidecarSuccess', { count: totalCount }));
      onLibraryRefresh();
    } catch (err: unknown) {
      console.error('Failed to clear sidecars:', err);
      setClearMessage(`Error: ${formatUnknownError(err)}`);
    } finally {
      setTimeout(() => {
        setIsClearing(false);
        setClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearSidecars = () => {
    setConfirmModalState({
      confirmText: t('settings.data.modals.confirmDeleteAllEdits'),
      confirmVariant: 'destructive',
      isOpen: true,
      message: t('settings.data.modals.sidecarMessage'),
      onConfirm: () => {
        void executeClearSidecars();
      },
      title: t('settings.data.modals.confirmTitle'),
    });
  };

  const executeClearAiTags = async () => {
    setIsClearingAiTags(true);
    setAiTagsClearMessage(t('settings.data.statuses.clearingAi'));
    try {
      let totalCount = 0;
      for (const root of effectiveRootPaths) {
        const count = await invokeWithSchema(Invokes.ClearAiTags, { rootPath: root }, countSchema);
        totalCount += count;
      }
      setAiTagsClearMessage(t('settings.data.statuses.aiSuccess', { count: totalCount }));
      onLibraryRefresh();
    } catch (err: unknown) {
      console.error('Failed to clear AI tags:', err);
      setAiTagsClearMessage(`Error: ${formatUnknownError(err)}`);
    } finally {
      setTimeout(() => {
        setIsClearingAiTags(false);
        setAiTagsClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearAiTags = () => {
    setConfirmModalState({
      confirmText: t('settings.data.modals.confirmClearAi'),
      confirmVariant: 'destructive',
      isOpen: true,
      message: t('settings.data.modals.aiMessage'),
      onConfirm: () => {
        void executeClearAiTags();
      },
      title: t('settings.data.modals.confirmAiTitle'),
    });
  };

  const executeClearTags = async () => {
    setIsClearingTags(true);
    setTagsClearMessage(t('settings.data.statuses.clearingAll'));
    try {
      let totalCount = 0;
      for (const root of effectiveRootPaths) {
        const count = await invokeWithSchema(Invokes.ClearAllTags, { rootPath: root }, countSchema);
        totalCount += count;
      }
      setTagsClearMessage(t('settings.data.statuses.allSuccess', { count: totalCount }));
      onLibraryRefresh();
    } catch (err: unknown) {
      console.error('Failed to clear tags:', err);
      setTagsClearMessage(`Error: ${formatUnknownError(err)}`);
    } finally {
      setTimeout(() => {
        setIsClearingTags(false);
        setTagsClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearTags = () => {
    setConfirmModalState({
      confirmText: t('settings.data.modals.confirmClearAll'),
      confirmVariant: 'destructive',
      isOpen: true,
      message: t('settings.data.modals.allMessage'),
      onConfirm: () => {
        void executeClearTags();
      },
      title: t('settings.data.modals.confirmAllTitle'),
    });
  };

  const shortcutTagVariants: Variants = {
    visible: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 500, damping: 30 } },
    exit: { opacity: 0, scale: 0.8, transition: { duration: 0.15 } },
  };

  const executeClearCache = async () => {
    setIsClearingCache(true);
    setCacheClearMessage(t('settings.data.statuses.clearingCache'));
    try {
      await invokeWithSchema(Invokes.ClearThumbnailCache, {}, emptyResponseSchema);
      setCacheClearMessage(t('settings.data.statuses.cacheSuccess'));
      onLibraryRefresh();
    } catch (err: unknown) {
      console.error('Failed to clear thumbnail cache:', err);
      setCacheClearMessage(`Error: ${formatUnknownError(err)}`);
    } finally {
      setTimeout(() => {
        setIsClearingCache(false);
        setCacheClearMessage('');
      }, EXECUTE_TIMEOUT);
    }
  };

  const handleClearCache = () => {
    setConfirmModalState({
      confirmText: t('settings.data.modals.confirmClearCache'),
      confirmVariant: 'destructive',
      isOpen: true,
      message: t('settings.data.modals.cacheMessage'),
      onConfirm: () => {
        void executeClearCache();
      },
      title: t('settings.data.modals.confirmCacheTitle'),
    });
  };

  const handleTestConnection = async () => {
    if (!aiConnectorAddress) {
      return;
    }
    setTestStatus({ testing: true, message: t('settings.processing.ai.connector.testing'), success: null });
    try {
      await invokeWithSchema(Invokes.TestAIConnectorConnection, { address: aiConnectorAddress }, emptyResponseSchema);
      setTestStatus({ testing: false, message: t('settings.processing.ai.connector.success'), success: true });
    } catch (err) {
      setTestStatus({ testing: false, message: t('settings.processing.ai.connector.failed'), success: false });
      console.error('AI Connector connection test failed:', err);
    } finally {
      setTimeout(() => {
        setTestStatus({ testing: false, message: '', success: null });
      }, EXECUTE_TIMEOUT);
    }
  };

  const closeConfirmModal = () => {
    setConfirmModalState({ ...confirmModalState, isOpen: false });
  };

  const handleAddShortcut = () => {
    const parsedTags = newShortcut
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    if (parsedTags.length > 0) {
      const uniqueShortcuts = Array.from(new Set([...taggingShortcuts, ...parsedTags])).sort();
      saveSettings({ ...appSettings, taggingShortcuts: uniqueShortcuts });
    }
    setNewShortcut('');
  };

  const handleRemoveShortcut = (shortcutToRemove: string) => {
    const uniqueShortcuts = taggingShortcuts.filter((s) => s !== shortcutToRemove);
    saveSettings({ ...appSettings, taggingShortcuts: uniqueShortcuts });
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddShortcut();
    }
  };

  const handleAddAiTag = () => {
    const parsedTags = newAiTag
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    if (parsedTags.length > 0) {
      const uniqueTags = Array.from(new Set([...customAiTags, ...parsedTags])).sort();
      saveSettings({ ...appSettings, customAiTags: uniqueTags });
    }
    setNewAiTag('');
  };

  const handleRemoveAiTag = (tagToRemove: string) => {
    const uniqueTags = customAiTags.filter((t) => t !== tagToRemove);
    saveSettings({ ...appSettings, customAiTags: uniqueTags });
  };

  const handleAiTagInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAiTag();
    }
  };

  const handleKeybindSave = (action: string, combo: string[]) => {
    const validatedCombo = parseKeyboardShortcutCombo(combo);
    const currentKeybinds = normalizeKeyboardShortcutMap(appSettings.keybinds, KEYBIND_ACTIONS);
    const newKeybinds = { ...currentKeybinds, [action]: validatedCombo };
    saveSettings({ ...appSettings, keybinds: newKeybinds });
  };

  const conflictingKeys = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const userKb = normalizeKeyboardShortcutMap(appSettings.keybinds, KEYBIND_ACTIONS);
    for (const def of KEYBIND_DEFINITIONS) {
      const userCombo = userKb[def.action];
      const effective = userCombo?.length ? userCombo : userCombo === undefined ? def.defaultCombo : null;
      if (!effective) continue;
      const key = effective.join('+');
      if (!map.has(key)) map.set(key, new Set());
      const actions = map.get(key);
      if (!actions) {
        throw new Error('keybind conflict map invariant violated');
      }
      actions.add(def.action);
    }
    const keys = new Set<string>();
    for (const [, actions] of map) {
      if (actions.size > 1) actions.forEach((k) => keys.add(k));
    }
    return keys;
  }, [appSettings.keybinds]);

  return (
    <>
      <ConfirmModal {...confirmModalState} onClose={closeConfirmModal} />
      <div
        className="flex flex-col h-full w-full text-text-primary"
        data-active-category={activeCategory}
        data-testid="settings-panel"
      >
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-y-4 mb-8 pt-4">
          <div className="flex items-center shrink-0">
            <Button
              className="mr-4 hover:bg-surface text-text-primary rounded-full"
              onClick={onBack}
              size="icon"
              variant="ghost"
              data-tooltip={t('settings.tooltips.goHome')}
            >
              <ArrowLeft />
            </Button>
            <UiText variant={TextVariants.display} color={TextColors.accent} className="whitespace-nowrap">
              {t('settings.title')}
            </UiText>
          </div>

          <div className="relative flex w-full min-[1200px]:w-112.5 p-2 bg-surface rounded-md">
            {settingCategories.map((category) => (
              <button
                data-testid={`settings-category-${category.id}`}
                key={category.id}
                onClick={() => {
                  setActiveCategory(category.id);
                }}
                className={cx(
                  'relative flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  {
                    'text-text-primary hover:bg-surface': activeCategory !== category.id,
                    'text-button-text': activeCategory === category.id,
                  },
                )}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {activeCategory === category.id && (
                  <motion.span
                    layoutId="settings-category-switch-bubble"
                    className="absolute inset-0 z-0 bg-accent"
                    style={{ borderRadius: 6 }}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10 flex items-center">
                  <category.icon size={16} className="mr-2 shrink-0" />
                  <span className="truncate">{category.label}</span>
                </span>
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2 -mr-2 custom-scrollbar">
          <AnimatePresence mode="wait">
            {activeCategory === 'general' && (
              <motion.div
                key="general"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-10"
              >
                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.general.title')}
                  </UiText>
                  <div className="space-y-8">
                    <SettingItem label={t('settings.general.theme')} description={t('settings.general.themeDesc')}>
                      <Dropdown
                        onChange={(value: Theme) => {
                          saveSettings({ ...appSettings, theme: value });
                        }}
                        options={THEMES.map((theme: ThemeProps) => ({
                          value: theme.id,
                          label: translateDynamicKey(t, theme.name),
                        }))}
                        value={appSettings.theme}
                        triggerClassName="bg-bg-primary"
                      />
                    </SettingItem>

                    <SettingItem label={t('settings.language')} description={t('settings.languageDesc')}>
                      <Dropdown
                        onChange={(value: string) => {
                          saveSettings({ ...appSettings, language: value });
                        }}
                        options={[
                          { value: 'en', label: 'English' },
                          { value: 'de', label: 'Deutsch' },
                          { value: 'es', label: 'Español' },
                          { value: 'fr', label: 'Français' },
                          { value: 'it', label: 'Italiano' },
                          { value: 'ja', label: '日本語' },
                          { value: 'ko', label: '한국어' },
                          { value: 'pl', label: 'Polski' },
                          { value: 'pt', label: 'Português' },
                          { value: 'ru', label: 'Русский' },
                          { value: 'zh-CN', label: '简体中文' },
                          { value: 'zh-TW', label: '繁體中文' },
                        ]}
                        value={appSettings.language || 'en'}
                        triggerClassName="bg-bg-primary"
                      />
                    </SettingItem>

                    <div className="space-y-4">
                      <SettingItem
                        label={t('settings.general.xmpSync')}
                        description={t('settings.general.xmpSyncDesc')}
                      >
                        <Switch
                          checked={appSettings.enableXmpSync ?? true}
                          id="enable-xmp-sync-toggle"
                          label={t('settings.general.enableXmpSync')}
                          onChange={(checked) => {
                            const newSettings = { ...appSettings, enableXmpSync: checked };
                            if (!checked) {
                              newSettings.createXmpIfMissing = false;
                            }
                            saveSettings(newSettings);
                          }}
                        />
                      </SettingItem>

                      <AnimatePresence initial={false}>
                        {(appSettings.enableXmpSync ?? true) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="pl-4 border-l-2 border-border-color ml-1">
                              <SettingItem
                                label={t('settings.general.createXmp')}
                                description={t('settings.general.createXmpDesc')}
                              >
                                <Switch
                                  checked={appSettings.createXmpIfMissing ?? false}
                                  id="create-xmp-missing-toggle"
                                  label={t('settings.general.createXmpMissing')}
                                  onChange={(checked) => {
                                    saveSettings({ ...appSettings, createXmpIfMissing: checked });
                                  }}
                                />
                              </SettingItem>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <SettingItem
                      label={t('settings.general.folderImageCounts')}
                      description={t('settings.general.folderImageCountsDesc')}
                    >
                      <Switch
                        checked={appSettings.enableFolderImageCounts ?? false}
                        id="folder-image-counts-toggle"
                        label={t('settings.general.showImageCounts')}
                        onChange={(checked) => {
                          saveSettings({ ...appSettings, enableFolderImageCounts: checked });
                        }}
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.general.displayEditIcon')}
                      description={t('settings.general.displayEditIconDesc')}
                    >
                      <Switch
                        checked={appSettings.displayEditIcon ?? true}
                        id="display-edit-icon-toggle"
                        label={t('settings.general.displayEditIcon')}
                        onChange={(checked) => {
                          saveSettings({ ...appSettings, displayEditIcon: checked });
                        }}
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.general.focusMode')}
                      description={t('settings.general.focusModeDesc')}
                    >
                      <Switch
                        checked={appSettings.enableFocusMode ?? false}
                        id="focus-mode-toggle"
                        label={t('settings.general.enableFocusMode')}
                        onChange={(checked) => {
                          saveSettings({ ...appSettings, enableFocusMode: checked });
                        }}
                      />
                    </SettingItem>

                    <SettingItem label={t('settings.general.font')} description={t('settings.general.fontDesc')}>
                      <Dropdown
                        onChange={(value: string) => {
                          saveSettings({ ...appSettings, fontFamily: value });
                        }}
                        options={fontOptions}
                        value={appSettings.fontFamily || 'poppins'}
                        triggerClassName="bg-bg-primary"
                      />
                    </SettingItem>

                    {osPlatform === 'linux' && (
                      <SettingItem
                        label={t('settings.general.nativeTitlebar')}
                        description={t('settings.general.nativeTitlebarDesc')}
                      >
                        <Switch
                          checked={appSettings.decorations ?? false}
                          id="native-titlebar-toggle"
                          label={t('settings.general.enableOsTitlebar')}
                          onChange={(checked) => {
                            saveSettings({ ...appSettings, decorations: checked });
                            getCurrentWindow().setDecorations(checked).catch(console.error);
                          }}
                        />
                      </SettingItem>
                    )}
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.adjustments.title')}
                  </UiText>
                  <UiText className="mb-4">{t('settings.adjustments.description')}</UiText>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <Switch
                      label={t('settings.adjustments.chromaticAberration')}
                      checked={appSettings.adjustmentVisibility?.['chromaticAberration'] ?? false}
                      onChange={(checked) => {
                        saveSettings({
                          ...appSettings,
                          adjustmentVisibility: {
                            ...(appSettings.adjustmentVisibility || adjustmentVisibilityDefaults),
                            chromaticAberration: checked,
                          },
                        });
                      }}
                    />
                    <Switch
                      label={t('settings.adjustments.grain')}
                      checked={appSettings.adjustmentVisibility?.['grain'] ?? true}
                      onChange={(checked) => {
                        saveSettings({
                          ...appSettings,
                          adjustmentVisibility: {
                            ...(appSettings.adjustmentVisibility || adjustmentVisibilityDefaults),
                            grain: checked,
                          },
                        });
                      }}
                    />
                    <Switch
                      label={t('settings.adjustments.colorCalibration')}
                      checked={appSettings.adjustmentVisibility?.['colorCalibration'] ?? true}
                      onChange={(checked) => {
                        saveSettings({
                          ...appSettings,
                          adjustmentVisibility: {
                            ...(appSettings.adjustmentVisibility || adjustmentVisibilityDefaults),
                            colorCalibration: checked,
                          },
                        });
                      }}
                    />
                    <Switch
                      label={t('settings.adjustments.noiseReduction')}
                      checked={appSettings.adjustmentVisibility?.['noiseReduction'] ?? true}
                      onChange={(checked) => {
                        saveSettings({
                          ...appSettings,
                          adjustmentVisibility: {
                            ...(appSettings.adjustmentVisibility || adjustmentVisibilityDefaults),
                            noiseReduction: checked,
                          },
                        });
                      }}
                    />
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.lenses.title')}
                  </UiText>
                  <UiText className="mb-6">{t('settings.lenses.description')}</UiText>

                  <div className="space-y-8">
                    <div className="bg-bg-primary rounded-lg p-4 border border-border-color">
                      <UiText variant={TextVariants.heading} className="mb-3">
                        {t('settings.lenses.addNew')}
                      </UiText>
                      <div className="space-y-4">
                        <Dropdown
                          options={lensMakers.map((m) => ({ label: m, value: m }))}
                          value={tempLensMaker}
                          onChange={handleTempMakerChange}
                          placeholder={t('settings.lenses.manufacturerPlaceholder')}
                        />
                        <Dropdown
                          options={lensModels.map((m) => ({ label: m, value: m }))}
                          value={tempLensModel}
                          onChange={setTempLensModel}
                          placeholder={t('settings.lenses.modelPlaceholder')}
                          disabled={!tempLensMaker}
                        />
                        <Button onClick={handleAddLens} disabled={!tempLensMaker || !tempLensModel} className="w-full">
                          <Plus size={16} className="mr-1" />
                          {t('settings.lenses.addButton')}
                        </Button>
                      </div>
                    </div>

                    <div>
                      <UiText variant={TextVariants.heading} className="mb-2">
                        {t('settings.lenses.saved')}
                      </UiText>
                      {(!appSettings.myLenses || appSettings.myLenses.length === 0) && (
                        <UiText className="italic">{t('settings.lenses.noLenses')}</UiText>
                      )}
                      <div className="divide-y divide-border-color">
                        {(appSettings.myLenses || []).map((lens: MyLens, index: number) => (
                          <div
                            key={`${lens.maker}-${lens.model}-${index}`}
                            className="flex justify-between items-center py-3 first:pt-0 last:pb-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-surface rounded-md text-accent">
                                <Bookmark size={16} />
                              </div>
                              <div>
                                <UiText color={TextColors.primary} weight={TextWeights.medium}>
                                  {lens.model}
                                </UiText>
                                <UiText variant={TextVariants.small}>{lens.maker}</UiText>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                handleRemoveLens(index);
                              }}
                              className="p-2 text-text-secondary hover:text-red-400 hover:bg-bg-primary rounded-md transition-colors"
                              data-tooltip={t('settings.lenses.removeTooltip')}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.tagging.title')}
                  </UiText>
                  <div className="space-y-8">
                    <div className="space-y-4">
                      <SettingItem
                        description={t('settings.tagging.aiTaggingDesc')}
                        label={t('settings.tagging.aiTagging')}
                      >
                        <Switch
                          checked={appSettings.enableAiTagging ?? false}
                          id="ai-tagging-toggle"
                          label={t('settings.tagging.automaticAiTagging')}
                          onChange={(checked) => {
                            saveSettings({ ...appSettings, enableAiTagging: checked });
                          }}
                        />
                      </SettingItem>

                      <AnimatePresence>
                        {(appSettings.enableAiTagging ?? false) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="pl-4 border-l-2 border-border-color ml-1 space-y-8">
                              <SettingItem
                                label={t('settings.tagging.maxAiTags')}
                                description={t('settings.tagging.maxAiTagsDesc')}
                              >
                                <Slider
                                  label={t('settings.tagging.amount')}
                                  min={1}
                                  max={20}
                                  step={1}
                                  value={appSettings.aiTagCount ?? 10}
                                  defaultValue={10}
                                  onChange={(event: NumericChangeEvent) => {
                                    saveSettings({ ...appSettings, aiTagCount: getIntegerEventValue(event) });
                                  }}
                                />
                              </SettingItem>

                              <SettingItem
                                label={t('settings.tagging.customList')}
                                description={t('settings.tagging.customListDesc')}
                              >
                                <div>
                                  <div className="flex flex-wrap gap-2 p-2 bg-bg-primary rounded-md min-h-10 border border-border-color mb-2 items-center">
                                    <AnimatePresence>
                                      {customAiTags.length > 0 ? (
                                        customAiTags.map((tag: string) => (
                                          <motion.div
                                            key={tag}
                                            layout
                                            variants={shortcutTagVariants}
                                            initial={false}
                                            animate="visible"
                                            exit="exit"
                                            onClick={() => {
                                              handleRemoveAiTag(tag);
                                            }}
                                            data-tooltip={t('settings.tagging.removeCustomTooltip', { tag })}
                                            className="flex items-center gap-1 bg-surface px-2 py-1 rounded-sm group cursor-pointer"
                                          >
                                            <UiText variant={TextVariants.label} color={TextColors.primary}>
                                              {tag}
                                            </UiText>
                                            <span className="rounded-full group-hover:bg-black/20 p-0.5 transition-colors">
                                              <X size={14} />
                                            </span>
                                          </motion.div>
                                        ))
                                      ) : (
                                        <motion.span
                                          key="no-ai-tags-placeholder"
                                          initial={{ opacity: 0 }}
                                          animate={{ opacity: 1 }}
                                          exit={{ opacity: 0 }}
                                          transition={{ duration: 0.2 }}
                                        >
                                          <UiText className="px-1 select-none italic">
                                            {t('settings.tagging.noCustomTags')}
                                          </UiText>
                                        </motion.span>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                      <Input
                                        type="text"
                                        value={newAiTag}
                                        onChange={(e) => {
                                          setNewAiTag(e.target.value);
                                        }}
                                        onKeyDown={handleAiTagInputKeyDown}
                                        placeholder={t('settings.tagging.addCustomPlaceholder')}
                                        className="pr-10"
                                        bgClassName="bg-bg-primary"
                                      />
                                      <button
                                        onClick={handleAddAiTag}
                                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface"
                                        data-tooltip={t('settings.tagging.addCustomTooltip')}
                                      >
                                        <Plus size={18} />
                                      </button>
                                    </div>
                                    <button
                                      onClick={() => {
                                        saveSettings({ ...appSettings, customAiTags: [] });
                                      }}
                                      disabled={customAiTags.length === 0}
                                      className="p-2 text-text-secondary hover:text-red-400 hover:bg-surface rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary disabled:hover:bg-transparent"
                                      data-tooltip={t('settings.tagging.clearCustomTooltip')}
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  </div>
                                </div>
                              </SettingItem>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <SettingItem
                      label={t('settings.tagging.shortcuts')}
                      description={t('settings.tagging.shortcutsDesc')}
                    >
                      <div>
                        <div className="flex flex-wrap gap-2 p-2 bg-bg-primary rounded-md min-h-10 border border-border-color mb-2 items-center">
                          <AnimatePresence>
                            {taggingShortcuts.length > 0 ? (
                              taggingShortcuts.map((shortcut: string) => (
                                <motion.div
                                  key={shortcut}
                                  layout
                                  variants={shortcutTagVariants}
                                  initial={false}
                                  animate="visible"
                                  exit="exit"
                                  onClick={() => {
                                    handleRemoveShortcut(shortcut);
                                  }}
                                  data-tooltip={t('settings.tagging.removeShortcutTooltip', { shortcut })}
                                  className="flex items-center gap-1 bg-surface px-2 py-1 rounded-sm group cursor-pointer"
                                >
                                  <UiText variant={TextVariants.label} color={TextColors.primary}>
                                    {shortcut}
                                  </UiText>
                                  <span className="rounded-full group-hover:bg-black/20 p-0.5 transition-colors">
                                    <X size={14} />
                                  </span>
                                </motion.div>
                              ))
                            ) : (
                              <motion.span
                                key="no-shortcuts-placeholder"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="text-sm text-text-secondary italic px-1 select-none"
                              >
                                {t('settings.tagging.noShortcuts')}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Input
                              type="text"
                              value={newShortcut}
                              onChange={(e) => {
                                setNewShortcut(e.target.value);
                              }}
                              onKeyDown={handleInputKeyDown}
                              placeholder={t('settings.tagging.addShortcutsPlaceholder')}
                              className="pr-10"
                              bgClassName="bg-bg-primary"
                            />
                            <button
                              onClick={handleAddShortcut}
                              className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface"
                              data-tooltip={t('settings.tagging.addShortcutTooltip')}
                            >
                              <Plus size={18} />
                            </button>
                          </div>
                          <button
                            onClick={() => {
                              saveSettings({ ...appSettings, taggingShortcuts: [] });
                            }}
                            disabled={taggingShortcuts.length === 0}
                            className="p-2 text-text-secondary hover:text-red-400 hover:bg-surface rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary disabled:hover:bg-transparent"
                            data-tooltip={t('settings.tagging.clearShortcutsTooltip')}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </SettingItem>

                    <div className="pt-8 border-t border-border-color">
                      <div className="space-y-8">
                        <DataActionItem
                          buttonAction={handleClearAiTags}
                          buttonText={t('settings.tagging.clearAiTagsButton')}
                          description={t('settings.tagging.clearAiTagsDesc')}
                          disabled={effectiveRootPaths.length === 0}
                          icon={<Trash2 size={16} className="mr-2" />}
                          isProcessing={isClearingAiTags}
                          message={aiTagsClearMessage}
                          title={t('settings.tagging.clearAiTagsTitle')}
                        />
                        <DataActionItem
                          buttonAction={handleClearTags}
                          buttonText={t('settings.tagging.clearAiTagsButton')}
                          description={t('settings.tagging.clearAllTagsDesc')}
                          disabled={effectiveRootPaths.length === 0}
                          icon={<Trash2 size={16} className="mr-2" />}
                          isProcessing={isClearingTags}
                          message={tagsClearMessage}
                          title={t('settings.tagging.clearAllTagsTitle')}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-6">
                    {t('settings.thanks.title')}
                  </UiText>
                  <UiText className="mb-4">{t('settings.thanks.description')}</UiText>
                  <UiText as="ul" className="space-y-3 list-disc ml-5 pl-1">
                    <li>
                      <a
                        href="https://github.com/dnglab/dnglab/tree/main/rawler"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.rawler')}
                      </a>
                      : {t('settings.thanks.list.rawler')}
                    </li>
                    <li>
                      <a
                        href="https://lensfun.github.io/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.lensfun')}
                      </a>
                      : {t('settings.thanks.list.lensfun')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/marcinz606/NegPy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.negpy')}
                      </a>
                      : {t('settings.thanks.list.negpy')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/advimman/lama"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.lama')}
                      </a>
                      : {t('settings.thanks.list.lama')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/facebookresearch/sam2"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.sam2')}
                      </a>
                      : {t('settings.thanks.list.sam2')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/xuebinqin/U-2-Net"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.u2net')}
                      </a>
                      : {t('settings.thanks.list.u2net')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/DepthAnything/Depth-Anything-V2"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.depth')}
                      </a>
                      : {t('settings.thanks.list.depth')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/trougnouf/nind-denoise"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.nind')}
                      </a>
                      : {t('settings.thanks.list.nind')}
                    </li>
                    <li>
                      <a
                        href="https://github.com/darktable-org/darktable"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-accent hover:underline"
                      >
                        {t('settings.thanks.names.darktable')}
                      </a>
                      : {t('settings.thanks.list.darktable')}
                    </li>
                    <li>
                      <span className="font-semibold text-accent">{t('settings.thanks.list.youLabel')}</span>:{' '}
                      {t('settings.thanks.list.you')}
                    </li>
                  </UiText>
                </div>
              </motion.div>
            )}
            {activeCategory === 'processing' && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-10"
              >
                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.processing.title')}
                  </UiText>
                  <div className="space-y-8">
                    <div>
                      <UiText variant={TextVariants.heading} className="mb-2">
                        {t('settings.processing.previewStrategy')}
                      </UiText>
                      <PreviewModeSwitch
                        mode={appSettings.enableZoomHifi ? 'dynamic' : 'static'}
                        onModeChange={handlePreviewModeChange}
                      />

                      <div className="mt-3">
                        <AnimatePresence mode="wait">
                          {!(appSettings.enableZoomHifi ?? true) ? (
                            <motion.div
                              key="static-preview"
                              initial={{ opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              transition={{ duration: 0.2 }}
                            >
                              <UiText variant={TextVariants.small} className="mb-4">
                                {t('settings.processing.staticDesc')}
                              </UiText>
                              <div className="pl-4 border-l-2 border-border-color ml-1">
                                <DropdownSetting
                                  description={t('settings.processing.previewResDesc')}
                                  label={t('settings.processing.previewRes')}
                                  onChange={(value) => {
                                    handleProcessingSettingChangeVoid('editorPreviewResolution', value);
                                  }}
                                  options={resolutions}
                                  value={processingSettings.editorPreviewResolution}
                                />
                              </div>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="dynamic-preview"
                              initial={{ opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              transition={{ duration: 0.2 }}
                            >
                              <UiText variant={TextVariants.small} className="mb-4">
                                {t('settings.processing.dynamicDesc')}
                              </UiText>
                              <div className="pl-4 border-l-2 border-border-color ml-1 space-y-3">
                                <DropdownSetting
                                  description={t('settings.processing.staticPreviewResDesc')}
                                  label={t('settings.processing.staticPreviewRes')}
                                  onChange={(value) => {
                                    handleProcessingSettingChangeVoid('editorPreviewResolution', value);
                                  }}
                                  options={resolutions}
                                  value={processingSettings.editorPreviewResolution}
                                />

                                <DropdownSetting
                                  label={t('settings.processing.renderScale')}
                                  description={t('settings.processing.renderScaleDesc')}
                                  onChange={(value) => {
                                    handleProcessingSettingChangeVoid('highResZoomMultiplier', value);
                                  }}
                                  options={zoomMultiplierOptions}
                                  value={processingSettings.highResZoomMultiplier}
                                />

                                <SwitchSetting
                                  label={t('settings.processing.highDpi')}
                                  description={
                                    dpr > 1
                                      ? t('settings.processing.highDpiDesc', { dpr })
                                      : t('settings.processing.highDpiDescStandard')
                                  }
                                  checked={processingSettings.useFullDpiRendering}
                                  disabled={dpr <= 1}
                                  id="full-dpi-rendering-toggle"
                                  switchLabel={t('settings.processing.nativeDpi')}
                                  onChange={(checked) => {
                                    handleProcessingSettingChangeVoid('useFullDpiRendering', checked);
                                  }}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <SettingItem
                        label={t('settings.processing.livePreviews')}
                        description={t('settings.processing.livePreviewsDesc')}
                      >
                        <Switch
                          checked={appSettings.enableLivePreviews ?? true}
                          id="live-previews-toggle"
                          label={t('settings.processing.enableLivePreviews')}
                          onChange={(checked) => {
                            setHasInteractedWithLivePreview(true);
                            saveSettings({ ...appSettings, enableLivePreviews: checked });
                          }}
                        />
                      </SettingItem>

                      <AnimatePresence>
                        {(appSettings.enableLivePreviews ?? true) && (
                          <motion.div
                            initial={hasInteractedWithLivePreview ? { height: 0, opacity: 0 } : false}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                          >
                            <div className="pl-4 border-l-2 border-border-color ml-1">
                              <SettingItem
                                label={t('settings.processing.livePreviewQuality')}
                                description={t('settings.processing.livePreviewQualityDesc')}
                              >
                                <Dropdown
                                  onChange={(value: string) => {
                                    saveSettings({ ...appSettings, livePreviewQuality: value });
                                  }}
                                  options={livePreviewQualityOptions}
                                  value={appSettings.livePreviewQuality || 'high'}
                                  triggerClassName="bg-bg-primary"
                                />
                              </SettingItem>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <DropdownSetting
                      description={t('settings.processing.thumbnailResDesc')}
                      label={t('settings.processing.thumbnailRes')}
                      onChange={(value) => {
                        handleProcessingSettingChangeVoid('thumbnailResolution', value);
                      }}
                      options={thumbnailResolutions}
                      value={processingSettings.thumbnailResolution}
                    />

                    <SettingItem
                      label={t('settings.processing.workerThreads')}
                      description={t('settings.processing.workerThreadsDesc')}
                    >
                      <Slider
                        label={t('settings.processing.threads')}
                        min={2}
                        max={10}
                        step={1}
                        value={processingSettings.thumbnailWorkerThreads}
                        defaultValue={4}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid('thumbnailWorkerThreads', getIntegerEventValue(event));
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.processing.imageCache')}
                      description={t('settings.processing.imageCacheDesc')}
                    >
                      <Slider
                        label={t('settings.processing.images')}
                        min={2}
                        max={10}
                        step={1}
                        value={processingSettings.imageCacheSize}
                        defaultValue={5}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid('imageCacheSize', getIntegerEventValue(event));
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SwitchSetting
                      label={t('settings.processing.wgpu')}
                      description={
                        osPlatform === 'linux'
                          ? t('settings.processing.wgpuDescLinux')
                          : osPlatform === 'android'
                            ? t('settings.processing.wgpuDescAndroid')
                            : t('settings.processing.wgpuDescRecommended')
                      }
                      checked={processingSettings.useWgpuRenderer}
                      disabled={osPlatform === 'linux' || osPlatform === 'android'}
                      id="wgpu-renderer-toggle"
                      switchLabel={t('settings.processing.wgpuLabel')}
                      onChange={(checked) => {
                        handleProcessingSettingChangeVoid('useWgpuRenderer', checked);
                      }}
                    />

                    <DropdownSetting
                      label={t('settings.processing.backend')}
                      description={t('settings.processing.backendDesc')}
                      onChange={(value) => {
                        handleProcessingSettingChangeVoid('processingBackend', value);
                      }}
                      options={filteredBackendOptions}
                      value={
                        filteredBackendOptions.some((option) => option.value === processingSettings.processingBackend)
                          ? processingSettings.processingBackend
                          : 'auto'
                      }
                    />

                    {osPlatform !== 'macos' && osPlatform !== 'windows' && (
                      <SwitchSetting
                        label={t('settings.processing.linuxCompat')}
                        description={t('settings.processing.linuxCompatDesc')}
                        checked={processingSettings.linuxGpuOptimization}
                        id="gpu-compat-toggle"
                        switchLabel={t('settings.processing.linuxCompatLabel')}
                        onChange={(checked) => {
                          handleProcessingSettingChangeVoid('linuxGpuOptimization', checked);
                        }}
                      />
                    )}

                    {restartRequired && (
                      <>
                        <UiText
                          as="div"
                          color={TextColors.info}
                          className="p-3 bg-blue-900/10 border border-blue-500/50 rounded-lg flex items-center gap-3"
                        >
                          <Info size={18} />
                          <p>{t('settings.processing.restartRequired')}</p>
                        </UiText>
                        <div className="flex justify-end">
                          <Button
                            onClick={() => {
                              void handleSaveAndRelaunch();
                            }}
                          >
                            {t('settings.processing.saveRelaunch')}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.processing.rawMode.title')}
                  </UiText>
                  <div className="space-y-5" data-testid="raw-processing-mode-control">
                    <DropdownSetting
                      label={t('settings.processing.rawMode.label')}
                      description={t('settings.processing.rawMode.description')}
                      onChange={handleRawProcessingModeChangeVoid}
                      options={rawProcessingModeOptions}
                      value={processingSettings.rawProcessingMode}
                    />
                    <div className="rounded-lg border border-surface bg-bg-primary/40 p-3">
                      <UiText as="div" color={TextColors.secondary} className="text-xs uppercase tracking-wide">
                        {t('settings.processing.rawMode.provenance')}
                      </UiText>
                      <UiText as="div" color={TextColors.primary} className="mt-1 font-mono text-xs">
                        {RAW_PROCESSING_MODE_RECIPES[processingSettings.rawProcessingMode].provenance}
                      </UiText>
                      <UiText as="div" color={TextColors.secondary} className="mt-2 text-sm">
                        {t(`settings.processing.rawModes.${processingSettings.rawProcessingMode}.description`)}
                      </UiText>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.processing.preprocessing.title')}
                  </UiText>
                  <div className="space-y-8">
                    <div data-testid="capture-sharpening-preset-control">
                      <DropdownSetting
                        label={t('settings.processing.preprocessing.captureSharpeningPreset')}
                        description={t('settings.processing.preprocessing.captureSharpeningPresetDesc')}
                        options={captureSharpeningPresetOptions}
                        value={
                          findMatchingCaptureSharpeningPreset({
                            applyPreprocessingToNonRaws: processingSettings.applyPreprocessingToNonRaws,
                            rawPreprocessingColorNr: processingSettings.rawPreprocessingColorNr,
                            rawPreprocessingSharpening: processingSettings.rawPreprocessingSharpening,
                            rawPreprocessingSharpeningDetail: processingSettings.rawPreprocessingSharpeningDetail,
                            rawPreprocessingSharpeningEdgeMasking:
                              processingSettings.rawPreprocessingSharpeningEdgeMasking,
                            rawPreprocessingSharpeningRadius: processingSettings.rawPreprocessingSharpeningRadius,
                          })?.id ?? CUSTOM_CAPTURE_SHARPENING_PRESET_ID
                        }
                        onChange={handleCaptureSharpeningPresetChangeVoid}
                      />
                    </div>

                    <SettingItem
                      label={t('settings.processing.preprocessing.highlightRecovery')}
                      description={t('settings.processing.preprocessing.highlightRecoveryDesc')}
                    >
                      <Slider
                        label={t('settings.tagging.amount')}
                        min={1}
                        max={10}
                        step={0.1}
                        value={processingSettings.rawHighlightCompression}
                        defaultValue={2.5}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid('rawHighlightCompression', getNumericEventValue(event));
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.processing.preprocessing.colorNr')}
                      description={t('settings.processing.preprocessing.colorNrDesc')}
                    >
                      <Slider
                        label={t('settings.tagging.amount')}
                        min={0}
                        max={1.0}
                        step={0.05}
                        value={processingSettings.rawPreprocessingColorNr}
                        defaultValue={0.5}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid('rawPreprocessingColorNr', getNumericEventValue(event));
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.processing.preprocessing.sharpening')}
                      description={t('settings.processing.preprocessing.sharpeningDesc')}
                    >
                      <Slider
                        label={t('settings.tagging.amount')}
                        min={0}
                        max={1.0}
                        step={0.05}
                        value={processingSettings.rawPreprocessingSharpening}
                        defaultValue={0.35}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid('rawPreprocessingSharpening', getNumericEventValue(event));
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.processing.preprocessing.sharpeningRadius')}
                      description={t('settings.processing.preprocessing.sharpeningRadiusDesc')}
                    >
                      <Slider
                        label={t('settings.processing.preprocessing.radiusPx')}
                        min={0.5}
                        max={3}
                        step={0.1}
                        value={processingSettings.rawPreprocessingSharpeningRadius}
                        defaultValue={2}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid(
                            'rawPreprocessingSharpeningRadius',
                            getNumericEventValue(event),
                          );
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.processing.preprocessing.sharpeningDetail')}
                      description={t('settings.processing.preprocessing.sharpeningDetailDesc')}
                    >
                      <Slider
                        label={t('settings.tagging.amount')}
                        min={0}
                        max={1}
                        step={0.05}
                        value={processingSettings.rawPreprocessingSharpeningDetail}
                        defaultValue={0.45}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid(
                            'rawPreprocessingSharpeningDetail',
                            getNumericEventValue(event),
                          );
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SettingItem
                      label={t('settings.processing.preprocessing.sharpeningEdgeMasking')}
                      description={t('settings.processing.preprocessing.sharpeningEdgeMaskingDesc')}
                    >
                      <Slider
                        label={t('settings.tagging.amount')}
                        min={0}
                        max={1}
                        step={0.05}
                        value={processingSettings.rawPreprocessingSharpeningEdgeMasking}
                        defaultValue={0.3}
                        onChange={(event: NumericChangeEvent) => {
                          handleProcessingSettingChangeVoid(
                            'rawPreprocessingSharpeningEdgeMasking',
                            getNumericEventValue(event),
                          );
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>

                    <SwitchSetting
                      label={t('settings.processing.preprocessing.applyPreprocessing')}
                      description={t('settings.processing.preprocessing.applyPreprocessingDesc')}
                      checked={processingSettings.applyPreprocessingToNonRaws}
                      id="preprocessing-non-raws-toggle"
                      switchLabel={t('settings.processing.preprocessing.enablePreprocessingNonRaws')}
                      onChange={(checked) => {
                        handleProcessingSettingChangeVoid('applyPreprocessingToNonRaws', checked);
                      }}
                    />

                    <DropdownSetting
                      label={t('settings.processing.preprocessing.linearRaw')}
                      description={t('settings.processing.preprocessing.linearRawDesc')}
                      onChange={(value) => {
                        saveSettings({ ...appSettings, linearRawMode: value });
                      }}
                      options={linearRawOptions}
                      value={appSettings.linearRawMode || 'auto'}
                    />

                    <div className="space-y-4">
                      <SettingItem
                        label={t('settings.processing.preprocessing.tonemapperOverride')}
                        description={t('settings.processing.preprocessing.tonemapperOverrideDesc')}
                      >
                        <Switch
                          checked={appSettings.tonemapperOverrideEnabled ?? false}
                          id="tonemapper-override-toggle"
                          label={t('settings.processing.preprocessing.enableTonemapperOverride')}
                          onChange={(checked) => {
                            saveSettings({ ...appSettings, tonemapperOverrideEnabled: checked });
                          }}
                        />
                      </SettingItem>

                      <AnimatePresence>
                        {(appSettings.tonemapperOverrideEnabled ?? false) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                          >
                            <div className="pl-4 border-l-2 border-border-color ml-1 space-y-3">
                              <SettingItem
                                label={t('settings.processing.preprocessing.defaultRawTonemapper')}
                                description={t('settings.processing.preprocessing.defaultRawTonemapperDesc')}
                              >
                                <Dropdown
                                  onChange={(value: string) => {
                                    saveSettings({ ...appSettings, defaultRawTonemapper: value });
                                  }}
                                  options={tonemapperOptions}
                                  value={appSettings.defaultRawTonemapper || 'agx'}
                                  triggerClassName="bg-bg-primary"
                                />
                              </SettingItem>

                              <SettingItem
                                label={t('settings.processing.preprocessing.defaultNonRawTonemapper')}
                                description={t('settings.processing.preprocessing.defaultNonRawTonemapperDesc')}
                              >
                                <Dropdown
                                  onChange={(value: string) => {
                                    saveSettings({ ...appSettings, defaultNonRawTonemapper: value });
                                  }}
                                  options={tonemapperOptions}
                                  value={appSettings.defaultNonRawTonemapper || 'basic'}
                                  triggerClassName="bg-bg-primary"
                                />
                              </SettingItem>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.processing.ai.title')}
                  </UiText>
                  <UiText className="mb-4">{t('settings.processing.ai.description')}</UiText>

                  <AiProviderSwitch selectedProvider={aiProvider} onProviderChange={handleProviderChange} />

                  <div className="mt-8">
                    <AnimatePresence mode="wait">
                      {aiProvider === AiProviderId.Local && (
                        <motion.div
                          key="cpu"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <UiText variant={TextVariants.heading}>{t('settings.processing.ai.cpu.title')}</UiText>
                          <UiText className="mt-1">{t('settings.processing.ai.cpu.description')}</UiText>
                          <UiText as="ul" className="mt-3 space-y-1 list-disc list-inside">
                            <li>{t('settings.processing.ai.cpu.feature1')}</li>
                            <li>{t('settings.processing.ai.cpu.feature2')}</li>
                            <li>{t('settings.processing.ai.cpu.feature3')}</li>
                          </UiText>
                        </motion.div>
                      )}

                      {aiProvider === AiProviderId.Connector && (
                        <motion.div
                          key="ai-connector"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="space-y-8">
                            <div>
                              <UiText variant={TextVariants.heading}>
                                {t('settings.processing.ai.connector.title')}
                              </UiText>
                              <UiText className="mt-1">{t('settings.processing.ai.connector.description')}</UiText>
                              <UiText as="ul" className="mt-3 space-y-1 list-disc list-inside">
                                <li>{t('settings.processing.ai.connector.feature1')}</li>
                                <li>{t('settings.processing.ai.connector.feature2')}</li>
                                <li>{t('settings.processing.ai.connector.feature3')}</li>
                              </UiText>
                            </div>
                            <SettingItem
                              label={t('settings.processing.ai.connector.address')}
                              description={t('settings.processing.ai.connector.addressDesc')}
                            >
                              <div className="flex items-center gap-2">
                                <Input
                                  className="grow"
                                  id="ai-connector-address"
                                  onBlur={() => {
                                    saveSettings({ ...appSettings, aiConnectorAddress: aiConnectorAddress });
                                  }}
                                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                    setAiConnectorAddress(event.target.value);
                                  }}
                                  onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                                    event.stopPropagation();
                                  }}
                                  placeholder="127.0.0.1:8188"
                                  type="text"
                                  value={aiConnectorAddress}
                                  bgClassName="bg-bg-primary"
                                />
                                <Button
                                  className="w-32"
                                  disabled={testStatus.testing || !aiConnectorAddress}
                                  onClick={() => {
                                    void handleTestConnection();
                                  }}
                                >
                                  {testStatus.testing
                                    ? t('settings.processing.ai.connector.testing')
                                    : t('settings.processing.ai.connector.test')}
                                </Button>
                              </div>
                              {testStatus.message && (
                                <UiText
                                  color={testStatus.success ? TextColors.success : TextColors.error}
                                  className="mt-2 flex items-center gap-2"
                                >
                                  {testStatus.success === true && <Wifi size={16} />}
                                  {testStatus.success === false && <WifiOff size={16} />}
                                  {testStatus.message}
                                </UiText>
                              )}
                            </SettingItem>
                          </div>
                        </motion.div>
                      )}

                      {aiProvider === AiProviderId.Cloud && (
                        <motion.div
                          key="cloud"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <UiText variant={TextVariants.heading}>{t('settings.processing.ai.cloud.title')}</UiText>
                          <UiText className="mt-1">{t('settings.processing.ai.cloud.description')}</UiText>
                          <UiText as="ul" className="mt-3 space-y-1 list-disc list-inside">
                            <li>{t('settings.processing.ai.cloud.feature1')}</li>
                            <li>{t('settings.processing.ai.cloud.feature2')}</li>
                            <li>{t('settings.processing.ai.cloud.feature3')}</li>
                          </UiText>

                          <div className="mt-8">
                            <Show when="signed-in">
                              <div className="p-6 bg-bg-primary rounded-xl border border-border-color shadow-inner">
                                <CloudDashboard />
                              </div>
                            </Show>
                            <Show when="signed-out">
                              <div className="w-full max-w-md">
                                <SignIn
                                  routing="hash"
                                  fallbackRedirectUrl="/"
                                  forceRedirectUrl="/"
                                  appearance={{
                                    variables: {
                                      colorBackground: 'transparent',
                                      colorInput: 'transparent',
                                      colorForeground: 'inherit',
                                      colorInputForeground: 'inherit',
                                      colorPrimaryForeground: 'inherit',
                                      colorBorder: 'transparent',
                                      colorShadow: 'none',
                                      colorNeutral: 'inherit',
                                    },
                                    elements: {
                                      rootBox: '',

                                      cardBox: '!shadow-none !m-0 !p-0 !rounded-none',

                                      card: '!bg-transparent !border-none !shadow-none !py-0 !px-1 !rounded-none',

                                      header: '!hidden',

                                      formFieldLabel: '!text-base !font-semibold !text-text-primary !block !mb-2',

                                      formFieldAction:
                                        '!text-text-secondary hover:!text-text-primary !transition-colors !no-underline hover:!underline',

                                      formFieldInput:
                                        '!bg-bg-primary !border !border-border-color !text-text-primary focus:!border-accent focus:!ring-1 focus:!ring-accent !rounded-md !px-3 !py-2',

                                      formButtonPrimary:
                                        '!bg-accent !text-button-text hover:!bg-accent/90 !shadow-none !transition-colors !rounded-md !mt-4 !py-2',

                                      footer:
                                        '!bg-transparent !p-0 !mt-4 opacity-50 hover:opacity-100 transition-opacity',
                                      footerAction: '!hidden',

                                      identityPreview: '!bg-bg-primary !border !border-border-color !rounded-md !mb-4',
                                      identityPreviewText: '!text-text-primary !font-medium',
                                      identityPreviewEditButtonIcon:
                                        '!text-text-secondary hover:!text-text-primary !transition-colors',
                                    },
                                  }}
                                />
                                <div className="mt-6">
                                  <UiText variant={TextVariants.small}>
                                    {t('settings.processing.ai.cloud.signedOut.noAccount')}{' '}
                                    <button
                                      onClick={() => {
                                        void open('https://www.getrapidraw.com/dashboard');
                                      }}
                                      className="text-accent hover:underline focus:outline-none"
                                    >
                                      {t('settings.processing.ai.cloud.signedOut.signup')}
                                    </button>
                                  </UiText>
                                </div>
                              </div>
                            </Show>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.data.title')}
                  </UiText>
                  <div className="space-y-8">
                    <DataActionItem
                      buttonAction={handleClearSidecars}
                      buttonText={t('settings.data.clearSidecarsButton')}
                      description={
                        <>
                          <UiText as="span" variant={TextVariants.small}>
                            {t('settings.data.clearSidecarsDesc')}
                          </UiText>
                          <span className="block font-mono bg-bg-primary p-2 rounded-sm mt-2 break-all border border-border-color whitespace-pre-wrap">
                            {effectiveRootPaths.length > 0
                              ? effectiveRootPaths.join('\n')
                              : t('settings.data.noFolders')}
                          </span>
                        </>
                      }
                      disabled={effectiveRootPaths.length === 0}
                      icon={<Trash2 size={16} className="mr-2" />}
                      isProcessing={isClearing}
                      message={clearMessage}
                      title={t('settings.data.clearSidecars')}
                    />

                    <DataActionItem
                      buttonAction={handleClearCache}
                      buttonText={t('settings.data.clearThumbnailButton')}
                      description={t('settings.data.clearThumbnailDesc')}
                      icon={<Trash2 size={16} className="mr-2" />}
                      isProcessing={isClearingCache}
                      message={cacheClearMessage}
                      title={t('settings.data.clearThumbnail')}
                    />

                    <DataActionItem
                      buttonAction={() => {
                        if (logPath && !logPathLoading && !logPathError) {
                          void invoke(Invokes.ShowInFinder, { path: logPath }).catch((err: unknown) => {
                            console.error('Failed to reveal log file:', err);
                          });
                        }
                      }}
                      buttonText={t('settings.data.logsButton')}
                      description={
                        <UiText as="span" variant={TextVariants.small}>
                          {t('settings.data.logsDesc')}
                          <span className="block font-mono bg-bg-primary p-2 rounded-sm mt-2 break-all border border-border-color">
                            {logPathLoading
                              ? t('settings.data.loading')
                              : logPathError
                                ? t('settings.data.statuses.failedToGetPath')
                                : logPath}
                          </span>
                        </UiText>
                      }
                      disabled={logPathLoading || logPathError || !logPath}
                      icon={<ExternalLinkIcon size={16} className="mr-2" />}
                      isProcessing={false}
                      message=""
                      title={t('settings.data.logs')}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeCategory === 'shortcuts' && (
              <motion.div
                key="shortcuts"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-10"
              >
                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.controls.title')}
                  </UiText>
                  <div className="space-y-8">
                    <div>
                      <UiText variant={TextVariants.heading} className="mb-2">
                        {t('settings.controls.optimization')}
                      </UiText>
                      <UiText variant={TextVariants.small} className="mb-4">
                        {t('settings.controls.optimizationDesc')}
                      </UiText>
                      <CanvasInputModeSwitch
                        mode={appSettings.canvasInputMode || 'mouse'}
                        onModeChange={(value) => {
                          saveSettings({ ...appSettings, canvasInputMode: value });
                        }}
                      />
                    </div>

                    <SettingItem label={t('settings.controls.zoom')} description={t('settings.controls.zoomDesc')}>
                      <Slider
                        label={t('settings.controls.speed')}
                        min={0.1}
                        max={3.0}
                        step={0.1}
                        value={appSettings.zoomSpeedMultiplier ?? 1.0}
                        defaultValue={1.0}
                        onChange={(event: NumericChangeEvent) => {
                          saveSettings({ ...appSettings, zoomSpeedMultiplier: getNumericEventValue(event) });
                        }}
                        fillOrigin="min"
                      />
                    </SettingItem>
                  </div>
                </div>

                <div className="p-6 bg-surface rounded-xl shadow-md">
                  <UiText variant={TextVariants.title} color={TextColors.accent} className="mb-8">
                    {t('settings.controls.keyboardTitle')}
                  </UiText>
                  <div className="space-y-8">
                    {' '}
                    {KEYBIND_SECTIONS.map((section) => {
                      const sectionDefs = KEYBIND_DEFINITIONS.filter((d) => d.section === section.id);
                      const userKb = normalizeKeyboardShortcutMap(appSettings.keybinds, KEYBIND_ACTIONS);
                      return (
                        <div key={section.id}>
                          <UiText variant={TextVariants.heading}>{translateDynamicKey(t, section.label)}</UiText>
                          <div className="divide-y divide-border-color">
                            {sectionDefs.map((def) => (
                              <KeybindRow
                                key={def.action}
                                def={def}
                                currentCombo={userKb[def.action]}
                                osPlatform={osPlatform}
                                onSave={handleKeybindSave}
                                recordingAction={recordingAction}
                                onStartRecording={setRecordingAction}
                                isConflicting={conflictingKeys.has(def.action)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-end mt-6">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          saveSettings({ ...appSettings, keybinds: {} });
                        }}
                      >
                        {t('settings.controls.resetDefaults')}
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

export default SettingsPanel;
