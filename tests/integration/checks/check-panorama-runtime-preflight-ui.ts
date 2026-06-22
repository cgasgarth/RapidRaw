#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { panoramaRuntimePlanSchema } from '../../../src/schemas/panoramaUiSchemas.ts';

const failures: string[] = [];

const samplePlan = panoramaRuntimePlanSchema.parse({
  dry_run: true,
  family: 'panorama',
  output_dimensions: { height: 3200, width: 9600 },
  preflight: {
    blocked_reasons: [],
    execution_mode: 'full_frame_legacy',
    memory_budget_bytes: 6_442_450_944,
    memory_budget_ratio: 0.42,
    memory_components: {
      low_detail_mask_bytes: 22_500_000,
      output_canvas_bytes: 368_640_000,
      output_mask_bytes: 30_720_000,
      overhead_bytes: 63_864_000,
      preview_bytes: 73_728_000,
      seam_workspace_bytes: 122_880_000,
      source_decode_bytes: 270_000_000,
      total_estimated_peak_bytes: 952_332_000,
    },
    source_geometry: {
      blocked_reasons: ['multi_row_panorama_not_supported'],
      layout: 'multi_row_candidate',
      row_count_estimate: 2,
      support: 'blocked_requires_multi_row_solver',
      vertical_span_px: 480,
      warning_codes: ['multi_row_runtime_deferred'],
    },
    status: 'blocked_plan_only',
    tile_count: 1,
    warning_codes: ['geometry_estimate_low_confidence'],
  },
  source_image_refs: [{ image_path: '/synthetic/panorama/source-0.dng', source_index: 0 }],
  warnings: ['dry-run estimate'],
});

if (samplePlan.preflight.memory_components.total_estimated_peak_bytes !== 952_332_000) {
  failures.push('Panorama runtime plan schema did not preserve memory estimate.');
}

const actionSource = readFileSync('src/hooks/useProductivityActions.ts', 'utf8');
for (const marker of [
  'Invokes.PlanPanorama',
  'panoramaRuntimePlanSchema.parse',
  'maxPreviewDimensionPx: settings.maxPreviewDimensionPx',
  "runtimePlan.preflight.status === 'blocked_plan_only'",
  'runtimePlan,',
  'Invokes.StitchPanorama',
]) {
  if (!actionSource.includes(marker)) {
    failures.push(`Panorama action missing preflight marker: ${marker}`);
  }
}

const modalSource = readFileSync('src/components/modals/PanoramaModal.tsx', 'utf8');
for (const marker of [
  'runtimePlan: PanoramaRuntimePlan | null',
  'panorama-runtime-plan-summary',
  'data-runtime-plan-ready={String(runtimePlan !== null)}',
  'data-plan-scope="geometry_memory_only"',
  "data-plan-status={runtimePlan?.preflight.status ?? 'pending'}",
  "data-source-geometry-layout={runtimePlanSourceGeometry?.layout ?? 'pending'}",
  "data-source-geometry-support={runtimePlanSourceGeometry?.support ?? 'pending'}",
  "data-source-row-count-estimate={runtimePlanSourceGeometry?.row_count_estimate ?? ''}",
  'runtimePlan.preflight.memory_components.total_estimated_peak_bytes',
]) {
  if (!modalSource.includes(marker)) {
    failures.push(`Panorama modal missing runtime plan marker: ${marker}`);
  }
}

const appModalsSource = readFileSync('src/components/modals/AppModals.tsx', 'utf8');
if (!appModalsSource.includes('runtimePlan={panoramaModalState.runtimePlan}')) {
  failures.push('AppModals must pass panorama runtimePlan into PanoramaModal.');
}
if (!appModalsSource.includes('runtimePlan: null, settings')) {
  failures.push('Panorama settings changes must clear stale runtimePlan.');
}

const visualSmokeSource = readFileSync('scripts/capture-visual-smoke.ts', 'utf8');
for (const marker of [
  'panorama-runtime-plan-summary',
  "runtimePlanProof.planScope !== 'geometry_memory_only'",
  "runtimePlanProof.planStatus !== 'accepted'",
  "runtimePlanProof.sourceGeometryLayout !== 'single_row'",
  "runtimePlanProof.sourceGeometrySupport !== 'implemented_current_engine'",
]) {
  if (!visualSmokeSource.includes(marker)) {
    failures.push(`Panorama visual smoke missing runtime plan assertion: ${marker}`);
  }
}

const sidecarSource = readFileSync('src-tauri/src/panorama_stitching.rs', 'utf8');
for (const marker of [
  'artifact["projectionSettings"]["requestedProjection"]',
  'artifact["projectionSettings"]["effectiveProjection"]',
  'artifact["boundarySettings"]["requestedMode"]',
  'artifact["boundarySettings"]["effectiveMode"]',
  'artifact["sourceImageRefs"][1]["sourceIndex"]',
]) {
  if (!sidecarSource.includes(marker)) {
    failures.push(`Panorama sidecar test missing provenance assertion: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error('panorama runtime preflight UI failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('panorama runtime preflight UI ok');
