import { describe, expect, test } from 'bun:test';
import { matchLookApplicationReceiptV1Schema } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import type { AutoEditProposalV1 } from '../../src/schemas/autoEditSchemas';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  highConfidenceAutoEditGroups,
  isCurrentAutoEditCompletion,
  mergeAutoEditAdjustments,
  recommendedAutoEditGroups,
  toggleAutoEditGroup,
} from '../../src/utils/autoEditWorkflow';

const fingerprint = (digit: string): `fnv1a64:${string}` => `fnv1a64:${digit.repeat(16)}`;
const receipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 0.75, before: 0, key: 'exposure' }],
  appliedAt: '2026-07-13T23:00:00.000Z',
  baseGraphFingerprint: fingerprint('0'),
  destination: 'global-adjustments',
  effectiveReferences: [{ role: 'creative', sourceFingerprint: fingerprint('4'), weight: 1 }],
  enabledGroups: ['tone'],
  historyEntriesAdded: 1,
  impact: 75,
  proposalFingerprint: fingerprint('1'),
  resultingGraphFingerprint: fingerprint('2'),
  schemaVersion: 1,
  targetAnalysisFingerprint: fingerprint('3'),
});

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

  test('preview/apply merge cannot carry stale Match Look provenance into an Auto Edit graph', () => {
    const base = { ...INITIAL_ADJUSTMENTS, exposure: 0.75, referenceMatchApplicationReceipt: receipt };
    expect(mergeAutoEditAdjustments(base, { exposure: 1 })).toMatchObject({
      exposure: 1,
      referenceMatchApplicationReceipt: null,
    });
    expect(mergeAutoEditAdjustments(base, { sharpness: 25 }).referenceMatchApplicationReceipt).toBe(receipt);
    expect(base.referenceMatchApplicationReceipt).toBe(receipt);
  });
});
