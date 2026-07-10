import type { PreviewQualityStatus } from '../../../utils/adaptivePreviewQuality';
import type { EditorCompareMode } from '../../../utils/editorCompare';
import type { EditorZoomResolutionState } from '../../../utils/editorZoom';
import type { ViewerActiveTool } from './viewerInputResolver';

export type ViewerFooterTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';
export type ViewerFooterLiveMode = 'assertive' | 'off' | 'polite';
export type ViewerFooterRenderPhase = 'coherent' | 'degraded' | 'detail-ready' | 'error' | 'interactive' | 'refining';

export interface ViewerFooterRenderStatus {
  announce: ViewerFooterLiveMode;
  busy: boolean;
  label: string;
  phase: ViewerFooterRenderPhase;
  progress: number | null;
  tone: ViewerFooterTone;
}

export interface ViewerFooterToolHint {
  cancelHint: string | null;
  label: string;
  tool: Exclude<ViewerActiveTool, 'none'>;
}

export type ViewerFooterDensity = 'compact' | 'regular' | 'wide';

export interface ViewerFooterResponsiveModel {
  density: ViewerFooterDensity;
  overflow: Array<'compare' | 'dimensions' | 'diagnostics' | 'filename' | 'sampler'>;
  showCompare: boolean;
  showDimensions: boolean;
  showDiagnostics: boolean;
  showFilename: boolean;
  showSampler: boolean;
}

export interface ViewerFooterSelectionModel {
  dimensions: string | null;
  filename: string | null;
  primary: string;
}

const renderStatus = (
  phase: ViewerFooterRenderPhase,
  label: string,
  tone: ViewerFooterTone,
  announce: ViewerFooterLiveMode,
  busy = false,
): ViewerFooterRenderStatus => ({ announce, busy, label, phase, progress: busy ? null : 1, tone });

export const resolveViewerFooterRenderStatus = ({
  error,
  isRendering,
  qualityStatus,
  zoomResolutionState,
}: {
  error?: string | null;
  isRendering: boolean;
  qualityStatus: PreviewQualityStatus | null;
  zoomResolutionState: EditorZoomResolutionState;
}): ViewerFooterRenderStatus => {
  if (error) return renderStatus('error', error, 'danger', 'assertive');
  if (qualityStatus?.phase === 'degraded_limited' || zoomResolutionState === 'limited') {
    return renderStatus('degraded', 'Preview detail limited', 'warning', 'assertive');
  }
  if (qualityStatus?.phase === 'rendering_interaction' || qualityStatus?.phase === 'displaying_interaction') {
    return renderStatus('interactive', 'Interactive preview', 'info', 'off', true);
  }
  if (qualityStatus?.phase === 'refining_current_view' || (isRendering && qualityStatus === null)) {
    return renderStatus('refining', 'Refining current view', 'info', 'polite', true);
  }
  if (zoomResolutionState === 'settling') {
    return renderStatus('refining', 'Preparing zoom detail', 'info', 'polite', true);
  }
  if (qualityStatus?.phase === 'detail_ready') {
    return renderStatus('detail-ready', '1:1 detail ready', 'success', 'polite');
  }
  return renderStatus('coherent', 'Preview ready', 'success', 'off');
};

const toolHints: Record<Exclude<ViewerActiveTool, 'none'>, ViewerFooterToolHint> = {
  brush: { cancelHint: 'Esc', label: 'Paint the active mask', tool: 'brush' },
  crop: { cancelHint: 'Esc', label: 'Drag to crop; Enter applies', tool: 'crop' },
  mask: { cancelHint: 'Esc', label: 'Draw on the image to define the mask', tool: 'mask' },
  'object-prompt': { cancelHint: 'Esc', label: 'Click the subject or drag a prompt box', tool: 'object-prompt' },
  retouch: { cancelHint: 'Esc', label: 'Click to place the retouch source and target', tool: 'retouch' },
  'white-balance': { cancelHint: 'Esc', label: 'Click a neutral area to set white balance', tool: 'white-balance' },
};

export const resolveViewerFooterToolHint = (tool: ViewerActiveTool): ViewerFooterToolHint | null =>
  tool === 'none' ? null : toolHints[tool];

export const resolveViewerFooterCompareLabel = (mode: EditorCompareMode): string | null => {
  if (mode === 'off') return null;
  if (mode === 'hold-original') return 'Compare: Before';
  if (mode === 'side-by-side') return 'Compare: Side by side';
  return 'Compare: Split';
};

export const resolveViewerFooterSelection = ({
  filename,
  height,
  index,
  selectedCount,
  total,
  width,
}: {
  filename: string | null;
  height: number;
  index: number;
  selectedCount: number;
  total: number;
  width: number;
}): ViewerFooterSelectionModel => ({
  dimensions: width > 0 && height > 0 ? `${String(width)} x ${String(height)}` : null,
  filename,
  primary:
    selectedCount > 1
      ? `${String(selectedCount)} selected`
      : index >= 0 && total > 0
        ? `${String(index + 1)} of ${String(total)}`
        : '1 selected',
});

export const resolveViewerFooterResponsiveModel = ({
  compareActive,
  diagnosticsActive,
  samplerActive,
  width,
}: {
  compareActive: boolean;
  diagnosticsActive: boolean;
  samplerActive: boolean;
  width: number;
}): ViewerFooterResponsiveModel => {
  if (width < 640) {
    return {
      density: 'compact',
      overflow: [
        'filename',
        'dimensions',
        ...(samplerActive ? (['sampler'] as const) : []),
        ...(compareActive ? (['compare'] as const) : []),
        ...(diagnosticsActive ? (['diagnostics'] as const) : []),
      ],
      showCompare: false,
      showDimensions: false,
      showDiagnostics: false,
      showFilename: false,
      showSampler: false,
    };
  }
  if (width < 960) {
    return {
      density: 'regular',
      overflow: [
        'dimensions',
        ...(samplerActive ? (['sampler'] as const) : []),
        ...(diagnosticsActive ? (['diagnostics'] as const) : []),
      ],
      showCompare: compareActive,
      showDimensions: false,
      showDiagnostics: false,
      showFilename: true,
      showSampler: false,
    };
  }
  return {
    density: 'wide',
    overflow: [],
    showCompare: compareActive,
    showDimensions: true,
    showDiagnostics: diagnosticsActive,
    showFilename: true,
    showSampler: samplerActive,
  };
};
