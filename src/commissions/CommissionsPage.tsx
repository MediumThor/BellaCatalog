/**
 * Commissions dashboard.
 *
 * - Owners/admins see everyone's numbers, a per-rep leaderboard, and a
 *   monthly trend chart.
 * - Sales / manager / viewer users see only their own totals. Rules
 *   enforce this in addition to the UI filter.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { subscribeCompanyMembers } from "../company/teamFirestore";
import type { CompanyMemberDoc } from "../company/types";
import {
  subscribeCompanyLedger,
  subscribeMyLedger,
  rollupByUserAndMonth,
  totalsByUser,
} from "../services/commissionLedgerFirestore";
import type { CommissionLedgerEntry } from "../types/commission";
import { formatMoney } from "../utils/priceHelpers";

type Period =
  | "this_month"
  | "last_month"
  | "qtd"
  | "ytd"
  | "all";

function periodRange(p: Period): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const fmt = (yr: number, mo: number) =>
    `${yr}-${String(mo + 1).padStart(2, "0")}`;
  switch (p) {
    case "this_month":
      return { from: fmt(y, m), to: fmt(y, m) };
    case "last_month": {
      const lm = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
      return { from: fmt(lm.y, lm.m), to: fmt(lm.y, lm.m) };
    }
    case "qtd": {
      const qStart = Math.floor(m / 3) * 3;
      return { from: fmt(y, qStart), to: fmt(y, m) };
    }
    case "ytd":
      return { from: fmt(y, 0), to: fmt(y, m) };
    case "all":
    default:
      return { from: "0000-00", to: "9999-12" };
  }
}

function periodLabel(p: Period): string {
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

export function CommissionsPage() {
  const { user } = useAuth();
  const { activeCompanyId, role } = useCompany();
  const isAdmin = role === "owner" || role === "admin";
  const [ledger, setLedger] = useState<CommissionLedgerEntry[]>([]);
  const [members, setMembers] = useState<CompanyMemberDoc[]>([]);
  const [period, setPeriod] = useState<Period>("ytd");
  const [error, setError] = useState<string | null>(null);

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
      (rows) =>
        setLedger(rows.filter((r) => r.companyId === activeCompanyId)),
      (e) => setError(e.message)
    );
  }, [activeCompanyId, user?.uid, isAdmin]);

  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeCompanyMembers(
      activeCompanyId,
      (rows) => setMembers(rows),
      (e) => setError(e.message)
    );
  }, [activeCompanyId]);

  const memberName = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of members) out[m.userId] = m.displayName || m.email;
    return out;
  }, [members]);

  const range = useMemo(() => periodRange(period), [period]);

  const filtered = useMemo(
    () =>
      ledger.filter(
        (r) =>
          r.periodYearMonth >= range.from && r.periodYearMonth <= range.to
      ),
    [ledger, range]
  );

  const totalsThisPeriod = useMemo(
    () =>
      filtered.reduce((acc, r) => acc + r.amount, 0),
    [filtered]
  );

  const byUser = useMemo(() => totalsByUser(filtered), [filtered]);
  const byUserMonth = useMemo(() => rollupByUserAndMonth(filtered), [filtered]);

  const months = useMemo(() => {
    const set = new Set<string>();
    filtered.forEach((r) => set.add(r.periodYearMonth));
    return Array.from(set).sort();
  }, [filtered]);

  if (!activeCompanyId) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Commissions</h1>
        <p className="settings-page__lede">No active company selected.</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">Commissions</h1>
        <p className="settings-page__lede">
          {isAdmin
            ? "See every rep's performance, pipeline, and monthly trend."
            : "Your commission history across this company."}
        </p>
      </header>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Period</h2>
          <p className="settings-card__hint">
            Results update live as payments are recorded.
          </p>
        </div>
        <div className="settings-form__row">
          {(
            ["this_month", "last_month", "qtd", "ytd", "all"] as Period[]
          ).map((p) => (
            <button
              key={p}
              type="button"
              className={`btn ${period === p ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setPeriod(p)}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad">
          {error}
        </div>
      ) : null}

      <section className="commissions-kpis">
        <KpiCard
          label={`${periodLabel(period)} · commission earned`}
          value={formatMoney(totalsThisPeriod)}
          tone="good"
        />
        <KpiCard
          label="Ledger entries"
          value={String(filtered.length)}
          tone="info"
        />
        {isAdmin ? (
          <KpiCard
            label="Reps with earnings"
            value={String(Object.keys(byUser).length)}
            tone="info"
          />
        ) : null}
      </section>

      {isAdmin ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Leaderboard</h2>
          </div>
          <table className="commissions-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th>Entries</th>
                <th>Total earned</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byUser)
                .sort((a, b) => b[1] - a[1])
                .map(([uid, total]) => (
                  <tr key={uid}>
                    <td>{memberName[uid] ?? uid}</td>
                    <td>
                      {filtered.filter((r) => r.userId === uid).length}
                    </td>
                    <td>{formatMoney(total)}</td>
                  </tr>
                ))}
              {Object.keys(byUser).length === 0 ? (
                <tr>
                  <td colSpan={3} className="team-row--empty">
                    No commission rows for this period yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {months.length > 0 ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Monthly trend</h2>
            <p className="settings-card__hint">
              {isAdmin
                ? "Stacked commission earnings by rep, month over month."
                : "Your monthly earnings."}
            </p>
          </div>
          <StackedBars
            months={months}
            byUserMonth={byUserMonth}
            memberName={memberName}
            isAdmin={isAdmin}
            myUserId={user?.uid ?? ""}
          />
        </section>
      ) : null}
    </div>
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
        {/* y axis */}
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
