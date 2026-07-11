import { describe, expect, test } from 'bun:test';
import {
  canonicalizeAgentSelectedImageLifecycleValue,
  hashAgentSelectedImageLifecycleValue,
  sealAgentSelectedImageLifecyclePhase,
  upgradeAgentSelectedImageLiveSessionReceiptV1,
} from '../../../src/schemas/agent/agentSelectedImageLifecycleReceiptSchemas';

describe('selected-image lifecycle receipt hashing', () => {
  test('canonicalizes keys recursively and omits undefined values', () => {
    expect(canonicalizeAgentSelectedImageLifecycleValue({ z: 1, a: { y: undefined, b: 2 } })).toBe(
      '{"a":{"b":2},"z":1}',
    );
  });

  test('uses domain-separated cryptographic SHA-256', async () => {
    expect(await hashAgentSelectedImageLifecycleValue('known-vector', { a: 1 })).toBe(
      'sha256:9485601d90e4ea52cc3d43abad28931ff04a5a5a970b24cdb82750204f015245',
    );
    const proposal = await sealAgentSelectedImageLifecyclePhase('proposal', { proposalId: 'proposal-1' });
    expect(proposal.hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(proposal.hash).not.toBe(
      await hashAgentSelectedImageLifecycleValue('approval', { proposalId: 'proposal-1' }),
    );
  });

  test('marks V1 receipts as legacy evidence without upgrading weak hashes', () => {
    expect(upgradeAgentSelectedImageLiveSessionReceiptV1({ schemaVersion: 1, finalGraphHash: 'sha256:abcd' })).toEqual({
      legacyReceipt: { schemaVersion: 1, finalGraphHash: 'sha256:abcd' },
      proof: 'legacy_unverified',
      schemaVersion: 1,
    });
  });
});
