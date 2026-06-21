#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const cullingLocale = locale.modals?.culling;
const requiredLocaleKeys = [
  'batchPreview',
  'batchPreviewAlt',
  'batchPreviewMore_one',
  'batchPreviewMore_other',
  'emptyAnalysisModes',
  'emptyBatch',
  'progressCount',
  'summaryAnalysisModeCount_one',
  'summaryAnalysisModeCount_other',
  'summaryAnalysisModes',
  'summaryBlur',
  'summaryDisabled',
  'summaryEnabledThreshold',
  'summarySimilar',
  'summarySourceCount_one',
  'summarySourceCount_other',
  'summarySourceMix',
  'summarySourceMixValue',
  'summarySources',
  'summaryWorkload',
  'summaryWorkloadValue_one',
  'summaryWorkloadValue_other',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof cullingLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing culling summary locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/modals/CullingModal.tsx', 'utf8');
for (const marker of [
  'data-testid="culling-setup-summary"',
  'data-testid="culling-setup-batch-preview"',
  'data-preview-count={setupPreviewPaths.length}',
  'data-preview-overflow-count={setupPreviewOverflowCount}',
  'SETUP_PREVIEW_LIMIT = 6',
  'modals.culling.batchPreview',
  'modals.culling.batchPreviewMore',
  'data-testid="culling-empty-batch-guard"',
  'data-testid="culling-empty-analysis-mode-guard"',
  'const hasCullingAnalysisMode = settings.groupSimilar || settings.filterBlurry',
  'const cullingAnalysisModeCount = Number(settings.groupSimilar) + Number(settings.filterBlurry)',
  'const canStartCulling = imagePaths.length > 0 && hasCullingAnalysisMode',
  'disabled={!canStartCulling}',
  'modals.culling.emptyAnalysisModes',
  'modals.culling.emptyBatch',
  'data-testid="culling-progress-count"',
  'modals.culling.progressCount',
  'data-image-count={imagePaths.length}',
  'data-raw-source-count={sourceMix.raw}',
  'data-raster-source-count={sourceMix.raster}',
  'data-group-similar-enabled={String(settings.groupSimilar)}',
  'data-blur-filter-enabled={String(settings.filterBlurry)}',
  'data-culling-analysis-mode-count={cullingAnalysisModeCount}',
  'modals.culling.summaryAnalysisModes',
  'modals.culling.summaryAnalysisModeCount',
  'modals.culling.summarySourceMix',
  'modals.culling.summarySourceMixValue',
  'modals.culling.summaryWorkload',
  'modals.culling.summaryWorkloadValue',
]) {
  if (!source.includes(marker)) {
    console.error(`Culling setup summary missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('culling UI summary ok');
