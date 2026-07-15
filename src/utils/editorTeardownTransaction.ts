export interface EditorTeardownIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  path: string;
}

export interface EditorTeardownState {
  adjustmentRevision: number;
  imageSession: { id: string; path: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export interface EditorTeardownTransactionRequest extends EditorTeardownIdentity {
  transactionId: string;
}

export interface EditorTeardownTransactionResult {
  adjustmentRevision: number;
  adjustmentsChanged: boolean;
  transactionId: string;
}

interface EditorTeardownPublisherState extends EditorTeardownState {
  applyEditorTeardownTransaction: (request: EditorTeardownTransactionRequest) => EditorTeardownTransactionResult;
}

const currentEditorTeardownSessionId = (state: EditorTeardownState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureEditorTeardownIdentity = (state: EditorTeardownState): EditorTeardownIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentEditorTeardownSessionId(state),
        path: state.selectedImage.path,
      };

export const isEditorTeardownIdentityCurrent = (
  state: EditorTeardownState,
  identity: EditorTeardownIdentity,
): boolean =>
  state.adjustmentRevision === identity.adjustmentRevision &&
  currentEditorTeardownSessionId(state) === identity.imageSessionId &&
  (state.imageSession === null || state.imageSession.path === identity.path) &&
  state.selectedImage?.path === identity.path;

export const buildEditorTeardownTransaction = (
  state: EditorTeardownState,
  identity: EditorTeardownIdentity,
  transactionId: string,
): EditorTeardownTransactionRequest => {
  if (!isEditorTeardownIdentityCurrent(state, identity)) throw new Error('editor_teardown.stale_identity');
  return { ...identity, transactionId };
};

export const applyEditorTeardownIfCurrent = (
  state: EditorTeardownPublisherState,
  identity: EditorTeardownIdentity,
  transactionId: string,
): boolean => {
  if (!isEditorTeardownIdentityCurrent(state, identity)) return false;
  state.applyEditorTeardownTransaction(buildEditorTeardownTransaction(state, identity, transactionId));
  return true;
};
