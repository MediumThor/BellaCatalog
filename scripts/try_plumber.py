import pdfplumber, sys
path = sys.argv[1]
page_n = int(sys.argv[2]) - 1
with pdfplumber.open(path) as pdf:
    p = pdf.pages[page_n]
    print("--- tables", len(p.extract_tables() or []))
    for i, t in enumerate(p.extract_tables() or []):
        print("TABLE", i)
        for row in t[:25]:
            print(row)
    print("--- text sample")
    print((p.extract_text() or "")[:2000])
