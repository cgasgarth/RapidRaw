import { expect, test } from 'bun:test';

import {
  xmpMetadataConflictDecisionSchema,
  xmpMetadataConflictReportSchema,
} from '../../src/schemas/xmpMetadataConflictSchemas';

test('parses XMP conflict reports with field-level merge options', () => {
  const report = xmpMetadataConflictReportSchema.parse({
    path: '/photos/image.raf',
    xmpPath: '/photos/image.xmp',
    fields: [
      { field: 'rating', label: 'Rating', local: 2, external: 5 },
      {
        field: 'keywords',
        label: 'Keywords',
        local: ['alaska'],
        external: ['mountain'],
        merged: ['alaska', 'mountain'],
      },
    ],
  });

  expect(report.fields).toHaveLength(2);
  expect(report.fields[1]?.merged).toEqual(['alaska', 'mountain']);
});

test('rejects unsupported XMP conflict choices', () => {
  expect(() => xmpMetadataConflictDecisionSchema.parse({ field: 'rating', choice: 'overwrite' })).toThrow();
});
