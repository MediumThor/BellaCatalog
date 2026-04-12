import { memo } from "react";
import type { UiPreferences } from "../types/catalog";
import { ENABLE_VISUAL_TAG_FILTERS } from "../utils/filterCatalog";

type Props = {
  prefs: UiPreferences;
  onClear: () => void;
  onRemoveChip: (patch: Partial<UiPreferences>) => void;
};

function hasActiveFilters(p: UiPreferences): boolean {
  const visualTagsActive =
    ENABLE_VISUAL_TAG_FILTERS &&
    (p.colorFamilies.length > 0 ||
      p.undertones.length > 0 ||
      p.patternTags.length > 0 ||
      p.movementLevels.length > 0 ||
      p.styleTags.length > 0);
  return (
    p.searchQuery.trim() !== "" ||
    p.vendor !== "__all__" ||
    p.manufacturers.length > 0 ||
    p.materials.length > 0 ||
    p.thicknesses.length > 0 ||
    p.tierGroups.length > 0 ||
    p.finishes.length > 0 ||
    p.sizeClasses.length > 0 ||
    p.priceTypes.length > 0 ||
    visualTagsActive ||
    p.favoritesOnly ||
    p.hideWithoutPicture
  );
}

function ActiveFilterChipsInner({ prefs, onClear, onRemoveChip }: Props) {
  if (!hasActiveFilters(prefs)) return null;

  const chips: { label: string; onRemove: () => void }[] = [];

  if (prefs.searchQuery.trim()) {
    chips.push({
      label: `Search: ${prefs.searchQuery.trim()}`,
      onRemove: () => onRemoveChip({ searchQuery: "" }),
    });
  }
  if (prefs.vendor !== "__all__") {
    chips.push({
      label: `Vendor: ${prefs.vendor}`,
      onRemove: () => onRemoveChip({ vendor: "__all__" }),
    });
  }
  prefs.manufacturers.forEach((m) =>
    chips.push({
      label: `Mfr: ${m}`,
      onRemove: () =>
        onRemoveChip({
          manufacturers: prefs.manufacturers.filter((x) => x !== m),
        }),
    })
  );
  prefs.materials.forEach((m) =>
    chips.push({
      label: `Material: ${m}`,
      onRemove: () =>
        onRemoveChip({ materials: prefs.materials.filter((x) => x !== m) }),
    })
  );
  prefs.thicknesses.forEach((m) =>
    chips.push({
      label: `Thickness: ${m}`,
      onRemove: () =>
        onRemoveChip({ thicknesses: prefs.thicknesses.filter((x) => x !== m) }),
    })
  );
  prefs.tierGroups.forEach((m) =>
    chips.push({
      label: `Tier: ${m}`,
      onRemove: () =>
        onRemoveChip({ tierGroups: prefs.tierGroups.filter((x) => x !== m) }),
    })
  );
  prefs.finishes.forEach((m) =>
    chips.push({
      label: `Finish: ${m}`,
      onRemove: () =>
        onRemoveChip({ finishes: prefs.finishes.filter((x) => x !== m) }),
    })
  );
  prefs.sizeClasses.forEach((m) =>
    chips.push({
      label: `Size class: ${m}`,
      onRemove: () =>
        onRemoveChip({ sizeClasses: prefs.sizeClasses.filter((x) => x !== m) }),
    })
  );
  prefs.priceTypes.forEach((m) =>
    chips.push({
      label: `Price: ${m}`,
      onRemove: () =>
        onRemoveChip({ priceTypes: prefs.priceTypes.filter((x) => x !== m) }),
    })
  );
  if (ENABLE_VISUAL_TAG_FILTERS) {
    prefs.colorFamilies.forEach((m) =>
      chips.push({
        label: `Color: ${m}`,
        onRemove: () =>
          onRemoveChip({ colorFamilies: prefs.colorFamilies.filter((x) => x !== m) }),
      })
    );
    prefs.undertones.forEach((m) =>
      chips.push({
        label: `Undertone: ${m}`,
        onRemove: () =>
          onRemoveChip({ undertones: prefs.undertones.filter((x) => x !== m) }),
      })
    );
    prefs.patternTags.forEach((m) =>
      chips.push({
        label: `Pattern: ${m}`,
        onRemove: () =>
          onRemoveChip({ patternTags: prefs.patternTags.filter((x) => x !== m) }),
      })
    );
    prefs.movementLevels.forEach((m) =>
      chips.push({
        label: `Movement: ${m}`,
        onRemove: () =>
          onRemoveChip({ movementLevels: prefs.movementLevels.filter((x) => x !== m) }),
      })
    );
    prefs.styleTags.forEach((m) =>
      chips.push({
        label: `Style: ${m}`,
        onRemove: () =>
          onRemoveChip({ styleTags: prefs.styleTags.filter((x) => x !== m) }),
      })
    );
  }
  if (prefs.favoritesOnly) {
    chips.push({
      label: "Favorites only",
      onRemove: () => onRemoveChip({ favoritesOnly: false }),
    });
  }
  if (prefs.hideWithoutPicture) {
    chips.push({
      label: "With picture only",
      onRemove: () => onRemoveChip({ hideWithoutPicture: false }),
    });
  }

  return (
    <div className="chips" aria-label="Active filters">
      {chips.map((c, idx) => (
        <span key={`${idx}-${c.label}`} className="chip">
          {c.label}
          <button type="button" onClick={c.onRemove} aria-label={`Remove ${c.label}`}>
            ×
          </button>
        </span>
      ))}
      <button type="button" className="btn btn-ghost" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}

export const ActiveFilterChips = memo(ActiveFilterChipsInner);
export { hasActiveFilters };
