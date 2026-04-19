import { memo, useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  /** Compact header row: hides hint, screen-reader label only */
  variant?: "default" | "header";
  /** Visible label / sr-only label when in header variant. */
  label?: string;
  /** Input placeholder text. */
  placeholder?: string;
};

function SearchBarInner({
  value,
  onChange,
  id = "catalog-search",
  variant = "default",
  label = "Search catalog",
  placeholder = "Name, SKU, vendor, material, tier, notes…",
}: Props) {
  const [focused, setFocused] = useState(false);
  const isHeader = variant === "header";
  return (
    <div
      className={`toolbar-group catalog-search-wrap catalog-search-wrap--grow${isHeader ? " search-bar--header" : ""}`}
      data-focused={focused ? "true" : "false"}
    >
      <label htmlFor={id} className={isHeader ? "sr-only" : undefined}>
        {label}
      </label>
      <div className="catalog-search-row">
        <input
          id={id}
          className="search-input catalog-search-input"
          type="search"
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
    </div>
  );
}

export const SearchBar = memo(SearchBarInner);
