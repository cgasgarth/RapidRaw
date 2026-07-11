import { readFileSync } from 'node:fs';

const stitching = readFileSync('src-tauri/src/merge/panorama_stitching.rs', 'utf8');
const projection = readFileSync('src-tauri/src/merge/panorama_utils/projection.rs', 'utf8');
const reviewSchema = readFileSync('src/schemas/computational-merge/panoramaUiSchemas.ts', 'utf8');

for (const required of [
  'CalibratedPanoramaEngine',
  'build_calibrated_alignment_plan',
  'calibrated_runtime_fallback_legacy',
  'calibratedPlan',
  'cpu_reference',
  'horizontalFovDegrees',
  'rapidraw_calibrated_projection_v1',
]) {
  if (!stitching.includes(required)) throw new Error(`Calibrated render runtime is missing ${required}.`);
}

for (const required of [
  'MAX_OUTPUT_PIXELS',
  'TILE_SIZE_PX',
  'projection_bounds',
  'full_tile_render',
  'calibrated_cpu_render_is_deterministic_and_projection_specific',
  'cancelled_projection_publishes_no_pixels',
]) {
  if (!projection.includes(required)) throw new Error(`Calibrated projection runtime is missing ${required}.`);
}

if (!reviewSchema.includes('alignmentPlan: panoramaCalibratedAlignmentPlanSchema')) {
  throw new Error('Rendered and saved panorama review schemas do not preserve the calibrated plan.');
}

console.log('panorama calibrated global alignment render contract: ok');
