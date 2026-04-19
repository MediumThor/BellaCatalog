/**
 * Pure helpers that turn raw Firestore docs (jobs, options, payments,
 * commission ledger) into the aggregate metrics surfaced on the Stats
 * page and shipped to the AI assistant as structured context.
 *
 * Everything here is intentionally side-effect free so the page can
 * recompute the entire dashboard with `useMemo` whenever a snapshot
 * arrives, and so the AI prompt builder can call the same helpers.
 */

import type {
  JobComparisonOptionRecord,
  JobRecord,
  JobStatus,
} from "../types/compareQuote";
import {
  CANONICAL_JOB_STATUSES,
  jobAreasForJob,
  normalizeJobStatus,
} from "../types/compareQuote";
import type {
  CommissionLedgerEntry,
  JobPaymentRecord,
} from "../types/commission";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type StatsPeriod =
  | "this_month"
  | "last_month"
  | "qtd"
  | "ytd"
  | "all";

export interface StatsRange {
  /** ISO timestamp inclusive lower bound. "" means open. */
  fromIso: string;
  /** ISO timestamp inclusive upper bound. "" means open. */
  toIso: string;
  /** "YYYY-MM" form for ledger period filtering. */
  fromPeriod: string;
  toPeriod: string;
}

export function periodLabel(p: StatsPeriod): string {
  switch (p) {
    case "this_month":
      return "This month";
    case "last_month":
      return "Last month";
    case "qtd":
      return "Quarter to date";
    case "ytd":
      return "Year to date";
    case "all":
      return "All time";
  }
}

/** Resolve a {@link StatsPeriod} into ISO + YYYY-MM ranges (UTC). */
export function periodRange(p: StatsPeriod, now = new Date()): StatsRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const fmtMonth = (yr: number, mo: number) =>
    `${yr}-${String(mo + 1).padStart(2, "0")}`;
  const startOfMonth = (yr: number, mo: number) =>
    new Date(Date.UTC(yr, mo, 1)).toISOString();
  const endOfMonth = (yr: number, mo: number) =>
    new Date(Date.UTC(yr, mo + 1, 0, 23, 59, 59, 999)).toISOString();
  const startOfYear = (yr: number) =>
    new Date(Date.UTC(yr, 0, 1)).toISOString();
  switch (p) {
    case "this_month":
      return {
        fromIso: startOfMonth(y, m),
        toIso: endOfMonth(y, m),
        fromPeriod: fmtMonth(y, m),
        toPeriod: fmtMonth(y, m),
      };
    case "last_month": {
      const lm = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
      return {
        fromIso: startOfMonth(lm.y, lm.m),
        toIso: endOfMonth(lm.y, lm.m),
        fromPeriod: fmtMonth(lm.y, lm.m),
        toPeriod: fmtMonth(lm.y, lm.m),
      };
    }
    case "qtd": {
      const qStart = Math.floor(m / 3) * 3;
      return {
        fromIso: startOfMonth(y, qStart),
        toIso: endOfMonth(y, m),
        fromPeriod: fmtMonth(y, qStart),
        toPeriod: fmtMonth(y, m),
      };
    }
    case "ytd":
      return {
        fromIso: startOfYear(y),
        toIso: endOfMonth(y, m),
        fromPeriod: fmtMonth(y, 0),
        toPeriod: fmtMonth(y, m),
      };
    case "all":
    default:
      return {
        fromIso: "",
        toIso: "",
        fromPeriod: "0000-00",
        toPeriod: "9999-12",
      };
  }
}

// ---------------------------------------------------------------------------
// Per-job derived values
// ---------------------------------------------------------------------------

/**
 * Pull the option ids the customer has approved across this job's areas.
 * Falls back to the legacy single-area `finalOptionId` when no areas
 * declare an approval yet.
 */
function approvedOptionIdsForJob(job: JobRecord): string[] {
  const areas = jobAreasForJob(job);
  const ids = new Set<string>();
  for (const a of areas) {
    if (a.selectedOptionId) ids.add(a.selectedOptionId);
  }
  if (ids.size === 0 && job.finalOptionId) ids.add(job.finalOptionId);
  return [...ids];
}

/**
 * Sum every layout-derived numeric attribute on the *approved* options
 * for this job. When no option is approved we fall back to the option
 * with the largest layoutEstimatedAreaSqFt (i.e. the most-developed
 * quote candidate) so quote-stage jobs still contribute to "sq ft
 * quoted" totals.
 */
export interface JobLayoutRollup {
  areaSqFt: number;
  finishedEdgeLf: number;
  profileLf: number;
  miterLf: number;
  splashLf: number;
  splashCount: number;
  sinkCount: number;
  slabCount: number;
  estimatedMaterialCost: number;
}

function emptyLayoutRollup(): JobLayoutRollup {
  return {
    areaSqFt: 0,
    finishedEdgeLf: 0,
    profileLf: 0,
    miterLf: 0,
    splashLf: 0,
    splashCount: 0,
    sinkCount: 0,
    slabCount: 0,
    estimatedMaterialCost: 0,
  };
}

function addOptionToRollup(
  rollup: JobLayoutRollup,
  option: JobComparisonOptionRecord
): void {
  /**
   * Multi-area jobs persist per-area metrics on `layoutAreaStates`;
   * single-area legacy jobs put the same numbers at the option root.
   * Prefer the per-area sum when present so we don't double-count an
   * option that has both shapes populated.
   */
  const areaStates = option.layoutAreaStates;
  if (areaStates && Object.keys(areaStates).length > 0) {
    for (const state of Object.values(areaStates)) {
      if (!state) continue;
      rollup.areaSqFt += num(state.layoutEstimatedAreaSqFt);
      rollup.finishedEdgeLf += num(state.layoutEstimatedFinishedEdgeLf);
      rollup.profileLf += num(state.layoutProfileLf);
      rollup.miterLf += num(state.layoutMiterLf);
      rollup.splashLf += num(state.layoutSplashLf);
      rollup.splashCount += num(state.layoutSplashCount);
      rollup.sinkCount += num(state.layoutSinkCount);
      rollup.slabCount += num(state.layoutEstimatedSlabCount);
    }
  } else {
    rollup.areaSqFt += num(option.layoutEstimatedAreaSqFt);
    rollup.finishedEdgeLf += num(option.layoutEstimatedFinishedEdgeLf);
    rollup.profileLf += num(option.layoutProfileLf);
    rollup.miterLf += num(option.layoutMiterLf);
    rollup.splashLf += num(option.layoutSplashLf);
    rollup.splashCount += num(option.layoutSplashCount);
    rollup.sinkCount += num(option.layoutSinkCount);
    rollup.slabCount += num(option.layoutEstimatedSlabCount);
  }
  rollup.estimatedMaterialCost += num(option.estimatedMaterialCost);
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Coarse material categories used for cross-cutting analytics
 * ("granite vs quartz margin"). We keyword-match on the option's
 * `material` field plus the product / vendor strings as a fallback so
 * mis-keyed entries (e.g. material left blank but product name says
 * "Calacatta Quartz") still classify cleanly. Order matters:
 * `quartzite` must be checked before `quartz`.
 */
export type MaterialCategory =
  | "granite"
  | "quartz"
  | "quartzite"
  | "marble"
  | "dolomite"
  | "soapstone"
  | "porcelain"
  | "onyx"
  | "travertine"
  | "limestone"
  | "other";

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  granite: "Granite",
  quartz: "Quartz",
  quartzite: "Quartzite",
  marble: "Marble",
  dolomite: "Dolomite",
  soapstone: "Soapstone",
  porcelain: "Porcelain",
  onyx: "Onyx",
  travertine: "Travertine",
  limestone: "Limestone",
  other: "Other / Unknown",
};

/**
 * Best-effort classifier. We scan the joined `material + product + vendor`
 * string (lowercased) for the first matching keyword. The order in
 * `MATERIAL_KEYWORDS` is significant — `quartzite` must come before
 * `quartz` so a quartzite slab isn't misfiled as quartz.
 */
const MATERIAL_KEYWORDS: Array<[MaterialCategory, string[]]> = [
  ["quartzite", ["quartzite"]],
  ["quartz", ["quartz", "engineered stone"]],
  ["granite", ["granite"]],
  ["dolomite", ["dolomite"]],
  ["marble", ["marble"]],
  ["soapstone", ["soapstone"]],
  ["porcelain", ["porcelain", "sintered"]],
  ["onyx", ["onyx"]],
  ["travertine", ["travertine"]],
  ["limestone", ["limestone"]],
];

export function classifyMaterialCategory(
  option: Pick<
    JobComparisonOptionRecord,
    "material" | "productName" | "vendor" | "manufacturer"
  > | null | undefined
): MaterialCategory {
  if (!option) return "other";
  const haystack = [
    option.material ?? "",
    option.productName ?? "",
    option.manufacturer ?? "",
    option.vendor ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (!haystack.trim()) return "other";
  for (const [cat, keywords] of MATERIAL_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

/**
 * Roll a job's options into the production metrics surfaced on the
 * Stats page. Pass the prebuilt `optionsByJob` map so we don't filter
 * the global options array per call.
 */
export function rollupJobLayout(
  job: JobRecord,
  optionsByJob: Record<string, JobComparisonOptionRecord[]>
): JobLayoutRollup {
  const opts = optionsByJob[job.id] ?? [];
  if (opts.length === 0) return emptyLayoutRollup();
  const approvedIds = new Set(approvedOptionIdsForJob(job));
  const out = emptyLayoutRollup();
  if (approvedIds.size > 0) {
    for (const opt of opts) {
      if (approvedIds.has(opt.id)) addOptionToRollup(out, opt);
    }
    if (out.areaSqFt > 0 || out.estimatedMaterialCost > 0) return out;
  }
  /**
   * No approved option (or the approved option carries no layout
   * metrics) — fall back to the option whose layout is furthest along
   * so quote-stage jobs still report sq ft / profile LF.
   */
  let best: JobComparisonOptionRecord | null = null;
  let bestArea = -1;
  for (const opt of opts) {
    const a = num(opt.layoutEstimatedAreaSqFt);
    if (a > bestArea) {
      bestArea = a;
      best = opt;
    }
  }
  if (best) addOptionToRollup(out, best);
  return out;
}

/**
 * Pick the option that best represents the material for this job.
 * We prefer the customer-approved option (single-area: `finalOptionId`;
 * multi-area: pick the approved option with the largest layout area
 * so the "primary" material wins on a multi-room job). When nothing
 * is approved yet — i.e. the job is still in quote — fall back to the
 * most-developed candidate (largest `layoutEstimatedAreaSqFt`) so we
 * still surface a credible material on stats / leaderboard rows.
 */
export function primaryOptionForJob(
  job: JobRecord,
  optionsByJob: Record<string, JobComparisonOptionRecord[]>
): JobComparisonOptionRecord | null {
  const opts = optionsByJob[job.id] ?? [];
  if (opts.length === 0) return null;
  const approvedIds = new Set(approvedOptionIdsForJob(job));
  if (approvedIds.size > 0) {
    let bestApproved: JobComparisonOptionRecord | null = null;
    let bestArea = -1;
    for (const opt of opts) {
      if (!approvedIds.has(opt.id)) continue;
      const a = num(opt.layoutEstimatedAreaSqFt);
      if (a > bestArea) {
        bestArea = a;
        bestApproved = opt;
      }
    }
    if (bestApproved) return bestApproved;
  }
  let best: JobComparisonOptionRecord | null = null;
  let bestArea = -1;
  for (const opt of opts) {
    const a = num(opt.layoutEstimatedAreaSqFt);
    if (a > bestArea) {
      bestArea = a;
      best = opt;
    }
  }
  return best ?? opts[0];
}

/** Authoritative quoted total or 0. */
export function jobQuotedTotal(job: JobRecord): number {
  return num(job.quotedTotal);
}

/** Required deposit minus collected deposit, never negative. */
export function jobUnpaidDeposit(job: JobRecord): number {
  const required = num(job.requiredDepositAmount);
  if (required <= 0) return 0;
  const received = num(job.depositReceivedTotal);
  const due = required - received;
  return due > 0 ? due : 0;
}

/**
 * Outstanding final balance after the deposit. We subtract the deposit
 * portion so a job in "quote" doesn't double-count its required deposit
 * against both the deposit-due and balance-due metrics.
 */
export function jobBalanceDue(job: JobRecord): number {
  if (typeof job.balanceDue === "number" && Number.isFinite(job.balanceDue)) {
    return Math.max(0, job.balanceDue);
  }
  const total = jobQuotedTotal(job);
  if (total <= 0) return 0;
  const paid = num(job.paidTotal);
  return Math.max(0, total - paid);
}

/**
 * Approximate gross profit for a job: quoted total minus the rolled-up
 * material cost on the approved option(s). We don't have a separate
 * fabrication-cost ledger so this is a "material margin" — surfaced as
 * such in the UI tooltip. Returns null when we have no quoted total or
 * no material cost basis.
 */
export interface JobMargin {
  quotedTotal: number;
  materialCost: number;
  grossProfit: number;
  /** 0..100 (percent). */
  marginPct: number | null;
}

export function jobMargin(
  job: JobRecord,
  optionsByJob: Record<string, JobComparisonOptionRecord[]>
): JobMargin | null {
  const total = jobQuotedTotal(job);
  if (total <= 0) return null;
  const rollup = rollupJobLayout(job, optionsByJob);
  const cost = rollup.estimatedMaterialCost;
  const profit = total - cost;
  const pct = total > 0 ? (profit / total) * 100 : null;
  return {
    quotedTotal: total,
    materialCost: cost,
    grossProfit: profit,
    marginPct: pct,
  };
}

// ---------------------------------------------------------------------------
// Aging helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBetween(aIso: string, bIso: string): number | null {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, (b - a) / MS_PER_DAY);
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / MS_PER_DAY);
}

/**
 * Decide whether a job's `createdAt` (or `statusChangedAt`) falls
 * inside the chosen period. We bias toward `updatedAt` since it
 * captures the most recent activity and lines up with what the rep
 * intuitively means by "this month's pipeline".
 */
function jobInPeriod(job: JobRecord, range: StatsRange): boolean {
  if (!range.fromIso && !range.toIso) return true;
  const stamp = job.updatedAt || job.createdAt;
  if (!stamp) return true;
  if (range.fromIso && stamp < range.fromIso) return false;
  if (range.toIso && stamp > range.toIso) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

export interface PipelineRow {
  status: JobStatus;
  count: number;
  value: number;
}

export interface StatsSummary {
  /** All jobs scoped to the active company + (optionally) the rep filter. */
  totalJobs: number;
  /** Subset of {@link totalJobs} that fell inside the chosen period. */
  periodJobs: number;
  totalQuotedValue: number;
  totalRevenueCollected: number;
  totalDepositsCollected: number;
  unpaidDepositsTotal: number;
  outstandingFinalsTotal: number;
  outstandingQuotesValue: number;
  outstandingQuotesCount: number;
  /** Total sq ft across all approved (or candidate) layouts. */
  totalSqFtQuoted: number;
  /** Total sq ft on jobs that reached `installed` or `complete`. */
  totalSqFtInstalled: number;
  totalProfileLfInstalled: number;
  totalMiterLfInstalled: number;
  totalSplashLfInstalled: number;
  totalSlabsInstalled: number;
  totalSinksInstalled: number;
  totalCommissionEarned: number;
  averageJobValue: number;
  averageMarginPct: number | null;
  marginAbove75Count: number;
  marginAbove50Count: number;
  /** Quotes created more than 30 days ago and still in `quote` status. */
  staleQuotesCount: number;
  staleQuotesValue: number;
  /** Approved jobs (active/installed) that have been open >90 days. */
  staleApprovedCount: number;
  staleApprovedValue: number;
  /** Avg days `draft → quote` for jobs that reached at least quote. */
  avgDaysCreatedToQuote: number | null;
  /** Avg days `quote → active` for jobs that reached at least active. */
  avgDaysQuoteToActive: number | null;
  /** Avg days `installed → complete` for completed jobs. */
  avgDaysInstalledToComplete: number | null;
  /** Avg days end-to-end for completed jobs. */
  avgDaysCreatedToComplete: number | null;
  /** Quote → Active conversion rate (0..1). */
  quoteToActiveRate: number | null;
  /** Active → Complete conversion rate (0..1). */
  activeToCompleteRate: number | null;
  /** Win rate vs cancelled (complete / (complete + cancelled)). */
  winRate: number | null;
  /**
   * Cross-cutting "material category" rollup. The Stats AI uses this
   * to answer questions like "what's our average margin on quartz vs
   * granite?" without having to re-scan the job rows.
   */
  byMaterialCategory: MaterialCategoryStats[];
}

export interface MaterialCategoryStats {
  category: MaterialCategory;
  jobs: number;
  quotedValue: number;
  paidValue: number;
  sqFt: number;
  materialCost: number;
  /** Average margin pct across jobs that have one (0..100). */
  averageMarginPct: number | null;
  marginAbove50Count: number;
  marginAbove75Count: number;
  installedSqFt: number;
  installedSlabs: number;
  /** Top 3 product names within the category (most jobs). */
  topProducts: Array<{ productName: string; jobs: number }>;
}

export interface StatsBundle {
  range: StatsRange;
  summary: StatsSummary;
  pipeline: PipelineRow[];
  perRep: Array<{
    userId: string;
    quotedValue: number;
    activeJobs: number;
    completedJobs: number;
    cancelledJobs: number;
    commissionEarned: number;
    jobs: number;
  }>;
  topCustomers: Array<{
    customerId: string;
    jobs: number;
    quotedValue: number;
  }>;
  monthlyCommissionByUser: Record<string, Record<string, number>>;
  months: string[];
  /**
   * Per-job data shaped for the AI assistant prompt. Stays compact:
   * one short row per job with the essentials so we can include up to
   * the model context window.
   */
  jobRows: Array<{
    id: string;
    name: string;
    customerId: string;
    status: JobStatus;
    assignedUserId: string | null;
    quotedTotal: number;
    paidTotal: number;
    depositReceived: number;
    requiredDeposit: number;
    balanceDue: number;
    sqFt: number;
    profileLf: number;
    materialCost: number;
    marginPct: number | null;
    /** Coarse classification (granite, quartz, …) for the primary option. */
    materialCategory: MaterialCategory;
    /** Raw material string from the primary option (e.g. "Quartzite"). */
    material: string | null;
    /** Vendor / supplier on the primary option (e.g. "MSI"). */
    vendor: string | null;
    /** Product / color name on the primary option (e.g. "Calacatta Gold"). */
    productName: string | null;
    /** Slab thickness label (e.g. "3cm"). */
    thickness: string | null;
    createdAt: string;
    updatedAt: string;
    statusChangedAt: string | null;
    approvedQuoteAt: string | null;
    installedAt: string | null;
    completedAt: string | null;
    daysSinceCreated: number | null;
    daysSinceApproved: number | null;
  }>;
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function buildStatsBundle(input: {
  jobs: JobRecord[];
  options: JobComparisonOptionRecord[];
  payments: JobPaymentRecord[];
  ledger: CommissionLedgerEntry[];
  range: StatsRange;
  /** When set, only jobs assigned to this user (and their rep slice) count. */
  filterUserId?: string | null;
  now?: Date;
}): StatsBundle {
  const { range, filterUserId } = input;
  const now = (input.now ?? new Date()).getTime();
  /**
   * Group the global options array by jobId once so we don't filter
   * for every aggregate calculation below. Profile/area/material rollups
   * touch the same map repeatedly.
   */
  const optionsByJob: Record<string, JobComparisonOptionRecord[]> = {};
  for (const opt of input.options) {
    (optionsByJob[opt.jobId] ??= []).push(opt);
  }

  const repFiltered = filterUserId
    ? input.jobs.filter((j) => j.assignedUserId === filterUserId)
    : input.jobs;

  const periodJobs = repFiltered.filter((j) => jobInPeriod(j, range));

  // ---- Status pipeline ----------------------------------------------------
  const pipelineMap = new Map<JobStatus, PipelineRow>();
  for (const s of CANONICAL_JOB_STATUSES) {
    pipelineMap.set(s, { status: s, count: 0, value: 0 });
  }
  for (const j of repFiltered) {
    const s = normalizeJobStatus(j.status);
    const row = pipelineMap.get(s)!;
    row.count += 1;
    row.value += jobQuotedTotal(j);
  }
  const pipeline = [...pipelineMap.values()];

  // ---- Top-line totals ----------------------------------------------------
  let totalQuotedValue = 0;
  let totalRevenueCollected = 0;
  let totalDepositsCollected = 0;
  let unpaidDepositsTotal = 0;
  let outstandingFinalsTotal = 0;
  let outstandingQuotesValue = 0;
  let outstandingQuotesCount = 0;
  let totalSqFtQuoted = 0;
  let totalSqFtInstalled = 0;
  let totalProfileLfInstalled = 0;
  let totalMiterLfInstalled = 0;
  let totalSplashLfInstalled = 0;
  let totalSlabsInstalled = 0;
  let totalSinksInstalled = 0;
  let staleQuotesCount = 0;
  let staleQuotesValue = 0;
  let staleApprovedCount = 0;
  let staleApprovedValue = 0;
  let marginAbove75Count = 0;
  let marginAbove50Count = 0;
  const marginPcts: Array<number | null> = [];
  const daysCreatedToQuote: Array<number | null> = [];
  const daysQuoteToActive: Array<number | null> = [];
  const daysInstalledToComplete: Array<number | null> = [];
  const daysCreatedToComplete: Array<number | null> = [];

  const perCustomer = new Map<
    string,
    { customerId: string; jobs: number; quotedValue: number }
  >();
  const perRep = new Map<
    string,
    {
      userId: string;
      quotedValue: number;
      activeJobs: number;
      completedJobs: number;
      cancelledJobs: number;
      commissionEarned: number;
      jobs: number;
    }
  >();

  let quoteOrLaterCount = 0;
  let activeOrLaterCount = 0;
  let completeCount = 0;
  let cancelledCount = 0;

  /**
   * Per-category accumulators. We track everything needed to surface
   * "granite vs quartz" style comparisons in the AI prompt: counts,
   * dollars, sq ft, and per-category margin pcts (averaged at the end
   * via {@link avg}). `productCounts` lets us name the top 3 products
   * in each bucket without a second pass.
   */
  type CategoryAcc = {
    category: MaterialCategory;
    jobs: number;
    quotedValue: number;
    paidValue: number;
    sqFt: number;
    materialCost: number;
    marginPcts: Array<number | null>;
    marginAbove50Count: number;
    marginAbove75Count: number;
    installedSqFt: number;
    installedSlabs: number;
    productCounts: Map<string, number>;
  };
  const byCategoryAcc = new Map<MaterialCategory, CategoryAcc>();
  const ensureCategory = (category: MaterialCategory): CategoryAcc => {
    let acc = byCategoryAcc.get(category);
    if (!acc) {
      acc = {
        category,
        jobs: 0,
        quotedValue: 0,
        paidValue: 0,
        sqFt: 0,
        materialCost: 0,
        marginPcts: [],
        marginAbove50Count: 0,
        marginAbove75Count: 0,
        installedSqFt: 0,
        installedSlabs: 0,
        productCounts: new Map(),
      };
      byCategoryAcc.set(category, acc);
    }
    return acc;
  };

  const jobRows: StatsBundle["jobRows"] = [];

  for (const job of repFiltered) {
    const status = normalizeJobStatus(job.status);
    const total = jobQuotedTotal(job);
    if (status !== "cancelled") totalQuotedValue += total;
    totalRevenueCollected += num(job.paidTotal);
    totalDepositsCollected += num(job.depositReceivedTotal);

    const layout = rollupJobLayout(job, optionsByJob);
    if (status !== "cancelled") {
      totalSqFtQuoted += layout.areaSqFt;
    }
    if (status === "installed" || status === "complete") {
      totalSqFtInstalled += layout.areaSqFt;
      totalProfileLfInstalled += layout.profileLf;
      totalMiterLfInstalled += layout.miterLf;
      totalSplashLfInstalled += layout.splashLf;
      totalSlabsInstalled += layout.slabCount;
      totalSinksInstalled += layout.sinkCount;
    }

    if (status === "quote") {
      outstandingQuotesValue += total;
      outstandingQuotesCount += 1;
      const ageDays = daysSince(job.createdAt, now);
      if (ageDays != null && ageDays > 30) {
        staleQuotesCount += 1;
        staleQuotesValue += total;
      }
    }

    if (status === "quote" || status === "active" || status === "installed") {
      unpaidDepositsTotal += jobUnpaidDeposit(job);
    }
    if (status === "active" || status === "installed") {
      outstandingFinalsTotal += jobBalanceDue(job);
    }

    if (
      (status === "active" || status === "installed") &&
      job.approvedQuoteAt
    ) {
      const ageDays = daysSince(job.approvedQuoteAt, now);
      if (ageDays != null && ageDays > 90) {
        staleApprovedCount += 1;
        staleApprovedValue += total;
      }
    }

    const margin = jobMargin(job, optionsByJob);
    if (margin?.marginPct != null) {
      marginPcts.push(margin.marginPct);
      if (margin.marginPct >= 75) marginAbove75Count += 1;
      if (margin.marginPct >= 50) marginAbove50Count += 1;
    }

    // Lifecycle timing — only for jobs that crossed each gate.
    if (job.approvedQuoteAt) {
      daysCreatedToQuote.push(daysBetween(job.createdAt, job.approvedQuoteAt));
    }
    if (job.approvedQuoteAt && job.installedAt == null && status === "active") {
      // active jobs are post-deposit; treat statusChangedAt as the activation date
      const activatedAt = job.statusChangedAt ?? null;
      if (activatedAt) {
        daysQuoteToActive.push(daysBetween(job.approvedQuoteAt, activatedAt));
      }
    }
    if (job.approvedQuoteAt && job.installedAt) {
      daysQuoteToActive.push(daysBetween(job.approvedQuoteAt, job.installedAt));
    }
    if (job.installedAt && job.completedAt) {
      daysInstalledToComplete.push(daysBetween(job.installedAt, job.completedAt));
    }
    if (job.completedAt) {
      daysCreatedToComplete.push(daysBetween(job.createdAt, job.completedAt));
    }

    if (status !== "draft" && status !== "cancelled") quoteOrLaterCount += 1;
    if (
      status === "active" ||
      status === "installed" ||
      status === "complete"
    ) {
      activeOrLaterCount += 1;
    }
    if (status === "complete") completeCount += 1;
    if (status === "cancelled") cancelledCount += 1;

    // Per-customer rollup
    const c = perCustomer.get(job.customerId) ?? {
      customerId: job.customerId,
      jobs: 0,
      quotedValue: 0,
    };
    c.jobs += 1;
    if (status !== "cancelled") c.quotedValue += total;
    perCustomer.set(job.customerId, c);

    // Per-rep rollup
    const repId = job.assignedUserId ?? "_unassigned";
    const r = perRep.get(repId) ?? {
      userId: repId,
      quotedValue: 0,
      activeJobs: 0,
      completedJobs: 0,
      cancelledJobs: 0,
      commissionEarned: 0,
      jobs: 0,
    };
    r.jobs += 1;
    if (status !== "cancelled") r.quotedValue += total;
    if (status === "active" || status === "installed") r.activeJobs += 1;
    if (status === "complete") r.completedJobs += 1;
    if (status === "cancelled") r.cancelledJobs += 1;
    perRep.set(repId, r);

    /**
     * Material classification for this job. We only use the *primary*
     * approved option (or the most-developed candidate if nothing is
     * approved yet) so a single job lands in exactly one category —
     * otherwise multi-option quote-stage jobs would be triple-counted
     * in "granite vs quartz" totals.
     */
    const primaryOption = primaryOptionForJob(job, optionsByJob);
    const materialCategory = classifyMaterialCategory(primaryOption);
    const cat = ensureCategory(materialCategory);
    cat.jobs += 1;
    if (status !== "cancelled") {
      cat.quotedValue += total;
    }
    cat.paidValue += num(job.paidTotal);
    cat.sqFt += layout.areaSqFt;
    cat.materialCost += layout.estimatedMaterialCost;
    if (margin?.marginPct != null) {
      cat.marginPcts.push(margin.marginPct);
      if (margin.marginPct >= 50) cat.marginAbove50Count += 1;
      if (margin.marginPct >= 75) cat.marginAbove75Count += 1;
    }
    if (status === "installed" || status === "complete") {
      cat.installedSqFt += layout.areaSqFt;
      cat.installedSlabs += layout.slabCount;
    }
    if (primaryOption?.productName) {
      const key = primaryOption.productName.trim();
      if (key) {
        cat.productCounts.set(key, (cat.productCounts.get(key) ?? 0) + 1);
      }
    }

    jobRows.push({
      id: job.id,
      name: job.name,
      customerId: job.customerId,
      status,
      assignedUserId: job.assignedUserId ?? null,
      quotedTotal: total,
      paidTotal: num(job.paidTotal),
      depositReceived: num(job.depositReceivedTotal),
      requiredDeposit: num(job.requiredDepositAmount),
      balanceDue: jobBalanceDue(job),
      sqFt: layout.areaSqFt,
      profileLf: layout.profileLf,
      materialCost: layout.estimatedMaterialCost,
      marginPct: margin?.marginPct ?? null,
      materialCategory,
      material: primaryOption?.material ?? null,
      vendor: primaryOption?.vendor ?? null,
      productName: primaryOption?.productName ?? null,
      thickness: primaryOption?.thickness ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      statusChangedAt: job.statusChangedAt ?? null,
      approvedQuoteAt: job.approvedQuoteAt ?? null,
      installedAt: job.installedAt ?? null,
      completedAt: job.completedAt ?? null,
      daysSinceCreated: daysSince(job.createdAt, now),
      daysSinceApproved: daysSince(job.approvedQuoteAt ?? null, now),
    });
  }

  // ---- Commission totals --------------------------------------------------
  const repPeriodLedger = input.ledger.filter(
    (e) =>
      e.periodYearMonth >= range.fromPeriod &&
      e.periodYearMonth <= range.toPeriod &&
      (filterUserId ? e.userId === filterUserId : true)
  );
  let totalCommissionEarned = 0;
  for (const e of repPeriodLedger) totalCommissionEarned += e.amount;
  for (const e of repPeriodLedger) {
    const repId = e.userId || "_unassigned";
    const r = perRep.get(repId);
    if (!r) {
      perRep.set(repId, {
        userId: repId,
        quotedValue: 0,
        activeJobs: 0,
        completedJobs: 0,
        cancelledJobs: 0,
        commissionEarned: e.amount,
        jobs: 0,
      });
    } else {
      r.commissionEarned += e.amount;
    }
  }

  // ---- Monthly commission rollup (for chart) ------------------------------
  const monthlyCommissionByUser: Record<string, Record<string, number>> = {};
  const monthSet = new Set<string>();
  for (const e of repPeriodLedger) {
    monthSet.add(e.periodYearMonth);
    const byMonth = (monthlyCommissionByUser[e.userId] ??= {});
    byMonth[e.periodYearMonth] = (byMonth[e.periodYearMonth] ?? 0) + e.amount;
  }
  const months = [...monthSet].sort();

  // ---- Final summary ------------------------------------------------------
  const summary: StatsSummary = {
    totalJobs: repFiltered.length,
    periodJobs: periodJobs.length,
    totalQuotedValue,
    totalRevenueCollected,
    totalDepositsCollected,
    unpaidDepositsTotal,
    outstandingFinalsTotal,
    outstandingQuotesValue,
    outstandingQuotesCount,
    totalSqFtQuoted,
    totalSqFtInstalled,
    totalProfileLfInstalled,
    totalMiterLfInstalled,
    totalSplashLfInstalled,
    totalSlabsInstalled,
    totalSinksInstalled,
    totalCommissionEarned,
    averageJobValue: repFiltered.length
      ? totalQuotedValue / repFiltered.length
      : 0,
    averageMarginPct: avg(marginPcts),
    marginAbove75Count,
    marginAbove50Count,
    staleQuotesCount,
    staleQuotesValue,
    staleApprovedCount,
    staleApprovedValue,
    avgDaysCreatedToQuote: avg(daysCreatedToQuote),
    avgDaysQuoteToActive: avg(daysQuoteToActive),
    avgDaysInstalledToComplete: avg(daysInstalledToComplete),
    avgDaysCreatedToComplete: avg(daysCreatedToComplete),
    quoteToActiveRate: rate(activeOrLaterCount, quoteOrLaterCount),
    activeToCompleteRate: rate(completeCount, activeOrLaterCount),
    winRate: rate(completeCount, completeCount + cancelledCount),
    byMaterialCategory: [...byCategoryAcc.values()]
      .map<MaterialCategoryStats>((acc) => ({
        category: acc.category,
        jobs: acc.jobs,
        quotedValue: acc.quotedValue,
        paidValue: acc.paidValue,
        sqFt: acc.sqFt,
        materialCost: acc.materialCost,
        averageMarginPct: avg(acc.marginPcts),
        marginAbove50Count: acc.marginAbove50Count,
        marginAbove75Count: acc.marginAbove75Count,
        installedSqFt: acc.installedSqFt,
        installedSlabs: acc.installedSlabs,
        topProducts: [...acc.productCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([productName, jobs]) => ({ productName, jobs })),
      }))
      .sort((a, b) => b.quotedValue - a.quotedValue),
  };

  const topCustomers = [...perCustomer.values()]
    .sort((a, b) => b.quotedValue - a.quotedValue)
    .slice(0, 8);

  const perRepArr = [...perRep.values()].sort(
    (a, b) => b.quotedValue + b.commissionEarned - (a.quotedValue + a.commissionEarned)
  );

  // We deliberately drop quotedTotal noise out of the AI-facing rows
  // (the LLM works better with a flat array of jobs), but keep a hard
  // cap so prompts stay under context limits even on huge accounts.
  const cappedJobRows = jobRows
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 250);

  return {
    range,
    summary,
    pipeline,
    perRep: perRepArr,
    topCustomers,
    monthlyCommissionByUser,
    months,
    jobRows: cappedJobRows,
  };
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}

export function formatPercent(
  n: number | null | undefined,
  digits = 0
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatRate(
  n: number | null | undefined,
  digits = 0
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1) return "<1 day";
  return `${Math.round(n)} day${Math.round(n) === 1 ? "" : "s"}`;
}
