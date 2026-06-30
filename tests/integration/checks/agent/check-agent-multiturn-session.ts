#!/usr/bin/env bun

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  agentMultiTurnAppServerSessionRequestSchema,
  runAgentMultiTurnAppServerSession,
} from '../../../../src/utils/agent/session/agentMultiTurnAppServerSession.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3164.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 2));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-session-before',
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
    exif: { ISO: '320', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3164',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3164',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

if (
  agentMultiTurnAppServerSessionRequestSchema.safeParse({
    operationId: 'invalid',
    prompt: 'Make it better.',
    requestId: 'invalid',
    sessionId: 'invalid',
    turns: [{ adjustment: { exposure: 0.1 }, assistantRationale: 'Only one turn.' }],
  }).success
) {
  throw new Error('agent multi-turn session accepted a single-turn request.');
}

const result = await runAgentMultiTurnAppServerSession({
  operationId: 'agent_multiturn_3164',
  prompt: 'Brighten the RAW, inspect a medium preview, then refine shadows after seeing the result.',
  requestId: 'agent-multiturn-3164',
  sessionId: 'agent-multiturn-3164',
  turns: [
    {
      adjustment: { exposure: 0.28, highlights: -10 },
      assistantRationale: 'First pass: lift exposure while protecting highlights.',
      preview: { purpose: 'refresh' },
    },
    {
      adjustment: { shadows: 18, contrast: 9 },
      assistantRationale: 'Second pass after preview: open foreground shadows and restore midtone contrast.',
      color: { hsl: { blues: { hue: -2, luminance: 3, saturation: 8 } } },
      detailEffects: { clarity: 18, dehaze: 8, sharpness: 12 },
      preview: {
        crop: { height: 0.35, width: 0.3, x: 0.25, y: 0.2 },
        maxPixelCount: 800_000,
        purpose: 'detail_review',
        zoom: { centerX: 0.5, centerY: 0.55, scale: 2.5 },
      },
      userFollowUp: 'Foreground still feels dense; inspect the detail area and refine.',
    },
  ],
});

const state = useEditorStore.getState();
const previewPurposes = result.previews.map((preview) => preview.purpose);
const toolNames = result.toolCalls.map((toolCall) => toolCall.name);

if (result.turnCount !== 2 || result.sessionId !== 'agent-multiturn-3164') {
  throw new Error('agent multi-turn session did not preserve session identity and turn count.');
}
if (result.initialContext.preview.purpose !== 'initial_context' || result.previews.length !== 3) {
  throw new Error('agent multi-turn session did not include initial plus per-turn previews.');
}
if (previewPurposes.join(',') !== 'initial_context,refresh,detail_review') {
  throw new Error(`agent multi-turn session preview purposes were wrong: ${previewPurposes.join(',')}`);
}
if (
  result.previewLineage.length !== 3 ||
  result.previewLineage[0]?.turn !== 0 ||
  result.previewLineage[1]?.graphRevision !== 'history_1' ||
  result.previewLineage[2]?.graphRevision !== 'history_4' ||
  result.previewLineage[2]?.artifactId !== result.previews[2]?.artifactId
) {
  throw new Error('agent multi-turn session did not bind preview lineage to each turn.');
}
if (
  toolNames.filter((name) => name === 'rawengine.agent.adjustments.apply').length !== 2 ||
  toolNames.filter((name) => name === 'rawengine.agent.color.apply').length !== 1 ||
  toolNames.filter((name) => name === 'rawengine.agent.detail_effects.apply').length !== 1 ||
  toolNames.filter((name) => name === 'rawengine.agent.state.get').length !== 4 ||
  toolNames.filter((name) => name === 'rawengine.agent.preview.render').length !== 2
) {
  throw new Error(`agent multi-turn session did not use expected typed tools: ${toolNames.join(',')}`);
}
if (
  !result.messages.some((message) => message.role === 'user' && message.content.includes('Foreground still feels')) ||
  !result.messages.some((message) => message.previewArtifactId === result.previews[2]?.artifactId)
) {
  throw new Error('agent multi-turn session did not preserve follow-up prompt and preview references.');
}
if (
  state.adjustments.exposure !== 0.28 ||
  state.adjustments.shadows !== 18 ||
  state.adjustments.hsl.blues.saturation !== 8 ||
  state.adjustments.clarity !== 18 ||
  state.adjustments.sharpness !== 12 ||
  state.historyIndex !== 4
) {
  throw new Error('agent multi-turn session did not apply tone, color, and detail typed editing turns.');
}
if (
  result.rollbackGraphRevision !== 'history_0' ||
  result.finalGraphRevision !== 'history_4' ||
  result.finalRecipeHash !== result.previews[2]?.recipeHash
) {
  throw new Error('agent multi-turn session did not preserve rollback and final recipe identities.');
}
if (
  result.editReview.preview.id !== result.previews[2]?.id ||
  result.editReview.beforePreview.id !== result.previews[0]?.id ||
  result.editReview.toolReceiptCount !== 2
) {
  throw new Error('agent multi-turn session did not bind final review to previews and receipts.');
}

console.log('agent multi-turn app-server session ok');
