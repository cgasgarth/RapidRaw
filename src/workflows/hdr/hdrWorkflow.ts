import type { HdrMergeUiSettings } from '../../schemas/computational-merge/hdrMergeUiSchemas';
import {
  createOperationSession,
  type OperationEvent,
  type OperationLaunch,
  type OperationSession,
  reduceOperationSession,
} from '../operationLifecycle';

export interface HdrWorkflowState {
  readonly session: OperationSession | null;
  readonly settings: HdrMergeUiSettings;
}

export type HdrWorkflowEvent =
  | { type: 'open'; launch: OperationLaunch; settings: HdrMergeUiSettings }
  | { type: 'settings'; launchId: string; settings: HdrMergeUiSettings }
  | { type: 'lifecycle'; event: OperationEvent };

export const createHdrWorkflowState = (settings: HdrMergeUiSettings): HdrWorkflowState => ({
  session: null,
  settings,
});

export const reduceHdrWorkflow = (state: HdrWorkflowState, event: HdrWorkflowEvent): HdrWorkflowState => {
  switch (event.type) {
    case 'open':
      if (event.launch.kind !== 'hdr') return state;
      return { session: createOperationSession(event.launch), settings: event.settings };
    case 'settings':
      if (state.session?.launch.launchId !== event.launchId) return state;
      return { ...state, settings: event.settings };
    case 'lifecycle':
      if (state.session === null) return state;
      return { ...state, session: reduceOperationSession(state.session, event.event) };
  }
};

export const isCurrentHdrWorkflow = (state: HdrWorkflowState, launchId: string): boolean =>
  state.session?.launch.launchId === launchId && state.session.lifecycle !== 'closed';
