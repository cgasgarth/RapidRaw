import type { ViewerSamplerOverlayDescriptor } from './viewerSamplerSessionController';

export const ViewerSamplerOverlay = ({ descriptor }: { descriptor: ViewerSamplerOverlayDescriptor | null }) =>
  descriptor === null ? null : (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black/20 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
      data-geometry-epoch={descriptor.geometryEpoch}
      data-normalized-x={descriptor.normalizedImagePoint.x}
      data-normalized-y={descriptor.normalizedImagePoint.y}
      data-operation-generation={descriptor.operationGeneration}
      data-request-identity={descriptor.requestIdentity}
      data-sampler-status={descriptor.status}
      data-sampler-target={descriptor.target}
      data-testid="viewer-sampler-overlay"
      style={{ left: descriptor.viewPoint.x, top: descriptor.viewPoint.y }}
    />
  );
