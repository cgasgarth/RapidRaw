#!/usr/bin/env bun

import {
  AiProviderFallbackReason,
  AiProviderId,
  aiEditApprovalPolicySchema,
  aiProviderRuntimeStateSchema,
  normalizeAiProviderId,
  resolveAiEditApprovalPolicy,
  resolveAiProviderRuntimeState,
} from '../../../src/schemas/aiProviderSchemas.ts';

const fallbackCases = [
  {
    expected: {
      effectiveProvider: AiProviderId.Local,
      fallbackApplied: false,
      fallbackReason: null,
      generativeEditAvailable: false,
      requestedProvider: AiProviderId.Local,
      requestedProviderAvailable: true,
    },
    input: {
      aiProvider: AiProviderId.Local,
    },
    name: 'local provider stays available without generative editing',
  },
  {
    expected: {
      effectiveProvider: AiProviderId.Local,
      fallbackApplied: true,
      fallbackReason: AiProviderFallbackReason.InvalidProvider,
      generativeEditAvailable: false,
      requestedProvider: AiProviderId.Local,
      requestedProviderAvailable: false,
    },
    input: {
      aiProvider: 'legacy-app-server-provider-id',
    },
    name: 'invalid persisted provider falls back to local provider',
  },
  {
    expected: {
      effectiveProvider: AiProviderId.Local,
      fallbackApplied: true,
      fallbackReason: AiProviderFallbackReason.ConnectorUnavailable,
      generativeEditAvailable: false,
      requestedProvider: AiProviderId.Connector,
      requestedProviderAvailable: false,
    },
    input: {
      aiProvider: AiProviderId.Connector,
      isAIConnectorConnected: false,
    },
    name: 'disconnected AI connector falls back to local provider',
  },
  {
    expected: {
      effectiveProvider: AiProviderId.Connector,
      fallbackApplied: false,
      fallbackReason: null,
      generativeEditAvailable: true,
      requestedProvider: AiProviderId.Connector,
      requestedProviderAvailable: true,
    },
    input: {
      aiProvider: AiProviderId.Connector,
      isAIConnectorConnected: true,
    },
    name: 'connected AI connector enables generative editing',
  },
  {
    expected: {
      effectiveProvider: AiProviderId.Local,
      fallbackApplied: true,
      fallbackReason: AiProviderFallbackReason.CloudSignedOut,
      generativeEditAvailable: false,
      requestedProvider: AiProviderId.Cloud,
      requestedProviderAvailable: false,
    },
    input: {
      aiProvider: AiProviderId.Cloud,
      isPro: true,
      isSignedIn: false,
    },
    name: 'signed-out cloud provider falls back to local provider',
  },
  {
    expected: {
      effectiveProvider: AiProviderId.Local,
      fallbackApplied: true,
      fallbackReason: AiProviderFallbackReason.CloudPlanRequired,
      generativeEditAvailable: false,
      requestedProvider: AiProviderId.Cloud,
      requestedProviderAvailable: false,
    },
    input: {
      aiProvider: AiProviderId.Cloud,
      isPro: false,
      isSignedIn: true,
    },
    name: 'non-pro cloud account falls back to local provider',
  },
  {
    expected: {
      effectiveProvider: AiProviderId.Cloud,
      fallbackApplied: false,
      fallbackReason: null,
      generativeEditAvailable: true,
      requestedProvider: AiProviderId.Cloud,
      requestedProviderAvailable: true,
    },
    input: {
      aiProvider: AiProviderId.Cloud,
      isPro: true,
      isSignedIn: true,
    },
    name: 'signed-in pro cloud account enables generative editing',
  },
];

const runtimeStateJsonKeys = [
  'effectiveProvider',
  'fallbackApplied',
  'fallbackReason',
  'generativeEditAvailable',
  'requestedProvider',
  'requestedProviderAvailable',
];

const toStableJson = (value) => JSON.stringify(value, runtimeStateJsonKeys, 2);

const failures = [];

for (const fallbackCase of fallbackCases) {
  const actual = resolveAiProviderRuntimeState(fallbackCase.input);
  aiProviderRuntimeStateSchema.parse(actual);

  if (toStableJson(actual) !== toStableJson(fallbackCase.expected)) {
    failures.push(
      `${fallbackCase.name}\nexpected ${toStableJson(fallbackCase.expected)}\nreceived ${toStableJson(actual)}`,
    );
  }
}

if (normalizeAiProviderId('legacy-app-server-provider-id') !== AiProviderId.Local) {
  failures.push('normalizeAiProviderId must keep invalid persisted provider values on the local fallback.');
}

const approvalCases = [
  {
    expected: { approvalReason: null, requiresApproval: false },
    input: { aiProvider: AiProviderId.Local, useFastInpaint: true },
    name: 'local basic inpaint does not require approval',
  },
  {
    expected: { approvalReason: 'cloud_ai', requiresApproval: true },
    input: { aiProvider: AiProviderId.Cloud, useFastInpaint: false },
    name: 'cloud generative edit requires approval',
  },
  {
    expected: { approvalReason: 'connector_generative_edit', requiresApproval: true },
    input: { aiProvider: AiProviderId.Connector, useFastInpaint: false },
    name: 'connector generative edit requires approval',
  },
  {
    expected: { approvalReason: null, requiresApproval: false },
    input: { aiProvider: AiProviderId.Cloud, useFastInpaint: true },
    name: 'cloud provider with local basic inpaint does not require cloud approval',
  },
];

for (const approvalCase of approvalCases) {
  const actual = resolveAiEditApprovalPolicy(approvalCase.input);
  aiEditApprovalPolicySchema.parse(actual);

  if (JSON.stringify(actual) !== JSON.stringify(approvalCase.expected)) {
    failures.push(
      `${approvalCase.name}\nexpected ${JSON.stringify(approvalCase.expected)}\nreceived ${JSON.stringify(actual)}`,
    );
  }
}

if (failures.length > 0) {
  console.error('AI provider fallback validation failed.');
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(`Validated ${fallbackCases.length} AI provider fallback cases and ${approvalCases.length} approval cases.`);
