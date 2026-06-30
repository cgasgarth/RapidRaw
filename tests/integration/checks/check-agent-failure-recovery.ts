#!/usr/bin/env bun

import {
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  sampleAiEnhancementCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { agentChatTranscriptFixture } from '../../../src/utils/agent/session/agentChatTranscriptFixture.ts';

const failures: string[] = [];
const recovery = agentChatTranscriptFixture.failureRecovery;

if (recovery?.failedToolCallId !== 'tool-4') failures.push('Recovery fixture must identify the failed tool call.');
if (recovery?.recoveredToolCallId !== 'tool-3') failures.push('Recovery fixture must link to the recovered tool call.');
if (!recovery?.preservedPlanId.includes('missing_provider')) {
  failures.push('Recovery fixture must preserve the failed plan identity.');
}

const context = {
  now: () => new Date('2026-06-21T00:00:00.000Z'),
  requestId: 'request_agent_failure_recovery_3124',
};

const blockedCommand = {
  ...sampleAiEnhancementCommandEnvelopeV1,
  parameters: {
    ...sampleAiEnhancementCommandEnvelopeV1.parameters,
    providerClass: 'self_hosted_connector',
    providerId: 'missing-local-connector',
    sourcePixelDisclosure: 'local_only',
  },
} as const;

const bridge = createRawEngineLocalAppServerBridge();
const blocked = await bridge.dispatch(blockedCommand, context);
if (blocked.ok) failures.push('Forced unavailable-provider dry-run must fail before retry.');

const retry = await bridge.dispatch(sampleToneColorCommandEnvelopeV1, context);
if (!retry.ok) failures.push(`Local retry dry-run must succeed after failure: ${retry.message}`);

const audit = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (audit[0]?.status !== 'blocked' || audit[0].toolName !== 'ai.enhancement.dry_run_command') {
  failures.push('First audit event must preserve the blocked failed command.');
}
if (audit[1]?.status !== 'completed' || audit[1].commandType !== 'toneColor.setBasicTone') {
  failures.push('Second audit event must prove the local retry path succeeds.');
}

if (failures.length > 0) {
  console.error(`agent failure recovery failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent failure recovery ok (blocked tool + local retry)');
