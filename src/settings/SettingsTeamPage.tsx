import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { CompanyMemberDoc, CompanyRole } from "../company/types";
import { useCompany } from "../company/useCompany";
import {
  inviteMember,
  revokeInvite,
  setMemberCommission,
  setMemberStatus,
  updateMemberRole,
} from "../company/teamApi";
import {
  subscribeCompanyInvites,
  subscribeCompanyMembers,
  type CompanyInviteDoc,
} from "../company/teamFirestore";

const ROLE_LABELS: Record<CompanyRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  sales: "Sales",
  viewer: "Viewer",
};

const ROLE_HINTS: Record<CompanyRole, string> = {
  owner: "Full control, including billing and ownership transfers.",
  admin: "Manage teammates, billing, catalog, and jobs.",
  manager: "Manage catalog and price books; can't change billing or team.",
  sales: "Create jobs and quotes; can't edit the catalog.",
  viewer: "Read-only access for back-office or contractors.",
};

const ASSIGNABLE_ROLES: CompanyRole[] = [
  "owner",
  "admin",
  "manager",
  "sales",
  "viewer",
];

function formatDate(ts: unknown): string {
  if (
    !ts ||
    typeof ts !== "object" ||
    !("toDate" in (ts as Record<string, unknown>))
  ) {
    return "—";
  }
  try {
    return (ts as { toDate: () => Date })
      .toDate()
      .toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
  } catch {
    return "—";
  }
}

function statusTone(
  status: CompanyMemberDoc["status"]
): { label: string; tone: "good" | "warn" | "bad" | "info" } {
  switch (status) {
    case "active":
      return { label: "Active", tone: "good" };
    case "invited":
      return { label: "Invited", tone: "info" };
    case "disabled":
      return { label: "Disabled", tone: "warn" };
    case "removed":
      return { label: "Removed", tone: "bad" };
  }
}

export function SettingsTeamPage() {
  const { user } = useAuth();
  const {
    activeCompany,
    activeCompanyId,
    permissions,
    role: myRole,
  } = useCompany();

  const [members, setMembers] = useState<CompanyMemberDoc[]>([]);
  const [invites, setInvites] = useState<CompanyInviteDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("sales");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId) return;
    const unsub = subscribeCompanyMembers(
      activeCompanyId,
      (rows) => {
        setMembers(rows);
        setError(null);
      },
      (e) => setError(e.message)
    );
    return unsub;
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    const unsub = subscribeCompanyInvites(
      activeCompanyId,
      (rows) => setInvites(rows),
      (e) => setError(e.message)
    );
    return unsub;
  }, [activeCompanyId]);

  const visibleMembers = useMemo(
    () =>
      members.filter((m) => (showRemoved ? true : m.status !== "removed")),
    [members, showRemoved]
  );

  const activeSeatCount = useMemo(
    () => members.filter((m) => m.status === "active" && m.consumesSeat).length,
    [members]
  );
  const invitedCount = invites.length;
  const seatLimit = activeCompany?.billing?.seatLimit ?? activeSeatCount;
  const seatsOverLimit = activeSeatCount + invitedCount > seatLimit;

  if (!permissions.canManageUsers) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Team</h1>
        <p className="settings-page__lede">
          You don't have permission to manage teammates. Ask an owner or admin
          for access.
        </p>
      </div>
    );
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setInviting(true);
    setError(null);
    setInviteMsg(null);
    try {
      const res = await inviteMember({
        companyId: activeCompanyId,
        email,
        role: inviteRole,
        displayName: inviteName.trim() || undefined,
      });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("sales");
      setInviteMsg(
        res.pendingAuthUser
          ? `Invite sent to ${email}. They'll see it next time they sign in.`
          : `Invite created for ${email}. Share this code with them: ${res.token}`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create invite."
      );
    } finally {
      setInviting(false);
    }
  }

  async function handleRevokeInvite(invite: CompanyInviteDoc) {
    if (!activeCompanyId) return;
    if (!confirm(`Revoke invite for ${invite.email}?`)) return;
    setError(null);
    try {
      await revokeInvite({ companyId: activeCompanyId, inviteId: invite.id });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not revoke invite."
      );
    }
  }

  async function handleRoleChange(
    member: CompanyMemberDoc,
    nextRole: CompanyRole
  ) {
    if (!activeCompanyId) return;
    if (member.role === nextRole) return;
    if (nextRole === "owner" && !confirm(
      `Promote ${member.displayName || member.email} to Owner? They will gain full control, including billing.`
    )) {
      return;
    }
    setBusyUserId(member.userId);
    setError(null);
    try {
      await updateMemberRole({
        companyId: activeCompanyId,
        userId: member.userId,
        role: nextRole,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not change role."
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleCommissionChange(
    member: CompanyMemberDoc,
    raw: string
  ) {
    if (!activeCompanyId) return;
    const trimmed = raw.trim();
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setError("Commission must be between 0 and 100.");
        return;
      }
      next = parsed;
    }
    const current = member.commissionPercent ?? null;
    if (next === current) return;
    setBusyUserId(member.userId);
    setError(null);
    try {
      await setMemberCommission({
        companyId: activeCompanyId,
        userId: member.userId,
        commissionPercent: next,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update commission."
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleStatusChange(
    member: CompanyMemberDoc,
    nextStatus: "active" | "disabled" | "removed"
  ) {
    if (!activeCompanyId) return;
    const action =
      nextStatus === "removed"
        ? "Remove"
        : nextStatus === "disabled"
        ? "Disable"
        : "Re-enable";
    const target = member.displayName || member.email;
    if (
      nextStatus !== "active" &&
      !confirm(
        nextStatus === "removed"
          ? `Remove ${target} from the company? They will lose access immediately and their seat will be freed.`
          : `Disable ${target}? They will lose access immediately but their history is kept.`
      )
    ) {
      return;
    }
    setBusyUserId(member.userId);
    setError(null);
    try {
      await setMemberStatus({
        companyId: activeCompanyId,
        userId: member.userId,
        status: nextStatus,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed.`);
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">Team</h1>
        <p className="settings-page__lede">
          Invite teammates to {activeCompany?.name ?? "your workspace"},
          manage their roles, and revoke access the moment they leave.
        </p>
      </header>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Seats</h2>
          <p className="settings-card__hint">
            {activeSeatCount} active · {invitedCount} pending · {seatLimit} on
            plan.{" "}
            {seatsOverLimit ? (
              <>
                You're over your plan limit.{" "}
                <Link to="/settings/billing">Add seats in Billing</Link>.
              </>
            ) : (
              <Link to="/settings/billing">Manage billing</Link>
            )}
          </p>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Invite a teammate</h2>
          <p className="settings-card__hint">
            They'll use this email to sign in. If they already have a
            BellaCatalog account, they'll see the invite on their next
            visit. Otherwise, share the invite code we show you and point
            them to the sign-up page.
          </p>
        </div>
        <form className="settings-form" onSubmit={handleInvite}>
          <div className="settings-form__row">
            <label className="auth-field">
              <span className="auth-field__label">Email</span>
              <input
                className="auth-field__input"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">
                Display name{" "}
                <span className="auth-field__optional">· optional</span>
              </span>
              <input
                className="auth-field__input"
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jane Doe"
              />
            </label>
            <label className="auth-field">
              <span className="auth-field__label">Role</span>
              <select
                className="auth-field__input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as CompanyRole)}
              >
                {ASSIGNABLE_ROLES.filter((r) => r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <span className="auth-field__help">
                {ROLE_HINTS[inviteRole]}
              </span>
            </label>
          </div>
          <div className="settings-form__actions">
            {inviteMsg ? (
              <span className="settings-inline-msg settings-inline-msg--good">
                {inviteMsg}
              </span>
            ) : null}
            {error ? (
              <span className="settings-inline-msg settings-inline-msg--bad">
                {error}
              </span>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={inviting}
            >
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
      </section>

      {invites.length > 0 ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Pending invites</h2>
            <p className="settings-card__hint">
              These teammates have an invite but haven't joined yet.
            </p>
          </div>
          <ul className="team-list">
            {invites.map((inv) => (
              <li key={inv.id} className="team-row">
                <div className="team-row__main">
                  <div className="team-row__name">
                    {inv.displayName || inv.email}
                  </div>
                  <div className="team-row__meta">
                    {inv.email} · {ROLE_LABELS[inv.role]} · expires{" "}
                    {formatDate(inv.expiresAt)}
                  </div>
                  {inv.token ? (
                    <div className="team-row__meta">
                      Code: <code>{inv.token}</code>
                    </div>
                  ) : null}
                </div>
                <div className="team-row__actions">
                  <span className="billing-status billing-status--info">
                    Pending
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void handleRevokeInvite(inv)}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Members</h2>
          <p className="settings-card__hint">
            Change roles, pause access, or remove teammates who have left.
            {" "}
            <label className="settings-form__checkbox settings-form__checkbox--inline">
              <input
                type="checkbox"
                checked={showRemoved}
                onChange={(e) => setShowRemoved(e.target.checked)}
              />
              <span>Show removed</span>
            </label>
          </p>
        </div>
        <ul className="team-list">
          {visibleMembers.map((member) => {
            const status = statusTone(member.status);
            const isSelf = user?.uid === member.userId;
            const isBusy = busyUserId === member.userId;
            const roleLocked =
              (member.role === "owner" && myRole !== "owner") || isBusy;
            return (
              <li key={member.userId} className="team-row">
                <div className="team-row__main">
                  <div className="team-row__name">
                    {member.displayName || member.email || "Teammate"}
                    {isSelf ? (
                      <span className="team-row__you"> · you</span>
                    ) : null}
                  </div>
                  <div className="team-row__meta">
                    {member.email}
                    {member.joinedAt
                      ? ` · joined ${formatDate(member.joinedAt)}`
                      : null}
                  </div>
                </div>
                <div className="team-row__actions">
                  <span
                    className={`billing-status billing-status--${status.tone}`}
                  >
                    {status.label}
                  </span>
                  <select
                    className="auth-field__input team-row__role"
                    value={member.role}
                    disabled={roleLocked}
                    onChange={(e) =>
                      void handleRoleChange(
                        member,
                        e.target.value as CompanyRole
                      )
                    }
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <label
                    className="team-row__commission"
                    title="Flat commission % on gross sales. Leave blank for non-commissionable roles."
                  >
                    <span className="team-row__commission-label">Comm %</span>
                    <input
                      className="auth-field__input team-row__commission-input"
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      defaultValue={
                        member.commissionPercent == null
                          ? ""
                          : String(member.commissionPercent)
                      }
                      disabled={isBusy}
                      onBlur={(e) =>
                        void handleCommissionChange(member, e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                  </label>
                  {member.status === "active" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isSelf || isBusy}
                        onClick={() =>
                          void handleStatusChange(member, "disabled")
                        }
                        title={
                          isSelf
                            ? "You can't disable your own membership."
                            : "Disable access without removing history."
                        }
                      >
                        Disable
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={isSelf || isBusy}
                        onClick={() =>
                          void handleStatusChange(member, "removed")
                        }
                      >
                        Remove
                      </button>
                    </>
                  ) : member.status === "disabled" ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={isBusy}
                        onClick={() =>
                          void handleStatusChange(member, "active")
                        }
                      >
                        Re-enable
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={isBusy}
                        onClick={() =>
                          void handleStatusChange(member, "removed")
                        }
                      >
                        Remove
                      </button>
                    </>
                  ) : member.status === "invited" ? (
                    <span className="team-row__meta">
                      Waiting for them to sign in
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
          {visibleMembers.length === 0 ? (
            <li className="team-row team-row--empty">
              No teammates yet — invite your first one above.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
