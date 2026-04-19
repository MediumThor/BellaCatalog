import type { CompanyAddress } from "./types";

export type QuoteBrandingHeaderProps = {
  companyName: string;
  logoUrl?: string | null;
  address?: CompanyAddress | null;
  headerMessage?: string | null;
};

/**
 * Shared branding header used at the top of printed/shared quote documents.
 * Renders the company logo (when present), name, optional address block and
 * an optional header message that admins set on the Branding page.
 */
export function QuoteBrandingHeader({
  companyName,
  logoUrl,
  address,
  headerMessage,
}: QuoteBrandingHeaderProps) {
  const addressText = formatAddress(address);
  if (!logoUrl && !headerMessage && !addressText) {
    return (
      <div className="quote-branding-header quote-branding-header--text-only">
        <div className="quote-branding-header__text">
          <span className="quote-branding-header__name">{companyName}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="quote-branding-header">
      {logoUrl ? (
        <img
          className="quote-branding-header__logo"
          src={logoUrl}
          alt={`${companyName} logo`}
        />
      ) : null}
      <div className="quote-branding-header__text">
        <span className="quote-branding-header__name">{companyName}</span>
        {addressText ? (
          <span className="quote-branding-header__meta">{addressText}</span>
        ) : null}
        {headerMessage ? (
          <span className="quote-branding-header__message">{headerMessage}</span>
        ) : null}
      </div>
    </div>
  );
}

export function QuoteBrandingFooter({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return <footer className="quote-branding-footer">{text}</footer>;
}

function formatAddress(address?: CompanyAddress | null): string {
  if (!address) return "";
  const line1 = address.line1?.trim();
  const line2 = address.line2?.trim();
  const city = address.city?.trim();
  const state = address.state?.trim();
  const postal = address.postalCode?.trim();
  const country = address.country?.trim();

  const lines: string[] = [];
  if (line1) lines.push(line1);
  if (line2) lines.push(line2);
  const cityLine = [city, [state, postal].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  if (cityLine) lines.push(cityLine);
  if (country && country.toUpperCase() !== "US") lines.push(country);
  return lines.join("\n");
}
