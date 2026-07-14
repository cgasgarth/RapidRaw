import { describe, expect, test } from 'bun:test';
import { viewerSurfaceDataAttributes } from '../../../src/components/panel/editor/ViewerSurface';
import { createEditorOverlayGeometry } from '../../../src/utils/editorOverlayGeometry';
import { createEditorPresentationDescriptor } from '../../../src/utils/editorPresentationDescriptor';

const geometry = createEditorOverlayGeometry({
  crop: null,
  devicePixelRatio: 2,
  geometryEpoch: 19,
  orientationSteps: 0,
  renderSize: { height: 600, offsetX: 20, offsetY: 10, scale: 0.5, width: 800 },
  rotationDegrees: 0,
  semanticZoom: {
    cssPercent: 100,
    devicePixelsPerImagePixel: 1,
    displayPercent: 100,
    imagePixelsPerCssPixel: 1,
    imagePixelsPerDevicePixel: 0.5,
    mode: { kind: 'fit' },
    requiredPreviewResolution: 1600,
    transformScale: 1,
  },
  sourceSize: { height: 1200, width: 1600 },
  transform: { positionX: 0, positionY: 0, scale: 1 },
  viewportSizeCssPixels: { height: 620, width: 840 },
});

const presentation = createEditorPresentationDescriptor({
  colorTransformIdentity: 'fixture:display',
  compareIdentity: 'none',
  geometry,
  graphRevision: 'graph:1',
  overlayIdentity: 'none',
  proofTransformIdentity: 'none',
  quality: 'interactive',
  sourceIdentity: 'fixture.raw',
  textureSize: { height: 600, width: 800 },
});

describe('ViewerSurface presentation boundary', () => {
  test('publishes only immutable presentation and geometry identities', () => {
    expect(viewerSurfaceDataAttributes(presentation, geometry)).toEqual({
      'data-geometry-epoch': '19',
      'data-presentation-fingerprint': presentation.fingerprint,
      'data-viewer-surface': 'true',
    });
  });

  test('changes its geometry identity when a successor session replaces the view', () => {
    const successor = createEditorOverlayGeometry({
      crop: null,
      devicePixelRatio: 2,
      geometryEpoch: 20,
      orientationSteps: 0,
      renderSize: { height: 600, offsetX: 20, offsetY: 10, scale: 0.5, width: 800 },
      rotationDegrees: 0,
      semanticZoom: geometry.semanticZoom,
      sourceSize: geometry.sourceSize,
      transform: geometry.transform,
      viewportSizeCssPixels: geometry.viewportSizeCssPixels,
    });
    expect(viewerSurfaceDataAttributes(presentation, successor)['data-geometry-epoch']).toBe('20');
  });
});
