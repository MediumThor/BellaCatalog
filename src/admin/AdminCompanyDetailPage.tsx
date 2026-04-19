import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CompanyDoc, CompanyMemberDoc } from "../company/types";
import { effectiveSeatLimit } from "../company/types";
import { subscribeCompanyDoc } from "../company/companyFirestore";
import {
  subscribeCompanyInvites,
  subscribeCompanyMembers,
  type CompanyInviteDoc,
} from "../company/teamFirestore";
import {
  adminForceCancelSubscription,
  adminResumeSubscription,
  adminSetCompanyBilling,
  adminSetMemberSeatStatus,
  adminTransferOwnership,
} from "./platformAdminApi";

const BILLING_STATUSES: { value: string; label: string; hint?: string }[] = [
  { value: "trialing", label: "Trial" },
  { value: "active", label: "Active (Stripe)" },
  { value: "past_due", label: "Past due" },
  { value: "unpaid", label: "Unpaid" },
  { value: "incomplete", label: "Incomplete" },
  { value: "canceled", label: "Canceled" },
  { value: "none", label: "None" },
  {
    value: "internal_dev",
    label: "Internal / gifted (bypass billing)",
    hint: "Company skips Stripe checks entirely",
  },
];

function fmtDate(ts: unknown): string {
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

export function AdminCompanyDetailPage() {
  const { companyId = "" } = useParams();
  const [company, setCompany] = useState<CompanyDoc | null>(null);
  const [members, setMembers] = useState<CompanyMemberDoc[]>([]);
  const [invites, setInvites] = useState<CompanyInviteDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    const unsub = [
      subscribeCompanyDoc(companyId, setCompany, (e) => setError(e.message)),
      subscribeCompanyMembers(companyId, setMembers, (e) =>
        setError(e.message)
      ),
      subscribeCompanyInvites(companyId, setInvites, (e) =>
        setError(e.message)
      ),
    ];
    return () => {
      unsub.forEach((fn) => fn());
    };
  }, [companyId]);

  const billing = company?.billing;
  const seatTotal = effectiveSeatLimit(billing);
  const activeSeats = members.filter(
    (m) => m.status === "active" && m.consumesSeat !== false
  ).length;
  const exempt = members.filter((m) => m.seatStatus === "exempt");

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!companyId) {
    return <p className="admin-error">No company id in URL.</p>;
  }

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <p className="admin-page__eyebrow">
            <Link to="/admin">← Companies</Link>
          </p>
          <h1>{company?.name ?? companyId}</h1>
          <p className="admin-page__sub">
            {company?.slug ? `${company.slug} · ` : ""}
            {companyId}
          </p>
        </div>
      </header>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Billing & seats</h2>
          {billing?.status === "internal_dev" && (
            <span className="admin-chip admin-chip--gift">
              Gifted workspace
            </span>
          )}
        </div>

        <div className="admin-grid">
          <Metric label="Status" value={billing?.status ?? "—"} />
          <Metric
            label="Seats used"
            value={`${activeSeats} / ${seatTotal || "—"}`}
          />
          <Metric
            label="Paid seats (Stripe)"
            value={billing?.seatLimit ?? 0}
          />
          <Metric
            label="Gifted seats"
            value={billing?.bonusSeats ?? 0}
            highlight={(billing?.bonusSeats ?? 0) > 0}
          />
          <Metric
            label="Exempt members"
            value={exempt.length}
            highlight={exempt.length > 0}
          />
          <Metric
            label="Current period end"
            value={fmtDate(billing?.currentPeriodEnd)}
          />
          <Metric
            label="Cancel at period end"
            value={billing?.cancelAtPeriodEnd ? "Yes" : "No"}
          />
          <Metric
            label="Stripe subscription"
            value={billing?.stripeSubscriptionId ?? "—"}
          />
        </div>

        {billing?.adminNote && (
          <p className="admin-note">
            <strong>Admin note:</strong> {billing.adminNote}
          </p>
        )}

        <BillingForm
          companyId={companyId}
          initialStatus={billing?.status ?? "none"}
          initialBonus={billing?.bonusSeats ?? 0}
          initialNote={billing?.adminNote ?? ""}
          busy={busy}
          onSubmit={(payload) =>
            run("billing", () => adminSetCompanyBilling(payload))
          }
        />

        {billing?.stripeSubscriptionId && (
          <div className="admin-actions">
            {billing.cancelAtPeriodEnd ? (
              <button
                className="btn btn-ghost"
                disabled={busy === "resume"}
                onClick={() =>
                  run("resume", () =>
                    adminResumeSubscription({
                      companyId,
                      reason: "admin UI",
                    })
                  )
                }
              >
                {busy === "resume" ? "Resuming…" : "Resume subscription"}
              </button>
            ) : (
              <>
                <button
                  className="btn btn-ghost"
                  disabled={busy === "cancelEop"}
                  onClick={() =>
                    run("cancelEop", () =>
                      adminForceCancelSubscription({
                        companyId,
                        atPeriodEnd: true,
                        reason: "admin UI",
                      })
                    )
                  }
                >
                  {busy === "cancelEop"
                    ? "Scheduling…"
                    : "Cancel at period end"}
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy === "cancelNow"}
                  onClick={() => {
                    if (
                      !confirm(
                        "Force-cancel this Stripe subscription immediately? The company will lose access."
                      )
                    ) {
                      return;
                    }
                    void run("cancelNow", () =>
                      adminForceCancelSubscription({
                        companyId,
                        atPeriodEnd: false,
                        reason: "admin UI",
                      })
                    );
                  }}
                >
                  {busy === "cancelNow" ? "Canceling…" : "Cancel now"}
                </button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Members</h2>
          <span className="admin-card__sub">
            {members.length} total ({activeSeats} billable)
          </span>
        </div>

        {members.length === 0 ? (
          <p>No members yet.</p>
        ) : (
          <div className="admin-members">
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                busy={busy === `seat:${m.userId}`}
                onGiftSeat={() =>
                  run(`seat:${m.userId}`, () =>
                    adminSetMemberSeatStatus({
                      companyId,
                      userId: m.userId,
                      seatStatus: "exempt",
                      reason: "admin UI",
                    })
                  )
                }
                onRevokeGift={() =>
                  run(`seat:${m.userId}`, () =>
                    adminSetMemberSeatStatus({
                      companyId,
                      userId: m.userId,
                      seatStatus: "active",
                      reason: "admin UI",
                    })
                  )
                }
                onTransferOwnership={() => {
                  if (
                    !confirm(
                      `Transfer ownership to ${
                        m.displayName || m.email
                      }? Current owners will be demoted to admin.`
                    )
                  ) {
                    return;
                  }
                  void run(`seat:${m.userId}`, () =>
                    adminTransferOwnership({
                      companyId,
                      newOwnerUserId: m.userId,
                      currentOwnerBehavior: "demoteToAdmin",
                      reason: "admin UI",
                    })
                  );
                }}
              />
            ))}
          </div>
        )}
      </section>

      {invites.length > 0 && (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Pending invites</h2>
            <span className="admin-card__sub">{invites.length}</span>
          </div>
          <ul className="admin-list">
            {invites.map((inv) => (
              <li key={inv.id} className="admin-list__item">
                <div>
                  <strong>{inv.email}</strong> · {inv.role}
                </div>
                <div className="admin-list__meta">
                  invited {fmtDate(inv.createdAt)} · expires{" "}
                  {fmtDate(inv.expiresAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`admin-metric${highlight ? " admin-metric--hot" : ""}`}>
      <div className="admin-metric__label">{label}</div>
      <div className="admin-metric__value">{value}</div>
    </div>
  );
}

function BillingForm({
  companyId,
  initialStatus,
  initialBonus,
  initialNote,
  busy,
  onSubmit,
}: {
  companyId: string;
  initialStatus: string;
  initialBonus: number;
  initialNote: string;
  busy: string | null;
  onSubmit: (payload: {
    companyId: string;
    status?: string;
    bonusSeats?: number;
    note?: string | null;
    reason?: string;
  }) => Promise<void>;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [bonus, setBonus] = useState<string>(String(initialBonus ?? 0));
  const [note, setNote] = useState(initialNote ?? "");

  useEffect(() => {
    setStatus(initialStatus);
    setBonus(String(initialBonus ?? 0));
    setNote(initialNote ?? "");
  }, [initialStatus, initialBonus, initialNote]);

  const dirty = useMemo(() => {
    return (
      status !== initialStatus ||
      Number(bonus) !== initialBonus ||
      note !== initialNote
    );
  }, [status, bonus, note, initialStatus, initialBonus, initialNote]);

  return (
    <form
      className="admin-form"
      onSubmit={(e) => {
        e.preventDefault();
        const payload: Parameters<typeof onSubmit>[0] = { companyId };
        if (status !== initialStatus)
          payload.status = status;
        if (Number(bonus) !== initialBonus)
          payload.bonusSeats = Math.max(0, Math.floor(Number(bonus) || 0));
        if (note !== initialNote) payload.note = note.trim() || null;
        void onSubmit(payload);
      }}
    >
      <div className="admin-form__row">
        <label className="admin-form__field">
          <span className="admin-form__label">Billing status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {BILLING_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {BILLING_STATUSES.find((s) => s.value === status)?.hint && (
            <span className="admin-form__hint">
              {BILLING_STATUSES.find((s) => s.value === status)!.hint}
            </span>
          )}
        </label>

        <label className="admin-form__field admin-form__field--short">
          <span className="admin-form__label">Gifted seats (+)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
          />
          <span className="admin-form__hint">
            Added on top of the Stripe seat count.
          </span>
        </label>
      </div>

      <label className="admin-form__field">
        <span className="admin-form__label">Admin note (shown on billing page)</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Gifted 2 seats — Q1 promo"
        />
      </label>

      <div className="admin-actions">
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!dirty || busy === "billing"}
        >
          {busy === "billing" ? "Saving…" : "Save billing"}
        </button>
      </div>
    </form>
  );
}

function MemberRow({
  member,
  busy,
  onGiftSeat,
  onRevokeGift,
  onTransferOwnership,
}: {
  member: CompanyMemberDoc;
  busy: boolean;
  onGiftSeat: () => void;
  onRevokeGift: () => void;
  onTransferOwnership: () => void;
}) {
  const isExempt = member.seatStatus === "exempt";
  const isOwner = member.role === "owner";
  const isActive = member.status === "active";

  return (
    <div className="admin-members__row">
      <div className="admin-members__who">
        <div className="admin-members__name">
          {member.displayName || member.email}
        </div>
        <div className="admin-members__meta">
          {member.email} · {member.role} · {member.status}
          {isExempt ? " · exempt (free seat)" : ""}
        </div>
      </div>
      <div className="admin-members__actions">
        {isActive && !isExempt && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onGiftSeat}
          >
            {busy ? "…" : "Gift seat"}
          </button>
        )}
        {isExempt && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onRevokeGift}
          >
            {busy ? "…" : "Revoke gift"}
          </button>
        )}
        {!isOwner && isActive && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onTransferOwnership}
          >
            Make owner
          </button>
        )}
      </div>
    </div>
  );
}
