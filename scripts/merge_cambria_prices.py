"""
Merge Cambria distribution center slab prices from the official price sheet PDF
into public/cambria.json (per-thickness rows from cambria:sync).

Columns (pdfplumber): Designs, Series, Size, [3cm $/sf, 3cm slab, 2cm $/sf, 2cm slab, 1cm $/sf, 1cm slab], finish checkmarks...

Requires: pip install -r scripts/requirements.txt (pdfplumber)
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = REPO_ROOT / "Catalogs" / "Cambria Price Sheet 2026.pdf"
DEFAULT_OUT = REPO_ROOT / "public" / "cambria.json"

MM_TO_CM_COL = {"10": "1cm", "20": "2cm", "30": "3cm"}

# Web slug -> PDF row slug (price sheet uses longer product names for some lines).
SLUG_ALIASES: dict[str, str] = {
    "berkshire-brass": "berkshire-brass-smooth",
}


def parse_price_cell(val: object) -> float | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.upper() in ("N/A", "CFA"):
        return None
    cleaned = "".join(c for c in s if c.isdigit() or c == ".")
    if not cleaned:
        return None
    return float(cleaned)


def slugify_design_name(name: str) -> str:
    n = name.split(" - Price as Listed")[0].strip()
    n = re.sub(r"[™®*]", "", n)
    n = n.lower().replace(".", "")
    n = re.sub(r"[^a-z0-9]+", "-", n)
    n = re.sub(r"-+", "-", n).strip("-")
    return n


def load_price_rows(pdf_path: Path) -> dict[str, dict[str, tuple[float | None, float | None]]]:
    """design_slug -> {'1cm': (sf, slab), '2cm': ..., '3cm': ...}"""
    out: dict[str, dict[str, tuple[float | None, float | None]]] = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                if not table or len(table) < 2:
                    continue
                # Skip freight / non-pricing tables (2 columns)
                header0 = table[0][0] if table[0] else None
                if header0 is not None and "Designs" not in str(table[2][0] if len(table) > 2 else ""):
                    # Heuristic: real pricing table has Designs in row 2
                    pass
                for row in table:
                    if not row or len(row) < 9:
                        continue
                    design = row[0]
                    if not design or design == "Designs":
                        continue
                    if str(design).strip() in ("Series", "Size"):
                        continue
                    size = row[2]
                    if not size or not str(size).strip().isdigit():
                        continue

                    p3_sf = parse_price_cell(row[3])
                    p3_sl = parse_price_cell(row[4])
                    p2_sf = parse_price_cell(row[5])
                    p2_sl = parse_price_cell(row[6])
                    p1_sf = parse_price_cell(row[7])
                    p1_sl = parse_price_cell(row[8])

                    slug = slugify_design_name(str(design))
                    if not slug:
                        continue
                    out[slug] = {
                        "1cm": (p1_sf, p1_sl),
                        "2cm": (p2_sf, p2_sl),
                        "3cm": (p3_sf, p3_sl),
                    }
    return out


def thickness_mm_to_cm_key(thickness_mm: str) -> str | None:
    m = re.match(r"^(\d+)\s*mm$", thickness_mm.strip().lower())
    if not m:
        return None
    mm = m.group(1)
    return MM_TO_CM_COL.get(mm)


def merge_prices_into_items(
    items: list[dict],
    prices: dict[str, dict[str, tuple[float | None, float | None]]],
    source_label: str,
) -> tuple[list[dict], list[str], int]:
    warnings: list[str] = []
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    merged = 0

    for it in items:
        if it.get("vendor") != "Cambria" or it.get("sourceFile") != "cambria-sync":
            continue
        iid = str(it.get("id", ""))
        parts = iid.split(":")
        if len(parts) < 3 or parts[0] != "cambria":
            continue
        slug = parts[1]
        thick_part = parts[2]  # e.g. 20mm
        mm_match = re.match(r"^(\d+)mm$", thick_part, re.I)
        if not mm_match:
            continue
        mm = mm_match.group(1)
        cm_key = MM_TO_CM_COL.get(mm)
        if not cm_key:
            continue

        lookup_slug = SLUG_ALIASES.get(slug, slug)
        row = prices.get(lookup_slug)
        if not row:
            warnings.append(f"No PDF price row for design slug '{slug}' (item {iid})")
            continue

        sf, slab = row.get(cm_key, (None, None))
        if sf is None and slab is None:
            warnings.append(f"PDF has N/A/CFA for {slug} {cm_key} (item {iid})")
            continue

        thick_label = f"{mm} mm"
        entries = []
        if sf is not None:
            entries.append(
                {
                    "label": f"{source_label} — per sq ft",
                    "price": round(sf, 2),
                    "unit": "sqft",
                    "thickness": thick_label,
                    "sourceContext": "Cambria Price Sheet 2026.pdf",
                }
            )
        if slab is not None:
            entries.append(
                {
                    "label": f"{source_label} — per slab",
                    "price": round(slab, 2),
                    "unit": "slab",
                    "thickness": thick_label,
                    "sourceContext": "Cambria Price Sheet 2026.pdf",
                }
            )

        it["priceEntries"] = entries
        it["lastPriceSyncAt"] = now
        raw = it.get("rawSourceFields")
        if isinstance(raw, dict):
            raw["priceListFile"] = "Cambria Price Sheet 2026.pdf"
        merged += 1

    return items, warnings, merged


def main() -> int:
    pdf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PDF
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT

    if not pdf_path.is_file():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 1
    if not out_path.is_file():
        print(f"cambria.json not found: {out_path}", file=sys.stderr)
        return 1

    prices = load_price_rows(pdf_path)
    print(f"Loaded {len(prices)} design price rows from {pdf_path.name}")

    with open(out_path, encoding="utf-8") as f:
        data = json.load(f)

    catalog = data.get("catalog") or data
    items = catalog.get("items")
    if not isinstance(items, list):
        print("Invalid cambria.json: missing catalog.items", file=sys.stderr)
        return 1

    source_label = "Cambria DC 2026"
    items, warnings, merged = merge_prices_into_items(items, prices, source_label)

    iw = catalog.get("importWarnings") or []
    if not isinstance(iw, list):
        iw = []
    iw = [x for x in iw if not (isinstance(x, dict) and x.get("sourceFile") == "cambria-prices-merge")]
    for w in warnings[:200]:
        iw.append(
            {
                "severity": "warning",
                "message": w,
                "sourceFile": "cambria-prices-merge",
            }
        )
    catalog["importWarnings"] = iw

    if "catalog" in data:
        data["catalog"] = catalog
    else:
        data = catalog

    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    try:
        pdf_rel = str(pdf_path.relative_to(REPO_ROOT))
    except ValueError:
        pdf_rel = str(pdf_path)
    meta["cambriaPriceMerge"] = {
        "pdf": pdf_rel,
        "designsInPdf": len(prices),
        "itemsPriced": merged,
        "warnings": len(warnings),
    }
    if "meta" in data:
        data["meta"].update(meta)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"Wrote {out_path}")
    print(f"Priced {merged} thickness-variant rows")
    print(f"Price merge warnings (showing up to 20): {len(warnings)}")
    for w in warnings[:20]:
        print(f"  - {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
