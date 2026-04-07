import ProductCard from './ProductCard';

export default function CardView({ items, favorites, onToggleFavorite, visibleFields }) {
  return (
    <div className="card-grid">
      {items.map((item) => (
        <ProductCard
          key={item.id}
          item={item}
          isFavorite={favorites.includes(item.id)}
          onToggleFavorite={onToggleFavorite}
          visibleFields={visibleFields}
        />
      ))}
    </div>
  );
}
