import { HANSTONE_BASE, HANSTONE_USER_AGENT, parseColorGridHtml } from "./hanstoneHelpers.js";

const COLOR_SEARCH_URL = `${HANSTONE_BASE}/ajax/index.php?action=color_search`;

/**
 * POST body matches jQuery `data: { filters: { brand: ['hanstone-quartz'] } }` → `filters[brand][]=…`
 */
export async function fetchHanstoneGridHtml() {
  const body = new URLSearchParams();
  body.append("filters[brand][]", "hanstone-quartz");

  const res = await fetch(COLOR_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": HANSTONE_USER_AGENT,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`color_search HTTP ${res.status}`);
  }

  const json = await res.json();
  if (json.status !== "success") {
    throw new Error(`color_search status: ${json.status}`);
  }
  const html = typeof json.data === "string" ? json.data : "";
  return { html, raw: json };
}

export function parseGridRecords(html) {
  return parseColorGridHtml(html);
}

export async function fetchColorDetailHtml(slug) {
  const pathSlug = encodeURI(slug);
  const url = `${HANSTONE_BASE}/colors/${pathSlug}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": HANSTONE_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return { url, status: res.status, html: await res.text() };
}
