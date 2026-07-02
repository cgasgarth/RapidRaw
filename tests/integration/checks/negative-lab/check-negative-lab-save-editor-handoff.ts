#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { negativeLabSavedPositiveHandoffSchema } from '../../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildDustCandidateHealLayer } from '../../../../src/utils/dustCandidateHealLayer.ts';
import {
  consumePendingNegativeConversionDustHealLayers,
  consumePendingNegativeConversionSavedPositiveHandoff,
  handleNegativeConversionEditorHandoff,
} from '../../../../src/utils/negative-lab/negativeLabEditorHandoff.ts';

const savedPath = '/proof-roll/negative-lab/frame_001_Positive.tiff';
const sourcePath = '/proof-roll/negative-lab/frame_001.CR3';

const savedPositiveHandoff = negativeLabSavedPositiveHandoffSchema.parse({
  artifactId: 'artifact_negative_lab_save_handoff_001',
  conversionBundlePath: '/proof-roll/negative-lab/frame_001_Positive.tiff.conversion-bundle.json',
  dimensions: { height: 1200, width: 1800 },
  frameExposureOverrides: {
    overrides: [{ effectiveExposure: 0.15, exposureOffset: 0.1, frameId: 'negative-lab-frame-001', sourcePath }],
    schemaVersion: 1,
  },
  frameRgbBalanceOverrides: {
    overrides: [],
    schemaVersion: 1,
  },
  outputArtifactId: 'artifact_negative_lab_save_handoff_001_output',
  outputFormat: 'tiff16',
  outputHash: 'fnv1a64:0123456789abcdef',
  outputPath: savedPath,
  path: savedPath,
  positiveVariantId: 'positive_variant_save_handoff_001',
  profileProvenanceHash: 'fnv1a32:e5855424',
  replayPlanHash: 'fnv1a32:2f4a91bc',
  selectedAcquisitionProfile: {
    channelBasis: 'camera_raw',
    displayName: 'Camera RAW linear',
    id: 'camera_raw_linear_v1',
    inputTransform: 'camera_raw_linear',
    provenanceSummary: 'Camera RAW linear input.',
    warningCodes: [],
  },
  selectedProfile: {
    displayName: 'C-41 Portrait',
    presetId: 'negative_lab.generic.c41.portrait.v1',
    profileProvenanceHash: 'fnv1a32:e5855424',
  },
  sidecarPath: `${savedPath}.rrdata`,
  sourceImageRef: sourcePath,
  sourcePath,
});

const acceptedDustHealLayer = buildDustCandidateHealLayer({
  candidate: {
    candidateId: 'negative_lab_dust_frame_001_1',
    confidence: 0.86,
    geometry: {
      coordinateSpace: 'normalized_frame',
      height: 0.04,
      kind: 'rect',
      width: 0.04,
      x: 0.48,
      y: 0.48,
    },
    kind: 'dust_spot',
    status: 'pending',
  },
  frameId: 'negative-lab-frame-001',
  imageHeight: savedPositiveHandoff.dimensions.height,
  imageWidth: savedPositiveHandoff.dimensions.width,
  layerId: 'negative-lab-dust-heal-001',
});

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  selectedImage: null,
});

const events: string[] = [];
await handleNegativeConversionEditorHandoff({
  handleImageSelect: (path) => {
    events.push(`select:${path}`);
    useEditorStore.getState().setEditor({
      selectedImage: {
        exif: null,
        height: savedPositiveHandoff.dimensions.height,
        isRaw: false,
        isReady: true,
        metadata: {},
        originalUrl: null,
        path,
        thumbnailUrl: '',
        width: savedPositiveHandoff.dimensions.width,
      },
    });
  },
  handoff: {
    acceptedDustHealLayers: [acceptedDustHealLayer],
    acceptedDustHealLayersBySavedPath: { [savedPath]: [acceptedDustHealLayer] },
    activePositivePath: savedPath,
    openInEditor: true,
    savedPositiveHandoffs: [savedPositiveHandoff],
  },
  refreshImageList: async () => {
    events.push('refresh');
  },
  requestThumbnails: (paths) => {
    events.push(`thumbnail:${paths.join(',')}`);
  },
  savedPaths: [savedPath],
});

if (events.join('>') !== `refresh>thumbnail:${savedPath}>select:${savedPath}`) {
  throw new Error(`Negative Lab save handoff order mismatch: ${events.join('>')}`);
}

const consumedHandoff = consumePendingNegativeConversionSavedPositiveHandoff(savedPath);
if (consumedHandoff?.replayPlanHash !== savedPositiveHandoff.replayPlanHash) {
  throw new Error('Negative Lab saved positive handoff did not expose the replay plan hash.');
}
if (consumePendingNegativeConversionSavedPositiveHandoff(savedPath) !== null) {
  throw new Error('Negative Lab saved positive handoff should be consumed once.');
}
if (!consumePendingNegativeConversionDustHealLayers(savedPath)) {
  throw new Error('Negative Lab saved positive dust-heal layers were not consumed for the opened positive.');
}
const openedPositive = useEditorStore.getState().selectedImage;
const openedMetadata =
  typeof openedPositive?.metadata === 'object' &&
  openedPositive.metadata !== null &&
  !Array.isArray(openedPositive.metadata)
    ? openedPositive.metadata
    : null;
const healedSidecars =
  openedMetadata !== null &&
  typeof openedMetadata.rawEngineArtifacts === 'object' &&
  openedMetadata.rawEngineArtifacts !== null &&
  !Array.isArray(openedMetadata.rawEngineArtifacts) &&
  Array.isArray(openedMetadata.rawEngineArtifacts.layerStackSidecars)
    ? openedMetadata.rawEngineArtifacts.layerStackSidecars
    : null;
if (!Array.isArray(healedSidecars) || healedSidecars.length !== 1) {
  throw new Error('Negative Lab saved positive did not persist the accepted heal layer into metadata.');
}
if (
  healedSidecars[0]?.layers[0]?.retouchCloneSource?.provenance?.proofSource !== 'negative_lab_candidate_acceptance_v1'
) {
  throw new Error('Negative Lab saved positive heal layer metadata is missing editable-layer provenance.');
}

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const handoffSource = readFileSync('src/utils/negative-lab/negativeLabEditorHandoff.ts', 'utf8');
const loaderSource = readFileSync('src/hooks/editor/useImageLoader.ts', 'utf8');
const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');

for (const [label, source, marker] of [
  ['modal parses saved positive receipts', modalSource, 'negativeConversionSavedPositiveHandoffsSchema'],
  ['modal maps active positive path', modalSource, 'activePositiveVariant?.sourcePath'],
  ['modal passes saved positive receipts', modalSource, 'savedPositiveHandoffs,'],
  ['handoff requests thumbnail', handoffSource, 'requestThumbnails?.([firstSavedPath]);'],
  ['handoff queues saved positive receipt', handoffSource, 'pendingSavedPositiveHandoff = savedPositiveHandoff;'],
  ['loader exposes handoff metadata', loaderSource, 'rawEngineNegativeLabHandoff: savedPositiveHandoff'],
  ['app modals wires thumbnail request', appModalsSource, 'requestThumbnails: props.requestThumbnails'],
] as const) {
  if (!source.includes(marker)) {
    throw new Error(`Negative Lab save editor handoff marker missing: ${label}`);
  }
}

console.log('negative lab save editor handoff ok');
