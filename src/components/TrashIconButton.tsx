import { memo } from "react";

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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" x2="10" y1="11" y2="17" />
        <line x1="14" x2="14" y1="11" y2="17" />
      </svg>
    </button>
  );
}

export const TrashIconButton = memo(TrashIconButtonInner);
