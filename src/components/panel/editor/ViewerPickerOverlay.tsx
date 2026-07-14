import type { ViewerPickerOverlayDescriptor } from './viewerPickerInteractionControllers';

export const ViewerPickerOverlay = ({ descriptors }: { descriptors: readonly ViewerPickerOverlayDescriptor[] }) => (
  <>
    {descriptors.map((descriptor) => (
      <div
        aria-label={descriptor.ariaLabel}
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/30 shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
        data-geometry-epoch={descriptor.geometryEpoch}
        data-normalized-x={descriptor.normalizedImagePoint.x.toFixed(6)}
        data-normalized-y={descriptor.normalizedImagePoint.y.toFixed(6)}
        data-picker-status={descriptor.status}
        data-picker-tool={descriptor.toolId}
        data-testid="viewer-picker-overlay"
        key={descriptor.id}
        style={{ height: 18, left: descriptor.viewPoint.x, top: descriptor.viewPoint.y, width: 18, zIndex: 52 }}
      />
    ))}
  </>
);
