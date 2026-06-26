#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/panel/FolderTree.tsx', 'utf8');
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const folderItems = locale.library?.items;

const requiredLocaleKeys = ['collapseFolderNamed', 'expandFolderNamed', 'selectFolderNamed'];
const missingLocaleKeys = requiredLocaleKeys.filter((key) => typeof folderItems?.[key] !== 'string');
if (missingLocaleKeys.length > 0) {
  throw new Error(`Missing folder tree locale keys: ${missingLocaleKeys.join(', ')}`);
}

for (const marker of [
  "aria-label={t('library.items.selectFolderNamed'",
  'aria-label={disclosureLabel}',
  'aria-expanded={hasChildren ? isExpanded : undefined}',
  'aria-expanded={isExpanded}',
]) {
  if (!source.includes(marker)) {
    throw new Error(`Folder tree disclosure a11y marker missing: ${marker}`);
  }
}

console.log('folder tree disclosure a11y ok');
