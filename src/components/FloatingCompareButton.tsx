type Props = {
  count: number;
  onClick: () => void;
};

export function FloatingCompareButton({ count, onClick }: Props) {
  if (count < 1) return null;
  return (
    <button type="button" className="floating-compare-btn" onClick={onClick}>
      <span className="floating-compare-btn__inner">
        <span className="floating-compare-btn__label">Compare</span>
        <span className="floating-compare-btn__count" aria-hidden="true">
          {count}
        </span>
      </span>
      <span className="sr-only">
        Open compare onboarding for {count} selected slab{count === 1 ? "" : "s"}
      </span>
    </button>
  );
}
