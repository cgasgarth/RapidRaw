import { describe, expect, test } from 'bun:test';

import {
  copyPasteSettingsSchema,
  createDefaultCopyPasteSettings,
  resolveCopyPasteSettings,
} from '../../../src/schemas/copyPasteSettingsSchemas';
import { PasteMode } from '../../../src/utils/adjustments';
import { EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES } from '../../../src/utils/editDocumentV2';

describe('copy/paste settings current node contract', () => {
  test('accepts empty, full, and every individual current node under both paste modes', () => {
    for (const pasteMode of [PasteMode.Merge, PasteMode.Replace]) {
      for (const selectedNodeIds of [
        [],
        [...EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES],
        ...EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES.map((nodeId) => [nodeId]),
      ]) {
        expect(copyPasteSettingsSchema.parse({ pasteMode, selectedNodeIds })).toEqual({ pasteMode, selectedNodeIds });
      }
    }
  });

  test('rejects legacy fields, unknown keys, noncopyable nodes, duplicates, and malformed modes', () => {
    const invalidSettings: unknown[] = [
      { includedAdjustments: ['exposure'], knownAdjustments: ['exposure'], mode: 'merge' },
      { pasteMode: 'merge', selectedNodeIds: ['future_node'] },
      { pasteMode: 'merge', selectedNodeIds: ['layers'] },
      { pasteMode: 'merge', selectedNodeIds: ['scene_curve', 'scene_curve'] },
      { pasteMode: 'append', selectedNodeIds: [] },
      { pasteMode: 'merge', selectedNodeIds: [], unexpected: true },
    ];

    for (const settings of invalidSettings) expect(copyPasteSettingsSchema.safeParse(settings).success).toBeFalse();
  });

  test('resets invalid state deterministically without treating an empty selection as invalid', () => {
    const defaults = createDefaultCopyPasteSettings();
    expect(resolveCopyPasteSettings({ mode: 'merge', includedAdjustments: ['exposure'] })).toEqual({
      settings: defaults,
      wasReset: true,
    });
    expect(resolveCopyPasteSettings({ pasteMode: 'replace', selectedNodeIds: [] })).toEqual({
      settings: { pasteMode: PasteMode.Replace, selectedNodeIds: [] },
      wasReset: false,
    });
    expect(createDefaultCopyPasteSettings()).toEqual(defaults);
    expect(defaults.selectedNodeIds).not.toContain('geometry');
    expect(defaults.selectedNodeIds).not.toContain('lens_correction');
  });
});
