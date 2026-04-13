import { memo } from "react";
import { Trash2 } from "lucide-react";

type Props = {
  /** Product name for the accessible label */
  label: string;
  onClick: () => void;
};

function TrashIconButtonInner({ label, onClick }: Props) {
  return (
    <button
      type="button"
      className="btn btn-ghost catalog-delete-btn"
      aria-label={`Remove catalog entry: ${label}`}
      onClick={onClick}
    >
      <Trash2 aria-hidden="true" size={16} />
    </button>
  );
}

export const TrashIconButton = memo(TrashIconButtonInner);
