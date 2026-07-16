import { describe, expect, test } from 'bun:test';

import { editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentAiPatches, selectEditDocumentMasks } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { sourcePatch } from './authority-fixtures';

describe('current source and layer authority', () => {
  test('stores source artifacts and layers in synchronized typed domains', () => {
    const withPatch = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'source_artifacts', {
      aiPatches: [sourcePatch],
    });
    const mask = {
      adjustments: {},
      editNodeSchemaVersion: 1 as const,
      editNodes: {
        basic: { enabled: true },
        color: { enabled: true },
        curves: { enabled: true },
        details: { enabled: true },
      },
      id: 'layer-1',
      invert: false,
      name: 'Layer 1',
      opacity: 100,
      subMasks: [],
      visible: true,
    };
    const document = patchEditDocumentV2Node(withPatch, 'layers', { masks: [mask] });

    expect(selectEditDocumentAiPatches(document)).toEqual([sourcePatch]);
    expect(selectEditDocumentMasks(document)).toMatchObject([mask]);
    expect(JSON.stringify(document.sourceArtifacts)).toBe(JSON.stringify(document.nodes['source_artifacts']!.params));
    expect(JSON.stringify(document.layers)).toBe(JSON.stringify(document.nodes['layers']!.params));
  });

  test('rejects flat artifact and layer ownership', () => {
    const document = createDefaultEditDocumentV2();
    expect(editDocumentV2Schema.safeParse({ ...document, aiPatches: [sourcePatch] }).success).toBeFalse();
    expect(editDocumentV2Schema.safeParse({ ...document, masks: [] }).success).toBeFalse();
  });

  test('preserves unrelated source and layer identities', () => {
    const before = createDefaultEditDocumentV2();
    const after = patchEditDocumentV2Node(before, 'source_artifacts', { aiPatches: [sourcePatch] });
    expect(after.layers).toBe(before.layers);
    expect(after.geometry).toBe(before.geometry);
    expect(after.sourceArtifacts).not.toBe(before.sourceArtifacts);
  });
});
