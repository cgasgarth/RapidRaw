import { describe, expect, test } from 'bun:test';
import {
  agentSelectedImageLifecycleReceiptV2Schema,
  canonicalizeAgentSelectedImageLifecycleValue,
  hashAgentSelectedImageLifecycleValue,
  sealAgentSelectedImageLifecyclePhase,
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

  test('rejects V1 receipts instead of upgrading unverified legacy evidence', () => {
    expect(
      agentSelectedImageLifecycleReceiptV2Schema.safeParse({
        finalGraphHash: 'sha256:abcd',
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });
});
