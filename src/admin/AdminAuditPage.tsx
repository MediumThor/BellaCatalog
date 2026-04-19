import { useEffect, useState } from "react";
import type { AdminAuditEntry } from "../company/types";
import { subscribeRecentAuditEntries } from "./platformAdminFirestore";

const ACTION_LABEL: Record<AdminAuditEntry["action"], string> = {
  setCompanyBilling: "Updated billing",
  setMemberSeatStatus: "Changed seat status",
  transferOwnership: "Transferred ownership",
  forceCancelSubscription: "Canceled subscription",
  resumeSubscription: "Resumed subscription",
  setMemberStatus: "Changed member status",
  other: "Other",
};

function fmt(ts: unknown): string {
  if (!ts || typeof ts !== "object" || !("toDate" in (ts as object))) {
    return "—";
  }
  try {
    return (ts as { toDate: () => Date })
      .toDate()
      .toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export function AdminAuditPage() {
  const [rows, setRows] = useState<AdminAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeRecentAuditEntries(
      setRows,
      (e) => setError(e.message),
      200
    );
    return unsub;
  }, []);

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Audit log</h1>
          <p className="admin-page__sub">
            Last 200 actions taken by platform admins. Immutable — written
            by Cloud Functions on every admin change.
          </p>
        </div>
      </header>

      {error && <p className="admin-error">{error}</p>}

      {rows.length === 0 && !error ? (
        <p>No admin actions recorded yet.</p>
      ) : (
        <div className="admin-audit">
          {rows.map((row) => (
            <details key={row.id} className="admin-audit__row">
              <summary>
                <span className="admin-audit__when">{fmt(row.at)}</span>
                <span className="admin-audit__actor">{row.actorEmail}</span>
                <span className="admin-audit__action">
                  {ACTION_LABEL[row.action] ?? row.action}
                </span>
                <span className="admin-audit__target">
                  {row.targetCompanyId ?? ""}
                  {row.targetUserId ? ` · ${row.targetUserId}` : ""}
                </span>
              </summary>
              {row.reason && (
                <p className="admin-audit__reason">
                  <strong>Reason:</strong> {row.reason}
                </p>
              )}
              <div className="admin-audit__diff">
                <div>
                  <h4>Before</h4>
                  <pre>{JSON.stringify(row.before ?? null, null, 2)}</pre>
                </div>
                <div>
                  <h4>After</h4>
                  <pre>{JSON.stringify(row.after ?? null, null, 2)}</pre>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
