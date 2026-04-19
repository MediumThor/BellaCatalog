import type { PriceImportStatus } from "../catalogImport/types";

export type PriceListStatusTone = "info" | "warn" | "good" | "bad";

export interface PriceListStatusView {
  label: string;
  tone: PriceListStatusTone;
  friendly: string;
}

export function describePriceListStatus(
  status: PriceImportStatus | string
): PriceListStatusView {
  switch (status) {
    case "uploaded":
      return {
        label: "Received",
        tone: "info",
        friendly:
          "We've got the file. It's queued for processing — you'll see the prices flow in once parsing finishes.",
      };
    case "queued":
      return {
        label: "Queued",
        tone: "info",
        friendly:
          "Waiting in line. BellaCatalog will start reading this file shortly.",
      };
    case "parsing":
      return {
        label: "Parsing",
        tone: "info",
        friendly:
          "Reading rows, matching materials, and checking prices. This usually takes under a minute.",
      };
    case "needs_review":
      return {
        label: "Needs review",
        tone: "warn",
        friendly:
          "Parsed — but a few rows need your eyes. Open the review screen to confirm the matches.",
      };
    case "ready_to_publish":
      return {
        label: "Ready to publish",
        tone: "good",
        friendly:
          "Rows look clean. Publish to make the new prices live for everyone on your team.",
      };
    case "published":
      return {
        label: "Published",
        tone: "good",
        friendly: "Live. Every quote your team builds now uses these prices.",
      };
    case "failed":
      return {
        label: "Failed",
        tone: "bad",
        friendly:
          "Something went wrong while reading the file. Try uploading again or contact support.",
      };
    case "canceled":
      return {
        label: "Canceled",
        tone: "bad",
        friendly: "This import was canceled and nothing was published.",
      };
    default:
      return {
        label: String(status || "Unknown"),
        tone: "info",
        friendly: "Status unknown.",
      };
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return "—";
  if (
    typeof ts === "object" &&
    ts !== null &&
    "toDate" in ts &&
    typeof (ts as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (ts as { toDate: () => Date })
        .toDate()
        .toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
    } catch {
      return "—";
    }
  }
  return "—";
}
