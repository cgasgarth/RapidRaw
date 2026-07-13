import { describe, expect, test } from 'bun:test';

import { decideAdjustmentPersistence } from '../../../src/utils/adjustmentPersistence';

const equal = (left: { mode: string }, right: { mode: string }) => left.mode === right.mode;

describe('adjustment persistence image-open currentness', () => {
  test('primes a new image without persisting provisional defaults', () => {
    const decision = decideAdjustmentPersistence(null, '/photos/image.arw', { mode: 'off' }, equal);

    expect(decision.action).toBe('prime');
    expect(decision.snapshot).toEqual({ adjustments: { mode: 'off' }, path: '/photos/image.arw' });
  });

  test('persists hydration and later edits only after the path is primed', () => {
    const provisional = { adjustments: { mode: 'off' }, path: '/photos/image.arw' };
    const hydrated = decideAdjustmentPersistence(provisional, '/photos/image.arw', { mode: 'guided' }, equal);

    expect(hydrated.action).toBe('persist');
    expect(decideAdjustmentPersistence(hydrated.snapshot, '/photos/image.arw', { mode: 'guided' }, equal).action).toBe(
      'unchanged',
    );
    expect(
      decideAdjustmentPersistence(hydrated.snapshot, '/photos/image.arw', { mode: 'auto_level' }, equal).action,
    ).toBe('persist');
  });
});
