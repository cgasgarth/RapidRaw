import { beforeEach, expect, test } from 'bun:test';
import { buildPresetEditTransaction, resolveEditDocumentPresetPayload } from '../../../src/utils/editDocumentPreset';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  PRESET_BROWSER_MEMORY_KEY,
  readPresetBrowserMemory,
  writePresetBrowserMemory,
} from '../../../src/utils/presetBrowserMemory';

beforeEach(() => {
  localStorage.clear();
});

test('left-rail preset browser persists bounded favorites and recent usage separately from edit authority', () => {
  writePresetBrowserMemory({ favorites: ['look-a', 'look-a', 'look-b'], recent: { 'look-a': 10, 'look-b': 20 } });

  expect(readPresetBrowserMemory()).toEqual({
    favorites: ['look-a', 'look-a', 'look-b'],
    recent: { 'look-a': 10, 'look-b': 20 },
  });
  expect(localStorage.getItem(PRESET_BROWSER_MEMORY_KEY)).toContain('look-a');
});

test('left-rail apply lowers only strict current-node preset payloads into one transaction', () => {
  const destination = createDefaultEditDocumentV2();
  const source = patchEditDocumentV2Node(destination, 'scene_global_color_tone', { exposure: 0.75 });
  const toneNode = Object.entries(source.nodes).find(([nodeType]) => nodeType === 'scene_global_color_tone')?.[1];
  if (toneNode === undefined) throw new Error('Expected tone node.');
  const preset = {
    editDocumentV2: { nodes: { scene_global_color_tone: toneNode }, schemaVersion: 2 as const },
    includeCropTransform: false,
  };
  const payload = resolveEditDocumentPresetPayload(preset, destination);
  if (payload === null) throw new Error('Expected strict preset payload.');
  const request = buildPresetEditTransaction(
    { adjustmentRevision: 3, editDocumentV2: destination, imageSession: { id: 'image:1' }, imageSessionId: 1 },
    payload,
    'preset-browser-apply',
  );

  expect(request?.source).toBe('preset');
  expect(request?.history).toBe('single-entry');
  expect(request?.operations).toHaveLength(1);
  expect(request?.operations[0]?.type).toBe('replace-edit-document-node');
});
