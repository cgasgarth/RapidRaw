import { describe, expect, test } from 'bun:test';
import {
  type AiModelProgressById,
  formatAiModelProgress,
  parseAiModelProgress,
  updateAiModelProgress,
} from '../../src/utils/aiModelProgress';

describe('AI model progress', () => {
  test('keeps concurrent models independent and removes only the completed model', () => {
    let state: AiModelProgressById = {};
    const sky = parseAiModelProgress({
      modelId: 'skyU2Net',
      phase: 'downloading',
      bytesCurrent: 25,
      bytesTotal: 100,
    });
    const depth = parseAiModelProgress({
      modelId: 'depthAnything',
      phase: 'downloading',
      bytesCurrent: 50,
      bytesTotal: 100,
    });
    expect(sky).not.toBeNull();
    expect(depth).not.toBeNull();
    state = updateAiModelProgress(state, sky!);
    state = updateAiModelProgress(state, depth!);
    expect(formatAiModelProgress(state)).toBe('skyU2Net: 25% · depthAnything: 50%');

    state = updateAiModelProgress(state, { modelId: 'skyU2Net', phase: 'verified' });
    expect(formatAiModelProgress(state)).toBe('depthAnything: 50%');
  });

  test('rejects malformed progress rather than overwriting UI state', () => {
    expect(parseAiModelProgress('Sky Model')).toBeNull();
    expect(parseAiModelProgress({ modelId: '', phase: 'downloading' })).toBeNull();
  });

  test('retains a capability-specific terminal failure', () => {
    const failure = parseAiModelProgress({
      modelId: 'depthAnything',
      phase: 'failed',
      error: 'ai_model_digest_mismatch',
    });
    expect(failure).not.toBeNull();
    const state = updateAiModelProgress({}, failure!);
    expect(formatAiModelProgress(state)).toBe('depthAnything: ai_model_digest_mismatch');
  });
});
