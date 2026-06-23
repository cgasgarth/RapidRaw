#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const readinessLocale = locale.editor?.metadata?.readiness;
const xmpConflictLocale = locale.editor?.metadata?.xmpConflicts;
const requiredLocaleKeys = [
  'cameraFields_one',
  'cameraFields_other',
  'editableFields_one',
  'editableFields_other',
  'gpsMissing',
  'gpsReady',
  'selectionCount_one',
  'selectionCount_other',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof readinessLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing metadata readiness locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const requiredXmpConflictLocaleKeys = [
  'apply',
  'checking',
  'description',
  'external',
  'local',
  'merge',
  'resolving',
  'title',
];
const missingXmpConflictKeys = requiredXmpConflictLocaleKeys.filter(
  (key) => typeof xmpConflictLocale?.[key] !== 'string',
);
if (missingXmpConflictKeys.length > 0) {
  console.error(`Missing XMP conflict locale keys: ${missingXmpConflictKeys.join(', ')}`);
  process.exit(1);
}

for (const choice of ['external', 'local', 'merge']) {
  if (typeof xmpConflictLocale?.choices?.[choice] !== 'string') {
    console.error(`Missing XMP conflict choice locale key: ${choice}`);
    process.exit(1);
  }
}

const source = readFileSync('src/components/panel/right/MetadataPanel.tsx', 'utf8');
for (const marker of [
  'data-testid="metadata-readiness-summary"',
  'data-selection-count={targetPaths.length}',
  'data-camera-field-count={populatedCameraFieldCount}',
  'data-gps-ready={String(gpsCoordinates !== null)}',
  'data-editable-field-count={editableMetadataFieldCount}',
  'editor.metadata.readiness.cameraFields',
  'editor.metadata.readiness.editableFields',
  'Invokes.CheckXmpMetadataConflicts',
  'Invokes.ResolveXmpMetadataConflicts',
  'data-xmp-conflict-field={field.field}',
  'editor.metadata.xmpConflicts.title',
  'editor.metadata.xmpConflicts.description',
]) {
  if (!source.includes(marker)) {
    console.error(`Metadata panel readiness marker missing: ${marker}`);
    process.exit(1);
  }
}

console.log('metadata panel UI ok');
