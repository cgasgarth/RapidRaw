import negativeLabStockMetadataCatalogJson from '../data/negativeLabStockMetadataCatalog.json';
import {
  type NegativeLabStockMetadataCatalog,
  negativeLabStockMetadataCatalogSchema,
} from '../schemas/negativeLabStockMetadataCatalogSchemas';

export const NEGATIVE_LAB_STOCK_METADATA_CATALOG = negativeLabStockMetadataCatalogSchema.parse(
  negativeLabStockMetadataCatalogJson,
);

export const buildNegativeLabStockMetadataCounts = (catalog: NegativeLabStockMetadataCatalog) => ({
  blackAndWhiteNegativeCount: catalog.entries.filter((entry) => entry.stockClass === 'black_and_white_negative').length,
  cinemaNegativeCount: catalog.entries.filter((entry) => entry.stockClass === 'cinema_negative').length,
  colorNegativeCount: catalog.entries.filter((entry) => entry.stockClass === 'color_negative').length,
  slideReversalCount: catalog.entries.filter((entry) => entry.stockClass === 'slide_reversal').length,
  totalCount: catalog.entries.length,
});
