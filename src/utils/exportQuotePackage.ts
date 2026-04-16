import JSZip from "jszip";
import {
  customerDisplayName,
  type CustomerRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
} from "../types/compareQuote";
import { computeCurrentLayoutQuoteForOption } from "../compare/layoutStudio/utils/currentQuote";
import { formatMoney } from "./priceHelpers";

type ExportMode = "directory" | "zip";

type ExportResult = {
  mode: ExportMode;
  summaryFilename: string;
  imageFilenames: string[];
  skippedImages: string[];
};

type ExportQuotePackageInput = {
  job: JobRecord;
  customer: CustomerRecord | null;
  options: JobComparisonOptionRecord[];
  repName: string;
  repEmail: string;
  generatedAt: string;
  areaId?: string | null;
  areaName?: string | null;
  areaSelectedOptionId?: string | null;
};

type FileWriterHandle = {
  createWritable(): Promise<{
    write(data: Blob | string): Promise<void>;
    close(): Promise<void>;
  }>;
};

type DirectoryHandle = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileWriterHandle>;
  getDirectoryHandle?(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
};

function sanitizeFilenamePart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
}

function formatTimestampForFilename(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}_${pad(value.getHours())}-${pad(value.getMinutes())}-${pad(value.getSeconds())}`;
}

function areaMetrics(option: JobComparisonOptionRecord, areaId?: string | null) {
  if (!areaId) return null;
  return option.layoutAreaStates?.[areaId] ?? null;
}

function quotedSummaryLines(
  job: JobRecord,
  option: JobComparisonOptionRecord,
  isFinal: boolean,
  areaId?: string | null
): string[] {
  const metrics = areaMetrics(option, areaId);
  const quoted = computeCurrentLayoutQuoteForOption({ job, option, areaId });

  const catalogLine = option.selectedPriceLabel
    ? `${option.selectedPriceLabel} (${option.priceUnit ?? "—"})${option.slabQuantity != null && option.priceUnit === "slab" ? ` · ${option.slabQuantity} slabs` : ""}`
    : "—";

  const lines = [
    `${isFinal ? "[FINAL] " : ""}${option.productName}`,
    `Vendor: ${option.vendor || "—"}`,
    `Manufacturer: ${option.manufacturer || "—"}`,
    `Material: ${option.material || "—"}`,
    `Thickness: ${option.thickness || "—"}`,
    `Size: ${option.size || "—"}`,
    `Catalog line: ${catalogLine}`,
    `Installed price: ${quoted.customerPerSqft != null ? `${formatMoney(quoted.customerPerSqft)} / sq ft` : "—"}`,
    `Installed estimate: ${quoted.customerTotal != null ? formatMoney(quoted.customerTotal) : "—"}`,
  ];

  if (option.notes.trim()) {
    lines.push(`Notes: ${option.notes.trim()}`);
  }

  if ((metrics?.layoutUpdatedAt ?? option.layoutUpdatedAt)) {
    lines.push(
      `Layout Studio: ${quoted.displayMetrics.areaSqFt || "—"} sq ft area · ${quoted.displayMetrics.finishedEdgeLf || "—"} ft edge · ${quoted.displayMetrics.sinkCount || "—"} sinks · ${quoted.displayMetrics.outletCount ?? 0} outlets · ${quoted.displayMetrics.estimatedSlabCount || "—"} slabs (est.) · ${quoted.displayMetrics.splashLinearFeet > 0 ? `${quoted.displayMetrics.splashLinearFeet.toFixed(1)} lf backsplash polish` : "no backsplash polish"}`
    );
  }

  return lines;
}

function buildSummaryText({
  job,
  customer,
  options,
  repName,
  repEmail,
  generatedAt,
  areaId,
  areaName,
  areaSelectedOptionId,
}: ExportQuotePackageInput): string {
  const finalOption =
    options.find((option) => option.id === (areaSelectedOptionId ?? job.finalOptionId)) ?? null;
  const finalQuote = finalOption ? computeCurrentLayoutQuoteForOption({ job, option: finalOption, areaId }) : null;
  const jobQuoteSqFt =
    finalQuote?.quoteAreaSqFt ??
    options
      .map((option) => computeCurrentLayoutQuoteForOption({ job, option, areaId }).quoteAreaSqFt)
      .find((areaSqFt) => areaSqFt > 0) ??
    0;
  const lines: string[] = [
    "Bella Stone Quote Summary",
    "=========================",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Rep",
    "---",
    repName || "—",
    repEmail || "—",
    "",
    "Customer",
    "--------",
    customer ? customerDisplayName(customer) : "—",
    customer?.phone || "—",
    customer?.email || "—",
    customer?.address || "—",
  ];

  if (customer?.notes.trim()) {
    lines.push("", "Customer notes", "--------------", customer.notes.trim());
  }

  lines.push(
    "",
    "Job",
    "---",
    `Name: ${job.name}`,
    `Area: ${areaName || job.areaType}`,
    `Quote area (sq ft): ${jobQuoteSqFt > 0 ? String(jobQuoteSqFt) : "— (from layout when saved)"}`,
    `Status: ${job.status}`,
    `Attachments: DXF: ${job.dxfAttachmentUrl ?? "—"} · Drawing: ${job.drawingAttachmentUrl ?? "—"}`
  );

  if (job.notes.trim()) {
    lines.push(`Job notes: ${job.notes.trim()}`);
  }

  lines.push(
    "",
    "Assumptions",
    "-----------",
    job.assumptions.trim() ||
      "Estimated installed material pricing per Bella Stone quote schedule (material markup + fabrication). Subject to final template verification."
  );

  lines.push(
    "",
    "Final Selection",
    "---------------",
    finalOption ? finalOption.productName : "No final selection recorded.",
    "",
    `Selected stones: ${options.length}`,
    ""
  );

  options.forEach((option, index) => {
    lines.push(
      `${index + 1}. ${quotedSummaryLines(
        job,
        option,
        option.id === (areaSelectedOptionId ?? job.finalOptionId),
        areaId
      ).join("\n   ")}`
    );
    lines.push("");
  });

  return lines.join("\r\n").trimEnd() + "\r\n";
}

async function writeFile(directory: DirectoryHandle, filename: string, contents: Blob | string): Promise<void> {
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Could not decode image"));
      nextImage.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function convertBlobToJpeg(blob: Blob): Promise<Blob> {
  if (blob.type === "image/jpeg") {
    return blob;
  }

  const image = await loadImageFromBlob(blob);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error("Image has no dimensions");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });

  if (!jpeg) {
    throw new Error("Could not create JPEG");
  }

  return jpeg;
}

function resolveImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("empty image URL");
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  try {
    return new URL(trimmed, window.location.href).href;
  } catch {
    return trimmed;
  }
}

function isSameOriginUrl(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Loads slab art as JPEG. `fetch()` often fails on cross-origin URLs without CORS while `<img>`
 * still paints; we fall back to drawing a loaded Image (same-origin, or with CORS headers).
 */
async function imageElementToJpeg(url: string, crossOrigin: "" | "anonymous"): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = url;
  });

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error("Image has no dimensions");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is not available");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });

  if (!jpeg) {
    throw new Error("Could not create JPEG");
  }

  return jpeg;
}

async function getImageAsJpeg(imageUrl: string): Promise<Blob> {
  const url = resolveImageUrl(imageUrl);

  if (url.startsWith("data:") || url.startsWith("blob:")) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Image request failed with ${response.status}`);
    }
    const blob = await response.blob();
    return convertBlobToJpeg(blob);
  }

  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (response.ok) {
      const blob = await response.blob();
      return convertBlobToJpeg(blob);
    }
  } catch {
    // Try <img> fallbacks below.
  }

  const sameOrigin = isSameOriginUrl(url);
  if (sameOrigin) {
    try {
      return await imageElementToJpeg(url, "");
    } catch {
      // Try CORS decode for same-origin CDN paths that need a credentialed image decode, etc.
    }
  }

  return imageElementToJpeg(url, "anonymous");
}

function buildImageFilenames(options: JobComparisonOptionRecord[]): Map<string, string> {
  const used = new Map<string, number>();
  const filenames = new Map<string, string>();

  for (const option of options) {
    const base = sanitizeFilenamePart(option.productName || "stone", "stone");
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    filenames.set(option.id, count === 1 ? `${base}.jpg` : `${base} ${count}.jpg`);
  }

  return filenames;
}

async function exportToDirectory(
  rootDirectory: DirectoryHandle,
  folderName: string,
  summaryFilename: string,
  summaryText: string,
  options: JobComparisonOptionRecord[],
  imageFilenames: Map<string, string>,
  areaId?: string | null
): Promise<ExportResult> {
  const targetDirectory =
    typeof rootDirectory.getDirectoryHandle === "function"
      ? await rootDirectory.getDirectoryHandle(folderName, { create: true })
      : rootDirectory;

  const skippedImages: string[] = [];
  const writtenImages: string[] = [];

  await writeFile(targetDirectory, summaryFilename, summaryText);

  for (const option of options) {
    if (!option.imageUrl) {
      skippedImages.push(option.productName);
    } else {
      try {
        const jpegBlob = await getImageAsJpeg(option.imageUrl);
        const filename = imageFilenames.get(option.id) ?? "stone.jpg";
        await writeFile(targetDirectory, filename, jpegBlob);
        writtenImages.push(filename);
      } catch {
        skippedImages.push(option.productName);
      }
    }

    const previewUrl = areaMetrics(option, areaId)?.layoutPreviewImageUrl ?? option.layoutPreviewImageUrl;
    if (previewUrl?.trim()) {
      try {
        const jpegBlob = await getImageAsJpeg(previewUrl);
        const layoutName = `Layout-${option.id.slice(0, 12)}.jpg`;
        await writeFile(targetDirectory, layoutName, jpegBlob);
        writtenImages.push(layoutName);
      } catch {
        skippedImages.push(`${option.productName} layout preview`);
      }
    }
  }

  return {
    mode: "directory",
    summaryFilename,
    imageFilenames: writtenImages,
    skippedImages,
  };
}

async function exportToZip(
  folderName: string,
  summaryFilename: string,
  summaryText: string,
  options: JobComparisonOptionRecord[],
  imageFilenames: Map<string, string>,
  areaId?: string | null
): Promise<ExportResult> {
  const zip = new JSZip();
  const packageFolder = zip.folder(folderName);
  if (!packageFolder) {
    throw new Error("Could not create export package.");
  }

  const skippedImages: string[] = [];
  const writtenImages: string[] = [];

  packageFolder.file(summaryFilename, summaryText);

  for (const option of options) {
    if (!option.imageUrl) {
      skippedImages.push(option.productName);
    } else {
      try {
        const jpegBlob = await getImageAsJpeg(option.imageUrl);
        const filename = imageFilenames.get(option.id) ?? "stone.jpg";
        packageFolder.file(filename, jpegBlob);
        writtenImages.push(filename);
      } catch {
        skippedImages.push(option.productName);
      }
    }

    const previewUrl = areaMetrics(option, areaId)?.layoutPreviewImageUrl ?? option.layoutPreviewImageUrl;
    if (previewUrl?.trim()) {
      try {
        const jpegBlob = await getImageAsJpeg(previewUrl);
        const layoutName = `Layout-${option.id.slice(0, 12)}.jpg`;
        packageFolder.file(layoutName, jpegBlob);
        writtenImages.push(layoutName);
      } catch {
        skippedImages.push(`${option.productName} layout preview`);
      }
    }
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(`${folderName}.zip`, zipBlob);

  return {
    mode: "zip",
    summaryFilename,
    imageFilenames: writtenImages,
    skippedImages,
  };
}

export async function exportQuotePackage(input: ExportQuotePackageInput): Promise<ExportResult | null> {
  const customerName = input.customer
    ? sanitizeFilenamePart(customerDisplayName(input.customer), "customer")
    : "customer";
  const jobName = sanitizeFilenamePart(input.job.name, "job");
  const timestamp = formatTimestampForFilename(new Date());
  const folderName = `${customerName} - ${jobName} Export ${timestamp}`;
  const summaryFilename = `${customerName}-${jobName}.txt`;
  const summaryText = buildSummaryText(input);
  const imageFilenames = buildImageFilenames(input.options);
  const windowWithPicker = window as Window & {
    showDirectoryPicker?: (options?: { mode?: "readwrite"; id?: string }) => Promise<DirectoryHandle>;
  };

  if (typeof windowWithPicker.showDirectoryPicker !== "function") {
    return exportToZip(folderName, summaryFilename, summaryText, input.options, imageFilenames, input.areaId);
  }

  try {
    const directory = await windowWithPicker.showDirectoryPicker({
      mode: "readwrite",
      id: "quote-export",
    });
    return await exportToDirectory(
      directory,
      folderName,
      summaryFilename,
      summaryText,
      input.options,
      imageFilenames,
      input.areaId
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}
