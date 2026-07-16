import { describe, expect, test } from 'bun:test';

import {
  DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT,
  DEVELOP_SHELL_RESIZER_SIZE,
  resolveDevelopShellGeometry,
} from '../../../src/utils/developShellGeometry';
import {
  createDefaultEditorWorkspacePreferences,
  getEffectiveEditorWorkspaceLayout,
} from '../../../src/utils/editorWorkspacePreferences';
import { VISUAL_SMOKE_SCENARIO_IDS, VISUAL_SMOKE_SCENARIOS } from '../../../src/validation/visual/visualSmokeScenarios';

const desktopGeometry = (width: number, height: number) => {
  const preferences = createDefaultEditorWorkspacePreferences();
  const effective = getEffectiveEditorWorkspaceLayout(preferences, {
    height,
    isCompactPortrait: false,
    isPortrait: height > width,
    width,
  });
  return resolveDevelopShellGeometry({
    filmstripHeight: effective.bottomPanelHeight,
    filmstripVisible: true,
    fullscreen: false,
    leftRegionWidth: effective.leftPanelWidth + DEVELOP_SHELL_RESIZER_SIZE,
    rightInspectorVisible: true,
    rightInspectorWidth: effective.rightPanelWidth,
    viewportHeight: height,
    viewportWidth: width,
  });
};

describe('Lightroom-style Develop shell geometry', () => {
  test('holds measured canvas budgets at 800x600, 1224x768, 1440x900, and 1968x1280', () => {
    expect(desktopGeometry(800, 600)).toEqual({
      canvasHeight: 412,
      canvasWidth: 472,
      commandBarHeight: 36,
      filmstripTrackHeight: 152,
      leftTrackWidth: 132,
      rightTrackWidth: 196,
    });
    expect(desktopGeometry(1224, 768)).toEqual({
      canvasHeight: 580,
      canvasWidth: 616,
      commandBarHeight: 36,
      filmstripTrackHeight: 152,
      leftTrackWidth: 244,
      rightTrackWidth: 364,
    });
    expect(desktopGeometry(1440, 900)).toEqual({
      canvasHeight: 712,
      canvasWidth: 832,
      commandBarHeight: 36,
      filmstripTrackHeight: 152,
      leftTrackWidth: 244,
      rightTrackWidth: 364,
    });
    expect(desktopGeometry(1968, 1280)).toEqual({
      canvasHeight: 1092,
      canvasWidth: 1360,
      commandBarHeight: 36,
      filmstripTrackHeight: 152,
      leftTrackWidth: 244,
      rightTrackWidth: 364,
    });
  });

  test('reclaims the exact tracks when panels collapse or preview goes fullscreen', () => {
    const collapsed = resolveDevelopShellGeometry({
      filmstripHeight: DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT,
      filmstripVisible: false,
      fullscreen: false,
      leftRegionWidth: 80,
      rightInspectorVisible: false,
      rightInspectorWidth: 360,
      viewportHeight: 900,
      viewportWidth: 1440,
    });
    expect(collapsed).toMatchObject({ canvasHeight: 824, canvasWidth: 1318, filmstripTrackHeight: 40 });

    expect(
      resolveDevelopShellGeometry({
        filmstripHeight: DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT,
        filmstripVisible: true,
        fullscreen: true,
        leftRegionWidth: 244,
        rightInspectorVisible: true,
        rightInspectorWidth: 360,
        viewportHeight: 900,
        viewportWidth: 1440,
      }),
    ).toEqual({
      canvasHeight: 900,
      canvasWidth: 1440,
      commandBarHeight: 0,
      filmstripTrackHeight: 0,
      leftTrackWidth: 0,
      rightTrackWidth: 0,
    });
  });

  test('keeps the shell visual matrix at the supported desktop sizes and presentation states', () => {
    const shellModes = new Set<string>([
      VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShell,
      VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShellCollapsed,
      VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShellFullscreen,
    ]);
    const scenarios = VISUAL_SMOKE_SCENARIOS.filter(({ mode }) => shellModes.has(mode));
    expect(scenarios).toMatchObject([
      {
        compactViewport: { height: 600, width: 800 },
        mode: VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShell,
        reviewViewport: { height: 1280, width: 1968 },
        viewport: { height: 900, width: 1440 },
      },
      { mode: VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShellCollapsed },
      { mode: VISUAL_SMOKE_SCENARIO_IDS.ProfessionalEditorShellFullscreen },
    ]);
  });
});
