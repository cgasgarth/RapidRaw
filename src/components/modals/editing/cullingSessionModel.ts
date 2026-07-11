import type { CullingSuggestions } from '../../ui/AppProperties';

export interface CullingDecisionState {
  activePath: string | null;
  paths: readonly string[];
  reviewerChangedDecision: boolean;
  selectedRejects: Set<string>;
  suggestions: CullingSuggestions | null;
}

export type CullingDecisionAction =
  | { type: 'acceptSuggestions' }
  | { type: 'resetToSuggestions' }
  | { type: 'setActive'; path: string | null }
  | { type: 'setRange'; paths: string[]; rejected: boolean }
  | { type: 'suggestionsResolved'; paths: string[]; suggestions: CullingSuggestions }
  | { type: 'toggle'; path: string };

function suggestionRejectPaths(paths: readonly string[], suggestions: CullingSuggestions | null): Set<string> {
  if (!suggestions) return new Set();

  const availablePaths = new Set(paths);
  const rejects = new Set<string>();
  for (const group of suggestions.similarGroups) {
    for (const duplicate of group.duplicates) {
      if (availablePaths.has(duplicate.path)) rejects.add(duplicate.path);
    }
  }
  for (const blurryImage of suggestions.blurryImages) {
    if (availablePaths.has(blurryImage.path)) rejects.add(blurryImage.path);
  }
  return rejects;
}

export function buildInitialCullingDecision(
  paths: readonly string[],
  suggestions: CullingSuggestions | null,
): CullingDecisionState {
  return {
    activePath: paths[0] ?? null,
    paths: [...paths],
    reviewerChangedDecision: false,
    selectedRejects: suggestionRejectPaths(paths, suggestions),
    suggestions,
  };
}

export function reduceCullingDecision(
  state: CullingDecisionState,
  action: CullingDecisionAction,
): CullingDecisionState {
  switch (action.type) {
    case 'suggestionsResolved':
      return {
        ...state,
        selectedRejects: state.reviewerChangedDecision
          ? state.selectedRejects
          : suggestionRejectPaths(action.paths, action.suggestions),
        paths: [...action.paths],
        suggestions: action.suggestions,
      };
    case 'toggle': {
      const selectedRejects = new Set(state.selectedRejects);
      if (selectedRejects.has(action.path)) selectedRejects.delete(action.path);
      else selectedRejects.add(action.path);
      return { ...state, activePath: action.path, reviewerChangedDecision: true, selectedRejects };
    }
    case 'setRange': {
      const selectedRejects = new Set(state.selectedRejects);
      for (const path of action.paths) {
        if (action.rejected) selectedRejects.add(path);
        else selectedRejects.delete(path);
      }
      return { ...state, reviewerChangedDecision: true, selectedRejects };
    }
    case 'setActive':
      return { ...state, activePath: action.path };
    case 'acceptSuggestions':
    case 'resetToSuggestions':
      return {
        ...state,
        reviewerChangedDecision: false,
        selectedRejects: suggestionRejectPaths(state.paths, state.suggestions),
      };
  }
}
