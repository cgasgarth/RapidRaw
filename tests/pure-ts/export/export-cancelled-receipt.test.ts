import { expect, test } from 'bun:test';

import { Status } from '../../../src/components/ui/ExportImportProperties';
import { parseExportReceiptPayload } from '../../../src/schemas/tauriEventSchemas';
import { useProcessStore } from '../../../src/store/useProcessStore';
import {
  hasCommittedExportOutputs,
  shouldRefreshLibraryForExportReceipt,
} from '../../../src/utils/export/exportTerminalReceipt';

test('cancelled terminal receipt preserves committed outputs for UI actions and library refresh', () => {
  const receipt = parseExportReceiptPayload({
    completedAt: '2026-07-09T18:10:00.000Z',
    outputs: [
      {
        auxiliaryOutputPaths: ['/tmp/exported-look_mask_0_alpha.png'],
        byteSize: 256,
        format: 'cube',
        outputPath: '/tmp/exported-look.cube',
        sourcePath: '/tmp/source.arw',
      },
    ],
    terminalStatus: 'cancelled',
    total: 3,
  });

  useProcessStore.setState({
    exportState: { errorMessage: '', progress: { current: 1, total: 3 }, status: Status.Exporting },
  });
  useProcessStore.getState().setExportState({ lastReceipt: receipt, status: Status.Cancelled });

  const terminalState = useProcessStore.getState().exportState;
  expect(terminalState.status).toBe(Status.Cancelled);
  expect(terminalState.lastReceipt?.terminalStatus).toBe('cancelled');
  expect(terminalState.lastReceipt?.outputs.map((output) => output.outputPath)).toEqual(['/tmp/exported-look.cube']);
  expect(terminalState.lastReceipt?.outputs[0]?.auxiliaryOutputPaths).toEqual(['/tmp/exported-look_mask_0_alpha.png']);
  expect(terminalState.lastReceipt?.outputs.length).toBeGreaterThan(0);
  expect(hasCommittedExportOutputs(receipt)).toBe(true);
  expect(shouldRefreshLibraryForExportReceipt(receipt, '/tmp')).toBe(true);
  expect(shouldRefreshLibraryForExportReceipt(receipt, '/other')).toBe(false);
  expect(shouldRefreshLibraryForExportReceipt(receipt, 'Album: Favorites')).toBe(false);
});
