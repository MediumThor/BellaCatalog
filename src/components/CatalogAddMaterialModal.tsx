import { memo, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { useAuth } from "../auth/AuthProvider";
import { uploadManualCatalogImage } from "../services/manualCatalogImageStorage";
import type { CatalogItem, PriceUnit } from "../types/catalog";
import type { ImportedSource } from "../types/imports";
import { saveOverlayState, upsertEditedItem, upsertImportedSource } from "../utils/import/importStorage";
import { cropImageToBlob, parseDimensionRatioValue } from "../utils/imageCrop";
import { normalizeCatalogData } from "../utils/normalizeCatalogData";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  preferredVendor?: string;
  vendorSuggestions?: string[];
  thicknessOptions?: string[];
  initialItem?: CatalogItem | null;
};

type WalkthroughStepId = "basics" | "slab" | "photo" | "details";

const PRICE_UNITS: PriceUnit[] = ["sqft", "slab", "bundle", "each", "lot", "lf", "unknown"];

const WALKTHROUGH_STEPS: Array<{
  id: WalkthroughStepId;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "basics",
    label: "Step 1",
    title: "Basic material info",
    description: "Start with the supplier and slab name. Everything else can be added as needed.",
  },
  {
    id: "slab",
    label: "Step 2",
    title: "Slab specs",
    description: "Add slab dimensions, thickness, finish, and pricing. Width and height unlock ratio cropping.",
  },
  {
    id: "photo",
    label: "Step 3",
    title: "Photo and crop",
    description: "Upload a slab photo, then crop it to the slab ratio when dimensions are available.",
  },
  {
    id: "details",
    label: "Step 4",
    title: "Extra details",
    description: "Finish with optional inventory, URLs, notes, and tags before saving.",
  },
];

type ManualCatalogForm = {
  vendor: string;
  manufacturer: string;
  productName: string;
  material: string;
  category: string;
  collection: string;
  tierOrGroup: string;
  thickness: string;
  finish: string;
  slabWidth: string;
  slabHeight: string;
  sku: string;
  vendorItemNumber: string;
  bundleNumber: string;
  price: string;
  priceLabel: string;
  priceUnit: PriceUnit;
  productPageUrl: string;
  sourceUrl: string;
  notes: string;
  freightInfo: string;
  tags: string;
  availabilityFlags: string;
  imageUrl: string;
};

function buildDefaultManualForm(preferredVendor = ""): ManualCatalogForm {
  return {
    vendor: preferredVendor,
    manufacturer: "",
    productName: "",
    material: "",
    category: "Slab",
    collection: "",
    tierOrGroup: "",
    thickness: "",
    finish: "",
    slabWidth: "",
    slabHeight: "",
    sku: "",
    vendorItemNumber: "",
    bundleNumber: "",
    price: "",
    priceLabel: "List",
    priceUnit: "slab",
    productPageUrl: "",
    sourceUrl: "",
    notes: "",
    freightInfo: "",
    tags: "",
    availabilityFlags: "",
    imageUrl: "",
  };
}

function slugPart(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function parseCsvValues(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(",")) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function parseCsvLowerValues(input: string): string[] {
  return parseCsvValues(input).map((value) => value.toLowerCase());
}

const SIZE_PAIR_PATTERN = /(\d+(?:\.\d+)?)\s*["']?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["']?/i;

function firstNonEmptyString(values: unknown[]): string {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

function parseDimensionNumber(input: string): number | null {
  const match = input.trim().match(/-?\d*\.?\d+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatDimensionNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function inferSlabDimensions(item: CatalogItem): { slabWidth: string; slabHeight: string } {
  const raw = item.rawSourceFields || {};
  const rawWidth = firstNonEmptyString([raw.slabWidth, raw.width, raw.slab_width, raw.slabWidthIn]);
  const rawHeight = firstNonEmptyString([raw.slabHeight, raw.height, raw.slab_height, raw.slabHeightIn]);
  const rawWidthNum = parseDimensionNumber(rawWidth);
  const rawHeightNum = parseDimensionNumber(rawHeight);

  if (rawWidth && rawHeight) {
    if (rawWidthNum != null && rawHeightNum != null) {
      return rawWidthNum >= rawHeightNum
        ? { slabWidth: rawWidth, slabHeight: rawHeight }
        : { slabWidth: rawHeight, slabHeight: rawWidth };
    }
    return { slabWidth: rawWidth, slabHeight: rawHeight };
  }

  const sizeSources = [item.size, item.priceEntries[0]?.size ?? ""];
  for (const source of sizeSources) {
    const match = source.match(SIZE_PAIR_PATTERN);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
    const hi = Math.max(first, second);
    const lo = Math.min(first, second);
    return {
      slabWidth: formatDimensionNumber(hi),
      slabHeight: formatDimensionNumber(lo),
    };
  }

  return {
    slabWidth: rawWidth,
    slabHeight: rawHeight,
  };
}

function loadImageAspect(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!src.trim()) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const { naturalWidth, naturalHeight } = image;
      resolve(naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : null);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function makeManualSourceToken(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
}

function itemBaseId(item: CatalogItem | null | undefined): string | null {
  if (!item) return null;
  const fromRaw = item.rawSourceFields?.__thicknessSplitFromId;
  return typeof fromRaw === "string" && fromRaw.trim() ? fromRaw : item.id;
}

function sourceTokenFromBaseId(baseId: string | null): string | null {
  if (!baseId) return null;
  const match = baseId.match(/^manual-item\|(.+)$/);
  return match?.[1] ?? null;
}

function isManualCatalogItem(item: CatalogItem | null | undefined): boolean {
  return item?.sourceType === "manual_entry" || item?.rawSourceFields?.manualEntry === true;
}

function manualFormFromItem(item: CatalogItem): ManualCatalogForm {
  const price = item.priceEntries[0];
  const { slabWidth, slabHeight } = inferSlabDimensions(item);
  return {
    vendor: item.vendor || "",
    manufacturer: item.manufacturer || "",
    productName: item.productName || "",
    material: item.material || "",
    category: item.category || "Slab",
    collection: item.collection || "",
    tierOrGroup: item.tierOrGroup || "",
    thickness: item.thickness || "",
    finish: item.finish || "",
    slabWidth,
    slabHeight,
    sku: item.sku || "",
    vendorItemNumber: item.vendorItemNumber || "",
    bundleNumber: item.bundleNumber || "",
    price: price?.price != null ? String(price.price) : "",
    priceLabel: price?.label || "List",
    priceUnit: price?.unit || "slab",
    productPageUrl: item.productPageUrl || "",
    sourceUrl: item.sourceUrl || "",
    notes: item.notes || "",
    freightInfo: item.freightInfo || "",
    tags: item.tags.filter((tag) => tag.toLowerCase() !== "manual-entry").join(", "),
    availabilityFlags: item.availabilityFlags.join(", "),
    imageUrl: item.imageUrl || "",
  };
}

function CatalogAddMaterialModalInner({
  open,
  onClose,
  onCreated,
  preferredVendor = "",
  vendorSuggestions = [],
  thicknessOptions = [],
  initialItem = null,
}: Props) {
  const { user } = useAuth();
  const editingItemId = initialItem?.id ?? null;
  const editingBaseId = useMemo(() => itemBaseId(initialItem), [initialItem]);
  const editingManualItem = useMemo(() => isManualCatalogItem(initialItem), [initialItem]);
  const initialForm = useMemo(
    () => (initialItem ? manualFormFromItem(initialItem) : buildDefaultManualForm(preferredVendor)),
    [initialItem, preferredVendor]
  );
  const [manualForm, setManualForm] = useState<ManualCatalogForm>(initialForm);
  const [manualImageFile, setManualImageFile] = useState<File | null>(null);
  const [manualImagePreviewUrl, setManualImagePreviewUrl] = useState("");
  const [manualImageInputKey, setManualImageInputKey] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [recropCurrentImage, setRecropCurrentImage] = useState(false);
  const [fallbackCropAspect, setFallbackCropAspect] = useState<number | null>(null);
  const [currentStep, setCurrentStep] = useState<WalkthroughStepId>("basics");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vendorListId = "catalog-add-material-vendors";

  const manualPreviewSrc = manualImagePreviewUrl || manualForm.imageUrl.trim();
  const cropEditorSrc = manualImagePreviewUrl || (recropCurrentImage ? manualForm.imageUrl.trim() : "");
  const cropWidthValue = useMemo(
    () => parseDimensionRatioValue(manualForm.slabWidth),
    [manualForm.slabWidth]
  );
  const cropHeightValue = useMemo(
    () => parseDimensionRatioValue(manualForm.slabHeight),
    [manualForm.slabHeight]
  );
  const cropAspect = useMemo(() => {
    if (!cropWidthValue || !cropHeightValue) return null;
    return cropWidthValue / cropHeightValue;
  }, [cropHeightValue, cropWidthValue]);
  const effectiveCropAspect = cropAspect ?? fallbackCropAspect;
  const hasRequiredBasics = Boolean(manualForm.vendor.trim() && manualForm.productName.trim());
  const currentStepIndex = WALKTHROUGH_STEPS.findIndex((step) => step.id === currentStep);
  const currentStepMeta = WALKTHROUGH_STEPS[currentStepIndex] ?? WALKTHROUGH_STEPS[0];
  const isLastStep = currentStepIndex === WALKTHROUGH_STEPS.length - 1;
  const isEditing = initialItem != null;

  useEffect(() => {
    if (!open) return;
    setManualForm(initialForm);
    setManualImageFile(null);
    setManualImageInputKey((prev) => prev + 1);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setRecropCurrentImage(false);
    setFallbackCropAspect(null);
    setCurrentStep("basics");
    setSaving(false);
    setError(null);
  }, [open, initialForm]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  useEffect(() => {
    if (!manualImageFile) {
      setManualImagePreviewUrl("");
      return;
    }
    const next = URL.createObjectURL(manualImageFile);
    setManualImagePreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [manualImageFile]);

  useEffect(() => {
    let cancelled = false;
    if (cropAspect) {
      setFallbackCropAspect(null);
      return;
    }
    if (!cropEditorSrc) {
      setFallbackCropAspect(null);
      return;
    }
    void loadImageAspect(cropEditorSrc).then((aspect) => {
      if (!cancelled) setFallbackCropAspect(aspect);
    });
    return () => {
      cancelled = true;
    };
  }, [cropAspect, cropEditorSrc]);

  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }, [cropEditorSrc, effectiveCropAspect]);

  function resetManualForm() {
    setManualForm(initialForm);
    setManualImageFile(null);
    setManualImageInputKey((prev) => prev + 1);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setRecropCurrentImage(false);
    setFallbackCropAspect(null);
    setCurrentStep("basics");
    setError(null);
  }

  function updateManualForm<Key extends keyof ManualCatalogForm>(key: Key, value: ManualCatalogForm[Key]) {
    setManualForm((prev) => ({ ...prev, [key]: value }));
  }

  const onCropComplete = useCallback((_croppedArea: Area, nextCroppedAreaPixels: Area) => {
    setCroppedAreaPixels(nextCroppedAreaPixels);
  }, []);

  function goToStep(stepId: WalkthroughStepId) {
    setCurrentStep(stepId);
  }

  function goNextStep() {
    const next = WALKTHROUGH_STEPS[currentStepIndex + 1];
    if (next) setCurrentStep(next.id);
  }

  function goPreviousStep() {
    const prev = WALKTHROUGH_STEPS[currentStepIndex - 1];
    if (prev) setCurrentStep(prev.id);
  }

  async function onCreateManualEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const vendor = manualForm.vendor.trim();
    const productName = manualForm.productName.trim();
    const existingRaw = initialItem?.rawSourceFields ?? {};
    if (!vendor || !productName) {
      setError("Vendor and product name are required.");
      return;
    }
    const priceText = manualForm.price.trim();
    const priceValue = priceText ? Number(priceText) : null;
    const slabWidth = manualForm.slabWidth.trim();
    const slabHeight = manualForm.slabHeight.trim();
    const sizeLabel =
      slabWidth && slabHeight ? `${slabWidth} x ${slabHeight}` : slabWidth || slabHeight || "";
    if (priceText && !Number.isFinite(priceValue)) {
      setError("Price must be a valid number.");
      return;
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const sourceToken = sourceTokenFromBaseId(editingBaseId) || editingItemId || makeManualSourceToken();
      const sourceFile = initialItem?.sourceFile?.trim()
        ? initialItem.sourceFile
        : `manual-entry/${slugPart(vendor, "vendor")}/${slugPart(productName, "slab")}/${sourceToken}`;
      let uploadedImageUrl = manualForm.imageUrl.trim();
      let imageStoragePath =
        typeof existingRaw.imageStoragePath === "string" ? existingRaw.imageStoragePath : null;
      const shouldRecropExistingImage =
        !manualImageFile && recropCurrentImage && Boolean(manualForm.imageUrl.trim()) && Boolean(croppedAreaPixels);

      if (manualImageFile || shouldRecropExistingImage) {
        if (!user?.uid) {
          throw new Error("Sign in again before uploading a slab photo.");
        }
        let uploadFile: File;
        let cropApplied = false;
        if (manualImageFile) {
          uploadFile = manualImageFile;
          if (croppedAreaPixels && manualImagePreviewUrl) {
            const croppedBlob = await cropImageToBlob(
              manualImagePreviewUrl,
              croppedAreaPixels,
              manualImageFile.type || "image/jpeg"
            );
            uploadFile = new File([croppedBlob], manualImageFile.name, {
              type: croppedBlob.type || manualImageFile.type || "image/jpeg",
            });
            cropApplied = true;
          }
        } else {
          if (!croppedAreaPixels || !manualForm.imageUrl.trim()) {
            throw new Error("Open the photo cropper before saving the corrected image.");
          }
          const croppedBlob = await cropImageToBlob(manualForm.imageUrl.trim(), croppedAreaPixels, "image/jpeg");
          uploadFile = new File(
            [croppedBlob],
            (typeof existingRaw.uploadedImageName === "string" && existingRaw.uploadedImageName) ||
              `${slugPart(productName, "slab")}.jpg`,
            {
              type: croppedBlob.type || "image/jpeg",
            }
          );
          cropApplied = true;
        }
        const uploaded = await uploadManualCatalogImage({
          ownerUserId: user.uid,
          file: uploadFile,
          vendor,
          productName,
          catalogItemId: sourceToken,
        });
        uploadedImageUrl = uploaded.downloadUrl;
        imageStoragePath = uploaded.storagePath;
        if (cropApplied) {
          // preserve the saved ratio context for exports/debugging later
        }
      }

      const tags = parseCsvLowerValues(manualForm.tags);
      if ((!isEditing || editingManualItem) && !tags.includes("manual-entry")) tags.push("manual-entry");

      const priceEntries = priceText
        ? [
            {
              label: manualForm.priceLabel.trim() || "Manual price",
              price: priceValue,
              unit: manualForm.priceUnit,
              thickness: manualForm.thickness.trim() || undefined,
              size: sizeLabel || undefined,
            },
          ]
        : [];
      const mergedRawSourceFields: Record<string, unknown> = {
        ...existingRaw,
        localEdited: isEditing ? true : existingRaw.localEdited,
        localEditedAt: isEditing ? nowIso : existingRaw.localEditedAt,
        createdAt: typeof existingRaw.createdAt === "string" ? existingRaw.createdAt : nowIso,
        createdByUserId:
          typeof existingRaw.createdByUserId === "string" || existingRaw.createdByUserId === null
            ? existingRaw.createdByUserId
            : user?.uid ?? null,
        imageStoragePath,
        uploadedImageName:
          manualImageFile?.name ??
          (typeof existingRaw.uploadedImageName === "string" ? existingRaw.uploadedImageName : null),
        slabWidth,
        slabHeight,
        croppedToRatio: cropAspect,
        cropApplied:
          manualImageFile != null || shouldRecropExistingImage
            ? Boolean(cropAspect && croppedAreaPixels)
            : existingRaw.cropApplied === true,
      };
      if (editingManualItem || !isEditing) {
        mergedRawSourceFields.manualEntry = true;
      }

      const normalized = normalizeCatalogData(
        [
          isEditing && initialItem
            ? {
                ...initialItem,
                id: editingItemId,
                vendor,
                manufacturer: manualForm.manufacturer.trim(),
                sourceFile,
                sourceType: initialItem.sourceType || (editingManualItem ? "manual_entry" : undefined),
                sourceUrl: manualForm.sourceUrl.trim(),
                productPageUrl: manualForm.productPageUrl.trim(),
                productName,
                displayName: productName,
                material: manualForm.material.trim(),
                category: manualForm.category.trim(),
                collection: manualForm.collection.trim(),
                tierOrGroup: manualForm.tierOrGroup.trim(),
                thickness: manualForm.thickness.trim(),
                thicknesses: undefined,
                finish: manualForm.finish.trim(),
                size: sizeLabel,
                sizes: undefined,
                sku: manualForm.sku.trim(),
                vendorItemNumber: manualForm.vendorItemNumber.trim(),
                bundleNumber: manualForm.bundleNumber.trim(),
                priceEntries,
                imageUrl: uploadedImageUrl || undefined,
                notes: manualForm.notes.trim(),
                freightInfo: manualForm.freightInfo.trim(),
                availabilityFlags: parseCsvValues(manualForm.availabilityFlags),
                tags,
                rawSourceFields: mergedRawSourceFields,
              }
            : {
                id: `manual-item|${sourceToken}`,
                vendor,
                manufacturer: manualForm.manufacturer.trim(),
                sourceFile,
                sourceType: "manual_entry",
                sourceUrl: manualForm.sourceUrl.trim(),
                productPageUrl: manualForm.productPageUrl.trim(),
                productName,
                displayName: productName,
                material: manualForm.material.trim(),
                category: manualForm.category.trim(),
                collection: manualForm.collection.trim(),
                tierOrGroup: manualForm.tierOrGroup.trim(),
                thickness: manualForm.thickness.trim(),
                finish: manualForm.finish.trim(),
                size: sizeLabel,
                sku: manualForm.sku.trim(),
                vendorItemNumber: manualForm.vendorItemNumber.trim(),
                bundleNumber: manualForm.bundleNumber.trim(),
                priceEntries,
                imageUrl: uploadedImageUrl || undefined,
                notes: manualForm.notes.trim(),
                freightInfo: manualForm.freightInfo.trim(),
                availabilityFlags: parseCsvValues(manualForm.availabilityFlags),
                tags,
                rawSourceFields: mergedRawSourceFields,
              },
        ],
        sourceFile
      );

      if (normalized.items.length === 0) {
        throw new Error(normalized.importWarnings[0]?.message || "Could not save this catalog listing.");
      }

      if (isEditing && initialItem) {
        const [normalizedEditedItem] = normalized.items;
        if (!normalizedEditedItem) {
          throw new Error("Could not save the edited listing.");
        }
        const next = upsertEditedItem({
          ...normalizedEditedItem,
          liveInventory: initialItem.liveInventory,
          galleryImages: initialItem.galleryImages?.length ? initialItem.galleryImages : normalizedEditedItem.galleryImages,
          integraGlue: initialItem.integraGlue ?? normalizedEditedItem.integraGlue,
          lastSeenAt: initialItem.lastSeenAt || normalizedEditedItem.lastSeenAt,
          lastImageSyncAt: initialItem.lastImageSyncAt || normalizedEditedItem.lastImageSyncAt,
          lastPriceSyncAt: initialItem.lastPriceSyncAt || normalizedEditedItem.lastPriceSyncAt,
        });
        saveOverlayState(next);
        onCreated();
        onClose();
        return;
      }

      const importedSource: ImportedSource = {
        id: `manual-import|${sourceToken}`,
        parserId: "manual",
        originalFileName: `Manual entry - ${productName}`,
        importedAtIso: nowIso,
        sourceFile,
        vendor,
        items: normalized.items,
        importWarnings: normalized.importWarnings,
      };
      const next = upsertImportedSource(importedSource);
      saveOverlayState(next);
      onCreated();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save this catalog listing.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const modal = (
    <div
      className="modal-backdrop catalog-add-material-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--wide catalog-add-material-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-add-material-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="catalog-add-material-modal__header">
          <div>
            <h2 id="catalog-add-material-title" className="modal-title">
              {isEditing ? "Edit material" : "Add material"}
            </h2>
            <p className="modal-sub catalog-add-material-modal__sub">
              {isEditing
                ? "Update this catalog listing, including re-cropping the current photo when needed, and save it into the local overlay."
                : "Create a polished manual catalog entry with a slab photo, pricing, and supplier details."}
            </p>
          </div>
        </div>

        {error ? (
          <div className="import-warnings" role="alert" style={{ marginTop: 0 }}>
            <strong>Could not {isEditing ? "save material" : "add material"}.</strong> {error}
          </div>
        ) : null}

        <form className="catalog-add-material-form" onSubmit={onCreateManualEntry}>
          <div className="catalog-add-material-steps" role="tablist" aria-label="Add material walkthrough">
            {WALKTHROUGH_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                className="catalog-add-material-step"
                data-active={step.id === currentStep}
                data-complete={index < currentStepIndex}
                onClick={() => goToStep(step.id)}
              >
                <span className="catalog-add-material-step__index">{index + 1}</span>
                <span className="catalog-add-material-step__body">
                  <span className="catalog-add-material-step__label">{step.label}</span>
                  <span className="catalog-add-material-step__title">{step.title}</span>
                </span>
              </button>
            ))}
          </div>

          <section className="catalog-add-material-stage">
            <div className="catalog-add-material-stage__eyebrow">{currentStepMeta.label}</div>
            <h3 className="catalog-add-material-stage__title">{currentStepMeta.title}</h3>
            <p className="catalog-add-material-stage__sub">{currentStepMeta.description}</p>

            {currentStep === "basics" ? (
              <>
                <div className="catalog-add-material-hint">
                  Only <strong>Vendor / supplier</strong> and <strong>Product name</strong> are required to save.
                </div>
                <div className="compare-form-grid catalog-add-material-grid">
                  <label className="form-label">
                    Vendor / supplier
                    <input
                      className="form-input"
                      list={vendorSuggestions.length ? vendorListId : undefined}
                      value={manualForm.vendor}
                      onChange={(e) => updateManualForm("vendor", e.target.value)}
                      placeholder="MSI, Cambria, StoneX..."
                      disabled={saving}
                      required
                      autoFocus
                    />
                  </label>
                  <label className="form-label">
                    Product name
                    <input
                      className="form-input"
                      value={manualForm.productName}
                      onChange={(e) => updateManualForm("productName", e.target.value)}
                      placeholder="Calacatta Gold"
                      disabled={saving}
                      required
                    />
                  </label>
                  <label className="form-label">
                    Manufacturer / brand
                    <input
                      className="form-input"
                      value={manualForm.manufacturer}
                      onChange={(e) => updateManualForm("manufacturer", e.target.value)}
                      placeholder="Optional"
                      disabled={saving}
                    />
                  </label>
                  <label className="form-label">
                    Material
                    <input
                      className="form-input"
                      value={manualForm.material}
                      onChange={(e) => updateManualForm("material", e.target.value)}
                      placeholder="Quartz, granite, porcelain..."
                      disabled={saving}
                    />
                  </label>
                  <label className="form-label">
                    Category
                    <input
                      className="form-input"
                      value={manualForm.category}
                      onChange={(e) => updateManualForm("category", e.target.value)}
                      placeholder="Slab"
                      disabled={saving}
                    />
                  </label>
                  <label className="form-label">
                    Collection / line
                    <input
                      className="form-input"
                      value={manualForm.collection}
                      onChange={(e) => updateManualForm("collection", e.target.value)}
                      placeholder="Optional"
                      disabled={saving}
                    />
                  </label>
                  <label className="form-label compare-form-span-2">
                    Tier / group
                    <input
                      className="form-input"
                      value={manualForm.tierOrGroup}
                      onChange={(e) => updateManualForm("tierOrGroup", e.target.value)}
                      placeholder="Optional"
                      disabled={saving}
                    />
                  </label>
                </div>
              </>
            ) : null}

            {currentStep === "slab" ? (
              <div className="compare-form-grid catalog-add-material-grid">
                <label className="form-label">
                  Thickness
                  <select
                    className="form-input"
                    value={manualForm.thickness}
                    onChange={(e) => updateManualForm("thickness", e.target.value)}
                    disabled={saving}
                  >
                    <option value="">Select thickness</option>
                    {thicknessOptions.map((thickness) => (
                      <option key={thickness} value={thickness}>
                        {thickness}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Finish
                  <input
                    className="form-input"
                    value={manualForm.finish}
                    onChange={(e) => updateManualForm("finish", e.target.value)}
                    placeholder="Polished, suede..."
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Width
                  <input
                    className="form-input"
                    value={manualForm.slabWidth}
                    onChange={(e) => updateManualForm("slabWidth", e.target.value)}
                    placeholder='126", 63, 3200mm...'
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Height
                  <input
                    className="form-input"
                    value={manualForm.slabHeight}
                    onChange={(e) => updateManualForm("slabHeight", e.target.value)}
                    placeholder='63", 1600mm...'
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Price
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={manualForm.price}
                    onChange={(e) => updateManualForm("price", e.target.value)}
                    placeholder="Optional"
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Price label
                  <input
                    className="form-input"
                    value={manualForm.priceLabel}
                    onChange={(e) => updateManualForm("priceLabel", e.target.value)}
                    placeholder="List, promo, bundle..."
                    disabled={saving}
                  />
                </label>
                <label className="form-label compare-form-span-2">
                  Price unit
                  <select
                    className="form-input"
                    value={manualForm.priceUnit}
                    onChange={(e) => updateManualForm("priceUnit", e.target.value as PriceUnit)}
                    disabled={saving}
                  >
                    {PRICE_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {currentStep === "photo" ? (
              <div className="compare-form-grid catalog-add-material-grid">
                <label className="form-label compare-form-span-2">
                  Upload slab photo
                  <input
                    key={manualImageInputKey}
                    className="form-input"
                    type="file"
                    accept="image/*"
                    disabled={saving}
                    onChange={(e) => {
                      const nextFile = e.target.files?.[0] ?? null;
                      setManualImageFile(nextFile);
                      if (nextFile) setRecropCurrentImage(false);
                    }}
                  />
                  <span className="filter-hint">
                    Upload a file here, or paste an image URL below. If both are set, the uploaded file wins. You can
                    also re-crop the current catalog photo when a listing already has one.
                  </span>
                </label>

                {manualForm.imageUrl.trim() && !manualImageFile ? (
                  <div className="compare-form-span-2" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setRecropCurrentImage((prev) => !prev)}
                      disabled={saving}
                    >
                      {recropCurrentImage ? "Use current photo as-is" : "Re-crop current photo"}
                    </button>
                    <span className="filter-hint">
                      {cropAspect
                        ? "This will upload a corrected cropped copy and keep it in your local catalog overlay."
                        : "This will upload a corrected cropped copy. Add width and height in Step 2 to lock the crop to the slab ratio."}
                    </span>
                  </div>
                ) : null}

                {manualImageFile || recropCurrentImage ? (
                  <div className="compare-form-span-2 catalog-add-material-crop">
                    <div className="catalog-add-material-crop__header">
                      <div>
                        <div className="settings-section-title catalog-add-material-crop__title">Crop slab photo</div>
                        <p className="product-sub catalog-add-material-crop__sub">
                          {cropAspect
                            ? `Crop is locked to ${manualForm.slabWidth.trim() || "?"} x ${
                                manualForm.slabHeight.trim() || "?"
                              }. The saved image will use this crop.`
                            : "Crop the photo now using its current image ratio, or add width and height in Step 2 to lock it to the slab ratio."}
                        </p>
                      </div>
                      {cropAspect ? (
                        <div className="catalog-add-material-crop__ratio-pill">
                          Ratio {cropWidthValue?.toFixed(2)} : {cropHeightValue?.toFixed(2)}
                        </div>
                      ) : fallbackCropAspect ? (
                        <div className="catalog-add-material-crop__ratio-pill">Using current photo ratio</div>
                      ) : null}
                    </div>

                    {effectiveCropAspect ? (
                      <>
                        <div className="catalog-add-material-crop__frame">
                          <Cropper
                            image={cropEditorSrc}
                            crop={crop}
                            zoom={zoom}
                            aspect={effectiveCropAspect}
                            showGrid={false}
                            objectFit="contain"
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropComplete={onCropComplete}
                          />
                        </div>
                        <label className="form-label catalog-add-material-crop__zoom">
                          Zoom
                          <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.01}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            disabled={saving}
                          />
                        </label>
                      </>
                    ) : (
                      <div className="catalog-add-material-crop__empty">
                        The photo could not be prepared for cropping yet. Try another image or add slab dimensions in Step 2.
                      </div>
                    )}
                  </div>
                ) : null}

                <label className="form-label compare-form-span-2">
                  Image URL
                  <input
                    className="form-input"
                    type="url"
                    value={manualForm.imageUrl}
                    onChange={(e) => updateManualForm("imageUrl", e.target.value)}
                    placeholder="https://..."
                    disabled={saving}
                  />
                </label>

                {manualPreviewSrc && !manualImageFile && !recropCurrentImage ? (
                  <div className="compare-form-span-2 catalog-add-material-preview">
                    <img src={manualPreviewSrc} alt="" className="catalog-add-material-preview__img" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {currentStep === "details" ? (
              <div className="compare-form-grid catalog-add-material-grid">
                <label className="form-label">
                  SKU / code
                  <input
                    className="form-input"
                    value={manualForm.sku}
                    onChange={(e) => updateManualForm("sku", e.target.value)}
                    placeholder="Optional"
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Vendor item #
                  <input
                    className="form-input"
                    value={manualForm.vendorItemNumber}
                    onChange={(e) => updateManualForm("vendorItemNumber", e.target.value)}
                    placeholder="Optional"
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Bundle #
                  <input
                    className="form-input"
                    value={manualForm.bundleNumber}
                    onChange={(e) => updateManualForm("bundleNumber", e.target.value)}
                    placeholder="Optional"
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Product page URL
                  <input
                    className="form-input"
                    type="url"
                    value={manualForm.productPageUrl}
                    onChange={(e) => updateManualForm("productPageUrl", e.target.value)}
                    placeholder="https://..."
                    disabled={saving}
                  />
                </label>
                <label className="form-label compare-form-span-2">
                  Source URL
                  <input
                    className="form-input"
                    type="url"
                    value={manualForm.sourceUrl}
                    onChange={(e) => updateManualForm("sourceUrl", e.target.value)}
                    placeholder="Optional supplier or reference URL"
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Tags
                  <input
                    className="form-input"
                    value={manualForm.tags}
                    onChange={(e) => updateManualForm("tags", e.target.value)}
                    placeholder="comma, separated, tags"
                    disabled={saving}
                  />
                </label>
                <label className="form-label">
                  Availability flags
                  <input
                    className="form-input"
                    value={manualForm.availabilityFlags}
                    onChange={(e) => updateManualForm("availabilityFlags", e.target.value)}
                    placeholder="quick ship, low stock..."
                    disabled={saving}
                  />
                </label>
                <label className="form-label compare-form-span-2">
                  Notes
                  <textarea
                    className="form-input form-textarea"
                    value={manualForm.notes}
                    onChange={(e) => updateManualForm("notes", e.target.value)}
                    placeholder="Anything installers, sales, or estimating should know."
                    disabled={saving}
                  />
                </label>
                <label className="form-label compare-form-span-2">
                  Freight / shipping
                  <textarea
                    className="form-input form-textarea"
                    value={manualForm.freightInfo}
                    onChange={(e) => updateManualForm("freightInfo", e.target.value)}
                    placeholder="Optional freight details"
                    disabled={saving}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <div className="modal-actions catalog-add-material-actions">
            <button type="button" className="btn" onClick={resetManualForm} disabled={saving}>
              Reset
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <span className="catalog-add-material-actions__spacer" />
            {currentStepIndex > 0 ? (
              <button type="button" className="btn" onClick={goPreviousStep} disabled={saving}>
                Back
              </button>
            ) : null}
            {!isLastStep ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={goNextStep}
                disabled={saving || (currentStep === "basics" && !hasRequiredBasics)}
              >
                Next
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={saving || !hasRequiredBasics}>
                {saving ? (isEditing ? "Saving..." : "Adding...") : isEditing ? "Save changes" : "Add material"}
              </button>
            )}
          </div>
        </form>
        {vendorSuggestions.length ? (
          <datalist id={vendorListId}>
            {vendorSuggestions.map((vendor) => (
              <option key={vendor} value={vendor} />
            ))}
          </datalist>
        ) : null}
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : null;
}

export const CatalogAddMaterialModal = memo(CatalogAddMaterialModalInner);
