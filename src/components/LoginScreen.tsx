import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { createCompanyWithOwner } from "../company/companyFirestore";
import { acceptInvite } from "../company/teamApi";
import { useCompany } from "../company/useCompany";

type TabId = "signin" | "create" | "join";

/**
 * Normalize an invite code to the canonical alphabet that
 * `generateInviteToken` emits in `functions/src/members/helpers.ts`
 * (uppercase, no `O`/`I`/`0`/`1`). Strips spaces/dashes a teammate
 * may have pasted in by accident.
 */
function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

function friendlyAuthError(code: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/email-already-in-use":
      return "An account already exists for that email. Use Sign in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a few minutes.";
    case "auth/user-disabled":
      return "This account is disabled.";
    case "auth/operation-not-allowed":
      return "Account creation is disabled for this workspace.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: unknown }).code ?? "");
  }
  return "";
}

export function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const { refresh } = useCompany();

  const [tab, setTab] = useState<TabId>("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sign in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Create company state
  const [createFullName, setCreateFullName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createCompanyName, setCreateCompanyName] = useState("");
  const [createState, setCreateState] = useState("");

  // Join with code state
  const [joinCode, setJoinCode] = useState("");
  const [joinFullName, setJoinFullName] = useState("");
  const [joinEmail, setJoinEmail] = useState("");
  const [joinPassword, setJoinPassword] = useState("");

  const canSignIn = useMemo(
    () => email.trim().length > 0 && password.length > 0 && !busy,
    [email, password, busy]
  );

  const canCreate = useMemo(
    () =>
      createEmail.trim().length > 0 &&
      createPassword.length >= 6 &&
      createCompanyName.trim().length > 0 &&
      !busy,
    [createEmail, createPassword, createCompanyName, busy]
  );

  const canJoin = useMemo(
    () =>
      joinCode.trim().length >= 6 &&
      joinEmail.trim().length > 0 &&
      joinPassword.length >= 6 &&
      !busy,
    [joinCode, joinEmail, joinPassword, busy]
  );

  const switchTab = (next: TabId) => {
    if (next === tab) return;
    setTab(next);
    setError(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSignIn) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(friendlyAuthError(errorCode(err)));
      setBusy(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const user = await signUp({
        email: createEmail.trim(),
        password: createPassword,
        displayName: createFullName.trim() || undefined,
      });
      await createCompanyWithOwner({
        name: createCompanyName.trim(),
        createdByUserId: user.uid,
        ownerEmail: user.email ?? createEmail.trim(),
        ownerDisplayName: createFullName.trim() || user.email || "Owner",
        region: createState.trim()
          ? { country: "US", states: [createState.trim().toUpperCase()] }
          : undefined,
      });
      refresh();
      // Auth state change will bring them into the app automatically.
    } catch (err) {
      setError(friendlyAuthError(errorCode(err)));
      setBusy(false);
    }
  };

  /**
   * "Join with code" flow:
   *   1. Sign up (or sign in if the email already has an account).
   *   2. Call `acceptInvite({ token })` — the backend resolves the
   *      invite by `(auth.email, token)` and writes our active membership.
   * If the email already exists, the password the user typed must match
   * the existing account; otherwise we surface the standard auth error.
   */
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canJoin) return;
    const code = normalizeInviteCode(joinCode);
    const trimmedEmail = joinEmail.trim();
    if (!code) {
      setError("Enter the invite code your admin sent you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      try {
        await signUp({
          email: trimmedEmail,
          password: joinPassword,
          displayName: joinFullName.trim() || undefined,
        });
      } catch (err) {
        if (errorCode(err) === "auth/email-already-in-use") {
          // They already have a BellaCatalog account — sign them in
          // with the password they just typed and consume the invite.
          await signIn(trimmedEmail, joinPassword);
        } else {
          throw err;
        }
      }
      try {
        await acceptInvite({ token: code });
      } catch (err) {
        // If invite acceptance fails (wrong code / expired / wrong email)
        // the user is now signed in but unaffiliated. Surface a clear
        // message so they know to retry from /settings or contact their
        // admin instead of staring at a blank shell.
        const msg =
          err instanceof Error
            ? err.message
            : "Could not accept that invite.";
        setError(msg);
        setBusy(false);
        return;
      }
      refresh();
      // Auth state change brings them into their new workspace.
    } catch (err) {
      setError(friendlyAuthError(errorCode(err)));
      setBusy(false);
    }
  };

  return (
    <div className="hero-auth">
      <div className="hero-auth__bg" aria-hidden="true">
        <div className="hero-auth__bg-veins" />
        <div className="hero-auth__bg-grain" />
      </div>

      <div className="hero-auth__inner">
        <section className="hero-auth__hero">
          <div className="hero-auth__eyebrow">BellaCatalog</div>
          <h1 className="hero-auth__title">
            Premium stone.
            <br />
            <span className="hero-auth__title-accent">
              Priced, laid out, quoted.
            </span>
          </h1>
          <p className="hero-auth__lede">
            A private workspace for stone shops &amp; fabricators. Keep your
            catalog, vendor price books, customers, and jobs in one elegant
            place — and hand customers a beautifully branded quote every time.
          </p>

          <ul className="hero-auth__features" aria-label="Features">
            <li>
              <span className="hero-auth__bullet" />
              Global slab library with your private price overrides
            </li>
            <li>
              <span className="hero-auth__bullet" />
              AI-assisted vendor price-sheet imports
            </li>
            <li>
              <span className="hero-auth__bullet" />
              Layout Studio → branded, shareable quotes
            </li>
          </ul>
        </section>

        <section className="hero-auth__panel" aria-label="Sign in or create company">
          <div className="hero-auth__card">
            <header className="hero-auth__brand">
              <div className="hero-auth__brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="26" height="26">
                  <defs>
                    <linearGradient id="bella-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#efd27a" />
                      <stop offset="100%" stopColor="#9a7a1a" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M16 2 L30 10 V22 L16 30 L2 22 V10 Z"
                    fill="none"
                    stroke="url(#bella-mark)"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 20 L16 10 L22 20 Z"
                    fill="url(#bella-mark)"
                    opacity="0.85"
                  />
                </svg>
              </div>
              <div>
                <div className="hero-auth__brand-name">BellaCatalog</div>
                <div className="hero-auth__brand-sub">Wholesale stone platform</div>
              </div>
            </header>

            <div className="hero-auth__tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "signin"}
                className={`hero-auth__tab${tab === "signin" ? " hero-auth__tab--active" : ""}`}
                onClick={() => switchTab("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "create"}
                className={`hero-auth__tab${tab === "create" ? " hero-auth__tab--active" : ""}`}
                onClick={() => switchTab("create")}
              >
                Create company
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "join"}
                className={`hero-auth__tab${tab === "join" ? " hero-auth__tab--active" : ""}`}
                onClick={() => switchTab("join")}
              >
                Join with code
              </button>
            </div>

            {error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null}

            {tab === "signin" ? (
              <form className="auth-form" onSubmit={handleSignIn}>
                <label className="auth-field">
                  <span className="auth-field__label">Email</span>
                  <input
                    className="auth-field__input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Password</span>
                  <input
                    className="auth-field__input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={!canSignIn}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
                <p className="hero-auth__switch">
                  New to BellaCatalog?{" "}
                  <button
                    type="button"
                    className="hero-auth__switch-btn"
                    onClick={() => switchTab("create")}
                  >
                    Create a company
                  </button>
                </p>
                <p className="hero-auth__switch">
                  Got an invite code?{" "}
                  <button
                    type="button"
                    className="hero-auth__switch-btn"
                    onClick={() => switchTab("join")}
                  >
                    Join your team
                  </button>
                </p>
              </form>
            ) : tab === "create" ? (
              <form className="auth-form" onSubmit={handleCreate}>
                <p className="hero-auth__walkthrough">
                  Create your owner account and workspace in one step. You can
                  invite teammates after sign-in.
                </p>
                <label className="auth-field">
                  <span className="auth-field__label">Your full name</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    autoComplete="name"
                    value={createFullName}
                    onChange={(e) => setCreateFullName(e.target.value)}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Work email</span>
                  <input
                    className="auth-field__input"
                    type="email"
                    autoComplete="email"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Password (min 6)</span>
                  <input
                    className="auth-field__input"
                    type="password"
                    autoComplete="new-password"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Company name</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={createCompanyName}
                    onChange={(e) => setCreateCompanyName(e.target.value)}
                    required
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Primary state (optional)</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={createState}
                    onChange={(e) => setCreateState(e.target.value)}
                    maxLength={2}
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={!canCreate}
                >
                  {busy ? "Creating your workspace…" : "Create company"}
                </button>
                <p className="hero-auth__switch">
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="hero-auth__switch-btn"
                    onClick={() => switchTab("signin")}
                  >
                    Sign in
                  </button>
                </p>
                <p className="hero-auth__switch">
                  Joining an existing company?{" "}
                  <button
                    type="button"
                    className="hero-auth__switch-btn"
                    onClick={() => switchTab("join")}
                  >
                    Use an invite code
                  </button>
                </p>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleJoin}>
                <p className="hero-auth__walkthrough">
                  Got an invite code from your owner or admin? Paste it
                  below with your work email and a password — we'll add
                  you to the right workspace automatically.
                </p>
                <label className="auth-field">
                  <span className="auth-field__label">Invite code</span>
                  <input
                    className="auth-field__input hero-auth__code"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="text"
                    spellCheck={false}
                    value={joinCode}
                    onChange={(e) =>
                      setJoinCode(normalizeInviteCode(e.target.value))
                    }
                    placeholder="e.g. K7Q3HRMNZ4"
                    required
                  />
                  <span className="auth-field__help">
                    The 10-character code from your invite email or chat.
                  </span>
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">
                    Your full name{" "}
                    <span className="auth-field__optional">· optional</span>
                  </span>
                  <input
                    className="auth-field__input"
                    type="text"
                    autoComplete="name"
                    value={joinFullName}
                    onChange={(e) => setJoinFullName(e.target.value)}
                    placeholder="Jane Doe"
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">
                    Work email (must match the invite)
                  </span>
                  <input
                    className="auth-field__input"
                    type="email"
                    autoComplete="email"
                    value={joinEmail}
                    onChange={(e) => setJoinEmail(e.target.value)}
                    required
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Password (min 6)</span>
                  <input
                    className="auth-field__input"
                    type="password"
                    autoComplete="new-password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                  <span className="auth-field__help">
                    If you already have a BellaCatalog account, use that
                    password and we'll just attach you to the workspace.
                  </span>
                </label>
                <button
                  type="submit"
                  className="btn btn-primary auth-submit"
                  disabled={!canJoin}
                >
                  {busy ? "Joining your team…" : "Join team"}
                </button>
                <p className="hero-auth__switch">
                  No invite yet?{" "}
                  <button
                    type="button"
                    className="hero-auth__switch-btn"
                    onClick={() => switchTab("create")}
                  >
                    Create your own company
                  </button>
                </p>
              </form>
            )}
          </div>

          <p className="hero-auth__legal">
            By continuing you agree to use BellaCatalog responsibly. Data is
            scoped per company. Manufacturer images are shared; vendor pricing
            stays private to your company.
          </p>
        </section>
      </div>
    </div>
  );
}
