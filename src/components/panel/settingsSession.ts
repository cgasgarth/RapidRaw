import type { AppSettings } from '../ui/AppProperties';

export const RESTART_REQUIRED_SETTING_KEYS = [
  'linuxGpuOptimization',
  'processingBackend',
  'thumbnailWorkerThreads',
  'useWgpuRenderer',
] as const;

export const IMMEDIATE_PROCESSING_SETTING_KEYS = [
  'applyPreprocessingToNonRaws',
  'editorPreviewResolution',
  'highResZoomMultiplier',
  'imageCacheSize',
  'rawHighlightCompression',
  'rawPreprocessingColorNr',
  'rawPreprocessingSharpening',
  'rawPreprocessingSharpeningDetail',
  'rawPreprocessingSharpeningEdgeMasking',
  'rawPreprocessingSharpeningRadius',
  'rawProcessingMode',
  'thumbnailResolution',
  'useFullDpiRendering',
] as const;

export const SETTINGS_OWNERSHIP = {
  aiConnectorAddress: 'ephemeral-form-input',
  aiProvider: 'immediate',
  immediateProcessing: IMMEDIATE_PROCESSING_SETTING_KEYS,
  restartProcessing: RESTART_REQUIRED_SETTING_KEYS,
} as const;

export const PROCESSING_BACKENDS = ['auto', 'vulkan', 'dx12', 'metal', 'gl'] as const;
export type ProcessingBackend = (typeof PROCESSING_BACKENDS)[number];

export function selectProcessingBackends(osPlatform: string): readonly ProcessingBackend[] {
  return PROCESSING_BACKENDS.filter((backend) => {
    if (backend === 'metal' && osPlatform !== 'macos') return false;
    if (backend === 'dx12' && osPlatform === 'macos') return false;
    return true;
  });
}

export type RestartRequiredSettingKey = (typeof RESTART_REQUIRED_SETTING_KEYS)[number];

export function isRestartRequiredSettingKey(key: string): key is RestartRequiredSettingKey {
  return (RESTART_REQUIRED_SETTING_KEYS as readonly string[]).includes(key);
}

export interface RestartRequiredSettingsDraft {
  linuxGpuOptimization: boolean;
  processingBackend: string;
  thumbnailWorkerThreads: number;
  useWgpuRenderer: boolean;
}

export interface SettingsEditSession {
  connectorAddress: string;
  connectorBaseline: string;
  connectorDirty: boolean;
  restartBaseline: RestartRequiredSettingsDraft;
  restartDraft: RestartRequiredSettingsDraft;
  touchedRestartKeys: ReadonlySet<RestartRequiredSettingKey>;
}

const defaultWgpuRenderer = (_osPlatform: string): boolean => false;

export function selectRestartRequiredSettings(settings: AppSettings, osPlatform: string): RestartRequiredSettingsDraft {
  return {
    linuxGpuOptimization: settings.linuxGpuOptimization ?? false,
    processingBackend: settings.processingBackend || 'auto',
    thumbnailWorkerThreads: settings.thumbnailWorkerThreads ?? 4,
    useWgpuRenderer: settings.useWgpuRenderer ?? defaultWgpuRenderer(osPlatform),
  };
}

export function createSettingsEditSession(settings: AppSettings, osPlatform: string): SettingsEditSession {
  const restartBaseline = selectRestartRequiredSettings(settings, osPlatform);
  const connectorAddress = settings.aiConnectorAddress || '';
  return {
    connectorAddress,
    connectorBaseline: connectorAddress,
    connectorDirty: false,
    restartBaseline,
    restartDraft: restartBaseline,
    touchedRestartKeys: new Set(),
  };
}

export function editRestartSetting(
  session: SettingsEditSession,
  key: RestartRequiredSettingKey,
  value: boolean | number | string,
): SettingsEditSession {
  return {
    ...session,
    restartDraft: { ...session.restartDraft, [key]: value } as RestartRequiredSettingsDraft,
    touchedRestartKeys: new Set([...session.touchedRestartKeys, key]),
  };
}

export function editConnectorAddress(session: SettingsEditSession, connectorAddress: string): SettingsEditSession {
  return { ...session, connectorAddress, connectorDirty: connectorAddress !== session.connectorBaseline };
}

export function rebaseSettingsEditSession(
  session: SettingsEditSession,
  settings: AppSettings,
  osPlatform: string,
): SettingsEditSession {
  const restartBaseline = selectRestartRequiredSettings(settings, osPlatform);
  const restartDraft = { ...session.restartDraft };
  for (const key of RESTART_REQUIRED_SETTING_KEYS) {
    if (!session.touchedRestartKeys.has(key)) {
      Object.assign(restartDraft, { [key]: restartBaseline[key] });
    }
  }
  const connectorBaseline = settings.aiConnectorAddress || '';
  return {
    connectorAddress: session.connectorDirty ? session.connectorAddress : connectorBaseline,
    connectorBaseline,
    connectorDirty: session.connectorDirty && session.connectorAddress !== connectorBaseline,
    restartBaseline,
    restartDraft,
    touchedRestartKeys: session.touchedRestartKeys,
  };
}

export function hasRestartRequiredChanges(session: SettingsEditSession): boolean {
  return RESTART_REQUIRED_SETTING_KEYS.some((key) => session.restartDraft[key] !== session.restartBaseline[key]);
}

export function buildRestartSavePayload(settings: AppSettings, session: SettingsEditSession): AppSettings {
  return {
    ...settings,
    ...session.restartDraft,
    ...(session.connectorDirty ? { aiConnectorAddress: session.connectorAddress } : {}),
  };
}

export function settingsSessionMatchesCanonical(
  session: SettingsEditSession,
  settings: AppSettings,
  osPlatform: string,
): boolean {
  const nextRestart = selectRestartRequiredSettings(settings, osPlatform);
  return (
    session.connectorBaseline === (settings.aiConnectorAddress || '') &&
    RESTART_REQUIRED_SETTING_KEYS.every((key) => session.restartBaseline[key] === nextRestart[key])
  );
}
