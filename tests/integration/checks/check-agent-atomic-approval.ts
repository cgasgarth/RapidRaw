#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import type { AgentApprovalState } from '../../../src/utils/agentApprovalGate.ts';
import { applyApprovedAgentPlanAtomically, rollbackApprovedAgentPlan } from '../../../src/utils/agentAtomicApproval.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3160.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_atomic_approval',
  albumTree: [{ id: 'album_agent_atomic_approval', images: [selectedPath], name: 'Atomic Approval', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [],
  imageList: [
    {
      exif: { ISO: '1000', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_560,
      path: selectedPath,
      rating: 4,
      tags: ['agent-atomic-approval'],
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
  finalPreviewUrl: 'blob:rawengine-atomic-before',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '1000', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3160',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3160',
    width: 6000,
  },
});

const steps = [
  {
    kind: 'basic_tone' as const,
    payload: {
      ...INITIAL_ADJUSTMENTS,
      blacks: -4,
      brightness: INITIAL_ADJUSTMENTS.brightness,
      clarity: 10,
      contrast: 18,
      exposure: 0.25,
      highlights: -12,
      saturation: 5,
      shadows: 8,
      whites: 4,
    },
  },
];
const snapshot = buildAgentImageContextSnapshot();
const buildApproval = (status: AgentApprovalState['status'], overrides: Partial<AgentApprovalState> = {}) => ({
  approvalId: `approval_${status}_3160`,
  approvedGraphRevision: snapshot.graphRevision,
  approvedRecipeHash: snapshot.initialPreview.recipeHash,
  approvedSelectedImagePath: snapshot.activeImagePath,
  approvedSessionId: 'agent-atomic-approval-3160',
  status,
  ...overrides,
});

await expectRejects(
  applyApprovedAgentPlanAtomically({
    approval: buildApproval('pending'),
    approvedAfterHash: 'after',
    approvedBeforeHash: 'before',
    approvedGraphRevision: 'history_0',
    operationId: 'atomic_3160_pending',
    sessionId: 'agent-atomic-approval-3160',
    steps,
  }),
  'pending approval',
);

await expectRejects(
  applyApprovedAgentPlanAtomically({
    approval: buildApproval('cancelled'),
    approvedAfterHash: 'after',
    approvedBeforeHash: 'before',
    approvedGraphRevision: 'history_0',
    operationId: 'atomic_3160_cancelled',
    sessionId: 'agent-atomic-approval-3160',
    steps,
  }),
  'cancelled approval',
);

await expectRejects(
  applyApprovedAgentPlanAtomically({
    approval: buildApproval('approved', { approvedSelectedImagePath: '/tmp/other.ARW' }),
    approvedAfterHash: 'after',
    approvedBeforeHash: 'before',
    approvedGraphRevision: 'history_0',
    operationId: 'atomic_3160_wrong_image',
    sessionId: 'agent-atomic-approval-3160',
    steps,
  }),
  'wrong selected image',
);

await expectRejects(
  applyApprovedAgentPlanAtomically({
    approval: buildApproval('approved', { approvedGraphRevision: 'history_99' }),
    approvedAfterHash: 'after',
    approvedBeforeHash: 'before',
    approvedGraphRevision: 'history_99',
    operationId: 'atomic_3160_stale',
    sessionId: 'agent-atomic-approval-3160',
    steps,
  }),
  'stale graph revision',
);

const applied = await applyApprovedAgentPlanAtomically({
  approval: buildApproval('approved', { approvalId: 'approval_accepted_3160' }),
  approvedAfterHash: 'after',
  approvedBeforeHash: 'before',
  approvedGraphRevision: 'history_0',
  operationId: 'atomic_3160',
  sessionId: 'agent-atomic-approval-3160',
  steps,
});

const appliedState = useEditorStore.getState();
if (applied.approvalId !== 'approval_accepted_3160' || applied.rollbackTarget.graphRevision !== 'history_0') {
  throw new Error('Atomic approval did not persist approval and rollback target.');
}
if (appliedState.adjustments.exposure !== 0.25 || appliedState.historyIndex !== 1) {
  throw new Error('Atomic approval did not apply the approved plan.');
}

const rollbackRevision = rollbackApprovedAgentPlan(applied.rollbackTarget);
const rolledBackState = useEditorStore.getState();
if (rollbackRevision !== 'history_0') {
  throw new Error('Rollback did not return the approved rollback graph revision.');
}
if (rolledBackState.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure || rolledBackState.historyIndex !== 0) {
  throw new Error('Rollback did not restore original adjustments and history index.');
}
if (rolledBackState.finalPreviewUrl !== 'blob:rawengine-atomic-before') {
  throw new Error('Rollback did not restore original preview identity.');
}

console.log('agent atomic approval ok');

async function expectRejects(promise: Promise<unknown>, label: string) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(`Expected rejection for ${label}.`);
}
