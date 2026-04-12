import { Navigate, useParams } from "react-router-dom";

/** Old option-scoped URL → job layout with ?option= */
export function LayoutStudioLegacyRedirect() {
  const { jobId, optionId } = useParams<{ jobId: string; optionId: string }>();
  if (!jobId || !optionId) {
    return <Navigate to="/compare" replace />;
  }
  return <Navigate to={`/compare/jobs/${jobId}/layout?option=${encodeURIComponent(optionId)}`} replace />;
}
