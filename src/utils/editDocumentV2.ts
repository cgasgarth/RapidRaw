import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  editDocumentV2Schema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';

const NODE_FIELDS: Record<EditDocumentNodeTypeV2, readonly string[]> = {
  camera_input: ['cameraProfile', 'temperature', 'tint', 'whiteBalance'],
  detail_denoise_dehaze: [
    'clarity',
    'colorNoiseReduction',
    'dehaze',
    'denoiseContrastProtection',
    'denoiseDetail',
    'denoiseNaturalGrain',
    'denoiseShadowBias',
    'lumaNoiseReduction',
    'sharpness',
  ],
  display_creative: ['filmCurve', 'grainAmount', 'halationAmount', 'lutIntensity', 'vignetteAmount'],
  geometry: ['aspectRatio', 'crop', 'flipHorizontal', 'flipVertical', 'orientationSteps', 'rotation'],
  layers: ['masks'],
  scene_curve: ['outputToneCurve', 'sceneCurve', 'toneCurve'],
  scene_global_color_tone: [
    'blacks',
    'brightness',
    'contrast',
    'exposure',
    'highlights',
    'saturation',
    'shadows',
    'whites',
  ],
  source_artifacts: ['aiPatches', 'generatedProfile', 'referenceMatchApplicationReceipt'],
};

const descriptorFor = (nodeType: EditDocumentNodeTypeV2) =>
  EDIT_DOCUMENT_NODE_DESCRIPTORS.find((descriptor) => descriptor.nodeType === nodeType);

const isNodeField = (key: string): boolean => Object.values(NODE_FIELDS).some((fields) => fields.includes(key));

export const legacyAdjustmentsToEditDocumentV2 = (adjustments: Adjustments): EditDocumentV2 => {
  const entries = Object.entries(adjustments);
  const nodes = Object.fromEntries(
    EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => {
      const fields = NODE_FIELDS[nodeType];
      const params = Object.fromEntries(entries.filter(([key]) => (fields ?? []).includes(key)));
      const descriptor = descriptorFor(nodeType);
      return [
        nodeType,
        {
          enabled: true,
          implementationVersion: descriptor?.implementationVersion ?? 1,
          params,
          process: descriptor?.process ?? 'scene_referred_v2',
          type: nodeType,
        },
      ];
    }),
  );
  const legacyAdjustments = Object.fromEntries(entries.filter(([key]) => !isNodeField(key)));
  return editDocumentV2Schema.parse({
    extensions: { legacyAdjustments },
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    geometry: nodes['geometry']?.params ?? {},
    graphProcess: 'scene_referred_v2',
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    layers: nodes['layers']?.params ?? {},
    nodes,
    provenance: {},
    schemaVersion: 2,
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    sourceArtifacts: nodes['source_artifacts']?.params ?? {},
  });
};

export const editDocumentV2ToLegacyAdjustments = (document: EditDocumentV2): Adjustments => {
  const parsed = editDocumentV2Schema.parse(document);
  // biome-ignore lint/complexity/useLiteralKeys: extensions intentionally quarantines future keys.
  const legacy = parsed.extensions['legacyAdjustments'];
  const nodeValues = Object.values(parsed.nodes).flatMap((node) => Object.entries(node.params));
  return Object.fromEntries([
    ...Object.entries(legacy && typeof legacy === 'object' ? legacy : {}),
    ...nodeValues,
  ]) as Adjustments;
};

export const editDocumentV2NodeInventory = (document: EditDocumentV2): readonly EditDocumentNodeTypeV2[] =>
  Object.keys(document.nodes) as EditDocumentNodeTypeV2[];
