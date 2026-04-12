import { memo, useId, type ChangeEvent } from "react";
import type { UiPreferences } from "../types/catalog";

type OptionSets = {
  manufacturers: string[];
  materials: string[];
  thicknesses: string[];
  tierGroups: string[];
  finishes: string[];
  sizeClasses: string[];
  priceTypes: string[];
};

type Props = {
  options: OptionSets;
  prefs: UiPreferences;
  onChange: (patch: Partial<UiPreferences>) => void;
  /** Drawer: visible section title, no extra panel chrome */
  variant?: "default" | "drawer";
  /** When true, thickness is controlled elsewhere (e.g. 2 cm / 3 cm quick filter). */
  hideThickness?: boolean;
};

function multiProps(
  values: string[],
  onCommit: (next: string[]) => void
): {
  value: string[];
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
} {
  return {
    value: values,
    onChange: (e: ChangeEvent<HTMLSelectElement>) => {
      const next = Array.from(e.target.selectedOptions).map((o) => o.value);
      onCommit(next);
    },
  };
}

function FilterPanelInner({ options, prefs, onChange, variant = "default", hideThickness = false }: Props) {
  const id = useId();
  const inDrawer = variant === "drawer";

  return (
    <section
      className={`filter-panel${inDrawer ? " filter-panel--drawer" : ""}`}
      aria-labelledby={`${id}-filters-heading`}
    >
      <h2
        id={`${id}-filters-heading`}
        className={inDrawer ? "catalog-tools-section__title" : "sr-only"}
      >
        Filters
      </h2>
      <div className="filter-grid">
        <div className="filter-field">
          <label htmlFor={`${id}-mfr`}>Manufacturer</label>
          <select
            id={`${id}-mfr`}
            className="filter-select"
            multiple
            {...multiProps(prefs.manufacturers, (manufacturers) =>
              onChange({ manufacturers })
            )}
          >
            {options.manufacturers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="filter-hint">Ctrl / ⌘ + click for multi-select</div>
        </div>
        <div className="filter-field">
          <label htmlFor={`${id}-mat`}>Material</label>
          <select
            id={`${id}-mat`}
            className="filter-select"
            multiple
            {...multiProps(prefs.materials, (materials) => onChange({ materials }))}
          >
            {options.materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="filter-hint">Ctrl / ⌘ + click for multi-select</div>
        </div>
        {hideThickness ? null : (
          <div className="filter-field">
            <label htmlFor={`${id}-thick`}>Thickness</label>
            <select
              id={`${id}-thick`}
              className="filter-select"
              multiple
              {...multiProps(prefs.thicknesses, (thicknesses) =>
                onChange({ thicknesses })
              )}
            >
              {options.thicknesses.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <div className="filter-hint">Ctrl / ⌘ + click for multi-select</div>
          </div>
        )}
        <div className="filter-field">
          <label htmlFor={`${id}-tier`}>Tier / group</label>
          <select
            id={`${id}-tier`}
            className="filter-select"
            multiple
            {...multiProps(prefs.tierGroups, (tierGroups) =>
              onChange({ tierGroups })
            )}
          >
            {options.tierGroups.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="filter-hint">Tier 1 is the lowest group for sorting</div>
        </div>
        <div className="filter-field">
          <label htmlFor={`${id}-fin`}>Finish</label>
          <select
            id={`${id}-fin`}
            className="filter-select"
            multiple
            {...multiProps(prefs.finishes, (finishes) => onChange({ finishes }))}
          >
            {options.finishes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="filter-hint">Ctrl / ⌘ + click for multi-select</div>
        </div>
        <div className="filter-field">
          <label htmlFor={`${id}-sz`}>Size class</label>
          <select
            id={`${id}-sz`}
            className="filter-select"
            multiple
            {...multiProps(prefs.sizeClasses, (sizeClasses) =>
              onChange({ sizeClasses })
            )}
          >
            {options.sizeClasses.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="filter-hint">Derived from size text (jumbo, standard, etc.)</div>
        </div>
        <div className="filter-field">
          <label htmlFor={`${id}-price`}>Price types</label>
          <select
            id={`${id}-price`}
            className="filter-select"
            multiple
            {...multiProps(prefs.priceTypes, (priceTypes) => onChange({ priceTypes }))}
          >
            {options.priceTypes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="filter-hint">Show rows that include any selected price label</div>
        </div>
      </div>
    </section>
  );
}

export const FilterPanel = memo(FilterPanelInner);
