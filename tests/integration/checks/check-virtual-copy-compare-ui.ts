#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/panel/MainLibrary.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  library?: { header?: { compare?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'getPhysicalImagePath',
  'getVirtualCopyLabel',
  'selectedCompareVariants',
  'image.is_virtual_copy',
  'thumbnails[image.path] ?? null',
  'onRequestThumbnails?.(selectedCompareVariants.map(({ image }) => image.path))',
  'data-testid="library-virtual-copy-compare-strip"',
  'data-testid={`library-virtual-copy-compare-slot-${slot}`}',
  "data-compare-source-path={getPhysicalImagePath(selectedCompareVariants[0]?.image.path ?? '')}",
  'data-compare-active={props.activePath === image.path}',
  'data-compare-has-thumbnail={thumbnail !== null}',
  'className="h-full w-full object-cover"',
  "t('library.header.compare.title')",
  "t('library.header.compare.original')",
  "t('library.header.compare.virtualCopy'",
  "t('library.header.compare.ready')",
];

const compareKeys = localeJson.library?.header?.compare ?? {};
const requiredLocaleKeys = ['title', 'original', 'virtualCopy', 'ready'];

const failures = [
  ...requiredSourceSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `missing: ${snippet}`),
  ...requiredLocaleKeys.filter((key) => compareKeys[key] === undefined).map((key) => `missing locale: ${key}`),
];

if (!packageJson.includes('"check:virtual-copy-compare-ui"')) {
  failures.push('missing package script: check:virtual-copy-compare-ui');
}

if (failures.length > 0) {
  console.error('virtual copy compare UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('virtual copy compare UI ok');
