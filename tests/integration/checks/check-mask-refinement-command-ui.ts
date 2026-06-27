import { readFileSync } from 'node:fs';

import {
  createMaskRefinementCommand,
  dispatchMaskRefinementCommand,
  MASK_REFINEMENT_REPLAY_PARAMETER_KEY,
  maskRefinementUiCommandSchema,
} from '../../../src/utils/maskRefinementCommandBus.ts';

const busSource = readFileSync('src/utils/maskRefinementCommandBus.ts', 'utf8');
const panelSource = readFileSync('src/components/panel/right/MasksPanel.tsx', 'utf8');

const requiredBusFragments: string[] = [
  'maskRefinementUiCommandSchema',
  "commandType: z.literal('layerMask.refineMask')",
  'createMaskRefinementCommand',
  'dispatchMaskRefinementCommand',
  'MASK_REFINEMENT_REPLAY_PARAMETER_KEY',
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

const command = createMaskRefinementCommand(
  'mask_refine_replay',
  { density: 0.7, edgeContrast: 0.1 },
  {
    edgeContrast: 0.35,
    edgeShiftPx: 3,
    featherPx: 12,
    smoothness: 0.5,
  },
);
const dispatched = dispatchMaskRefinementCommand(command);
const replay = dispatched[MASK_REFINEMENT_REPLAY_PARAMETER_KEY];
const replayCommand =
  typeof replay === 'object' && replay !== null && 'command' in replay
    ? (replay as { command: unknown }).command
    : null;
if (dispatched['edgeContrast'] !== 0.35 || dispatched['featherPx'] !== 12) {
  throw new Error('Mask refinement dispatch did not preserve bounded parameter changes.');
}
if (!maskRefinementUiCommandSchema.safeParse(replayCommand).success) {
  throw new Error('Mask refinement dispatch did not persist a replayable command envelope.');
}

console.log('mask refinement command UI ok');
