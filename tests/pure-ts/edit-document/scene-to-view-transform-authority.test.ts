import { describe, expect, test } from 'bun:test';

import { compileEditDocumentNodeV2, editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

describe('scene-to-view transform authority', () => {
  test('stores tone mapping and view transform in one typed node', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_to_view_transform', {
      toneMapper: 'agx',
      viewTransform: {
        ...selectEditDocumentNode(createDefaultEditDocumentV2(), 'scene_to_view_transform').params['viewTransform'],
        contrast: 1.25,
      },
    });
    expect(selectEditDocumentNode(document, 'scene_to_view_transform').params).toMatchObject({
      toneMapper: 'agx',
      viewTransform: { contrast: 1.25 },
    });
    expect(compileEditDocumentNodeV2(document.nodes['scene_to_view_transform'])).toMatchObject({
      nodeType: 'scene_to_view_transform',
      renderStage: 'scene_to_view_transform',
    });
  });

  test('rejects removed graph processes and top-level transform mirrors', () => {
    const document = createDefaultEditDocumentV2();
    expect(editDocumentV2Schema.safeParse({ ...document, graphProcess: 'display_referred_v1' }).success).toBeFalse();
    expect(editDocumentV2Schema.safeParse({ ...document, toneMapper: 'basic' }).success).toBeFalse();
  });
});
