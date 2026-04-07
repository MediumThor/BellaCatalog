const FILTER_SECTIONS = [
  ['manufacturer', 'Manufacturer'],
  ['material', 'Material'],
  ['thickness', 'Thickness'],
  ['tierOrGroup', 'Tier/Group'],
  ['finish', 'Finish'],
  ['sizeClass', 'Size Class'],
];

export default function FilterPanel({ options, filters, setFilters, priceLabels, visibleFields, setVisibleFields }) {
  const toggleArray = (key, value) => {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter((x) => x !== value) : [...prev[key], value],
    }));
  };

  return (
    <section className="panel filter-panel">
      <div className="filter-grid">
        {FILTER_SECTIONS.map(([key, label]) => (
          <fieldset key={key}>
            <legend>{label}</legend>
            <div className="option-list">
              {options[key].map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={filters[key].includes(value)}
                    onChange={() => toggleArray(key, value)}
                  />
                  {value}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset>
          <legend>Price Types</legend>
          <div className="option-list">
            {priceLabels.map((label) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={filters.priceTypes.includes(label)}
                  onChange={() => toggleArray('priceTypes', label)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Special</legend>
          <label>
            <input
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, favoritesOnly: e.target.checked }))}
            />
            Favorites only
          </label>
        </fieldset>

        <fieldset>
          <legend>Visible Fields</legend>
          <div className="option-list">
            {Object.keys(visibleFields).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={visibleFields[key]}
                  onChange={() => setVisibleFields((prev) => ({ ...prev, [key]: !prev[key] }))}
                />
                {key}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
