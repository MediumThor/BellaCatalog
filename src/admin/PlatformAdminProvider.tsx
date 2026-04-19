import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { subscribeIsPlatformAdmin } from "./platformAdminFirestore";

/**
 * Lightweight context that tells the rest of the app whether the
 * signed-in user is a BellaCatalog platform admin. Exposed as a single
 * boolean + loading flag so non-admins pay zero runtime cost.
 */
export interface PlatformAdminContextValue {
  isPlatformAdmin: boolean;
  loading: boolean;
}

const PlatformAdminContext = createContext<PlatformAdminContextValue>({
  isPlatformAdmin: false,
  loading: true,
});

export function PlatformAdminProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeIsPlatformAdmin(
      user.uid,
      (next) => {
        setIsAdmin(next);
        setLoading(false);
      },
      () => {
        setIsAdmin(false);
        setLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  const value = useMemo(
    () => ({ isPlatformAdmin: isAdmin, loading }),
    [isAdmin, loading]
  );

  return (
    <PlatformAdminContext.Provider value={value}>
      {children}
    </PlatformAdminContext.Provider>
  );
}

export function usePlatformAdmin(): PlatformAdminContextValue {
  return useContext(PlatformAdminContext);
}
