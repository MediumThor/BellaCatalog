/**
 * Admin-only page to generate + download QuickBooks CSV exports.
 *
 * Phase 1: CSV download for "payments" and "commissions" in a date range.
 * Phase 2: swap internals for the QuickBooks Online REST API (planned,
 * see `docs/commission-tracker-plan.md` §13).
 */
import { useEffect, useMemo, useState } from "react";
import { useCompany } from "../company/useCompany";
import {
  generateCommissionsExport,
  subscribeExports,
} from "../services/quickbooksExportsFirestore";
import type { QuickBooksExportDoc } from "../types/commission";
import { formatMoney } from "../utils/priceHelpers";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function QuickBooksExportsPage() {
  const { activeCompanyId, role } = useCompany();
  const isAdmin = role === "owner" || role === "admin";
  const [rows, setRows] = useState<QuickBooksExportDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [periodStart, setPeriodStart] = useState(firstOfMonthIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [includeExported, setIncludeExported] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeExports(
      activeCompanyId,
      (r) => setRows(r),
      (e) => setError(e.message)
    );
  }, [activeCompanyId]);

  const canExport = isAdmin && Boolean(activeCompanyId);

  async function handleExport() {
    if (!activeCompanyId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await generateCommissionsExport({
        companyId: activeCompanyId,
        periodStart,
        periodEnd,
        includeExportedPayments: includeExported,
      });
      setResult(
        `Export ready: ${r.paymentCount} payment${r.paymentCount === 1 ? "" : "s"} · ${formatMoney(r.totalCommissionAmount)} commission`
      );
      // Trigger browser download of the commissions file.
      if (r.downloadUrl) {
        const a = document.createElement("a");
        a.href = r.downloadUrl;
        a.download = r.commissionsFileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  const sorted = useMemo(() => rows, [rows]);

  if (!isAdmin) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">QuickBooks exports</h1>
        <p className="settings-page__lede">
          Only owners and admins can generate exports.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">QuickBooks exports</h1>
        <p className="settings-page__lede">
          Generate CSVs of payments and commissions for a date range, ready
          to import into QuickBooks. A direct QuickBooks Online sync is on
          the roadmap (phase 2).
        </p>
      </header>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">New export</h2>
          <p className="settings-card__hint">
            Payments included in this export are marked so they don't roll
            into next month — turn on "Include already-exported" to re-run.
          </p>
        </div>
        <div className="settings-form__row">
          <label className="auth-field">
            <span className="auth-field__label">From</span>
            <input
              className="auth-field__input"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              max={periodEnd}
            />
          </label>
          <label className="auth-field">
            <span className="auth-field__label">To</span>
            <input
              className="auth-field__input"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              min={periodStart}
              max={todayIso()}
            />
          </label>
          <label className="settings-form__checkbox settings-form__checkbox--inline">
            <input
              type="checkbox"
              checked={includeExported}
              onChange={(e) => setIncludeExported(e.target.checked)}
            />
            <span>Include already-exported</span>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleExport()}
            disabled={!canExport || busy}
          >
            {busy ? "Generating…" : "Generate export"}
          </button>
        </div>
        {result ? (
          <div className="settings-inline-msg settings-inline-msg--good">
            {result}
          </div>
        ) : null}
        {error ? (
          <div className="settings-inline-msg settings-inline-msg--bad">
            {error}
          </div>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">History</h2>
          <p className="settings-card__hint">
            Download links are signed for 24 hours; re-generate an export if
            a link expires.
          </p>
        </div>
        <table className="commissions-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Payments</th>
              <th>Deposits</th>
              <th>Final</th>
              <th>Commission</th>
              <th>Created</th>
              <th>Download</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.periodStart} → {r.periodEnd}
                </td>
                <td>{r.paymentCount}</td>
                <td>{formatMoney(r.totalDepositAmount)}</td>
                <td>{formatMoney(r.totalFinalAmount)}</td>
                <td>{formatMoney(r.totalCommissionAmount)}</td>
                <td>
                  {r.createdAt && "toDate" in (r.createdAt as object)
                    ? (r.createdAt as { toDate: () => Date })
                        .toDate()
                        .toLocaleString()
                    : "—"}
                </td>
                <td>
                  {r.downloadUrl ? (
                    <a
                      href={r.downloadUrl}
                      download={r.commissionsFileName}
                      className="btn btn-ghost btn-sm"
                    >
                      Commissions
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="team-row--empty">
                  No exports yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
