import cx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, ChevronDown, ChevronRight, GitMerge, Plus, Star, Tag, X, User } from 'lucide-react';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useLibraryActions } from '../../../hooks/useLibraryActions';
import { useManagedFocus } from '../../../hooks/useManagedFocus';
import { emptyTauriResponseSchema } from '../../../schemas/tauriResponseSchemas';
import {
  type XmpMetadataConflictChoice,
  type XmpMetadataConflictDecision,
  type XmpMetadataConflictReport,
  xmpMetadataConflictReportSchema,
} from '../../../schemas/xmpMetadataConflictSchemas';
import { useEditorStore } from '../../../store/useEditorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { useProcessStore } from '../../../store/useProcessStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { TextColors, TextVariants, TextWeights } from '../../../types/typography';
import { COLOR_LABELS, type Color } from '../../../utils/adjustments';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import { Invokes } from '../../ui/AppProperties';
import UiText from '../../ui/Text';
import { IconAperture, IconShutter, IconIso, IconFocalLength, IconLens } from '../editor/ExifIcons';

import type { TFunction } from 'i18next';

interface CameraSetting {
  format?(value: MetadataValue): string | number;
  label: string;
}

type CameraSettingKey = 'ExposureTime' | 'FNumber' | 'FocalLengthIn35mmFilm' | 'LensModel' | 'PhotographicSensitivity';

type CameraSettings = Record<CameraSettingKey, CameraSetting>;

type MetadataValue = string | number | null | undefined;

type ExifData = Record<string, MetadataValue>;
type ConflictDecisions = Partial<Record<XmpMetadataConflictDecision['field'], XmpMetadataConflictChoice>>;

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

function formatExifTag(str: string) {
  if (!str) return '';
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
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

const EDITABLE_FIELDS = [
  { key: 'ImageDescription', label: 'title' },
  { key: 'Artist', label: 'author' },
  { key: 'Copyright', label: 'copyright' },
  { key: 'UserComment', label: 'comments' },
] as const;

const EDITABLE_FIELD_LABEL_FALLBACKS: Record<(typeof EDITABLE_FIELDS)[number]['label'], string> = {
  author: 'Author',
  comments: 'Comments',
  copyright: 'Copyright',
  title: 'Title',
};

const KEY_CAMERA_SETTINGS_MAP: CameraSettings = {
  FNumber: {
    format: (value: MetadataValue) => {
      const fStr = String(value);
      return fStr.toLowerCase().startsWith('f') ? fStr : `f/${fStr}`;
    },
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
    format: (value: MetadataValue) => (String(value).endsWith('mm') ? String(value) : `${String(value)} mm`),
    label: 'Focal Length',
  },
  LensModel: {
    format: (value: MetadataValue) => String(value).replace(/"/g, ''),
    label: 'Lens',
  },
};

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

  const rating = selectedImage ? imageRatings[selectedImage.path] || 0 : 0;
  const tags = useMemo(
    () => (selectedImage ? imageList.find((img) => img.path === selectedImage.path)?.tags || [] : []),
    [imageList, selectedImage],
  );
  const liveThumbnailUrl = selectedImage ? thumbnails[selectedImage.path] : undefined;

  const targetPaths = multiSelectedPaths.length > 0 ? multiSelectedPaths : selectedImage ? [selectedImage.path] : [];

  const { cameraGridSettings, lensSetting, gpsData, otherExifEntries } = useMemo(() => {
    const exif = (selectedImage?.exif || {}) as ExifData;

    const cameraGridKeys: CameraSettingKey[] = [
      'ExposureTime',
      'FNumber',
      'PhotographicSensitivity',
      'FocalLengthIn35mmFilm',
    ];
    const cameraGridSettings: CameraGridSetting[] = cameraGridKeys.map((key) => {
      const value = exif[key];
      const hasValue = value !== undefined && value !== null && value !== '';

      const translatedLabel =
        key === 'FNumber'
          ? t('editor.metadata.camera.aperture')
          : key === 'ExposureTime'
            ? t('editor.metadata.camera.shutterSpeed')
            : key === 'PhotographicSensitivity'
              ? t('editor.metadata.camera.iso')
              : key === 'FocalLengthIn35mmFilm'
                ? t('editor.metadata.camera.focalLength')
                : '';

      const cameraSetting = KEY_CAMERA_SETTINGS_MAP[key];
      return {
        key: key,
        label: translatedLabel,
        value: hasValue && cameraSetting.format ? cameraSetting.format(value) : hasValue ? value : '-',
      };
    });

    const lensValue = exif['LensModel'];
    const hasLensValue = lensValue !== undefined && lensValue !== null && lensValue !== '';
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

    const handledKeys = [...cameraGridKeys, 'LensModel', ...EDITABLE_FIELDS.map((f) => f.key)];
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
  const populatedCameraFieldCount = cameraGridSettings.filter((setting) => setting.value !== '-').length;
  const editableMetadataFieldCount = EDITABLE_FIELDS.length;

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
        setXmpConflictDecisions(
          Object.fromEntries(
            result.fields.map((field) => [field.field, field.field === 'keywords' ? 'merge' : 'external']),
          ),
        );
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
              data-camera-field-count={populatedCameraFieldCount}
              data-editable-field-count={editableMetadataFieldCount}
              data-gps-ready={String(gpsCoordinates !== null)}
              data-selection-count={targetPaths.length}
              data-testid="metadata-readiness-summary"
            >
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {t('editor.metadata.readiness.selectionCount', { count: targetPaths.length })}
              </UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {t('editor.metadata.readiness.cameraFields', { count: populatedCameraFieldCount })}
              </UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {gpsCoordinates === null
                  ? t('editor.metadata.readiness.gpsMissing')
                  : t('editor.metadata.readiness.gpsReady')}
              </UiText>
              <UiText
                as="span"
                variant={TextVariants.small}
                className="rounded bg-bg-primary px-2 py-1 text-text-secondary"
              >
                {t('editor.metadata.readiness.editableFields', { count: editableMetadataFieldCount })}
              </UiText>
            </section>
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
                        {EDITABLE_FIELDS.map((field) => {
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
