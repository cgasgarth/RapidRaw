import { describe, expect, test } from 'bun:test';

import {
  resolveViewerFooterCompareLabel,
  resolveViewerFooterRenderStatus,
  resolveViewerFooterResponsiveModel,
  resolveViewerFooterSelection,
  resolveViewerFooterToolHint,
} from '../../../src/components/panel/editor/viewerFooterModel.ts';
import type { PreviewQualityStatus } from '../../../src/utils/adaptivePreviewQuality.ts';

const quality = (phase: PreviewQualityStatus['phase']): PreviewQualityStatus => ({
  backend: 'wgpu',
  effectiveRoi: null,
  effectiveTargetResolution: 4096,
  estimatedWorkingBytes: 1,
  generation: 1,
  limitedBy: phase === 'degraded_limited' ? 'memory' : null,
  phase,
  reason: 'test',
  requestId: 1,
  requestedTargetResolution: 4096,
  sufficientForSemanticZoom: phase !== 'degraded_limited',
  tier: phase === 'detail_ready' ? 'inspection_1to1' : 'viewport_full',
});

describe('viewer footer model', () => {
  test('coalesces scheduler events into stable user-facing phases', () => {
    const rendering = resolveViewerFooterRenderStatus({
      isRendering: true,
      qualityStatus: quality('rendering_interaction'),
      zoomResolutionState: 'ready',
    });
    const displaying = resolveViewerFooterRenderStatus({
      isRendering: false,
      qualityStatus: quality('displaying_interaction'),
      zoomResolutionState: 'ready',
    });

    expect(rendering).toEqual(displaying);
    expect(rendering).toMatchObject({ announce: 'off', busy: true, label: 'Interactive preview', tone: 'info' });
    expect(
      resolveViewerFooterRenderStatus({
        isRendering: false,
        qualityStatus: quality('refining_current_view'),
        zoomResolutionState: 'ready',
      }),
    ).toMatchObject({ announce: 'polite', label: 'Refining current view', phase: 'refining' });
    expect(
      resolveViewerFooterRenderStatus({
        isRendering: false,
        qualityStatus: quality('detail_ready'),
        zoomResolutionState: 'ready',
      }),
    ).toMatchObject({ announce: 'polite', label: '1:1 detail ready', phase: 'detail-ready' });
  });

  test('prioritizes degraded and error states with assertive announcements', () => {
    expect(
      resolveViewerFooterRenderStatus({
        error: 'Preview unavailable',
        isRendering: false,
        qualityStatus: quality('detail_ready'),
        zoomResolutionState: 'ready',
      }),
    ).toMatchObject({ announce: 'assertive', label: 'Preview unavailable', phase: 'error', tone: 'danger' });
    expect(
      resolveViewerFooterRenderStatus({
        isRendering: false,
        qualityStatus: quality('degraded_limited'),
        zoomResolutionState: 'limited',
      }),
    ).toMatchObject({ announce: 'assertive', phase: 'degraded', tone: 'warning' });
  });

  test('publishes concise hints only for active tools', () => {
    expect(resolveViewerFooterToolHint('none')).toBeNull();
    expect(resolveViewerFooterToolHint('crop')).toEqual({
      cancelHint: 'Esc',
      label: 'Drag to crop; Enter applies',
      tool: 'crop',
    });
    expect(resolveViewerFooterToolHint('white-balance')?.label).toContain('neutral area');
  });

  test('builds selection and compare summaries without leaking implementation state', () => {
    expect(
      resolveViewerFooterSelection({
        filename: 'alaska.ARW',
        height: 4000,
        index: 2,
        selectedCount: 1,
        total: 12,
        width: 6000,
      }),
    ).toEqual({ dimensions: '6000 x 4000', filename: 'alaska.ARW', primary: '3 of 12' });
    expect(
      resolveViewerFooterSelection({ filename: null, height: 0, index: -1, selectedCount: 4, total: 12, width: 0 }),
    ).toMatchObject({ dimensions: null, primary: '4 selected' });
    expect(resolveViewerFooterCompareLabel('split-wipe')).toBe('Compare: Split');
    expect(resolveViewerFooterCompareLabel('off')).toBeNull();
  });

  test('keeps render and zoom visible while collapsing secondary zones', () => {
    expect(
      resolveViewerFooterResponsiveModel({
        compareActive: true,
        diagnosticsActive: true,
        samplerActive: true,
        width: 520,
      }),
    ).toEqual({
      density: 'compact',
      overflow: ['filename', 'dimensions', 'sampler', 'compare', 'diagnostics'],
      showCompare: false,
      showDimensions: false,
      showDiagnostics: false,
      showFilename: false,
      showSampler: false,
    });
    expect(
      resolveViewerFooterResponsiveModel({
        compareActive: true,
        diagnosticsActive: true,
        samplerActive: true,
        width: 1200,
      }),
    ).toMatchObject({ density: 'wide', overflow: [], showDiagnostics: true, showSampler: true });
  });
});
