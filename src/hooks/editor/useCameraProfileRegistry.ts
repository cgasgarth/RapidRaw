import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useState } from 'react';
import {
  type CameraProfileBrowserEntry,
  cameraProfileRegistryReportSchema,
} from '../../schemas/color/cameraProfileBrowserSchemas';
import { Invokes } from '../../tauri/commands';

export const useCameraProfileRegistry = (cameraModel: string | null) => {
  const [entries, setEntries] = useState<Array<CameraProfileBrowserEntry>>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const report = cameraProfileRegistryReportSchema.parse(await invoke(Invokes.ListCameraProfiles, { cameraModel }));
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
      const report = cameraProfileRegistryReportSchema.parse(
        await invoke(Invokes.ImportCameraProfile, { cameraModel, sourcePath }),
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
      await invoke(Invokes.RemoveCameraProfile, { id });
      await refresh();
    },
    [refresh],
  );
  const revealProfile = useCallback(async (id: string) => {
    await invoke(Invokes.RevealCameraProfile, { id });
  }, []);
  return { entries, errorCode, importProfile, loading, refresh, removeProfile, revealProfile };
};
