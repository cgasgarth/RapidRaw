import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { AgentPanel, resolveAgentReviewWorkspaceState } from '../../../src/components/panel/right/ai/AgentPanel';
import { type AppSettings, type SelectedImage, Theme } from '../../../src/components/ui/AppProperties';
import {
  ExportColorProfile,
  type ExportPreset,
  ExportRenderingIntent,
  WatermarkAnchor,
} from '../../../src/components/ui/ExportImportProperties';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  agentSelectedImageLiveSessionAuditStoreSchema,
  buildAgentSelectedImageLiveSessionAuditExportReceipt,
  preflightAgentSelectedImageLiveSessionAuditReplay,
} from '../../../src/utils/agent/session/agentSelectedImageLiveSession';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

const selectedImage: SelectedImage = {
  exif: { ISO: 200 },
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: 'blob:agent-review-original',
  path: '/photos/agent-review-workspace.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4500,
};

const exportPreset: ExportPreset = {
  colorProfile: ExportColorProfile.Srgb,
  dontEnlarge: true,
  enableResize: true,
  enableWatermark: false,
  fileFormat: 'jpeg',
  filenameTemplate: '{original_filename}-agent',
  id: 'agent-workspace-jpeg',
  jpegQuality: 86,
  keepMetadata: true,
  name: 'Agent workspace JPEG',
  preserveTimestamps: true,
  renderingIntent: ExportRenderingIntent.RelativeColorimetric,
  resizeMode: 'longEdge',
  resizeValue: 1536,
  stripGps: false,
  watermarkAnchor: WatermarkAnchor.BottomRight,
  watermarkOpacity: 50,
  watermarkPath: null,
  watermarkScale: 20,
  watermarkSpacing: 2,
};

const appSettings: AppSettings = {
  exportPresets: [exportPreset],
  lastRootPath: null,
  theme: Theme.Dark,
};

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  globalThis.localStorage?.clear();
  resetEditorStore();
  useSettingsStore.setState({ appSettings: null });
});

describe('agent panel preview-review workspace', () => {
  test('resolves stable review states for no-selection, preview, approval, applied, blocked, and audit', () => {
    expect(
      resolveAgentReviewWorkspaceState({
        hasAppliedEdit: false,
        hasPreviewReceipt: false,
        selectedImage: null,
      }),
    ).toMatchObject({
      applied: false,
      'approval-required': false,
      'audit-persisted': false,
      blocked: true,
      'dry-run-ready': false,
      'no-selection': true,
      'preview-ready': false,
    });

    expect(
      resolveAgentReviewWorkspaceState({
        hasAppliedEdit: true,
        hasPreviewReceipt: true,
        selectedImage,
      }),
    ).toMatchObject({
      applied: true,
      'approval-required': true,
      'audit-persisted': true,
      blocked: false,
      'dry-run-ready': true,
      'no-selection': false,
      'preview-ready': true,
    });
  });

  test('renders dense first-screen evidence before the lower transcript in a selected-image rail', async () => {
    resetEditorStore();
    useEditorStore.getState().setEditor({
      finalPreviewUrl: 'data:image/jpeg;base64,BBBB',
      historyIndex: 1,
      selectedImage,
    });

    const { container } = await renderAgentPanel();

    expect(required(container, 'agent-review-workspace').className).toContain('space-y-2');
    expect(required(container, 'agent-review-workspace-header').textContent).toContain('Agent Review');
    expect(required(container, 'agent-preview-receipt-card').dataset.previewReady).toBe('true');
    expect(required(container, 'agent-review-state-no-selection').dataset.state).toBe('inactive');
    expect(required(container, 'agent-review-state-preview-ready').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-dry-run-ready').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-approval-required').dataset.state).toBe('inactive');
    expect(required(container, 'agent-review-state-applied').dataset.state).toBe('inactive');
    expect(required(container, 'agent-review-state-audit-persisted').dataset.state).toBe('inactive');
    expect(required(container, 'agent-tool-readiness-chip-row').textContent).toContain('Dry-runs');
    expect(required(container, 'agent-reviewed-command-composer').dataset.commandId).toBe('highlight_recovery');
    expect(required(container, 'agent-reviewed-command-diff-highlights').dataset.delta).toBe('-18');
    expect(required(container, 'agent-reviewed-command-diff-whites').dataset.delta).toBe('-6');
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.approvalRequired).toBe('false');
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe('idle');
    expect((required(container, 'agent-review-control-dry-run') as HTMLButtonElement).disabled).toBe(false);
    expect((required(container, 'agent-review-control-apply') as HTMLButtonElement).disabled).toBe(true);
    expect((required(container, 'agent-review-control-export') as HTMLButtonElement).disabled).toBe(true);
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(true);
    expect(required(container, 'agent-review-live-activity-timeline').textContent).toContain('Current image context');

    const workspace = required(container, 'agent-review-workspace');
    const transcript = required(container, 'agent-review-transcript-lower');
    expect([...workspace.children].indexOf(transcript)).toBeGreaterThan(4);
  });

  test('keeps blocked no-selection state visible with controls disabled', async () => {
    const { container } = await renderAgentPanel();

    expect(required(container, 'agent-right-rail-panel').dataset.reviewWorkspaceState).toBe('blocked');
    expect(required(container, 'agent-review-state-no-selection').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-blocked').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-preview-ready').dataset.state).toBe('inactive');
    expect((required(container, 'agent-review-control-dry-run') as HTMLButtonElement).disabled).toBe(true);
    expect((required(container, 'agent-review-control-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(required(container, 'agent-preview-receipt-card').dataset.previewReady).toBe('false');
    expect(required(container, 'agent-stale-recovery-card').dataset.staleReason).toBe('missing_selection');
    expect((required(container, 'agent-review-control-refresh-dry-run') as HTMLButtonElement).disabled).toBe(true);
  });

  test('wires the top dry-run control to a selected-image live-session receipt', async () => {
    resetEditorStore();
    useSettingsStore.getState().setAppSettings(appSettings);
    useSettingsStore.setState({ appSettings });
    useEditorStore.getState().setEditor({
      finalPreviewUrl: 'data:image/jpeg;base64,BBBB',
      selectedImage,
    });

    const { container } = await renderAgentPanel();

    await clickAndFlush(container, 'agent-reviewed-command-option-shadow_lift');

    expect(required(container, 'agent-reviewed-command-composer').dataset.commandId).toBe('shadow_lift');
    expect(required(container, 'agent-reviewed-command-diff-shadows').dataset.delta).toBe('18');
    expect(required(container, 'agent-reviewed-command-diff-blacks').dataset.delta).toBe('4');

    await act(async () => {
      (required(container, 'agent-review-control-dry-run') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe(
      'approval_required',
    );
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionToolName).toBe(
      'rawengine.agent.adjustments.dry_run',
    );
    const receipt = required(container, 'agent-before-after-preview-receipt');
    expect(receipt.dataset.receiptKind).toBe('dry_run');
    expect(receipt.dataset.receiptState).toBe('current');
    expect(receipt.dataset.receiptRequestId).toMatch(/^agent-workspace-selected-image-\d+-dry-run$/u);
    expect(receipt.dataset.toolName).toBe('rawengine.agent.adjustments.dry_run');
    expect(receipt.dataset.beforeGraphRevision).toBe('history_0');
    expect(receipt.dataset.afterGraphRevision).toContain('basic_tone');
    expect(receipt.dataset.beforeRenderHash).toMatch(/^render:/u);
    expect(receipt.dataset.afterRenderHash).toMatch(/^sha256:agent-adjustments:/u);
    expect(required(container, 'agent-before-after-preview-receipt-before').dataset.previewRef).toBe(
      'data:image/jpeg;base64,BBBB',
    );
    expect(required(container, 'agent-before-after-preview-receipt-after').dataset.previewRef).toBe('');
    expect(required(container, 'agent-review-state-approval-required').dataset.state).toBe('active');
    expect((required(container, 'agent-review-control-apply') as HTMLButtonElement).disabled).toBe(false);
  });

  test('applies and rolls back through the top selected-image live-session controls', async () => {
    resetEditorStore();
    useEditorStore.getState().setEditor({
      finalPreviewUrl: 'data:image/jpeg;base64,BBBB',
      selectedImage,
    });

    const { container } = await renderAgentPanel();

    await clickAndFlush(container, 'agent-reviewed-command-option-gentle_exposure_lift');
    await clickAndFlush(container, 'agent-review-control-dry-run');
    await clickAndFlush(container, 'agent-review-control-apply');

    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe('applied');
    expect(required(container, 'agent-review-state-audit-persisted').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-applied').dataset.state).toBe('active');
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.25);
    expect(readLatestAuditCommandId()).toBe('gentle_exposure_lift');
    const applyReceipt = required(container, 'agent-before-after-preview-receipt');
    expect(applyReceipt.dataset.receiptKind).toBe('apply');
    expect(applyReceipt.dataset.receiptState).toBe('current');
    expect(applyReceipt.dataset.toolName).toBe('rawengine.agent.adjustments.apply');
    expect(applyReceipt.dataset.receiptRequestId).toMatch(/^agent-workspace-selected-image-\d+-apply$/u);
    expect(applyReceipt.dataset.beforeGraphRevision).toBe('history_0');
    expect(applyReceipt.dataset.afterGraphRevision).toBe('history_1');
    expect(applyReceipt.dataset.beforeRenderHash).toBeTruthy();
    expect(applyReceipt.dataset.afterRenderHash).toBeTruthy();
    expect(applyReceipt.dataset.beforeRenderHash).not.toBe(applyReceipt.dataset.afterRenderHash);
    expect(required(container, 'agent-before-after-preview-receipt-before').dataset.previewRef).toBe(
      'data:image/jpeg;base64,BBBB',
    );
    expect(required(container, 'agent-before-after-preview-receipt-after').dataset.previewRef).toBeTruthy();
    expect(required(container, 'agent-before-after-preview-receipt-after').dataset.previewRef).not.toBe(
      required(container, 'agent-before-after-preview-receipt-before').dataset.previewRef,
    );
    await act(async () => {
      useSettingsStore.setState({ appSettings });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((required(container, 'agent-review-control-export') as HTMLButtonElement).disabled).toBe(false);
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(false);
    expect(required(container, 'agent-review-live-activity-timeline').textContent).toContain('history_1');

    await clickAndFlush(container, 'agent-review-control-export');

    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe('exported');
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionToolName).toBe(
      'rawengine.agent.audit.export',
    );
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(false);

    await clickAndFlush(container, 'agent-review-control-rollback');

    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe('rolled_back');
    expect(required(container, 'agent-before-after-preview-receipt').dataset.receiptState).toBe('stale');
    expect(required(container, 'agent-before-after-preview-receipt').dataset.staleReason).toBe(
      'graph_revision_changed',
    );
    expect(required(container, 'agent-review-live-activity-timeline').dataset).toBeDefined();
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });

  test('recovers a stale graph from the current edit and preserves block, apply, and rollback proof', async () => {
    resetEditorStore();
    useEditorStore.getState().setEditor({
      finalPreviewUrl: 'data:image/jpeg;base64,BBBB',
      selectedImage,
    });

    const { container } = await renderAgentPanel();
    await clickAndFlush(container, 'agent-reviewed-command-option-gentle_exposure_lift');
    await clickAndFlush(container, 'agent-review-control-dry-run');

    await act(async () => {
      const current = useEditorStore.getState().adjustments;
      const outsideAgentEdit = { ...current, contrast: 7 };
      useEditorStore.getState().setEditor({ adjustments: outsideAgentEdit });
      useEditorStore.getState().pushHistory(outsideAgentEdit);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useEditorStore.getState().historyIndex).toBe(1);

    await clickAndFlush(container, 'agent-review-control-apply');

    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe('blocked');
    const recoveryCard = required(container, 'agent-stale-recovery-card');
    expect(recoveryCard.dataset.staleReason).toBe('graph_revision_changed');
    expect(recoveryCard.dataset.currentGraphRevision).toBe('history_1');
    expect(recoveryCard.dataset.currentRecipeHash).toMatch(/^recipe:/u);
    expect((required(container, 'agent-review-control-refresh-dry-run') as HTMLButtonElement).disabled).toBe(false);
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(true);
    expect(useEditorStore.getState().adjustments.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);

    await clickAndFlush(container, 'agent-review-control-refresh-dry-run');

    expect(container.querySelector('[data-testid="agent-stale-recovery-card"]')).toBeNull();
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe(
      'approval_required',
    );
    const recoveryPreview = required(container, 'agent-before-after-preview-receipt');
    expect(recoveryPreview.dataset.beforeGraphRevision).toBe('history_1');
    const recoveryBeforePreviewHash = recoveryPreview.dataset.beforeRenderHash;
    expect(recoveryBeforePreviewHash).toBeTruthy();
    const recoveryActivity = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="agent-review-live-activity-"]'),
    ).find((entry) => entry.dataset.recoveryRequestId?.length);
    expect(recoveryActivity?.dataset.currentGraphRevision).toBe('history_1');
    expect(recoveryActivity?.dataset.currentRecipeHash).toBe(recoveryCard.dataset.currentRecipeHash);
    expect(recoveryActivity?.dataset.staleReason).toBe('graph_revision_changed');

    await clickAndFlush(container, 'agent-review-control-apply');

    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.liveActionStatus).toBe('applied');
    expect(useEditorStore.getState().historyIndex).toBe(2);
    expect(useEditorStore.getState().adjustments.contrast).toBe(7);
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.25);
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(false);

    const appliedAdjustments = useEditorStore.getState().adjustments;
    await act(async () => {
      useEditorStore.getState().setEditor({ adjustments: { ...appliedAdjustments, saturation: 4 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(true);
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.rollbackBlockedReason).toBe(
      'stale_recipe_hash',
    );
    await act(async () => {
      useEditorStore.getState().setEditor({ adjustments: appliedAdjustments });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.rollbackReadiness).toBe('safe');
    expect((required(container, 'agent-review-control-rollback') as HTMLButtonElement).disabled).toBe(false);

    const appliedAudit = readLatestAuditRecord();
    expect(appliedAudit.receipt.recoveries).toHaveLength(1);
    expect(appliedAudit.receipt.recoveries?.[0]).toMatchObject({
      currentGraphRevision: 'history_1',
      recoveredGraphRevision: 'history_1',
      staleReason: 'graph_revision_changed',
      status: 'applied',
    });
    expect(appliedAudit.transcript.some((entry) => entry.kind === 'recovery')).toBe(true);
    expect(
      appliedAudit.transcript.some((entry) => entry.kind === 'apply_decision' && entry.status === 'rejected'),
    ).toBe(true);
    expect(
      appliedAudit.transcript.some((entry) => entry.kind === 'apply_decision' && entry.status === 'succeeded'),
    ).toBe(true);

    await clickAndFlush(container, 'agent-review-control-rollback');

    expect(useEditorStore.getState().historyIndex).toBe(1);
    expect(useEditorStore.getState().adjustments.contrast).toBe(7);
    expect(useEditorStore.getState().adjustments.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
    const rollbackAudit = readLatestAuditRecord();
    expect(rollbackAudit.receipt.state).toBe('rolled_back');
    expect(rollbackAudit.receipt.rollbackReceiptGraphRevision).toBe('history_1');
    expect(rollbackAudit.receipt.rollbackReceiptRecipeHash).toBe(rollbackAudit.receipt.initialRecipeHash);
    expect(rollbackAudit.receipt.rollbackReceiptPreviewHash).toBe(recoveryBeforePreviewHash);
    expect(rollbackAudit.receipt.recoveries?.[0]?.status).toBe('rolled_back');
    expect(rollbackAudit.auditEvents.some((event) => event.state === 'failed')).toBe(true);
    expect(rollbackAudit.auditEvents.some((event) => event.state === 'rolled_back')).toBe(true);
    const exportReceipt = buildAgentSelectedImageLiveSessionAuditExportReceipt({
      audit: rollbackAudit,
      exportedAt: '2026-07-09T12:00:00.000Z',
      replayPreflight: preflightAgentSelectedImageLiveSessionAuditReplay(rollbackAudit),
    });
    const recovery = rollbackAudit.receipt.recoveries?.[0];
    if (recovery === undefined) throw new Error('Expected recovery receipt in rollback audit.');
    expect(exportReceipt.rollbackState.status).toBe('restored');
    expect(exportReceipt.previewHashes.rollback).toBe(recoveryBeforePreviewHash);
    expect(exportReceipt.auditRecord.transcript.some((entry) => entry.kind === 'recovery')).toBe(true);
    expect(exportReceipt.requestIds).toContain(recovery.blockedRequestId);
    expect(exportReceipt.requestIds).toContain(recovery.recoveryRequestId);
  });
});

async function renderAgentPanel() {
  if (!globalThis.window) {
    const window = new Window();
    Object.assign(globalThis, {
      document: window.document,
      HTMLButtonElement: window.HTMLButtonElement,
      HTMLDivElement: window.HTMLDivElement,
      HTMLElement: window.HTMLElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      localStorage: window.localStorage,
      window,
    });
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  renderedRoot = { container, root };

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n: await createTestI18n() }, createElement(AgentPanel)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return { container, root };
}

async function clickAndFlush(container: HTMLElement, testId: string) {
  await act(async () => {
    (required(container, testId) as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: en } },
  });
  return instance;
}

function required(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (element === null) throw new Error(`Expected ${testId} to render.`);
  return element;
}

function resetEditorStore() {
  useEditorStore.setState({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: null,
    history: [INITIAL_ADJUSTMENTS],
    historyCheckpoints: [],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: null,
    uncroppedAdjustedPreviewUrl: null,
  });
}

function readLatestAuditCommandId() {
  return readLatestAuditRecord().receipt.reviewedCommand?.commandId;
}

function readLatestAuditRecord() {
  if (typeof globalThis.localStorage === 'undefined') throw new Error('Expected localStorage.');
  const storageKeys = Array.from({ length: globalThis.localStorage.length }, (_value, index) =>
    globalThis.localStorage.key(index),
  ).filter((key): key is string => key !== null);
  const key = storageKeys.find((candidate) =>
    candidate.startsWith('rawengine.agent.selectedImageLiveSessionAudit.v1.'),
  );
  if (key === undefined) throw new Error('Expected selected-image audit storage.');
  const value = globalThis.localStorage.getItem(key);
  const parsedJson: unknown = value === null ? null : JSON.parse(value);
  const store = agentSelectedImageLiveSessionAuditStoreSchema.parse(parsedJson);
  const latestRecord = store.records.at(-1);
  if (latestRecord === undefined) throw new Error('Expected selected-image audit receipt.');
  return latestRecord;
}
