import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { saveAgentSelectedImageAuditReceipt } from '../../../src/components/panel/right/ai/useAgentSelectedImageWorkspaceController';

test('native audit export writes and reads back a real JSON file path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rawengine-agent-audit-'));
  const path = join(directory, 'selected-image-audit.json');
  const payload = '{"kind":"agent.selectedImageLiveSession.auditReceipt"}\n';

  try {
    const result = await saveAgentSelectedImageAuditReceipt({
      filename: 'selected-image-audit.json',
      nativeAvailable: true,
      nativeSave: async (_filename, text) => {
        await writeFile(path, text, 'utf8');
        return { destination: path, text: await readFile(path, 'utf8') };
      },
      text: payload,
    });

    expect(result).toEqual({ destination: path, mode: 'native', text: payload });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      kind: 'agent.selectedImageLiveSession.auditReceipt',
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
