import { memo } from "react";

type Props = {
  selected: boolean;
  onToggle: () => void;
  label: string;
};

function CompareBagButtonInner({ selected, onToggle, label }: Props) {
  return (
    <button
      type="button"
      className="compare-bag-btn"
      data-selected={selected}
      aria-pressed={selected}
      aria-label={
        selected ? `Remove ${label} from compare selection` : `Add ${label} to compare selection`
      }
      title={selected ? "In compare bag" : "Add to compare bag"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg className="compare-bag-btn__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6 8V7a6 6 0 1 1 12 0v1h1.25A1.75 1.75 0 0 1 21 9.75l-.7 9.35A2 2 0 0 1 18.3 21H5.7a2 2 0 0 1-1.99-1.9L3 9.75A1.75 1.75 0 0 1 4.75 8zm2 0h8V7a4 4 0 1 0-8 0z"
        />
      </svg>
    </button>
  );
}

export const CompareBagButton = memo(CompareBagButtonInner);
