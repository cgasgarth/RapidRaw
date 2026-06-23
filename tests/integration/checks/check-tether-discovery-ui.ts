#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const panelSource = readFileSync('src/components/panel/right/TetherPanel.tsx', 'utf8');
const schemaSource = readFileSync('src/schemas/tetheringSchemas.ts', 'utf8');
const registrySource = readFileSync('src/components/panel/right/rightPanelRegistry.ts', 'utf8');
const appPropertiesSource = readFileSync('src/components/ui/AppProperties.tsx', 'utf8');
const libSource = readFileSync('src-tauri/src/lib.rs', 'utf8');
const rustSource = readFileSync('src-tauri/src/tethering.rs', 'utf8');
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
  editor?: { tether?: Record<string, unknown> };
};

const requiredSnippets = [
  [panelSource, 'data-testid="tether-panel"'],
  [panelSource, 'data-testid="tether-camera-card"'],
  [panelSource, 'data-testid="tether-provider-status"'],
  [panelSource, 'Invokes.DiscoverTetheredCameras'],
  [schemaSource, 'tetherDiscoveryResponseSchema'],
  [registrySource, 'Panel.Tether'],
  [appPropertiesSource, "Tether = 'tether'"],
  [appPropertiesSource, "DiscoverTetheredCameras = 'discover_tethered_cameras'"],
  [libSource, 'tethering::discover_tethered_cameras'],
  [rustSource, 'fake_tether_provider_returns_one_ready_camera'],
  [rustSource, 'hardware_adapter_pending'],
] as const;

const failures = requiredSnippets
  .filter(([source, snippet]) => !source.includes(snippet))
  .map(([, snippet]) => `missing marker: ${snippet}`);

for (const key of [
  'title',
  'subtitle',
  'refresh',
  'connected',
  'providerMode',
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
