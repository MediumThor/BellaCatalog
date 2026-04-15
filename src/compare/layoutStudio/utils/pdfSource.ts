import { getBytes, getDownloadURL, ref } from "firebase/storage";
import { firebaseStorage } from "../../../firebase";

type PdfModule = Awaited<typeof import("pdfjs-dist/build/pdf.mjs")>;
type RemotePdfOptions = { storagePath?: string | null };

const pdfUrlDocCache = new Map<string, Promise<any>>();
const pdfUrlDataCache = new Map<string, Promise<Uint8Array>>();

async function loadPdfModule(): Promise<PdfModule> {
  const mod = await import("pdfjs-dist/build/pdf.mjs");
  mod.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return mod;
}

async function getPdfFromFile(file: File): Promise<{ pdf: any; destroy: () => Promise<void> }> {
  const { getDocument } = await loadPdfModule();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({ data });
  const pdf = await task.promise;
  return {
    pdf,
    destroy: async () => {
      try {
        await task.destroy();
      } catch {
        // ignore
      }
    },
  };
}

async function fetchPdfData(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not download PDF (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function buildPdfCacheKey(url: string, storagePath?: string | null): string {
  return storagePath ? `${storagePath}::${url}` : url;
}

function looksLikeFirebaseStorageUrl(url: string): boolean {
  return /firebasestorage\.googleapis\.com|storage\.googleapis\.com|\.firebasestorage\.app/i.test(url);
}

function resolveStorageRef(url: string, storagePath?: string | null) {
  if (storagePath) {
    return ref(firebaseStorage, storagePath);
  }
  return ref(firebaseStorage, url);
}

async function fetchPdfDataFromStorageRef(url: string, storagePath?: string | null): Promise<Uint8Array> {
  const storageRef = resolveStorageRef(url, storagePath);
  let lastError: unknown = null;
  try {
    const bytes = await getBytes(storageRef);
    return new Uint8Array(bytes);
  } catch (error) {
    lastError = error;
  }
  try {
    const refreshedUrl = await getDownloadURL(storageRef);
    if (refreshedUrl) {
      return await fetchPdfData(refreshedUrl);
    }
  } catch (error) {
    lastError = error;
  }
  throw lastError instanceof Error ? lastError : new Error("Could not download PDF from storage.");
}

async function fetchPdfDataWithFallbacks(url: string, storagePath?: string | null): Promise<Uint8Array> {
  if (storagePath || looksLikeFirebaseStorageUrl(url)) {
    try {
      return await fetchPdfDataFromStorageRef(url, storagePath);
    } catch (storageError) {
      try {
        return await fetchPdfData(url);
      } catch {
        throw storageError;
      }
    }
  }
  try {
    return await fetchPdfData(url);
  } catch (initialError) {
    try {
      return await fetchPdfDataFromStorageRef(url, storagePath);
    } catch {
      throw initialError;
    }
  }
}

async function getPdfFromUrl(url: string, opts?: RemotePdfOptions): Promise<any> {
  const cacheKey = buildPdfCacheKey(url, opts?.storagePath);
  const cached = pdfUrlDocCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const { getDocument } = await loadPdfModule();
    const cachedData = pdfUrlDataCache.get(cacheKey);
    const dataPromise =
      cachedData ??
      fetchPdfDataWithFallbacks(url, opts?.storagePath);
    if (!cachedData) pdfUrlDataCache.set(cacheKey, dataPromise);
    try {
      const task = getDocument({ data: await dataPromise });
      return await task.promise;
    } catch (error) {
      pdfUrlDocCache.delete(cacheKey);
      pdfUrlDataCache.delete(cacheKey);
      throw error;
    }
  })().catch((error) => {
    pdfUrlDocCache.delete(cacheKey);
    pdfUrlDataCache.delete(cacheKey);
    throw error;
  });
  pdfUrlDocCache.set(cacheKey, promise);
  return promise;
}

async function renderPdfPageToCanvas(
  pdf: any,
  pageNumber: number,
  scale: number,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page
    .render({
      canvasContext: ctx,
      viewport: page.getViewport({ scale: canvas.width / Math.max(viewport.width, 1e-6) }),
    })
    .promise;
  return { canvas, width: canvas.width, height: canvas.height };
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not render PDF preview"));
    }, "image/png");
  });
}

export async function inspectPdfFilePages(
  file: File,
): Promise<Array<{ pageNumber: number; width: number; height: number }>> {
  const { pdf, destroy } = await getPdfFromFile(file);
  try {
    const pages: Array<{ pageNumber: number; width: number; height: number }> = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        pageNumber,
        width: Math.max(1, Math.round(viewport.width)),
        height: Math.max(1, Math.round(viewport.height)),
      });
    }
    return pages;
  } finally {
    await destroy();
  }
}

export async function inspectPdfUrlPages(
  url: string,
  opts?: RemotePdfOptions,
): Promise<Array<{ pageNumber: number; width: number; height: number }>> {
  const pdf = await getPdfFromUrl(url, opts);
  const pages: Array<{ pageNumber: number; width: number; height: number }> = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      pageNumber,
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
    });
  }
  return pages;
}

export async function renderPdfFilePageToDataUrl(
  file: File,
  pageNumber: number,
  scale = 2,
): Promise<{ dataUrl: string; pngBlob: Blob; width: number; height: number }> {
  const { pdf, destroy } = await getPdfFromFile(file);
  try {
    const { canvas, width, height } = await renderPdfPageToCanvas(pdf, pageNumber, scale);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      pngBlob: await canvasToBlob(canvas),
      width,
      height,
    };
  } finally {
    await destroy();
  }
}

export async function renderPdfFilePagesToDataUrls(
  file: File,
  pageNumbers: number[],
  scale = 2,
  onPageRendered?: (info: { pageNumber: number; renderedCount: number; totalCount: number }) => void,
): Promise<Array<{ pageNumber: number; dataUrl: string; pngBlob: Blob; width: number; height: number }>> {
  const { pdf, destroy } = await getPdfFromFile(file);
  try {
    const out: Array<{ pageNumber: number; dataUrl: string; pngBlob: Blob; width: number; height: number }> = [];
    for (let i = 0; i < pageNumbers.length; i += 1) {
      const pageNumber = pageNumbers[i]!;
      const { canvas, width, height } = await renderPdfPageToCanvas(pdf, pageNumber, scale);
      const pngBlob = await canvasToBlob(canvas);
      out.push({
        pageNumber,
        dataUrl: canvas.toDataURL("image/png"),
        pngBlob,
        width,
        height,
      });
      onPageRendered?.({ pageNumber, renderedCount: i + 1, totalCount: pageNumbers.length });
    }
    return out;
  } finally {
    await destroy();
  }
}

export async function renderPdfUrlPageToDataUrl(
  url: string,
  pageNumber: number,
  scale = 2,
  opts?: RemotePdfOptions,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const pdf = await getPdfFromUrl(url, opts);
  const { canvas, width, height } = await renderPdfPageToCanvas(pdf, pageNumber, scale);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
  };
}

/**
 * Render first PDF page to a PNG data URL for tracing (client-side).
 */
export async function renderPdfFileFirstPageToDataUrl(
  file: File,
  scale = 2,
): Promise<{ dataUrl: string; pngBlob: Blob; width: number; height: number }> {
  return renderPdfFilePageToDataUrl(file, 1, scale);
}

export async function renderPdfUrlFirstPageToDataUrl(
  url: string,
  scale = 2,
  opts?: RemotePdfOptions,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return renderPdfUrlPageToDataUrl(url, 1, scale, opts);
}
