import { describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';

describe('gamut warning overlay defaults', () => {
  test('keeps destructive preview mask opt-in', () => {
    expect(useEditorStore.getState().isGamutWarningOverlayVisible).toBe(false);
  });
});
