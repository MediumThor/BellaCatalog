"""Probe: print page range text sample."""
import sys
import fitz

path = sys.argv[1]
start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
end = int(sys.argv[3]) if len(sys.argv) > 3 else 5
doc = fitz.open(path)
for i in range(start, min(end, len(doc))):
    print(f"\n--- PAGE {i+1} ---\n")
    print(doc[i].get_text()[:4000])
doc.close()
