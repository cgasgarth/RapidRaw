import { afterEach, expect, test } from 'bun:test';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  loadMaskOverlaySettingsPreference,
  nextMaskOverlayHotkeySettings,
  saveMaskOverlaySettingsPreference,
} from '../../../src/utils/mask/maskOverlayPreferences';
import { buildMaskOverlayInvokePayload, buildMaskOverlayTriggerHash } from '../../../src/utils/mask/maskOverlayRequest';

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function installMemoryStorage() {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

afterEach(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('mask overlay preferences normalize persisted mode and opacity', () => {
  const storage = installMemoryStorage();
  storage.setItem(
    'rawengine.maskOverlaySettings.v1',
    JSON.stringify({ edgeThreshold: 1.5, mode: 'edges', opacity: -0.25 }),
  );

  expect(loadMaskOverlaySettingsPreference()).toEqual({
    edgeThreshold: 0.5,
    mode: 'rubylith',
    opacity: 0.5,
  });

  const saved = saveMaskOverlaySettingsPreference({
    edgeThreshold: 0.8,
    mode: 'black',
    opacity: 0.35,
  });

  expect(saved).toEqual({ edgeThreshold: 0.8, mode: 'black', opacity: 0.35 });
  expect(loadMaskOverlaySettingsPreference()).toEqual(saved);
});

test('mask overlay hotkey cycles persisted review modes without changing opacity', () => {
  const next = nextMaskOverlayHotkeySettings({ edgeThreshold: 0.25, mode: 'edges', opacity: 0.42 });

  expect(next).toEqual({ edgeThreshold: 0.25, mode: 'grayscale', opacity: 0.42 });
  expect(nextMaskOverlayHotkeySettings(next).mode).toBe('hidden');
});

test('mask overlay invoke payload carries normalized overlay settings and refinement parameters', () => {
  const maskDef = {
    adjustments: {},
    id: 'layer-1',
    invert: false,
    name: 'Layer 1',
    opacity: 100,
    subMasks: [
      {
        id: 'mask-1',
        invert: false,
        mode: 'additive',
        opacity: 100,
        parameters: {
          density: 0.55,
          edgeContrast: 0.4,
          edgeShiftPx: -3,
          featherPx: 12,
          maskDataBase64: 'already-sent-mask-payload',
          smoothness: 0.2,
        },
        type: 'ai-subject',
        visible: true,
      },
    ],
    visible: true,
  } as const;

  const payload = buildMaskOverlayInvokePayload({
    jsAdjustments: INITIAL_ADJUSTMENTS,
    maskDef,
    maskOverlaySettings: { edgeThreshold: 0.65, mode: 'white', opacity: 0.4 },
    patchesSentToBackend: new Set(['mask-1']),
    renderSize: { height: 240, scale: 0.5, width: 320 },
  });

  expect(payload?.overlaySettings).toEqual({ edgeThreshold: 0.65, mode: 'white', opacity: 0.4 });
  expect(payload?.maskDef.subMasks[0].parameters).toMatchObject({
    density: 0.55,
    edgeContrast: 0.4,
    edgeShiftPx: -3,
    featherPx: 12,
    maskDataBase64: null,
    smoothness: 0.2,
  });

  const triggerHash = buildMaskOverlayTriggerHash({
    activeMaskDef: maskDef,
    adjustments: INITIAL_ADJUSTMENTS,
    imageRenderSize: { height: 240, width: 320 },
    maskOverlaySettings: { edgeThreshold: 0.65, mode: 'white', opacity: 0.4 },
  });

  expect(triggerHash).toContain('"maskOverlaySettings":{"edgeThreshold":0.65,"mode":"white","opacity":0.4}');
  expect(triggerHash).toContain('"featherPx":12');
});
