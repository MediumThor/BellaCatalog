/**
 * Strip Cosentino scrape artifacts (truncated URLs, plugin asset paths) from fields
 * shown as table headers / filter options / price-badge labels.
 */
const SPEC_GARBAGE =
  /(?:\/\/|https?:|www\.|\.(?:png|jpe?g|webp|gif|svg)\b|wp-content|\/plugins\/|CosentinoShowcase|chevron|moodboard|ficha-color|assets\/img|static\.cosentino|bynder|showcase|teads\.tv|bat\.bing)/i;

export function isCosentinoSpecGarbage(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 220) return true;
  if (SPEC_GARBAGE.test(t)) return true;
  if (/^\/\//.test(t)) return true;
  if ((t.match(/\//g) || []).length > 5) return true;
  return false;
}

/** Returns empty string if value is unusable (URL junk, tracking paths, etc.). */
export function sanitizeCosentinoSpecString(s: string | undefined | null): string {
  if (s === undefined || s === null) return "";
  const t = String(s).trim();
  if (isCosentinoSpecGarbage(t)) return "";
  return t;
}

export function sanitizeCosentinoSpecStringList(arr: string[] | undefined | null): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const x of arr) {
    const c = sanitizeCosentinoSpecString(typeof x === "string" ? x : "");
    if (c) out.push(c);
  }
  return out;
}
