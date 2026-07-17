import type { AiPeopleMaskPart } from '../../schemas/masks/aiMaskingSchemas';

/** Shared lifecycle used by the People and Object selectors.  Draft work is
 * intentionally separate from an accepted mask so it can never enter the
 * edit graph, history, persistence, or export. */
export type AiSelectionStatus = 'empty' | 'pending' | 'review' | 'accepted' | 'cancelled' | 'error';

export interface PeopleSelectionDraft {
  personId: string | null;
  part: AiPeopleMaskPart;
}

export interface PeopleSelectionState {
  candidates: number;
  draft: PeopleSelectionDraft | null;
  error: string | null;
  status: AiSelectionStatus;
}

export interface ObjectSelectionState {
  error: string | null;
  hasPrompt: boolean;
  hasProposal: boolean;
  status: AiSelectionStatus;
}

export function createPeopleSelectionState(candidates = 0): PeopleSelectionState {
  return { candidates, draft: null, error: null, status: 'empty' };
}

export function selectPeopleCandidate(state: PeopleSelectionState, draft: PeopleSelectionDraft): PeopleSelectionState {
  return { ...state, draft, error: null, status: 'review' };
}

export function beginPeopleSelection(state: PeopleSelectionState): PeopleSelectionState {
  return { ...state, error: null, status: 'pending' };
}

export function finishPeopleSelection(state: PeopleSelectionState, error?: string): PeopleSelectionState {
  return error === undefined ? { ...state, error: null, status: 'accepted' } : { ...state, error, status: 'error' };
}

export function cancelPeopleSelection(state: PeopleSelectionState): PeopleSelectionState {
  return { ...state, draft: null, error: null, status: 'cancelled' };
}

export function createObjectSelectionState(hasPrompt = false): ObjectSelectionState {
  return { error: null, hasPrompt, hasProposal: false, status: hasPrompt ? 'review' : 'empty' };
}

export function beginObjectSelection(state: ObjectSelectionState): ObjectSelectionState {
  return { ...state, error: null, status: 'pending' };
}

export function reviewObjectSelection(state: ObjectSelectionState): ObjectSelectionState {
  return { ...state, error: null, hasProposal: true, status: 'review' };
}

export function acceptObjectSelection(state: ObjectSelectionState): ObjectSelectionState {
  return { ...state, error: null, hasProposal: false, status: 'accepted' };
}

export function cancelObjectSelection(state: ObjectSelectionState): ObjectSelectionState {
  return { ...state, error: null, hasProposal: false, status: 'cancelled' };
}

export function failObjectSelection(state: ObjectSelectionState, error: string): ObjectSelectionState {
  return { ...state, error, status: 'error' };
}
