import { describe, expect, test } from 'bun:test';

import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  editDocumentV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import {
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  resetEditDocumentV2Node,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';

describe('descriptor-owned current nodes', () => {
  test('creates one valid envelope for every current descriptor', () => {
    const document = createDefaultEditDocumentV2();
    expect(editDocumentV2Schema.safeParse(document).success).toBeTrue();
    expect(Object.keys(document.nodes).sort()).toEqual(
      EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => nodeType).sort(),
    );
    for (const descriptor of EDIT_DOCUMENT_NODE_DESCRIPTORS) {
      expect(selectEditDocumentNode(document, descriptor.nodeType)).toMatchObject({
        enabled: true,
        implementationVersion: descriptor.implementationVersion,
        process: 'scene_referred_v2',
        type: descriptor.nodeType,
      });
    }
  });

  test('keeps latent parameters when a node is disabled and re-enabled', () => {
    const edited = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'display_creative', { grainAmount: 38 });
    const disabled = setEditDocumentV2NodeEnabled(edited, 'display_creative', false);
    const reenabled = setEditDocumentV2NodeEnabled(disabled, 'display_creative', true);

    expect(selectEditDocumentNode(disabled, 'display_creative')).toMatchObject({
      enabled: false,
      params: { grainAmount: 38 },
    });
    expect(selectEditDocumentNode(reenabled, 'display_creative').params['grainAmount']).toBe(38);
  });

  test('resets one node without changing unrelated authority', () => {
    const edited = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: 1.25,
    });
    const reset = resetEditDocumentV2Node(edited, 'scene_global_color_tone');

    expect(selectEditDocumentNode(reset, 'scene_global_color_tone').params['exposure']).toBe(0);
    expect(reset.nodes['geometry']).toEqual(edited.nodes['geometry']);
  });
});
