#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { negativeLabStockRegistrySchema } from '../../../../src/schemas/negative-lab/negativeLabStockRegistrySchemas.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';

const registryUrl = new URL('../../../../fixtures/negative-lab/negative-lab-stock-registry.json', import.meta.url);
const sourceRegistryUrl = new URL('../../../../src/data/negativeLabStockRegistry.json', import.meta.url);
const registry = negativeLabStockRegistrySchema.parse(JSON.parse(await readFile(registryUrl, 'utf8')));
const sourceRegistry = negativeLabStockRegistrySchema.parse(JSON.parse(await readFile(sourceRegistryUrl, 'utf8')));
const genericPresetIds = new Set(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.map((preset) => preset.presetId));
const bannedRuntimeText =
  /\b(?:adobe|capture one|dehancer|ektachrome|ektar|exact|fujifilm|fuji|gold|ilford|kodak|lightroom|mastin|negative lab pro|nlp|official|portra|rni|tri-x|t-max|vsco)\b/iu;

for (const entry of registry.entries) {
  if (entry.genericPresetId !== null && !genericPresetIds.has(entry.genericPresetId)) {
    throw new Error(`Stock registry entry references unknown generic preset: ${entry.registryId}`);
  }

  if (entry.provenance.sourceReferences.join('\n') !== entry.sourceReferences.join('\n')) {
    throw new Error(`Stock registry provenance references drifted from source references: ${entry.registryId}`);
  }

  if (
    !/\bnot measured\b|\brequires project-owned measurements\b|\bnot a negative inversion\b/iu.test(
      entry.provenance.legalNote,
    )
  ) {
    throw new Error(`Stock registry legal note does not disclose measurement/emulation boundary: ${entry.registryId}`);
  }

  if (entry.claimTier === 'generic_family_starting_point') {
    const runtimeText = [
      entry.colorResponseNotes,
      entry.contrastCurveDescriptor,
      entry.grainModelDescriptor,
      entry.stockFamilyDescriptor,
    ].join(' ');
    if (bannedRuntimeText.test(runtimeText)) {
      throw new Error(`Runtime stock-family mapping contains unsafe named-stock claim: ${entry.registryId}`);
    }

    if (
      entry.profileStatus !== 'heuristic' ||
      entry.provenance.measurementSource !== 'generic_engineered_starting_point'
    ) {
      throw new Error(`Runtime stock-family mapping must stay heuristic and generically sourced: ${entry.registryId}`);
    }
  } else if (
    entry.genericPresetId !== null ||
    !['needs_fixture', 'placeholder'].includes(entry.profileStatus) ||
    entry.provenance.measurementSource !== 'research_reference_metadata_only'
  ) {
    throw new Error(`Reference stock-family mapping must stay gated until measured: ${entry.registryId}`);
  }
}

const runtimeMappings = registry.entries.filter((entry) => entry.claimTier === 'generic_family_starting_point');
const referenceOnly = registry.entries.filter((entry) => entry.claimTier === 'reference_mapping_only');

if (runtimeMappings.length < 5) {
  throw new Error('Stock registry needs at least five generic family starting-point mappings.');
}

if (referenceOnly.length < 2) {
  throw new Error('Stock registry needs reference-only coverage for slide and cinema families.');
}

if (JSON.stringify(registry) !== JSON.stringify(sourceRegistry)) {
  throw new Error('Public stock registry fixture must match the source-owned runtime registry.');
}

console.log(
  `negative lab stock registry ok (${registry.entries.length} entries, ${runtimeMappings.length} runtime-safe)`,
);
