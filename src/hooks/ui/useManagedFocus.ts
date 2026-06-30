import { type RefObject, useEffect } from 'react';

interface ManagedFocusOptions {
  preventScroll?: boolean;
  selectText?: boolean;
}

export function useManagedFocus<T extends HTMLElement>(
  ref: RefObject<T | null>,
  shouldFocus: boolean,
  { preventScroll = true, selectText = false }: ManagedFocusOptions = {},
) {
  useEffect(() => {
    if (!shouldFocus) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) {
        return;
      }

      element.focus({ preventScroll });
      if (selectText && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        element.select();
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [preventScroll, ref, selectText, shouldFocus]);
}
