import { memo, useEffect, useMemo, useState } from "react";
import type { CatalogCollection, CatalogItem } from "../types/catalog";
import { searchCatalog } from "../utils/searchCatalog";

type Props = {
  open: boolean;
  /** The active manual collection we are adding slabs to. */
  collection: CatalogCollection | null;
  /** All catalog items the user can pick from (typically the full loaded catalog). */
  catalogItems: CatalogItem[];
  onClose: () => void;
  /** Called with the *new* item ids the user wants to add (ids already in the collection are not included). */
  onAdd: (newItemIds: string[]) => Promise<void> | void;
};

/** Cap the rendered list so very large catalogs stay snappy. The user can narrow with search/filters. */
const RENDER_LIMIT = 400;

function CatalogAddSlabsToCollectionModalInner({
  open,
  collection,
  catalogItems,
  onClose,
  onAdd,
}: Props) {
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState<string>("__all__");
  const [thickness, setThickness] = useState<string>("__all__");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setVendor("__all__");
    setThickness("__all__");
    setSelectedIds(new Set());
    setSaving(false);
  }, [open, collection?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  const existingIdSet = useMemo(
    () => new Set(collection?.itemIds ?? []),
    [collection?.itemIds]
  );

  const vendors = useMemo(() => {
    const set = new Set<string>();
    for (const item of catalogItems) {
      if (item.vendor) set.add(item.vendor);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogItems]);

  const thicknesses = useMemo(() => {
    const set = new Set<string>();
    for (const item of catalogItems) {
      if (item.thickness) set.add(item.thickness);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogItems]);

  const filteredItems = useMemo(() => {
    let working = catalogItems;
    if (vendor !== "__all__") {
      working = working.filter((item) => item.vendor === vendor);
    }
    if (thickness !== "__all__") {
      working = working.filter((item) => item.thickness === thickness);
    }
    return searchCatalog(working, search);
  }, [catalogItems, vendor, thickness, search]);

  const visibleItems = filteredItems.slice(0, RENDER_LIMIT);
  const truncated = filteredItems.length > RENDER_LIMIT;

  /** Item ids that are eligible to be selected on screen right now (excludes already-in-collection). */
  const visibleSelectableIds = useMemo(
    () => visibleItems.filter((item) => !existingIdSet.has(item.id)).map((item) => item.id),
    [visibleItems, existingIdSet]
  );

  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    visibleSelectableIds.every((id) => selectedIds.has(id));

  const newSelectedCount = selectedIds.size;
  const alreadyInCount = visibleItems.filter((item) => existingIdSet.has(item.id)).length;

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleSelectableIds) next.delete(id);
      } else {
        for (const id of visibleSelectableIds) next.add(id);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setVendor("__all__");
    setThickness("__all__");
  };

  if (!open || !collection) return null;

  const saveDisabled = newSelectedCount === 0 || saving;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--wide catalog-add-slabs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-add-slabs-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="catalog-add-slabs__header">
          <div>
            <h2 id="catalog-add-slabs-title" className="modal-title">
              Add slabs to “{collection.name}”
            </h2>
            <p className="modal-sub">
              Search and check the slabs you want to add. Slabs already in this collection are
              shown with a badge so you can see what you have.
            </p>
          </div>
          <div className="catalog-add-slabs__count-pill" aria-live="polite">
            <strong>{newSelectedCount}</strong>{" "}
            new slab{newSelectedCount === 1 ? "" : "s"} selected
          </div>
        </div>

        <div className="catalog-add-slabs__filters" role="group" aria-label="Filter slabs">
          <input
            type="search"
            className="search-input catalog-add-slabs__search"
            placeholder="Search by name, vendor, color, sku…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={saving}
            autoFocus
          />
          <select
            className="search-input"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            disabled={saving}
            aria-label="Vendor"
          >
            <option value="__all__">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            className="search-input"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
            disabled={saving}
            aria-label="Thickness"
          >
            <option value="__all__">All thicknesses</option>
            {thicknesses.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={clearFilters}
            disabled={saving || (search === "" && vendor === "__all__" && thickness === "__all__")}
          >
            Clear
          </button>
        </div>

        <div className="catalog-add-slabs__toolbar">
          <button
            type="button"
            className="btn"
            onClick={toggleSelectAllVisible}
            disabled={saving || visibleSelectableIds.length === 0}
            title={
              visibleSelectableIds.length === 0
                ? "Nothing on screen to add"
                : allVisibleSelected
                  ? "Uncheck all visible"
                  : "Check all visible"
            }
          >
            {allVisibleSelected
              ? `Unselect ${visibleSelectableIds.length} visible`
              : `Select all ${visibleSelectableIds.length} visible`}
          </button>
          <span className="catalog-add-slabs__meta">
            Showing {visibleItems.length}
            {truncated ? ` of ${filteredItems.length} (refine filters to see more)` : ""}
            {alreadyInCount > 0
              ? ` · ${alreadyInCount} already in this collection`
              : ""}
          </span>
        </div>

        <div className="catalog-add-slabs__list" role="listbox" aria-multiselectable="true">
          {visibleItems.length === 0 ? (
            <div className="empty-state">
              No slabs match these filters. Try clearing search or filters.
            </div>
          ) : (
            visibleItems.map((item) => {
              const inCollection = existingIdSet.has(item.id);
              const checked = inCollection || selectedIds.has(item.id);
              const id = `add-slabs-row-${item.id}`;
              return (
                <label
                  key={item.id}
                  htmlFor={id}
                  className="catalog-add-slabs-row"
                  data-in-collection={inCollection || undefined}
                  data-checked={checked || undefined}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    disabled={inCollection || saving}
                    onChange={() => toggleOne(item.id)}
                  />
                  <div className="catalog-add-slabs-row__thumb" aria-hidden="true">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="catalog-add-slabs-row__thumb-empty">No image</span>
                    )}
                  </div>
                  <div className="catalog-add-slabs-row__body">
                    <div className="catalog-add-slabs-row__title">
                      {item.displayName}
                      {inCollection ? (
                        <span className="catalog-collection-badge catalog-collection-badge--shared catalog-add-slabs-row__badge">
                          In collection
                        </span>
                      ) : null}
                    </div>
                    <div className="catalog-add-slabs-row__meta">
                      <span>{item.vendor || "—"}</span>
                      {item.material ? <span> · {item.material}</span> : null}
                      {item.thickness ? <span> · {item.thickness}</span> : null}
                      {item.finish ? <span> · {item.finish}</span> : null}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveDisabled}
            onClick={async () => {
              setSaving(true);
              try {
                await onAdd(Array.from(selectedIds));
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? "Adding…"
              : `Add ${newSelectedCount} slab${newSelectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export const CatalogAddSlabsToCollectionModal = memo(CatalogAddSlabsToCollectionModalInner);
