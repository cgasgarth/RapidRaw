#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const shellSource = readFileSync('src/components/panel/right/AgentChatShell.tsx', 'utf8');
const panelSource = readFileSync('src/components/panel/right/AIPanel.tsx', 'utf8');

const requiredShellMarkers = [
  'interface LiveSessionEvent',
  'initialPromptPreviewContext: AgentInitialPromptPreviewContext | undefined',
  'initialPromptPreviewContext={transcript.initialPromptPreviewContext}',
  "toolName: 'rawengine.agent.initial_prompt_preview'",
  'getAgentReadOnlyState({',
  'AGENT_STATE_GET_TOOL_NAME',
  'agentImageContextSnapshotSchema.parse',
  'data-testid="agent-live-prompt-inspect-state"',
  'data-testid="agent-live-prompt-state-inspection"',
  'data-testid="agent-live-prompt-stale-preview-warning"',
  "t('editor.ai.agent.composer.stalePreviewWarning')",
  'previewStaleRecipeHash: previewResult.staleRecipeHash',
  "t('editor.ai.agent.composer.inspectState')",
  'renderAgentReadOnlyPreview({',
  'AGENT_PREVIEW_RENDER_TOOL_NAME',
  'data-testid="agent-live-prompt-detail-preview"',
  "t('editor.ai.agent.composer.detailPreview')",
  "purpose: 'detail_review'",
  'scale: 2',
  'data-testid="agent-live-prompt-refresh-preview"',
  "t('editor.ai.agent.composer.refreshPreview')",
  "createLiveSessionEvent('assistant',",
  'initialPromptPreviewContext.renderHash',
  'initialPromptPreviewContext.recipeHash',
  'initialPromptPreviewContext.graphRevision',
  'liveSessionEvents',
  'data-live-session-event-count',
  'data-live-session-state',
  'data-session-input-state',
  "toolCall.toolName === 'rawengine.live_context'",
  "toolCall.status === 'succeeded'",
  "createLiveSessionEvent('user', requestedPrompt, 'prompt')",
  'runAgentMultiTurnAppServerSession',
  'buildLiveMultiTurnSessionRequest',
  "toolName: 'rawengine.agent.session.multiturn'",
  "toolName: 'rawengine.agent.app_server_session'",
  'data-testid="agent-live-session-review"',
  'data-testid="agent-live-session-preview-lineage"',
  'data-testid="agent-live-session-review-actions"',
  'data-rollback-state={review.rollbackState}',
  "setSessionReview((review) => (review === null ? null : { ...review, rollbackState: 'restored' }))",
  "t('editor.ai.agent.composer.status.dry_run_ready')",
  "t('editor.ai.agent.composer.status.applied')",
  'data-testid="agent-live-apply-receipt"',
  "t('editor.ai.agent.composer.applyReceipt')",
  "t('editor.ai.agent.composer.applyReceiptPixels'",
  'data-tool-call-count={sessionReview?.toolCallCount.toString()',
  "t('editor.ai.agent.composer.status.rolled_back')",
  'disabled={!isContextReady}',
];

for (const marker of requiredShellMarkers) {
  if (!shellSource.includes(marker)) {
    throw new Error(`Agent live session shell missing marker: ${marker}`);
  }
}

if (panelSource.includes('agentChatTranscriptFixture')) {
  throw new Error('The live AI panel must not use the static agent transcript fixture.');
}

console.log('agent live session shell ok');
