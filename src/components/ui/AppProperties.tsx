import type { ExportPreset } from './ExportImportProperties';
import type { Adjustments, CopyPasteSettings } from '../../utils/adjustments';
import type { ToolType } from '../panel/right/Masks';
import type { LucideIcon } from 'lucide-react';

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

export enum Invokes {
  AddTagForPaths = 'add_tag_for_paths',
  ApplyAdjustments = 'apply_adjustments',
  ApplyAdjustmentsToPaths = 'apply_adjustments_to_paths',
  ApplyAutoAdjustmentsToPaths = 'apply_auto_adjustments_to_paths',
  ApplyDenoising = 'apply_denoising',
  AutodetectLens = 'autodetect_lens',
  BatchDenoiseImages = 'batch_denoise_images',
  CalculateAutoAdjustments = 'calculate_auto_adjustments',
  CancelExport = 'cancel_export',
  CancelThumbnailGeneration = 'cancel_thumbnail_generation',
  CheckAIConnectorStatus = 'check_ai_connector_status',
  CheckXmpMetadataConflicts = 'check_xmp_metadata_conflicts',
  ClearAllSidecars = 'clear_all_sidecars',
  ClearAiTags = 'clear_ai_tags',
  ClearAllTags = 'clear_all_tags',
  ClearImageCaches = 'clear_image_caches',
  ClearSessionCaches = 'clear_session_caches',
  ClearThumbnailCache = 'clear_thumbnail_cache',
  ConvertNegatives = 'convert_negatives',
  CopyFiles = 'copy_files',
  CreateFolder = 'create_folder',
  CreateVirtualCopy = 'create_virtual_copy',
  CullImages = 'cull_images',
  DeleteFilesFromDisk = 'delete_files_from_disk',
  DeleteFilesWithAssociated = 'delete_files_with_associated',
  DeleteFolder = 'delete_folder',
  DuplicateFile = 'duplicate_file',
  DryRunDeblurControls = 'dry_run_deblur_controls',
  DryRunDenoiseControls = 'dry_run_denoise_controls',
  EstimateNegativeBaseFog = 'estimate_negative_base_fog',
  SuggestNegativeLabHighlightPatchExposure = 'suggest_negative_lab_highlight_patch_exposure',
  SuggestNegativeLabNeutralPatchRgbBalance = 'suggest_negative_lab_neutral_patch_rgb_balance',
  SuggestNegativeLabShadowPatchBlackPoint = 'suggest_negative_lab_shadow_patch_black_point',
  EstimateExportSizes = 'estimate_export_sizes',
  ExportImages = 'export_images',
  FrontendLog = 'frontend_log',
  FrontendReady = 'frontend_ready',
  GenerateAiForegroundMask = 'generate_ai_foreground_mask',
  GenerateAiSkyMask = 'generate_ai_sky_mask',
  GenerateAiSubjectMask = 'generate_ai_subject_mask',
  GenerateAiDepthMask = 'generate_ai_depth_mask',
  GenerateOriginalTransformedPreview = 'generate_original_transformed_preview',
  GeneratePreviewForPath = 'generate_preview_for_path',
  GenerateMaskOverlay = 'generate_mask_overlay',
  GeneratePresetPreview = 'generate_preset_preview',
  GenerateUncroppedPreview = 'generate_uncropped_preview',
  GetImageDimensions = 'get_image_dimensions',
  GetFolderTree = 'get_folder_tree',
  GetFolderChildren = 'get_folder_children',
  GetLogFilePath = 'get_log_file_path',
  GetLensDistortionParams = 'get_lens_distortion_params',
  GetOrCreateInternalLibraryRoot = 'get_or_create_internal_library_root',
  GetLensfunLensesForMaker = 'get_lensfun_lenses_for_maker',
  GetLensfunMakers = 'get_lensfun_makers',
  GetPinnedFolderTrees = 'get_pinned_folder_trees',
  GetSupportedFileTypes = 'get_supported_file_types',
  HandleExportPresetsToFile = 'handle_export_presets_to_file',
  HandleImportPresetsFromFile = 'handle_import_presets_from_file',
  HandleImportLegacyPresetsFromFile = 'handle_import_legacy_presets_from_file',
  ImportFiles = 'import_files',
  InvokeGenerativeReplaseWithMaskDef = 'invoke_generative_replace_with_mask_def',
  IsImageCached = 'is_image_cached',
  ListImagesInDir = 'list_images_in_dir',
  ListImagesRecursive = 'list_images_recursive',
  LoadImage = 'load_image',
  LoadAndParseLut = 'load_and_parse_lut',
  LoadMetadata = 'load_metadata',
  LoadPresets = 'load_presets',
  LoadSettings = 'load_settings',
  MoveFiles = 'move_files',
  PlanPanorama = 'plan_panorama',
  PrecomputeAiSubjectMask = 'precompute_ai_subject_mask',
  PreviewGeometryTransform = 'preview_geometry_transform',
  PreviewNegativeConversion = 'preview_negative_conversion',
  ReadExifForPaths = 'read_exif_for_paths',
  ReadLibraryRelinkIdentity = 'read_library_relink_identity',
  RemoveTagForPaths = 'remove_tag_for_paths',
  RenameFiles = 'rename_files',
  RenameFolder = 'rename_folder',
  ResetAdjustmentsForPaths = 'reset_adjustments_for_paths',
  ResolveAndroidContentUriName = 'resolve_android_content_uri_name',
  ResolveXmpMetadataConflicts = 'resolve_xmp_metadata_conflicts',
  SaveMetadataAndUpdateThumbnail = 'save_metadata_and_update_thumbnail',
  SaveCollage = 'save_collage',
  SaveDenoisedImage = 'save_denoised_image',
  SavePanorama = 'save_panorama',
  SaveHdr = 'save_hdr',
  SavePresets = 'save_presets',
  SaveSettings = 'save_settings',
  SetColorLabelForPaths = 'set_color_label_for_paths',
  SetRatingForPaths = 'set_rating_for_paths',
  ShowInFinder = 'show_in_finder',
  StartBackgroundIndexing = 'start_background_indexing',
  StitchPanorama = 'stitch_panorama',
  MergeHdr = 'merge_hdr',
  TestAIConnectorConnection = 'test_ai_connector_connection',
  UpdateWgpuTransform = 'update_wgpu_transform',
  UpdateThumbnailQueue = 'update_thumbnail_queue',
  UpdateExifFields = 'update_exif_fields',
  FetchCommunityPresets = 'fetch_community_presets',
  GenerateAllCommunityPreviews = 'generate_all_community_previews',
  SaveCommunityPreset = 'save_community_preset',
  SaveTempFile = 'save_temp_file',
  GetAlbums = 'get_albums',
  SaveAlbums = 'save_albums',
  AddToAlbum = 'add_to_album',
  GetAlbumImages = 'get_album_images',
}

export enum ExifOverlay {
  Off = 'off',
  Hover = 'hover',
  Always = 'always',
}

export enum Panel {
  Adjustments = 'adjustments',
  Ai = 'ai',
  Crop = 'crop',
  Export = 'export',
  Masks = 'masks',
  Metadata = 'metadata',
  Presets = 'presets',
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
  openTreeSections?: string[];
  folderIcons?: Record<string, string>;
  exifOverlay?: ExifOverlay;
  language?: string;
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
  exposureMetric: number;
  focusScore: number;
  focusConfidence: number;
  focusRegion: string;
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
