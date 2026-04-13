import type { CatalogItem } from "../types/catalog";
import { CatalogBrowser } from "../components/CatalogBrowser";
import { useMergedCatalog } from "../hooks/useMergedCatalog";

type Props = {
  open: boolean;
  areaName: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onAddMaterials: (items: CatalogItem[]) => Promise<void>;
};

export function AreaMaterialsCatalogModal({ open, areaName, saving, error, onClose, onAddMaterials }: Props) {
  const { catalog, loadError, bumpOverlay, horusCatalog } = useMergedCatalog();

  if (!open) return null;

  return (
    <div className="ls-entry-modal-backdrop" onClick={saving ? undefined : onClose} role="presentation">
      <div
        className="ls-entry-modal ls-entry-modal--catalog glass-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="area-materials-modal-title"
      >
        <div className="ls-entry-modal-head">
          <div>
            <h3 id="area-materials-modal-title" className="ls-entry-modal-title">
              Add materials to {areaName}
            </h3>
            <p className="ls-muted ls-entry-modal-sub">
              Select one or more catalog materials, then use the green button to add them to this area.
            </p>
          </div>
          <button type="button" className="ls-btn ls-btn-ghost" onClick={onClose} disabled={saving}>
            Close
          </button>
        </div>
        {error ? (
          <p className="compare-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ls-entry-catalog-modal-body">
          <CatalogBrowser
            catalog={catalog}
            loadError={loadError}
            bumpOverlay={bumpOverlay}
            horusCatalog={horusCatalog}
            allowDelete={false}
            searchPlacement="inline"
            compareBagAction={{
              label: saving ? "Adding…" : "Add materials",
              srLabel: `Add selected materials to ${areaName}`,
              className: "floating-compare-btn--success",
              disabled: saving,
              onClick: (items) => {
                void onAddMaterials(items);
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
