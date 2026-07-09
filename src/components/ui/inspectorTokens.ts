import { editorChromeStatusChipClassName, editorChromeTokens } from './editorChromeTokens';

export const inspectorSectionTokens = {
  badge: editorChromeTokens.statusChip.base,
  body: 'px-2.5 pb-2 pt-1.5 transition-opacity duration-200',
  chevron: 'text-text-secondary transition-transform duration-200',
  dirtyIndicator: 'h-1.5 w-1.5 shrink-0 rounded-full bg-editor-info',
  header:
    'group min-h-8 w-full px-2.5 py-1 flex items-center justify-between gap-2 text-left hover:bg-editor-panel-raised transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-inset',
  actionsMenuSlot: 'h-6 w-6 shrink-0',
  headerActionButton:
    'z-10 flex h-6 w-6 items-center justify-center rounded text-text-secondary transition-colors duration-150 hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:bg-editor-selected-quiet focus-visible:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45',
  headerActions:
    'flex h-6 shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
  hiddenBadge: editorChromeStatusChipClassName('neutral'),
  shell: 'bg-editor-panel overflow-hidden shrink-0 border-b border-editor-border',
  title: 'truncate text-[12px] leading-4 tracking-normal text-text-primary',
  titleRow: 'flex min-w-0 items-center gap-1.5 overflow-hidden',
  visibilityButton:
    'z-10 flex h-6 w-6 items-center justify-center rounded text-text-secondary transition-colors duration-150 hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  visibilitySlot: 'w-6 h-6 flex items-center justify-center shrink-0',
} as const;

export const professionalInspectorDensityTokens = {
  actionButton: {
    active: 'bg-editor-primary-active text-editor-primary-active-text',
    base: 'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1.5 text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45',
    icon: 'w-5 px-0',
    inactive: 'bg-editor-panel text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
    quiet: 'bg-transparent text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary',
    selectedQuiet: 'bg-editor-selected-quiet text-editor-selected-quiet-text',
  },
  card: {
    panel: 'rounded bg-editor-panel-well p-1',
    nested: 'rounded border border-editor-border bg-editor-panel px-1.5 py-1',
    nestedBare: 'rounded bg-editor-panel px-1.5 py-1',
    nestedPanel: 'rounded border border-editor-border bg-editor-panel-well p-1',
    surface: 'rounded-md border border-editor-border bg-editor-matte',
  },
  gutter: {
    panel: 'space-y-1.5',
    section: 'space-y-1',
  },
  frame: {
    actionButton:
      'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-secondary transition-colors duration-150 hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:text-editor-disabled disabled:opacity-45',
    actionButtonActive: 'bg-editor-selected-quiet text-editor-selected-quiet-text hover:bg-editor-selected-quiet',
    actions: 'flex h-7 shrink-0 items-center gap-0.5',
    header:
      'flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-editor-border bg-editor-panel px-2.5 py-1',
    iconSlot:
      'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-editor-border bg-editor-panel-well text-text-secondary',
    notice:
      'flex min-h-7 shrink-0 items-center gap-1.5 border-b border-editor-border bg-editor-panel-well px-2.5 py-1 text-[11px] font-medium leading-4',
    title: 'min-w-0 truncate text-[13px] font-semibold leading-5 tracking-normal text-text-primary',
  },
  panelHeader: {
    actionButton:
      'inline-flex h-6 w-6 items-center justify-center rounded text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45',
    actionButtonActive: 'bg-editor-selected-quiet text-editor-selected-quiet-text hover:bg-editor-selected-quiet',
    root: 'flex min-h-9 shrink-0 items-center justify-between border-b border-editor-border bg-editor-panel px-3 py-1',
    title: 'truncate text-[13px] font-semibold leading-5 tracking-normal text-text-primary',
  },
  rawProcessing: {
    body: 'space-y-1.5 pt-1.5',
    compareButton:
      'flex min-h-7 w-full items-center justify-center gap-2 rounded bg-editor-panel-raised px-2 py-1 text-[11px] font-medium leading-4 text-text-primary transition-colors hover:bg-editor-selected-quiet disabled:cursor-not-allowed disabled:opacity-45 aria-busy:cursor-progress focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
    description: 'min-w-0 text-[11px] leading-4 text-text-secondary',
    disclosure:
      'flex min-h-7 w-full items-center justify-between gap-2 rounded-sm text-left transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
    label: 'shrink-0 text-[11px] font-semibold uppercase leading-4 tracking-normal text-text-secondary',
    provenanceButton:
      'inline-flex items-center gap-1.5 rounded text-[11px] font-medium leading-4 text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
    provenanceValue: 'break-all font-mono text-[11px] leading-4 text-text-secondary',
    resultCard: 'space-y-1.5 rounded border border-editor-border bg-editor-panel-well p-1.5',
    resultMetric: 'min-w-0 space-y-0.5 rounded bg-editor-panel px-1.5 pb-1 pt-1',
    root: 'shrink-0 border-b border-editor-border bg-editor-panel px-3 py-1',
    statusValue: 'truncate text-[11px] leading-4 text-text-primary',
  },
  workspaceNavigation: {
    active: 'bg-editor-panel-raised text-text-primary shadow-[inset_0_-2px_0_var(--editor-primary-active)]',
    inactive: 'text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
    scroller: 'min-w-0 pb-px',
    statusCount:
      'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-editor-border bg-editor-panel-raised px-1 text-[10px] font-semibold leading-4 text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
    statusLabel: 'min-w-0 flex-1 truncate text-[10px] font-semibold leading-4 text-editor-warning',
    statusRow: 'mt-1 flex h-6 min-w-0 items-center gap-1 overflow-hidden',
    tab: 'relative inline-flex min-h-7 min-w-0 items-center justify-center whitespace-nowrap px-0.5 text-[10px] font-medium leading-4 tracking-normal transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring',
    tabList:
      'grid min-w-0 w-full grid-cols-4 gap-px overflow-hidden rounded border border-editor-border bg-editor-panel-well p-px',
  },
  row: {
    label: 'text-[10px] font-medium leading-3 text-text-tertiary',
    value: 'text-right font-mono text-[11px] leading-3 tabular-nums text-text-secondary',
    valueSlot: 'min-w-0 shrink-0 text-right',
  },
  scrollPadding: 'scroll-px-2 scroll-py-2',
  sectionHeader: {
    badge:
      'shrink-0 rounded bg-editor-selected-quiet px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-normal text-text-secondary',
    root: 'mb-0.5 flex min-h-5 items-center justify-between gap-2',
    rootLoose: 'mb-0.5 flex items-start justify-between gap-2',
    summary: 'block text-[10px] leading-3 text-text-secondary',
    title: 'text-[11px] font-semibold uppercase leading-4 tracking-normal text-text-secondary',
  },
  toneMapper: {
    card: 'w-full rounded bg-editor-panel-raised p-1',
    label:
      'col-start-1 row-start-1 text-[11px] font-semibold uppercase leading-4 tracking-normal text-text-secondary select-none transition-opacity duration-200 ease-in-out',
    option:
      'relative flex min-h-6 flex-1 items-center justify-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
    resetLabel:
      'col-start-1 row-start-1 text-[11px] font-semibold uppercase leading-4 tracking-normal text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none',
    root: 'group mb-1.5',
    sliderWrap: 'mt-1 px-0.5',
    titleRow: 'mb-0.5 flex items-center justify-between',
  },
} as const;

export const agentReviewWorkspaceTokens = {
  actionButton:
    'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded border px-2 text-[11px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:border-editor-border disabled:bg-editor-panel disabled:text-text-tertiary',
  card: 'rounded border border-editor-border bg-editor-panel-well p-2',
  chip: 'inline-flex min-h-5 min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-3',
  label: 'text-[10px] font-semibold uppercase leading-3 tracking-normal text-text-tertiary',
  metaValue: 'truncate font-mono text-[10px] leading-3 text-text-secondary',
  sectionTitle: 'text-[11px] font-semibold uppercase leading-4 tracking-normal text-text-secondary',
  stateActive: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  stateBlocked: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  stateInactive: 'border-editor-border bg-editor-panel text-text-tertiary',
} as const;

export const inspectorSliderTokens = {
  fill: 'absolute top-1/2 h-1 -translate-y-1/2 rounded-full pointer-events-none bg-editor-primary-active/45',
  header: 'mb-0.5 flex items-center justify-between gap-3',
  input:
    'absolute top-1/2 left-0 z-10 h-4 w-full -translate-y-1/2 appearance-none bg-transparent m-0 p-0 slider-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
  label:
    'col-start-1 row-start-1 text-[13px] font-medium leading-4 text-text-secondary select-none transition-opacity duration-200 ease-in-out',
  labelButton: 'grid border-0 bg-transparent p-0 text-left cursor-pointer',
  labelStatic: 'grid border-0 bg-transparent p-0 text-left cursor-default',
  resetLabel:
    'col-start-1 row-start-1 text-[13px] font-medium leading-4 text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none',
  root: 'mb-1 group',
  suffix: 'text-[10px] align-top inline-block mt-0.5 ml-0.5',
  track: 'absolute top-1/2 left-0 h-1 w-full -translate-y-1/2 rounded-full pointer-events-none',
  trackWrap: 'relative h-4 w-full',
  valueButton:
    'h-5 rounded border-0 bg-transparent p-0 text-[13px] leading-5 text-text-primary w-full text-right select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  valueInput:
    'h-5 w-full rounded-sm border border-editor-border bg-editor-panel-raised px-1 py-0 text-right text-[13px] leading-5 text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  valueSlot: 'w-12 shrink-0 text-right',
} as const;

export const compactInspectorSliderTokens = {
  fill: 'absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full pointer-events-none bg-editor-primary-active/45',
  input:
    'absolute top-1/2 left-0 z-10 h-4 w-full -translate-y-1/2 appearance-none bg-transparent m-0 p-0 slider-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
  label:
    'col-start-1 row-start-1 truncate text-[11px] font-medium leading-4 text-text-secondary select-none transition-opacity duration-200 ease-in-out',
  labelButton: 'grid min-w-0 border-0 bg-transparent p-0 text-left cursor-pointer',
  labelStatic: 'grid min-w-0 border-0 bg-transparent p-0 text-left cursor-default',
  resetLabel:
    'col-start-1 row-start-1 truncate text-[11px] font-medium leading-4 text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none',
  root: 'group grid min-h-5 grid-cols-[minmax(5.25rem,0.62fr)_minmax(4.5rem,1fr)_3.25rem] items-center gap-1 py-px disabled:opacity-60 max-[319px]:grid-cols-[minmax(0,1fr)_3.25rem]',
  suffix: 'text-[10px] align-top inline-block mt-0.5 ml-0.5',
  track: 'absolute top-1/2 left-0 h-[3px] w-full -translate-y-1/2 rounded-full pointer-events-none',
  trackWrap: 'relative h-4 min-w-0 max-[319px]:col-span-2 max-[319px]:col-start-1 max-[319px]:row-start-2',
  valueButton:
    'h-5 rounded border-0 bg-transparent p-0 font-mono text-[11px] leading-5 tabular-nums text-text-primary w-full text-right select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  valueInput:
    'h-5 w-full rounded-sm border border-editor-border bg-editor-panel-raised px-1 py-0 text-right font-mono text-[11px] leading-5 tabular-nums text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  valueSlot: 'w-[3.25rem] shrink-0 text-right max-[319px]:col-start-2 max-[319px]:row-start-1',
} as const;
