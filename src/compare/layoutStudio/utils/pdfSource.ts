/**
 * Render first PDF page to a PNG data URL for tracing (client-side).
 */
export async function renderPdfFileFirstPageToDataUrl(
  file: File,
  scale = 2
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  try {
    await task.destroy();
  } catch {
    // ignore
  }
  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, width: canvas.width, height: canvas.height };
}

export async function renderPdfUrlFirstPageToDataUrl(
  url: string,
  scale = 2
): Promise<{ dataUrl: string; width: number; height: number }> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const task = getDocument({ url });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  try {
    await task.destroy();
  } catch {
    // ignore
  }
  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, width: canvas.width, height: canvas.height };
}
