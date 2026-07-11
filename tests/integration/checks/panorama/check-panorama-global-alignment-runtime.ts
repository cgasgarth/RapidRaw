import { readFileSync } from 'node:fs';

const native = readFileSync('src-tauri/src/merge/panorama_utils/alignment_plan.rs', 'utf8');
for (const required of [
  'HUBER_DELTA_PX',
  'solve_global',
  'cycle_closure_error_px',
  'global_alignment_plan_ready',
  'match_graph_disconnected',
  'no plan was published',
  'global_residual_outlier',
  'overlap_bounds',
]) {
  if (!native.includes(required)) throw new Error(`Global alignment runtime is missing ${required}.`);
}
const command = readFileSync('src-tauri/src/merge/panorama_stitching.rs', 'utf8');
if (!command.includes('cancel_panorama_alignment') || !command.includes('build_calibrated_alignment_plan')) {
  throw new Error('Tauri runtime does not publish/cancel the native alignment plan.');
}
console.log('panorama global alignment runtime contract: ok');
