#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const panelSource = readFileSync('src/components/panel/right/TetherPanel.tsx', 'utf8');
const editorViewSource = readFileSync('src/components/views/EditorView.tsx', 'utf8');
const schemaSource = readFileSync('src/schemas/tetheringSchemas.ts', 'utf8');
const registrySource = readFileSync('src/components/panel/right/rightPanelRegistry.ts', 'utf8');
const appPropertiesSource = readFileSync('src/components/ui/AppProperties.tsx', 'utf8');
const visualSmokeSource = readFileSync('src/validation/visual/VisualSmokeApp.tsx', 'utf8');
const visualSmokeScriptSource = readFileSync('scripts/capture-visual-smoke.ts', 'utf8');
const libSource = readFileSync('src-tauri/src/lib.rs', 'utf8');
const rustSource = readFileSync('src-tauri/src/tethering.rs', 'utf8');
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
  editor?: { tether?: Record<string, unknown> };
};

const requiredSnippets = [
  [panelSource, 'data-testid="tether-panel"'],
  [panelSource, 'data-testid="tether-camera-card"'],
  [panelSource, 'data-testid="tether-provider-status"'],
  [panelSource, 'data-testid="tether-session-status"'],
  [panelSource, 'data-testid="tether-open-session"'],
  [panelSource, 'data-testid="tether-close-session"'],
  [panelSource, 'data-testid="tether-trigger-capture"'],
  [panelSource, 'data-testid="tether-capture-result"'],
  [panelSource, 'data-testid="tether-incoming-capture-strip"'],
  [panelSource, 'data-testid="tether-review-mode-control"'],
  [panelSource, 'data-testid="tether-incoming-capture-item"'],
  [panelSource, "type TetherReviewMode = 'holdCurrent' | 'newest' | 'pinned'"],
  [panelSource, 'setCaptures((current) => [response, ...current].slice(0, 8))'],
  [panelSource, "reviewMode === 'newest'"],
  [panelSource, 'data-testid="tether-pin-capture"'],
  [panelSource, 'data-testid="tether-open-capture"'],
  [panelSource, 'data-testid="tether-open-selected-capture"'],
  [panelSource, 'data-testid="tether-ingest-preset-select"'],
  [panelSource, 'data-testid="tether-metadata-template-select"'],
  [panelSource, 'data-testid="tether-backup-copy-toggle"'],
  [panelSource, 'data-ingest-preset-id={capture.ingest.presetId}'],
  [panelSource, 'data-metadata-template-id={capture.metadata.templateId}'],
  [panelSource, 'data-backup-status={capture.backup.status}'],
  [panelSource, 'backupDestinationRoot: isBackupEnabled && backupDestinationRoot.trim()'],
  [panelSource, 'data-pinned={String(isPinned)}'],
  [panelSource, "setReviewMode('pinned')"],
  [panelSource, 'onOpenCapture?.(path)'],
  [panelSource, 'Invokes.DiscoverTetheredCameras'],
  [panelSource, 'Invokes.OpenTetherSession'],
  [panelSource, 'Invokes.CloseTetherSession'],
  [panelSource, 'Invokes.TriggerTetherCapture'],
  [schemaSource, 'tetherDiscoveryResponseSchema'],
  [schemaSource, 'tetherSessionResponseSchema'],
  [schemaSource, 'tetherCaptureRequestSchema'],
  [schemaSource, 'tetherCaptureIngestSchema'],
  [schemaSource, 'tetherCaptureBackupSchema'],
  [schemaSource, 'tetherCaptureMetadataSchema'],
  [schemaSource, 'tetherCaptureResponseSchema'],
  [registrySource, 'Panel.Tether'],
  [appPropertiesSource, "Tether = 'tether'"],
  [appPropertiesSource, "DiscoverTetheredCameras = 'discover_tethered_cameras'"],
  [appPropertiesSource, "OpenTetherSession = 'open_tether_session'"],
  [appPropertiesSource, "CloseTetherSession = 'close_tether_session'"],
  [appPropertiesSource, "TriggerTetherCapture = 'trigger_tether_capture'"],
  [libSource, 'tethering::discover_tethered_cameras'],
  [libSource, 'tethering::open_tether_session'],
  [libSource, 'tethering::close_tether_session'],
  [libSource, 'tethering::trigger_tether_capture'],
  [rustSource, 'fake_tether_provider_returns_one_ready_camera'],
  [rustSource, 'fake_provider_opens_and_closes_session'],
  [rustSource, 'fake_provider_captures_verified_raw_copy'],
  [rustSource, 'fake_provider_reports_backup_failure_without_losing_primary_capture'],
  [rustSource, 'fake_provider_uses_collision_safe_ingest_counters'],
  [rustSource, 'apply_capture_metadata_template'],
  [rustSource, 'write_verified_backup_capture'],
  [rustSource, 'tether_capture_artifacts'],
  [rustSource, 'resolve_imported_capture_path'],
  [rustSource, '"{source_stem}_{counter:04}"'],
  [rustSource, 'hardware_adapter_pending'],
  [panelSource, 'data-testid="tether-incoming-capture-strip"'],
  [panelSource, 'data-testid="tether-review-mode-control"'],
  [panelSource, 'data-review-mode-option={mode}'],
  [editorViewSource, 'handleTetherCaptureOpen'],
  [editorViewSource, 'handleImageSelect(path)'],
  [editorViewSource, 'onOpenCapture={(path) =>'],
  [visualSmokeSource, "data-opened-capture-path={openedCapturePath ?? ''}"],
  [visualSmokeScriptSource, '[data-review-mode-option="pinned"]'],
  [visualSmokeScriptSource, "selectOption('sourceSequence')"],
  [visualSmokeScriptSource, "selectOption('studioSession')"],
  [visualSmokeScriptSource, 'tether-backup-copy-toggle'],
  [visualSmokeScriptSource, 'data-ingest-preset-id="sourceSequence"'],
  [visualSmokeScriptSource, 'data-metadata-template-id="studioSession"'],
  [visualSmokeScriptSource, 'data-backup-status="verified"'],
  [visualSmokeScriptSource, '[data-testid="tether-incoming-capture-item"][data-pinned="true"]'],
  [visualSmokeScriptSource, 'data-opened-capture-path="/tmp/rawengine-tether-captures/alaska-dsc7853.ARW"'],
] as const;

const failures = requiredSnippets
  .filter(([source, snippet]) => !source.includes(snippet))
  .map(([, snippet]) => `missing marker: ${snippet}`);

for (const key of [
  'title',
  'subtitle',
  'refresh',
  'connected',
  'capture',
  'captureBusy',
  'captureComplete',
  'captureVerified',
  'backupCopy',
  'backupCopyDescription',
  'backupCopyPlaceholder',
  'backupDisabled',
  'backupFailed',
  'backupVerified',
  'ingestApplied',
  'ingestPreset',
  'ingestPresetCameraSequence',
  'ingestPresetSourceSequence',
  'ingestPresetTimestampCamera',
  'metadataApplied',
  'metadataSkipped',
  'metadataTemplate',
  'metadataTemplateNone',
  'metadataTemplateStudioSession',
  'incomingCaptures',
  'reviewHoldCurrent',
  'reviewNewest',
  'reviewPinned',
  'pinCapture',
  'openCapture',
  'openSelectedCapture',
  'providerMode',
  'openSession',
  'closeSession',
  'sessionOpen',
  'sessionClosed',
  'noCameraTitle',
  'noCameraDescription',
]) {
  if (locale.editor?.tether?.[key] === undefined) failures.push(`missing locale: editor.tether.${key}`);
}

if (failures.length > 0) {
  console.error('tether discovery UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('tether discovery UI ok');
