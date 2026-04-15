import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import type { CatalogCollection, CatalogItem, NormalizedCatalog, UiPreferences } from "../types/catalog";
import { CatalogAddToCollectionModal } from "./CatalogAddToCollectionModal";
import { CatalogAddMaterialModal } from "./CatalogAddMaterialModal";
import { CatalogCollectionsBar } from "./CatalogCollectionsBar";
import { CatalogCreateManualCollectionModal } from "./CatalogCreateManualCollectionModal";
import { CatalogCollectionsManagerModal } from "./CatalogCollectionsManagerModal";
import { CatalogSaveSmartCollectionModal } from "./CatalogSaveSmartCollectionModal";
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
import { GridView } from "./GridView";
import { TableView } from "./TableView";
import { ThicknessQuickFilter } from "./ThicknessQuickFilter";
import { VendorTabs } from "./VendorTabs";
import {
  geminiCatalogSearchConfigured,
  runGeminiCatalogSearch,
  runGeminiCatalogVisualMatch,
} from "../services/geminiCatalogSearch";
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
import {
  createCatalogCollection,
  deleteCatalogCollection,
  subscribeCatalogCollections,
  updateCatalogCollection,
} from "../services/catalogCollectionsFirestore";

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
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefs, setPrefs] = useState<UiPreferences>(() => mergePreferences(loadPreferences()));
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => [...loadFavoriteIds()]);
  const [collections, setCollections] = useState<CatalogCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CatalogItem | null>(null);
  const [collectionDeleteConfirm, setCollectionDeleteConfirm] = useState<CatalogCollection | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRankedIds, setAiRankedIds] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<{
    kind: "idle" | "success" | "error";
    message: string;
  }>({ kind: "idle", message: "" });
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
  const aiConfigured = geminiCatalogSearchConfigured();
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
    return subscribeCatalogCollections(
      user.uid,
      (rows) => {
        setCollections(rows);
        setCollectionsLoading(false);
      },
      (e) => {
        setCollections([]);
        setCollectionsLoading(false);
        setCollectionsError(e.message);
      }
    );
  }, [user?.uid]);

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
    const changedCollections = next.filter((collection, index) => collection !== collections[index]);
    if (changedCollections.length === 0) return;
    void Promise.all(
      changedCollections.map((collection) =>
        updateCatalogCollection(collection.id, {
          itemIds: collection.itemIds,
        })
      )
    );
  }, [catalog, collections, user?.uid]);

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
      setAiRankedIds([]);
      setAiStatus({ kind: "idle", message: "" });
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
    const sorted = sortCatalog(filtered, prefs.sortKey);
    if (!aiRankedIds.length) {
      return sorted;
    }

    const rankedIndex = new Map(aiRankedIds.map((id, index) => [id, index]));
    return [...sorted].sort((a, b) => {
      const aRank = rankedIndex.get(a.id);
      const bRank = rankedIndex.get(b.id);
      if (aRank != null && bRank != null) return aRank - bRank;
      if (aRank != null) return -1;
      if (bRank != null) return 1;
      return 0;
    });
  }, [catalog, collectionBaseItems, deferredSearch, prefs, favoriteSet, aiRankedIds]);

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
      setAiRankedIds([]);
      setAiStatus({ kind: "idle", message: "" });
      updateCollectionParam(id);
    },
    [collections, updateCollectionParam]
  );

  const createManualCollection = useCallback(
    async (name: string, description: string, itemIds: string[] = [], activate = true) => {
      if (!user?.uid) return;
      const id = await createCatalogCollection(user.uid, {
        name,
        description,
        type: "manual",
        itemIds: [...new Set(itemIds)],
        smartSnapshot: null,
      });
      if (activate) handleSelectCollection(id);
    },
    [handleSelectCollection, user?.uid]
  );

  const createSmartCollection = useCallback(
    async (name: string, description: string, activate = true) => {
      if (!user?.uid) return;
      const id = await createCatalogCollection(user.uid, {
        name,
        description,
        type: "smart",
        itemIds: [],
        smartSnapshot: currentCollectionSnapshot,
      });
      if (activate) handleSelectCollection(id);
    },
    [currentCollectionSnapshot, handleSelectCollection, user?.uid]
  );

  const renameCollection = useCallback(async (id: string, name: string, description: string) => {
    await updateCatalogCollection(id, {
      name,
      description,
    });
  }, []);

  const updateSmartCollection = useCallback(
    async (id: string) => {
      await updateCatalogCollection(id, {
        smartSnapshot: currentCollectionSnapshot,
      });
    },
    [currentCollectionSnapshot]
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
    setAiRankedIds([]);
    setAiStatus({ kind: "idle", message: "" });
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
      createNew: { name: string; description: string } | null
    ) => {
      if (!user?.uid) return;
      const selectedItemIds = [...new Set(collectionModalItems.map((item) => item.id))];
      if (selectedItemIds.length === 0) return;
      const selectedItemIdSet = new Set(selectedItemIds);
      const selectedCollectionIdSet = new Set(selectedCollectionIds);
      const updates = collections
        .filter((collection) => collection.type === "manual")
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
          await updateCatalogCollection(collection.id, { itemIds });
        });
      await Promise.all(updates);
      if (createNew?.name.trim()) {
        await createManualCollection(createNew.name.trim(), createNew.description.trim(), selectedItemIds, false);
      }
    },
    [collections, collectionModalItems, createManualCollection, user?.uid]
  );

  /** Drop bag ids that no longer exist in the loaded catalog (overlay delete), not when filtered out. */
  useEffect(() => {
    if (!catalog) return;
    const valid = new Set(catalog.items.map((i) => i.id));
    setCompareBagIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [catalog]);

  const handleDeleteCollection = useCallback(async () => {
    if (!collectionDeleteConfirm) return;
    const deletingId = collectionDeleteConfirm.id;
    await deleteCatalogCollection(deletingId);
    if (activeCollectionId === deletingId) {
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

  const runAiSearch = useCallback(async () => {
    if (!catalog || collectionBaseItems.length === 0) return;
    const query = prefs.searchQuery.trim();
    if (!query) return;
    setAiBusy(true);
    setAiRankedIds([]);
    setAiStatus({ kind: "idle", message: "" });
    try {
      const plan = await runGeminiCatalogSearch(query, filterOptions);
      const nextPrefs = {
        ...prefs,
        searchQuery: plan.searchText,
        vendor: plan.vendor || "__all__",
        manufacturers: plan.manufacturers,
        materials: plan.materials,
        thicknesses: plan.thicknesses,
        tierGroups: plan.tierGroups,
        finishes: plan.finishes,
        sizeClasses: plan.sizeClasses,
        priceTypes: plan.priceTypes,
        colorFamilies: plan.colorFamilies,
        undertones: plan.undertones,
        patternTags: plan.patternTags,
        movementLevels: plan.movementLevels,
        styleTags: plan.styleTags,
      };
      setPrefs((p) => ({
        ...p,
        searchQuery: plan.searchText,
        vendor: plan.vendor || "__all__",
        manufacturers: plan.manufacturers,
        materials: plan.materials,
        thicknesses: plan.thicknesses,
        tierGroups: plan.tierGroups,
        finishes: plan.finishes,
        sizeClasses: plan.sizeClasses,
        priceTypes: plan.priceTypes,
        colorFamilies: plan.colorFamilies,
        undertones: plan.undertones,
        patternTags: plan.patternTags,
        movementLevels: plan.movementLevels,
        styleTags: plan.styleTags,
      }));

      const searched = searchCatalog(collectionBaseItems, plan.searchText);
      const filtered = filterCatalog(searched, {
        vendor: nextPrefs.vendor,
        manufacturers: nextPrefs.manufacturers,
        materials: nextPrefs.materials,
        thicknesses: nextPrefs.thicknesses,
        tierGroups: nextPrefs.tierGroups,
        finishes: nextPrefs.finishes,
        sizeClasses: nextPrefs.sizeClasses,
        priceTypes: nextPrefs.priceTypes,
        colorFamilies: nextPrefs.colorFamilies,
        undertones: nextPrefs.undertones,
        patternTags: nextPrefs.patternTags,
        movementLevels: nextPrefs.movementLevels,
        styleTags: nextPrefs.styleTags,
        favoritesOnly: nextPrefs.favoritesOnly,
        favoriteIds: favoriteSet,
        hideWithoutPicture: nextPrefs.hideWithoutPicture,
      });
      const visualCandidates = sortCatalog(
        filtered.filter((item) => Boolean(item.imageUrl?.trim())),
        prefs.sortKey
      );
      const visualMatch = await runGeminiCatalogVisualMatch(query, visualCandidates);
      if (visualMatch?.orderedIds.length) {
        setAiRankedIds(visualMatch.orderedIds);
      }

      const visualSuffix = visualMatch?.orderedIds.length
        ? ` Visually ranked ${visualMatch.orderedIds.length} photo match${visualMatch.orderedIds.length === 1 ? "" : "es"} first.`
        : "";
      setAiStatus({
        kind: "success",
        message:
          (plan.explanation || "AI search applied the closest matching catalog filters.") +
          visualSuffix +
          (visualMatch?.explanation ? ` ${visualMatch.explanation}` : ""),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI search failed.";
      setAiStatus({ kind: "error", message: msg });
    } finally {
      setAiBusy(false);
    }
  }, [catalog, collectionBaseItems, favoriteSet, filterOptions, prefs]);

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
        onClose={() => setSaveSmartOpen(false)}
        onCreate={createSmartCollection}
      />

      <CatalogCollectionsManagerModal
        open={collectionManagerOpen}
        collections={collections}
        activeCollectionId={activeCollectionId}
        countsByCollectionId={countsByCollectionId}
        onClose={() => setCollectionManagerOpen(false)}
        onSelectCollection={handleSelectCollection}
        onRenameCollection={renameCollection}
        onDeleteCollection={(id) => {
          const next = collections.find((collection) => collection.id === id) ?? null;
          setCollectionDeleteConfirm(next);
        }}
        onUpdateSmartCollection={updateSmartCollection}
      />

      <CatalogAddToCollectionModal
        open={addToCollectionOpen}
        items={collectionModalItems}
        collections={collections}
        onClose={() => setAddToCollectionOpen(false)}
        onSave={handleSaveItemsToCollections}
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
              onChange={(searchQuery) => {
                setAiRankedIds([]);
                setAiStatus({ kind: "idle", message: "" });
                updatePrefs({ searchQuery });
              }}
              onAiSearch={runAiSearch}
              aiBusy={aiBusy}
              aiDisabledReason={aiConfigured ? undefined : "Set VITE_GEMINI_API_KEY to enable AI search"}
            />,
            headerSearchSlot
          )
        : null}

      {searchPlacement === "inline" ? (
        <SearchBar
          value={prefs.searchQuery}
          onChange={(searchQuery) => {
            setAiRankedIds([]);
            setAiStatus({ kind: "idle", message: "" });
            updatePrefs({ searchQuery });
          }}
          onAiSearch={runAiSearch}
          aiBusy={aiBusy}
          aiDisabledReason={aiConfigured ? undefined : "Set VITE_GEMINI_API_KEY to enable AI search"}
        />
      ) : null}

      {aiStatus.kind !== "idle" ? (
        <div className="ai-search-status" data-kind={aiStatus.kind} role="status">
          {aiStatus.message}
        </div>
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
        displayedCount={displayedItems.length}
        baseCount={collectionBaseItems.length}
        compareBagCount={compareBagItems.length}
        onSelectCollection={handleSelectCollection}
        onOpenNewManual={openCreateManualModal}
        onOpenSaveCurrentView={openSaveSmartModal}
        onOpenManage={openManageCollectionsModal}
        onOpenAddToCollection={() => openCollectionPickerForItems(compareBagItems)}
        onUpdateActiveCollection={() => {
          if (activeCollection?.type !== "smart") return;
          updateSmartCollection(activeCollection.id);
        }}
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
          />
        )
      ) : null}
    </>
  );
}
