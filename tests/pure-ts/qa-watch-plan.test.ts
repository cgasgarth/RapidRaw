import { describe, expect, test } from 'bun:test';
import {
  buildWatchRunArgs,
  isQaWatchSourcePath,
  watchedScenarioIds,
  withoutScenarioSelectors,
} from '../../scripts/qa/watch-plan';

describe('QA watch planning', () => {
  test('watches product, harness, integration, and configuration inputs without proof-output loops', () => {
    expect(isQaWatchSourcePath('src/components/editor/CompareControls.tsx')).toBeTrue();
    expect(isQaWatchSourcePath('src-tauri/src/lib.rs')).toBeTrue();
    expect(isQaWatchSourcePath('scripts/qa/run.ts')).toBeTrue();
    expect(isQaWatchSourcePath('tests/integration/checks/check-browser-tauri-harness.ts')).toBeTrue();
    expect(isQaWatchSourcePath('package.json')).toBeTrue();
    expect(isQaWatchSourcePath('private-artifacts/qa/run.json')).toBeFalse();
    expect(isQaWatchSourcePath('dist/index.html')).toBeFalse();
  });

  test('deduplicates changes and maps them to deterministic affected scenarios', () => {
    expect(
      watchedScenarioIds([
        'src/components/editor/CompareControls.tsx',
        'src/components/editor/CompareControls.tsx',
        'private-artifacts/qa/run.json',
      ]),
    ).toEqual(['browser.editor.compare']);
    expect(watchedScenarioIds(['private-artifacts/qa/run.json'])).toEqual([]);
  });

  test('replaces original scenario and tag selectors while retaining execution options', () => {
    expect(
      withoutScenarioSelectors(['run', '--persistent', '--tag', 'crop', '--scenario', 'browser.editor.compare']),
    ).toEqual(['run', '--persistent']);
    expect(buildWatchRunArgs(['run', '--watch', '--scenario', 'browser.editor.compare'])).toEqual([
      'run',
      '--scenario',
      'browser.editor.compare',
      '--persistent',
    ]);
    expect(
      buildWatchRunArgs(['run', '--watch', '--tag', 'crop'], ['browser.editor.compare', 'browser.editor.crop']),
    ).toEqual(['run', '--persistent', '--scenario', 'browser.editor.compare', '--scenario', 'browser.editor.crop']);
  });
});
