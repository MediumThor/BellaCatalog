import sys, fitz
path = sys.argv[1]
doc = fitz.open(path)
for i in range(len(doc)):
    t = doc[i].get_text()
    print(f"page {i+1}: {len(t)} chars")
print("total pages:", len(doc))
doc.close()
