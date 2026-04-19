import { Link, Outlet } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { usePlatformAdmin } from "./PlatformAdminProvider";

/**
 * Gate for every route under `/admin`. Non-admins see a "Not found"
 * style page so the panel's existence isn't advertised.
 */
export function RequirePlatformAdmin() {
  const { isPlatformAdmin, loading } = usePlatformAdmin();

  if (loading) {
    return (
      <AppShell>
        <div className="auth-loading" aria-busy="true">
          Loading…
        </div>
      </AppShell>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <AppShell>
        <div className="admin-forbidden">
          <h1>Not available</h1>
          <p>
            The page you tried to open isn't available on your account.
          </p>
          <Link to="/" className="btn btn-primary">
            Back to app
          </Link>
        </div>
      </AppShell>
    );
  }

  return <Outlet />;
}
