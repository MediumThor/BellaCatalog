import * as THREE from "three";
import { corsSafeImageUrl, normalizeRenderableImageUrl } from "../../../utils/renderableImageUrl";

/** Set on textures created from a blob object URL; revoke when disposing. */
export const SLAB_TEXTURE_BLOB_URL_USERDATA_KEY = "__slabBlobObjectUrl";
/** Native ImageBitmap backing a texture; call close() on dispose. */
export const SLAB_TEXTURE_IMAGEBITMAP_USERDATA_KEY = "__slabImageBitmap";

const FETCH_TIMEOUT_MS = 12_000;
const TEXTURE_LOAD_TIMEOUT_MS = 15_000;

/** Public image proxy — fetches server-side so our origin gets CORS-clean bytes for WebGL. */
const WSRV_PROXY = "https://wsrv.nl/?url=";

function finalizeSlabTexture(tex: THREE.Texture, maxAnisotropy: number): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  /** Slab photos are arbitrary size (cropped); mipmaps + mipmap min filters often render black in WebGL. */
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function textureFromImageBitmap(bitmap: ImageBitmap, maxAnisotropy: number): THREE.Texture {
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.userData[SLAB_TEXTURE_IMAGEBITMAP_USERDATA_KEY] = bitmap;
  return finalizeSlabTexture(tex, maxAnisotropy);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = globalThis.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        globalThis.clearTimeout(id);
        resolve(v);
      },
      (e) => {
        globalThis.clearTimeout(id);
        reject(e);
      }
    );
  });
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const ac = new AbortController();
  const id = globalThis.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    return res;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(id);
  }
}

async function tryFetchBlob(url: string): Promise<Blob | null> {
  const attempts: RequestInit[] = [
    { mode: "cors", credentials: "omit" },
    { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" },
  ];
  for (const init of attempts) {
    try {
      const res = await fetchWithTimeout(url, init);
      if (!res?.ok) continue;
      const blob = await res.blob();
      if (blob.size > 0) return blob;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Same bytes via wsrv.nl when direct browser fetch fails (CORS / odd headers) but &lt;img&gt; still works.
 * Long Firebase URLs may exceed proxy limits — then this no-ops.
 */
async function tryFetchBlobViaWsrv(originalHttpsUrl: string): Promise<Blob | null> {
  if (!/^https?:\/\//i.test(originalHttpsUrl)) return null;
  const proxied = `${WSRV_PROXY}${encodeURIComponent(originalHttpsUrl)}`;
  if (proxied.length > 7800) return null;
  return tryFetchBlob(proxied);
}

/**
 * `encodeURI(decodeURI(u))` can differ from the string that successfully loads in &lt;img&gt;
 * (e.g. Firebase token query). Try both trimmed raw and normalized URLs.
 */
function urlVariantsForLoading(rawUrl: string): string[] {
  const trimmed = rawUrl.trim();
  if (!trimmed) return [];
  const normalized = normalizeRenderableImageUrl(trimmed);
  if (normalized === trimmed) return [trimmed];
  return [trimmed, normalized];
}

async function textureFromBlob(blob: Blob, maxAnisotropy: number): Promise<THREE.Texture | null> {
  if (blob.size < 1) return null;

  const tryCreateBitmap = async (b: Blob): Promise<ImageBitmap | null> => {
    try {
      return await createImageBitmap(b);
    } catch {
      return null;
    }
  };

  let bitmap = await tryCreateBitmap(blob);
  if (!bitmap && (!blob.type || blob.type === "application/octet-stream")) {
    const buf = await blob.arrayBuffer();
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      bitmap = await tryCreateBitmap(new Blob([buf], { type }));
      if (bitmap) break;
    }
  }
  if (bitmap) {
    return textureFromImageBitmap(bitmap, maxAnisotropy);
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const tex = await withTimeout(loader.loadAsync(objectUrl), TEXTURE_LOAD_TIMEOUT_MS);
    finalizeSlabTexture(tex, maxAnisotropy);
    tex.userData[SLAB_TEXTURE_BLOB_URL_USERDATA_KEY] = objectUrl;
    return tex;
  } catch {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Mirrors a successful &lt;img&gt; load: decode in an Image, then GPU upload (needs CORS from host
 * or same-origin blob). Tries anonymous first, then no crossOrigin (layout resolution path).
 */
async function textureFromImageUrl(url: string, maxAnisotropy: number): Promise<THREE.Texture | null> {
  const tryOnce = (crossOrigin: "" | "anonymous") =>
    new Promise<THREE.Texture | null>((resolve) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = async () => {
        try {
          if (img.decode) await img.decode();
          const tex = new THREE.Texture(img);
          finalizeSlabTexture(tex, maxAnisotropy);
          resolve(tex);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });

  let tex = await withTimeout(tryOnce("anonymous"), TEXTURE_LOAD_TIMEOUT_MS).catch(() => null);
  if (tex) return tex;
  return withTimeout(tryOnce(""), TEXTURE_LOAD_TIMEOUT_MS).catch(() => null);
}

async function tryTextureLoader(url: string, maxAnisotropy: number, crossOrigin: "anonymous" | null): Promise<THREE.Texture | null> {
  const loader = new THREE.TextureLoader();
  if (crossOrigin) loader.setCrossOrigin(crossOrigin);
  try {
    const tex = await withTimeout(loader.loadAsync(url), TEXTURE_LOAD_TIMEOUT_MS);
    return finalizeSlabTexture(tex, maxAnisotropy);
  } catch {
    return null;
  }
}

async function loadHttpsUrlOnce(url: string, maxAnisotropy: number): Promise<THREE.Texture | null> {
  let blob = await tryFetchBlob(url);
  if (!blob) {
    const safe = corsSafeImageUrl(url);
    if (safe && safe !== url) {
      blob = await tryFetchBlob(safe);
    }
  }
  if (!blob) {
    blob = await tryFetchBlobViaWsrv(url);
  }
  if (blob) {
    const tex = await textureFromBlob(blob, maxAnisotropy);
    if (tex) return tex;
  }

  let tex = await tryTextureLoader(url, maxAnisotropy, "anonymous");
  if (tex) return tex;

  tex = await tryTextureLoader(url, maxAnisotropy, null);
  if (tex) return tex;

  return textureFromImageUrl(url, maxAnisotropy);
}

/**
 * Loads slab imagery for WebGL. Tries raw URL and normalized variant, fetch→bitmap, TextureLoader,
 * Image decode, and wsrv proxy fallback so Firebase / CDN URLs that paint in 2D still upload to GPU.
 */
export async function loadSlabTextureForWebGL(
  rawUrl: string,
  maxAnisotropy: number
): Promise<THREE.Texture | null> {
  const variants = urlVariantsForLoading(rawUrl);
  if (!variants.length) return null;

  for (const url of variants) {
    if (/^https?:\/\//i.test(url)) {
      const tex = await loadHttpsUrlOnce(url, maxAnisotropy);
      if (tex) return tex;
    } else {
      const tex = await tryTextureLoader(url, maxAnisotropy, "anonymous");
      if (tex) return tex;
      const tex2 = await tryTextureLoader(url, maxAnisotropy, null);
      if (tex2) return tex2;
      const tex3 = await textureFromImageUrl(url, maxAnisotropy);
      if (tex3) return tex3;
    }
  }

  return null;
}

export function disposeSlabTextureWebGL(tex: THREE.Texture): void {
  const blobUrl = tex.userData?.[SLAB_TEXTURE_BLOB_URL_USERDATA_KEY];
  const bitmap = tex.userData?.[SLAB_TEXTURE_IMAGEBITMAP_USERDATA_KEY] as ImageBitmap | undefined;
  tex.dispose();
  if (typeof blobUrl === "string") {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      /* ignore */
    }
  }
  if (bitmap && typeof bitmap.close === "function") {
    try {
      bitmap.close();
    } catch {
      /* ignore */
    }
  }
}
