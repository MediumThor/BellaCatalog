import { memo } from "react";
import { ShoppingCart } from "lucide-react";

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
      title={selected ? "In compare cart" : "Add to compare cart"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ShoppingCart className="compare-bag-btn__icon" size={20} aria-hidden="true" />
    </button>
  );
}

export const CompareBagButton = memo(CompareBagButtonInner);
