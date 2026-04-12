#!/usr/bin/env python3
"""Emit JSON array of Hallmark Corian Quartz slab prices (parse_corian_pdfplumber)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_catalog import parse_corian_pdfplumber  # noqa: E402


def main() -> None:
    pdf = ROOT / "Catalogs" / "CorianQuartzPriceList Hallmark 4.3.26.pdf"
    if len(sys.argv) > 1:
        pdf = Path(sys.argv[1])
    if not pdf.is_file():
        print(json.dumps({"error": f"file not found: {pdf}"}), file=sys.stderr)
        sys.exit(1)
    items = parse_corian_pdfplumber(pdf)
    json.dump(items, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
