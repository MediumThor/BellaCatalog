#!/usr/bin/env python3
"""Emit JSON array of HanStone MW IL/WI price sheet rows (parse_hanstone)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_catalog import parse_hanstone, read_pdf  # noqa: E402


def main() -> None:
    pdf = ROOT / "Catalogs" / "2025 HanStone Pricing MW IL_WI (002).pdf"
    if len(sys.argv) > 1:
        pdf = Path(sys.argv[1])
    if not pdf.is_file():
        print(json.dumps({"error": f"file not found: {pdf}"}), file=sys.stderr)
        sys.exit(1)
    text = read_pdf(pdf)
    items = parse_hanstone(text, pdf.name)
    json.dump(items, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
