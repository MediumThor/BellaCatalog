import { normalizePriceEntry } from './priceHelpers';

const normalizeText = (value) => (value == null ? '' : String(value).trim());

const toArray = (value) => (Array.isArray(value) ? value : []);

const buildSearchText = (item) => {
  const base = [
    item.productName,
    item.displayName,
    item.vendor,
    item.manufacturer,
    item.material,
    item.thickness,
    item.size,
    item.sku,
    item.vendorItemNumber,
    item.collection,
    item.tierOrGroup,
    item.notes,
    item.finish,
  ]
    .join(' ')
    .toLowerCase();

  const priceText = item.priceEntries.map((p) => `${p.label} ${p.unit}`).join(' ').toLowerCase();
  return `${base} ${priceText}`;
};

function parseCollectionItem(baseRecord, collectionItem, index) {
  return {
    ...baseRecord,
    id: `${baseRecord.id}-c${index + 1}`,
    productName: normalizeText(collectionItem.productName || collectionItem.color || baseRecord.productName),
    displayName: normalizeText(collectionItem.displayName || collectionItem.color || baseRecord.displayName),
    sku: normalizeText(collectionItem.sku || baseRecord.sku),
    tierOrGroup: normalizeText(collectionItem.tierOrGroup || baseRecord.tierOrGroup),
    priceEntries: toArray(collectionItem.priceEntries).map(normalizePriceEntry),
    rawSourceFields: {
      ...baseRecord.rawSourceFields,
      collectionItem,
    },
  };
}

function normalizeRecord(record, index, sourceFile) {
  const baseRecord = {
    id: normalizeText(record.id) || `${sourceFile}-${index + 1}`,
    vendor: normalizeText(record.vendor),
    manufacturer: normalizeText(record.manufacturer),
    sourceFile: normalizeText(record.sourceFile || sourceFile),
    productName: normalizeText(record.productName),
    displayName: normalizeText(record.displayName || record.productName),
    material: normalizeText(record.material),
    category: normalizeText(record.category),
    collection: normalizeText(record.collection),
    tierOrGroup: normalizeText(record.tierOrGroup),
    thickness: normalizeText(record.thickness),
    finish: normalizeText(record.finish),
    size: normalizeText(record.size),
    sku: normalizeText(record.sku),
    vendorItemNumber: normalizeText(record.vendorItemNumber),
    bundleNumber: normalizeText(record.bundleNumber),
    priceEntries: toArray(record.priceEntries).map(normalizePriceEntry),
    notes: normalizeText(record.notes),
    freightInfo: normalizeText(record.freightInfo),
    availabilityFlags: toArray(record.availabilityFlags),
    tags: toArray(record.tags),
    rawSourceFields: record.rawSourceFields || {},
  };

  if (Array.isArray(record.collectionItems) && record.collectionItems.length) {
    return record.collectionItems.map((entry, i) => parseCollectionItem(baseRecord, entry, i));
  }

  return [baseRecord];
}

export function normalizeCatalogData(rawData) {
  const items = [];
  const warnings = [];

  (rawData.sources || []).forEach((source) => {
    if (source.status && source.status !== 'ok') {
      warnings.push({
        sourceFile: source.sourceFile || 'unknown-source',
        message: source.warning || 'Source file imported partially.',
      });
    }

    toArray(source.records).forEach((record, index) => {
      try {
        const normalizedRows = normalizeRecord(record, index, source.sourceFile || 'unknown-source');
        normalizedRows.forEach((row) => {
          row.searchText = buildSearchText(row);
          items.push(row);
        });
      } catch {
        warnings.push({
          sourceFile: source.sourceFile || 'unknown-source',
          message: `Row ${index + 1} could not be normalized and was skipped.`,
        });
      }
    });
  });

  return { items, importWarnings: [...(rawData.importWarnings || []), ...warnings] };
}
