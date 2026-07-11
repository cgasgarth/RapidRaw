import { readFileSync } from 'node:fs';

const ui = readFileSync('src/components/modals/computational-merge/PanoramaModal.tsx', 'utf8');
for (const required of [
  'data-alignment-plan-hash',
  'data-alignment-accepted-edge-count',
  'data-alignment-rejected-edge-count',
  'data-alignment-rejection-reasons',
  'data-match-overlay-artifact-ids',
  'data-global-residual-p95-px',
  'data-cycle-closure-error-px',
  'data-overlap-handoff-count',
  'data-alignment-rejection-reasons',
]) {
  if (!ui.includes(required)) throw new Error(`Panorama match review is missing ${required}.`);
}
const workflow = readFileSync('src/hooks/app/useProductivityActions.ts', 'utf8');
const panoramaBlock = workflow.slice(workflow.indexOf('handleStartPanorama'), workflow.indexOf('handleSavePanorama'));
if (panoramaBlock.includes('Invokes.StitchPanorama')) {
  throw new Error('Alignment-plan workflow must not enter final panorama pixel blending.');
}
console.log('panorama match review artifacts: ok');
