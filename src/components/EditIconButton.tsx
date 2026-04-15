import { memo } from "react";
import { Pencil } from "lucide-react";

type Props = {
  label: string;
  onClick: () => void;
};

function EditIconButtonInner({ label, onClick }: Props) {
  return (
    <button
      type="button"
      className="btn btn-ghost catalog-edit-btn"
      aria-label={`Edit catalog entry: ${label}`}
      onClick={onClick}
    >
      <Pencil aria-hidden="true" size={16} />
    </button>
  );
}

export const EditIconButton = memo(EditIconButtonInner);
