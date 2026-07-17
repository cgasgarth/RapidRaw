import {
  acceptObjectSelection,
  beginObjectSelection,
  beginPeopleSelection,
  cancelObjectSelection,
  cancelPeopleSelection,
  createObjectSelectionState,
  createPeopleSelectionState,
  failObjectSelection,
  finishPeopleSelection,
  reviewObjectSelection,
  selectPeopleCandidate,
} from '../../../src/utils/ai/aiMaskSelectionWorkflow';

describe('Lightroom AI People/Object selection lifecycle', () => {
  test('keeps People candidates in review until an accepted typed result exists', () => {
    const empty = createPeopleSelectionState();
    expect(empty.status).toBe('empty');
    const pending = beginPeopleSelection(selectPeopleCandidate(empty, { part: 'full_person', personId: 'p-1' }));
    expect(pending.status).toBe('pending');
    expect(finishPeopleSelection(pending).status).toBe('accepted');
    expect(cancelPeopleSelection(pending).draft).toBeNull();
  });

  test('supports Object review/apply/cancel/error without persisting the draft', () => {
    const pending = beginObjectSelection(createObjectSelectionState(true));
    const review = reviewObjectSelection(pending);
    expect(review.status).toBe('review');
    expect(review.hasProposal).toBe(true);
    expect(acceptObjectSelection(review).status).toBe('accepted');
    expect(cancelObjectSelection(review).hasProposal).toBe(false);
    expect(failObjectSelection(pending, 'provider offline').status).toBe('error');
  });
});

import { describe, expect, test } from 'bun:test';
