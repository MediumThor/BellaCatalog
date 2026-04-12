import { Outlet } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { LoginScreen } from "../components/LoginScreen";
import { useAuth } from "./AuthProvider";

/**
 * Layout route: shows login when signed out; otherwise renders child routes.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <AppShell>
        <div className="auth-loading" aria-busy="true">
          Loading…
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <Outlet />;
}
