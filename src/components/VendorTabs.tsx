import { memo } from "react";

type Props = {
  vendors: string[];
  active: string;
  onSelect: (vendor: string) => void;
  /** Vertical stack for catalog tools drawer */
  layout?: "default" | "sidebar";
};

function VendorTabsInner({ vendors, active, onSelect, layout = "default" }: Props) {
  return (
    <div
      className={`vendor-tabs${layout === "sidebar" ? " vendor-tabs--sidebar" : ""}`}
      role="tablist"
      aria-label="Vendor filter"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === "__all__"}
        className="vendor-tab vendor-tab--all"
        data-active={active === "__all__"}
        onClick={() => onSelect("__all__")}
      >
        All vendors
      </button>
      {vendors.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={active === v}
          className="vendor-tab"
          data-active={active === v}
          onClick={() => onSelect(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export const VendorTabs = memo(VendorTabsInner);
