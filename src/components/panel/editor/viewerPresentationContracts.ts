import type { EditorWorkspaceLightsOutLevel } from '../../../schemas/editorWorkspacePreferencesSchemas';

export const VIEWER_LIGHTS_OUT_LEVELS = [
  'off',
  'dim',
  'black',
] as const satisfies readonly EditorWorkspaceLightsOutLevel[];

export type ViewerEscapeAction = 'exit-fullscreen' | 'exit-lights-out' | 'none';

export const getViewerLightsOutLabel = (level: EditorWorkspaceLightsOutLevel): string =>
  ({ black: 'Black', dim: 'Dim', off: 'Off' })[level];

export const getNextViewerLightsOutLevel = (level: EditorWorkspaceLightsOutLevel): EditorWorkspaceLightsOutLevel => {
  const index = VIEWER_LIGHTS_OUT_LEVELS.indexOf(level);
  return VIEWER_LIGHTS_OUT_LEVELS[(index + 1) % VIEWER_LIGHTS_OUT_LEVELS.length] ?? 'off';
};

export const resolveViewerEscapeAction = ({
  hasHigherPriorityEscapeOwner,
  isFullScreen,
  lightsOutLevel,
}: {
  hasHigherPriorityEscapeOwner: boolean;
  isFullScreen: boolean;
  lightsOutLevel: EditorWorkspaceLightsOutLevel;
}): ViewerEscapeAction => {
  if (hasHigherPriorityEscapeOwner) return 'none';
  if (lightsOutLevel !== 'off') return 'exit-lights-out';
  if (isFullScreen) return 'exit-fullscreen';
  return 'none';
};

export const resolveViewerFramePresentation = ({
  transformScale,
  zoomMode,
}: {
  transformScale: number;
  zoomMode: 'fill' | 'fit' | 'one-to-one' | 'ratio';
}) => ({
  edgeVisible: true,
  shadowVisible: zoomMode === 'fit' && transformScale <= 1.01,
});
