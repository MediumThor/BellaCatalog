const CORS_PROXY_HOSTS = new Set([
  "cambriausa.com",
  "www.cambriausa.com",
]);

const CORS_IMAGE_PROXY_BASE = "https://wsrv.nl/";
const URL_BASE_FALLBACK = "https://app.local/";

function shouldProxyImage(parsed: URL): boolean {
  if (CORS_PROXY_HOSTS.has(parsed.hostname)) return true;
  const host = parsed.hostname;
  if (host === "s3.us-east-2.amazonaws.com" && parsed.pathname.startsWith("/stonexusa-sps-files/")) {
    return true;
  }
  /** Adobe Scene7 (e.g. Daltile) — blocks anonymous canvas reads without CORS. */
  if (host === "digitalassets.daltile.com" || host.endsWith(".scene7.com")) {
    return true;
  }
  return false;
}

export function normalizeRenderableImageUrl(raw: string | null | undefined): string {
  const trimmed = raw?.trim() || "";
  if (!trimmed) return "";
  if (/^(data:|blob:)/i.test(trimmed)) return trimmed;
  try {
    return encodeURI(decodeURI(trimmed));
  } catch {
    try {
      return encodeURI(trimmed);
    } catch {
      return trimmed;
    }
  }
}

export function corsSafeImageUrl(raw: string | null | undefined): string {
  const normalized = normalizeRenderableImageUrl(raw);
  if (!normalized) return "";
  try {
    const baseHref = typeof window !== "undefined" ? window.location.href : URL_BASE_FALLBACK;
    const parsed = new URL(normalized, baseHref);
    if (!/^https?:$/i.test(parsed.protocol)) return normalized;
    if (parsed.hostname === "wsrv.nl" || parsed.hostname === "images.weserv.nl") return parsed.href;
    if (!shouldProxyImage(parsed)) return parsed.href;
    return `${CORS_IMAGE_PROXY_BASE}?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return normalized;
  }
}
