import { useSyncExternalStore } from 'react';

import { useUIStore } from '../../store/useUIStore';
import type { EditorWorkspaceViewport } from '../../utils/editorWorkspacePreferences';

export const COMPACT_EDITOR_MAX_WIDTH = 900;

export const classifyEditorWorkspaceViewport = (width: number, height: number): EditorWorkspaceViewport => {
  const normalizedWidth = Math.max(0, Math.round(width));
  const normalizedHeight = Math.max(0, Math.round(height));
  const isPortrait = normalizedWidth > 0 && normalizedHeight > normalizedWidth;
  return {
    height: normalizedHeight,
    isCompactPortrait: isPortrait && normalizedWidth <= COMPACT_EDITOR_MAX_WIDTH,
    isPortrait,
    width: normalizedWidth,
  };
};

export const areEditorWorkspaceViewportsEqual = (
  left: EditorWorkspaceViewport,
  right: EditorWorkspaceViewport,
): boolean =>
  left.width === right.width &&
  left.height === right.height &&
  left.isPortrait === right.isPortrait &&
  left.isCompactPortrait === right.isCompactPortrait;

const readBrowserViewport = (): EditorWorkspaceViewport => {
  if (typeof window === 'undefined') return classifyEditorWorkspaceViewport(0, 0);
  return classifyEditorWorkspaceViewport(
    window.visualViewport?.width ?? window.innerWidth,
    window.visualViewport?.height ?? window.innerHeight,
  );
};

let snapshot = readBrowserViewport();
const listeners = new Set<() => void>();

const publishBrowserViewport = () => {
  const next = readBrowserViewport();
  const didSnapshotChange = !areEditorWorkspaceViewportsEqual(snapshot, next);
  snapshot = next;
  const stored = useUIStore.getState().editorWorkspaceViewport;
  if (!areEditorWorkspaceViewportsEqual(stored, next)) useUIStore.getState().setEditorWorkspaceViewport(next);
  if (didSnapshotChange) for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (typeof window === 'undefined') return () => listeners.delete(listener);

  window.addEventListener('resize', publishBrowserViewport);
  window.addEventListener('orientationchange', publishBrowserViewport);
  window.visualViewport?.addEventListener('resize', publishBrowserViewport);
  publishBrowserViewport();

  return () => {
    listeners.delete(listener);
    window.removeEventListener('resize', publishBrowserViewport);
    window.removeEventListener('orientationchange', publishBrowserViewport);
    window.visualViewport?.removeEventListener('resize', publishBrowserViewport);
  };
};

const getSnapshot = () => snapshot;
const getServerSnapshot = () => classifyEditorWorkspaceViewport(0, 0);

export const useEditorWorkspaceViewportSubscription = (): EditorWorkspaceViewport =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
