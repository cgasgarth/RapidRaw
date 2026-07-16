#!/usr/bin/env bun

import {
  ApprovalClass,
  toneColorCommandEnvelopeV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  applyBasicToneCommandToLiveEditor,
  applyBasicToneToLiveEditor,
} from '../../../../src/utils/agent/session/agentLiveBasicTone.ts';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../../src/utils/editDocumentV2.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3155.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_basic_tone',
  albumTree: [{ id: 'album_agent_basic_tone', images: [selectedPath], name: 'Agent Basic Tone', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [
    {
      children: [],
      hasSubdirs: false,
      imageCount: 1,
      isDir: true,
      name: 'Alaska',
      path: '/Users/cgas/Pictures/Capture One/Alaska',
    },
  ],
  imageList: [
    {
      exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_555,
      path: selectedPath,
      rating: 4,
      tags: ['agent-basic-tone'],
    },
  ],
  imageRatings: { [selectedPath]: 4 },
  libraryActivePath: selectedPath,
  multiSelectedPaths: [selectedPath],
  pinnedFolderTrees: [],
  rootPaths: ['/Users/cgas/Pictures/Capture One'],
  sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
});

const initialEditDocumentV2 = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
useEditorStore.getState().hydrateEditorRenderAuthority({
  editDocumentV2: initialEditDocumentV2,
  finalPreviewUrl: 'blob:rawengine-preview-before',
  hasRenderedFirstFrame: true,
  history: [initialEditDocumentV2],
  historyIndex: 0,
  lastBasicToneCommand: null,
  selectedImage: {
    exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3155',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3155',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});
const baselineAdjustmentRevision = useEditorStore.getState().adjustmentRevision;

const result = await applyBasicToneToLiveEditor({
  operationId: 'live_apply_3155',
  requestedAdjustments: {
    ...INITIAL_ADJUSTMENTS,
    blacks: -8,
    brightness: INITIAL_ADJUSTMENTS.brightness,
    clarity: 16,
    contrast: 22,
    exposure: 0.45,
    highlights: -18,
    saturation: 10,
    shadows: 14,
    whites: 7,
  },
  sessionId: 'agent-live-basic-tone-3155',
});

const state = useEditorStore.getState();

if (state.adjustmentSnapshot.value.exposure !== 0.45 || state.adjustmentSnapshot.value.contrast !== 22) {
  throw new Error('Agent basic-tone apply did not mutate live editor adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2) {
  throw new Error('Agent basic-tone apply did not push edit history.');
}
if (state.lastBasicToneCommand?.commandId !== result.command.commandId || state.lastBasicToneCommand.dryRun) {
  throw new Error('Agent basic-tone apply did not retain the applied command envelope.');
}
if (
  state.adjustmentRevision !== baselineAdjustmentRevision + 1 ||
  state.lastEditApplicationReceipt?.source !== 'agent-command' ||
  state.lastEditApplicationReceipt.transactionId !== result.command.commandId ||
  state.lastEditApplicationReceipt.baseAdjustmentRevision !== baselineAdjustmentRevision ||
  state.lastEditApplicationReceipt.adjustmentRevision !== baselineAdjustmentRevision + 1
) {
  throw new Error(
    `Agent basic-tone apply did not publish one revisioned EditTransaction receipt: ${JSON.stringify({
      adjustmentRevision: state.adjustmentRevision,
      receipt: state.lastEditApplicationReceipt,
      resultCommandId: result.command.commandId,
    })}`,
  );
}
if (
  state.editDocumentV2.nodes.scene_global_color_tone?.params.exposure !== 0.45 ||
  state.editDocumentV2.nodes.scene_global_color_tone.params.contrast !== 22
) {
  throw new Error('Agent basic-tone apply did not update the canonical scene tone node.');
}
if (state.finalPreviewUrl !== null) {
  throw new Error('Agent basic-tone apply did not invalidate stale preview output for scheduled rendering.');
}
if (state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('Agent basic-tone apply must invalidate stale uncropped preview output.');
}
if (result.beforePreviewHash === result.afterPreviewHash || result.changedPixelCount < 64) {
  throw new Error('Agent basic-tone renderer proof did not change expected output pixels.');
}
if (
  result.sampledPixelCount !== 64 ||
  result.changedPixelPercent !== 100 ||
  result.meanLuminanceDelta <= 0 ||
  result.maxChannelDelta <= 0
) {
  throw new Error('Agent basic-tone renderer proof must report meaningful preview delta metrics.');
}
if (result.mutation.appliedGraphRevision !== result.appliedGraphRevision) {
  throw new Error('Agent basic-tone result did not preserve mutation graph revision.');
}

let unapprovedApplyRejected = false;
try {
  await applyBasicToneCommandToLiveEditor(
    toneColorCommandEnvelopeV1Schema.parse({
      ...result.command,
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Regression check: preview-only approval cannot mutate.',
        state: 'not_required',
      },
      commandId: 'basic_tone_unapproved_apply_regression',
      correlationId: 'basic_tone_unapproved_apply_regression_corr',
      expectedGraphRevision: 'history_1',
      idempotencyKey: 'basic_tone_unapproved_apply_regression_idem',
    }),
  );
} catch (error) {
  unapprovedApplyRejected = error instanceof Error;
}
if (!unapprovedApplyRejected) {
  throw new Error('Typed basic-tone apply accepted a preview-only approval.');
}
if (useEditorStore.getState().historyIndex !== 1) {
  throw new Error('Rejected typed basic-tone apply must not advance editor history.');
}

console.log('agent basic tone live apply ok (store+history+renderer handoff)');
