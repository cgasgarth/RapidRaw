export const DEVELOP_SHELL_COMMAND_BAR_HEIGHT = 36;
export const DEVELOP_SHELL_CONTROL_BAR_HEIGHT = 36;
export const DEVELOP_SHELL_RESIZER_SIZE = 4;
export const DEVELOP_SHELL_RIGHT_RAIL_WIDTH = 42;
export const DEVELOP_SHELL_DEFAULT_FILMSTRIP_HEIGHT = 112;
export const DEVELOP_SHELL_DEFAULT_LEFT_PANEL_WIDTH = 240;
export const DEVELOP_SHELL_DEFAULT_RIGHT_PANEL_WIDTH = 360;

export interface DevelopShellGeometryInput {
  filmstripHeight: number;
  filmstripVisible: boolean;
  fullscreen: boolean;
  leftRegionWidth: number;
  rightInspectorVisible: boolean;
  rightInspectorWidth: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface DevelopShellGeometry {
  canvasHeight: number;
  canvasWidth: number;
  commandBarHeight: number;
  filmstripTrackHeight: number;
  leftTrackWidth: number;
  rightTrackWidth: number;
}

/**
 * Describes the actual desktop Develop tracks. Keeping this math outside React makes the
 * canvas-first contract measurable at every supported window size and prevents decorative
 * gutters from silently consuming image space.
 */
export const resolveDevelopShellGeometry = ({
  filmstripHeight,
  filmstripVisible,
  fullscreen,
  leftRegionWidth,
  rightInspectorVisible,
  rightInspectorWidth,
  viewportHeight,
  viewportWidth,
}: DevelopShellGeometryInput): DevelopShellGeometry => {
  if (fullscreen) {
    return {
      canvasHeight: Math.max(0, viewportHeight),
      canvasWidth: Math.max(0, viewportWidth),
      commandBarHeight: 0,
      filmstripTrackHeight: 0,
      leftTrackWidth: 0,
      rightTrackWidth: 0,
    };
  }

  const commandBarHeight = DEVELOP_SHELL_COMMAND_BAR_HEIGHT;
  const filmstripTrackHeight =
    DEVELOP_SHELL_RESIZER_SIZE +
    DEVELOP_SHELL_CONTROL_BAR_HEIGHT +
    (filmstripVisible ? Math.max(0, filmstripHeight) : 0);
  const leftTrackWidth = Math.max(0, leftRegionWidth);
  const rightTrackWidth = rightInspectorVisible
    ? DEVELOP_SHELL_RESIZER_SIZE + Math.max(0, rightInspectorWidth)
    : DEVELOP_SHELL_RIGHT_RAIL_WIDTH;

  return {
    canvasHeight: Math.max(0, viewportHeight - commandBarHeight - filmstripTrackHeight),
    canvasWidth: Math.max(0, viewportWidth - leftTrackWidth - rightTrackWidth),
    commandBarHeight,
    filmstripTrackHeight,
    leftTrackWidth,
    rightTrackWidth,
  };
};
