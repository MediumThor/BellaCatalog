import { Navigate, useLocation, useParams } from "react-router-dom";

type CompareLegacyRedirectTarget = "root" | "customer" | "job" | "jobAdd" | "jobQuote" | "jobLayout";

type Props = {
  target: CompareLegacyRedirectTarget;
};

export function CompareLegacyRedirect({ target }: Props) {
  const { jobId } = useParams<{ jobId: string }>();
  const { search } = useLocation();

  switch (target) {
    case "root":
    case "customer":
      return <Navigate to="/layout" replace />;
    case "job":
      return <Navigate to={jobId ? `/layout/jobs/${encodeURIComponent(jobId)}${search}` : "/layout"} replace />;
    case "jobAdd":
      return (
        <Navigate
          to={jobId ? `/layout/jobs/${encodeURIComponent(jobId)}/add${search}` : "/layout"}
          replace
        />
      );
    case "jobQuote":
      return (
        <Navigate
          to={jobId ? `/layout/jobs/${encodeURIComponent(jobId)}/quote${search}` : "/layout"}
          replace
        />
      );
    case "jobLayout":
      return <Navigate to={jobId ? `/layout/jobs/${encodeURIComponent(jobId)}${search}` : "/layout"} replace />;
  }
}
