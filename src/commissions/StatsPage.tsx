/**
 * Company-wide Stats dashboard.
 *
 * - Replaces the old Commissions tab. Commission earnings are still
 *   surfaced (period totals, per-rep leaderboard, monthly trend), but
 *   are now one of many lenses on operations rather than the only one.
 * - Pulls every job + option + payment + ledger row for the active
 *   company so all metrics share a single source of truth and the AI
 *   assistant at the bottom can answer questions without an extra
 *   round-trip.
 * - Honors company scoping. Owners/admins see everything; sales /
 *   manager / viewer roles see only their own assigned jobs and ledger
 *   entries (mirrors the rules-enforced read scope).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { subscribeCompanyMembers } from "../company/teamFirestore";
import type { CompanyMemberDoc } from "../company/types";
import {
  subscribeAllJobsForCompany,
  subscribeAllOptionsForCompany,
  subscribeCustomers,
} from "../services/compareQuoteFirestore";
import {
  subscribeCompanyLedger,
  subscribeMyLedger,
} from "../services/commissionLedgerFirestore";
import { fetchPaymentsInRange } from "../services/jobPaymentsFirestore";
import type {
  CustomerRecord,
  JobComparisonOptionRecord,
  JobRecord,
  JobStatus,
} from "../types/compareQuote";
import {
  customerDisplayName,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABELS,
} from "../types/compareQuote";
import type {
  CommissionLedgerEntry,
  JobPaymentRecord,
} from "../types/commission";
import { formatMoney } from "../utils/priceHelpers";
import {
  buildStatsBundle,
  formatDays,
  formatNumber,
  formatPercent,
  formatRate,
  MATERIAL_CATEGORY_LABELS,
  periodLabel,
  periodRange,
  type StatsBundle,
  type StatsPeriod,
} from "./statsCompute";
import { StatsAssistant } from "./StatsAssistant";

export function StatsPage() {
  const { user } = useAuth();
  const { activeCompanyId, role } = useCompany();
  const isAdmin = role === "owner" || role === "admin";

  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [payments, setPayments] = useState<JobPaymentRecord[]>([]);
  const [ledger, setLedger] = useState<CommissionLedgerEntry[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [members, setMembers] = useState<CompanyMemberDoc[]>([]);
  const [period, setPeriod] = useState<StatsPeriod>("ytd");
  const [filterRep, setFilterRep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // ---- subscriptions ------------------------------------------------------

  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeAllJobsForCompany(
      activeCompanyId,
      (rows) => setJobs(rows),
      (e) => setError(e.message)
    );
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeAllOptionsForCompany(
      activeCompanyId,
      (rows) => setOptions(rows),
      (e) => setError(e.message)
    );
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeCustomers(
      activeCompanyId,
      (rows) => setCustomers(rows),
      (e) => setError(e.message)
    );
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    if (!isAdmin) {
      setMembers([]);
      return;
    }
    return subscribeCompanyMembers(
      activeCompanyId,
      (rows) => setMembers(rows),
      (e) => setError(e.message)
    );
  }, [activeCompanyId, isAdmin]);

  useEffect(() => {
    if (!activeCompanyId || !user) return;
    if (isAdmin) {
      return subscribeCompanyLedger(
        activeCompanyId,
        (rows) => setLedger(rows),
        (e) => setError(e.message)
      );
    }
    return subscribeMyLedger(
      user.uid,
      (rows) => setLedger(rows.filter((r) => r.companyId === activeCompanyId)),
      (e) => setError(e.message)
    );
  }, [activeCompanyId, user?.uid, isAdmin]);

  /**
   * Payments aren't streamed because the existing index supports a
   * range query (`receivedAt`) and the dashboard only needs them for
   * the period totals. Refetch when the active period or company
   * changes — the call is idempotent and capped at 2k rows.
   */
  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    const range = periodRange(period);
    fetchPaymentsInRange({
      companyId: activeCompanyId,
      from: range.fromIso || undefined,
      to: range.toIso || undefined,
    })
      .then((rows) => {
        if (!cancelled) setPayments(rows);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, period]);

  const range = useMemo(() => periodRange(period), [period]);

  const memberName = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of members) out[m.userId] = m.displayName?.trim() || m.email || m.userId;
    return out;
  }, [members]);

  const customerName = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of customers) out[c.id] = customerDisplayName(c);
    return out;
  }, [customers]);

  const repUniverse = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => j.assignedUserId && set.add(j.assignedUserId));
    return [...set];
  }, [jobs]);

  /**
   * Apply role-based scoping in addition to the optional admin rep
   * filter. Sales reps only ever see their own jobs / commission rows
   * here; admins can pivot the whole dashboard onto a single rep.
   */
  const effectiveFilterUserId = useMemo(() => {
    if (!isAdmin) return user?.uid ?? null;
    return filterRep || null;
  }, [isAdmin, user?.uid, filterRep]);

  const bundle = useMemo<StatsBundle>(
    () =>
      buildStatsBundle({
        jobs,
        options,
        payments,
        ledger,
        range,
        filterUserId: effectiveFilterUserId,
      }),
    [jobs, options, payments, ledger, range, effectiveFilterUserId]
  );

  if (!activeCompanyId) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Stats</h1>
        <p className="settings-page__lede">No active company selected.</p>
      </div>
    );
  }

  const s = bundle.summary;

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">Stats</h1>
        <p className="settings-page__lede">
          {isAdmin
            ? "Operating numbers across the company — pipeline, cash flow, production volume, margins, and commission. The AI assistant at the bottom can answer plain-English questions about everything you see."
            : "Your share of the company's pipeline and commission. The AI assistant at the bottom can answer questions about your own jobs."}
        </p>
      </header>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Period &amp; scope</h2>
          <p className="settings-card__hint">
            Period drives commission totals, payments, and the monthly
            chart. Pipeline and aging metrics always reflect the live
            state of every job.
          </p>
        </div>
        <div className="settings-form__row stats-period-controls">
          <div>
            <span className="auth-field__label">Period</span>
            <div
              className="settings-form__row"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
            >
              {(
                ["this_month", "last_month", "qtd", "ytd", "all"] as StatsPeriod[]
              ).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn stats-period-btn${period === p ? " stats-period-btn--active" : ""}`}
                  onClick={() => setPeriod(p)}
                >
                  {periodLabel(p)}
                </button>
              ))}
            </div>
          </div>
          {isAdmin && repUniverse.length > 0 ? (
            <label className="auth-field">
              <span className="auth-field__label">Rep filter</span>
              <select
                className="auth-field__input stats-rep-filter"
                value={filterRep}
                onChange={(e) => setFilterRep(e.target.value)}
              >
                <option value="">All reps</option>
                {repUniverse.map((uid) => (
                  <option key={uid} value={uid}>
                    {memberName[uid] || uid}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad">{error}</div>
      ) : null}

      {/* ---- Headline KPIs ---- */}
      <section className="commissions-kpis">
        <KpiCard
          label={`${periodLabel(period)} · commission earned`}
          value={formatMoney(s.totalCommissionEarned)}
          tone="good"
        />
        <KpiCard
          label="Pipeline value (non-cancelled)"
          value={formatMoney(s.totalQuotedValue)}
          tone="info"
        />
        <KpiCard
          label="Revenue collected"
          value={formatMoney(s.totalRevenueCollected)}
          tone="good"
        />
        <KpiCard
          label="Outstanding quotes"
          value={`${formatNumber(s.outstandingQuotesCount)} · ${formatMoney(
            s.outstandingQuotesValue
          )}`}
          tone="warn"
        />
        <KpiCard
          label="Unpaid required deposits"
          value={formatMoney(s.unpaidDepositsTotal)}
          tone="warn"
        />
        <KpiCard
          label="Outstanding final balances"
          value={formatMoney(s.outstandingFinalsTotal)}
          tone="warn"
        />
        <KpiCard
          label="Sq ft quoted (lifetime)"
          value={formatNumber(s.totalSqFtQuoted)}
          tone="info"
        />
        <KpiCard
          label="Profile LF installed"
          value={formatNumber(s.totalProfileLfInstalled)}
          tone="info"
        />
        <KpiCard
          label="Average job size"
          value={formatMoney(s.averageJobValue)}
          tone="info"
        />
        <KpiCard
          label="Average margin"
          value={formatPercent(s.averageMarginPct, 1)}
          tone="info"
        />
      </section>

      {/* ---- Pipeline + production ---- */}
      <div className="settings-form__row">
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Pipeline by status</h2>
            <p className="settings-card__hint">
              Live count + quoted value across every active job in the
              company. Cancelled jobs are excluded from the value totals.
            </p>
          </div>
          <table className="commissions-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Jobs</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {bundle.pipeline.map((row) => (
                <tr key={row.status}>
                  <td>
                    <span
                      className="pill"
                      style={{
                        borderColor: JOB_STATUS_COLOR[row.status],
                        color: JOB_STATUS_COLOR[row.status],
                      }}
                    >
                      {JOB_STATUS_LABELS[row.status]}
                    </span>
                  </td>
                  <td>{formatNumber(row.count)}</td>
                  <td>
                    {row.status === "cancelled"
                      ? "—"
                      : formatMoney(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Production volume</h2>
            <p className="settings-card__hint">
              Rolled up from approved Layout Studio plans on jobs that
              reached <strong>Installed</strong> or later.
            </p>
          </div>
          <ul className="kv-list" style={kvListStyle}>
            <KvRow label="Sq ft installed" value={formatNumber(s.totalSqFtInstalled)} />
            <KvRow label="Profile LF installed" value={formatNumber(s.totalProfileLfInstalled)} />
            <KvRow label="Miter LF installed" value={formatNumber(s.totalMiterLfInstalled)} />
            <KvRow label="Splash LF installed" value={formatNumber(s.totalSplashLfInstalled)} />
            <KvRow label="Slabs installed" value={formatNumber(s.totalSlabsInstalled)} />
            <KvRow label="Sinks installed" value={formatNumber(s.totalSinksInstalled)} />
          </ul>
        </section>
      </div>

      {/* ---- Aging + conversion ---- */}
      <div className="settings-form__row">
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Aging &amp; lifecycle</h2>
            <p className="settings-card__hint">
              Stale quotes are quotes still open more than 30 days after
              creation. Stale approved jobs are post-approval (active /
              installed) jobs that have been open more than 90 days.
            </p>
          </div>
          <ul className="kv-list" style={kvListStyle}>
            <KvRow
              label="Quotes > 30 days old"
              value={`${formatNumber(s.staleQuotesCount)} · ${formatMoney(
                s.staleQuotesValue
              )}`}
            />
            <KvRow
              label="Approved jobs > 90 days unfinished"
              value={`${formatNumber(s.staleApprovedCount)} · ${formatMoney(
                s.staleApprovedValue
              )}`}
            />
            <KvRow
              label="Avg days · created → approved quote"
              value={formatDays(s.avgDaysCreatedToQuote)}
            />
            <KvRow
              label="Avg days · approved → active"
              value={formatDays(s.avgDaysQuoteToActive)}
            />
            <KvRow
              label="Avg days · installed → complete"
              value={formatDays(s.avgDaysInstalledToComplete)}
            />
            <KvRow
              label="Avg days · created → complete"
              value={formatDays(s.avgDaysCreatedToComplete)}
            />
          </ul>
        </section>

        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Conversion &amp; margin</h2>
            <p className="settings-card__hint">
              Margin is computed against the rolled-up estimated material
              cost on the approved option(s) — labour and overhead live
              outside the catalog so the figure is best read as a
              <em> material margin</em>.
            </p>
          </div>
          <ul className="kv-list" style={kvListStyle}>
            <KvRow
              label="Quote → Active conversion"
              value={formatRate(s.quoteToActiveRate, 1)}
            />
            <KvRow
              label="Active → Complete conversion"
              value={formatRate(s.activeToCompleteRate, 1)}
            />
            <KvRow
              label="Win rate (vs cancelled)"
              value={formatRate(s.winRate, 1)}
            />
            <KvRow
              label="Average gross margin"
              value={formatPercent(s.averageMarginPct, 1)}
            />
            <KvRow
              label="Jobs with margin ≥ 50%"
              value={formatNumber(s.marginAbove50Count)}
            />
            <KvRow
              label="Jobs with margin ≥ 75%"
              value={formatNumber(s.marginAbove75Count)}
            />
          </ul>
        </section>
      </div>

      {/* ---- Top customers + per-rep leaderboard ---- */}
      <div className="settings-form__row">
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Top customers by quoted value</h2>
          </div>
          <table className="commissions-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Jobs</th>
                <th>Quoted value</th>
              </tr>
            </thead>
            <tbody>
              {bundle.topCustomers.map((c) => (
                <tr key={c.customerId}>
                  <td>{customerName[c.customerId] ?? c.customerId}</td>
                  <td>{formatNumber(c.jobs)}</td>
                  <td>{formatMoney(c.quotedValue)}</td>
                </tr>
              ))}
              {bundle.topCustomers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="team-row--empty">
                    No customers yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        {isAdmin ? (
          <section className="settings-card">
            <div className="settings-card__head">
              <h2 className="settings-card__title">Rep leaderboard</h2>
              <p className="settings-card__hint">
                Quoted volume is lifetime; commission earnings are for{" "}
                {periodLabel(period).toLowerCase()}.
              </p>
            </div>
            <table className="commissions-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Jobs</th>
                  <th>Active</th>
                  <th>Won</th>
                  <th>Quoted value</th>
                  <th>Commission</th>
                </tr>
              </thead>
              <tbody>
                {bundle.perRep.map((r) => (
                  <tr key={r.userId}>
                    <td>
                      {r.userId === "_unassigned"
                        ? "Unassigned"
                        : memberName[r.userId] ?? r.userId}
                    </td>
                    <td>{formatNumber(r.jobs)}</td>
                    <td>{formatNumber(r.activeJobs)}</td>
                    <td>{formatNumber(r.completedJobs)}</td>
                    <td>{formatMoney(r.quotedValue)}</td>
                    <td>{formatMoney(r.commissionEarned)}</td>
                  </tr>
                ))}
                {bundle.perRep.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="team-row--empty">
                      No reps with activity in this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>

      {/* ---- Material category breakdown ---- */}
      {s.byMaterialCategory.length > 0 ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">By material category</h2>
            <p className="settings-card__hint">
              Each job is classified by the customer-approved material
              (or the most-developed quote candidate when nothing is
              approved yet). Margin is gross of fabrication labor.
            </p>
          </div>
          <table className="commissions-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Jobs</th>
                <th>Quoted value</th>
                <th>Sq ft</th>
                <th>Material cost</th>
                <th>Avg margin</th>
                <th>≥75% margin</th>
                <th>Top product</th>
              </tr>
            </thead>
            <tbody>
              {s.byMaterialCategory.map((m) => (
                <tr key={m.category}>
                  <td>
                    {MATERIAL_CATEGORY_LABELS[m.category] ?? m.category}
                  </td>
                  <td>{formatNumber(m.jobs)}</td>
                  <td>{formatMoney(m.quotedValue)}</td>
                  <td>{formatNumber(m.sqFt)}</td>
                  <td>{formatMoney(m.materialCost)}</td>
                  <td>{formatPercent(m.averageMarginPct, 1)}</td>
                  <td>{formatNumber(m.marginAbove75Count)}</td>
                  <td>
                    {m.topProducts.length === 0
                      ? "—"
                      : m.topProducts
                          .map((p) => `${p.productName} (${p.jobs})`)
                          .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ---- Monthly commission trend ---- */}
      {bundle.months.length > 0 ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Commission · monthly trend</h2>
            <p className="settings-card__hint">
              {isAdmin
                ? "Stacked commission earnings by rep, month over month."
                : "Your monthly earnings."}
            </p>
          </div>
          <StackedBars
            months={bundle.months}
            byUserMonth={bundle.monthlyCommissionByUser}
            memberName={memberName}
            isAdmin={isAdmin}
            myUserId={user?.uid ?? ""}
          />
        </section>
      ) : null}

      {/* ---- Stale quote spotlight (admin only, easier to act on) ---- */}
      {isAdmin && bundle.jobRows.some((j) => j.status === "quote" && (j.daysSinceCreated ?? 0) > 30) ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Stale quotes &gt; 30 days</h2>
            <p className="settings-card__hint">
              Quotes that have lingered more than 30 days without
              advancing. Click a row to open the job and follow up.
            </p>
          </div>
          <table className="commissions-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Customer</th>
                <th>Rep</th>
                <th>Days open</th>
                <th>Quoted</th>
              </tr>
            </thead>
            <tbody>
              {bundle.jobRows
                .filter(
                  (j) =>
                    j.status === "quote" && (j.daysSinceCreated ?? 0) > 30
                )
                .sort((a, b) => (b.daysSinceCreated ?? 0) - (a.daysSinceCreated ?? 0))
                .slice(0, 20)
                .map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link to={`/jobs/${j.id}`} className="btn btn-ghost btn-sm">
                        {j.name}
                      </Link>
                    </td>
                    <td>{customerName[j.customerId] ?? "—"}</td>
                    <td>
                      {j.assignedUserId
                        ? memberName[j.assignedUserId] ?? j.assignedUserId
                        : "Unassigned"}
                    </td>
                    <td>{formatDays(j.daysSinceCreated)}</td>
                    <td>{formatMoney(j.quotedTotal)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {/* ---- AI assistant (renders as a fixed-position floating panel) ---- */}
      <StatsAssistant
        bundle={bundle}
        memberName={memberName}
        customerName={customerName}
        isAdmin={isAdmin}
      />
    </div>
  );
}

const kvListStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 8,
  padding: 0,
  margin: 0,
  listStyle: "none",
};

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        paddingBottom: 8,
        borderBottom: "1px solid var(--bella-border)",
      }}
    >
      <span style={{ color: "var(--bella-muted)", fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </li>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "info" | "warn";
}) {
  return (
    <div className={`kpi-card kpi-card--${tone}`}>
      <div className="kpi-card__value">{value}</div>
      <div className="kpi-card__label">{label}</div>
    </div>
  );
}

function StackedBars({
  months,
  byUserMonth,
  memberName,
  isAdmin,
  myUserId,
}: {
  months: string[];
  byUserMonth: Record<string, Record<string, number>>;
  memberName: Record<string, string>;
  isAdmin: boolean;
  myUserId: string;
}) {
  const users = isAdmin
    ? Object.keys(byUserMonth)
    : [myUserId].filter((u) => byUserMonth[u]);
  const colors = [
    "#10b981",
    "#6366f1",
    "#f59e0b",
    "#ef4444",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
  ];
  const maxMonth = Math.max(
    1,
    ...months.map((m) =>
      users.reduce((a, u) => a + (byUserMonth[u]?.[m] ?? 0), 0)
    )
  );
  const width = Math.max(320, months.length * 64 + 80);
  const height = 240;
  const barWidth = 40;
  const leftPad = 48;
  const bottomPad = 30;
  const usableH = height - bottomPad - 10;
  return (
    <div className="commissions-chart" style={{ overflowX: "auto" }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Monthly commission trend"
      >
        <line
          x1={leftPad}
          y1={10}
          x2={leftPad}
          y2={height - bottomPad}
          stroke="rgba(255,255,255,0.2)"
        />
        <text
          x={leftPad - 6}
          y={14}
          textAnchor="end"
          fontSize={10}
          fill="currentColor"
        >
          {formatMoney(maxMonth)}
        </text>
        <text
          x={leftPad - 6}
          y={height - bottomPad}
          textAnchor="end"
          fontSize={10}
          fill="currentColor"
        >
          $0
        </text>
        {months.map((m, idx) => {
          const x = leftPad + 16 + idx * 64;
          let cursorY = height - bottomPad;
          return (
            <g key={m}>
              {users.map((uid, ui) => {
                const amt = byUserMonth[uid]?.[m] ?? 0;
                if (!amt) return null;
                const h = Math.max(1, (amt / maxMonth) * usableH);
                cursorY -= h;
                return (
                  <rect
                    key={uid}
                    x={x}
                    y={cursorY}
                    width={barWidth}
                    height={h}
                    fill={colors[ui % colors.length]}
                  >
                    <title>
                      {(memberName[uid] ?? uid)}: {formatMoney(amt)} ({m})
                    </title>
                  </rect>
                );
              })}
              <text
                x={x + barWidth / 2}
                y={height - bottomPad + 14}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
              >
                {m.slice(5)}/{m.slice(2, 4)}
              </text>
            </g>
          );
        })}
      </svg>
      {isAdmin && users.length > 1 ? (
        <ul className="commissions-chart__legend">
          {users.map((uid, i) => (
            <li key={uid}>
              <span
                className="commissions-chart__swatch"
                style={{ background: colors[i % colors.length] }}
              />
              {memberName[uid] ?? uid}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Re-export for the main router so the existing import path stays
// stable while the file lives next to the rest of the commissions
// dashboard pages.
export default StatsPage;

// Statuses re-exported for downstream consumers; kept at the bottom so
// the main page render is the first thing readers see.
export type { JobStatus };
