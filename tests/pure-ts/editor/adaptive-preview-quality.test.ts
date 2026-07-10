import { describe, expect, test } from 'bun:test';
import {
  AdaptivePreviewQualityController,
  getPreviewReadyPhase,
  resolveAdaptivePreviewQuality,
} from '../../../src/utils/adaptivePreviewQuality.ts';

const baseInput = {
  backend: 'cpu' as const,
  devicePixelRatio: 2,
  inputCadenceMs: 16,
  interacting: true,
  operationClass: 'standard' as const,
  recentRenderMs: 12,
  requestedTargetResolution: 6000,
  semanticZoom: 'viewport' as const,
  sourceHeight: 4000,
  sourceWidth: 6000,
  visibleRoi: null,
};

describe('adaptive preview quality policy', () => {
  test('degrades only when rendering falls behind input and applies hysteresis', () => {
    const slow = resolveAdaptivePreviewQuality({ ...baseInput, recentRenderMs: 60 });
    expect(slow.tier).toBe('interaction_low');
    expect(slow.effectiveTargetResolution).toBe(2520);

    const heldLow = resolveAdaptivePreviewQuality({ ...baseInput, recentRenderMs: 13 }, 'interaction_low');
    expect(heldLow.tier).toBe('interaction_low');

    const recovered = resolveAdaptivePreviewQuality({ ...baseInput, recentRenderMs: 8 }, 'interaction_low');
    expect(recovered.tier).toBe('interaction_balanced');
  });

  test('pads high-zoom ROI and uses it to keep inspection work within memory bounds', () => {
    const decision = resolveAdaptivePreviewQuality({
      ...baseInput,
      interacting: false,
      requestedTargetResolution: 12_000,
      semanticZoom: 'inspection',
      sourceHeight: 8000,
      sourceWidth: 12_000,
      visibleRoi: [0.25, 0.25, 0.2, 0.2],
    });

    expect(decision.tier).toBe('inspection_1to1');
    expect(decision.effectiveRoi?.[0]).toBeLessThan(0.25);
    expect(decision.effectiveRoi?.[2]).toBeGreaterThan(0.2);
    expect(decision.effectiveTargetResolution).toBe(8192);
    expect(decision.limitedBy).toBe('target_dimension');
    expect(decision.sufficientForSemanticZoom).toBe(false);
    expect(getPreviewReadyPhase(decision)).toBe('degraded_limited');
  });

  test('keeps fit work full-frame and gives WGPU a larger deterministic target cap', () => {
    const cpu = resolveAdaptivePreviewQuality({
      ...baseInput,
      interacting: false,
      requestedTargetResolution: 10_000,
      semanticZoom: 'fit',
      sourceHeight: 6667,
      sourceWidth: 10_000,
      visibleRoi: [0.2, 0.2, 0.2, 0.2],
    });
    const wgpu = resolveAdaptivePreviewQuality({ ...baseInput, backend: 'wgpu', interacting: false });

    expect(cpu.effectiveRoi).toBeNull();
    expect(cpu.effectiveTargetResolution).toBeLessThan(10_000);
    expect(wgpu.effectiveTargetResolution).toBe(6000);
    expect(wgpu.limitedBy).toBeNull();
    expect(resolveAdaptivePreviewQuality({ ...baseInput, interacting: false, semanticZoom: 'viewport' }).tier).toBe(
      'viewport_full',
    );
  });

  test('records bounded render/decode/input metrics for deterministic traces', () => {
    const controller = new AdaptivePreviewQualityController();
    for (let index = 0; index < 30; index += 1) {
      controller.noteInput(index * 16);
      controller.record({
        commitMs: 1,
        decodeMs: 3,
        displayedAgeMs: 24,
        inputToDispatchMs: 2,
        renderMs: 20 + index,
        tier: 'interaction_balanced',
      });
    }

    expect(controller.metrics()).toHaveLength(24);
    const decision = controller.decide({
      backend: 'cpu',
      devicePixelRatio: 2,
      interacting: true,
      operationClass: 'mask',
      requestedTargetResolution: 4096,
      semanticZoom: 'viewport',
      sourceHeight: 4000,
      sourceWidth: 6000,
      visibleRoi: null,
    });
    expect(decision.tier).toBe('interaction_low');
  });
});
