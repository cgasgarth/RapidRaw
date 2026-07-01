export const inspectorSectionTokens = {
  badge: 'rounded px-1.5 py-0.5 text-xs font-semibold uppercase leading-4 tracking-normal',
  body: 'px-3 pb-2 pt-1 transition-opacity duration-200',
  chevron: 'text-text-secondary transition-transform duration-200',
  dirtyBadge: 'bg-accent/15 text-accent',
  header:
    'group min-h-8 w-full px-3 py-1 flex items-center justify-between gap-2 text-left hover:bg-card-active transition-colors duration-150',
  actionsMenuSlot: 'h-5 w-5 shrink-0',
  headerActionButton:
    'z-10 flex h-5 w-5 items-center justify-center rounded text-text-secondary transition-colors duration-150 hover:bg-bg-primary hover:text-text-primary focus-visible:bg-bg-primary focus-visible:text-text-primary',
  headerActions:
    'flex h-5 shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
  hiddenBadge: 'bg-surface text-text-secondary',
  shell: 'bg-surface overflow-hidden shrink-0 border-b border-surface/70',
  title: 'truncate text-[13px] leading-4 tracking-normal text-text-primary',
  titleRow: 'flex min-w-0 items-center gap-1.5',
  visibilityButton:
    'z-10 flex h-5 w-5 items-center justify-center rounded text-text-secondary transition-colors duration-150 hover:bg-bg-primary hover:text-text-primary',
  visibilitySlot: 'w-5 h-5 flex items-center justify-center shrink-0',
} as const;

export const professionalInspectorDensityTokens = {
  actionButton: {
    active: 'bg-accent text-button-text',
    base: 'inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-2 text-[11px] font-medium leading-none transition-colors',
    icon: 'w-6 px-0',
    inactive: 'bg-bg-secondary text-text-secondary hover:bg-surface hover:text-text-primary',
    quiet: 'bg-surface text-text-secondary hover:bg-bg-secondary hover:text-text-primary',
    selectedQuiet: 'bg-bg-secondary text-text-primary',
  },
  card: {
    panel: 'rounded-md bg-bg-tertiary p-1.5',
    nested: 'rounded border border-border bg-bg-secondary px-2 py-1',
    nestedBare: 'rounded bg-bg-secondary px-2 py-1',
    nestedPanel: 'rounded-md border border-border bg-bg-tertiary p-1.5',
    surface: 'rounded-md border border-surface bg-bg-primary',
  },
  gutter: {
    panel: 'space-y-2',
    section: 'space-y-1.5',
  },
  row: {
    label: 'text-[10px] font-medium leading-3 text-text-tertiary',
    value: 'text-right font-mono text-[11px] leading-3 tabular-nums text-text-secondary',
    valueSlot: 'min-w-0 shrink-0 text-right',
  },
  scrollPadding: 'scroll-px-2 scroll-py-2',
  sectionHeader: {
    badge:
      'shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-normal text-text-secondary',
    root: 'mb-2 flex min-h-6 items-center justify-between gap-2',
    rootLoose: 'mb-2 flex items-start justify-between gap-2',
    summary: 'mt-0.5 block text-[11px] leading-4 text-text-secondary',
    title: 'text-[12px] font-semibold leading-4 text-text-primary',
  },
} as const;

export const inspectorSliderTokens = {
  fill: 'absolute top-1/2 h-1 -translate-y-1/2 rounded-full pointer-events-none bg-accent/30',
  header: 'mb-0.5 flex items-center justify-between gap-3',
  input: 'absolute top-1/2 left-0 z-10 h-4 w-full -translate-y-1/2 appearance-none bg-transparent m-0 p-0 slider-input',
  label:
    'col-start-1 row-start-1 text-[13px] font-medium leading-4 text-text-secondary select-none transition-opacity duration-200 ease-in-out',
  labelButton: 'grid border-0 bg-transparent p-0 text-left cursor-pointer',
  labelStatic: 'grid border-0 bg-transparent p-0 text-left cursor-default',
  resetLabel:
    'col-start-1 row-start-1 text-[13px] font-medium leading-4 text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none',
  root: 'mb-1.5 group',
  suffix: 'text-[10px] align-top inline-block mt-0.5 ml-0.5',
  track: 'absolute top-1/2 left-0 h-1 w-full -translate-y-1/2 rounded-full pointer-events-none',
  trackWrap: 'relative h-4 w-full',
  valueButton: 'h-5 border-0 bg-transparent p-0 text-[13px] leading-5 text-text-primary w-full text-right select-none',
  valueInput:
    'h-5 w-full rounded-sm border border-gray-500 bg-card-active px-1 py-0 text-right text-[13px] leading-5 text-text-primary outline-none focus:ring-1 focus:ring-blue-500',
  valueSlot: 'w-12 shrink-0 text-right',
} as const;

export const compactInspectorSliderTokens = {
  fill: 'absolute top-1/2 h-1 -translate-y-1/2 rounded-full pointer-events-none bg-accent/35',
  input: 'absolute top-1/2 left-0 z-10 h-5 w-full -translate-y-1/2 appearance-none bg-transparent m-0 p-0 slider-input',
  label:
    'col-start-1 row-start-1 truncate text-[12px] font-medium leading-4 text-text-secondary select-none transition-opacity duration-200 ease-in-out',
  labelButton: 'grid min-w-0 border-0 bg-transparent p-0 text-left cursor-pointer',
  labelStatic: 'grid min-w-0 border-0 bg-transparent p-0 text-left cursor-default',
  resetLabel:
    'col-start-1 row-start-1 truncate text-[12px] font-medium leading-4 text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none',
  root: 'group grid min-h-6 grid-cols-[minmax(5rem,0.85fr)_minmax(5rem,1fr)_2.75rem] items-center gap-2 py-0.5',
  suffix: 'text-[10px] align-top inline-block mt-0.5 ml-0.5',
  track: 'absolute top-1/2 left-0 h-1 w-full -translate-y-1/2 rounded-full pointer-events-none',
  trackWrap: 'relative h-5 min-w-0',
  valueButton:
    'h-5 border-0 bg-transparent p-0 font-mono text-[12px] leading-5 tabular-nums text-text-primary w-full text-right select-none',
  valueInput:
    'h-5 w-full rounded-sm border border-gray-500 bg-card-active px-1 py-0 text-right font-mono text-[12px] leading-5 tabular-nums text-text-primary outline-none focus:ring-1 focus:ring-blue-500',
  valueSlot: 'w-11 shrink-0 text-right',
} as const;
