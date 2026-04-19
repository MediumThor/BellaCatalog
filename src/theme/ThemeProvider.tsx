import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { useAuth } from "../auth/AuthProvider";
import { firebaseDb } from "../firebase";

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "bella.theme";
const DEFAULT_MODE: ThemeMode = "dark";

type ThemeContextValue = {
  /** What the user chose (may be "system"). */
  mode: ThemeMode;
  /** What is actually applied right now ("dark" or "light"). */
  resolved: ResolvedTheme;
  setMode: (next: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_MODE;
}

function writeStoredMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore quota / privacy errors
  }
}

function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersLight() ? "light" : "dark";
  return mode;
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveMode(readStoredMode())
  );

  // Apply on every mode change.
  useEffect(() => {
    const next = resolveMode(mode);
    setResolved(next);
    applyTheme(next);
  }, [mode]);

  // React to OS-level theme changes when the user picked "system".
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? "light" : "dark";
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [mode]);

  // When signed in, sync from the user's profile doc. The Firestore value
  // wins over localStorage so the same account looks identical on any device.
  useEffect(() => {
    if (!user) return;
    const ref = doc(firebaseDb, "users", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const remote = snap.data()?.theme;
        if (isThemeMode(remote) && remote !== mode) {
          setModeState(remote);
          writeStoredMode(remote);
        }
      },
      () => {
        // Network errors shouldn't change the local theme.
      }
    );
    return unsub;
    // We intentionally only re-subscribe per user; comparing against `mode`
    // here would refire the snapshot listener whenever the user toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const setMode = useCallback<ThemeContextValue["setMode"]>(
    async (next) => {
      setModeState(next);
      writeStoredMode(next);
      if (user) {
        try {
          await setDoc(
            doc(firebaseDb, "users", user.uid),
            { theme: next, updatedAt: serverTimestamp() },
            { merge: true }
          );
        } catch {
          // Non-fatal: the local choice still applies.
        }
      }
    },
    [user]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
