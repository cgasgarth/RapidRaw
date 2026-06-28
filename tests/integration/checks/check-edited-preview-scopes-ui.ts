#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const failures: string[] = [];

const storeSource = read('src/store/useEditorStore.ts');
const listenerSource = read('src/hooks/useTauriListeners.ts');
const waveformSource = read('src/components/panel/editor/Waveform.tsx');
const controlsPanelSource = read('src/components/panel/right/ControlsPanel.tsx');
const masksPanelSource = read('src/components/panel/right/MasksPanel.tsx');
const rustLibSource = read('src-tauri/src/lib.rs');
const gpuProcessingSource = read('src-tauri/src/gpu_processing.rs');
const locale = JSON.parse(read('src/i18n/locales/en.json'));

for (const marker of [
  'export interface PreviewScopeStatus',
  'previewScopeStatus: PreviewScopeStatus | null',
  'previewScopeStatus: null',
]) {
  if (!storeSource.includes(marker)) failures.push(`Editor store missing ${marker}`);
}

for (const marker of [
  'PREVIEW_SCOPE_SOURCE_LABEL',
  'PREVIEW_SCOPE_WORKING_TRANSFORM_LABEL',
  'PREVIEW_SCOPE_DISPLAY_TRANSFORM_LABEL',
  'histogramReady: true',
  'waveformReady: true',
  'updatedAt: new Date().toISOString()',
]) {
  if (!listenerSource.includes(marker)) failures.push(`Tauri listener missing ${marker}`);
}

for (const marker of [
  'data-testid="preview-scope-status"',
  'data-preview-scope-ready',
  'data-preview-scope-source',
  'data-working-transform-label',
  'data-display-transform-label',
  'ui.waveform.scopeStatus.ready',
  'ui.waveform.scopeStatus.updating',
  'ui.waveform.scopeStatus.pending',
]) {
  if (!waveformSource.includes(marker)) failures.push(`Waveform UI missing ${marker}`);
}

for (const [panelName, source] of [
  ['ControlsPanel', controlsPanelSource],
  ['MasksPanel', masksPanelSource],
] as const) {
  if (!source.includes('previewScopeStatus: state.previewScopeStatus')) {
    failures.push(`${panelName} does not subscribe to previewScopeStatus.`);
  }
  if (!source.includes('previewScopeStatus={previewScopeStatus}')) {
    failures.push(`${panelName} does not pass previewScopeStatus to Waveform.`);
  }
}

for (const marker of [
  'calculate_histogram_from_image(&job.image)',
  'calculate_waveform_from_image(',
  'process_and_get_dynamic_image_with_analytics',
]) {
  if (!rustLibSource.includes(marker) && !gpuProcessingSource.includes(marker)) {
    failures.push(`Runtime edited-preview analytics path missing ${marker}`);
  }
}

for (const key of ['pending', 'ready', 'updating']) {
  if (typeof locale.ui?.waveform?.scopeStatus?.[key] !== 'string') {
    failures.push(`Missing locale ui.waveform.scopeStatus.${key}`);
  }
}

if (failures.length > 0) {
  console.error('edited preview scopes UI failed');
  console.error(failures.slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('edited preview scopes UI ok');
