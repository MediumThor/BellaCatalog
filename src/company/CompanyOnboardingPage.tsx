import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { US_STATES } from "../utils/usStates";
import { createCompanyWithOwner } from "./companyFirestore";
import { acceptInvite } from "./teamApi";
import {
  findPendingInvitesForEmail,
  type CompanyInviteDoc,
} from "./teamFirestore";
import { useCompany } from "./useCompany";

/**
 * Step 2 of the sign-up walkthrough. A signed-in user who doesn't yet own or
 * belong to a company lands here. Styled to match the premium login hero so
 * the experience is continuous.
 */
export function CompanyOnboardingPage() {
  const { user, profileDisplayName, signOut } = useAuth();
  const { refresh } = useCompany();

  const [companyName, setCompanyName] = useState("");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingInvites, setPendingInvites] = useState<CompanyInviteDoc[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);

  const canSubmit = companyName.trim().length > 0 && !busy;

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    (async () => {
      const rows = await findPendingInvitesForEmail(user.email ?? "");
      if (!cancelled) setPendingInvites(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  async function handleAcceptInvite(invite: CompanyInviteDoc) {
    setAccepting(invite.id);
    setError(null);
    try {
      await acceptInvite({ inviteId: invite.id });
      refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not accept invite. Please try again."
      );
      setAccepting(null);
    }
  }

  return (
    <div className="hero-auth">
      <div className="hero-auth__bg" aria-hidden="true">
        <div className="hero-auth__bg-veins" />
        <div className="hero-auth__bg-grain" />
      </div>

      <div className="hero-auth__inner">
        <section className="hero-auth__hero">
          <div className="hero-auth__eyebrow">Step 2 of 2</div>
          <h1 className="hero-auth__title">
            One last step.
            <br />
            <span className="hero-auth__title-accent">
              Name your workspace.
            </span>
          </h1>
          <p className="hero-auth__lede">
            Every catalog, price book, customer, and job in BellaCatalog lives
            inside a company workspace. You'll be the owner — invite teammates
            anytime after setup.
          </p>

          <ul className="hero-auth__features" aria-label="You'll get">
            <li>
              <span className="hero-auth__bullet" />
              Your private catalog + vendor price overrides
            </li>
            <li>
              <span className="hero-auth__bullet" />
              Branded, shareable layout quotes
            </li>
            <li>
              <span className="hero-auth__bullet" />
              Role-based access for your team
            </li>
          </ul>
        </section>

        <section
          className="hero-auth__panel"
          aria-label="Create your company"
        >
          <div className="hero-auth__card">
            <header className="hero-auth__brand">
              <div className="hero-auth__brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="26" height="26">
                  <defs>
                    <linearGradient
                      id="bella-mark-onboard"
                      x1="0"
                      y1="0"
                      x2="32"
                      y2="32"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0%" stopColor="#efd27a" />
                      <stop offset="100%" stopColor="#9a7a1a" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M16 2 L30 10 V22 L16 30 L2 22 V10 Z"
                    fill="none"
                    stroke="url(#bella-mark-onboard)"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 20 L16 10 L22 20 Z"
                    fill="url(#bella-mark-onboard)"
                    opacity="0.85"
                  />
                </svg>
              </div>
              <div>
                <div className="hero-auth__brand-name">Create your company</div>
                <div className="hero-auth__brand-sub">
                  {user?.email ?? "Signed in"}
                </div>
              </div>
            </header>

            {error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null}

            {pendingInvites.length > 0 ? (
              <div className="onboarding-invites" role="region" aria-label="Pending invites">
                <div className="onboarding-invites__title">
                  You've been invited
                </div>
                <p className="onboarding-invites__hint">
                  Join an existing workspace instead of creating a new one.
                </p>
                <ul className="onboarding-invites__list">
                  {pendingInvites.map((inv) => {
                    const label =
                      inv.companyName?.trim() ||
                      inv.displayName ||
                      inv.companyId;
                    return (
                      <li key={inv.id} className="onboarding-invites__row">
                        <div className="onboarding-invites__company">
                          {label}
                        </div>
                        <div className="onboarding-invites__meta">
                          Role: {inv.role}
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary onboarding-invites__btn"
                          disabled={accepting !== null}
                          onClick={() => void handleAcceptInvite(inv)}
                        >
                          {accepting === inv.id ? "Joining…" : `Join ${label}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="onboarding-invites__or">
                  <span>or create a new workspace below</span>
                </div>
              </div>
            ) : null}

            <form
              className="auth-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canSubmit) return;
                if (!user) {
                  setError("Not signed in.");
                  return;
                }
                setBusy(true);
                setError(null);
                try {
                  await createCompanyWithOwner({
                    name: companyName.trim(),
                    createdByUserId: user.uid,
                    ownerEmail: user.email ?? "",
                    ownerDisplayName:
                      profileDisplayName?.trim() || user.email || "Owner",
                    region: state
                      ? { country: "US", states: [state] }
                      : undefined,
                  });
                  refresh();
                } catch (err) {
                  const msg =
                    err instanceof Error
                      ? err.message
                      : "Failed to create company. Please try again.";
                  setError(msg);
                  setBusy(false);
                }
              }}
            >
              <label className="auth-field">
                <span className="auth-field__label">Company name</span>
                <input
                  className="auth-field__input"
                  type="text"
                  autoFocus
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </label>

              <label className="auth-field">
                <span className="auth-field__label">
                  Primary state (optional)
                </span>
                <select
                  className="auth-field__input"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  <option value="">Select a state…</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                className="btn btn-primary auth-submit"
                disabled={!canSubmit}
              >
                {busy ? "Creating your workspace…" : "Create company"}
              </button>

              <p className="hero-auth__switch">
                Signed in as the wrong user?{" "}
                <button
                  type="button"
                  className="hero-auth__switch-btn"
                  onClick={() => {
                    void signOut();
                  }}
                >
                  Sign out
                </button>
              </p>
            </form>
          </div>

          <p className="hero-auth__legal">
            Your workspace is private. Only people you invite can see your
            pricing, customers, or jobs.
          </p>
        </section>
      </div>
    </div>
  );
}
