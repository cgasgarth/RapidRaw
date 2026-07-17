import { describe, expect, it } from 'bun:test';
import { retainEditorPreviewSource } from '../../../src/utils/editorImagePreviewSource.ts';

describe('editor preview source retention', () => {
  it('retains the last same-image CPU source while zoom work clears the current URL', () => {
    const retained = retainEditorPreviewSource({
      currentSource: 'blob:fit',
      retainedSource: null,
      sourceIdentity: '/photos/alaska.arw',
    });

    expect(
      retainEditorPreviewSource({
        currentSource: null,
        retainedSource: retained,
        sourceIdentity: '/photos/alaska.arw',
      }),
    ).toEqual({ sourceIdentity: '/photos/alaska.arw', url: 'blob:fit' });
  });

  it('never carries a CPU source across image sessions', () => {
    expect(
      retainEditorPreviewSource({
        currentSource: null,
        retainedSource: { sourceIdentity: '/photos/old.arw', url: 'blob:old' },
        sourceIdentity: '/photos/new.arw',
      }),
    ).toBeNull();
  });
});
