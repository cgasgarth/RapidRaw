export type EditorChromeStatus = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const editorChromeTokens = {
  density: {
    rightRail: 'w-[42px]',
    inspectorHeader: 'min-h-9',
    toolbarControl: 'h-8 min-w-8',
    compactToolbarControl: 'h-7 min-w-7',
    inspectorRow: 'min-h-6',
    compactInspectorRow: 'min-h-7',
    gutterXs: 'gap-1.5',
    gutterSm: 'gap-2',
    gutterMd: 'gap-3',
    separator: 'border-editor-border',
    radiusSm: 'rounded',
    radiusMd: 'rounded-md',
    radiusLg: 'rounded-lg',
  },
  focusRing:
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
  palette: {
    matte: 'bg-editor-matte',
    overlay: 'border-editor-overlay-stroke shadow-[0_14px_34px_var(--editor-overlay-shadow)]',
    panel: 'bg-editor-panel',
    raised: 'bg-editor-panel-raised',
    well: 'bg-editor-panel-well',
  },
  typography: {
    utilityLabel: 'text-[11px] font-medium leading-4 tracking-normal',
    compactRowLabel: 'text-[12px] font-medium leading-4 tracking-normal',
    inspectorLabel: 'text-[13px] font-medium leading-4 tracking-normal',
    panelTitle: 'text-[14px] font-semibold leading-5 tracking-normal',
    numericValue: 'font-mono tabular-nums tracking-normal',
    shortBadge: 'text-[10px] font-semibold uppercase leading-4 tracking-normal',
  },
  button: {
    base: 'inline-flex items-center justify-center gap-1.5 rounded border border-transparent font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
    icon: 'h-8 w-8 p-0',
    iconCompact: 'h-7 w-7 p-0',
    primary:
      'bg-editor-primary-active text-editor-primary-active-text hover:bg-editor-primary-active/90 active:bg-editor-primary-active/80',
    quiet:
      'bg-transparent text-text-secondary hover:bg-editor-selected-quiet hover:text-text-primary active:bg-editor-selected-quiet/80',
    selectedQuiet: 'bg-editor-selected-quiet text-editor-selected-quiet-text',
    destructive:
      'bg-editor-danger-surface text-editor-danger hover:bg-editor-danger-surface/80 active:bg-editor-danger-surface/70',
    disabled: 'disabled:text-editor-disabled',
    loading: 'aria-busy:cursor-progress aria-busy:opacity-75',
  },
  input: {
    base: 'rounded border border-editor-border bg-editor-panel-raised text-text-primary placeholder:text-text-tertiary transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
    compact: 'h-7 px-2 py-1 text-[12px] leading-4',
    default: 'h-9 px-2.5 py-1.5 text-[13px] leading-5',
    numeric: 'font-mono tabular-nums',
  },
  slider: {
    fill: 'bg-editor-primary-active/45',
    track: 'bg-editor-panel-raised',
    valueInput:
      'border-editor-border bg-editor-panel-raised text-text-primary focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  },
  statusChip: {
    base: 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-normal',
    danger: 'bg-editor-danger-surface text-editor-danger',
    info: 'bg-editor-info-surface text-editor-info',
    neutral: 'bg-editor-selected-quiet text-text-secondary',
    success: 'bg-editor-success-surface text-editor-success',
    warning: 'bg-editor-warning-surface text-editor-warning',
  },
} as const;

export const editorChromeStatusChipClassName = (status: EditorChromeStatus): string =>
  `${editorChromeTokens.statusChip.base} ${editorChromeTokens.statusChip[status]}`;
