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

function isFirebaseStorageHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    return h === "firebasestorage.googleapis.com" || h.endsWith(".firebasestorage.app");
  } catch {
    return false;
  }
}

/**
 * In Vite dev, route `firebasestorage.googleapis.com` URLs through `vite.config` `server.proxy`
 * so the browser sees same-origin responses; `fetch` → blob → ImageBitmap is then WebGL-safe.
 * Production still uses the raw URL (configure Storage CORS on the bucket, or add a hosting proxy).
 */
function devSameOriginFirebaseStorageUrl(url: string): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== "firebasestorage.googleapis.com") return null;
    return `${window.location.origin}/__firebase_storage${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** Avoid 304 revalidation that can omit CORS headers on cross-origin image loads. */
function withCacheBustQuery(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("_cb", String(Date.now()));
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Prefer same-origin `fetch` → blob when the dev proxy is active (see `devSameOriginFirebaseStorageUrl`).
 * Otherwise Firebase often omits CORS on cross-origin `fetch`; fall back to TextureLoader/Image.
 */
async function loadFirebaseStorageHttpsUrl(url: string, maxAnisotropy: number): Promise<THREE.Texture | null> {
  const primary = devSameOriginFirebaseStorageUrl(url) ?? url;

  const tryPrimaryBlob = async (): Promise<THREE.Texture | null> => {
    const busted = withCacheBustQuery(primary);
    const blob = await tryFetchBlob(busted);
    if (!blob) return null;
    const t = await textureFromBlob(blob, maxAnisotropy);
    return t;
  };

  let tex = await tryPrimaryBlob();
  if (tex) return tex;

  const busted = withCacheBustQuery(primary);
  tex = await tryTextureLoader(busted, maxAnisotropy, "anonymous");
  if (tex) return tex;
  tex = await tryTextureLoader(busted, maxAnisotropy, null);
  if (tex) return tex;
  tex = await tryTextureLoader(primary, maxAnisotropy, "anonymous");
  if (tex) return tex;
  tex = await tryTextureLoader(primary, maxAnisotropy, null);
  if (tex) return tex;
  tex = await textureFromImageUrl(busted, maxAnisotropy);
  if (tex) return tex;
  return textureFromImageUrl(primary, maxAnisotropy);
}

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
  /** ImageBitmap is top-left origin; Three.js expects `flipY` false for GPU upload from bitmaps. */
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

/**
 * `cache: 'no-store'` avoids 304 revalidation responses that often omit CORS headers on `fetch`,
 * which breaks `res.blob()` for WebGL (Chrome: "No Access-Control-Allow-Origin" on 304).
 */
async function tryFetchBlob(url: string): Promise<Blob | null> {
  const base: RequestInit = {
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  };
  const attempts: RequestInit[] = [
    base,
    { ...base, referrerPolicy: "no-referrer" },
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

async function tryFetchBlobViaWsrv(originalHttpsUrl: string): Promise<Blob | null> {
  if (!/^https?:\/\//i.test(originalHttpsUrl)) return null;
  /** Firebase signed URLs + wsrv double-encoding breaks paths (%252F → 403). Image/TextureLoader is primary for Firebase. */
  if (isFirebaseStorageHttpsUrl(originalHttpsUrl)) return null;
  const proxied = `${WSRV_PROXY}${encodeURIComponent(originalHttpsUrl)}`;
  if (proxied.length > 7800) return null;
  return tryFetchBlob(proxied);
}

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

/**
 * 1) `fetch` → blob → ImageBitmap — when CORS allows (not Firebase download URLs in dev).
 * 2) TextureLoader / Image — matches &lt;img&gt;; required for Firebase (no fetch CORS on many buckets).
 */
async function loadHttpsUrlOnce(url: string, maxAnisotropy: number): Promise<THREE.Texture | null> {
  if (isFirebaseStorageHttpsUrl(url)) {
    return loadFirebaseStorageHttpsUrl(url, maxAnisotropy);
  }

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
    const t = await textureFromBlob(blob, maxAnisotropy);
    if (t) return t;
  }

  let tex = await tryTextureLoader(url, maxAnisotropy, "anonymous");
  if (tex) return tex;

  tex = await tryTextureLoader(url, maxAnisotropy, null);
  if (tex) return tex;

  return textureFromImageUrl(url, maxAnisotropy);
}

/**
 * Loads slab imagery for WebGL. Tries raw URL and normalized variant; image decode before fetch.
 */
export async function loadSlabTextureForWebGL(
  rawUrl: string,
  maxAnisotropy: number
): Promise<THREE.Texture | null> {
  const variants = urlVariantsForLoading(rawUrl);
  if (!variants.length) return null;

  for (const url of variants) {
    if (/^https?:\/\//i.test(url)) {
      const t = await loadHttpsUrlOnce(url, maxAnisotropy);
      if (t) return t;
    } else {
      let t = await tryTextureLoader(url, maxAnisotropy, "anonymous");
      if (t) return t;
      t = await tryTextureLoader(url, maxAnisotropy, null);
      if (t) return t;
      t = await textureFromImageUrl(url, maxAnisotropy);
      if (t) return t;
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
