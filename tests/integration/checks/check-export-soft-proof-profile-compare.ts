#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { ExportColorProfile, ExportRenderingIntent } from '../../../src/components/ui/ExportImportProperties.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  buildSoftProofProfileCompareProof,
  buildSoftProofProfileCompareRequests,
  describeSoftProofProfileRole,
  getSoftProofProfileCompareStatus,
} from '../../../src/utils/exportSoftProofProfileCompare.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const exportPanelSource = read('src/components/panel/right/export/ExportPanel.tsx');
const compareSource = read('src/utils/exportSoftProofProfileCompare.ts');
const commandsSource = read('src/tauri/commands.ts');
const rustLibSource = read('src-tauri/src/lib.rs');
const rustExportColorPolicySource = read('src-tauri/src/export_color_policy.rs');
const packageSource = read('package.json');
const locale = JSON.parse(read('src/i18n/locales/en.json'));

for (const marker of [
  'data-testid="export-soft-proof-profile-compare"',
  'data-testid="export-soft-proof-profile-compare-generate"',
  'data-testid={`export-soft-proof-profile-compare-',
  'data-testid={`export-soft-proof-profile-compare-preview-',
  'data-export-soft-proof-profile-compare-effective-color-profile',
  'data-export-soft-proof-profile-compare-effective-rendering-intent',
  'data-export-soft-proof-profile-compare-preview-hash',
  'data-export-soft-proof-profile-compare-proof-role',
  'data-export-soft-proof-profile-compare-requested-color-profile',
  'data-export-soft-proof-profile-compare-requested-rendering-intent',
  'data-export-soft-proof-profile-compare-source-precision-path',
  'data-export-soft-proof-profile-compare-status',
  'data-export-soft-proof-profile-compare-target-resolution',
  'data-export-soft-proof-profile-compare-transform-applied',
  'data-export-soft-proof-profile-compare-transform-policy-fingerprint',
  'Invokes.GenerateExportSoftProofPreview',
  'Invokes.ResolveExportSoftProofTransformMetadata',
  'prepareAdjustmentPayloadForBackend',
  'buildSoftProofProfileCompareRequests',
  'buildSoftProofProfileCompareProof',
  'setSoftProofProfileCompareState',
  "status: 'unavailable'",
]) {
  if (!exportPanelSource.includes(marker)) failures.push(`ExportPanel missing ${marker}`);
}

for (const marker of [
  'ExportColorProfile.Srgb',
  'ExportColorProfile.DisplayP3',
  'srgb-perceptual-gamut-map',
  'srgb-relative-identity',
  'display-p3-managed-transform',
  'hashSoftProofPreviewBuffer',
  'transformPolicyFingerprint',
]) {
  if (!compareSource.includes(marker)) failures.push(`compare helper missing ${marker}`);
}

for (const marker of [
  'GenerateExportSoftProofPreview',
  'generate_export_soft_proof_preview',
  'ResolveExportSoftProofTransformMetadata',
  'resolve_export_soft_proof_transform_metadata',
]) {
  if (!commandsSource.includes(marker) && !rustLibSource.includes(marker)) {
    failures.push(`soft-proof command missing ${marker}`);
  }
}

for (const marker of [
  'export_processing::export_soft_proof_rgb_pixels_and_profile_with_policy',
  'export_processing::export_soft_proof_transform_metadata',
]) {
  if (!rustLibSource.includes(marker)) failures.push(`Rust command does not reuse ${marker}`);
}

for (const marker of [
  'export_soft_proof_rgb_pixels_and_profile_with_policy',
  'export_soft_proof_transform_metadata',
  'export_rgb_pixels_and_profile(',
  'export_receipt_metadata(',
]) {
  if (!rustExportColorPolicySource.includes(marker)) failures.push(`export color policy missing ${marker}`);
}

for (const scriptName of [
  'check:export-soft-proof-profile-compare',
  'check:export-soft-proof-ui',
  'check:color-preview-export-parity',
  'check:working-space-contract',
]) {
  if (!packageSource.includes(`"${scriptName}"`)) failures.push(`package.json missing ${scriptName}`);
}

for (const key of [
  'displayP3Title',
  'effective',
  'emptyPreview',
  'fingerprint',
  'generate',
  'requested',
  'sideUnavailable',
  'srgbTitle',
  'subtitle',
  'title',
  'unavailable',
  'unavailableNoImage',
]) {
  if (typeof locale.export?.softProofCompare?.[key] !== 'string') {
    failures.push(`Missing export.softProofCompare.${key} locale`);
  }
}

const [srgbRequest, displayP3Request] = buildSoftProofProfileCompareRequests({
  blackPointCompensation: false,
  jsAdjustments: INITIAL_ADJUSTMENTS,
  renderingIntent: ExportRenderingIntent.Perceptual,
  targetResolution: 1024,
});

if (srgbRequest?.request.colorProfile !== ExportColorProfile.Srgb) {
  failures.push('first compare request is not sRGB');
}
if (displayP3Request?.request.colorProfile !== ExportColorProfile.DisplayP3) {
  failures.push('second compare request is not Display P3');
}
if (srgbRequest?.request.jsAdjustments !== displayP3Request?.request.jsAdjustments) {
  failures.push('compare requests do not share the same adjustment payload');
}
if (!srgbRequest || !displayP3Request) {
  failures.push('paired compare requests were not created');
}

const metadata = {
  blackPointCompensation: 'disabled',
  colorManagedTransform: 'moxcms-export-soft-proof',
  effectiveColorProfile: 'sRGB',
  effectiveRenderingIntent: 'Perceptual',
  policyStatus: 'managed',
  policyVersion: 'export-color-policy-v1',
  sourcePrecisionPath: 'rgba16-linear-working',
  transformApplied: false,
  transformPolicyFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};
const srgbProof = buildSoftProofProfileCompareProof({
  buffer: new Uint8Array([12, 96, 224, 255, 16, 104, 226, 255]).buffer,
  label: 'sRGB',
  metadata,
  previewUrl: 'blob:synthetic-srgb',
  request: srgbRequest?.request ?? {
    blackPointCompensation: false,
    colorProfile: ExportColorProfile.Srgb,
    jsAdjustments: INITIAL_ADJUSTMENTS,
    renderingIntent: ExportRenderingIntent.Perceptual,
    targetResolution: 1024,
  },
  side: 'srgb',
});
const displayP3Proof = buildSoftProofProfileCompareProof({
  buffer: new Uint8Array([24, 112, 245, 255, 28, 120, 248, 255]).buffer,
  label: 'Display P3',
  metadata: {
    ...metadata,
    effectiveColorProfile: 'Display P3',
    effectiveRenderingIntent: 'Perceptual',
    transformApplied: true,
    transformPolicyFingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
  previewUrl: 'blob:synthetic-display-p3',
  request: displayP3Request?.request ?? {
    blackPointCompensation: false,
    colorProfile: ExportColorProfile.DisplayP3,
    jsAdjustments: INITIAL_ADJUSTMENTS,
    renderingIntent: ExportRenderingIntent.Perceptual,
    targetResolution: 1024,
  },
  side: 'displayP3',
});

if (srgbProof.previewHash === displayP3Proof.previewHash) {
  failures.push('synthetic sRGB and Display P3 preview hashes should differ');
}
if (srgbProof.previewHash === 'fnv1a32:00000000' || displayP3Proof.previewHash === 'fnv1a32:00000000') {
  failures.push('synthetic preview hashes must be nonzero');
}
if (srgbProof.proofRole !== 'srgb-perceptual-gamut-map') {
  failures.push(`sRGB perceptual proof role not explicit: ${srgbProof.proofRole}`);
}
if (
  describeSoftProofProfileRole({
    requestedColorProfile: ExportColorProfile.Srgb,
    requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
    transformApplied: false,
  }) !== 'srgb-relative-identity'
) {
  failures.push('sRGB relative identity proof role not explicit');
}
if (
  getSoftProofProfileCompareStatus({
    displayP3: { proof: displayP3Proof, side: 'displayP3', status: 'ready' },
    srgb: { proof: srgbProof, side: 'srgb', status: 'ready' },
  }) !== 'ready'
) {
  failures.push('paired proof status should be ready when both sides are ready');
}
if (
  getSoftProofProfileCompareStatus({
    displayP3: {
      error: 'Display P3 transform unavailable',
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.Perceptual,
      side: 'displayP3',
      status: 'unavailable',
    },
    srgb: { proof: srgbProof, side: 'srgb', status: 'ready' },
  }) !== 'unavailable'
) {
  failures.push('missing Display P3 proof must be unavailable, not sRGB success');
}

if (failures.length > 0) {
  console.error('export soft-proof profile compare failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('export soft-proof profile compare ok');
