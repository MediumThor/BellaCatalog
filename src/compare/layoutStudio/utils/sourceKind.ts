import type { LayoutSourceKind } from "../types";

export function layoutSourceKindFromFile(file: File): LayoutSourceKind {
  const t = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (t.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (t.includes("png") || name.endsWith(".png")) return "image";
  if (t.includes("jpeg") || t.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image";
  }
  if (t.includes("webp") || name.endsWith(".webp")) return "image";
  if (name.endsWith(".dxf")) return "dxf";
  return "unknown";
}

export function isAcceptedLayoutSourceFile(file: File): boolean {
  const k = layoutSourceKindFromFile(file);
  return k === "pdf" || k === "image";
}
