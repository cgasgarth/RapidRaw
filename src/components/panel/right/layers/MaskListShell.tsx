import type { ReactNode } from 'react';

interface MaskListShellProps {
  children: ReactNode;
  count: number;
}

/** Focused host for the current typed mask authority; tool controls stay below it. */
export function MaskListShell({ children, count }: MaskListShellProps) {
  return (
    <section
      className="min-h-0 shrink-0"
      data-mask-list-state={count === 0 ? 'empty' : 'ready'}
      data-mask-list-count={count}
      data-testid="mask-list-shell"
    >
      {children}
    </section>
  );
}
