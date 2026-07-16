import { beforeEach, describe, expect, test } from 'bun:test';

import type { EditDocumentNodeTypeV2, EditDocumentV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { REFERENCE_FILM_PROFILE_REF } from '../../../src/utils/film-look/filmEmulationOperation';
import { buildFilmWorkspaceEditTransactionRequest } from '../../../src/utils/film-look/filmWorkspaceEditTransaction';

const node = (mix: number) => ({
  contractVersion: 1 as const,
  enabled: true,
  mix,
  nodeType: 'film_emulation' as const,
  profileRef: REFERENCE_FILM_PROFILE_REF,
  seedPolicy: 'source_stable_v1' as const,
  workingSpace: 'acescg_linear_v1' as const,
});

const requiredNode = <NodeType extends EditDocumentNodeTypeV2>(document: EditDocumentV2, nodeType: NodeType) =>
  selectEditDocumentNode(document, nodeType);

const seedStore = () => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 9,
    lastEditApplicationReceipt: null,
    history: [editDocumentV2],
  });
};

describe('current Film workspace transaction', () => {
  beforeEach(seedStore);

  test('commits only the pinned Film node and round-trips Undo/Redo', () => {
    const state = useEditorStore.getState();
    const request = buildFilmWorkspaceEditTransactionRequest(state, { filmEmulation: node(0.72) }, 'film-node');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'film_emulation',
        patch: { filmEmulation: node(0.72) },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(result.changedKeys).toEqual(['nodes.film_emulation.params.filmEmulation']);
    expect(result.after.nodes['film_emulation']?.params['filmEmulation']).toEqual(node(0.72));
    expect(requiredNode(result.after, 'film_emulation').params).toEqual({ filmEmulation: node(0.72) });
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toBeNull();
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toEqual(
      node(0.72),
    );
  });

  test('coalesces mix changes into one history entry and removing the node is exact', () => {
    const first = useEditorStore.getState();
    first.applyEditTransaction(buildFilmWorkspaceEditTransactionRequest(first, { filmEmulation: node(1) }, 'enable'));
    for (const mix of [0.9, 0.7, 0.4]) {
      const current = useEditorStore.getState();
      current.applyEditTransaction(
        buildFilmWorkspaceEditTransactionRequest(
          current,
          { filmEmulation: node(mix) },
          'mix-gesture',
          'coalesced-interaction',
        ),
      );
    }
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'film_emulation').params['filmEmulation']?.mix,
    ).toBe(0.4);
    expect(useEditorStore.getState().history).toHaveLength(3);

    const current = useEditorStore.getState();
    current.applyEditTransaction(
      buildFilmWorkspaceEditTransactionRequest(current, { filmEmulation: null }, 'remove-film'),
    );
    expect(useEditorStore.getState().editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toBeNull();
    expect(requiredNode(useEditorStore.getState().editDocumentV2, 'film_emulation').params).toEqual({
      filmEmulation: null,
    });
  });
});
