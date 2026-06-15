import type { Adjustments } from './adjustments';

export interface EditHistoryState {
  adjustments: Adjustments;
  history: Array<Adjustments>;
  historyIndex: number;
}

export function pushEditHistoryEntry(
  history: Array<Adjustments>,
  historyIndex: number,
  newAdjustments: Adjustments,
  maxEntries = 50,
): Pick<EditHistoryState, 'history' | 'historyIndex'> {
  const nextHistory = history.slice(0, historyIndex + 1);
  nextHistory.push(newAdjustments);
  if (nextHistory.length > maxEntries) nextHistory.shift();
  return { history: nextHistory, historyIndex: nextHistory.length - 1 };
}

export function undoEditHistory(state: EditHistoryState): EditHistoryState {
  if (state.historyIndex <= 0) return state;
  const historyIndex = state.historyIndex - 1;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

export function redoEditHistory(state: EditHistoryState): EditHistoryState {
  if (state.historyIndex >= state.history.length - 1) return state;
  const historyIndex = state.historyIndex + 1;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

export function goToEditHistoryIndex(state: EditHistoryState, historyIndex: number): EditHistoryState {
  if (historyIndex < 0 || historyIndex >= state.history.length) return state;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}
