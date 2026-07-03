import { describe, expect, test } from 'bun:test';

import {
  buildColorOutputProofingDiagnostics,
  type PreviewScopeFreshnessStatus,
  type RenderedPreviewWarningStatus,
} from '../../../src/utils/color/runtime/gamutWarningDisplay';

const currentPreviewWarningStatus: RenderedPreviewWarningStatus = {
  coverageLabel: '2.3%',
  displayProfileLabel: 'Display P3',
  exportProfileLabel: 'Display P3',
  renderTargetLabel: 'Export preview -> Display P3',
  state: 'current',
  statusLabel: 'Rendered preview current',
};

const currentScopeStatus: PreviewScopeFreshnessStatus = {
  state: 'current',
  statusLabel: 'Scopes current',
};

describe('Color Output proofing diagnostics', () => {
  test('summarizes active display profile, LUT, soft proof transform, and gamut coverage', () => {
    const summary = buildColorOutputProofingDiagnostics({
      activeDisplayProfile: {
        cmm: 'colorsync+moxcms',
        displayId: 1,
        iccSha256: `sha256:${'a'.repeat(64)}`,
        profileByteCount: 4096,
        source: 'ColorSyncProfileCreateWithDisplayID(CGMainDisplayID())',
        status: 'active_profile_loaded',
      },
      currentGamutWarningOverlay: {
        black_point_compensation: 'enabled',
        color_managed_transform: 'moxcms.rgb16',
        coverage_ratio: 0.0234,
        effective_color_profile: 'Display P3',
        effective_rendering_intent: 'perceptual',
        export_soft_proof_recipe_id: 'display-p3-proof',
        height: 10,
        mask_data_url: 'data:image/png;base64,AA==',
        max_channel_value: 255,
        min_channel_value: 0,
        pixel_count: 100,
        policy_status: 'managed',
        policy_version: 'rawengine.export-color.v1',
        preview_basis: 'export_preview',
        source_image_path: '/proof/image.raw',
        source_precision_path: 'rgb16',
        transform_applied: true,
        transform_policy_fingerprint: 'sha256:proof-transform',
        warning_pixel_count: 3,
        width: 10,
      },
      displayProfileError: null,
      displayProfileLoading: false,
      displayPreviewLutStatus: {
        profile: {
          cmm: 'colorsync+moxcms',
          displayId: 1,
          iccSha256: `sha256:${'a'.repeat(64)}`,
          profileByteCount: 4096,
          source: 'ColorSyncProfileCreateWithDisplayID(CGMainDisplayID())',
          status: 'active_profile_loaded',
        },
        sampleCount: 32768,
        size: 32,
        status: 'active_display_transform',
      },
      exportSoftProofRecipeId: 'display-p3-proof',
      exportSoftProofTransform: {
        blackPointCompensation: 'enabled',
        colorManagedTransform: 'moxcms.rgb16',
        effectiveColorProfile: 'Display P3',
        effectiveRenderingIntent: 'perceptual',
        policyStatus: 'managed',
        policyVersion: 'rawengine.export-color.v1',
        sourcePrecisionPath: 'rgb16',
        transformApplied: true,
        transformPolicyFingerprint: 'sha256:proof-transform',
      },
      previewScopeFreshnessStatus: currentScopeStatus,
      previewScopeWarningCodes: ['histogram_export_preview'],
      renderedPreviewWarningStatus: currentPreviewWarningStatus,
    });

    expect(summary.displayProfileLabel).toBe('ColorSync active display profile');
    expect(summary.displayProfileHash).toBe(`sha256:${'a'.repeat(12)}`);
    expect(summary.lutStatusLabel).toBe('Active display LUT');
    expect(summary.lutSampleCount).toBe(32768);
    expect(summary.outputProfileLabel).toBe('Display P3');
    expect(summary.renderingIntentLabel).toBe('perceptual');
    expect(summary.gamutCoverageLabel).toBe('2.3%');
    expect(summary.gamutWarningPixelCount).toBe(3);
    expect(summary.codes).toContain('preview_proof_current');
    expect(summary.codes).toContain('display_lut_active_display_transform');
    expect(summary.codes).toContain('gamut_warning_present');
    expect(summary.codes).toContain('histogram_export_preview');
  });

  test('marks stale proof state without claiming print-match accuracy', () => {
    const staleSummary = buildColorOutputProofingDiagnostics({
      activeDisplayProfile: null,
      currentGamutWarningOverlay: null,
      displayProfileError: 'no active display profile',
      displayProfileLoading: false,
      displayPreviewLutStatus: null,
      exportSoftProofRecipeId: 'display-p3-proof',
      exportSoftProofTransform: null,
      previewScopeFreshnessStatus: {
        state: 'stale',
        statusLabel: 'Scopes stale',
      },
      renderedPreviewWarningStatus: {
        ...currentPreviewWarningStatus,
        coverageLabel: 'Clear',
        state: 'stale',
        statusLabel: 'Gamut mask stale',
      },
    });

    expect(staleSummary.displayProfileState).toBe('error');
    expect(staleSummary.lutState).toBe('error');
    expect(staleSummary.previewProofState).toBe('stale');
    expect(staleSummary.codes).toContain('preview_proof_stale');
    expect(staleSummary.codes).toContain('preview_scope_stale');
    expect(staleSummary.codes.join(' ')).not.toMatch(/print.match|exact/i);
  });
});
