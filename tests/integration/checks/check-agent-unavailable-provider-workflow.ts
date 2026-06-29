#!/usr/bin/env bun

import {
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import {
  sampleAiEnhancementApplyCommandEnvelopeV1,
  sampleAiEnhancementCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { RawEngineAppServerResponseStatus } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { buildRawEngineAppServerToolDispatchResponse } from '../../../src/utils/rawEngineAppServerHost.ts';

const failures: string[] = [];
const context = {
  now: () => new Date('2026-06-21T00:00:00.000Z'),
  requestId: 'request_agent_unavailable_provider_001',
};

const unavailableProviderCommand = {
  ...sampleAiEnhancementCommandEnvelopeV1,
  parameters: {
    ...sampleAiEnhancementCommandEnvelopeV1.parameters,
    providerClass: 'self_hosted_connector',
    providerId: 'missing-local-connector',
    sourcePixelDisclosure: 'local_only',
  },
} as const;

const bridge = createRawEngineLocalAppServerBridge();
const blockedDryRun = await bridge.dispatch(unavailableProviderCommand, context);
if (blockedDryRun.ok) {
  failures.push('Unavailable provider dry-run must be blocked before producing preview artifacts.');
}
if (!blockedDryRun.ok && blockedDryRun.reason !== 'handler_failed') {
  failures.push(`Unavailable provider dry-run returned unexpected reason: ${blockedDryRun.reason}.`);
}

const [blockedAudit] = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (blockedAudit?.status !== 'blocked') failures.push('Unavailable provider audit status must be blocked.');
if (blockedAudit?.toolName !== 'ai.enhancement.dry_run_command') {
  failures.push('Unavailable provider audit must name the app-server dry-run tool.');
}
if (blockedAudit?.mutates !== false || blockedAudit?.dryRun !== true) {
  failures.push('Unavailable provider audit must prove a non-mutating dry-run block.');
}
if (blockedAudit?.approvalState !== sampleAiEnhancementCommandEnvelopeV1.approval.state) {
  failures.push('Unavailable provider audit must preserve approval state without using it as the block reason.');
}
if (blockedAudit?.providerFallback?.reasonCode !== 'connector_unavailable') {
  failures.push('Unavailable connector block must use connector_unavailable reason code.');
}
if (blockedAudit?.providerFallback?.requestedProviderId !== 'missing-local-connector') {
  failures.push('Unavailable provider audit must preserve the requested provider id.');
}
if (blockedAudit?.providerFallback?.requestedProviderClass !== 'self_hosted_connector') {
  failures.push('Unavailable provider audit must preserve the requested provider class.');
}
if (
  blockedAudit?.providerFallback?.effectiveProviderId !== 'cpu' ||
  blockedAudit.providerFallback.effectiveProviderClass !== 'local_model'
) {
  failures.push('Unavailable provider audit must record the local CPU routing fallback target.');
}
if (
  blockedAudit?.providerFallback?.routingFallbackApplied !== true ||
  blockedAudit.providerFallback.executionDisposition !== 'blocked'
) {
  failures.push('Unavailable provider audit must record that fallback routing was blocked, not executed.');
}
if (!blockedAudit?.warnings.some((warning) => warning.includes('no pixels were sent'))) {
  failures.push('Unavailable provider audit must include no-pixel-disclosure warning.');
}

const applyAfterBlockedDryRun = await bridge.dispatch(sampleAiEnhancementApplyCommandEnvelopeV1, context);
if (applyAfterBlockedDryRun.ok) {
  failures.push('Apply after a blocked dry-run must fail because no accepted plan exists.');
} else if (!applyAfterBlockedDryRun.message.includes('without a matching dry-run')) {
  failures.push('Apply after a blocked dry-run must fail on missing accepted dry-run plan.');
}

const [, applyAudit] = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (applyAudit?.status !== 'rejected' || applyAudit.toolName !== 'ai.enhancement.apply_command') {
  failures.push('Apply after blocked dry-run must record a rejected apply audit event.');
}
if (applyAudit?.providerFallback !== undefined) {
  failures.push('Apply after blocked dry-run must not invent provider fallback metadata for a plan mismatch.');
}

const availableBridge = createRawEngineLocalAppServerBridge();
const availableDryRun = await availableBridge.dispatch(sampleAiEnhancementCommandEnvelopeV1, context);
if (!availableDryRun.ok) {
  failures.push(`Available provider dry-run must still execute: ${availableDryRun.message}`);
}
const [availableAudit] = availableBridge
  .listAuditEvents()
  .map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
if (availableAudit?.status !== 'completed' || availableAudit.providerFallback !== undefined) {
  failures.push('Available provider dry-run must complete without fallback metadata.');
}

const unavailableAgentTool = await buildRawEngineAppServerToolDispatchResponse({
  arguments: {
    operationId: 'agent_layer_mask_unavailable_tool',
    requestId: 'request-agent-layer-mask-unavailable-tool',
    sessionId: 'agent-layer-mask-unavailable-tool',
  },
  requestId: 'request-agent-layer-mask-unavailable-tool',
  runtimeToolName: 'rawengine.agent.layer_mask.unavailable_tool',
});
if (
  unavailableAgentTool.status !== RawEngineAppServerResponseStatus.Ok ||
  unavailableAgentTool.dispatchStatus !== 'rejected' ||
  !unavailableAgentTool.message?.includes('not an approved typed agent app-server tool')
) {
  failures.push('Unavailable typed agent layer/mask tool must be rejected before dispatch.');
}

if (failures.length > 0) {
  console.error('Agent unavailable-provider workflow validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('agent unavailable-provider workflow ok (blocked dry-run + rejected apply + positive control)');
