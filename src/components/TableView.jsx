import ProductRow from './ProductRow';

export default function TableView({ items, favorites, onToggleFavorite, visibleFields, expandedNotes, setExpandedNotes }) {
  const toggleExpanded = (id) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>★</th>
            <th>Name</th>
            <th>Vendor</th>
            {visibleFields.manufacturer && <th>Manufacturer</th>}
            {visibleFields.material && <th>Material</th>}
            {visibleFields.thickness && <th>Thickness</th>}
            {visibleFields.finish && <th>Finish</th>}
            {visibleFields.size && <th>Size</th>}
            {visibleFields.tierOrGroup && <th>Tier/Group</th>}
            {visibleFields.collection && <th>Collection</th>}
            {visibleFields.sku && <th>SKU</th>}
            {visibleFields.vendorItemNumber && <th>Vendor Item</th>}
            {visibleFields.bundleNumber && <th>Bundle #</th>}
            <th>Prices</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              isFavorite={favorites.includes(item.id)}
              onToggleFavorite={onToggleFavorite}
              visibleFields={visibleFields}
              expanded={expandedNotes.has(item.id)}
              onToggleExpanded={() => toggleExpanded(item.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
