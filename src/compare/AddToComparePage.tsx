import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { CatalogBrowser } from "../components/CatalogBrowser";
import { useMergedCatalog } from "../hooks/useMergedCatalog";
import {
  addJobComparisonOption,
  findJobById,
  prepareJobComparisonOptionFields,
  subscribeJob,
  subscribeOptionsForJob,
  updateJob,
} from "../services/compareQuoteFirestore";
import type { JobRecord } from "../types/compareQuote";
import type { CatalogItem } from "../types/catalog";
import type { JobComparisonOptionRecord } from "../types/compareQuote";
import { jobQuoteSquareFootage } from "../utils/quotedPrice";
import { AddPriceOptionModal } from "./AddPriceOptionModal";

export function AddToComparePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user, profileDisplayName } = useAuth();
  const { activeCompanyId } = useCompany();
  const nav = useNavigate();
  const { catalog, loadError, bumpOverlay, horusCatalog } = useMergedCatalog();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [jobOptions, setJobOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!jobId || !activeCompanyId) return;
    let cancelled = false;
    (async () => {
      const found = await findJobById(activeCompanyId, jobId);
      if (cancelled) return;
      if (!found) {
        setJob(null);
        setCustomerId(null);
        return;
      }
      setCustomerId(found.customerId);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, jobId]);

  useEffect(() => {
    if (!activeCompanyId || !customerId || !jobId) return;
    return subscribeJob(activeCompanyId, customerId, jobId, setJob);
  }, [activeCompanyId, customerId, jobId]);

  useEffect(() => {
    if (!activeCompanyId || !customerId || !jobId) return;
    return subscribeOptionsForJob(
      activeCompanyId,
      customerId,
      jobId,
      setJobOptions
    );
  }, [activeCompanyId, customerId, jobId]);

  if (!jobId) return <p className="compare-warning">Missing job.</p>;
  if (!activeCompanyId)
    return <p className="compare-warning">No active company selected.</p>;
  if (!job || !customerId) return <p className="product-sub">Loading job…</p>;

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
          const fields = await prepareJobComparisonOptionFields(
            activeCompanyId,
            customerId,
            job.id,
            user.uid,
            pendingItem,
            quoteBasisSqFt,
            payload
          );
          await addJobComparisonOption(activeCompanyId, customerId, job.id, {
            ...fields,
            ownerUserId: user.uid,
            createdByUserId: user.uid,
            createdByDisplayName: profileDisplayName ?? null,
            visibility: "company",
          });
          if (job.status === "draft") {
            await updateJob(activeCompanyId, customerId, job.id, {
              status: "comparing",
            });
          }
          setModalOpen(false);
          setPendingItem(null);
          nav(`/layout/jobs/${job.id}`);
        }}
      />
    </div>
  );
}
