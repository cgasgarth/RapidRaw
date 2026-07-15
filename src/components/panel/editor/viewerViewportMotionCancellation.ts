import type { ViewerViewportTransition } from './viewerViewportInteractionController';

/** Applies the controller's motion-cancellation edge at the DOM/runtime adapter boundary. */
export const applyViewerViewportMotionCancellation = (
  transition: ViewerViewportTransition | null,
  cancelMotion: () => void,
): void => {
  if (transition?.cancelMotion) cancelMotion();
};
