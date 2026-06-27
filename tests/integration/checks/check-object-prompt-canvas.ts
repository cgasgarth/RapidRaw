#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  applyObjectPromptClick,
  clearObjectPromptCanvasState,
  imagePointFromCanvasClick,
  readObjectPromptCanvasState,
  setObjectPromptMode,
  writeObjectPromptCanvasState,
} from '../../../src/utils/objectMaskPromptCanvas.ts';

const renderSize = { height: 800, offsetX: 100, offsetY: 50, width: 1200 };
const center = imagePointFromCanvasClick({ x: 700, y: 450 }, renderSize);
if (center === null || center.x !== 0.5 || center.y !== 0.5) {
  throw new Error('Object prompt canvas did not normalize image-space click coordinates.');
}
if (imagePointFromCanvasClick({ x: 20, y: 450 }, renderSize) !== null) {
  throw new Error('Object prompt canvas accepted an off-image click.');
}

let state = readObjectPromptCanvasState(undefined);
state = applyObjectPromptClick(state, center);
if (state.pointPrompts.length !== 1 || state.pointPrompts[0]?.label !== 'foreground') {
  throw new Error('Object prompt canvas did not add a foreground point.');
}
state = setObjectPromptMode(state, 'background_point');
state = applyObjectPromptClick(state, { label: 'foreground', x: 0.2, y: 0.25 });
if (state.pointPrompts.length !== 2 || state.pointPrompts[1]?.label !== 'background') {
  throw new Error('Object prompt canvas did not add a background point.');
}
state = setObjectPromptMode(state, 'box');
state = applyObjectPromptClick(state, { label: 'foreground', x: 0.25, y: 0.3 });
if (state.pendingBoxAnchor === null) throw new Error('Object prompt canvas did not retain first box anchor.');
state = applyObjectPromptClick(state, { label: 'foreground', x: 0.55, y: 0.7 });
if (state.boxPrompt?.x !== 0.25 || state.boxPrompt.width < 0.29 || state.pendingBoxAnchor !== null) {
  throw new Error('Object prompt canvas did not materialize normalized box prompt.');
}

const serialized = writeObjectPromptCanvasState({}, state);
const reparsed = readObjectPromptCanvasState(serialized);
if (reparsed.boxPrompt === null || reparsed.pointPrompts.length !== 2 || reparsed.mode !== 'box') {
  throw new Error('Object prompt canvas state did not round-trip through submask parameters.');
}
if (clearObjectPromptCanvasState(reparsed).pointPrompts.length !== 0) {
  throw new Error('Object prompt canvas clear did not remove points.');
}

const editorSource = readFileSync('src/components/panel/Editor.tsx', 'utf8');
const maskPanelSource = readFileSync('src/components/panel/right/MasksPanel.tsx', 'utf8');
for (const [label, source, needle] of [
  ['canvas overlay', editorSource, 'data-testid="object-prompt-canvas-overlay"'],
  ['box overlay', editorSource, 'data-testid="object-prompt-box"'],
  ['prompt controls', maskPanelSource, 'data-testid="object-prompt-controls"'],
  ['mode buttons', maskPanelSource, 'object-prompt-mode-'],
] as const) {
  if (!source.includes(needle)) throw new Error(`Object prompt UI is missing ${label}.`);
}

console.log('object prompt canvas ok');
