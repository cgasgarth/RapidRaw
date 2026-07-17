import { describe, expect, test } from 'bun:test';
import {
  createRetouchRemoveWorkflowState,
  reduceRetouchRemoveWorkflow,
} from '../../../src/utils/retouchRemoveWorkflow';

describe('canvas-first Remove workflow', () => {
  test('activates one typed tool authority and selects a single spot', () => {
    let state = createRetouchRemoveWorkflowState();
    state = reduceRetouchRemoveWorkflow(state, { layerId: 'remove-1', tool: 'remove', type: 'activate' });
    state = reduceRetouchRemoveWorkflow(state, { spotId: 'spot-a', type: 'select-spot' });

    expect(state).toMatchObject({
      activeLayerId: 'remove-1',
      activeTool: 'remove',
      selectedSpotId: 'spot-a',
      sessionActive: false,
    });
  });

  test('cancel and complete both close the current pointer session', () => {
    let state = reduceRetouchRemoveWorkflow(createRetouchRemoveWorkflowState(), {
      layerId: 'remove-1',
      tool: 'heal',
      type: 'activate',
    });
    state = reduceRetouchRemoveWorkflow(state, { type: 'begin-session' });
    expect(state.sessionActive).toBe(true);
    state = reduceRetouchRemoveWorkflow(state, { type: 'cancel-session' });
    expect(state.sessionActive).toBe(false);
    state = reduceRetouchRemoveWorkflow(state, { type: 'begin-session' });
    state = reduceRetouchRemoveWorkflow(state, { type: 'complete-session' });
    expect(state.sessionActive).toBe(false);
  });

  test('changing tools invalidates the selected spot and advances the generation', () => {
    let state = createRetouchRemoveWorkflowState();
    state = reduceRetouchRemoveWorkflow(state, { layerId: 'layer-a', tool: 'clone', type: 'activate' });
    state = reduceRetouchRemoveWorkflow(state, { spotId: 'spot-a', type: 'select-spot' });
    const generation = state.sessionGeneration;
    state = reduceRetouchRemoveWorkflow(state, { layerId: 'layer-b', tool: 'remove', type: 'activate' });

    expect(state.sessionGeneration).toBeGreaterThan(generation);
    expect(state).toMatchObject({ activeLayerId: 'layer-b', activeTool: 'remove', selectedSpotId: null });
  });

  test('spot visualization can be hidden and restored without changing edit authority', () => {
    let state = reduceRetouchRemoveWorkflow(createRetouchRemoveWorkflowState(), {
      layerId: 'remove-1',
      tool: 'remove',
      type: 'activate',
    });
    state = reduceRetouchRemoveWorkflow(state, { type: 'toggle-spots' });
    expect(state.spotsVisible).toBe(false);
    state = reduceRetouchRemoveWorkflow(state, { type: 'toggle-spots' });
    expect(state.spotsVisible).toBe(true);
    expect(state.activeLayerId).toBe('remove-1');
  });
});
