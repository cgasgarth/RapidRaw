import { z } from 'zod';

export const smartAlbumMatchModeSchema = z.enum(['all', 'any']);
export const smartAlbumSortOrderSchema = z.enum(['asc', 'desc']);
export const smartAlbumSortKeySchema = z.enum(['name', 'captured_at', 'rating', 'color_label', 'file_extension']);
export const smartAlbumConditionFieldSchema = z.enum([
  'aperture',
  'camera_make',
  'camera_model',
  'captured_at',
  'color_label',
  'edited_status',
  'file_extension',
  'focal_length_mm',
  'iso',
  'lens',
  'rating',
  'raw_status',
  'tag',
]);
export const smartAlbumConditionOperatorSchema = z.enum([
  'between',
  'contains',
  'equals',
  'gte',
  'is_empty',
  'is_not_empty',
  'lte',
  'not_contains',
  'not_equals',
]);

const numberFieldSchema = z.enum(['aperture', 'focal_length_mm', 'iso', 'rating']);
const textFieldSchema = z.enum([
  'camera_make',
  'camera_model',
  'captured_at',
  'color_label',
  'edited_status',
  'file_extension',
  'lens',
  'raw_status',
  'tag',
]);
const numberOperatorSchema = z.enum(['between', 'equals', 'gte', 'lte', 'not_equals']);
const textOperatorSchema = z.enum(['contains', 'equals', 'is_empty', 'is_not_empty', 'not_contains', 'not_equals']);

export const smartAlbumConditionSchema = z
  .object({
    field: smartAlbumConditionFieldSchema,
    negate: z.boolean().default(false),
    operator: smartAlbumConditionOperatorSchema,
    value: z.union([z.string(), z.number(), z.tuple([z.number(), z.number()])]).nullable(),
  })
  .strict()
  .superRefine((condition, context) => {
    const isNumberField = numberFieldSchema.safeParse(condition.field).success;
    const isTextField = textFieldSchema.safeParse(condition.field).success;
    const isNumberOperator = numberOperatorSchema.safeParse(condition.operator).success;
    const isTextOperator = textOperatorSchema.safeParse(condition.operator).success;

    if (isNumberField && !isNumberOperator) {
      context.addIssue({
        code: 'custom',
        message: 'Numeric smart-album fields require numeric operators.',
        path: ['operator'],
      });
    }
    if (isTextField && !isTextOperator) {
      context.addIssue({
        code: 'custom',
        message: 'Text smart-album fields require text operators.',
        path: ['operator'],
      });
    }

    if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
      if (condition.value !== null) {
        context.addIssue({ code: 'custom', message: 'Empty checks must use a null value.', path: ['value'] });
      }
      return;
    }

    if (condition.operator === 'between') {
      if (!Array.isArray(condition.value) || condition.value[0] > condition.value[1]) {
        context.addIssue({ code: 'custom', message: 'between requires an ascending numeric tuple.', path: ['value'] });
      }
      return;
    }

    if (isNumberField && isNumberOperator && typeof condition.value !== 'number') {
      context.addIssue({ code: 'custom', message: 'Numeric operators require a number value.', path: ['value'] });
    }
    if (isTextField && isTextOperator && typeof condition.value !== 'string') {
      context.addIssue({ code: 'custom', message: 'Text operators require a string value.', path: ['value'] });
    }
  });

export const smartAlbumSortSchema = z
  .object({
    key: smartAlbumSortKeySchema,
    order: smartAlbumSortOrderSchema,
  })
  .strict();

export const smartAlbumSchema = z
  .object({
    conditions: z.array(smartAlbumConditionSchema).min(1),
    createdAt: z.iso.datetime(),
    id: z.string().trim().min(1),
    includeVirtualCopies: z.boolean(),
    limit: z.number().int().min(1).max(10000).nullable(),
    match: smartAlbumMatchModeSchema,
    name: z.string().trim().min(1),
    sort: smartAlbumSortSchema,
    updatedAt: z.iso.datetime(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((album, context) => {
    if (Date.parse(album.updatedAt) < Date.parse(album.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }
  });

export const smartAlbumCatalogSchema = z
  .object({
    albums: z.array(smartAlbumSchema),
    defaultAlbumId: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, album] of catalog.albums.entries()) {
      if (ids.has(album.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate smart album id: ${album.id}`,
          path: ['albums', index, 'id'],
        });
      }
      ids.add(album.id);
    }
    if (catalog.defaultAlbumId !== null && !ids.has(catalog.defaultAlbumId)) {
      context.addIssue({
        code: 'custom',
        message: 'defaultAlbumId must reference an album.',
        path: ['defaultAlbumId'],
      });
    }
  });

export const smartAlbumAssetSchema = z
  .object({
    aperture: z.number().positive().nullable(),
    cameraMake: z.string().nullable(),
    cameraModel: z.string().nullable(),
    capturedAt: z.iso.datetime().nullable(),
    colorLabel: z.string().nullable(),
    editedStatus: z.enum(['edited', 'unedited']),
    fileExtension: z.string().trim().min(1),
    focalLengthMm: z.number().positive().nullable(),
    isVirtualCopy: z.boolean(),
    iso: z.number().int().positive().nullable(),
    lens: z.string().nullable(),
    path: z.string().trim().min(1),
    rating: z.number().int().min(0).max(5),
    rawStatus: z.enum(['raw', 'rendered']),
    tags: z.array(z.string().trim().min(1)),
  })
  .strict();

export const smartAlbumAssetSetSchema = z.array(smartAlbumAssetSchema);

export type SmartAlbum = z.infer<typeof smartAlbumSchema>;
export type SmartAlbumAsset = z.infer<typeof smartAlbumAssetSchema>;
export type SmartAlbumCatalog = z.infer<typeof smartAlbumCatalogSchema>;
export type SmartAlbumCondition = z.infer<typeof smartAlbumConditionSchema>;
type SmartAlbumNumberField = z.infer<typeof numberFieldSchema>;
type SmartAlbumTextField = z.infer<typeof textFieldSchema>;

const normalizeText = (value: string) => value.trim().toLocaleLowerCase();

const getTextValues = (asset: SmartAlbumAsset, field: SmartAlbumTextField): string[] => {
  switch (field) {
    case 'camera_make':
      return asset.cameraMake === null ? [] : [asset.cameraMake];
    case 'camera_model':
      return asset.cameraModel === null ? [] : [asset.cameraModel];
    case 'captured_at':
      return asset.capturedAt === null ? [] : [asset.capturedAt];
    case 'color_label':
      return asset.colorLabel === null ? [] : [asset.colorLabel];
    case 'edited_status':
      return [asset.editedStatus];
    case 'file_extension':
      return [asset.fileExtension];
    case 'lens':
      return asset.lens === null ? [] : [asset.lens];
    case 'raw_status':
      return [asset.rawStatus];
    case 'tag':
      return asset.tags;
  }
};

const getNumberValue = (asset: SmartAlbumAsset, field: SmartAlbumNumberField): number | null => {
  switch (field) {
    case 'aperture':
      return asset.aperture;
    case 'focal_length_mm':
      return asset.focalLengthMm;
    case 'iso':
      return asset.iso;
    case 'rating':
      return asset.rating;
  }
};

export const matchesSmartAlbumCondition = (asset: SmartAlbumAsset, condition: SmartAlbumCondition): boolean => {
  let matches = false;
  const numberFieldResult = numberFieldSchema.safeParse(condition.field);
  if (numberFieldResult.success) {
    const assetValue = getNumberValue(asset, numberFieldResult.data);
    if (assetValue !== null) {
      if (condition.operator === 'between' && Array.isArray(condition.value)) {
        matches = assetValue >= condition.value[0] && assetValue <= condition.value[1];
      } else if (condition.operator === 'equals' && typeof condition.value === 'number') {
        matches = assetValue === condition.value;
      } else if (condition.operator === 'gte' && typeof condition.value === 'number') {
        matches = assetValue >= condition.value;
      } else if (condition.operator === 'lte' && typeof condition.value === 'number') {
        matches = assetValue <= condition.value;
      } else if (condition.operator === 'not_equals' && typeof condition.value === 'number') {
        matches = assetValue !== condition.value;
      }
    }
  } else {
    const textFieldResult = textFieldSchema.safeParse(condition.field);
    const values = textFieldResult.success ? getTextValues(asset, textFieldResult.data).map(normalizeText) : [];
    if (condition.operator === 'is_empty') {
      matches = values.length === 0;
    } else if (condition.operator === 'is_not_empty') {
      matches = values.length > 0;
    } else if (typeof condition.value === 'string') {
      const expected = normalizeText(condition.value);
      if (condition.operator === 'contains') {
        matches = values.some((value) => value.includes(expected));
      } else if (condition.operator === 'equals') {
        matches = values.some((value) => value === expected);
      } else if (condition.operator === 'not_contains') {
        matches = values.every((value) => !value.includes(expected));
      } else if (condition.operator === 'not_equals') {
        matches = values.every((value) => value !== expected);
      }
    }
  }

  return condition.negate ? !matches : matches;
};

export const filterSmartAlbumAssets = (album: SmartAlbum, assets: SmartAlbumAsset[]): SmartAlbumAsset[] => {
  const filteredAssets = assets.filter((asset) => {
    if (!album.includeVirtualCopies && asset.isVirtualCopy) return false;
    const conditionResults = album.conditions.map((condition) => matchesSmartAlbumCondition(asset, condition));
    return album.match === 'all' ? conditionResults.every(Boolean) : conditionResults.some(Boolean);
  });

  const sortedAssets = [...filteredAssets].sort((left, right) => {
    const direction = album.sort.order === 'asc' ? 1 : -1;
    switch (album.sort.key) {
      case 'captured_at':
        return direction * ((Date.parse(left.capturedAt ?? '') || 0) - (Date.parse(right.capturedAt ?? '') || 0));
      case 'color_label':
        return direction * (left.colorLabel ?? '').localeCompare(right.colorLabel ?? '');
      case 'file_extension':
        return direction * left.fileExtension.localeCompare(right.fileExtension);
      case 'rating':
        return direction * (left.rating - right.rating);
      case 'name':
        return direction * left.path.localeCompare(right.path);
    }
  });

  return album.limit === null ? sortedAssets : sortedAssets.slice(0, album.limit);
};

export const parseSmartAlbumCatalog = (value: unknown): SmartAlbumCatalog => smartAlbumCatalogSchema.parse(value);
export const parseSmartAlbumAssets = (value: unknown): SmartAlbumAsset[] => smartAlbumAssetSetSchema.parse(value);
