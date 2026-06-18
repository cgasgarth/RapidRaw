import type { Adjustments } from './adjustments';

export interface EditHistoryState<Entry = Adjustments> {
  adjustments: Entry;
  history: Array<Entry>;
  historyIndex: number;
}

export function pushEditHistoryEntry<Entry>(
  history: Array<Entry>,
  historyIndex: number,
  newAdjustments: Entry,
  maxEntries = 50,
): Pick<EditHistoryState<Entry>, 'history' | 'historyIndex'> {
  const nextHistory = history.slice(0, historyIndex + 1);
  nextHistory.push(newAdjustments);
  if (nextHistory.length > maxEntries) nextHistory.shift();
  return { history: nextHistory, historyIndex: nextHistory.length - 1 };
}

export function undoEditHistory<Entry>(state: EditHistoryState<Entry>): EditHistoryState<Entry> {
  if (state.historyIndex <= 0) return state;
  const historyIndex = state.historyIndex - 1;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

export function redoEditHistory<Entry>(state: EditHistoryState<Entry>): EditHistoryState<Entry> {
  if (state.historyIndex >= state.history.length - 1) return state;
  const historyIndex = state.historyIndex + 1;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

export function goToEditHistoryIndex<Entry>(
  state: EditHistoryState<Entry>,
  historyIndex: number,
): EditHistoryState<Entry> {
  if (historyIndex < 0 || historyIndex >= state.history.length) return state;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}
