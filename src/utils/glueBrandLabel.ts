import type { CatalogItem } from "../types/catalog";

/**
 * **Integra** is the adhesive manufacturer; glue recommendations come from Integra
 * cross-reference PDFs. **StoneX** and **One Quartz** are stone suppliers (see
 * catalog vendor/manufacturer), not glue brands.
 */
export function glueBrandLabel(_item: CatalogItem): string {
  return "Integra";
}
