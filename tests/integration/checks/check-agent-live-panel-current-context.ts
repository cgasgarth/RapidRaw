#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const aiPanelSource = readFileSync('src/components/panel/right/AIPanel.tsx', 'utf8');
const visualSmokeSource = readFileSync('src/validation/visual/VisualSmokeApp.tsx', 'utf8');

const requiredLivePanelMarkers = [
  'selectedImagePath={selectedImage?.path}',
  'buildLiveAgentTranscript(selectedImagePath)',
  'getImageLabelFromPath',
  'Current image:',
  'rawengine.live_context',
];

for (const marker of requiredLivePanelMarkers) {
  if (!aiPanelSource.includes(marker)) {
    throw new Error(`AIPanel live agent context is missing marker: ${marker}`);
  }
}

if (aiPanelSource.includes('agentChatTranscriptFixture')) {
  throw new Error('AIPanel must not render the static DSC_2844.NEF agent transcript fixture in the live editor.');
}

if (!visualSmokeSource.includes('agentChatTranscriptFixture')) {
  throw new Error('Visual smoke app should keep the rich agent transcript fixture for validation-only previews.');
}

console.log('agent live panel current context ok');
