type Props = {
  count: number;
  onClick: () => void;
  label?: string;
  srLabel?: string;
  className?: string;
  disabled?: boolean;
};

export function FloatingCompareButton({
  count,
  onClick,
  label = "Compare",
  srLabel,
  className,
  disabled = false,
}: Props) {
  if (count < 1) return null;
  return (
    <button
      type="button"
      className={`floating-compare-btn${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="floating-compare-btn__inner">
        <span className="floating-compare-btn__label">{label}</span>
        <span className="floating-compare-btn__count" aria-hidden="true">
          {count}
        </span>
      </span>
      <span className="sr-only">
        {srLabel ?? `Open compare onboarding for ${count} selected slab${count === 1 ? "" : "s"}`}
      </span>
    </button>
  );
}
