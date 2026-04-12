import { memo } from "react";

type Props = {
  active: boolean;
  onToggle: () => void;
  label: string;
};

function FavoriteStarInner({ active, onToggle, label }: Props) {
  return (
    <button
      type="button"
      className="fav-star"
      data-active={active}
      aria-pressed={active}
      aria-label={active ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      title={active ? "Remove favorite" : "Add favorite"}
      onClick={onToggle}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

export const FavoriteStar = memo(FavoriteStarInner);
