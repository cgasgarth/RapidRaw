#!/usr/bin/env bun

import {
  createRawEngineLocalAppServerBridge,
  rawEngineLocalAppServerAuditEventV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge.ts';
import { toneColorMutationResultV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleAiEnhancementCommandEnvelopeV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const failures: string[] = [];
const context = {
  now: () => new Date('2026-06-20T00:00:00.000Z'),
  requestId: 'request_local_app_server_audit_001',
};

const rejectedBridge = createRawEngineLocalAppServerBridge();
const rejectedApply = await rejectedBridge.dispatch(sampleToneColorApplyCommandEnvelopeV1, context);
if (rejectedApply.ok) failures.push('Apply before dry-run must be rejected.');
const [rejectedAudit] = rejectedBridge.listAuditEvents();
if (rejectedAudit?.status !== 'rejected' || rejectedAudit.dryRun !== false) {
  failures.push('Rejected apply must record a non-dry-run rejected audit event.');
}

const bridge = createRawEngineLocalAppServerBridge();
const dryRun = await bridge.dispatch(sampleToneColorCommandEnvelopeV1, context);
if (!dryRun.ok) failures.push(`Dry-run failed: ${dryRun.message}`);
const apply = await bridge.dispatch(sampleToneColorApplyCommandEnvelopeV1, context);
if (!apply.ok) failures.push(`Apply failed after dry-run: ${apply.message}`);
if (apply.ok) toneColorMutationResultV1Schema.parse(apply.result);

const unavailableProviderBridge = createRawEngineLocalAppServerBridge();
const unavailableProviderCommand = {
  ...sampleAiEnhancementCommandEnvelopeV1,
  parameters: {
    ...sampleAiEnhancementCommandEnvelopeV1.parameters,
    providerClass: 'self_hosted_connector',
    providerId: 'missing-local-connector',
    sourcePixelDisclosure: 'local_only',
  },
} as const;
const unavailableProviderResult = await unavailableProviderBridge.dispatch(unavailableProviderCommand, context);
if (unavailableProviderResult.ok) failures.push('Unavailable AI provider dry-run must be rejected.');
const [unavailableProviderAudit] = unavailableProviderBridge.listAuditEvents();
if (unavailableProviderAudit?.providerFallback?.fallbackReason !== 'provider_unavailable') {
  failures.push('Unavailable provider rejection must record provider fallback metadata.');
}
if (unavailableProviderAudit?.providerFallback?.requestedProviderId !== 'missing-local-connector') {
  failures.push('Unavailable provider audit must preserve requested provider id.');
}
if (unavailableProviderAudit?.mutates !== false || unavailableProviderAudit.dryRun !== true) {
  failures.push('Unavailable provider audit must remain non-mutating dry-run evidence.');
}
if (!unavailableProviderAudit?.warnings.some((warning) => warning.includes('no pixels were sent'))) {
  failures.push('Unavailable provider audit must include a user-visible non-disclosure warning.');
}

const auditEvents = bridge.listAuditEvents().map((event) => rawEngineLocalAppServerAuditEventV1Schema.parse(event));
const [dryRunAudit, applyAudit] = auditEvents;
if (auditEvents.length !== 2) failures.push(`Expected 2 audit events, got ${auditEvents.length}.`);
if (dryRunAudit?.commandId !== sampleToneColorCommandEnvelopeV1.commandId || dryRunAudit.dryRun !== true) {
  failures.push('Dry-run audit must preserve command id and dry-run mode.');
}
if (dryRunAudit?.mutates !== false) failures.push('Dry-run audit must be non-mutating.');
if (applyAudit?.commandId !== sampleToneColorApplyCommandEnvelopeV1.commandId || applyAudit.dryRun !== false) {
  failures.push('Apply audit must preserve command id and apply mode.');
}
if (applyAudit?.mutates !== true) failures.push('Apply audit must be mutating.');
for (const event of [rejectedAudit, dryRunAudit, applyAudit]) {
  if (event?.timestampIso !== '2026-06-20T00:00:00.000Z') {
    failures.push(`${event?.eventId ?? 'missing'} did not preserve context timestamp.`);
  }
  if (event?.requestId !== context.requestId) {
    failures.push(`${event?.eventId ?? 'missing'} did not preserve request id.`);
  }
}

if (failures.length > 0) {
  console.error('Local app-server audit event validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('local app-server audit events ok (dry-run/apply/reject)');
