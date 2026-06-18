import { agentChatTranscriptSchema, type AgentChatTranscript } from '../schemas/agentChatTranscriptSchemas';

const fixture = {
  dryRunReview: {
    actions: [
      {
        id: 'approve-dry-run',
        label: 'Approve dry-run',
        reason: 'Requires runtime replay before apply can be enabled.',
        state: 'disabled',
      },
      {
        id: 'reject-plan',
        label: 'Reject plan',
        reason: 'Rejected state is visible and audit-only in this fixture.',
        state: 'rejected',
      },
      {
        id: 'apply-unavailable',
        label: 'Apply unavailable',
        reason: 'UI-only demo cannot mutate project state.',
        state: 'unavailable',
      },
    ],
    affectedTargets: [
      {
        id: 'current-frame',
        label: 'Frame',
        value: 'DSC_1042.ARW',
      },
      {
        id: 'sidecar',
        label: 'Sidecar',
        value: 'Pending dry-run artifact',
      },
      {
        id: 'mask',
        label: 'Mask',
        value: 'Protected subject mask',
      },
    ],
    parameterDiffs: [
      {
        after: '+420 K',
        before: '+0 K',
        id: 'temperature',
        label: 'Temperature',
      },
      {
        after: '-18',
        before: '0',
        id: 'highlights',
        label: 'Highlights',
      },
      {
        after: '+7',
        before: '0',
        id: 'subject-saturation',
        label: 'Subject saturation',
      },
    ],
    warnings: [
      'Window highlight clipping must be reviewed before apply.',
      'Runtime apply stays disabled until app-server replay proof exists.',
    ],
  },
  id: 'agent-chat-demo-portrait-grade-v1',
  messages: [
    {
      body: 'Warm the skin, keep the dress neutral, and do not clip the window highlights.',
      id: 'msg-user-1',
      role: 'user',
      timestamp: '14:22:10',
    },
    {
      body: 'I can prepare a dry-run with color balance, highlight recovery, and a protected subject mask.',
      id: 'msg-agent-1',
      role: 'assistant',
      timestamp: '14:22:14',
    },
    {
      body: 'Dry-run only. No pixels or sidecars have been changed.',
      id: 'msg-system-1',
      role: 'system',
      timestamp: '14:22:16',
    },
  ],
  runtimeStatus: 'ui_only_demo',
  sessionTitle: 'Portrait color grade',
  toolCalls: [
    {
      approvalState: 'not_required',
      durationMs: 184,
      id: 'tool-1',
      mode: 'read',
      provenance: {
        requestHash: 'sha256:48f0c2c8332bb2f7',
        runtime: 'codex_app_server',
        schema: 'rawEngineAppServerRouteCatalogRequest.v1',
      },
      status: 'succeeded',
      summary: 'Found tone, color, mask, and export routes.',
      timestamp: '14:22:15',
      title: 'Read available edit tools',
      toolName: 'rawengine.route_catalog',
    },
    {
      approvalState: 'required',
      durationMs: 312,
      id: 'tool-2',
      mode: 'dry_run',
      provenance: {
        requestHash: 'sha256:a84094d362ed80af',
        runtime: 'codex_app_server',
        schema: 'toneColorCommandEnvelope.v1',
        sourceAssetHash: 'sha256:9d0f83a746a7d4e6',
      },
      status: 'warning',
      summary: 'Prepared +420 K warmth, -18 highlights, and subject-safe saturation.',
      timestamp: '14:22:18',
      title: 'Build color dry-run',
      toolName: 'rawengine.tone_color.dry_run',
      warning: 'Window highlight warning: review clipping map before apply.',
    },
    {
      approvalState: 'rejected',
      id: 'tool-3',
      mode: 'apply',
      provenance: {
        requestHash: 'sha256:de0fb74e411dc332',
        runtime: 'codex_app_server',
        schema: 'aiEnhancementApplyRequest.v1',
        sourceAssetHash: 'sha256:9d0f83a746a7d4e6',
      },
      status: 'blocked',
      summary: 'Apply blocked until the dry-run diff is inspected and approved.',
      timestamp: '14:22:20',
      title: 'Apply proposed grade',
      toolName: 'rawengine.edit.apply_dry_run_plan',
      warning: 'UI-only shell: this demo does not mutate project state.',
    },
  ],
} satisfies AgentChatTranscript;

export const agentChatTranscriptFixture = agentChatTranscriptSchema.parse(fixture);
