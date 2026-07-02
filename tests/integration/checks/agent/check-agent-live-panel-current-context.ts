#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const aiPanelSource = readFileSync('src/components/panel/right/ai/AgentPanel.tsx', 'utf8');
const shellSource = readFileSync('src/components/panel/right/ai/AgentChatShell.tsx', 'utf8');
const schemaSource = readFileSync('src/schemas/agent/agentChatTranscriptSchemas.ts', 'utf8');
const visualSmokeSource = readFileSync('src/validation/visual/VisualSmokeApp.tsx', 'utf8');

const requiredLivePanelMarkers = [
  'buildLiveAgentTranscript(selectedImage?.path, initialPromptContext)',
  'buildAgentInitialPromptContext({',
  'initialPromptContext',
  'rawengine.image.get_preview',
  'agentInitialPromptContext.v1',
  'initialPromptContext === null',
  'getImageLabelFromPath',
  'Current image:',
  "runtimeStatus: 'runtime_apply_ready'",
  'rawengine.live_context',
];

for (const marker of requiredLivePanelMarkers) {
  if (!aiPanelSource.includes(marker)) {
    throw new Error(`AIPanel live agent context is missing marker: ${marker}`);
  }
}

for (const marker of [
  'agentInitialPromptPreviewContextSchema',
  'longEdgePx: z.literal(1536)',
  "mediaType: z.literal('image/jpeg')",
  'includesOriginalRaw: z.literal(false)',
]) {
  if (!schemaSource.includes(marker)) {
    throw new Error(`Agent transcript schema is missing initial preview context marker: ${marker}`);
  }
}

for (const marker of [
  'InitialPromptPreviewContextCard',
  'agent-initial-prompt-preview-context',
  'data-includes-original-raw={String(context.includesOriginalRaw)}',
  'data-tool-name={context.toolName}',
  'editor.ai.agent.initialPreviewContext.title',
  'editor.ai.agent.initialPreviewContext.summary',
]) {
  if (!shellSource.includes(marker)) {
    throw new Error(`Agent chat shell is missing initial preview context marker: ${marker}`);
  }
}

if (aiPanelSource.includes('agentChatTranscriptFixture')) {
  throw new Error('AIPanel must not render the static DSC_2844.NEF agent transcript fixture in the live editor.');
}

if (!visualSmokeSource.includes('agentChatTranscriptFixture')) {
  throw new Error('Visual smoke app should keep the rich agent transcript fixture for validation-only previews.');
}

console.log('agent live panel current context ok');
