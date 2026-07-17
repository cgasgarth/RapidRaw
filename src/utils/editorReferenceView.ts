export interface ReferenceViewImage {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly renderUrl: string | null;
}

export type ReferenceViewPane = 'active' | 'reference';

export interface EditorReferenceViewState {
  readonly activePane: ReferenceViewPane;
  readonly isChooserOpen: boolean;
  readonly mode: 'off' | 'side-by-side';
  readonly reference: ReferenceViewImage | null;
  readonly synchronizedTransform: boolean;
}

export type EditorReferenceViewCommand =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'open-chooser' }
  | { type: 'close-chooser' }
  | { image: ReferenceViewImage; type: 'set-reference' }
  | { type: 'clear-reference' }
  | { pane: ReferenceViewPane; type: 'set-active-pane' }
  | { type: 'toggle-synchronized-transform' }
  | { type: 'swap-panes' };

export const DEFAULT_EDITOR_REFERENCE_VIEW_STATE: EditorReferenceViewState = {
  activePane: 'active',
  isChooserOpen: false,
  mode: 'off',
  reference: null,
  synchronizedTransform: true,
};

export const reduceEditorReferenceView = (
  state: EditorReferenceViewState,
  command: EditorReferenceViewCommand,
): EditorReferenceViewState => {
  switch (command.type) {
    case 'enter':
      return { ...state, isChooserOpen: state.reference === null, mode: 'side-by-side' };
    case 'exit':
      return { ...state, activePane: 'active', isChooserOpen: false, mode: 'off' };
    case 'open-chooser':
      return { ...state, isChooserOpen: true, mode: 'side-by-side' };
    case 'close-chooser':
      return { ...state, isChooserOpen: false };
    case 'set-reference':
      return { ...state, isChooserOpen: false, mode: 'side-by-side', reference: command.image };
    case 'clear-reference':
      return { ...state, activePane: 'active', isChooserOpen: true, mode: 'side-by-side', reference: null };
    case 'set-active-pane':
      return { ...state, activePane: command.pane };
    case 'toggle-synchronized-transform':
      return { ...state, synchronizedTransform: !state.synchronizedTransform };
    case 'swap-panes':
      return { ...state, activePane: state.activePane === 'active' ? 'reference' : 'active' };
  }
};

export const isEditorReferenceViewActive = (state: EditorReferenceViewState): boolean => state.mode !== 'off';

export const isReferenceViewReferenceSelectable = (
  state: EditorReferenceViewState,
  candidatePath: string,
  activePath: string | null,
): boolean => candidatePath !== activePath && candidatePath !== state.reference?.path;
