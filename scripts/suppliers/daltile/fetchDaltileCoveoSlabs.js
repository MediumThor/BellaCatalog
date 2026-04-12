/**
 * Daltile Site search uses Coveo for Sitecore: POST /coveo/rest with the same
 * advanced query as the public Search URL hash facets.
 */

const COVEO_REST = "https://www.daltile.com/coveo/rest";

/** Matches Search# ... f:@sourcedisplayname=[product]&f:@productshape=[Slab] */
export const AQ_SLAB_PRODUCTS =
  "(@sourcedisplayname==product) (@productshape==Slab)";

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (compatible; BellaCatalog/1.0; +https://github.com/)",
};

export async function fetchDaltileCoveoPage({
  firstResult = 0,
  numberOfResults = 90,
  aq = AQ_SLAB_PRODUCTS,
} = {}) {
  const res = await fetch(COVEO_REST, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      q: "",
      firstResult,
      numberOfResults,
      aq,
      searchHub: "daltile-searchhub",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Coveo HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * @param {object} opts
 * @param {number} [opts.pageSize]
 * @param {(pageIndex: number, total: number, pageCount: number) => void} [opts.onPage]
 */
export async function fetchAllDaltileSlabResults(opts = {}) {
  const pageSize = opts.pageSize ?? 90;
  const onPage = opts.onPage;
  const first = await fetchDaltileCoveoPage({
    firstResult: 0,
    numberOfResults: pageSize,
  });
  const total = typeof first.totalCount === "number" ? first.totalCount : 0;
  const all = [...(first.results || [])];
  let firstResult = all.length;
  let pageIndex = 0;
  if (onPage) onPage(pageIndex, total, all.length);

  while (firstResult < total && first.results?.length) {
    pageIndex += 1;
    const next = await fetchDaltileCoveoPage({
      firstResult,
      numberOfResults: pageSize,
    });
    const batch = next.results || [];
    all.push(...batch);
    if (onPage) onPage(pageIndex, total, all.length);
    if (batch.length === 0) break;
    firstResult += batch.length;
  }

  return { totalCount: total, results: all, indexToken: first.indexToken };
}
