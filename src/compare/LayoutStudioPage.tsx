import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PenSquare, Trash2, X } from "lucide-react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { CatalogItem } from "../types/catalog";
import { LayoutStudioScreen } from "./layoutStudio/components/LayoutStudioScreen";
import { PlaceWorkspace } from "./layoutStudio/components/PlaceWorkspace";
import { useResolvedLayoutSlabs } from "./layoutStudio/hooks/useResolvedLayoutSlabs";
import type { SavedJobLayoutPlan } from "./layoutStudio/types";
import { stripMaterialOptionIdsFromJobPlan } from "./layoutStudio/services/persistLayout";
import { slabsForOption } from "./layoutStudio/utils/slabDimensions";
import {
  addCatalogItemsToJobBatch,
  createCustomer,
  createJob,
  deleteCustomer,
  deleteJob,
  fetchOptionsForJob,
  getCustomer,
  getJob,
  subscribeCustomers,
  subscribeJob,
  subscribeJobsForCustomer,
  subscribeOptionsForJob,
  updateJob,
  updateJobComparisonOption,
  updateCustomer,
} from "../services/compareQuoteFirestore";
import {
  CUSTOMER_TYPE_OPTIONS,
  buildJobAreas,
  customerDisplayName,
  customerTypeLabel,
  normalizeCustomerType,
  jobAreasForJob,
  primaryAreaForJob,
  type CustomerRecord,
  type CustomerType,
  type JobAreaRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
  type LayoutAreaOptionState,
} from "../types/compareQuote";
import { CreateCustomerModal, type CustomerFormValues } from "./CreateCustomerModal";
import { CreateJobModal, type JobFormValues } from "./CreateJobModal";
import { AreaMaterialsCatalogModal } from "./AreaMaterialsCatalogModal";

type LayoutStudioCustomerFilter = "all" | CustomerType;

function customerToFormValues(customer: CustomerRecord): CustomerFormValues {
  return {
    customerType: normalizeCustomerType(customer.customerType),
    businessName: customer.businessName ?? "",
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    notes: customer.notes,
  };
}

function optionHasSavedPreviewPlacement(option: JobComparisonOptionRecord, areaId: string): boolean {
  return Boolean(option.layoutAreaStates?.[areaId]?.layoutStudioPlacement ?? option.layoutStudioPlacement);
}

function pickPreviewOption(
  jobRow: JobRecord,
  area: JobAreaRecord | null,
  options: JobComparisonOptionRecord[]
): JobComparisonOptionRecord | null {
  if (!area || options.length === 0) return null;
  const scopedOptions = Array.isArray(area.associatedOptionIds)
    ? options.filter((option) => area.associatedOptionIds?.includes(option.id))
    : options;
  const preferredIds = [area.selectedOptionId, jobRow.finalOptionId];
  const orderedCandidates: JobComparisonOptionRecord[] = [];

  for (const optionId of preferredIds) {
    if (!optionId) continue;
    const match =
      scopedOptions.find((option) => option.id === optionId) ?? options.find((option) => option.id === optionId);
    if (match && !orderedCandidates.some((option) => option.id === match.id)) {
      orderedCandidates.push(match);
    }
  }

  for (const option of [...scopedOptions, ...options]) {
    if (!orderedCandidates.some((candidate) => candidate.id === option.id)) {
      orderedCandidates.push(option);
    }
  }

  return orderedCandidates.find((option) => optionHasSavedPreviewPlacement(option, area.id)) ?? null;
}

function areaPreviewForOption(
  option: JobComparisonOptionRecord | null,
  areaId: string
): LayoutAreaOptionState | null {
  return option?.layoutAreaStates?.[areaId] ?? null;
}

function areaAssociatedOptions(area: JobAreaRecord | null, options: JobComparisonOptionRecord[]): JobComparisonOptionRecord[] {
  if (!area) return options;
  if (!Array.isArray(area.associatedOptionIds)) return options;
  const ids = new Set(area.associatedOptionIds);
  return options.filter((option) => ids.has(option.id));
}

function parseImportedAreaSource(
  sourceKey: string,
  jobs: JobRecord[]
): { job: JobRecord; area: JobAreaRecord } | null {
  if (!sourceKey) return null;
  const [sourceJobId, sourceAreaId] = sourceKey.split(":");
  if (!sourceJobId || !sourceAreaId) return null;
  const sourceJob = jobs.find((job) => job.id === sourceJobId);
  if (!sourceJob) return null;
  const sourceArea = jobAreasForJob(sourceJob).find((area) => area.id === sourceAreaId);
  if (!sourceArea?.layoutStudioPlan) return null;
  return { job: sourceJob, area: sourceArea };
}

function areaSinkSummaries(area: JobAreaRecord): string[] {
  const pieces = area.layoutStudioPlan?.pieces ?? [];
  return pieces.flatMap((piece) =>
    (piece.sinks ?? []).map((sink) => {
      const holeCount = sink.faucetHoleCount ?? 0;
      const holeLabel = `${holeCount} hole${holeCount === 1 ? "" : "s"}`;
      const spread = sink.spreadIn != null ? `${sink.spreadIn}" spread` : "spread —";
      return `${(sink.name ?? "").trim() || "Sink"} · ${holeLabel} · ${spread}`;
    })
  );
}

function SavedAreaLayoutPreview({
  plan,
  option,
  areaId,
}: {
  plan: SavedJobLayoutPlan;
  option: JobComparisonOptionRecord;
  areaId: string;
}) {
  const placement = option.layoutAreaStates?.[areaId]?.layoutStudioPlacement ?? option.layoutStudioPlacement ?? null;
  const layoutSlabs = useResolvedLayoutSlabs(option, placement?.slabClones ?? []);
  const resolvedSlabs = layoutSlabs.length > 0 ? layoutSlabs : slabsForOption(option);
  const workspaceKind: "blank" | "source" = plan.workspaceKind === "blank" ? "blank" : "source";
  const ppi = plan.calibration.pixelsPerInch;
  const previewPpi = workspaceKind === "blank" ? (ppi && ppi > 0 ? ppi : 1) : ppi;
  const [activeSlabId, setActiveSlabId] = useState<string | null>(resolvedSlabs[0]?.id ?? null);

  useEffect(() => {
    if (!resolvedSlabs.some((slab) => slab.id === activeSlabId)) {
      setActiveSlabId(resolvedSlabs[0]?.id ?? null);
    }
  }, [activeSlabId, resolvedSlabs]);

  if (workspaceKind === "source" && (!ppi || ppi <= 0)) {
    return (
      <div className="ls-entry-preview-empty">
        <p className="ls-muted">Set scale in Layout Studio before previewing saved dimensions.</p>
      </div>
    );
  }

  if (!placement) {
    return (
      <div className="ls-entry-preview-empty">
        <p className="ls-muted">This area does not have saved slab placement data yet.</p>
      </div>
    );
  }

  return (
    <div className="ls-entry-preview-canvas ls-entry-preview-canvas--slabs">
      <PlaceWorkspace
        slabs={resolvedSlabs}
        activeSlabId={activeSlabId ?? resolvedSlabs[0]?.id ?? null}
        onActiveSlab={setActiveSlabId}
        pieces={plan.pieces}
        placements={placement.placements}
        pixelsPerInch={previewPpi}
        selectedPieceId={null}
        onSelectPiece={() => {}}
        onPlacementChange={() => {}}
        readOnly
        showSlabTabs={resolvedSlabs.length > 1}
        showPieceLabels
        showPieceDimensions
        slabViewMode="column"
      />
    </div>
  );
}

export function LayoutStudioPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const optionFromQuery = searchParams.get("option");

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [jobsByCustomer, setJobsByCustomer] = useState<Record<string, JobRecord[]>>({});
  const [jobOptionsByJobId, setJobOptionsByJobId] = useState<Record<string, JobComparisonOptionRecord[]>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerTypeFilter, setCustomerTypeFilter] = useState<LayoutStudioCustomerFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedJobs, setExpandedJobs] = useState<Record<string, boolean>>({});
  const [previewTarget, setPreviewTarget] = useState<{ jobId: string; areaId: string } | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<{ jobId: string; areaId: string; optionId: string } | null>(null);
  const [areaMaterialsTarget, setAreaMaterialsTarget] = useState<{ jobId: string; areaId: string } | null>(null);
  const [areaMaterialsSaving, setAreaMaterialsSaving] = useState(false);
  const [areaMaterialsError, setAreaMaterialsError] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [areaModalJobId, setAreaModalJobId] = useState<string | null>(null);
  const [newAreaName, setNewAreaName] = useState("");
  const [copyPlanSource, setCopyPlanSource] = useState("");
  const [headerSearchSlot, setHeaderSearchSlot] = useState<HTMLElement | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<
    | { kind: "job"; jobId: string; jobName: string }
    | { kind: "area"; jobId: string; jobName: string; areaId: string; areaName: string }
    | null
  >(null);

  const [job, setJob] = useState<JobRecord | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasJobContext = Boolean(jobId);

  useLayoutEffect(() => {
    setHeaderSearchSlot(document.getElementById("catalog-header-search-root"));
  }, []);

  useEffect(() => {
    if (!user?.uid || hasJobContext) return;
    return subscribeCustomers(
      user.uid,
      (rows) => {
        setCustomers(rows);
        setSelectedCustomerId((prev) => prev ?? rows[0]?.id ?? null);
      },
      () => setLoadError("Could not load customers.")
    );
  }, [hasJobContext, user?.uid]);

  useEffect(() => {
    if (hasJobContext) return;
    setJob(null);
    setCustomer(null);
    setOptions([]);
    setLoadError(null);
    if (searchParams.size > 0) {
      setSearchParams(new URLSearchParams(), { replace: true });
    }
  }, [hasJobContext, searchParams, setSearchParams]);

  useEffect(() => {
    if (!user?.uid || hasJobContext || customers.length === 0) return;
    const unsubscribers = customers.map((customerRow) =>
      subscribeJobsForCustomer(
        customerRow.id,
        user.uid,
        (jobs) => {
          setJobsByCustomer((prev) => ({ ...prev, [customerRow.id]: jobs }));
        },
        () => setLoadError("Could not load jobs.")
      )
    );
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [customers, hasJobContext, user?.uid]);

  useEffect(() => {
    if (!user?.uid || hasJobContext) return;
    const jobs = Object.values(jobsByCustomer).flat();
    if (jobs.length === 0) {
      setJobOptionsByJobId({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      jobs.map(async (jobRow) => [jobRow.id, await fetchOptionsForJob(jobRow.id, user.uid)] as const)
    ).then((entries) => {
      if (cancelled) return;
      setJobOptionsByJobId(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [hasJobContext, jobsByCustomer, user?.uid]);

  useEffect(() => {
    if (!jobId || !hasJobContext) return;
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
  }, [hasJobContext, jobId]);

  useEffect(() => {
    if (!jobId || !user?.uid || !hasJobContext) return;
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
  }, [hasJobContext, jobId, user?.uid]);

  useEffect(() => {
    if (!jobId || !user?.uid || !hasJobContext) return;
    return subscribeOptionsForJob(jobId, user.uid, setOptions);
  }, [hasJobContext, jobId, user?.uid]);

  useEffect(() => {
    if (!hasJobContext || !job) return;
    const areas = jobAreasForJob(job);
    if (areas.length === 0) return;
    const areaFromQuery = searchParams.get("area");
    if (areaFromQuery && areas.some((area) => area.id === areaFromQuery)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("area", areas[0].id);
        return next;
      },
      { replace: true }
    );
  }, [hasJobContext, job, searchParams, setSearchParams]);

  useEffect(() => {
    if (!hasJobContext) return;
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
  }, [hasJobContext, job?.customerId]);

  const activeAreaIdFromQuery = searchParams.get("area");
  const jobAreas = hasJobContext && job ? jobAreasForJob(job) : [];
  const activeArea =
    hasJobContext && job
      ? (activeAreaIdFromQuery ? jobAreas.find((area) => area.id === activeAreaIdFromQuery) : null) ??
        primaryAreaForJob(job)
      : null;
  const defaultPlanCanvasExpanded = hasJobContext && location.pathname.startsWith("/layout/jobs/");

  const areaMaterialsJob =
    areaMaterialsTarget
      ? hasJobContext
        ? job?.id === areaMaterialsTarget.jobId
          ? job
          : null
        : Object.values(jobsByCustomer)
            .flat()
            .find((candidate) => candidate.id === areaMaterialsTarget.jobId) ?? null
      : null;
  const areaMaterialsArea =
    areaMaterialsTarget && areaMaterialsJob
      ? jobAreasForJob(areaMaterialsJob).find((area) => area.id === areaMaterialsTarget.areaId) ?? null
      : null;
  const activeAreaOptions = useMemo(() => areaAssociatedOptions(activeArea, options), [activeArea, options]);

  /** When options exist, ensure ?option= points at a valid id (default first or area-selected). */
  useEffect(() => {
    if (activeAreaOptions.length === 0) return;
    const valid = optionFromQuery && activeAreaOptions.some((o) => o.id === optionFromQuery);
    const areaSelected = activeArea?.selectedOptionId;
    if (
      areaSelected &&
      activeAreaOptions.some((option) => option.id === areaSelected) &&
      valid &&
      optionFromQuery === areaSelected
    ) {
      return;
    }
    if (!areaSelected && valid) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(
          "option",
          areaSelected && activeAreaOptions.some((option) => option.id === areaSelected)
            ? areaSelected
            : activeAreaOptions[0].id
        );
        return next;
      },
      { replace: true }
    );
  }, [activeArea?.selectedOptionId, activeAreaOptions, optionFromQuery, setSearchParams]);

  const activeOption = useMemo((): JobComparisonOptionRecord | null => {
    if (activeAreaOptions.length === 0) return null;
    if (optionFromQuery && activeAreaOptions.some((o) => o.id === optionFromQuery)) {
      return activeAreaOptions.find((o) => o.id === optionFromQuery) ?? null;
    }
    if (activeArea?.selectedOptionId && activeAreaOptions.some((o) => o.id === activeArea.selectedOptionId)) {
      return activeAreaOptions.find((o) => o.id === activeArea.selectedOptionId) ?? null;
    }
    return activeAreaOptions[0] ?? null;
  }, [activeArea?.selectedOptionId, activeAreaOptions, optionFromQuery]);

  const handleOptionChange = (nextId: string) => {
    if (hasJobContext && job && activeArea) {
      const nextAreas = jobAreasForJob(job).map((area) =>
        area.id === activeArea.id ? { ...area, selectedOptionId: nextId, updatedAt: new Date().toISOString() } : area
      );
      void updateJob(job.id, {
        areas: nextAreas,
        areaType: nextAreas.map((area) => area.name).join(", "),
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("option", nextId);
        return next;
      },
      { replace: true }
    );
  };

  const openAddMaterialsForActiveArea = () => {
    if (!job?.id || !activeArea?.id) return;
    setAreaMaterialsError(null);
    setAreaMaterialsTarget({ jobId: job.id, areaId: activeArea.id });
  };

  const removeMaterialFromActiveArea = (optionId: string) => {
    if (!job || !activeArea) return;
    const nextAssociatedOptionIds = activeAreaOptions
      .filter((option) => option.id !== optionId)
      .map((option) => option.id);
    const nextSelectedOptionId =
      activeArea.selectedOptionId === optionId ? nextAssociatedOptionIds[0] ?? null : activeArea.selectedOptionId ?? null;
    const nextAreas = jobAreasForJob(job).map((area) =>
      area.id === activeArea.id
        ? {
            ...area,
            associatedOptionIds: nextAssociatedOptionIds,
            selectedOptionId: nextSelectedOptionId,
            updatedAt: new Date().toISOString(),
          }
        : area
    );
    void updateJob(job.id, {
      areas: nextAreas,
      areaType: nextAreas.map((area) => area.name).join(", "),
    });
  };

  const handleAddMaterialsToArea = async (items: CatalogItem[]) => {
    if (!user?.uid) {
      setAreaMaterialsError("Sign in to add materials.");
      return;
    }
    if (!areaMaterialsTarget || !areaMaterialsArea || !areaMaterialsJob) {
      setAreaMaterialsError("Choose an area first.");
      return;
    }
    if (items.length === 0) {
      setAreaMaterialsError("Select at least one material.");
      return;
    }
    setAreaMaterialsSaving(true);
    setAreaMaterialsError(null);
    const existingOptions =
      hasJobContext && job?.id === areaMaterialsJob.id
        ? options
        : (jobOptionsByJobId[areaMaterialsJob.id] ?? []);
    const existingIds = new Set(existingOptions.map((option) => option.id));
    try {
      const result = await addCatalogItemsToJobBatch(user.uid, areaMaterialsJob, items);
      if (result.added === 0) {
        setAreaMaterialsError(result.failures[0]?.message ?? "Could not add materials.");
        return;
      }
      const refreshedOptions = await fetchOptionsForJob(areaMaterialsJob.id, user.uid);
      const latestJob = await getJob(areaMaterialsJob.id);
      const baseJobForAreaUpdate = latestJob ?? areaMaterialsJob;
      const latestArea =
        jobAreasForJob(baseJobForAreaUpdate).find((area) => area.id === areaMaterialsArea.id) ?? areaMaterialsArea;
      setJobOptionsByJobId((prev) => ({ ...prev, [areaMaterialsJob.id]: refreshedOptions }));
      if (hasJobContext && job?.id === areaMaterialsJob.id) {
        setOptions(refreshedOptions);
      }
      const addedOptions = refreshedOptions.filter((option) => !existingIds.has(option.id));
      const existingAssociatedOptionIds = Array.isArray(latestArea.associatedOptionIds)
        ? latestArea.associatedOptionIds
        : existingOptions.map((option) => option.id);
      const nextAssociatedOptionIds = Array.from(
        new Set([...existingAssociatedOptionIds, ...addedOptions.map((option) => option.id)])
      );
      const nextSelectedOptionId = latestArea.selectedOptionId ?? addedOptions[0]?.id ?? null;
      if (
        nextSelectedOptionId !== latestArea.selectedOptionId ||
        nextAssociatedOptionIds.join("|") !== (latestArea.associatedOptionIds ?? []).join("|")
      ) {
        const nextAreas = jobAreasForJob(baseJobForAreaUpdate).map((area) =>
          area.id === latestArea.id
            ? {
                ...area,
                associatedOptionIds: nextAssociatedOptionIds,
                selectedOptionId: nextSelectedOptionId,
                updatedAt: new Date().toISOString(),
              }
            : area
        );
        await updateJob(baseJobForAreaUpdate.id, {
          areas: nextAreas,
          areaType: nextAreas.map((area) => area.name).join(", "),
        });
      }
      if (result.failures.length > 0) {
        setLoadError(
          `Added ${result.added} material${result.added === 1 ? "" : "s"} to ${areaMaterialsArea.name}. ${result.failures.length} item${result.failures.length === 1 ? "" : "s"} could not be added.`
        );
      }
      setAreaMaterialsTarget(null);
      setAreaMaterialsError(null);
    } catch (error) {
      setAreaMaterialsError(error instanceof Error ? error.message : "Could not add materials.");
    } finally {
      setAreaMaterialsSaving(false);
    }
  };

  if (!hasJobContext) {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filteredCustomers = customers.filter((row) => {
      const matchesType =
        customerTypeFilter === "all" || normalizeCustomerType(row.customerType) === customerTypeFilter;
      if (!matchesType) return false;
      if (!normalizedQuery) return true;
      const fullName = `${row.businessName ?? ""} ${row.firstName} ${row.lastName}`.toLowerCase();
      const directCustomerMatch =
        fullName.includes(normalizedQuery) ||
        row.phone.toLowerCase().includes(normalizedQuery) ||
        row.email.toLowerCase().includes(normalizedQuery);
      if (directCustomerMatch) return true;
      const jobs = jobsByCustomer[row.id] ?? [];
      return jobs.some((j) => {
        const haystack = `${j.name} ${j.areaType} ${j.notes} ${j.assumptions}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });
    });
    const emptyCustomerMessage =
      customerTypeFilter === "all"
        ? "No customers match your search yet."
        : `No ${customerTypeLabel(customerTypeFilter).toLowerCase()} customers match your search yet.`;

    const activeCustomerId =
      selectedCustomerId && filteredCustomers.some((c) => c.id === selectedCustomerId)
        ? selectedCustomerId
        : (filteredCustomers[0]?.id ?? null);
    const activeCustomer = filteredCustomers.find((row) => row.id === activeCustomerId) ?? null;
    const editingCustomer = editingCustomerId ? customers.find((row) => row.id === editingCustomerId) ?? null : null;
    const activeJobs = activeCustomer ? jobsByCustomer[activeCustomer.id] ?? [] : [];
    const customerPlanSources = activeJobs.flatMap((customerJob) =>
      jobAreasForJob(customerJob)
        .filter((area) => area.layoutStudioPlan)
        .map((area) => ({
          key: `${customerJob.id}:${area.id}`,
          label: `${customerJob.name} - ${area.name}`,
          plan: area.layoutStudioPlan,
        }))
    );
    const visibleJobs = activeJobs.filter((j) => {
      if (!normalizedQuery) return true;
      return `${j.name} ${j.areaType} ${j.notes} ${j.assumptions}`.toLowerCase().includes(normalizedQuery);
    });
    const previewJob =
      (previewTarget
        ? activeJobs.find((jobRow) => jobRow.id === previewTarget.jobId) ??
          Object.values(jobsByCustomer)
            .flat()
            .find((jobRow) => jobRow.id === previewTarget.jobId) ??
          null
        : null) ?? null;
    const previewArea =
      previewTarget && previewJob
        ? jobAreasForJob(previewJob).find((area) => area.id === previewTarget.areaId) ?? null
        : null;
    const previewOption =
      previewJob && previewArea ? pickPreviewOption(previewJob, previewArea, jobOptionsByJobId[previewJob.id] ?? []) : null;

    return (
      <>
        <div className="ls-entry-dashboard">
        <aside className="ls-entry-sidebar glass-panel">
          <div className="ls-entry-sidebar-head">
            <div className="ls-entry-sidebar-head-main">
              <p className="ls-entry-sidebar-label">Customers</p>
              <div className="ls-entry-sidebar-filter-row">
                <div className="view-toggle ls-entry-customer-filter" role="group" aria-label="Customer type filter">
                  {[{ value: "all", label: "All" }, ...CUSTOMER_TYPE_OPTIONS].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="btn view-toggle__btn"
                      data-active={customerTypeFilter === option.value}
                      aria-pressed={customerTypeFilter === option.value}
                      onClick={() => setCustomerTypeFilter(option.value as LayoutStudioCustomerFilter)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ls-entry-sidebar-add"
                  aria-label="Create customer"
                  title="Create customer"
                  onClick={() => setCustomerModalOpen(true)}
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="ls-entry-sidebar-list">
            {filteredCustomers.map((row) => {
              const name = customerDisplayName(row);
              const isActive = row.id === activeCustomerId;
              const typeLabel = customerTypeLabel(row.customerType);
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`ls-entry-sidebar-item${isActive ? " is-active" : ""}`}
                  onClick={() => setSelectedCustomerId(row.id)}
                >
                  <span className="ls-entry-sidebar-item-name">{name || "Unnamed customer"}</span>
                  <span className="ls-entry-sidebar-item-meta">
                    {typeLabel} · {(jobsByCustomer[row.id] ?? []).length} jobs
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="ls-entry-main glass-panel">
          {!activeCustomer ? (
            <p className="ls-muted">{emptyCustomerMessage}</p>
          ) : (
            <div className="ls-entry-customer-head">
              <div className="ls-entry-customer-head-copy">
                <div className="ls-entry-customer-title-row">
                  <h3 className="ls-entry-customer-name">{customerDisplayName(activeCustomer)}</h3>
                  <button
                    type="button"
                    className="ls-entry-icon-btn"
                    aria-label={`Edit customer ${customerDisplayName(activeCustomer)}`}
                    title="Edit customer"
                    onClick={() => {
                      if (activeCustomer) {
                        setEditingCustomerId(activeCustomer.id);
                      }
                    }}
                  >
                    <PenSquare aria-hidden="true" />
                  </button>
                </div>
                <ul className="ls-entry-customer-meta">
                  {activeCustomer.phone.trim() ? <li>{activeCustomer.phone}</li> : null}
                  {activeCustomer.email.trim() ? <li>{activeCustomer.email}</li> : null}
                  {!activeCustomer.phone.trim() && !activeCustomer.email.trim() ? <li>No phone or email</li> : null}
                  <li>{customerTypeLabel(activeCustomer.customerType)}</li>
                </ul>
              </div>
              <div className="ls-entry-customer-head-actions">
                <button
                  type="button"
                  className="ls-btn ls-btn-primary"
                  onClick={() => setJobModalOpen(true)}
                >
                  Create job
                </button>
              </div>
            </div>
          )}

          {activeCustomer ? (
            <div className="ls-entry-job-list">
              {visibleJobs.map((jobRow) => {
                const isExpanded = Boolean(expandedJobs[jobRow.id]);
                const areas = jobAreasForJob(jobRow);
                const jobOptions = jobOptionsByJobId[jobRow.id] ?? [];
                return (
                  <article key={jobRow.id} className={`ls-entry-job-card${isExpanded ? " is-expanded" : ""}`}>
                    <div
                      className="ls-entry-job-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedJobs((prev) => ({
                          ...prev,
                          [jobRow.id]: !prev[jobRow.id],
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setExpandedJobs((prev) => ({
                            ...prev,
                            [jobRow.id]: !prev[jobRow.id],
                          }));
                        }
                      }}
                    >
                      <div className="ls-entry-job-summary">
                        <h3 className="ls-entry-job-title">{jobRow.name}</h3>
                        <p className="ls-entry-job-subtitle">
                          {areas.length} area{areas.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="ls-entry-job-actions">
                        <button
                          type="button"
                          className="ls-entry-icon-btn"
                          aria-label={`Edit ${jobRow.name}`}
                          title="Edit job details"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingJobId(jobRow.id);
                          }}
                        >
                          <PenSquare aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="ls-entry-icon-btn ls-entry-icon-btn--danger"
                          aria-label={`Delete job ${jobRow.name}`}
                          title="Delete job"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmState({ kind: "job", jobId: jobRow.id, jobName: jobRow.name });
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="ls-btn ls-btn-outline-accent"
                          onClick={(event) => {
                            event.stopPropagation();
                            setAreaModalJobId(jobRow.id);
                            setNewAreaName("");
                            setCopyPlanSource("");
                          }}
                        >
                          Add area
                        </button>
                      </div>
                    </div>

                    <div className={`ls-entry-job-drawer${isExpanded ? " is-open" : ""}`}>
                      <div className="ls-entry-job-drawer-inner">
                        <p className="ls-entry-detail-line">
                          <strong>Contact:</strong> {jobRow.contactName || "Not set"}
                          {jobRow.contactPhone ? ` · ${jobRow.contactPhone}` : ""}
                        </p>
                        <p className="ls-entry-detail-line">
                          <strong>Address:</strong> {jobRow.siteAddress || "Not set"}
                        </p>
                        <p className="ls-entry-detail-line">
                          <strong>Quote notes:</strong> {jobRow.notes || "No quote notes yet."}
                        </p>
                        <p className="ls-entry-detail-label">Areas</p>
                        <div className="ls-entry-area-list">
                          {areas.map((area) => {
                            const areaOptions = jobOptions;
                            const areaOption =
                              areaOptions.find(
                                (option) => areaPreviewForOption(option, area.id)?.layoutPreviewImageUrl
                              ) ?? pickPreviewOption(jobRow, area, areaOptions);
                            const areaState = areaPreviewForOption(areaOption, area.id);
                            const areaMaterialOptions = areaAssociatedOptions(area, areaOptions);
                            const quoteableAreaMaterialOptions = areaMaterialOptions.filter((option) =>
                              Boolean(
                                areaPreviewForOption(option, area.id)?.layoutPreviewImageUrl ||
                                  areaPreviewForOption(option, area.id)?.layoutStudioPlacement
                              )
                            );
                            const sinkSummaries = areaSinkSummaries(area);
                            return (
                              <div key={area.id} className="ls-entry-area-row">
                                <div className="ls-entry-area-header">
                                  <h4 className="ls-entry-area-title">{area.name}</h4>
                                  <button
                                    type="button"
                                    className="ls-entry-icon-btn ls-entry-icon-btn--danger"
                                    disabled={areas.length <= 1}
                                    aria-label={`Delete area ${area.name}`}
                                    title={areas.length <= 1 ? "Delete the job instead" : "Delete area"}
                                    onClick={() =>
                                      setConfirmState({
                                        kind: "area",
                                        jobId: jobRow.id,
                                        jobName: jobRow.name,
                                        areaId: area.id,
                                        areaName: area.name,
                                      })
                                    }
                                  >
                                    <Trash2 aria-hidden="true" />
                                  </button>
                                </div>
                                <div className="ls-entry-area-head">
                                  <div className="ls-entry-area-copy">
                                    <div className="ls-entry-area-meta-list">
                                      <div className="ls-entry-area-materials">
                                        <span className="ls-entry-area-meta-label">Materials</span>
                                        {areaMaterialOptions.length > 0 ? (
                                          <div className="ls-entry-material-pill-list">
                                            {areaMaterialOptions.map((option) => (
                                              <span
                                                key={`${area.id}-${option.id}`}
                                                className={`ls-entry-material-pill${
                                                  area.selectedOptionId === option.id ? " is-active" : ""
                                                }`}
                                              >
                                                <span className="ls-entry-material-pill-label">{option.productName}</span>
                                                <button
                                                  type="button"
                                                  className="ls-entry-material-pill-remove"
                                                  aria-label={`Remove ${option.productName} from ${area.name}`}
                                                  title={`Remove ${option.productName} from ${area.name}`}
                                                  onClick={() => {
                                                    const nextAssociatedOptionIds = areaMaterialOptions
                                                      .filter((candidate) => candidate.id !== option.id)
                                                      .map((candidate) => candidate.id);
                                                    const nextSelectedOptionId =
                                                      area.selectedOptionId === option.id
                                                        ? nextAssociatedOptionIds[0] ?? null
                                                        : area.selectedOptionId ?? null;
                                                    const nextAreas = jobAreasForJob(jobRow).map((candidate) =>
                                                      candidate.id === area.id
                                                        ? {
                                                            ...candidate,
                                                            associatedOptionIds: nextAssociatedOptionIds,
                                                            selectedOptionId: nextSelectedOptionId,
                                                            updatedAt: new Date().toISOString(),
                                                          }
                                                        : candidate
                                                    );
                                                    void updateJob(jobRow.id, {
                                                      areas: nextAreas,
                                                      areaType: nextAreas.map((candidate) => candidate.name).join(", "),
                                                    });
                                                  }}
                                                >
                                                  <X aria-hidden="true" />
                                                </button>
                                              </span>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="ls-entry-area-meta-value">No materials associated yet</span>
                                        )}
                                      </div>
                                      {sinkSummaries.length ? (
                                        <div className="ls-entry-area-sinks">
                                          <span className="ls-entry-area-meta-label">Sinks</span>
                                          {sinkSummaries.map((summary) => (
                                            <span key={`${area.id}-${summary}`} className="ls-entry-area-sink-line">
                                              {summary}
                                            </span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="ls-entry-area-head-actions">
                                    {areaState?.layoutPreviewImageUrl ? (
                                      <span className="ls-entry-area-status">Saved layout available</span>
                                    ) : null}
                                    <div className="ls-entry-area-actions-main">
                                      <button
                                        type="button"
                                        className="ls-btn ls-btn-secondary"
                                        onClick={() => {
                                          setAreaMaterialsError(null);
                                          setAreaMaterialsTarget({ jobId: jobRow.id, areaId: area.id });
                                        }}
                                      >
                                        Add materials
                                      </button>
                                      <button
                                        type="button"
                                        className="ls-btn ls-btn-secondary"
                                        onClick={() =>
                                          navigate(`/layout/jobs/${jobRow.id}?area=${encodeURIComponent(area.id)}`)
                                        }
                                      >
                                        Open studio
                                      </button>
                                      <button
                                        type="button"
                                        className="ls-btn ls-btn-secondary"
                                        disabled={!areaState?.layoutPreviewImageUrl}
                                        onClick={() => setPreviewTarget({ jobId: jobRow.id, areaId: area.id })}
                                      >
                                        {areaState?.layoutPreviewImageUrl ? "Preview layout" : "No saved layout"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                {quoteableAreaMaterialOptions.length > 0 ? (
                                  <div className="ls-entry-area-actions">
                                    <div className="ls-entry-area-actions-divider" aria-hidden="true" />
                                    <div className="ls-entry-area-actions-quotes">
                                      {quoteableAreaMaterialOptions.map((option) => (
                                        <button
                                          key={`${area.id}-${option.id}-quote`}
                                          type="button"
                                          className="ls-btn ls-btn-secondary"
                                          title={`Open PDF quote preview for ${option.productName}`}
                                          onClick={() =>
                                            setQuoteTarget({ jobId: jobRow.id, areaId: area.id, optionId: option.id })
                                          }
                                        >
                                          PDF quote: {option.productName}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {visibleJobs.length === 0 ? <p className="ls-muted">No jobs match your search for this customer.</p> : null}
            </div>
          ) : null}
        </section>

        {previewTarget ? (
          <div className="ls-entry-modal-backdrop" onClick={() => setPreviewTarget(null)} role="presentation">
            <div className="ls-entry-preview-modal glass-panel" onClick={(event) => event.stopPropagation()}>
              <div className="ls-entry-modal-head">
                <h3 className="ls-entry-modal-title">Saved layout preview</h3>
                <button type="button" className="ls-btn ls-btn-ghost" onClick={() => setPreviewTarget(null)}>
                  Close
                </button>
              </div>
              {previewArea?.layoutStudioPlan && previewOption ? (
                <>
                  <SavedAreaLayoutPreview
                    plan={previewArea.layoutStudioPlan}
                    option={previewOption}
                    areaId={previewArea.id}
                  />
                  <p className="ls-muted ls-entry-preview-note">
                    Preview shows the saved slab layout with piece labels, sink cutouts, splash, and miter strips.
                  </p>
                </>
              ) : (
                <div className="ls-entry-preview-empty">
                  <p className="ls-muted">This job does not have a saved slab layout yet.</p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {quoteTarget ? (
          <div className="ls-entry-modal-backdrop" onClick={() => setQuoteTarget(null)} role="presentation">
            <div className="ls-entry-modal glass-panel" onClick={(event) => event.stopPropagation()}>
              <div className="ls-entry-modal-head">
                <h3 className="ls-entry-modal-title">Quote Preview</h3>
                <button type="button" className="ls-btn ls-btn-ghost" onClick={() => setQuoteTarget(null)}>
                  Close
                </button>
              </div>
              <iframe
                title="Job quote preview"
                className="ls-entry-modal-frame"
                src={`/layout/jobs/${quoteTarget.jobId}/quote?area=${encodeURIComponent(quoteTarget.areaId)}&option=${encodeURIComponent(quoteTarget.optionId)}`}
              />
            </div>
          </div>
        ) : null}

        <AreaMaterialsCatalogModal
          open={Boolean(areaMaterialsTarget && areaMaterialsArea)}
          areaName={areaMaterialsArea?.name ?? "Area"}
          saving={areaMaterialsSaving}
          error={areaMaterialsError}
          onClose={() => {
            if (areaMaterialsSaving) return;
            setAreaMaterialsTarget(null);
            setAreaMaterialsError(null);
          }}
          onAddMaterials={handleAddMaterialsToArea}
        />

        <CreateCustomerModal
          open={customerModalOpen}
          onClose={() => setCustomerModalOpen(false)}
          onSubmit={async (values: CustomerFormValues) => {
            if (!user?.uid) throw new Error("Not signed in");
            const customerId = await createCustomer(user.uid, {
              customerType: values.customerType,
              businessName: values.businessName.trim(),
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              phone: values.phone.trim(),
              email: values.email.trim(),
              address: values.address.trim(),
              notes: values.notes.trim(),
            });
            setSelectedCustomerId(customerId);
          }}
        />

        <CreateCustomerModal
          open={Boolean(editingCustomer)}
          initialValues={editingCustomer ? customerToFormValues(editingCustomer) : null}
          onClose={() => setEditingCustomerId(null)}
          onDelete={async () => {
            if (!editingCustomer || !user?.uid) throw new Error("Choose a customer first.");
            await deleteCustomer(editingCustomer.id, user.uid);
            setSelectedCustomerId((prev) => (prev === editingCustomer.id ? null : prev));
          }}
          onSubmit={async (values: CustomerFormValues) => {
            if (!editingCustomer) throw new Error("Choose a customer first.");
            await updateCustomer(editingCustomer.id, {
              customerType: values.customerType,
              businessName: values.businessName.trim(),
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              phone: values.phone.trim(),
              email: values.email.trim(),
              address: values.address.trim(),
              notes: values.notes.trim(),
            });
          }}
        />

        <CreateJobModal
          open={jobModalOpen}
          onClose={() => setJobModalOpen(false)}
          onSubmit={async (values: JobFormValues) => {
            if (!user?.uid) throw new Error("Not signed in");
            if (!activeCustomerId) throw new Error("Choose a customer first.");
            const initialAreaName = values.name.trim();
            const createdJobId = await createJob(user.uid, {
              customerId: activeCustomerId,
              name: initialAreaName,
              contactName: values.contactName.trim(),
              contactPhone: values.contactPhone.trim(),
              siteAddress: values.siteAddress.trim(),
              areaType: initialAreaName,
              areas: buildJobAreas(initialAreaName),
              squareFootage: 0,
              notes: values.notes.trim(),
              assumptions: values.assumptions.trim(),
              status: "draft",
              dxfAttachmentUrl: null,
              drawingAttachmentUrl: null,
            });
            setExpandedJobs((prev) => ({ ...prev, [createdJobId]: true }));
          }}
        />

        <CreateJobModal
          open={Boolean(editingJobId)}
          onClose={() => setEditingJobId(null)}
          initialValues={
            editingJobId
              ? (() => {
                  const editingJob = Object.values(jobsByCustomer)
                    .flat()
                    .find((candidate) => candidate.id === editingJobId);
                  return editingJob
                    ? {
                        name: editingJob.name,
                        contactName: editingJob.contactName ?? "",
                        contactPhone: editingJob.contactPhone ?? "",
                        siteAddress: editingJob.siteAddress ?? "",
                        areaType: editingJob.areaType,
                        notes: editingJob.notes,
                        assumptions: editingJob.assumptions,
                      }
                    : null;
                })()
              : null
          }
          onSubmit={async (values: JobFormValues) => {
            if (!editingJobId) throw new Error("Missing job.");
            await updateJob(editingJobId, {
              name: values.name.trim(),
              contactName: values.contactName.trim(),
              contactPhone: values.contactPhone.trim(),
              siteAddress: values.siteAddress.trim(),
              notes: values.notes.trim(),
              assumptions: values.assumptions.trim(),
            });
            setEditingJobId(null);
          }}
        />

        {areaModalJobId ? (
          <div className="ls-entry-modal-backdrop" role="presentation" onClick={() => setAreaModalJobId(null)}>
            <div className="ls-entry-area-modal glass-panel" onClick={(event) => event.stopPropagation()}>
              <div className="ls-entry-modal-head">
                <h3 className="ls-entry-modal-title">Add area</h3>
                <button type="button" className="ls-btn ls-btn-ghost" onClick={() => setAreaModalJobId(null)}>
                  Close
                </button>
              </div>
              <label className="ls-field">
                Area name
                <input
                  className="ls-input"
                  value={newAreaName}
                  onChange={(event) => setNewAreaName(event.target.value)}
                  placeholder="Kitchen, Vanity, Basement Bar"
                />
              </label>
              <label className="ls-field">
                Import another plan from this customer
                <select
                  className="ls-input"
                  value={copyPlanSource}
                  onChange={(event) => setCopyPlanSource(event.target.value)}
                >
                  <option value="">Start with a blank area</option>
                  {customerPlanSources.map((source) => (
                    <option key={source.key} value={source.key}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ls-modal-actions">
                <button type="button" className="ls-btn ls-btn-secondary" onClick={() => setAreaModalJobId(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="ls-btn ls-btn-primary"
                  onClick={async () => {
                    const targetJob = Object.values(jobsByCustomer)
                      .flat()
                      .find((candidate) => candidate.id === areaModalJobId);
                    if (!targetJob || !newAreaName.trim()) return;
                    const createdAt = new Date().toISOString();
                    const existingAreas = jobAreasForJob(targetJob);
                    const importSource = parseImportedAreaSource(copyPlanSource, activeJobs);
                    const sameJobImport = importSource?.job.id === targetJob.id;
                    const targetJobOptions = jobOptionsByJobId[targetJob.id] ?? [];
                    const targetJobOptionIds = targetJobOptions.map((option) => option.id);
                    const importLinkedOptionIds =
                      sameJobImport && importSource
                        ? targetJobOptions
                            .filter((option) => Boolean(option.layoutAreaStates?.[importSource.area.id]))
                            .map((option) => option.id)
                        : [];
                    const importedAssociatedOptionIds =
                      !importSource
                        ? []
                        : sameJobImport
                        ? Array.isArray(importSource.area.associatedOptionIds) &&
                          importSource.area.associatedOptionIds.length > 0
                          ? importSource.area.associatedOptionIds.filter((optionId) =>
                              targetJobOptions.some((option) => option.id === optionId)
                            )
                          : importLinkedOptionIds
                        : targetJobOptionIds;
                    const importedSelectedOptionId =
                      sameJobImport &&
                      importSource?.area.selectedOptionId &&
                      importedAssociatedOptionIds.includes(importSource.area.selectedOptionId)
                        ? importSource.area.selectedOptionId
                        : importedAssociatedOptionIds[0] ?? null;
                    const importedPlanBase: SavedJobLayoutPlan | null = importSource?.area.layoutStudioPlan
                      ? {
                          ...structuredClone(importSource.area.layoutStudioPlan),
                          updatedAt: createdAt,
                        }
                      : null;
                    const importedPlan =
                      importedPlanBase && !sameJobImport
                        ? stripMaterialOptionIdsFromJobPlan(importedPlanBase)
                        : importedPlanBase;
                    const createdAreas = buildJobAreas(newAreaName.trim(), createdAt).map((area, index) => ({
                      ...area,
                      id: `${area.id}-${existingAreas.length + index + 1}`,
                      associatedOptionIds: sameJobImport ? [...importedAssociatedOptionIds] : area.associatedOptionIds,
                      selectedOptionId: sameJobImport ? importedSelectedOptionId : area.selectedOptionId,
                      layoutStudioPlan: importedPlan,
                    }));
                    const nextAreas = [
                      ...existingAreas,
                      ...createdAreas,
                    ];
                    await updateJob(targetJob.id, {
                      areas: nextAreas,
                      areaType: nextAreas.map((area) => area.name).join(", "),
                    });
                    if (sameJobImport && importSource) {
                      const optionUpdates = targetJobOptions.flatMap((option) => {
                        const sourceAreaState = option.layoutAreaStates?.[importSource.area.id];
                        if (!sourceAreaState) return [];
                        const nextLayoutAreaStates = {
                          ...(option.layoutAreaStates ?? {}),
                        };
                        for (const area of createdAreas) {
                          nextLayoutAreaStates[area.id] = structuredClone(sourceAreaState);
                        }
                        return [{ optionId: option.id, layoutAreaStates: nextLayoutAreaStates }];
                      });
                      await Promise.all(
                        optionUpdates.map(({ optionId, layoutAreaStates }) =>
                          updateJobComparisonOption(optionId, { layoutAreaStates })
                        )
                      );
                    }
                    setExpandedJobs((prev) => ({ ...prev, [targetJob.id]: true }));
                    setAreaModalJobId(null);
                    setNewAreaName("");
                    setCopyPlanSource("");
                  }}
                >
                  Save area
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ConfirmDialog
          open={Boolean(confirmState)}
          title={
            confirmState?.kind === "job"
              ? "Delete job?"
              : confirmState?.kind === "area"
                ? "Delete area?"
                : ""
          }
          message={
            confirmState?.kind === "job"
              ? `Delete ${confirmState.jobName}? This cannot be undone.`
              : confirmState?.kind === "area"
                ? `Delete ${confirmState.areaName} from ${confirmState.jobName}? This cannot be undone.`
                : ""
          }
          confirmLabel={confirmState?.kind === "job" ? "Delete job" : "Delete area"}
          cancelLabel="Cancel"
          danger
          onCancel={() => setConfirmState(null)}
          onConfirm={() => {
            if (!confirmState || !user?.uid) return;
            if (confirmState.kind === "job") {
              void (async () => {
                await deleteJob(confirmState.jobId, user.uid);
                setConfirmState(null);
              })();
              return;
            }
            void (async () => {
              const targetJob = Object.values(jobsByCustomer)
                .flat()
                .find((candidate) => candidate.id === confirmState.jobId);
              if (!targetJob) {
                setConfirmState(null);
                return;
              }
              const nextAreas = jobAreasForJob(targetJob).filter((area) => area.id !== confirmState.areaId);
              await updateJob(targetJob.id, {
                areas: nextAreas,
                areaType: nextAreas.map((area) => area.name).join(", "),
              });
              setConfirmState(null);
            })();
          }}
        />
        </div>
        {headerSearchSlot
          ? createPortal(
              <input
                className="ls-input ls-entry-search ls-entry-search--header"
                placeholder="Search customers, jobs, areas..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />,
              headerSearchSlot
            )
          : null}
      </>
    );
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
        <Link className="btn btn-ghost" to={`/layout/jobs/${jobId}`}>
          ← Back to job
        </Link>
      </div>
    );
  }

  return (
    <>
      <LayoutStudioScreen
        job={job}
        customer={customer}
        activeAreaId={activeArea?.id ?? null}
        activeAreaName={activeArea?.name ?? null}
        options={activeAreaOptions}
        activeOption={activeOption}
        onOptionChange={handleOptionChange}
        onRemoveMaterialOption={removeMaterialFromActiveArea}
        onOpenAddMaterials={openAddMaterialsForActiveArea}
        ownerUserId={user.uid}
        onBack={() => navigate("/layout", { replace: true })}
        defaultPlanCanvasExpanded={defaultPlanCanvasExpanded}
      />
      <AreaMaterialsCatalogModal
        open={Boolean(areaMaterialsTarget && areaMaterialsArea)}
        areaName={areaMaterialsArea?.name ?? "Area"}
        saving={areaMaterialsSaving}
        error={areaMaterialsError}
        onClose={() => {
          if (areaMaterialsSaving) return;
          setAreaMaterialsTarget(null);
          setAreaMaterialsError(null);
        }}
        onAddMaterials={handleAddMaterialsToArea}
      />
    </>
  );
}
