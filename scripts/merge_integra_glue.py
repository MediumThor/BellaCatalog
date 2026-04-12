#!/usr/bin/env python3
"""
Parse **Integra** adhesive cross-reference PDFs (Integra/*.pdf) and merge
integraGlue[] onto matching catalog items in public/catalog.json.

Integra is the glue/adhesive manufacturer. **StoneX** and **One Quartz** are stone
suppliers; catalog rows reference vendor/manufacturer separately.

The ONE QUARTZ PDF (Integra chart for One Quartz surface colors) uses a Code
column (OQ78, NQ36) between the sheet name and glue; those lines are skipped.

StoneX price-list color names often differ from One Quartz marketing names. Use
Integra/stonex_one_quartz_aliases.json to map normalized StoneX titles to
normalized chart sheet names, e.g. {"Autumn Gray": "Arches"}.

Fuzzy sheet matching ignores generic words like "quartz" (otherwise the only
sheet containing "quartz" — e.g. "white quartz" — would match every StoneX
quartz row). Prefer explicit aliases when the chart uses a different color name
(e.g. absolute black → liberty black).

Natural stone (granite, marble, …): Integra NATURAL STONE PDF matches by color
name for any supplier (MSI, StoneX, …). Optional: Integra/natural_stone_aliases.json.

Run from repo root:  .venv\\Scripts\\python scripts/merge_integra_glue.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
INTEGRA_DIR = ROOT / "Integra"
CATALOG_PATH = ROOT / "public" / "catalog.json"

try:
    import fitz  # PyMuPDF
except ImportError as e:
    raise SystemExit("PyMuPDF (fitz) required. pip install pymupdf") from e

# First line of PDF body (brand) -> catalog manufacturer string (must match exactly).
# PDFs without a catalog manufacturer are still parsed for a sidecar JSON only.
PDF_BRAND_TO_MANUFACTURER: dict[str, str | None] = {
    "HANSTONE": "HanStone",
    "SILESTONE": "Silestone / Cosentino",
    "LX VIATERA": "Viatera",
    "CORIAN QUARTZ": "Corian Quartz",
    "TRENDS IN QUARTZ": "Trends in Quartz",
    "CAMBRIA": None,
    "WILSONART QUARTZ": None,
    # Integra PDF chart titled for One Quartz surfaces; apply to StoneX catalog rows.
    "ONE QUARTZ": "StoneX",
    "CERASTONE": None,
    "CRESCENT QUARTZ": None,
    "ATHENIAN MARBLE": None,
    "MARBLESTONE": None,
    "METRO MARBLE MMG": None,
    "NATURAL STONE": "__NATURAL_STONE__",
    "PIEDRAFINA": None,
    "PREMIUM STONE": None,
    "SENSA": None,
}

GLUE_LINE = re.compile(r"^(.+?)\s*-\s*(\d{4})\s*\*?\s*$")
# Integra ONE QUARTZ chart PDF has a "Code" column between sheet name and glue (OQ78, NQ36, …).
ONE_QUARTZ_CODE_LINE = re.compile(r"^[A-Z]{2}\d{2,4}\s*$")
# Form-only line e.g. XI+, XI+/H, XI+/H/R
FORM_ONLY = re.compile(r"^XI\+(?:/[HRP])*\s*$")
# Same line: form for previous glue + next glue name/code
FORM_AND_GLUE = re.compile(r"^((?:XI\+(?:/[HRP])*)+)\s+(.+?\s*-\s*\d{4})\s*\*?\s*$")


def norm_key(s: str) -> str:
    s = s.lower().replace("—", " ").replace("–", "-")
    s = re.sub(r"[^\w\s-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def name_candidates(product_name: str, display_name: str) -> set[str]:
    out: set[str] = set()
    for n in (product_name, display_name):
        if not (n and n.strip()):
            continue
        out.add(norm_key(n))
        for sep in (" — ", " – ", " - "):
            if sep in n:
                tail = n.split(sep, 1)[1]
                out.add(norm_key(tail))
    return out


# StoneX price-list titles often append finish + slab thickness after the color name;
# Integra "Sheet Name" uses the base color only (e.g. Maple White).
_STONEX_TAIL = re.compile(
    r"""
    \s+
    (?:Jumbo\s+)?
    (?:Polished|Honed|Matte|Leathered|Brushed)
    (?:\s+\d+(?:\.\d+)?\s*cm)?
    \s*$
    """,
    re.I | re.VERBOSE,
)


def stonex_base_color_candidates(product_name: str, display_name: str) -> set[str]:
    out: set[str] = set()
    for n in (product_name, display_name):
        if not (n and n.strip()):
            continue
        s = re.sub(r"\s+-\s+Quartz\s*$", "", n, flags=re.I)
        prev = None
        while s != prev:
            prev = s
            s = _STONEX_TAIL.sub("", s).strip()
        if s:
            out.add(norm_key(s))
            for sep in (" — ", " – ", " - "):
                if sep in s:
                    tail = s.split(sep, 1)[1]
                    out.add(norm_key(tail))
    return out


def _is_stonex_row(item: dict[str, Any]) -> bool:
    """StoneX supplier rows (One Quartz stone line uses Integra ONE QUARTZ chart)."""
    if item.get("manufacturer") == "StoneX":
        return True
    v = str(item.get("vendor") or "").strip()
    return v == "StoneX"


_NATURAL_MATERIAL_TAIL = re.compile(
    r"\s+-\s+(Granite|Marble|Quartzite|Limestone|Soapstone|Marble Limestone|Other|Porcelain)\s*$",
    re.I,
)


def is_catalog_natural_stone(item: dict[str, Any]) -> bool:
    """True for granite/marble/quartzite/etc., false for engineered quartz and accessories."""
    raw = str(item.get("material") or "").strip().lower()
    if not raw:
        return False
    if raw in ("quartz", "accessory", "accessories"):
        return False
    if raw == "printed uquartz" or raw.endswith(" uquartz"):
        return False
    # Broad buckets used in price lists (e.g. UGM "Natural stone").
    if raw in ("natural stone", "natural"):
        return True
    # Quartzite is natural; plain "quartz" is not.
    if "quartzite" in raw or raw == "quartzite":
        return True
    natural = (
        "granite",
        "marble",
        "limestone",
        "soapstone",
        "slate",
        "travertine",
        "onyx",
        "dolomite",
        "marble limestone",
        "porcelain",
    )
    if raw in natural:
        return True
    return any(t in raw for t in ("granite", "marble", "limestone", "soapstone", "slate"))


def natural_stone_base_candidates(product_name: str, display_name: str) -> set[str]:
    """Strip material suffix, finish/thickness, trailing (Dual) etc. for name matching."""
    out: set[str] = set()
    for n in (product_name, display_name):
        if not (n and n.strip()):
            continue
        s = _NATURAL_MATERIAL_TAIL.sub("", n)
        s = re.sub(r"\s*\([^)]*\)\s*$", "", s).strip()
        prev = None
        while s != prev:
            prev = s
            s = _STONEX_TAIL.sub("", s).strip()
        if s:
            out.add(norm_key(s))
            for sep in (" — ", " – ", " - "):
                if sep in s:
                    tail = s.split(sep, 1)[1]
                    out.add(norm_key(tail))
    return out


def all_name_candidates(item: dict[str, Any]) -> set[str]:
    pn = str(item.get("productName") or "")
    dn = str(item.get("displayName") or "")
    c = name_candidates(pn, dn)
    if _is_stonex_row(item):
        c |= stonex_base_color_candidates(pn, dn)
    if is_catalog_natural_stone(item):
        c |= natural_stone_base_candidates(pn, dn)
    return c


def sanitize_sheet_name(raw: str) -> str:
    """Strip merged product codes (One Quartz PDF) from Integra sheet titles."""
    s = " ".join(raw.split())
    while True:
        t = re.sub(r"\s+[A-Z]{2}\d{2,4}\s*$", "", s).strip()
        if t == s:
            break
        s = t
    return s


def load_natural_stone_aliases() -> dict[str, str]:
    """Optional: map normalized catalog keys → normalized Integra NATURAL STONE sheet keys."""
    p = INTEGRA_DIR / "natural_stone_aliases.json"
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return {}
        return {norm_key(str(k)): norm_key(str(v)) for k, v in raw.items()}
    except (OSError, json.JSONDecodeError):
        return {}


# Too-generic normalized keys: must never drive unique substring matching (e.g. candidate
# "quartz" would wrongly match the only sheet containing "quartz", often "white quartz").
STONEX_UNIQUE_SUBSTRING_BLOCKLIST: frozenset[str] = frozenset(
    {
        "quartz",
        "granite",
        "marble",
        "quartzite",
        "stone",
        "porcelain",
        "ceramic",
        "natural stone",
        "natural",
        "other",
        "slate",
        "soapstone",
        "limestone",
        "travertine",
        "onyx",
        "dolomite",
        "uquartz",
        "printed uquartz",
        "accessory",
        "accessories",
    }
)


def load_stonex_one_quartz_aliases() -> dict[str, str]:
    """Optional: map StoneX catalog color keys → Integra ONE QUARTZ chart sheet keys (normalized)."""
    p = INTEGRA_DIR / "stonex_one_quartz_aliases.json"
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return {}
        return {norm_key(str(k)): norm_key(str(v)) for k, v in raw.items()}
    except (OSError, json.JSONDecodeError):
        return {}


def resolve_stonex_unique_sheet_key(candidate: str, sheet_keys: list[str]) -> str | None:
    """If exactly one Integra sheet key equals or uniquely contains the candidate, return it."""
    if not candidate:
        return None
    if candidate in STONEX_UNIQUE_SUBSTRING_BLOCKLIST:
        return None
    exact = [s for s in sheet_keys if candidate == s]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    if len(candidate) < 5:
        return None
    subs = [s for s in sheet_keys if candidate in s or s in candidate]
    if len(subs) == 1:
        return subs[0]
    return None


def catalog_row_matches_pdf_brand(item: dict[str, Any], mfr: str) -> bool:
    """Match catalog item to Integra PDF brand (HanStone, StoneX, …)."""
    if mfr == "StoneX":
        return _is_stonex_row(item)
    if mfr == "__NATURAL_STONE__":
        return is_catalog_natural_stone(item)
    return item.get("manufacturer") == mfr


def read_sheet_lines(body: list[str], i: int) -> tuple[str, int]:
    parts: list[str] = []
    while i < len(body):
        line = body[i].strip()
        if not line:
            i += 1
            continue
        if "Integra Adhesives" in line:
            return "", i
        if line.startswith("Refer to MSDS") or line.startswith("XI+ =") or line.startswith("+ indicates"):
            i += 1
            continue
        if line.startswith("* Indicates"):
            i += 1
            continue
        if ONE_QUARTZ_CODE_LINE.match(line):
            i += 1
            continue
        if GLUE_LINE.match(line) and not line.startswith("XI+"):
            break
        if line.startswith("XI+") or FORM_AND_GLUE.match(line):
            break
        parts.append(line)
        i += 1
    sheet = sanitize_sheet_name(" ".join(parts))
    return sheet, i


def parse_matches(body: list[str], i: int) -> tuple[list[dict[str, str]], int]:
    matches: list[dict[str, str]] = []
    while i < len(body):
        line = body[i].strip()
        if not line or "Integra Adhesives" in line:
            break
        if not GLUE_LINE.match(line) or line.startswith("XI+"):
            break
        glue = line.rstrip("*").strip()
        i += 1
        if i >= len(body):
            matches.append({"glue": glue, "form": ""})
            break
        L = body[i].strip()
        m2 = FORM_AND_GLUE.match(L)
        if m2:
            form_a = m2.group(1).strip()
            glue_b = m2.group(2).strip().rstrip("*").strip()
            matches.append({"glue": glue, "form": form_a})
            i += 1
            if i >= len(body):
                matches.append({"glue": glue_b, "form": ""})
                break
            L2 = body[i].strip()
            if FORM_ONLY.match(L2):
                matches.append({"glue": glue_b, "form": L2})
                i += 1
            else:
                matches.append({"glue": glue_b, "form": ""})
            continue
        if FORM_ONLY.match(L):
            matches.append({"glue": glue, "form": L})
            i += 1
            continue
        matches.append({"glue": glue, "form": ""})
        break
    return matches, i


def parse_integra_page(text: str) -> list[dict[str, Any]]:
    lines = [l.rstrip() for l in text.splitlines()]
    start = 0
    for j, l in enumerate(lines):
        if l.strip() == "Match 2" and j + 1 < len(lines) and "H/R/XI+" in lines[j + 1]:
            start = j + 2
            break
    body = lines[start:]
    rows: list[dict[str, Any]] = []
    i = 0
    while i < len(body):
        sheet, i = read_sheet_lines(body, i)
        if not sheet:
            i += 1
            continue
        mlist, i = parse_matches(body, i)
        if mlist:
            rows.append({"sheet": sheet, "matches": mlist})
    return rows


def dedupe_matches(mlist: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, str]] = []
    for m in mlist:
        t = (m["glue"], m["form"])
        if t in seen:
            continue
        seen.add(t)
        out.append(m)
    return out


def pdf_brand_from_filename(stem: str) -> str:
    s = stem.strip()
    if s.lower().endswith("_signature"):
        s = s[: -len("_signature")]
    s = re.sub(r"\s*-\d{2}-\d{2}-\d{2}$", "", s)
    return " ".join(s.split()).upper()


def parse_pdf(path: Path) -> tuple[str | None, list[dict[str, Any]]]:
    brand = pdf_brand_from_filename(path.stem)
    doc = fitz.open(path)
    all_rows: list[dict[str, Any]] = []
    for page in doc:
        all_rows.extend(parse_integra_page(page.get_text()))
    doc.close()
    mfr = PDF_BRAND_TO_MANUFACTURER.get(brand)
    return mfr, all_rows


def build_sheet_glue_map(
    pdf_path: Path,
) -> tuple[dict[str, list[dict[str, str]]], str | None]:
    mfr, rows = parse_pdf(pdf_path)
    by_sheet: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = norm_key(row["sheet"])
        if not key:
            continue
        by_sheet[key].extend(row["matches"])
    for k in list(by_sheet.keys()):
        by_sheet[k] = dedupe_matches(by_sheet[k])
    return dict(by_sheet), mfr


def merge_into_catalog(data: dict[str, Any]) -> dict[str, int]:
    stats = {"items_updated": 0, "sheets_matched": 0, "pdfs": 0}
    if not INTEGRA_DIR.is_dir():
        return stats

    for it in data.get("items", []):
        if isinstance(it, dict):
            it.pop("integraGlue", None)

    aliases = load_stonex_one_quartz_aliases()
    natural_aliases = load_natural_stone_aliases()

    for pdf in sorted(INTEGRA_DIR.glob("*.pdf")):
        sheet_map, mfr = build_sheet_glue_map(pdf)
        stats["pdfs"] += 1
        if not mfr:
            continue
        sheet_keys = list(sheet_map.keys())
        for it in data.get("items", []):
            if not catalog_row_matches_pdf_brand(it, mfr):
                continue
            cands = all_name_candidates(it)
            hit: list[dict[str, str]] | None = None
            for c in cands:
                if c in sheet_map:
                    hit = sheet_map[c]
                    break
            if not hit and mfr == "StoneX":
                for c in cands:
                    tgt = aliases.get(c)
                    if tgt and tgt in sheet_map:
                        hit = sheet_map[tgt]
                        break
                if not hit:
                    # Prefer longer, more specific keys so "absolute black" wins over "quartz".
                    for c in sorted(cands, key=lambda x: (-len(x), x)):
                        u = resolve_stonex_unique_sheet_key(c, sheet_keys)
                        if u and u in sheet_map:
                            hit = sheet_map[u]
                            break
            if not hit and mfr == "__NATURAL_STONE__":
                for c in cands:
                    tgt = natural_aliases.get(c)
                    if tgt and tgt in sheet_map:
                        hit = sheet_map[tgt]
                        break
                if not hit:
                    for c in sorted(cands, key=lambda x: (-len(x), x)):
                        u = resolve_stonex_unique_sheet_key(c, sheet_keys)
                        if u and u in sheet_map:
                            hit = sheet_map[u]
                            break
            if not hit:
                continue
            stats["sheets_matched"] += 1
            numbered: list[dict[str, Any]] = []
            for idx, m in enumerate(hit, start=1):
                numbered.append(
                    {
                        "rank": idx,
                        "glue": m["glue"],
                        "form": m["form"],
                    }
                )
            it["integraGlue"] = numbered
            stats["items_updated"] += 1
    return stats


def main() -> None:
    if not CATALOG_PATH.is_file():
        raise SystemExit(f"Missing {CATALOG_PATH}")
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or "items" not in raw:
        raise SystemExit("catalog.json must be an object with items[]")

    stats = merge_into_catalog(raw)
    CATALOG_PATH.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"merge_integra_glue: pdfs={stats['pdfs']} items_updated={stats['items_updated']} "
        f"sheet_key_hits={stats['sheets_matched']} (written {CATALOG_PATH})"
    )


if __name__ == "__main__":
    main()
