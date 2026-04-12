import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";

function friendlyAuthError(code: string) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a few minutes.";
    case "auth/user-disabled":
      return "This account is disabled.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => email.trim().length > 0 && password.length > 0, [email, password]);

  return (
    <div className="auth-page">
      <div className="auth-card" role="region" aria-label="Sign in">
        <div className="auth-brand">
          <div className="auth-brand__title">Bella Stone</div>
          <div className="auth-brand__subtitle">Wholesale Catalog</div>
        </div>

        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Use the email/password you were given.</p>

        {error ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit || busy) return;
            setBusy(true);
            setError(null);
            try {
              await signIn(email.trim(), password);
            } catch (err) {
              const code = err && typeof err === "object" && "code" in err ? String((err as any).code) : "";
              setError(friendlyAuthError(code));
              setBusy(false);
            }
          }}
        >
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              className="auth-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          <button type="submit" className="btn btn-primary auth-submit" disabled={!canSubmit || busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

