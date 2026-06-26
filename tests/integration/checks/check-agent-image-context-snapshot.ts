#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3156.ARW';
const histogramBins = Array.from({ length: 256 }, (_, index) => (index === 0 ? 24 : index === 255 ? 18 : 2));

useEditorStore.getState().setEditor({
  activeMaskContainerId: 'mask_subject_3156',
  adjustments: {
    ...INITIAL_ADJUSTMENTS,
    aspectRatio: 1.5,
    contrast: 18,
    crop: { height: 60, unit: '%', width: 90, x: 5, y: 10 },
    exposure: 0.35,
    masks: [
      {
        adjustments: { ...INITIAL_ADJUSTMENTS },
        id: 'mask_subject_3156',
        inverted: false,
        masks: [],
        name: 'Subject',
        visible: true,
      },
    ],
  },
  brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-context',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: histogramBins.map((value) => value + 2) },
    [ActiveChannel.Green]: { color: '#6BCB77', data: histogramBins.map((value) => value + 1) },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: histogramBins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: histogramBins.map((value) => value + 3) },
  },
  history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.1 }, { ...INITIAL_ADJUSTMENTS, exposure: 0.35 }],
  historyIndex: 2,
  selectedImage: {
    exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM', ShutterSpeedValue: '1/320' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3156',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3156',
    width: 6000,
  },
});

const snapshot = buildAgentImageContextSnapshot();

if (snapshot.activeImagePath !== selectedPath || snapshot.graphRevision !== 'history_2') {
  throw new Error('Agent image context did not bind to the selected RAW and graph revision.');
}
if (snapshot.histogramSummary.length !== 4 || snapshot.histogramSummary.some((channel) => channel.bins.length > 16)) {
  throw new Error('Agent image context did not include bounded histogram summaries.');
}
if (snapshot.clipping.shadowsPercent <= 0 || snapshot.clipping.highlightsPercent <= 0) {
  throw new Error('Agent image context did not report clipping from histogram bins.');
}
if (!snapshot.cropHint.active || snapshot.cropHint.aspectRatio !== 1.5) {
  throw new Error('Agent image context did not include crop hints.');
}
if (!snapshot.subjectHint.hasActiveMask || snapshot.subjectHint.maskCount !== 1) {
  throw new Error('Agent image context did not include subject/mask hints.');
}
if (!snapshot.adjustmentSummary.some((entry) => entry.key === 'exposure' && entry.value === 0.35)) {
  throw new Error('Agent image context did not include current adjustment summary.');
}
if (!snapshot.metadataSummary.some((entry) => entry.key === 'LensModel' && entry.value === 'FE 35mm F1.4 GM')) {
  throw new Error('Agent image context did not include bounded EXIF metadata.');
}
if (
  snapshot.initialPreview.mediaType !== 'image/jpeg' ||
  snapshot.initialPreview.encodedFormat !== 'jpeg' ||
  snapshot.initialPreview.longEdgePx !== 1536 ||
  snapshot.initialPreview.quality !== 0.86
) {
  throw new Error('Agent image context did not include a medium-quality initial preview descriptor.');
}
if (
  snapshot.initialPreview.includesOriginalRaw ||
  snapshot.initialPreview.previewRef === 'blob:rawengine-original-3156'
) {
  throw new Error('Agent image context must not attach the original RAW by default.');
}
if (snapshot.initialPreview.width !== 1536 || snapshot.initialPreview.height !== 1024) {
  throw new Error('Agent image context did not scale initial preview dimensions to the configured long edge.');
}
if (
  !snapshot.initialPreview.cacheKey.startsWith('agent-initial-preview:render:') ||
  !snapshot.initialPreview.recipeHash.startsWith('recipe:') ||
  !snapshot.initialPreview.renderHash.startsWith('render:')
) {
  throw new Error('Agent image context did not include stable preview cache, recipe, and render identities.');
}
if (JSON.stringify(snapshot).length > 4_800) {
  throw new Error('Agent image context snapshot exceeded bounded payload budget.');
}

console.log('agent image context snapshot ok (bounded RAW context)');
