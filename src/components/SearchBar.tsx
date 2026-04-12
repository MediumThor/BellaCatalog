import { memo, useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  onAiSearch?: () => void;
  aiBusy?: boolean;
  aiDisabledReason?: string;
  /** Compact header row: hides hint, screen-reader label only */
  variant?: "default" | "header";
};

function SearchBarInner({
  value,
  onChange,
  id = "catalog-search",
  onAiSearch,
  aiBusy = false,
  aiDisabledReason,
  variant = "default",
}: Props) {
  const [focused, setFocused] = useState(false);
  const aiDisabled = Boolean(aiDisabledReason) || !value.trim() || aiBusy;
  const isHeader = variant === "header";
  return (
    <div
      className={`toolbar-group catalog-search-wrap catalog-search-wrap--grow${isHeader ? " search-bar--header" : ""}`}
      data-focused={focused ? "true" : "false"}
    >
      <label htmlFor={id} className={isHeader ? "sr-only" : undefined}>
        Search catalog
      </label>
      <div className="catalog-search-row">
        <input
          id={id}
          className="search-input catalog-search-input"
          type="search"
          placeholder="Name, SKU, vendor, material, tier, notes…"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {onAiSearch ? (
          <button
            type="button"
            className="btn"
            onClick={onAiSearch}
            disabled={aiDisabled}
            title={aiDisabledReason || "Use Gemini to turn this request into catalog filters"}
          >
            {aiBusy ? "Thinking..." : "AI search"}
          </button>
        ) : null}
      </div>
      {onAiSearch && !isHeader ? (
        <div className="filter-hint">
          {aiDisabledReason || "Use natural language like: brown stone with soft movement"}
        </div>
      ) : null}
    </div>
  );
}

export const SearchBar = memo(SearchBarInner);
