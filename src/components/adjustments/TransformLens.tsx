import { invoke } from '@tauri-apps/api/core';
import cx from 'clsx';
import { Aperture, CircleDashed, Loader, SquareDashed, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Invokes } from '../../tauri/commands';
import { TextVariants } from '../../types/typography';
import type { Adjustments } from '../../utils/adjustments';
import { parseExifMetadataNumber } from '../../utils/metadataPanelContracts';
import {
  getLensCorrectionAvailability,
  hasSupportedLensCorrections,
  type LensDistortionParams,
} from '../../utils/transformLensControls';
import type { SelectedImage } from '../ui/AppProperties';
import Dropdown, { type OptionItem } from '../ui/primitives/Dropdown';
import Switch from '../ui/primitives/Switch';
import UiText from '../ui/primitives/Text';
import AdjustmentSlider from './AdjustmentSlider';

type AdjustmentUpdate = Partial<Adjustments> | ((prev: Adjustments) => Adjustments);
type LensCorrectionMode = Adjustments['lensCorrectionMode'];
type ExifData = Record<string, string | number | null | undefined>;
type AutodetectLensResult = [string, string] | { maker: string; model: string };
type DetectionStatus = 'idle' | 'detecting' | 'success' | 'not_found' | 'error';

interface TransformLensProps {
  adjustments: Adjustments;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  selectedImage: SelectedImage | null;
  setAdjustments: (adjustments: AdjustmentUpdate) => void;
}

const DEFAULT_FOCAL_LENGTH_MM = 50;
const statusChipClassName =
  'inline-flex items-center gap-1 rounded border border-editor-border px-1.5 py-0.5 text-[10px]';
const copy = {
  auto: 'Auto',
  autoDetect: 'Auto-detect lens',
  correctionAmount: 'Correction amount',
  detecting: 'Detecting',
  distortionAmount: 'Distortion amount',
  horizontal: 'Horizontal perspective',
  lensHeading: 'Lens correction',
  manual: 'Manual',
  opticalDistortion: 'Optical distortion',
  profileDistortion: 'Profile distortion',
  profileError: 'Profile error',
  profileIdle: 'Profile idle',
  profileNotFound: 'No profile',
  profileReady: 'Profile ready',
  profileTca: 'Chromatic aberration',
  profileVignette: 'Lens vignette',
  rotation: 'Rotation',
  scale: 'Scale',
  selectLens: 'Select lens',
  selectMaker: 'Select maker',
  transformHeading: 'Transform',
  unsupportedProfileField: 'Current lens profile does not provide this correction.',
  vertical: 'Vertical perspective',
  vignetteAmount: 'Vignette amount',
  xOffset: 'X offset',
  yOffset: 'Y offset',
};

const parseExifNumber = (value: string | number | null | undefined): number | null => {
  const parsed = parseExifMetadataNumber(value);
  return parsed.status === 'valid' ? parsed.value : null;
};

const getExifValue = (exif: ExifData | null | undefined, key: string): string | number | null | undefined =>
  exif?.[key];

const normalizeAutodetectLensResult = (value: AutodetectLensResult | null): { maker: string; model: string } | null => {
  if (value === null) return null;
  if (Array.isArray(value)) {
    const [maker, model] = value;
    return maker.length > 0 && model.length > 0 ? { maker, model } : null;
  }
  return value.maker.length > 0 && value.model.length > 0 ? value : null;
};

const toOptions = (values: string[]): Array<OptionItem<string>> => values.map((value) => ({ label: value, value }));

export default function TransformLens({
  adjustments,
  onDragStateChange,
  selectedImage,
  setAdjustments,
}: TransformLensProps) {
  const [makers, setMakers] = useState<string[]>([]);
  const [lenses, setLenses] = useState<string[]>([]);
  const [detectionStatus, setDetectionStatus] = useState<DetectionStatus>('idle');

  const selectedExif = selectedImage?.exif as ExifData | null | undefined;
  const focalLength = useMemo(
    () =>
      parseExifNumber(getExifValue(selectedExif, 'FocalLength') ?? getExifValue(selectedExif, 'FocalLengthIn35mmFilm')),
    [selectedExif],
  );
  const aperture = useMemo(
    () => parseExifNumber(getExifValue(selectedExif, 'FNumber') ?? getExifValue(selectedExif, 'ApertureValue')),
    [selectedExif],
  );
  const distance = useMemo(() => parseExifNumber(getExifValue(selectedExif, 'SubjectDistance')), [selectedExif]);
  const availability = useMemo(
    () => getLensCorrectionAvailability(adjustments.lensDistortionParams),
    [adjustments.lensDistortionParams],
  );
  const hasSupportedLensProfile = hasSupportedLensCorrections(availability);

  useEffect(() => {
    let isMounted = true;
    void invoke<string[]>(Invokes.GetLensfunMakers)
      .then((nextMakers) => {
        if (isMounted) setMakers(nextMakers);
      })
      .catch(() => {
        if (isMounted) setDetectionStatus('error');
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!adjustments.lensMaker) {
      setLenses([]);
      return;
    }

    let isMounted = true;
    void invoke<string[]>(Invokes.GetLensfunLensesForMaker, { maker: adjustments.lensMaker })
      .then((nextLenses) => {
        if (isMounted) setLenses(nextLenses);
      })
      .catch(() => {
        if (isMounted) setLenses([]);
      });
    return () => {
      isMounted = false;
    };
  }, [adjustments.lensMaker]);

  const updateAdjustment = <Key extends keyof Adjustments>(key: Key, value: Adjustments[Key]) => {
    setAdjustments((prev: Adjustments) => ({ ...prev, [key]: value }));
  };

  const fetchDistortionParams = async (maker: string, model: string): Promise<LensDistortionParams | null> =>
    invoke<LensDistortionParams | null>(Invokes.GetLensDistortionParams, {
      aperture,
      distance,
      focalLength: focalLength ?? DEFAULT_FOCAL_LENGTH_MM,
      maker,
      model,
    });

  const applyLensProfile = async (maker: string, model: string, mode: LensCorrectionMode) => {
    try {
      const lensDistortionParams = await fetchDistortionParams(maker, model);
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        lensCorrectionMode: mode,
        lensDistortionParams,
        lensMaker: maker,
        lensModel: model,
      }));
      setDetectionStatus(lensDistortionParams === null ? 'not_found' : 'success');
    } catch (error) {
      setDetectionStatus('error');
      console.error('Failed to apply lens profile', error);
    }
  };

  const handleModeChange = (mode: LensCorrectionMode) => {
    updateAdjustment('lensCorrectionMode', mode);
    if (mode === 'auto') {
      void handleAutoDetect();
    }
  };

  const handleAutoDetect = async () => {
    const exifMaker = String(getExifValue(selectedExif, 'Make') ?? '');
    const exifModel = String(getExifValue(selectedExif, 'LensModel') ?? '');
    if (!exifModel) {
      setDetectionStatus('not_found');
      return;
    }

    setDetectionStatus('detecting');
    try {
      const detected = normalizeAutodetectLensResult(
        await invoke<AutodetectLensResult | null>(Invokes.AutodetectLens, {
          maker: exifMaker,
          model: exifModel,
        }),
      );
      if (detected === null) {
        setAdjustments((prev: Adjustments) => ({
          ...prev,
          lensCorrectionMode: 'auto',
          lensDistortionParams: null,
          lensMaker: null,
          lensModel: null,
        }));
        setDetectionStatus('not_found');
        return;
      }
      await applyLensProfile(detected.maker, detected.model, 'auto');
    } catch (error) {
      setDetectionStatus('error');
      console.error('Failed to detect lens profile', error);
    }
  };

  const handleMakerChange = (maker: string) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      lensCorrectionMode: 'manual',
      lensDistortionParams: null,
      lensMaker: maker,
      lensModel: null,
    }));
    setDetectionStatus('idle');
  };

  const handleModelChange = (model: string) => {
    if (!adjustments.lensMaker) return;
    void applyLensProfile(adjustments.lensMaker, model, 'manual');
  };

  const makerOptions = useMemo(() => toOptions(makers), [makers]);
  const lensOptions = useMemo(() => toOptions(lenses), [lenses]);
  const unsupportedProfileFieldTooltip = copy.unsupportedProfileField;
  const lensModeOptions = useMemo<Array<OptionItem<LensCorrectionMode>>>(
    () => [
      { label: copy.auto, value: 'auto' },
      { label: copy.manual, value: 'manual' },
    ],
    [],
  );
  const detectionLabel =
    detectionStatus === 'detecting'
      ? copy.detecting
      : detectionStatus === 'success'
        ? copy.profileReady
        : detectionStatus === 'not_found'
          ? copy.profileNotFound
          : detectionStatus === 'error'
            ? copy.profileError
            : copy.profileIdle;

  return (
    <div className="space-y-2" data-testid="transform-lens-inspector">
      <section className="space-y-1.5">
        <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
          {copy.transformHeading}
        </UiText>
        <div className="space-y-px">
          <AdjustmentSlider
            density="compact"
            label={copy.vertical}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformVertical', Math.trunc(value));
            }}
            step={1}
            value={adjustments.transformVertical}
          />
          <AdjustmentSlider
            density="compact"
            label={copy.horizontal}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformHorizontal', Math.trunc(value));
            }}
            step={1}
            value={adjustments.transformHorizontal}
          />
          <AdjustmentSlider
            density="compact"
            label={copy.rotation}
            max={45}
            min={-45}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformRotate', value);
            }}
            step={0.1}
            suffix="°"
            value={adjustments.transformRotate}
          />
          <AdjustmentSlider
            density="compact"
            fillOrigin="min"
            label={copy.scale}
            max={150}
            min={50}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformScale', Math.trunc(value));
            }}
            step={1}
            suffix="%"
            value={adjustments.transformScale}
          />
          <AdjustmentSlider
            density="compact"
            label={copy.xOffset}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformXOffset', Math.trunc(value));
            }}
            step={1}
            value={adjustments.transformXOffset}
          />
          <AdjustmentSlider
            density="compact"
            label={copy.yOffset}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformYOffset', Math.trunc(value));
            }}
            step={1}
            value={adjustments.transformYOffset}
          />
          <AdjustmentSlider
            density="compact"
            label={copy.opticalDistortion}
            max={100}
            min={-100}
            onDragStateChange={onDragStateChange}
            onValueChange={(value) => {
              updateAdjustment('transformDistortion', Math.trunc(value));
            }}
            step={1}
            value={adjustments.transformDistortion}
          />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <UiText variant={TextVariants.label} className="text-[11px] font-semibold uppercase text-text-secondary">
            {copy.lensHeading}
          </UiText>
          <span
            className={cx(
              statusChipClassName,
              hasSupportedLensProfile
                ? 'bg-editor-selected-quiet text-text-primary'
                : 'bg-editor-panel text-text-secondary',
            )}
          >
            {detectionStatus === 'detecting' ? <Loader className="animate-spin" size={11} /> : <Aperture size={11} />}
            {detectionLabel}
          </span>
        </div>

        <div className="space-y-1.5 rounded border border-editor-border bg-editor-panel-well p-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Dropdown
              chrome="editor"
              onChange={handleModeChange}
              options={lensModeOptions}
              value={adjustments.lensCorrectionMode}
            />
            <button
              aria-label={copy.autoDetect}
              className="inline-flex h-7 w-8 items-center justify-center rounded border border-editor-border text-text-secondary transition-colors hover:bg-editor-selected-quiet hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-editor-focus-ring disabled:cursor-not-allowed disabled:opacity-45"
              data-tooltip={copy.autoDetect}
              disabled={detectionStatus === 'detecting' || !getExifValue(selectedExif, 'LensModel')}
              onClick={() => {
                void handleAutoDetect();
              }}
              type="button"
            >
              {detectionStatus === 'detecting' ? <Loader className="animate-spin" size={14} /> : <Wand2 size={14} />}
            </button>
          </div>

          {adjustments.lensCorrectionMode === 'manual' && (
            <div className="grid grid-cols-1 gap-1.5">
              <Dropdown
                chrome="editor"
                onChange={handleMakerChange}
                options={makerOptions}
                placeholder={copy.selectMaker}
                value={adjustments.lensMaker}
              />
              <Dropdown
                chrome="editor"
                disabled={!adjustments.lensMaker}
                onChange={handleModelChange}
                options={lensOptions}
                placeholder={copy.selectLens}
                value={adjustments.lensModel}
              />
            </div>
          )}

          {adjustments.lensCorrectionMode === 'auto' && adjustments.lensMaker && adjustments.lensModel && (
            <UiText as="div" variant={TextVariants.small} className="truncate text-[11px] text-text-secondary">
              {adjustments.lensMaker} - {adjustments.lensModel}
            </UiText>
          )}

          <div className="space-y-2">
            <Switch
              checked={adjustments.lensDistortionEnabled && availability.distortion}
              chrome="editor"
              disabled={!availability.distortion}
              label={copy.profileDistortion}
              onChange={(checked) => {
                updateAdjustment('lensDistortionEnabled', checked);
              }}
              {...(availability.distortion ? {} : { tooltip: unsupportedProfileFieldTooltip })}
            />
            <AdjustmentSlider
              density="compact"
              disabled={!availability.distortion || !adjustments.lensDistortionEnabled}
              fillOrigin="min"
              label={
                <span className="inline-flex items-center gap-1">
                  <SquareDashed size={12} />
                  {copy.distortionAmount}
                </span>
              }
              max={200}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('lensDistortionAmount', Math.trunc(value));
              }}
              step={1}
              suffix="%"
              value={adjustments.lensDistortionAmount}
            />

            <Switch
              checked={adjustments.lensTcaEnabled && availability.tca}
              chrome="editor"
              disabled={!availability.tca}
              label={copy.profileTca}
              onChange={(checked) => {
                updateAdjustment('lensTcaEnabled', checked);
              }}
              {...(availability.tca ? {} : { tooltip: unsupportedProfileFieldTooltip })}
            />
            <AdjustmentSlider
              density="compact"
              disabled={!availability.tca || !adjustments.lensTcaEnabled}
              fillOrigin="min"
              label={copy.correctionAmount}
              max={200}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('lensTcaAmount', Math.trunc(value));
              }}
              step={1}
              suffix="%"
              value={adjustments.lensTcaAmount}
            />

            <Switch
              checked={adjustments.lensVignetteEnabled && availability.vignetting}
              chrome="editor"
              disabled={!availability.vignetting}
              label={copy.profileVignette}
              onChange={(checked) => {
                updateAdjustment('lensVignetteEnabled', checked);
              }}
              {...(availability.vignetting ? {} : { tooltip: unsupportedProfileFieldTooltip })}
            />
            <AdjustmentSlider
              density="compact"
              disabled={!availability.vignetting || !adjustments.lensVignetteEnabled}
              fillOrigin="min"
              label={
                <span className="inline-flex items-center gap-1">
                  <CircleDashed size={12} />
                  {copy.vignetteAmount}
                </span>
              }
              max={200}
              min={0}
              onDragStateChange={onDragStateChange}
              onValueChange={(value) => {
                updateAdjustment('lensVignetteAmount', Math.trunc(value));
              }}
              step={1}
              suffix="%"
              value={adjustments.lensVignetteAmount}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
