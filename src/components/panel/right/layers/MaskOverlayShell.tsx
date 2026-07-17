import type { ReactNode } from 'react';

interface MaskOverlayShellProps {
  authorityIdentity: string;
  autoHidden: boolean;
  children: ReactNode;
}

/** Overlay controls are presentation-only and keyed to the current mask identity. */
export function MaskOverlayShell({ authorityIdentity, autoHidden, children }: MaskOverlayShellProps) {
  return (
    <section
      className="mt-2 shrink-0 border-t border-editor-border pt-2"
      data-mask-overlay-authority={authorityIdentity}
      data-mask-overlay-auto-hidden={String(autoHidden)}
      data-testid="mask-overlay-shell"
    >
      <div data-testid="mask-overlay-utility">{children}</div>
    </section>
  );
}
