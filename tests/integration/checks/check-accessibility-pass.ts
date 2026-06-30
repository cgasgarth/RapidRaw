#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { ESLint } from 'eslint';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { z } from 'zod';

import { LibraryExportPanelSlot } from '../../../src/App.tsx';
import CommandPaletteModal from '../../../src/components/modals/CommandPaletteModal.tsx';
import ConfirmModal from '../../../src/components/modals/ConfirmModal.tsx';
import FocusStackModal from '../../../src/components/modals/FocusStackModal.tsx';
import SuperResolutionModal from '../../../src/components/modals/SuperResolutionModal.tsx';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focusStackUiSchemas.ts';
import { DEFAULT_SUPER_RESOLUTION_UI_SETTINGS } from '../../../src/schemas/superResolutionUiSchemas.ts';

const RequiredRuleSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

const DialogTargetSchema = z
  .object({
    closeLabel: z.string().min(1),
    element: z.custom<ReactElement>(),
    name: z.string().min(1),
    target: z.string().min(1),
  })
  .strict();

const requiredRules = z
  .array(RequiredRuleSchema)
  .parse([
    { name: 'jsx-a11y/no-static-element-interactions' },
    { name: 'jsx-a11y/click-events-have-key-events' },
    { name: 'jsx-a11y/no-autofocus' },
    { name: 'jsx-a11y/no-noninteractive-element-interactions' },
  ]);

const lintTargets = [
  'src/components/modals/ConfirmModal.tsx',
  'src/components/modals/CommandPaletteModal.tsx',
  'src/components/panel/right/AIPanel.tsx',
  'src/components/panel/right/MasksPanel.tsx',
  'src/components/panel/right/PresetsPanel.tsx',
];

const severityName = (ruleConfig) => {
  const severity = Array.isArray(ruleConfig) ? ruleConfig[0] : ruleConfig;
  if (severity === 2 || severity === 'error') return 'error';
  if (severity === 1 || severity === 'warn') return 'warn';
  return 'off';
};

const eslint = new ESLint({ cwd: process.cwd() });
const config = await eslint.calculateConfigForFile('src/components/modals/ConfirmModal.tsx');
const failures = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

for (const rule of requiredRules) {
  if (severityName(config.rules?.[rule.name]) !== 'error') {
    failures.push(`${rule.name} must be enforced as an error.`);
  }
}

const lintResults = await eslint.lintFiles(lintTargets);
for (const result of lintResults) {
  for (const message of result.messages) {
    if (message.severity === 2 && message.ruleId?.startsWith('jsx-a11y/')) {
      failures.push(`${result.filePath}:${message.line}:${message.column} ${message.ruleId} ${message.message}`);
    }
  }
}

const renderedDialogTargets = z.array(DialogTargetSchema).parse([
  {
    closeLabel: 'Cancel',
    element: withI18n(
      createElement(ConfirmModal, {
        isOpen: true,
        message: 'Discard the pending edit?',
        onClose: noop,
        onConfirm: noop,
        title: 'Discard edit',
      }),
    ),
    name: 'Discard edit',
    target: 'ConfirmModal',
  },
  {
    closeLabel: locale.modals.commandPalette.close,
    element: withI18n(createElement(CommandPaletteModal, { isOpen: true, onBackToLibrary: noop, onClose: noop })),
    name: locale.modals.commandPalette.title,
    target: 'CommandPaletteModal',
  },
  {
    closeLabel: 'Close',
    element: withI18n(
      createElement(FocusStackModal, {
        isOpen: true,
        loadingImageUrl: null,
        onApplyPlan: noop,
        onClose: noop,
        onPreviewPlan: noop,
        onSettingsChange: noop,
        settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
        sourceCount: 3,
        sourcePaths: ['/raw/focus-1.ARW', '/raw/focus-2.ARW', '/raw/focus-3.ARW'],
      }),
    ),
    name: locale.modals.focusStack.title,
    target: 'FocusStackModal',
  },
  {
    closeLabel: 'Close',
    element: withI18n(
      createElement(SuperResolutionModal, {
        isOpen: true,
        loadingImageUrl: null,
        onApplyPlan: noop,
        onClose: noop,
        onPreviewPlan: noop,
        onSettingsChange: noop,
        settings: DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
        sourceCount: 3,
        sourcePaths: ['/raw/sr-1.ARW', '/raw/sr-2.ARW', '/raw/sr-3.ARW'],
      }),
    ),
    name: locale.modals.superResolution.title,
    target: 'SuperResolutionModal',
  },
]);

for (const target of renderedDialogTargets) {
  assertRenderedDialog(target, failures);
}

assertLibraryExportPanelSlot(failures);

if (failures.length > 0) {
  console.error('Accessibility pass failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `a11y ok rules=${requiredRules.length} lintTargets=${lintTargets.length} dialogs=${renderedDialogTargets.length}`,
);

function assertLibraryExportPanelSlot(failures: string[]) {
  const marker = 'rendered-library-export-panel';
  const visibleMarkup = renderToStaticMarkup(
    createElement(
      LibraryExportPanelSlot,
      { hasSelectedImage: false, isLibraryExportPanelVisible: true },
      createElement('aside', { 'data-testid': marker }, 'Export panel'),
    ),
  );
  const hiddenMarkup = renderToStaticMarkup(
    createElement(
      LibraryExportPanelSlot,
      { hasSelectedImage: false, isLibraryExportPanelVisible: false },
      createElement('aside', { 'data-testid': marker }, 'Export panel'),
    ),
  );
  const editorMarkup = renderToStaticMarkup(
    createElement(
      LibraryExportPanelSlot,
      { hasSelectedImage: true, isLibraryExportPanelVisible: true },
      createElement('aside', { 'data-testid': marker }, 'Export panel'),
    ),
  );

  if (!visibleMarkup.includes(marker)) {
    failures.push('LibraryExportPanelSlot must render the export panel when the library panel is visible.');
  }
  if (hiddenMarkup.includes(marker)) {
    failures.push('LibraryExportPanelSlot must unmount the export panel when the library panel is hidden.');
  }
  if (editorMarkup.includes(marker)) {
    failures.push('LibraryExportPanelSlot must unmount the library export panel when an editor image is selected.');
  }
}

function assertRenderedDialog(
  target: {
    closeLabel: string;
    element: ReactElement;
    name: string;
    target: string;
  },
  failures: string[],
) {
  const markup = renderToStaticMarkup(target.element);
  const dialogMatch = markup.match(/<([a-z0-9-]+)\b[^>]*\brole="dialog"[^>]*>/iu);
  const dialogTag = dialogMatch?.[0];

  if (dialogTag === undefined) {
    failures.push(`${target.target} must render a dialog role.`);
    return;
  }
  if (!/\baria-modal="true"/iu.test(dialogTag)) {
    failures.push(`${target.target} must render aria-modal="true" on the dialog.`);
  }

  const labelledBy = dialogTag.match(/\baria-labelledby="([^"]+)"/iu)?.[1];
  if (labelledBy === undefined) {
    failures.push(`${target.target} must render aria-labelledby on the dialog.`);
    return;
  }

  const labelText = textById(markup, labelledBy);
  if (labelText === null) {
    failures.push(`${target.target} aria-labelledby must point to a rendered title.`);
  } else if (normalizeText(labelText) !== normalizeText(target.name)) {
    failures.push(`${target.target} dialog name must be "${target.name}", got "${normalizeText(labelText)}".`);
  }

  if (!renderedAccessibleNameIncludes(markup, target.closeLabel)) {
    failures.push(`${target.target} must render a close affordance named "${target.closeLabel}".`);
  }
}

function renderedAccessibleNameIncludes(markup: string, expected: string) {
  const normalizedExpected = normalizeText(expected);
  const ariaLabels = [...markup.matchAll(/\baria-label="([^"]+)"/giu)].map((match) => normalizeText(match[1] ?? ''));
  return normalizeText(stripTags(markup)).includes(normalizedExpected) || ariaLabels.includes(normalizedExpected);
}

function textById(markup: string, id: string) {
  const escapedId = escapeRegExp(id);
  const pattern = new RegExp(`<([a-z0-9-]+)\\b[^>]*\\bid="${escapedId}"[^>]*>([\\s\\S]*?)<\\/\\1>`, 'iu');
  const match = markup.match(pattern);
  return match === null ? null : stripTags(match[2] ?? '');
}

function stripTags(markup: string) {
  return markup.replace(/<[^>]*>/gu, ' ');
}

function normalizeText(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function withI18n(children: ReactElement) {
  return createElement(I18nextProvider, { i18n }, children);
}

function noop() {
  return undefined;
}

async function createTestI18n(resources: typeof locale) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}
