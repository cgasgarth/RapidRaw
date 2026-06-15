#!/usr/bin/env bun

import { buildLibrarySessionUiCard, librarySessionUiCardSchema } from '../src/schemas/librarySessionUiSchemas.ts';

const card = buildLibrarySessionUiCard({
  assetCount: 42,
  exportRecipeCount: 2,
  folderPath: '/Users/example/Pictures/Wedding',
  id: 'session-wedding-cull',
  name: 'Wedding Cull',
  selectedCount: 6,
  stage: 'cull',
});

const parsed = librarySessionUiCardSchema.safeParse(card);
if (!parsed.success || card.selectedLabel !== '6 selected' || card.recipeLabel !== '2 recipes') {
  console.error('Library session UI card validation failed.');
  process.exit(1);
}

console.log('library session UI ok');
