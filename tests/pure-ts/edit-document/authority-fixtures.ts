import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';

export const referenceMatchReceipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 0.75, before: 0, key: 'exposure' }],
  appliedAt: '2026-07-14T20:00:00.000Z',
  baseGraphFingerprint: `fnv1a64:${'0'.repeat(16)}`,
  destination: 'global-adjustments',
  effectiveReferences: [{ role: 'creative', sourceFingerprint: `fnv1a64:${'4'.repeat(16)}`, weight: 1 }],
  enabledGroups: ['tone'],
  historyEntriesAdded: 1,
  impact: 75,
  proposalFingerprint: `fnv1a64:${'1'.repeat(16)}`,
  resultingGraphFingerprint: `fnv1a64:${'2'.repeat(16)}`,
  schemaVersion: 1,
  targetAnalysisFingerprint: `fnv1a64:${'3'.repeat(16)}`,
});

export const sourcePatch = {
  id: 'patch-1',
  invert: false,
  isLoading: false,
  name: 'Repair',
  patchData: { pixels: 'resident-payload' },
  prompt: 'remove distraction',
  subMasks: [
    {
      id: 'mask-1',
      invert: false,
      mode: 'additive' as const,
      opacity: 80,
      parameters: { mask_data_base64: 'encoded-mask' },
      type: 'brush' as const,
      visible: true,
    },
  ],
  visible: true,
};
