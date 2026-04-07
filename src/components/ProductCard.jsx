import FavoriteStar from './FavoriteStar';
import PriceBadgeGroup from './PriceBadgeGroup';
import VendorNotesPanel from './VendorNotesPanel';

export default function ProductCard({ item, isFavorite, onToggleFavorite, visibleFields }) {
  return (
    <article className="catalog-card">
      <div className="card-header">
        <h3>{item.displayName}</h3>
        <FavoriteStar active={isFavorite} onClick={() => onToggleFavorite(item.id)} />
      </div>

      <div className="card-meta">
        <p><strong>Vendor:</strong> {item.vendor}</p>
        {visibleFields.manufacturer && <p><strong>Manufacturer:</strong> {item.manufacturer || '-'}</p>}
        {visibleFields.material && <p><strong>Material:</strong> {item.material || '-'}</p>}
        {visibleFields.thickness && <p><strong>Thickness:</strong> {item.thickness || '-'}</p>}
        {visibleFields.finish && <p><strong>Finish:</strong> {item.finish || '-'}</p>}
        {visibleFields.size && <p><strong>Size:</strong> {item.size || '-'}</p>}
        {visibleFields.collection && <p><strong>Collection:</strong> {item.collection || '-'}</p>}
        {visibleFields.tierOrGroup && <p><strong>Tier/Group:</strong> {item.tierOrGroup || '-'}</p>}
        {visibleFields.sku && <p><strong>SKU:</strong> {item.sku || '-'}</p>}
      </div>

      <PriceBadgeGroup prices={item.priceEntries} />
      <VendorNotesPanel notes={visibleFields.notes ? item.notes : ''} freightInfo={visibleFields.freightInfo ? item.freightInfo : ''} />
    </article>
  );
}
