import { describe, expect, test } from 'bun:test';

import { compileEditDocumentNodeV2, editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

describe('current document render handoff', () => {
  test('compiles the exact typed node values without a flat preparation layer', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      contrast: 14,
      exposure: 0.75,
    });
    const compiled = compileEditDocumentNodeV2(document.nodes['scene_global_color_tone']);

    expect(compiled).toMatchObject({
      enabled: true,
      implementationVersion: 1,
      nodeType: 'scene_global_color_tone',
      params: { contrast: 14, exposure: 0.75 },
      process: 'scene_referred_v2',
      renderStage: 'scene_global_color_tone',
    });
    expect(document.extensions).toEqual({});
  });

  test('keeps synchronized domains identical to their node params', () => {
    const document = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', { rotation: 4.5 });
    expect(JSON.stringify(document.geometry)).toBe(JSON.stringify(document.nodes['geometry']!.params));
    expect(JSON.stringify(document.layers)).toBe(JSON.stringify(document.nodes['layers']!.params));
    expect(JSON.stringify(document.sourceDecode)).toBe(JSON.stringify(document.nodes['source_decode']!.params));
    expect(JSON.stringify(document.sourceArtifacts)).toBe(JSON.stringify(document.nodes['source_artifacts']!.params));
  });

  test('fails closed for non-current graph processes and unknown top-level fields', () => {
    const document = createDefaultEditDocumentV2();
    expect(
      editDocumentV2Schema.safeParse({ ...document, graphProcess: 'legacy_display_referred' }).success,
    ).toBeFalse();
    expect(editDocumentV2Schema.safeParse({ ...document, adjustments: { exposure: 1 } }).success).toBeFalse();
  });
});
