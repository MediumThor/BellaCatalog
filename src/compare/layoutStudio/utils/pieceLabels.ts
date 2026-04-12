import type { LayoutPiece } from "../types";
import { isPlanStripPiece } from "./pieceRoles";

/** 0 → A, 25 → Z, 26 → AA (Excel-style column letters). */
export function indexToLetters(index: number): string {
  let n = index;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * Default stored name for the next countertop piece: first → "Piece A", second → "Piece B", …
 * Matches {@link pieceLetterLabelByPieceId} when names stay in default alphabetical order.
 */
export function defaultNonSplashPieceName(nonSplashPieceCountBeforeAdd: number): string {
  return `Piece ${indexToLetters(nonSplashPieceCountBeforeAdd)}`;
}

/**
 * Countertop pieces only (excludes backsplash and miter strips), ordered by name — maps id → "Piece A", "Piece B", …
 */
export function pieceLetterLabelByPieceId(pieces: readonly LayoutPiece[]): Map<string, string> {
  const nonSplash = pieces
    .filter((p) => !isPlanStripPiece(p))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const m = new Map<string, string>();
  for (let i = 0; i < nonSplash.length; i++) {
    m.set(nonSplash[i].id, `Piece ${indexToLetters(i)}`);
  }
  return m;
}

/**
 * Backsplash strips in array order — maps id → "Splash A", "Splash B", …
 */
export function splashLetterLabelByPieceId(pieces: readonly LayoutPiece[]): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  for (const p of pieces) {
    if (p.pieceRole === "splash") {
      m.set(p.id, `Splash ${indexToLetters(i)}`);
      i += 1;
    }
  }
  return m;
}

/**
 * Miter strips in array order — maps id → "Miter A", "Miter B", …
 */
export function miterLetterLabelByPieceId(pieces: readonly LayoutPiece[]): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  for (const p of pieces) {
    if (p.pieceRole === "miter") {
      m.set(p.id, `Miter ${indexToLetters(i)}`);
      i += 1;
    }
  }
  return m;
}

/**
 * Backsplash + miter strips — maps id → "Splash A" / "Miter A" etc. (for plan/place labels).
 */
export function edgeStripLetterLabelByPieceId(pieces: readonly LayoutPiece[]): Map<string, string> {
  const m = new Map<string, string>();
  let si = 0;
  let mi = 0;
  for (const p of pieces) {
    if (p.pieceRole === "splash") {
      m.set(p.id, `Splash ${indexToLetters(si++)}`);
    } else if (p.pieceRole === "miter") {
      m.set(p.id, `Miter ${indexToLetters(mi++)}`);
    }
  }
  return m;
}
