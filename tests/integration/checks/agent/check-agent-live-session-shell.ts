#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import AgentChatShell from '../../../../src/components/panel/right/ai/AgentChatShell.tsx';
import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import {
  type AgentChatTranscript,
  agentChatTranscriptSchema,
} from '../../../../src/schemas/agent/agentChatTranscriptSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentInitialPromptContext } from '../../../../src/utils/agent/context/agentInitialPromptContext.ts';
import { agentChatTranscriptFixture } from '../../../../src/utils/agent/session/agentChatTranscriptFixture.ts';
import {
  type AgentMultiTurnAppServerSessionResult,
  agentMultiTurnAppServerSessionRequestSchema,
  runAgentMultiTurnAppServerSession,
} from '../../../../src/utils/agent/session/agentMultiTurnAppServerSession.ts';
import {
  type AgentSessionAuditRecord,
  appendAgentSessionAuditRecord,
  readAgentSessionAuditStore,
} from '../../../../src/utils/agent/session/agentSessionAuditStore.ts';

const LIVE_AGENT_AUDIT_STORE_KEY = 'rawengine.agent.liveSessionAudit.v1';
const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3164.ARW';
const prompt = 'Brighten the RAW, inspect a medium preview, then refine shadows and detail.';
const embeddedPreviewDataUrl = `data:image/jpeg;base64,${'A'.repeat(256)}`;
const failures: string[] = [];

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();
seedEditorStore();
installMemoryLocalStorage();

const initialContext = buildAgentInitialPromptContext({
  operationId: 'agent-live-shell-context',
  prompt,
  sessionId: 'agent-live-shell',
});
const transcript = agentChatTranscriptSchema.parse(buildTranscript(initialContext));

await validateRenderedShellBehavior(transcript, initialContext);
await validateRenderedSelectedImageLoopFromPanel(transcript);
await validateRenderedStaleState(transcript);
await validateRenderedReviewStates(transcript);
globalThis.localStorage.removeItem(LIVE_AGENT_AUDIT_STORE_KEY);

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
    finalPreviewUrl: null,
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
      thumbnailUrl: embeddedPreviewDataUrl,
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
}

async function validateRenderedShellBehavior(
  renderedTranscript: AgentChatTranscript,
  context: ReturnType<typeof buildAgentInitialPromptContext>,
) {
  const rendered = await renderShell(renderedTranscript);

  const shell = getByTestId(rendered.container, 'agent-chat-shell', 'agent chat shell did not render.');
  assertData(shell, 'liveSessionState', 'ready', 'live session shell did not become ready from live_context.');
  assertData(shell, 'liveSessionEventCount', '0', 'live session event count should start at zero.');
  assertData(shell, 'agentRuntimeStatus', 'runtime_apply_demo', 'runtime apply status was not exposed.');

  const toolTranscript = getByTestId(rendered.container, 'agent-tool-transcript', 'tool transcript did not render.');
  assertVisibleText(
    toolTranscript,
    'rawengine.agent.initial_prompt_preview',
    'initial prompt preview tool call did not render.',
  );
  assertVisibleText(rendered.container, 'Runtime apply proof', 'runtime status label was not visible.');
  assertVisibleText(rendered.container, context.preview.artifactId, 'initial preview artifact id was not visible.');
  assertVisibleText(
    rendered.container,
    `JPEG ${context.modelInput.initialPreview.width}x${context.modelInput.initialPreview.height} preview`,
    'initial preview dimensions were not visible.',
  );
  assertVisibleText(
    rendered.container,
    `${context.preview.longEdgePx}px long edge`,
    'initial preview long-edge summary was not visible.',
  );
  if (rendered.container.querySelector('[data-testid="agent-initial-prompt-preview-context"] img') === null) {
    failures.push('initial preview thumbnail was not rendered.');
  }
  assertNoBase64PreviewPayload(rendered.container);
  assertVisibleText(
    rendered.container,
    'Ready to plan a local app-server edit',
    'existing transcript message was not visible.',
  );

  const runButton = getButtonByName(rendered.container, 'Dry-run', 'dry-run button was not queryable by role/text.');
  const applyButton = getButtonByName(rendered.container, 'Apply edit', 'apply button was not queryable by role/text.');
  if (runButton.disabled) failures.push('dry-run button should be enabled when live context is ready.');
  if (!applyButton.disabled) failures.push('apply button should stay disabled before a dry-run exists.');

  const promptInput = getByTestId<HTMLTextAreaElement>(
    rendered.container,
    'agent-live-prompt-input',
    'live prompt input did not render.',
  );
  await act(async () => {
    promptInput.value = prompt;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    runButton.click();
  });
  await act(async () => {
    await flushPromises();
  });

  const composer = getByTestId(
    rendered.container,
    'agent-live-prompt-composer',
    'live prompt composer did not render.',
  );
  await waitForCondition('dry-run did not reach review-ready state.', () => {
    return composer.dataset.livePromptStatus === 'dry_run_ready';
  });
  getByTestId(rendered.container, 'agent-live-prompt-result', 'dry-run result did not render.');
  const eventsAfterDryRun = Number(shell.dataset.liveSessionEventCount ?? '0');
  if (eventsAfterDryRun < 2) {
    failures.push(`expected rendered session events after dry-run, got ${eventsAfterDryRun}.`);
  }

  const enabledApplyButton = getButtonByName(
    rendered.container,
    'Apply edit',
    'enabled apply button was not queryable after dry-run.',
  );
  if (enabledApplyButton.disabled) failures.push('apply button should become enabled after a successful dry-run.');
  await act(async () => {
    enabledApplyButton.click();
  });
  await act(async () => {
    await flushPromises();
  });

  await waitForCondition(
    () =>
      `apply did not reach rendered applied state. status=${composer.dataset.livePromptStatus ?? '<missing>'}; result=${normalizeText(
        rendered.container.querySelector('[data-testid="agent-live-prompt-result"]')?.textContent,
      ).slice(0, 1000)}`,
    () => {
      return composer.dataset.livePromptStatus === 'applied';
    },
  );
  const review = await waitForTestId(
    rendered.container,
    'agent-live-session-review',
    'applied session review did not render.',
  );
  assertData(review, 'rollbackGraphRevision', 'history_0', 'rollback target revision was not rendered after apply.');
  assertData(
    review,
    'rollbackState',
    'invalidated',
    'post-apply rollback state was not rendered from graph validation.',
  );
  assertData(review, 'initialPreviewArtifactId', context.preview.artifactId, 'before preview was not bound in review.');
  if ((review.dataset.finalPreviewArtifactId ?? '') === context.preview.artifactId) {
    failures.push('current preview binding did not move past the initial preview after apply.');
  }

  const lineage = rendered.container.querySelectorAll('[data-testid="agent-live-session-preview-lineage-entry"]');
  if (lineage.length !== 3) failures.push(`expected three rendered preview lineage entries, got ${lineage.length}.`);
  const lineagePurposes = Array.from(lineage).map((entry) => (entry as HTMLElement).dataset.purpose);
  if (lineagePurposes.join(',') !== 'initial_context,refresh,detail_review') {
    failures.push(`rendered preview lineage order was wrong: ${lineagePurposes.join(',')}.`);
  }

  const audit = await waitForTestId(
    rendered.container,
    'agent-live-session-audit-artifact',
    'live audit artifact panel did not render after apply.',
  );
  assertData(audit, 'persistedRecordCount', '1', 'rendered audit output did not expose persisted record count.');
  assertData(audit, 'rollbackGraphRevision', 'history_0', 'rendered audit output did not preserve rollback revision.');

  rendered.unmount();
}

async function validateRenderedStaleState(renderedTranscript: AgentChatTranscript) {
  seedEditorStore();
  const rendered = await renderShell(renderedTranscript);
  const runButton = getButtonByName(rendered.container, 'Dry-run', 'stale-state dry-run button did not render.');
  const promptInput = getByTestId<HTMLTextAreaElement>(
    rendered.container,
    'agent-live-prompt-input',
    'stale-state prompt input did not render.',
  );

  await act(async () => {
    promptInput.value = prompt;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    runButton.click();
  });
  await waitForCondition('stale-state dry-run did not reach review-ready state.', () => {
    return (
      getByTestId(rendered.container, 'agent-live-prompt-composer', 'stale-state composer did not render.').dataset
        .livePromptStatus === 'dry_run_ready'
    );
  });

  await act(async () => {
    useEditorStore.getState().setEditor({
      adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.15 },
      finalPreviewUrl: 'blob:rawengine-agent-live-shell-stale',
      history: [{ ...INITIAL_ADJUSTMENTS, exposure: 0.15 }],
      historyIndex: 0,
    });
  });
  await act(async () => {
    getButtonByName(rendered.container, 'Inspect state', 'inspect-state button did not render.').click();
  });
  const staleWarning = await waitForTestId(
    rendered.container,
    'agent-live-prompt-stale-preview-warning',
    'stale recipe warning did not render after graph recipe changed.',
  );
  assertData(staleWarning, 'stateStaleRecipeHash', 'true', 'stale state recipe hash was not exposed.');

  rendered.unmount();
  seedEditorStore();
}

async function validateRenderedSelectedImageLoopFromPanel(renderedTranscript: AgentChatTranscript) {
  seedEditorStore();
  const rendered = await renderShell(renderedTranscript);
  const runButton = getButtonByName(rendered.container, 'Dry-run', 'selected-loop dry-run button did not render.');
  const promptInput = getByTestId<HTMLTextAreaElement>(
    rendered.container,
    'agent-live-prompt-input',
    'selected-loop prompt input did not render.',
  );

  await act(async () => {
    promptInput.value = prompt;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    runButton.click();
  });
  await waitForCondition('selected-loop dry-run did not reach review-ready state.', () => {
    return (
      getByTestId(rendered.container, 'agent-live-prompt-composer', 'selected-loop composer did not render.').dataset
        .livePromptStatus === 'dry_run_ready'
    );
  });

  const loopButton = getByTestId<HTMLButtonElement>(
    rendered.container,
    'agent-live-selected-image-preview-loop',
    'live selected-image preview-loop control did not render.',
  );
  if (loopButton.disabled) failures.push('live selected-image preview-loop control should enable after dry-run.');
  assertData(
    loopButton,
    'dispatchPath',
    'rawengine.agent.selected_image.preview_loop',
    'live selected-image preview-loop control did not bind the typed dispatch path.',
  );
  await act(async () => {
    loopButton.click();
  });
  await waitForCondition('selected-image loop did not render a runtime review from the AI panel.', () => {
    return rendered.container.querySelector('[data-testid="agent-selected-image-preview-loop-review"]') !== null;
  });

  const selectedLoop = getByTestId(
    rendered.container,
    'agent-selected-image-preview-loop-review',
    'selected-image preview-loop review did not render after panel dispatch.',
  );
  assertData(
    selectedLoop,
    'toolName',
    'rawengine.agent.selected_image.preview_loop',
    'panel selected-image loop review did not expose the selected-image tool.',
  );
  assertData(selectedLoop, 'selectedImagePath', selectedPath, 'panel selected-image loop used the wrong image path.');
  assertData(selectedLoop, 'runtimeState', 'idle', 'panel selected-image loop review should render completed output.');
  assertData(selectedLoop, 'acceptedDryRunPlanCount', '2', 'panel selected-image loop did not accept two dry-runs.');
  assertData(selectedLoop, 'applyReceiptCount', '2', 'panel selected-image loop did not render two apply receipts.');
  assertData(selectedLoop, 'previewLineageCount', '2', 'panel selected-image loop did not render preview lineage.');
  assertData(
    selectedLoop,
    'rollbackReceiptGraphRevision',
    'history_0',
    'panel selected-image loop did not expose rollback-after-review receipt.',
  );
  const acceptApply = getByTestId<HTMLButtonElement>(
    rendered.container,
    'agent-selected-image-preview-loop-accept-apply',
    'panel selected-image accept/apply state did not render.',
  );
  assertData(acceptApply, 'controlState', 'dispatched', 'panel selected-image apply state did not show dispatch.');
  const changedPixels = Number(
    getByTestId(
      rendered.container,
      'agent-selected-image-preview-loop-changed-pixels',
      'panel selected-image changed-pixel metric did not render.',
    ).textContent,
  );
  if (!Number.isFinite(changedPixels) || changedPixels <= 0) {
    failures.push(`panel selected-image changed-pixel metric was not positive: ${changedPixels}.`);
  }

  rendered.unmount();
  seedEditorStore();
}

async function validateRenderedReviewStates(baseTranscript: AgentChatTranscript) {
  const blockedTranscript = agentChatTranscriptSchema.parse({
    ...baseTranscript,
    toolCalls: baseTranscript.toolCalls.filter((toolCall) => toolCall.toolName !== 'rawengine.live_context'),
  });
  const blocked = await renderShell(blockedTranscript);
  const blockedShell = getByTestId(blocked.container, 'agent-chat-shell', 'blocked shell did not render.');
  assertData(blockedShell, 'liveSessionState', 'blocked', 'missing live_context did not render blocked shell state.');
  if (!getButtonByName(blocked.container, 'Dry-run', 'blocked dry-run button did not render.').disabled) {
    failures.push('dry-run should be disabled when live_context is missing.');
  }
  blocked.unmount();

  const reviewTranscript = agentChatTranscriptSchema.parse({
    ...baseTranscript,
    artifactReview: agentChatTranscriptFixture.artifactReview,
    dryRunReview: {
      ...agentChatTranscriptFixture.dryRunReview,
      actions: agentChatTranscriptFixture.dryRunReview.actions.map((action) =>
        action.id === 'apply-approved' ? { ...action, state: 'disabled' as const } : action,
      ),
    },
    reviewHandoff: agentChatTranscriptFixture.reviewHandoff,
    selectedImagePreviewLoopReview: agentChatTranscriptFixture.selectedImagePreviewLoopReview,
  });
  const review = await renderShell(reviewTranscript);

  const dryRunReview = getByTestId(review.container, 'agent-dry-run-review', 'dry-run review did not render.');
  assertData(dryRunReview, 'applyAvailability', 'runtime_apply_demo', 'dry-run apply availability was not rendered.');
  const disabledApply = getByTestId<HTMLButtonElement>(
    review.container,
    'agent-approval-action-apply-approved',
    'disabled apply-approved review control did not render.',
  );
  if (!disabledApply.disabled) failures.push('disabled apply-approved review control should render disabled.');
  if (
    getButtonByName(review.container, 'Runtime apply proof', 'runtime apply proof control did not render.').disabled !==
    true
  ) {
    failures.push('runtime replay apply proof should be a disabled rendered control.');
  }

  const artifactReview = getByTestId(review.container, 'agent-artifact-review', 'artifact review did not render.');
  assertData(artifactReview, 'artifactCount', '3', 'artifact review did not expose preview artifact count.');
  assertVisibleText(review.container, 'Current edit graph', 'before preview label was not visible in artifact review.');
  assertVisibleText(
    review.container,
    'Applied virtual copy',
    'current preview label was not visible in artifact review.',
  );

  const handoff = getByTestId(review.container, 'agent-review-handoff', 'rollback handoff did not render.');
  assertData(handoff, 'rollbackStatus', 'available', 'rollback handoff availability was not rendered.');
  const rollbackRestore = getByTestId<HTMLButtonElement>(
    review.container,
    'agent-review-handoff-rollback-restore',
    'rollback restore control did not render.',
  );
  if (rollbackRestore.disabled) failures.push('available rollback restore control should render enabled.');
  await act(async () => {
    rollbackRestore.click();
  });
  assertData(handoff, 'rollbackRestoreState', 'restored', 'rollback restore action did not update rendered state.');

  const selectedLoop = getByTestId(
    review.container,
    'agent-selected-image-preview-loop-review',
    'selected-image preview-loop review did not render.',
  );
  assertData(
    selectedLoop,
    'toolName',
    'rawengine.agent.selected_image.preview_loop',
    'selected-image preview-loop tool name was not exposed.',
  );
  assertData(selectedLoop, 'reviewStatus', 'needs_user_review', 'selected-image review status was not rendered.');
  assertData(selectedLoop, 'previewLineageCount', '2', 'selected-image preview lineage count was not rendered.');
  assertData(selectedLoop, 'applyReceiptCount', '2', 'selected-image apply receipt count was not rendered.');
  assertData(selectedLoop, 'auditEventCount', '5', 'selected-image audit event count was not rendered.');
  assertData(
    selectedLoop,
    'beforeArtifactId',
    'artifact_agent_selected_loop_before_3162',
    'selected-image before artifact id was not exposed.',
  );
  assertData(
    selectedLoop,
    'currentArtifactId',
    'artifact_agent_selected_loop_current_3162',
    'selected-image current artifact id was not exposed.',
  );
  assertData(selectedLoop, 'initialGraphRevision', 'history_0', 'selected-image initial graph was not exposed.');
  assertData(selectedLoop, 'finalGraphRevision', 'history_2', 'selected-image final graph was not exposed.');
  assertData(
    selectedLoop,
    'rollbackReceiptGraphRevision',
    'history_0',
    'selected-image rollback receipt was not exposed.',
  );
  if (!selectedLoop.dataset.blockers?.includes('private_raw_proof_unavailable')) {
    failures.push('selected-image private RAW proof blocker was not rendered.');
  }

  const before = getByTestId(
    review.container,
    'agent-selected-image-preview-loop-before',
    'selected-image before artifact card did not render.',
  );
  assertData(
    before,
    'artifactId',
    'artifact_agent_selected_loop_before_3162',
    'selected-image before artifact card was not bound.',
  );
  const current = getByTestId(
    review.container,
    'agent-selected-image-preview-loop-current',
    'selected-image current artifact card did not render.',
  );
  assertData(
    current,
    'artifactId',
    'artifact_agent_selected_loop_current_3162',
    'selected-image current artifact card was not bound.',
  );

  const selectedLoopLineage = review.container.querySelectorAll(
    '[data-testid="agent-selected-image-preview-loop-lineage-entry"]',
  );
  if (selectedLoopLineage.length !== 2) {
    failures.push(`expected two selected-image preview lineage entries, got ${selectedLoopLineage.length}.`);
  }
  const selectedLoopPurposes = Array.from(selectedLoopLineage).map((entry) => (entry as HTMLElement).dataset.purpose);
  if (selectedLoopPurposes.join(',') !== 'refresh,detail_review') {
    failures.push(`selected-image preview lineage order was wrong: ${selectedLoopPurposes.join(',')}.`);
  }

  const selectedLoopControls = getByTestId(
    review.container,
    'agent-selected-image-preview-loop-controls',
    'selected-image preview-loop controls did not render.',
  );
  assertData(
    selectedLoopControls,
    'disabledReason',
    'private_raw_proof_unavailable',
    'selected-image disabled/error reason was not exposed.',
  );
  const acceptApply = getByTestId<HTMLButtonElement>(
    review.container,
    'agent-selected-image-preview-loop-accept-apply',
    'selected-image accept apply control did not render.',
  );
  assertData(
    acceptApply,
    'dispatchPath',
    'rawengine.agent.selected_image.preview_loop',
    'selected-image accept apply did not bind to typed command dispatch.',
  );
  const revise = getByTestId<HTMLButtonElement>(
    review.container,
    'agent-selected-image-preview-loop-revise',
    'selected-image revise control did not render.',
  );
  assertData(
    revise,
    'dispatchPath',
    'rawengine.agent.selected_image.preview_loop',
    'selected-image revise control did not bind to typed command dispatch.',
  );
  if (!revise.dataset.feedback?.includes('Foreground still needs separation')) {
    failures.push('selected-image revise feedback turn was not rendered.');
  }
  const selectedRollback = getByTestId<HTMLButtonElement>(
    review.container,
    'agent-selected-image-preview-loop-rollback',
    'selected-image rollback control did not render.',
  );
  assertData(
    selectedRollback,
    'dispatchPath',
    'rawengine.agent.history.rollback',
    'selected-image rollback did not bind to typed rollback dispatch.',
  );
  getByTestId(
    review.container,
    'agent-selected-image-preview-loop-audit-summary',
    'selected-image audit summary did not render.',
  );
  getByTestId(
    review.container,
    'agent-selected-image-preview-loop-rollback-receipt',
    'selected-image rollback receipt did not render.',
  );

  review.unmount();
}

function installDom() {
  const window = new Window({ url: 'http://localhost/agent-live-session-shell' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', { configurable: true, value: window.HTMLTextAreaElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
}

async function renderShell(renderedTranscript: AgentChatTranscript): Promise<{
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(AgentChatShell, { transcript: renderedTranscript })),
    );
  });

  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getByTestId<T extends HTMLElement = HTMLElement>(container: Element, testId: string, message: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (element === null) {
    failures.push(message);
    throw new Error(message);
  }
  return element as T;
}

async function waitForTestId<T extends HTMLElement = HTMLElement>(
  container: Element,
  testId: string,
  message: string,
): Promise<T> {
  const element = await waitForCondition(
    message,
    () => container.querySelector(`[data-testid="${testId}"]`) as T | null,
  );
  return element;
}

async function waitForCondition<T>(
  message: string | (() => string),
  check: () => T | false | null | undefined,
): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = check();
    if (result) return result;
    await act(async () => {
      await flushPromises();
    });
  }

  const resolvedMessage = typeof message === 'function' ? message() : message;
  failures.push(resolvedMessage);
  throw new Error(resolvedMessage);
}

function getButtonByName(container: Element, name: string, message: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const button = buttons.find((candidate) => normalizeText(candidate.textContent).includes(name));
  if (button === undefined) {
    failures.push(message);
    throw new Error(message);
  }
  return button;
}

function assertData(element: HTMLElement, key: string, expected: string, message: string) {
  const actual = element.dataset[key];
  if (actual !== expected) failures.push(`${message} Expected ${expected}, got ${actual ?? '<missing>'}.`);
}

function assertVisibleText(container: Element, text: string, message: string) {
  if (!normalizeText(container.textContent).includes(text)) failures.push(message);
}

function assertNoBase64PreviewPayload(container: Element) {
  const visibleText = normalizeText(container.textContent);
  if (visibleText.includes('data:image/jpeg;base64,')) {
    failures.push('rendered agent preview exposed a raw JPEG data URL in visible text.');
  }

  const accessibleValues = Array.from(
    container.querySelectorAll<HTMLElement>('[aria-label],[aria-labelledby],[aria-describedby],[title],[alt]'),
  ).flatMap((element) => [
    element.getAttribute('aria-label'),
    element.getAttribute('aria-labelledby'),
    element.getAttribute('aria-describedby'),
    element.getAttribute('title'),
    element.getAttribute('alt'),
  ]);
  if (accessibleValues.some((value) => (value ?? '').includes('data:image/jpeg;base64,'))) {
    failures.push('rendered agent preview exposed a raw JPEG data URL in accessibility-visible content.');
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
