export async function extractPdfText(file: File): Promise<string> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  const pdf = await task.promise;
  const parts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    parts.push(`\n--- PAGE ${pageNum} ---\n`);
    for (const it of content.items as Array<{ str?: string }>) {
      const s = (it.str ?? "").trimEnd();
      if (s) parts.push(s);
    }
    parts.push("\n");
  }

  try {
    await task.destroy();
  } catch {
    // ignore
  }

  // This is intentionally whitespace-heavy: downstream parsers normalize.
  return parts.join("\n");
}

