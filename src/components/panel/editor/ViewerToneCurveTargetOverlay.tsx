import type { ToneCurveTargetOverlayDescriptor } from './toneCurveTargetInteractionController';

export const ViewerToneCurveTargetOverlay = ({
  descriptors,
}: {
  descriptors: readonly ToneCurveTargetOverlayDescriptor[];
}) => (
  <>
    {descriptors.map((descriptor) => (
      <div
        aria-label={descriptor.ariaLabel}
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/25 shadow-[0_0_0_1px_rgba(0,0,0,0.75),0_0_12px_rgba(255,255,255,0.45)]"
        data-curve-target-channel={descriptor.channel}
        data-curve-target-mode={descriptor.mode}
        data-curve-target-region={descriptor.region}
        data-geometry-epoch={descriptor.geometryEpoch}
        data-normalized-x={descriptor.normalizedImagePoint.x.toFixed(6)}
        data-normalized-y={descriptor.normalizedImagePoint.y.toFixed(6)}
        data-curve-target-status={descriptor.status}
        data-testid="tone-curve-target-overlay"
        key={descriptor.id}
        style={{ height: 20, left: descriptor.viewPoint.x, top: descriptor.viewPoint.y, width: 20, zIndex: 53 }}
      >
        <span className="absolute inset-1 rounded-full border border-white/80" />
      </div>
    ))}
  </>
);
