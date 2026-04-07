export default function ActiveFilterChips({ chips, onRemove, onClearAll }) {
  if (chips.length === 0) return null;

  return (
    <section className="active-chips" aria-live="polite">
      {chips.map((chip, i) => (
        <button type="button" key={`${chip.label}-${i}`} onClick={() => onRemove(chip)} title="Remove filter">
          {chip.label} ×
        </button>
      ))}
      <button type="button" className="clear" onClick={onClearAll}>
        Clear all
      </button>
    </section>
  );
}
