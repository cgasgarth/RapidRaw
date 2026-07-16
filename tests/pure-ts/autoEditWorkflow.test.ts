import { describe, expect, test } from 'bun:test';
import type { AutoEditProposalV1 } from '../../src/schemas/autoEditSchemas';
import { selectAutoEditAdjustmentProposal } from '../../src/utils/autoEditTransaction';
import {
  highConfidenceAutoEditGroups,
  isCurrentAutoEditCompletion,
  mergeAutoEditAdjustments,
  recommendedAutoEditGroups,
  toggleAutoEditGroup,
} from '../../src/utils/autoEditWorkflow';
import { createDefaultEditDocumentV2 } from '../../src/utils/editDocumentV2';

const proposal = {
  recommendations: [
    { group: 'light', confidence: 0.9, safeToBatch: true, state: 'recommended' },
    { group: 'color', confidence: 0.7, safeToBatch: false, state: 'recommended' },
    { group: 'geometry', confidence: 0, safeToBatch: false, state: 'not_applicable' },
  ],
} as AutoEditProposalV1;

describe('typed Auto Edit workflow', () => {
  test('selects only recommended groups and applies the stricter batch-safe confidence gate', () => {
    expect([...recommendedAutoEditGroups(proposal)]).toEqual(['light', 'color']);
    expect([...highConfidenceAutoEditGroups(proposal)]).toEqual(['light']);
  });

  test('group toggles return a new immutable selection', () => {
    const initial = new Set(['light'] as const);
    const removed = toggleAutoEditGroup(initial, 'light');
    const added = toggleAutoEditGroup(initial, 'color');
    expect([...initial]).toEqual(['light']);
    expect([...removed]).toEqual([]);
    expect([...added]).toEqual(['light', 'color']);
  });

  test('rejects completions after image or history revision changes', () => {
    expect(isCurrentAutoEditCompletion('session-a', 'history_2', 'session-a', 'history_2')).toBe(true);
    expect(isCurrentAutoEditCompletion('session-a', 'history_2', 'session-b', 'history_2')).toBe(false);
    expect(isCurrentAutoEditCompletion('session-a', 'history_2', 'session-a', 'history_3')).toBe(false);
  });

  test('preview/apply merge changes only proposal-owned fields', () => {
    const base = { ...selectAutoEditAdjustmentProposal(createDefaultEditDocumentV2()), exposure: 0.75 };
    expect(mergeAutoEditAdjustments(base, { exposure: 1 })).toMatchObject({ exposure: 1, contrast: 0 });
    expect(base.exposure).toBe(0.75);
  });
});
