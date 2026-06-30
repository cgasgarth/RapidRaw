import { expect, test } from 'bun:test';

import { parseLoadImageResult } from '../../../src/schemas/imageLoaderSchemas';

test('load image result preserves offline smart preview state', () => {
  const parsed = parseLoadImageResult({
    exif: { RawEngineOfflineSmartPreview: 'true' },
    height: 1707,
    is_offline_smart_preview: true,
    is_raw: false,
    metadata: { adjustments: null },
    width: 2560,
  });

  expect(parsed.is_offline_smart_preview).toBe(true);
  expect(parsed.is_raw).toBe(false);
});
