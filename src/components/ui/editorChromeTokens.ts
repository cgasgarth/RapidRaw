export type EditorChromeStatus = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type EditorInteractionState =
  | 'idle'
  | 'hover'
  | 'pressed'
  | 'selected'
  | 'edited'
  | 'disabled'
  | 'loading'
  | 'error'
  | 'focus';

export const editorChromeTokens = {
  region: {
    // Persistent editor commands belong in chrome lanes that reserve layout space around the image.
    viewerCommandBar: 'shrink-0 relative z-[120]',
    viewerFullscreenExit: 'shrink-0 flex justify-center border-b border-editor-border bg-editor-panel px-3 py-2',
    viewerStatusFooter: 'shrink-0 border-t border-editor-border bg-editor-panel px-2 py-1',
  },
  density: {
    topToolbar: 'min-h-10',
    bottomToolbar: 'min-h-8',
    filmstripHeader: 'min-h-8',
    leftPanelHeader: 'min-h-9',
    rightPanelHeader: 'min-h-9',
    rightRail: 'w-[42px]',
    rightRailTarget: 'h-8 w-8',
    inspectorHeader: 'min-h-9',
    inspectorSectionHeader: 'min-h-7',
    toolbarControl: 'h-8 min-w-8',
    compactToolbarControl: 'h-7 min-w-7',
    inspectorRow: 'min-h-6',
    compactInspectorRow: 'min-h-7',
    coarsePointerTarget: 'min-h-11 min-w-11',
    gutterXs: 'gap-1.5',
    gutterSm: 'gap-2',
    gutterMd: 'gap-3',
    separator: 'border-editor-border',
    radiusSm: 'rounded',
    radiusMd: 'rounded-md',
    radiusLg: 'rounded-lg',
  },
  motion: {
    panelReveal: 'duration-200 ease-out motion-reduce:duration-0',
    previewHandoff: 'duration-150 ease-out motion-reduce:duration-0',
    sectionCollapse: 'duration-200 ease-in-out motion-reduce:duration-0',
    selectionChange: 'duration-100 ease-out motion-reduce:duration-0',
  },
  focusRing:
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
  palette: {
    disabled: 'bg-editor-disabled-surface',
    divider: 'border-editor-divider',
    focus: 'ring-editor-focus-ring',
    hover: 'bg-editor-hover',
    matte: 'bg-editor-matte',
    overlay: 'border-editor-overlay-stroke shadow-[0_14px_34px_var(--editor-overlay-shadow)]',
    panel: 'bg-editor-panel',
    raised: 'bg-editor-panel-raised',
    selected: 'bg-editor-selected-quiet',
    viewer: 'bg-editor-viewer-matte',
    well: 'bg-editor-panel-well',
  },
  surface: {
    dragOverlay:
      'border border-dashed border-editor-overlay-stroke bg-editor-overlay-surface shadow-[0_14px_34px_var(--editor-overlay-shadow)]',
    floatingHud:
      'border border-editor-overlay-stroke bg-editor-overlay-surface shadow-[0_14px_34px_var(--editor-overlay-shadow)]',
    imageFrame:
      'border border-editor-overlay-stroke bg-editor-viewer-matte shadow-[0_24px_52px_var(--editor-overlay-shadow)]',
    popover: 'border border-editor-divider bg-editor-panel-raised shadow-[0_14px_34px_var(--editor-overlay-shadow)]',
  },
  typography: {
    utilityLabel: 'text-[11px] font-medium leading-4 tracking-normal',
    compactRowLabel: 'text-[12px] font-medium leading-4 tracking-normal',
    controlLabel: 'text-[12px] font-medium leading-4 tracking-normal',
    inspectorLabel: 'text-[13px] font-medium leading-4 tracking-normal',
    metadata: 'text-[10px] font-medium leading-4 tracking-normal text-text-secondary',
    panelTitle: 'text-[14px] font-semibold leading-5 tracking-normal',
    numericValue: 'font-mono tabular-nums tracking-normal',
    sectionTitle: 'text-[11px] font-semibold uppercase leading-4 tracking-normal',
    shortBadge: 'text-[10px] font-semibold uppercase leading-4 tracking-normal',
    status: 'text-[10px] font-medium leading-4 tracking-normal',
    tooltip: 'text-[11px] font-medium leading-4 tracking-normal',
  },
  state: {
    disabled: 'cursor-not-allowed opacity-45',
    edited: 'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-editor-info',
    error: 'border-editor-danger bg-editor-danger-surface text-editor-danger',
    focus:
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-editor-matte',
    hover: 'hover:bg-editor-hover hover:text-text-primary',
    idle: 'bg-transparent text-text-secondary',
    loading: 'aria-busy:cursor-progress aria-busy:opacity-75',
    pressed: 'active:bg-editor-selected-quiet/80',
    selected:
      'relative bg-editor-selected-quiet text-editor-selected-quiet-text before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-editor-primary-active',
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
    defaultOriginFill: 'bg-editor-info/55',
    fill: 'bg-editor-primary-active/45',
    minimumOriginFill: 'bg-editor-primary-active/45',
    track: 'bg-editor-panel-raised',
    valueInput:
      'border-editor-border bg-editor-panel-raised text-text-primary focus-visible:ring-1 focus-visible:ring-editor-focus-ring',
  },
  toolTab: {
    active:
      'relative bg-editor-selected-quiet text-editor-selected-quiet-text before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-editor-primary-active',
    inactive: 'text-text-secondary hover:bg-editor-hover hover:text-text-primary',
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
