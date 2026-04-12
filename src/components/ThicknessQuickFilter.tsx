import { memo, useMemo } from "react";
import {
  thicknessOptionsForCmClass,
  thicknessQuickPresetFromSelection,
} from "../utils/thicknessQuickFilter";

type Props = {
  catalogThicknessOptions: string[];
  selectedThicknesses: string[];
  onChange: (thicknesses: string[]) => void;
};

function ThicknessQuickFilterInner({
  catalogThicknessOptions,
  selectedThicknesses,
  onChange,
}: Props) {
  const opts2 = useMemo(
    () => thicknessOptionsForCmClass(catalogThicknessOptions, 2),
    [catalogThicknessOptions]
  );
  const opts3 = useMemo(
    () => thicknessOptionsForCmClass(catalogThicknessOptions, 3),
    [catalogThicknessOptions]
  );

  const preset = thicknessQuickPresetFromSelection(
    selectedThicknesses,
    catalogThicknessOptions
  );

  return (
    <section
      className="thickness-quick-filter catalog-tools-section"
      aria-labelledby="thickness-quick-title"
    >
      <h3 id="thickness-quick-title" className="catalog-tools-section__title">
        Thickness
      </h3>
      <div className="thickness-quick-filter__buttons" role="group" aria-label="Thickness filter">
        <button
          type="button"
          className="btn thickness-quick-filter__btn"
          data-active={preset === "2cm" ? "true" : "false"}
          disabled={opts2.length === 0}
          title={
            opts2.length === 0
              ? "No 2 cm slabs in the current catalog"
              : preset === "2cm"
                ? "Clear thickness filter"
                : "Show only 2 cm slabs"
          }
          onClick={() => {
            if (opts2.length === 0) return;
            if (preset === "2cm") onChange([]);
            else onChange([...opts2]);
          }}
        >
          2 cm
        </button>
        <button
          type="button"
          className="btn thickness-quick-filter__btn"
          data-active={preset === "3cm" ? "true" : "false"}
          disabled={opts3.length === 0}
          title={
            opts3.length === 0
              ? "No 3 cm slabs in the current catalog"
              : preset === "3cm"
                ? "Clear thickness filter"
                : "Show only 3 cm slabs"
          }
          onClick={() => {
            if (opts3.length === 0) return;
            if (preset === "3cm") onChange([]);
            else onChange([...opts3]);
          }}
        >
          3 cm
        </button>
      </div>
      {preset === "custom" && selectedThicknesses.length > 0 ? (
        <p className="thickness-quick-filter__custom-hint" role="status">
          Custom thickness selection is active. Use Clear filters or pick 2 cm / 3 cm to reset.
        </p>
      ) : null}
    </section>
  );
}

export const ThicknessQuickFilter = memo(ThicknessQuickFilterInner);
