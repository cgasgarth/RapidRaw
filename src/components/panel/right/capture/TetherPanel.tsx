import {
  AlertTriangle,
  Battery,
  Camera,
  CheckCircle2,
  Crosshair,
  Eye,
  HardDrive,
  Images,
  Pin,
  RefreshCcw,
  Usb,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type TetherCameraControl,
  type TetherCameraControlWriteRequest,
  type TetherCameraControlWriteResponse,
  type TetherCapability,
  type TetherCaptureRequest,
  type TetherCaptureResponse,
  type TetherDiscoveryResponse,
  type TetherSessionOpenRequest,
  type TetherSessionResponse,
  tetherCameraControlWriteResponseSchema,
  tetherCaptureResponseSchema,
  tetherDiscoveryResponseSchema,
  tetherIngestPresetIdSchema,
  tetherMetadataTemplateIdSchema,
  tetherSessionOpenRequestSchema,
  tetherSessionResponseSchema,
} from '../../../../schemas/tetheringSchemas';
import { Invokes } from '../../../../tauri/commands';
import { TextColors, TextVariants } from '../../../../types/typography';
import { invokeWithSchema } from '../../../../utils/tauriSchemaInvoke';
import {
  buildTetherIngestProofReceipt,
  buildTetherRecoveryProofReceipt,
} from '../../../../utils/tetherIngestProofReceipt';
import Button from '../../../ui/Button';
import UiText from '../../../ui/Text';

interface TetherPanelProps {
  captureFrame?: (request: TetherCaptureRequest) => Promise<TetherCaptureResponse>;
  closeSession?: () => Promise<TetherSessionResponse>;
  discoverCameras?: () => Promise<TetherDiscoveryResponse>;
  getSession?: () => Promise<TetherSessionResponse>;
  onOpenCapture?: (path: string) => void;
  openSession?: (request: TetherSessionOpenRequest) => Promise<TetherSessionResponse>;
  setCameraControl?: (request: TetherCameraControlWriteRequest) => Promise<TetherCameraControlWriteResponse>;
}

type TetherReviewMode = 'holdCurrent' | 'newest' | 'pinned';
type TetherLiveViewStatus = 'off' | 'running';

const capabilityTone: Record<TetherCapability['status'], string> = {
  not_checked: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
  ready: 'border-green-500/40 bg-green-500/10 text-green-300',
  unavailable: 'border-red-500/40 bg-red-500/10 text-red-300',
};

const reviewModes: Array<TetherReviewMode> = ['newest', 'pinned', 'holdCurrent'];
const tetherIngestPresetIds = tetherIngestPresetIdSchema.options;
const tetherMetadataTemplateIds = tetherMetadataTemplateIdSchema.options;
const tetherDisabledControlClassName =
  'disabled:bg-bg-secondary disabled:text-text-tertiary disabled:ring-1 disabled:ring-border-color';

const defaultDiscoverCameras = (): Promise<TetherDiscoveryResponse> =>
  invokeWithSchema(
    Invokes.DiscoverTetheredCameras,
    { request: { providerMode: 'auto' } },
    tetherDiscoveryResponseSchema,
  );

const defaultOpenSession = (request: TetherSessionOpenRequest): Promise<TetherSessionResponse> =>
  invokeWithSchema(
    Invokes.OpenTetherSession,
    { request: tetherSessionOpenRequestSchema.parse(request) },
    tetherSessionResponseSchema,
  );

const defaultCloseSession = (): Promise<TetherSessionResponse> =>
  invokeWithSchema(Invokes.CloseTetherSession, {}, tetherSessionResponseSchema);

const defaultGetSession = (): Promise<TetherSessionResponse> =>
  invokeWithSchema(Invokes.GetTetherSession, {}, tetherSessionResponseSchema);

const defaultCaptureFrame = (request: TetherCaptureRequest): Promise<TetherCaptureResponse> =>
  invokeWithSchema(Invokes.TriggerTetherCapture, { request }, tetherCaptureResponseSchema);

const defaultSetCameraControl = (request: TetherCameraControlWriteRequest): Promise<TetherCameraControlWriteResponse> =>
  invokeWithSchema(Invokes.SetTetherCameraControl, { request }, tetherCameraControlWriteResponseSchema);

export function TetherPanel({
  captureFrame = defaultCaptureFrame,
  closeSession = defaultCloseSession,
  discoverCameras = defaultDiscoverCameras,
  getSession = defaultGetSession,
  onOpenCapture,
  openSession = defaultOpenSession,
  setCameraControl = defaultSetCameraControl,
}: TetherPanelProps = {}) {
  const { t } = useTranslation();
  const [discovery, setDiscovery] = useState<TetherDiscoveryResponse | null>(null);
  const [session, setSession] = useState<TetherSessionResponse['session']>(null);
  const [capture, setCapture] = useState<TetherCaptureResponse | null>(null);
  const [captures, setCaptures] = useState<Array<TetherCaptureResponse>>([]);
  const [cameraControls, setCameraControls] = useState<Array<TetherCameraControl>>([]);
  const [pinnedCaptureKey, setPinnedCaptureKey] = useState<string | null>(null);
  const [controlStatus, setControlStatus] = useState<Record<string, string>>({});
  const [busyControlId, setBusyControlId] = useState<string | null>(null);
  const [destinationRoot, setDestinationRoot] = useState('');
  const [backupDestinationRoot, setBackupDestinationRoot] = useState('');
  const [isBackupEnabled, setIsBackupEnabled] = useState(false);
  const [ingestPresetId, setIngestPresetId] = useState<TetherCaptureRequest['ingestPresetId']>('timestampCamera');
  const [metadataTemplateId, setMetadataTemplateId] = useState<TetherCaptureRequest['metadataTemplateId']>('none');
  const [reviewMode, setReviewMode] = useState<TetherReviewMode>('newest');
  const [liveViewStatus, setLiveViewStatus] = useState<TetherLiveViewStatus>('off');
  const [isFocusPeakingEnabled, setIsFocusPeakingEnabled] = useState(true);
  const [liveViewFrame, setLiveViewFrame] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isCaptureBusy, setIsCaptureBusy] = useState(false);
  const [isSessionBusy, setIsSessionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = discovery?.cameras[0] ?? null;
  const providerStatus = discovery?.provider.status ?? 'hardware_adapter_pending';
  const isSessionOpen = session !== null;
  const isSessionCaptureReady = session?.status === 'open';
  const isReconnectRequired = session?.status === 'reconnect_required';
  const isLiveViewSupported = discovery?.provider.mode === 'fake' && isSessionCaptureReady;
  const effectiveLiveViewStatus: TetherLiveViewStatus = isLiveViewSupported ? liveViewStatus : 'off';
  const isLiveViewRunning = effectiveLiveViewStatus === 'running';
  const captureProofReceipt = capture === null ? null : buildTetherIngestProofReceipt(capture);
  const recoveryProofReceipt = session === null ? null : buildTetherRecoveryProofReceipt(session);

  const discover = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await discoverCameras();
      setDiscovery(response);
      setCameraControls(response.cameras[0]?.controls ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [discoverCameras]);

  const refreshSession = useCallback(async () => {
    try {
      const response = await getSession();
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [getSession]);

  const openCameraSession = useCallback(async () => {
    if (camera === null) return;

    setIsSessionBusy(true);
    setError(null);
    try {
      const trimmedDestinationRoot = destinationRoot.trim();
      const response = await openSession({
        cameraId: camera.id,
        destinationRoot: trimmedDestinationRoot ? trimmedDestinationRoot : (session?.destinationRoot ?? undefined),
        providerMode: discovery?.provider.mode ?? 'auto',
      });
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSessionBusy(false);
    }
  }, [camera, destinationRoot, discovery, openSession, session]);

  const closeCameraSession = useCallback(async () => {
    setIsSessionBusy(true);
    setError(null);
    try {
      const response = await closeSession();
      setSession(response.session);
      setCapture(null);
      setCaptures([]);
      setLiveViewStatus('off');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSessionBusy(false);
    }
  }, [closeSession]);

  const toggleLiveView = useCallback(() => {
    if (!isLiveViewSupported && !isLiveViewRunning) return;
    setLiveViewStatus((currentStatus) => (currentStatus === 'running' ? 'off' : 'running'));
  }, [isLiveViewRunning, isLiveViewSupported]);

  const triggerCapture = useCallback(async () => {
    setIsCaptureBusy(true);
    setError(null);
    try {
      const response = await captureFrame({
        backupDestinationRoot:
          isBackupEnabled && backupDestinationRoot.trim() ? backupDestinationRoot.trim() : undefined,
        cameraControlValues: Object.fromEntries(cameraControls.map((control) => [control.id, control.currentValue])),
        ingestPresetId,
        metadataTemplateId,
      });
      setCaptures((current) => [response, ...current].slice(0, 8));
      setCapture((current) => {
        if (reviewMode === 'newest' || current === null) return response;
        if (reviewMode === 'pinned' && pinnedCaptureKey !== null) return current;
        return current;
      });
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshSession();
    } finally {
      setIsCaptureBusy(false);
    }
  }, [
    backupDestinationRoot,
    cameraControls,
    captureFrame,
    ingestPresetId,
    isBackupEnabled,
    metadataTemplateId,
    pinnedCaptureKey,
    refreshSession,
    reviewMode,
  ]);

  const updateCameraControl = useCallback(
    async (control: TetherCameraControl, value: string) => {
      if (camera === null || value === control.currentValue) return;

      setBusyControlId(control.id);
      setError(null);
      try {
        const response = await setCameraControl({
          cameraId: camera.id,
          controlId: control.id,
          providerMode: discovery?.provider.mode ?? 'auto',
          value,
        });
        setCameraControls((current) =>
          current.map((item) =>
            item.id === response.controlId ? { ...item, currentValue: response.appliedValue } : item,
          ),
        );
        setControlStatus((current) => ({
          ...current,
          [response.controlId]: t('editor.tether.controlVerified', { value: response.appliedValue }),
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyControlId(null);
      }
    },
    [camera, discovery, setCameraControl, t],
  );

  const selectedCaptureKey = capture === null ? null : captureKey(capture);

  const setMode = useCallback(
    (mode: TetherReviewMode) => {
      setReviewMode(mode);
      if (mode === 'newest') {
        setPinnedCaptureKey(null);
        setCapture(captures[0] ?? null);
        return;
      }
      if (mode === 'holdCurrent') {
        setPinnedCaptureKey(null);
        return;
      }
      if (capture !== null) setPinnedCaptureKey(captureKey(capture));
    },
    [capture, captures],
  );

  const selectCapture = useCallback(
    (nextCapture: TetherCaptureResponse) => {
      setCapture(nextCapture);
      if (reviewMode === 'pinned') setPinnedCaptureKey(captureKey(nextCapture));
    },
    [reviewMode],
  );

  const openCapture = useCallback(
    (path: string) => {
      onOpenCapture?.(path);
    },
    [onOpenCapture],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void discover();
      void refreshSession();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [discover, refreshSession]);

  useEffect(() => {
    if (!isLiveViewRunning) return undefined;

    const intervalId = window.setInterval(() => {
      setLiveViewFrame((currentFrame) => (currentFrame + 1) % 10_000);
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLiveViewRunning]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4" data-testid="tether-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <UiText variant={TextVariants.title}>{t('editor.tether.title')}</UiText>
            <span className="rounded border border-blue-400/40 bg-blue-400/10 px-2 py-0.5 text-xs text-blue-200">
              {t('editor.tether.discoveryOnly')}
            </span>
          </div>
          <UiText variant={TextVariants.small} color={TextColors.secondary}>
            {t('editor.tether.subtitle')}
          </UiText>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => {
            void discover();
          }}
          size="sm"
        >
          <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
          {t('editor.tether.refresh')}
        </Button>
      </div>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-provider-mode={discovery?.provider.mode ?? 'auto'}
        data-provider-status={providerStatus}
        data-testid="tether-provider-status"
      >
        <div className="flex items-center gap-2">
          {providerStatus === 'ready' ? (
            <CheckCircle2 size={16} className="text-green-300" />
          ) : (
            <AlertTriangle size={16} className="text-yellow-300" />
          )}
          <UiText variant={TextVariants.label}>
            {discovery?.provider.adapter ?? t('editor.tether.pendingAdapter')}
          </UiText>
        </div>
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
          {discovery?.provider.message ?? t('editor.tether.pendingMessage')}
        </UiText>
      </section>

      <Button
        className={tetherDisabledControlClassName}
        disabled={!isSessionCaptureReady || isCaptureBusy}
        onClick={() => {
          void triggerCapture();
        }}
        size="sm"
        data-testid="tether-trigger-capture"
      >
        <Camera size={14} />
        {isCaptureBusy ? t('editor.tether.captureBusy') : t('editor.tether.capture')}
      </Button>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-focus-peaking-enabled={String(isFocusPeakingEnabled)}
        data-frame-rate="4"
        data-live-view-supported={String(isLiveViewSupported)}
        data-live-view-status={effectiveLiveViewStatus}
        data-testid="tether-live-view"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eye size={16} className={isLiveViewRunning ? 'text-green-300' : 'text-text-secondary'} />
            <UiText variant={TextVariants.label}>{t('editor.tether.liveView')}</UiText>
          </div>
          <Button
            className={tetherDisabledControlClassName}
            data-testid="tether-live-view-toggle"
            disabled={!isLiveViewSupported}
            onClick={toggleLiveView}
            size="sm"
          >
            {isLiveViewRunning ? t('editor.tether.stopLiveView') : t('editor.tether.startLiveView')}
          </Button>
        </div>
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
          {isLiveViewSupported ? t('editor.tether.liveViewReady') : t('editor.tether.liveViewRequiresSession')}
        </UiText>
        <div
          className="relative mt-3 aspect-video overflow-hidden rounded border border-border-color bg-gradient-to-br from-[#17202a] via-[#30444c] to-[#d7b36a]"
          data-live-frame={liveViewFrame}
          data-testid="tether-live-view-preview"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_44%,rgba(255,255,255,0.22),transparent_18%),linear-gradient(135deg,rgba(0,0,0,0.38),transparent_45%)]" />
          {isLiveViewRunning && isFocusPeakingEnabled && (
            <div
              className="absolute left-[31%] top-[24%] h-[38%] w-[34%] rounded-full border border-lime-300/80 shadow-[0_0_18px_rgba(190,242,100,0.7)]"
              data-testid="tether-live-view-focus-peaking"
            />
          )}
          <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px] text-white">
            {t('editor.tether.liveViewFps', { fps: 4 })}
          </div>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded border border-border-color bg-bg-primary px-2 py-1.5">
          <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
            <Crosshair size={14} />
            {t('editor.tether.focusPeaking')}
          </span>
          <input
            checked={isFocusPeakingEnabled}
            className="h-4 w-4"
            data-testid="tether-focus-peaking-toggle"
            onChange={(event) => {
              setIsFocusPeakingEnabled(event.target.checked);
            }}
            type="checkbox"
          />
        </label>
      </section>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-control-count={cameraControls.length}
        data-testid="tether-exposure-controls"
      >
        <div className="flex items-center justify-between gap-3">
          <UiText variant={TextVariants.label}>{t('editor.tether.exposureControls')}</UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary}>
            {isSessionCaptureReady ? t('editor.tether.controlsReady') : t('editor.tether.controlsRequireSession')}
          </UiText>
        </div>
        <div className="mt-3 grid gap-2">
          {cameraControls.map((control) => {
            const isWritable =
              isSessionCaptureReady && control.writable && control.status === 'ready' && busyControlId === null;
            return (
              <label
                className="grid grid-cols-[86px_1fr] items-center gap-2 rounded border border-border-color bg-bg-primary p-2"
                data-control-current-value={control.currentValue}
                data-control-id={control.id}
                data-control-status={control.status}
                data-control-writable={String(control.writable)}
                data-testid="tether-exposure-control"
                key={control.id}
              >
                <span>
                  <UiText variant={TextVariants.small}>{control.label}</UiText>
                  {control.unit !== null && (
                    <UiText variant={TextVariants.small} color={TextColors.secondary} className="block">
                      {control.unit}
                    </UiText>
                  )}
                </span>
                <select
                  className="min-w-0 rounded border border-border-color bg-bg-secondary px-2 py-1.5 text-sm text-text-primary disabled:opacity-60"
                  data-testid={`tether-exposure-control-${control.id}`}
                  disabled={!isWritable}
                  onChange={(event) => {
                    void updateCameraControl(control, event.target.value);
                  }}
                  value={control.currentValue}
                >
                  {control.values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {controlStatus[control.id] && (
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="col-span-2">
                    {controlStatus[control.id]}
                  </UiText>
                )}
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-md border border-border-color bg-bg-secondary p-3" data-testid="tether-ingest-preset">
        <label className="block">
          <UiText variant={TextVariants.label}>{t('editor.tether.ingestPreset')}</UiText>
          <select
            className="mt-2 w-full rounded border border-border-color bg-bg-primary px-2 py-2 text-sm text-text-primary"
            data-selected-ingest-preset={ingestPresetId}
            data-testid="tether-ingest-preset-select"
            onChange={(event) => {
              setIngestPresetId(tetherIngestPresetIdSchema.parse(event.target.value));
            }}
            value={ingestPresetId}
          >
            {tetherIngestPresetIds.map((presetId) => (
              <option key={presetId} value={presetId}>
                {t(tetherIngestPresetLocaleKey(presetId))}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-testid="tether-metadata-template"
      >
        <label className="block">
          <UiText variant={TextVariants.label}>{t('editor.tether.metadataTemplate')}</UiText>
          <select
            className="mt-2 w-full rounded border border-border-color bg-bg-primary px-2 py-2 text-sm text-text-primary"
            data-selected-metadata-template={metadataTemplateId}
            data-testid="tether-metadata-template-select"
            onChange={(event) => {
              setMetadataTemplateId(tetherMetadataTemplateIdSchema.parse(event.target.value));
            }}
            value={metadataTemplateId}
          >
            {tetherMetadataTemplateIds.map((templateId) => (
              <option key={templateId} value={templateId}>
                {t(tetherMetadataTemplateLocaleKey(templateId))}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-backup-enabled={String(isBackupEnabled)}
        data-testid="tether-backup-copy"
      >
        <label className="flex items-center justify-between gap-3">
          <UiText variant={TextVariants.label}>{t('editor.tether.backupCopy')}</UiText>
          <input
            checked={isBackupEnabled}
            className="h-4 w-4"
            data-testid="tether-backup-copy-toggle"
            onChange={(event) => {
              setIsBackupEnabled(event.target.checked);
            }}
            type="checkbox"
          />
        </label>
        <input
          className="mt-2 w-full rounded border border-border-color bg-bg-primary px-2 py-2 text-sm text-text-primary"
          data-testid="tether-backup-copy-path"
          disabled={!isBackupEnabled}
          onChange={(event) => {
            setBackupDestinationRoot(event.target.value);
          }}
          placeholder={t('editor.tether.backupCopyPlaceholder')}
          value={backupDestinationRoot}
        />
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
          {t('editor.tether.backupCopyDescription')}
        </UiText>
      </section>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-destination-root={destinationRoot.trim()}
        data-testid="tether-destination-root"
      >
        <label className="block">
          <UiText variant={TextVariants.label}>{t('editor.tether.destinationRoot')}</UiText>
          <input
            className="mt-2 w-full rounded border border-border-color bg-bg-primary px-2 py-2 text-sm text-text-primary"
            data-testid="tether-destination-root-path"
            disabled={isSessionOpen || isSessionBusy}
            onChange={(event) => {
              setDestinationRoot(event.target.value);
            }}
            placeholder={t('editor.tether.destinationRootPlaceholder')}
            value={destinationRoot}
          />
        </label>
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
          {t('editor.tether.destinationRootDescription')}
        </UiText>
      </section>

      {capture !== null && (
        <section
          className="rounded-md border border-green-500/40 bg-green-500/10 p-3"
          data-backup-status={capture.backup.status}
          data-capture-checksum={capture.checksum}
          data-capture-imported-path={capture.importedPath}
          data-capture-status={capture.status}
          data-ingest-preset-id={capture.ingest.presetId}
          data-metadata-template-id={capture.metadata.templateId}
          data-testid="tether-capture-result"
        >
          <UiText variant={TextVariants.label}>
            {capture.status === 'duplicate'
              ? t('editor.tether.captureDuplicateSuppressed')
              : t('editor.tether.captureComplete')}
          </UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block truncate">
            {capture.importedPath}
          </UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            {t('editor.tether.captureVerified', { bytes: capture.bytes })}
          </UiText>
          {captureProofReceipt !== null && (
            <UiText
              variant={TextVariants.small}
              color={TextColors.secondary}
              className="mt-1 block truncate"
              data-backup-enabled={String(captureProofReceipt.backupEnabled)}
              data-camera-control-count={captureProofReceipt.cameraControlCount}
              data-duplicate-suppressed={String(captureProofReceipt.duplicateSuppressed)}
              data-receipt-backup-status={captureProofReceipt.backupStatus}
              data-receipt-checksum={captureProofReceipt.checksum}
              data-receipt-collision-index={captureProofReceipt.collisionIndex}
              data-receipt-imported-path={captureProofReceipt.importedPath}
              data-receipt-ingest-preset-id={captureProofReceipt.ingestPresetId}
              data-receipt-metadata-sidecar-path={captureProofReceipt.metadataSidecarPath ?? ''}
              data-receipt-metadata-template-id={captureProofReceipt.metadataTemplateId}
              data-receipt-provider-mode={captureProofReceipt.providerMode}
              data-receipt-session-id={captureProofReceipt.sessionId}
              data-receipt-status={captureProofReceipt.status}
              data-receipt-version={captureProofReceipt.receiptVersion}
              data-testid="tether-ingest-proof-receipt"
            >
              {t('editor.tether.ingestProofReceipt', {
                checksum: captureProofReceipt.checksum,
                collisionIndex: captureProofReceipt.collisionIndex,
                preset: t(tetherIngestPresetLocaleKey(captureProofReceipt.ingestPresetId)),
              })}
            </UiText>
          )}
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            {t('editor.tether.ingestApplied', {
              collisionIndex: capture.ingest.collisionIndex,
              preset: t(tetherIngestPresetLocaleKey(capture.ingest.presetId)),
            })}
          </UiText>
          {capture.ingest.addTags.length > 0 && (
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('editor.tether.ingestTagsApplied', {
                tags: formatTetherList(capture.ingest.addTags, t('editor.tether.none')),
              })}
            </UiText>
          )}
          {capture.ingest.applyPresetIds.length > 0 && (
            <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
              {t('editor.tether.ingestDevelopPresetsApplied', {
                presets: formatTetherList(capture.ingest.applyPresetIds, t('editor.tether.none')),
              })}
            </UiText>
          )}
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            {capture.metadata.applied
              ? t('editor.tether.metadataApplied', {
                  fields: capture.metadata.appliedFields.length,
                  template: t(tetherMetadataTemplateLocaleKey(capture.metadata.templateId)),
                })
              : t('editor.tether.metadataSkipped')}
          </UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
            {t('editor.tether.controlsRecorded', {
              controls: formatTetherControlValues(capture.cameraControlValues, t('editor.tether.none')),
            })}
          </UiText>
          <UiText
            variant={TextVariants.small}
            color={capture.backup.status === 'failed' ? TextColors.error : TextColors.secondary}
            className="mt-1 block truncate"
          >
            {capture.backup.status === 'verified' && capture.backup.destinationPath !== null
              ? t('editor.tether.backupVerified', { path: capture.backup.destinationPath })
              : capture.backup.status === 'failed'
                ? t('editor.tether.backupFailed', { error: capture.backup.error ?? t('editor.tether.unknown') })
                : t('editor.tether.backupDisabled')}
          </UiText>
          {onOpenCapture && (
            <Button
              onClick={() => {
                openCapture(capture.importedPath);
              }}
              size="sm"
              className="mt-3"
              data-testid="tether-open-selected-capture"
            >
              {t('editor.tether.openSelectedCapture')}
            </Button>
          )}
        </section>
      )}

      {captures.length > 0 && (
        <section
          className="rounded-md border border-border-color bg-bg-secondary p-3"
          data-review-mode={reviewMode}
          data-selected-capture-key={selectedCaptureKey ?? ''}
          data-testid="tether-incoming-capture-strip"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Images size={16} className="text-accent" />
              <UiText variant={TextVariants.label}>{t('editor.tether.incomingCaptures')}</UiText>
            </div>
            <div className="flex gap-1" data-testid="tether-review-mode-control">
              {reviewModes.map((mode) => (
                <button
                  className={`rounded border px-2 py-1 text-xs transition-colors ${
                    reviewMode === mode
                      ? 'border-accent bg-accent text-button-text'
                      : 'border-border-color bg-bg-primary text-text-secondary hover:text-text-primary'
                  }`}
                  data-review-mode-option={mode}
                  data-selected={String(reviewMode === mode)}
                  key={mode}
                  onClick={() => {
                    setMode(mode);
                  }}
                  type="button"
                >
                  {t(reviewModeLocaleKey(mode))}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" data-testid="tether-incoming-capture-items">
            {captures.map((incomingCapture) => {
              const key = captureKey(incomingCapture);
              const isSelected = key === selectedCaptureKey;
              const isPinned = key === pinnedCaptureKey;
              return (
                <div
                  className={`min-w-48 rounded-md border p-2 text-left transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/10'
                      : 'border-border-color bg-bg-primary hover:border-accent/60'
                  }`}
                  data-capture-imported-path={incomingCapture.importedPath}
                  data-capture-key={key}
                  data-backup-status={incomingCapture.backup.status}
                  data-ingest-collision-index={incomingCapture.ingest.collisionIndex}
                  data-ingest-file-name={incomingCapture.ingest.fileName}
                  data-ingest-preset-id={incomingCapture.ingest.presetId}
                  data-metadata-template-id={incomingCapture.metadata.templateId}
                  data-pinned={String(isPinned)}
                  data-selected={String(isSelected)}
                  data-testid="tether-incoming-capture-item"
                  key={key}
                >
                  <button
                    className="block w-full text-left"
                    onClick={() => {
                      selectCapture(incomingCapture);
                    }}
                    type="button"
                  >
                    <UiText variant={TextVariants.label} className="block truncate">
                      {captureFileName(incomingCapture.importedPath)}
                    </UiText>
                    <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block">
                      {t('editor.tether.captureVerified', { bytes: incomingCapture.bytes })}
                    </UiText>
                    <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1 block truncate">
                      {incomingCapture.capturedAt}
                    </UiText>
                    <UiText
                      variant={TextVariants.small}
                      color={TextColors.secondary}
                      className="mt-1 block truncate"
                      data-testid="tether-incoming-capture-ingest"
                    >
                      {t('editor.tether.ingestApplied', {
                        collisionIndex: incomingCapture.ingest.collisionIndex,
                        preset: t(tetherIngestPresetLocaleKey(incomingCapture.ingest.presetId)),
                      })}
                    </UiText>
                  </button>
                  <div className="mt-2 flex gap-1">
                    <button
                      className={`rounded border px-2 py-1 text-xs ${
                        isPinned
                          ? 'border-accent bg-accent text-button-text'
                          : 'border-border-color bg-bg-secondary text-text-secondary hover:text-text-primary'
                      }`}
                      data-pinned={String(isPinned)}
                      data-testid="tether-pin-capture"
                      onClick={() => {
                        setReviewMode('pinned');
                        setPinnedCaptureKey(key);
                        setCapture(incomingCapture);
                      }}
                      type="button"
                    >
                      <Pin size={12} className="mr-1 inline" />
                      {t('editor.tether.pinCapture')}
                    </button>
                    {onOpenCapture && (
                      <button
                        className="rounded border border-border-color bg-bg-secondary px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                        data-testid="tether-open-capture"
                        onClick={() => {
                          openCapture(incomingCapture.importedPath);
                        }}
                        type="button"
                      >
                        {t('editor.tether.openCapture')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-session-status={session?.status ?? 'closed'}
        data-testid="tether-session-status"
      >
        <UiText variant={TextVariants.label}>
          {session?.status === 'reconnect_required'
            ? t('editor.tether.sessionReconnectRequired')
            : isSessionOpen
              ? t('editor.tether.sessionOpen')
              : t('editor.tether.sessionClosed')}
        </UiText>
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
          {session?.status === 'reconnect_required'
            ? t('editor.tether.sessionReconnectRequiredDescription')
            : isSessionOpen
              ? t('editor.tether.sessionOpenDescription', { camera: session.cameraDisplayName })
              : t('editor.tether.sessionClosedDescription')}
        </UiText>
        {session?.destinationRoot && (
          <UiText
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="mt-2 block truncate"
            data-testid="tether-session-destination-root"
            title={session.destinationRoot}
          >
            {t('editor.tether.sessionDestinationRoot', { path: session.destinationRoot })}
          </UiText>
        )}
        {session && (
          <UiText
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="mt-2 block"
            data-session-capture-counter={session.captureCounter}
            data-testid="tether-session-capture-counter"
          >
            {t('editor.tether.sessionCaptureCounter', { next: session.captureCounter })}
          </UiText>
        )}
        {session?.recovery && session.recovery.status !== 'clean' && (
          <div
            className="mt-3 rounded border border-yellow-500/40 bg-yellow-500/10 p-2"
            data-first-quarantined-file={session.recovery.quarantinedFiles[0] ?? ''}
            data-partial-files-found={session.recovery.partialFilesFound}
            data-quarantined-file-count={session.recovery.quarantinedFiles.length}
            data-recovery-status={session.recovery.status}
            data-testid="tether-recovery-status"
          >
            {recoveryProofReceipt !== null && (
              <UiText
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="mb-1 block truncate"
                data-capture-counter={recoveryProofReceipt.captureCounter}
                data-first-quarantined-file={recoveryProofReceipt.firstQuarantinedFile ?? ''}
                data-partial-files-found={recoveryProofReceipt.partialFilesFound}
                data-quarantined-file-count={recoveryProofReceipt.quarantinedFileCount}
                data-receipt-version={recoveryProofReceipt.receiptVersion}
                data-reconnect-required={String(recoveryProofReceipt.reconnectRequired)}
                data-recovery-status={recoveryProofReceipt.recoveryStatus}
                data-session-id={recoveryProofReceipt.sessionId}
                data-session-status={recoveryProofReceipt.sessionStatus}
                data-testid="tether-recovery-proof-receipt"
              >
                {t('editor.tether.recoveryProofReceipt', {
                  count: recoveryProofReceipt.partialFilesFound,
                  status: recoveryProofReceipt.recoveryStatus,
                })}
              </UiText>
            )}
            <UiText
              variant={TextVariants.small}
              color={session.recovery.status === 'failed' ? TextColors.error : TextColors.secondary}
              className="block"
            >
              {session.recovery.status === 'quarantined'
                ? t('editor.tether.recoveryQuarantined', { count: session.recovery.partialFilesFound })
                : session.recovery.status === 'failed'
                  ? t('editor.tether.recoveryFailed', { message: session.recovery.message })
                  : session.recovery.status === 'reconnect_required'
                    ? t('editor.tether.recoveryReconnectRequired', { message: session.recovery.message })
                    : session.recovery.message}
            </UiText>
            {session.recovery.quarantinedFiles.length > 0 && (
              <UiText
                variant={TextVariants.small}
                color={TextColors.secondary}
                className="mt-1 block truncate"
                data-testid="tether-recovery-quarantine-file"
                title={session.recovery.quarantinedFiles[0]}
              >
                {session.recovery.quarantinedFiles[0]}
              </UiText>
            )}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Button
            className={tetherDisabledControlClassName}
            disabled={camera === null || isSessionOpen || isSessionBusy}
            onClick={() => {
              void openCameraSession();
            }}
            size="sm"
            data-testid="tether-open-session"
          >
            {t('editor.tether.openSession')}
          </Button>
          {isReconnectRequired && (
            <Button
              className={tetherDisabledControlClassName}
              disabled={camera === null || isSessionBusy}
              onClick={() => {
                void openCameraSession();
              }}
              size="sm"
              data-preserves-destination-root={session.destinationRoot ?? ''}
              data-testid="tether-reconnect-session"
            >
              {t('editor.tether.reconnectSession')}
            </Button>
          )}
          <Button
            className={tetherDisabledControlClassName}
            disabled={!isSessionOpen || isSessionBusy}
            onClick={() => {
              void closeCameraSession();
            }}
            size="sm"
            data-testid="tether-close-session"
          >
            {t('editor.tether.closeSession')}
          </Button>
        </div>
      </section>

      {error && (
        <UiText
          variant={TextVariants.small}
          className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-200"
        >
          {error}
        </UiText>
      )}

      {camera ? (
        <section
          className="rounded-md border border-border-color bg-bg-secondary p-3"
          data-battery-percent={camera.batteryPercent ?? ''}
          data-camera-id={camera.id}
          data-testid="tether-camera-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bg-primary text-accent">
                <Camera size={22} />
              </div>
              <div>
                <UiText variant={TextVariants.heading}>{camera.displayName}</UiText>
                <UiText variant={TextVariants.small} color={TextColors.secondary}>
                  {camera.make} {camera.model}
                </UiText>
              </div>
            </div>
            <span className="rounded border border-green-500/40 bg-green-500/10 px-2 py-1 text-xs text-green-300">
              {t('editor.tether.connected')}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <Metric icon={<Usb size={15} />} label={t('editor.tether.transport')} value={camera.connection.transport} />
            <Metric
              icon={<Battery size={15} />}
              label={t('editor.tether.battery')}
              value={camera.batteryPercent === null ? t('editor.tether.unknown') : `${camera.batteryPercent}%`}
            />
            <Metric
              icon={<HardDrive size={15} />}
              label={t('editor.tether.storage')}
              value={
                camera.storage.freeGb === null
                  ? camera.storage.label
                  : t('editor.tether.storageValue', {
                      freeGb: camera.storage.freeGb.toFixed(1),
                      label: camera.storage.label,
                    })
              }
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2" data-testid="tether-capability-badges">
            {camera.capabilities.map((capability) => (
              <span
                className={`rounded border px-2 py-1 text-xs ${capabilityTone[capability.status]}`}
                data-capability-id={capability.id}
                data-capability-status={capability.status}
                key={capability.id}
              >
                {capability.label}
              </span>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-md border border-border-color bg-bg-secondary p-3" data-testid="tether-empty-state">
          <UiText variant={TextVariants.heading}>{t('editor.tether.noCameraTitle')}</UiText>
          <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
            {t('editor.tether.noCameraDescription')}
          </UiText>
        </section>
      )}
    </div>
  );
}

export default TetherPanel;

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-color bg-bg-primary p-2">
      <div className="flex items-center gap-1.5 text-text-secondary">
        {icon}
        <UiText variant={TextVariants.small}>{label}</UiText>
      </div>
      <UiText variant={TextVariants.label} className="mt-1 block truncate">
        {value}
      </UiText>
    </div>
  );
}

function captureKey(capture: TetherCaptureResponse): string {
  return `${capture.sessionId}:${capture.capturedAt}:${capture.checksum}`;
}

function captureFileName(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path;
}

function reviewModeLocaleKey(
  mode: TetherReviewMode,
): 'editor.tether.reviewHoldCurrent' | 'editor.tether.reviewNewest' | 'editor.tether.reviewPinned' {
  if (mode === 'newest') return 'editor.tether.reviewNewest';
  if (mode === 'pinned') return 'editor.tether.reviewPinned';
  return 'editor.tether.reviewHoldCurrent';
}

function tetherIngestPresetLocaleKey(
  presetId: TetherCaptureRequest['ingestPresetId'],
):
  | 'editor.tether.ingestPresetCameraSequence'
  | 'editor.tether.ingestPresetSourceSequence'
  | 'editor.tether.ingestPresetTimestampCamera'
  | 'editor.tether.ingestPresetWeddingCopyIngest' {
  if (presetId === 'cameraSequence') return 'editor.tether.ingestPresetCameraSequence';
  if (presetId === 'sourceSequence') return 'editor.tether.ingestPresetSourceSequence';
  if (presetId === 'wedding-copy-ingest') return 'editor.tether.ingestPresetWeddingCopyIngest';
  return 'editor.tether.ingestPresetTimestampCamera';
}

function tetherMetadataTemplateLocaleKey(
  templateId: TetherCaptureRequest['metadataTemplateId'],
):
  | 'editor.tether.metadataTemplateNone'
  | 'editor.tether.metadataTemplateCopyrightClientDelivery'
  | 'editor.tether.metadataTemplateReviewSelect'
  | 'editor.tether.metadataTemplateStudioSession' {
  if (templateId === 'copyright-client-delivery') return 'editor.tether.metadataTemplateCopyrightClientDelivery';
  if (templateId === 'reviewSelect') return 'editor.tether.metadataTemplateReviewSelect';
  if (templateId === 'studioSession') return 'editor.tether.metadataTemplateStudioSession';
  return 'editor.tether.metadataTemplateNone';
}

function formatTetherControlValues(values: Record<string, string>, emptyLabel: string): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return emptyLabel;
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

function formatTetherList(values: Array<string>, emptyLabel: string): string {
  if (values.length === 0) return emptyLabel;
  return values.join(', ');
}
