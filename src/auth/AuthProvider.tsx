import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { firebaseAuth, firebaseDb } from "../firebase";
import { sanitizePhone } from "../utils/phone";

export type UserProfilePatch = {
  displayName?: string;
  phone?: string;
  whatsapp?: string;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** Display name from Firestore `users/{uid}.displayName` (not Auth profile). */
  profileDisplayName: string | null;
  /** Optional contact phone (stored at `users/{uid}.phone`). */
  profilePhone: string | null;
  /** Optional WhatsApp number (stored at `users/{uid}.whatsapp`). */
  profileWhatsapp: string | null;
  profileLoading: boolean;
  /** @deprecated use `saveProfile({ displayName })` instead. */
  saveProfileDisplayName: (name: string) => Promise<void>;
  saveProfile: (patch: UserProfilePatch) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<User>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [profileWhatsapp, setProfileWhatsapp] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileDisplayName(null);
      setProfilePhone(null);
      setProfileWhatsapp(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    const ref = doc(firebaseDb, "users", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.data();
        setProfileDisplayName(typeof d?.displayName === "string" ? d.displayName : null);
        setProfilePhone(typeof d?.phone === "string" ? d.phone : null);
        setProfileWhatsapp(typeof d?.whatsapp === "string" ? d.whatsapp : null);
        setProfileLoading(false);
      },
      () => {
        setProfileDisplayName(null);
        setProfilePhone(null);
        setProfileWhatsapp(null);
        setProfileLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      profileDisplayName,
      profilePhone,
      profileWhatsapp,
      profileLoading,
      saveProfileDisplayName: async (name: string) => {
        if (!user) return;
        await setDoc(
          doc(firebaseDb, "users", user.uid),
          {
            displayName: name.trim(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      },
      saveProfile: async (patch: UserProfilePatch) => {
        if (!user) return;
        const payload: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
        };
        if (typeof patch.displayName === "string") {
          payload.displayName = patch.displayName.trim();
        }
        if (typeof patch.phone === "string") {
          payload.phone = sanitizePhone(patch.phone);
        }
        if (typeof patch.whatsapp === "string") {
          payload.whatsapp = sanitizePhone(patch.whatsapp);
        }
        await setDoc(doc(firebaseDb, "users", user.uid), payload, { merge: true });
      },
      signIn: async (email: string, password: string) => {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      },
      signUp: async ({ email, password, displayName }) => {
        const cred = await createUserWithEmailAndPassword(
          firebaseAuth,
          email,
          password
        );
        const trimmedName = displayName?.trim();
        if (trimmedName) {
          try {
            await updateProfile(cred.user, { displayName: trimmedName });
          } catch {
            // Non-fatal; Firestore profile still gets the name below.
          }
        }
        await setDoc(
          doc(firebaseDb, "users", cred.user.uid),
          {
            email: cred.user.email ?? email,
            displayName: trimmedName ?? "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true }
        );
        return cred.user;
      },
      signOut: async () => {
        await signOut(firebaseAuth);
      },
    }),
    [user, loading, profileDisplayName, profilePhone, profileWhatsapp, profileLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

