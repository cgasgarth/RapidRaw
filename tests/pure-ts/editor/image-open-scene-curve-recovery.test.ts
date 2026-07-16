import { describe, expect, test } from 'bun:test';

import {
  beginImageOpenResultSchema,
  loadedMetadataSchema,
  parseLoadedMetadata,
} from '../../../src/schemas/imageLoaderSchemas';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixtures/scene-curve-recovery.ARW';

const objectOnlyOptionalPaths = [
  ['extensions', 'quarantinedNodes'],
  ['nodes', 'film_emulation', 'params', 'filmEmulation', 'stageParams'],
  ['nodes', 'film_emulation', 'params', 'filmEmulation', 'residualLut'],
  ['nodes', 'film_emulation', 'params', 'filmEmulation', 'characteristicCurve'],
  ['nodes', 'film_emulation', 'params', 'filmEmulation', 'characteristicCurve', 'density'],
  ['nodes', 'scene_curve', 'params', 'outputCurveV1'],
  ['nodes', 'scene_curve', 'params', 'sceneCurveV1'],
  ['layers', 'masks', '*', 'referenceMatchApplicationReceipt'],
  ['layers', 'masks', '*', 'retouchCloneSource'],
  ['layers', 'masks', '*', 'retouchRemoveSource'],
  ['layers', 'masks', '*', 'subMasks', '*', 'parameters'],
  ['nodes', 'layers', 'params', 'masks', '*', 'referenceMatchApplicationReceipt'],
  ['nodes', 'layers', 'params', 'masks', '*', 'retouchCloneSource'],
  ['nodes', 'layers', 'params', 'masks', '*', 'retouchRemoveSource'],
  ['nodes', 'layers', 'params', 'masks', '*', 'subMasks', '*', 'parameters'],
  ['sourceArtifacts', 'aiPatches', '*', 'subMasks', '*', 'parameters'],
  ['nodes', 'source_artifacts', 'params', 'aiPatches', '*', 'subMasks', '*', 'parameters'],
] as const;

const setCorruptPath = (root: object, path: readonly string[], invalid: unknown): void => {
  const [segment, ...remainder] = path;
  if (segment === undefined) throw new Error('Object-only corruption path must not be empty.');
  if (remainder.length === 0) {
    Reflect.set(root, segment, invalid);
    return;
  }
  if (segment === '*') throw new Error('A wildcard must follow an array-owning key.');
  const nextIsArray = remainder[0] === '*';
  let child = Reflect.get(root, segment);
  if (nextIsArray) {
    const children: unknown[] = Array.isArray(child) ? child : [];
    if (children.length === 0) children.push({});
    Reflect.set(root, segment, children);
    const first = children[0];
    if (first === null || typeof first !== 'object') throw new Error('Wildcard fixture entry must be an object.');
    setCorruptPath(first, remainder.slice(1), invalid);
    return;
  }
  if (child === null || Array.isArray(child) || typeof child !== 'object') child = {};
  Reflect.set(root, segment, child);
  setCorruptPath(child, remainder, invalid);
};

const validSceneCurve = {
  channelMode: 'luminance_preserving',
  middleGrey: 0.18,
  points: [
    { xEv: -16, yEv: -16 },
    { xEv: 16, yEv: 16 },
  ],
} as const;

const validOutputCurve = {
  domain: 'view_encoded',
  peakNits: 203,
  points: [
    { input: 0, output: 0 },
    { input: 1, output: 1 },
  ],
  sdrReferenceWhiteNits: 203,
  targetIdentity: 'rapid-view-default',
} as const;

const sceneCurveParams = (document: ReturnType<typeof createDefaultEditDocumentV2>) => {
  const sceneCurve = document.nodes['scene_curve'];
  if (sceneCurve === undefined) throw new Error('Default current document omitted scene_curve.');
  return sceneCurve.params;
};

const metadataWithCurveValue = (key: 'outputCurveV1' | 'sceneCurveV1', value: unknown): unknown => {
  const document = structuredClone(createDefaultEditDocumentV2());
  Reflect.set(sceneCurveParams(document), key, value);
  return { adjustments: null, editDocumentV2: document };
};

const beginOpenEnvelope = (metadata: unknown): unknown => ({
  decodeReadyMillis: 20,
  decoded: {
    exif: {},
    height: 80,
    is_raw: true,
    metadata,
    width: 100,
  },
  imageId: sourcePath,
  joinedPrefetch: false,
  metadataFingerprint: 'a'.repeat(64),
  metadataReadyMillis: 2,
  sessionId: { imageSession: 4, selectionGeneration: 4 },
});

describe('scene-curve image-open recovery boundary', () => {
  test('accepts absent and valid current curve objects without relaxing the strict schema', () => {
    const neutral = { adjustments: null, editDocumentV2: createDefaultEditDocumentV2() };
    expect(parseLoadedMetadata(neutral).editDocumentV2?.schemaVersion).toBe(2);

    const document = structuredClone(createDefaultEditDocumentV2());
    const params = sceneCurveParams(document);
    params['sceneCurveV1'] = structuredClone(validSceneCurve);
    params['outputCurveV1'] = structuredClone(validOutputCurve);
    expect(loadedMetadataSchema.parse({ adjustments: null, editDocumentV2: document }).editDocumentV2).toEqual(
      document,
    );
    expect(beginImageOpenResultSchema.parse(beginOpenEnvelope(neutral)).decoded.width).toBe(100);
  });

  test('rejects null, scalar, array, and malformed authority at the strict metadata boundary after transport', () => {
    for (const key of ['sceneCurveV1', 'outputCurveV1'] as const) {
      for (const invalid of [null, 0.5, 'curve', false, [0, 1], { domain: 'view_encoded' }]) {
        const metadata = metadataWithCurveValue(key, invalid);
        expect(loadedMetadataSchema.safeParse(metadata).success).toBeFalse();
        const transported = beginImageOpenResultSchema.parse(beginOpenEnvelope(metadata));
        expect(() => parseLoadedMetadata(transported.decoded.metadata)).toThrow();
      }
    }
  });

  test('keeps native object-only optional inventory in strict Zod parity across current document mirrors', () => {
    expect(objectOnlyOptionalPaths).toHaveLength(17);
    for (const path of objectOnlyOptionalPaths) {
      for (const invalid of [null, false, 0.5, 'object', [0, 1]]) {
        const document = structuredClone(createDefaultEditDocumentV2());
        setCorruptPath(document, path, invalid);
        const metadata = { editDocumentV2: document };
        expect(
          loadedMetadataSchema.safeParse(metadata).success,
          `${path.join('.')} accepted ${JSON.stringify(invalid)}`,
        ).toBeFalse();
        const transported = beginImageOpenResultSchema.parse(beginOpenEnvelope(metadata));
        expect(() => parseLoadedMetadata(transported.decoded.metadata), path.join('.')).toThrow();
      }
    }
  });

  test('rejects unquarantined future curve authority while retaining a neutral current document', () => {
    const future = structuredClone(createDefaultEditDocumentV2());
    Reflect.set(sceneCurveParams(future), 'futureCurveV3', { schemaVersion: 3 });
    expect(loadedMetadataSchema.safeParse({ adjustments: null, editDocumentV2: future }).success).toBeFalse();

    const recovered = parseLoadedMetadata({ adjustments: null, editDocumentV2: createDefaultEditDocumentV2() });
    if (recovered.editDocumentV2 === null || recovered.editDocumentV2 === undefined) {
      throw new Error('Recovered metadata omitted its neutral current document.');
    }
    const params = sceneCurveParams(recovered.editDocumentV2);
    expect(params).not.toHaveProperty('futureCurveV3');
    expect(params).not.toHaveProperty('sceneCurveV1');
    expect(params).not.toHaveProperty('outputCurveV1');
  });
});
