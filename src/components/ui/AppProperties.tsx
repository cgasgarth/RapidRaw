import type { LucideIcon } from 'lucide-react';
import type { RawDevelopmentReport } from '../../schemas/imageLoaderSchemas';
import type { Adjustments, CopyPasteSettings } from '../../utils/adjustments';
import type { ToolType } from '../panel/right/layers/Masks';
import type { ExportPreset } from './ExportImportProperties';

export const GLOBAL_KEYS = [
  ' ',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'f',
  'b',
  'a',
  's',
  'd',
  'r',
  'm',
  'k',
  'p',
  'i',
  'e',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  'Enter',
];
export const OPTION_SEPARATOR = 'separator';

export enum ExifOverlay {
  Off = 'off',
  Hover = 'hover',
  Always = 'always',
}

export enum Panel {
  Adjustments = 'adjustments',
  Agent = 'agent',
  Ai = 'ai',
  Color = 'color',
  Crop = 'crop',
  Export = 'export',
  Masks = 'masks',
  Metadata = 'metadata',
  Presets = 'presets',
  Tether = 'tether',
}

export enum RawStatus {
  All = 'all',
  NonRawOnly = 'nonRawOnly',
  RawOnly = 'rawOnly',
  RawOverNonRaw = 'rawOverNonRaw',
}

export enum SortDirection {
  Ascending = 'asc',
  Descending = 'desc',
}

export type FolderSortKey = 'name' | 'modified' | 'created' | 'imageCount';

export interface FolderTreeSort {
  key: FolderSortKey;
  order: SortDirection;
}

export enum Theme {
  Arctic = 'arctic',
  Blue = 'blue',
  Dark = 'dark',
  Grey = 'grey',
  Light = 'light',
  MutedGreen = 'muted-green',
  Sepia = 'sepia',
  Snow = 'snow',
}

export enum ThumbnailAspectRatio {
  Cover = 'cover',
  Contain = 'contain',
}

export interface AppSettings {
  aiConnectorAddress?: string;
  aiProvider?: string;
  aiTagCount?: number;
  applyPreprocessingToNonRaws?: boolean;
  decorations?: boolean;
  editorPreviewResolution?: number;
  enableZoomHifi?: boolean;
  useFullDpiRendering?: boolean;
  highResZoomMultiplier?: number;
  enableLivePreviews?: boolean;
  livePreviewQuality?: string;
  enableAiTagging?: boolean;
  customAiTags?: string[];
  filterCriteria?: FilterCriteria;
  lastFolderState?: PersistedFolderState | null;
  pinnedFolders?: string[];
  lastRootPath: string | null;
  rootFolders?: string[];
  libraryViewMode?: LibraryViewMode;
  sortCriteria?: SortCriteria;
  theme: Theme;
  fontFamily?: string;
  thumbnailSize?: ThumbnailSize;
  thumbnailAspectRatio?: ThumbnailAspectRatio;
  uiVisibility?: UiVisibility;
  adjustmentVisibility?: Record<string, boolean>;
  rawHighlightCompression?: number;
  rawPreprocessingColorNr?: number;
  rawPreprocessingSharpening?: number;
  rawPreprocessingSharpeningDetail?: number;
  rawPreprocessingSharpeningEdgeMasking?: number;
  rawPreprocessingSharpeningRadius?: number;
  rawProcessingMode?: string;
  processingBackend?: string;
  linuxGpuOptimization?: boolean;
  exportPresets?: ExportPreset[];
  myLenses?: MyLens[];
  thumbnailResolution?: number;
  thumbnailWorkerThreads?: number;
  imageCacheSize?: number;
  enableFolderImageCounts?: boolean;
  displayEditIcon?: boolean;
  linearRawMode?: string;
  enableXmpSync?: boolean;
  createXmpIfMissing?: boolean;
  isWaveformVisible?: boolean;
  waveformHeight?: number;
  activeWaveformChannel?: string;
  panelScopesLayout?: string;
  useWgpuRenderer?: boolean;
  canvasInputMode?: 'mouse' | 'trackpad';
  zoomSpeedMultiplier?: number;
  keybinds?: Record<string, string[]>;
  taggingShortcuts?: string[];
  tonemapperOverrideEnabled?: boolean;
  defaultRawTonemapper?: string;
  defaultNonRawTonemapper?: string;
  copyPasteSettings?: CopyPasteSettings;
  enableFocusMode?: boolean;
  externalEditorPath?: string;
  openTreeSections?: string[];
  folderIcons?: Record<string, string>;
  exifOverlay?: ExifOverlay;
  language?: string;
  folderTreeSort?: FolderTreeSort;
}

export interface BrushSettings {
  feather: number;
  size: number;
  tool: ToolType;
}

export enum LibraryViewMode {
  Flat = 'flat',
  Recursive = 'recursive',
}

export const EditedStatus = {
  All: 'all',
  EditedOnly: 'editedOnly',
  UneditedOnly: 'uneditedOnly',
} as const;

export type EditedStatus = (typeof EditedStatus)[keyof typeof EditedStatus];

export interface FilterCriteria {
  colors: Array<string>;
  rating: number;
  rawStatus: RawStatus;
  editedStatus?: EditedStatus;
}

export interface PersistedFolderState {
  activeAlbumId?: string | null;
  currentFolderPath?: string | null;
  expandedAlbumGroups?: string[];
  expandedFolders?: string[];
}

export interface MyLens {
  maker: string;
  model: string;
}

export interface ExifData extends Record<string, string> {
  DateTimeOriginal?: string;
  ExposureTime?: string;
  FNumber?: string;
  FocalLengthIn35mmFilm?: string;
  ISO?: string;
  LensModel?: string;
  Make?: string;
  PhotographicSensitivity?: string;
}

export interface Folder {
  children: Preset[];
  id?: string | undefined;
  name?: string | undefined;
  imageCount?: number;
}

export interface ImageFile {
  is_edited: boolean;
  modified: number;
  path: string;
  rating: number;
  tags: Array<string> | null;
  exif: Record<string, string> | null;
  is_virtual_copy: boolean;
}

export interface Option {
  color?: string;
  disabled?: boolean;
  customComponent?: unknown;
  customProps?: unknown;
  icon?: LucideIcon;
  isDestructive?: boolean;
  label?: string;
  onClick?: (() => void) | undefined;
  onRightClick?(): void;
  submenu?: Option[];
  type?: string;
}

export enum Orientation {
  Horizontal = 'horizontal',
  Vertical = 'vertical',
}

export interface Preset {
  adjustments: Partial<Adjustments>;
  colorStyleProvenance?:
    | {
        createdAt: string;
        legalNamingStatus: 'user_named';
        legalWarning: string;
        source: 'user_created';
        updatedAt: string;
      }
    | undefined;
  folder?: Folder;
  id: string;
  name: string;
  includeMasks?: boolean | undefined;
  includeCropTransform?: boolean | undefined;
  presetType?: 'tool' | 'style' | undefined;
}

export interface Progress {
  completed?: number;
  current: number;
  stage?: string;
  total: number;
}

export interface SelectedImage {
  exif: ExifData | null;
  height: number;
  isRaw: boolean;
  isOfflineSmartPreview?: boolean;
  isReady: boolean;
  metadata?: unknown;
  original_base64?: string;
  originalUrl: string | null;
  path: string;
  rawDevelopmentReport?: RawDevelopmentReport | null;
  thumbnailUrl: string;
  width: number;
}

export interface SortCriteria {
  key: string;
  label?: string;
  order: SortDirection;
}

export interface SupportedTypes {
  nonRaw: Array<string>;
  raw: Array<string>;
}

export enum ThumbnailSize {
  Large = 'large',
  Medium = 'medium',
  Small = 'small',
  List = 'list',
}

export interface TransformState {
  positionX: number;
  positionY: number;
  scale: number;
}

export interface UiVisibility {
  folderTree: boolean;
  filmstrip: boolean;
}

export interface WaveformData {
  blue: string;
  green: string;
  height: number;
  luma: string;
  red: string;
  rgb: string;
  parade: string;
  vectorscope: string;
  width: number;
}

export interface CullingSettings {
  similarityThreshold: number;
  blurThreshold: number;
  groupSimilar: boolean;
  filterBlurry: boolean;
  rankFocus: boolean;
}

export interface ImageAnalysisResult {
  path: string;
  qualityScore: number;
  sharpnessMetric: number;
  centerFocusMetric: number;
  faceSharpnessMetric: number;
  eyeSharpnessMetric: number;
  exposureMetric: number;
  focusScore: number;
  focusConfidence: number;
  focusRegion: string;
  focusRegionProvider?: string | null | undefined;
  detectedEyeConfidence?: number | null | undefined;
  detectedFaceConfidence?: number | null | undefined;
  width: number;
  height: number;
}

export interface CullGroup {
  representative: ImageAnalysisResult;
  duplicates: ImageAnalysisResult[];
}

export interface CullingSuggestions {
  similarGroups: CullGroup[];
  blurryImages: ImageAnalysisResult[];
  focusRankings: ImageAnalysisResult[];
  failedPaths: string[];
  latencyReport: CullingLatencyReport | null;
}

export interface CullingLatencyReport {
  analysisModeCount: number;
  averageAnalysisMs: number;
  failedCount: number;
  maxAnalysisMs: number;
  sourceCount: number;
  successfulCount: number;
  totalElapsedMs: number;
}

export interface KeybindHandler {
  shouldFire?: () => boolean;
  execute: (event: KeyboardEvent) => void;
}

export type AlbumItem = Album | AlbumGroup;

export interface Album {
  type: 'album';
  id: string;
  name: string;
  icon?: string | undefined;
  images: string[];
}

export interface AlbumGroup {
  type: 'group';
  id: string;
  name: string;
  icon?: string | undefined;
  children: AlbumItem[];
}
