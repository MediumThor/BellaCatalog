import { memo } from "react";
import type { ColumnVisibility } from "../types/catalog";

export const COLUMN_TOGGLE_ENTRIES: { key: keyof ColumnVisibility; label: string }[] = [
  { key: "manufacturer", label: "Manufacturer" },
  { key: "category", label: "Category" },
  { key: "collection", label: "Collection" },
  { key: "tierOrGroup", label: "Tier / group" },
  { key: "material", label: "Material" },
  { key: "thickness", label: "Thickness" },
  { key: "finish", label: "Finish" },
  { key: "size", label: "Size" },
  { key: "sku", label: "SKU" },
  { key: "vendorItemNumber", label: "Vendor item #" },
  { key: "bundleNumber", label: "Bundle #" },
  { key: "glue", label: "Glue" },
  { key: "notes", label: "Notes" },
  { key: "freight", label: "Freight" },
];

type Props = {
  columns: ColumnVisibility;
  onColumnToggle: (key: keyof ColumnVisibility, value: boolean) => void;
  /** Extra class on the wrapping <details> */
  className?: string;
};

function OptionalColumnsFieldsInner({ columns, onColumnToggle, className = "" }: Props) {
  return (
    <details className={className}>
      <summary>Optional columns &amp; fields</summary>
      <div className="column-toggle-grid">
        {COLUMN_TOGGLE_ENTRIES.map(({ key, label }) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={columns[key]}
              onChange={(e) => onColumnToggle(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}

export const OptionalColumnsFields = memo(OptionalColumnsFieldsInner);
