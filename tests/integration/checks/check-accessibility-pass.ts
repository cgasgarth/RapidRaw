#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { ESLint } from 'eslint';
import { z } from 'zod';

const RequiredRuleSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

const DialogTargetSchema = z
  .object({
    path: z.string().min(1),
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

const dialogTargets = z
  .array(DialogTargetSchema)
  .parse([
    { path: 'src/components/modals/ConfirmModal.tsx' },
    { path: 'src/components/modals/CommandPaletteModal.tsx' },
    { path: 'src/components/modals/FocusStackModal.tsx' },
    { path: 'src/components/modals/SuperResolutionModal.tsx' },
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

const appSource = await readFile('src/App.tsx', 'utf8');
if (!appSource.includes('!selectedImage && isLibraryExportPanelVisible &&')) {
  failures.push('src/App.tsx must unmount the library ExportPanel when it is not visible.');
}

for (const target of dialogTargets) {
  const source = await readFile(target.path, 'utf8');
  const usesComputationalSetupShell = source.includes('ComputationalSetupModalShell');
  const shellSource = usesComputationalSetupShell
    ? await readFile('src/components/modals/ComputationalSetupModalShell.tsx', 'utf8')
    : '';
  const dialogSource = usesComputationalSetupShell ? shellSource : source;

  if (!dialogSource.includes('role="dialog"')) {
    failures.push(`${target.path} must expose role="dialog".`);
  }
  if (!dialogSource.includes('aria-modal="true"')) {
    failures.push(`${target.path} must expose aria-modal="true".`);
  }
  if (!dialogSource.includes('aria-labelledby=')) {
    failures.push(`${target.path} must label the dialog with aria-labelledby.`);
  }
}

if (failures.length > 0) {
  console.error('Accessibility pass failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`a11y ok rules=${requiredRules.length} lintTargets=${lintTargets.length} dialogs=${dialogTargets.length}`);
