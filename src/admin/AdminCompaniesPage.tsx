import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminListCompanies,
  type AdminCompanyRow,
} from "./platformAdminApi";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  unpaid: "Unpaid",
  none: "—",
  internal_dev: "Internal / gifted",
};

export function AdminCompaniesPage() {
  const [rows, setRows] = useState<AdminCompanyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminListCompanies()
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load companies."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.id.toLowerCase().includes(needle) ||
        (row.slug ?? "").toLowerCase().includes(needle) ||
        (row.stripeCustomerId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, search, statusFilter]);

  const statuses = useMemo(() => {
    const s = new Set<string>();
    (rows ?? []).forEach((r) => s.add(r.status));
    return Array.from(s).sort();
  }, [rows]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      companies: list.length,
      paidSeats: list.reduce((n, r) => n + (r.seatLimit ?? 0), 0),
      giftedSeats: list.reduce((n, r) => n + (r.bonusSeats ?? 0), 0),
      activeSeats: list.reduce((n, r) => n + (r.activeSeatCount ?? 0), 0),
      gifted: list.filter((r) => r.status === "internal_dev").length,
    };
  }, [rows]);

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Companies</h1>
          <p className="admin-page__sub">
            Every workspace using BellaCatalog. Open a row to gift seats,
            flip billing, transfer ownership, or force-cancel.
          </p>
        </div>
      </header>

      <div className="admin-summary">
        <SummaryCard label="Workspaces" value={totals.companies} />
        <SummaryCard label="Paid seats" value={totals.paidSeats} />
        <SummaryCard label="Gifted seats" value={totals.giftedSeats} />
        <SummaryCard label="Active members" value={totals.activeSeats} />
        <SummaryCard
          label="Gifted whole co"
          value={totals.gifted}
          hint="status = internal_dev"
        />
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-toolbar__input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, id, slug, or Stripe id"
          aria-label="Search companies"
        />
        <select
          className="admin-toolbar__select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by billing status"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      {loading && <p>Loading companies…</p>}
      {error && <p className="admin-error">{error}</p>}

      {!loading && !error && (
        <div className="admin-table">
          <div className="admin-table__head">
            <div className="admin-table__cell admin-table__cell--grow">
              Company
            </div>
            <div className="admin-table__cell">Status</div>
            <div className="admin-table__cell">Seats</div>
            <div className="admin-table__cell" />
          </div>
          {filtered.length === 0 ? (
            <div className="admin-table__empty">No matches.</div>
          ) : (
            filtered.map((row) => {
              const gifted = row.bonusSeats > 0;
              const total = (row.seatLimit ?? 0) + (row.bonusSeats ?? 0);
              return (
                <div key={row.id} className="admin-table__row">
                  <div className="admin-table__cell admin-table__cell--grow">
                    <div className="admin-table__name">{row.name}</div>
                    <div className="admin-table__meta">
                      {row.id}
                      {row.slug && row.slug !== row.id
                        ? ` · ${row.slug}`
                        : ""}
                      {row.cancelAtPeriodEnd ? " · cancel at period end" : ""}
                    </div>
                  </div>
                  <div className="admin-table__cell">
                    <StatusPill status={row.status} />
                  </div>
                  <div className="admin-table__cell">
                    <span className="admin-seats">
                      {row.activeSeatCount}/{total || 0}
                    </span>
                    {gifted && (
                      <span className="admin-chip admin-chip--gift">
                        +{row.bonusSeats} gifted
                      </span>
                    )}
                  </div>
                  <div className="admin-table__cell admin-table__cell--actions">
                    <Link
                      className="btn btn-ghost"
                      to={`/admin/companies/${row.id}`}
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="admin-summary__card">
      <div className="admin-summary__value">{value.toLocaleString()}</div>
      <div className="admin-summary__label">{label}</div>
      {hint ? <div className="admin-summary__hint">{hint}</div> : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status;
  const tone =
    status === "active" || status === "trialing"
      ? "ok"
      : status === "internal_dev"
        ? "gift"
        : status === "past_due" || status === "unpaid" || status === "incomplete"
          ? "warn"
          : status === "canceled"
            ? "danger"
            : "neutral";
  return (
    <span className={`admin-pill admin-pill--${tone}`}>{label}</span>
  );
}
