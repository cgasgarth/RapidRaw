import { describe, expect, test } from 'bun:test';
import {
  buildRestartSavePayload,
  createSettingsEditSession,
  editConnectorAddress,
  editRestartSetting,
  hasRestartRequiredChanges,
  IMMEDIATE_PROCESSING_SETTING_KEYS,
  RESTART_REQUIRED_SETTING_KEYS,
  rebaseSettingsEditSession,
  SETTINGS_OWNERSHIP,
  selectProcessingBackends,
} from '../../../src/components/panel/settingsSession';
import { type AppSettings, Theme } from '../../../src/components/ui/AppProperties';

const settings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
  lastRootPath: null,
  theme: Theme.Dark,
  aiConnectorAddress: 'old:8188',
  aiProvider: 'local',
  processingBackend: 'auto',
  thumbnailWorkerThreads: 4,
  useWgpuRenderer: false,
  linuxGpuOptimization: false,
  ...overrides,
});

describe('Settings edit session', () => {
  test('classifies every formerly mirrored processing field exactly once', () => {
    const classified = [...IMMEDIATE_PROCESSING_SETTING_KEYS, ...RESTART_REQUIRED_SETTING_KEYS];
    expect(new Set(classified).size).toBe(17);
    expect(SETTINGS_OWNERSHIP.aiProvider).toBe('immediate');
    expect(SETTINGS_OWNERSHIP.aiConnectorAddress).toBe('ephemeral-form-input');
  });

  test('filters platform-only backends when the platform changes', () => {
    expect(selectProcessingBackends('macos')).toContain('metal');
    expect(selectProcessingBackends('macos')).not.toContain('dx12');
    expect(selectProcessingBackends('windows')).toContain('dx12');
    expect(selectProcessingBackends('windows')).not.toContain('metal');
    expect(selectProcessingBackends('linux')).not.toContain('metal');
  });

  test('derives restart state from the baseline and supports reverting an edit', () => {
    const initial = createSettingsEditSession(settings(), 'macos');
    expect(hasRestartRequiredChanges(initial)).toBe(false);

    const edited = editRestartSetting(initial, 'processingBackend', 'metal');
    expect(hasRestartRequiredChanges(edited)).toBe(true);
    expect(hasRestartRequiredChanges(editRestartSetting(edited, 'processingBackend', 'auto'))).toBe(false);
  });

  test('preserves edited keys while rebasing untouched keys after an external update', () => {
    const edited = editRestartSetting(createSettingsEditSession(settings(), 'macos'), 'processingBackend', 'metal');
    const rebased = rebaseSettingsEditSession(
      edited,
      settings({ processingBackend: 'vulkan', thumbnailWorkerThreads: 8, theme: Theme.Light }),
      'macos',
    );

    expect(rebased.restartBaseline.processingBackend).toBe('vulkan');
    expect(rebased.restartDraft.processingBackend).toBe('metal');
    expect(rebased.restartDraft.thumbnailWorkerThreads).toBe(8);
    expect(hasRestartRequiredChanges(rebased)).toBe(true);
  });

  test('preserves a dirty connector form but refreshes an untouched form', () => {
    const initial = createSettingsEditSession(settings(), 'macos');
    const external = settings({ aiConnectorAddress: 'external:8188' });
    expect(rebaseSettingsEditSession(initial, external, 'macos').connectorAddress).toBe('external:8188');

    const dirty = editConnectorAddress(initial, 'draft:8188');
    const rebased = rebaseSettingsEditSession(dirty, external, 'macos');
    expect(rebased.connectorAddress).toBe('draft:8188');
    expect(rebased.connectorDirty).toBe(true);
  });

  test('builds one complete save payload from current canonical settings and restart draft', () => {
    const draft = editConnectorAddress(
      editRestartSetting(createSettingsEditSession(settings(), 'macos'), 'processingBackend', 'metal'),
      'draft:9191',
    );
    const latest = settings({ aiProvider: 'connector', imageCacheSize: 9, theme: Theme.Light });
    const payload = buildRestartSavePayload(latest, draft);

    expect(payload).toEqual({
      ...latest,
      processingBackend: 'metal',
      thumbnailWorkerThreads: 4,
      useWgpuRenderer: false,
      linuxGpuOptimization: false,
      aiConnectorAddress: 'draft:9191',
    });
  });

  test('a fresh open discards prior drafts and uses current persisted settings', () => {
    const edited = editRestartSetting(createSettingsEditSession(settings(), 'macos'), 'thumbnailWorkerThreads', 10);
    expect(hasRestartRequiredChanges(edited)).toBe(true);

    const reopened = createSettingsEditSession(settings({ thumbnailWorkerThreads: 6 }), 'macos');
    expect(reopened.restartDraft.thumbnailWorkerThreads).toBe(6);
    expect(hasRestartRequiredChanges(reopened)).toBe(false);
  });
});
