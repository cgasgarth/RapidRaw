import { describe, expect, test } from 'bun:test';

import { editDocumentV2CopyPayloadSchema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import {
  applyEditDocumentV2CopyPayload,
  batchUpdateEditDocumentV2Nodes,
  buildEditDocumentV2Diagnostics,
  copyEditDocumentV2Nodes,
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  resetEditDocumentV2Node,
  selectEditDocumentV2CopyPayload,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';

describe('EditDocumentV2 batch, reset, and clipboard', () => {
  test('batch edits only descriptor-approved nodes', () => {
    const documents = [
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 0.1 }),
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 0.2 }),
    ];
    const updated = batchUpdateEditDocumentV2Nodes(documents, 'scene_global_color_tone', (params, index) => ({
      ...params,
      exposure: index + 1,
    }));
    expect(updated?.map((document) => requireNode(document, 'scene_global_color_tone').params['exposure'])).toEqual([
      1, 2,
    ]);
    expect(updated?.[0]?.nodes['geometry']).toEqual(documents[0]?.nodes['geometry']);
    expect(batchUpdateEditDocumentV2Nodes(documents, 'layers', (params) => params)).toBeNull();
    expect(batchUpdateEditDocumentV2Nodes(documents, 'source_artifacts', (params) => params)).toBeNull();
  });

  test('reset restores typed defaults while preserving unrelated nodes', () => {
    const edited = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      contrast: 20,
      exposure: 1.5,
    });
    const reset = resetEditDocumentV2Node(edited, 'scene_global_color_tone');

    expect(selectEditDocumentNode(reset, 'scene_global_color_tone').params).toMatchObject({ contrast: 0, exposure: 0 });
    expect(reset.nodes['geometry']).toEqual(edited.nodes['geometry']);
  });

  test('clipboard contains only selected current nodes and strips provenance', () => {
    const edited = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 0.8 });
    const payload = copyEditDocumentV2Nodes(edited, ['scene_global_color_tone', 'geometry', 'layers']);

    expect(editDocumentV2CopyPayloadSchema.safeParse(payload).success).toBeTrue();
    expect(Object.keys(payload.nodes)).toEqual(['scene_global_color_tone', 'geometry']);
    expect(payload).not.toHaveProperty('provenance');
  });

  test('clipboard filtering can omit default nodes', () => {
    const payload = copyEditDocumentV2Nodes(createDefaultEditDocumentV2(), [
      'scene_global_color_tone',
      'display_creative',
    ]);
    const filtered = selectEditDocumentV2CopyPayload(payload, ['scene_global_color_tone', 'display_creative'], true);
    expect(filtered.nodes).toEqual({});
  });

  test('applying a clipboard is atomic and preserves unselected authority', () => {
    const source = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', { exposure: 1.2 });
    const target = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', { rotation: 4 });
    const applied = applyEditDocumentV2CopyPayload(
      target,
      copyEditDocumentV2Nodes(source, ['scene_global_color_tone']),
    );

    expect(selectEditDocumentNode(applied, 'scene_global_color_tone').params['exposure']).toBe(1.2);
    expect(applied.geometry.rotation).toBe(4);
  });

  test('diagnostics report disabled and quarantined nodes without legacy ownership', () => {
    const base = setEditDocumentV2NodeEnabled(createDefaultEditDocumentV2(), 'scene_curve', false);
    const diagnostics = buildEditDocumentV2Diagnostics({
      ...base,
      extensions: { quarantinedNodes: { future_color_v9: { enabled: true } } },
    });

    expect(diagnostics.nodeDiagnostics.find(({ nodeType }) => nodeType === 'scene_curve')?.status).toBe('disabled');
    expect(diagnostics.quarantinedNodeTypes).toEqual(['future_color_v9']);
    expect(diagnostics.legacyNodeTypes).toEqual([]);
  });
});
