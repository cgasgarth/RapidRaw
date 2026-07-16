import { describe, expect, test } from 'bun:test';
import type {
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeTypeV2,
  EditDocumentV2,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import {
  compileEditDocumentNodeV2,
  compileEditDocumentV2,
  editDocumentSourceArtifactsV2Schema,
  editDocumentV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  batchUpdateEditDocumentV2Nodes,
  buildEditDocumentV2Diagnostics,
  copyEditDocumentV2Node,
  copyEditDocumentV2Nodes,
  editDocumentV2NodeInventory,
  legacyAdjustmentsToEditDocumentV2,
  lowerEditDocumentV2CopyPayloadToLegacyAdjustments,
  pasteEditDocumentV2Node,
  prepareEditDocumentV2ForRender,
  replaceEditDocumentV2SourceArtifacts,
  resetEditDocumentV2Node,
  selectEditDocumentV2CopyPayload,
  setEditDocumentV2NodeEnabled,
  updateEditDocumentV2Node,
} from '../../../src/utils/editDocumentV2';
import { referenceMatchReceipt, sourcePatch } from './authority-fixtures';

const requireNode = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentNodeEnvelopeV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`expected ${nodeType} fixture`);
  return node;
};

describe('EditDocumentV2 batch reset and clipboard', () => {
  test('batch edits honor descriptor capability and preserve each document domain', () => {
    const documents = [
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.1 }),
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.2 }),
    ];
    const updated = batchUpdateEditDocumentV2Nodes(documents, 'scene_global_color_tone', (params, index) => ({
      ...params,
      exposure: index + 1,
    }));
    expect(updated?.map((document) => requireNode(document, 'scene_global_color_tone').params['exposure'])).toEqual([
      1, 2,
    ]);
    expect(updated?.[0]?.nodes['geometry']).toEqual(documents[0]?.nodes['geometry']);
    expect(batchUpdateEditDocumentV2Nodes(documents, 'layers', () => ({}))).toBeNull();
    expect(batchUpdateEditDocumentV2Nodes(documents, 'source_artifacts', () => ({}))).toBeNull();
  });

  test('diagnostics expose node ownership, migration, quarantine, and render fingerprints', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.75 });
    const diagnostics = buildEditDocumentV2Diagnostics({
      ...document,
      extensions: { ...document.extensions, quarantinedNodes: { future_color_v9: { enabled: true } } },
      nodes: {
        ...document.nodes,
        scene_curve: { ...requireNode(document, 'scene_curve'), enabled: false },
      },
    });

    expect(diagnostics.schemaVersion).toBe(2);
    expect(diagnostics.activeNodeTypes).toEqual(editDocumentV2NodeInventory(document));
    expect(diagnostics.legacyNodeTypes).toEqual([]);
    expect(diagnostics.nodeDiagnostics.find(({ nodeType }) => nodeType === 'scene_curve')?.status).toBe('disabled');
    expect(diagnostics.quarantinedNodeTypes).toEqual(['future_color_v9']);
    expect(diagnostics.renderStageFingerprints[0]?.fingerprint).toContain('source_decode');
  });

  test('reset uses descriptor defaults and preserves unrelated domains', () => {
    const document = legacyAdjustmentsToEditDocumentV2({
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure: 1.5,
      contrast: 0.25,
    });
    const reset = resetEditDocumentV2Node(document, 'scene_global_color_tone');

    expect(requireNode(reset, 'scene_global_color_tone').params).toEqual({
      blacks: 0,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
    });
    expect(requireNode(reset, 'geometry')).toEqual(requireNode(document, 'geometry'));
    expect(reset.provenance).toEqual(document.provenance);
  });

  test('non-resettable source artifacts remain unchanged', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(resetEditDocumentV2Node(document, 'source_artifacts')).toEqual(document);
  });

  test('source-artifact replacement is atomic and structurally isolates unrelated nodes', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const next = replaceEditDocumentV2SourceArtifacts(document, { aiPatches: [sourcePatch] });

    expect(next.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
    expect(requireNode(next, 'source_artifacts').params).toEqual(next.sourceArtifacts);
    expect(requireNode(next, 'scene_global_color_tone')).toBe(requireNode(document, 'scene_global_color_tone'));
    expect(requireNode(next, 'geometry')).toBe(requireNode(document, 'geometry'));
    expect(next.provenance).toEqual(document.provenance);
  });

  test('focused source-artifact updates and render preparation mirror node authority into the explicit domain', () => {
    const prepared = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const authoritative = updateEditDocumentV2Node(prepared, 'source_artifacts', (params) => ({
      ...params,
      aiPatches: [sourcePatch],
    }));
    expect(authoritative.sourceArtifacts).toEqual(
      editDocumentSourceArtifactsV2Schema.parse(requireNode(authoritative, 'source_artifacts').params),
    );

    const rendered = prepareEditDocumentV2ForRender(INITIAL_ADJUSTMENTS, authoritative, ['source_artifacts']);
    expect(requireNode(rendered, 'source_artifacts')).toBe(requireNode(authoritative, 'source_artifacts'));
    expect(rendered.sourceArtifacts).toEqual(authoritative.sourceArtifacts);
    expect(rendered.sourceArtifacts.aiPatches).toEqual([sourcePatch]);
  });

  test('copy and paste derive eligibility from descriptors and isolate node state', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.5 });
    const clipboard = copyEditDocumentV2Node(document, 'scene_global_color_tone');
    expect(clipboard).not.toBeNull();
    if (clipboard === null) throw new Error('expected scene tone clipboard fixture');
    expect(clipboard.params['exposure']).toBe(0.5);
    clipboard.params['exposure'] = 2;
    expect(requireNode(document, 'scene_global_color_tone').params['exposure']).toBe(0.5);

    const pasted = pasteEditDocumentV2Node(document, 'scene_global_color_tone', clipboard);
    expect(requireNode(pasted, 'scene_global_color_tone').params['exposure']).toBe(2);
    expect(requireNode(pasted, 'geometry')).toBe(requireNode(document, 'geometry'));
    expect(pasted.provenance).toBe(document.provenance);
    expect(copyEditDocumentV2Node(document, 'source_artifacts')).toBeNull();
  });

  test('builds a descriptor-only multi-node clipboard and lowers only approved compatibility fields', () => {
    const withArtifacts = replaceEditDocumentV2SourceArtifacts(
      legacyAdjustmentsToEditDocumentV2({
        ...structuredClone(INITIAL_ADJUSTMENTS),
        exposure: 1.25,
        referenceMatchApplicationReceipt: referenceMatchReceipt,
      }),
      { aiPatches: [sourcePatch] },
    );
    const source = setEditDocumentV2NodeEnabled(withArtifacts, 'scene_global_color_tone', false);
    const clipboard = copyEditDocumentV2Nodes(source);

    expect(Object.keys(clipboard.nodes)).toContain('scene_global_color_tone');
    expect(clipboard.nodes['scene_global_color_tone']).toMatchObject({ enabled: false, params: { exposure: 1.25 } });
    expect(clipboard.nodes).not.toHaveProperty('layers');
    expect(clipboard.nodes).not.toHaveProperty('source_artifacts');
    expect(clipboard).not.toHaveProperty('provenance');
    expect(clipboard).not.toHaveProperty('sourceArtifacts');

    const selected = selectEditDocumentV2CopyPayload(clipboard, ['scene_global_color_tone'], true);
    expect(Object.keys(selected.nodes)).toEqual(['scene_global_color_tone']);
    expect(selected.nodes['scene_global_color_tone']?.enabled).toBeFalse();
    expect(lowerEditDocumentV2CopyPayloadToLegacyAdjustments(selected)).toMatchObject({ exposure: 1.25 });
    expect(lowerEditDocumentV2CopyPayloadToLegacyAdjustments(selected)).not.toHaveProperty(
      'referenceMatchApplicationReceipt',
    );
  });

  test('preserves disabled state and unrelated structural identity across paste and reopen authority', () => {
    const source = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 2 }),
      'scene_global_color_tone',
      false,
    );
    const clipboard = copyEditDocumentV2Nodes(source, ['scene_global_color_tone']);
    const destination = replaceEditDocumentV2SourceArtifacts(
      legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: -1 }),
      { aiPatches: [sourcePatch] },
    );
    const pasted = pasteEditDocumentV2Node(
      destination,
      'scene_global_color_tone',
      clipboard.nodes['scene_global_color_tone'],
    );

    expect(requireNode(pasted, 'scene_global_color_tone')).toMatchObject({ enabled: false, params: { exposure: 2 } });
    expect(requireNode(pasted, 'geometry')).toBe(requireNode(destination, 'geometry'));
    expect(requireNode(pasted, 'layers')).toBe(requireNode(destination, 'layers'));
    expect(requireNode(pasted, 'source_artifacts')).toBe(requireNode(destination, 'source_artifacts'));
    expect(pasted.sourceArtifacts).toBe(destination.sourceArtifacts);
    expect(editDocumentV2Schema.parse(structuredClone(pasted))).toEqual(pasted);
    expect(
      prepareEditDocumentV2ForRender(INITIAL_ADJUSTMENTS, pasted, ['scene_global_color_tone']).nodes,
    ).toHaveProperty('scene_global_color_tone.enabled', false);
  });

  test('rejects malformed or cross-node clipboard payloads without mutation', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(
      pasteEditDocumentV2Node(document, 'scene_global_color_tone', {
        enabled: true,
        implementationVersion: 1,
        params: { exposure: 2 },
        process: 'scene_referred_v2',
        type: 'geometry',
      }),
    ).toEqual(document);
    expect(pasteEditDocumentV2Node(document, 'scene_global_color_tone', { invalid: true })).toEqual(document);
  });

  test('compiles graph nodes in descriptor order with render-stage authority', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    const compiled = compileEditDocumentV2(document);
    expect(compiled.map(({ nodeType }) => nodeType)).toEqual([...editDocumentV2NodeInventory(document)]);
    expect(compiled.find(({ nodeType }) => nodeType === 'geometry')).toMatchObject({
      nodeType: 'geometry',
      process: 'scene_referred_v2',
      renderStage: 'geometry',
    });
  });

  test('rejects unsupported node process/version before render compilation', () => {
    const document = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
    expect(() =>
      compileEditDocumentNodeV2({
        ...requireNode(document, 'geometry'),
        process: 'legacy_pipeline_v1',
      }),
    ).toThrow();
    expect(() =>
      compileEditDocumentNodeV2({
        ...requireNode(document, 'geometry'),
        implementationVersion: 2,
      }),
    ).toThrow('unsupported version');
    expect(() =>
      compileEditDocumentNodeV2({
        ...requireNode(document, 'scene_global_color_tone'),
        params: { ...requireNode(document, 'scene_global_color_tone').params, exposure: 6 },
      }),
    ).toThrow();
  });
});
