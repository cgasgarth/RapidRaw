import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentV2CopyPayloadSchema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildPresetEditTransaction,
  buildPresetPreviewAdjustments,
  configureEditDocumentPresetPayload,
  createEditDocumentPresetPayload,
  lowerEditDocumentPresetPayload,
  parsePresetLibrary,
  resolveEditDocumentPresetPayload,
} from '../../../src/utils/editDocumentPreset';
import {
  legacyAdjustmentsToEditDocumentV2,
  prepareEditDocumentV2ForRender,
  replaceEditDocumentV2SourceArtifacts,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';

const targetPath = '/fixture/preset-target.ARW';
const session = createEditorImageSession({ generation: 41, path: targetPath, source: 'cache' });
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: targetPath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};

describe('descriptor-derived edit document presets', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), brightness: 0.2, exposure: -0.5 };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('serializes descriptor-approved nodes, disabled state, and optional geometry without source domains', () => {
    const artifacts = replaceEditDocumentV2SourceArtifacts(
      legacyAdjustmentsToEditDocumentV2({
        ...structuredClone(INITIAL_ADJUSTMENTS),
        exposure: 1.25,
        rotation: 3,
      }),
      { aiPatches: [] },
    );
    const source = setEditDocumentV2NodeEnabled(artifacts, 'scene_global_color_tone', false);
    const style = createEditDocumentPresetPayload(source, false, 'style');

    expect(editDocumentV2CopyPayloadSchema.parse(style)).toEqual(style);
    expect(style.nodes.scene_global_color_tone).toMatchObject({ enabled: false, params: { exposure: 1.25 } });
    expect(style.nodes).not.toHaveProperty('geometry');
    expect(style.nodes).not.toHaveProperty('lens_correction');
    expect(style.nodes).not.toHaveProperty('layers');
    expect(style.nodes).not.toHaveProperty('source_artifacts');
    expect(style).not.toHaveProperty('provenance');
    expect(style).not.toHaveProperty('sourceArtifacts');

    const withGeometry = createEditDocumentPresetPayload(source, true, 'style');
    expect(withGeometry.nodes.geometry?.params.rotation).toBe(3);
    expect(withGeometry.nodes).toHaveProperty('lens_correction');
    expect(lowerEditDocumentPresetPayload(withGeometry)).toMatchObject({ exposure: 1.25, rotation: 3 });
  });

  test('tool presets omit enabled defaults but retain disabled default nodes as authored state', () => {
    const defaults = legacyAdjustmentsToEditDocumentV2(structuredClone(INITIAL_ADJUSTMENTS));
    const source = setEditDocumentV2NodeEnabled(defaults, 'scene_global_color_tone', false);
    const tool = createEditDocumentPresetPayload(source, false, 'tool');

    expect(Object.keys(tool.nodes)).toContain('scene_global_color_tone');
    expect(tool.nodes.scene_global_color_tone?.enabled).toBeFalse();
  });

  test('promotes a partial legacy preset against destination authority without changing sibling nodes', () => {
    const destination = useEditorStore.getState().editDocumentV2;
    const cameraInputBefore = destination.nodes.camera_input;
    const payload = resolveEditDocumentPresetPayload(
      { adjustments: { exposure: 0.75 }, includeCropTransform: false },
      destination,
    );
    expect(payload?.nodes.scene_global_color_tone?.params).toMatchObject({ brightness: 0.2, exposure: 0.75 });
    expect(payload?.nodes).not.toHaveProperty('camera_input');
    if (payload === null) throw new Error('Expected promoted legacy preset payload.');

    const state = useEditorStore.getState();
    const request = buildPresetEditTransaction(state, payload, 'preset-apply');
    if (request === null) throw new Error('Expected preset transaction.');
    const result = state.applyEditTransaction(request);
    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'preset' });
    expect(result.after).toMatchObject({ brightness: 0.2, exposure: 0.75 });
    expect(result.afterEditDocumentV2.nodes.camera_input).toBe(cameraInputBefore);
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(-0.5);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0.75);
  });

  test('is exact no-op, reopens strictly, and publishes the same preview/export render node', () => {
    const state = useEditorStore.getState();
    const payload = resolveEditDocumentPresetPayload(
      { adjustments: { exposure: -0.5 }, includeCropTransform: false },
      state.editDocumentV2,
    );
    if (payload === null) throw new Error('Expected preset payload.');
    const request = buildPresetEditTransaction(state, payload, 'preset-no-op');
    if (request === null) throw new Error('Expected preset transaction.');
    const result = state.applyEditTransaction(request);

    expect(result.noOp).toBeTrue();
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();
    const reopened = editDocumentV2CopyPayloadSchema.parse(structuredClone(payload));
    expect(reopened).toEqual(payload);
    const renderDocument = prepareEditDocumentV2ForRender(INITIAL_ADJUSTMENTS, result.afterEditDocumentV2, [
      'scene_global_color_tone',
    ]);
    expect(renderDocument.nodes.scene_global_color_tone).toBe(result.afterEditDocumentV2.nodes.scene_global_color_tone);
    expect(renderDocument.nodes.scene_global_color_tone?.params.exposure).toBe(
      lowerEditDocumentPresetPayload(payload).exposure,
    );
  });

  test('native preview compilation trusts strict V2 authority over a stale legacy mirror', () => {
    const document = legacyAdjustmentsToEditDocumentV2({ ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 1.25 });
    const payload = createEditDocumentPresetPayload(document, false, 'style');
    expect(
      buildPresetPreviewAdjustments({
        adjustments: { exposure: -1.75 },
        editDocumentV2: payload,
        includeCropTransform: false,
      })?.exposure,
    ).toBe(1.25);
    expect(buildPresetPreviewAdjustments({ adjustments: { exposure: 0.5 } })?.exposure).toBe(0.5);
    expect(
      buildPresetPreviewAdjustments({
        adjustments: { exposure: 0.5 },
        editDocumentV2: { nodes: { source_artifacts: document.nodes.source_artifacts }, schemaVersion: 2 } as never,
      }),
    ).toBeNull();
  });

  test('configure migrates legacy state and enforces descriptor policy for style/tool conversion', () => {
    const style = configureEditDocumentPresetPayload(
      { adjustments: { exposure: 1, masks: [{ id: 'legacy-mask' }] }, includeCropTransform: false },
      false,
      'style',
    );
    if (style === null) throw new Error('Expected legacy preset migration.');
    expect(style.nodes.scene_global_color_tone?.params.exposure).toBe(1);
    expect(style.nodes).not.toHaveProperty('layers');
    expect(style.nodes).not.toHaveProperty('source_artifacts');
    expect(style.nodes).not.toHaveProperty('geometry');

    const tool = configureEditDocumentPresetPayload(
      { adjustments: lowerEditDocumentPresetPayload(style), editDocumentV2: style, includeCropTransform: false },
      false,
      'tool',
    );
    if (tool === null) throw new Error('Expected strict V2 preset configuration.');
    expect(tool.nodes.scene_global_color_tone?.params.exposure).toBe(1);
    expect(Object.keys(tool.nodes).length).toBeLessThan(Object.keys(style.nodes).length);
  });

  test('rejects malformed, cross-node, and artifact payloads without legacy fallback', () => {
    const destination = useEditorStore.getState().editDocumentV2;
    expect(
      resolveEditDocumentPresetPayload(
        {
          adjustments: { exposure: 1.75 },
          editDocumentV2: {
            nodes: { source_artifacts: destination.nodes.source_artifacts },
            schemaVersion: 2,
          } as never,
        },
        destination,
      ),
    ).toBeNull();
    expect(
      resolveEditDocumentPresetPayload(
        {
          adjustments: {},
          editDocumentV2: {
            nodes: {
              scene_global_color_tone: { ...destination.nodes.geometry, type: 'geometry' },
            },
            schemaVersion: 2,
          } as never,
        },
        destination,
      ),
    ).toBeNull();
    expect(
      configureEditDocumentPresetPayload(
        {
          adjustments: { exposure: 1.75 },
          editDocumentV2: {
            nodes: { source_artifacts: destination.nodes.source_artifacts },
            schemaVersion: 2,
          } as never,
        },
        false,
        'style',
      ),
    ).toBeNull();
  });

  test('validates native preset and folder payloads while quarantining corrupt explicit V2 authority', () => {
    const destination = useEditorStore.getState().editDocumentV2;
    const validPayload = createEditDocumentPresetPayload(destination, false, 'style');
    const parsed = parsePresetLibrary([
      {
        preset: {
          adjustments: { exposure: -0.5 },
          editDocumentV2: validPayload,
          id: 'valid-v2',
          name: 'Valid V2',
        },
      },
      {
        folder: {
          children: [
            { adjustments: { exposure: 0.25 }, id: 'legacy', name: 'Legacy' },
            {
              adjustments: { exposure: 1.75 },
              editDocumentV2: {
                nodes: { source_artifacts: destination.nodes.source_artifacts },
                schemaVersion: 2,
              },
              id: 'corrupt-v2',
              name: 'Corrupt V2',
            },
          ],
          id: 'folder',
          name: 'Folder',
        },
      },
      { unexpected: true },
    ]);

    expect(parsed.quarantinedCount).toBe(2);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]?.preset?.editDocumentV2).toEqual(validPayload);
    expect(parsed.items[1]?.folder?.children.map((preset) => preset.id)).toEqual(['legacy']);
  });
});
