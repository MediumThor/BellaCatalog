import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { CatalogBrowser } from "../components/CatalogBrowser";
import { useMergedCatalog } from "../hooks/useMergedCatalog";
import {
  getJob,
  prepareJobComparisonOptionFields,
  addJobComparisonOption,
  subscribeOptionsForJob,
  updateJob,
} from "../services/compareQuoteFirestore";
import type { CatalogItem } from "../types/catalog";
import type { JobComparisonOptionRecord } from "../types/compareQuote";
import { jobQuoteSquareFootage } from "../utils/quotedPrice";
import { AddPriceOptionModal } from "./AddPriceOptionModal";

export function AddToComparePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const { catalog, loadError, bumpOverlay, horusCatalog } = useMergedCatalog();
  const [job, setJob] = useState<Awaited<ReturnType<typeof getJob>>>(null);
  const [jobOptions, setJobOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      const j = await getJob(jobId);
      if (!cancelled) setJob(j);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !user?.uid) return;
    return subscribeOptionsForJob(jobId, user.uid, setJobOptions);
  }, [jobId, user?.uid]);

  if (!jobId) return <p className="compare-warning">Missing job.</p>;
  if (!job) return <p className="product-sub">Loading job…</p>;
  if (user?.uid !== job.ownerUserId) {
    return <p className="compare-warning">You do not have access to this job.</p>;
  }

  const quoteBasisSqFt = jobQuoteSquareFootage(job, jobOptions);

  return (
    <div className="compare-page compare-add-page">
      <nav className="compare-breadcrumb">
        <Link to={`/layout/jobs/${job.id}`}>← Job: {job.name}</Link>
      </nav>
      <h1 className="compare-title">Add catalog products to compare</h1>
      <p className="compare-lead">
        Same search, filters, and data as the main catalog — supplier list prices stay hidden. Open{" "}
        <strong>Catalog tools</strong> on the right and use <strong>Show quoted price</strong> to reveal
        estimated quoted $/sq ft when you need it. Pick a row, confirm the quote line in the dialog
        (calculations use the quoted install schedule), and it is saved on the job as a snapshot.
      </p>

      <CatalogBrowser
        catalog={catalog}
        loadError={loadError}
        bumpOverlay={bumpOverlay}
        horusCatalog={horusCatalog}
        pickMode
        pickLabel="Add to job"
        onPickItem={(item) => {
          setPendingItem(item);
          setModalOpen(true);
        }}
      />

      <AddPriceOptionModal
        open={modalOpen}
        item={pendingItem}
        quoteBasisSqFt={quoteBasisSqFt}
        onClose={() => {
          setModalOpen(false);
          setPendingItem(null);
        }}
        onConfirm={async (payload) => {
          if (!user?.uid || !pendingItem) return;
          const fields = await prepareJobComparisonOptionFields(user.uid, pendingItem, job.id, quoteBasisSqFt, payload);
          await addJobComparisonOption(user.uid, fields);
          if (job.status === "draft") {
            await updateJob(job.id, { status: "comparing" });
          }
          setModalOpen(false);
          setPendingItem(null);
          nav(`/layout/jobs/${job.id}`);
        }}
      />
    </div>
  );
}
