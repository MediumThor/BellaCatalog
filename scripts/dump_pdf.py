import sys, fitz
path = sys.argv[1]
out = sys.argv[2]
doc = fitz.open(path)
parts = []
for i in range(len(doc)):
    parts.append(f"\n--- PAGE {i+1} ---\n")
    parts.append(doc[i].get_text())
doc.close()
with open(out, "w", encoding="utf-8") as f:
    f.write("".join(parts))
print("wrote", out)
