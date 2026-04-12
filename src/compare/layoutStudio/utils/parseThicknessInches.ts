/**
 * Best-effort parse of catalog / option thickness strings to decimal inches.
 * Examples: `3/4"`, `1.25 cm`, `2cm`, `1-1/4"`, `3 cm`.
 */
export function parseThicknessToInches(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const cmMatch = s.match(/([\d.]+)\s*cm\b/);
  if (cmMatch) {
    const cm = parseFloat(cmMatch[1]!);
    if (Number.isFinite(cm) && cm > 0) return (cm / 2.54) as number;
  }

  const mmMatch = s.match(/([\d.]+)\s*mm\b/);
  if (mmMatch) {
    const mm = parseFloat(mmMatch[1]!);
    if (Number.isFinite(mm) && mm > 0) return (mm / 25.4) as number;
  }

  let inchStr = s.replace(/"/g, "").replace(/inches?/g, "").replace(/in\b/g, "").trim();

  const mixed = inchStr.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (mixed) {
    const whole = parseInt(mixed[1]!, 10);
    const num = parseInt(mixed[2]!, 10);
    const den = parseInt(mixed[3]!, 10);
    if (den > 0) return whole + num / den;
  }

  const frac = inchStr.match(/^(\d+)\s*\/\s*(\d+)\s*$/);
  if (frac) {
    const num = parseInt(frac[1]!, 10);
    const den = parseInt(frac[2]!, 10);
    if (den > 0) return num / den;
  }

  const dec = parseFloat(inchStr.replace(/[^\d.+-]/g, ""));
  if (Number.isFinite(dec) && dec > 0) return dec;

  return null;
}

/** Fallback when thickness is unknown (typical 3cm quartz). */
export const DEFAULT_SLAB_THICKNESS_IN = 1.25;
