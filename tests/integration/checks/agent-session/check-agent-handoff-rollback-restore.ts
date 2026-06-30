#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  applyApprovedAgentPlanAtomically,
  rollbackApprovedAgentPlan,
} from '../../../../src/utils/agentAtomicApproval.ts';
import { agentChatTranscriptFixture } from '../../../../src/utils/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const handoff = agentChatTranscriptFixture.reviewHandoff;

if (handoff?.rollback.restoreAction.toolName !== 'edit_graph.rollback') {
  failures.push('Handoff rollback must expose the edit graph rollback tool.');
}
if (handoff?.rollback.restoreAction.commandId !== 'command_agent_expert_edit_demo_rollback_2844') {
  failures.push('Handoff rollback must persist a restore command id.');
}

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3121.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_handoff_rollback',
  albumTree: [{ id: 'album_agent_handoff_rollback', images: [selectedPath], name: 'Handoff Rollback', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [],
  imageList: [
    {
      exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_121,
      path: selectedPath,
      rating: 4,
      tags: ['agent-handoff-rollback'],
    },
  ],
  imageRatings: { [selectedPath]: 4 },
  libraryActivePath: selectedPath,
  multiSelectedPaths: [selectedPath],
  pinnedFolderTrees: [],
  rootPaths: ['/Users/cgas/Pictures/Capture One'],
  sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
});

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  finalPreviewUrl: 'blob:rawengine-handoff-rollback-before',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3121',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3121',
    width: 6000,
  },
});

const applied = await applyApprovedAgentPlanAtomically({
  approvalId: 'approval_handoff_rollback_3121',
  approvedAfterHash: handoff?.afterArtifactId ?? 'after',
  approvedBeforeHash: handoff?.beforeArtifactId ?? 'before',
  approvedGraphRevision: 'history_0',
  operationId: 'handoff_rollback_3121',
  sessionId: 'agent-handoff-rollback-3121',
  steps: [
    {
      kind: 'basic_tone',
      payload: {
        ...INITIAL_ADJUSTMENTS,
        blacks: -5,
        brightness: INITIAL_ADJUSTMENTS.brightness,
        clarity: 10,
        contrast: 18,
        exposure: 0.28,
        highlights: -12,
        saturation: 5,
        shadows: 8,
        whites: 4,
      },
    },
  ],
});

if (applied.rollbackTarget.graphRevision !== 'history_0') {
  failures.push('Applied result must retain the pre-agent rollback graph revision.');
}

const restoredRevision = rollbackApprovedAgentPlan(applied.rollbackTarget);
const restoredState = useEditorStore.getState();
if (restoredRevision !== 'history_0' || restoredState.historyIndex !== 0) {
  failures.push('Rollback restore path must recover the pre-agent history revision.');
}
if (restoredState.finalPreviewUrl !== 'blob:rawengine-handoff-rollback-before') {
  failures.push('Rollback restore path must recover the pre-agent preview identity.');
}
if (restoredState.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) {
  failures.push('Rollback restore path must recover pre-agent adjustments.');
}

const shellSource = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'data-testid="agent-review-handoff-rollback-restore"',
  'data-rollback-restore-state={rollbackRestoreState}',
  'data-command-id={handoff.rollback.restoreAction.commandId}',
]) {
  if (!shellSource.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

if (failures.length > 0) {
  console.error(`agent handoff rollback restore failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent handoff rollback restore ok (ui action+runtime rollback)');
