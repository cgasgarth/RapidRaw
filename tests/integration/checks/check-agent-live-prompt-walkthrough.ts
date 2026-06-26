#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { agentChatTranscriptFixture } from '../../../src/utils/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const walkthrough = agentChatTranscriptFixture.livePromptWalkthrough;

if (walkthrough === undefined) {
  failures.push('Agent transcript fixture must include a live prompt walkthrough.');
} else {
  if (walkthrough.approval.state !== 'approved') failures.push('Walkthrough must show an approved dry-run gate.');
  if (!walkthrough.stages.some((stage) => stage.id === 'dry-run' && stage.toolCallId === 'tool-2')) {
    failures.push('Walkthrough must link dry-run stage to tool-2.');
  }
  if (!walkthrough.stages.some((stage) => stage.id === 'apply' && stage.toolCallId === 'tool-3')) {
    failures.push('Walkthrough must link apply stage to tool-3.');
  }
  if (walkthrough.stages.some((stage) => stage.state !== 'completed')) {
    failures.push('Runtime demo walkthrough should show the prompt-to-apply path completed.');
  }
}

const shellSource = readFileSync('src/components/panel/right/AgentChatShell.tsx', 'utf8');
for (const marker of [
  'data-testid="agent-live-prompt-composer"',
  'data-testid="agent-live-prompt-input"',
  'data-testid="agent-live-prompt-run"',
  'data-native-accessibility-input="reads-textarea-dom-value"',
  'data-testid="agent-live-prompt-apply"',
  'data-testid="agent-live-prompt-rollback"',
  'data-discard-control="rollback-session"',
  'data-testid="agent-live-activity-timeline"',
  'data-testid="agent-live-activity-timeline-entries"',
  'data-testid="agent-live-activity-preview-hash"',
  'data-testid="agent-live-activity-review-controls"',
  'data-approval-id={entry.approvalId',
  'data-export-artifact-id={entry.exportArtifactId',
  'data-timeline-review-state={entry.status}',
  'rawengine.agent.preview.render',
  'rawengine.live_basic_tone.apply',
  'rawengine.agent.history.rollback',
  'editor.ai.agent.timeline.title',
  'data-testid="agent-live-prompt-walkthrough"',
  'data-testid="agent-live-prompt-walkthrough-stages"',
  'data-testid="agent-live-prompt-walkthrough-summary"',
  'data-changed-pixel-percent',
  'data-mean-luminance-delta',
  'data-max-channel-delta',
  'data-sampled-pixel-count',
  'live-agent-basic-tone-apply',
  'onResultChange={setLivePromptResult}',
  'hasLiveApplyProof || transcript.runtimeStatus',
  'applyBasicToneToLiveEditor',
  'editor.ai.agent.composer.previewDelta',
  'runAgentBoundedEditPlannerLoop',
  'editor.ai.agent.walkthrough.title',
]) {
  if (!shellSource.includes(marker)) failures.push(`Agent chat shell missing marker: ${marker}`);
}

const localeSchema = z
  .object({
    editor: z.object({
      ai: z.object({
        agent: z.object({
          composer: z.object({
            apply: z.string().min(1),
            dryRun: z.string().min(1),
            label: z.string().min(1),
            previewDelta: z.string().min(1),
            rollback: z.string().min(1),
            status: z.object({
              applied: z.string().min(1),
              dry_run_ready: z.string().min(1),
              idle: z.string().min(1),
            }),
          }),
          timeline: z.object({
            control: z.object({
              approval: z.string().min(1),
              compare: z.string().min(1),
              inspect: z.string().min(1),
              rollback: z.string().min(1),
            }),
            empty: z.string().min(1),
            kind: z.object({
              approval: z.string().min(1),
              error: z.string().min(1),
              preview: z.string().min(1),
              prompt: z.string().min(1),
              rollback: z.string().min(1),
              tool_call: z.string().min(1),
            }),
            subtitle: z.string().min(1),
            title: z.string().min(1),
          }),
          walkthrough: z.object({
            plan: z.string().min(1),
            target: z.string().min(1),
            title: z.string().min(1),
          }),
        }),
      }),
    }),
  })
  .passthrough();

localeSchema.parse(JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')));

if (failures.length > 0) {
  console.error(`agent live prompt walkthrough failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`agent live prompt walkthrough ok (${walkthrough?.stages.length ?? 0} stages)`);
