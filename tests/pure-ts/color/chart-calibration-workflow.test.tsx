import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const calls: Array<{ command: string; args: unknown }> = [];
const sampling = {
  contract: 'rapidraw.chart_calibration.v1',
  chartId: 'colorchecker_classic_24_cc0_srgb_d65_v1',
  chartVersion: 1,
  sourceRevision: 'source-revision-v1:test',
  cameraIdentity: 'Synthetic Camera',
  inputDomain: 'raw_camera_linear_after_sensor_correction_before_wb_profile_view_output',
  geometry: {
    corners: [
      { x: 0.15, y: 0.2 },
      { x: 0.85, y: 0.2 },
      { x: 0.85, y: 0.8 },
      { x: 0.15, y: 0.8 },
    ],
    mirrored: false,
  },
  samples: Array.from({ length: 24 }, (_, index) => ({
    patchId: `patch-${index}`,
    role: index < 6 ? 'neutral' : index < 8 ? 'skin' : 'chromatic',
    cameraRgbMean: [0.2, 0.2, 0.2],
    cameraRgbMedian: [0.2, 0.2, 0.2],
    covariance: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    clippedFraction: 0,
    validFraction: 1,
    spatialGradient: 0.01,
    sharpness: 0.1,
    sampleCount: 81,
  })),
  captureQuality: {
    chartAreaFraction: 0.42,
    minimumPatchAreaPixels: 900,
    maximumClippedFraction: 0.004,
    maximumSpatialGradient: 0.02,
    minimumPatchSharpness: 0.08,
    warningCodes: [],
    accepted: true,
  },
};
const metrics = {
  meanDeltaE00: 0.8,
  medianDeltaE00: 0.7,
  p95DeltaE00: 1.4,
  maxDeltaE00: 1.8,
  neutralAxisError: 0.4,
  skinMeanDeltaE00: 0.9,
};
const result = {
  receipt: {
    contract: 'rapidraw.chart_calibration.v1',
    implementationVersion: 1,
    cameraIdentity: 'Synthetic Camera',
    sourceRevision: 'source-revision-v1:test',
    rawProcessingProfile: 'balanced:test',
    chartId: sampling.chartId,
    chartVersion: 1,
    chartReferenceIlluminant: 'D65',
    chartObserver: 'CIE 1931 2 degree',
    chartProvenance: 'Wikimedia Commons Color Checker.svg sRGB/D65 numeric values',
    chartLicense: 'CC0-1.0',
    chartSourceUrl: 'https://commons.wikimedia.org/wiki/File:Color_Checker.svg',
    illuminant: { x: 0.3127, y: 0.329, cctKelvin: 6504, duv: 0 },
    adaptation: 'Bradford',
    trainPatchIds: Array.from({ length: 18 }, (_, index) => `patch-${index}`),
    validationPatchIds: Array.from({ length: 6 }, (_, index) => `patch-${index + 18}`),
    cameraToXyz: [
      [0.7, 0.2, 0.1],
      [0.1, 0.8, 0.1],
      [0.02, 0.08, 0.9],
    ],
    conditionNumber: 1.4,
    rejectedPatchIds: [],
    trainMetrics: metrics,
    validationMetrics: metrics,
    residualModelAccepted: false,
    qualityStatus: 'excellent',
    warningCodes: [],
    solverFingerprint: 'blake3:solver-test',
  },
  publishedProfileId: `dcp:${'a'.repeat(64)}`,
};
const invoke = mock(async (command: string, args: unknown) => {
  calls.push({ command, args });
  if (command === 'sample_color_chart') return sampling;
  if (command === 'fit_color_chart') return result;
  throw new Error(`unexpected command ${command}`);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  calls.length = 0;
  invoke.mockClear();
});

test('samples the technical RAW domain, surfaces quality, and publishes the measured receipt', async () => {
  installDom();
  const { ChartCalibrationModal } = await import('../../../src/components/adjustments/color/ChartCalibrationModal');
  const published: Array<string> = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(ChartCalibrationModal, {
        firstEndpoint: null,
        onClose: () => undefined,
        onEndpointSaved: () => undefined,
        onPublished: (profileId) => published.push(profileId),
        open: true,
        sourcePath: '/private/test.raw',
      }),
    ),
  );

  const sampleButton = container?.querySelector<HTMLButtonElement>('[data-testid="chart-sample-button"]');
  await act(async () => sampleButton?.click());
  expect(container.querySelector('[data-testid="chart-quality-status"]')?.getAttribute('data-accepted')).toBe('true');
  expect(calls[0]).toMatchObject({
    command: 'sample_color_chart',
    args: { input: { chartId: sampling.chartId, sourcePath: '/private/test.raw' } },
  });

  const publish = container.querySelector<HTMLInputElement>('[data-testid="chart-publish-profile"]');
  await act(async () => publish?.click());
  const fitButton = container.querySelector<HTMLButtonElement>('[data-testid="chart-fit-button"]');
  await act(async () => fitButton?.click());
  expect(container.querySelector('[data-testid="chart-fit-metrics"]')?.getAttribute('data-mean-delta-e')).toBe('0.8');
  expect(calls[1]).toMatchObject({
    command: 'fit_color_chart',
    args: {
      input: {
        calibration: {
          illuminant: { x: 0.3127, y: 0.329, cctKelvin: 6504, duv: 0 },
          publish: true,
          sampling: { sourceRevision: sampling.sourceRevision },
        },
        sourcePath: '/private/test.raw',
      },
    },
  });
  expect(published).toEqual([result.publishedProfileId]);
});

function installDom() {
  const window = new Window({ url: 'http://localhost/chart-calibration-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window, writable: true });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator, writable: true });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: window.HTMLElement,
    writable: true,
  });
  Object.defineProperty(globalThis, 'HTMLInputElement', {
    configurable: true,
    value: window.HTMLInputElement,
    writable: true,
  });
}
