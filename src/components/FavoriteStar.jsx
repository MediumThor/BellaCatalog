export default function FavoriteStar({ active, onClick }) {
  return (
    <button
      type="button"
      className={`favorite-star ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={active ? 'Remove favorite' : 'Add favorite'}
    >
      ★
    </button>
  );
}
