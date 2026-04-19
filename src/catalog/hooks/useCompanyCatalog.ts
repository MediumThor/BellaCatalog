import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { firebaseDb } from "../../firebase";
import { useStaticMergedCatalog } from "./useStaticMergedCatalog";
import type {
  CatalogItem,
  ImportWarning,
  NormalizedCatalog,
} from "../../types/catalog";

/**
 * Company-aware catalog loader. This hook wraps the legacy static merged
 * catalog (from `useMergedCatalog`) and, when a company context is available,
 * layers published company catalog items on top.
 *
 * Phase-1 behavior:
 *  - If no `companyId` is provided, we return exactly the legacy static
 *    catalog (no behavior change for existing internal users).
 *  - If `companyId` is provided but the company has zero published
 *    `catalogItems`, we still return the legacy static catalog so the UI
 *    never goes empty during onboarding.
 *  - If company catalog items exist, they are merged *on top of* the static
 *    catalog. Duplicate IDs prefer the company copy.
 *
 * See `docs/saas-refactor/50_company_catalog_loading.md` and
 * `docs/saas-refactor/05_ownership_clarification.md`.
 */
export function useCompanyCatalog(companyId: string | null) {
  const staticResult = useStaticMergedCatalog();

  const [companyItems, setCompanyItems] = useState<CatalogItem[] | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setCompanyItems(null);
      setCompanyError(null);
      return;
    }
    const q = query(
      collection(firebaseDb, "companies", companyId, "catalogItems"),
      where("active", "==", true)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: CatalogItem[] = [];
        snap.forEach((entry) => {
          const raw = entry.data() as Record<string, unknown>;
          const item = raw.item;
          if (item && typeof item === "object" && !Array.isArray(item)) {
            rows.push(item as CatalogItem);
          }
        });
        setCompanyItems(rows);
        setCompanyError(null);
      },
      (e) => {
        // If rules reject or the subcollection doesn't exist yet, fall back
        // silently to the static catalog.
        setCompanyItems([]);
        setCompanyError(e instanceof Error ? e.message : "Failed to load company catalog");
      }
    );
    return unsub;
  }, [companyId]);

  const mergedCatalog = useMemo<NormalizedCatalog | null>(() => {
    const base = staticResult.catalog;
    if (!companyId) return base;
    // If we don't yet know the company catalog contents (still subscribing),
    // return the static base so the UI keeps working.
    if (!companyItems || companyItems.length === 0) return base;
    if (!base) {
      return { items: [...companyItems], importWarnings: [] };
    }
    const byId = new Map<string, CatalogItem>();
    for (const it of base.items) byId.set(it.id, it);
    for (const it of companyItems) byId.set(it.id, it);
    const merged: NormalizedCatalog = {
      items: Array.from(byId.values()),
      importWarnings: base.importWarnings,
    };
    return merged;
  }, [staticResult.catalog, companyItems, companyId]);

  const mergedBase = useMemo<NormalizedCatalog | null>(() => {
    const base = staticResult.baseCatalog;
    if (!companyId) return base;
    if (!companyItems || companyItems.length === 0) return base;
    if (!base) return { items: [...companyItems], importWarnings: [] };
    const byId = new Map<string, CatalogItem>();
    for (const it of base.items) byId.set(it.id, it);
    for (const it of companyItems) byId.set(it.id, it);
    return { items: Array.from(byId.values()), importWarnings: base.importWarnings };
  }, [staticResult.baseCatalog, companyItems, companyId]);

  const combinedWarnings: ImportWarning[] = useMemo(() => {
    const base = mergedCatalog?.importWarnings ?? [];
    if (!companyError) return base;
    return [
      ...base,
      {
        severity: "warning",
        message: `Company catalog could not be loaded: ${companyError}`,
      } satisfies ImportWarning,
    ];
  }, [mergedCatalog?.importWarnings, companyError]);

  return {
    baseCatalog: mergedBase,
    catalog: mergedCatalog,
    loadError: staticResult.loadError ?? companyError,
    importWarnings: combinedWarnings,
    overlayVersion: staticResult.overlayVersion,
    bumpOverlay: staticResult.bumpOverlay,
    horusCatalog: staticResult.horusCatalog,
    /** Number of published company catalog items currently loaded. */
    companyItemCount: companyItems?.length ?? 0,
    /** True when the active company has no published catalog items yet. */
    isUsingStaticFallback:
      !companyId || !companyItems || companyItems.length === 0,
  };
}
