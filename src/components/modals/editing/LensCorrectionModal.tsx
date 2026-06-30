import { invoke } from '@tauri-apps/api/core';
import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Check,
  CircleDashed,
  Eye,
  EyeOff,
  Info,
  Loader,
  Maximize,
  RotateCcw,
  SquareDashed,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useModalTransition } from '../../../hooks/ui/useModalTransition';
import { usePreviewViewport } from '../../../hooks/viewport/usePreviewViewport';
import { Invokes } from '../../../tauri/commands';
import { TextColors, TextVariants } from '../../../types/typography';
import type { Adjustments } from '../../../utils/adjustments';
import { throttle } from '../../../utils/timing';
import type { SelectedImage } from '../../ui/AppProperties';
import Button from '../../ui/Button';
import Dropdown from '../../ui/Dropdown';
import Slider from '../../ui/Slider';
import Switch from '../../ui/Switch';
import UiText from '../../ui/Text';

interface GeometryParams {
  distortion: number;
  vertical: number;
  horizontal: number;
  rotate: number;
  aspect: number;
  scale: number;
  x_offset: number;
  y_offset: number;
  lens_distortion_amount: number;
  lens_vignette_amount: number;
  lens_tca_amount: number;
  lens_dist_k1: number;
  lens_dist_k2: number;
  lens_dist_k3: number;
  lens_model: number;
  tca_vr: number;
  tca_vb: number;
  vig_k1: number;
  vig_k2: number;
  vig_k3: number;
  lens_distortion_enabled: boolean;
  lens_tca_enabled: boolean;
  lens_vignette_enabled: boolean;
}

interface MyLens {
  maker: string;
  model: string;
}

interface LensDistortionParams {
  k1: number;
  k2: number;
  k3: number;
  model: number;
  tca_vr: number;
  tca_vb: number;
  vig_k1: number;
  vig_k2: number;
  vig_k3: number;
}

interface LensParams {
  lensCorrectionMode: 'auto' | 'manual';
  lensMaker: string | null;
  lensModel: string | null;
  lensDistortionAmount: number;
  lensVignetteAmount: number;
  lensTcaAmount: number;
  lensDistortionEnabled: boolean;
  lensTcaEnabled: boolean;
  lensVignetteEnabled: boolean;
  lensDistortionParams: LensDistortionParams | null;
}

interface LensSettings {
  myLenses?: Array<MyLens>;
}

type ExifData = Record<string, string | number | null | undefined>;

interface LensCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (newParams: LensParams) => void;
  currentAdjustments: Adjustments;
  selectedImage: SelectedImage | null;
}

const DEFAULT_PARAMS: LensParams = {
  lensCorrectionMode: 'manual',
  lensMaker: null,
  lensModel: null,
  lensDistortionAmount: 100,
  lensVignetteAmount: 100,
  lensTcaAmount: 100,
  lensDistortionEnabled: true,
  lensTcaEnabled: true,
  lensVignetteEnabled: true,
  lensDistortionParams: null,
};

const parseFocalLength = (exif: ExifData | null | undefined): number | null => {
  const focalLength = exif?.['FocalLength'];
  if (!focalLength) return null;
  const val = parseFloat(String(focalLength));
  return isNaN(val) ? null : val;
};

const parseAperture = (exif: ExifData | null | undefined): number | null => {
  const fNumber = exif?.['FNumber'];
  if (!fNumber) return null;
  const val = parseFloat(String(fNumber));
  return isNaN(val) ? null : val;
};

const parseDistance = (exif: ExifData | null | undefined): number | null => {
  const subjectDistance = exif?.['SubjectDistance'];
  if (!subjectDistance) return null;
  const val = parseFloat(String(subjectDistance));
  return isNaN(val) ? null : val;
};

const SLIDER_DIVISOR = 100.0;

export default function LensCorrectionModal({
  isOpen,
  onClose,
  onApply,
  currentAdjustments,
  selectedImage,
}: LensCorrectionModalProps) {
  const { t } = useTranslation();
  const [params, setParams] = useState<LensParams>(DEFAULT_PARAMS);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [makers, setMakers] = useState<string[]>([]);
  const [lenses, setLenses] = useState<string[]>([]);
  const [myLenses, setMyLenses] = useState<MyLens[]>([]);
  const { isMounted, show } = useModalTransition(isOpen);
  const [detectionStatus, setDetectionStatus] = useState<'idle' | 'detecting' | 'not_found' | 'success'>('idle');

  const [isCompareActive, setIsCompareActive] = useState(false);
  const { containerRef, handleMouseDown, handleResetZoom, handleWheel, imageTransformStyle, zoom, zoomIn, zoomOut } =
    usePreviewViewport({ maxZoom: 8, minZoom: 0.1, zoomStep: 0.25 });

  const [modeBubbleStyle, setModeBubbleStyle] = useState({});
  const isModeInitialAnimation = useRef(true);

  const selectedExif = selectedImage?.exif as ExifData | null | undefined;
  const focalLength = useMemo(() => parseFocalLength(selectedExif), [selectedExif]);
  const aperture = useMemo(() => parseAperture(selectedExif), [selectedExif]);
  const distance = useMemo(() => parseDistance(selectedExif), [selectedExif]);

  const availability = useMemo(() => {
    if (!params.lensDistortionParams) return { distortion: false, tca: false, vignetting: false };
    const p = params.lensDistortionParams;
    return {
      distortion: Math.abs(p.k1) > 1e-6 || Math.abs(p.k2) > 1e-6 || Math.abs(p.k3) > 1e-6,
      tca: Math.abs(p.tca_vr - 1.0) > 1e-5 || Math.abs(p.tca_vb - 1.0) > 1e-5,
      vignetting: Math.abs(p.vig_k1) > 1e-6 || Math.abs(p.vig_k2) > 1e-6 || Math.abs(p.vig_k3) > 1e-6,
    };
  }, [params.lensDistortionParams]);

  useEffect(() => {
    const selectedIndex = params.lensCorrectionMode === 'auto' ? 0 : 1;
    const targetX = `${selectedIndex * 100}%`;
    const targetWidth = '50%';

    if (isModeInitialAnimation.current) {
      const initialX = params.lensCorrectionMode === 'manual' ? '100%' : '-25%';
      setModeBubbleStyle({
        x: [initialX, targetX],
        width: targetWidth,
      });
      isModeInitialAnimation.current = false;
    } else {
      setModeBubbleStyle({
        x: targetX,
        width: targetWidth,
      });
    }
  }, [params.lensCorrectionMode]);

  const fetchDistortionParams = async (maker: string, model: string): Promise<LensDistortionParams | null> => {
    try {
      return await invoke<LensDistortionParams | null>(Invokes.GetLensDistortionParams, {
        maker,
        model,
        focalLength: focalLength,
        aperture: aperture,
        distance: distance,
      });
    } catch (error) {
      console.error('Failed to fetch lens params', error);
      return null;
    }
  };

  const updatePreview = useMemo(
    () =>
      throttle(async (currentParams: LensParams) => {
        try {
          const fullParams: GeometryParams = {
            distortion: currentAdjustments.transformDistortion,
            vertical: currentAdjustments.transformVertical,
            horizontal: currentAdjustments.transformHorizontal,
            rotate: currentAdjustments.transformRotate,
            aspect: currentAdjustments.transformAspect,
            scale: currentAdjustments.transformScale,
            x_offset: currentAdjustments.transformXOffset,
            y_offset: currentAdjustments.transformYOffset,

            lens_distortion_amount: currentParams.lensDistortionAmount / SLIDER_DIVISOR,
            lens_vignette_amount: currentParams.lensVignetteAmount / SLIDER_DIVISOR,
            lens_tca_amount: currentParams.lensTcaAmount / SLIDER_DIVISOR,

            lens_distortion_enabled: currentParams.lensDistortionEnabled,
            lens_vignette_enabled: currentParams.lensVignetteEnabled,
            lens_tca_enabled: currentParams.lensTcaEnabled,

            lens_dist_k1: currentParams.lensDistortionParams?.k1 ?? 0,
            lens_dist_k2: currentParams.lensDistortionParams?.k2 ?? 0,
            lens_dist_k3: currentParams.lensDistortionParams?.k3 ?? 0,
            lens_model: currentParams.lensDistortionParams?.model ?? 0,
            tca_vr: currentParams.lensDistortionParams?.tca_vr ?? 1.0,
            tca_vb: currentParams.lensDistortionParams?.tca_vb ?? 1.0,
            vig_k1: currentParams.lensDistortionParams?.vig_k1 ?? 0,
            vig_k2: currentParams.lensDistortionParams?.vig_k2 ?? 0,
            vig_k3: currentParams.lensDistortionParams?.vig_k3 ?? 0,
          };

          const result: string = await invoke(Invokes.PreviewGeometryTransform, {
            params: fullParams,
            jsAdjustments: currentAdjustments,
            showLines: false,
          });
          setPreviewUrl(result);
        } catch (e) {
          console.error('Lens correction preview failed', e);
        }
      }, 50),
    [currentAdjustments],
  );

  useEffect(() => {
    if (isOpen) {
      void invoke<LensSettings>(Invokes.LoadSettings)
        .then((settings) => {
          if (settings.myLenses) {
            setMyLenses(settings.myLenses);
          }
        })
        .catch(console.error);

      const initParams: LensParams = {
        lensCorrectionMode: currentAdjustments.lensCorrectionMode,
        lensMaker: currentAdjustments.lensMaker,
        lensModel: currentAdjustments.lensModel,
        lensDistortionAmount: currentAdjustments.lensDistortionAmount,
        lensVignetteAmount: currentAdjustments.lensVignetteAmount,
        lensTcaAmount: currentAdjustments.lensTcaAmount,
        lensDistortionEnabled: currentAdjustments.lensDistortionEnabled,
        lensTcaEnabled: currentAdjustments.lensTcaEnabled,
        lensVignetteEnabled: currentAdjustments.lensVignetteEnabled,
        lensDistortionParams: currentAdjustments.lensDistortionParams,
      };

      const timer = window.setTimeout(() => {
        setParams(initParams);
        setDetectionStatus('idle');
        handleResetZoom();
        updatePreview(initParams);
      }, 0);

      void invoke<Array<string>>(Invokes.GetLensfunMakers)
        .then((m) => {
          setMakers(m);
        })
        .catch(console.error);

      if (initParams.lensMaker) {
        void invoke<Array<string>>(Invokes.GetLensfunLensesForMaker, { maker: initParams.lensMaker })
          .then((l) => {
            setLenses(l);
          })
          .catch(console.error);
      }

      return () => {
        window.clearTimeout(timer);
      };
    }

    const timer = window.setTimeout(() => {
      setPreviewUrl(null);
      setIsApplying(false);
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, currentAdjustments, handleResetZoom, updatePreview]);

  const handleMakerChange = (maker: string) => {
    const newParams = {
      ...params,
      lensMaker: maker,
      lensModel: null,
      lensDistortionParams: null,
    };
    setParams(newParams);
    setLenses([]);
    setDetectionStatus('idle');

    void invoke<Array<string>>(Invokes.GetLensfunLensesForMaker, { maker })
      .then((l) => {
        setLenses(l);
      })
      .catch(console.error);

    updatePreview(newParams);
  };

  const handleModelChange = async (model: string) => {
    const tempParams = { ...params, lensModel: model };
    setParams(tempParams);
    setDetectionStatus('idle');

    if (params.lensMaker) {
      const distortionParams = await fetchDistortionParams(params.lensMaker, model);
      const finalParams = { ...tempParams, lensDistortionParams: distortionParams };
      setParams(finalParams);
      updatePreview(finalParams);
    }
  };

  const handleMyLensSelect = async (val: string) => {
    if (!val || val === 'none') return;
    const index = parseInt(val);
    const selected = myLenses[index];
    if (!selected) return;

    const tempParams = { ...params, lensMaker: selected.maker, lensModel: selected.model };
    setParams(tempParams);
    setDetectionStatus('idle');

    void invoke<Array<string>>(Invokes.GetLensfunLensesForMaker, { maker: selected.maker })
      .then((l) => {
        setLenses(l);
      })
      .catch(console.error);

    const distortionParams = await fetchDistortionParams(selected.maker, selected.model);
    const finalParams = { ...tempParams, lensDistortionParams: distortionParams };
    setParams(finalParams);
    updatePreview(finalParams);
  };

  const handleAmountChange = (key: keyof LensParams, amount: number) => {
    const newParams = { ...params, [key]: amount };
    setParams(newParams);
    updatePreview(newParams);
  };

  const handleToggleChange = (key: keyof LensParams, val: boolean) => {
    const newParams = { ...params, [key]: val };
    setParams(newParams);
    updatePreview(newParams);
  };

  const handleAutoDetect = async () => {
    if (!selectedImage?.exif) {
      setDetectionStatus('not_found');
      return;
    }
    const exifMaker = selectedImage.exif.Make || '';
    const exifModel = selectedImage.exif.LensModel || '';

    if (!exifModel) {
      setDetectionStatus('not_found');
      return;
    }

    setDetectionStatus('detecting');

    try {
      const result = await invoke<[string, string] | null>(Invokes.AutodetectLens, {
        maker: exifMaker,
        model: exifModel,
      });

      if (result) {
        const [detectedMaker, detectedModel] = result;

        void invoke<Array<string>>(Invokes.GetLensfunLensesForMaker, { maker: detectedMaker })
          .then((l) => {
            setLenses(l);
          })
          .catch(console.error);

        const distortionParams = await fetchDistortionParams(detectedMaker, detectedModel);

        setParams((prev) => {
          const newParams = {
            ...prev,
            lensMaker: detectedMaker,
            lensModel: detectedModel,
            lensDistortionParams: distortionParams,
          };
          updatePreview(newParams);
          return newParams;
        });

        setDetectionStatus('success');

        setTimeout(() => {
          setDetectionStatus('idle');
        }, 2000);
      } else {
        setParams((prev) => {
          const clearedParams = {
            ...prev,
            lensMaker: null,
            lensModel: null,
            lensDistortionParams: null,
          };
          updatePreview(clearedParams);
          return clearedParams;
        });
        setDetectionStatus('not_found');
      }
    } catch (error) {
      console.error('Autodetection failed with error:', error);
      setDetectionStatus('not_found');
    }
  };

  const handleApply = () => {
    setIsApplying(true);
    onApply(params);
    onClose();
  };

  const handleReset = () => {
    const resetParams = {
      ...DEFAULT_PARAMS,
      lensDistortionEnabled: true,
      lensTcaEnabled: true,
      lensVignetteEnabled: true,
    };
    setParams(resetParams);
    setLenses([]);
    setDetectionStatus('idle');
    updatePreview(resetParams);
  };

  const toggleCompare = (active: boolean) => {
    setIsCompareActive(active);
    if (active) {
      const fullParams: GeometryParams = {
        distortion: currentAdjustments.transformDistortion,
        vertical: currentAdjustments.transformVertical,
        horizontal: currentAdjustments.transformHorizontal,
        rotate: currentAdjustments.transformRotate,
        aspect: currentAdjustments.transformAspect,
        scale: currentAdjustments.transformScale,
        x_offset: currentAdjustments.transformXOffset,
        y_offset: currentAdjustments.transformYOffset,

        lens_distortion_amount: currentAdjustments.lensDistortionAmount / SLIDER_DIVISOR,
        lens_vignette_amount: currentAdjustments.lensVignetteAmount / SLIDER_DIVISOR,
        lens_tca_amount: currentAdjustments.lensTcaAmount / SLIDER_DIVISOR,

        lens_distortion_enabled: false,
        lens_vignette_enabled: false,
        lens_tca_enabled: false,

        lens_dist_k1: currentAdjustments.lensDistortionParams?.k1 ?? 0,
        lens_dist_k2: currentAdjustments.lensDistortionParams?.k2 ?? 0,
        lens_dist_k3: currentAdjustments.lensDistortionParams?.k3 ?? 0,
        lens_model: currentAdjustments.lensDistortionParams?.model ?? 0,
        tca_vr: currentAdjustments.lensDistortionParams?.tca_vr ?? 1.0,
        tca_vb: currentAdjustments.lensDistortionParams?.tca_vb ?? 1.0,
        vig_k1: currentAdjustments.lensDistortionParams?.vig_k1 ?? 0,
        vig_k2: currentAdjustments.lensDistortionParams?.vig_k2 ?? 0,
        vig_k3: currentAdjustments.lensDistortionParams?.vig_k3 ?? 0,
      };

      void invoke<string>(Invokes.PreviewGeometryTransform, {
        params: fullParams,
        jsAdjustments: currentAdjustments,
        showLines: false,
      })
        .then((result) => {
          setPreviewUrl(result);
        })
        .catch(console.error);
    } else {
      updatePreview(params);
    }
  };

  const makerOptions = makers.map((m) => ({ label: m, value: m }));
  const lensOptions = lenses.map((m) => ({ label: m, value: m }));

  const myLensOptions = useMemo(() => {
    if (myLenses.length === 0) {
      return [{ label: t('modals.lensCorrection.manageLensesPlaceholder'), value: 'none' }];
    }
    return myLenses.map((l, i) => ({
      label: `${l.maker} - ${l.model}`,
      value: i.toString(),
    }));
  }, [myLenses, t]);

  const handleModeChange = (mode: 'auto' | 'manual') => {
    const newParams = { ...params, lensCorrectionMode: mode };
    setParams(newParams);

    if (mode === 'auto') {
      void handleAutoDetect();
    } else {
      updatePreview(newParams);
    }
  };

  const renderControls = () => (
    <div className="modal-adjustments-pane w-80 shrink-0 bg-bg-secondary flex flex-col border-l border-surface h-full z-10">
      <div className="p-4 flex justify-between items-center shrink-0 border-b border-surface">
        <UiText variant={TextVariants.title}>{t('modals.lensCorrection.title')}</UiText>
        <button
          onClick={handleReset}
          data-tooltip={t('modals.lensCorrection.resetTooltip')}
          className="p-2 rounded-full hover:bg-surface transition-colors"
        >
          <RotateCcw size={18} />
        </button>
      </div>
      <div className="grow overflow-y-auto p-4 flex flex-col gap-6 text-text-secondary">
        <div className="w-full p-2 bg-card-active rounded-md">
          <div className="relative flex w-full">
            <motion.div
              className="absolute top-0 bottom-0 z-0 bg-accent"
              style={{ borderRadius: 6 }}
              animate={modeBubbleStyle}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
            />
            <button
              onClick={() => {
                handleModeChange('auto');
              }}
              className={cx(
                'relative flex-1 flex items-center justify-center gap-2 px-3 p-1.5 text-sm font-medium rounded-md transition-colors',
                params.lensCorrectionMode === 'auto' ? 'text-button-text' : 'text-text-primary hover:bg-surface',
              )}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="relative z-10 flex items-center">{t('modals.lensCorrection.modeAuto')}</span>
            </button>
            <button
              onClick={() => {
                handleModeChange('manual');
              }}
              className={cx(
                'relative flex-1 flex items-center justify-center gap-2 px-3 p-1.5 text-sm font-medium rounded-md transition-colors',
                params.lensCorrectionMode === 'manual' ? 'text-button-text' : 'text-text-primary hover:bg-surface',
              )}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <span className="relative z-10 flex items-center">{t('modals.lensCorrection.modeManual')}</span>
            </button>
          </div>
        </div>

        {params.lensCorrectionMode === 'auto' ? (
          <div>
            <UiText variant={TextVariants.heading} className="mb-2">
              {t('modals.lensCorrection.autoDetectStatus')}
            </UiText>
            <div className="space-y-3">
              <div
                className={cx(
                  'w-full flex items-center justify-center gap-2 px-3 py-3 text-sm font-semibold rounded-md border',
                  detectionStatus === 'not_found'
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : params.lensMaker
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-surface text-text-secondary border-surface',
                )}
              >
                {detectionStatus === 'detecting' ? (
                  <>
                    <Loader size={16} className="animate-spin" /> {t('modals.lensCorrection.detectingExif')}
                  </>
                ) : detectionStatus === 'not_found' ? (
                  t('modals.lensCorrection.lensProfileNotFound')
                ) : params.lensMaker && params.lensModel ? (
                  <>
                    <Check size={16} /> {params.lensMaker} - {params.lensModel}
                  </>
                ) : (
                  t('modals.lensCorrection.waitingAutoDetect')
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <UiText variant={TextVariants.heading} className="mb-2">
              {t('modals.lensCorrection.manualSelection')}
            </UiText>
            <div className="space-y-4">
              <Dropdown
                options={myLensOptions}
                value=""
                onChange={(value) => {
                  void handleMyLensSelect(value);
                }}
                placeholder={t('modals.lensCorrection.chooseSavedLens')}
              />
              <Dropdown
                options={makerOptions}
                value={params.lensMaker}
                onChange={(maker) => {
                  handleMakerChange(maker);
                }}
                placeholder={t('modals.lensCorrection.selectManufacturer')}
              />
              {params.lensMaker && (
                <Dropdown
                  options={lensOptions}
                  value={params.lensModel}
                  onChange={(model) => {
                    void handleModelChange(model);
                  }}
                  placeholder={t('modals.lensCorrection.selectLensModel')}
                />
              )}
            </div>
          </div>
        )}

        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.lensCorrection.corrections')}
          </UiText>

          <div className="flex flex-col gap-4">
            <div>
              <div
                className={cx(
                  'flex items-center gap-3 p-2 rounded-md transition-colors',
                  availability.distortion ? 'bg-surface' : 'bg-surface/30',
                )}
              >
                <UiText as="div" className="p-1.5 bg-bg-primary rounded-sm">
                  <SquareDashed size={16} />
                </UiText>
                <Switch
                  className="grow"
                  label={t('modals.lensCorrection.distortion')}
                  checked={params.lensDistortionEnabled && availability.distortion}
                  onChange={(val) => {
                    handleToggleChange('lensDistortionEnabled', val);
                  }}
                  disabled={!availability.distortion}
                />
              </div>
              <AnimatePresence initial={false}>
                {availability.distortion && params.lensDistortionEnabled && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: 'auto', opacity: 1, marginTop: 8 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden px-2"
                  >
                    <Slider
                      label={t('modals.lensCorrection.amount')}
                      value={params.lensDistortionAmount}
                      min={0}
                      max={200}
                      defaultValue={100}
                      step={1}
                      onChange={(e) => {
                        handleAmountChange('lensDistortionAmount', Number(e.target.value));
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div>
              <div
                className={cx(
                  'flex items-center gap-3 p-2 rounded-md transition-colors',
                  availability.tca ? 'bg-surface' : 'bg-surface/30',
                )}
              >
                <UiText as="div" className="p-1.5 bg-bg-primary rounded-sm">
                  <Activity size={16} />
                </UiText>
                <Switch
                  className="grow"
                  label={t('modals.lensCorrection.chromaticAberration')}
                  checked={params.lensTcaEnabled && availability.tca}
                  onChange={(val) => {
                    handleToggleChange('lensTcaEnabled', val);
                  }}
                  disabled={!availability.tca}
                />
              </div>
              <AnimatePresence initial={false}>
                {availability.tca && params.lensTcaEnabled && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: 'auto', opacity: 1, marginTop: 8 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden px-2"
                  >
                    <Slider
                      label={t('modals.lensCorrection.amount')}
                      value={params.lensTcaAmount}
                      min={0}
                      max={200}
                      defaultValue={100}
                      step={1}
                      onChange={(e) => {
                        handleAmountChange('lensTcaAmount', Number(e.target.value));
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div>
              <div
                className={cx(
                  'flex items-center gap-3 p-2 rounded-md transition-colors',
                  availability.vignetting ? 'bg-surface' : 'bg-surface/30',
                )}
              >
                <UiText as="div" className="p-1.5 bg-bg-primary rounded-sm">
                  <CircleDashed size={16} />
                </UiText>
                <Switch
                  className="grow"
                  label={t('modals.lensCorrection.vignetting')}
                  checked={params.lensVignetteEnabled && availability.vignetting}
                  onChange={(val) => {
                    handleToggleChange('lensVignetteEnabled', val);
                  }}
                  disabled={!availability.vignetting}
                />
              </div>
              <AnimatePresence initial={false}>
                {availability.vignetting && params.lensVignetteEnabled && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, marginTop: 0 }}
                    animate={{ height: 'auto', opacity: 1, marginTop: 8 }}
                    exit={{ height: 0, opacity: 0, marginTop: 0 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden px-2"
                  >
                    <Slider
                      label={t('modals.lensCorrection.amount')}
                      value={params.lensVignetteAmount}
                      min={0}
                      max={200}
                      defaultValue={100}
                      step={1}
                      onChange={(e) => {
                        handleAmountChange('lensVignetteAmount', Number(e.target.value));
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="mt-auto space-y-2">
          {currentAdjustments.masks.length > 0 && (
            <UiText
              as="div"
              variant={TextVariants.small}
              className="p-3 bg-surface rounded-md border border-surface flex items-center gap-3"
            >
              <Info size={16} className="shrink-0" />
              <p className="leading-relaxed">{t('modals.lensCorrection.maskWarning')}</p>
            </UiText>
          )}
          <UiText
            as="div"
            variant={TextVariants.small}
            className="p-3 bg-surface rounded-md border border-surface flex items-center gap-3"
          >
            <Info size={16} className="shrink-0" />
            <div className="leading-tight space-y-1">
              <Trans i18nKey="modals.lensCorrection.databaseNotice">
                Lens database provided by the{' '}
                <a
                  href="https://lensfun.github.io/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary transition-colors"
                >
                  Lensfun Project
                </a>{' '}
                (
                <a
                  href="https://creativecommons.org/licenses/by-sa/3.0/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-primary transition-colors"
                >
                  CC BY-SA 3.0
                </a>
                ).
              </Trans>
            </div>
          </UiText>
        </div>
      </div>
    </div>
  );

  const renderContent = () => (
    <div className="modal-preview-adjustments flex flex-row h-full w-full overflow-hidden">
      <div className="modal-preview-pane grow flex flex-col relative min-h-0 bg-[#0f0f0f] overflow-hidden">
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
          role="presentation"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          ></div>

          {previewUrl && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="origin-center" style={imageTransformStyle}>
                <div className="relative inline-block shadow-2xl">
                  <img
                    src={previewUrl}
                    className="block object-contain"
                    style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                    alt={t('modals.lensCorrection.previewAlt')}
                    draggable={false}
                  />
                  {isCompareActive && (
                    <UiText
                      as="div"
                      variant={TextVariants.small}
                      color={TextColors.button}
                      className="absolute top-4 left-4 bg-accent px-2 py-1 rounded-sm shadow-lg z-20"
                    >
                      {t('modals.lensCorrection.original')}
                    </UiText>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/70 backdrop-blur-md p-1.5 rounded-full border border-white/10 shadow-xl z-20 pointer-events-auto"
            role="presentation"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
          >
            <button
              onClick={zoomOut}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.lensCorrection.zoomOutTooltip')}
            >
              <ZoomOut size={18} />
            </button>
            <span className="text-xs font-mono text-white/90 w-12 text-center select-none pointer-events-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.lensCorrection.zoomInTooltip')}
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={handleResetZoom}
              className="p-2 text-white/60 hover:bg-white/10 hover:text-white rounded-full transition-colors"
              data-tooltip={t('modals.lensCorrection.resetZoomTooltip')}
            >
              <Maximize size={16} />
            </button>
            <div className="w-px h-5 bg-white/20 mx-1"></div>
            <button
              onMouseDown={() => {
                toggleCompare(true);
              }}
              onMouseUp={() => {
                toggleCompare(false);
              }}
              onMouseLeave={() => {
                toggleCompare(false);
              }}
              className={cx(
                'p-2 rounded-full transition-colors select-none',
                isCompareActive ? 'bg-accent text-white' : 'text-white/60 hover:bg-white/10 hover:text-white',
              )}
              data-tooltip={t('modals.lensCorrection.compareTooltip')}
            >
              {isCompareActive ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>
      </div>
      {renderControls()}
    </div>
  );

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs transition-opacity duration-300 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="grow min-h-0 overflow-hidden">{renderContent()}</div>
            <div className="shrink-0 p-4 flex justify-end gap-3 border-t border-surface bg-bg-secondary z-20">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
              >
                {t('modals.lensCorrection.cancel')}
              </button>
              <Button onClick={handleApply} disabled={isApplying || !previewUrl}>
                <Check className="mr-2" size={16} /> {t('modals.lensCorrection.apply')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
