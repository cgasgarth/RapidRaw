import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import type { TFunction } from 'i18next';
import { AlertTriangle, Check, ChevronDown, ChevronRight, GitMerge, Plus, Star, Tag, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLibraryActions } from '../../../../hooks/library/useLibraryActions';
import { useManagedFocus } from '../../../../hooks/ui/useManagedFocus';
import {
  type ActiveDisplayProfile,
  activeDisplayProfileSchema,
  type DisplayPreviewLutStatus,
  displayPreviewLutStatusSchema,
} from '../../../../schemas/displayProfileSchemas';
import { emptyTauriResponseSchema } from '../../../../schemas/tauriResponseSchemas';
import {
  type XmpMetadataConflictChoice,
  type XmpMetadataConflictDecision,
  type XmpMetadataConflictReport,
  xmpMetadataConflictReportSchema,
} from '../../../../schemas/xmpMetadataConflictSchemas';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useLibraryStore } from '../../../../store/useLibraryStore';
import { useProcessStore } from '../../../../store/useProcessStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import { Invokes } from '../../../../tauri/commands';
import { TextColors, TextVariants, TextWeights } from '../../../../types/typography';
import { COLOR_LABELS, type Color } from '../../../../utils/adjustments';
import { buildCameraProfileProvenanceReceipt } from '../../../../utils/cameraProfileProvenanceReceipt';
import {
  buildDefaultXmpConflictDecisions,
  buildMetadataReadinessSummary,
  formatExifApertureFromMetadata,
  formatExifFocalLengthFromMetadata,
  getDisplayPreviewLutLocaleStatus,
  hasMetadataValue,
  METADATA_CAMERA_GRID_KEYS,
  METADATA_EDITABLE_FIELDS,
  type MetadataExifData,
  type MetadataValue,
} from '../../../../utils/metadataPanelContracts';
import { buildRawWarningChips } from '../../../../utils/rawWarningReceipts';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import UiText from '../../../ui/primitives/Text';
import { IconAperture, IconFocalLength, IconIso, IconLens, IconShutter } from '../../editor/ExifIcons';

interface CameraSetting {
  format?(value: MetadataValue): string | number;
  label: string;
}

type CameraSettingKey = 'ExposureTime' | 'FNumber' | 'FocalLengthIn35mmFilm' | 'LensModel' | 'PhotographicSensitivity';

type CameraSettings = Record<CameraSettingKey, CameraSetting>;

type ConflictDecisions = Partial<Record<XmpMetadataConflictDecision['field'], XmpMetadataConflictChoice>>;
type DisplayProfileState =
  | { error: string; loading: false; profile: null }
  | { error: null; loading: true; profile: null }
  | { error: null; loading: false; profile: ActiveDisplayProfile };
type DisplayPreviewLutState =
  | { error: string; loading: false; lut: null }
  | { error: null; loading: true; lut: null }
  | { error: null; loading: false; lut: DisplayPreviewLutStatus };

interface GPSData {
  altitude: string | number | null;
  lat: number | null;
  lon: number | null;
}

interface CameraGridSetting {
  key: CameraSettingKey;
  label: string;
  value: MetadataValue;
}

interface MetaDataItemProps {
  label: string;
  value: MetadataValue;
}

const USER_TAG_PREFIX = 'user:';

const DISPLAY_PROFILE_HASH_PREFIX_LENGTH = 19;

function formatExifTag(str: string) {
  if (!str) return '';
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex] ?? 'GB'}`;
}

function formatElapsedMs(value: number) {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function formatRawReceiptToken(value: string) {
  return value
    .split('_')
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');
}

function parseDms(dmsString: string) {
  if (!dmsString) return null;
  const parts = /(\d+\.?\d*)\s+deg\s+(\d+\.?\d*)\s+min\s+(\d+\.?\d*)\s+sec/.exec(dmsString);
  if (!parts) return null;
  const degrees = parseFloat(parts[1] ?? '0');
  const minutes = parseFloat(parts[2] ?? '0');
  const seconds = parseFloat(parts[3] ?? '0');
  return degrees + minutes / 60 + seconds / 3600;
}

const CAMERA_ICONS: Record<string, React.FC> = {
  FNumber: IconAperture,
  ExposureTime: IconShutter,
  PhotographicSensitivity: IconIso,
  FocalLengthIn35mmFilm: IconFocalLength,
  LensModel: IconLens,
};

function MetadataItem({ label, value }: MetaDataItemProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const strValue = String(value);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(strValue);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="flex justify-between items-start gap-4 py-1.5 px-2 rounded-md hover:bg-card-active transition-colors cursor-default">
      <UiText
        variant={TextVariants.small}
        color={TextColors.secondary}
        weight={TextWeights.medium}
        className="shrink-0 mt-0.5"
      >
        {label}
      </UiText>
      <button
        type="button"
        className="grid cursor-pointer text-right min-w-0 flex-1 bg-transparent border-0 p-0 font-inherit"
        onMouseEnter={() => {
          setIsHovered(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          setCopied(false);
        }}
        onClick={(event) => {
          void handleCopy(event);
        }}
        data-tooltip={strValue.length > 500 ? strValue.slice(0, 500) + '...' : strValue}
      >
        <UiText
          variant={TextVariants.small}
          color={TextColors.primary}
          className={cx(
            'col-start-1 row-start-1 break-words min-w-0 text-right line-clamp-3 transition-opacity duration-200 ease-in-out select-none',
            isHovered ? 'opacity-0' : 'opacity-100',
          )}
        >
          {strValue}
        </UiText>
        <span
          aria-hidden={!isHovered}
          className={cx(
            'col-start-1 row-start-1 text-xs font-medium text-text-primary select-none transition-opacity duration-200 ease-in-out pointer-events-none flex items-center justify-end h-full',
            isHovered ? 'opacity-100' : 'opacity-0',
          )}
        >
          {copied ? t('editor.metadata.copied') : t('editor.metadata.copy')}
        </span>
      </button>
    </div>
  );
}

function formatConflictValue(value: unknown) {
  if (value === null || value === undefined) return 'None';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'None';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return 'Unsupported value';
}

function formatDisplayProfileHash(profile: ActiveDisplayProfile) {
  return profile.iccSha256?.slice(0, DISPLAY_PROFILE_HASH_PREFIX_LENGTH) ?? '-';
}

function formatDisplayProfileByteCount(profile: ActiveDisplayProfile) {
  if (profile.profileByteCount === null || profile.profileByteCount === undefined) return '-';
  return profile.profileByteCount.toLocaleString();
}

function formatCameraProfileEndpoint(warmIlluminant?: string | null, coolIlluminant?: string | null) {
  if (warmIlluminant && coolIlluminant) return `${warmIlluminant} → ${coolIlluminant}`;
  return warmIlluminant ?? coolIlluminant ?? '-';
}

function formatCameraProfilePercent(value?: number | null) {
  return value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`;
}

function formatCameraProfileCct(value?: number | null) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} K`;
}

function formatCameraProfileHash(value?: string | null) {
  return value?.slice(0, 20) ?? '-';
}

function xmpChoiceLabel(choice: XmpMetadataConflictChoice, t: TFunction) {
  if (choice === 'local') return t('editor.metadata.xmpConflicts.choices.local');
  if (choice === 'external') return t('editor.metadata.xmpConflicts.choices.external');
  return t('editor.metadata.xmpConflicts.choices.merge');
}

interface EditableMetadataItemProps {
  label: string;
  value: string;
  onSave: (val: string) => void;
}

function EditableMetadataItem({ label, value, onSave }: EditableMetadataItemProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useManagedFocus(inputRef, isEditing);

  const handleSave = () => {
    setIsEditing(false);
    const trimmedLocal = localValue.trim();
    const trimmedProp = (value || '').trim();
    if (trimmedLocal !== trimmedProp) {
      onSave(trimmedLocal);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setLocalValue(value || '');
      setIsEditing(false);
    }
  };

  return (
    <div className="flex justify-between items-center gap-4 py-1 px-2 rounded-md">
      <UiText
        variant={TextVariants.small}
        color={TextColors.secondary}
        weight={TextWeights.medium}
        className="shrink-0 truncate"
      >
        {label}
      </UiText>

      <div className="w-[55%] shrink-0">
        {isEditing ? (
          <input
            type="text"
            value={localValue}
            onChange={(e) => {
              setLocalValue(e.target.value);
            }}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            ref={inputRef}
            className="bg-bg-secondary border border-accent rounded-sm px-2 py-0.5 text-xs text-text-primary text-right outline-hidden w-full shadow-sm focus:ring-1 focus:ring-accent/30"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setLocalValue(value || '');
              setIsEditing(true);
            }}
            className="text-xs px-2 py-0.5 min-h-[24px] flex items-center justify-end rounded-sm cursor-text border transition-colors text-right truncate w-full text-text-primary bg-bg-secondary/40 border-surface/50 hover:bg-bg-secondary/80 hover:border-text-tertiary/40"
            data-tooltip={value ? t('editor.metadata.clickToEdit') : t('editor.metadata.emptyClickToAdd')}
          >
            {value}
          </button>
        )}
      </div>
    </div>
  );
}

const EDITABLE_FIELD_LABEL_FALLBACKS: Record<(typeof METADATA_EDITABLE_FIELDS)[number]['label'], string> = {
  author: 'Author',
  comments: 'Comments',
  copyright: 'Copyright',
  title: 'Title',
};

const KEY_CAMERA_SETTINGS_MAP: CameraSettings = {
  FNumber: {
    label: 'Aperture',
  },
  ExposureTime: {
    format: (value: MetadataValue) => (String(value).endsWith('s') ? String(value) : `${String(value)}s`),
    label: 'Shutter Speed',
  },
  PhotographicSensitivity: {
    format: (value: MetadataValue) => String(value),
    label: 'ISO',
  },
  FocalLengthIn35mmFilm: {
    label: 'Focal Length',
  },
  LensModel: {
    format: (value: MetadataValue) => String(value).replace(/"/g, ''),
    label: 'Lens',
  },
};

function translateCameraGridLabel(key: (typeof METADATA_CAMERA_GRID_KEYS)[number], t: TFunction) {
  switch (key) {
    case 'ExposureTime':
      return t('editor.metadata.camera.shutterSpeed');
    case 'FNumber':
      return t('editor.metadata.camera.aperture');
    case 'FocalLengthIn35mmFilm':
      return t('editor.metadata.camera.focalLength');
    case 'PhotographicSensitivity':
      return t('editor.metadata.camera.iso');
  }
}

export default function MetadataPanel() {
  const { t } = useTranslation();
  const [isOrganizationExpanded, setIsOrganizationExpanded] = useState(false);
  const [isAuthorExpanded, setIsAuthorExpanded] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const [isTagInputFocused, setIsTagInputFocused] = useState(false);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const multiSelectedPaths = useLibraryStore((s) => s.multiSelectedPaths);
  const imageList = useLibraryStore((s) => s.imageList);
  const imageRatings = useLibraryStore((s) => s.imageRatings);
  const appSettings = useSettingsStore((s) => s.appSettings);
  const thumbnails = useProcessStore((s) => s.thumbnails);
  const setLibrary = useLibraryStore((s) => s.setLibrary);

  const { handleRate, handleSetColorLabel, handleTagsChanged, handleUpdateExif } = useLibraryActions();
  const [xmpConflictReport, setXmpConflictReport] = useState<XmpMetadataConflictReport | null>(null);
  const [xmpConflictDecisions, setXmpConflictDecisions] = useState<ConflictDecisions>({});
  const [isCheckingXmpConflicts, setIsCheckingXmpConflicts] = useState(false);
  const [isResolvingXmpConflicts, setIsResolvingXmpConflicts] = useState(false);
  const [displayProfileState, setDisplayProfileState] = useState<DisplayProfileState>({
    error: null,
    loading: true,
    profile: null,
  });
  const [displayPreviewLutState, setDisplayPreviewLutState] = useState<DisplayPreviewLutState>({
    error: null,
    loading: true,
    lut: null,
  });

  const rating = selectedImage ? imageRatings[selectedImage.path] || 0 : 0;
  const tags = useMemo(
    () => (selectedImage ? imageList.find((img) => img.path === selectedImage.path)?.tags || [] : []),
    [imageList, selectedImage],
  );
  const liveThumbnailUrl = selectedImage ? thumbnails[selectedImage.path] : undefined;

  const targetPaths = multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : [];

  const { cameraGridSettings, lensSetting, gpsData, otherExifEntries } = useMemo(() => {
    const exif = (selectedImage?.exif || {}) as MetadataExifData;

    const cameraGridSettings: CameraGridSetting[] = METADATA_CAMERA_GRID_KEYS.map((key) => {
      const value =
        key === 'FNumber'
          ? formatExifApertureFromMetadata(exif)
          : key === 'FocalLengthIn35mmFilm'
            ? formatExifFocalLengthFromMetadata(exif)
            : exif[key];
      const hasValue = hasMetadataValue(value);

      const translatedLabel = translateCameraGridLabel(key, t);

      const cameraSetting = KEY_CAMERA_SETTINGS_MAP[key];
      return {
        key: key,
        label: translatedLabel,
        value: hasValue && cameraSetting.format ? cameraSetting.format(value) : hasValue ? value : '-',
      };
    });

    const lensValue = exif['LensModel'];
    const hasLensValue = hasMetadataValue(lensValue);
    const lensSetting = {
      key: 'LensModel',
      label: t('editor.metadata.camera.lens'),
      value:
        hasLensValue && KEY_CAMERA_SETTINGS_MAP['LensModel'].format
          ? KEY_CAMERA_SETTINGS_MAP['LensModel'].format(lensValue)
          : hasLensValue
            ? lensValue
            : '-',
    };

    const latStr = exif['GPSLatitude'];
    const latRef = exif['GPSLatitudeRef'];
    const lonStr = exif['GPSLongitude'];
    const lonRef = exif['GPSLongitudeRef'];

    const gpsData: GPSData = { lat: null, lon: null, altitude: exif['GPSAltitude'] || null };
    if (latStr && latRef && lonStr && lonRef) {
      const parsedLat = parseDms(String(latStr));
      const parsedLon = parseDms(String(lonStr));
      if (parsedLat !== null && parsedLon !== null) {
        gpsData.lat = String(latRef).toUpperCase() === 'S' ? -parsedLat : parsedLat;
        gpsData.lon = String(lonRef).toUpperCase() === 'W' ? -parsedLon : parsedLon;
      }
    }

    const handledKeys = [
      ...METADATA_CAMERA_GRID_KEYS,
      'ApertureValue',
      'FocalLength',
      'LensModel',
      ...METADATA_EDITABLE_FIELDS.map((f) => f.key),
    ];
    const otherExifEntries = Object.entries(exif)
      .filter(([key]) => !handledKeys.includes(key))
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

    return { cameraGridSettings, lensSetting, gpsData, otherExifEntries };
  }, [selectedImage?.exif, t]);

  const currentColor = useMemo(() => {
    return tags.find((tag: string) => tag.startsWith('color:'))?.substring(6) || null;
  }, [tags]);

  const currentTags = useMemo(() => {
    return tags
      .filter((t) => !t.startsWith('color:'))
      .map((t) => ({
        tag: t.startsWith(USER_TAG_PREFIX) ? t.substring(USER_TAG_PREFIX.length) : t,
        isUser: t.startsWith(USER_TAG_PREFIX),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }, [tags]);

  const gpsCoordinates = gpsData.lat !== null && gpsData.lon !== null ? { lat: gpsData.lat, lon: gpsData.lon } : null;
  const fullPath = selectedImage?.path || '';
  const isVirtualCopy = fullPath.includes('?vc=');
  const basePath = fullPath.split('?vc=')[0] ?? fullPath;
  const fileName = basePath.split(/[\\/]/).pop() || '';
  const fileExtension = fileName.split('.').pop()?.toUpperCase() || 'FILE';
  const megapixels = selectedImage ? ((selectedImage.width * selectedImage.height) / 1000000).toFixed(1) : null;
  const rawDevelopmentReport = selectedImage?.rawDevelopmentReport ?? null;
  const cameraProfileReport = rawDevelopmentReport?.cameraProfile ?? null;
  const cameraProfileReceipt =
    rawDevelopmentReport === null ? null : buildCameraProfileProvenanceReceipt(rawDevelopmentReport);
  const rawWarningChips = useMemo(
    () =>
      buildRawWarningChips(
        {
          rawDevelopmentReport,
        },
        t,
      ),
    [rawDevelopmentReport, t],
  );
  const metadataReadiness = buildMetadataReadinessSummary({
    exif: selectedImage?.exif || {},
    gpsCoordinates,
    selectionCount: targetPaths.length,
  });

  useEffect(() => {
    let isActive = true;

    const loadDisplayProfile = async () => {
      setDisplayProfileState({ error: null, loading: true, profile: null });
      setDisplayPreviewLutState({ error: null, loading: true, lut: null });
      try {
        const [profile, lut] = await Promise.all([
          invokeWithSchema(Invokes.GetActiveDisplayProfile, {}, activeDisplayProfileSchema),
          invokeWithSchema(Invokes.GetDisplayPreviewLutStatus, {}, displayPreviewLutStatusSchema),
        ]);
        if (isActive) setDisplayProfileState({ error: null, loading: false, profile });
        if (isActive) setDisplayPreviewLutState({ error: null, loading: false, lut });
      } catch (err) {
        if (isActive) {
          const error = err instanceof Error ? err.message : String(err);
          setDisplayProfileState({
            error,
            loading: false,
            profile: null,
          });
          setDisplayPreviewLutState({
            error,
            loading: false,
            lut: null,
          });
        }
      }
    };

    void loadDisplayProfile();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const checkConflicts = async () => {
      if (!selectedImage?.path || targetPaths.length !== 1) {
        setXmpConflictReport(null);
        setXmpConflictDecisions({});
        return;
      }

      setIsCheckingXmpConflicts(true);
      try {
        const result = await invokeWithSchema(
          Invokes.CheckXmpMetadataConflicts,
          { path: selectedImage.path },
          xmpMetadataConflictReportSchema.nullable(),
        );
        if (!isActive) return;

        if (result === null) {
          setXmpConflictReport(null);
          setXmpConflictDecisions({});
          return;
        }

        setXmpConflictReport(result);
        setXmpConflictDecisions(buildDefaultXmpConflictDecisions(result));
      } catch (err) {
        if (isActive) {
          console.error('Failed to check XMP conflicts:', err);
          setXmpConflictReport(null);
          setXmpConflictDecisions({});
        }
      } finally {
        if (isActive) setIsCheckingXmpConflicts(false);
      }
    };

    void checkConflicts();

    return () => {
      isActive = false;
    };
  }, [selectedImage?.path, targetPaths.length]);

  const handleResolveXmpConflicts = async () => {
    if (!selectedImage?.path || xmpConflictReport === null) return;

    const decisions: XmpMetadataConflictDecision[] = xmpConflictReport.fields.map((field) => ({
      field: field.field,
      choice: xmpConflictDecisions[field.field] ?? (field.field === 'keywords' ? 'merge' : 'external'),
    }));

    setIsResolvingXmpConflicts(true);
    try {
      await invokeWithSchema(
        Invokes.ResolveXmpMetadataConflicts,
        { path: selectedImage.path, decisions },
        emptyTauriResponseSchema,
      );

      setLibrary((state) => {
        const nextRatings = { ...state.imageRatings };
        const nextImageList = state.imageList.map((image) => {
          if (image.path !== selectedImage.path) return image;

          let nextRating = nextRatings[image.path] ?? image.rating;
          let nextTags = [...(image.tags ?? [])];

          for (const decision of decisions) {
            const field = xmpConflictReport.fields.find((candidate) => candidate.field === decision.field);
            if (!field) continue;
            const value =
              decision.choice === 'local'
                ? field.local
                : decision.choice === 'merge'
                  ? (field.merged ?? field.external)
                  : field.external;

            if (field.field === 'rating' && typeof value === 'number') {
              nextRating = value;
              nextRatings[image.path] = value;
            }

            if (field.field === 'colorLabel') {
              nextTags = nextTags.filter((tag) => !tag.startsWith('color:'));
              if (typeof value === 'string' && value.length > 0) nextTags.push(`color:${value}`);
            }

            if (field.field === 'keywords' && Array.isArray(value)) {
              const colorTags = nextTags.filter((tag) => tag.startsWith('color:'));
              const keywordTags = value
                .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
                .map((tag) => `user:${tag.trim()}`);
              nextTags = [...colorTags, ...keywordTags];
            }
          }

          return { ...image, rating: nextRating, tags: nextTags.length > 0 ? nextTags : null };
        });

        return { imageList: nextImageList, imageRatings: nextRatings };
      });
      setXmpConflictReport(null);
      setXmpConflictDecisions({});
    } catch (err) {
      console.error('Failed to resolve XMP conflicts:', err);
    } finally {
      setIsResolvingXmpConflicts(false);
    }
  };

  const handleAddTag = async (tagToAdd: string) => {
    const newTagValue = tagToAdd.trim().toLowerCase();
    if (newTagValue && !currentTags.some((t) => t.tag === newTagValue)) {
      try {
        const prefixedTag = `${USER_TAG_PREFIX}${newTagValue}`;
        await invokeWithSchema(
          Invokes.AddTagForPaths,
          { paths: targetPaths, tag: prefixedTag },
          emptyTauriResponseSchema,
        );

        const newTags = [...currentTags, { tag: newTagValue, isUser: true }];
        handleTagsChanged(targetPaths, newTags);
        setTagInputValue('');
      } catch (err) {
        console.error('Failed to add tag:', err);
      }
    }
  };

  const handleRemoveTag = async (tagToRemove: { tag: string; isUser: boolean }) => {
    try {
      const prefixedTag = tagToRemove.isUser ? `${USER_TAG_PREFIX}${tagToRemove.tag}` : tagToRemove.tag;
      await invokeWithSchema(
        Invokes.RemoveTagForPaths,
        { paths: targetPaths, tag: prefixedTag },
        emptyTauriResponseSchema,
      );

      const newTags = currentTags.filter((t) => t.tag !== tagToRemove.tag);
      handleTagsChanged(targetPaths, newTags);
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleAddTag(tagInputValue);
    }
    e.stopPropagation();
  };

  const LensIcon = CAMERA_ICONS['LensModel'];

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText variant={TextVariants.title}>{t('editor.metadata.title')}</UiText>
      </div>
      <div className="grow overflow-y-auto p-4 custom-scrollbar">
        {selectedImage ? (
          <div className="flex flex-col gap-6">
            <section
              className="grid grid-cols-2 gap-2 rounded-md border border-surface bg-bg-secondary/70 p-2 text-xs"
              data-camera-field-count={metadataReadiness.cameraFieldCount}
              data-editable-field-count={metadataReadiness.editableFieldCount}
              data-gps-ready={String(metadataReadiness.gpsReady)}
              data-selection-count={metadataReadiness.selectionCount}
              data-testid="metadata-readiness-summary"
            >
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {t('editor.metadata.readiness.selectionCount', { count: metadataReadiness.selectionCount })}
              </UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {t('editor.metadata.readiness.cameraFields', { count: metadataReadiness.cameraFieldCount })}
              </UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {!metadataReadiness.gpsReady
                  ? t('editor.metadata.readiness.gpsMissing')
                  : t('editor.metadata.readiness.gpsReady')}
              </UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {t('editor.metadata.readiness.editableFields', { count: metadataReadiness.editableFieldCount })}
              </UiText>
            </section>
            <section
              className="rounded-md border border-surface bg-bg-secondary/70 p-3 text-xs"
              data-display-profile-status={
                displayProfileState.profile?.status ?? (displayProfileState.loading ? 'loading' : 'error')
              }
              data-testid="metadata-display-profile-status"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <UiText variant={TextVariants.heading}>{t('editor.metadata.displayProfile.title')}</UiText>
                <UiText
                  as="span"
                  variant={TextVariants.small}
                  className={cx(
                    'rounded px-2 py-1 font-semibold',
                    displayProfileState.profile?.status === 'active_profile_loaded'
                      ? 'bg-green-500/10 text-green-300'
                      : 'bg-yellow-500/10 text-yellow-200',
                  )}
                >
                  {displayProfileState.loading
                    ? t('editor.metadata.displayProfile.loading')
                    : displayProfileState.profile
                      ? t(`editor.metadata.displayProfile.status.${displayProfileState.profile.status}`)
                      : t('editor.metadata.displayProfile.status.error')}
                </UiText>
              </div>
              {displayProfileState.profile ? (
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.displayProfile.cmm')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                    {displayProfileState.profile.cmm}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.displayProfile.displayId')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                    {displayProfileState.profile.displayId ?? '-'}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.displayProfile.iccHash')}
                  </UiText>
                  <UiText
                    variant={TextVariants.small}
                    color={TextColors.primary}
                    className="truncate text-right"
                    data-tooltip={displayProfileState.profile.iccSha256 ?? undefined}
                  >
                    {formatDisplayProfileHash(displayProfileState.profile)}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.displayProfile.profileBytes')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                    {formatDisplayProfileByteCount(displayProfileState.profile)}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.displayProfile.previewLut')}
                  </UiText>
                  <UiText
                    variant={TextVariants.small}
                    color={TextColors.primary}
                    className="truncate text-right"
                    data-display-preview-lut-samples={displayPreviewLutState.lut?.sampleCount ?? 0}
                    data-display-preview-lut-size={displayPreviewLutState.lut?.size ?? 0}
                    data-display-preview-lut-status={
                      displayPreviewLutState.lut === null
                        ? displayPreviewLutState.loading
                          ? 'loading'
                          : 'error'
                        : getDisplayPreviewLutLocaleStatus(displayPreviewLutState.lut)
                    }
                    data-testid="metadata-display-preview-lut-status"
                  >
                    {displayPreviewLutState.loading
                      ? t('editor.metadata.displayProfile.loading')
                      : displayPreviewLutState.lut
                        ? t(
                            `editor.metadata.displayProfile.previewLutStatus.${getDisplayPreviewLutLocaleStatus(displayPreviewLutState.lut)}`,
                          )
                        : t('editor.metadata.displayProfile.status.error')}
                  </UiText>
                </div>
              ) : (
                <UiText variant={TextVariants.small} color={TextColors.secondary}>
                  {displayProfileState.loading
                    ? t('editor.metadata.displayProfile.loadingDescription')
                    : t('editor.metadata.displayProfile.errorDescription', { error: displayProfileState.error })}
                </UiText>
              )}
            </section>
            {selectedImage.isRaw && rawDevelopmentReport !== null && cameraProfileReport !== null && (
              <section
                className="rounded-md border border-surface bg-bg-secondary/70 p-3 text-xs"
                data-camera-profile-algorithm={cameraProfileReport.algorithmId}
                data-camera-profile-candidate-count={cameraProfileReport.candidateCount}
                data-camera-profile-matrix-hash={cameraProfileReport.matrixHash ?? ''}
                data-camera-profile-status={cameraProfileReport.status}
                data-demosaic-path={rawDevelopmentReport.demosaicPath}
                data-testid="metadata-camera-profile-report"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <UiText variant={TextVariants.heading}>{t('editor.metadata.cameraProfile.title')}</UiText>
                  <UiText
                    as="span"
                    variant={TextVariants.small}
                    className={cx(
                      'rounded px-2 py-1 font-semibold',
                      cameraProfileReport.status === 'interpolated'
                        ? 'bg-green-500/10 text-green-300'
                        : cameraProfileReport.status === 'single_illuminant'
                          ? 'bg-sky-500/10 text-sky-200'
                          : 'bg-yellow-500/10 text-yellow-200',
                    )}
                    data-testid="metadata-camera-profile-status-label"
                  >
                    {t(`editor.metadata.cameraProfile.status.${cameraProfileReport.status}`)}
                  </UiText>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {cameraProfileReceipt !== null && (
                    <>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {t('editor.metadata.cameraProfile.receipt')}
                      </UiText>
                      <UiText
                        variant={TextVariants.small}
                        color={TextColors.primary}
                        className="truncate text-right"
                        data-candidate-count={cameraProfileReceipt.candidateCount}
                        data-colorchecker-fallback-reason={cameraProfileReceipt.colorCheckerFallbackReason ?? ''}
                        data-colorchecker-gate-status={cameraProfileReceipt.colorCheckerGateStatus}
                        data-colorchecker-mean-delta-e00={cameraProfileReceipt.colorCheckerMeanDeltaE00 ?? ''}
                        data-colorchecker-p95-delta-e00={cameraProfileReceipt.colorCheckerP95DeltaE00 ?? ''}
                        data-colorchecker-patch-count={cameraProfileReceipt.colorCheckerPatchCount ?? ''}
                        data-cool-illuminant={cameraProfileReceipt.coolIlluminant ?? ''}
                        data-cool-weight={cameraProfileReceipt.coolWeight ?? ''}
                        data-demosaic-algorithm-id={cameraProfileReceipt.demosaicAlgorithmId ?? ''}
                        data-demosaic-path={cameraProfileReceipt.demosaicPath}
                        data-estimated-cct-kelvin={cameraProfileReceipt.estimatedCctKelvin ?? ''}
                        data-matrix-hash={cameraProfileReceipt.matrixHash ?? ''}
                        data-processing-profile={cameraProfileReceipt.processingProfile}
                        data-preview-elapsed-ms={cameraProfileReceipt.previewElapsedMs ?? ''}
                        data-profile-confidence-basis={cameraProfileReceipt.profileConfidenceBasis}
                        data-receipt-version={cameraProfileReceipt.receiptVersion}
                        data-scratch-memory-bytes={cameraProfileReceipt.scratchMemoryBytes ?? ''}
                        data-status={cameraProfileReceipt.status}
                        data-testid="metadata-camera-profile-provenance-receipt"
                        data-warm-illuminant={cameraProfileReceipt.warmIlluminant ?? ''}
                        data-warning-count={cameraProfileReceipt.warningCount}
                      >
                        {t('editor.metadata.cameraProfile.receiptSummary', {
                          demosaicPath: formatRawReceiptToken(cameraProfileReceipt.demosaicPath),
                          processingProfile: formatRawReceiptToken(cameraProfileReceipt.processingProfile),
                          status: cameraProfileReceipt.status,
                        })}
                      </UiText>
                    </>
                  )}
                  {cameraProfileReceipt !== null && (
                    <>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {t('editor.metadata.cameraProfile.colorCheckerGate')}
                      </UiText>
                      <UiText
                        variant={TextVariants.small}
                        color={TextColors.primary}
                        className="truncate text-right"
                        data-colorchecker-fallback-reason={cameraProfileReceipt.colorCheckerFallbackReason ?? ''}
                        data-colorchecker-gate-status={cameraProfileReceipt.colorCheckerGateStatus}
                        data-colorchecker-max-delta-e00={cameraProfileReceipt.colorCheckerMaxDeltaE00 ?? ''}
                        data-colorchecker-mean-delta-e00={cameraProfileReceipt.colorCheckerMeanDeltaE00 ?? ''}
                        data-colorchecker-median-delta-e00={cameraProfileReceipt.colorCheckerMedianDeltaE00 ?? ''}
                        data-colorchecker-p95-delta-e00={cameraProfileReceipt.colorCheckerP95DeltaE00 ?? ''}
                        data-colorchecker-patch-count={cameraProfileReceipt.colorCheckerPatchCount ?? ''}
                        data-colorchecker-threshold-mean-delta-e00={
                          cameraProfileReceipt.colorCheckerThresholdMeanDeltaE00 ?? ''
                        }
                        data-colorchecker-threshold-p95-delta-e00={
                          cameraProfileReceipt.colorCheckerThresholdP95DeltaE00 ?? ''
                        }
                        data-profile-confidence-basis={cameraProfileReceipt.profileConfidenceBasis}
                        data-testid="metadata-camera-profile-colorchecker-gate"
                      >
                        {t('editor.metadata.cameraProfile.colorCheckerGateSummary', {
                          basis: t(
                            `editor.metadata.cameraProfile.confidenceBasis.${cameraProfileReceipt.profileConfidenceBasis}`,
                          ),
                          mean:
                            cameraProfileReceipt.colorCheckerMeanDeltaE00 === null
                              ? t('editor.metadata.cameraProfile.notApplicable')
                              : cameraProfileReceipt.colorCheckerMeanDeltaE00.toFixed(2),
                          p95:
                            cameraProfileReceipt.colorCheckerP95DeltaE00 === null
                              ? t('editor.metadata.cameraProfile.notApplicable')
                              : cameraProfileReceipt.colorCheckerP95DeltaE00.toFixed(2),
                          status: t(
                            `editor.metadata.cameraProfile.colorCheckerGateStatus.${cameraProfileReceipt.colorCheckerGateStatus}`,
                          ),
                        })}
                      </UiText>
                    </>
                  )}
                  {cameraProfileReceipt !== null && (
                    <>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {t('editor.metadata.cameraProfile.runtime')}
                      </UiText>
                      <UiText
                        variant={TextVariants.small}
                        color={TextColors.primary}
                        className="truncate text-right"
                        data-cache-hit={cameraProfileReceipt.cacheHit ?? ''}
                        data-decode-elapsed-ms={cameraProfileReceipt.decodeElapsedMs ?? ''}
                        data-export-elapsed-ms={cameraProfileReceipt.exportElapsedMs ?? ''}
                        data-output-dimensions={cameraProfileReceipt.outputDimensions?.join('x') ?? ''}
                        data-preview-elapsed-ms={cameraProfileReceipt.previewElapsedMs ?? ''}
                        data-testid="metadata-raw-runtime-receipt"
                      >
                        {t('editor.metadata.cameraProfile.runtimeSummary', {
                          cache: cameraProfileReceipt.cacheHit
                            ? t('editor.metadata.cameraProfile.cacheHit')
                            : t('editor.metadata.cameraProfile.cacheMiss'),
                          decode:
                            cameraProfileReceipt.decodeElapsedMs === null
                              ? t('editor.metadata.cameraProfile.notApplicable')
                              : formatElapsedMs(cameraProfileReceipt.decodeElapsedMs),
                          preview:
                            cameraProfileReceipt.previewElapsedMs === null
                              ? t('editor.metadata.cameraProfile.notApplicable')
                              : formatElapsedMs(cameraProfileReceipt.previewElapsedMs),
                        })}
                      </UiText>
                    </>
                  )}
                  {rawWarningChips.length > 0 && (
                    <>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {t('editor.metadata.cameraProfile.warnings')}
                      </UiText>
                      <div
                        className="flex flex-wrap justify-end gap-1"
                        data-raw-warning-codes={rawWarningChips.map((chip) => chip.code).join(',')}
                        data-testid="metadata-raw-warning-chips"
                      >
                        {rawWarningChips.map((chip) => (
                          <span
                            key={chip.code}
                            className={cx(
                              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              chip.tone === 'warning'
                                ? 'bg-yellow-500/15 text-yellow-200'
                                : 'bg-sky-500/15 text-sky-200',
                            )}
                            data-raw-warning-code={chip.code}
                          >
                            {formatRawReceiptToken(chip.label)}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.processingMode')}
                  </UiText>
                  <UiText
                    variant={TextVariants.small}
                    color={TextColors.primary}
                    className="truncate text-right"
                    data-testid="metadata-raw-processing-mode"
                  >
                    {formatRawReceiptToken(rawDevelopmentReport.processingProfile)}
                    {' / '}
                    {formatRawReceiptToken(rawDevelopmentReport.demosaicPath)}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.demosaicProvenance')}
                  </UiText>
                  <UiText
                    variant={TextVariants.small}
                    color={TextColors.primary}
                    className="truncate text-right"
                    data-demosaic-algorithm-id={rawDevelopmentReport.demosaicAlgorithmId ?? ''}
                    data-testid="metadata-raw-demosaic-provenance"
                  >
                    {rawDevelopmentReport.demosaicAlgorithmId ?? t('editor.metadata.cameraProfile.defaultDemosaic')}
                  </UiText>
                  {cameraProfileReceipt !== null && (
                    <>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {t('editor.metadata.cameraProfile.scratchMemory')}
                      </UiText>
                      <UiText
                        variant={TextVariants.small}
                        color={TextColors.primary}
                        className="truncate text-right"
                        data-testid="metadata-raw-scratch-memory"
                      >
                        {cameraProfileReceipt.scratchMemoryBytes === null
                          ? t('editor.metadata.cameraProfile.notApplicable')
                          : formatBytes(cameraProfileReceipt.scratchMemoryBytes)}
                      </UiText>
                    </>
                  )}
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.algorithm')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                    {cameraProfileReport.algorithmId}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.illuminants')}
                  </UiText>
                  <UiText
                    variant={TextVariants.small}
                    color={TextColors.primary}
                    className="truncate text-right"
                    data-testid="metadata-camera-profile-endpoints"
                  >
                    {formatCameraProfileEndpoint(
                      cameraProfileReport.warmIlluminant,
                      cameraProfileReport.coolIlluminant,
                    )}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.estimatedCct')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                    {formatCameraProfileCct(cameraProfileReport.estimatedCctKelvin)}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.coolWeight')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                    {formatCameraProfilePercent(cameraProfileReport.coolWeight)}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary}>
                    {t('editor.metadata.cameraProfile.matrixHash')}
                  </UiText>
                  <UiText
                    variant={TextVariants.small}
                    color={TextColors.primary}
                    className="truncate text-right"
                    data-tooltip={cameraProfileReport.matrixHash ?? undefined}
                  >
                    {formatCameraProfileHash(cameraProfileReport.matrixHash)}
                  </UiText>
                  {cameraProfileReport.fallbackReason && (
                    <>
                      <UiText variant={TextVariants.small} color={TextColors.secondary}>
                        {t('editor.metadata.cameraProfile.fallbackReason')}
                      </UiText>
                      <UiText variant={TextVariants.small} color={TextColors.primary} className="truncate text-right">
                        {cameraProfileReport.fallbackReason}
                      </UiText>
                    </>
                  )}
                </div>
              </section>
            )}
            <div>
              <UiText variant={TextVariants.heading} className="mb-3">
                {t('editor.metadata.fileInfo.title')}
              </UiText>
              <div className="bg-surface border border-surface rounded-xl p-3.5 flex flex-col gap-2 cursor-default relative min-h-[5.5rem] overflow-hidden">
                {(liveThumbnailUrl || selectedImage.thumbnailUrl) && (
                  <div
                    className="absolute inset-y-0 right-0 w-2/3 pointer-events-none opacity-20"
                    style={{
                      backgroundImage: `url(${liveThumbnailUrl || selectedImage.thumbnailUrl})`,
                      backgroundPosition: 'right center',
                      backgroundSize: 'cover',
                      filter: 'grayscale(100%)',
                      maskImage: 'linear-gradient(to right, transparent 5%, black 80%)',
                      WebkitMaskImage: 'linear-gradient(to right, transparent 5%, black 80%)',
                    }}
                  />
                )}

                <div className="flex justify-between items-start gap-4 relative z-10">
                  <UiText weight={TextWeights.semibold} color={TextColors.primary} className="truncate drop-shadow-sm">
                    {fileName || '-'}
                  </UiText>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isVirtualCopy && (
                      <div
                        className="bg-bg-primary/80 backdrop-blur-md text-text-secondary font-bold text-[10px] rounded-md px-2 py-1 tracking-wider uppercase shadow-sm border border-surface/50"
                        data-tooltip={t('editor.metadata.fileInfo.virtualCopy')}
                      >
                        {t('editor.metadata.fileInfo.virtualCopyAbbreviation')}
                      </div>
                    )}
                    <div className="bg-bg-primary/80 backdrop-blur-md text-text-secondary font-bold text-[10px] rounded-md px-2 py-1 tracking-wider uppercase shadow-sm border border-surface/50">
                      {fileExtension}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-0.5 relative z-10">
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate drop-shadow-sm">
                    {selectedImage.width && selectedImage.height
                      ? t('editor.metadata.fileInfo.dimensions', {
                          width: selectedImage.width,
                          height: selectedImage.height,
                          megapixels,
                        })
                      : t('editor.metadata.fileInfo.emptyDimensions')}
                  </UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="truncate drop-shadow-sm">
                    {selectedImage.exif?.DateTimeOriginal || '-'}
                  </UiText>
                </div>
              </div>
            </div>

            <div>
              <UiText variant={TextVariants.heading} className="mb-3">
                {t('editor.metadata.camera.title')}
              </UiText>
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  {cameraGridSettings.map((item) => {
                    const Icon = CAMERA_ICONS[item.key];
                    return (
                      <div
                        key={item.key}
                        className="flex items-center gap-2 bg-surface border border-surface px-3 py-2 rounded-xl cursor-default"
                        data-tooltip={item.label}
                      >
                        {Icon && (
                          <span className="text-text-secondary opacity-90 flex items-center justify-center shrink-0">
                            <Icon />
                          </span>
                        )}
                        <UiText
                          as="span"
                          variant={TextVariants.small}
                          color={TextColors.primary}
                          weight={TextWeights.medium}
                          className="truncate"
                        >
                          {item.value}
                        </UiText>
                      </div>
                    );
                  })}
                </div>

                <div
                  className="flex items-center gap-2 bg-surface border border-surface px-3 py-2 rounded-xl cursor-default"
                  data-tooltip={lensSetting.label}
                >
                  {LensIcon && (
                    <span className="text-text-secondary opacity-90 flex items-center justify-center shrink-0">
                      <LensIcon />
                    </span>
                  )}
                  <UiText
                    as="span"
                    variant={TextVariants.small}
                    weight={TextWeights.medium}
                    color={TextColors.primary}
                    className="truncate"
                  >
                    {lensSetting.value}
                  </UiText>
                </div>
              </div>
            </div>

            <div>
              <UiText variant={TextVariants.heading} className="mb-3">
                {t('editor.metadata.author.title')}
              </UiText>
              <div className="bg-surface rounded-xl overflow-hidden">
                <button
                  onClick={() => {
                    setIsAuthorExpanded(!isAuthorExpanded);
                  }}
                  className="w-full flex items-center justify-between p-3 hover:bg-card-active transition-colors"
                >
                  <UiText
                    as="span"
                    variant={TextVariants.label}
                    color={TextColors.primary}
                    className="flex items-center gap-2"
                  >
                    <User size={16} /> {t('editor.metadata.author.creatorDetails')}
                  </UiText>
                  <UiText color={TextColors.secondary}>
                    {isAuthorExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </UiText>
                </button>

                <AnimatePresence initial={false}>
                  {isAuthorExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-2 pb-3 pt-2 border-t border-surface/50 flex flex-col gap-0.5">
                        {METADATA_EDITABLE_FIELDS.map((field) => {
                          const rawValue = selectedImage.exif?.[field.key] || '';
                          const cleanValue = rawValue.replace(/^"|"$/g, '').trim();
                          const displayValue = cleanValue.toLowerCase() === 'default' ? '' : cleanValue;
                          return (
                            <EditableMetadataItem
                              key={field.key}
                              label={t(`editor.metadata.fields.${field.label}`, {
                                defaultValue: EDITABLE_FIELD_LABEL_FALLBACKS[field.label],
                              })}
                              value={displayValue}
                              onSave={(newVal) => {
                                void handleUpdateExif(targetPaths, { [field.key]: newVal });
                              }}
                            />
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div>
              <UiText variant={TextVariants.heading} className="mb-3">
                {t('editor.metadata.organization.title')}
              </UiText>
              <div className="bg-surface rounded-xl overflow-hidden">
                <button
                  onClick={() => {
                    setIsOrganizationExpanded(!isOrganizationExpanded);
                  }}
                  className="w-full flex items-center justify-between p-3 hover:bg-card-active transition-colors"
                >
                  <UiText
                    as="span"
                    variant={TextVariants.label}
                    color={TextColors.primary}
                    className="flex items-center gap-2"
                  >
                    <Tag size={16} /> {t('editor.metadata.organization.ratingLabels')}
                  </UiText>
                  <UiText color={TextColors.secondary}>
                    {isOrganizationExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </UiText>
                </button>

                <AnimatePresence initial={false}>
                  {isOrganizationExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-2 border-t border-surface/50 flex flex-col gap-4">
                        {(xmpConflictReport || isCheckingXmpConflicts) && (
                          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
                            <div className="mb-2 flex items-start justify-between gap-3">
                              <UiText
                                as="span"
                                variant={TextVariants.small}
                                color={TextColors.primary}
                                weight={TextWeights.semibold}
                                className="flex items-center gap-2"
                              >
                                <AlertTriangle size={15} className="text-yellow-400" />
                                {t('editor.metadata.xmpConflicts.title')}
                              </UiText>
                              {xmpConflictReport && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleResolveXmpConflicts();
                                  }}
                                  disabled={isResolvingXmpConflicts}
                                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-bg-primary transition-opacity disabled:opacity-50"
                                >
                                  <GitMerge size={13} />
                                  {isResolvingXmpConflicts
                                    ? t('editor.metadata.xmpConflicts.resolving')
                                    : t('editor.metadata.xmpConflicts.apply')}
                                </button>
                              )}
                            </div>
                            {isCheckingXmpConflicts && !xmpConflictReport ? (
                              <UiText variant={TextVariants.small} color={TextColors.secondary}>
                                {t('editor.metadata.xmpConflicts.checking')}
                              </UiText>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <UiText variant={TextVariants.small} color={TextColors.secondary}>
                                  {t('editor.metadata.xmpConflicts.description')}
                                </UiText>
                                {xmpConflictReport?.fields.map((field) => {
                                  const selectedChoice =
                                    xmpConflictDecisions[field.field] ??
                                    (field.field === 'keywords' ? 'merge' : 'external');
                                  const choices: XmpMetadataConflictChoice[] =
                                    field.merged === undefined ? ['local', 'external'] : ['local', 'external', 'merge'];

                                  return (
                                    <div
                                      key={field.field}
                                      className="rounded-md border border-surface bg-bg-primary/80 p-2"
                                      data-xmp-conflict-field={field.field}
                                    >
                                      <div className="mb-2 grid grid-cols-[80px_1fr] gap-2 text-xs">
                                        <UiText variant={TextVariants.small} color={TextColors.primary}>
                                          {field.label}
                                        </UiText>
                                        <div className="min-w-0 space-y-1 text-text-secondary">
                                          <div className="truncate">
                                            {t('editor.metadata.xmpConflicts.local')}:{' '}
                                            {formatConflictValue(field.local)}
                                          </div>
                                          <div className="truncate">
                                            {t('editor.metadata.xmpConflicts.external')}:{' '}
                                            {formatConflictValue(field.external)}
                                          </div>
                                          {field.merged !== undefined && (
                                            <div className="truncate">
                                              {t('editor.metadata.xmpConflicts.merge')}:{' '}
                                              {formatConflictValue(field.merged)}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {choices.map((choice) => (
                                          <button
                                            key={choice}
                                            type="button"
                                            onClick={() => {
                                              setXmpConflictDecisions((current) => ({
                                                ...current,
                                                [field.field]: choice,
                                              }));
                                            }}
                                            className={cx(
                                              'rounded px-2 py-1 text-xs font-medium transition-colors',
                                              selectedChoice === choice
                                                ? 'bg-accent text-bg-primary'
                                                : 'bg-bg-secondary text-text-secondary hover:text-text-primary',
                                            )}
                                          >
                                            {xmpChoiceLabel(choice, t)}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        <div>
                          <UiText
                            variant={TextVariants.small}
                            color={TextColors.primary}
                            weight={TextWeights.semibold}
                            className="uppercase tracking-wider mb-2 block"
                          >
                            {t('editor.metadata.organization.rating')}
                          </UiText>
                          <div className="flex items-center gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                onClick={() => {
                                  handleRate(star, targetPaths);
                                }}
                                className="focus:outline-hidden transition-transform active:scale-95 hover:scale-110"
                              >
                                <Star
                                  size={20}
                                  className={cx(
                                    'transition-colors duration-200',
                                    star <= rating
                                      ? 'fill-accent text-accent'
                                      : 'fill-transparent text-text-secondary hover:text-text-primary',
                                  )}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <UiText
                            variant={TextVariants.small}
                            color={TextColors.primary}
                            weight={TextWeights.semibold}
                            className="uppercase tracking-wider mb-2 block"
                          >
                            {t('editor.metadata.organization.colorLabel')}
                          </UiText>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                void handleSetColorLabel(null, targetPaths);
                              }}
                              className={cx(
                                'w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110',
                                currentColor === null
                                  ? 'ring-2 ring-text-secondary ring-offset-1 ring-offset-bg-primary'
                                  : 'opacity-50 hover:opacity-100 hover:ring-2 hover:ring-text-secondary/20',
                              )}
                              data-tooltip={t('editor.metadata.organization.none')}
                            >
                              <X size={12} className="text-text-tertiary" />
                            </button>
                            {COLOR_LABELS.map((color: Color) => (
                              <button
                                key={color.name}
                                onClick={() => {
                                  void handleSetColorLabel(color.name, targetPaths);
                                }}
                                className={cx(
                                  'w-5 h-5 rounded-full transition-all hover:scale-110',
                                  currentColor === color.name
                                    ? 'ring-2 ring-white ring-offset-1 ring-offset-bg-primary'
                                    : 'hover:ring-2 hover:ring-white/20',
                                )}
                                style={{ backgroundColor: color.color }}
                                data-tooltip={color.name}
                              >
                                {currentColor === color.name && <Check size={12} className="text-black/50 mx-auto" />}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <UiText
                            variant={TextVariants.small}
                            color={TextColors.primary}
                            weight={TextWeights.semibold}
                            className="uppercase tracking-wider mb-2 block"
                          >
                            {t('editor.metadata.organization.tags')}
                          </UiText>
                          <div className="flex flex-wrap gap-1 mb-2">
                            <AnimatePresence>
                              {currentTags.length > 0 ? (
                                currentTags.map((tagItem) => (
                                  <motion.div
                                    key={tagItem.tag}
                                    layout
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    className="flex items-center gap-1 bg-bg-primary px-2 py-1 rounded-md group cursor-pointer border border-surface hover:border-text-tertiary/50 transition-colors"
                                    onClick={() => {
                                      void handleRemoveTag(tagItem);
                                    }}
                                  >
                                    <UiText
                                      as="span"
                                      variant={TextVariants.small}
                                      color={TextColors.primary}
                                      weight={TextWeights.medium}
                                    >
                                      {tagItem.tag}
                                    </UiText>
                                    <X size={10} className="opacity-50 group-hover:opacity-100" />
                                  </motion.div>
                                ))
                              ) : (
                                <UiText variant={TextVariants.small} className="italic text-text-secondary">
                                  {t('editor.metadata.organization.noTags')}
                                </UiText>
                              )}
                            </AnimatePresence>
                          </div>

                          <div
                            className={cx(
                              'flex items-center bg-bg-primary border rounded-md px-2 py-1.5 transition-colors',
                              isTagInputFocused ? 'border-accent' : 'border-surface',
                            )}
                          >
                            <input
                              type="text"
                              value={tagInputValue}
                              onChange={(e) => {
                                setTagInputValue(e.target.value);
                              }}
                              onKeyDown={handleTagInputKeyDown}
                              onFocus={() => {
                                setIsTagInputFocused(true);
                              }}
                              onBlur={() => {
                                setIsTagInputFocused(false);
                              }}
                              placeholder={t('editor.metadata.organization.addTagPlaceholder')}
                              className="bg-transparent border-none outline-hidden text-xs w-full text-text-primary placeholder-text-tertiary"
                            />
                            <button
                              onClick={() => {
                                void handleAddTag(tagInputValue);
                              }}
                              disabled={!tagInputValue.trim()}
                              className="text-text-secondary hover:text-accent disabled:opacity-30 transition-colors"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          {appSettings?.taggingShortcuts && appSettings.taggingShortcuts.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {appSettings.taggingShortcuts.map((shortcut) => (
                                <button
                                  key={shortcut}
                                  onClick={() => {
                                    void handleAddTag(shortcut);
                                  }}
                                  className="text-xs font-medium bg-bg-secondary hover:bg-card-active text-text-secondary px-1.5 py-0.5 rounded-sm border border-transparent hover:border-border-color transition-all"
                                >
                                  {shortcut}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {gpsCoordinates && (
              <div>
                <UiText variant={TextVariants.heading} className="mb-3">
                  {t('editor.metadata.gps.title')}
                </UiText>
                <div className="bg-surface border border-surface rounded-xl p-3 flex flex-col gap-3">
                  <div className="relative rounded-md overflow-hidden shadow-sm">
                    <iframe
                      className="pointer-events-none h-[180px] w-full border-0"
                      loading="lazy"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${gpsCoordinates.lon - 0.01}%2C${
                        gpsCoordinates.lat - 0.01
                      }%2C${gpsCoordinates.lon + 0.01}%2C${gpsCoordinates.lat + 0.01}&layer=mapnik&marker=${
                        gpsCoordinates.lat
                      }%2C${gpsCoordinates.lon}`}
                      title={t('editor.metadata.gps.title')}
                    ></iframe>
                    <a
                      aria-label={t('editor.metadata.gps.clickToOpenTooltip')}
                      className="absolute inset-0 cursor-pointer hover:bg-black/10 transition-colors"
                      href={`https://www.openstreetmap.org/?mlat=${gpsCoordinates.lat}&mlon=${gpsCoordinates.lon}#map=15/${gpsCoordinates.lat}/${gpsCoordinates.lon}`}
                      rel="noopener noreferrer"
                      target="_blank"
                      data-tooltip={t('editor.metadata.gps.clickToOpenTooltip')}
                    ></a>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <MetadataItem label={t('editor.metadata.gps.latitude')} value={gpsCoordinates.lat.toFixed(6)} />
                    <MetadataItem label={t('editor.metadata.gps.longitude')} value={gpsCoordinates.lon.toFixed(6)} />
                    {gpsData.altitude && (
                      <MetadataItem label={t('editor.metadata.gps.altitude')} value={`${gpsData.altitude} m`} />
                    )}
                  </div>
                </div>
              </div>
            )}

            {otherExifEntries.length > 0 && (
              <div>
                <UiText variant={TextVariants.heading} className="mb-3">
                  {t('editor.metadata.extendedExif.title')}
                </UiText>
                <div className="bg-surface border border-surface rounded-xl p-3 flex flex-col gap-0.5 overflow-hidden">
                  {otherExifEntries.map(([tag, value]) => (
                    <MetadataItem key={tag} label={formatExifTag(tag)} value={value} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <UiText
            variant={TextVariants.heading}
            color={TextColors.secondary}
            weight={TextWeights.normal}
            className="text-center mt-4"
          >
            {t('editor.ai.noImageSelected')}
          </UiText>
        )}
      </div>
    </div>
  );
}
