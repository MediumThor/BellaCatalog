import { memo } from "react";
import type { CatalogViewMode } from "../types/catalog";

type Props = {
  catalogView: CatalogViewMode;
  onCatalogViewChange: (v: CatalogViewMode) => void;
};

function CatalogViewToggleInner({ catalogView, onCatalogViewChange }: Props) {
  return (
    <div className="toolbar-group view-toggle-group catalog-view-toggle" role="group" aria-label="Grid or list layout">
      <div className="view-toggle">
        <button
          type="button"
          className="btn view-toggle__btn"
          data-active={catalogView === "grid"}
          aria-pressed={catalogView === "grid"}
          onClick={() => onCatalogViewChange("grid")}
        >
          Grid
        </button>
        <button
          type="button"
          className="btn view-toggle__btn"
          data-active={catalogView === "table"}
          aria-pressed={catalogView === "table"}
          onClick={() => onCatalogViewChange("table")}
        >
          List
        </button>
      </div>
    </div>
  );
}

export const CatalogViewToggle = memo(CatalogViewToggleInner);
