import { invoke } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import {
  type CalibrationFitReceipt,
  type CalibrationJobResult,
  type ChartGeometry,
  type ChartSamplingReceipt,
  calibrationJobResultSchema,
  chartSamplingReceiptSchema,
  dualCalibrationJobResultSchema,
  type IlluminantCoordinates,
} from '../../schemas/color/chartCalibrationSchemas';
import { Invokes } from '../../tauri/commands';

const CHART_ID = 'colorchecker_classic_24_cc0_srgb_d65_v1';
let nextCalibrationJob = 0;
const createJobId = () => `chart-calibration-${Date.now().toString(36)}-${++nextCalibrationJob}`;

export const useChartCalibration = (sourcePath: string | null) => {
  const [jobId] = useState(createJobId);
  const [sampling, setSampling] = useState<ChartSamplingReceipt | null>(null);
  const [result, setResult] = useState<CalibrationJobResult | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const sample = useCallback(
    async (geometry: ChartGeometry) => {
      if (sourcePath === null) throw new Error('chart_calibration_source_unavailable');
      setRunning(true);
      setResult(null);
      try {
        const receipt = chartSamplingReceiptSchema.parse(
          await invoke(Invokes.SampleColorChart, {
            input: { chartId: CHART_ID, geometry, jobId, sourcePath },
          }),
        );
        setSampling(receipt);
        setErrorCode(null);
        return receipt;
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        setErrorCode(code);
        throw error;
      } finally {
        setRunning(false);
      }
    },
    [jobId, sourcePath],
  );

  const fit = useCallback(
    async (input: {
      confirmWarning: boolean;
      illuminant: IlluminantCoordinates;
      profileName: string;
      publish: boolean;
    }) => {
      if (sourcePath === null || sampling === null) throw new Error('chart_calibration_sample_required');
      setRunning(true);
      try {
        const nextResult = calibrationJobResultSchema.parse(
          await invoke(Invokes.FitColorChart, {
            input: {
              jobId,
              sourcePath,
              calibration: { ...input, sampling },
            },
          }),
        );
        setResult(nextResult);
        setErrorCode(null);
        return nextResult;
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        setErrorCode(code);
        throw error;
      } finally {
        setRunning(false);
      }
    },
    [jobId, sampling, sourcePath],
  );

  const cancel = useCallback(async () => {
    await invoke(Invokes.CancelColorChartCalibration, { jobId });
  }, [jobId]);

  const combine = useCallback(
    async (
      first: CalibrationFitReceipt,
      second: CalibrationFitReceipt,
      profileName: string,
      confirmWarning: boolean,
    ) => {
      setRunning(true);
      try {
        const firstCct = first.illuminant.cctKelvin ?? 0;
        const [warm, cool] = firstCct <= (second.illuminant.cctKelvin ?? 0) ? [first, second] : [second, first];
        const combined = dualCalibrationJobResultSchema.parse(
          await invoke(Invokes.CombineColorChartCalibrations, {
            input: { confirmWarning, cool, profileName, warm },
          }),
        );
        setErrorCode(null);
        return combined;
      } catch (error) {
        setErrorCode(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setSampling(null);
    setResult(null);
    setErrorCode(null);
  }, []);

  return { cancel, combine, errorCode, fit, reset, result, running, sample, sampling };
};
