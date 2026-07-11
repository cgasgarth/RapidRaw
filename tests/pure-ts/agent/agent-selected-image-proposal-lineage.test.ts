import { describe, expect, test } from 'bun:test';
import type { AgentSelectedImageProposalIterationV1 } from '../../../src/schemas/agent/agentSelectedImageProposalIterationSchemas';
import {
  addAgentSelectedImageProposalIteration,
  assertAgentSelectedImageProposalApplyable,
  createAgentSelectedImageProposalLineage,
  parseAgentSelectedImageProposalLineage,
  transitionAgentSelectedImageProposalIteration,
} from '../../../src/utils/agent/session/agentSelectedImageProposalLineage';

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const iteration = (
  ordinal: number,
  overrides: Partial<AgentSelectedImageProposalIterationV1> = {},
): AgentSelectedImageProposalIterationV1 => ({
  baseGraphRevision: 'history_7',
  basePreviewArtifactId: 'preview-base',
  basePreviewContentHash: hash('1'),
  baseRecipeHash: 'recipe:base',
  beforePreviewArtifactId: 'preview-base',
  beforePreviewContentHash: hash('1'),
  cleanupStatus: 'not_required',
  createdAt: '2026-07-11T12:00:00.000Z',
  expiresAt: '2026-07-11T12:05:00.000Z',
  initiatingTurnId: `turn-${ordinal}`,
  iterationId: `iteration-${ordinal}`,
  lineageId: 'lineage-1',
  ordinal,
  proposalHash: hash(String(ordinal)),
  proposalId: `proposal-${ordinal}`,
  proposalSchemaVersion: 1,
  schemaVersion: 1,
  selectedImageId: hash('a'),
  sessionId: 'session-1',
  state: 'draft',
  toolCalls: [{ callId: `call-${ordinal}`, type: 'proposal_render' }],
  ...overrides,
});

const transition = (
  lineage: ReturnType<typeof createAgentSelectedImageProposalLineage>,
  id: string,
  state: Parameters<typeof transitionAgentSelectedImageProposalIteration>[2],
) =>
  transitionAgentSelectedImageProposalIteration(lineage, id, state, {
    expectedEpoch: lineage.epoch,
    now: '2026-07-11T12:01:00.000Z',
  });

const ready = () => {
  let lineage = createAgentSelectedImageProposalLineage({ lineageId: 'lineage-1', sessionId: 'session-1' });
  lineage = addAgentSelectedImageProposalIteration(lineage, iteration(1));
  lineage = transition(lineage, 'iteration-1', 'rendering');
  return transition(lineage, 'iteration-1', 'ready');
};

describe('selected-image proposal lineage', () => {
  test('accepts the complete success transition chain', () => {
    let lineage = ready();
    lineage = transition(lineage, 'iteration-1', 'sealed');
    assertAgentSelectedImageProposalApplyable({
      acceptedProposalHash: hash('1'),
      acceptedProposalId: 'proposal-1',
      baseGraphRevision: 'history_7',
      basePreviewArtifactId: 'preview-base',
      basePreviewContentHash: hash('1'),
      baseRecipeHash: 'recipe:base',
      expectedEpoch: lineage.epoch,
      iterationId: 'iteration-1',
      lineage,
      now: '2026-07-11T12:02:00.000Z',
      selectedImageId: hash('a'),
      sessionId: 'session-1',
    });
    lineage = transition(lineage, 'iteration-1', 'applied');
    lineage = transition(lineage, 'iteration-1', 'reverted');
    expect(lineage.iterations[0]?.state).toBe('reverted');
  });

  test.each([
    ['draft', 'ready'],
    ['ready', 'applied'],
    ['sealed', 'reverted'],
    ['cancelled', 'sealed'],
    ['superseded', 'sealed'],
    ['stale', 'sealed'],
    ['failed', 'rendering'],
  ] as const)('rejects illegal %s -> %s transitions', (from, to) => {
    let lineage = createAgentSelectedImageProposalLineage({ lineageId: 'lineage-1', sessionId: 'session-1' });
    lineage = addAgentSelectedImageProposalIteration(lineage, iteration(1));
    if (from !== 'draft') {
      const paths = {
        cancelled: ['cancelled'],
        failed: ['failed'],
        ready: ['rendering', 'ready'],
        sealed: ['rendering', 'ready', 'sealed'],
        stale: ['stale'],
        superseded: ['rendering', 'superseded'],
      } as const;
      for (const state of paths[from]) lineage = transition(lineage, 'iteration-1', state);
    }
    expect(() => transition(lineage, 'iteration-1', to)).toThrow('Illegal proposal transition');
  });

  test('atomically supersedes the old head when a child is created', () => {
    let lineage = ready();
    lineage = transition(lineage, 'iteration-1', 'sealed');
    lineage = addAgentSelectedImageProposalIteration(
      lineage,
      iteration(2, { parentIterationId: 'iteration-1', parentProposalId: 'proposal-1' }),
    );
    expect(lineage.iterations[0]).toMatchObject({ cleanupStatus: 'pending', state: 'superseded' });
    expect(lineage.sealedIterationId).toBeUndefined();
    expect(() =>
      assertAgentSelectedImageProposalApplyable({
        acceptedProposalHash: hash('1'),
        acceptedProposalId: 'proposal-1',
        baseGraphRevision: 'history_7',
        basePreviewArtifactId: 'preview-base',
        basePreviewContentHash: hash('1'),
        baseRecipeHash: 'recipe:base',
        expectedEpoch: lineage.epoch,
        iterationId: 'iteration-1',
        lineage,
        selectedImageId: hash('a'),
        sessionId: 'session-1',
      }),
    ).toThrow('current sealed proposal head');
  });

  test('rejects duplicate ordinals, cross-session children, stale bases, expiry, and late results', () => {
    const lineage = ready();
    expect(() => addAgentSelectedImageProposalIteration(lineage, iteration(1))).toThrow('ordinal');
    expect(() =>
      addAgentSelectedImageProposalIteration(
        lineage,
        iteration(2, { parentIterationId: 'iteration-1', parentProposalId: 'proposal-1', sessionId: 'other' }),
      ),
    ).toThrow('Cross-session');
    expect(() =>
      transitionAgentSelectedImageProposalIteration(lineage, 'iteration-1', 'sealed', {
        expectedEpoch: lineage.epoch - 1,
      }),
    ).toThrow('epoch');
    expect(() =>
      transitionAgentSelectedImageProposalIteration(lineage, 'iteration-1', 'sealed', {
        expectedEpoch: lineage.epoch,
        now: '2026-07-11T12:06:00.000Z',
      }),
    ).toThrow('Expired');
    const sealed = transition(lineage, 'iteration-1', 'sealed');
    expect(() =>
      assertAgentSelectedImageProposalApplyable({
        acceptedProposalHash: hash('1'),
        acceptedProposalId: 'proposal-1',
        baseGraphRevision: 'history_8',
        basePreviewArtifactId: 'preview-base',
        basePreviewContentHash: hash('1'),
        baseRecipeHash: 'recipe:base',
        expectedEpoch: sealed.epoch,
        iterationId: 'iteration-1',
        lineage: sealed,
        now: '2026-07-11T12:02:00.000Z',
        selectedImageId: hash('a'),
        sessionId: 'session-1',
      }),
    ).toThrow('base identity is stale');
  });

  test('rejects reconstructed state with two sealed heads', () => {
    const lineage = transition(ready(), 'iteration-1', 'sealed');
    expect(() =>
      parseAgentSelectedImageProposalLineage({
        ...lineage,
        iterations: [
          ...lineage.iterations,
          iteration(2, { parentIterationId: 'iteration-1', parentProposalId: 'proposal-1', state: 'sealed' }),
        ],
        sealedIterationId: 'iteration-2',
      }),
    ).toThrow('Multiple sealed');
  });
});
