#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/adjustments/Color.tsx', 'utf8');
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const colorLocale = locale.adjustments?.color;

const requiredLocaleKeys = [
  'channelMixer.title',
  'colorBalanceRgb.title',
  'colorGrading',
  'colorMixer',
  'profileTone.title',
  'skinToneUniformity.description',
  'skinToneUniformity.disabled',
  'skinToneUniformity.enabled',
  'skinToneUniformity.hue',
  'skinToneUniformity.hueCap',
  'skinToneUniformity.lightness',
  'skinToneUniformity.preview',
  'skinToneUniformity.saturation',
  'skinToneUniformity.title',
  'skinToneUniformity.warning',
  'workflowRecipes.apply',
  'workflowRecipes.cleanPortrait',
  'workflowRecipes.cleanPortraitDescription',
  'workflowRecipes.description',
  'workflowRecipes.landscapeDepth',
  'workflowRecipes.landscapeDepthDescription',
  'workflowRecipes.neutralProduct',
  'workflowRecipes.neutralProductDescription',
  'workflowRecipes.profileChip',
  'workflowRecipes.rangeChip',
  'workflowRecipes.toneChip',
  'workflowRecipes.whiteBalanceChip',
  'workflowRecipes.title',
];
const getValue = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((value, segment) => {
    if (value && typeof value === 'object' && segment in value) {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);

const missingLocaleKeys = requiredLocaleKeys.filter((key) => typeof getValue(colorLocale, key) !== 'string');
if (missingLocaleKeys.length > 0) {
  console.error(`Missing professional color workflow locale keys: ${missingLocaleKeys.join(', ')}`);
  process.exit(1);
}

for (const marker of [
  'ColorWorkflowReadinessRail',
  'data-testid="professional-color-workflow-readiness"',
  'data-testid="professional-color-readiness-item"',
  'data-profile-tone-ready="true"',
  'data-color-balance-ready="true"',
  'data-selective-color-ready="true"',
  'data-channel-mixer-ready="true"',
  'data-grading-ready="true"',
  'data-testid="professional-color-recipes"',
  'data-testid="skin-tone-uniformity-controls"',
  'data-testid="skin-tone-uniformity-toggle"',
  'data-skin-tone-runtime-proof="private-raw-preview-export"',
  'data-testid={`professional-color-recipe-${recipe.id}`}',
  'data-testid="professional-color-recipe-summary"',
  'aria-pressed={isApplied}',
  'data-active={String(isApplied)}',
  'applyProfessionalColorRecipe',
  'isProfessionalColorRecipeApplied',
  'professionalColorRecipes',
  'data-temperature={recipe.temperature}',
  'data-tint={recipe.tint}',
  'data-vibrance={recipe.vibrance}',
  "t('adjustments.color.workflowRecipes.title')",
  "t('adjustments.color.workflowRecipes.description')",
  "t('adjustments.color.workflowRecipes.profileChip'",
  "t('adjustments.color.workflowRecipes.toneChip'",
  "t('adjustments.color.workflowRecipes.whiteBalanceChip'",
  "t('adjustments.color.workflowRecipes.rangeChip'",
  "t('adjustments.color.profileTone.title')",
  "t('adjustments.color.colorBalanceRgb.title')",
  "t('adjustments.color.channelMixer.title')",
  "t('adjustments.color.colorMixer')",
  "t('adjustments.color.colorGrading')",
  "t('adjustments.color.skinToneUniformity.title')",
  "t('adjustments.color.skinToneUniformity.warning')",
]) {
  if (!source.includes(marker)) {
    console.error(`Professional color workflow UI missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('professional color workflow UI ok');
