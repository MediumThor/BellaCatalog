import { memo } from "react";

type Props = {
  /** Active company name; retained for API compatibility with existing callers. */
  companyName?: string | null;
};

function FooterInner(_props: Props) {
  return null;
}

export const Footer = memo(FooterInner);
