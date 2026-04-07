import { useEffect, useMemo, useState } from 'react';
import AppShell from './components/AppShell';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import VendorSelector from './components/VendorSelector';
import FilterPanel from './components/FilterPanel';
import ActiveFilterChips from './components/ActiveFilterChips';
import CatalogToolbar from './components/CatalogToolbar';
import TableView from './components/TableView';
import CardView from './components/CardView';
import ImportWarningsPanel from './components/ImportWarningsPanel';
import Footer from './components/Footer';
import rawCatalog from './data/catalog.json';
import { normalizeCatalogData } from './utils/normalizeCatalogData';
import { applySearch } from './utils/searchCatalog';
import { applyFilters, buildFilterOptions, defaultFilters } from './utils/filterCatalog';
import { sortCatalog } from './utils/sortCatalog';
import { getLowestPrice, getHighestPrice } from './utils/priceHelpers';
import { exportCatalogCsv } from './utils/exportCsv';
import { useLocalStorageState } from './utils/localStorageState';

const DEFAULT_SORT = 'name-asc';
const DEFAULT_VIEW = 'table';
const DEFAULT_VISIBLE_FIELDS = {
  manufacturer: true,
  material: true,
  thickness: true,
  finish: true,
  size: true,
  tierOrGroup: true,
  collection: true,
  sku: true,
  vendorItemNumber: false,
  bundleNumber: false,
  notes: true,
  freightInfo: true,
};

export default function App() {
  const { items, importWarnings } = useMemo(() => normalizeCatalogData(rawCatalog), []);

  const [search, setSearch] = useLocalStorageState('bella_search', '');
  const [activeVendor, setActiveVendor] = useLocalStorageState('bella_active_vendor', 'All Vendors');
  const [filters, setFilters] = useLocalStorageState('bella_filters', defaultFilters);
  const [sortBy, setSortBy] = useLocalStorageState('bella_sort', DEFAULT_SORT);
  const [viewMode, setViewMode] = useLocalStorageState('bella_view', DEFAULT_VIEW);
  const [favorites, setFavorites] = useLocalStorageState('bella_favorites', []);
  const [visibleFields, setVisibleFields] = useLocalStorageState('bella_visible_fields', DEFAULT_VISIBLE_FIELDS);
  const [expandedNotes, setExpandedNotes] = useState(() => new Set());

  const filterOptions = useMemo(() => buildFilterOptions(items), [items]);

  const searched = useMemo(() => applySearch(items, search), [items, search]);
  const filtered = useMemo(
    () =>
      applyFilters(searched, {
        ...filters,
        vendor: activeVendor === 'All Vendors' ? [] : [activeVendor],
        favorites,
      }),
    [searched, filters, activeVendor, favorites]
  );

  const sorted = useMemo(() => sortCatalog(filtered, sortBy), [filtered, sortBy]);

  const vendors = useMemo(
    () => ['All Vendors', ...Array.from(new Set(items.map((item) => item.vendor))).sort()],
    [items]
  );

  const priceLabels = useMemo(
    () => Array.from(new Set(items.flatMap((i) => i.priceEntries.map((p) => p.label)))).sort(),
    [items]
  );

  const toggleFavorite = (id) => {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearFilters = () => {
    setFilters(defaultFilters());
    setSearch('');
    setActiveVendor('All Vendors');
  };

  const removeChip = (chip) => {
    if (chip.type === 'search') setSearch('');
    if (chip.type === 'favoritesOnly') setFilters((prev) => ({ ...prev, favoritesOnly: false }));
    if (chip.type === 'priceTypes') {
      setFilters((prev) => ({ ...prev, priceTypes: prev.priceTypes.filter((v) => v !== chip.value) }));
    }
    if (chip.type === 'vendor' && chip.value === activeVendor) setActiveVendor('All Vendors');
    if (chip.filterKey) {
      setFilters((prev) => ({
        ...prev,
        [chip.filterKey]: prev[chip.filterKey].filter((value) => value !== chip.value),
      }));
    }
  };

  const activeChips = useMemo(() => {
    const chips = [];
    if (search) chips.push({ type: 'search', label: `Search: ${search}` });
    if (activeVendor !== 'All Vendors') chips.push({ type: 'vendor', value: activeVendor, label: `Vendor: ${activeVendor}` });
    if (filters.favoritesOnly) chips.push({ type: 'favoritesOnly', label: 'Favorites only' });

    ['manufacturer', 'material', 'thickness', 'tierOrGroup', 'finish', 'sizeClass'].forEach((key) => {
      filters[key].forEach((value) => chips.push({ filterKey: key, value, label: `${key}: ${value}` }));
    });

    filters.priceTypes.forEach((value) => chips.push({ type: 'priceTypes', value, label: `price: ${value}` }));

    return chips;
  }, [search, activeVendor, filters]);

  const resultStats = useMemo(() => {
    const lows = sorted.map(getLowestPrice).filter((v) => typeof v === 'number');
    const highs = sorted.map(getHighestPrice).filter((v) => typeof v === 'number');
    return {
      count: sorted.length,
      lowest: lows.length ? Math.min(...lows).toFixed(2) : null,
      highest: highs.length ? Math.max(...highs).toFixed(2) : null,
    };
  }, [sorted]);

  useEffect(() => {
    setExpandedNotes(new Set());
  }, [viewMode, sortBy, search, filters, activeVendor]);

  return (
    <AppShell>
      <Header />
      <ImportWarningsPanel warnings={importWarnings} />
      <SearchBar value={search} onChange={setSearch} resultCount={resultStats.count} />
      <VendorSelector vendors={vendors} activeVendor={activeVendor} onChange={setActiveVendor} />
      <FilterPanel
        options={filterOptions}
        filters={filters}
        setFilters={setFilters}
        priceLabels={priceLabels}
        visibleFields={visibleFields}
        setVisibleFields={setVisibleFields}
      />
      <ActiveFilterChips chips={activeChips} onRemove={removeChip} onClearAll={clearFilters} />
      <CatalogToolbar
        viewMode={viewMode}
        onChangeView={setViewMode}
        sortBy={sortBy}
        onChangeSort={setSortBy}
        onExport={() => exportCatalogCsv(sorted, visibleFields)}
        summary={resultStats}
      />

      {sorted.length === 0 ? (
        <div className="empty-state">No matching catalog items. Adjust filters or clear all.</div>
      ) : viewMode === 'table' ? (
        <TableView
          items={sorted}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          visibleFields={visibleFields}
          expandedNotes={expandedNotes}
          setExpandedNotes={setExpandedNotes}
        />
      ) : (
        <CardView
          items={sorted}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          visibleFields={visibleFields}
        />
      )}
      <Footer total={items.length} filtered={sorted.length} />
    </AppShell>
  );
}
