import { useEffect } from 'react';

const GENERATED_ARIA_LABEL_ATTR = 'data-rawengine-generated-aria-label';

const hasVisibleText = (button: HTMLButtonElement): boolean => button.textContent.trim().length > 0;

const syncTooltipButtonLabel = (button: HTMLButtonElement): void => {
  if (button.getAttribute('aria-label') || hasVisibleText(button)) return;

  const tooltip = button.getAttribute('data-tooltip')?.trim();
  if (!tooltip) return;

  button.setAttribute('aria-label', tooltip);
  button.setAttribute(GENERATED_ARIA_LABEL_ATTR, 'true');
};

const syncTooltipButtonLabels = (root: ParentNode): void => {
  if (root instanceof HTMLButtonElement) {
    syncTooltipButtonLabel(root);
  }
  root.querySelectorAll('button[data-tooltip]').forEach((button) => {
    if (button instanceof HTMLButtonElement) syncTooltipButtonLabel(button);
  });
};

export const useTooltipAccessibility = (): void => {
  useEffect(() => {
    syncTooltipButtonLabels(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLButtonElement) {
          syncTooltipButtonLabel(mutation.target);
        }
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) syncTooltipButtonLabels(node);
        });
      }
    });

    observer.observe(document.body, {
      attributeFilter: ['data-tooltip', 'aria-label'],
      attributes: true,
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, []);
};
