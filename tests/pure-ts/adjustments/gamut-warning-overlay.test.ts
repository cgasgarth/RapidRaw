import { describe, expect, test } from 'bun:test';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';

import {
  type GamutWarningOverlayPayload,
  gamutWarningOverlayPayloadSchema,
} from '../../../src/schemas/tauriEventSchemas';
import { useEditorStore } from '../../../src/store/useEditorStore';
import {
  formatGamutWarningCoverage,
  isCurrentExportSoftProofGamutWarningOverlay,
  resolveGamutWarningProofDimensions,
} from '../../../src/utils/color/runtime/gamutWarningDisplay.ts';

const imagePath = '/validation/current-export-soft-proof.ARW';
const recipeId = 'display-p3-jpeg';
const transform = {
  blackPointCompensation: 'Unsupported',
  colorManagedTransform: 'moxcms Display P3 Relative Colorimetric 8-bit',
  effectiveColorProfile: 'Display P3',
  effectiveRenderingIntent: 'Relative Colorimetric',
  policyStatus: 'color_managed',
  policyVersion: 'rawengine.export-color-policy.v1',
  sourcePrecisionPath: 'float16-preview',
  transformApplied: true,
  transformPolicyFingerprint: 'sha256:gamut-warning-current',
};
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: imagePath,
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4000,
};
const loadedRawSelectedImage = {
  ...selectedImage,
  rawDevelopmentReport: {
    cameraProfile: {
      algorithmId: 'rawengine.camera_profile.v1',
      candidateCount: 1,
      illuminantEstimateConfidence: 'high',
      illuminantEstimateMethod: 'metadata_only_fallback',
      status: 'fallback',
      warningCodes: [],
    },
    demosaicPath: 'standard',
    processingProfile: 'balanced',
    runtime: {
      cacheHit: false,
      outputDimensions: [4000, 3000] as const,
    },
  },
} satisfies SelectedImage;
const currentOverlay: GamutWarningOverlayPayload = {
  black_point_compensation: transform.blackPointCompensation,
  color_managed_transform: transform.colorManagedTransform,
  coverage_ratio: 0.125,
  effective_color_profile: transform.effectiveColorProfile,
  effective_rendering_intent: transform.effectiveRenderingIntent,
  export_soft_proof_recipe_id: recipeId,
  height: 180,
  mask_data_url: 'data:image/png;base64,AAAA',
  max_channel_value: 255,
  min_channel_value: 0,
  pixel_count: 360,
  policy_status: transform.policyStatus,
  policy_version: transform.policyVersion,
  preview_basis: 'export_preview',
  source_image_path: imagePath,
  source_precision_path: transform.sourcePrecisionPath,
  transform_applied: transform.transformApplied,
  transform_policy_fingerprint: transform.transformPolicyFingerprint,
  warning_pixel_count: 45,
  width: 240,
};

const resetOverlayState = () => {
  useEditorStore.getState().setEditor({
    exportSoftProofRecipeId: null,
    exportSoftProofTransform: null,
    gamutWarningOverlay: null,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    selectedImage: null,
  });
};

describe('gamut warning overlay defaults', () => {
  test('keeps destructive preview mask opt-in', () => {
    expect(useEditorStore.getState().isGamutWarningOverlayVisible).toBe(false);
  });

  test('requires export soft-proof provenance in overlay event payloads', () => {
    expect(gamutWarningOverlayPayloadSchema.parse(currentOverlay).transform_policy_fingerprint).toBe(
      transform.transformPolicyFingerprint,
    );
    expect(
      gamutWarningOverlayPayloadSchema.safeParse({
        coverage_ratio: 0.125,
        height: 180,
        mask_data_url: 'data:image/png;base64,AAAA',
        max_channel_value: 255,
        min_channel_value: 0,
        pixel_count: 360,
        warning_pixel_count: 45,
        width: 240,
      }).success,
    ).toBe(false);
  });

  test('matches only the current export soft-proof transform', () => {
    expect(
      isCurrentExportSoftProofGamutWarningOverlay(currentOverlay, {
        exportSoftProofRecipeId: recipeId,
        exportSoftProofTransform: transform,
        isExportSoftProofEnabled: true,
        selectedImagePath: imagePath,
      }),
    ).toBe(true);
    expect(
      isCurrentExportSoftProofGamutWarningOverlay(
        { ...currentOverlay, transform_policy_fingerprint: 'sha256:stale' },
        {
          exportSoftProofRecipeId: recipeId,
          exportSoftProofTransform: transform,
          isExportSoftProofEnabled: true,
          selectedImagePath: imagePath,
        },
      ),
    ).toBe(false);
    expect(formatGamutWarningCoverage(currentOverlay)).toBe('12.5%');
  });

  test('falls back to loaded RAW proof dimensions when the overlay is not ready yet', () => {
    expect(resolveGamutWarningProofDimensions(null, loadedRawSelectedImage)).toEqual({
      height: 3000,
      width: 4000,
    });
  });

  test('clears stale overlays when proof state or selected image changes', () => {
    resetOverlayState();
    useEditorStore.getState().setEditor({
      exportSoftProofRecipeId: recipeId,
      exportSoftProofTransform: transform,
      gamutWarningOverlay: currentOverlay,
      isExportSoftProofEnabled: true,
      selectedImage,
    });
    expect(useEditorStore.getState().gamutWarningOverlay).toEqual(currentOverlay);

    useEditorStore.getState().setEditor({ exportSoftProofRecipeId: 'stale-recipe' });
    expect(useEditorStore.getState().gamutWarningOverlay).toBeNull();

    useEditorStore.getState().setEditor({
      exportSoftProofRecipeId: recipeId,
      exportSoftProofTransform: transform,
      gamutWarningOverlay: currentOverlay,
      isExportSoftProofEnabled: true,
      selectedImage,
    });
    useEditorStore.getState().setEditor({
      selectedImage: { ...selectedImage, path: '/validation/other.ARW' },
    });
    expect(useEditorStore.getState().gamutWarningOverlay).toBeNull();
  });
});
