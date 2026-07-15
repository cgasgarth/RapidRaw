import { describe, expect, test } from 'bun:test';
import {
  createPreviewCoordinatorState,
  type PreviewArtifact,
  type PreviewCoordinatorState,
  type PreviewCoordinatorTransition,
} from '../../../src/utils/previewCoordinator';
import { PreviewUrlReleaseAuthority } from '../../../src/utils/previewUrlReleaseAuthority';

const artifact = (url: string, kind: 'interactive' | 'original' | 'settled' = 'settled'): PreviewArtifact => ({
  identity: {
    generation: 1,
    kind,
    operationId: 1,
    session: {
      adjustmentRevision: 1,
      backend: 'cpu',
      displayGeneration: 1,
      geometryRevision: 1,
      graphRevision: 'graph',
      imageSessionId: 1,
      maskRevision: 1,
      patchRevision: 1,
      proofRevision: 1,
      roiFingerprint: 'full',
      sourceImagePath: '/image.raw',
      sourceRevision: 1,
      targetHeight: 1024,
      targetWidth: 1024,
      viewportRevision: 1,
    },
  },
  url,
});

const state = (values: Partial<PreviewCoordinatorState> = {}): PreviewCoordinatorState => ({
  ...createPreviewCoordinatorState(),
  ...values,
});

const releaseTransition = (
  next: PreviewCoordinatorState,
  url: string,
  reason: string,
): PreviewCoordinatorTransition => ({
  effects: [{ reason, type: 'release-url', url }],
  state: next,
});

describe('preview URL release authority', () => {
  test('releases stale and never-presented materializations once across duplicate completion and failure cleanup', () => {
    const released: string[] = [];
    const authority = new PreviewUrlReleaseAuthority({ release: (url) => released.push(url) });
    const empty = state();

    for (const [url, reason] of [
      ['blob:stale-edited', 'artifact-not-presented'],
      ['blob:stale-original', 'stale-original-artifact'],
      ['blob:cpu-failure', 'materialization-failed'],
      ['blob:wgpu-cancelled', 'request-cancelled'],
    ] as const) {
      const transition = releaseTransition(empty, url, reason);
      authority.consume(empty, transition);
      authority.consume(empty, transition);
      authority.release(url);
    }

    expect(released).toEqual(['blob:stale-edited', 'blob:stale-original', 'blob:cpu-failure', 'blob:wgpu-cancelled']);
  });

  test('transfers edited and original artifacts to the surface through replacement, display invalidation, and cancel', () => {
    const released: string[] = [];
    const authority = new PreviewUrlReleaseAuthority({ release: (url) => released.push(url) });
    const presented = state({
      originalArtifact: artifact('blob:original-a', 'original'),
      visibleArtifact: artifact('blob:edited-a'),
    });
    const next = state({
      originalArtifact: artifact('blob:original-b', 'original'),
      visibleArtifact: artifact('blob:edited-b'),
    });

    authority.consume(presented, releaseTransition(next, 'blob:edited-a', 'artifact-replaced'));
    authority.consume(presented, releaseTransition(next, 'blob:original-a', 'original-artifact-replaced'));
    authority.consume(presented, releaseTransition(state(), 'blob:edited-a', 'display-generation-changed'));
    authority.consume(presented, releaseTransition(state(), 'blob:original-a', 'compare-disabled'));
    authority.consume(presented, releaseTransition(state(), 'blob:edited-a', 'editor-unmounted'));

    expect(released).toEqual([]);
    expect(authority.hasReleased('blob:edited-a')).toBe(false);
    expect(authority.hasReleased('blob:original-a')).toBe(false);
  });

  test('surface release is exactly once for interactive-to-settled, A-B-A, and repeated session cancellation', () => {
    const released: string[] = [];
    const surface = new PreviewUrlReleaseAuthority({ release: (url) => released.push(url) });

    surface.release('blob:interactive-a');
    surface.release('blob:interactive-a');
    surface.release('blob:edited-b');
    surface.release('blob:edited-b');
    surface.release('blob:original-a');
    surface.release('blob:original-a');

    expect(released).toEqual(['blob:interactive-a', 'blob:edited-b', 'blob:original-a']);
    expect(released).not.toContain('blob:edited-a');
  });

  test('never revokes non-blob, current cache-owned, or repeated cache-transferred resources', () => {
    const released: string[] = [];
    const protectedUrls = new Set(['blob:cache-owned']);
    const authority = new PreviewUrlReleaseAuthority({
      isProtected: (url) => protectedUrls.has(url),
      release: (url) => released.push(url),
    });

    expect(authority.release('data:image/jpeg;base64,AA==')).toBe(false);
    expect(authority.release('https://example.test/preview.jpg')).toBe(false);
    expect(authority.release('blob:cache-owned')).toBe(false);
    protectedUrls.delete('blob:cache-owned');
    expect(authority.release('blob:cache-owned')).toBe(true);
    expect(authority.release('blob:cache-owned')).toBe(false);
    expect(released).toEqual(['blob:cache-owned']);
  });
});
