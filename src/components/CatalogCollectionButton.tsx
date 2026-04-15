import { memo } from "react";

type Props = {
  active: boolean;
  count: number;
  onClick: () => void;
  label: string;
};

function CatalogCollectionButtonInner({ active, count, onClick, label }: Props) {
  const title =
    count > 0
      ? count === 1
        ? "Saved in 1 collection"
        : `Saved in ${count} collections`
      : "Add to collection";
  return (
    <button
      type="button"
      className="catalog-collection-btn"
      data-active={active}
      aria-pressed={active}
      aria-label={
        count > 0
          ? `Manage ${label} in collections. Saved in ${count} collection${count === 1 ? "" : "s"}.`
          : `Add ${label} to a collection`
      }
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg
        className="catalog-collection-btn__icon"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M4 4.75A2.75 2.75 0 0 1 6.75 2h3.08c.73 0 1.42.29 1.94.81l1.17 1.17c.23.23.54.36.86.36h3.45A2.75 2.75 0 0 1 20 7.09v8.16A2.75 2.75 0 0 1 17.25 18H6.75A2.75 2.75 0 0 1 4 15.25zm3.75 1.09a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5zm0 4.41a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5zm0 4.41a.75.75 0 0 0 0 1.5h5.25a.75.75 0 0 0 0-1.5z"
        />
      </svg>
    </button>
  );
}

export const CatalogCollectionButton = memo(CatalogCollectionButtonInner);
