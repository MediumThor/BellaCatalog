/**
 * Company-wide jobs overview.
 *
 * - Board view: status columns for the five canonical statuses (+ cancelled).
 * - Table view: same data, sortable by updatedAt.
 *
 * Non-admin members see only their own jobs; admins see every job.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { SearchBar } from "../components/SearchBar";
import { subscribeCompanyMembers } from "../company/teamFirestore";
import type { CompanyMemberDoc } from "../company/types";
import {
  subscribeCustomers,
  subscribeRecentJobsForCompany,
} from "../services/compareQuoteFirestore";
import {
  CANONICAL_JOB_STATUSES,
  customerDisplayName,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABELS,
  normalizeJobStatus,
  type CustomerRecord,
  deriveJobSinkModels,
  type JobRecord,
  type JobStatus,
} from "../types/compareQuote";
import { formatMoney } from "../utils/priceHelpers";

type View = "board" | "table";

export function JobsOverviewPage() {
  const { user } = useAuth();
  const { activeCompanyId, role } = useCompany();
  const isAdmin = role === "owner" || role === "admin";
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [members, setMembers] = useState<CompanyMemberDoc[]>([]);
  const [view, setView] = useState<View>("board");
  const [error, setError] = useState<string | null>(null);
  const [filterRep, setFilterRep] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [headerSearchSlot, setHeaderSearchSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHeaderSearchSlot(document.getElementById("catalog-header-search-root"));
  }, []);

  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeRecentJobsForCompany(
      activeCompanyId,
      (rows) => setJobs(rows),
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
    if (!activeCompanyId || !isAdmin) {
      setMembers([]);
      return;
    }
    return subscribeCompanyMembers(
      activeCompanyId,
      (rows) => setMembers(rows),
      (e) => setError(e.message)
    );
  }, [activeCompanyId, isAdmin]);

  const customerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of customers) map[c.id] = customerDisplayName(c);
    return map;
  }, [customers]);

  const repNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      map[m.userId] = m.displayName?.trim() || m.email || m.userId;
    }
    return map;
  }, [members]);

  const mineOnly = useMemo(() => {
    if (isAdmin) return jobs;
    return jobs.filter((j) => j.assignedUserId === user?.uid);
  }, [jobs, isAdmin, user?.uid]);

  const repUniverse = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => j.assignedUserId && set.add(j.assignedUserId));
    return Array.from(set);
  }, [jobs]);

  const repFiltered = useMemo(
    () =>
      filterRep
        ? mineOnly.filter((j) => j.assignedUserId === filterRep)
        : mineOnly,
    [mineOnly, filterRep]
  );

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return repFiltered;
    return repFiltered.filter((j) => {
      const customer = customerNameById[j.customerId] ?? "";
      const rep = j.assignedUserId ? repNameById[j.assignedUserId] ?? "" : "";
      const status = JOB_STATUS_LABELS[normalizeJobStatus(j.status)] ?? "";
      const haystack = [
        j.name,
        j.areaType,
        j.notes,
        j.assumptions,
        j.contactName,
        j.siteAddress,
        customer,
        rep,
        status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [repFiltered, searchQuery, customerNameById, repNameById]);

  const byStatus = useMemo(() => {
    const out: Record<JobStatus, JobRecord[]> = {
      draft: [],
      quote: [],
      active: [],
      installed: [],
      complete: [],
      cancelled: [],
      comparing: [],
      selected: [],
      quoted: [],
      closed: [],
    };
    for (const j of visible) {
      out[normalizeJobStatus(j.status)].push(j);
    }
    return out;
  }, [visible]);

  return (
    <div className="settings-page">
      {headerSearchSlot
        ? createPortal(
            <SearchBar
              variant="header"
              id="jobs-overview-search"
              label="Search jobs"
              placeholder="Search jobs, customers, reps, status…"
              value={searchQuery}
              onChange={setSearchQuery}
            />,
            headerSearchSlot
          )
        : null}
      <section className="settings-card jobs-toolbar">
        <div className="settings-form__row jobs-toolbar__row">
          <div
            className="tab-bar tab-bar--jobs"
            role="tablist"
            aria-label="Jobs view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "board"}
              className={`tab-bar__btn${view === "board" ? " is-active" : ""}`}
              onClick={() => setView("board")}
            >
              Board
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              className={`tab-bar__btn${view === "table" ? " is-active" : ""}`}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
          {isAdmin && repUniverse.length > 0 ? (
            <label className="auth-field">
              <span className="auth-field__label">Filter by rep</span>
              <select
                className="auth-field__input"
                value={filterRep}
                onChange={(e) => setFilterRep(e.target.value)}
              >
                <option value="">All reps</option>
                {repUniverse.map((uid) => (
                  <option key={uid} value={uid}>
                    {repNameById[uid] || uid}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad">
          {error}
        </div>
      ) : null}

      {view === "board" ? (
        <div className="kanban-board">
          {CANONICAL_JOB_STATUSES.filter((s) => s !== "cancelled").map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              jobs={byStatus[s]}
              customerNameById={customerNameById}
            />
          ))}
          {byStatus.cancelled.length > 0 ? (
            <KanbanColumn
              status="cancelled"
              jobs={byStatus.cancelled}
              customerNameById={customerNameById}
            />
          ) : null}
        </div>
      ) : (
        <TableView jobs={visible} customerNameById={customerNameById} />
      )}
    </div>
  );
}

function KanbanColumn({
  status,
  jobs,
  customerNameById,
}: {
  status: JobStatus;
  jobs: JobRecord[];
  customerNameById: Record<string, string>;
}) {
  return (
    <div
      className="kanban-column"
      style={{ borderTopColor: JOB_STATUS_COLOR[status] }}
    >
      <header className="kanban-column__head">
        <span className="kanban-column__title">
          {JOB_STATUS_LABELS[status]}
        </span>
        <span className="kanban-column__count">{jobs.length}</span>
      </header>
      <ul className="kanban-column__list">
        {jobs.map((j) => {
          const customer = customerNameById[j.customerId];
          /**
           * Quote is approved (an area has a customer-chosen material)
           * the moment Firestore stamps a `requiredDepositAmount` on the
           * job. The job stays in the `quote` lane until a deposit is
           * recorded, so surface a clear "Awaiting deposit" affordance
           * here — the rep doesn't need to drill into the job to know
           * it's blocked on payment.
           */
          const requiredDeposit = j.requiredDepositAmount ?? 0;
          const depositReceived = j.depositReceivedTotal ?? 0;
          const normStatus = normalizeJobStatus(j.status);
          const awaitingDeposit =
            normStatus === "quote" &&
            requiredDeposit > 0 &&
            depositReceived < requiredDeposit;
          /**
           * Active-phase production summary: surface the dates,
           * sinks, and notes the rep recorded so the board doubles
           * as a quick-glance production schedule. We hide deposit
           * info from the meta line in this phase since the deposit
           * is already collected (per the lifecycle redesign).
           */
          const isActivePhase =
            normStatus === "active" || normStatus === "installed";
          const activeSinks = isActivePhase ? deriveJobSinkModels(j) : [];
          return (
            <li key={j.id}>
              <Link to={`/jobs/${j.id}`} className="kanban-card">
                <span className="kanban-card__customer">
                  {customer ?? "Unnamed customer"}
                </span>
                <span className="kanban-card__title">{j.name}</span>
                {isActivePhase ? (
                  <span className="kanban-card__schedule">
                    {j.materialDeliveryDate ? (
                      <span title="Material delivery">
                        Delivery: {j.materialDeliveryDate}
                      </span>
                    ) : null}
                    {j.requestedInstallDate ? (
                      <span title="Requested install">
                        Install: {j.requestedInstallDate}
                      </span>
                    ) : null}
                    {activeSinks.length > 0 ? (
                      <span title="Sink models from quote">
                        Sinks: {activeSinks.join(", ")}
                      </span>
                    ) : null}
                    {j.activeJobNotes ? (
                      <span
                        className="kanban-card__notes"
                        title={j.activeJobNotes}
                      >
                        {j.activeJobNotes.length > 80
                          ? `${j.activeJobNotes.slice(0, 80)}…`
                          : j.activeJobNotes}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className="kanban-card__pills">
                  {awaitingDeposit ? (
                    <span className="pill pill--awaiting">
                      Awaiting deposit
                    </span>
                  ) : null}
                  {normStatus === "complete" || j.paidInFullAt ? (
                    <span className="pill pill--good">Paid in full</span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
        {jobs.length === 0 ? (
          <li className="kanban-column__empty">No jobs</li>
        ) : null}
      </ul>
    </div>
  );
}

function TableView({
  jobs,
  customerNameById,
}: {
  jobs: JobRecord[];
  customerNameById: Record<string, string>;
}) {
  return (
    <table className="commissions-table">
      <thead>
        <tr>
          <th>Job</th>
          <th>Customer</th>
          <th>Status</th>
          <th>Assigned rep</th>
          <th>Quoted total</th>
          <th>Deposit received</th>
          <th>Balance due</th>
          <th>Delivery</th>
          <th>Install</th>
          <th>Sinks</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => {
          const sinks = deriveJobSinkModels(j);
          return (
            <tr key={j.id}>
              <td>
                <Link to={`/jobs/${j.id}`} className="btn btn-ghost btn-sm">
                  {j.name}
                </Link>
              </td>
              <td>{customerNameById[j.customerId] ?? "—"}</td>
              <td>
                <span
                  className="pill"
                  style={{
                    borderColor:
                      JOB_STATUS_COLOR[normalizeJobStatus(j.status)],
                    color: JOB_STATUS_COLOR[normalizeJobStatus(j.status)],
                  }}
                >
                  {JOB_STATUS_LABELS[normalizeJobStatus(j.status)]}
                </span>
              </td>
              <td>{j.assignedUserId ?? "—"}</td>
              <td>
                {j.quotedTotal != null ? formatMoney(j.quotedTotal) : "—"}
              </td>
              <td>{formatMoney(j.depositReceivedTotal ?? 0)}</td>
              <td>
                {j.balanceDue != null ? formatMoney(j.balanceDue) : "—"}
              </td>
              <td>{j.materialDeliveryDate ?? "—"}</td>
              <td>{j.requestedInstallDate ?? "—"}</td>
              <td title={sinks.join(", ") || undefined}>
                {sinks.length === 0
                  ? "—"
                  : sinks.length <= 2
                  ? sinks.join(", ")
                  : `${sinks.slice(0, 2).join(", ")} +${sinks.length - 2}`}
              </td>
              <td>{j.updatedAt?.slice(0, 10)}</td>
            </tr>
          );
        })}
        {jobs.length === 0 ? (
          <tr>
            <td colSpan={11} className="team-row--empty">
              No jobs.
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
