import { normalizeWhitespace } from "./cosentinoHelpers.js";

/** Visible-ish text from main content only; drops script/style so regexes don't ingest asset URLs. */
export async function getVisibleSpecPlainText(page) {
  return await page.evaluate(() => {
    const root = document.querySelector("main") || document.querySelector('[role="main"]') || document.body;
    if (!root) return "";
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,iframe").forEach((el) => el.remove());
    return (clone.innerText || "").replace(/\s+/g, " ").trim();
  });
}

const GARBAGE =
  /(?:\/\/|https?:|www\.|\.(?:png|jpe?g|webp|gif|svg)\b|wp-content|\/plugins\/|CosentinoShowcase|chevron|moodboard|ficha-color|assets\/img|static\.cosentino|bynder|showcase|teads\.tv|bat\.bing)/i;

export function isGarbageSpecToken(s) {
  const t = normalizeWhitespace(s);
  if (!t || t.length > 220) return true;
  if (GARBAGE.test(t)) return true;
  if (/^\/\//.test(t)) return true;
  if ((t.match(/\//g) || []).length > 5) return true;
  return false;
}

/** Remove URL/path junk from a scraped field before validators run. */
export function scrubCosentinoSpecCapture(s) {
  const t = normalizeWhitespace(s);
  if (!t || isGarbageSpecToken(t)) return "";
  return t;
}

export function acceptFinishValue(s) {
  const t = normalizeWhitespace(s);
  if (!t || t.length < 2 || t.length > 80) return "";
  if (isGarbageSpecToken(t)) return "";
  if (!/[a-zA-Z]/.test(t)) return "";
  return t;
}

export function acceptThicknessToken(s) {
  const t = normalizeWhitespace(s);
  if (!t || isGarbageSpecToken(t)) return "";
  if (!/\d/.test(t)) return "";
  if (!/\b(mm|cm|in(ch)?)\b/i.test(t) && !/\b\d[\d.,]*\s*(mm|cm|")\b/i.test(t)) return "";
  return t.slice(0, 80);
}

export function acceptSizeToken(s) {
  const t = normalizeWhitespace(s);
  if (!t || isGarbageSpecToken(t)) return "";
  if (!/\d/.test(t)) return "";
  if (!/(\d+[\d.,]*\s*[×x]\s*\d+|\d+\s*["']?\s*[x×]\s*\d+)/i.test(t) && !/\b\d{2,4}\s*(?:x|×)\s*\d{2,4}\b/i.test(t)) {
    return "";
  }
  return t.slice(0, 160);
}

/** Final pass on catalog record fields written to JSON (idempotent with validators). */
export function finalizeCosentinoScrapedSpecs(record) {
  const clean = (s) => scrubCosentinoSpecCapture(s);
  const thList = Array.from(
    new Set((record.thicknesses || []).map((x) => acceptThicknessToken(clean(x))).filter(Boolean))
  );
  const szList = Array.from(
    new Set((record.sizes || []).map((x) => acceptSizeToken(clean(x))).filter(Boolean))
  );
  const finish = acceptFinishValue(clean(record.finish));
  const thickness = acceptThicknessToken(clean(record.thickness)) || thList[0] || "";
  const size = acceptSizeToken(clean(record.size)) || szList[0] || "";
  return {
    ...record,
    finish,
    thickness,
    thicknesses: thList,
    size,
    sizes: szList,
  };
}
