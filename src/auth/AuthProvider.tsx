import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { firebaseAuth, firebaseDb } from "../firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** Display name from Firestore `users/{uid}.displayName` (not Auth profile). */
  profileDisplayName: string | null;
  profileLoading: boolean;
  saveProfileDisplayName: (name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
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
        setProfileLoading(false);
      },
      () => {
        setProfileDisplayName(null);
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
      signIn: async (email: string, password: string) => {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      },
      signOut: async () => {
        await signOut(firebaseAuth);
      },
    }),
    [user, loading, profileDisplayName, profileLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

