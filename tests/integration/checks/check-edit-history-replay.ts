#!/usr/bin/env bun

import { z } from 'zod';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  goToEditHistoryIndex,
  pushEditHistoryEntry,
  redoEditHistory,
  undoEditHistory,
} from '../../../src/utils/editHistory.ts';

const stepSchema = z
  .object({
    contrast: z.number(),
    exposure: z.number(),
    label: z.string().trim().min(1),
  })
  .strict();

const replaySteps = z
  .array(stepSchema)
  .min(3)
  .parse([
    { contrast: 0, exposure: 0, label: 'base' },
    { contrast: 12, exposure: 0.4, label: 'tone' },
    { contrast: -8, exposure: -0.25, label: 'correction' },
  ]);

const makeAdjustments = (step) => ({
  ...structuredClone(INITIAL_ADJUSTMENTS),
  contrast: step.contrast,
  exposure: step.exposure,
});

let state = {
  adjustments: makeAdjustments(replaySteps[0]),
  history: [makeAdjustments(replaySteps[0])],
  historyIndex: 0,
};

for (const step of replaySteps.slice(1)) {
  const pushed = pushEditHistoryEntry(state.history, state.historyIndex, makeAdjustments(step));
  state = { ...state, ...pushed, adjustments: makeAdjustments(step) };
}

state = undoEditHistory(state);
if (state.historyIndex !== 1 || state.adjustments.exposure !== replaySteps[1].exposure) {
  console.error('Undo replay mismatch.');
  process.exit(1);
}

state = redoEditHistory(state);
if (state.historyIndex !== 2 || state.adjustments.contrast !== replaySteps[2].contrast) {
  console.error('Redo replay mismatch.');
  process.exit(1);
}

state = goToEditHistoryIndex(state, 0);
if (state.historyIndex !== 0 || state.adjustments.exposure !== replaySteps[0].exposure) {
  console.error('History index replay mismatch.');
  process.exit(1);
}

const branch = pushEditHistoryEntry(state.history, state.historyIndex, makeAdjustments(replaySteps[1]));
if (branch.history.length !== 2 || branch.historyIndex !== 1) {
  console.error('Branch replay did not truncate redo history.');
  process.exit(1);
}

let bounded = {
  adjustments: makeAdjustments(replaySteps[0]),
  history: [makeAdjustments(replaySteps[0])],
  historyIndex: 0,
};
for (let index = 0; index < 55; index += 1) {
  const pushed = pushEditHistoryEntry(
    bounded.history,
    bounded.historyIndex,
    { ...makeAdjustments(replaySteps[1]), exposure: index },
    50,
  );
  bounded = { ...bounded, ...pushed, adjustments: pushed.history[pushed.historyIndex] };
}
if (bounded.history.length !== 50 || bounded.historyIndex !== 49) {
  console.error('History replay max-entry bound mismatch.');
  process.exit(1);
}

console.log('Edit history replay ok.');
