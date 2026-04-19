/**
 * Lightweight phone number formatting helpers. Designed for friendly display
 * of US-style and common international numbers without pulling in a full
 * libphonenumber dependency. Phone + WhatsApp fields are optional, so we
 * stay forgiving of anything the user types.
 */

/**
 * Strip all formatting to `+digits` form for storage. Returns `""` for empty
 * or junk input.
 */
export function sanitizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Format a phone number for friendly display:
 *   - `+1##########`           → `+1 (###) ###-####`
 *   - `##########`             → `(###) ###-####`
 *   - `1##########` (no plus)  → `1 (###) ###-####`
 *   - `+CC` followed by digits → `+CC ### ### ####` (3-3-4 grouping)
 *   - anything shorter         → best-effort partial formatting
 */
export function formatPhone(input: string): string {
  const cleaned = sanitizePhone(input);
  if (!cleaned) return "";

  // International (has +)
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.startsWith("1") && digits.length === 11) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    // Guess country-code length: 1 digit if starts with 1 or 7, else up to 3.
    const ccLen =
      digits.length <= 4 ? Math.min(digits.length, 3) : guessCountryCodeLen(digits);
    const cc = digits.slice(0, ccLen);
    const rest = digits.slice(ccLen);
    if (!rest) return `+${cc}`;
    return `+${cc} ${groupDigits(rest)}`;
  }

  // US / bare numbers
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 7) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  }

  // Partial / unknown: group in 3s for readability.
  return groupDigits(cleaned);
}

function groupDigits(digits: string): string {
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 10)
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)} ${digits.slice(10)}`;
}

function guessCountryCodeLen(digits: string): number {
  // Common 1-digit country codes.
  const oneDigit = new Set(["1", "7"]);
  // A short list of common 2-digit country codes (AU 61, DE 49, FR 33, GB 44,
  // IN 91, JP 81, MX 52, etc.). For anything else we default to 2, which is
  // close to correct for most of the world.
  if (oneDigit.has(digits[0])) return 1;
  // 3-digit country codes mostly start with 3xx or 9xx (e.g. 350 Gibraltar,
  // 972 Israel). Be permissive: default to 2, unless we have plenty of digits.
  if (digits.length >= 12) return 3;
  return 2;
}

/**
 * Convert any phone string into a `tel:` or `https://wa.me/` URL. Returns
 * `null` if the input is too short to dial.
 */
export function phoneToTelHref(input: string): string | null {
  const cleaned = sanitizePhone(input);
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `tel:${cleaned}`;
}

export function phoneToWhatsAppHref(input: string): string | null {
  const cleaned = sanitizePhone(input);
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `https://wa.me/${digits}`;
}

/** @deprecated kept for backward compatibility — prefer {@link formatPhone}. */
export const formatPhoneInput = formatPhone;
