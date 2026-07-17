/**
 * UI-only session authority for the canvas-first retouch tools.
 *
 * The edit document remains the source of truth for pixels. This small state
 * machine only tracks which tool/spot the canvas is currently editing and
 * makes cancel/complete transitions explicit so stale pointer work cannot be
 * mistaken for a committed Remove operation.
 */
export type RetouchRemoveTool = 'clone' | 'heal' | 'remove';

export interface RetouchRemoveWorkflowState {
  readonly activeLayerId: string | null;
  readonly activeTool: RetouchRemoveTool | null;
  readonly sessionGeneration: number;
  readonly sessionActive: boolean;
  readonly selectedSpotId: string | null;
  readonly spotsVisible: boolean;
}

export type RetouchRemoveWorkflowAction =
  | { readonly type: 'activate'; readonly layerId: string; readonly tool: RetouchRemoveTool }
  | { readonly type: 'select-spot'; readonly spotId: string | null }
  | { readonly type: 'begin-session' }
  | { readonly type: 'cancel-session' }
  | { readonly type: 'complete-session' }
  | { readonly type: 'toggle-spots' }
  | { readonly type: 'deactivate' };

export const createRetouchRemoveWorkflowState = (): RetouchRemoveWorkflowState => ({
  activeLayerId: null,
  activeTool: null,
  sessionGeneration: 0,
  sessionActive: false,
  selectedSpotId: null,
  spotsVisible: true,
});

export const reduceRetouchRemoveWorkflow = (
  state: RetouchRemoveWorkflowState,
  action: RetouchRemoveWorkflowAction,
): RetouchRemoveWorkflowState => {
  switch (action.type) {
    case 'activate':
      return {
        ...state,
        activeLayerId: action.layerId,
        activeTool: action.tool,
        selectedSpotId: null,
        sessionActive: false,
        sessionGeneration: state.sessionGeneration + 1,
      };
    case 'select-spot':
      return { ...state, selectedSpotId: action.spotId };
    case 'begin-session':
      return state.activeLayerId === null || state.activeTool === null
        ? state
        : { ...state, sessionActive: true, sessionGeneration: state.sessionGeneration + 1 };
    case 'cancel-session':
      return { ...state, sessionActive: false };
    case 'complete-session':
      return { ...state, sessionActive: false };
    case 'toggle-spots':
      return { ...state, spotsVisible: !state.spotsVisible };
    case 'deactivate':
      return { ...state, activeLayerId: null, activeTool: null, selectedSpotId: null, sessionActive: false };
  }
};
