export interface RenderSize {
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  width: number;
}

const CSS_PIXEL_TOLERANCE = 0.5;
const SCALE_TOLERANCE = 1 / 4096;
export const RENDER_SIZE_SETTLE_MS = 50;

export const areRenderSizesEquivalent = (left: RenderSize, right: RenderSize): boolean =>
  Math.abs(left.width - right.width) <= CSS_PIXEL_TOLERANCE &&
  Math.abs(left.height - right.height) <= CSS_PIXEL_TOLERANCE &&
  Math.abs(left.scale - right.scale) <= SCALE_TOLERANCE &&
  Math.abs(left.offsetX - right.offsetX) <= CSS_PIXEL_TOLERANCE &&
  Math.abs(left.offsetY - right.offsetY) <= CSS_PIXEL_TOLERANCE;

export const hasMaterialRenderSizeChange = (left: RenderSize, right: RenderSize): boolean =>
  Math.abs(left.width - right.width) > CSS_PIXEL_TOLERANCE ||
  Math.abs(left.height - right.height) > CSS_PIXEL_TOLERANCE ||
  Math.abs(left.scale - right.scale) > SCALE_TOLERANCE;

/**
 * Coalesces ResizeObserver bursts before React publication. Layout may report
 * several self-invalidating intermediate boxes during a layout transition;
 * only the final settled geometry is allowed to update component state.
 */
export class RenderSizePublicationQueue {
  private pending: RenderSize | null = null;
  private published: RenderSize;

  constructor(initial: RenderSize) {
    this.published = initial;
  }

  observe(value: RenderSize): void {
    this.pending = value;
  }

  flush(): RenderSize | null {
    const value = this.pending;
    this.pending = null;
    if (value === null || areRenderSizesEquivalent(this.published, value)) return null;
    this.published = value;
    return value;
  }

  snapshot(): RenderSize {
    return this.published;
  }
}
