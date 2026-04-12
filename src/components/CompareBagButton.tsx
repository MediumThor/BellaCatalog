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
          d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"
        />
      </svg>
    </button>
  );
}

export const CompareBagButton = memo(CompareBagButtonInner);
