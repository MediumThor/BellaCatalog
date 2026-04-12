import { memo } from "react";

function FooterInner() {
  return (
    <footer className="app-footer">
      Bella Stone — internal wholesale catalog. Prices are subject to change; verify with vendor
      before ordering.
    </footer>
  );
}

export const Footer = memo(FooterInner);
