export function applySearch(items, query) {
  const term = query.trim().toLowerCase();
  if (!term) return items;
  return items.filter((item) => item.searchText.includes(term));
}
