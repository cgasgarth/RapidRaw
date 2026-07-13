import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function writeNativeFeedbackReceipt(path: string, receipt: unknown): Promise<void> {
  const output = resolve(path);
  const candidate = `${output}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  try {
    await writeFile(candidate, `${JSON.stringify(receipt, null, 2)}\n`);
    await rename(candidate, output);
  } finally {
    await rm(candidate, { force: true });
  }
}
