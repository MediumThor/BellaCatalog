import sys, fitz
path = sys.argv[1]
page_idx = int(sys.argv[2]) - 1
out = sys.argv[3] if len(sys.argv) > 3 else "dump.txt"
doc = fitz.open(path)
text = doc[page_idx].get_text()
doc.close()
with open(out, "w", encoding="utf-8") as f:
    f.write(text)
print("wrote", out, "chars", len(text))
