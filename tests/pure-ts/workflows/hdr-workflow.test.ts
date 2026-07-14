import { describe, expect, test } from 'bun:test';

import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/computational-merge/hdrMergeUiSchemas';
import {
  createHdrWorkflowState,
  isCurrentHdrWorkflow,
  reduceHdrWorkflow,
} from '../../../src/workflows/hdr/hdrWorkflow';
import type { OperationLaunch } from '../../../src/workflows/operationLifecycle';

const launch = (launchId: string, sourcePaths: readonly string[] = ['a.raw', 'b.raw']): OperationLaunch => ({
  kind: 'hdr',
  launchId,
  openedAtRevision: 1,
  sourcePaths,
});

describe('HDR workflow reducer', () => {
  test('owns the typed review and run lifecycle without React or Zustand', () => {
    const first = launch('hdr:first');
    let state = reduceHdrWorkflow(createHdrWorkflowState(DEFAULT_HDR_MERGE_UI_SETTINGS), {
      type: 'open',
      launch: first,
      settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
    });

    for (const event of [
      { type: 'prepare', launchId: first.launchId },
      { type: 'ready', launchId: first.launchId },
      { type: 'start', launchId: first.launchId },
      { type: 'progress', launchId: first.launchId, progress: 0.5 },
      { type: 'complete', launchId: first.launchId },
    ] as const) {
      state = reduceHdrWorkflow(state, { type: 'lifecycle', event });
    }

    expect(state.session?.lifecycle).toBe('completed');
    expect(state.session?.progress).toBe(1);
    expect(isCurrentHdrWorkflow(state, first.launchId)).toBe(true);
  });

  test('rejects stale settings and lifecycle events after a fresh reopen', () => {
    const first = launch('hdr:first');
    const second = launch('hdr:second', ['c.raw', 'd.raw']);
    let state = reduceHdrWorkflow(createHdrWorkflowState(DEFAULT_HDR_MERGE_UI_SETTINGS), {
      type: 'open',
      launch: first,
      settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
    });
    state = reduceHdrWorkflow(state, {
      type: 'open',
      launch: second,
      settings: { ...DEFAULT_HDR_MERGE_UI_SETTINGS, toneMappingPreset: 'natural' },
    });
    const reopened = state;

    state = reduceHdrWorkflow(state, {
      type: 'settings',
      launchId: first.launchId,
      settings: { ...DEFAULT_HDR_MERGE_UI_SETTINGS, toneMappingPreset: 'highlight_detail' },
    });
    state = reduceHdrWorkflow(state, {
      type: 'lifecycle',
      event: { type: 'fail', launchId: first.launchId, error: 'stale failure' },
    });

    expect(state).toEqual(reopened);
    expect(isCurrentHdrWorkflow(state, first.launchId)).toBe(false);
    expect(isCurrentHdrWorkflow(state, second.launchId)).toBe(true);
  });

  test('close is terminal for its launch while a subsequent launch starts cleanly', () => {
    const first = launch('hdr:first');
    const second = launch('hdr:second');
    let state = reduceHdrWorkflow(createHdrWorkflowState(DEFAULT_HDR_MERGE_UI_SETTINGS), {
      type: 'open',
      launch: first,
      settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
    });
    state = reduceHdrWorkflow(state, {
      type: 'lifecycle',
      event: { type: 'close', launchId: first.launchId },
    });
    const closed = state;
    state = reduceHdrWorkflow(state, {
      type: 'lifecycle',
      event: { type: 'start', launchId: first.launchId },
    });
    expect(state).toEqual(closed);

    state = reduceHdrWorkflow(state, {
      type: 'open',
      launch: second,
      settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
    });
    expect(state.session?.launch.launchId).toBe(second.launchId);
    expect(state.session?.lifecycle).toBe('idle');
    expect(state.session?.progress).toBeNull();
  });
});
