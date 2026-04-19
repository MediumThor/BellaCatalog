import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import {
  approveJobAreaQuote,
  assignJobRep,
  clearJobAreaQuoteApproval,
  deleteJobComparisonOption,
  findJobById,
  setJobFinalOption,
  subscribeCustomer,
  subscribeJob,
  subscribeOptionsForJob,
} from "../services/compareQuoteFirestore";
import { subscribeCompanyMembers } from "../company/teamFirestore";
import type { CompanyMemberDoc } from "../company/types";
import {
  customerDisplayName,
  jobAreasForJob,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABELS,
  normalizeJobStatus,
  type CustomerRecord,
  type JobAreaRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
} from "../types/compareQuote";
import {
  computeCurrentLayoutQuoteForOption,
  type CurrentLayoutStudioQuote,
} from "./layoutStudio/utils/currentQuote";
import { formatMoney } from "../utils/priceHelpers";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SlabThumbnailLightbox } from "../components/SlabThumbnailLightbox";
import { useJobCollaboration } from "./useJobCollaboration";
import { JobCollaborationBanner } from "./JobCollaborationBanner";
import { JobPaymentsPanel } from "../commissions/JobPaymentsPanel";
import { IconBack } from "./layoutStudio/components/PlanToolbarIcons";
import { PlaceLayoutPreview } from "./layoutStudio/components/PlaceLayoutPreview";
import type { SavedJobLayoutPlan } from "./layoutStudio/types";

function areaAssociatedOptions(
  area: JobAreaRecord,
  options: JobComparisonOptionRecord[]
): JobComparisonOptionRecord[] {
  if (!Array.isArray(area?.associatedOptionIds)) return options;
  const ids = new Set(area.associatedOptionIds);
  return options.filter((option) => ids.has(option.id));
}

/**
 * Resolve the layout preview snapshot for a given area+option pair, falling
 * back to the option-level preview for legacy single-area jobs.
 */
function previewUrlForAreaOption(
  area: JobAreaRecord,
  option: JobComparisonOptionRecord
): string | null {
  return (
    option.layoutAreaStates?.[area.id]?.layoutPreviewImageUrl ??
    option.layoutPreviewImageUrl ??
    null
  );
}

/**
 * One-line preview rendered inside the Job details `<summary>` so reps can
 * tell at a glance whether the collapsible has anything worth opening
 * without expanding it.
 */
function jobDetailSummaryLine(job: JobRecord): string {
  const bits: string[] = [];
  const notes = job.notes?.trim();
  const assumptions = job.assumptions?.trim();
  const hasAttachments = Boolean(
    job.dxfAttachmentUrl?.trim() || job.drawingAttachmentUrl?.trim()
  );
  if (notes) {
    const trimmed = notes.length > 60 ? `${notes.slice(0, 60).trimEnd()}…` : notes;
    bits.push(`Notes: ${trimmed}`);
  }
  if (assumptions) bits.push("Assumptions saved");
  if (hasAttachments) bits.push("Attachments");
  if (bits.length === 0) return "Empty — click to add notes & assumptions";
  return bits.join(" · ");
}

/**
 * "Quoted" === the rep has actually built a layout for this area+option pair
 * in Layout Studio (we have either a saved placement or a rendered preview).
 * Approval — i.e. marking it as the customer's chosen material — should be
 * gated on this so reps can't approve a material they haven't priced yet.
 */
function isOptionQuotedForArea(
  area: JobAreaRecord,
  option: JobComparisonOptionRecord,
  jobAreaCount: number
): boolean {
  const areaState = option.layoutAreaStates?.[area.id];
  if (areaState?.layoutPreviewImageUrl || areaState?.layoutStudioPlacement) {
    return true;
  }
  // Legacy single-area jobs stored layout state at the option root.
  if (
    jobAreaCount === 1 &&
    (option.layoutPreviewImageUrl || option.layoutStudioPlacement)
  ) {
    return true;
  }
  return false;
}

/**
 * Live layout snapshot tile that lives in the right column of the job
 * hero. Shows whichever preview is most "real" (approved layout, then
 * any saved area preview, then the catalog placeholder), and clicking
 * it expands the image into a full-screen modal via the existing
 * SlabThumbnailLightbox. Keeping this as a small wrapper means the
 * hero never knows about modal mechanics — it just hands over a URL.
 */
function JobHeroLayoutThumbnail({
  plan,
  previewUrl,
  jobName,
}: {
  plan: SavedJobLayoutPlan | null;
  previewUrl: string | null;
  jobName: string;
}) {
  /**
   * Prefer rendering the live PLAN preview (the kitchen pieces shown on the
   * right side of Layout Studio) — it's the canonical "what is this job?"
   * picture and updates the moment a rep edits the layout. Slabs and
   * placements are intentionally omitted so we render the plan view, not
   * the slab placement view. Falls back to the captured preview image and
   * finally to an empty placeholder when no layout exists yet.
   */
  const [expanded, setExpanded] = useState(false);

  // Esc closes the expanded modal.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Lock body scroll while the expanded layout modal is open so the
  // hero behind it doesn't drift around when you scroll inside the
  // dialog.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  const hasPlanPieces = (plan?.pieces?.length ?? 0) > 0;

  if (hasPlanPieces && plan) {
    const workspaceKind: "blank" | "source" =
      plan.workspaceKind === "blank" ? "blank" : "source";
    const ppi = plan.calibration?.pixelsPerInch ?? null;
    const previewPpi = workspaceKind === "blank" ? (ppi && ppi > 0 ? ppi : 1) : ppi;
    /**
     * Same `<PlaceLayoutPreview>` config used for both thumbnail and
     * expanded modal so they always render the exact same scene — the
     * modal is just a bigger frame around it.
     */
    const previewProps = {
      workspaceKind,
      pieces: plan.pieces,
      placements: [],
      slabs: [],
      pixelsPerInch: previewPpi,
      tracePlanWidth: plan.source?.sourceWidthPx ?? null,
      tracePlanHeight: plan.source?.sourceHeightPx ?? null,
      showLabels: false,
      showSinkLabels: false,
      selectedPieceId: null,
      showZoomControls: false,
      allowViewportInteraction: false,
    };

    return (
      <>
        <button
          type="button"
          className="compare-job-detail-hero__thumb compare-job-detail-hero__thumb--plan compare-job-detail-hero__thumb--expandable"
          aria-label={`Expand live layout plan for ${jobName}`}
          onClick={() => setExpanded(true)}
        >
          <PlaceLayoutPreview
            {...previewProps}
            previewInstanceId="job-hero"
          />
          <span className="compare-job-detail-hero__thumb-expand" aria-hidden="true">
            ⤢
          </span>
        </button>
        {expanded
          ? // Portal to <body> so the modal escapes any ancestor with
            // `overflow:hidden`, `transform`, `filter`, or its own
            // stacking context (the job hero header sets a few of
            // these). This guarantees the expanded layout always paints
            // above every other UI surface — sticky bars, dropdowns,
            // collaboration banner — instead of being clipped by the
            // hero card it lives inside.
            createPortal(
              <div
                className="modal-backdrop compare-job-detail-hero__thumb-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label={`Live layout plan for ${jobName}`}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setExpanded(false);
                }}
              >
                <div
                  className="modal-panel modal-panel--wide compare-job-detail-hero__thumb-modal"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="compare-job-detail-hero__thumb-modal-head">
                    <h2 className="modal-title">{jobName} — live layout</h2>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setExpanded(false)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="compare-job-detail-hero__thumb-modal-body compare-job-detail-hero__thumb--plan">
                    <PlaceLayoutPreview
                      {...previewProps}
                      previewInstanceId="job-hero-expanded"
                    />
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </>
    );
  }

  if (!previewUrl) {
    return (
      <div
        className="compare-job-detail-hero__thumb compare-job-detail-hero__thumb--empty"
        aria-label="Live layout preview"
      >
        <div
          className="compare-job-detail-hero__thumb-empty"
          title="Save a layout in Layout Studio to populate the preview."
        >
          <span aria-hidden="true">◳</span>
          <span>No layout yet</span>
        </div>
      </div>
    );
  }

  // Legacy raster preview path — `SlabThumbnailLightbox` already
  // provides its own click-to-expand image lightbox, so we don't need
  // to wrap it in our own modal.
  return (
    <div
      className="compare-job-detail-hero__thumb"
      aria-label="Live layout preview"
    >
      <SlabThumbnailLightbox
        src={previewUrl}
        label={`Live layout for ${jobName}`}
        className="compare-job-detail-hero__thumb-img"
      />
    </div>
  );
}

/**
 * Modal for choosing/overriding the assigned rep on a job. Triggered
 * from the "Change" button in the hero rep card. Shows a clear warning
 * that saving will override whoever is currently assigned, and only
 * commits the change when the user clicks Save.
 */
function AssignRepModal({
  open,
  job,
  members,
  busy,
  error,
  onCancel,
  onSave,
}: {
  open: boolean;
  job: JobRecord;
  members: CompanyMemberDoc[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (userId: string) => void;
}) {
  const [draft, setDraft] = useState<string>(job.assignedUserId ?? "");

  // Reset the draft whenever the modal is (re)opened so it always
  // reflects the current assignment, not a stale prior selection.
  useEffect(() => {
    if (open) setDraft(job.assignedUserId ?? "");
  }, [open, job.assignedUserId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const currentMember = members.find((m) => m.userId === job.assignedUserId);
  const currentName =
    currentMember?.displayName ||
    currentMember?.email ||
    job.commissionSnapshot?.displayName ||
    null;
  const isDirty = (job.assignedUserId ?? "") !== draft;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Change assigned rep"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">Change assigned rep</h2>
        <p className="modal-sub">
          Currently assigned to{" "}
          <strong>{currentName ?? "no one"}</strong>. Saving a new rep here
          will <strong>override the currently assigned rep</strong> for this
          job and update commission tracking going forward.
        </p>
        <span
          className="compare-job-detail-hero__rep-override-label"
          id="assign-rep-list-label"
        >
          Assigned rep
        </span>
        <ul
          className="assign-rep-modal__list"
          role="radiogroup"
          aria-labelledby="assign-rep-list-label"
        >
          <li>
            <button
              type="button"
              role="radio"
              aria-checked={draft === ""}
              className={`assign-rep-modal__option${
                draft === "" ? " assign-rep-modal__option--selected" : ""
              }`}
              onClick={() => setDraft("")}
              disabled={busy}
            >
              <span className="assign-rep-modal__option-avatar assign-rep-modal__option-avatar--empty" aria-hidden="true">
                —
              </span>
              <span className="assign-rep-modal__option-body">
                <span className="assign-rep-modal__option-name">Unassigned</span>
                <span className="assign-rep-modal__option-meta product-sub">
                  No rep earns commission on this job
                </span>
              </span>
              {draft === "" ? (
                <span className="assign-rep-modal__option-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          </li>
          {members.map((m) => {
            const isCreatorOption = m.userId === job.createdByUserId;
            const name = m.displayName || m.email || "Unknown member";
            const email = m.displayName ? m.email : null;
            const initials = (() => {
              const parts = name.trim().split(/\s+/).filter(Boolean);
              if (parts.length === 0) return "?";
              if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
              return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            })();
            const selected = draft === m.userId;
            const metaBits: string[] = [];
            if (isCreatorOption) metaBits.push("Job creator");
            if (m.commissionPercent != null)
              metaBits.push(`${m.commissionPercent}% commission`);
            if (email) metaBits.push(email);
            return (
              <li key={m.userId}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`assign-rep-modal__option${
                    selected ? " assign-rep-modal__option--selected" : ""
                  }`}
                  onClick={() => setDraft(m.userId)}
                  disabled={busy}
                >
                  <span className="assign-rep-modal__option-avatar" aria-hidden="true">
                    {initials}
                  </span>
                  <span className="assign-rep-modal__option-body">
                    <span className="assign-rep-modal__option-name">{name}</span>
                    {metaBits.length > 0 ? (
                      <span className="assign-rep-modal__option-meta product-sub">
                        {metaBits.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <span className="assign-rep-modal__option-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p
            className="compare-warning compare-job-detail-hero__rep-error"
            role="alert"
            style={{ marginTop: "0.75rem" }}
          >
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave(draft)}
            disabled={busy || !isDirty}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact "Assigned rep" readout for the job hero. Shows the rep's
 * initials, name, and a one-line meta describing why they're on the
 * job (creator vs. override). Owners/admins get a "Change" button that
 * opens a modal with an explicit override warning + save action — the
 * old inline dropdown made it too easy to overwrite an assignment by
 * accident.
 */
function JobHeroAssignedRep({
  job,
  members,
  canAssignRep,
  busy,
  error,
  onOpenAssign,
}: {
  job: JobRecord;
  members: CompanyMemberDoc[];
  canAssignRep: boolean;
  busy: boolean;
  error: string | null;
  onOpenAssign: () => void;
}) {
  const assignedMember = members.find((m) => m.userId === job.assignedUserId);
  const creatorMember = members.find((m) => m.userId === job.createdByUserId);
  const assignedName =
    assignedMember?.displayName ||
    assignedMember?.email ||
    job.commissionSnapshot?.displayName ||
    null;
  const isCreator =
    Boolean(job.assignedUserId) &&
    job.assignedUserId === job.createdByUserId;
  const initials = (() => {
    const src = assignedName || "?";
    const parts = src.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  })();
  const changeDisabled = busy || (job.pricingLocked && !canAssignRep);

  const body = (
    <>
      <div className="compare-job-detail-hero__rep-head">
        <div
          className={`compare-job-detail-hero__rep-avatar${
            assignedName ? "" : " compare-job-detail-hero__rep-avatar--empty"
          }`}
          aria-hidden="true"
        >
          {assignedName ? initials : "—"}
        </div>
        <div className="compare-job-detail-hero__rep-info">
          <span className="compare-job-detail-hero__rep-label">
            Assigned rep
          </span>
          <span className="compare-job-detail-hero__rep-name">
            {assignedName ?? "Unassigned"}
          </span>
          {assignedName ? (
            <span className="compare-job-detail-hero__rep-meta product-sub">
              {isCreator ? (
                <>Job creator · earns commission</>
              ) : creatorMember ? (
                <>
                  Override of {creatorMember.displayName || creatorMember.email}
                </>
              ) : (
                <>Earns commission on this job</>
              )}
            </span>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="compare-warning compare-job-detail-hero__rep-error" role="alert">
          {error}
        </p>
      ) : null}
      {job.commissionSnapshot ? (
        <span className="compare-job-detail-hero__rep-snapshot product-sub">
          Snapshot: {job.commissionSnapshot.displayName} ·{" "}
          {job.commissionSnapshot.percent}%
        </span>
      ) : null}
    </>
  );

  if (canAssignRep) {
    return (
      <button
        type="button"
        className="compare-job-detail-hero__rep compare-job-detail-hero__rep--button"
        aria-live="polite"
        aria-label={
          assignedName
            ? `Change assigned rep (currently ${assignedName})`
            : "Assign rep"
        }
        onClick={onOpenAssign}
        disabled={changeDisabled}
      >
        {body}
      </button>
    );
  }

  return (
    <div className="compare-job-detail-hero__rep" aria-live="polite">
      {body}
    </div>
  );
}

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { user, profileDisplayName } = useAuth();
  const { activeCompany, activeCompanyId, role } = useCompany();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [members, setMembers] = useState<CompanyMemberDoc[]>([]);
  const [repBusy, setRepBusy] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);
  const [assignRepOpen, setAssignRepOpen] = useState(false);
  /**
   * Customer-facing screen: dollar amounts are visible by default now that
   * the standalone "Show/Hide prices" toolbar has been removed. We keep the
   * variable so all downstream price-gating logic remains identical and the
   * toggle can be re-introduced from a different UI surface later if needed.
   */
  const showJobPrices = true;
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // Resolve jobId → customerId via collectionGroup (URL only has jobId).
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

  // Live subscription once we know the full path.
  useEffect(() => {
    if (!jobId || !activeCompanyId || !customerId) return;
    return subscribeJob(activeCompanyId, customerId, jobId, (j) => setJob(j));
  }, [activeCompanyId, customerId, jobId]);

  // Live customer record so the hero can show the customer's name as the
  // primary title (with the area shown beneath it).
  useEffect(() => {
    if (!activeCompanyId || !customerId) {
      setCustomer(null);
      return;
    }
    return subscribeCustomer(activeCompanyId, customerId, setCustomer);
  }, [activeCompanyId, customerId]);

  useEffect(() => {
    if (!jobId || !activeCompanyId || !customerId) return;
    return subscribeOptionsForJob(
      activeCompanyId,
      customerId,
      jobId,
      setOptions
    );
  }, [activeCompanyId, customerId, jobId]);

  /**
   * Live company members feed for the assigned-rep readout in the hero.
   * Mirrors the subscription that JobPaymentsPanel used to own — we
   * lifted the rep card up into the top summary so reps see who owns
   * the job without scrolling.
   */
  useEffect(() => {
    if (!activeCompanyId) return;
    return subscribeCompanyMembers(
      activeCompanyId,
      (rows) => setMembers(rows.filter((m) => m.status === "active")),
      (err) => setRepError(err.message)
    );
  }, [activeCompanyId]);

  const accessOk = useMemo(() => {
    return Boolean(user?.uid && job && activeCompanyId);
  }, [user?.uid, job, activeCompanyId]);

  /**
   * Overview/detail screen: surface presence but don't claim the soft
   * edit lock — that's reserved for the Layout Studio where real
   * structural edits happen.
   */
  const collaboration = useJobCollaboration({
    job,
    userId: user?.uid ?? null,
    displayName: profileDisplayName ?? user?.displayName ?? user?.email ?? null,
    mode: "viewing",
  });

  // NOTE: `optionQuotes` must stay above the early returns below so React's
  // hook order is stable across renders (Rules of Hooks). We tolerate `job`
  // being null here by returning an empty Map.
  const optionQuotes = useMemo(
    () =>
      job
        ? new Map(
            options.map((option) => [
              option.id,
              computeCurrentLayoutQuoteForOption({ job, option }),
            ]),
          )
        : new Map<string, CurrentLayoutStudioQuote>(),
    [job, options]
  );

  /**
   * Per area+option quote so we get accurate totals for multi-area jobs
   * (Kitchen vs Vanity might use different materials and edge counts).
   * Keyed by `${areaId}::${optionId}` so the lookup is O(1) inside the
   * render loop below.
   */
  const areaOptionQuotes = useMemo(() => {
    const map = new Map<string, CurrentLayoutStudioQuote>();
    if (!job) return map;
    const areas = jobAreasForJob(job);
    for (const area of areas) {
      for (const option of areaAssociatedOptions(area, options)) {
        map.set(
          `${area.id}::${option.id}`,
          computeCurrentLayoutQuoteForOption({ job, option, areaId: area.id })
        );
      }
    }
    return map;
  }, [job, options]);

  if (!jobId) return <p className="compare-warning">Missing job.</p>;
  if (!activeCompanyId)
    return <p className="compare-warning">No active company selected.</p>;
  if (!job) return <p className="product-sub">Loading job…</p>;
  if (!customerId)
    return <p className="compare-warning">This job has no customer.</p>;
  if (!accessOk)
    return <p className="compare-warning">You do not have access to this job.</p>;

  const finalOption = options.find((o) => o.id === job.finalOptionId) ?? null;
  const jobAreas = jobAreasForJob(job);
  const optionsById = new Map(options.map((o) => [o.id, o]));
  /**
   * Distinct (area, option) pairs that have actually been quoted in
   * Layout Studio. We dedupe by option id so a single material reused
   * across multiple areas counts once for the lifecycle pipeline pill.
   */
  const quotedOptionIds = new Set<string>();
  for (const area of jobAreas) {
    for (const option of areaAssociatedOptions(area, options)) {
      if (isOptionQuotedForArea(area, option, jobAreas.length)) {
        quotedOptionIds.add(option.id);
      }
    }
  }
  const quotedMaterialCount = quotedOptionIds.size;

  /**
   * Per-area roll-up consumed by the lifecycle panel's "Quoted
   * materials" section. We only surface materials that have a saved
   * Layout Studio quote (placement or preview) so the lifecycle panel
   * stays focused on real candidates the rep can actually approve.
   * Anything attached but not yet quoted is collapsed into a single
   * count + "price in Layout Studio" CTA per area.
   */
  const quotedMaterialsByArea = jobAreas.map((area) => {
    const areaOptions = areaAssociatedOptions(area, options);
    const approvedOptionId = area.selectedOptionId ?? null;
    const approvedOption = approvedOptionId
      ? optionsById.get(approvedOptionId) ?? null
      : null;
    const quoted = areaOptions
      .filter((option) => isOptionQuotedForArea(area, option, jobAreas.length))
      .map((option) => {
        const q =
          areaOptionQuotes.get(`${area.id}::${option.id}`) ??
          optionQuotes.get(option.id) ??
          null;
        return {
          option,
          customerTotal: q?.customerTotal ?? null,
          /**
           * The Quoted materials list is fundamentally a "what stone
           * did the customer choose?" surface, so we prefer the
           * material's catalog photo (the actual slab) over the tiny
           * layout outline. Layout previews still render as the hero
           * thumbnail and inside Layout Studio — this list is the
           * only place where the material image is more informative.
           */
          previewUrl:
            option.imageUrl ?? previewUrlForAreaOption(area, option) ?? null,
          isApproved: approvedOptionId === option.id,
        };
      });
    return {
      area,
      quoted,
      unquotedCount: Math.max(0, areaOptions.length - quoted.length),
      approvedOption,
    };
  });

  const finalQuoted = finalOption ? (optionQuotes.get(finalOption.id) ?? null) : null;
  const primaryQuoteSqFt =
    finalQuoted?.quoteAreaSqFt ??
    Array.from(optionQuotes.values()).find((quote) => quote.quoteAreaSqFt > 0)?.quoteAreaSqFt ??
    0;

  // ---- Approval helpers --------------------------------------------------
  const approvedAreaTotals: Record<string, number> = {};
  const approvedAreaPreviews: Array<{ area: JobAreaRecord; option: JobComparisonOptionRecord; total: number | null; previewUrl: string | null }> = [];
  for (const area of jobAreas) {
    if (!area.selectedOptionId) continue;
    const opt = optionsById.get(area.selectedOptionId);
    if (!opt) continue;
    const q = areaOptionQuotes.get(`${area.id}::${opt.id}`) ?? optionQuotes.get(opt.id) ?? null;
    if (q?.customerTotal != null && Number.isFinite(q.customerTotal)) {
      approvedAreaTotals[area.id] = q.customerTotal;
    }
    approvedAreaPreviews.push({
      area,
      option: opt,
      total: q?.customerTotal ?? null,
      previewUrl: previewUrlForAreaOption(area, opt),
    });
  }
  const consolidatedApprovedTotal = Object.values(approvedAreaTotals).reduce(
    (sum, v) => sum + (Number.isFinite(v) ? v : 0),
    0
  );
  /**
   * Hero picture is the live layout PLAN — the kitchen pieces shown on the
   * right side of Layout Studio — rendered live from the saved plan so the
   * thumbnail tracks whatever the rep is currently working on. Multi-area
   * jobs may keep separate per-area plans; pick the most recently updated
   * one. Single-area / legacy jobs fall back to `job.layoutStudioPlan`.
   */
  const heroLivePlan = (() => {
    let bestPlan: SavedJobLayoutPlan | null = null;
    let bestTimestamp = -Infinity;
    for (const area of jobAreas) {
      const plan = area.layoutStudioPlan;
      if (!plan?.pieces?.length) continue;
      const score = Date.parse(plan.updatedAt ?? "");
      if (Number.isFinite(score) && score >= bestTimestamp) {
        bestTimestamp = score;
        bestPlan = plan;
      } else if (bestPlan == null) {
        bestPlan = plan;
      }
    }
    if (bestPlan) return bestPlan;
    const jobPlan = job.layoutStudioPlan;
    return jobPlan?.pieces?.length ? jobPlan : null;
  })();
  /**
   * Fallback raster preview only used when no live plan exists yet (so the
   * hero never goes empty when there's an approved capture on file).
   */
  const heroPreviewUrl =
    job.approvedLayoutPreviewImageUrl?.trim() ||
    approvedAreaPreviews.find((row) => row.previewUrl)?.previewUrl ||
    null;
  const allAreasApproved =
    jobAreas.length > 0 && jobAreas.every((area) => Boolean(area.selectedOptionId));

  /**
   * The JOB itself is only "approved" once a deposit has been received and
   * the job has progressed to `active` (or beyond). Picking a customer
   * material per area is just a selection — it does not approve the quote.
   * Gate the green "Approved quote" hero on this so it cannot appear while
   * we're still in `draft` or `quote` waiting on a deposit.
   */
  const jobStatus = normalizeJobStatus(job.status);
  const jobIsApproved =
    jobStatus === "active" ||
    jobStatus === "installed" ||
    jobStatus === "complete";
  const hasCustomerSelections = approvedAreaPreviews.length > 0;
  const depositRequired = job.requiredDepositAmount ?? 0;
  const depositReceived = job.depositReceivedTotal ?? 0;

  const handleApproveAreaOption = async (
    area: JobAreaRecord,
    option: JobComparisonOptionRecord
  ) => {
    if (!activeCompanyId || !customerId) return;
    const key = `${area.id}::${option.id}`;
    const quote = areaOptionQuotes.get(key) ?? optionQuotes.get(option.id) ?? null;
    const previewUrl = previewUrlForAreaOption(area, option);
    /**
     * Build the per-other-area totals map so the helper can compute the
     * consolidated quoted total without re-reading every option doc.
     */
    const otherTotals: Record<string, number> = {};
    for (const other of jobAreas) {
      if (other.id === area.id || !other.selectedOptionId) continue;
      const opt = optionsById.get(other.selectedOptionId);
      if (!opt) continue;
      const q =
        areaOptionQuotes.get(`${other.id}::${opt.id}`) ??
        optionQuotes.get(opt.id) ??
        null;
      if (q?.customerTotal != null && Number.isFinite(q.customerTotal)) {
        otherTotals[other.id] = q.customerTotal;
      }
    }
    setApprovalBusy(key);
    setApprovalError(null);
    try {
      await approveJobAreaQuote(activeCompanyId, customerId, job.id, {
        areaId: area.id,
        optionId: option.id,
        areaQuotedTotal: quote?.customerTotal ?? null,
        layoutPreviewImageUrl: previewUrl,
        otherApprovedAreaTotals: otherTotals,
        defaultDepositPercent:
          activeCompany?.settings?.defaultRequiredDepositPercent ?? null,
        advanceToQuote: true,
      });
    } catch (err) {
      setApprovalError(
        err instanceof Error ? err.message : "Could not approve quote."
      );
    } finally {
      setApprovalBusy(null);
    }
  };

  const handleClearAreaApproval = async (area: JobAreaRecord) => {
    if (!activeCompanyId || !customerId) return;
    const remaining: Record<string, number> = {};
    for (const other of jobAreas) {
      if (other.id === area.id || !other.selectedOptionId) continue;
      const opt = optionsById.get(other.selectedOptionId);
      if (!opt) continue;
      const q =
        areaOptionQuotes.get(`${other.id}::${opt.id}`) ??
        optionQuotes.get(opt.id) ??
        null;
      if (q?.customerTotal != null && Number.isFinite(q.customerTotal)) {
        remaining[other.id] = q.customerTotal;
      }
    }
    setApprovalBusy(`clear:${area.id}`);
    setApprovalError(null);
    try {
      await clearJobAreaQuoteApproval(
        activeCompanyId,
        customerId,
        job.id,
        area.id,
        remaining
      );
    } catch (err) {
      setApprovalError(
        err instanceof Error ? err.message : "Could not clear approval."
      );
    } finally {
      setApprovalBusy(null);
    }
  };

  const handleAssignRep = async (userId: string) => {
    if (!activeCompanyId || !customerId) return;
    setRepBusy(true);
    setRepError(null);
    try {
      await assignJobRep(activeCompanyId, customerId, job.id, userId || null);
      setAssignRepOpen(false);
    } catch (err) {
      setRepError(
        err instanceof Error ? err.message : "Could not assign rep."
      );
    } finally {
      setRepBusy(false);
    }
  };

  const canAssignRep = role === "owner" || role === "admin";
  // ------------------------------------------------------------------------

  return (
    <div className="compare-page compare-job-detail-page">
      <JobCollaborationBanner
        viewers={collaboration.viewers}
        activeEditor={collaboration.activeEditor}
        lockedByOther={collaboration.lockedByOther}
        disableTakeover
      />
      <button
        type="button"
        className="compare-job-detail-back"
        onClick={() => {
          // Prefer real browser back so the user lands wherever they came
          // from (Jobs overview, customer page, etc.). Fall back to the
          // jobs list if there's no history (e.g. opened in a new tab).
          if (window.history.length > 1) navigate(-1);
          else navigate("/jobs");
        }}
        title="Back"
        aria-label="Back"
      >
        <IconBack />
      </button>

      <header
        className={`compare-job-detail-hero${
          hasCustomerSelections
            ? jobIsApproved
              ? " compare-job-detail-hero--approved"
              : " compare-job-detail-hero--pending"
            : ""
        }`}
      >
        <aside
          className="compare-job-detail-hero__aside"
          aria-label="Live layout snapshot and assigned rep"
        >
          <JobHeroLayoutThumbnail
            plan={heroLivePlan}
            previewUrl={heroPreviewUrl}
            jobName={job.name}
          />
        </aside>
        <div className="compare-job-detail-hero__main">
          <div className="compare-job-detail-hero__top">
            <div className="compare-job-detail-hero__title-block">
              <div className="compare-job-detail-hero__title-stack">
                <h1 className="compare-title compare-job-detail-hero__title">
                  {customer ? customerDisplayName(customer) : job.name}
                </h1>
                <span className="compare-job-detail-hero__subtitle">
                  {job.areaType || job.name || "No area"}
                </span>
              </div>
              {hasCustomerSelections ? (
                <span
                  className={`compare-job-detail-approved__pill${
                    jobIsApproved
                      ? " compare-job-detail-approved__pill--approved"
                      : " compare-job-detail-approved__pill--pending"
                  }`}
                >
                  {jobIsApproved
                    ? "Quote approved · Active"
                    : depositReceived > 0
                    ? "Deposit recorded — promoting to Active…"
                    : depositRequired > 0
                    ? `Awaiting ${formatMoney(depositRequired)} deposit`
                    : "Awaiting deposit"}
                </span>
              ) : null}
            </div>
            <div className="compare-job-detail-status-wrap">
              <span className="compare-job-detail-status-label__text">Status</span>
              <a
                href="#job-lifecycle"
                className="compare-job-detail-status-pill"
                style={{
                  borderColor: JOB_STATUS_COLOR[normalizeJobStatus(job.status)],
                  color: JOB_STATUS_COLOR[normalizeJobStatus(job.status)],
                }}
                title="Change status in the lifecycle stepper below"
              >
                {JOB_STATUS_LABELS[normalizeJobStatus(job.status)]}
              </a>
            </div>
          </div>
          {hasCustomerSelections ? (
            <p className="compare-job-detail-hero__lede">
              {jobIsApproved
                ? `Consolidated from ${approvedAreaPreviews.length} ${approvedAreaPreviews.length === 1 ? "area" : "areas"}. Quote is approved and the job is active.`
                : `Customer's chosen ${approvedAreaPreviews.length === 1 ? "material" : "materials"} for ${approvedAreaPreviews.length} ${approvedAreaPreviews.length === 1 ? "area" : "areas"}. The quote is approved and the job moves to Active automatically once a deposit is recorded in the Lifecycle & payments panel.`}
              {!jobIsApproved && !allAreasApproved && jobAreas.length > 1
                ? " You can keep refining selections in other areas in the meantime."
                : ""}
            </p>
          ) : null}
          <div className="compare-job-detail-hero__details">
          <div className="compare-job-detail-stats">
            <div className="compare-job-detail-stat">
              <span className="compare-job-detail-stat__label">Area</span>
              <span className="compare-job-detail-stat__value">{job.areaType || "No areas yet"}</span>
            </div>
            <div className="compare-job-detail-stat">
              <span className="compare-job-detail-stat__label">Quote area (sq ft)</span>
              <span className="compare-job-detail-stat__value">
                {primaryQuoteSqFt > 0 ? (
                  <strong>{primaryQuoteSqFt}</strong>
                ) : (
                  <span className="product-sub compare-job-detail-stat__hint">
                    From Layout Studio when saved
                  </span>
                )}
              </span>
            </div>
            <div className="compare-job-detail-stat">
              <span className="compare-job-detail-stat__label">
                {jobIsApproved ? "Approved areas" : "Customer-chosen areas"}
              </span>
              <span className="compare-job-detail-stat__value">
                <strong>{approvedAreaPreviews.length}</strong>
                <span className="product-sub"> / {jobAreas.length || 0}</span>
              </span>
            </div>
            {showJobPrices ? (
              <div className="compare-job-detail-stat">
                <span className="compare-job-detail-stat__label">
                  {jobIsApproved
                    ? "Approved total"
                    : hasCustomerSelections
                    ? "Pending total"
                    : "Selected total"}
                </span>
                <span className="compare-job-detail-stat__value">
                  {consolidatedApprovedTotal > 0 ? (
                    <strong>{formatMoney(consolidatedApprovedTotal)}</strong>
                  ) : (
                    <span className="product-sub compare-job-detail-stat__hint">
                      No selection yet
                    </span>
                  )}
                </span>
              </div>
            ) : null}
          </div>
            <JobHeroAssignedRep
              job={job}
              members={members}
              canAssignRep={canAssignRep}
              busy={repBusy}
              error={repError}
              onOpenAssign={() => {
                setRepError(null);
                setAssignRepOpen(true);
              }}
            />
          </div>
          {hasCustomerSelections ? (
            <ul className="compare-job-detail-approved__list compare-job-detail-hero__selections">
              {approvedAreaPreviews.map((row) => (
                <li
                  key={row.area.id}
                  className="compare-job-detail-approved__item"
                >
                  <div>
                    <span className="compare-job-detail-approved__area">
                      {row.area.name}
                    </span>
                    <span className="compare-job-detail-approved__option">
                      {row.option.productName}
                      <span className="product-sub">
                        {" "}
                        · {row.option.vendor || row.option.manufacturer || "—"}
                      </span>
                    </span>
                  </div>
                  {showJobPrices ? (
                    <span className="compare-job-detail-approved__amount">
                      {row.total != null ? formatMoney(row.total) : "—"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      <div id="job-lifecycle" className="compare-job-detail-lifecycle-wrap">
        <JobPaymentsPanel
          job={job}
          hasApprovedSelection={hasCustomerSelections}
          quotedMaterialCount={quotedMaterialCount}
          approvedMaterialCount={approvedAreaPreviews.length}
          lifecycleGate={{ areas: jobAreas, options }}
          quotedMaterialsByArea={quotedMaterialsByArea}
          approvalBusyKey={approvalBusy}
          approvalError={approvalError}
          onApproveAreaOption={(areaId, optionId) => {
            const area = jobAreas.find((a) => a.id === areaId);
            const option = optionsById.get(optionId);
            if (area && option) void handleApproveAreaOption(area, option);
          }}
          onClearAreaApproval={(areaId) => {
            const area = jobAreas.find((a) => a.id === areaId);
            if (area) void handleClearAreaApproval(area);
          }}
          derivedQuotedTotal={consolidatedApprovedTotal}
          companyDepositPercent={
            activeCompany?.settings?.defaultRequiredDepositPercent ?? null
          }
          customer={customer}
        />
      </div>

      <details
        className="compare-job-detail-panel compare-job-detail-panel--collapsible"
        aria-labelledby="job-detail-fields-title"
      >
        <summary className="compare-job-detail-panel__summary">
          <span className="compare-job-detail-panel__summary-left">
            <span
              className="compare-job-detail-panel__chevron"
              aria-hidden="true"
            />
            <h2
              id="job-detail-fields-title"
              className="compare-job-detail-panel__title"
            >
              Job details
            </h2>
          </span>
          <span className="compare-job-detail-panel__summary-meta product-sub">
            {jobDetailSummaryLine(job)}
          </span>
        </summary>
        <div className="compare-job-detail-fields">
          <div className="compare-job-detail-field">
            <span className="compare-job-detail-field__label">Notes</span>
            <span className="compare-job-detail-field__value compare-job-detail-field__value--multiline">
              {job.notes?.trim() ? job.notes : "—"}
            </span>
          </div>
          <div className="compare-job-detail-field">
            <span className="compare-job-detail-field__label">Assumptions</span>
            <span className="compare-job-detail-field__value compare-job-detail-field__value--multiline">
              {job.assumptions?.trim() ? job.assumptions : "—"}
            </span>
          </div>
          <div className="compare-job-detail-field compare-job-detail-field--attachments">
            <span className="compare-job-detail-field__label">Attachments (phase 2)</span>
            <span className="compare-job-detail-field__value compare-job-detail-field__value--muted">
              DXF: {job.dxfAttachmentUrl ?? "—"} · Drawing: {job.drawingAttachmentUrl ?? "—"}
            </span>
          </div>
        </div>
      </details>


      {finalOption ? (
        <p className="compare-final-summary compare-job-detail-final">
          Final material: <strong>{finalOption.productName}</strong> ({finalOption.vendor})
          {showJobPrices ? (
            <>
              {" "}
              — installed estimate{" "}
              <strong>
                {finalQuoted?.customerTotal != null ? formatMoney(finalQuoted.customerTotal) : "—"}
              </strong>
            </>
          ) : null}
        </p>
      ) : null}

      <AssignRepModal
        open={assignRepOpen}
        job={job}
        members={members}
        busy={repBusy}
        error={repError}
        onCancel={() => {
          setAssignRepOpen(false);
          setRepError(null);
        }}
        onSave={(userId) => void handleAssignRep(userId)}
      />

      <ConfirmDialog
        open={!!removeId}
        title="Remove option?"
        message="This removes the option from the job comparison. Snapshot data in Firestore is deleted."
        danger
        confirmLabel="Remove"
        onCancel={() => setRemoveId(null)}
        onConfirm={() => {
          if (!removeId) return;
          const id = removeId;
          void (async () => {
            await deleteJobComparisonOption(
              activeCompanyId,
              customerId,
              job.id,
              id
            );
            if (job.finalOptionId === id) {
              await setJobFinalOption(
                activeCompanyId,
                customerId,
                job.id,
                null
              );
              setJob((j) => (j ? { ...j, finalOptionId: null } : j));
            }
            setRemoveId(null);
          })();
        }}
      />

    </div>
  );
}

