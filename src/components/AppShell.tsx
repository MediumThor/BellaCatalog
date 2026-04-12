import { memo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

function AppShellInner({ children }: Props) {
  return <div className="app-shell bella-app">{children}</div>;
}

export const AppShell = memo(AppShellInner);
