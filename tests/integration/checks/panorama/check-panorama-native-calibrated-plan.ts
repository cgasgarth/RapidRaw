import { readFileSync } from 'node:fs';

const native = readFileSync('src-tauri/src/merge/panorama_utils/alignment_plan.rs', 'utf8');
for (const required of [
  'panorama_calibrated_alignment_plan_v1',
  'rapidraw_oriented_brief_calibrated_global_pose_v1',
  'feature_artifact_hash',
  'match_artifact_hash',
  'canonical_plan_hash',
  'calibration_unobservable',
  'verified_sidecar',
  'embedded_exif_35mm',
  'deterministic_homography_ransac',
  'transform_condition_number',
]) {
  if (!native.includes(required)) throw new Error(`Native calibrated plan is missing ${required}.`);
}
if (native.includes('progressive_seam_stitcher')) throw new Error('Alignment planner must not blend panorama pixels.');
console.log('panorama native calibrated plan contract: ok');
