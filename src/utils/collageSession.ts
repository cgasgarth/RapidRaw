import type { Layout } from './CollageVariants';

export interface CollageLayoutOption {
  id: string;
  layout: Layout;
}

export interface CollageLoadedImage {
  height: number;
  path: string;
  url: string;
  width: number;
}

export interface CollageImageState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface CollageLoadState {
  error: string | null;
  exportHeight: number;
  imageStates: Record<string, CollageImageState>;
  isLoading: boolean;
  loadedImages: CollageLoadedImage[];
  originalAspectRatio: number | null;
  requestId: string | null;
}

export type CollageLoadAction =
  | { requestId: string; type: 'loadStarted' }
  | {
      exportHeight: number;
      images: CollageLoadedImage[];
      originalAspectRatio: number | null;
      requestId: string;
      type: 'loadCompleted';
    }
  | { error: string; requestId: string; type: 'loadFailed' }
  | { exportHeight: number; type: 'exportHeightChanged' }
  | { images: CollageLoadedImage[]; type: 'imagesReordered' }
  | { imageStates: Record<string, CollageImageState>; type: 'imageStatesChanged' };

export const createCollageSessionIdentity = (orderedPaths: readonly string[], openEpoch: number): string =>
  `${openEpoch}:${orderedPaths.map((path) => `${path.length}:${path}`).join('')}`;

export const chooseDefaultLayout = (availableLayouts: readonly CollageLayoutOption[]): CollageLayoutOption | null =>
  availableLayouts[0] ?? null;

export const resolveCollageLayout = (
  availableLayouts: readonly CollageLayoutOption[],
  selectedLayoutId: string | null,
): CollageLayoutOption | null =>
  availableLayouts.find((layout) => layout.id === selectedLayoutId) ?? chooseDefaultLayout(availableLayouts);

export const initialCollageLoadState = (exportHeight: number): CollageLoadState => ({
  error: null,
  exportHeight,
  imageStates: {},
  isLoading: true,
  loadedImages: [],
  originalAspectRatio: null,
  requestId: null,
});

export const collageLoadReducer = (state: CollageLoadState, action: CollageLoadAction): CollageLoadState => {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, error: null, isLoading: true, requestId: action.requestId };
    case 'loadCompleted': {
      if (state.requestId !== action.requestId) return state;
      return {
        ...state,
        exportHeight: action.exportHeight,
        imageStates: Object.fromEntries(
          action.images.map((image) => [image.path, { offsetX: 0, offsetY: 0, scale: 1 }]),
        ),
        isLoading: false,
        loadedImages: action.images,
        originalAspectRatio: action.originalAspectRatio,
      };
    }
    case 'loadFailed':
      return state.requestId === action.requestId ? { ...state, error: action.error, isLoading: false } : state;
    case 'imagesReordered':
      return { ...state, loadedImages: action.images };
    case 'exportHeightChanged':
      return { ...state, exportHeight: action.exportHeight };
    case 'imageStatesChanged':
      return { ...state, imageStates: action.imageStates };
  }
};
