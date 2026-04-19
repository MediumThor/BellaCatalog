import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import type { CatalogCollection, CatalogItem, NormalizedCatalog, UiPreferences } from "../types/catalog";
import { CatalogAddSlabsToCollectionModal } from "./CatalogAddSlabsToCollectionModal";
import { CatalogAddToCollectionModal } from "./CatalogAddToCollectionModal";
import { CatalogAddMaterialModal } from "./CatalogAddMaterialModal";
import { CatalogCollectionsBar } from "./CatalogCollectionsBar";
import { CatalogCreateManualCollectionModal } from "./CatalogCreateManualCollectionModal";
import { CatalogCollectionsManagerModal } from "./CatalogCollectionsManagerModal";
import { CatalogSaveSmartCollectionModal } from "./CatalogSaveSmartCollectionModal";
import { CatalogSelectionActionBar } from "./CatalogSelectionActionBar";
import { CompareCatalogOnboardingModal } from "./CompareCatalogOnboardingModal";
import { FloatingCompareButton } from "./FloatingCompareButton";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { CatalogToolbar } from "./CatalogToolbar";
import { CatalogToolsDrawer } from "./CatalogToolsDrawer";
import { CatalogColumnClearRow } from "./CatalogColumnClearRow";
import { CatalogDisplayToggles } from "./CatalogDisplayToggles";
import { CatalogViewToggle } from "./CatalogViewToggle";
import { FilterPanel } from "./FilterPanel";
import { SearchBar } from "./SearchBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { CatalogGridSkeleton } from "./CatalogGridSkeleton";
import { GridView } from "./GridView";
import { TableView } from "./TableView";
import { ThicknessQuickFilter } from "./ThicknessQuickFilter";
import { VendorTabs } from "./VendorTabs";
import { buildFilterOptions } from "../utils/catalogOptions";
import {
  COLLECTION_QUERY_PARAM,
  applyCollectionSnapshot,
  buildCollectionSnapshot,
  getCatalogCollectionItems,
  pruneCatalogCollections,
} from "../utils/catalogCollections";
import { downloadCsv, exportCsv } from "../utils/exportCsv";
import { downloadHorusSlabsExcel } from "../utils/exportHorusCsv";
import { filterCatalog } from "../utils/filterCatalog";
import { loadFavoriteIds, loadPreferences, mergePreferences, saveFavoriteIds, savePreferences } from "../utils/localStorageState";
import { searchCatalog } from "../utils/searchCatalog";
import { sortCatalog } from "../utils/sortCatalog";
import { markItemRemoved, saveOverlayState } from "../utils/import/importStorage";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import {
  canEditCollection,
  canShareCollection,
  createUnifiedCatalogCollection,
  deleteUnifiedCatalogCollection,
  subscribeUnifiedCatalogCollections,
  updateUnifiedCatalogCollection,
} from "../services/unifiedCatalogCollections";
import type { CatalogCollectionVisibility } from "../types/catalog";

export type CatalogBrowserProps = {
  catalog: NormalizedCatalog | null;
  loadError: string | null;
  bumpOverlay: () => void;
  horusCatalog: NormalizedCatalog | null;
  pickMode?: boolean;
  onPickItem?: (item: CatalogItem) => void;
  pickLabel?: string;
  allowDelete?: boolean;
  searchPlacement?: "header" | "inline";
  compareBagAction?: {
    label: string;
    srLabel: string;
    className?: string;
    disabled?: boolean;
    onClick: (items: CatalogItem[]) => void;
  };
};

export function CatalogBrowser({
  catalog,
  loadError,
  bumpOverlay,
  horusCatalog,
  pickMode,
  onPickItem,
  pickLabel,
  allowDelete,
  searchPlacement = "header",
  compareBagAction,
}: CatalogBrowserProps) {
  const { user, profileDisplayName } = useAuth();
  const { activeCompanyId, role } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefs, setPrefs] = useState<UiPreferences>(() => mergePreferences(loadPreferences()));
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => [...loadFavoriteIds()]);
  const [collections, setCollections] = useState<CatalogCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CatalogItem | null>(null);
  const [collectionDeleteConfirm, setCollectionDeleteConfirm] = useState<CatalogCollection | null>(null);
  const [catalogToolsOpen, setCatalogToolsOpen] = useState(false);
  const [headerSearchSlot, setHeaderSearchSlot] = useState<HTMLElement | null>(null);
  const [compareBagIds, setCompareBagIds] = useState<string[]>([]);
  const [compareOnboardOpen, setCompareOnboardOpen] = useState(false);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [editingMaterialItem, setEditingMaterialItem] = useState<CatalogItem | null>(null);
  const [createManualOpen, setCreateManualOpen] = useState(false);
  const [saveSmartOpen, setSaveSmartOpen] = useState(false);
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [addToCollectionOpen, setAddToCollectionOpen] = useState(false);
  const [collectionModalItems, setCollectionModalItems] = useState<CatalogItem[]>([]);
  const [loadedCollectionId, setLoadedCollectionId] = useState<string | null>(null);
  const [addSlabsToCollectionOpen, setAddSlabsToCollectionOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const compareBagEnabled = Boolean(compareBagAction) || !pickMode;
  const canDeleteCatalogRows = allowDelete ?? !pickMode;
  const activeCollectionId = searchParams.get(COLLECTION_QUERY_PARAM);

  useLayoutEffect(() => {
    if (searchPlacement !== "header") {
      setHeaderSearchSlot(null);
      return;
    }
    setHeaderSearchSlot(document.getElementById("catalog-header-search-root"));
  }, [searchPlacement]);

  useEffect(() => {
    savePreferences(prefs);
  }, [prefs]);

  useEffect(() => {
    saveFavoriteIds(new Set(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    if (!user?.uid) {
      setCollections([]);
      setCollectionsLoading(false);
      setCollectionsError(null);
      return;
    }
    setCollectionsLoading(true);
    setCollectionsError(null);
    setCollections([]);
    return subscribeUnifiedCatalogCollections({
      userId: user.uid,
      companyId: activeCompanyId,
      onData: (rows) => {
        setCollections(rows);
        setCollectionsLoading(false);
      },
      onError: (e) => {
        setCollections([]);
        setCollectionsLoading(false);
        setCollectionsError(e.message);
      },
    });
  }, [user?.uid, activeCompanyId]);

  const currentUserId = user?.uid ?? "";
  const ownerDisplayName = useMemo(() => {
    const name = profileDisplayName?.trim();
    if (name) return name;
    return user?.email ?? null;
  }, [profileDisplayName, user?.email]);
  const canShareWithCompanyNow = Boolean(activeCompanyId) && canShareCollection(role);
  const canEditCollectionCb = useCallback(
    (collection: import("../types/catalog").CatalogCollection) =>
      canEditCollection({ collection, currentUserId, role }),
    [currentUserId, role]
  );

  const deferredSearch = useDeferredValue(prefs.searchQuery);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId) ?? null,
    [collections, activeCollectionId]
  );
  const currentCollectionSnapshot = useMemo(() => buildCollectionSnapshot(prefs), [prefs]);

  useEffect(() => {
    if (!catalog || !user?.uid) return;
    const validIds = new Set(catalog.items.map((item) => item.id));
    const next = pruneCatalogCollections(collections, validIds);
    /**
     * Only auto-prune collections the current user can actually edit. Other
     * seats' private or shared-but-role-protected lists shouldn't get
     * invalidated by our local catalog view.
     */
    const changedCollections = next.filter(
      (collection, index) =>
        collection !== collections[index] && canEditCollectionCb(collections[index])
    );
    if (changedCollections.length === 0) return;
    void Promise.all(
      changedCollections.map((collection) =>
        updateUnifiedCatalogCollection(collection, {
          itemIds: collection.itemIds,
        })
      )
    );
  }, [catalog, collections, user?.uid, canEditCollectionCb]);

  useEffect(() => {
    if (!activeCollectionId) {
      if (loadedCollectionId !== null) setLoadedCollectionId(null);
      return;
    }
    if (collectionsLoading) return;
    if (activeCollection) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(COLLECTION_QUERY_PARAM);
        return next;
      },
      { replace: true }
    );
  }, [activeCollection, activeCollectionId, collectionsLoading, loadedCollectionId, setSearchParams]);

  useEffect(() => {
    if (!activeCollection) {
      if (loadedCollectionId !== null) setLoadedCollectionId(null);
      return;
    }
    if (loadedCollectionId === activeCollection.id) return;
    setLoadedCollectionId(activeCollection.id);
    if (activeCollection.type === "smart" && activeCollection.smartSnapshot) {
      const snapshot = activeCollection.smartSnapshot;
      setPrefs((prev) => applyCollectionSnapshot(prev, snapshot));
    }
  }, [activeCollection, loadedCollectionId]);

  const collectionBaseItems = useMemo(() => {
    if (!catalog) return [] as CatalogItem[];
    return activeCollection ? getCatalogCollectionItems(activeCollection, catalog.items) : catalog.items;
  }, [catalog, activeCollection]);

  const countsByCollectionId = useMemo(() => {
    if (!catalog) return {} as Record<string, number>;
    return Object.fromEntries(
      collections.map((collection) => [collection.id, getCatalogCollectionItems(collection, catalog.items).length])
    ) as Record<string, number>;
  }, [catalog, collections]);

  const collectionMembershipCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    collections
      .filter((collection) => collection.type === "manual")
      .forEach((collection) => {
        collection.itemIds.forEach((id) => {
          counts[id] = (counts[id] ?? 0) + 1;
        });
      });
    return counts;
  }, [collections]);

  const filterOptions = useMemo(() => {
    if (!collectionBaseItems.length) {
      return {
        vendors: [] as string[],
        manufacturers: [] as string[],
        materials: [] as string[],
        thicknesses: [] as string[],
        tierGroups: [] as string[],
        finishes: [] as string[],
        sizeClasses: [] as string[],
        priceTypes: [] as string[],
        colorFamilies: [] as string[],
        undertones: [] as string[],
        patternTags: [] as string[],
        movementLevels: [] as string[],
        styleTags: [] as string[],
      };
    }
    return buildFilterOptions(collectionBaseItems);
  }, [collectionBaseItems]);
  const preferredAddMaterialVendor = useMemo(() => {
    if (prefs.vendor && prefs.vendor !== "__all__") return prefs.vendor;
    if (filterOptions.vendors.length === 1) return filterOptions.vendors[0];
    return "";
  }, [filterOptions.vendors, prefs.vendor]);

  const displayedItems: CatalogItem[] = useMemo(() => {
    if (!catalog) return [];
    const searched = searchCatalog(collectionBaseItems, deferredSearch);
    const filtered = filterCatalog(searched, {
      vendor: prefs.vendor,
      manufacturers: prefs.manufacturers,
      materials: prefs.materials,
      thicknesses: prefs.thicknesses,
      tierGroups: prefs.tierGroups,
      finishes: prefs.finishes,
      sizeClasses: prefs.sizeClasses,
      priceTypes: prefs.priceTypes,
      colorFamilies: prefs.colorFamilies,
      undertones: prefs.undertones,
      patternTags: prefs.patternTags,
      movementLevels: prefs.movementLevels,
      styleTags: prefs.styleTags,
      favoritesOnly: prefs.favoritesOnly,
      favoriteIds: favoriteSet,
      hideWithoutPicture: prefs.hideWithoutPicture,
    });
    return sortCatalog(filtered, prefs.sortKey);
  }, [catalog, collectionBaseItems, deferredSearch, prefs, favoriteSet]);

  const updatePrefs = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs((p) => ({ ...p, ...patch, columns: { ...p.columns, ...patch.columns } }));
  }, []);

  const updateCollectionParam = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(COLLECTION_QUERY_PARAM, id);
          else next.delete(COLLECTION_QUERY_PARAM);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSelectCollection = useCallback(
    (id: string | null) => {
      if (id) {
        const selected = collections.find((collection) => collection.id === id) ?? null;
        if (selected?.type === "smart" && selected.smartSnapshot) {
          const snapshot = selected.smartSnapshot;
          setPrefs((prev) => applyCollectionSnapshot(prev, snapshot));
          setLoadedCollectionId(id);
        }
      } else {
        setLoadedCollectionId(null);
      }
      updateCollectionParam(id);
    },
    [collections, updateCollectionParam]
  );

  const createManualCollection = useCallback(
    async (
      name: string,
      description: string,
      visibility: CatalogCollectionVisibility,
      itemIds: string[] = [],
      activate = true
    ) => {
      if (!user?.uid) return;
      /**
       * Guard against a user without the right role sending "company". The
       * modal already greys it out, but the service call is the backstop.
       */
      const effectiveVisibility: CatalogCollectionVisibility =
        visibility === "company" && canShareWithCompanyNow ? "company" : "private";
      const id = await createUnifiedCatalogCollection({
        userId: user.uid,
        companyId: activeCompanyId,
        ownerDisplayName,
        data: {
          name,
          description,
          type: "manual",
          itemIds: [...new Set(itemIds)],
          smartSnapshot: null,
          visibility: effectiveVisibility,
        },
      });
      if (activate) handleSelectCollection(id);
    },
    [
      activeCompanyId,
      canShareWithCompanyNow,
      handleSelectCollection,
      ownerDisplayName,
      user?.uid,
    ]
  );

  const createSmartCollection = useCallback(
    async (
      name: string,
      description: string,
      visibility: CatalogCollectionVisibility,
      activate = true
    ) => {
      if (!user?.uid) return;
      const effectiveVisibility: CatalogCollectionVisibility =
        visibility === "company" && canShareWithCompanyNow ? "company" : "private";
      const id = await createUnifiedCatalogCollection({
        userId: user.uid,
        companyId: activeCompanyId,
        ownerDisplayName,
        data: {
          name,
          description,
          type: "smart",
          itemIds: [],
          smartSnapshot: currentCollectionSnapshot,
          visibility: effectiveVisibility,
        },
      });
      if (activate) handleSelectCollection(id);
    },
    [
      activeCompanyId,
      canShareWithCompanyNow,
      currentCollectionSnapshot,
      handleSelectCollection,
      ownerDisplayName,
      user?.uid,
    ]
  );

  const renameCollection = useCallback(
    async (
      collection: import("../types/catalog").CatalogCollection,
      name: string,
      description: string
    ) => {
      await updateUnifiedCatalogCollection(collection, { name, description });
    },
    []
  );

  const updateSmartCollection = useCallback(
    async (collection: import("../types/catalog").CatalogCollection) => {
      await updateUnifiedCatalogCollection(collection, {
        smartSnapshot: currentCollectionSnapshot,
      });
    },
    [currentCollectionSnapshot]
  );

  const setCollectionVisibility = useCallback(
    async (
      collection: import("../types/catalog").CatalogCollection,
      visibility: CatalogCollectionVisibility
    ) => {
      await updateUnifiedCatalogCollection(collection, { visibility });
    },
    []
  );

  const openCollectionPickerForItems = useCallback((items: CatalogItem[]) => {
    if (items.length === 0) return;
    setCollectionModalItems(items);
    setAddToCollectionOpen(true);
  }, []);

  const handleOpenCollectionsForItem = useCallback(
    (item: CatalogItem) => {
      openCollectionPickerForItems([item]);
    },
    [openCollectionPickerForItems]
  );

  const openCreateManualModal = useCallback(() => setCreateManualOpen(true), []);
  const openSaveSmartModal = useCallback(() => setSaveSmartOpen(true), []);
  const openManageCollectionsModal = useCallback(() => setCollectionManagerOpen(true), []);

  /** Add-to-job picker: never show list/cost prices; quoted column follows toolbar preference. */
  const hidePricesEffective = pickMode ? true : prefs.hidePrices;
  const showQuotedEffective = prefs.showQuotedPrice;

  const clearFilters = useCallback(() => {
    setPrefs((p) => ({
      ...p,
      searchQuery: "",
      vendor: "__all__",
      manufacturers: [],
      materials: [],
      thicknesses: [],
      tierGroups: [],
      finishes: [],
      sizeClasses: [],
      priceTypes: [],
      colorFamilies: [],
      undertones: [],
      patternTags: [],
      movementLevels: [],
      styleTags: [],
      favoritesOnly: false,
      hideWithoutPicture: false,
    }));
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavoriteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleCompareBag = useCallback((id: string) => {
    setCompareBagIds((prev) => {
      const i = prev.indexOf(id);
      if (i >= 0) return prev.filter((_, idx) => idx !== i);
      return [...prev, id];
    });
  }, []);

  const clearCompareBag = useCallback(() => setCompareBagIds([]), []);

  const compareBagIdSet = useMemo(() => new Set(compareBagIds), [compareBagIds]);

  const compareBagItems = useMemo((): CatalogItem[] => {
    if (!catalog) return [];
    const map = new Map(catalog.items.map((i) => [i.id, i]));
    return compareBagIds.map((id) => map.get(id)).filter((x): x is CatalogItem => x != null);
  }, [catalog, compareBagIds]);

  const handleSaveItemsToCollections = useCallback(
    async (
      selectedCollectionIds: string[],
      createNew: {
        name: string;
        description: string;
        visibility: CatalogCollectionVisibility;
      } | null
    ) => {
      if (!user?.uid) return;
      const selectedItemIds = [...new Set(collectionModalItems.map((item) => item.id))];
      if (selectedItemIds.length === 0) return;
      const selectedItemIdSet = new Set(selectedItemIds);
      const selectedCollectionIdSet = new Set(selectedCollectionIds);
      const updates = collections
        .filter((collection) => collection.type === "manual")
        .filter((collection) => canEditCollectionCb(collection))
        .map(async (collection) => {
          const hasOverlap = collection.itemIds.some((id) => selectedItemIdSet.has(id));
          const shouldInclude = selectedCollectionIdSet.has(collection.id);
          if (!hasOverlap && !shouldInclude) return;
          const withoutSelected = collection.itemIds.filter((id) => !selectedItemIdSet.has(id));
          const itemIds = shouldInclude ? [...withoutSelected, ...selectedItemIds] : withoutSelected;
          const changed =
            itemIds.length !== collection.itemIds.length ||
            itemIds.some((id, index) => id !== collection.itemIds[index]);
          if (!changed) return;
          await updateUnifiedCatalogCollection(collection, { itemIds });
        });
      await Promise.all(updates);
      if (createNew?.name.trim()) {
        await createManualCollection(
          createNew.name.trim(),
          createNew.description.trim(),
          createNew.visibility ?? "private",
          selectedItemIds,
          false
        );
      }
    },
    [canEditCollectionCb, collections, collectionModalItems, createManualCollection, user?.uid]
  );

  /** Drop bag ids that no longer exist in the loaded catalog (overlay delete), not when filtered out. */
  useEffect(() => {
    if (!catalog) return;
    const valid = new Set(catalog.items.map((i) => i.id));
    setCompareBagIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
    setSelectedItemIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [catalog]);

  const toggleSelectedItem = useCallback((id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItemIds(new Set());
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedItemIds(new Set());
  }, []);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) {
        setSelectedItemIds(new Set());
      }
      return !prev;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedItemIds((prev) => {
      const visibleIds = displayedItems.map((item) => item.id);
      const allAlreadySelected =
        visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allAlreadySelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }, [displayedItems]);

  const allVisibleSelected = useMemo(() => {
    if (displayedItems.length === 0) return false;
    return displayedItems.every((item) => selectedItemIds.has(item.id));
  }, [displayedItems, selectedItemIds]);

  const selectedItems = useMemo((): CatalogItem[] => {
    if (!catalog) return [];
    if (selectedItemIds.size === 0) return [];
    const map = new Map(catalog.items.map((i) => [i.id, i]));
    const out: CatalogItem[] = [];
    for (const id of selectedItemIds) {
      const item = map.get(id);
      if (item) out.push(item);
    }
    return out;
  }, [catalog, selectedItemIds]);

  const canEditActiveCollection = activeCollection
    ? canEditCollectionCb(activeCollection)
    : false;

  const openAddSlabsToActiveCollection = useCallback(() => {
    if (!activeCollection || activeCollection.type !== "manual") return;
    if (!canEditActiveCollection) return;
    setAddSlabsToCollectionOpen(true);
  }, [activeCollection, canEditActiveCollection]);

  const handleAddSlabsToActiveCollection = useCallback(
    async (newItemIds: string[]) => {
      if (!activeCollection || activeCollection.type !== "manual") return;
      if (newItemIds.length === 0) return;
      const existing = new Set(activeCollection.itemIds);
      const additions = newItemIds.filter((id) => !existing.has(id));
      if (additions.length === 0) return;
      await updateUnifiedCatalogCollection(activeCollection, {
        itemIds: [...activeCollection.itemIds, ...additions],
      });
    },
    [activeCollection]
  );

  const openCollectionPickerForSelection = useCallback(() => {
    if (selectedItems.length === 0) return;
    openCollectionPickerForItems(selectedItems);
  }, [openCollectionPickerForItems, selectedItems]);

  const removeSelectedFromActiveCollection = useCallback(async () => {
    if (!activeCollection || activeCollection.type !== "manual") return;
    if (!canEditActiveCollection) return;
    if (selectedItemIds.size === 0) return;
    const remaining = activeCollection.itemIds.filter((id) => !selectedItemIds.has(id));
    if (remaining.length === activeCollection.itemIds.length) return;
    await updateUnifiedCatalogCollection(activeCollection, { itemIds: remaining });
    clearSelection();
  }, [activeCollection, canEditActiveCollection, clearSelection, selectedItemIds]);

  const handleDeleteCollection = useCallback(async () => {
    if (!collectionDeleteConfirm) return;
    const deletingCollection = collectionDeleteConfirm;
    await deleteUnifiedCatalogCollection(deletingCollection);
    if (activeCollectionId === deletingCollection.id) {
      handleSelectCollection(null);
    }
    setCollectionDeleteConfirm(null);
  }, [activeCollectionId, collectionDeleteConfirm, handleSelectCollection]);

  const handleRequestDeleteEntry = useCallback((item: CatalogItem) => {
    if (!canDeleteCatalogRows) return;
    setDeleteConfirm(item);
  }, [canDeleteCatalogRows]);

  const handleRequestEditEntry = useCallback((item: CatalogItem) => {
    setEditingMaterialItem(item);
    setAddMaterialOpen(false);
  }, []);

  const confirmDeleteEntry = useCallback(() => {
    if (!deleteConfirm) return;
    const next = markItemRemoved(deleteConfirm.id);
    saveOverlayState(next);
    setDeleteConfirm(null);
    bumpOverlay();
  }, [deleteConfirm, bumpOverlay]);

  const onExportCsv = useCallback(() => {
    const csv = exportCsv(displayedItems, prefs.columns);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`bella-stone-catalog-${stamp}.csv`, csv);
  }, [displayedItems, prefs.columns]);

  const onExportHorus = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    const allItems = horusCatalog?.items ?? [];
    downloadHorusSlabsExcel(allItems, `Match-Inventory-${stamp}.xlsx`);
  }, [horusCatalog]);

  const onColumnToggle = useCallback((key: keyof UiPreferences["columns"], value: boolean) => {
    setPrefs((p) => ({
      ...p,
      columns: { ...p.columns, [key]: value },
    }));
  }, []);

  return (
    <>
      {loadError ? (
        <div className="import-warnings" role="alert">
          <strong>Could not load catalog.json.</strong> {loadError} — place a valid file at{" "}
          <code>public/catalog.json</code> and refresh.
        </div>
      ) : null}

      {!compareBagAction ? (
        <CompareCatalogOnboardingModal
          open={compareOnboardOpen}
          onClose={() => setCompareOnboardOpen(false)}
          selectedItems={compareBagItems}
          onClearSelection={clearCompareBag}
        />
      ) : null}

      <CatalogCreateManualCollectionModal
        open={createManualOpen}
        canShareWithCompany={canShareWithCompanyNow}
        defaultVisibility={canShareWithCompanyNow ? "company" : "private"}
        onClose={() => setCreateManualOpen(false)}
        onCreate={createManualCollection}
      />

      <CatalogAddMaterialModal
        open={addMaterialOpen || !!editingMaterialItem}
        onClose={() => {
          setAddMaterialOpen(false);
          setEditingMaterialItem(null);
        }}
        onCreated={bumpOverlay}
        preferredVendor={preferredAddMaterialVendor}
        vendorSuggestions={filterOptions.vendors}
        thicknessOptions={filterOptions.thicknesses}
        initialItem={editingMaterialItem}
      />

      <CatalogSaveSmartCollectionModal
        open={saveSmartOpen}
        currentSnapshot={currentCollectionSnapshot}
        canShareWithCompany={canShareWithCompanyNow}
        defaultVisibility={canShareWithCompanyNow ? "company" : "private"}
        onClose={() => setSaveSmartOpen(false)}
        onCreate={createSmartCollection}
      />

      <CatalogCollectionsManagerModal
        open={collectionManagerOpen}
        collections={collections}
        currentUserId={currentUserId}
        activeCollectionId={activeCollectionId}
        countsByCollectionId={countsByCollectionId}
        canShareWithCompany={canShareWithCompanyNow}
        canEdit={canEditCollectionCb}
        onClose={() => setCollectionManagerOpen(false)}
        onSelectCollection={handleSelectCollection}
        onRenameCollection={renameCollection}
        onDeleteCollection={(collection) => {
          setCollectionDeleteConfirm(collection);
        }}
        onUpdateSmartCollection={updateSmartCollection}
        onSetVisibility={setCollectionVisibility}
      />

      <CatalogAddToCollectionModal
        open={addToCollectionOpen}
        items={collectionModalItems}
        collections={collections}
        currentUserId={currentUserId}
        canShareWithCompany={canShareWithCompanyNow}
        canEdit={canEditCollectionCb}
        onClose={() => setAddToCollectionOpen(false)}
        onSave={handleSaveItemsToCollections}
      />

      <CatalogAddSlabsToCollectionModal
        open={addSlabsToCollectionOpen}
        collection={activeCollection}
        catalogItems={catalog?.items ?? []}
        onClose={() => setAddSlabsToCollectionOpen(false)}
        onAdd={handleAddSlabsToActiveCollection}
      />

      <FloatingCompareButton
        count={compareBagEnabled ? compareBagIds.length : 0}
        onClick={() => {
          if (compareBagAction) {
            compareBagAction.onClick(compareBagItems);
            return;
          }
          setCompareOnboardOpen(true);
        }}
        label={compareBagAction?.label}
        srLabel={compareBagAction?.srLabel}
        className={compareBagAction?.className}
        disabled={compareBagAction?.disabled}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Remove catalog entry?"
        danger
        message={
          deleteConfirm
            ? `This will hide “${deleteConfirm.displayName}” on this computer only (localStorage). You can restore it in Data manager.`
            : ""
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={confirmDeleteEntry}
      />

      <ConfirmDialog
        open={!!collectionDeleteConfirm}
        title="Delete collection?"
        message={
          collectionDeleteConfirm
            ? `Delete “${collectionDeleteConfirm.name}”? This only removes the saved collection. Catalog items stay untouched.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onCancel={() => setCollectionDeleteConfirm(null)}
        onConfirm={handleDeleteCollection}
      />

      {pickMode ? (
        <p className="compare-pick-banner">
          Same catalog as the main app — supplier list prices stay hidden. Use{" "}
          <strong>Show quoted price</strong> in <strong>Catalog tools</strong> when you want to see
          estimated quoted $/sq ft (install schedule). Pick a row, then confirm the quote line in the
          dialog.
        </p>
      ) : null}

      {searchPlacement === "header" && headerSearchSlot
        ? createPortal(
            <SearchBar
              variant="header"
              value={prefs.searchQuery}
              onChange={(searchQuery) => updatePrefs({ searchQuery })}
            />,
            headerSearchSlot
          )
        : null}

      {searchPlacement === "inline" ? (
        <SearchBar
          value={prefs.searchQuery}
          onChange={(searchQuery) => updatePrefs({ searchQuery })}
        />
      ) : null}

      {collectionsError ? (
        <div className="import-warnings" role="alert">
          Could not load your collections. {collectionsError}
        </div>
      ) : null}

      <CatalogCollectionsBar
        collections={collections}
        activeCollection={activeCollection}
        activeCollectionId={activeCollectionId}
        currentUserId={currentUserId}
        displayedCount={displayedItems.length}
        baseCount={collectionBaseItems.length}
        compareBagCount={compareBagItems.length}
        canEditActiveCollection={canEditActiveCollection}
        selectMode={selectMode}
        selectedCount={selectedItemIds.size}
        onSelectCollection={handleSelectCollection}
        onOpenNewManual={openCreateManualModal}
        onOpenSaveCurrentView={openSaveSmartModal}
        onOpenManage={openManageCollectionsModal}
        onOpenAddToCollection={() => openCollectionPickerForItems(compareBagItems)}
        onOpenAddSlabsToActiveCollection={openAddSlabsToActiveCollection}
        onUpdateActiveCollection={() => {
          if (activeCollection?.type !== "smart") return;
          if (!canEditCollectionCb(activeCollection)) return;
          void updateSmartCollection(activeCollection);
        }}
        onToggleSelectMode={toggleSelectMode}
      />

      <CatalogToolsDrawer open={catalogToolsOpen} onOpenChange={setCatalogToolsOpen}>
        <section className="catalog-tools-section" aria-labelledby="catalog-tools-layout-title">
          <h3 id="catalog-tools-layout-title" className="catalog-tools-section__title">
            Grid / list
          </h3>
          <CatalogViewToggle
            catalogView={prefs.catalogView}
            onCatalogViewChange={(catalogView) => updatePrefs({ catalogView })}
          />
          <ThicknessQuickFilter
            catalogThicknessOptions={filterOptions.thicknesses}
            selectedThicknesses={prefs.thicknesses}
            onChange={(thicknesses) => updatePrefs({ thicknesses })}
          />
          <div className="catalog-tools-layout-extras" role="group" aria-label="View options">
            <button
              type="button"
              className="btn catalog-tools-layout-extras__btn"
              data-active={prefs.hideWithoutPicture}
              aria-pressed={prefs.hideWithoutPicture}
              onClick={() => updatePrefs({ hideWithoutPicture: !prefs.hideWithoutPicture })}
              title="Hide rows that have no primary photo URL (same as grid cards with “No image”)"
            >
              Hide without picture
            </button>
          </div>
          <CatalogDisplayToggles
            pickMode={pickMode}
            favoritesOnly={prefs.favoritesOnly}
            hidePrices={hidePricesEffective}
            showQuotedPrice={showQuotedEffective}
            onFavoritesOnly={(favoritesOnly) => updatePrefs({ favoritesOnly })}
            onHidePricesChange={(hidePrices) => updatePrefs({ hidePrices })}
            onShowQuotedPriceChange={(showQuotedPrice) => updatePrefs({ showQuotedPrice })}
          />
        </section>

        <section className="catalog-tools-section" aria-labelledby="catalog-tools-vendors-title">
          <h3 id="catalog-tools-vendors-title" className="catalog-tools-section__title">
            Vendors
          </h3>
          <VendorTabs
            layout="sidebar"
            vendors={filterOptions.vendors}
            active={prefs.vendor}
            onSelect={(vendor) => updatePrefs({ vendor })}
          />
        </section>

        <CatalogColumnClearRow
          columns={prefs.columns}
          onColumnToggle={onColumnToggle}
          onClearFilters={clearFilters}
        />

        <section className="catalog-tools-section">
          <CatalogToolbar
            variant="drawer"
            hideViewToggle
            toolbarActionsPreset="tags-only"
            showColumnToggle={false}
            showExports={false}
            showClearFilters={false}
            catalogView={prefs.catalogView}
            sortKey={prefs.sortKey}
            favoritesOnly={prefs.favoritesOnly}
            hidePrices={hidePricesEffective}
            showQuotedPrice={showQuotedEffective}
            columns={prefs.columns}
            onCatalogViewChange={(catalogView) => updatePrefs({ catalogView })}
            onSortChange={(sortKey) => updatePrefs({ sortKey })}
            onFavoritesOnly={(favoritesOnly) => updatePrefs({ favoritesOnly })}
            onHidePricesChange={(hidePrices) => updatePrefs({ hidePrices })}
            onShowQuotedPriceChange={(showQuotedPrice) => updatePrefs({ showQuotedPrice })}
            onShowTagsChange={(showTags) => updatePrefs({ showTags })}
            showTags={prefs.showTags}
            onColumnToggle={onColumnToggle}
            onClearFilters={clearFilters}
            pickMode={pickMode}
          />
        </section>

        <FilterPanel
          variant="drawer"
          hideThickness
          options={{
            manufacturers: filterOptions.manufacturers,
            materials: filterOptions.materials,
            thicknesses: filterOptions.thicknesses,
            tierGroups: filterOptions.tierGroups,
            finishes: filterOptions.finishes,
            sizeClasses: filterOptions.sizeClasses,
            priceTypes: filterOptions.priceTypes,
          }}
          prefs={prefs}
          onChange={updatePrefs}
        />

        {pickMode ? null : (
          <>
            <section className="catalog-tools-section">
              <h3 className="catalog-tools-section__title">Catalog actions</h3>
              <button
                type="button"
                className="btn catalog-tools-layout-extras__btn catalog-tools-action-btn catalog-tools-action-btn--green"
                onClick={() => {
                  setEditingMaterialItem(null);
                  setAddMaterialOpen(true);
                }}
              >
                Add material
              </button>
            </section>

            <div className="catalog-tools-export-footer">
              <button
                type="button"
                className="btn catalog-tools-action-btn catalog-tools-action-btn--red"
                onClick={onExportCsv}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="btn catalog-tools-action-btn catalog-tools-action-btn--red"
                onClick={onExportHorus}
                title="Export full inventory to Horus Match Inventory (sheet 'Match Inventory'). Ignores UI filters, search, and Data Manager removed sources."
              >
                Export Horus
              </button>
            </div>
          </>
        )}
      </CatalogToolsDrawer>

      <div className="catalog-meta-offset">
        <p className="result-count" aria-live="polite">
          Showing <strong>{displayedItems.length}</strong>
          {catalog ? (
            <>
              {" "}
              of <strong>{collectionBaseItems.length}</strong>{" "}
              {activeCollection ? "items in this collection" : "items"}
            </>
          ) : null}
        </p>

        <ActiveFilterChips prefs={prefs} onClear={clearFilters} onRemoveChip={updatePrefs} />
      </div>

      {!loadError && !catalog ? <CatalogGridSkeleton /> : null}

      {!loadError && catalog && catalog.items.length === 0 ? (
        <div className="empty-state">
          No catalog items loaded. Add products to <code>public/catalog.json</code>.
        </div>
      ) : null}

      {!loadError && catalog && catalog.items.length > 0 && displayedItems.length === 0 ? (
        <div className="empty-state">
          No results match the current search and filters. Try clearing filters or widening search.
        </div>
      ) : null}

      {displayedItems.length > 0 ? (
        prefs.catalogView === "grid" ? (
          <GridView
            items={displayedItems}
            favoriteIds={favoriteSet}
            onToggleFavorite={toggleFavorite}
            onRequestDeleteEntry={canDeleteCatalogRows ? handleRequestDeleteEntry : undefined}
            onRequestEditEntry={handleRequestEditEntry}
            hidePrices={hidePricesEffective}
            showQuotedPrice={showQuotedEffective}
            showTags={prefs.showTags}
            pickMode={pickMode}
            onPickItem={onPickItem}
            pickLabel={pickLabel}
            compareBagEnabled={compareBagEnabled}
            compareBagIds={compareBagIdSet}
            onToggleCompareBag={toggleCompareBag}
            collectionMembershipCounts={collectionMembershipCounts}
            onOpenCollections={handleOpenCollectionsForItem}
            selectMode={selectMode}
            selectedIds={selectedItemIds}
            onToggleSelected={toggleSelectedItem}
          />
        ) : (
          <TableView
            items={displayedItems}
            columns={prefs.columns}
            favoriteIds={favoriteSet}
            onToggleFavorite={toggleFavorite}
            onRequestDeleteEntry={canDeleteCatalogRows ? handleRequestDeleteEntry : undefined}
            onRequestEditEntry={handleRequestEditEntry}
            hidePrices={hidePricesEffective}
            showQuotedPrice={showQuotedEffective}
            showTags={prefs.showTags}
            pickMode={pickMode}
            onPickItem={onPickItem}
            pickLabel={pickLabel}
            compareBagEnabled={compareBagEnabled}
            compareBagIds={compareBagIdSet}
            onToggleCompareBag={toggleCompareBag}
            collectionMembershipCounts={collectionMembershipCounts}
            onOpenCollections={handleOpenCollectionsForItem}
            selectMode={selectMode}
            selectedIds={selectedItemIds}
            onToggleSelected={toggleSelectedItem}
          />
        )
      ) : null}

      {selectMode ? (
        <CatalogSelectionActionBar
          selectedCount={selectedItemIds.size}
          visibleCount={displayedItems.length}
          allVisibleSelected={allVisibleSelected}
          activeManualCollectionName={
            activeCollection?.type === "manual" && canEditActiveCollection
              ? activeCollection.name
              : null
          }
          onSelectAllVisible={selectAllVisible}
          onClearSelection={clearSelection}
          onAddToCollection={openCollectionPickerForSelection}
          onRemoveFromActiveCollection={() => {
            void removeSelectedFromActiveCollection();
          }}
          onExit={exitSelectMode}
        />
      ) : null}
    </>
  );
}
