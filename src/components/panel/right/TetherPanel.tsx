import { Battery, Camera, CheckCircle2, HardDrive, RefreshCcw, Usb, AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  tetherDiscoveryResponseSchema,
  tetherSessionResponseSchema,
  type TetherCapability,
  type TetherDiscoveryResponse,
  type TetherSessionResponse,
} from '../../../schemas/tetheringSchemas';
import { TextColors, TextVariants } from '../../../types/typography';
import { invokeWithSchema } from '../../../utils/tauriSchemaInvoke';
import { Invokes } from '../../ui/AppProperties';
import Button from '../../ui/Button';
import UiText from '../../ui/Text';

interface TetherPanelProps {
  closeSession?: () => Promise<TetherSessionResponse>;
  discoverCameras?: () => Promise<TetherDiscoveryResponse>;
  openSession?: (cameraId: string) => Promise<TetherSessionResponse>;
}

const capabilityTone: Record<TetherCapability['status'], string> = {
  not_checked: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
  ready: 'border-green-500/40 bg-green-500/10 text-green-300',
  unavailable: 'border-red-500/40 bg-red-500/10 text-red-300',
};

const defaultDiscoverCameras = (): Promise<TetherDiscoveryResponse> =>
  invokeWithSchema(
    Invokes.DiscoverTetheredCameras,
    { request: { providerMode: 'auto' } },
    tetherDiscoveryResponseSchema,
  );

const defaultOpenSession = (cameraId: string): Promise<TetherSessionResponse> =>
  invokeWithSchema(
    Invokes.OpenTetherSession,
    { request: { cameraId, providerMode: 'auto' } },
    tetherSessionResponseSchema,
  );

const defaultCloseSession = (): Promise<TetherSessionResponse> =>
  invokeWithSchema(Invokes.CloseTetherSession, {}, tetherSessionResponseSchema);

export function TetherPanel({
  closeSession = defaultCloseSession,
  discoverCameras = defaultDiscoverCameras,
  openSession = defaultOpenSession,
}: TetherPanelProps = {}) {
  const { t } = useTranslation();
  const [discovery, setDiscovery] = useState<TetherDiscoveryResponse | null>(null);
  const [session, setSession] = useState<TetherSessionResponse['session']>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSessionBusy, setIsSessionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = discovery?.cameras[0] ?? null;
  const providerStatus = discovery?.provider.status ?? 'hardware_adapter_pending';
  const isSessionOpen = session !== null;

  const discover = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await discoverCameras();
      setDiscovery(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [discoverCameras]);

  const openCameraSession = useCallback(async () => {
    if (camera === null) return;

    setIsSessionBusy(true);
    setError(null);
    try {
      const response = await openSession(camera.id);
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSessionBusy(false);
    }
  }, [camera, openSession]);

  const closeCameraSession = useCallback(async () => {
    setIsSessionBusy(true);
    setError(null);
    try {
      const response = await closeSession();
      setSession(response.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSessionBusy(false);
    }
  }, [closeSession]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void discover();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [discover]);

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

      <Button disabled={true} onClick={() => undefined} size="sm" data-testid="tether-capture-disabled">
        <Camera size={14} />
        {t('editor.tether.captureUnavailable')}
      </Button>

      <section
        className="rounded-md border border-border-color bg-bg-secondary p-3"
        data-session-status={session?.status ?? 'closed'}
        data-testid="tether-session-status"
      >
        <UiText variant={TextVariants.label}>
          {isSessionOpen ? t('editor.tether.sessionOpen') : t('editor.tether.sessionClosed')}
        </UiText>
        <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
          {isSessionOpen
            ? t('editor.tether.sessionOpenDescription', { camera: session.cameraDisplayName })
            : t('editor.tether.sessionClosedDescription')}
        </UiText>
        <div className="mt-3 flex gap-2">
          <Button
            disabled={camera === null || isSessionOpen || isSessionBusy}
            onClick={() => {
              void openCameraSession();
            }}
            size="sm"
            data-testid="tether-open-session"
          >
            {t('editor.tether.openSession')}
          </Button>
          <Button
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
