import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useState } from 'react';
import {
  type CameraProfileBrowserEntry,
  cameraProfileRegistryReportSchema,
} from '../../schemas/color/cameraProfileBrowserSchemas';
import { emptyTauriResponseSchema } from '../../schemas/tauriResponseSchemas';
import { Invokes } from '../../tauri/commands';
import { invokeWithSchema } from '../../utils/tauriSchemaInvoke';

export const useCameraProfileRegistry = (cameraModel: string | null) => {
  const [entries, setEntries] = useState<Array<CameraProfileBrowserEntry>>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const report = await invokeWithSchema(
        Invokes.ListCameraProfiles,
        { cameraModel },
        cameraProfileRegistryReportSchema,
      );
      setEntries(report.entries);
      setErrorCode(null);
    } catch (error) {
      setErrorCode(error instanceof Error ? error.message : 'camera_profile_registry_unavailable');
    } finally {
      setLoading(false);
    }
  }, [cameraModel]);
  useEffect(() => void refresh(), [refresh]);
  const importProfile = useCallback(async () => {
    const sourcePath = await open({
      directory: false,
      filters: [{ extensions: ['dcp'], name: 'DNG Camera Profile' }],
      multiple: false,
    });
    if (sourcePath === null) return;
    setLoading(true);
    try {
      const report = await invokeWithSchema(
        Invokes.ImportCameraProfile,
        { cameraModel, sourcePath },
        cameraProfileRegistryReportSchema,
      );
      setEntries(report.entries);
      setErrorCode(null);
    } catch (error) {
      setErrorCode(error instanceof Error ? error.message : 'camera_profile_import_failed');
    } finally {
      setLoading(false);
    }
  }, [cameraModel]);
  const removeProfile = useCallback(
    async (id: string) => {
      await invokeWithSchema(Invokes.RemoveCameraProfile, { id }, emptyTauriResponseSchema);
      await refresh();
    },
    [refresh],
  );
  const revealProfile = useCallback(async (id: string) => {
    await invokeWithSchema(Invokes.RevealCameraProfile, { id }, emptyTauriResponseSchema);
  }, []);
  return { entries, errorCode, importProfile, loading, refresh, removeProfile, revealProfile };
};
