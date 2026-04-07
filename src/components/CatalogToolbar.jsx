const SORT_OPTIONS = [
  ['name-asc', 'Name A-Z'],
  ['name-desc', 'Name Z-A'],
  ['vendor', 'Vendor'],
  ['manufacturer', 'Manufacturer'],
  ['lowest-price', 'Lowest Price'],
  ['highest-price', 'Highest Price'],
  ['tier', 'Tier/Group'],
];

export default function CatalogToolbar({ viewMode, onChangeView, sortBy, onChangeSort, onExport, summary }) {
  return (
    <section className="panel toolbar">
      <div className="toolbar-group">
        <button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => onChangeView('table')}>
          Table
        </button>
        <button type="button" className={viewMode === 'card' ? 'active' : ''} onClick={() => onChangeView('card')}>
          Cards
        </button>
      </div>

      <div className="toolbar-group">
        <label htmlFor="sortBy">Sort</label>
        <select id="sortBy" value={sortBy} onChange={(e) => onChangeSort(e.target.value)}>
          {SORT_OPTIONS.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <button type="button" onClick={onExport}>
        Export CSV
      </button>

      <div className="toolbar-stats">
        {summary.lowest && <span>Lowest: ${summary.lowest}</span>}
        {summary.highest && <span>Highest: ${summary.highest}</span>}
      </div>
    </section>
  );
}
