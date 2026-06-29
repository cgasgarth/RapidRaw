#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import AgentChatShell from '../../../src/components/panel/right/AgentChatShell.tsx';
import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import {
  agentChatTranscriptSchema,
  type AgentChatTranscript,
} from '../../../src/schemas/agentChatTranscriptSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentInitialPromptContext } from '../../../src/utils/agentInitialPromptContext.ts';
import {
  agentMultiTurnAppServerSessionRequestSchema,
  runAgentMultiTurnAppServerSession,
  type AgentMultiTurnAppServerSessionResult,
} from '../../../src/utils/agentMultiTurnAppServerSession.ts';
import {
  appendAgentSessionAuditRecord,
  readAgentSessionAuditStore,
  type AgentSessionAuditRecord,
} from '../../../src/utils/agentSessionAuditStore.ts';

const LIVE_AGENT_AUDIT_STORE_KEY = 'rawengine.agent.liveSessionAudit.v1';
const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3164.ARW';
const prompt = 'Brighten the RAW, inspect a medium preview, then refine shadows and detail.';
const failures: string[] = [];

seedEditorStore();
installMemoryLocalStorage();

const initialContext = buildAgentInitialPromptContext({
  operationId: 'agent-live-shell-context',
  prompt,
  sessionId: 'agent-live-shell',
});
const transcript = agentChatTranscriptSchema.parse(buildTranscript(initialContext));
const shellMarkup = renderToStaticMarkup(
  createElement(I18nextProvider, { i18n: await createTestI18n() }, createElement(AgentChatShell, { transcript })),
);

for (const [needle, message] of [
  ['data-testid="agent-chat-shell"', 'agent chat shell did not render'],
  ['data-live-session-state="ready"', 'live session shell did not become ready from live_context'],
  ['data-live-session-event-count="0"', 'live session event count should start at zero'],
  ['data-agent-runtime-status="runtime_apply_demo"', 'runtime apply status was not exposed'],
  ['data-testid="agent-tool-transcript"', 'tool transcript did not render'],
  ['rawengine.agent.initial_prompt_preview', 'initial prompt preview tool call did not render'],
]) {
  if (!shellMarkup.includes(needle)) failures.push(message);
}

const request = agentMultiTurnAppServerSessionRequestSchema.parse({
  operationId: 'agent-live-shell-session',
  prompt,
  requestId: 'agent-live-shell-request',
  sessionId: 'agent-live-shell',
  turns: [
    {
      adjustment: { exposure: 0.28, highlights: -10 },
      assistantRationale: 'First pass: lift exposure while protecting highlights.',
      preview: { purpose: 'refresh' },
    },
    {
      adjustment: { shadows: 18, contrast: 9 },
      assistantRationale: 'Second pass after preview: open shadows and restore detail.',
      detailEffects: { clarity: 18, dehaze: 8, sharpness: 12 },
      preview: { longEdgePx: 1536, purpose: 'detail_review', quality: 0.86 },
      userFollowUp: 'Inspect the medium preview and refine the image before final review.',
    },
  ],
});

const sessionResult = await runAgentMultiTurnAppServerSession(request);
validateSessionResult(sessionResult);

const auditRecord = buildAuditRecord(sessionResult);
const auditStore = appendAgentSessionAuditRecord(
  {
    readText: () => globalThis.localStorage.getItem(LIVE_AGENT_AUDIT_STORE_KEY),
    writeText: (value) => globalThis.localStorage.setItem(LIVE_AGENT_AUDIT_STORE_KEY, value),
  },
  auditRecord,
);
const readBack = readAgentSessionAuditStore({
  readText: () => globalThis.localStorage.getItem(LIVE_AGENT_AUDIT_STORE_KEY),
  writeText: (value) => globalThis.localStorage.setItem(LIVE_AGENT_AUDIT_STORE_KEY, value),
});
const persisted = readBack.records[0];

if (auditStore.records.length !== 1 || persisted === undefined) {
  failures.push('live session audit did not persist one record.');
} else {
  if (persisted.sessionId !== sessionResult.sessionId) failures.push('audit session id did not round-trip.');
  if (persisted.artifactLineage.length !== sessionResult.previewLineage.length) {
    failures.push('audit artifact lineage count did not match preview lineage.');
  }
  if (persisted.toolCalls.length !== sessionResult.toolCalls.length + 1) {
    failures.push('audit tool call count did not match session result.');
  }
  if (
    persisted.rollbackGraphRevision !== sessionResult.rollbackGraphRevision ||
    persisted.finalGraphRevision !== sessionResult.finalGraphRevision
  ) {
    failures.push('audit did not preserve rollback/final graph revisions.');
  }
}

if (failures.length > 0) {
  console.error('agent live session shell failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `agent live session shell ok (${sessionResult.turnCount} turns, ${sessionResult.previews.length} previews, ${sessionResult.toolCalls.length} tool calls)`,
);

function seedEditorStore() {
  const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 2));
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-live-shell-before',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '320', LensModel: 'FE 24-70mm F2.8 GM II' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-original-live-shell',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-thumb-live-shell',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
}

function buildTranscript(initialContext: ReturnType<typeof buildAgentInitialPromptContext>): AgentChatTranscript {
  return {
    id: 'agent-live-shell',
    initialPromptPreviewContext: {
      accessScope: initialContext.preview.accessScope,
      artifactId: initialContext.preview.artifactId,
      colorProfile: initialContext.modelInput.initialPreview.colorProfile,
      encodedFormat: initialContext.preview.encodedFormat,
      graphRevision: initialContext.modelInput.graphRevision,
      height: initialContext.modelInput.initialPreview.height,
      includesOriginalRaw: initialContext.modelInput.initialPreview.includesOriginalRaw,
      longEdgePx: initialContext.preview.longEdgePx,
      mediaType: initialContext.preview.mediaType,
      previewRef: initialContext.preview.previewRef,
      purpose: initialContext.preview.purpose,
      quality: initialContext.preview.quality,
      recipeHash: initialContext.preview.recipeHash,
      renderHash: initialContext.preview.renderHash,
      transport: initialContext.modelInput.transport,
      width: initialContext.modelInput.initialPreview.width,
    },
    messages: [
      {
        body: `Ready to plan a local app-server edit for ${selectedPath}. Initial prompt includes JPEG preview ${initialContext.preview.artifactId}.`,
        id: 'live-agent-current-context',
        role: 'system',
        timestamp: 'now',
      },
    ],
    runtimeStatus: 'runtime_apply_demo',
    sessionTitle: 'Current image: DSC_3164.ARW',
    toolCalls: [
      {
        approvalState: 'not_required',
        id: 'live-agent-current-context-readiness',
        mode: 'read',
        provenance: {
          requestHash: 'sha256:0000000000000000',
          runtime: 'codex_app_server',
          schema: 'liveAgentCurrentContext.v1',
        },
        status: 'succeeded',
        summary: `Ready to plan a local app-server edit for ${selectedPath}.`,
        timestamp: 'now',
        title: 'Current image context',
        toolName: 'rawengine.live_context',
      },
      {
        approvalState: 'not_required',
        id: 'live-agent-initial-preview-context',
        mode: 'read',
        provenance: {
          requestHash: 'sha256:1111111111111111',
          runtime: 'codex_app_server',
          schema: 'agentInitialPromptContext.v1',
        },
        status: 'succeeded',
        summary: `Initial prompt includes JPEG preview ${initialContext.preview.artifactId}.`,
        timestamp: 'now',
        title: 'Initial prompt preview',
        toolName: 'rawengine.agent.initial_prompt_preview',
      },
    ],
  };
}

function validateSessionResult(sessionResult: AgentMultiTurnAppServerSessionResult) {
  const previewPurposes = sessionResult.previews.map((preview) => preview.purpose);
  const lineagePurposes = sessionResult.previewLineage.map((preview) => preview.purpose);
  const toolNames = sessionResult.toolCalls.map((toolCall) => toolCall.name);

  if (sessionResult.sessionId !== request.sessionId || sessionResult.turnCount !== 2) {
    failures.push('live session did not preserve session identity and turn count.');
  }
  if (previewPurposes.join(',') !== 'initial_context,refresh,detail_review') {
    failures.push(`live session preview order was wrong: ${previewPurposes.join(',')}`);
  }
  if (lineagePurposes.join(',') !== previewPurposes.join(',')) {
    failures.push('preview lineage did not match preview order.');
  }
  if (
    !toolNames.includes('rawengine.agent.adjustments.apply') ||
    !toolNames.includes('rawengine.agent.detail_effects.apply') ||
    toolNames.filter((name) => name === 'rawengine.agent.preview.render').length !== 2 ||
    toolNames.filter((name) => name === 'rawengine.agent.state.get').length < 3
  ) {
    failures.push(`live session did not use the expected safe tool path: ${toolNames.join(',')}`);
  }
  if (
    sessionResult.previewLineage.at(-1)?.artifactId !== sessionResult.previews.at(-1)?.artifactId ||
    sessionResult.editReview.preview.id !== sessionResult.previews.at(-1)?.id ||
    sessionResult.editReview.beforePreview.id !== sessionResult.previews[0]?.id
  ) {
    failures.push('live session review did not bind to before/after previews.');
  }
  if (sessionResult.editReview.toolReceiptCount !== 2) {
    failures.push(`expected two applied tool receipts, got ${sessionResult.editReview.toolReceiptCount}.`);
  }
  if (sessionResult.rollbackGraphRevision !== 'history_0' || sessionResult.finalGraphRevision !== 'history_3') {
    failures.push('live session did not preserve rollback/final graph revisions.');
  }
}

function buildAuditRecord(sessionResult: AgentMultiTurnAppServerSessionResult): AgentSessionAuditRecord {
  return {
    approvalId: 'agent_policy_not_required',
    artifactLineage: sessionResult.previewLineage.map((preview) => ({
      artifactId: preview.artifactId,
      contentHash: `sha256:${preview.renderHash}`,
      graphRevision: preview.graphRevision,
      sourceToolCallId: preview.toolCallId,
    })),
    finalGraphRevision: sessionResult.finalGraphRevision,
    initialGraphRevision: sessionResult.initialContext.imageContext.graphRevision,
    modelId: sessionResult.modelId,
    planSummary: sessionResult.editReview.finalRationale,
    prompt,
    rollbackGraphRevision: sessionResult.rollbackGraphRevision,
    sessionId: sessionResult.sessionId,
    toolCalls: [
      {
        id: sessionResult.previewLineage[0]?.toolCallId ?? `${sessionResult.sessionId}-initial-preview`,
        name: 'rawengine.agent.initial_prompt_preview',
        resultSummary: sessionResult.initialContext.preview.artifactId,
        status: 'succeeded',
      },
      ...sessionResult.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        resultSummary: toolCall.receiptGraphRevision ?? toolCall.previewArtifactId ?? `${toolCall.name} succeeded`,
        status: toolCall.status,
      })),
    ],
    traceEvents: [
      {
        id: `${sessionResult.sessionId}-prompt`,
        kind: 'prompt',
        message: prompt,
        timestamp: new Date(0).toISOString(),
      },
      ...sessionResult.previewLineage.map((preview, index) => ({
        graphRevision: preview.graphRevision,
        id: `${sessionResult.sessionId}-preview-${index}`,
        kind: 'preview' as const,
        previewRef: preview.artifactId,
        recipeHash: preview.recipeHash,
        renderHash: preview.renderHash,
        timestamp: new Date(index + 1).toISOString(),
        toolCallId: preview.toolCallId,
      })),
      {
        graphRevision: sessionResult.rollbackGraphRevision,
        id: `${sessionResult.sessionId}-rollback`,
        kind: 'rollback',
        message: 'Rollback checkpoint available.',
        timestamp: new Date(sessionResult.previewLineage.length + 1).toISOString(),
      },
    ],
  };
}

function installMemoryLocalStorage() {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) } },
  });
  return instance;
}
