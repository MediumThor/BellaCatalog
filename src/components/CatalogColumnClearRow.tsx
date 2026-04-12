import { memo } from "react";
import type { ColumnVisibility } from "../types/catalog";
import { OptionalColumnsFields } from "./OptionalColumnsFields";

type Props = {
  columns: ColumnVisibility;
  onColumnToggle: (key: keyof ColumnVisibility, value: boolean) => void;
  onClearFilters: () => void;
};

function CatalogColumnClearRowInner({ columns, onColumnToggle, onClearFilters }: Props) {
  return (
    <div className="catalog-tools-columns-clear-row">
      <div className="column-toggle catalog-tools-column-details-wrap">
        <OptionalColumnsFields columns={columns} onColumnToggle={onColumnToggle} />
      </div>
      <button type="button" className="btn btn-ghost catalog-tools-clear-filters-btn" onClick={onClearFilters}>
        Clear filters
      </button>
    </div>
  );
}

export const CatalogColumnClearRow = memo(CatalogColumnClearRowInner);
