import type { CatalogItem } from "../types/catalog";

type GeminiCatalogFilterOptions = {
  vendors: string[];
  manufacturers: string[];
  materials: string[];
  thicknesses: string[];
  tierGroups: string[];
  finishes: string[];
  sizeClasses: string[];
  priceTypes: string[];
  colorFamilies: string[];
  undertones: string[];
  patternTags: string[];
  movementLevels: string[];
  styleTags: string[];
};

export type GeminiCatalogSearchResult = {
  explanation: string;
  searchText: string;
  vendor: string;
  manufacturers: string[];
  materials: string[];
  thicknesses: string[];
  tierGroups: string[];
  finishes: string[];
  sizeClasses: string[];
  priceTypes: string[];
  colorFamilies: string[];
  undertones: string[];
  patternTags: string[];
  movementLevels: string[];
  styleTags: string[];
};

export type GeminiCatalogVisualMatchResult = {
  explanation: string;
  orderedIds: string[];
  rejectedIds: string[];
};

type GeminiCandidateImage = {
  id: string;
  label: string;
  mimeType: string;
  data: string;
};

function cleanJsonString(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function clampToAllowed(values: string[], allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  return values.filter((value) => allowedSet.has(value));
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function getApiKey(): string {
  return import.meta.env.VITE_GEMINI_API_KEY?.trim() || "";
}

function getModel(): string {
  return import.meta.env.VITE_GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

function toPrompt(userRequest: string, options: GeminiCatalogFilterOptions): string {
  return [
    "You map a salesperson's natural-language stone search into structured catalog filters.",
    "Return JSON only. Do not include markdown.",
    'Use this exact shape: {"explanation":"","searchText":"","vendor":"__all__","manufacturers":[],"materials":[],"thicknesses":[],"tierGroups":[],"finishes":[],"sizeClasses":[],"priceTypes":[],"colorFamilies":[],"undertones":[],"patternTags":[],"movementLevels":[],"styleTags":[]}',
    'Rules: keep values conservative; only use values from the allowed lists below; if unsure leave a field empty; use "__all__" when vendor is not specified; "searchText" should be a short residual keyword query, not the full sentence.',
    `Allowed vendors: ${JSON.stringify(options.vendors)}`,
    `Allowed manufacturers: ${JSON.stringify(options.manufacturers)}`,
    `Allowed materials: ${JSON.stringify(options.materials)}`,
    `Allowed thicknesses: ${JSON.stringify(options.thicknesses)}`,
    `Allowed tierGroups: ${JSON.stringify(options.tierGroups)}`,
    `Allowed finishes: ${JSON.stringify(options.finishes)}`,
    `Allowed sizeClasses: ${JSON.stringify(options.sizeClasses)}`,
    `Allowed priceTypes: ${JSON.stringify(options.priceTypes)}`,
    `Allowed colorFamilies: ${JSON.stringify(options.colorFamilies)}`,
    `Allowed undertones: ${JSON.stringify(options.undertones)}`,
    `Allowed patternTags: ${JSON.stringify(options.patternTags)}`,
    `Allowed movementLevels: ${JSON.stringify(options.movementLevels)}`,
    `Allowed styleTags: ${JSON.stringify(options.styleTags)}`,
    `Salesperson request: ${userRequest}`,
  ].join("\n");
}

export function geminiCatalogSearchConfigured(): boolean {
  return Boolean(getApiKey());
}

export async function runGeminiCatalogSearch(
  userRequest: string,
  options: GeminiCatalogFilterOptions
): Promise<GeminiCatalogSearchResult> {
  const apiKey = getApiKey();
  const model = getModel();
  if (!apiKey) {
    throw new Error("Set VITE_GEMINI_API_KEY to enable AI search.");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: toPrompt(userRequest, options) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}).`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const rawText = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!rawText.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanJsonString(rawText)) as Record<string, unknown>;
  } catch {
    throw new Error("Gemini returned invalid JSON.");
  }

  const vendor = asString(parsed.vendor);

  return {
    explanation: asString(parsed.explanation),
    searchText: asString(parsed.searchText),
    vendor: vendor && (vendor === "__all__" || options.vendors.includes(vendor)) ? vendor : "__all__",
    manufacturers: clampToAllowed(asStringArray(parsed.manufacturers), options.manufacturers),
    materials: clampToAllowed(asStringArray(parsed.materials), options.materials),
    thicknesses: clampToAllowed(asStringArray(parsed.thicknesses), options.thicknesses),
    tierGroups: clampToAllowed(asStringArray(parsed.tierGroups), options.tierGroups),
    finishes: clampToAllowed(asStringArray(parsed.finishes), options.finishes),
    sizeClasses: clampToAllowed(asStringArray(parsed.sizeClasses), options.sizeClasses),
    priceTypes: clampToAllowed(asStringArray(parsed.priceTypes), options.priceTypes),
    colorFamilies: clampToAllowed(asStringArray(parsed.colorFamilies), options.colorFamilies),
    undertones: clampToAllowed(asStringArray(parsed.undertones), options.undertones),
    patternTags: clampToAllowed(asStringArray(parsed.patternTags), options.patternTags),
    movementLevels: clampToAllowed(asStringArray(parsed.movementLevels), options.movementLevels),
    styleTags: clampToAllowed(asStringArray(parsed.styleTags), options.styleTags),
  };
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not encode image file."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

async function blobToSizedJpeg(blob: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode candidate image."));
      img.src = objectUrl;
    });

    const maxEdge = 512;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      throw new Error("Candidate image has no size.");
    }

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas is not available.");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.82);
    });
    if (!jpeg) {
      throw new Error("Could not prepare candidate image.");
    }
    return jpeg;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadCandidateImage(item: CatalogItem): Promise<GeminiCandidateImage | null> {
  const imageUrl = item.imageUrl?.trim();
  if (!imageUrl) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const jpegBlob = await blobToSizedJpeg(await response.blob());
    return {
      id: item.id,
      label: `${item.displayName} (${item.vendor})`,
      mimeType: "image/jpeg",
      data: await fileToBase64(jpegBlob),
    };
  } catch {
    return null;
  }
}

function visualPrompt(userRequest: string, images: GeminiCandidateImage[]): string {
  const allowedIds = images.map((image) => image.id);
  const labeledItems = images.map((image, index) => `${index + 1}. ${image.id} = ${image.label}`);

  return [
    "You are ranking slab and stone photos for a salesperson search.",
    "Focus on what is visibly shown in each image, not just the product names.",
    "Prioritize dominant base color, whether the slab is truly white/light vs dark, and whether the pattern is veining vs granular speckles.",
    "If a request asks for white stone with veins, reject black, dark gray, or peppered/speckled stones even if the text label seems related.",
    "Return JSON only. Do not include markdown.",
    'Use this exact shape: {"explanation":"","orderedIds":[],"rejectedIds":[]}',
    "Only return ids from the allowed list below.",
    `Allowed ids: ${JSON.stringify(allowedIds)}`,
    "Candidate ids and labels:",
    ...labeledItems,
    `Search request: ${userRequest}`,
  ].join("\n");
}

export async function runGeminiCatalogVisualMatch(
  userRequest: string,
  candidates: CatalogItem[]
): Promise<GeminiCatalogVisualMatchResult | null> {
  const apiKey = getApiKey();
  const model = getModel();
  if (!apiKey) {
    throw new Error("Set VITE_GEMINI_API_KEY to enable AI search.");
  }

  const limitedCandidates = candidates.slice(0, 12);
  const images = (await Promise.all(limitedCandidates.map((candidate) => loadCandidateImage(candidate)))).filter(
    (value): value is GeminiCandidateImage => Boolean(value)
  );

  if (images.length < 2) {
    return null;
  }

  const parts: Array<
    | { text: string }
    | {
        inlineData: {
          mimeType: string;
          data: string;
        };
      }
  > = [{ text: visualPrompt(userRequest, images) }];

  for (const image of images) {
    parts.push({ text: `Candidate ${image.id}: ${image.label}` });
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini visual match failed (${res.status}).`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const rawText = json.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!rawText.trim()) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanJsonString(rawText)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const allowedIds = new Set(images.map((image) => image.id));
  const orderedIds = asStringArray(parsed.orderedIds).filter((id) => allowedIds.has(id));
  const rejectedIds = asStringArray(parsed.rejectedIds).filter((id) => allowedIds.has(id));

  if (orderedIds.length === 0 && rejectedIds.length === 0) {
    return null;
  }

  return {
    explanation: asString(parsed.explanation),
    orderedIds,
    rejectedIds,
  };
}
