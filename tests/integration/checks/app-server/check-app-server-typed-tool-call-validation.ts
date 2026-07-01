#!/usr/bin/env bun

import { ApprovalClass } from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import {
  RawEngineAppServerAuditOutcome,
  RawEngineAppServerHostToolName,
  RawEngineAppServerResponseStatus,
  RawEngineAppServerToolKind,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import {
  buildRawEngineAppServerAuditEntry,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const failures: string[] = [];

type DispatchRequest = Parameters<typeof handleRawEngineAppServerHostRequestAsync>[0];

const baseDispatchRequest = {
  arguments: sampleToneColorCommandEnvelopeV1,
  requestId: 'typed_tool_validation_valid_dry_run',
  runtimeToolName: 'tonecolor.dry_run_command',
  toolName: RawEngineAppServerHostToolName.DispatchTool,
};

const issuePaths = (response: { schemaIssues?: Array<{ path: string[] }> }): string[] =>
  response.schemaIssues?.map((issue) => issue.path.join('.')) ?? [];

const expectRejected = async ({
  expectedPaths,
  label,
  request,
}: {
  expectedPaths: string[];
  label: string;
  request: DispatchRequest;
}) => {
  const response = await handleRawEngineAppServerHostRequestAsync(request);
  if (
    response.status !== RawEngineAppServerResponseStatus.Ok ||
    !('dispatchStatus' in response) ||
    response.dispatchStatus !== 'rejected'
  ) {
    failures.push(`${label}: expected structured rejection.`);
    return;
  }

  const paths = issuePaths(response);
  for (const expectedPath of expectedPaths) {
    if (!paths.includes(expectedPath)) {
      failures.push(`${label}: missing schema issue path ${expectedPath}; got ${paths.join(',') || 'none'}.`);
    }
  }
  if (!response.message?.includes('validation rejected')) {
    failures.push(`${label}: rejection message should identify validation boundary.`);
  }

  const auditEntry = buildRawEngineAppServerAuditEntry({
    mutates: false,
    outcome: RawEngineAppServerAuditOutcome.Rejected,
    requestId: response.requestId,
    timestampIso: '2026-07-01T12:00:00.000Z',
    toolKind: RawEngineAppServerToolKind.Command,
    toolName: response.runtimeToolName,
  });
  if (auditEntry.outcome !== RawEngineAppServerAuditOutcome.Rejected || auditEntry.mutates) {
    failures.push(`${label}: validation rejection audit entry must be rejected and non-mutating.`);
  }
};

const validDryRun = await handleRawEngineAppServerHostRequestAsync(baseDispatchRequest);
if (
  validDryRun.status !== RawEngineAppServerResponseStatus.Ok ||
  !('dispatchStatus' in validDryRun) ||
  validDryRun.dispatchStatus !== 'completed' ||
  validDryRun.schemaIssues !== undefined
) {
  failures.push('Valid registered tone-color dry-run should still dispatch without schema issues.');
}

await expectRejected({
  expectedPaths: ['toolCall.toolName'],
  label: 'unknown tool',
  request: {
    ...baseDispatchRequest,
    requestId: 'typed_tool_validation_unknown_tool',
    runtimeToolName: 'tonecolor.unknown_command',
  },
});

await expectRejected({
  expectedPaths: ['toolCall.toolName'],
  label: 'declared unknown tool',
  request: {
    ...baseDispatchRequest,
    requestId: 'typed_tool_validation_declared_unknown_tool',
    runtimeToolName: 'tonecolor.unknown_command',
    toolCall: {
      approval: sampleToneColorCommandEnvelopeV1.approval,
      dryRun: true,
      inputSchemaName: 'ToneColorCommandEnvelopeV1',
      toolKind: 'dry_run',
      toolName: 'tonecolor.unknown_command',
    },
  },
});

await expectRejected({
  expectedPaths: ['toolCall.toolKind'],
  label: 'mismatched kind',
  request: {
    ...baseDispatchRequest,
    requestId: 'typed_tool_validation_mismatched_kind',
    toolCall: { toolKind: 'apply' },
  },
});

await expectRejected({
  expectedPaths: ['toolCall.inputSchemaName'],
  label: 'wrong input schema',
  request: {
    ...baseDispatchRequest,
    requestId: 'typed_tool_validation_wrong_input_schema',
    toolCall: { inputSchemaName: 'CommandEnvelopeV1' },
  },
});

await expectRejected({
  expectedPaths: ['toolCall.dryRun'],
  label: 'dryRun mismatch',
  request: {
    ...baseDispatchRequest,
    requestId: 'typed_tool_validation_dry_run_mismatch',
    toolCall: { dryRun: false },
  },
});

await expectRejected({
  expectedPaths: ['toolCall.approval.state'],
  label: 'apply without approved approval',
  request: {
    arguments: {
      ...sampleToneColorApplyCommandEnvelopeV1,
      approval: {
        ...sampleToneColorApplyCommandEnvelopeV1.approval,
        state: 'pending',
      },
    },
    requestId: 'typed_tool_validation_apply_pending',
    runtimeToolName: 'tonecolor.apply_command',
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  },
});

await expectRejected({
  expectedPaths: ['toolCall.approval.approvalClass'],
  label: 'mutating route with preview-only approval',
  request: {
    arguments: {
      ...sampleToneColorApplyCommandEnvelopeV1,
      approval: {
        ...sampleToneColorApplyCommandEnvelopeV1.approval,
        approvalClass: ApprovalClass.PreviewOnly,
      },
    },
    requestId: 'typed_tool_validation_apply_preview_only',
    runtimeToolName: 'tonecolor.apply_command',
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  },
});

await expectRejected({
  expectedPaths: ['toolCall.arguments'],
  label: 'malformed arguments',
  request: {
    ...baseDispatchRequest,
    arguments: {
      ...sampleToneColorCommandEnvelopeV1,
      parameters: 'not-an-object',
    },
    requestId: 'typed_tool_validation_malformed_arguments',
  },
});

if (failures.length > 0) {
  console.error(`App-server typed tool-call validation failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('app-server typed tool-call validation ok (registry rejection before dispatch)');
