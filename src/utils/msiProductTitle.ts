/** Strip PDF marketing tokens from MSI Q Quartz product names (shown as titles in the catalog). */
export function sanitizeMsiProductTitle(name: string): string {
  let s = name.replace(/\(\s*jumbo\s*\)/gi, "");
  s = s.replace(/\bnew\b/gi, "");
  return s.replace(/\s+/g, " ").trim();
}
