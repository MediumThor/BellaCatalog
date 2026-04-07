export default function SearchBar({ value, onChange, resultCount }) {
  return (
    <section className="panel search-panel">
      <label htmlFor="catalog-search">Search Catalog</label>
      <input
        id="catalog-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, vendor, SKU, material, notes..."
      />
      <span className="result-count">{resultCount} matching rows</span>
    </section>
  );
}
