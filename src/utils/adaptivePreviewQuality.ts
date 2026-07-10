export type PreviewBackend = 'cpu' | 'wgpu';
export type PreviewQualityTier =
  | 'interaction_low'
  | 'interaction_balanced'
  | 'viewport_full'
  | 'inspection_1to1'
  | 'settled_full';
export type PreviewSettlePhase =
  | 'rendering_interaction'
  | 'displaying_interaction'
  | 'refining_current_view'
  | 'detail_ready'
  | 'final_ready'
  | 'degraded_limited';
export type PreviewOperationClass = 'geometry' | 'mask' | 'standard';
export type PreviewRoi = [number, number, number, number];

export interface PreviewQualityDecision {
  backend: PreviewBackend;
  effectiveRoi: PreviewRoi | null;
  effectiveTargetResolution: number;
  estimatedWorkingBytes: number;
  limitedBy: 'backend' | 'error' | 'memory' | 'target_dimension' | null;
  reason: string;
  requestedTargetResolution: number;
  sufficientForSemanticZoom: boolean;
  tier: PreviewQualityTier;
}

export interface PreviewQualityStatus extends PreviewQualityDecision {
  generation: number;
  phase: PreviewSettlePhase;
  requestId: number;
}

export interface PreviewTimingSample {
  commitMs: number;
  decodeMs: number;
  displayedAgeMs: number;
  inputToDispatchMs: number;
  renderMs: number;
  tier: PreviewQualityTier;
}

export interface AdaptivePreviewPolicyInput {
  backend: PreviewBackend;
  devicePixelRatio: number;
  inputCadenceMs: number | null;
  interacting: boolean;
  operationClass: PreviewOperationClass;
  recentRenderMs: number | null;
  requestedTargetResolution: number;
  semanticZoom: 'fit' | 'inspection' | 'viewport';
  sourceHeight: number;
  sourceWidth: number;
  visibleRoi: PreviewRoi | null;
}

const MEBIBYTE = 1024 * 1024;
const BYTES_PER_WORKING_PIXEL = 16;
const POLICY_LIMITS: Record<PreviewBackend, { maxBytes: number; maxTarget: number }> = {
  cpu: { maxBytes: 512 * MEBIBYTE, maxTarget: 8192 },
  wgpu: { maxBytes: 768 * MEBIBYTE, maxTarget: 12_288 },
};
const METRIC_LIMIT = 24;
const ROI_PADDING_FRACTION = 0.08;
const INTERACTION_MIN_TARGET = 640;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const padRoi = (roi: PreviewRoi | null): PreviewRoi | null => {
  if (roi === null) return null;
  const [x, y, width, height] = roi;
  const paddingX = width * ROI_PADDING_FRACTION;
  const paddingY = height * ROI_PADDING_FRACTION;
  const left = clamp(x - paddingX, 0, 1);
  const top = clamp(y - paddingY, 0, 1);
  const right = clamp(x + width + paddingX, 0, 1);
  const bottom = clamp(y + height + paddingY, 0, 1);
  if (left <= 0.001 && top <= 0.001 && right >= 0.999 && bottom >= 0.999) return null;
  return [left, top, right - left, bottom - top];
};

const capTargetResolution = ({
  backend,
  requestedTarget,
  roi,
  sourceHeight,
  sourceWidth,
}: {
  backend: PreviewBackend;
  requestedTarget: number;
  roi: PreviewRoi | null;
  sourceHeight: number;
  sourceWidth: number;
}) => {
  const limits = POLICY_LIMITS[backend];
  const sourceLongEdge = Math.max(1, sourceWidth, sourceHeight);
  const sourceShortEdge = Math.max(1, Math.min(sourceWidth || 1, sourceHeight || 1));
  const aspectPixelFactor = sourceShortEdge / sourceLongEdge;
  const roiArea = roi === null ? 1 : clamp(roi[2] * roi[3], 0.0001, 1);
  const memoryTarget = Math.floor(
    Math.sqrt(limits.maxBytes / Math.max(BYTES_PER_WORKING_PIXEL * aspectPixelFactor * roiArea, 1)),
  );
  const targetDimensionCapped = Math.min(requestedTarget, limits.maxTarget, sourceLongEdge);
  const effectiveTarget = Math.max(1, Math.floor(Math.min(targetDimensionCapped, memoryTarget)));
  const limitedBy =
    effectiveTarget >= requestedTarget
      ? null
      : memoryTarget < Math.min(requestedTarget, limits.maxTarget, sourceLongEdge)
        ? 'memory'
        : 'target_dimension';
  return {
    effectiveTarget,
    estimatedWorkingBytes: Math.round(
      effectiveTarget * effectiveTarget * aspectPixelFactor * roiArea * BYTES_PER_WORKING_PIXEL,
    ),
    limitedBy,
  } as const;
};

export const resolveAdaptivePreviewQuality = (
  input: AdaptivePreviewPolicyInput,
  previousInteractionTier: Extract<
    PreviewQualityTier,
    'interaction_balanced' | 'interaction_low'
  > = 'interaction_balanced',
): PreviewQualityDecision => {
  const requestedTarget = Math.max(1, Math.round(input.requestedTargetResolution));
  const paddedRoi = input.semanticZoom === 'fit' ? null : padRoi(input.visibleRoi);
  const renderBudgetRatio =
    input.recentRenderMs === null || input.inputCadenceMs === null
      ? 0
      : input.recentRenderMs / Math.max(input.inputCadenceMs, 1);

  let tier: PreviewQualityTier;
  let tierScale = 1;
  let reason: string;
  if (!input.interacting) {
    tier =
      input.semanticZoom === 'inspection'
        ? 'inspection_1to1'
        : input.semanticZoom === 'viewport'
          ? 'viewport_full'
          : 'settled_full';
    reason =
      input.semanticZoom === 'inspection'
        ? 'semantic_zoom_release'
        : input.semanticZoom === 'viewport'
          ? 'current_view_release'
          : 'committed_release';
  } else {
    const operationPressure = input.operationClass === 'mask' ? 1.2 : input.operationClass === 'geometry' ? 1.1 : 1;
    const degradeThreshold = previousInteractionTier === 'interaction_low' ? 0.72 : 1.15;
    const shouldUseLow = renderBudgetRatio * operationPressure >= degradeThreshold;
    tier = shouldUseLow ? 'interaction_low' : 'interaction_balanced';
    tierScale = shouldUseLow ? 0.42 : input.backend === 'cpu' ? 0.68 : 0.78;
    reason = shouldUseLow ? 'render_slower_than_input' : 'interactive_frame_budget';
  }

  const tierTarget = input.interacting
    ? Math.min(requestedTarget, Math.max(INTERACTION_MIN_TARGET, Math.round(requestedTarget * tierScale)))
    : requestedTarget;
  const { effectiveTarget, estimatedWorkingBytes, limitedBy } = capTargetResolution({
    backend: input.backend,
    requestedTarget: tierTarget,
    roi: paddedRoi,
    sourceHeight: input.sourceHeight,
    sourceWidth: input.sourceWidth,
  });
  const sufficientForSemanticZoom =
    input.semanticZoom !== 'inspection' ||
    (!input.interacting && limitedBy === null && effectiveTarget >= requestedTarget);

  return {
    backend: input.backend,
    effectiveRoi: paddedRoi,
    effectiveTargetResolution: effectiveTarget,
    estimatedWorkingBytes,
    limitedBy,
    reason: limitedBy === null ? reason : `${reason}_${limitedBy}_guard`,
    requestedTargetResolution: requestedTarget,
    sufficientForSemanticZoom,
    tier,
  };
};

export class AdaptivePreviewQualityController {
  private inputTimes: number[] = [];
  private interactionTier: Extract<PreviewQualityTier, 'interaction_balanced' | 'interaction_low'> =
    'interaction_balanced';
  private renderTimes: number[] = [];
  private samples: PreviewTimingSample[] = [];

  noteInput(now: number): void {
    this.inputTimes.push(now);
    if (this.inputTimes.length > METRIC_LIMIT + 1) this.inputTimes.shift();
  }

  decide(input: Omit<AdaptivePreviewPolicyInput, 'inputCadenceMs' | 'recentRenderMs'>): PreviewQualityDecision {
    const inputIntervals = this.inputTimes.slice(1).map((value, index) => value - (this.inputTimes[index] ?? value));
    const decision = resolveAdaptivePreviewQuality(
      {
        ...input,
        inputCadenceMs: average(inputIntervals),
        recentRenderMs: average(this.renderTimes),
      },
      this.interactionTier,
    );
    if (decision.tier === 'interaction_balanced' || decision.tier === 'interaction_low') {
      this.interactionTier = decision.tier;
    }
    return decision;
  }

  record(sample: PreviewTimingSample): void {
    this.samples.push({ ...sample });
    this.renderTimes.push(sample.renderMs);
    if (this.samples.length > METRIC_LIMIT) this.samples.shift();
    if (this.renderTimes.length > METRIC_LIMIT) this.renderTimes.shift();
  }

  metrics(): readonly PreviewTimingSample[] {
    return this.samples.map((sample) => ({ ...sample }));
  }

  reset(): void {
    this.inputTimes = [];
    this.interactionTier = 'interaction_balanced';
    this.renderTimes = [];
    this.samples = [];
  }
}

export const getPreviewReadyPhase = (decision: PreviewQualityDecision): PreviewSettlePhase => {
  if (decision.limitedBy !== null) return 'degraded_limited';
  if (decision.tier === 'interaction_balanced' || decision.tier === 'interaction_low') {
    return 'displaying_interaction';
  }
  return decision.tier === 'inspection_1to1' && decision.sufficientForSemanticZoom ? 'detail_ready' : 'final_ready';
};
