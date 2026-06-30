import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/panel/right/layers/MasksPanel.tsx', 'utf8');

const requiredFragments = [
  'const MASK_REFINEMENT_PARAMETERS',
  "key: 'density'",
  "key: 'featherPx'",
  "key: 'edgeShiftPx'",
  "key: 'edgeContrast'",
  "key: 'smoothness'",
  'function MaskRefinementControls',
  'data-testid="mask-refinement-controls"',
  'data-testid={`mask-refinement-control-${param.key}`}',
  'data-testid="mask-refinement-warning-list"',
  'data-mask-refinement-warning={warningId}',
  'data-refinement-warning-count={warningIds.length}',
  'MASK_REFINEMENT_WARNING_LABEL_KEYS',
  '<MaskRefinementControls',
  'onReset={handleResetMaskRefinement}',
  'handleSubMaskParametersChange',
];

const missing = requiredFragments.filter((fragment) => !source.includes(fragment));

if (missing.length > 0) {
  console.error(`mask refinement controls missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('mask refinement controls ok');
