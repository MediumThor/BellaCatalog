import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseDb } from "../firebase";
import type { UiPreferences } from "../types/catalog";

/**
 * Per-user, per-company catalog state (favorites + UI preferences).
 *
 * Path: `companies/{companyId}/userCatalogState/{userId}`
 *
 * localStorage remains the immediate-read cache (see `localStorageState.ts`).
 * When a company context exists, this service becomes the source of truth and
 * localStorage is used as a warm cache.
 */

export interface UserCatalogStateDoc {
  companyId: string;
  userId: string;
  favoriteItemIds: string[];
  preferences: UiPreferences | null;
}

function stateDoc(companyId: string, userId: string) {
  return doc(firebaseDb, "companies", companyId, "userCatalogState", userId);
}

export function subscribeUserCatalogState(
  companyId: string,
  userId: string,
  onData: (state: UserCatalogStateDoc | null) => void,
  onError?: (e: Error) => void
): () => void {
  return onSnapshot(
    stateDoc(companyId, userId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      const favoriteItemIds = Array.isArray(raw.favoriteItemIds)
        ? (raw.favoriteItemIds.filter((x) => typeof x === "string") as string[])
        : [];
      const preferences =
        raw.preferences && typeof raw.preferences === "object"
          ? ((raw.preferences as unknown) as UiPreferences)
          : null;
      onData({ companyId, userId, favoriteItemIds, preferences });
    },
    (e) => onError?.(e as Error)
  );
}

export async function saveFavoriteItemIds(
  companyId: string,
  userId: string,
  favoriteItemIds: string[]
): Promise<void> {
  await setDoc(
    stateDoc(companyId, userId),
    {
      companyId,
      userId,
      favoriteItemIds,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function saveUiPreferences(
  companyId: string,
  userId: string,
  preferences: UiPreferences
): Promise<void> {
  await setDoc(
    stateDoc(companyId, userId),
    {
      companyId,
      userId,
      preferences,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
