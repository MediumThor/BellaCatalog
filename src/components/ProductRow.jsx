import FavoriteStar from './FavoriteStar';
import PriceBadgeGroup from './PriceBadgeGroup';
import VendorNotesPanel from './VendorNotesPanel';

export default function ProductRow({ item, isFavorite, onToggleFavorite, visibleFields, expanded, onToggleExpanded }) {
  return (
    <>
      <tr>
        <td><FavoriteStar active={isFavorite} onClick={() => onToggleFavorite(item.id)} /></td>
        <td>{item.displayName}</td>
        <td>{item.vendor}</td>
        {visibleFields.manufacturer && <td>{item.manufacturer || '-'}</td>}
        {visibleFields.material && <td>{item.material || '-'}</td>}
        {visibleFields.thickness && <td>{item.thickness || '-'}</td>}
        {visibleFields.finish && <td>{item.finish || '-'}</td>}
        {visibleFields.size && <td>{item.size || '-'}</td>}
        {visibleFields.tierOrGroup && <td>{item.tierOrGroup || '-'}</td>}
        {visibleFields.collection && <td>{item.collection || '-'}</td>}
        {visibleFields.sku && <td>{item.sku || '-'}</td>}
        {visibleFields.vendorItemNumber && <td>{item.vendorItemNumber || '-'}</td>}
        {visibleFields.bundleNumber && <td>{item.bundleNumber || '-'}</td>}
        <td><PriceBadgeGroup prices={item.priceEntries} /></td>
        <td>
          <button type="button" onClick={onToggleExpanded}>
            {expanded ? 'Hide notes' : 'Show notes'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={30}>
            <VendorNotesPanel notes={visibleFields.notes ? item.notes : ''} freightInfo={visibleFields.freightInfo ? item.freightInfo : ''} />
          </td>
        </tr>
      )}
    </>
  );
}
