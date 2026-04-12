#!/usr/bin/env python3
"""
Extract catalog items from PDFs in Catalogs/ and write merged public/catalog.json.
Run from repo root:  .venv\\Scripts\\python scripts/build_catalog.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOGS = ROOT / "Catalogs"
OUT = ROOT / "public" / "catalog.json"


def slug_id(parts: list[str]) -> str:
    raw = "|".join(parts)
    return re.sub(r"[^a-zA-Z0-9|._-]+", "-", raw)[:200]


def money(s: str) -> float | None:
    s = s.strip().replace("$", "").replace(",", "")
    s = re.sub(r"\(\d+\)\s*$", "", s).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def item(
    *,
    vendor: str,
    source_file: str,
    manufacturer: str,
    product_name: str,
    display_name: str,
    id_suffix: str = "",
    material: str,
    category: str,
    collection: str,
    tier_or_group: str,
    thickness: str,
    finish: str,
    size: str,
    sku: str,
    vendor_item_number: str,
    bundle_number: str,
    price_entries: list[dict[str, Any]],
    notes: str,
    freight_info: str,
    tags: list[str],
    availability_flags: list[str],
    raw: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": slug_id([vendor, source_file, sku or display_name, product_name, id_suffix]),
        "vendor": vendor,
        "manufacturer": manufacturer,
        "sourceFile": source_file,
        "productName": product_name,
        "displayName": display_name,
        "material": material,
        "category": category,
        "collection": collection,
        "tierOrGroup": tier_or_group,
        "thickness": thickness,
        "finish": finish,
        "size": size,
        "sku": sku,
        "vendorItemNumber": vendor_item_number,
        "bundleNumber": bundle_number,
        "priceEntries": price_entries,
        "notes": notes,
        "freightInfo": freight_info,
        "availabilityFlags": availability_flags,
        "tags": tags,
        "rawSourceFields": raw,
    }


# --- MSI ---
SKU_MSI = re.compile(r"^QSL-", re.I)
PRICE_LINE = re.compile(r"^\$[\d,]+\.?\d*\s*$")
GROUP_LINE = re.compile(r"^(?:Group|GROUP)\s+(\d+)$", re.I)
JUMBO_PAREN = re.compile(r"\(\s*jumbo\s*\)", re.I)
NEW_WORD = re.compile(r"\bnew\b", re.I)


def sanitize_msi_product_title(name: str) -> str:
    s = JUMBO_PAREN.sub("", name)
    s = NEW_WORD.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def parse_msi(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.rstrip() for l in text.splitlines()]
    out: list[dict[str, Any]] = []
    group = "Group 0"
    i = 0
    skip_next_price_continuation = False

    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        gm = GROUP_LINE.match(s)
        if gm:
            group = f"Group {gm.group(1)}"
            i += 1
            continue
        if re.match(r"^2CM ONLY", s, re.I):
            group = f"{group} | 2CM ONLY"
            i += 1
            continue
        if s in (
            "3cm-ID Num",
            "Size/SF",
            "$ / Sq ft",
            "$ /sq ft",
            "Q+",
        ) or s.startswith("Size/SF"):
            i += 1
            continue
        if SKU_MSI.match(s):
            sku = s.strip()
            name = lines[i - 1].strip() if i > 0 else ""
            if SKU_MSI.match(name):
                name = ""
            j = i + 1
            size_parts: list[str] = []
            while j < len(lines):
                t = lines[j].strip()
                if not t:
                    j += 1
                    continue
                if SKU_MSI.match(t):
                    break
                if PRICE_LINE.match(t):
                    p = money(t)
                    if p is None:
                        j += 1
                        continue
                    thick = (
                        "3 cm"
                        if "-3CM" in sku.upper()
                        else ("2 cm" if "-2CM" in sku.upper() else "")
                    )
                    label = f"{thick or 'Slab'} — per sq ft ({group.split('|')[0].strip()})"
                    pe = [
                        {
                            "label": label,
                            "price": p,
                            "unit": "sqft",
                            "thickness": thick,
                            "size": " ".join(size_parts)[:200],
                        }
                    ]
                    clean_name = sanitize_msi_product_title(name)
                    out.append(
                        item(
                            vendor="MSI",
                            source_file=source_file,
                            manufacturer="MSI Q Quartz",
                            product_name=clean_name,
                            display_name=clean_name,
                            material="Quartz",
                            category="Surfacing",
                            collection="Q Premium / Q+",
                            tier_or_group=group,
                            thickness=thick,
                            finish="",
                            size=" ".join(size_parts)[:200],
                            sku=sku,
                            vendor_item_number="",
                            bundle_number="",
                            price_entries=pe,
                            notes="Parsed from MSI Bronze price list PDF.",
                            freight_info="",
                            tags=["pdf-import", "msi"],
                            availability_flags=[],
                            raw={"sku": sku, "group": group},
                        )
                    )
                    i = j + 1
                    break
                size_parts.append(t)
                j += 1
            else:
                i += 1
            continue
        i += 1
    return out


# --- StoneX ---
STONE_TYPE = re.compile(
    r" - (Quartz|Granite|Marble|Marble Limestone|Limestone|Soapstone|Quartzite|Porcelain|Other)\s*$",
    re.I,
)


def parse_stonex(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.strip() for l in text.splitlines()]
    out: list[dict[str, Any]] = []
    i = 0
    header_markers = {
        "Stone Name",
        "Category",
        "Bundle #",
        "Sizes",
        "Single",
        "Price",
        "Bundle",
        "Price",
        "Tier 1",
        "Tier 2",
        "QUARTZ PRICE LIST",
        "NATURAL STONE",
    }

    while i < len(lines):
        s = lines[i]
        if not s or s in header_markers or "www.stonexusa.com" in s:
            i += 1
            continue
        if "PRICE LIST" in s and len(s) < 40:
            i += 1
            continue
        m = STONE_TYPE.search(s)
        if not m:
            i += 1
            continue
        name = s
        material = m.group(1).strip()
        if i + 1 >= len(lines):
            break
        category = lines[i + 1]
        bundle = lines[i + 2] if i + 2 < len(lines) else ""

        j = i + 3
        buf: list[str] = []
        prices: list[float] = []
        while j < len(lines):
            t = lines[j]
            if STONE_TYPE.search(t):
                break
            if t.startswith("$"):
                # merge broken "$16.0" + next line "0"
                price_str = t
                if j + 1 < len(lines) and re.match(r"^\d+\s*$", lines[j + 1]):
                    price_str = t + lines[j + 1].strip()
                    j += 1
                p = money(price_str)
                if p is not None:
                    prices.append(p)
                if len(prices) >= 2:
                    j += 1
                    break
                j += 1
                continue
            buf.append(t)
            j += 1

        size_blob = " ".join(buf).replace("\n", " ")
        size_blob = re.sub(r"\s+", " ", size_blob).strip()[:300]

        pe = []
        if len(prices) >= 1:
            pe.append(
                {
                    "label": "Single — per sq ft",
                    "price": prices[0],
                    "unit": "sqft",
                    "size": size_blob,
                }
            )
        if len(prices) >= 2:
            pe.append(
                {
                    "label": "Bundle — per sq ft",
                    "price": prices[1],
                    "unit": "sqft",
                    "size": size_blob,
                }
            )

        thick_m = re.search(r"\b(\d)\s*cm\b", name, re.I)
        thickness = f"{thick_m.group(1)} cm" if thick_m else ""
        fin_m = re.search(
            r"(Polished|Honed|Leathered|Brushed|Dual[^-]*)", name, re.I
        )
        finish = fin_m.group(1) if fin_m else ""

        out.append(
            item(
                vendor="StoneX",
                source_file=source_file,
                manufacturer="StoneX",
                product_name=name.split(" - ")[0].strip(),
                display_name=name,
                material=material,
                category=category,
                collection="",
                tier_or_group="",
                thickness=thickness,
                finish=finish,
                size=size_blob,
                sku="",
                vendor_item_number="",
                bundle_number=bundle,
                price_entries=pe,
                notes="Parsed from StoneX PDF.",
                freight_info="",
                tags=["pdf-import", "stonex"],
                availability_flags=[],
                raw={"bundle": bundle},
            )
        )
        i = j if j > i else i + 1
    return out


# --- Daltile natural stone ---
SKU_DALTILE = re.compile(r"^[A-Z]\d{3,4}(?:\s*\+\s*[A-Z]\d{3,4})?$")


def parse_daltile(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.strip() for l in text.splitlines()]
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        s = lines[i]
        if SKU_DALTILE.match(s) and i + 1 < len(lines):
            sku = s
            name = lines[i + 1]
            # next two non-empty lines that look like prices (X.XX with optional $)
            j = i + 2
            nums: list[float] = []
            while j < len(lines) and len(nums) < 2:
                t = lines[j]
                if not t:
                    j += 1
                    continue
                if SKU_DALTILE.match(t):
                    break
                if re.match(r"^\$?\s*[\d.]+\s*$", t.replace("$", "").strip()):
                    p = money(t if t.startswith("$") else "$" + t)
                    if p is not None:
                        nums.append(p)
                j += 1
                if len(nums) == 2:
                    break
            if len(nums) >= 2:
                pe = [
                    {
                        "label": "2 cm — per sq ft (Central region)",
                        "price": nums[0],
                        "unit": "sqft",
                        "thickness": "2 cm",
                    },
                    {
                        "label": "3 cm — per sq ft (Central region)",
                        "price": nums[1],
                        "unit": "sqft",
                        "thickness": "3 cm",
                    },
                ]
                out.append(
                    item(
                        vendor="Daltile",
                        source_file=source_file,
                        manufacturer="Daltile",
                        product_name=name,
                        display_name=name,
                        material="Natural stone",
                        category="Traditional (natural stone)",
                        collection="",
                        tier_or_group="",
                        thickness="2 cm / 3 cm",
                        finish="",
                        size="",
                        sku=sku,
                        vendor_item_number=sku,
                        bundle_number="",
                        price_entries=pe,
                        notes="Parsed from Daltile Central natural stone PDF.",
                        freight_info="Price excludes freight; see Daltile terms.",
                        tags=["pdf-import", "daltile"],
                        availability_flags=[],
                        raw={"sku": sku},
                    )
                )
            i = i + 1
            continue
        i += 1
    return out


# --- HanStone (Hyundai) — split on COLLECTION blocks from price sheet page ---
def parse_hanstone(text: str, source_file: str) -> list[dict[str, Any]]:
    text = text.replace("\r\n", "\n")
    parts = re.split(
        r"(?mi)^(VALUE|DESIGNER|IMAGINATION|PREMIUM|PREMIUM \+|PLATINUM)\s+COLLECTION\s*$",
        text,
    )
    out: list[dict[str, Any]] = []
    # parts: [preamble, coll_word, body, coll_word, body, ...]
    idx = 1
    while idx + 1 < len(parts):
        coll_word = parts[idx].strip().upper()
        body = parts[idx + 1]
        idx += 2
        collection = f"{coll_word} COLLECTION"

        sqft_3 = sqft_2 = None
        m3 = re.search(r"3CM\s*\|\s*\$\s*([\d,]+\.?\d*)", body, re.I)
        m2 = re.search(r"2CM\s*\|\s*\$\s*([\d,]+\.?\d*)", body, re.I)
        if m3:
            sqft_3 = money("$" + m3.group(1))
        if m2:
            sqft_2 = money("$" + m2.group(1))

        jumbo_3 = jumbo_2 = None
        jm = re.search(
            r"JUMBO SIZE\s*\n\s*65[\"']?\s*[xX]\s*130[\"']?\s*\n\s*"
            r"\$([\d,]+\.?\d*)\s*\n\s*\$([\d,]+\.?\d*)",
            body,
            re.I,
        )
        if jm:
            jumbo_3 = money("$" + jm.group(1))
            jumbo_2 = money("$" + jm.group(2))

        colors: list[str] = []
        for line in body.splitlines():
            s = line.strip()
            if not s or len(s) > 52:
                continue
            up = s.upper()
            if up in (
                "PER SQ FT",
                "JUMBO SIZE",
                "LEATHER",
                "RIVERWASH",
                "NEW PRICE GROUP",
            ):
                continue
            if "HYUNDAI" in up or "CHARTER" in up or "PRICE SHEET" in up:
                continue
            if re.search(r"CM\s*\|", s, re.I):
                continue
            if s.startswith("$") or re.match(r"^[\d.,]+\s*$", s.replace(",", "")):
                continue
            if re.match(r'^65["\']?\s*[xX]\s*130', s):
                continue
            if re.match(r"^2025\s+PRICE", up):
                continue
            if not re.match(r"^[A-Za-z]", s):
                continue
            if re.search(r"\$\s*[\d]", s):
                continue
            colors.append(s)

        seen: set[str] = set()
        for col in colors:
            key = col.upper()
            if key in seen:
                continue
            seen.add(key)
            if sqft_3 is None and sqft_2 is None:
                continue
            pe: list[dict[str, Any]] = []
            if sqft_2 is not None:
                pe.append(
                    {
                        "label": f"{collection} — 2cm per sq ft",
                        "price": sqft_2,
                        "unit": "sqft",
                        "thickness": "2 cm",
                    }
                )
            if sqft_3 is not None:
                pe.append(
                    {
                        "label": f"{collection} — 3cm per sq ft",
                        "price": sqft_3,
                        "unit": "sqft",
                        "thickness": "3 cm",
                    }
                )
            if jumbo_3 is not None:
                pe.append(
                    {
                        "label": "Jumbo slab 65×130 — 3cm (list)",
                        "price": jumbo_3,
                        "unit": "slab",
                        "thickness": "3 cm",
                        "size": '65" × 130"',
                    }
                )
            if jumbo_2 is not None:
                pe.append(
                    {
                        "label": "Jumbo slab 65×130 — 2cm (list)",
                        "price": jumbo_2,
                        "unit": "slab",
                        "thickness": "2 cm",
                        "size": '65" × 130"',
                    }
                )
            disp = col.strip().title()
            out.append(
                item(
                    vendor="HanStone Quartz",
                    source_file=source_file,
                    manufacturer="HanStone",
                    product_name=col.strip().title(),
                    display_name=disp,
                    material="Quartz",
                    category="Surfacing",
                    collection=collection,
                    tier_or_group=collection,
                    thickness="",
                    finish="",
                    size='Jumbo 65" × 130" (see PDF)',
                    sku="",
                    vendor_item_number="",
                    bundle_number="",
                    price_entries=pe,
                    notes="Parsed from HanStone MW IL/WI price sheet (collection tier + color list).",
                    freight_info="See PDF freight table for IL/WI.",
                    tags=["pdf-import", "hanstone", "collection-expanded"],
                    availability_flags=["regional"],
                    raw={"color": col, "collection": collection},
                )
            )
    return out


# --- UGM UQuartz ---
def parse_ugm_uquartz(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if lines[i] in ("UQuartz", "Printed UQuartz") and i >= 2 and i + 1 < len(lines):
            price_line = lines[i + 1]
            if price_line.startswith("$"):
                name = lines[i - 2]
                size_blob = lines[i - 1]
                brand = lines[i]
                p = money(price_line)
                if p is not None:
                    thick = ""
                    nu = name.upper()
                    if "2CM" in nu or "2 CM" in nu:
                        thick = "2 cm"
                    elif "3CM" in nu or "3 CM" in nu:
                        thick = "3 cm"
                    out.append(
                        item(
                            vendor="UGM",
                            source_file=source_file,
                            manufacturer=brand,
                            product_name=name,
                            display_name=name,
                            material="Quartz",
                            category="Surfacing",
                            collection="UQuartz",
                            tier_or_group="",
                            thickness=thick,
                            finish="",
                            size=size_blob,
                            sku="",
                            vendor_item_number="",
                            bundle_number="",
                            price_entries=[
                                {
                                    "label": "Price per sq ft",
                                    "price": p,
                                    "unit": "sqft",
                                    **({"thickness": thick} if thick else {}),
                                }
                            ],
                            notes="Parsed from UGM UQuartz PDF.",
                            freight_info="",
                            tags=["pdf-import", "ugm", "uquartz"],
                            availability_flags=[],
                            raw={"brand": brand},
                        )
                    )
                i += 2
                continue
        i += 1
    return out


# --- UGM Natural Stone (simple name + $/sqft) ---
def parse_ugm_natural(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    out: list[dict[str, Any]] = []
    i = 0
    while i + 1 < len(lines):
        name = lines[i]
        nxt = lines[i + 1]
        if nxt.startswith("$") and not name.startswith("$"):
            up = name.upper()
            if up in (
                "NATURAL STONE COLOR",
                "PRICE PER SQUARE FOOT",
            ) or "STREET" in up or "OAK CREEK" in up:
                i += 1
                continue
            p = money(nxt)
            if p is not None and 2 < len(name) < 90:
                mat = "Natural stone"
                if "MARBLE" in up:
                    mat = "Marble"
                elif "QUARTZ" in up:
                    mat = "Quartzite"
                out.append(
                    item(
                        vendor="UGM",
                        source_file=source_file,
                        manufacturer="UGM Natural",
                        product_name=name,
                        display_name=name,
                        id_suffix=str(p),
                        material=mat,
                        category="Natural",
                        collection="",
                        tier_or_group="",
                        thickness="",
                        finish="",
                        size="",
                        sku="",
                        vendor_item_number="",
                        bundle_number="",
                        price_entries=[
                            {"label": "Price per sq ft", "price": p, "unit": "sqft"}
                        ],
                        notes="Parsed from UGM Natural Stone PDF.",
                        freight_info="",
                        tags=["pdf-import", "ugm", "natural-stone"],
                        availability_flags=[],
                        raw={},
                    )
                )
            i += 2
            continue
        i += 1
    return out


# --- Trends in Quartz (Jaeckle) — TIQ item# rows ---
TIQ = re.compile(r"^(TIQ[A-Z0-9]+)$")


def parse_trends(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.strip() for l in text.splitlines()]
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if TIQ.match(lines[i]) and i >= 3:
            sku = lines[i]
            finish = lines[i - 1]
            color_num = lines[i - 2]
            name = lines[i - 3]
            # next lines: slab $, sqft $, maybe IAI
            j = i + 1
            slab_p = sqft_p = None
            if j < len(lines) and lines[j].startswith("$"):
                slab_p = money(lines[j])
                j += 1
            if j < len(lines) and lines[j].startswith("$"):
                sqft_p = money(lines[j])
                j += 1
            pe = []
            if slab_p is not None:
                pe.append(
                    {
                        "label": "3cm Jumbo slab — per slab",
                        "price": slab_p,
                        "unit": "slab",
                        "thickness": "3 cm",
                    }
                )
            if sqft_p is not None:
                pe.append(
                    {
                        "label": "3cm — per sq ft",
                        "price": sqft_p,
                        "unit": "sqft",
                        "thickness": "3 cm",
                    }
                )
            if pe:
                out.append(
                    item(
                        vendor="Jaeckle Distributors",
                        source_file=source_file,
                        manufacturer="Trends in Quartz",
                        product_name=name,
                        display_name=name,
                        material="Quartz",
                        category="Surfacing",
                        collection="",
                        tier_or_group="",
                        thickness="3 cm",
                        finish=finish,
                        size='65" × 130" Jumbo',
                        sku=sku,
                        vendor_item_number=color_num,
                        bundle_number="",
                        price_entries=pe,
                        notes="Parsed from Trends in Quartz PDF (Bella Stone account).",
                        freight_info="",
                        tags=["pdf-import", "jaeckle", "trends"],
                        availability_flags=[],
                        raw={"colorNumber": color_num, "finish": finish},
                    )
                )
            i = j
            continue
        i += 1
    return out


def read_pdf(path: Path) -> str:
    import fitz

    doc = fitz.open(path)
    parts = []
    for p in range(len(doc)):
        parts.append(doc[p].get_text())
    doc.close()
    return "\n".join(parts)


def parse_viatera_pdfplumber(path: Path) -> list[dict[str, Any]]:
    import pdfplumber

    out: list[dict[str, Any]] = []
    with pdfplumber.open(path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            tables = page.extract_tables() or []
            for t in tables:
                if not t or not t[0]:
                    continue
                header = " ".join([str(x or "") for x in t[0]]).lower()
                if "color" in header and "slab" in header and "price" in header:
                    # rows like: ["", "Destin White, Sonoran Beige", "Jumbo I", "1.5 cm", "$12.00", "$660.00"]
                    for row in t[2:]:
                        if not row or len(row) < 6:
                            continue
                        color_blob = (row[1] or "").strip()
                        slab_size = (row[2] or "").replace("\n", " ").strip()
                        thickness = (row[3] or "").strip()
                        sqft = money(str(row[4] or ""))
                        slab = money(str(row[5] or ""))
                        if not color_blob or (sqft is None and slab is None):
                            continue

                        # split comma-separated colors; keep single-line names too
                        colors = []
                        for part in re.split(r",|\n", color_blob):
                            s = part.strip()
                            if s:
                                colors.append(s)
                        for color in colors:
                            pe: list[dict[str, Any]] = []
                            if sqft is not None:
                                pe.append(
                                    {
                                        "label": f"{thickness} — per sq ft",
                                        "price": sqft,
                                        "unit": "sqft",
                                        "thickness": thickness,
                                        "size": slab_size,
                                    }
                                )
                            if slab is not None:
                                pe.append(
                                    {
                                        "label": f"{thickness} — per slab",
                                        "price": slab,
                                        "unit": "slab",
                                        "thickness": thickness,
                                        "size": slab_size,
                                    }
                                )
                            out.append(
                                item(
                                    vendor="LX Hausys (Viatera)",
                                    source_file=path.name,
                                    manufacturer="Viatera",
                                    product_name=color,
                                    display_name=color,
                                    material="Quartz",
                                    category="Surfacing",
                                    collection="",
                                    tier_or_group="",
                                    thickness=thickness,
                                    finish="",
                                    size=slab_size,
                                    sku="",
                                    vendor_item_number="",
                                    bundle_number="",
                                    price_entries=pe,
                                    notes="Parsed from Viatera project PDF table.",
                                    freight_info="",
                                    tags=["pdf-import", "viatera"],
                                    availability_flags=[],
                                    raw={"page": page_idx + 1},
                                )
                            )
    return out


def parse_vadara_pdfplumber(path: Path) -> list[dict[str, Any]]:
    import pdfplumber

    out: list[dict[str, Any]] = []
    with pdfplumber.open(path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            for t in page.extract_tables() or []:
                if not t or not t[0]:
                    continue
                if [c for c in t[0] if c] != ["Color", "Size", "Book Match", "Slab Price", "SQFT Price"]:
                    continue
                for row in t[1:]:
                    if not row or len(row) < 5:
                        continue
                    colors_blob = (row[0] or "").strip()
                    size = (row[1] or "").strip()
                    book_match = (row[2] or "").strip()
                    slab_price = (row[3] or "").strip()
                    sqft_price = (row[4] or "").strip()
                    slab = money(slab_price.replace("+", "").strip())
                    sqft = money(sqft_price)
                    if not colors_blob or (slab is None and sqft is None):
                        continue
                    colors = [c.strip() for c in re.split(r"\n|,", colors_blob) if c.strip()]
                    finish = "Leather" if re.search(r"\(Leather\)", colors_blob, re.I) else ""
                    for color in colors:
                        clean_color = re.sub(r"\s*\+\s*\(New\)\s*$", "", color, flags=re.I).strip()
                        pe: list[dict[str, Any]] = []
                        if sqft is not None:
                            pe.append(
                                {
                                    "label": "3cm — per sq ft",
                                    "price": sqft,
                                    "unit": "sqft",
                                    "thickness": "3 cm",
                                    "size": size,
                                }
                            )
                        if slab is not None:
                            pe.append(
                                {
                                    "label": "3cm — per slab",
                                    "price": slab,
                                    "unit": "slab",
                                    "thickness": "3 cm",
                                    "size": size,
                                }
                            )
                        out.append(
                            item(
                                vendor="UGM",
                                source_file=path.name,
                                manufacturer="Vadara",
                                product_name=clean_color,
                                display_name=clean_color,
                                material="Quartz",
                                category="Surfacing",
                                collection="Vadara",
                                tier_or_group="",
                                thickness="3 cm",
                                finish=finish,
                                size=size,
                                sku="",
                                vendor_item_number="",
                                bundle_number="",
                                price_entries=pe,
                                notes="Parsed from Vadara PDF table (all slabs 3cm).",
                                freight_info="",
                                tags=["pdf-import", "vadara", "ugm"],
                                availability_flags=[],
                                raw={"bookMatch": book_match, "page": page_idx + 1},
                            )
                        )
    return out


def parse_corian_pdfplumber(path: Path) -> list[dict[str, Any]]:
    import pdfplumber

    out: list[dict[str, Any]] = []
    slab_code_map = {
        "S": 'Standard 63"×120"',
        "E": 'Extended 63"×126"',
        "J": 'Jumbo 65"×130"',
    }
    with pdfplumber.open(path) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            if "Corian" not in text and "Quartz" not in text and "Group" not in text:
                continue
            tables = page.extract_tables() or []
            for t in tables:
                if not t or len(t) < 8:
                    continue
                # detect the price row: ["Price per sq. ft. $25.86 $29.39", ...]
                price_row = None
                for r in t:
                    if r and r[0] and isinstance(r[0], str) and "Price per sq. ft." in r[0]:
                        price_row = r[0]
                        break
                if not price_row:
                    continue
                pm = re.search(r"\$([\d,]+\.\d+)\s*\$([\d,]+\.\d+)", price_row)
                if not pm:
                    continue
                p2 = money("$" + pm.group(1))
                p3 = money("$" + pm.group(2))
                if p2 is None and p3 is None:
                    continue

                # group number from page text (best-effort)
                gm = re.search(r"Group\s+(\d+)", text, re.I)
                group = f"Group {gm.group(1)}" if gm else ""

                # data rows tend to look like: ["Cloud White", "S/J", "ST", "ST", "Rice Paper", "Translucent White"]
                for row in t:
                    if not row or not row[0] or row[0] in ("Color Name", None):
                        continue
                    if not isinstance(row[0], str):
                        continue
                    color = row[0].strip()
                    if not color or color.lower().startswith("price per"):
                        continue
                    sizes = (row[1] or "").strip() if len(row) > 1 else ""
                    stocked_2 = (row[2] or "").strip().upper() == "ST" if len(row) > 2 else False
                    stocked_3 = (row[3] or "").strip().upper() == "ST" if len(row) > 3 else False
                    size_desc = " / ".join([slab_code_map.get(c.strip(), c.strip()) for c in sizes.split("/") if c.strip()])

                    pe: list[dict[str, Any]] = []
                    if p2 is not None:
                        pe.append(
                            {
                                "label": f"{group} — 2cm per sq ft",
                                "price": p2,
                                "unit": "sqft",
                                "thickness": "2 cm",
                            }
                        )
                    if p3 is not None:
                        pe.append(
                            {
                                "label": f"{group} — 3cm per sq ft",
                                "price": p3,
                                "unit": "sqft",
                                "thickness": "3 cm",
                            }
                        )

                    flags: list[str] = []
                    if stocked_2 or stocked_3:
                        flags.append("stocked")
                    if stocked_2:
                        flags.append("stocked-2cm")
                    if stocked_3:
                        flags.append("stocked-3cm")

                    out.append(
                        item(
                            vendor="Hallmark Building Supplies",
                            source_file=path.name,
                            manufacturer="Corian Quartz",
                            product_name=color,
                            display_name=color,
                            material="Quartz",
                            category="Surfacing",
                            collection=group,
                            tier_or_group=group,
                            thickness="2 cm / 3 cm",
                            finish="",
                            size=size_desc,
                            sku="",
                            vendor_item_number="",
                            bundle_number="",
                            price_entries=pe,
                            notes="Parsed from Corian Quartz / Hallmark slab pricing tables.",
                            freight_info="Stock status varies by warehouse; verify ST status in PDF/MyAccount.",
                            tags=["pdf-import", "corian", "hallmark"],
                            availability_flags=flags,
                            raw={"sizesCode": sizes, "page": page_idx + 1},
                        )
                    )
    return out


# --- Cosentino — Silestone full slab (USD/slab, Regular + Jumbo × 12/20/30 mm) ---
SILESTONE_SLAB_DIMS = (
    ("Regular", 'Up to 120" × 55"'),
    ("Jumbo", 'Up to 128" × 62"'),
)
SILESTONE_THICKS = ("12 mm", "20 mm", "30 mm")


def _extract_silestone_slab_section(full_text: str) -> str:
    """Block for Silestone countertop slabs (not flooring tiles)."""
    # PDF text often splits headers across lines (USD/slab on two lines; Group / Color / … each on its own line).
    m = re.search(
        r'Regular size - Up to 120" x 55"\s*\n'
        r'Jumbo size - Up to 128" x 62"\s*\n'
        r"USD/slab\s*\n\s*USD/slab\s*\n\s*Group\s*\n\s*Color\s*\n\s*Finish",
        full_text,
        re.I,
    )
    if not m:
        return ""
    start = m.start()
    end = full_text.find("FLOORING PRICES", start)
    if end < 0:
        end = len(full_text)
    return full_text[start:end]


def _silestone_extract_cells(rest: str) -> tuple[str, list[str | None]]:
    """Legacy: single-line row (unused when PDF splits cells per line)."""
    tok = rest.split()
    start_idx = None
    for i, t in enumerate(tok):
        if t == "-" or re.match(r"^\$[\d,]+\.\d{2}", t):
            start_idx = i
            break
    if start_idx is None:
        return rest, []
    cells_raw = tok[start_idx : start_idx + 6]
    while len(cells_raw) < 6:
        cells_raw.append("-")
    cells_raw = cells_raw[:6]
    cells: list[str | None] = []
    for c in cells_raw:
        if c == "-":
            cells.append(None)
        elif c.startswith("$"):
            cells.append(c)
        else:
            cells.append(None)
    return " ".join(tok[:start_idx]), cells


_SLAB_PRICE_LINE = re.compile(r"^\$[\d,]+(?:\.\d{2})?(?:\(\d+\))?$")


def _silestone_take_six_cell_lines(lines: list[str], start_i: int) -> tuple[list[str | None], int]:
    """Read six slab price cells; each cell is one line: '-' or '\$…'."""
    i = start_i
    while i < len(lines):
        t = lines[i].strip()
        if t == "-" or _SLAB_PRICE_LINE.match(t):
            break
        i += 1
    cells: list[str | None] = []
    while i < len(lines) and len(cells) < 6:
        t = lines[i].strip()
        if t == "-":
            cells.append(None)
            i += 1
        elif _SLAB_PRICE_LINE.match(t):
            cells.append(t)
            i += 1
        else:
            break
    while len(cells) < 6:
        cells.append(None)
    return cells[:6], i


def _silestone_row_to_price_entries(cells: list[str | None]) -> list[dict[str, Any]]:
    pe: list[dict[str, Any]] = []
    idx = 0
    for size_name, dim in SILESTONE_SLAB_DIMS:
        for th in SILESTONE_THICKS:
            if idx >= len(cells):
                break
            raw = cells[idx]
            idx += 1
            if not raw:
                continue
            p = money(raw)
            if p is None:
                continue
            pe.append(
                {
                    "label": f"{size_name} — {dim} — {th} — per slab",
                    "price": p,
                    "unit": "slab",
                    "thickness": th,
                    "size": dim,
                }
            )
    return pe


def _parse_silestone_slab_lines(block: str, source_file: str) -> list[dict[str, Any]]:
    """Parse Silestone slab table where each PDF cell is on its own text line."""
    raw_lines = [ln.strip() for ln in block.splitlines()]
    lines: list[str] = []
    for ln in raw_lines:
        if not ln:
            continue
        if ln.startswith("ɽ") or ln.startswith("Contain a Maximum"):
            continue
        if ln.startswith("Prices do not") or "COSENTINO NORTH" in ln:
            continue
        lines.append(ln)

    # Data begins after: 12 mm / 20 mm / 30 mm (Regular) then 12 / 20 / 30 mm (Jumbo).
    data_start = 0
    for i in range(len(lines) - 6):
        if lines[i : i + 6] == ["12 mm", "20 mm", "30 mm", "12 mm", "20 mm", "30 mm"]:
            data_start = i + 6
            break

    out: list[dict[str, Any]] = []
    i = data_start
    while i < len(lines):
        ln = lines[i]
        if ln == "FLOORING PRICES":
            break
        if ln == "FULL SLAB PRICES":
            i += 1
            continue
        if i + 6 <= len(lines) and lines[i : i + 6] == [
            "12 mm",
            "20 mm",
            "30 mm",
            "12 mm",
            "20 mm",
            "30 mm",
        ]:
            i += 6
            continue
        if re.fullmatch(r"\d{2,3}", ln):
            i += 1
            continue
        if ln in ("SILESTONE", "KEY", "Group", "Color", "Finish", "Technology", "Integrity", "Polished", "Suede"):
            i += 1
            continue
        if ln == "USD/slab":
            i += 1
            continue
        if re.fullmatch(r"\d+", ln) and len(ln) <= 2:
            i += 1
            continue
        if ln.startswith("Regular size") or ln.startswith("Jumbo size"):
            i += 1
            continue

        color_parts: list[str] = []
        while i < len(lines):
            nxt = lines[i]
            if nxt in ("p", "l", "p l"):
                break
            if re.fullmatch(r"\d+", nxt) and len(nxt) <= 2 and not color_parts:
                i += 1
                continue
            if nxt in ("FLOORING PRICES", "FULL SLAB PRICES"):
                break
            if nxt in ("12 mm", "20 mm", "30 mm", "USD/slab"):
                break
            color_parts.append(nxt)
            i += 1

        if not color_parts:
            i += 1
            continue
        color = re.sub(r"\s+", " ", " ".join(color_parts)).strip()
        color = re.sub(r"\s+NEW\s*$", " NEW", color).strip()
        if not color or i >= len(lines):
            continue

        fin = lines[i]
        i += 1
        if fin == "p" and i < len(lines) and lines[i] == "l":
            fin = "p l"
            i += 1
        if fin not in ("p", "l", "p l"):
            continue

        # Technology / Integrity single-letter codes (e.g. "i"); do not consume "-" or "$" — those start slab cells.
        while i < len(lines):
            t = lines[i]
            if t == "i" or t == "F":
                i += 1
                continue
            if len(t) == 1 and t.isalpha() and t not in ("p", "l"):
                i += 1
                continue
            break

        cells, i = _silestone_take_six_cell_lines(lines, i)
        if len(cells) != 6:
            continue
        pe = _silestone_row_to_price_entries(cells)
        if not pe:
            continue
        out.append(
            item(
                vendor="Cosentino",
                source_file=source_file,
                manufacturer="Silestone / Cosentino",
                product_name=color,
                display_name=color,
                material="Quartz",
                category="Surfacing",
                collection="Silestone",
                tier_or_group="",
                thickness="12 mm / 20 mm / 30 mm",
                finish="Polished / Suede (see PDF)",
                size='Regular & Jumbo (see price lines)',
                sku="",
                vendor_item_number="",
                bundle_number="",
                price_entries=pe,
                notes="Parsed from Cosentino 2026 PDF — Silestone full slab table (USD/slab). Suede +10% where noted in PDF.",
                freight_info="Verify availability and pricing with Cosentino.",
                tags=["pdf-import", "cosentino", "silestone"],
                availability_flags=[],
                raw={"finishCode": fin},
            )
        )
    return out


def parse_cosentino_silestone_slabs(full_text: str, source_file: str) -> list[dict[str, Any]]:
    block = _extract_silestone_slab_section(full_text)
    if not block:
        return []
    return _parse_silestone_slab_lines(block, source_file)


# --- Cosentino — Scalea & Sensa natural stone (USD/sq.ft per slab) ---
_STONE_TYPES = frozenset({"Granite", "Marble", "Quartzite", "Soapstone"})


def _parse_cosentino_natural_stone_table_block(block: str, source_file: str, *, sensa: bool) -> list[dict[str, Any]]:
    """PDF emits one cell per line: Color / Type / Origin / Finish / \$20 / \$30."""

    def row_item(name: str, typ: str, origin: str, fin: str, p20: float | None, p30: float | None) -> dict[str, Any] | None:
        if p20 is None and p30 is None:
            return None
        display = name
        if sensa and not name.lower().startswith("sensa "):
            display = f"Sensa {name}"
        collection = "Sensa by Cosentino" if sensa else "Scalea"
        manufacturer = "Sensa by Cosentino" if sensa else "Scalea / Cosentino"
        pe: list[dict[str, Any]] = []
        if p20 is not None:
            pe.append({"label": "20 mm — per sq ft (slab)", "price": p20, "unit": "sqft", "thickness": "20 mm"})
        if p30 is not None:
            pe.append({"label": "30 mm — per sq ft (slab)", "price": p30, "unit": "sqft", "thickness": "30 mm"})
        return item(
            vendor="Cosentino",
            source_file=source_file,
            manufacturer=manufacturer,
            product_name=display,
            display_name=display,
            material=typ,
            category="Surfacing",
            collection=collection,
            tier_or_group="",
            thickness="20 mm / 30 mm",
            finish=fin,
            size="Individual slab (see PDF)",
            sku="",
            vendor_item_number="",
            bundle_number="",
            price_entries=pe,
            notes=f"Parsed from Cosentino 2026 PDF — natural stone slab list. Origin: {origin}.",
            freight_info="Verify availability and pricing with Cosentino.",
            tags=["pdf-import", "cosentino", "natural-stone"],
            availability_flags=[],
            raw={"origin": origin, "stoneType": typ},
        )

    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    out: list[dict[str, Any]] = []
    i = 0
    while i + 5 < len(lines):
        name = lines[i]
        typ = lines[i + 1]
        origin = lines[i + 2]
        fin = lines[i + 3]
        p20s = lines[i + 4]
        p30s = lines[i + 5]
        if typ not in _STONE_TYPES:
            i += 1
            continue
        p20 = None if p20s == "-" else money(p20s)
        p30 = None if p30s == "-" else money(p30s)
        i += 6
        it = row_item(name, typ, origin, fin, p20, p30)
        if it:
            out.append(it)
        if i < len(lines) and lines[i] == "Leather" and i + 2 < len(lines):
            p20b = money(lines[i + 1])
            p30b = money(lines[i + 2])
            i += 3
            it2 = row_item(name, typ, origin, "Leather", p20b, p30b)
            if it2:
                out.append(it2)
    return out


def parse_cosentino_natural_stone_slabs(path: Path) -> list[dict[str, Any]]:
    import fitz

    doc = fitz.open(path)
    try:
        p40 = doc[39].get_text() if len(doc) > 39 else ""
        p41 = doc[40].get_text() if len(doc) > 40 else ""
        p42 = doc[41].get_text() if len(doc) > 41 else ""
        p43 = doc[42].get_text() if len(doc) > 42 else ""
    finally:
        doc.close()
    out: list[dict[str, Any]] = []
    if "Individual slab - USD/sq.ft" in p40:
        m = re.search(
            r"Individual slab - USD/sq\.ft\s*(.*?)Prices do not include taxes\.",
            p40,
            re.S | re.I,
        )
        if m:
            out.extend(_parse_cosentino_natural_stone_table_block(m.group(1), path.name, sensa=False))
    if "Individual slab - USD/sq.ft" in p41:
        m = re.search(
            r"Individual slab - USD/sq\.ft\s*(.*?)Prices do not include taxes\.",
            p41,
            re.S | re.I,
        )
        if m:
            out.extend(_parse_cosentino_natural_stone_table_block(m.group(1), path.name, sensa=False))
    sensa_blob = "\n".join([p42, p43])
    if "Sensa" in sensa_blob and "Individual slab - USD/sq.ft" in sensa_blob:
        m = re.search(
            r"Individual slab - USD/sq\.ft\s*(.*?)Prices do not include taxes\.",
            sensa_blob,
            re.S | re.I,
        )
        if m:
            out.extend(_parse_cosentino_natural_stone_table_block(m.group(1), path.name, sensa=True))
    return out


# --- Cosentino — ĒCLOS full slab (USD/slab) ---
_ECLOS_FINISH = {"g": "Glossy", "s": "Smooth"}


def parse_cosentino_eclos_slabs(path: Path) -> list[dict[str, Any]]:
    """Page 13 in Cosentino 2026: group name, then one or more 'Color C.SOON' rows (j/g/s + prices)."""
    import fitz

    doc = fitz.open(path)
    try:
        if len(doc) < 13:
            return []
        p13 = doc[12].get_text()
    finally:
        doc.close()
    lines = [ln.strip() for ln in p13.splitlines() if ln.strip()]
    try:
        start = lines.index("3 cm") + 1
    except ValueError:
        start = 0
    lines = lines[start:]
    out: list[dict[str, Any]] = []
    current_group = ""
    i = 0
    while i < len(lines):
        ln = lines[i]
        if i + 1 < len(lines) and re.search(r"\s+C\.SOON$", lines[i + 1]):
            current_group = ln
            i += 1
            continue
        if not re.search(r"\s+C\.SOON$", ln):
            i += 1
            continue
        name = re.sub(r"\s+C\.SOON\s*$", "", ln, flags=re.I).strip()
        name = re.sub(r"\s+", " ", name)
        if i + 4 >= len(lines):
            break
        _siz_k = lines[i + 1]
        fin_k = lines[i + 2]
        p2s, p3s = lines[i + 3], lines[i + 4]
        if _siz_k != "j" or fin_k not in ("g", "s") or not p2s.startswith("$") or not p3s.startswith("$"):
            i += 1
            continue
        p2 = money(p2s)
        p3 = money(p3s)
        finish = _ECLOS_FINISH.get(fin_k, fin_k)
        pe: list[dict[str, Any]] = []
        if p2 is not None:
            pe.append(
                {
                    "label": f'Jumbo — Up to 128" × 62" — 2 cm — {finish} — per slab',
                    "price": p2,
                    "unit": "slab",
                    "thickness": "2 cm",
                    "size": 'Up to 128" × 62"',
                }
            )
        if p3 is not None:
            pe.append(
                {
                    "label": f'Jumbo — Up to 128" × 62" — 3 cm — {finish} — per slab',
                    "price": p3,
                    "unit": "slab",
                    "thickness": "3 cm",
                    "size": 'Up to 128" × 62"',
                }
            )
        if not pe:
            i += 5
            continue
        out.append(
            item(
                vendor="Cosentino",
                source_file=path.name,
                manufacturer="ĒCLOS / Cosentino",
                product_name=name,
                display_name=name + " (ĒCLOS)",
                material="Mineral surface",
                category="Surfacing",
                collection="ĒCLOS",
                tier_or_group=current_group,
                thickness="2 cm / 3 cm",
                finish=finish,
                size='Jumbo up to 128" × 62"',
                sku="",
                vendor_item_number="",
                bundle_number="",
                price_entries=pe,
                notes="Parsed from Cosentino 2026 PDF — ĒCLOS full slab (C.SOON = coming soon; verify availability).",
                freight_info="Verify availability and pricing with Cosentino.",
                tags=["pdf-import", "cosentino", "eclos"],
                availability_flags=["coming-soon"],
                raw={"sizeKey": _siz_k, "finishKey": fin_k},
            )
        )
        i += 5
    return out


def parse_cosentino_pdf(path: Path) -> list[dict[str, Any]]:
    """Full Cosentino 2026 price guide: Quick Ship + Silestone slabs + natural stone + ĒCLOS."""
    import fitz

    doc = fitz.open(path)
    try:
        full = "\n".join(doc[i].get_text() for i in range(len(doc)))
    finally:
        doc.close()
    if len(full.strip()) < 50:
        return []
    out: list[dict[str, Any]] = []
    out.extend(parse_cosentino_quickship(full, path.name))
    out.extend(parse_cosentino_silestone_slabs(full, path.name))
    out.extend(parse_cosentino_natural_stone_slabs(path))
    out.extend(parse_cosentino_eclos_slabs(path))
    return out


# --- Cosentino (best-effort) — Quick Ship accessory tables with Price (USD/unit) ---
def parse_cosentino_quickship(text: str, source_file: str) -> list[dict[str, Any]]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        if lines[i].upper() == "DESCRIPTION" and i + 3 < len(lines) and "PRICE" in lines[i + 3].upper():
            # header likely: Description / Format (inches) / Available colors / Price (USD/unit)
            i += 1
            continue
        if re.search(r"Price\s*\(USD/unit\)", lines[i], re.I):
            i += 1
            continue
        # capture rows like:
        # 36" x 22" x 6"
        # Desert Silver
        # $2,399
        if re.match(r'^\d+\"\s*x\s*\d+\"\s*x\s*\d+\"', lines[i]):
            size = lines[i]
            j = i + 1
            while j + 1 < len(lines) and not re.match(r'^\d+\"\s*x', lines[j]):
                color = lines[j]
                price = lines[j + 1] if j + 1 < len(lines) else ""
                if price.startswith("$"):
                    p = money(price)
                    if p is not None and color and len(color) < 60:
                        out.append(
                            item(
                                vendor="Cosentino",
                                source_file=source_file,
                                manufacturer="Silestone / Cosentino",
                                product_name=f"{color} sink/accessory",
                                display_name=f"{color} — {size}",
                                material="Accessory",
                                category="Sinks / Accessories",
                                collection="Quick Ship",
                                tier_or_group="",
                                thickness="",
                                finish="",
                                size=size,
                                sku="",
                                vendor_item_number="",
                                bundle_number="",
                                price_entries=[
                                    {
                                        "label": "Price per unit",
                                        "price": p,
                                        "unit": "each",
                                    }
                                ],
                                notes="Parsed from Cosentino 2026 PDF (Quick Ship tables; best-effort).",
                                freight_info="Verify availability and pricing with Cosentino.",
                                tags=["pdf-import", "cosentino", "quick-ship"],
                                availability_flags=[],
                                raw={"color": color},
                            )
                        )
                    j += 2
                else:
                    j += 1
            i = j
            continue
        i += 1
    return out


def main() -> None:
    import warnings

    warnings.filterwarnings("ignore")
    all_items: list[dict[str, Any]] = []
    import_warnings: list[dict[str, Any]] = []

    jobs: list[tuple[str, Path, Any]] = [
        ("msi", CATALOGS / "MSI Q Quartz Bronze Price List - October 2025.pdf", parse_msi),
        (
            "stonex_q",
            CATALOGS / "StoneX Quartz Price List 08-27-2024_compressed.pdf",
            lambda t, s: parse_stonex(t, s),
        ),
        (
            "stonex_n",
            CATALOGS / "StoneX Natural Stones Price List 08-27-2024_compressed.pdf",
            lambda t, s: parse_stonex(t, s),
        ),
        ("daltile", CATALOGS / "Daltile 2025 Central Price Book.pdf", parse_daltile),
        ("hanstone", CATALOGS / "2025 HanStone Pricing MW IL_WI (002).pdf", parse_hanstone),
        (
            "ugm_uq",
            CATALOGS / "2026 UGM price lists" / "Re_ UGM Current Price Lists 2026" / "UGM UQuartz Price List 2026.pdf",
            parse_ugm_uquartz,
        ),
        (
            "ugm_nat",
            CATALOGS / "2026 UGM price lists" / "Re_ UGM Current Price Lists 2026" / "Natural Stone Prices 2026.pdf",
            parse_ugm_natural,
        ),
        ("vadara", CATALOGS / "2026 UGM price lists" / "Re_ UGM Current Price Lists 2026" / "Vadara Price List 2026.pdf", "pdfplumber_vadara"),
        ("viatera", CATALOGS / "VIATERA 2025 Project Code 3016656.pdf", "pdfplumber_viatera"),
        ("corian", CATALOGS / "CorianQuartzPriceList Hallmark 4.3.26.pdf", "pdfplumber_corian"),
        ("trends", CATALOGS / "Trends in Quartz Jaeckle 4.3.26.pdf", parse_trends),
        ("cosentino", CATALOGS / "Cosentino 2026.pdf", "cosentino_pdf"),
    ]

    for key, path, parser in jobs:
        rel = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
        if not path.exists():
            import_warnings.append(
                {
                    "severity": "warning",
                    "message": f"File not found, skipped: {rel}",
                    "sourceFile": str(rel),
                }
            )
            continue
        try:
            items: list[dict[str, Any]] = []
            if parser == "pdfplumber_vadara":
                items = parse_vadara_pdfplumber(path)
            elif parser == "pdfplumber_viatera":
                items = parse_viatera_pdfplumber(path)
            elif parser == "pdfplumber_corian":
                items = parse_corian_pdfplumber(path)
            elif parser == "cosentino_pdf":
                items = parse_cosentino_pdf(path)
            else:
                text = read_pdf(path)
                if len(text.strip()) < 50:
                    import_warnings.append(
                        {
                            "severity": "warning",
                            "message": "Very little extractable text (may be image-only).",
                            "sourceFile": str(rel),
                        }
                    )
                    continue
                items = parser(text, path.name)
            all_items.extend(items)
            import_warnings.append(
                {
                    "severity": "info",
                    "message": f"Imported {len(items)} rows from {path.name}",
                    "sourceFile": path.name,
                }
            )
        except Exception as e:
            import_warnings.append(
                {
                    "severity": "error",
                    "message": f"{key}: {e}",
                    "sourceFile": str(rel),
                }
            )

    # Dedupe by id (keep first)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for it in all_items:
        iid = it.get("id", "")
        if iid in seen:
            continue
        seen.add(iid)
        unique.append(it)

    payload = {
        "importWarnings": import_warnings,
        "items": unique,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(unique)} items to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
