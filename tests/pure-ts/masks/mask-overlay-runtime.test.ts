import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Mask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks';
import { createDefaultMaskEditNodes } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  loadMaskOverlaySettingsPreference,
  nextMaskOverlayHotkeySettings,
  saveMaskOverlaySettingsPreference,
} from '../../../src/utils/mask/maskOverlayPreferences';
import {
  buildMaskOverlayInvokePayload,
  buildMaskOverlayRequestIdentity,
  buildMaskOverlayTriggerHash,
  isMaskOverlayResponseCurrent,
  type MaskPreviewDefinition,
} from '../../../src/utils/mask/maskOverlayRequest';

beforeEach(() => localStorage.clear());

afterEach(() => {
  localStorage.clear();
});

test('mask overlay preferences normalize persisted mode and opacity', () => {
  localStorage.setItem(
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
  const maskDef: MaskPreviewDefinition = {
    adjustments: {},
    editNodes: createDefaultMaskEditNodes(),
    editNodeSchemaVersion: 1,
    id: 'layer-1',
    invert: false,
    name: 'Layer 1',
    opacity: 100,
    subMasks: [
      {
        id: 'mask-1',
        invert: false,
        mode: SubMaskMode.Additive,
        opacity: 100,
        parameters: {
          density: 0.55,
          edgeContrast: 0.4,
          edgeShiftPx: -3,
          featherPx: 12,
          maskDataBase64: 'already-sent-mask-payload',
          smoothness: 0.2,
        },
        type: Mask.AiSubject,
        visible: true,
      },
    ],
    visible: true,
  };

  const payload = buildMaskOverlayInvokePayload({
    editDocumentV2: createDefaultEditDocumentV2(),
    maskDef,
    maskOverlaySettings: { edgeThreshold: 0.65, mode: 'white', opacity: 0.4 },
    patchesSentToBackend: new Set(['mask-1']),
    renderSize: { height: 240, offsetX: 0, offsetY: 0, scale: 0.5, width: 320 },
  });

  expect(payload?.overlaySettings).toEqual({ edgeThreshold: 0.65, mode: 'white', opacity: 0.4 });
  if (payload === null) throw new Error('Expected mask overlay invoke payload.');
  if (!('subMasks' in payload.maskDef)) throw new Error('Expected mask-container overlay payload.');
  expect(payload.maskDef.subMasks[0]?.parameters).toMatchObject({
    density: 0.55,
    edgeContrast: 0.4,
    edgeShiftPx: -3,
    featherPx: 12,
    maskDataBase64: null,
    smoothness: 0.2,
  });

  const triggerHash = buildMaskOverlayTriggerHash({
    activeMaskDef: maskDef,
    editDocumentV2: createDefaultEditDocumentV2(),
    imageRenderSize: { height: 240, width: 320 },
    maskOverlaySettings: { edgeThreshold: 0.65, mode: 'white', opacity: 0.4 },
  });

  expect(triggerHash).toContain('"maskOverlaySettings":{"edgeThreshold":0.65,"mode":"white","opacity":0.4}');
  expect(triggerHash).toContain('"featherPx":12');
});

test('mask overlay request identity tracks image session, source, render size, and trigger hash', () => {
  const identity = buildMaskOverlayRequestIdentity({
    imageSessionId: 'image-session:a:1',
    renderSize: { height: 240.4, scale: 0.3333333, width: 319.6 },
    selectedImagePath: '/photos/_DSC7505.ARW',
    triggerHash: 'mask-trigger-a',
  });

  expect(identity).toBe(
    JSON.stringify({
      imageSessionId: 'image-session:a:1',
      renderSize: { h: 240, scale: 0.3333, w: 320 },
      selectedImagePath: '/photos/_DSC7505.ARW',
      triggerHash: 'mask-trigger-a',
    }),
  );
});

test('mask overlay stale responses are rejected when a newer request is active', () => {
  const first = buildMaskOverlayRequestIdentity({
    imageSessionId: 'image-session:a:1',
    renderSize: { height: 240, scale: 0.5, width: 320 },
    selectedImagePath: '/photos/_DSC7505.ARW',
    triggerHash: 'mask-trigger-a',
  });
  const latest = buildMaskOverlayRequestIdentity({
    imageSessionId: 'image-session:a:1',
    renderSize: { height: 240, scale: 0.5, width: 320 },
    selectedImagePath: '/photos/_DSC7505.ARW',
    triggerHash: 'mask-trigger-b',
  });

  expect(isMaskOverlayResponseCurrent(latest, first)).toBe(false);
  expect(isMaskOverlayResponseCurrent(latest, latest)).toBe(true);
});

test('mask overlay identity never revives after an A to B to successor-A session replacement', () => {
  const request = (imageSessionId: string, selectedImagePath: string) =>
    buildMaskOverlayRequestIdentity({
      imageSessionId,
      renderSize: { height: 240, scale: 0.5, width: 320 },
      selectedImagePath,
      triggerHash: 'same-mask-content',
    });
  const sourceA = request('image-session:a:1', '/photos/a.ARW');
  const sourceB = request('image-session:b:1', '/photos/b.ARW');
  const successorA = request('image-session:a:2', '/photos/a.ARW');

  expect(isMaskOverlayResponseCurrent(sourceB, sourceA)).toBe(false);
  expect(isMaskOverlayResponseCurrent(successorA, sourceA)).toBe(false);
  expect(isMaskOverlayResponseCurrent(successorA, successorA)).toBe(true);
});
