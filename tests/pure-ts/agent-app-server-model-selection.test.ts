import { describe, expect, test } from 'bun:test';

import {
  agentModelSelectionReceiptSchema,
  buildAgentAppServerTurnTransportRequest,
  DEFAULT_AGENT_EDITING_MODEL_SELECTION,
} from '../../src/utils/agent/session/agentAppServerModelSelection';

describe('selected-image app-server model selection', () => {
  test('requests Terra with light reasoning through supported turn fields', () => {
    expect(buildAgentAppServerTurnTransportRequest(DEFAULT_AGENT_EDITING_MODEL_SELECTION)).toEqual({
      method: 'turn/start',
      params: { effort: 'light', model: 'gpt-5.6-terra' },
    });
  });

  test('requires explicit effective fallback configuration and reason', () => {
    expect(
      agentModelSelectionReceiptSchema.parse({
        effective: { modelId: 'gpt-5.6-terra-compatible', reasoningTier: 'low' },
        reason: 'Requested model tier is unavailable.',
        requested: DEFAULT_AGENT_EDITING_MODEL_SELECTION,
        status: 'fallback',
      }),
    ).toMatchObject({ status: 'fallback' });
    expect(
      agentModelSelectionReceiptSchema.safeParse({
        effective: { modelId: 'gpt-5.6-terra-compatible', reasoningTier: 'low' },
        requested: DEFAULT_AGENT_EDITING_MODEL_SELECTION,
        status: 'fallback',
      }).success,
    ).toBe(false);
  });

  test('represents rejection without an invented effective model', () => {
    expect(
      agentModelSelectionReceiptSchema.parse({
        effective: null,
        reason: 'Requested model is not available.',
        requested: DEFAULT_AGENT_EDITING_MODEL_SELECTION,
        status: 'rejected',
      }),
    ).toMatchObject({ effective: null, status: 'rejected' });
  });
});
