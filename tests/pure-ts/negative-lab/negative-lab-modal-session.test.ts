import { describe, expect, test } from 'bun:test';

import type { NegativeConversionModalState } from '../../../src/store/useUIStore.ts';
import {
  createDefaultNegativeLabModalSession,
  openNegativeLabModalSession,
} from '../../../src/utils/negative-lab/negativeLabModalSession.ts';
import { updateNegativeLabSessionRecipe } from '../../../src/utils/negative-lab/negativeLabSessionState.ts';

const closedState = (): NegativeConversionModalState => ({
  isOpen: false,
  operationEpoch: 0,
  session: null,
  targetPaths: [],
});

describe('Negative Lab modal session initialization', () => {
  test('reconciles ordered targets before opening while retaining persisted recipe state', () => {
    const persisted = updateNegativeLabSessionRecipe(
      createDefaultNegativeLabModalSession(['/roll/a.dng', '/roll/b.dng']),
      (recipe) => ({ ...recipe, params: { ...recipe.params, exposure: 1.25 } }),
    );

    const opened = openNegativeLabModalSession({ ...closedState(), session: persisted }, [
      '/roll/b.dng',
      '/roll/c.dng',
    ]);

    expect(opened.isOpen).toBe(true);
    expect(opened.targetPaths).toEqual(['/roll/b.dng', '/roll/c.dng']);
    expect(opened.session?.session.targetPaths).toEqual(['/roll/b.dng', '/roll/c.dng']);
    expect(opened.session?.session.recipeState.params.exposure).toBe(1.25);
  });

  test('same-path reopen creates a fresh transient operation identity without resetting persisted state', () => {
    const firstOpen = openNegativeLabModalSession(closedState(), ['/roll/a.dng']);
    const reopened = openNegativeLabModalSession({ ...firstOpen, isOpen: false }, ['/roll/a.dng']);

    expect(reopened.operationEpoch).toBe(firstOpen.operationEpoch + 1);
    expect(reopened.session).toBe(firstOpen.session);
    expect(reopened.session?.session.sessionId).toBe(firstOpen.session?.session.sessionId);
  });

  test('a source set change preserves matching per-path state and quarantines removed transient frames', () => {
    const firstOpen = openNegativeLabModalSession(closedState(), ['/roll/a.dng', '/roll/b.dng']);
    const secondOpen = openNegativeLabModalSession({ ...firstOpen, isOpen: false }, ['/roll/b.dng', '/roll/c.dng']);

    expect(secondOpen.operationEpoch).toBe(2);
    expect(secondOpen.session?.session.frameStateByPath['/roll/a.dng']).toBeUndefined();
    expect(secondOpen.session?.session.frameStateByPath['/roll/b.dng']).toBeDefined();
    expect(secondOpen.session?.session.frameStateByPath['/roll/c.dng']).toBeDefined();
  });
});
