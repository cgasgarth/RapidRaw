import { describe, expect, test } from 'bun:test';
import type {
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeTypeV2,
  EditDocumentV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  EDIT_DOCUMENT_SCENE_TO_VIEW_TRANSFORM_DEFAULTS,
  editDocumentSceneToViewTransformV2Schema,
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  copyEditDocumentV2Node,
  editDocumentV2ToLegacyAdjustments,
  legacyAdjustmentsToEditDocumentV2,
  pasteEditDocumentV2Node,
  prepareEditDocumentV2ForRender,
  resetEditDocumentV2Node,
} from '../../../src/utils/editDocumentV2';
import { buildAdjustmentMutationOperations, reduceEditTransaction } from '../../../src/utils/editTransaction';

const requireNode = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentNodeEnvelopeV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`expected ${nodeType} fixture`);
  return node;
};

describe('scene-to-view transform edit-document authority', () => {
  test('owns strict current-head defaults instead of legacy extensions', () => {
    const document = legacyAdjustmentsToEditDocumentV2(structuredClone(INITIAL_ADJUSTMENTS));
    const node = requireNode(document, 'scene_to_view_transform');

    expect(node.params).toEqual(EDIT_DOCUMENT_SCENE_TO_VIEW_TRANSFORM_DEFAULTS);
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('toneMapper');
    expect(document.extensions['legacyAdjustments']).not.toHaveProperty('viewTransform');
    expect(getEditDocumentNodeDescriptor('scene_to_view_transform')).toMatchObject({
      editorSection: 'basic',
      legacyFields: ['toneMapper', 'viewTransform'],
      process: 'scene_referred_v2',
      renderStage: 'scene_to_view_transform',
    });

    expect(
      editDocumentSceneToViewTransformV2Schema.safeParse({
        ...structuredClone(EDIT_DOCUMENT_SCENE_TO_VIEW_TRANSFORM_DEFAULTS),
        obsoleteCompatibilityMode: true,
      }).success,
    ).toBeFalse();
    expect(
      editDocumentSceneToViewTransformV2Schema.safeParse({
        ...structuredClone(EDIT_DOCUMENT_SCENE_TO_VIEW_TRANSFORM_DEFAULTS),
        viewTransform: {
          ...structuredClone(EDIT_DOCUMENT_SCENE_TO_VIEW_TRANSFORM_DEFAULTS.viewTransform),
          sourceBlackEv: -4,
          sourceWhiteEv: 1.5,
        },
      }).success,
    ).toBeFalse();
  });

  test('routes tone-mapper edits through one focused transaction with structural sharing', () => {
    const document = legacyAdjustmentsToEditDocumentV2(structuredClone(INITIAL_ADJUSTMENTS));
    const before = editDocumentV2ToLegacyAdjustments(document);
    const viewTransform = { ...before.viewTransform, contrast: 1.6, shoulder: 0.8 };
    const after = { ...before, toneMapper: 'rapidView' as const, viewTransform };
    const operations = buildAdjustmentMutationOperations(before, after, document);

    expect(operations).toEqual([
      {
        nodeType: 'scene_to_view_transform',
        patch: { viewTransform },
        type: 'patch-edit-document-node',
      },
    ]);

    const result = reduceEditTransaction(
      document,
      0,
      {
        baseAdjustmentRevision: 0,
        history: 'single-entry',
        imageSessionId: 'scene-to-view-test',
        operations,
        persistence: 'commit',
        source: 'manual-control',
        transactionId: 'scene-to-view-test-1',
      },
      'scene-to-view-test',
    );

    expect(requireNode(result.afterEditDocumentV2, 'scene_to_view_transform').params).toMatchObject({
      toneMapper: 'rapidView',
      viewTransform: { contrast: 1.6, shoulder: 0.8 },
    });
    expect(requireNode(result.afterEditDocumentV2, 'scene_global_color_tone')).toBe(
      requireNode(document, 'scene_global_color_tone'),
    );
    expect(result.after.viewTransform).toEqual(viewTransform);
    expect(result.changedKeys).toEqual(['viewTransform']);
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
  });

  test('renders, copies, pastes, and resets from the node envelope', () => {
    const source = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      toneMapper: 'rapidView',
      viewTransform: { ...structuredClone(INITIAL_ADJUSTMENTS.viewTransform), contrast: 1.7, toe: 0.7 },
    });
    const clipboard = copyEditDocumentV2Node(source, 'scene_to_view_transform');
    if (clipboard === null) throw new Error('expected scene-to-view clipboard fixture');

    const destination = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      toneMapper: 'basic',
    });
    const pasted = pasteEditDocumentV2Node(destination, 'scene_to_view_transform', clipboard);
    const rendered = prepareEditDocumentV2ForRender(structuredClone(INITIAL_ADJUSTMENTS), pasted, [
      'scene_to_view_transform',
    ]);

    expect(requireNode(rendered, 'scene_to_view_transform')).toBe(requireNode(pasted, 'scene_to_view_transform'));
    expect(editDocumentV2ToLegacyAdjustments(rendered)).toMatchObject({
      toneMapper: 'rapidView',
      viewTransform: { contrast: 1.7, toe: 0.7 },
    });
    expect(requireNode(rendered, 'scene_global_color_tone')).toEqual(
      requireNode(legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS), 'scene_global_color_tone'),
    );

    const reset = resetEditDocumentV2Node(pasted, 'scene_to_view_transform');
    expect(requireNode(reset, 'scene_to_view_transform').params).toEqual(
      EDIT_DOCUMENT_SCENE_TO_VIEW_TRANSFORM_DEFAULTS,
    );
    expect(requireNode(reset, 'scene_global_color_tone')).toEqual(requireNode(pasted, 'scene_global_color_tone'));
    expect(editDocumentV2Schema.parse(reset)).toEqual(reset);
  });
});
