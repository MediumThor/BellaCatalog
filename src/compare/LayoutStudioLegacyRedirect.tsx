import { Navigate, useParams } from "react-router-dom";

/** Old option-scoped URL → job layout with ?option= */
export function LayoutStudioLegacyRedirect() {
  const { jobId, optionId } = useParams<{ jobId: string; optionId: string }>();
  if (!jobId || !optionId) {
    return <Navigate to="/layout" replace />;
  }
  return <Navigate to={`/layout/jobs/${jobId}?option=${encodeURIComponent(optionId)}`} replace />;
}
