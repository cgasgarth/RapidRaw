import { create } from 'zustand';

import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../schemas/computational-merge/hdrMergeUiSchemas';
import {
  createHdrWorkflowState,
  type HdrWorkflowEvent,
  type HdrWorkflowState,
  isCurrentHdrWorkflow,
  reduceHdrWorkflow,
} from '../workflows/hdr/hdrWorkflow';
import type { OperationLaunch } from '../workflows/operationLifecycle';

interface HdrWorkflowStore extends HdrWorkflowState {
  dispatch: (event: HdrWorkflowEvent) => void;
  open: (launch: OperationLaunch, settings?: HdrWorkflowState['settings']) => void;
  close: (launchId: string) => void;
  isCurrent: (launchId: string) => boolean;
}

export const useHdrWorkflowStore = create<HdrWorkflowStore>((set, get) => ({
  ...createHdrWorkflowState(DEFAULT_HDR_MERGE_UI_SETTINGS),
  dispatch: (event) => set((state) => reduceHdrWorkflow(state, event)),
  open: (launch, settings = DEFAULT_HDR_MERGE_UI_SETTINGS) =>
    set((state) => reduceHdrWorkflow(state, { type: 'open', launch, settings })),
  close: (launchId) =>
    set((state) => reduceHdrWorkflow(state, { type: 'lifecycle', event: { type: 'close', launchId } })),
  isCurrent: (launchId) => isCurrentHdrWorkflow(get(), launchId),
}));

export const resetHdrWorkflowStore = () =>
  useHdrWorkflowStore.setState(createHdrWorkflowState(DEFAULT_HDR_MERGE_UI_SETTINGS));
