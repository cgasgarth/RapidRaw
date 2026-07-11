import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnWidths } from '../MainLibrary';
import {
  applyColumnWidthVariables,
  type ColumnWidthKey,
  columnWidthsEqual,
  resizeAdjacentColumns,
} from './libraryColumnWidths';

interface ColumnResizeSession {
  pointerId: number;
  handle: HTMLElement;
  startClientX: number;
  containerWidth: number;
  initialWidths: ColumnWidths;
  draftWidths: ColumnWidths;
  left: ColumnWidthKey;
  right: ColumnWidthKey;
  rafId: number | null;
}

interface UseLibraryColumnResizeOptions {
  committedWidths: ColumnWidths;
  rootRef: React.RefObject<HTMLDivElement | null>;
  visibleColumns: readonly ColumnWidthKey[];
  commitWidths: (widths: ColumnWidths) => void;
  enabled?: boolean;
}

export function useLibraryColumnResize({
  committedWidths,
  rootRef,
  visibleColumns,
  commitWidths,
  enabled = true,
}: UseLibraryColumnResizeOptions) {
  const sessionRef = useRef<ColumnResizeSession | null>(null);
  const committedRef = useRef(committedWidths);
  const visibleRef = useRef(visibleColumns);
  const [isResizing, setIsResizing] = useState(false);

  committedRef.current = committedWidths;
  visibleRef.current = visibleColumns;

  const writeWidths = useCallback(
    (widths: ColumnWidths) => {
      if (rootRef.current) applyColumnWidthVariables(rootRef.current, widths, visibleRef.current);
    },
    [rootRef],
  );

  const flush = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.rafId !== null) cancelAnimationFrame(session.rafId);
    session.rafId = null;
    writeWidths(session.draftWidths);
  }, [writeWidths]);

  const finish = useCallback(
    (commit: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      if (commit) flush();
      else {
        if (session.rafId !== null) cancelAnimationFrame(session.rafId);
        writeWidths(session.initialWidths);
      }
      sessionRef.current = null;
      if (session.handle.hasPointerCapture?.(session.pointerId))
        session.handle.releasePointerCapture(session.pointerId);
      document.documentElement.style.removeProperty('user-select');
      setIsResizing(false);
      if (commit && !columnWidthsEqual(session.initialWidths, session.draftWidths)) commitWidths(session.draftWidths);
    },
    [commitWidths, flush, writeWidths],
  );

  useEffect(() => {
    if (!sessionRef.current) writeWidths(committedWidths);
  }, [committedWidths, visibleColumns, writeWidths]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finish, isResizing]);

  useEffect(() => {
    if (!enabled) finish(false);
  }, [enabled, finish]);

  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (!session) return;
      if (session.rafId !== null) cancelAnimationFrame(session.rafId);
      if (session.handle.hasPointerCapture?.(session.pointerId))
        session.handle.releasePointerCapture(session.pointerId);
      document.documentElement.style.removeProperty('user-select');
      applyColumnWidthVariables(rootRef.current ?? session.handle, committedRef.current, visibleRef.current);
      sessionRef.current = null;
    },
    [rootRef],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, left: ColumnWidthKey, right: ColumnWidthKey) => {
      if (sessionRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (!enabled) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      handle.focus();
      const containerWidth = rootRef.current?.clientWidth ?? 0;
      sessionRef.current = {
        pointerId: event.pointerId,
        handle,
        startClientX: event.clientX,
        containerWidth,
        initialWidths: { ...committedRef.current },
        draftWidths: { ...committedRef.current },
        left,
        right,
        rafId: null,
      };
      handle.setPointerCapture(event.pointerId);
      document.documentElement.style.setProperty('user-select', 'none');
      setIsResizing(true);
    },
    [enabled, rootRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const deltaPercent =
        session.containerWidth > 0 ? ((event.clientX - session.startClientX) / session.containerWidth) * 100 : 0;
      session.draftWidths = resizeAdjacentColumns(session.initialWidths, session.left, session.right, deltaPercent, {
        minPercentByColumn: { [session.left]: 1, [session.right]: 1 },
        visibleColumns: visibleRef.current,
      });
      if (session.rafId === null) session.rafId = requestAnimationFrame(flush);
    },
    [flush],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (sessionRef.current?.pointerId === event.pointerId) finish(true);
    },
    [finish],
  );
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (sessionRef.current?.pointerId === event.pointerId) finish(false);
    },
    [finish],
  );
  const onLostPointerCapture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (sessionRef.current?.pointerId === event.pointerId) finish(false);
    },
    [finish],
  );

  const resizeWithKeyboard = useCallback(
    (left: ColumnWidthKey, right: ColumnWidthKey, delta: number) => {
      const next = resizeAdjacentColumns(committedRef.current, left, right, delta, {
        minPercentByColumn: { [left]: 1, [right]: 1 },
        visibleColumns: visibleRef.current,
      });
      writeWidths(next);
      if (!columnWidthsEqual(committedRef.current, next)) commitWidths(next);
    },
    [commitWidths, writeWidths],
  );

  return {
    isResizing,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    resizeWithKeyboard,
  };
}
