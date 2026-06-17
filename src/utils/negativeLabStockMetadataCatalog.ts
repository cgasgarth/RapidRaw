import negativeLabStockMetadataCatalogJson from '../data/negativeLabStockMetadataCatalog.json';
import { negativeLabStockMetadataCatalogSchema } from '../schemas/negativeLabStockMetadataCatalogSchemas';

export const NEGATIVE_LAB_STOCK_METADATA_CATALOG = negativeLabStockMetadataCatalogSchema.parse(
  negativeLabStockMetadataCatalogJson,
);
