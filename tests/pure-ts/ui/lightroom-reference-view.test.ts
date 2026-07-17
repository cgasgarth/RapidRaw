import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_EDITOR_REFERENCE_VIEW_STATE,
  isEditorReferenceViewActive,
  isReferenceViewReferenceSelectable,
  reduceEditorReferenceView,
} from '../../../src/utils/editorReferenceView';

const reference = {
  id: '/tmp/reference.raw',
  label: 'reference.raw',
  path: '/tmp/reference.raw',
  renderUrl: 'blob:ref',
};

describe('Lightroom-style Reference View state', () => {
  it('enters a chooser without changing the active image', () => {
    const state = reduceEditorReferenceView(DEFAULT_EDITOR_REFERENCE_VIEW_STATE, { type: 'enter' });
    expect(state.mode).toBe('side-by-side');
    expect(state.isChooserOpen).toBe(true);
    expect(isEditorReferenceViewActive(state)).toBe(true);
  });

  it('chooses, focuses, and clears a read-only reference deterministically', () => {
    const chosen = reduceEditorReferenceView(DEFAULT_EDITOR_REFERENCE_VIEW_STATE, {
      image: reference,
      type: 'set-reference',
    });
    expect(chosen.reference).toEqual(reference);
    expect(chosen.isChooserOpen).toBe(false);
    const focused = reduceEditorReferenceView(chosen, { pane: 'reference', type: 'set-active-pane' });
    expect(focused.activePane).toBe('reference');
    const cleared = reduceEditorReferenceView(focused, { type: 'clear-reference' });
    expect(cleared.reference).toBeNull();
    expect(cleared.isChooserOpen).toBe(true);
    expect(cleared.activePane).toBe('active');
  });

  it('keeps sync and pane focus explicit', () => {
    const state = reduceEditorReferenceView(
      reduceEditorReferenceView(DEFAULT_EDITOR_REFERENCE_VIEW_STATE, { image: reference, type: 'set-reference' }),
      { type: 'toggle-synchronized-transform' },
    );
    expect(state.synchronizedTransform).toBe(false);
    expect(reduceEditorReferenceView(state, { type: 'swap-panes' }).activePane).toBe('reference');
  });

  it('rejects the active image and current reference as chooser candidates', () => {
    expect(
      isReferenceViewReferenceSelectable(
        { ...DEFAULT_EDITOR_REFERENCE_VIEW_STATE, reference },
        '/tmp/active.raw',
        '/tmp/active.raw',
      ),
    ).toBe(false);
    expect(
      isReferenceViewReferenceSelectable(
        { ...DEFAULT_EDITOR_REFERENCE_VIEW_STATE, reference },
        reference.path,
        '/tmp/active.raw',
      ),
    ).toBe(false);
    expect(
      isReferenceViewReferenceSelectable(
        { ...DEFAULT_EDITOR_REFERENCE_VIEW_STATE, reference: null },
        '/tmp/next.raw',
        '/tmp/active.raw',
      ),
    ).toBe(true);
  });
});
