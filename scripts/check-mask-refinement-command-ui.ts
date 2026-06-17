import { readFileSync } from 'node:fs';

const busSource = readFileSync('src/utils/maskRefinementCommandBus.ts', 'utf8');
const panelSource = readFileSync('src/components/panel/right/MasksPanel.tsx', 'utf8');

const requiredBusFragments: string[] = [
  'maskRefinementUiCommandSchema',
  "commandType: z.literal('layerMask.refineMask')",
  'createMaskRefinementCommand',
  'dispatchMaskRefinementCommand',
  'edgeShiftPx: z.number().min(-512).max(512)',
  'featherPx: z.number().min(0).max(4096)',
];

const requiredPanelFragments: string[] = [
  'createMaskRefinementCommand',
  'dispatchMaskRefinementCommand',
  'handleMaskRefinementParametersChange',
  'onChange={handleMaskRefinementParametersChange}',
];

const missing = [
  ...requiredBusFragments.filter((fragment) => !busSource.includes(fragment)),
  ...requiredPanelFragments.filter((fragment) => !panelSource.includes(fragment)),
];

if (missing.length > 0) {
  console.error(`mask refinement command UI missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('mask refinement command UI ok');
