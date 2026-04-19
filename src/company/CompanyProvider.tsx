import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  findMembershipsForUser,
  setUserActiveCompany,
  subscribeCompanyDoc,
  subscribeCompanyMember,
  subscribeUserDoc,
} from "./companyFirestore";
import type {
  CompanyDoc,
  CompanyMemberDoc,
  CompanyRole,
  ResolvedPermissions,
  UserDoc,
} from "./types";
import { resolvePermissions } from "./types";

export interface CompanyContextValue {
  userDoc: UserDoc | null;
  activeCompany: CompanyDoc | null;
  activeCompanyId: string | null;

  membership: CompanyMemberDoc | null;
  role: CompanyRole | null;

  memberships: CompanyMemberDoc[];

  loading: boolean;
  error: string | null;

  hasCompany: boolean;
  hasActiveSeat: boolean;
  hasAllowedBillingStatus: boolean;
  isBillingFixable: boolean;
  canAccessApp: boolean;

  permissions: ResolvedPermissions;

  switchCompany: (companyId: string) => Promise<void>;
  refresh: () => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

const EMPTY_PERMISSIONS: ResolvedPermissions = {
  canManageBilling: false,
  canManageUsers: false,
  canManageCatalog: false,
  canPublishPriceBooks: false,
  canCreateJobs: false,
  canViewPrices: false,
};

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [memberships, setMemberships] = useState<CompanyMemberDoc[]>([]);
  const [activeCompany, setActiveCompany] = useState<CompanyDoc | null>(null);
  const [membership, setMembership] = useState<CompanyMemberDoc | null>(null);

  const [userDocLoading, setUserDocLoading] = useState(false);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [membershipsVersion, setMembershipsVersion] = useState(0);

  // Subscribe to users/{uid}
  useEffect(() => {
    if (!user) {
      setUserDoc(null);
      setUserDocLoading(false);
      return;
    }
    setUserDocLoading(true);
    const unsub = subscribeUserDoc(
      user.uid,
      (next) => {
        setUserDoc(next);
        setUserDocLoading(false);
      },
      (e) => {
        setError(e.message);
        setUserDocLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  // Load memberships across companies (one-shot; refreshes when needed)
  useEffect(() => {
    if (!user) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }
    let cancelled = false;
    setMembershipsLoading(true);
    (async () => {
      try {
        const rows = await findMembershipsForUser(user.uid);
        if (cancelled) return;
        setMemberships(rows);
        setMembershipsLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load memberships");
        setMembershipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, membershipsVersion]);

  // Pick activeCompanyId from userDoc preference, else first active membership.
  const activeCompanyId = useMemo<string | null>(() => {
    const preferred =
      (userDoc?.activeCompanyId && userDoc.activeCompanyId.trim()) ||
      (userDoc?.defaultCompanyId && userDoc.defaultCompanyId.trim()) ||
      null;
    if (preferred) {
      // Only honor preferred if the user still has that membership (or we can’t
      // tell yet because memberships haven't loaded).
      if (!memberships.length) return preferred;
      const hasPreferred = memberships.some(
        (m) => m.companyId === preferred && m.status !== "removed"
      );
      if (hasPreferred) return preferred;
    }
    const firstActive = memberships.find(
      (m) => m.status === "active" || m.status === "invited"
    );
    return firstActive?.companyId ?? null;
  }, [userDoc?.activeCompanyId, userDoc?.defaultCompanyId, memberships]);

  // Apply company branding colors as CSS variables on :root so the
  // whole app reacts to the active company's theme. Safe: variables fall
  // back to the defaults defined in global.css when unset.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const primary = activeCompany?.branding?.primaryColor?.trim();
    const accent = activeCompany?.branding?.accentColor?.trim();
    if (primary) root.style.setProperty("--company-primary", primary);
    else root.style.removeProperty("--company-primary");
    if (accent) root.style.setProperty("--company-accent", accent);
    else root.style.removeProperty("--company-accent");
    return () => {
      // Leave variables in place between route changes; they only flip when
      // the active company changes. Cleanup on unmount keeps the DOM clean.
      root.style.removeProperty("--company-primary");
      root.style.removeProperty("--company-accent");
    };
  }, [activeCompany?.branding?.primaryColor, activeCompany?.branding?.accentColor]);

  // Subscribe to the active company doc
  useEffect(() => {
    if (!activeCompanyId) {
      setActiveCompany(null);
      setCompanyLoading(false);
      return;
    }
    setCompanyLoading(true);
    const unsub = subscribeCompanyDoc(
      activeCompanyId,
      (next) => {
        setActiveCompany(next);
        setCompanyLoading(false);
      },
      (e) => {
        setError(e.message);
        setCompanyLoading(false);
      }
    );
    return unsub;
  }, [activeCompanyId]);

  // Subscribe to my membership in the active company
  useEffect(() => {
    if (!user || !activeCompanyId) {
      setMembership(null);
      setMemberLoading(false);
      return;
    }
    setMemberLoading(true);
    const unsub = subscribeCompanyMember(
      activeCompanyId,
      user.uid,
      (next) => {
        setMembership(next);
        setMemberLoading(false);
      },
      (e) => {
        setError(e.message);
        setMemberLoading(false);
      }
    );
    return unsub;
  }, [user?.uid, activeCompanyId]);

  const refresh = useCallback(() => {
    setMembershipsVersion((v) => v + 1);
  }, []);

  const switchCompanyRef = useRef<CompanyContextValue["switchCompany"] | null>(null);
  switchCompanyRef.current = async (companyId: string) => {
    if (!user) throw new Error("Not signed in");
    await setUserActiveCompany(user.uid, companyId);
  };

  const value = useMemo<CompanyContextValue>(() => {
    const role: CompanyRole | null = membership?.role ?? null;
    const permissions = role
      ? resolvePermissions(role, membership?.permissions ?? null)
      : EMPTY_PERMISSIONS;

    const hasActiveSeat = Boolean(
      membership &&
        membership.status === "active" &&
        (membership.seatStatus === "active" ||
          membership.seatStatus === "exempt")
    );

    const billingStatus = activeCompany?.billing?.status;
    const hasAllowedBillingStatus = Boolean(
      billingStatus &&
        (billingStatus === "trialing" ||
          billingStatus === "active" ||
          billingStatus === "internal_dev")
    );

    // Owners/admins are allowed to reach the billing page even when their
    // subscription is broken so they can fix it. `RequireActiveSubscription`
    // consumes this flag.
    const isBillingFixable = Boolean(
      billingStatus &&
        (billingStatus === "past_due" ||
          billingStatus === "incomplete" ||
          billingStatus === "unpaid" ||
          billingStatus === "canceled" ||
          billingStatus === "none")
    );

    const loading =
      authLoading ||
      userDocLoading ||
      membershipsLoading ||
      companyLoading ||
      memberLoading;

    const hasCompany = Boolean(activeCompanyId);

    const canAccessApp =
      !loading &&
      Boolean(user) &&
      hasCompany &&
      Boolean(membership) &&
      hasActiveSeat &&
      hasAllowedBillingStatus;

    return {
      userDoc,
      activeCompany,
      activeCompanyId,
      membership,
      role,
      memberships,
      loading,
      error,
      hasCompany,
      hasActiveSeat,
      hasAllowedBillingStatus,
      isBillingFixable,
      canAccessApp,
      permissions,
      switchCompany: (id: string) => {
        const fn = switchCompanyRef.current;
        if (!fn) throw new Error("switchCompany not ready");
        return fn(id);
      },
      refresh,
    };
  }, [
    userDoc,
    activeCompany,
    activeCompanyId,
    membership,
    memberships,
    authLoading,
    userDocLoading,
    membershipsLoading,
    companyLoading,
    memberLoading,
    error,
    user,
    refresh,
  ]);

  return (
    <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
  );
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within <CompanyProvider>");
  return ctx;
}
