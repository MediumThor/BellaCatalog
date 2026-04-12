import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { LayoutStudioScreen } from "./layoutStudio/components/LayoutStudioScreen";
import {
  getCustomer,
  getJob,
  subscribeJob,
  subscribeOptionsForJob,
} from "../services/compareQuoteFirestore";
import type { CustomerRecord, JobComparisonOptionRecord, JobRecord } from "../types/compareQuote";

export function LayoutStudioPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const optionFromQuery = searchParams.get("option");

  const [job, setJob] = useState<JobRecord | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      const j = await getJob(jobId);
      if (cancelled) return;
      if (!j) {
        setLoadError("Job not found.");
        setJob(null);
        return;
      }
      setJob(j);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !user?.uid) return;
    return subscribeJob(
      jobId,
      user.uid,
      (row) => {
        if (!row) {
          setLoadError("Job not found.");
          setJob(null);
          return;
        }
        setJob(row);
        setLoadError(null);
      },
      () => setLoadError("Could not load job.")
    );
  }, [jobId, user?.uid]);

  useEffect(() => {
    if (!jobId || !user?.uid) return;
    return subscribeOptionsForJob(jobId, user.uid, setOptions);
  }, [jobId, user?.uid]);

  useEffect(() => {
    if (!job?.customerId) {
      setCustomer(null);
      return;
    }
    let cancelled = false;
    void getCustomer(job.customerId).then((c) => {
      if (!cancelled) setCustomer(c);
    });
    return () => {
      cancelled = true;
    };
  }, [job?.customerId]);

  /** When options exist, ensure ?option= points at a valid id (default first). */
  useEffect(() => {
    if (options.length === 0) return;
    const valid = optionFromQuery && options.some((o) => o.id === optionFromQuery);
    if (valid) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("option", options[0].id);
        return next;
      },
      { replace: true }
    );
  }, [options, optionFromQuery, setSearchParams]);

  const activeOption = useMemo((): JobComparisonOptionRecord | null => {
    if (options.length === 0) return null;
    if (optionFromQuery && options.some((o) => o.id === optionFromQuery)) {
      return options.find((o) => o.id === optionFromQuery) ?? null;
    }
    return options[0] ?? null;
  }, [options, optionFromQuery]);

  const handleOptionChange = (nextId: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("option", nextId);
        return next;
      },
      { replace: true }
    );
  };

  if (!jobId) {
    return <p className="compare-warning">Missing job.</p>;
  }
  if (!job) {
    return loadError ? <p className="compare-warning">{loadError}</p> : <p className="product-sub">Loading…</p>;
  }
  if (user?.uid !== job.ownerUserId) {
    return <p className="compare-warning">You do not have access to this job.</p>;
  }
  if (loadError) {
    return (
      <div className="compare-page">
        <p className="compare-warning">{loadError}</p>
        <Link className="btn btn-ghost" to={`/compare/jobs/${jobId}`}>
          ← Back to job
        </Link>
      </div>
    );
  }

  return (
    <LayoutStudioScreen
      job={job}
      customer={customer}
      options={options}
      activeOption={activeOption}
      onOptionChange={handleOptionChange}
      ownerUserId={user.uid}
      onBack={() => navigate(`/compare/jobs/${jobId}`)}
    />
  );
}
