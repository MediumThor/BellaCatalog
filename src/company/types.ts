import type { Timestamp } from "firebase/firestore";
import type { LayoutQuoteSettings } from "../types/compareQuote";

/**
 * Company + membership types for the BellaCatalog SaaS refactor.
 *
 * See `docs/saas-refactor/20_firebase_schema.md` for the full schema and
 * `docs/saas-refactor/05_ownership_clarification.md` for the global-vs-company
 * ownership rule.
 */

export type CompanyRole = "owner" | "admin" | "manager" | "sales" | "viewer";

export type CompanyBillingStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid"
  | "none"
  /**
   * Internal / dev-only state. Grants app access without a Stripe subscription.
   * Used for BellaCatalog staff and companies provisioned before the paid
   * launch. Only set via admin tooling / Cloud Functions.
   */
  | "internal_dev";

export type CompanyMembershipStatus =
  | "invited"
  | "active"
  | "disabled"
  | "removed";

export type CompanySeatStatus = "active" | "pending" | "disabled" | "exempt";

export interface CompanyBranding {
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  quoteHeaderText?: string | null;
  quoteFooterText?: string | null;
}

export interface CompanyAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface CompanyRegion {
  country: string;
  states: string[];
  serviceAreaLabel?: string;
}

export interface CompanyBilling {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status: CompanyBillingStatus;
  planId?: string | null;
  /** Seats paid for through Stripe (`items[0].quantity`). */
  seatLimit: number;
  /** Extra seats gifted by BellaCatalog staff via the admin panel. */
  bonusSeats?: number;
  activeSeatCount: number;
  trialEndsAt?: Timestamp | null;
  currentPeriodEnd?: Timestamp | null;
  /**
   * Whether the Stripe subscription is set to cancel at the end of the
   * current period. Mirrored here so the billing UI can warn owners
   * without having to call Stripe.
   */
  cancelAtPeriodEnd?: boolean;
  /**
   * Free-form note from a platform admin attached to the last billing
   * change (e.g. "Gifted 2 seats — promo for Q1"). Shown in the Billing
   * page so the owner can see why they were upgraded.
   */
  adminNote?: string | null;
}

/**
 * The total seats a company is allowed to consume = Stripe quantity +
 * gifted seats. Kept here so both the client and Cloud Functions use the
 * same formula.
 */
export function effectiveSeatLimit(billing: CompanyBilling | null | undefined): number {
  if (!billing) return 0;
  const paid = Math.max(0, billing.seatLimit ?? 0);
  const bonus = Math.max(0, billing.bonusSeats ?? 0);
  return paid + bonus;
}

export interface CommissionSplitSetting {
  /** 0..1. Sums with `onFinalPayment` to 1. */
  onDeposit: number;
  onFinalPayment: number;
}

/**
 * Company-defined sink cutout the team can pick from the Layout Studio
 * "Add sink" modal. Custom templates are layered on top of the built-in
 * `kitchen` / `vanitySquare` / `vanityRound` catalog and persist on
 * `companies/{id}.settings.customSinkTemplates`.
 *
 * Each template carries its own per-cut price so it flows directly into
 * the commercial quote. When a sink is placed, the template's dimensions
 * AND its price are snapshotted onto the `PieceSinkCutout` so historical
 * jobs are not affected by later edits or deletions of the template.
 */
export interface CustomSinkTemplate {
  /** Stable id (random uuid). Used as `PieceSinkCutout.templateKind` lookup key. */
  id: string;
  name: string;
  shape: "rectangle" | "oval";
  widthIn: number;
  depthIn: number;
  /** Ignored when `shape === "oval"`. */
  cornerRadiusIn: number;
  /** Per-cut price added to the commercial quote (USD). */
  priceUsd: number;
  /** ISO timestamp; informational only. */
  createdAt?: string;
  /** uid of the member who created it; informational only. */
  createdByUserId?: string | null;
}

/**
 * The catalog kinds the Layout Studio always offers (kitchen, vanity
 * square, vanity round). Mirrored from
 * `compare/layoutStudio/types.ts → PieceSinkTemplateKind`; kept as a
 * plain string union here to avoid pulling Layout Studio types into the
 * shared company schema.
 */
export type BuiltinSinkKind = "kitchen" | "vanityRound" | "vanitySquare";

/**
 * Per-company override of a built-in sink template's dimensions and per-cut
 * price. Built-ins always exist for every company, but each company can
 * tune the defaults (e.g. a shop that always cuts a 32×18 kitchen sink at
 * $125). Edits ONLY affect new placements — existing `PieceSinkCutout`s
 * snapshot their dims + price at placement time so historical jobs stay
 * intact.
 */
export interface BuiltinSinkOverride {
  widthIn: number;
  depthIn: number;
  /** Ignored for `vanityRound` (oval). */
  cornerRadiusIn: number;
  /** Per-cut price added to the commercial quote (USD). */
  priceUsd: number;
  /** ISO timestamp; informational only. */
  updatedAt?: string;
  /** uid of the member who last edited it; informational only. */
  updatedByUserId?: string | null;
}

export interface CompanySettings {
  defaultHidePrices: boolean;
  allowCompanyCollections: boolean;
  allowUserUploadedImages: boolean;
  requireImportReviewBeforePublish: boolean;
  /** Commission tracker defaults. Added in the commission-tracker rollout. */
  defaultCommissionSplit?: CommissionSplitSetting | null;
  /**
   * Company-defined sink cutout templates. Layered on top of the
   * built-in templates in the Layout Studio "Add sink" modal. Each
   * template carries its own per-cut price.
   */
  customSinkTemplates?: CustomSinkTemplate[] | null;
  /**
   * Per-company overrides for the three built-in sink templates
   * (kitchen / vanitySquare / vanityRound). When set, the override's
   * dims and per-cut price replace the catalog defaults for new
   * placements; absent kinds fall back to the built-in defaults.
   * Already-placed sinks keep the dims + price snapshotted at
   * placement time.
   */
  builtinSinkOverrides?: Partial<Record<BuiltinSinkKind, BuiltinSinkOverride>> | null;
  /**
   * Default deposit percent (0..100) prefilled when generating a new
   * quote. Sales reps can still override per-job in the Layout quote
   * modal. Stored as a percentage value to match the per-job
   * `requiredDepositPercent` field on `JobRecord`.
   */
  defaultRequiredDepositPercent?: number | null;
  /**
   * Company-wide defaults for Layout Studio quote pricing knobs
   * (markup, install $/sqft, splash $/lf, etc.). Used as fallbacks
   * when a job has not explicitly set its own value. Sales reps can
   * still override per-job from the Layout Studio quote tab.
   */
  defaultLayoutQuoteSettings?: Partial<LayoutQuoteSettings> | null;
  /**
   * When true, commission is computed on the tax-inclusive total. Most
   * shops leave this off so commissions come from pre-tax revenue.
   */
  commissionIncludesSalesTax?: boolean;
}

export interface CompanyDoc {
  id: string;
  name: string;
  legalName?: string;
  slug: string;
  branding: CompanyBranding;
  address?: CompanyAddress;
  region?: CompanyRegion;
  billing: CompanyBilling;
  settings: CompanySettings;
  createdByUserId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface CompanyMemberPermissions {
  canManageBilling?: boolean;
  canManageUsers?: boolean;
  canManageCatalog?: boolean;
  canPublishPriceBooks?: boolean;
  canCreateJobs?: boolean;
  canViewPrices?: boolean;
}

export interface CompanyMemberDoc {
  userId: string;
  companyId: string;
  email: string;
  displayName: string;
  role: CompanyRole;
  status: CompanyMembershipStatus;
  seatStatus: CompanySeatStatus;
  consumesSeat: boolean;
  permissions?: CompanyMemberPermissions;
  invitedByUserId?: string | null;
  joinedAt?: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  /**
   * Flat % (0..100) this member earns on jobs assigned to them. `null` means
   * not commissionable. Writable only by owner/admin (enforced in rules).
   */
  commissionPercent?: number | null;
  /** Override for this member; falls back to company default. */
  commissionSplit?: CommissionSplitSetting | null;
}

export interface UserDoc {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  defaultCompanyId?: string | null;
  activeCompanyId?: string | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastLoginAt?: Timestamp | null;
}

/**
 * BellaCatalog staff record. Presence of a doc at
 * `platformAdmins/{uid}` grants the user access to the `/admin` panel
 * and read access across every company via Firestore rules. Writes
 * performed from the admin panel still go through Cloud Functions so
 * they can be audited.
 */
export interface PlatformAdminDoc {
  uid: string;
  email: string;
  displayName?: string | null;
  addedByUserId?: string | null;
  addedAt?: Timestamp | null;
  notes?: string | null;
}

/** One row in `adminAuditLog`. Written by every admin Cloud Function. */
export interface AdminAuditEntry {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action:
    | "setCompanyBilling"
    | "setMemberSeatStatus"
    | "transferOwnership"
    | "forceCancelSubscription"
    | "resumeSubscription"
    | "setMemberStatus"
    | "other";
  targetCompanyId?: string | null;
  targetUserId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  at: Timestamp | null;
}

export interface ResolvedPermissions {
  canManageBilling: boolean;
  canManageUsers: boolean;
  canManageCatalog: boolean;
  canPublishPriceBooks: boolean;
  canCreateJobs: boolean;
  canViewPrices: boolean;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<CompanyRole, ResolvedPermissions> = {
  owner: {
    canManageBilling: true,
    canManageUsers: true,
    canManageCatalog: true,
    canPublishPriceBooks: true,
    canCreateJobs: true,
    canViewPrices: true,
  },
  admin: {
    canManageBilling: true,
    canManageUsers: true,
    canManageCatalog: true,
    canPublishPriceBooks: true,
    canCreateJobs: true,
    canViewPrices: true,
  },
  manager: {
    canManageBilling: false,
    canManageUsers: false,
    canManageCatalog: true,
    canPublishPriceBooks: true,
    canCreateJobs: true,
    canViewPrices: true,
  },
  sales: {
    canManageBilling: false,
    canManageUsers: false,
    canManageCatalog: false,
    canPublishPriceBooks: false,
    canCreateJobs: true,
    canViewPrices: true,
  },
  viewer: {
    canManageBilling: false,
    canManageUsers: false,
    canManageCatalog: false,
    canPublishPriceBooks: false,
    canCreateJobs: false,
    canViewPrices: false,
  },
};

export function resolvePermissions(
  role: CompanyRole,
  overrides?: CompanyMemberPermissions | null
): ResolvedPermissions {
  const base = DEFAULT_ROLE_PERMISSIONS[role];
  if (!overrides) return base;
  return {
    canManageBilling: overrides.canManageBilling ?? base.canManageBilling,
    canManageUsers: overrides.canManageUsers ?? base.canManageUsers,
    canManageCatalog: overrides.canManageCatalog ?? base.canManageCatalog,
    canPublishPriceBooks:
      overrides.canPublishPriceBooks ?? base.canPublishPriceBooks,
    canCreateJobs: overrides.canCreateJobs ?? base.canCreateJobs,
    canViewPrices: overrides.canViewPrices ?? base.canViewPrices,
  };
}
