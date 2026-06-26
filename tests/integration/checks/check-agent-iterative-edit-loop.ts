#!/usr/bin/env bun

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  agentIterativeEditLoopRequestSchema,
  runAgentIterativeEditLoop,
} from '../../../src/utils/agentIterativeEditLoop.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3162.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 2));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-loop-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  lastBasicToneCommand: null,
  selectedImage: {
    exif: { ISO: '250', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3162',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3162',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

if (
  agentIterativeEditLoopRequestSchema.safeParse({
    maxIterations: 1,
    operationId: 'invalid',
    prompt: 'too short',
    requestId: 'invalid',
    sessionId: 'invalid',
    steps: [{ exposure: 0.2 }],
  }).success
) {
  throw new Error('agent iterative loop accepted too few iterations and steps.');
}

const result = await runAgentIterativeEditLoop({
  maxIterations: 4,
  operationId: 'agent_loop_3162',
  prompt: 'Brighten the exposure, inspect the preview, then lift shadows if the foreground still feels dense.',
  requestId: 'agent-loop-3162',
  sessionId: 'agent-loop-3162',
  steps: [
    { exposure: 0.28, highlights: -12 },
    { shadows: 18, exposure: 0.34 },
  ],
});

const state = useEditorStore.getState();
const toolNames = result.transcript.map((entry) => entry.toolName);

if (result.stopReason !== 'completed' || result.editCount !== 2 || result.previewRefreshCount !== 2) {
  throw new Error('agent iterative loop did not complete two edit/preview iterations.');
}
if (state.adjustments.exposure !== 0.34 || state.adjustments.shadows !== 18 || state.historyIndex !== 2) {
  throw new Error('agent iterative loop did not apply both editing turns into history.');
}
if (state.history.length !== 3 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent iterative loop did not maintain undo history and preview invalidation.');
}
if (
  toolNames.filter((name) => name === 'rawengine.agent.adjustments.apply').length !== 2 ||
  toolNames.filter((name) => name === 'rawengine.agent.preview.render').length !== 2 ||
  toolNames[0] !== 'rawengine.agent.state.get'
) {
  throw new Error(`agent iterative loop transcript has wrong tool order: ${toolNames.join(',')}`);
}
if (result.appliedGraphRevision !== 'history_2' || result.finalRecipeHash.length === 0) {
  throw new Error('agent iterative loop did not report final graph and recipe hash.');
}

console.log('agent iterative edit loop ok');
