import { memo, useEffect, type ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

function CatalogToolsDrawerInner({ open, onOpenChange, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  return (
    <>
      <div
        className={`catalog-tools-backdrop${open ? " catalog-tools-backdrop--open" : ""}`}
        role="presentation"
        aria-hidden={!open}
        onClick={() => onOpenChange(false)}
      />

      <aside
        id="catalog-tools-drawer-panel"
        className={`catalog-tools-drawer${open ? " catalog-tools-drawer--open" : ""}`}
        role="dialog"
        aria-modal={open}
        aria-labelledby="catalog-tools-drawer-title"
        aria-hidden={!open}
      >
        <div className="catalog-tools-drawer__header">
          <h2 id="catalog-tools-drawer-title" className="catalog-tools-drawer__title">
            Catalog tools
          </h2>
          <button
            type="button"
            className="btn btn-ghost catalog-tools-drawer__close"
            aria-label="Close catalog tools"
            onClick={() => onOpenChange(false)}
          >
            ×
          </button>
        </div>
        <div className="catalog-tools-drawer__body">{children}</div>
      </aside>

      <button
        type="button"
        className="catalog-tools-tab"
        aria-expanded={open}
        aria-controls="catalog-tools-drawer-panel"
        id="catalog-tools-tab"
        onClick={() => onOpenChange(!open)}
      >
        <span className="catalog-tools-tab__label">Catalog tools</span>
      </button>
    </>
  );
}

export const CatalogToolsDrawer = memo(CatalogToolsDrawerInner);
