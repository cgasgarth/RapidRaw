#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { chromium, type Locator, type Page } from '@playwright/test';
import { editDocumentV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { allocateFreeTcpPort, parseTcpPort } from '../../../scripts/lib/dev-server-port';
import { waitForPageCondition } from '../../../scripts/lib/playwright-waits';
import { installBrowserProofNetworkBoundary } from '../../../scripts/qa/browser-network-boundary';
import { agentSelectedImageLiveSessionAuditExportReceiptSchema } from '../../../src/schemas/agent/agentSelectedImageAuditExportSchemas';
import { Invokes } from '../../../src/tauri/commands';
import { createDefaultEditDocumentV2, EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES } from '../../../src/utils/editDocumentV2';
import { DISPLAY_TARGET_CHANGED_EVENT } from '../../../src/utils/tauriEventNames';

const host = '127.0.0.1';
const portOverride =
  process.env.BROWSER_TAURI_HARNESS_PORT === undefined
    ? undefined
    : parseTcpPort(process.env.BROWSER_TAURI_HARNESS_PORT, 'BROWSER_TAURI_HARNESS_PORT');
const port = await allocateFreeTcpPort(host, portOverride);
const baseUrl = `http://${host}:${port}`;
const runAgentAuditE2e = process.env.RAWENGINE_AGENT_AUDIT_E2E === '1';
const browserScenario = process.env.RAWENGINE_BROWSER_SCENARIO ?? 'full';
const viewport = { height: 720, width: 1280 };
const boundsReportPath = resolve(
  'private-artifacts/validation/preview-bounds/browser-tauri-harness-bounds-report.json',
);
const failureScreenshotPath = resolve('private-artifacts/validation/preview-bounds/browser-tauri-harness-failure.png');

interface ElementBoundsSnapshot {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface BoundsSample {
  elements: Record<string, ElementBoundsSnapshot | null>;
  failures: string[];
  label: string;
  viewport: typeof viewport;
}

interface BoundsReport {
  generatedAt: string;
  samples: BoundsSample[];
  scenario: string;
  status: 'failed' | 'passed';
  viewport: typeof viewport;
}

const boundsSamples: BoundsSample[] = [];

async function verifyPreviewUrlLifetime(page: Page): Promise<void> {
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.getByTestId('adjustments-inspector').waitFor({ timeout: 10_000 });
  const exposureValue = page.getByTestId('basic-control-exposure-value');
  const applyBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push(
      { color: [200, 40, 40], delayMs: 20 },
      { color: [40, 40, 200], delayMs: 20 },
      { color: [40, 200, 40], delayMs: 20 },
    );
  });
  for (const [index, exposure] of ['0.15', '0.35', '0.55'].entries()) {
    await exposureValue.click();
    const input = page.getByTestId('basic-control-exposure-input');
    await input.fill(exposure);
    await input.press('Enter');
    await page.waitForFunction(
      (expected) =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
          .length ?? 0) >= expected,
      applyBaseline + index + 1,
      { timeout: 10_000 },
    );
  }
  await page.waitForTimeout(800);

  const overflow = page.getByTestId('editor-command-overflow-trigger');
  await overflow.click();
  const splitCompare = page.getByRole('menuitemcheckbox', { name: /Compare split wipe/u });
  await splitCompare.click();
  await waitForPageCondition(
    page,
    () => document.querySelectorAll('[data-preview-source-identity^="original:"]').length > 0,
    { timeout: 10_000 },
  );
  await page.getByTestId('viewer-footer-zoom-select').selectOption('1');
  await page.waitForTimeout(500);

  const proof = await page.evaluate(async () => {
    const audit = Reflect.get(window, '__RAWENGINE_PREVIEW_URL_AUDIT__') as
      | { created: string[]; imageErrors: string[]; revoked: string[] }
      | undefined;
    if (!audit) throw new Error('Preview URL audit was not installed.');
    const visibleHrefs = [...document.querySelectorAll<SVGImageElement>('[data-preview-layer-id]')]
      .filter((layer) => Number.parseFloat(getComputedStyle(layer).opacity) > 0.99)
      .map((layer) => layer.getAttribute('href'))
      .filter((href): href is string => href !== null);
    const decodeFailures: string[] = [];
    for (const href of visibleHrefs) {
      const image = new Image();
      image.src = href;
      try {
        await image.decode();
      } catch {
        decodeFailures.push(href);
      }
    }
    return { ...audit, decodeFailures, visibleHrefs };
  });
  if (proof.created.length < 3) {
    throw new Error(`Preview URL proof created too few edited artifacts: ${JSON.stringify(proof)}.`);
  }
  if (proof.revoked.length === 0) {
    throw new Error(`Preview URL proof did not retire any replaced artifacts: ${JSON.stringify(proof)}.`);
  }
  const revokeCounts = Map.groupBy(proof.revoked, (url) => url);
  const duplicateRevokes = [...revokeCounts].filter(([, urls]) => urls.length > 1).map(([url]) => url);
  if (duplicateRevokes.length > 0) {
    throw new Error(`Preview URLs were revoked more than once: ${duplicateRevokes.join(', ')}.`);
  }
  const revokedVisible = proof.visibleHrefs.filter((url) => proof.revoked.includes(url));
  if (revokedVisible.length > 0 || proof.decodeFailures.length > 0 || proof.imageErrors.length > 0) {
    throw new Error(`Visible preview ownership broke: ${JSON.stringify(proof)}.`);
  }

  await overflow.click();
  await splitCompare.click();
  await waitForPageCondition(
    page,
    () => document.querySelectorAll('[data-preview-source-identity^="original:"]').length === 0,
    { timeout: 10_000 },
  );
}

async function verifySchemaOwnedTauriTransport(page: Page): Promise<void> {
  const editDocumentV2 = createDefaultEditDocumentV2();
  editDocumentV2.extensions['browserHarnessTransport'] = {
    omittedByJsonTransport: undefined,
    schemaVersion: 1,
  };
  const proof = await page.evaluate(
    async ({ checkStatusCommand, documentToPersist, loadMetadataCommand, saveMetadataCommand }) => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (invoke === undefined) throw new Error('Browser Tauri transport is unavailable.');
      const status = await invoke(checkStatusCommand);
      const path = '/tmp/rawengine-browser-harness/schema-boundary.ARW';
      const receipt = await invoke(saveMetadataCommand, {
        editDocumentV2: documentToPersist,
        path,
        transaction: null,
      });
      const metadata = await invoke(loadMetadataCommand, { path });
      const persistedDocument =
        typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'editDocumentV2') : null;
      const extensions =
        typeof persistedDocument === 'object' && persistedDocument !== null
          ? Reflect.get(persistedDocument, 'extensions')
          : null;
      const transport =
        typeof extensions === 'object' && extensions !== null
          ? Reflect.get(extensions, 'browserHarnessTransport')
          : null;
      return {
        artifactSchemaVersion:
          typeof transport === 'object' && transport !== null ? Reflect.get(transport, 'schemaVersion') : null,
        hasOmittedProperty:
          typeof transport === 'object' && transport !== null
            ? Object.hasOwn(transport, 'omittedByJsonTransport')
            : true,
        receiptKeys: typeof receipt === 'object' && receipt !== null ? Object.keys(receipt).sort() : [],
        status,
      };
    },
    {
      checkStatusCommand: Invokes.CheckAIConnectorStatus,
      documentToPersist: editDocumentV2,
      loadMetadataCommand: Invokes.LoadMetadata,
      saveMetadataCommand: Invokes.SaveMetadataAndUpdateThumbnail,
    },
  );
  if (proof.status !== null) throw new Error('AI connector status command did not preserve its native unit response.');
  if (proof.hasOmittedProperty || proof.artifactSchemaVersion !== 1) {
    throw new Error(`Persistence receipt did not preserve native JSON transport semantics: ${JSON.stringify(proof)}`);
  }
  if (
    JSON.stringify(proof.receiptKeys) !==
    JSON.stringify(['catalogRevision', 'imageId', 'path', 'renderFingerprint', 'sidecarRevision', 'thumbnailRevision'])
  ) {
    throw new Error(`Persistence receipt diverged from the strict native shape: ${JSON.stringify(proof)}`);
  }
}

async function verifyEditorRenderAuthorityBoundary(page: Page): Promise<void> {
  const proof = await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ `/src/${'store/useEditorStore.ts'}`);
    const state = module.useEditorStore.getState();
    const capture = (operation: () => void): string => {
      try {
        operation();
        return 'accepted';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const setEditorError = capture(() =>
      Reflect.apply(state.setEditor, undefined, [{ adjustments: structuredClone(state.adjustments) }]),
    );
    const setStateError = capture(() =>
      Reflect.apply(module.useEditorStore.setState, module.useEditorStore, [{ history: [...state.history] }]),
    );
    state.setEditor({ isWaveformVisible: true });
    const uiUpdateAccepted = module.useEditorStore.getState().isWaveformVisible;
    module.useEditorStore.getState().setEditor({ isWaveformVisible: false });
    return { setEditorError, setStateError, uiUpdateAccepted };
  });
  if (
    proof.setEditorError !== 'editor.setEditor.render_authority_forbidden:adjustments' ||
    proof.setStateError !== 'editor.setState.render_authority_forbidden:history' ||
    !proof.uiUpdateAccepted
  ) {
    throw new Error(`Editor render-authority browser boundary failed: ${JSON.stringify(proof)}`);
  }
}

async function verifyPreviewAnalyticsArtifactAuthority(page: Page): Promise<void> {
  const analyticsHeader = page.locator('[data-testid$="-analytics-header"]').first();
  await page.waitForFunction(() => {
    const header = document.querySelector('[data-testid$="-analytics-header"]');
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return (
      header?.getAttribute('data-analytics-state') === 'current' &&
      header.getAttribute('data-state') === 'histogram' &&
      calls.some(({ args, command }) => {
        const request = command === 'apply_adjustments' ? args?.['request'] : null;
        return (
          typeof request === 'object' &&
          request !== null &&
          Reflect.get(request, 'computeWaveform') === false &&
          typeof Reflect.get(request, 'previewOperationIdentity') === 'object'
        );
      })
    );
  });
  if ((await analyticsHeader.locator('[data-testid$="-analytics-header-histogram"]').count()) !== 1) {
    throw new Error('Closed advanced drawer did not publish one authoritative histogram.');
  }
  if ((await analyticsHeader.locator('[data-scope-mode]').count()) !== 0) {
    throw new Error('Advanced scope modes leaked into the default histogram surface.');
  }
  if ((await analyticsHeader.locator('[data-testid$="-analytics-header-metadata"]').textContent())?.trim() === '') {
    throw new Error('Histogram header omitted its compact photo metadata.');
  }
  const editStateBefore = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return { historyIndex: state.historyIndex, revision: state.adjustmentRevision };
  });
  const shadowClipping = analyticsHeader.locator('[data-testid$="-shadow-clipping-toggle"]');
  const clippingPressedBefore = await shadowClipping.getAttribute('aria-pressed');
  await shadowClipping.press('Enter');
  if ((await shadowClipping.getAttribute('aria-pressed')) === clippingPressedBefore) {
    throw new Error('Keyboard did not toggle the histogram clipping view state.');
  }
  await shadowClipping.click();
  const viewStateProof = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    const header = document.querySelector('[data-testid$="-analytics-header"]');
    const clipping = header?.querySelector<HTMLButtonElement>('[data-testid$="-shadow-clipping-toggle"]');
    return {
      histogramFreshness: header?.getAttribute('data-preview-histogram-freshness'),
      historyIndex: state.historyIndex,
      pressedAfterKeyboardAndPointer: clipping?.getAttribute('aria-pressed'),
      revision: state.adjustmentRevision,
      state: header?.getAttribute('data-state'),
    };
  });
  if (
    viewStateProof.histogramFreshness !== 'current' ||
    viewStateProof.historyIndex !== editStateBefore.historyIndex ||
    viewStateProof.pressedAfterKeyboardAndPointer !== clippingPressedBefore ||
    viewStateProof.revision !== editStateBefore.revision ||
    viewStateProof.state !== 'histogram'
  ) {
    throw new Error(`Default histogram interaction proof failed: ${JSON.stringify(viewStateProof)}`);
  }

  await page.locator('[data-testid$="-analytics-header-expand-toggle"]').first().click();
  await page.locator('[data-testid$="-analytics-header-recover-scopes"]').evaluateAll((buttons) => {
    const recover = buttons[0];
    if (recover instanceof HTMLButtonElement && !recover.disabled) recover.click();
  });
  await page.waitForFunction(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return calls.some(({ args, command }) => {
      const request = command === 'apply_adjustments' ? args?.['request'] : null;
      return (
        typeof request === 'object' &&
        request !== null &&
        Reflect.get(request, 'computeWaveform') === true &&
        typeof Reflect.get(request, 'previewOperationIdentity') === 'object'
      );
    });
  });

  const status = page.getByTestId('preview-scope-status');
  await status.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="preview-scope-status"]')?.getAttribute('data-preview-scope-ready') ===
      'true',
  );
  await page.waitForTimeout(250);
  let acceptedAt = await status.getAttribute('data-preview-scope-updated-at');
  if (!acceptedAt) throw new Error('Exact presented preview analytics did not publish scope status.');

  const completeProducts = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    const state = module.useEditorStore.getState();
    return {
      histogram: ['blue', 'green', 'luma', 'red'].every(
        (channel) => (state.histogram?.[channel as keyof typeof state.histogram]?.data.length ?? 0) > 0,
      ),
      luma: state.waveform?.luma ?? '',
      parade: state.waveform?.parade ?? '',
      rgb: state.waveform?.rgb ?? '',
      vectorscope: state.waveform?.vectorscope ?? '',
    };
  });
  if (
    !completeProducts.histogram ||
    [completeProducts.luma, completeProducts.rgb, completeProducts.parade, completeProducts.vectorscope].some(
      (url) => !url,
    )
  ) {
    throw new Error(
      `Accepted preview did not publish every nonempty scope product: ${JSON.stringify(completeProducts)}`,
    );
  }

  for (const mode of ['luma', 'rgb', 'parade', 'vectorscope', 'histogram']) {
    await page.locator(`[data-testid$="-analytics-header-mode-${mode}"]`).first().click();
    if ((await status.getAttribute('data-preview-scope-ready')) !== 'true') {
      throw new Error(`Scope mode ${mode} lost the accepted ready receipt.`);
    }
  }

  await page.getByTestId('viewer-footer-zoom-select').selectOption('2');
  await page.waitForFunction((previous) => {
    const status = document.querySelector('[data-testid="preview-scope-status"]');
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return (
      status?.getAttribute('data-preview-scope-ready') === 'true' &&
      status.getAttribute('data-preview-scope-updated-at') !== previous &&
      calls.some(
        ({ args, command }) => command === 'apply_adjustments' && Reflect.get(args?.['request'] ?? {}, 'roi') !== null,
      )
    );
  }, acceptedAt);
  if ((await analyticsHeader.getAttribute('data-preview-scope-freshness')) !== 'current') {
    throw new Error('Zoom ROI analytics did not converge on the displayed preview identity.');
  }
  const zoomAcceptedAt = await status.getAttribute('data-preview-scope-updated-at');
  await page.getByTestId('viewer-footer-zoom-select').selectOption('fit');
  await page.waitForFunction(
    (previous) =>
      document.querySelector('[data-testid="preview-scope-status"]')?.getAttribute('data-preview-scope-updated-at') !==
      previous,
    zoomAcceptedAt,
  );
  acceptedAt = await status.getAttribute('data-preview-scope-updated-at');
  if (!acceptedAt) throw new Error('Fit reset did not publish current scope status.');

  await page.evaluate(() => {
    const harness = window.__RAWENGINE_BROWSER_TAURI_HARNESS__;
    const request = harness?.calls
      .filter(
        ({ args, command }) =>
          command === 'apply_adjustments' && Reflect.get(args?.['request'] ?? {}, 'computeWaveform') === true,
      )
      .at(-1)?.args?.['request'];
    if (!harness || typeof request !== 'object' || request === null)
      throw new Error('Missing preview request authority.');
    const current = structuredClone(Reflect.get(request, 'previewOperationIdentity')) as {
      generation: number;
      operationId: number;
      session: { imageSessionId: number; sourceImagePath: string };
    };
    current.generation += 1000;
    current.operationId += 1000;
    harness.emitEvent('analytics-result', {
      frameId: {
        graphRevision: current.operationId,
        imageSession: current.session.imageSessionId,
        previewGeneration: current.generation,
      },
      gamut: null,
      histogram: { blue: [9], green: [9], luma: [9], red: [9] },
      path: current.session.sourceImagePath,
      previewOperationIdentity: current,
      requestedProducts: 1,
      scopes: null,
      spatial: null,
      timing: { finishingMs: 0, fullImageConversions: 0, samplingMs: 0, sourcePixelsRead: 1 },
    });
  });
  await page.waitForTimeout(150);
  const staleMutation = await page.evaluate(async () => {
    const module = await import('/src/store/useEditorStore.ts');
    return module.useEditorStore.getState().histogram?.luma?.data.every((value) => value === 9) ?? false;
  });
  if (staleMutation) {
    throw new Error('A non-presented preview operation replaced exact-current scope output.');
  }

  const displayInvalidationBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );
  await page.evaluate((eventName) => {
    const payload = {
      deviceGeneration: 10_000,
      displayResourceGeneration: 10_000,
      target: {
        colorSpace: 'display_encoded_srgb',
        displayId: 1,
        profileSha256: 'sha256:browser-harness-display',
        scaleFactorBits: 4_607_182_418_800_017_400,
      },
    };
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.emitEvent(eventName, payload);
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.emitEvent(eventName, payload);
  }, DISPLAY_TARGET_CHANGED_EVENT);
  await page.waitForFunction(
    (baseline) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0) >=
      baseline + 1,
    displayInvalidationBaseline,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(250);
  const displayInvalidationCount = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );
  if (displayInvalidationCount !== displayInvalidationBaseline + 1) {
    throw new Error(
      `Duplicate display invalidation scheduled ${String(displayInvalidationCount - displayInvalidationBaseline)} previews.`,
    );
  }
}

async function verifyCompareDividerController(page: Page): Promise<void> {
  const divider = page.getByTestId('editor-compare-split-divider');
  const surface = page.getByTestId('image-canvas');
  const box = await divider.boundingBox();
  if (box === null) throw new Error('Compare divider did not expose browser geometry.');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 80, center.y);
  await page.mouse.up();
  const mouseValue = Number(await divider.getAttribute('aria-valuenow'));
  if (!Number.isFinite(mouseValue) || mouseValue >= 50) {
    throw new Error(`Mouse compare-divider command did not move left: ${String(mouseValue)}.`);
  }

  await divider.press('Shift+ArrowRight');
  const keyboardValue = Number(await divider.getAttribute('aria-valuenow'));
  if (keyboardValue !== mouseValue + 10) {
    throw new Error(`Keyboard compare-divider command was not semantic: ${String(keyboardValue)}.`);
  }
  await divider.dblclick();
  const resetValue = Number(await divider.getAttribute('aria-valuenow'));
  if (resetValue !== 50) {
    throw new Error(`Double-click did not dispatch the semantic compare-divider reset: ${String(resetValue)}.`);
  }

  const cdp = await page.context().newCDPSession(page);
  const touchStart = async (x: number, y: number): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ force: 1, id: 11, radiusX: 1, radiusY: 1, x, y }],
      type: 'touchStart',
    });
  };
  const touchMove = async (x: number, y: number): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ force: 1, id: 11, radiusX: 1, radiusY: 1, x, y }],
      type: 'touchMove',
    });
  };
  const touchEnd = async (): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  };

  const touchBox = await divider.boundingBox();
  if (touchBox === null) throw new Error('Compare divider disappeared before touch proof.');
  const touchCenter = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
  await touchStart(touchCenter.x, touchCenter.y);
  await touchMove(touchCenter.x + 60, touchCenter.y);
  const touchValue = Number(await divider.getAttribute('aria-valuenow'));
  if (!Number.isFinite(touchValue) || touchValue <= keyboardValue) {
    throw new Error(`Touch compare-divider command did not move right: ${String(touchValue)}.`);
  }
  const capturedPointerId = await surface.evaluate((element) => {
    for (let pointerId = 1; pointerId <= 32; pointerId += 1) {
      if (element.hasPointerCapture(pointerId)) return pointerId;
    }
    return null;
  });
  if (capturedPointerId === null) throw new Error('Canonical viewer router did not capture the touch pointer.');
  await surface.evaluate((element, pointerId) => element.releasePointerCapture(pointerId), capturedPointerId);
  await touchMove(touchCenter.x + 120, touchCenter.y);
  if (Number(await divider.getAttribute('aria-valuenow')) !== touchValue) {
    throw new Error('Compare divider continued mutating after lost pointer capture.');
  }
  await touchEnd();

  const sessionBox = await divider.boundingBox();
  const sessionBefore = await divider.getAttribute('data-compare-divider-session');
  if (sessionBox === null || sessionBefore === null) throw new Error('Compare divider session proof could not start.');
  const sessionCenter = { x: sessionBox.x + sessionBox.width / 2, y: sessionBox.y + sessionBox.height / 2 };
  await touchStart(sessionCenter.x, sessionCenter.y);
  await page.setViewportSize({ height: viewport.height, width: viewport.width - 20 });
  await page.waitForFunction(
    (previous) =>
      document
        .querySelector('[data-testid="editor-compare-split-divider"]')
        ?.getAttribute('data-compare-divider-session') !== previous,
    sessionBefore,
  );
  const invalidatedValue = Number(await divider.getAttribute('aria-valuenow'));
  await touchMove(sessionCenter.x - 100, sessionCenter.y);
  if (Number(await divider.getAttribute('aria-valuenow')) !== invalidatedValue) {
    throw new Error('A geometry-successor pointer mutated the invalidated compare-divider session.');
  }
  await touchEnd();
  await page.setViewportSize(viewport);
}

async function verifyInitialMaskDrawController(page: Page): Promise<void> {
  const imageCanvas = page.getByTestId('image-canvas');
  const toolStage = page.locator('[data-initial-mask-draw-stage="true"]');
  const readCallCount = (command: string) =>
    page.evaluate(
      (expectedCommand) =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === expectedCommand).length ??
        0,
      command,
    );
  const waitForStableGeometry = async (successorOf: string | null): Promise<void> => {
    await page.waitForFunction((previous) => {
      const current = document
        .querySelector('[data-testid="image-canvas"]')
        ?.getAttribute('data-initial-mask-draw-context-geometry');
      return current !== null && current !== previous;
    }, successorOf);
    await page.evaluate(async () => {
      const readGeometry = () =>
        document
          .querySelector('[data-testid="image-canvas"]')
          ?.getAttribute('data-initial-mask-draw-context-geometry') ?? null;
      let previous = readGeometry();
      let stableFrames = 0;
      for (let frame = 0; frame < 12 && stableFrames < 2; frame += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const current = readGeometry();
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
      if (stableFrames < 2) throw new Error('Initial mask geometry did not stabilize after viewport replacement.');
    });
  };
  const waitForGeometryIdle = async (): Promise<void> => {
    await page.evaluate(async () => {
      const readAuthority = () => {
        const canvas = document.querySelector('[data-testid="image-canvas"]');
        return `${canvas?.getAttribute('data-initial-mask-draw-context-geometry') ?? ''}|${canvas?.getAttribute('data-initial-mask-draw-context-revision') ?? ''}`;
      };
      let previous = readAuthority();
      let stableFrames = 0;
      for (let frame = 0; frame < 120 && stableFrames < 30; frame += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const current = readAuthority();
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
      if (stableFrames < 30)
        throw new Error('Initial mask geometry/source authority did not become idle before pointer input.');
    });
  };
  const waitForPersistedMask = async (type: 'linear' | 'radial', initial: boolean, label: string): Promise<void> => {
    try {
      await page.waitForFunction(
        ({ expectedInitial, expectedType }) => {
          const saves =
            window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
              ({ command }) => command === 'save_metadata_and_update_thumbnail',
            ) ?? [];
          const call = saves.at(-1);
          const document = call?.args?.['editDocumentV2'];
          if (typeof document !== 'object' || document === null || !('layers' in document)) return false;
          const layers = document.layers;
          if (typeof layers !== 'object' || layers === null || !('masks' in layers)) return false;
          const masks = layers.masks;
          if (!Array.isArray(masks)) return false;
          const subMask = masks
            .flatMap((mask) =>
              typeof mask === 'object' && mask !== null && 'subMasks' in mask && Array.isArray(mask.subMasks)
                ? mask.subMasks
                : [],
            )
            .find(
              (candidate) => typeof candidate === 'object' && candidate !== null && candidate['type'] === expectedType,
            );
          if (typeof subMask !== 'object' || subMask === null || !('parameters' in subMask)) return false;
          const parameters = subMask.parameters;
          if (typeof parameters !== 'object' || parameters === null) return false;
          return (
            call?.endedAtMs !== null &&
            'isInitialDraw' in parameters === expectedInitial &&
            (expectedInitial ||
              (expectedType === 'radial'
                ? typeof parameters['radiusX'] === 'number' && parameters['radiusX'] > 10
                : typeof parameters['range'] === 'number' && parameters['range'] > 10))
          );
        },
        { expectedInitial: initial, expectedType: type },
        { timeout: 10_000 },
      );
    } catch {
      const latest = await page.evaluate(() => {
        const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1);
        const document = call?.args?.['editDocumentV2'];
        const layers =
          typeof document === 'object' && document !== null && 'layers' in document ? document.layers : null;
        const masks =
          typeof layers === 'object' && layers !== null && 'masks' in layers && Array.isArray(layers.masks)
            ? layers.masks
            : [];
        return {
          ended: call?.endedAtMs !== null,
          masks: masks.flatMap((mask) =>
            typeof mask === 'object' && mask !== null && 'subMasks' in mask && Array.isArray(mask.subMasks)
              ? mask.subMasks.map((subMask) => ({
                  initial:
                    typeof subMask === 'object' &&
                    subMask !== null &&
                    'parameters' in subMask &&
                    typeof subMask.parameters === 'object' &&
                    subMask.parameters !== null
                      ? 'isInitialDraw' in subMask.parameters
                      : null,
                  type: typeof subMask === 'object' && subMask !== null && 'type' in subMask ? subMask.type : 'unknown',
                }))
              : [],
          ),
        };
      });
      throw new Error(`Timed out waiting for ${label} persistence: ${JSON.stringify(latest)}.`);
    }
  };
  const assertCurrentOverlayMatchesPersisted = async (label: string, overlayCallsBefore: number): Promise<void> => {
    try {
      await page.waitForFunction(
        ({ minimumOverlayCalls }) => {
          const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
          const overlays = calls.filter(({ command }) => command === 'generate_mask_overlay');
          if (overlays.length <= minimumOverlayCalls) return false;
          const canvas = document.querySelector('[data-testid="image-canvas"]');
          const workspace = document.querySelector('[data-testid="editor-workspace"]');
          const maskId = canvas?.getAttribute('data-initial-mask-draw-context-mask');
          const sourcePath = workspace?.getAttribute('data-selected-image-path');
          const imageSessionId = canvas?.getAttribute('data-initial-mask-draw-context-session');
          const identityText = canvas?.getAttribute('data-mask-overlay-identity');
          if (
            maskId === null ||
            maskId === undefined ||
            sourcePath === null ||
            sourcePath === undefined ||
            imageSessionId === null ||
            imageSessionId === undefined ||
            identityText === null ||
            identityText === undefined ||
            canvas?.getAttribute('data-mask-overlay-status') !== 'current'
          )
            return false;
          const latestSave = calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').at(-1);
          const masks = latestSave?.args?.['editDocumentV2']?.['layers']?.['masks'];
          const persisted = Array.isArray(masks)
            ? masks.flatMap((mask) => mask['subMasks']).find((subMask) => subMask['id'] === maskId)?.['parameters']
            : null;
          const native = overlays
            .at(-1)
            ?.args?.['maskDef']?.['subMasks']?.find((subMask: Record<string, unknown>) => subMask['id'] === maskId)?.[
            'parameters'
          ];
          const identity = JSON.parse(identityText) as {
            imageSessionId?: unknown;
            selectedImagePath?: unknown;
            triggerHash?: unknown;
          };
          if (
            typeof identity.triggerHash !== 'string' ||
            identity.imageSessionId !== imageSessionId ||
            identity.selectedImagePath !== sourcePath
          )
            return false;
          const trigger = JSON.parse(identity.triggerHash) as { subMasks?: Array<Record<string, unknown>> };
          const identified = trigger.subMasks?.find((subMask) => subMask['id'] === maskId)?.['parameters'];
          return (
            typeof persisted === 'object' &&
            persisted !== null &&
            JSON.stringify(persisted) === JSON.stringify(native) &&
            JSON.stringify(persisted) === JSON.stringify(identified)
          );
        },
        { minimumOverlayCalls: overlayCallsBefore },
        { timeout: 10_000 },
      );
    } catch {
      const diagnostics = await page.evaluate(() => {
        const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
        const canvas = document.querySelector('[data-testid="image-canvas"]');
        const latestOverlay = calls.filter(({ command }) => command === 'generate_mask_overlay').at(-1);
        return {
          active: canvas?.getAttribute('data-initial-mask-draw-context-active'),
          identity: canvas?.getAttribute('data-mask-overlay-identity'),
          mask: canvas?.getAttribute('data-initial-mask-draw-context-mask'),
          overlayCalls: calls.filter(({ command }) => command === 'generate_mask_overlay').length,
          overlayMask: latestOverlay?.args?.['maskDef'] ?? null,
          source: document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path'),
          status: canvas?.getAttribute('data-mask-overlay-status'),
          tool: canvas?.getAttribute('data-initial-mask-draw-context-tool'),
        };
      });
      throw new Error(
        `Timed out waiting for ${label} native overlay rollback/currentness: ${JSON.stringify(diagnostics)}.`,
      );
    }
  };
  await page.getByTestId('right-panel-switcher-button-masks').click();
  const createMask = async (type: 'linear' | 'radial'): Promise<void> => {
    const contextual = page.getByTestId(`mask-contextual-create-${type}`);
    if ((await contextual.count()) > 0 && (await contextual.isVisible())) {
      await contextual.click();
      return;
    }
    const grid = page.getByTestId(`mask-creation-${type}`);
    await grid.scrollIntoViewIfNeeded();
    await grid.click();
  };
  await createMask('radial');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-tool') ===
      'radial',
  );
  await waitForPersistedMask('radial', true, 'initial radial');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-active') ===
      'true',
  );
  await waitForGeometryIdle();

  const box = await toolStage.boundingBox();
  if (box === null) throw new Error('Initial mask proof could not resolve the Konva input surface.');
  const start = {
    x: box.x + box.width * 0.42,
    y: Math.min(box.y + box.height * 0.42, viewport.height - 48),
  };
  const end = { x: start.x + 110, y: start.y + 80 };

  const saveBeforeCancel = await readCallCount('save_metadata_and_update_thumbnail');
  const overlayBeforeCancel = await readCallCount('generate_mask_overlay');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if ((await imageCanvas.getAttribute('data-initial-mask-draw-active')) !== 'true') {
    throw new Error('Radial mouse gesture did not begin its declarative draft.');
  }
  const readContext = () =>
    page.evaluate(() => {
      const element = document.querySelector('[data-testid="image-canvas"]');
      const viewer = document.querySelector('[data-testid="editor-image-preview-panel"]');
      return {
        active: element?.getAttribute('data-initial-mask-draw-context-active'),
        controllerActive: element?.getAttribute('data-initial-mask-draw-controller-active'),
        geometry: element?.getAttribute('data-initial-mask-draw-context-geometry'),
        mask: element?.getAttribute('data-initial-mask-draw-context-mask'),
        revision: element?.getAttribute('data-initial-mask-draw-context-revision'),
        scale: viewer?.getAttribute('data-editor-transform-scale'),
        tool: element?.getAttribute('data-initial-mask-draw-context-tool'),
        transition: element?.getAttribute('data-initial-mask-draw-transition'),
        viewerInputOwner: element?.getAttribute('data-viewer-input-owner'),
        x: viewer?.getAttribute('data-editor-transform-position-x'),
        y: viewer?.getAttribute('data-editor-transform-position-y'),
      };
    });
  const contextBeforeMove = await readContext();
  await page.mouse.move(end.x, end.y);
  if ((await imageCanvas.getAttribute('data-initial-mask-draw-active')) !== 'true') {
    const current = await readContext();
    throw new Error(
      `Radial mouse gesture did not retain its declarative draft: ${JSON.stringify(contextBeforeMove)} -> ${JSON.stringify(current)}.`,
    );
  }
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-active') === 'false',
  );
  await page.mouse.up();
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== saveBeforeCancel) {
    throw new Error('A cancelled initial-mask pointer persisted a mask commit.');
  }
  await assertCurrentOverlayMatchesPersisted('pointercancel radial', overlayBeforeCancel);
  for (const cancellation of ['lostpointercapture', 'escape'] as const) {
    const saveBeforeLifecycleCancel = await readCallCount('save_metadata_and_update_thumbnail');
    const overlayBeforeLifecycleCancel = await readCallCount('generate_mask_overlay');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    if ((await imageCanvas.getAttribute('data-initial-mask-draw-active')) !== 'true') {
      throw new Error(`Radial ${cancellation} proof did not begin a keyed draft.`);
    }
    if (cancellation === 'lostpointercapture') {
      await imageCanvas.dispatchEvent('lostpointercapture', { pointerId: 1, pointerType: 'mouse' });
    } else {
      await imageCanvas.focus();
      await page.keyboard.press('Escape');
    }
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-active') ===
        'false',
    );
    await page.mouse.up();
    if ((await readCallCount('save_metadata_and_update_thumbnail')) !== saveBeforeLifecycleCancel) {
      throw new Error(`Radial ${cancellation} cancellation persisted a semantic commit.`);
    }
    await assertCurrentOverlayMatchesPersisted(`${cancellation} radial`, overlayBeforeLifecycleCancel);
  }

  const saveBeforeGeometry = await readCallCount('save_metadata_and_update_thumbnail');
  const overlayBeforeGeometry = await readCallCount('generate_mask_overlay');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.setViewportSize({ height: viewport.height, width: viewport.width - 20 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-active') === 'false',
  );
  await page.mouse.up();
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== saveBeforeGeometry) {
    throw new Error('A geometry-successor initial-mask pointer persisted a mask commit.');
  }
  const narrowGeometry = await imageCanvas.getAttribute('data-initial-mask-draw-context-geometry');
  await page.setViewportSize(viewport);
  await waitForStableGeometry(narrowGeometry);
  await assertCurrentOverlayMatchesPersisted('geometry-successor radial', overlayBeforeGeometry);

  const radialBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    renders: await readCallCount('apply_adjustments'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.waitForFunction(
    (baseline) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const overlay = calls.filter(({ command }) => command === 'generate_mask_overlay').at(-1);
      const maskDef = overlay?.args?.['maskDef'];
      if (
        typeof maskDef !== 'object' ||
        maskDef === null ||
        !('subMasks' in maskDef) ||
        !Array.isArray(maskDef.subMasks)
      )
        return false;
      const radial = maskDef.subMasks.find(
        (candidate) => typeof candidate === 'object' && candidate !== null && candidate['type'] === 'radial',
      );
      const parameters =
        typeof radial === 'object' && radial !== null && 'parameters' in radial ? radial.parameters : null;
      return (
        calls.filter(({ command }) => command === 'generate_mask_overlay').length > baseline.overlays &&
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === baseline.saves &&
        typeof parameters === 'object' &&
        parameters !== null &&
        typeof parameters['radiusX'] === 'number' &&
        parameters['radiusX'] > 10
      );
    },
    radialBaseline,
    { timeout: 10_000 },
  );
  await page.mouse.move(end.x, box.y - 12);
  if ((await imageCanvas.getAttribute('data-initial-mask-draw-active')) !== 'true') {
    throw new Error('Moving a radial-mask pointer outside the Konva stage cancelled its owned gesture.');
  }
  await page.mouse.up();
  await waitForPersistedMask('radial', false, 'committed radial');
  await page.waitForFunction(
    ({ renders, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return (
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
        calls.filter(({ command }) => command === 'apply_adjustments').length > renders
      );
    },
    radialBaseline,
    { timeout: 10_000 },
  );

  await waitForGeometryIdle();
  const maskShapeStart = start;
  const maskShapeSceneAlpha = await toolStage.evaluate((element, point) => {
    let centerAlpha = 0;
    for (const canvas of element.querySelectorAll('canvas')) {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) continue;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(canvas.width - 1, Math.round(((point.x - rect.left) / rect.width) * canvas.width)),
      );
      const y = Math.max(
        0,
        Math.min(canvas.height - 1, Math.round(((point.y - rect.top) / rect.height) * canvas.height)),
      );
      centerAlpha = Math.max(centerAlpha, context.getImageData(x, y, 1, 1).data[3]);
    }
    return centerAlpha;
  }, maskShapeStart);
  if (maskShapeSceneAlpha !== 0) {
    throw new Error(`Mask-shape hit-only fill changed scene pixels: alpha=${String(maskShapeSceneAlpha)}.`);
  }
  const maskShapeActivation = { x: maskShapeStart.x + 8, y: maskShapeStart.y + 6 };
  const maskShapeEnd = { x: maskShapeStart.x + 34, y: maskShapeStart.y + 26 };
  const shapeCommitBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  await page.mouse.move(maskShapeStart.x, maskShapeStart.y);
  await page.mouse.down();
  await page.mouse.move(maskShapeActivation.x, maskShapeActivation.y, { steps: 3 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active') ===
      'true',
  );
  await page.mouse.move(maskShapeEnd.x, maskShapeEnd.y, { steps: 6 });
  await page.waitForTimeout(250);
  const shapePreviewProof = await page.evaluate(() => ({
    active: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active'),
    overlays:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'generate_mask_overlay')
        .length ?? 0,
    saves:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
    pointerId: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-pointer-id'),
    pointerType: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-pointer-type'),
    transition: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-transition'),
  }));
  if (
    shapePreviewProof.active !== 'true' ||
    shapePreviewProof.overlays <= shapeCommitBaseline.overlays ||
    shapePreviewProof.saves !== shapeCommitBaseline.saves
  ) {
    throw new Error(`Mask-shape body drag did not publish a draft: ${JSON.stringify(shapePreviewProof)}.`);
  }
  await page.mouse.up();
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await page.waitForTimeout(250);
  const shapeCommitProof = await page.evaluate(() => ({
    active: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active'),
    saves:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
    pointerId: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-pointer-id'),
    pointerType: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-pointer-type'),
    transactionId: document
      .querySelector('[data-testid="editor-image-preview-panel"]')
      ?.getAttribute('data-last-edit-transaction-id'),
    transition: document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-transition'),
  }));
  if (
    shapeCommitProof.active !== 'false' ||
    shapeCommitProof.saves !== shapeCommitBaseline.saves + 1 ||
    shapeCommitProof.transactionId?.startsWith('mask-shape:') !== true
  ) {
    throw new Error(`Mask-shape drag did not commit exactly once: ${JSON.stringify(shapeCommitProof)}.`);
  }
  await assertCurrentOverlayMatchesPersisted('mask-shape commit', shapeCommitBaseline.overlays);
  await page.mouse.move(maskShapeEnd.x + 12, maskShapeEnd.y + 8);
  await page.mouse.up();
  await page.waitForTimeout(100);
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== shapeCommitBaseline.saves + 1) {
    throw new Error('A late mask-shape move/release emitted a duplicate semantic save.');
  }

  const shapeCancelStart = maskShapeEnd;
  const shapeCancelEnd = { x: shapeCancelStart.x + 31, y: shapeCancelStart.y + 18 };
  const shapeCancelBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  await page.mouse.move(shapeCancelStart.x, shapeCancelStart.y);
  await page.mouse.down();
  await page.mouse.move(shapeCancelStart.x + 8, shapeCancelStart.y + 6, { steps: 3 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active') ===
      'true',
  );
  await page.mouse.move(shapeCancelEnd.x, shapeCancelEnd.y, { steps: 6 });
  await page.waitForFunction(
    (minimum) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'generate_mask_overlay')
        .length ?? 0) > minimum,
    shapeCancelBaseline.overlays,
  );
  await imageCanvas.focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-transition') === 'escape',
  );
  await page.mouse.up();
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== shapeCancelBaseline.saves) {
    throw new Error('Escape persisted a cancelled mask-shape draft.');
  }
  await assertCurrentOverlayMatchesPersisted('mask-shape escape rollback', shapeCancelBaseline.overlays);

  const maskShapeCdp = await page.context().newCDPSession(page);
  const touchCommitBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  await maskShapeCdp.send('Input.dispatchTouchEvent', {
    touchPoints: [{ force: 1, id: 41, radiusX: 1, radiusY: 1, x: shapeCancelStart.x, y: shapeCancelStart.y }],
    type: 'touchStart',
  });
  await maskShapeCdp.send('Input.dispatchTouchEvent', {
    touchPoints: [{ force: 1, id: 41, radiusX: 1, radiusY: 1, x: shapeCancelStart.x + 8, y: shapeCancelStart.y + 6 }],
    type: 'touchMove',
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="image-canvas"]');
    return (
      canvas?.getAttribute('data-mask-shape-controller-active') === 'true' &&
      canvas.getAttribute('data-mask-shape-pointer-type') === 'touch'
    );
  });
  await maskShapeCdp.send('Input.dispatchTouchEvent', {
    touchPoints: [{ force: 1, id: 41, radiusX: 1, radiusY: 1, x: shapeCancelStart.x + 18, y: shapeCancelStart.y + 12 }],
    type: 'touchMove',
  });
  await page.waitForFunction((minimum) => {
    const canvas = document.querySelector('[data-testid="image-canvas"]');
    return (
      canvas?.getAttribute('data-mask-shape-controller-active') === 'true' &&
      canvas.getAttribute('data-mask-shape-pointer-type') === 'touch' &&
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'generate_mask_overlay')
        .length ?? 0) > minimum
    );
  }, touchCommitBaseline.overlays);
  await maskShapeCdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await page.waitForFunction(
    ({ saves }) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) ===
      saves + 1,
    touchCommitBaseline,
    { timeout: 10_000 },
  );
  await assertCurrentOverlayMatchesPersisted('mask-shape touch commit', touchCommitBaseline.overlays);

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  for (const label of ['touch shape edit', 'mouse shape edit']) {
    const savesBeforeUndo = await readCallCount('save_metadata_and_update_thumbnail');
    await undo.click();
    await page.waitForFunction(
      (minimum) =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'save_metadata_and_update_thumbnail',
        ).length ?? 0) > minimum,
      savesBeforeUndo,
      { timeout: 10_000 },
    );
    await waitForPersistedMask('radial', false, `undone ${label}`);
  }
  await undo.click();
  await waitForPersistedMask('radial', true, 'undone radial');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-active') ===
      'true',
  );
  await waitForGeometryIdle();

  const saveBeforeLinearCreation = await readCallCount('save_metadata_and_update_thumbnail');
  await createMask('linear');
  await waitForPersistedMask('linear', true, 'initial linear');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-tool') ===
      'linear',
  );
  await waitForGeometryIdle();
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== saveBeforeLinearCreation + 1) {
    throw new Error('Creating the linear initial-mask tool did not persist exactly once.');
  }

  const linearBox = await toolStage.boundingBox();
  if (linearBox === null) throw new Error('Linear mask proof could not resolve the Konva input surface.');
  const linearStart = {
    x: linearBox.x + linearBox.width * 0.28,
    y: Math.min(linearBox.y + linearBox.height * 0.32, viewport.height - 48),
  };
  const linearBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    renders: await readCallCount('apply_adjustments'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  const cdp = await page.context().newCDPSession(page);
  const dispatchTouch = async (
    type: 'touchEnd' | 'touchMove' | 'touchStart',
    points: ReadonlyArray<{ id: number; x: number; y: number }>,
  ): Promise<void> => {
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: points.map((point) => ({ ...point, force: 1, radiusX: 1, radiusY: 1 })),
      type,
    });
  };
  const contextBeforeTouchStart = await readContext();
  await dispatchTouch('touchStart', [{ id: 21, ...linearStart }]);
  const touchPointerId = Number(await imageCanvas.getAttribute('data-initial-mask-draw-pointer-id'));
  if (!Number.isInteger(touchPointerId) || touchPointerId < 1) {
    throw new Error(
      `Linear mask gesture did not retain touch identity: ${String(touchPointerId)} ${JSON.stringify(contextBeforeTouchStart)} -> ${JSON.stringify(await readContext())}.`,
    );
  }
  await page.evaluate(({ x, y }) => {
    const unrelated = new Touch({ clientX: x, clientY: y, identifier: 999, target: document.body });
    window.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [unrelated], touches: [] }),
    );
  }, linearStart);
  if ((await imageCanvas.getAttribute('data-initial-mask-draw-active')) !== 'true') {
    throw new Error('An unrelated touchend stole the linear-mask gesture.');
  }
  await page.evaluate(
    ({ pointerId, x, y }) => {
      const owned = new Touch({ clientX: x, clientY: y, identifier: pointerId - 1, target: document.body });
      window.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [owned], touches: [] }),
      );
    },
    { pointerId: touchPointerId, ...linearStart },
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-active') === 'false',
  );
  await waitForPersistedMask('linear', false, 'committed linear');
  await dispatchTouch('touchEnd', []);
  await page.waitForFunction(
    ({ overlays, renders, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return (
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
        calls.filter(({ command }) => command === 'apply_adjustments').length > renders &&
        calls.filter(({ command }) => command === 'generate_mask_overlay').length > overlays
      );
    },
    linearBaseline,
    { timeout: 10_000 },
  );
  await page.evaluate(
    ({ pointerId, x, y }) => {
      const duplicate = new Touch({ clientX: x, clientY: y, identifier: pointerId - 1, target: document.body });
      window.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [duplicate], touches: [] }),
      );
      return new Promise<void>((resolveFrames) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrames())),
      );
    },
    { pointerId: touchPointerId, ...linearStart },
  );
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== linearBaseline.saves + 1) {
    throw new Error('Konva and global touchend handlers duplicated the linear-mask commit.');
  }

  const editReceipt = await page.getByTestId('editor-image-preview-panel').evaluate((element) => ({
    source: element.getAttribute('data-last-edit-source'),
    transactionId: element.getAttribute('data-last-edit-transaction-id'),
  }));
  if (editReceipt.source !== 'layer-command' || !editReceipt.transactionId?.startsWith('initial-mask-draw:')) {
    throw new Error(`Initial mask draw bypassed the semantic edit command: ${JSON.stringify(editReceipt)}.`);
  }

  const outputProof = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const latest = (command: string) => calls.filter((call) => call.command === command).at(-1)?.args ?? null;
    return {
      overlay: latest('generate_mask_overlay'),
      persistence: latest('save_metadata_and_update_thumbnail'),
      render: latest('apply_adjustments'),
    };
  });
  const persistedDocument = editDocumentV2Schema.parse(outputProof.persistence?.['editDocumentV2']);
  const overlayMask = outputProof.overlay?.['maskDef'];
  const renderRequest = outputProof.render?.['request'];
  if (
    typeof overlayMask !== 'object' ||
    overlayMask === null ||
    typeof renderRequest !== 'object' ||
    renderRequest === null
  ) {
    throw new Error(
      `Initial mask output proof was incomplete: persistence=${String(persistedDocument !== null)} overlay=${String(overlayMask !== null)} render=${String(renderRequest !== null)}.`,
    );
  }
  const editDocument = editDocumentV2Schema.parse(renderRequest['editDocumentV2']);
  const persistedLinear = persistedDocument.layers.masks
    .flatMap((mask) => mask.subMasks)
    .find((subMask) => subMask.type === 'linear');
  const overlayLinear = overlayMask.subMasks.find((subMask) => subMask.type === 'linear');
  const renderedLinear = editDocument.layers.masks
    .flatMap((mask) => mask.subMasks)
    .find((subMask) => subMask.type === 'linear');
  if (
    persistedLinear === undefined ||
    overlayLinear === undefined ||
    renderedLinear === undefined ||
    JSON.stringify(persistedLinear.parameters) !== JSON.stringify(overlayLinear.parameters) ||
    JSON.stringify(persistedLinear.parameters) !== JSON.stringify(renderedLinear.parameters)
  ) {
    throw new Error(
      `Linear mask persistence, render, and native overlay output diverged: ${JSON.stringify({ overlayLinear, persistedLinear, renderedLinear })}.`,
    );
  }

  await undo.click();
  await waitForPersistedMask('linear', true, 'undone linear');

  await createMask('radial');
  await waitForPersistedMask('radial', true, 'tool-replacement radial');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-tool') ===
      'radial',
  );
  await waitForGeometryIdle();
  const replacementBox = await toolStage.boundingBox();
  if (replacementBox === null) throw new Error('Tool-replacement proof could not resolve the Konva input surface.');
  const replacementStart = {
    x: replacementBox.x + replacementBox.width * 0.42,
    y: Math.min(replacementBox.y + replacementBox.height * 0.42, viewport.height - 48),
  };
  const replacementEnd = { x: replacementStart.x + 110, y: replacementStart.y + 80 };
  await page.mouse.move(replacementStart.x, replacementStart.y);
  await page.mouse.down();
  await page.mouse.move(replacementEnd.x, replacementEnd.y);
  const saveBeforeToolReplacement = await readCallCount('save_metadata_and_update_thumbnail');
  await page.evaluate(() => {
    const linear = document.querySelector<HTMLButtonElement>(
      '[data-testid="mask-contextual-create-linear"], [data-testid="mask-creation-linear"]',
    );
    if (linear === null) throw new Error('Linear mask tool replacement control was unavailable.');
    linear.click();
  });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="image-canvas"]');
    return (
      canvas?.getAttribute('data-initial-mask-draw-active') === 'false' &&
      canvas.getAttribute('data-initial-mask-draw-context-tool') === 'linear'
    );
  });
  await page.mouse.up();
  await waitForPersistedMask('linear', true, 'tool-replacement linear');
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    saveBeforeToolReplacement + 1,
    { timeout: 10_000 },
  );
  const toolReplacementProof = await page.evaluate(() => {
    const saves =
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ) ?? [];
    const document = saves.at(-1)?.args?.['editDocumentV2'];
    if (typeof document !== 'object' || document === null || !('layers' in document)) return false;
    const layers = document.layers;
    if (typeof layers !== 'object' || layers === null || !('masks' in layers) || !Array.isArray(layers.masks))
      return false;
    return layers.masks
      .flatMap((mask) => mask.subMasks)
      .filter((subMask) => subMask.type === 'radial')
      .every((subMask) => subMask.parameters.isInitialDraw === true);
  });
  const savesAfterToolReplacement = await readCallCount('save_metadata_and_update_thumbnail');
  if (savesAfterToolReplacement !== saveBeforeToolReplacement + 1 || !toolReplacementProof) {
    throw new Error(
      `Tool replacement persisted the stale radial draft or did not persist the new linear mask once: ${JSON.stringify({ saveBeforeToolReplacement, savesAfterToolReplacement, toolReplacementProof })}.`,
    );
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-active') ===
      'true',
  );
  await waitForGeometryIdle();

  const sourceReplacementBaseline = await readCallCount('save_metadata_and_update_thumbnail');
  const sourceReplacementOverlayBaseline = await readCallCount('generate_mask_overlay');
  const sourceA = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  if (sourceA === null) throw new Error('Initial mask A→B→A proof could not resolve source A.');
  await page.mouse.move(replacementStart.x, replacementStart.y);
  await page.mouse.down();
  await page.mouse.move(replacementEnd.x, replacementEnd.y);
  if ((await imageCanvas.getAttribute('data-initial-mask-draw-active')) !== 'true') {
    throw new Error(`Initial mask A→B→A proof did not begin source A draft: ${JSON.stringify(await readContext())}.`);
  }
  const sourceBThumbnail = page
    .locator(`[data-testid="filmstrip-thumbnail"]:not([data-image-path="${sourceA}"])`)
    .first();
  const sourceB = await sourceBThumbnail.getAttribute('data-image-path');
  if (sourceB === null) throw new Error('Initial mask A→B→A proof requires source B.');
  await sourceBThumbnail.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Source B thumbnail is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    sourceB,
  );
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourceA}"]`).evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Source A thumbnail is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    sourceA,
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== sourceReplacementBaseline) {
    throw new Error('A source-A draft revived and persisted after an A→B→A image-session replacement.');
  }
  const sourceInvalidation = await imageCanvas.evaluate((element) => {
    const identityText = element.getAttribute('data-mask-overlay-identity');
    return {
      contextSession: element.getAttribute('data-initial-mask-draw-context-session'),
      identity: identityText === null ? null : JSON.parse(identityText),
      status: element.getAttribute('data-mask-overlay-status'),
      urlPresent: element.getAttribute('data-mask-overlay-url-present'),
    };
  });
  if (
    sourceInvalidation.status !== 'none' ||
    sourceInvalidation.urlPresent !== 'false' ||
    sourceInvalidation.identity?.['status'] !== 'session-invalidated' ||
    sourceInvalidation.identity?.['imageSessionId'] !== sourceInvalidation.contextSession
  ) {
    throw new Error(
      `A→B→A did not invalidate the stale native overlay authority: ${JSON.stringify(sourceInvalidation)}.`,
    );
  }

  await createMask('radial');
  await waitForPersistedMask('radial', true, 'unmount radial');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-initial-mask-draw-context-active') ===
      'true',
  );
  await waitForGeometryIdle();
  await assertCurrentOverlayMatchesPersisted('successor-A radial', sourceReplacementOverlayBaseline);
  const successorMaskId = await imageCanvas.getAttribute('data-initial-mask-draw-context-mask');
  if (successorMaskId === null) throw new Error('Successor-A radial proof could not resolve the active mask id.');
  const unmountStage = page.locator('[data-initial-mask-draw-stage="true"]');
  const unmountBox = await unmountStage.boundingBox();
  if (unmountBox === null) throw new Error('Initial mask unmount proof could not resolve the input surface.');
  let successorShapeStart = {
    x: unmountBox.x + unmountBox.width * 0.32,
    y: unmountBox.y + unmountBox.height * 0.36,
  };
  const successorShapeEnd = {
    x: unmountBox.x + unmountBox.width * 0.63,
    y: unmountBox.y + unmountBox.height * 0.64,
  };
  await page.mouse.move(successorShapeStart.x, successorShapeStart.y);
  await page.mouse.down();
  await page.mouse.move(successorShapeEnd.x, successorShapeEnd.y);
  await page.mouse.up();
  await page.waitForFunction(
    (maskId) => {
      const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .at(-1);
      const masks = call?.args?.['editDocumentV2']?.['layers']?.['masks'];
      const subMask = Array.isArray(masks)
        ? masks.flatMap((mask) => mask['subMasks']).find((candidate) => candidate['id'] === maskId)
        : null;
      const parameters = subMask?.['parameters'];
      return (
        call?.endedAtMs !== null &&
        typeof parameters === 'object' &&
        parameters !== null &&
        !('isInitialDraw' in parameters) &&
        typeof parameters['radiusX'] === 'number' &&
        parameters['radiusX'] > 10
      );
    },
    successorMaskId,
    { timeout: 10_000 },
  );

  const shapeSourceReplacementBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  await page.mouse.move(successorShapeStart.x, successorShapeStart.y);
  await page.mouse.down();
  await page.mouse.move(successorShapeStart.x + 8, successorShapeStart.y + 6, { steps: 3 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active') ===
      'true',
  );
  await page.mouse.move(successorShapeStart.x + 27, successorShapeStart.y + 19, { steps: 4 });
  await page.waitForFunction(
    (minimum) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'generate_mask_overlay')
        .length ?? 0) > minimum,
    shapeSourceReplacementBaseline.overlays,
  );
  await sourceBThumbnail.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Source B thumbnail is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    sourceB,
  );
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourceA}"]`).evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Source A thumbnail is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    sourceA,
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== shapeSourceReplacementBaseline.saves) {
    throw new Error('A mask-shape draft revived and persisted after an A→B→successor-A session replacement.');
  }
  if ((await imageCanvas.getAttribute('data-mask-shape-controller-active')) !== 'false') {
    throw new Error('A mask-shape controller remained active after an A→B→successor-A session replacement.');
  }
  const successorMaskRow = page.getByTestId(`mask-submask-row-${successorMaskId}`);
  await successorMaskRow.scrollIntoViewIfNeeded();
  await successorMaskRow.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-context-active') === 'true',
  );
  await waitForGeometryIdle();
  const successorBoxAfterReturn = await toolStage.boundingBox();
  if (successorBoxAfterReturn === null) {
    throw new Error('Successor-A mask-shape proof could not resolve the replaced input surface.');
  }
  const successorVisibleBottom = Math.min(
    successorBoxAfterReturn.y + successorBoxAfterReturn.height,
    viewport.height - 48,
  );
  const successorVisibleHeight = successorVisibleBottom - successorBoxAfterReturn.y;
  successorShapeStart = {
    x: successorBoxAfterReturn.x + successorBoxAfterReturn.width * 0.32,
    y: successorBoxAfterReturn.y + successorVisibleHeight * 0.35,
  };

  const successorCommitBaseline = {
    overlays: await readCallCount('generate_mask_overlay'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  await page.mouse.move(successorShapeStart.x, successorShapeStart.y);
  await page.mouse.down();
  await page.mouse.move(successorShapeStart.x + 8, successorShapeStart.y + 6, { steps: 3 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active') ===
      'true',
  );
  const successorCommittedCenter = { x: successorShapeStart.x + 23, y: successorShapeStart.y + 17 };
  await page.mouse.move(successorCommittedCenter.x, successorCommittedCenter.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    successorCommitBaseline.saves + 1,
    { timeout: 10_000 },
  );
  await assertCurrentOverlayMatchesPersisted('successor-A mask-shape commit', successorCommitBaseline.overlays);

  const unmountBaseline = {
    maskId: await imageCanvas.getAttribute('data-initial-mask-draw-context-mask'),
    overlays: await readCallCount('generate_mask_overlay'),
    saves: await readCallCount('save_metadata_and_update_thumbnail'),
  };
  if (unmountBaseline.maskId === null) throw new Error('Mask-shape unmount proof could not resolve the mask id.');
  await page.mouse.move(successorCommittedCenter.x, successorCommittedCenter.y);
  await page.mouse.down();
  await page.mouse.move(successorCommittedCenter.x + 8, successorCommittedCenter.y + 6, { steps: 3 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-mask-shape-controller-active') ===
      'true',
  );
  await page.mouse.move(successorCommittedCenter.x + 29, successorCommittedCenter.y + 21, { steps: 4 });
  await page.waitForFunction(
    (minimum) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'generate_mask_overlay')
        .length ?? 0) > minimum,
    unmountBaseline.overlays,
  );
  await page
    .locator('button[data-command-id="back-to-library"]:visible')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library is not a button.');
      element.click();
    });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  if ((await readCallCount('save_metadata_and_update_thumbnail')) !== unmountBaseline.saves) {
    throw new Error('Mask-shape controller published a semantic commit after ImageCanvas unmount.');
  }
  const unmountOutput = await page.evaluate((maskId) => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const latestOverlay = calls.filter(({ command }) => command === 'generate_mask_overlay').at(-1);
    const latestSave = calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').at(-1);
    const persistedMasks = latestSave?.args?.['editDocumentV2']?.['layers']?.['masks'];
    return {
      native: latestOverlay?.args?.['maskDef']?.['subMasks']?.find(
        (subMask: Record<string, unknown>) => subMask['id'] === maskId,
      )?.['parameters'],
      overlays: calls.filter(({ command }) => command === 'generate_mask_overlay').length,
      persisted: Array.isArray(persistedMasks)
        ? persistedMasks.flatMap((mask) => mask['subMasks']).find((subMask) => subMask['id'] === maskId)?.['parameters']
        : null,
    };
  }, unmountBaseline.maskId);
  if (
    unmountOutput.overlays <= unmountBaseline.overlays ||
    typeof unmountOutput.native !== 'object' ||
    unmountOutput.native === null ||
    JSON.stringify(unmountOutput.native) !== JSON.stringify(unmountOutput.persisted)
  ) {
    throw new Error(
      `Mask-shape unmount left a live draft in native output: ${JSON.stringify({ unmountBaseline, unmountOutput })}.`,
    );
  }
}

async function verifyParametricMaskTargetController(page: Page): Promise<void> {
  const imageCanvas = page.getByTestId('image-canvas');
  const toolStage = page.locator('[data-initial-mask-draw-stage="true"]');
  const callCount = (command: string) =>
    page.evaluate(
      (expectedCommand) =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === expectedCommand).length ??
        0,
      command,
    );
  const touchCdp = await page.context().newCDPSession(page);
  const createMask = async (type: 'color' | 'luminance'): Promise<void> => {
    const contextual = page.getByTestId(`mask-contextual-create-${type}`);
    if ((await contextual.count()) > 0 && (await contextual.isVisible())) {
      await contextual.click();
      return;
    }
    const emptyGridOthers = page.getByTestId('mask-creation-others');
    if ((await emptyGridOthers.count()) > 0) {
      await emptyGridOthers.scrollIntoViewIfNeeded();
      await emptyGridOthers.click();
    } else {
      const more = page.getByTestId('mask-contextual-create-more');
      await more.click();
      await page.getByRole('menuitem', { exact: true, name: 'Others' }).click();
    }
    await page.getByRole('menuitem', { exact: true, name: type === 'color' ? 'Color' : 'Luminance' }).click();
  };
  const waitForPersistedTarget = async (type: 'color' | 'luminance', expectedInitial: boolean): Promise<void> => {
    await page.waitForFunction(
      ({ initial, maskType }) => {
        const latest = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .at(-1);
        const masks = latest?.args?.['editDocumentV2']?.['layers']?.['masks'];
        if (!Array.isArray(masks) || typeof latest?.endedAtMs !== 'number') return false;
        const mask = masks
          .flatMap((container) =>
            typeof container === 'object' && container !== null && Array.isArray(container['subMasks'])
              ? container['subMasks']
              : [],
          )
          .find((candidate) => candidate?.['type'] === maskType);
        const parameters = mask?.['parameters'];
        if (typeof parameters !== 'object' || parameters === null) return false;
        return initial
          ? parameters['isInitialDraw'] === true
          : !('isInitialDraw' in parameters) &&
              Number.isFinite(parameters['targetX']) &&
              Number.isFinite(parameters['targetY']) &&
              parameters['targetX'] >= 0 &&
              parameters['targetY'] >= 0;
      },
      { initial: expectedInitial, maskType: type },
      { timeout: 10_000 },
    );
  };
  const targetPoint = async (): Promise<{ x: number; y: number }> => {
    const box = await toolStage.boundingBox();
    if (box === null) throw new Error('Parametric target proof could not resolve the Konva stage.');
    return { x: box.x + box.width * 0.43, y: Math.min(box.y + box.height * 0.47, viewport.height - 48) };
  };
  const waitForParametricAuthorityIdle = () =>
    page.evaluate(async () => {
      const readAuthority = () => {
        const canvas = document.querySelector('[data-testid="image-canvas"]');
        return `${canvas?.getAttribute('data-parametric-mask-context-geometry') ?? ''}|${canvas?.getAttribute('data-parametric-mask-context-revision') ?? ''}|${canvas?.getAttribute('data-parametric-mask-context-session') ?? ''}`;
      };
      let previous = readAuthority();
      let stableFrames = 0;
      for (let frame = 0; frame < 120 && stableFrames < 30; frame += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const current = readAuthority();
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
      if (stableFrames < 30) throw new Error('Parametric target authority did not stabilize before pointer input.');
    });
  const pointerDown = async (pointerType: 'mouse' | 'touch', point: { x: number; y: number }): Promise<void> => {
    if (pointerType === 'mouse') {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      return;
    }
    await touchCdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ ...point, force: 1, id: 31, radiusX: 1, radiusY: 1 }],
      type: 'touchStart',
    });
  };
  const pointerUp = async (pointerType: 'mouse' | 'touch'): Promise<void> => {
    if (pointerType === 'mouse') {
      await page.mouse.up();
      return;
    }
    await touchCdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  };

  await page.getByTestId('right-panel-switcher-button-masks').click();
  await page.getByText('Create New Mask', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  for (const [index, type] of (['color', 'luminance'] as const).entries()) {
    const creationSaves = await callCount('save_metadata_and_update_thumbnail');
    await createMask(type);
    await page.waitForFunction((expectedType) => {
      const canvas = document.querySelector('[data-testid="image-canvas"]');
      return (
        canvas?.getAttribute('data-parametric-mask-context-active') === 'true' &&
        canvas.getAttribute('data-parametric-mask-context-tool') === expectedType
      );
    }, type);
    await waitForPersistedTarget(type, true);
    if ((await callCount('save_metadata_and_update_thumbnail')) !== creationSaves + 1) {
      throw new Error(`Creating the ${type} mask did not persist exactly once.`);
    }

    const baseline = {
      overlays: await callCount('generate_mask_overlay'),
      renders: await callCount('apply_adjustments'),
      saves: await callCount('save_metadata_and_update_thumbnail'),
    };
    await waitForParametricAuthorityIdle();
    const pointerType = index === 0 ? 'mouse' : 'touch';
    const point = await targetPoint();
    await pointerDown(pointerType, point);
    await page.waitForFunction((expectedPointerType) => {
      const canvas = document.querySelector('[data-testid="image-canvas"]');
      return (
        canvas?.getAttribute('data-parametric-mask-controller-active') === 'true' &&
        canvas.getAttribute('data-parametric-mask-pointer-type') === expectedPointerType &&
        Number(canvas.getAttribute('data-parametric-mask-operation')) > 0
      );
    }, pointerType);
    if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves) {
      throw new Error(`Parametric ${type} pointer-down persisted before its owned release.`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="image-canvas"]')
          ?.getAttribute('data-parametric-mask-controller-active') === 'false',
      undefined,
      { timeout: 5_000 },
    );
    const cancellationTransition = await imageCanvas.getAttribute('data-parametric-mask-transition');
    if (cancellationTransition !== 'escape') {
      throw new Error(`Parametric ${type} Escape resolved as ${String(cancellationTransition)}.`);
    }
    await pointerUp(pointerType);
    if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves) {
      throw new Error(`Parametric ${type} Escape cancellation persisted a semantic target.`);
    }

    if (pointerType === 'touch') {
      await waitForParametricAuthorityIdle();
      await pointerDown(pointerType, point);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="image-canvas"]')
            ?.getAttribute('data-parametric-mask-controller-active') === 'true',
      );
      await page.evaluate(({ x, y }) => {
        const touch = new Touch({ clientX: x, clientY: y, identifier: 31, target: document.body });
        window.dispatchEvent(
          new TouchEvent('touchcancel', { bubbles: true, cancelable: true, changedTouches: [touch], touches: [] }),
        );
      }, point);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('[data-testid="image-canvas"]');
        return (
          canvas?.getAttribute('data-parametric-mask-controller-active') === 'false' &&
          canvas.getAttribute('data-parametric-mask-transition') === 'touchcancel'
        );
      });
      await pointerUp(pointerType);
      await page.waitForTimeout(50);
      if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves) {
        throw new Error('Parametric luminance touchcancel/late touchend persisted a semantic target.');
      }
    }

    await waitForParametricAuthorityIdle();
    await pointerDown(pointerType, point);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="image-canvas"]')
          ?.getAttribute('data-parametric-mask-controller-active') === 'true',
    );
    if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves) {
      throw new Error(`Parametric ${type} draft persisted before the second owned release.`);
    }
    await pointerUp(pointerType);
    await page.waitForTimeout(150);
    if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves + 1) {
      const diagnostics = await imageCanvas.evaluate((element) => ({
        active: element.getAttribute('data-parametric-mask-controller-active'),
        contextGeometry: element.getAttribute('data-parametric-mask-context-geometry'),
        contextRevision: element.getAttribute('data-parametric-mask-context-revision'),
        operation: element.getAttribute('data-parametric-mask-operation'),
        pointerId: element.getAttribute('data-parametric-mask-pointer-id'),
        pointerType: element.getAttribute('data-parametric-mask-pointer-type'),
        transition: element.getAttribute('data-parametric-mask-transition'),
      }));
      throw new Error(`Parametric ${type} release did not commit: ${JSON.stringify(diagnostics)}.`);
    }
    await waitForPersistedTarget(type, false);
    await page.waitForFunction(
      ({ overlays, renders, saves }) => {
        const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
        return (
          calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
          calls.filter(({ command }) => command === 'apply_adjustments').length > renders &&
          calls.filter(({ command }) => command === 'generate_mask_overlay').length > overlays
        );
      },
      baseline,
      { timeout: 10_000 },
    );
    if (pointerType === 'mouse') {
      await pointerUp(pointerType);
    } else {
      await page.evaluate(() => {
        const touch = new Touch({ clientX: 0, clientY: 0, identifier: 31, target: document.body });
        window.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch], touches: [] }),
        );
      });
    }
    await page.waitForTimeout(50);
    if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves + 1) {
      throw new Error(`Parametric ${type} late release duplicated its semantic transaction.`);
    }
    const proof = await page.evaluate((maskType) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const latest = (command: string) => calls.filter((call) => call.command === command).at(-1)?.args ?? null;
      const findMask = (containers: unknown) =>
        Array.isArray(containers)
          ? containers
              .flatMap((container) =>
                typeof container === 'object' && container !== null && Array.isArray(container['subMasks'])
                  ? container['subMasks']
                  : [],
              )
              .find((candidate) => candidate?.['type'] === maskType)
          : undefined;
      return {
        overlay: findMask(
          latest('generate_mask_overlay')?.['maskDef']?.['subMasks'] === undefined
            ? []
            : [{ subMasks: latest('generate_mask_overlay')?.['maskDef']?.['subMasks'] }],
        ),
        persisted: findMask(latest('save_metadata_and_update_thumbnail')?.['editDocumentV2']?.['layers']?.['masks']),
        receipt: {
          source: document
            .querySelector('[data-testid="editor-image-preview-panel"]')
            ?.getAttribute('data-last-edit-source'),
          transactionId: document
            .querySelector('[data-testid="editor-image-preview-panel"]')
            ?.getAttribute('data-last-edit-transaction-id'),
        },
        renderRequest: latest('apply_adjustments')?.['request'],
      };
    }, type);
    const persistedParameters = proof.persisted?.['parameters'];
    const overlayParameters = proof.overlay?.['parameters'];
    if (
      proof.receipt.source !== 'layer-command' ||
      !proof.receipt.transactionId?.startsWith('parametric-mask-target:') ||
      typeof persistedParameters?.['targetX'] !== 'number' ||
      typeof persistedParameters['targetY'] !== 'number' ||
      overlayParameters?.['targetX'] !== persistedParameters['targetX'] ||
      overlayParameters?.['targetY'] !== persistedParameters['targetY'] ||
      typeof proof.renderRequest !== 'object' ||
      proof.renderRequest === null
    ) {
      throw new Error(`Parametric ${type} output proof was incomplete: ${JSON.stringify(proof.receipt)}.`);
    }
    const rendered = editDocumentV2Schema
      .parse(proof.renderRequest['editDocumentV2'])
      .layers.masks.flatMap((container) => container.subMasks)
      .find((candidate) => candidate.type === type);
    if (
      rendered?.parameters?.['targetX'] !== persistedParameters['targetX'] ||
      rendered.parameters['targetY'] !== persistedParameters['targetY']
    ) {
      throw new Error(`Parametric ${type} render output diverged from persisted target.`);
    }

    await page.locator('button[data-command-id="undo"]:visible').first().click();
    await waitForPersistedTarget(type, true);
    if ((await imageCanvas.getAttribute('data-parametric-mask-context-tool')) !== type) {
      throw new Error(`Undo did not restore the active ${type} target session.`);
    }
    if (index === 0) {
      await page.getByTestId('mask-reset-all').click();
      await page.getByTestId('mask-creation-others').waitFor({ state: 'visible', timeout: 10_000 });
    }
  }

  const sourceReplacementBaseline = await callCount('save_metadata_and_update_thumbnail');
  const sourceA = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  const activeMaskId = await imageCanvas.getAttribute('data-parametric-mask-context-id');
  if (sourceA === null || activeMaskId === null) {
    throw new Error('Parametric A→B→successor-A proof could not resolve source/mask identity.');
  }
  const stalePoint = await targetPoint();
  await pointerDown('mouse', stalePoint);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-parametric-mask-controller-active') ===
      'true',
  );
  const sourceBThumbnail = page
    .locator(`[data-testid="filmstrip-thumbnail"]:not([data-image-path="${sourceA}"])`)
    .first();
  const sourceB = await sourceBThumbnail.getAttribute('data-image-path');
  if (sourceB === null) throw new Error('Parametric A→B→successor-A proof requires source B.');
  await sourceBThumbnail.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Source B thumbnail is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    sourceB,
  );
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${sourceA}"]`).evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Source A thumbnail is not interactive.');
    element.click();
  });
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    sourceA,
  );
  await pointerUp('mouse');
  await page.waitForTimeout(100);
  if (
    (await callCount('save_metadata_and_update_thumbnail')) !== sourceReplacementBaseline ||
    (await imageCanvas.getAttribute('data-parametric-mask-controller-active')) !== 'false'
  ) {
    throw new Error('A stale parametric target revived after A→B→successor-A session replacement.');
  }

  const activeMaskRow = page.getByTestId(`mask-submask-row-${activeMaskId}`);
  await activeMaskRow.scrollIntoViewIfNeeded();
  await activeMaskRow.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-parametric-mask-context-active') ===
      'true',
  );
  const successorPoint = await targetPoint();
  const successorBaseline = await callCount('save_metadata_and_update_thumbnail');
  await pointerDown('mouse', successorPoint);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-parametric-mask-controller-active') ===
      'true',
  );
  await pointerUp('mouse');
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    successorBaseline + 1,
    { timeout: 10_000 },
  );

  const unmountBaseline = await callCount('save_metadata_and_update_thumbnail');
  await pointerDown('mouse', { x: successorPoint.x + 24, y: successorPoint.y + 18 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-parametric-mask-controller-active') ===
      'true',
  );
  await page
    .locator('button[data-command-id="back-to-library"]:visible')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library is not a button.');
      element.click();
    });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
  await pointerUp('mouse');
  await page.waitForTimeout(100);
  if ((await callCount('save_metadata_and_update_thumbnail')) !== unmountBaseline) {
    throw new Error('Parametric target controller committed after ImageCanvas unmount.');
  }
}

async function verifyAiMaskBoxController(page: Page): Promise<void> {
  const imageCanvas = page.getByTestId('image-canvas');
  const toolStage = page.locator('[data-initial-mask-draw-stage="true"]');
  const callCount = (command: string) =>
    page.evaluate(
      (expected) =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === expected).length ?? 0,
      command,
    );

  await page.getByTestId('right-panel-switcher-button-masks').click();
  const contextual = page.getByTestId('mask-contextual-create-ai-subject');
  if ((await contextual.count()) > 0 && (await contextual.isVisible())) {
    await contextual.click();
  } else {
    await page.getByTestId('mask-creation-ai-subject').click();
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-ai-mask-box-context-active') ===
        'true' &&
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-ai-mask-box-context-tool') ===
        'ai-subject',
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(650);

  const box = await toolStage.boundingBox();
  if (box === null) throw new Error('AI mask box proof could not resolve the Konva input surface.');
  const start = { x: box.x + box.width * 0.28, y: box.y + box.height * 0.32 };
  const end = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.68 };

  const saveBeforeCancel = await callCount('save_metadata_and_update_thumbnail');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  if ((await imageCanvas.getAttribute('data-ai-mask-box-active')) !== 'true') {
    throw new Error('AI Subject mouse gesture did not publish its declarative box overlay.');
  }
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  await page.waitForFunction(
    () => document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-ai-mask-box-active') === 'false',
  );
  await page.mouse.up();
  if ((await callCount('save_metadata_and_update_thumbnail')) !== saveBeforeCancel) {
    throw new Error('A cancelled AI mask box gesture persisted a semantic transaction.');
  }
  for (const cancellation of ['lostpointercapture', 'escape'] as const) {
    const saveBeforeLifecycleCancel = await callCount('save_metadata_and_update_thumbnail');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    if ((await imageCanvas.getAttribute('data-ai-mask-box-active')) !== 'true') {
      throw new Error(`AI Subject ${cancellation} proof did not begin a box gesture.`);
    }
    if (cancellation === 'lostpointercapture') {
      await imageCanvas.dispatchEvent('lostpointercapture', { pointerId: 1, pointerType: 'mouse' });
    } else {
      await imageCanvas.focus();
      await page.keyboard.press('Escape');
    }
    await page.waitForFunction(
      () => document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-ai-mask-box-active') === 'false',
    );
    await page.mouse.up();
    if ((await callCount('save_metadata_and_update_thumbnail')) !== saveBeforeLifecycleCancel) {
      throw new Error(`AI Subject ${cancellation} cancellation persisted a semantic transaction.`);
    }
  }

  const staleWithoutSuccessor = {
    native: await callCount('generate_ai_subject_mask'),
    saves: await callCount('save_metadata_and_update_thumbnail'),
  };
  await page.evaluate(() => {
    const harness = window.__RAWENGINE_BROWSER_TAURI_HARNESS__;
    if (harness === undefined) throw new Error('AI mask box proof could not configure a stale native response.');
    harness.aiSubjectMaskResponses.push({
      delayMs: 500,
      value: { generatedMaskArtifactId: 'stale-without-successor', generatedMaskCoverage: 0.2 },
    });
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await page.waitForFunction((nativeBefore) => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return (
      calls.filter(({ command }) => command === 'generate_ai_subject_mask').length === nativeBefore + 1 &&
      document
        .querySelector('[data-testid="editor-image-preview-panel"]')
        ?.getAttribute('data-is-generating-ai-mask') === 'true'
    );
  }, staleWithoutSuccessor.native);
  await page.setViewportSize({ height: viewport.height, width: viewport.width - 24 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="editor-image-preview-panel"]')
        ?.getAttribute('data-is-generating-ai-mask') === 'false',
    undefined,
    { timeout: 5_000 },
  );
  if ((await callCount('save_metadata_and_update_thumbnail')) !== staleWithoutSuccessor.saves) {
    throw new Error('A geometry-stale AI mask generation persisted without a successor request.');
  }
  await page.setViewportSize(viewport);
  await page.waitForTimeout(300);

  const baseline = {
    native: await callCount('generate_ai_subject_mask'),
    overlays: await callCount('generate_mask_overlay'),
    renders: await callCount('apply_adjustments'),
    saves: await callCount('save_metadata_and_update_thumbnail'),
  };
  await page.evaluate(() => {
    const harness = window.__RAWENGINE_BROWSER_TAURI_HARNESS__;
    if (harness === undefined) throw new Error('AI mask box proof could not configure native responses.');
    harness.aiSubjectMaskResponses.push(
      { delayMs: 700, value: { generatedMaskArtifactId: 'stale-generation', generatedMaskCoverage: 0.1 } },
      { delayMs: 0, value: { generatedMaskArtifactId: 'current-generation', generatedMaskCoverage: 0.8 } },
    );
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  const successorStart = { x: start.x + 24, y: start.y + 18 };
  const successorEnd = { x: end.x - 18, y: end.y - 14 };
  await page.mouse.move(successorStart.x, successorStart.y);
  await page.mouse.down();
  await page.mouse.move(successorEnd.x, successorEnd.y);
  await page.mouse.up();
  try {
    await page.waitForFunction(
      ({ native, overlays, renders, saves }) => {
        const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
        const receipt = document.querySelector('[data-testid="editor-image-preview-panel"]');
        return (
          receipt?.getAttribute('data-last-edit-source') === 'layer-command' &&
          receipt.getAttribute('data-last-edit-transaction-id')?.startsWith('ai-mask-box:') === true &&
          calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
          calls.filter(({ command }) => command === 'apply_adjustments').length > renders &&
          calls.filter(({ command }) => command === 'generate_mask_overlay').length > overlays &&
          calls.filter(({ command }) => command === 'generate_ai_subject_mask').length === native + 2
        );
      },
      baseline,
      { timeout: 10_000 },
    );
  } catch {
    const diagnostics = await page.evaluate(() => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const receipt = document.querySelector('[data-testid="editor-image-preview-panel"]');
      const canvas = document.querySelector('[data-testid="image-canvas"]');
      return {
        active: canvas?.getAttribute('data-ai-mask-box-active'),
        callCounts: Object.fromEntries(
          [
            'save_metadata_and_update_thumbnail',
            'apply_adjustments',
            'generate_mask_overlay',
            'generate_ai_subject_mask',
          ].map((command) => [command, calls.filter((call) => call.command === command).length]),
        ),
        receipt: {
          source: receipt?.getAttribute('data-last-edit-source'),
          transactionId: receipt?.getAttribute('data-last-edit-transaction-id'),
        },
        transition: canvas?.getAttribute('data-ai-mask-box-transition'),
      };
    });
    throw new Error(`AI mask box command output timed out: ${JSON.stringify({ baseline, diagnostics })}.`);
  }

  const proof = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const latest = (command: string) => calls.filter((call) => call.command === command).at(-1)?.args ?? null;
    return {
      native: latest('generate_ai_subject_mask'),
      overlay: latest('generate_mask_overlay'),
      persistence: latest('save_metadata_and_update_thumbnail'),
      render: latest('apply_adjustments'),
    };
  });
  const persisted = proof.persistence?.['editDocumentV2']?.['layers']?.['masks']
    ?.flatMap((container: Record<string, unknown>) => container['subMasks'])
    .find((subMask: Record<string, unknown>) => subMask['type'] === 'ai-subject')?.['parameters'];
  const overlay = proof.overlay?.['maskDef']?.['subMasks']?.find(
    (subMask: Record<string, unknown>) => subMask['type'] === 'ai-subject',
  )?.['parameters'];
  const renderDocument = editDocumentV2Schema.parse(proof.render?.['request']?.['editDocumentV2']);
  const rendered = renderDocument.layers.masks
    .flatMap((container) => container.subMasks)
    .find((subMask) => subMask.type === 'ai-subject')?.parameters;
  const nativeStart = proof.native?.['startPoint'];
  const nativeEnd = proof.native?.['endPoint'];
  if (
    typeof persisted !== 'object' ||
    persisted === null ||
    JSON.stringify(persisted) !== JSON.stringify(overlay) ||
    JSON.stringify(persisted) !== JSON.stringify(rendered) ||
    !Array.isArray(nativeStart) ||
    !Array.isArray(nativeEnd) ||
    persisted['startX'] !== nativeStart[0] ||
    persisted['startY'] !== nativeStart[1] ||
    persisted['endX'] !== nativeEnd[0] ||
    persisted['endY'] !== nativeEnd[1]
  ) {
    throw new Error(
      `AI mask box persistence, native request, overlay, and render diverged: ${JSON.stringify({ nativeEnd, nativeStart, overlay, persisted, rendered })}.`,
    );
  }
  if (persisted['generatedMaskArtifactId'] !== 'current-generation') {
    throw new Error(`The successor AI mask generation did not own the committed output: ${JSON.stringify(persisted)}.`);
  }
  await page.waitForTimeout(850);
  if ((await callCount('save_metadata_and_update_thumbnail')) !== baseline.saves + 1) {
    throw new Error('A delayed stale AI mask generation persisted after its successor generation.');
  }
  if ((await page.getByTestId('editor-image-preview-panel').getAttribute('data-is-generating-ai-mask')) !== 'false') {
    throw new Error('The latest AI mask generation left the busy UI owned after completion.');
  }

  const sourceReplacementBaseline = {
    native: await callCount('generate_ai_subject_mask'),
    saves: await callCount('save_metadata_and_update_thumbnail'),
  };
  const activePath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  if (activePath === null) throw new Error('AI mask A→B→A proof could not resolve source A.');
  await page.evaluate(() => {
    const harness = window.__RAWENGINE_BROWSER_TAURI_HARNESS__;
    if (harness === undefined) throw new Error('AI mask A→B→A proof could not configure native delay.');
    harness.aiSubjectMaskResponses.push({
      delayMs: 500,
      value: { generatedMaskArtifactId: 'stale-after-source-return', generatedMaskCoverage: 0.3 },
    });
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  await page.waitForFunction(
    (nativeBefore) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'generate_ai_subject_mask')
        .length ?? 0) ===
      nativeBefore + 1,
    sourceReplacementBaseline.native,
  );
  const other = page.locator(`[data-testid="filmstrip-thumbnail"]:not([data-image-path="${activePath}"])`).first();
  const otherPath = await other.getAttribute('data-image-path');
  if (otherPath === null) throw new Error('AI mask A→B→A proof requires source B.');
  await other.click();
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    otherPath,
  );
  await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${activePath}"]`).click();
  await page.waitForFunction(
    (path) =>
      document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
    activePath,
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="editor-image-preview-panel"]')
        ?.getAttribute('data-is-generating-ai-mask') === 'false',
    undefined,
    { timeout: 5_000 },
  );
  if ((await callCount('save_metadata_and_update_thumbnail')) !== sourceReplacementBaseline.saves) {
    throw new Error('A delayed source-A result persisted after an A→B→A image-session replacement.');
  }

  await page.getByTestId('right-panel-switcher-button-ai').click();
  await page.getByTestId('inpaint-workspace-panel').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: /Create New Quick Erase Edit/iu }).click();
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('[data-testid="image-canvas"]');
      return (
        canvas?.getAttribute('data-ai-mask-box-context-active') === 'true' &&
        canvas.getAttribute('data-ai-mask-box-context-tool') === 'quick-eraser'
      );
    },
    undefined,
    { timeout: 10_000 },
  );
  const quickEraseStage = page.locator('[data-initial-mask-draw-stage="true"]');
  const quickEraseBox = await quickEraseStage.boundingBox();
  if (quickEraseBox === null) throw new Error('Quick Eraser proof could not resolve the Konva input surface.');
  const quickEraseStart = {
    x: quickEraseBox.x + quickEraseBox.width * 0.31,
    y: quickEraseBox.y + quickEraseBox.height * 0.34,
  };
  const quickEraseEnd = {
    x: quickEraseBox.x + quickEraseBox.width * 0.66,
    y: quickEraseBox.y + quickEraseBox.height * 0.64,
  };
  const quickEraseBaseline = {
    generation: await callCount('generate_ai_subject_mask'),
    inpaint: await callCount('invoke_generative_replace_with_mask_def'),
    renders: await callCount('apply_adjustments'),
    saves: await callCount('save_metadata_and_update_thumbnail'),
  };
  await page.mouse.move(quickEraseStart.x, quickEraseStart.y);
  await page.mouse.down();
  await page.mouse.move(quickEraseEnd.x, quickEraseEnd.y);
  if (
    (await imageCanvas.getAttribute('data-ai-mask-box-active')) !== 'true' ||
    (await imageCanvas.getAttribute('data-ai-mask-box-context-tool')) !== 'quick-eraser'
  ) {
    throw new Error('Quick Eraser did not publish a declarative box overlay in its keyed tool context.');
  }
  await page.mouse.up();
  await page.waitForFunction(
    ({ generation, inpaint, renders, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const receipt = document.querySelector('[data-testid="editor-image-preview-panel"]');
      return (
        receipt?.getAttribute('data-last-edit-source') === 'ai-edit' &&
        calls.filter(({ command }) => command === 'generate_ai_subject_mask').length === generation + 1 &&
        calls.filter(({ command }) => command === 'invoke_generative_replace_with_mask_def').length === inpaint + 1 &&
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
        calls.filter(({ command }) => command === 'apply_adjustments').length > renders
      );
    },
    quickEraseBaseline,
    { timeout: 10_000 },
  );
  const quickEraseProof = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const latest = (command: string) => calls.filter((call) => call.command === command).at(-1)?.args ?? null;
    return {
      generation: latest('generate_ai_subject_mask'),
      inpaint: latest('invoke_generative_replace_with_mask_def'),
      persistence: latest('save_metadata_and_update_thumbnail'),
      render: latest('apply_adjustments'),
    };
  });
  const quickErasePersistedPatch = quickEraseProof.persistence?.['editDocumentV2']?.['sourceArtifacts']?.[
    'aiPatches'
  ]?.find(
    (patch: Record<string, unknown>) =>
      Array.isArray(patch['subMasks']) &&
      patch['subMasks'].some((subMask: Record<string, unknown>) => subMask['type'] === 'quick-eraser'),
  );
  const quickErasePersisted = quickErasePersistedPatch?.['subMasks']?.find(
    (subMask: Record<string, unknown>) => subMask['type'] === 'quick-eraser',
  )?.['parameters'];
  const quickEraseDocument = editDocumentV2Schema.parse(quickEraseProof.render?.['request']?.['editDocumentV2']);
  const quickEraseRenderedPatch = quickEraseDocument.sourceArtifacts.aiPatches.find((patch) =>
    patch.subMasks.some((subMask) => subMask.type === 'quick-eraser'),
  );
  const quickEraseRendered = quickEraseRenderedPatch?.subMasks.find(
    (subMask) => subMask.type === 'quick-eraser',
  )?.parameters;
  const quickEraseNativeStart = quickEraseProof.generation?.['startPoint'];
  const quickEraseNativeEnd = quickEraseProof.generation?.['endPoint'];
  if (
    typeof quickErasePersisted !== 'object' ||
    quickErasePersisted === null ||
    JSON.stringify(quickErasePersisted) !== JSON.stringify(quickEraseRendered) ||
    JSON.stringify(quickErasePersistedPatch?.['patchData']) !== JSON.stringify(quickEraseRenderedPatch?.patchData) ||
    quickErasePersistedPatch?.['patchData']?.['browserHarnessQuickErase'] !== true ||
    !Array.isArray(quickEraseNativeStart) ||
    !Array.isArray(quickEraseNativeEnd) ||
    quickErasePersisted['startX'] !== quickEraseNativeStart[0] ||
    quickErasePersisted['startY'] !== quickEraseNativeStart[1] ||
    quickErasePersisted['endX'] !== quickEraseNativeEnd[0] ||
    quickErasePersisted['endY'] !== quickEraseNativeEnd[1] ||
    quickEraseProof.inpaint?.['useFastInpaint'] !== true
  ) {
    throw new Error(
      `Quick Eraser native, semantic persistence, and rendered output diverged: ${JSON.stringify({
        nativeEnd: quickEraseNativeEnd,
        nativeStart: quickEraseNativeStart,
        persisted: quickErasePersisted,
        rendered: quickEraseRendered,
      })}.`,
    );
  }
  await page.waitForTimeout(100);
  if (
    (await callCount('generate_ai_subject_mask')) !== quickEraseBaseline.generation + 1 ||
    (await callCount('invoke_generative_replace_with_mask_def')) !== quickEraseBaseline.inpaint + 1 ||
    (await callCount('save_metadata_and_update_thumbnail')) !== quickEraseBaseline.saves + 1
  ) {
    throw new Error('Quick Eraser box release produced more than one native or semantic commit.');
  }

  const unmountBaseline = {
    native: await callCount('generate_ai_subject_mask'),
    saves: await callCount('save_metadata_and_update_thumbnail'),
  };
  const currentStage = page.locator('[data-initial-mask-draw-stage="true"]');
  const currentBox = await currentStage.boundingBox();
  if (currentBox === null) throw new Error('AI mask unmount proof could not resolve the input surface.');
  await page.mouse.move(currentBox.x + currentBox.width * 0.3, currentBox.y + currentBox.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(currentBox.x + currentBox.width * 0.65, currentBox.y + currentBox.height * 0.62);
  await page
    .locator('button[data-command-id="back-to-library"]:visible')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library is not a button.');
      element.click();
    });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  if (
    (await callCount('generate_ai_subject_mask')) !== unmountBaseline.native ||
    (await callCount('save_metadata_and_update_thumbnail')) !== unmountBaseline.saves
  ) {
    throw new Error('AI mask box published a native or persistence command after ImageCanvas unmount.');
  }
}

async function verifyObjectPromptController(page: Page): Promise<void> {
  const callCount = (command: string) =>
    page.evaluate(
      (expected) =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === expected).length ?? 0,
      command,
    );
  const persistedPrompt = () =>
    page.evaluate(() => {
      const latest = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(
          ({ command, endedAtMs }) => command === 'save_metadata_and_update_thumbnail' && typeof endedAtMs === 'number',
        )
        .at(-1);
      const masks = latest?.args?.['editDocumentV2']?.['layers']?.['masks'];
      return Array.isArray(masks)
        ? (masks
            .flatMap((container) => (Array.isArray(container?.['subMasks']) ? container['subMasks'] : []))
            .find((candidate) => candidate?.['type'] === 'ai-object')?.['parameters'] ?? null)
        : null;
    });
  const waitForPrompt = async (expected: { box: boolean; pending: boolean; points: number }): Promise<void> => {
    try {
      await page.waitForFunction(
        ({ box, pending, points }) => {
          const latest = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
            .filter(
              ({ command, endedAtMs }) =>
                command === 'save_metadata_and_update_thumbnail' && typeof endedAtMs === 'number',
            )
            .at(-1);
          const masks = latest?.args?.['editDocumentV2']?.['layers']?.['masks'];
          if (!Array.isArray(masks)) return false;
          const parameters = masks
            .flatMap((container) => (Array.isArray(container?.['subMasks']) ? container['subMasks'] : []))
            .find((candidate) => candidate?.['type'] === 'ai-object')?.['parameters'];
          return (
            typeof parameters === 'object' &&
            parameters !== null &&
            Array.isArray(parameters['pointPrompts']) &&
            parameters['pointPrompts'].length === points &&
            (parameters['boxPrompt'] != null) === box &&
            (parameters['pendingBoxAnchor'] != null) === pending
          );
        },
        expected,
        { timeout: 10_000 },
      );
    } catch {
      const actual = await persistedPrompt();
      const ui = await page.evaluate(() => ({
        boxReady: document
          .querySelector('[data-testid="object-prompt-controls"]')
          ?.getAttribute('data-object-prompt-box-ready'),
        mode: document.querySelector('[data-testid="object-prompt-controls"]')?.getAttribute('data-object-prompt-mode'),
        points: document
          .querySelector('[data-testid="object-prompt-controls"]')
          ?.getAttribute('data-object-prompt-point-count'),
        receipt: document
          .querySelector('[data-testid="editor-image-preview-panel"]')
          ?.getAttribute('data-last-edit-transaction-id'),
        saves: (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [])
          .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
          .map((call) => ({ ended: call.endedAtMs, keys: Object.keys(call.args ?? {}) })),
      }));
      throw new Error(
        `Object Prompt state timed out: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)} ui=${JSON.stringify(ui)}.`,
      );
    }
  };
  const waitForPromptMode = (mode: 'background_point' | 'box') =>
    page.waitForFunction(
      (expectedMode) => {
        const latest = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(
            ({ command, endedAtMs }) =>
              command === 'save_metadata_and_update_thumbnail' && typeof endedAtMs === 'number',
          )
          .at(-1);
        const masks = latest?.args?.['editDocumentV2']?.['layers']?.['masks'];
        return (
          Array.isArray(masks) &&
          masks
            .flatMap((container) => (Array.isArray(container?.['subMasks']) ? container['subMasks'] : []))
            .find((candidate) => candidate?.['type'] === 'ai-object')?.['parameters']?.['promptMode'] === expectedMode
        );
      },
      mode,
      { timeout: 10_000 },
    );
  const restoreViewerScroll = () =>
    page.getByTestId('editor-image-preview-panel').evaluate((element) => {
      let ancestor: HTMLElement | null = element;
      while (ancestor !== null) {
        ancestor.scrollTop = 0;
        ancestor = ancestor.parentElement;
      }
      window.scrollTo(0, 0);
    });

  await page.getByTestId('right-panel-switcher-button-masks').click();
  const contextual = page.getByTestId('mask-contextual-create-ai-object');
  if ((await contextual.count()) > 0 && (await contextual.isVisible())) {
    await contextual.click();
  } else {
    await page.getByTestId('mask-creation-ai-object').click();
  }
  const controls = page.getByTestId('object-prompt-controls');
  await controls.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(600);

  const pointAt = (x: number, y: number) =>
    page.getByTestId('editor-image-preview-panel').evaluate(
      (element, point) => {
        const bounds = element.getBoundingClientRect();
        const left = Number(element.getAttribute('data-editor-image-rect-left'));
        const top = Number(element.getAttribute('data-editor-image-rect-top'));
        const width = Number(element.getAttribute('data-editor-image-rect-width'));
        const height = Number(element.getAttribute('data-editor-image-rect-height'));
        if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          throw new Error('Object Prompt surface omitted canonical image geometry.');
        }
        const targetY = bounds.top + top + height * point.y;
        if (targetY < 120 || targetY > window.innerHeight - 120) {
          window.scrollBy(0, targetY - window.innerHeight / 2);
        }
        const visibleBounds = element.getBoundingClientRect();
        return { x: visibleBounds.left + left + width * point.x, y: visibleBounds.top + top + height * point.y };
      },
      { x, y },
    );
  const clickPrompt = (point: { x: number; y: number }) =>
    page.getByTestId('editor-image-preview-panel').dispatchEvent('click', {
      bubbles: true,
      button: 0,
      clientX: point.x,
      clientY: point.y,
      detail: 1,
    });

  const foregroundBaseline = {
    overlays: await callCount('generate_mask_overlay'),
    renders: await callCount('apply_adjustments'),
    saves: await callCount('save_metadata_and_update_thumbnail'),
  };
  const foreground = await pointAt(0.3, 0.4);
  await page.getByTestId('editor-image-preview-panel').dispatchEvent('pointerup', {
    bubbles: true,
    button: 0,
    clientX: foreground.x,
    clientY: foreground.y,
    pointerId: 41,
    pointerType: 'touch',
  });
  await clickPrompt(foreground);
  await waitForPrompt({ box: false, pending: false, points: 1 });
  await page.waitForFunction(
    ({ overlays, renders, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return (
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
        calls.filter(({ command }) => command === 'apply_adjustments').length > renders &&
        calls.filter(({ command }) => command === 'generate_mask_overlay').length > overlays
      );
    },
    foregroundBaseline,
    { timeout: 10_000 },
  );
  const foregroundOverlay = page.locator('[data-object-prompt-label="foreground"]');
  await foregroundOverlay.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await callCount('save_metadata_and_update_thumbnail')) !== foregroundBaseline.saves + 1) {
    throw new Error('A synthesized touch compatibility click duplicated the Object Prompt transaction.');
  }

  await page.getByTestId('object-prompt-mode-background_point').click();
  await restoreViewerScroll();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="object-prompt-controls"]')?.getAttribute('data-object-prompt-mode') ===
      'background_point',
  );
  await waitForPromptMode('background_point');
  await page.waitForTimeout(650);
  const background = await pointAt(0.68, 0.62);
  await clickPrompt(background);
  await waitForPrompt({ box: false, pending: false, points: 2 });
  await page.locator('[data-object-prompt-label="background"]').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByTestId('object-prompt-mode-box').click();
  await restoreViewerScroll();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="object-prompt-controls"]')?.getAttribute('data-object-prompt-mode') ===
      'box',
  );
  await waitForPromptMode('box');
  await page.waitForTimeout(650);
  const anchor = await pointAt(0.2, 0.25);
  const end = await pointAt(0.76, 0.72);
  await clickPrompt(anchor);
  await waitForPrompt({ box: false, pending: true, points: 2 });
  await page.getByTestId('object-prompt-pending-box-anchor').waitFor({ state: 'visible', timeout: 10_000 });
  await clickPrompt(end);
  await waitForPrompt({ box: true, pending: false, points: 2 });
  await page.getByTestId('object-prompt-box').waitFor({ state: 'visible', timeout: 10_000 });

  const proof = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const latest = (command: string) => calls.filter((call) => call.command === command).at(-1)?.args ?? null;
    return {
      overlay: latest('generate_mask_overlay'),
      persistence: latest('save_metadata_and_update_thumbnail'),
      receipt: {
        source: document
          .querySelector('[data-testid="editor-image-preview-panel"]')
          ?.getAttribute('data-last-edit-source'),
        transactionId: document
          .querySelector('[data-testid="editor-image-preview-panel"]')
          ?.getAttribute('data-last-edit-transaction-id'),
      },
      render: latest('apply_adjustments'),
    };
  });
  const persisted = await persistedPrompt();
  const overlayPrompt = proof.overlay?.['maskDef']?.['subMasks']?.find(
    (candidate: Record<string, unknown>) => candidate['type'] === 'ai-object',
  )?.['parameters'];
  const renderDocument = editDocumentV2Schema.parse(proof.render?.['request']?.['editDocumentV2']);
  const rendered = renderDocument.layers.masks
    .flatMap((container) => container.subMasks)
    .find((candidate) => candidate.type === 'ai-object')?.parameters;
  if (
    proof.receipt.source !== 'layer-command' ||
    !proof.receipt.transactionId?.startsWith('object-prompt:') ||
    persisted === null ||
    JSON.stringify(persisted) !== JSON.stringify(overlayPrompt) ||
    JSON.stringify(persisted) !== JSON.stringify(rendered)
  ) {
    throw new Error(
      `Object Prompt persistence, overlay, render, and command receipt diverged: ${JSON.stringify(proof.receipt)}.`,
    );
  }

  await page.locator('button[data-command-id="undo"]:visible').first().click();
  await waitForPrompt({ box: false, pending: true, points: 2 });
  await page.getByTestId('object-prompt-pending-box-anchor').waitFor({ state: 'visible', timeout: 10_000 });
}

async function verifyRetouchController(page: Page): Promise<void> {
  const settledCallCount = (command: string) =>
    page.evaluate(async (expected) => {
      const read = () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === expected).length ?? 0;
      let previous = read();
      let stableFrames = 0;
      for (let frame = 0; frame < 60 && stableFrames < 8; frame += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const current = read();
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
      return previous;
    }, command);
  await page.setViewportSize({ height: 2000, width: viewport.width });
  await page.getByTestId('right-panel-switcher-button-masks').click();
  await page.getByTestId('layer-create-clone-layer').click();
  const handles = page.getByTestId('image-canvas-retouch-handles');
  await handles.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) > 0,
  );

  const imageCanvas = page.getByTestId('image-canvas');
  const pointAt = (x: number, y: number) =>
    page.getByTestId('editor-image-preview-panel').evaluate(
      (element, point) => {
        const bounds = element.getBoundingClientRect();
        const left = Number(element.getAttribute('data-editor-image-rect-left'));
        const top = Number(element.getAttribute('data-editor-image-rect-top'));
        const width = Number(element.getAttribute('data-editor-image-rect-width'));
        const height = Number(element.getAttribute('data-editor-image-rect-height'));
        if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          throw new Error('Retouch surface omitted canonical image geometry.');
        }
        return { x: bounds.left + left + width * point.x, y: bounds.top + top + height * point.y };
      },
      { x, y },
    );
  const readHandlePoint = async (handle: 'source' | 'target') => ({
    x: Number(await handles.getAttribute(`data-retouch-handle-${handle}-x`)),
    y: Number(await handles.getAttribute(`data-retouch-handle-${handle}-y`)),
  });

  const mouseTarget = await pointAt(0.68, 0.62);
  const savesBeforeMouse = await settledCallCount('save_metadata_and_update_thumbnail');
  await page.mouse.move(mouseTarget.x, mouseTarget.y);
  await page.mouse.down();
  const capturedPointerId = await imageCanvas.evaluate((element) => {
    for (let pointerId = 1; pointerId <= 32; pointerId += 1) {
      if (element.hasPointerCapture(pointerId)) return pointerId;
    }
    return null;
  });
  if (capturedPointerId === null) {
    const context = await imageCanvas.evaluate((element) => ({
      activeTool: element.getAttribute('data-viewer-active-tool'),
      canvasTool: element.getAttribute('data-canvas-overlay-tool'),
      owner: element.getAttribute('data-viewer-input-owner'),
    }));
    throw new Error(`Retouch gesture did not use canonical pointer capture: ${JSON.stringify(context)}.`);
  }
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="image-canvas"]')?.getAttribute('data-retouch-last-commit-status') !==
      'none',
  );
  const mouseCommitStatus = await imageCanvas.getAttribute('data-retouch-last-commit-status');
  if (!mouseCommitStatus?.startsWith('committed:')) {
    throw new Error(`Mouse retouch command was rejected: ${String(mouseCommitStatus)}.`);
  }
  await page.waitForFunction(
    (baseline) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) > baseline,
    savesBeforeMouse,
    { timeout: 10_000 },
  );
  const mouseCommittedTarget = await readHandlePoint('target');

  const touchTarget = await pointAt(0.76, 0.7);
  const savesBeforeTouch = await settledCallCount('save_metadata_and_update_thumbnail');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    touchPoints: [{ force: 1, id: 19, radiusX: 1, radiusY: 1, x: touchTarget.x, y: touchTarget.y }],
    type: 'touchStart',
  });
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await page.waitForFunction(
    (baseline) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) > baseline,
    savesBeforeTouch,
    { timeout: 10_000 },
  );

  const proof = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const latest = (command: string) => calls.filter((call) => call.command === command).at(-1)?.args ?? null;
    const handles = document.querySelector('[data-testid="image-canvas-retouch-handles"]');
    const preview = document.querySelector('[data-testid="editor-image-preview-panel"]');
    return {
      overlay: {
        sourceX: Number(handles?.getAttribute('data-retouch-handle-source-x')),
        sourceY: Number(handles?.getAttribute('data-retouch-handle-source-y')),
        targetX: Number(handles?.getAttribute('data-retouch-handle-target-x')),
        targetY: Number(handles?.getAttribute('data-retouch-handle-target-y')),
      },
      persistence: latest('save_metadata_and_update_thumbnail'),
      receipt: {
        source: preview?.getAttribute('data-last-edit-source'),
        transactionId: preview?.getAttribute('data-last-edit-transaction-id'),
      },
      render: latest('apply_adjustments'),
    };
  });
  const persistedDocument = editDocumentV2Schema.parse(proof.persistence?.['editDocumentV2']);
  const persistedLayer = persistedDocument.layers.masks.find(
    (layer: Record<string, unknown>) => typeof layer['retouchCloneSource'] === 'object',
  );
  const persistedSource = persistedLayer?.['retouchCloneSource'];
  const renderDocument = editDocumentV2Schema.parse(proof.render?.['request']?.['editDocumentV2']);
  const renderedLayer = renderDocument.layers.masks.find((layer) => layer.retouchCloneSource !== undefined);
  if (
    proof.receipt.source !== 'layer-command' ||
    !proof.receipt.transactionId?.startsWith('retouch-handle:') ||
    typeof persistedSource !== 'object' ||
    persistedSource === null ||
    renderedLayer?.retouchCloneSource === undefined ||
    JSON.stringify(persistedSource['targetPoint']) !== JSON.stringify(renderedLayer.retouchCloneSource.targetPoint) ||
    proof.overlay.targetX !== renderedLayer.retouchCloneSource.targetPoint.x ||
    proof.overlay.targetY !== renderedLayer.retouchCloneSource.targetPoint.y
  ) {
    throw new Error(`Retouch persistence, render, overlay, and command receipt diverged: ${JSON.stringify(proof)}.`);
  }

  await page.locator('button[data-command-id="undo"]:visible').first().click();
  await page.waitForFunction(({ x, y }) => {
    const handles = document.querySelector('[data-testid="image-canvas-retouch-handles"]');
    return (
      Number(handles?.getAttribute('data-retouch-handle-target-x')) === x &&
      Number(handles?.getAttribute('data-retouch-handle-target-y')) === y
    );
  }, mouseCommittedTarget);
}

async function waitForDevServer(server: ReturnType<typeof spawn>): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite exited before ${baseUrl} became available.`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (server.exitCode !== null || server.signalCode !== null) {
          throw new Error(`Vite exited after ${baseUrl} became available.`);
        }
        const confirmation = await fetch(baseUrl);
        if (confirmation.ok) return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopServer(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => {
      server.once('exit', resolve);
    }),
    new Promise((resolve) =>
      setTimeout(() => {
        server.kill('SIGKILL');
        resolve(undefined);
      }, 5_000),
    ),
  ]);
}

async function verifyNoArgumentWaitTimeoutOptions(page: Page): Promise<void> {
  page.setDefaultTimeout(800);
  const startedAt = performance.now();
  let rejected = false;
  try {
    await waitForPageCondition(page, () => false, { polling: 10, timeout: 75 });
  } catch {
    rejected = true;
  } finally {
    page.setDefaultTimeout(30_000);
  }
  const elapsedMs = performance.now() - startedAt;
  if (!rejected) throw new Error('Unsatisfied Playwright page condition did not reject.');
  if (elapsedMs < 50 || elapsedMs >= 400) {
    throw new Error(
      `No-argument Playwright wait ignored its 75ms options-slot timeout (elapsed ${elapsedMs.toFixed(1)}ms).`,
    );
  }
}

const server = spawn('bun', ['run', 'dev', '--', '--host', host, '--port', String(port)], {
  env: {
    ...process.env,
    RAWENGINE_DEV_SERVER_PORT: String(port),
    VITE_RAWENGINE_AGENT_AUDIT_E2E: runAgentAuditE2e ? '1' : '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
const captureServerOutput = (chunk: Buffer) => {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
};
server.stdout.on('data', captureServerOutput);
server.stderr.on('data', captureServerOutput);

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;

try {
  await waitForDevServer(server);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    hasTouch:
      browserScenario === 'initial-mask-draw-controller' ||
      browserScenario === 'ai-mask-box-controller' ||
      browserScenario === 'object-prompt-controller' ||
      browserScenario === 'parametric-mask-target-controller' ||
      browserScenario === 'retouch-controller',
    viewport,
  });
  await verifyNoArgumentWaitTimeoutOptions(page);
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location().url;
      consoleErrors.push(location ? `${message.text()} (${location})` : message.text());
    } else if (message.type() === 'warning' && !message.text().startsWith('Clerk:')) {
      consoleWarnings.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  await installBrowserProofNetworkBoundary(page);
  if (browserScenario === 'preview-url-lifetime') {
    await page.addInitScript(() => {
      const created: string[] = [];
      const imageErrors: string[] = [];
      const revoked: string[] = [];
      const createObjectURL = URL.createObjectURL.bind(URL);
      const revokeObjectURL = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob): string => {
        const url = createObjectURL(blob);
        created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url: string): void => {
        revoked.push(url);
        revokeObjectURL(url);
      };
      window.addEventListener(
        'error',
        (event) => {
          const target = event.target;
          if (target instanceof HTMLImageElement || target instanceof SVGImageElement) {
            imageErrors.push(target.getAttribute('src') ?? target.getAttribute('href') ?? 'unknown-image');
          }
        },
        true,
      );
      Reflect.set(window, '__RAWENGINE_PREVIEW_URL_AUDIT__', { created, imageErrors, revoked });
    });
  }
  await page.route('https://api.github.com/repos/CyberTimon/RapidRAW/releases/latest', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        html_url: 'https://github.com/CyberTimon/RapidRAW/releases/latest',
        tag_name: 'v0.0.0-browser-harness',
      },
      status: 200,
    });
  });

  const pageUrl = browserScenario === 'full' ? `${baseUrl}?qaPersistedRecovery=1` : baseUrl;
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'RapidRAW' }).waitFor({ timeout: 30_000 });
  await verifySchemaOwnedTauriTransport(page);
  await verifyEditorRenderAuthorityBoundary(page);
  await page.getByRole('button', { name: /Open Folder/u }).click();
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.evaluate(() => {
    const harness = window.__RAWENGINE_BROWSER_TAURI_HARNESS__;
    if (!harness) throw new Error('Browser Tauri harness was not installed before image open.');
    harness.holdNextImageOpenCompletion();
  });
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  const provisionalBadge = page.getByTestId('embedded-preview-provisional-badge');
  await page.waitForFunction(
    () => {
      const badge = document.querySelector('[data-testid="embedded-preview-provisional-badge"]');
      if (!(badge instanceof HTMLElement)) return false;
      const style = getComputedStyle(badge);
      return style.display !== 'none' && style.visibility !== 'hidden' && badge.textContent?.includes('Camera preview');
    },
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.releaseHeldImageOpenCompletion() !== true) {
      throw new Error('Browser Tauri harness did not hold the selected image-open completion.');
    }
  });
  await provisionalBadge.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await page.getByRole('region', { name: 'Editor preview' }).waitFor({ timeout: 10_000 });
  await page.getByRole('region', { name: 'Image preview' }).waitFor({ timeout: 10_000 });
  const imageCanvas = page.getByTestId('image-canvas');
  await imageCanvas.waitFor({ timeout: 10_000 });
  if (browserScenario === 'full') {
    const recoveryToast = page.getByText('Recovered incompatible saved edits and reopened with safe render state.', {
      exact: false,
    });
    await recoveryToast.waitFor({ timeout: 10_000 });
    if ((await recoveryToast.count()) !== 1) {
      throw new Error('Persisted render recovery must publish one bounded diagnostic.');
    }
    if ((await page.getByText('Failed to load image:', { exact: false }).count()) !== 0) {
      throw new Error('Recovered current authority incorrectly failed the decoded image session.');
    }
  }
  if (browserScenario === 'preview-url-lifetime') {
    await verifyPreviewUrlLifetime(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected preview URL lifetime browser errors: ${consoleErrors.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('preview URL lifetime browser proof passed');
    process.exit(0);
  }
  if (browserScenario === 'analytics-artifact-authority') {
    await verifyPreviewAnalyticsArtifactAuthority(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected analytics-authority browser errors: ${consoleErrors.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('preview analytics artifact authority browser proof passed');
    process.exit(0);
  }
  if (browserScenario === 'initial-mask-draw-controller') {
    await verifyInitialMaskDrawController(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected initial-mask browser errors: ${consoleErrors.join('\n')}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`Unexpected initial-mask browser warnings: ${consoleWarnings.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('initial mask draw browser controller proof passed');
    process.exit(0);
  }
  if (browserScenario === 'parametric-mask-target-controller') {
    await verifyParametricMaskTargetController(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected parametric-mask browser errors: ${consoleErrors.join('\n')}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`Unexpected parametric-mask browser warnings: ${consoleWarnings.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('parametric mask target browser controller proof passed');
    process.exit(0);
  }
  if (browserScenario === 'object-prompt-controller') {
    await verifyObjectPromptController(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected Object Prompt browser errors: ${consoleErrors.join('\n')}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`Unexpected Object Prompt browser warnings: ${consoleWarnings.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('Object Prompt browser controller proof passed');
    process.exit(0);
  }
  if (browserScenario === 'ai-mask-box-controller') {
    await verifyAiMaskBoxController(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected AI mask box browser errors: ${consoleErrors.join('\n')}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`Unexpected AI mask box browser warnings: ${consoleWarnings.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('AI mask box browser controller proof passed');
    process.exit(0);
  }
  if (browserScenario === 'retouch-controller') {
    await verifyRetouchController(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected retouch browser errors: ${consoleErrors.join('\n')}`);
    }
    if (consoleWarnings.length > 0) {
      throw new Error(`Unexpected retouch browser warnings: ${consoleWarnings.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('retouch browser controller proof passed');
    process.exit(0);
  }
  await verifyPreviewBoundsScenario(page, boundsSamples);
  if (browserScenario === 'preview-visible-frame') {
    await verifyEditorIntrinsicHeightContainment(page);
    await verifyVisiblePreviewReopen(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected visible-frame browser errors: ${consoleErrors.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('preview visible-frame reopen and zoom proof passed');
    process.exit(0);
  }
  if (browserScenario === 'viewport-controller') {
    await verifyViewportInteractionController(page);
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected viewport-controller browser errors: ${consoleErrors.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('viewer viewport browser controller proof passed');
    process.exit(0);
  }
  const commandOverflowButton = page.getByTestId('editor-command-overflow-trigger');
  await commandOverflowButton.click();
  const splitCompareButton = page.getByRole('menuitemcheckbox', { name: /Compare split wipe/u });
  const sideBySideCompareButton = page.getByRole('menuitemcheckbox', { name: /Compare side by side/u });
  await splitCompareButton.waitFor({ timeout: 10_000 });
  await sideBySideCompareButton.waitFor({ timeout: 10_000 });
  const originalPreviewBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'generate_original_transformed_preview',
      ).length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.originalPreviewResponses.push(
      {
        delayMs: 700,
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='red'/%3E%3C/svg%3E",
      },
      {
        delayMs: 30,
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Crect width='4' height='3' fill='green'/%3E%3C/svg%3E",
      },
    );
  });
  await splitCompareButton.click();
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'generate_original_transformed_preview',
      ).length ?? 0) === expected,
    originalPreviewBaseline + 1,
    { timeout: 10_000 },
  );
  await page.getByTestId('viewer-footer-zoom-select').selectOption('1');
  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'generate_original_transformed_preview',
      ).length ?? 0) === expected,
    originalPreviewBaseline + 2,
    { timeout: 10_000 },
  );
  await imageCanvas.waitFor({ timeout: 10_000 });
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'split-wipe') {
    throw new Error('Split-wipe compare mode did not activate on the image canvas.');
  }
  await page.getByTestId('editor-compare-split-divider').waitFor({ timeout: 10_000 });
  await verifyCompareDividerController(page);
  if (browserScenario === 'compare-divider-controller') {
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected compare-divider browser errors: ${consoleErrors.join('\n')}`);
    }
    await writeBoundsReport('passed');
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('compare divider browser controller proof passed');
    process.exit(0);
  }
  await page.waitForTimeout(750);
  if ((await imageCanvas.getAttribute('data-editor-compare-original-ready')) !== 'true') {
    throw new Error('A late superseded original completion replaced the visible current compare artifact.');
  }
  await commandOverflowButton.click();
  await sideBySideCompareButton.click();
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'side-by-side') {
    throw new Error('Side-by-side compare mode did not activate on the image canvas.');
  }
  await page.getByTestId('editor-compare-side-by-side-preview').waitFor({ timeout: 10_000 });
  await commandOverflowButton.click();
  await sideBySideCompareButton.click();
  if ((await imageCanvas.getAttribute('data-editor-compare-mode')) !== 'off') {
    throw new Error('Compare mode did not return to off after toggling side-by-side.');
  }
  await page.getByTestId('viewer-footer-zoom-select').selectOption('fit');
  await waitForStablePreview(page);
  await assertVisibleNonEmptyPreviewPixels(
    page,
    'fit-after-image-select',
    '/tmp/rawengine-browser-harness/browser-harness.ARW',
  );
  await page.getByRole('complementary', { name: 'Editor tools' }).waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { exact: true, name: 'Color' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.getByTestId('adjustments-inspector').waitFor({ timeout: 10_000 });
  await verifyAutoEditTransactionBoundary(page);
  await verifyBatchAutoAdjustTransactionBoundary(page);
  const exposureValue = page.getByTestId('basic-control-exposure-value');
  const applyBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
        .length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.applyPreviewResponses.push(
      { color: [220, 20, 20], delayMs: 700 },
      { color: [20, 20, 220], delayMs: 350 },
      { color: [20, 220, 20], delayMs: 30 },
    );
  });
  for (const [index, exposure] of ['0.10', '0.20', '0.75'].entries()) {
    await exposureValue.click();
    const exposureInput = page.getByTestId('basic-control-exposure-input');
    await exposureInput.fill(exposure);
    await exposureInput.press('Enter');
    await exposureValue.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      (expected) =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments')
          .length ?? 0) >= expected,
      applyBaseline + index + 1,
      { timeout: 10_000 },
    );
  }
  if ((await exposureValue.textContent())?.trim() !== '0.75') {
    throw new Error('Exposure numeric control did not commit the requested value.');
  }
  await page.waitForTimeout(800);
  const editedPreviewPixel = await page.evaluate(async () => {
    const layers = [...document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]')];
    const visible = layers.findLast((layer) => Number.parseFloat(getComputedStyle(layer).opacity) > 0.99);
    const href = visible?.getAttribute('href');
    if (!href) return null;
    const image = new Image();
    image.src = href;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(image, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  });
  if (
    editedPreviewPixel === null ||
    editedPreviewPixel[1] === undefined ||
    editedPreviewPixel[0] === undefined ||
    editedPreviewPixel[2] === undefined ||
    editedPreviewPixel[1] < 160 ||
    editedPreviewPixel[0] > 80 ||
    editedPreviewPixel[2] > 80
  ) {
    throw new Error(
      'Reordered edited-preview completion did not preserve the green A-successor: ' +
        JSON.stringify(editedPreviewPixel),
    );
  }
  await waitForPageCondition(
    page,
    () => {
      const request = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'apply_adjustments')
        .at(-1)?.args?.['request'];
      if (typeof request !== 'object' || request === null) return false;
      const document = request['editDocumentV2'];
      if (typeof document !== 'object' || document === null) return false;
      const nodes = document['nodes'];
      if (typeof nodes !== 'object' || nodes === null) return false;
      const toneNode = nodes['scene_global_color_tone'];
      if (typeof toneNode !== 'object' || toneNode === null) return false;
      const params = toneNode['params'];
      return typeof params === 'object' && params !== null && params['exposure'] === 0.75;
    },
    { timeout: 10_000 },
  );
  const persistenceBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.metadataSaveResponses.push(
      { delayMs: 700, sidecarRevision: `sha256:${'b'.repeat(64)}` },
      { delayMs: 30, sidecarRevision: `sha256:${'c'.repeat(64)}` },
    );
  });
  for (const [index, exposure] of ['0.80', '0.90'].entries()) {
    await exposureValue.click();
    const exposureInput = page.getByTestId('basic-control-exposure-input');
    await exposureInput.fill(exposure);
    await exposureInput.press('Enter');
    await page.waitForFunction(
      ({ expected, persistenceCommand }) =>
        (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === persistenceCommand)
          .length ?? 0) >= expected,
      {
        expected: persistenceBaseline + index + 1,
        persistenceCommand: 'save_metadata_and_update_thumbnail',
      },
      { timeout: 10_000 },
    );
  }
  await page.waitForFunction(
    ({ firstIndex, persistenceCommand, secondIndex }) => {
      const saves =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === persistenceCommand) ?? [];
      return saves[firstIndex]?.endedAtMs !== null && saves[secondIndex]?.endedAtMs !== null;
    },
    {
      firstIndex: persistenceBaseline,
      persistenceCommand: 'save_metadata_and_update_thumbnail',
      secondIndex: persistenceBaseline + 1,
    },
    { timeout: 10_000 },
  );
  const reorderedPersistenceProof = await page.evaluate(
    ({ firstIndex, persistenceCommand, secondIndex }) => {
      const saves =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === persistenceCommand) ?? [];
      return {
        firstEndedAtMs: saves[firstIndex]?.endedAtMs ?? null,
        secondStartedAtMs: saves[secondIndex]?.startedAtMs ?? null,
        secondEndedAtMs: saves[secondIndex]?.endedAtMs ?? null,
        secondTransaction: saves[secondIndex]?.args?.['transaction'] ?? null,
      };
    },
    {
      firstIndex: persistenceBaseline,
      persistenceCommand: 'save_metadata_and_update_thumbnail',
      secondIndex: persistenceBaseline + 1,
    },
  );
  if (
    reorderedPersistenceProof.firstEndedAtMs === null ||
    reorderedPersistenceProof.secondStartedAtMs === null ||
    reorderedPersistenceProof.secondEndedAtMs === null ||
    reorderedPersistenceProof.secondStartedAtMs < reorderedPersistenceProof.firstEndedAtMs
  ) {
    throw new Error(
      `Successor persistence overlapped its delayed predecessor: ${JSON.stringify(reorderedPersistenceProof)}`,
    );
  }
  if (reorderedPersistenceProof.secondTransaction === null) {
    throw new Error('Current persistence request did not carry committed edit transaction authority.');
  }
  if ((await exposureValue.textContent())?.trim() !== '0.90') {
    throw new Error('A stale persistence completion displaced the current editor adjustment.');
  }
  if (browserScenario === 'persistence-session-authority') {
    const saveCount = persistenceBaseline + 2;
    await page.getByTestId('viewer-footer-zoom-select').selectOption('1');
    await waitForStablePreview(page);
    await page.waitForTimeout(100);
    const savesAfterPreview = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'save_metadata_and_update_thumbnail',
        ).length ?? 0,
    );
    if (savesAfterPreview !== saveCount) {
      throw new Error('Preview/zoom execution acquired persistence authority without a committed edit transaction.');
    }
    await page
      .locator('button[data-command-id="back-to-library"]:visible')
      .first()
      .evaluate((element) => {
        if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library is not a button.');
        element.click();
      });
    await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
    await page
      .getByRole('button', { name: /browser-harness\.ARW/u })
      .first()
      .dblclick();
    await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
    await page.getByTestId('image-canvas').waitFor({ timeout: 10_000 });
    await page.getByTestId('embedded-preview-provisional-badge').waitFor({ state: 'hidden', timeout: 10_000 });
    await waitForStablePreview(page);
    const reopenedInspector = page.getByTestId('adjustments-inspector');
    if (!(await reopenedInspector.isVisible())) {
      await page.getByTestId('right-panel-switcher-button-adjustments').click();
    }
    await reopenedInspector.waitFor({ timeout: 10_000 });
    const reopenedExposure = page.getByTestId('basic-control-exposure-value');
    await reopenedExposure.waitFor({ timeout: 10_000 });
    if ((await reopenedExposure.textContent())?.trim() !== '0.90') {
      throw new Error('Reopened session did not hydrate the newest serialized sidecar revision.');
    }
    const reopenedProof = await page.evaluate(() => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const request = calls.filter(({ command }) => command === 'apply_adjustments').at(-1)?.args?.['request'];
      const saves = calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length;
      return { request, saves };
    });
    const reopenedDocument = editDocumentV2Schema.parse(
      typeof reopenedProof.request === 'object' && reopenedProof.request !== null
        ? reopenedProof.request['editDocumentV2']
        : null,
    );
    if (reopenedDocument.nodes.scene_global_color_tone?.params['exposure'] !== 0.9) {
      throw new Error('Reopened preview did not render the newest persisted edit document.');
    }
    if (reopenedProof.saves !== saveCount) {
      throw new Error('Session reopen/native hydration emitted a duplicate persistence write.');
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected persistence-session browser errors: ${consoleErrors.join('\n')}`);
    }
    await browser.close();
    browser = undefined;
    await stopServer(server);
    console.log('persistence session authority browser proof passed');
    process.exit(0);
  }
  const editDocumentPreviewProof = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter((candidate) => candidate.command === 'apply_adjustments')
      .at(-1);
    const request = call?.args?.['request'];
    return typeof request === 'object' && request !== null ? request : null;
  });
  if (editDocumentPreviewProof === null || 'jsAdjustments' in editDocumentPreviewProof) {
    throw new Error('Editor preview did not retire the flat adjustments render payload.');
  }
  const previewEditDocument = editDocumentV2Schema.parse(editDocumentPreviewProof['editDocumentV2']);
  if (previewEditDocument.nodes.scene_global_color_tone?.params['exposure'] !== 0.9) {
    throw new Error('Exposure UI edit did not reach the scene_global_color_tone render node.');
  }
  if (
    JSON.stringify(previewEditDocument.nodes.source_artifacts?.params) !==
    JSON.stringify(previewEditDocument.sourceArtifacts)
  ) {
    throw new Error('Preview source-artifact node disagreed with its explicit render domain.');
  }
  if ('referenceMatchApplicationReceipt' in (previewEditDocument.nodes.source_artifacts?.params ?? {})) {
    throw new Error('Preview source artifacts incorrectly carried reference-match provenance.');
  }
  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByRole('heading', { exact: true, name: 'Color' }).waitFor({ timeout: 10_000 });
  await verifySceneCurveTransaction(page);
  await verifyColorCalibrationTransaction(page);
  await verifyViewerPickerControllers(page);
  // Mixer controls live in the explicit Mixer workspace tab.  Do not rely on
  // the session's last tab: CI and fresh installs correctly default to
  // Foundation, which otherwise makes the mixer proof time out.
  await page.getByTestId('color-workspace-tab-mixer').click();
  await verifyBlackWhiteMixerTransaction(page);
  await verifyChannelMixerTransaction(page);
  await verifyColorRangeLocalAdjustmentTransaction(page);
  const viewerFooterOverflow = page.getByTestId('viewer-footer-overflow');
  if (await viewerFooterOverflow.isVisible()) {
    await viewerFooterOverflow.locator('summary').click();
  }
  await page.getByText(runAgentAuditE2e ? /4 x 4/u : /1024 x 768/u).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Show crop tools/u }).click();
  await page.getByRole('heading', { name: 'Crop' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: /Straighten Tool/u }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Control+K');
  await page.getByRole('dialog', { name: /Command Palette/u }).waitFor({ timeout: 10_000 });
  await page.getByLabel(/Search commands/u).fill('negative');
  await page.getByRole('button', { name: /Open negative lab/u }).click();
  await page.getByRole('heading', { name: 'Negative Conversion' }).waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preview-image').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-workspace').getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('negative-lab-workspace').waitFor({ state: 'detached', timeout: 10_000 });
  if (runAgentAuditE2e) {
    await page.getByTestId('right-panel-switcher-button-agent').click();
    const auditWorkspace = page.getByTestId('agent-audit-export-workspace');
    await auditWorkspace.waitFor({ timeout: 10_000 });
    await page.getByTestId('agent-review-control-dry-run').click();
    const approveApply = page.getByTestId('agent-review-control-apply');
    await expectEnabled(approveApply, 'Agent approve/apply');
    await approveApply.click();
    const exportAudit = page.getByTestId('agent-review-control-export');
    await expectEnabled(exportAudit, 'Agent audit export');
    const [auditDownload] = await Promise.all([page.waitForEvent('download'), exportAudit.click()]);
    const auditDownloadPath = await auditDownload.path();
    if (auditDownloadPath === null) throw new Error('Browser fallback audit download did not produce an artifact.');
    const exportedAudit = agentSelectedImageLiveSessionAuditExportReceiptSchema.parse(
      JSON.parse(await Bun.file(auditDownloadPath).text()),
    );
    if (
      exportedAudit.proposalLineage === undefined ||
      exportedAudit.proposalLineage.iterations.length === 0 ||
      exportedAudit.proposalLineage.iterations.some((iteration) => !iteration.proposalHash.startsWith('sha256:'))
    ) {
      throw new Error('Browser audit export omitted sealed proposal lineage hashes.');
    }
    await page.getByTestId('agent-audit-export-result').waitFor({ timeout: 10_000 });
    const auditProof = await auditWorkspace.evaluate((element) => ({
      mode: element.dataset.exportMode,
      output: element.dataset.exportOutput,
      preflight: element.dataset.replayPreflight,
      validation: element.dataset.exportValidation,
    }));
    if (auditProof.mode !== 'browser_fallback' || auditProof.validation !== 'valid') {
      throw new Error(`Browser audit export was mislabeled or invalid: ${JSON.stringify(auditProof)}`);
    }
    if (auditProof.output !== auditDownload.suggestedFilename()) {
      throw new Error('Browser audit export UI did not report the fallback filename.');
    }
    if (auditProof.preflight !== exportedAudit.replayPreflight.status) {
      throw new Error('Browser audit export UI did not report the parsed replay preflight status.');
    }
    const auditTimeline = await page.getByTestId('agent-audit-export-timeline-entry').evaluate((element) => ({
      graphRevision: element.dataset.graphRevision,
      output: element.dataset.output,
      requestId: element.dataset.requestId,
      toolName: element.dataset.toolName,
    }));
    if (
      !auditTimeline.requestId?.includes('workspace-audit-export') ||
      auditTimeline.toolName !== 'rawengine.agent.audit.export' ||
      !auditTimeline.graphRevision ||
      auditTimeline.output !== auditProof.output
    ) {
      throw new Error(`Browser audit export timeline proof is incomplete: ${JSON.stringify(auditTimeline)}`);
    }
  }
  await page.keyboard.press('Control+K');
  const commandPaletteForCopyPaste = page.getByRole('dialog', { name: /Command Palette/u });
  await commandPaletteForCopyPaste.waitFor({ timeout: 10_000 });
  await commandPaletteForCopyPaste.getByLabel(/Search commands/u).fill('copy paste');
  await commandPaletteForCopyPaste.getByRole('button', { name: /Copy and paste settings/u }).click();
  const copyPasteDialog = page.getByRole('dialog', { name: /Copy & Paste Settings/u });
  await copyPasteDialog.waitFor({ timeout: 10_000 });
  if (
    (await copyPasteDialog.getByRole('checkbox').count()) !== EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES.length ||
    (await copyPasteDialog.getByText('Tone', { exact: true }).count()) !== 1 ||
    (await copyPasteDialog.getByText('Profile & Tone', { exact: true }).count()) !== 1 ||
    (await copyPasteDialog.getByText('Masks', { exact: true }).count()) !== 0 ||
    (await copyPasteDialog.getByText('Dust Spot Visualization', { exact: true }).count()) !== 0
  ) {
    throw new Error('Copy & Paste Settings diverged from descriptor-approved node availability.');
  }
  const saveButton = copyPasteDialog.getByRole('button', { name: 'Save' });
  await saveButton.waitFor({ timeout: 10_000 });
  const saveBox = await saveButton.boundingBox();
  if (saveBox === null || saveBox.y + saveBox.height > 720 || saveBox.y < 0) {
    throw new Error('Copy & Paste Settings Save button is outside the constrained viewport.');
  }
  const unlabeledIconButtons = await page.locator('button').evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const rect = button.getBoundingClientRect();
        const label =
          button.getAttribute('aria-label')?.trim() ||
          button.getAttribute('title')?.trim() ||
          button.textContent?.trim() ||
          '';
        const isDecorativeDisabledIndicator =
          button.disabled && button.classList.contains('cursor-default') && button.classList.contains('bg-transparent');
        return {
          index,
          isDecorativeDisabledIndicator,
          label,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((button) => button.visible && button.label.length === 0 && !button.isDecorativeDisabledIndicator)
      .map((button) => button.index),
  );
  if (unlabeledIconButtons.length > 0) {
    throw new Error(`Visible icon buttons missing accessible names: ${unlabeledIconButtons.join(', ')}`);
  }

  const harnessProof = await page.evaluate(() => ({
    calls: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.map((call) => call.command) ?? [],
    enabled: window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.enabled === true,
    hasTauriInternals: window.__TAURI_INTERNALS__ !== undefined,
    originalPreviewRequests:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'generate_original_transformed_preview')
        .map((call) => call.args) ?? [],
    startupRecords:
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter((call) => call.command === 'record_frontend_startup_phase')
        .map((call) => call.args) ?? [],
  }));
  if (!harnessProof.enabled || !harnessProof.hasTauriInternals) {
    throw new Error('Browser Tauri harness was not installed.');
  }
  if (
    harnessProof.originalPreviewRequests.length < 2 ||
    harnessProof.originalPreviewRequests.some(
      (request) =>
        request?.['expectedImagePath'] !== '/tmp/rawengine-browser-harness/browser-harness.ARW' ||
        typeof request?.['viewerSampleGraphRevision'] !== 'string',
    )
  ) {
    throw new Error(
      'Original preview effects did not preserve exact source and graph identity across zoom replacement.',
    );
  }
  for (const requiredCommand of [
    'load_settings',
    'get_supported_file_types',
    'frontend_ready',
    'get_startup_trace',
    'record_frontend_startup_phase',
    'plugin:dialog|open',
    'get_folder_tree',
    'begin_image_open',
    'apply_adjustments',
    'generate_original_transformed_preview',
  ]) {
    if (!harnessProof.calls.includes(requiredCommand)) {
      throw new Error(`Browser Tauri harness did not record ${requiredCommand}.`);
    }
  }
  const frontendReadyIndex = harnessProof.calls.indexOf('frontend_ready');
  const getTraceIndex = harnessProof.calls.indexOf('get_startup_trace');
  const firstPhaseIndex = harnessProof.calls.indexOf('record_frontend_startup_phase');
  if (!(frontendReadyIndex < getTraceIndex && getTraceIndex < firstPhaseIndex)) {
    throw new Error('Frontend startup phases were not correlated after native readiness and trace acquisition.');
  }
  const startupPhases = harnessProof.startupRecords.map((args) => args?.['phase']);
  for (const expectedPhase of ['shellVisible', 'interactive', 'settingsHydrated', 'libraryReady']) {
    if (!startupPhases.includes(expectedPhase)) {
      throw new Error(`Browser Tauri harness did not record startup phase ${expectedPhase}.`);
    }
  }
  const actionableErrors = consoleErrors.filter(
    (message) =>
      !message.includes('React does not recognize the') &&
      !message.includes('Clerk:') &&
      !message.includes('[vite] failed to connect to websocket') &&
      !message.includes('Failed to send error to Vite server') &&
      !message.includes(`WebSocket connection to 'ws://${host}:${port}/`),
  );
  if (actionableErrors.length > 0) {
    throw new Error(`Unexpected browser harness console errors: ${actionableErrors.slice(0, 5).join(' | ')}`);
  }
  console.log('browser tauri harness ok');
} catch (error) {
  console.error('browser tauri harness failed');
  if (page !== undefined) {
    await writeBoundsReport('failed');
    await page.screenshot({ fullPage: false, path: failureScreenshotPath }).catch(() => undefined);
    console.error(
      `bounds evidence: ${relative(process.cwd(), boundsReportPath)}; screenshot: ${relative(
        process.cwd(),
        failureScreenshotPath,
      )}`,
    );
  }
  if (serverOutput.trim()) console.error(`Vite ${baseUrl} output excerpt:\n${serverOutput.trim()}`);
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stopServer(server);
}

async function expectEnabled(locator: Locator, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (await locator.isDisabled()) {
    if (Date.now() >= deadline) throw new Error(`${label} did not become enabled.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function verifyAutoEditTransactionBoundary(page: Page): Promise<void> {
  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.waitFor({ timeout: 10_000 });
  if (!(await undo.isDisabled())) throw new Error('Auto Edit proof did not begin at the initial history boundary.');

  const saveCount = async () =>
    page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'save_metadata_and_update_thumbnail',
        ).length ?? 0,
    );
  const baselineSaves = await saveCount();
  const autoAdjust = page.getByRole('button', { name: 'Auto Adjust Image' });

  await autoAdjust.click();
  const review = page.getByTestId('auto-edit-review');
  await review.waitFor({ timeout: 10_000 });
  await waitForPageCondition(
    page,
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.some(
        ({ command }) => command === 'preview_auto_edit_proposal',
      ) === true,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(450);
  if (!(await undo.isDisabled()) || (await saveCount()) !== baselineSaves) {
    throw new Error('Auto Edit preview mutated canonical history or persistence.');
  }

  await review.getByRole('button', { name: 'Cancel Auto Adjust' }).click();
  await review.waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(450);
  if (!(await undo.isDisabled()) || (await saveCount()) !== baselineSaves) {
    throw new Error('Auto Edit cancel mutated canonical history or persistence.');
  }

  await autoAdjust.click();
  await review.waitFor({ timeout: 10_000 });
  await review.getByRole('button', { exact: true, name: 'Apply' }).click();
  await review.waitFor({ state: 'detached', timeout: 10_000 });
  await expectEnabled(undo, 'Undo after Auto Edit acceptance');
  await page.waitForFunction(
    (expectedCount) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expectedCount,
    baselineSaves + 1,
    { timeout: 10_000 },
  );

  const persisted = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .at(-1);
    return call?.args ?? null;
  });
  const persistedDocument = persisted?.['editDocumentV2'];
  const persistedNodes =
    persistedDocument !== null && typeof persistedDocument === 'object' && !Array.isArray(persistedDocument)
      ? (persistedDocument as Record<string, unknown>)['nodes']
      : null;
  const globalToneNode =
    persistedNodes !== null && typeof persistedNodes === 'object' && !Array.isArray(persistedNodes)
      ? (persistedNodes as Record<string, unknown>)['scene_global_color_tone']
      : null;
  const globalToneParams =
    globalToneNode !== null && typeof globalToneNode === 'object' && !Array.isArray(globalToneNode)
      ? (globalToneNode as Record<string, unknown>)['params']
      : null;
  if (
    globalToneParams === null ||
    typeof globalToneParams !== 'object' ||
    Array.isArray(globalToneParams) ||
    (globalToneParams as Record<string, unknown>)['exposure'] !== 0.5 ||
    persisted?.['transaction']?.['transactionId'] !== 'blake3:browser-harness-auto-edit-transaction' ||
    typeof persisted?.['transaction']?.['baseAdjustmentRevision'] !== 'number' ||
    persisted['transaction']['nextAdjustmentRevision'] !== persisted['transaction']['baseAdjustmentRevision'] + 1
  ) {
    throw new Error(
      `Auto Edit acceptance did not persist one revision-scoped transaction: ${JSON.stringify(persisted)}`,
    );
  }
}

async function verifyBatchAutoAdjustTransactionBoundary(page: Page): Promise<void> {
  const counts = async () =>
    page.evaluate(() => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return {
        autoAdjust: calls.filter(({ command }) => command === 'apply_auto_adjustments_to_paths').length,
        commit: calls.filter(({ command }) => command === 'commit_batch_auto_adjustment').length,
        metadataLoad: calls.filter(({ command }) => command === 'load_metadata').length,
        metadataSave: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
      };
    });
  const invokeFromContextMenu = async () => {
    await page.waitForFunction(
      () => document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
      undefined,
      { timeout: 10_000 },
    );
    const selectedPath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
    if (!selectedPath) throw new Error('Selected editor path was unavailable for Batch Auto Adjust proof.');
    const targetThumbnail = page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${selectedPath}"]`);
    const menuDiagnostics = async (reason: string, attempt: number) => ({
      attempt,
      reason,
      targetBox: await targetThumbnail.boundingBox(),
      targetCount: await targetThumbnail.count(),
      ...(await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const visibleItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .filter((item) => item.getClientRects().length > 0)
          .map((item) => ({
            expanded: item.getAttribute('aria-expanded'),
            path: item.dataset.menuItemPath ?? null,
            text: item.textContent?.trim() ?? '',
          }));
        return {
          active: active
            ? {
                disabled: 'disabled' in active && Boolean(active.disabled),
                path: active.dataset.menuItemPath ?? null,
                role: active.getAttribute('role'),
                text: (active.textContent?.trim() ?? '').slice(0, 80),
                visible: active.getClientRects().length > 0,
              }
            : null,
          visibleItems,
        };
      })),
    });
    const hasVisibleMenuItems = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some(
          (item) => item.getClientRects().length > 0,
        ),
      );
    let openAttempt = 0;
    let openFailureReason = 'context_menu_not_attempted';
    for (openAttempt = 1; openAttempt <= 2; openAttempt += 1) {
      if (openAttempt === 2 && (await hasVisibleMenuItems())) {
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () =>
            ![...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some(
              (item) => item.getClientRects().length > 0,
            ),
          undefined,
          { timeout: 2_000 },
        );
      }
      await targetThumbnail.waitFor({ state: 'visible', timeout: 10_000 });
      await targetThumbnail.scrollIntoViewIfNeeded();
      await targetThumbnail.click({ button: 'right' });
      try {
        await page.waitForFunction(
          () => {
            const active = document.activeElement as HTMLButtonElement | null;
            return (
              active?.getAttribute('role') === 'menuitem' &&
              !active.disabled &&
              active.getClientRects().length > 0 &&
              active.closest('[role="menu"]')?.parentElement?.closest('[role="menu"]') === null
            );
          },
          undefined,
          { timeout: 2_500 },
        );
        openFailureReason = '';
        break;
      } catch {
        openFailureReason = 'trusted_context_click_did_not_focus_visible_root_item';
      }
    }
    if (openFailureReason) {
      throw new Error(
        `Batch Auto Adjust context menu did not open: ${JSON.stringify(await menuDiagnostics(openFailureReason, openAttempt - 1))}`,
      );
    }
    try {
      let productivityFocused = false;
      for (let step = 0; step < 32; step += 1) {
        productivityFocused = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          if (
            active?.getAttribute('role') !== 'menuitem' ||
            active.getClientRects().length === 0 ||
            ('disabled' in active && Boolean(active.disabled))
          ) {
            return false;
          }
          const key = active.textContent?.trim() === 'Productivity' ? 'ArrowRight' : 'ArrowDown';
          active.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              code: key,
              key,
            }),
          );
          return key === 'ArrowRight';
        });
        if (productivityFocused) break;
      }
      if (!productivityFocused) {
        throw new Error(
          `Productivity keyboard target not reached: ${JSON.stringify(await menuDiagnostics('productivity_keyboard_target_not_reached', openAttempt))}`,
        );
      }
      await page.waitForFunction(
        () => {
          const active = document.activeElement as HTMLElement | null;
          const ready =
            active?.getAttribute('role') === 'menuitem' &&
            active.textContent?.trim() === 'Auto Adjust Image' &&
            active.getClientRects().length > 0 &&
            [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].some(
              (item) => item.textContent?.trim() === 'Productivity' && item.getAttribute('aria-expanded') === 'true',
            );
          if (!ready) return false;
          active.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              code: 'Enter',
              key: 'Enter',
            }),
          );
          return true;
        },
        undefined,
        { timeout: 10_000 },
      );
    } catch (error) {
      throw new Error(
        `Batch Auto Adjust keyboard menu activation failed: ${JSON.stringify(await menuDiagnostics('keyboard_navigation_or_activation_failed', openAttempt))}`,
        { cause: error },
      );
    }
  };
  const waitForSingleAutoAdjustInvocation = async (baselineCount: number) => {
    const expected = baselineCount + 1;
    const diagnostics = () =>
      page.evaluate(() => {
        const calls =
          window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
            ({ command }) => command === 'apply_auto_adjustments_to_paths',
          ) ?? [];
        const active = document.activeElement as HTMLElement | null;
        return {
          active: active
            ? {
                path: active.dataset.menuItemPath ?? null,
                role: active.getAttribute('role'),
                text: (active.textContent?.trim() ?? '').slice(0, 80),
              }
            : null,
          count: calls.length,
          lastArgs: calls.at(-1)?.args ?? null,
          visibleMenuItems: [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            .filter((item) => item.getClientRects().length > 0)
            .map((item) => item.textContent?.trim() ?? ''),
        };
      });
    try {
      await page.waitForFunction(
        (minimum) =>
          (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
            ({ command }) => command === 'apply_auto_adjustments_to_paths',
          ).length ?? 0) >= minimum,
        expected,
        { timeout: 10_000 },
      );
    } catch (error) {
      throw new Error(`Batch Auto Adjust invocation did not arrive: ${JSON.stringify(await diagnostics())}`, {
        cause: error,
      });
    }
    const observed = await diagnostics();
    if (observed.count !== expected) {
      throw new Error(`Batch Auto Adjust invocation was not singular: ${JSON.stringify({ expected, ...observed })}`);
    }
  };
  const switchAwayAndBack = async (activePath: string, waitForHydration = true) => {
    const other = page.locator(`[data-testid="filmstrip-thumbnail"]:not([data-image-path="${activePath}"])`).first();
    const otherPath = await other.getAttribute('data-image-path');
    if (!otherPath) throw new Error('Batch Auto Adjust race proof requires a second filmstrip image.');
    await other.click();
    await page.waitForFunction(
      (path) =>
        document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
      otherPath,
      { timeout: 10_000 },
    );
    await page.locator(`[data-testid="filmstrip-thumbnail"][data-image-path="${activePath}"]`).click();
    await page.waitForFunction(
      (path) =>
        document.querySelector('[data-testid="editor-workspace"]')?.getAttribute('data-selected-image-path') === path,
      activePath,
      { timeout: 10_000 },
    );
    if (waitForHydration) {
      await waitForPageCondition(
        page,
        () =>
          document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
        { timeout: 10_000 },
      );
    }
  };

  await waitForPageCondition(
    page,
    () => document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
    { timeout: 10_000 },
  );
  const baseline = await counts();
  const exposure = page.getByTestId('basic-control-exposure-value');
  await exposure.click();
  const exposureInput = page.getByTestId('basic-control-exposure-input');
  await exposureInput.fill('0.55');
  await exposureInput.press('Enter');
  const standardActivePath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  if (!standardActivePath) throw new Error('Batch Auto Adjust proof requires an active path.');
  await page.evaluate(() => {
    window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.holdNextBatchAutoAdjustCommitCompletion();
  });
  await invokeFromContextMenu();
  await waitForSingleAutoAdjustInvocation(baseline.autoAdjust);
  await page.waitForFunction(
    (expectedCommitCount) => {
      const commits =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'commit_batch_auto_adjustment',
        ) ?? [];
      return commits.length === expectedCommitCount && commits.at(-1)?.endedAtMs === null;
    },
    baseline.commit + 1,
    { timeout: 10_000 },
  );
  const afterPrepare = await counts();
  if (afterPrepare.commit !== baseline.commit + 1) {
    const applyArgs = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'apply_auto_adjustments_to_paths')
          .at(-1)?.args ?? null,
    );
    throw new Error(`Batch Auto Adjust did not reach selected-path commit: ${JSON.stringify(applyArgs)}`);
  }
  await switchAwayAndBack(standardActivePath);
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.releaseHeldBatchAutoAdjustCommitCompletion() !== true) {
      throw new Error('Batch Auto Adjust commit completion was not held for successor hydration.');
    }
  });

  await page.waitForFunction(
    ({ expectedCommitCount, expectedSaveCount }) => {
      const commits =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'commit_batch_auto_adjustment',
        ) ?? [];
      const saves =
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
          ({ command }) => command === 'save_metadata_and_update_thumbnail',
        ) ?? [];
      return (
        typeof commits[expectedCommitCount - 1]?.endedAtMs === 'number' &&
        saves.length >= expectedSaveCount &&
        saves[expectedSaveCount - 1]?.endedAtMs !== null &&
        document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0.65'
      );
    },
    { expectedCommitCount: baseline.commit + 1, expectedSaveCount: baseline.metadataSave + 1 },
    { timeout: 10_000 },
  );
  const afterApply = await counts();
  if (
    afterApply.metadataLoad !== baseline.metadataLoad ||
    afterApply.metadataSave !== baseline.metadataSave + 1 ||
    afterApply.commit !== baseline.commit + 1
  ) {
    const newSaveArgs = await page.evaluate((baselineSaveCount) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      return calls
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .slice(baselineSaveCount)
        .map(({ args }) => args ?? null);
    }, baseline.metadataSave);
    throw new Error(
      `Batch Auto Adjust did not use exactly one persistence barrier and one native commit: ${JSON.stringify({ afterApply, baseline, newSaveArgs })}`,
    );
  }
  const batchCalls = await page.evaluate((baselineSaveCount) => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    const apply = calls.filter(({ command }) => command === 'apply_auto_adjustments_to_paths').at(-1) ?? null;
    const barrier =
      calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').at(baselineSaveCount) ?? null;
    return {
      applyArgs: apply?.args ?? null,
      applyStartedAtMs: apply?.startedAtMs ?? null,
      barrierArgs: barrier?.args ?? null,
      barrierEndedAtMs: barrier?.endedAtMs ?? null,
    };
  }, baseline.metadataSave);
  const barrierDocument = editDocumentV2Schema.parse(batchCalls.barrierArgs?.['editDocumentV2']);
  if (
    barrierDocument.nodes.scene_global_color_tone?.params.exposure !== 0.55 ||
    batchCalls.applyArgs?.['expectedBaseRevision'] !== `sha256:${'a'.repeat(64)}` ||
    typeof batchCalls.barrierEndedAtMs !== 'number' ||
    typeof batchCalls.applyStartedAtMs !== 'number' ||
    batchCalls.applyStartedAtMs < batchCalls.barrierEndedAtMs
  ) {
    throw new Error(`Batch Auto Adjust did not prepare from the flushed dirty document: ${JSON.stringify(batchCalls)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await waitForPageCondition(
    page,
    () => document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0.55',
    { timeout: 10_000 },
  );
  const redo = page.locator('button[data-command-id="redo"]:visible').first();
  await expectEnabled(redo, 'Redo after Batch Auto Adjust undo');
  await redo.click();
  await waitForPageCondition(
    page,
    () => document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim() === '0.65',
    { timeout: 10_000 },
  );
  if ((await exposure.textContent())?.trim() !== '0.65') {
    throw new Error('Batch Auto Adjust did not restore its single accepted history boundary.');
  }

  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustCommitDelayMs = 400;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustPrepareDelayMs = 700;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.imageOpenDelayMs = 1_500;
    }
  });
  const raceBaseline = await counts();
  const activePath = await page.getByTestId('editor-workspace').getAttribute('data-selected-image-path');
  if (!activePath) throw new Error('Batch Auto Adjust race proof requires an active path.');
  await invokeFromContextMenu();
  await waitForSingleAutoAdjustInvocation(raceBaseline.autoAdjust);
  await switchAwayAndBack(activePath, false);
  await page.waitForFunction(
    (expected) =>
      typeof window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'commit_batch_auto_adjustment')
        .at(expected - 1)?.endedAtMs === 'number' &&
      document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
    raceBaseline.commit + 1,
    { timeout: 10_000 },
  );
  await waitForPageCondition(
    page,
    () => Number(document.querySelector('[data-testid="basic-control-exposure-value"]')?.textContent?.trim()) === 0.7,
    { timeout: 10_000 },
  );
  if (Number((await exposure.textContent())?.trim()) !== 0.7) {
    const commitArgs = await page.evaluate(
      () =>
        window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
          .filter(({ command }) => command === 'commit_batch_auto_adjustment')
          .at(-1)?.args ?? null,
    );
    throw new Error(
      `An unchanged successor A session did not accept the delayed Batch Auto Adjust commit: ${JSON.stringify({ commitArgs, exposure: await exposure.textContent() })}`,
    );
  }

  const editedRaceBaseline = await counts();
  await invokeFromContextMenu();
  await waitForSingleAutoAdjustInvocation(editedRaceBaseline.autoAdjust);
  await switchAwayAndBack(activePath, false);
  await exposure.click();
  await exposureInput.fill('0.8');
  await exposureInput.press('Enter');
  await page.waitForFunction(
    (expected) =>
      typeof window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'commit_batch_auto_adjustment')
        .at(expected - 1)?.endedAtMs === 'number' &&
      document.querySelector('[data-testid="editor-toolbar-file-status"]')?.getAttribute('aria-busy') === 'false',
    editedRaceBaseline.commit + 1,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(50);
  if (Number((await exposure.textContent())?.trim()) !== 0.8) {
    throw new Error('A delayed Batch Auto Adjust commit replaced an edited successor A session.');
  }
  await page.evaluate(() => {
    if (window.__RAWENGINE_BROWSER_TAURI_HARNESS__) {
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustCommitDelayMs = 0;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.batchAutoAdjustPrepareDelayMs = 0;
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__.imageOpenDelayMs = 250;
    }
  });
}

async function verifyPreviewBoundsScenario(page: Page, samples: BoundsSample[]): Promise<void> {
  const previewPanel = page.getByTestId('editor-image-preview-panel');
  const zoomSelector = page.getByTestId('viewer-footer-zoom-select');
  const sourceIdentity = '/tmp/rawengine-browser-harness/browser-harness.ARW';
  await previewPanel.waitFor({ timeout: 10_000 });
  await zoomSelector.waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-viewer-viewport-controller="ready"]') !== null,
    undefined,
    { timeout: 10_000 },
  );
  await waitForStablePreview(page);

  samples.push(await collectBoundsSample(page, 'fit-after-image-select'));
  await assertLatestBoundsSample(samples);

  await zoomSelector.selectOption('0.5');
  await assertRenderedImageGeometry(page, { height: 384, label: 'selector-zoom-50', width: 512 });
  samples.push(await collectBoundsSample(page, 'selector-zoom-50'));
  await assertLatestBoundsSample(samples);

  await zoomSelector.selectOption('1');
  await assertRenderedImageGeometry(page, { height: 768, label: 'selector-zoom-100', width: 1024 });
  samples.push(await collectBoundsSample(page, 'selector-zoom-100'));
  await assertLatestBoundsSample(samples);

  await page.keyboard.press('Meta+=');
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'keyboard-zoom-in'));
  await assertLatestBoundsSample(samples);

  await page.keyboard.press('Meta+-');
  await waitForStablePreview(page);
  samples.push(await collectBoundsSample(page, 'keyboard-zoom-out'));
  await assertLatestBoundsSample(samples);

  const canonicalBaseHref = await readCommittedBaseHref(page, sourceIdentity);
  await zoomSelector.selectOption('2');
  await assertRenderedImageGeometry(page, { height: 1536, label: 'selector-zoom-200', width: 2048 });
  await assertPositionedZoomOutput(page, { canonicalBaseHref, sourceIdentity });
  await assertVisibleNonEmptyPreviewPixels(page, 'selector-zoom-200', sourceIdentity);
  samples.push(await collectBoundsSample(page, 'selector-zoom-200'));
  await assertLatestBoundsSample(samples);

  const zoomedFrame = await readBounds(page.locator('[data-editor-image-frame="edited"]').first());
  const panel = await readBounds(previewPanel);
  if (zoomedFrame.width <= panel.width || zoomedFrame.height <= panel.height) {
    throw new Error(
      `selector-zoom-200 left the full frame visible (${zoomedFrame.width}x${zoomedFrame.height} inside ${panel.width}x${panel.height}).`,
    );
  }

  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, { ...(await readExpectedFitGeometry(previewPanel)), label: 'reset-to-fit' });
  samples.push(await collectBoundsSample(page, 'reset-to-fit'));
  await assertLatestBoundsSample(samples);

  await zoomSelector.selectOption('2');
  await assertRenderedImageGeometry(page, { height: 1536, label: 'repeated-selector-zoom-200', width: 2048 });
  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, {
    ...(await readExpectedFitGeometry(previewPanel)),
    label: 'repeated-reset-to-fit',
  });
  await assertSingleFullFrameOutput(page, sourceIdentity);

  await previewPanel.hover();
  await page.mouse.wheel(0, -320);
  await page.waitForFunction(() => document.querySelector('[data-editor-zoom-mode="ratio"]') !== null, undefined, {
    timeout: 10_000,
  });
  const gestureScale = Number(await previewPanel.getAttribute('data-editor-transform-scale'));
  const resolvedGestureScale = Number(await previewPanel.getAttribute('data-editor-resolved-transform-scale'));
  if (
    !Number.isFinite(gestureScale) ||
    !Number.isFinite(resolvedGestureScale) ||
    Math.abs(gestureScale - resolvedGestureScale) > 0.001
  ) {
    throw new Error(
      `Wheel zoom split visible transform ${String(gestureScale)} from semantic transform ${String(resolvedGestureScale)}.`,
    );
  }
  await waitForStablePreview(page);
  const gestureBaseHref = await readCommittedBaseHref(page, sourceIdentity);
  await assertPositionedZoomOutput(page, { canonicalBaseHref: gestureBaseHref, sourceIdentity });
  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, {
    ...(await readExpectedFitGeometry(previewPanel)),
    label: 'wheel-reset-to-fit',
  });
  await assertSingleFullFrameOutput(page, sourceIdentity);
  await assertVisibleNonEmptyPreviewPixels(page, 'wheel-reset-to-fit', sourceIdentity);

  await writeBoundsReport('passed');
}

async function verifyEditorIntrinsicHeightContainment(page: Page): Promise<void> {
  const proof = await page.evaluate(async () => {
    const workspace = document.querySelector<HTMLElement>('[data-testid="editor-workspace"]');
    const viewer = document.querySelector<HTMLElement>('[data-testid="image-canvas"]');
    const layer = document.querySelector<SVGImageElement>('[data-testid="svg-preview-base-layer"]');
    const tools = document.querySelector<HTMLElement>('[data-testid="editor-right-panel-shell"]');
    const wrapper = workspace?.parentElement ?? null;
    const shell = wrapper?.parentElement ?? null;
    const intrinsicToolsContent = tools?.firstElementChild;
    if (
      !workspace ||
      !viewer ||
      !layer ||
      !tools ||
      !(intrinsicToolsContent instanceof HTMLElement) ||
      !wrapper ||
      !shell
    ) {
      return { error: 'missing-editor-layout-node' } as const;
    }
    const previousMinHeight = intrinsicToolsContent.style.minHeight;
    intrinsicToolsContent.style.minHeight = '4800px';
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return { bottom: bounds.bottom, height: bounds.height, top: bounds.top, width: bounds.width };
    };
    const constrained = {
      layer: rect(layer),
      shell: rect(shell),
      viewer: rect(viewer),
      workspace: rect(workspace),
      wrapper: rect(wrapper),
    };
    intrinsicToolsContent.style.minHeight = previousMinHeight;
    return { constrained, error: null } as const;
  });
  if (proof.error !== null || !('constrained' in proof)) {
    throw new Error(`Editor intrinsic-height proof could not run: ${JSON.stringify(proof)}.`);
  }
  const { layer, shell, viewer, workspace, wrapper } = proof.constrained;
  const layerCenter = layer.top + layer.height / 2;
  if (
    wrapper.height > shell.height + 1 ||
    workspace.height > shell.height + 1 ||
    viewer.bottom > shell.bottom + 1 ||
    layerCenter < viewer.top ||
    layerCenter > viewer.bottom ||
    layer.width <= 0 ||
    layer.height <= 0
  ) {
    throw new Error(`Tall inspector displaced the visible CPU preview: ${JSON.stringify(proof.constrained)}.`);
  }
}

async function verifyVisiblePreviewReopen(page: Page): Promise<void> {
  const sourceIdentity = '/tmp/rawengine-browser-harness/browser-harness.ARW';
  await page
    .locator('button[data-command-id="back-to-library"]:visible')
    .first()
    .evaluate((element) => {
      if (!(element instanceof HTMLButtonElement)) throw new Error('Back to library is not a button.');
      element.click();
    });
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ state: 'detached', timeout: 10_000 });
  await page
    .getByRole('button', { name: /browser-harness\.ARW/u })
    .first()
    .dblclick();
  await page.getByRole('main', { name: 'Editor workspace' }).waitFor({ timeout: 10_000 });
  await waitForStablePreview(page);
  await assertSingleFullFrameOutput(page, sourceIdentity);
  await assertVisibleNonEmptyPreviewPixels(page, 'reopened-fit', sourceIdentity);

  const zoomSelector = page.getByTestId('viewer-footer-zoom-select');
  await zoomSelector.selectOption('2');
  await waitForStablePreview(page);
  await assertVisibleNonEmptyPreviewPixels(page, 'reopened-zoom-200', sourceIdentity);
  await zoomSelector.selectOption('fit');
  await waitForStablePreview(page);
  await assertSingleFullFrameOutput(page, sourceIdentity);
  await assertVisibleNonEmptyPreviewPixels(page, 'reopened-reset-fit', sourceIdentity);
}

async function assertVisibleNonEmptyPreviewPixels(page: Page, label: string, sourceIdentity: string): Promise<void> {
  const proof = await page.evaluate(
    async ({ expectedSourceIdentity }) => {
      const candidates = Array.from(
        document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'),
      );
      const layer = candidates.find(
        (candidate) =>
          candidate.dataset.previewSourceIdentity === expectedSourceIdentity &&
          Number.parseFloat(getComputedStyle(candidate).opacity) > 0.99,
      );
      if (layer === undefined) return { error: 'missing-committed-layer' } as const;
      const href = layer.getAttribute('href');
      if (href === null) return { error: 'missing-href' } as const;
      const style = getComputedStyle(layer);
      const bounds = layer.getBoundingClientRect();
      const image = new Image();
      image.src = href;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) return { error: 'missing-2d-context' } as const;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaquePixels = 0;
      let lumaTotal = 0;
      let minimumLuma = 255;
      let maximumLuma = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3] ?? 0;
        if (alpha === 0) continue;
        opaquePixels += 1;
        const luma =
          (pixels[offset] ?? 0) * 0.2126 + (pixels[offset + 1] ?? 0) * 0.7152 + (pixels[offset + 2] ?? 0) * 0.0722;
        lumaTotal += luma;
        minimumLuma = Math.min(minimumLuma, luma);
        maximumLuma = Math.max(maximumLuma, luma);
      }
      return {
        bounds: { height: bounds.height, width: bounds.width },
        display: style.display,
        error: null,
        maximumLuma,
        meanLuma: opaquePixels === 0 ? 0 : lumaTotal / opaquePixels,
        minimumLuma,
        opaquePixels,
        visibility: style.visibility,
      } as const;
    },
    { expectedSourceIdentity: sourceIdentity },
  );
  if (
    proof.error !== null ||
    !('opaquePixels' in proof) ||
    proof.opaquePixels < 250 ||
    proof.meanLuma < 8 ||
    proof.bounds.width <= 0 ||
    proof.bounds.height <= 0 ||
    proof.display === 'none' ||
    proof.visibility !== 'visible'
  ) {
    throw new Error(`${label} did not present non-empty visible preview pixels: ${JSON.stringify(proof)}.`);
  }
}

async function verifyViewportInteractionController(page: Page): Promise<void> {
  const previewPanel = page.getByTestId('editor-image-preview-panel');
  const zoomSelector = page.getByTestId('viewer-footer-zoom-select');
  await zoomSelector.selectOption('2');
  await assertRenderedImageGeometry(page, { height: 1536, label: 'viewport-controller-200', width: 2048 });

  await page.keyboard.press('r');
  await previewPanel.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-viewer-active-tool="crop"]') !== null, undefined, {
    timeout: 10_000,
  });
  const cropCommitBaseline = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  const bounds = await previewPanel.boundingBox();
  if (!bounds) throw new Error('Viewport controller proof could not resolve the preview bounds.');
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const positionBefore = Number(await previewPanel.getAttribute('data-editor-transform-position-x'));

  await previewPanel.dispatchEvent('pointerdown', {
    button: 0,
    clientX: center.x,
    clientY: center.y,
    pointerId: 91,
    pointerType: 'mouse',
  });
  const activeToolDown = await previewPanel.evaluate((element) => ({
    gesture: element.getAttribute('data-viewer-gesture-state'),
    positionX: Number(element.getAttribute('data-editor-transform-position-x')),
    temporaryHand: element.getAttribute('data-viewer-temporary-hand'),
    tool: element.getAttribute('data-viewer-active-tool'),
  }));
  if (
    activeToolDown.tool !== 'crop' ||
    activeToolDown.gesture !== 'idle' ||
    activeToolDown.temporaryHand !== 'false' ||
    activeToolDown.positionX !== positionBefore
  ) {
    throw new Error(`Active-tool pointerdown stole the viewport gesture: ${JSON.stringify(activeToolDown)}.`);
  }
  await previewPanel.dispatchEvent('pointerup', {
    button: 0,
    clientX: center.x,
    clientY: center.y,
    pointerId: 91,
    pointerType: 'mouse',
  });

  await page.keyboard.down('Space');
  await page.waitForFunction(() => document.querySelector('[data-viewer-temporary-hand="true"]') !== null, undefined, {
    timeout: 10_000,
  });
  await page.waitForFunction(() => {
    const surface = document.querySelector<HTMLElement>('[data-testid="crop-overlay-surface"]');
    return surface?.dataset.cropInputSuspended === 'true' && getComputedStyle(surface).pointerEvents === 'none';
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 72, center.y + 24, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await page.waitForFunction(
    () => document.querySelector('[data-viewer-gesture-state="idle"][data-viewer-temporary-hand="false"]') !== null,
    undefined,
    { timeout: 10_000 },
  );
  const cropCommitCountAfterPan = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  if (cropCommitCountAfterPan !== cropCommitBaseline) {
    throw new Error('Temporary-hand pan committed crop state before returning viewport ownership.');
  }
  const zoomModeAfterPan = await previewPanel.getAttribute('data-editor-zoom-mode');
  if (zoomModeAfterPan !== 'ratio') {
    throw new Error(`Temporary-hand pan changed semantic ratio zoom mode to ${String(zoomModeAfterPan)}.`);
  }
  await assertRenderedImageGeometry(page, { height: 1536, label: 'viewport-controller-after-pan', width: 2048 });
  const positionAfter = Number(await previewPanel.getAttribute('data-editor-transform-position-x'));
  if (!Number.isFinite(positionBefore) || !Number.isFinite(positionAfter) || positionAfter <= positionBefore + 20) {
    throw new Error(
      `Temporary-hand crop pan did not move the visible frame (${String(positionBefore)} -> ${String(positionAfter)}).`,
    );
  }

  await page.keyboard.down('Space');
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 12, center.y + 8);
  await previewPanel.dispatchEvent('lostpointercapture', { pointerId: 1, pointerType: 'mouse' });
  await page.waitForFunction(() => document.querySelector('[data-viewer-gesture-state="idle"]') !== null, undefined, {
    timeout: 10_000,
  });
  await page.mouse.up();
  await page.keyboard.up('Space');

  await page.keyboard.down('Space');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-viewer-temporary-hand="false"]') !== null, undefined, {
    timeout: 10_000,
  });
  await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => document.querySelector('[data-viewer-temporary-hand="false"]') !== null, undefined, {
    timeout: 10_000,
  });
  await page.keyboard.up('Space');

  await page.keyboard.press('Meta+-');
  await assertRenderedImageGeometry(page, { height: 1152, label: 'viewport-controller-crop-zoom-out', width: 1536 });
  await page.keyboard.press('Meta+=');
  await assertRenderedImageGeometry(page, { height: 1536, label: 'viewport-controller-crop-zoom-in', width: 2048 });
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.waitForFunction(() => document.querySelector('[data-viewer-active-tool="none"]') !== null, undefined, {
    timeout: 10_000,
  });
  const cropCommitCount = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  if (cropCommitCount !== cropCommitBaseline) {
    throw new Error(
      `Temporary-hand viewport gestures leaked ${String(cropCommitCount - cropCommitBaseline)} crop commit(s).`,
    );
  }
  await assertRenderedImageGeometry(page, { height: 1536, label: 'viewport-controller-after-crop-exit', width: 2048 });
  const layoutEpochBefore = Number(await previewPanel.getAttribute('data-editor-layout-epoch'));
  await page.setViewportSize({ height: 760, width: 1200 });
  await page.waitForFunction(
    (previousEpoch) =>
      Number(
        document.querySelector('[data-testid="editor-image-preview-panel"]')?.getAttribute('data-editor-layout-epoch'),
      ) > previousEpoch,
    layoutEpochBefore,
    { timeout: 10_000 },
  );
  const resizedTransform = await previewPanel.evaluate((element) => ({
    mode: element.getAttribute('data-editor-zoom-mode'),
    resolvedScale: Number(element.getAttribute('data-editor-resolved-transform-scale')),
    scale: Number(element.getAttribute('data-editor-transform-scale')),
    x: Number(element.getAttribute('data-editor-transform-position-x')),
    y: Number(element.getAttribute('data-editor-transform-position-y')),
  }));
  if (
    resizedTransform.mode !== 'ratio' ||
    !Object.values(resizedTransform).every((value) => typeof value === 'string' || Number.isFinite(value)) ||
    Math.abs(resizedTransform.scale - resizedTransform.resolvedScale) > 0.001
  ) {
    throw new Error(`Resize broke viewport transform authority: ${JSON.stringify(resizedTransform)}.`);
  }

  await page.setViewportSize(viewport);
  await zoomSelector.selectOption('fit');
  await assertRenderedImageGeometry(page, {
    ...(await readExpectedFitGeometry(previewPanel)),
    label: 'viewport-controller-reset-fit',
  });
}

async function assertPositionedZoomOutput(
  page: Page,
  expected: { canonicalBaseHref: string; sourceIdentity: string },
): Promise<void> {
  await page.waitForFunction(
    ({ canonicalBaseHref, sourceIdentity }) => {
      const bases = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'));
      const patches = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-patch-layer"]'));
      if (bases.length < 1 || bases.length > 2 || patches.length !== 1) return false;
      const committedBases = bases.filter((base) => Number.parseFloat(base.style.opacity) === 1);
      const base = committedBases[0];
      const patch = patches[0];
      if (committedBases.length !== 1 || !base || !patch) return false;
      return (
        bases.every(
          (candidate) =>
            candidate.dataset.previewSourceIdentity === sourceIdentity &&
            (candidate === base || Number.parseFloat(candidate.style.opacity) === 0),
        ) &&
        base.getAttribute('href') === canonicalBaseHref &&
        base.dataset.previewSourceIdentity === sourceIdentity &&
        patch.dataset.previewSourceIdentity === sourceIdentity &&
        Number(patch.dataset.previewFullWidth) > 0 &&
        Number(patch.dataset.previewFullHeight) > 0 &&
        Number(patch.dataset.previewPixelWidth) > 0 &&
        Number(patch.dataset.previewPixelHeight) > 0 &&
        Number.parseFloat(patch.style.opacity) === 1 &&
        patch.getBoundingClientRect().width > 0 &&
        patch.getBoundingClientRect().height > 0
      );
    },
    expected,
    { timeout: 10_000 },
  );
}

async function readCommittedBaseHref(page: Page, sourceIdentity: string): Promise<string> {
  await page.waitForFunction(
    (expectedSourceIdentity) => {
      const bases = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'));
      const committed = bases.filter(
        (base) =>
          base.dataset.previewSourceIdentity === expectedSourceIdentity && Number.parseFloat(base.style.opacity) === 1,
      );
      return committed.length === 1 && committed[0]?.getAttribute('href') !== null;
    },
    sourceIdentity,
    { timeout: 10_000 },
  );
  const href = await page.locator('[data-testid="svg-preview-base-layer"]').evaluateAll((bases, expectedIdentity) => {
    const committed = bases.find(
      (base) =>
        base instanceof SVGImageElement &&
        base.dataset.previewSourceIdentity === expectedIdentity &&
        Number.parseFloat(base.style.opacity) === 1,
    );
    return committed?.getAttribute('href') ?? null;
  }, sourceIdentity);
  if (href === null) throw new Error('Zoom proof could not identify the committed canonical base preview.');
  return href;
}

async function assertSingleFullFrameOutput(page: Page, sourceIdentity: string): Promise<void> {
  await page.waitForFunction(
    (expectedSourceIdentity) => {
      const bases = Array.from(document.querySelectorAll<SVGImageElement>('[data-testid="svg-preview-base-layer"]'));
      const patches = document.querySelectorAll('[data-testid="svg-preview-patch-layer"]');
      const base = bases[0];
      return (
        bases.length === 1 &&
        patches.length === 0 &&
        base?.dataset.previewSourceIdentity === expectedSourceIdentity &&
        Number.parseFloat(base.style.opacity) === 1 &&
        base.getBoundingClientRect().width > 0 &&
        base.getBoundingClientRect().height > 0
      );
    },
    sourceIdentity,
    { timeout: 10_000 },
  );
}

async function assertRenderedImageGeometry(
  page: Page,
  expected: { height: number; label: string; width: number },
): Promise<void> {
  const frame = page.locator('[data-editor-image-frame="edited"]').first();
  await frame.waitFor({ timeout: 10_000 });
  try {
    await page.waitForFunction(
      ({ expectedHeight, expectedWidth }) => {
        const element = document.querySelector<HTMLElement>('[data-editor-image-frame="edited"]');
        if (!element) return false;
        const bounds = element.getBoundingClientRect();
        return Math.abs(bounds.width - expectedWidth) <= 1 && Math.abs(bounds.height - expectedHeight) <= 1;
      },
      { expectedHeight: expected.height, expectedWidth: expected.width },
      { timeout: 10_000 },
    );
  } catch (error) {
    const actual = await readBounds(frame);
    throw new Error(
      `${expected.label} timed out at ${actual.width}x${actual.height}; expected ${expected.width}x${expected.height}.`,
      { cause: error },
    );
  }
  const actual = await readBounds(frame);
  if (Math.abs(actual.width - expected.width) > 1 || Math.abs(actual.height - expected.height) > 1) {
    throw new Error(
      `${expected.label} rendered ${actual.width}x${actual.height}; expected ${expected.width}x${expected.height}.`,
    );
  }
}

async function readExpectedFitGeometry(previewPanel: Locator): Promise<{ height: number; width: number }> {
  const bounds = await readBounds(previewPanel);
  const source = { height: 768, width: 1024 };
  const scale = Math.min(bounds.width / source.width, bounds.height / source.height);
  return { height: source.height * scale, width: source.width * scale };
}

async function waitForStablePreview(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await page.getByTestId('image-canvas').waitFor({ timeout: 10_000 });
}

async function verifyViewerPickerControllers(page: Page): Promise<void> {
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  await page.getByTestId('adjustments-inspector').waitFor({ state: 'visible', timeout: 10_000 });
  const toneAdvanced = page.getByTestId('tone-equalizer-advanced');
  if (!(await toneAdvanced.isVisible())) {
    // Basic now owns a single collapsed Advanced disclosure around Tone Mapper
    // and Tone Equalizer. Open that canonical disclosure before addressing the
    // nested picker controls; retain the nested selector for already-open views.
    const canonicalAdvancedToggle = page.getByTestId('basic-tone-advanced-toggle');
    if (await canonicalAdvancedToggle.isVisible()) {
      await canonicalAdvancedToggle.click();
    } else {
      await page.getByTestId('tone-equalizer-advanced-toggle').click();
    }
  }
  await toneAdvanced.waitFor({ state: 'visible', timeout: 10_000 });
  const tonePicker = page.getByTestId('tone-equalizer-picker');
  await tonePicker.scrollIntoViewIfNeeded();
  await waitForStablePreview(page);
  await tonePicker.click();
  await page.getByTestId('image-canvas').focus();
  await waitForStableGeometryEpoch(page);
  const toneSamplePoint = await displayedImageCenter(page);
  await page.mouse.move(toneSamplePoint.x, toneSamplePoint.y);
  await page.mouse.down();
  const toneOverlay = page.getByTestId('viewer-picker-overlay');
  await toneOverlay.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await toneOverlay.getAttribute('data-picker-tool')) !== 'tone-equalizer') {
    throw new Error('Tone Equalizer did not publish its declarative picker overlay.');
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="viewer-picker-overlay"]')?.getAttribute('data-picker-status') === 'ready',
    undefined,
    { timeout: 10_000 },
  );
  await page.mouse.up();
  await toneOverlay.waitFor({ state: 'detached', timeout: 10_000 });
  const toneReceipt = page.getByTestId('tone-equalizer-picker-receipt');
  await toneReceipt.waitFor({ state: 'attached', timeout: 10_000 });
  await toneReceipt.scrollIntoViewIfNeeded();
  await tonePicker.click();

  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByTestId('color-workspace-tab-point-color').click();
  const pointControls = page.getByTestId('point-color-controls');
  await pointControls.waitFor({ state: 'visible', timeout: 10_000 });
  const pointPicker = page.getByTestId('point-color-picker');
  await pointPicker.scrollIntoViewIfNeeded();
  await waitForStablePreview(page);
  await pointPicker.click();
  await page.getByTestId('image-canvas').focus();
  await waitForStableGeometryEpoch(page);
  const pointSamplePoint = await displayedImageCenter(page);
  await page.mouse.move(pointSamplePoint.x, pointSamplePoint.y);
  await page.mouse.down();
  const pointOverlay = page.getByTestId('viewer-picker-overlay');
  await pointOverlay.waitFor({ state: 'visible', timeout: 10_000 });
  const pointOverlayProof = await pointOverlay.evaluate((element) => ({
    normalizedX: element.dataset.normalizedX,
    normalizedY: element.dataset.normalizedY,
    tool: element.dataset.pickerTool,
  }));
  if (
    pointOverlayProof.tool !== 'point-color' ||
    pointOverlayProof.normalizedX === undefined ||
    pointOverlayProof.normalizedY === undefined
  ) {
    throw new Error(`Point Color overlay proof was incomplete: ${JSON.stringify(pointOverlayProof)}`);
  }
  await page.mouse.up();
  await page.getByTestId('point-color-selected-controls').waitFor({ state: 'visible', timeout: 10_000 });
  if ((await pointPicker.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('Point Color picker did not deactivate after committing its one-shot sample.');
  }
}

async function verifyBlackWhiteMixerTransaction(page: Page): Promise<void> {
  const disclosure = page.getByTestId('black-white-mixer-disclosure');
  await disclosure.scrollIntoViewIfNeeded();
  if ((await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
  const controls = page.getByTestId('black-white-mixer-controls');
  await controls.waitFor({ state: 'visible', timeout: 10_000 });
  const identity = await controls.evaluate((element) => ({
    adjustmentRevision: element.dataset.commitAdjustmentRevision,
    imageSessionId: element.dataset.commitImageSession,
    sourceIdentity: element.dataset.commitSourceIdentity,
  }));
  if (
    identity.sourceIdentity !== '/tmp/rawengine-browser-harness/browser-harness.ARW' ||
    identity.imageSessionId === undefined ||
    identity.adjustmentRevision === undefined
  ) {
    throw new Error(`Black & White Mixer did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }
  const baseline = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return {
      previews: calls.filter(({ command }) => command === 'apply_adjustments').length,
      saves: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
    };
  });

  const toggle = page.getByTestId('black-white-mixer-toggle');
  if ((await toggle.getAttribute('aria-checked')) !== 'false') {
    throw new Error('Black & White Mixer transaction proof requires a disabled baseline.');
  }
  await toggle.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="black-white-mixer-toggle"]')?.getAttribute('aria-checked') === 'true',
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    ({ saves }) => {
      const candidates = (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [])
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .slice(saves);
      return candidates.some((call) => {
        const mixer = call.args?.['editDocumentV2']?.['nodes']?.['black_white_mixer']?.['params']?.['blackWhiteMixer'];
        const transaction = call.args?.['transaction'];
        return (
          typeof call.endedAtMs === 'number' &&
          mixer?.['enabled'] === true &&
          mixer?.['weights']?.['reds'] === 0 &&
          typeof transaction?.['baseAdjustmentRevision'] === 'number' &&
          transaction?.['nextAdjustmentRevision'] === transaction['baseAdjustmentRevision'] + 1
        );
      });
    },
    baseline,
    { timeout: 10_000 },
  );
  await page.getByTestId('black-white-mixer-contribution-value').click();
  const responseInput = page.getByTestId('black-white-mixer-contribution-input');
  await responseInput.fill('32');
  await responseInput.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="black-white-mixer-contribution-value"]')?.textContent?.trim() === '32',
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    ({ previews, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const previewCalls = calls.filter(({ command }) => command === 'apply_adjustments');
      const request = previewCalls.at(-1)?.args?.['request'];
      const editDocument = typeof request === 'object' && request !== null ? request['editDocumentV2'] : null;
      const nodes = typeof editDocument === 'object' && editDocument !== null ? editDocument['nodes'] : null;
      const node = typeof nodes === 'object' && nodes !== null ? nodes['black_white_mixer'] : null;
      const params = typeof node === 'object' && node !== null ? node['params'] : null;
      const mixer = typeof params === 'object' && params !== null ? params['blackWhiteMixer'] : null;
      const weights = typeof mixer === 'object' && mixer !== null ? mixer['weights'] : null;
      return (
        previewCalls.length > previews &&
        (() => {
          const persistenceCalls = calls
            .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
            .slice(saves);
          const enable = persistenceCalls.find(
            (call) =>
              call.args?.['editDocumentV2']?.['nodes']?.['black_white_mixer']?.['params']?.['blackWhiteMixer']?.[
                'enabled'
              ] === true &&
              call.args?.['editDocumentV2']?.['nodes']?.['black_white_mixer']?.['params']?.['blackWhiteMixer']?.[
                'weights'
              ]?.['reds'] === 0,
          );
          const response = persistenceCalls.find(
            (call) =>
              call.args?.['editDocumentV2']?.['nodes']?.['black_white_mixer']?.['params']?.['blackWhiteMixer']?.[
                'enabled'
              ] === true &&
              call.args?.['editDocumentV2']?.['nodes']?.['black_white_mixer']?.['params']?.['blackWhiteMixer']?.[
                'weights'
              ]?.['reds'] === 32,
          );
          return (
            typeof enable?.endedAtMs === 'number' &&
            typeof response?.endedAtMs === 'number' &&
            response.args?.['transaction']?.['baseAdjustmentRevision'] ===
              enable.args?.['transaction']?.['nextAdjustmentRevision']
          );
        })() &&
        typeof request === 'object' &&
        request !== null &&
        !('jsAdjustments' in request) &&
        typeof mixer === 'object' &&
        mixer !== null &&
        mixer['enabled'] === true &&
        mixer['process'] === 'continuous_sensitivity_v1' &&
        typeof weights === 'object' &&
        weights !== null &&
        weights['reds'] === 32
      );
    },
    baseline,
    { timeout: 10_000 },
  );
  const persistence = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .findLast(
        (candidate) =>
          candidate.args?.['editDocumentV2']?.['nodes']?.['black_white_mixer']?.['params']?.['blackWhiteMixer']?.[
            'weights'
          ]?.['reds'] === 32,
      );
    return call?.args ?? null;
  });
  const persistedMixer = editDocumentV2Schema.parse(persistence?.['editDocumentV2']).nodes.black_white_mixer?.params
    .blackWhiteMixer;
  const transaction = persistence?.['transaction'];
  if (
    persistedMixer?.['enabled'] !== true ||
    persistedMixer?.['weights']?.['reds'] !== 32 ||
    transaction?.['imageSessionId'] !== identity.imageSessionId ||
    typeof transaction?.['baseAdjustmentRevision'] !== 'number' ||
    transaction['nextAdjustmentRevision'] !== transaction['baseAdjustmentRevision'] + 1
  ) {
    throw new Error(`Black & White Mixer did not persist node authority: ${JSON.stringify(persistence)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Black & White Mixer edits did not create Undo boundaries.');
  await undo.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="black-white-mixer-contribution-value"]')?.textContent?.trim() === '0' &&
      document.querySelector('[data-testid="black-white-mixer-toggle"]')?.getAttribute('aria-checked') === 'true',
    undefined,
    { timeout: 10_000 },
  );
  await undo.click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="black-white-mixer-toggle"]')?.getAttribute('aria-checked') === 'false' &&
      document.querySelector('[data-testid="black-white-mixer-contribution-value"]')?.textContent?.trim() === '0',
    undefined,
    { timeout: 10_000 },
  );
}

async function verifyChannelMixerTransaction(page: Page): Promise<void> {
  const disclosure = page.getByTestId('channel-mixer-disclosure');
  await disclosure.scrollIntoViewIfNeeded();
  if ((await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
  const controls = page.getByTestId('channel-mixer-controls');
  await controls.waitFor({ state: 'visible', timeout: 10_000 });
  const identity = await controls.evaluate((element) => ({
    adjustmentRevision: element.dataset.commitAdjustmentRevision,
    imageSessionId: element.dataset.commitImageSession,
    sourceIdentity: element.dataset.commitSourceIdentity,
  }));
  if (
    identity.sourceIdentity !== '/tmp/rawengine-browser-harness/browser-harness.ARW' ||
    identity.imageSessionId === undefined ||
    identity.adjustmentRevision === undefined
  ) {
    throw new Error(`Channel Mixer did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }
  const baseline = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return {
      previews: calls.filter(({ command }) => command === 'apply_adjustments').length,
      saves: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
    };
  });

  await page.getByTestId('channel-mixer-toggle').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="channel-mixer-toggle"]')?.getAttribute('aria-checked') === 'true' &&
      document.querySelector('[data-testid="channel-mixer-red-value"]')?.textContent?.trim() === '110',
    undefined,
    { timeout: 10_000 },
  );
  await page.getByTestId('channel-mixer-green-range').press('ArrowRight');
  await page.waitForFunction(
    ({ previews, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const previewCalls = calls.filter(({ command }) => command === 'apply_adjustments');
      const request = previewCalls.at(-1)?.args?.['request'];
      const editDocument = typeof request === 'object' && request !== null ? request['editDocumentV2'] : null;
      const nodes = typeof editDocument === 'object' && editDocument !== null ? editDocument['nodes'] : null;
      const node = typeof nodes === 'object' && nodes !== null ? nodes['channel_mixer'] : null;
      const params = typeof node === 'object' && node !== null ? node['params'] : null;
      const mixer = typeof params === 'object' && params !== null ? params['channelMixer'] : null;
      const red = typeof mixer === 'object' && mixer !== null ? mixer['red'] : null;
      return (
        previewCalls.length > previews &&
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length >= saves + 1 &&
        typeof request === 'object' &&
        request !== null &&
        !('jsAdjustments' in request) &&
        typeof mixer === 'object' &&
        mixer !== null &&
        mixer['enabled'] === true &&
        typeof red === 'object' &&
        red !== null &&
        red['red'] === 110 &&
        red['green'] === 1
      );
    },
    baseline,
    { timeout: 10_000 },
  );
  const persistence = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .at(-1);
    return call?.args ?? null;
  });
  const persistedMixer = editDocumentV2Schema.parse(persistence?.['editDocumentV2']).nodes.channel_mixer?.params
    .channelMixer;
  const transaction = persistence?.['transaction'];
  if (
    persistedMixer?.['enabled'] !== true ||
    persistedMixer?.['red']?.['red'] !== 110 ||
    persistedMixer?.['red']?.['green'] !== 1 ||
    transaction?.['imageSessionId'] !== identity.imageSessionId ||
    typeof transaction?.['baseAdjustmentRevision'] !== 'number' ||
    transaction['nextAdjustmentRevision'] !== transaction['baseAdjustmentRevision'] + 1
  ) {
    throw new Error(`Channel Mixer did not persist node authority: ${JSON.stringify(persistence)}`);
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  if (!(await undo.isEnabled())) throw new Error('Channel Mixer edits did not create Undo boundaries.');
  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="channel-mixer-green-value"]')?.textContent?.trim() === '0',
    undefined,
    { timeout: 10_000 },
  );
  if ((await page.getByTestId('channel-mixer-toggle').getAttribute('aria-checked')) !== 'true') {
    throw new Error('Channel Mixer coefficient Undo crossed the prior enable history boundary.');
  }
  await undo.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="channel-mixer-toggle"]')?.getAttribute('aria-checked') === 'false',
    undefined,
    { timeout: 10_000 },
  );
}

async function verifyColorRangeLocalAdjustmentTransaction(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  const baselineSaves = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0,
  );
  await page.getByTestId('selective-color-range-oranges').click();
  const disclosure = page.getByTestId('local-color-range-adjustment-disclosure');
  if ((await disclosure.getAttribute('open')) === null) await disclosure.locator('summary').click();
  const createLocalAdjustment = page.getByTestId('selective-color-create-local-adjustment');
  await createLocalAdjustment.scrollIntoViewIfNeeded();
  await createLocalAdjustment.click();

  await page.waitForFunction(
    (expected) =>
      (window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(
        ({ command }) => command === 'save_metadata_and_update_thumbnail',
      ).length ?? 0) === expected,
    baselineSaves + 1,
    { timeout: 10_000 },
  );
  const persisted = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
      .at(-1);
    return call?.args ?? null;
  });
  const transaction = persisted?.['transaction'];
  const persistedDocument = editDocumentV2Schema.parse(persisted?.['editDocumentV2']);
  const masks = persistedDocument.layers.masks;
  const colorMask = masks
    .flatMap((mask) => (Array.isArray(mask?.['subMasks']) ? mask['subMasks'] : []))
    .find((mask) => mask?.['type'] === 'color');
  if (
    colorMask === undefined ||
    typeof transaction?.['transactionId'] !== 'string' ||
    typeof transaction?.['baseAdjustmentRevision'] !== 'number' ||
    transaction['nextAdjustmentRevision'] !== transaction['baseAdjustmentRevision'] + 1
  ) {
    throw new Error(
      `Color-range local adjustment did not persist one revision-scoped typed layer: ${JSON.stringify({ colorMask, transaction })}`,
    );
  }
}

async function verifySceneCurveTransaction(page: Page): Promise<void> {
  await page.getByTestId('color-workspace-tab-foundation').click();
  const toneCurve = page.getByRole('combobox', { name: 'Tone Curve' });
  await toneCurve.scrollIntoViewIfNeeded();
  const baseline = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return {
      previews: calls.filter(({ command }) => command === 'apply_adjustments').length,
      saves: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
    };
  });

  await toneCurve.selectOption('soft_contrast');
  await page.waitForFunction(
    ({ previews, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const previewCalls = calls.filter(({ command }) => command === 'apply_adjustments');
      const latestRequest = previewCalls.at(-1)?.args?.request;
      const editDocument =
        typeof latestRequest === 'object' && latestRequest !== null ? latestRequest['editDocumentV2'] : null;
      const nodes = typeof editDocument === 'object' && editDocument !== null ? editDocument['nodes'] : null;
      const sceneCurve = typeof nodes === 'object' && nodes !== null ? nodes['scene_curve'] : null;
      const params = typeof sceneCurve === 'object' && sceneCurve !== null ? sceneCurve['params'] : null;
      return (
        previewCalls.length > previews &&
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length === saves + 1 &&
        typeof params === 'object' &&
        params !== null &&
        params['toneCurve'] === 'soft_contrast' &&
        params['curveMode'] === 'parametric'
      );
    },
    baseline,
    { timeout: 10_000 },
  );

  const request = await page.evaluate(() => {
    const call = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
      .filter(({ command }) => command === 'apply_adjustments')
      .at(-1);
    return call?.args?.request ?? null;
  });
  if (request === null || typeof request !== 'object' || 'jsAdjustments' in request) {
    throw new Error('Tone Curve preview retained the flat adjustments render payload.');
  }
  const editDocument = editDocumentV2Schema.parse(request['editDocumentV2']);
  const sceneCurve = editDocument.nodes.scene_curve?.params;
  if (sceneCurve?.toneCurve !== 'soft_contrast' || sceneCurve.curveMode !== 'parametric') {
    throw new Error(`Tone Curve UI edit did not reach scene_curve render authority: ${JSON.stringify(sceneCurve)}`);
  }
  if ((await toneCurve.inputValue()) !== 'soft_contrast') {
    throw new Error('Tone Curve selector did not retain the committed value.');
  }
}

async function verifyColorCalibrationTransaction(page: Page): Promise<void> {
  // Calibration is a Develop adjustment section, not a duplicate Color workspace
  // disclosure. Keep this proof bound to the canonical section and its toggle.
  await page.getByTestId('right-panel-switcher-button-adjustments').click();
  const inspector = page.getByTestId('adjustments-inspector');
  await inspector.waitFor({ timeout: 10_000 });
  const disclosure = page.getByTestId('adjustments-section-calibration');
  await disclosure.waitFor({ timeout: 10_000 });
  const disclosureToggle = disclosure.getByRole('button').first();
  if ((await disclosureToggle.getAttribute('aria-expanded')) !== 'true') await disclosureToggle.click();
  const controls = disclosure.getByTestId('calibration-controls');
  const identity = await controls.evaluate((element) => ({
    adjustmentRevision: element.dataset.commitAdjustmentRevision,
    imageSessionId: element.dataset.commitImageSession,
    sourceIdentity: element.dataset.commitSourceIdentity,
  }));
  if (
    identity.sourceIdentity !== '/tmp/rawengine-browser-harness/browser-harness.ARW' ||
    identity.imageSessionId === undefined ||
    identity.adjustmentRevision === undefined
  ) {
    throw new Error(`Color Calibration controls did not expose complete commit identity: ${JSON.stringify(identity)}`);
  }

  const shadowsSlider = page.getByTestId('calibration-shadows-tint-range').locator('input[type="range"]');
  const hueSlider = page.getByTestId('calibration-primary-hue-range').locator('input[type="range"]');
  await shadowsSlider.scrollIntoViewIfNeeded();
  const baseline = await page.evaluate(() => {
    const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
    return {
      previews: calls.filter(({ command }) => command === 'apply_adjustments').length,
      saves: calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length,
    };
  });
  await page.evaluate(() => {
    const shadows = document.querySelector<HTMLInputElement>(
      '[data-testid="calibration-shadows-tint-range"] input[type="range"]',
    );
    const redHue = document.querySelector<HTMLInputElement>(
      '[data-testid="calibration-primary-hue-range"] input[type="range"]',
    );
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (shadows === null || redHue === null || setValue === undefined) {
      throw new Error('Color Calibration rapid-edit inputs were unavailable.');
    }
    setValue.call(shadows, '18');
    shadows.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(redHue, '12');
    redHue.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    ({ previews, saves }) => {
      const calls = window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls ?? [];
      const previewCalls = calls.filter(({ command }) => command === 'apply_adjustments');
      const latestRequest = previewCalls.at(-1)?.args?.request;
      const editDocument =
        typeof latestRequest === 'object' && latestRequest !== null ? latestRequest['editDocumentV2'] : null;
      const nodes = typeof editDocument === 'object' && editDocument !== null ? editDocument['nodes'] : null;
      const calibration = typeof nodes === 'object' && nodes !== null ? nodes['color_calibration'] : null;
      const params = typeof calibration === 'object' && calibration !== null ? calibration['params'] : null;
      const colorCalibration = typeof params === 'object' && params !== null ? params['colorCalibration'] : null;
      return (
        previewCalls.length > previews &&
        calls.filter(({ command }) => command === 'save_metadata_and_update_thumbnail').length >= saves + 1 &&
        typeof colorCalibration === 'object' &&
        colorCalibration !== null &&
        colorCalibration['shadowsTint'] === 18 &&
        colorCalibration['redHue'] === 12
      );
    },
    baseline,
    { timeout: 10_000 },
  );

  const persisted = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls
        .filter(({ command }) => command === 'save_metadata_and_update_thumbnail')
        .at(-1)?.args,
  );
  const transaction = persisted?.['transaction'];
  const colorCalibration = editDocumentV2Schema.parse(persisted?.['editDocumentV2']).nodes.color_calibration?.params
    .colorCalibration;
  if (
    colorCalibration?.['shadowsTint'] !== 18 ||
    colorCalibration?.['redHue'] !== 12 ||
    transaction?.['imageSessionId'] !== identity.imageSessionId ||
    transaction?.['baseAdjustmentRevision'] !== Number(identity.adjustmentRevision) + 1 ||
    transaction?.['nextAdjustmentRevision'] !== transaction?.['baseAdjustmentRevision'] + 1
  ) {
    throw new Error(`Color Calibration did not persist one source-bound node revision: ${JSON.stringify(persisted)}`);
  }

  const request = await page.evaluate(
    () =>
      window.__RAWENGINE_BROWSER_TAURI_HARNESS__?.calls.filter(({ command }) => command === 'apply_adjustments').at(-1)
        ?.args?.request,
  );
  if (request === null || typeof request !== 'object' || 'jsAdjustments' in request) {
    throw new Error('Color Calibration preview retained the flat adjustments render payload.');
  }
  const editDocument = editDocumentV2Schema.parse(request['editDocumentV2']);
  const renderedCalibration = editDocument.nodes.color_calibration?.params['colorCalibration'];
  if (renderedCalibration?.shadowsTint !== 18 || renderedCalibration.redHue !== 12) {
    throw new Error('Rapid Color Calibration UI edits did not retain both fields in render authority.');
  }
  if ((await shadowsSlider.inputValue()) !== '18' || (await hueSlider.inputValue()) !== '12') {
    throw new Error('Rapid Color Calibration sliders did not retain both committed values.');
  }

  const undo = page.locator('button[data-command-id="undo"]:visible').first();
  await undo.click();
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[data-testid="calibration-shadows-tint-range"] input[type="range"]',
        ) as HTMLInputElement | null
      )?.value === '18' &&
      (
        document.querySelector(
          '[data-testid="calibration-primary-hue-range"] input[type="range"]',
        ) as HTMLInputElement | null
      )?.value === '0',
    undefined,
    { timeout: 10_000 },
  );
  await undo.click();
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[data-testid="calibration-shadows-tint-range"] input[type="range"]',
        ) as HTMLInputElement | null
      )?.value === '0',
    undefined,
    { timeout: 10_000 },
  );

  // Leave the inspector in the same workspace expected by the following picker
  // proof, which owns its own Adjustments-panel navigation.
  await page.getByTestId('right-panel-switcher-button-color').click();
  await page.getByRole('heading', { exact: true, name: 'Color' }).waitFor({ timeout: 10_000 });
}

async function waitForStableGeometryEpoch(page: Page): Promise<void> {
  const canvas = page.getByTestId('image-canvas');
  let previous = await canvas.getAttribute('data-geometry-epoch');
  let stableSamples = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(50);
    const current = await canvas.getAttribute('data-geometry-epoch');
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 3) return;
    previous = current;
  }
  throw new Error('Picker proof geometry epoch did not stabilize.');
}

async function displayedImageCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('[data-editor-image-frame="edited"]').first().boundingBox();
  if (bounds === null) throw new Error('Picker proof could not resolve displayed image bounds.');
  const visibleTop = Math.max(0, bounds.y);
  const visibleBottom = Math.min(viewport.height, bounds.y + bounds.height);
  if (visibleBottom - visibleTop < 20) throw new Error('Picker proof image is not visibly interactable.');
  return { x: bounds.x + bounds.width * 0.5, y: (visibleTop + visibleBottom) * 0.5 };
}

async function collectBoundsSample(page: Page, label: string): Promise<BoundsSample> {
  const elements = {
    bottomBarShell: await readBounds(page.getByTestId('editor-bottom-bar-shell')),
    firstFilmstripThumbnail: await readOptionalBounds(page.getByTestId('filmstrip-thumbnail').first()),
    imageCanvas: await readBounds(page.getByTestId('image-canvas')),
    previewContent: await readBounds(page.getByTestId('editor-image-preview-content')),
    previewPanel: await readBounds(page.getByTestId('editor-image-preview-panel')),
    previewRegion: await readBounds(page.getByTestId('editor-image-preview-region')),
    rightPanelShell: await readBounds(page.getByTestId('editor-right-panel-shell')),
    toolbarShell: await readBounds(page.getByTestId('editor-toolbar-shell')),
    workspace: await readBounds(page.getByTestId('editor-workspace')),
    viewerFooter: await readBounds(page.getByTestId('viewer-footer')),
    zoomSelector: await readBounds(page.getByTestId('viewer-footer-zoom-select')),
  };
  const failures = evaluateBounds(elements);
  return { elements, failures, label, viewport };
}

async function readBounds(locator: Locator): Promise<ElementBoundsSnapshot> {
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    };
  });
  return roundBounds(box);
}

async function readOptionalBounds(locator: Locator): Promise<ElementBoundsSnapshot | null> {
  if ((await locator.count()) === 0) return null;
  return readBounds(locator);
}

function roundBounds(bounds: ElementBoundsSnapshot): ElementBoundsSnapshot {
  return {
    bottom: round(bounds.bottom),
    height: round(bounds.height),
    left: round(bounds.left),
    right: round(bounds.right),
    top: round(bounds.top),
    width: round(bounds.width),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function evaluateBounds(elements: BoundsSample['elements']): string[] {
  const failures: string[] = [];
  const tolerance = 1;
  const viewportBoundedElements = [
    'bottomBarShell',
    'firstFilmstripThumbnail',
    'previewPanel',
    'previewRegion',
    'rightPanelShell',
    'toolbarShell',
    'workspace',
    'viewerFooter',
    'zoomSelector',
  ];
  for (const name of viewportBoundedElements) {
    const bounds = elements[name];
    if (bounds === undefined || bounds === null) continue;
    if (bounds.width <= 0 || bounds.height <= 0) {
      failures.push(`${name} has no visible area (${bounds.width}x${bounds.height}).`);
    }
    if (bounds.top < -tolerance) failures.push(`${name} is clipped above viewport top (${bounds.top}).`);
    if (bounds.left < -tolerance) failures.push(`${name} is clipped left of viewport (${bounds.left}).`);
    if (bounds.right > viewport.width + tolerance) {
      failures.push(`${name} exceeds viewport right edge (${bounds.right} > ${viewport.width}).`);
    }
    if (bounds.bottom > viewport.height + tolerance) {
      failures.push(`${name} exceeds viewport bottom edge (${bounds.bottom} > ${viewport.height}).`);
    }
  }

  const previewPanel = elements.previewPanel;
  const previewRegion = elements.previewRegion;
  const bottomBarShell = elements.bottomBarShell;
  const viewerFooter = elements.viewerFooter;
  const zoomSelector = elements.zoomSelector;
  const firstFilmstripThumbnail = elements.firstFilmstripThumbnail;
  if (previewRegion !== null && previewPanel !== null && !containsBounds(previewRegion, previewPanel, tolerance)) {
    failures.push('preview panel is not fully contained by the preview region.');
  }
  if (previewRegion !== null && viewerFooter !== null && !containsBounds(previewRegion, viewerFooter, tolerance)) {
    failures.push('viewer footer is not fully contained by the preview region.');
  }
  if (viewerFooter !== null && zoomSelector !== null && !containsBounds(viewerFooter, zoomSelector, tolerance)) {
    failures.push('zoom selector is not fully contained by the viewer footer.');
  }
  if (
    bottomBarShell !== null &&
    firstFilmstripThumbnail !== null &&
    !containsBounds(bottomBarShell, firstFilmstripThumbnail, tolerance)
  ) {
    failures.push('first filmstrip thumbnail is not fully contained by the bottom bar shell.');
  }
  if (viewerFooter !== null && firstFilmstripThumbnail !== null && overlaps(viewerFooter, firstFilmstripThumbnail)) {
    failures.push('viewer footer overlaps the filmstrip thumbnails.');
  }

  return failures;
}

function containsBounds(container: ElementBoundsSnapshot, child: ElementBoundsSnapshot, tolerance: number): boolean {
  return (
    child.top >= container.top - tolerance &&
    child.left >= container.left - tolerance &&
    child.right <= container.right + tolerance &&
    child.bottom <= container.bottom + tolerance
  );
}

function overlaps(left: ElementBoundsSnapshot, right: ElementBoundsSnapshot): boolean {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

async function assertLatestBoundsSample(samples: BoundsSample[]): Promise<void> {
  const latest = samples.at(-1);
  if (!latest || latest.failures.length === 0) return;
  await writeBoundsReport('failed');
  throw new Error(`Preview bounds failed for ${latest.label}: ${latest.failures.join(' | ')}`);
}

async function writeBoundsReport(status: BoundsReport['status']): Promise<void> {
  const report: BoundsReport = {
    generatedAt: new Date().toISOString(),
    samples: boundsSamples,
    scenario: 'browser-tauri-preview-zoom-window-bounds',
    status,
    viewport,
  };
  await mkdir(dirname(boundsReportPath), { recursive: true });
  await writeFile(boundsReportPath, `${JSON.stringify(report, null, 2)}\n`);
}
