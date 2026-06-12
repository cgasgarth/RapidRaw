import { useEffect, useState } from 'react';

interface ModalTransitionOptions {
  enterDelayMs?: number;
  exitDurationMs?: number;
}

export function useModalTransition(
  isOpen: boolean,
  { enterDelayMs = 10, exitDurationMs = 300 }: ModalTransitionOptions = {},
) {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof window.setTimeout> | null = null;

    const mountTimer = window.setTimeout(() => {
      if (isOpen) {
        setIsMounted(true);
        showTimer = window.setTimeout(() => {
          setShow(true);
        }, enterDelayMs);
        return;
      }

      setShow(false);
      showTimer = window.setTimeout(() => {
        setIsMounted(false);
      }, exitDurationMs);
    }, 0);

    return () => {
      window.clearTimeout(mountTimer);
      if (showTimer !== null) window.clearTimeout(showTimer);
    };
  }, [enterDelayMs, exitDurationMs, isOpen]);

  return { isMounted, show };
}
