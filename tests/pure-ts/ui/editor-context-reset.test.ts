import { describe, expect, test } from 'bun:test';

import { persistEditorResetForPath } from '../../../src/hooks/app/useAppContextMenus';

describe('editor context reset', () => {
  test('persists the immutable context-menu target before resolving', async () => {
    const calls: string[][] = [];
    let releaseReset: (() => void) | undefined;
    const resetFinished = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });

    const pendingReset = persistEditorResetForPath('/library/target.ARW', async (paths) => {
      calls.push(paths ?? []);
      await resetFinished;
    });

    expect(calls).toEqual([['/library/target.ARW']]);
    releaseReset?.();
    await pendingReset;
  });
});
