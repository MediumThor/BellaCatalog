const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function exportCatalogCsv(items, visibleFields) {
  const headers = [
    'id',
    'displayName',
    'vendor',
    'manufacturer',
    'material',
    'thickness',
    'finish',
    'size',
    'tierOrGroup',
    'collection',
    'sku',
    'vendorItemNumber',
    'bundleNumber',
    'prices',
    'notes',
    'freightInfo',
  ];

  const rows = items.map((item) => {
    const prices = item.priceEntries
      .map((p) => `${p.label}:${p.price ?? 'N/A'} ${p.unit}`.trim())
      .join(' | ');

    return [
      item.id,
      item.displayName,
      item.vendor,
      visibleFields.manufacturer ? item.manufacturer : '',
      visibleFields.material ? item.material : '',
      visibleFields.thickness ? item.thickness : '',
      visibleFields.finish ? item.finish : '',
      visibleFields.size ? item.size : '',
      visibleFields.tierOrGroup ? item.tierOrGroup : '',
      visibleFields.collection ? item.collection : '',
      visibleFields.sku ? item.sku : '',
      visibleFields.vendorItemNumber ? item.vendorItemNumber : '',
      visibleFields.bundleNumber ? item.bundleNumber : '',
      prices,
      visibleFields.notes ? item.notes : '',
      visibleFields.freightInfo ? item.freightInfo : '',
    ].map(quote);
  });

  const csv = [headers.map(quote).join(','), ...rows.map((row) => row.join(','))].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'bella-catalog-export.csv');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
