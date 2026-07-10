import { describe, expect, test } from 'bun:test';

import { editorChromeTokens } from '../../../src/components/ui/editorChromeTokens.ts';
import { inspectorTokens } from '../../../src/components/ui/inspectorTokens.ts';
import {
  VISUAL_SMOKE_SCENARIO_IDS,
  VISUAL_SMOKE_SCENARIOS,
} from '../../../src/validation/visual/visualSmokeScenarios.ts';

describe('editor parity tokens', () => {
  test('keeps editor geometry, non-color state, motion, and coarse-pointer contracts named', () => {
    expect(editorChromeTokens.density.rightRail).toBe('w-[42px]');
    expect(editorChromeTokens.density.coarsePointerTarget).toContain('min-h-11');
    expect(editorChromeTokens.motion.previewHandoff).toContain('motion-reduce:duration-0');
    expect(editorChromeTokens.state.selected).toContain('before:bg-editor-primary-active');
    expect(editorChromeTokens.surface.imageFrame).toContain('bg-editor-viewer-matte');
    expect(editorChromeTokens.slider.defaultOriginFill).not.toBe(editorChromeTokens.slider.minimumOriginFill);
    expect(inspectorTokens.disclosure.resetAction).toContain('focus-visible:ring-editor-focus-ring');
    expect(inspectorTokens.numeric.defaultOriginFill).not.toBe(inspectorTokens.numeric.minimumOriginFill);
  });

  test('registers the deterministic editor parity matrix at both desktop review sizes', () => {
    const scenario = VISUAL_SMOKE_SCENARIOS.find(
      (candidate) => candidate.mode === VISUAL_SMOKE_SCENARIO_IDS.EditorParityContract,
    );

    expect(scenario).toMatchObject({
      compactOutputFile: 'editor-parity-contract-coarse-390x844.png',
      highDpiDeviceScaleFactor: 2,
      outputFile: 'editor-parity-contract-1440x900.png',
      reducedMotionOutputFile: 'editor-parity-contract-reduced-motion-1440x900.png',
      reviewOutputFile: 'editor-parity-contract-1224x768.png',
      reviewViewport: { height: 768, width: 1224 },
      viewport: { height: 900, width: 1440 },
    });
  });
});
