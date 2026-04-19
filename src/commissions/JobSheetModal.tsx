/**
 * JobSheetModal — printable, **internal** job sheet handed to the
 * production / install crew. Mirrors the structure of `InvoiceModal`
 * (same body-class print plumbing, same modal chrome) but is
 * deliberately scrubbed of any pricing information: no quoted total,
 * no per-line dollars, no deposit, no balance. Only the operational
 * details the install crew needs:
 *
 *   - Customer & site contact info
 *   - Project details (areas, square footage, area type)
 *   - Schedule (material delivery date, requested install date)
 *   - Approved material per area + thickness, slab count, area sq ft
 *   - Sink models (derived from Layout Studio plans, with override)
 *   - Job notes / assumptions / active-phase production notes
 *   - Sign-off lines for the installer / template
 *
 * Wired from the lifecycle header in `JobPaymentsPanel`.
 */
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { CompanyDoc } from "../company/types";
import { QuoteBrandingHeader, QuoteBrandingFooter } from "../company/QuoteBranding";
import {
  customerDisplayName,
  deriveJobSinkModels,
  jobAreasForJob,
  JOB_STATUS_LABELS,
  normalizeJobStatus,
  type CustomerRecord,
  type JobAreaRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
} from "../types/compareQuote";
import type { SavedJobLayoutPlan } from "../compare/layoutStudio/types";
import type { QuotedAreaSection } from "./JobPaymentsPanel";
import { JobSheetLayoutPreviewSvg } from "./JobSheetLayoutPreviewSvg";

type Props = {
  open: boolean;
  onClose: () => void;
  company: CompanyDoc | null;
  customer: CustomerRecord | null;
  job: JobRecord;
  /** Same per-area quoted materials the panel computes for the materials list. */
  quotedMaterialsByArea?: QuotedAreaSection[];
};

function todayLong(): string {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function shortDateStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Stable per-job sheet number. Distinct from invoice numbers so a
 * printed sheet sitting on the shop floor is never confused with a
 * customer-facing invoice. Format: JOB-{shortJobId}-{yyyymmdd}.
 */
function buildJobSheetNumber(jobId: string): string {
  const tail = jobId.slice(-6).toUpperCase();
  return `JOB-${tail}-${shortDateStamp()}`;
}

interface AreaSheetRow {
  area: JobAreaRecord;
  approved: JobComparisonOptionRecord | null;
  /** Layout-derived approximate area in sq ft for this area (when available). */
  areaSqFt: number | null;
  /** Estimated slab count from layout. */
  slabCount: number | null;
  /** Sink count from layout. */
  sinkCount: number | null;
  /**
   * Sink model labels placed in this area's layout plan, in placement
   * order with duplicates collapsed. Pulled from
   * `area.layoutStudioPlan.pieces[].sinks[].name` so the install crew
   * sees the real sink models per area, not just a count.
   */
  sinkModels: string[];
  /**
   * Saved layout plan for this area. The job sheet renders an inline
   * SVG of this plan (printer-friendly outlines + labels) instead of
   * the dark raster preview the customer-facing flows use.
   */
  layoutPlan: SavedJobLayoutPlan | null;
}

/**
 * Pull unique sink model names from a saved Layout Studio plan, in
 * placement order. Mirrors the per-plan extraction in
 * `deriveJobSinkModels` but scoped to a single area's plan so the
 * job sheet can show "this area gets these sinks" alongside the
 * approved material.
 */
function sinkNamesFromPlan(
  plan: { pieces?: Array<{ sinks?: Array<{ name?: string | null }> | null }> } | null | undefined
): string[] {
  if (!plan?.pieces) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of plan.pieces) {
    for (const sink of piece.sinks ?? []) {
      const label = (sink.name ?? "").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

/**
 * Build one row per area for the production sheet. Pulls the
 * customer-approved material when one exists; otherwise the row still
 * renders so the crew can see "this area isn't picked yet" instead of
 * silently dropping.
 */
function buildAreaRows(
  job: JobRecord,
  sections: QuotedAreaSection[] | undefined
): AreaSheetRow[] {
  const sectionByAreaId = new Map<string, QuotedAreaSection>();
  for (const section of sections ?? []) {
    sectionByAreaId.set(section.area.id, section);
  }

  const areas = jobAreasForJob(job);
  const rows: AreaSheetRow[] = [];
  if (areas.length > 0) {
    for (const area of areas) {
      const section = sectionByAreaId.get(area.id);
      const approved =
        section?.approvedOption ??
        section?.quoted.find((q) => q.isApproved)?.option ??
        null;
      const layoutState =
        approved?.layoutAreaStates?.[area.id] ?? null;
      const sinkModels = sinkNamesFromPlan(area.layoutStudioPlan);
      rows.push({
        area,
        approved,
        areaSqFt:
          layoutState?.layoutEstimatedAreaSqFt ??
          approved?.layoutEstimatedAreaSqFt ??
          null,
        slabCount:
          layoutState?.layoutEstimatedSlabCount ??
          approved?.layoutEstimatedSlabCount ??
          null,
        sinkCount:
          layoutState?.layoutSinkCount ??
          approved?.layoutSinkCount ??
          (sinkModels.length > 0 ? sinkModels.length : null),
        sinkModels,
        layoutPlan: area.layoutStudioPlan ?? null,
      });
    }
    return rows;
  }
  const legacySinkModels = sinkNamesFromPlan(job.layoutStudioPlan);
  rows.push({
    area: {
      id: "legacy",
      name: job.areaType || "Project",
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    approved: null,
    areaSqFt: null,
    slabCount: null,
    sinkCount: legacySinkModels.length > 0 ? legacySinkModels.length : null,
    sinkModels: legacySinkModels,
    layoutPlan: job.layoutStudioPlan ?? null,
  });
  return rows;
}

function formatCustomerAddress(customer: CustomerRecord | null): string[] {
  if (!customer) return [];
  const lines: string[] = [];
  const address = customer.address?.trim();
  if (address) {
    for (const part of address.split(/\r?\n/)) {
      const trimmed = part.trim();
      if (trimmed) lines.push(trimmed);
    }
  }
  return lines;
}

function describeProduct(option: JobComparisonOptionRecord): string {
  const parts = [option.material, option.productName]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.length ? parts.join(" — ") : option.productName || "Selected material";
}

function describeSourceLine(option: JobComparisonOptionRecord): string {
  return [option.vendor, option.manufacturer]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" · ");
}

export function JobSheetModal({
  open,
  onClose,
  company,
  customer,
  job,
  quotedMaterialsByArea,
}: Props) {
  const sheetNumber = useMemo(() => buildJobSheetNumber(job.id), [job.id]);
  const issueDate = useMemo(() => todayLong(), []);
  const areaRows = useMemo(
    () => buildAreaRows(job, quotedMaterialsByArea),
    [job, quotedMaterialsByArea]
  );
  const sinkModels = useMemo(() => deriveJobSinkModels(job), [job]);
  const totalSinks = useMemo(
    () =>
      areaRows.reduce(
        (sum, r) => sum + (typeof r.sinkCount === "number" ? r.sinkCount : 0),
        0
      ),
    [areaRows]
  );

  const companyName = company?.name?.trim() || "Your Company";
  const customerName = customer
    ? customerDisplayName(customer)
    : job.contactName?.trim() || "Customer";
  const customerAddressLines = formatCustomerAddress(customer);
  const customerPhone =
    customer?.phone?.trim() || job.contactPhone?.trim() || null;
  const customerEmail = customer?.email?.trim() || null;

  const status = normalizeJobStatus(job.status);

  /**
   * Print plumbing — reuse the same body class + `.invoice-print-root`
   * marker `InvoiceModal` uses so the global print CSS hides everything
   * except the sheet itself.
   */
  useEffect(() => {
    if (!open) return;
    const handleBefore = () => document.body.classList.add("invoice-printing");
    const handleAfter = () => document.body.classList.remove("invoice-printing");
    window.addEventListener("beforeprint", handleBefore);
    window.addEventListener("afterprint", handleAfter);
    return () => {
      window.removeEventListener("beforeprint", handleBefore);
      window.removeEventListener("afterprint", handleAfter);
      document.body.classList.remove("invoice-printing");
    };
  }, [open]);

  if (!open) return null;

  const handlePrint = () => {
    const prevTitle = document.title;
    document.title = `${sheetNumber} — ${customerName}`;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = prevTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    window.setTimeout(restore, 2000);
  };

  /*
   * Render through a portal mounted on document.body so the modal
   * escapes any ancestor that creates a containing block for
   * `position: fixed` (transforms, filters, `backdrop-filter`,
   * `contain: paint`, etc.). The lifecycle panel uses glass-blur
   * styling and was clipping the backdrop inside its own bounds,
   * which is what made it look like the sheet "opens in its parent
   * div" instead of over the viewport.
   *
   * SSR guard: `document` only exists in the browser; on the server
   * we just render nothing rather than crash. The app is currently
   * client-rendered so this is a defensive belt-and-suspenders.
   */
  if (typeof document === "undefined") return null;

  const node = (
    <div
      className="modal-backdrop invoice-modal-backdrop job-sheet-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Job sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--wide invoice-modal-panel job-sheet-modal-panel"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="invoice-modal__header no-print">
          <div>
            <h2 className="modal-title">Job sheet</h2>
            <p className="modal-sub">
              Internal production reference for the install / template crew.
              Print or save as PDF — no pricing is included.
            </p>
          </div>
        </div>

        <article className="invoice-print-root invoice-sheet job-sheet">
          <QuoteBrandingHeader
            companyName={companyName}
            logoUrl={company?.branding?.logoUrl ?? null}
            address={company?.address ?? null}
            headerMessage={null}
          />

          <header className="invoice-sheet__head job-sheet__head">
            <div>
              <h3 className="invoice-sheet__title">Job sheet</h3>
              <p className="invoice-sheet__sub">
                Internal use only — not a customer document
              </p>
            </div>
            <dl className="invoice-sheet__meta">
              <div>
                <dt>Sheet #</dt>
                <dd>{sheetNumber}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{issueDate}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{JOB_STATUS_LABELS[status]}</dd>
              </div>
            </dl>
          </header>

          <section className="invoice-sheet__parties">
            <div>
              <h4 className="invoice-sheet__party-label">Customer</h4>
              <p className="invoice-sheet__party-name">{customerName}</p>
              {customerAddressLines.map((line, i) => (
                <p key={i} className="invoice-sheet__party-line">
                  {line}
                </p>
              ))}
              {customerPhone ? (
                <p className="invoice-sheet__party-line">{customerPhone}</p>
              ) : null}
              {customerEmail ? (
                <p className="invoice-sheet__party-line">{customerEmail}</p>
              ) : null}
            </div>
            <div>
              <h4 className="invoice-sheet__party-label">Project</h4>
              <p className="invoice-sheet__party-name">{job.name}</p>
              {job.siteAddress ? (
                <p className="invoice-sheet__party-line">{job.siteAddress}</p>
              ) : null}
              {job.areaType ? (
                <p className="invoice-sheet__party-line">{job.areaType}</p>
              ) : null}
              {typeof job.squareFootage === "number" && job.squareFootage > 0 ? (
                <p className="invoice-sheet__party-line">
                  Approx {job.squareFootage} sq ft
                </p>
              ) : null}
            </div>
          </section>

          <section className="job-sheet__schedule">
            <h4 className="invoice-sheet__party-label">Schedule</h4>
            <dl className="job-sheet__schedule-grid">
              <div>
                <dt>Material delivery</dt>
                <dd>{job.materialDeliveryDate || "—"}</dd>
              </div>
              <div>
                <dt>Requested install / template</dt>
                <dd>{job.requestedInstallDate || "—"}</dd>
              </div>
              <div>
                <dt>Sinks total</dt>
                <dd>
                  {totalSinks > 0
                    ? `${totalSinks} placed`
                    : sinkModels.length > 0
                    ? `${sinkModels.length} listed`
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="invoice-sheet__items job-sheet__items">
            <h4 className="invoice-sheet__party-label">Materials by area</h4>
            <table className="invoice-sheet__table job-sheet__table">
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Material</th>
                  <th scope="col">Source</th>
                  <th scope="col">Thickness</th>
                  <th scope="col" className="job-sheet__num-col">
                    Slabs
                  </th>
                  <th scope="col" className="job-sheet__num-col">
                    Sq ft
                  </th>
                  <th scope="col">Sinks</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.length > 0 ? (
                  areaRows.map((row) => (
                    <tr key={row.area.id}>
                      <td>{row.area.name}</td>
                      <td>
                        {row.approved
                          ? describeProduct(row.approved)
                          : "— Not yet approved —"}
                      </td>
                      <td>
                        {row.approved ? describeSourceLine(row.approved) : ""}
                      </td>
                      <td>{row.approved?.thickness || "—"}</td>
                      <td className="job-sheet__num-col">
                        {row.slabCount != null ? row.slabCount : "—"}
                      </td>
                      <td className="job-sheet__num-col">
                        {row.areaSqFt != null
                          ? Math.round(row.areaSqFt * 10) / 10
                          : "—"}
                      </td>
                      <td>
                        {row.sinkModels.length > 0 ? (
                          <span>
                            {row.sinkModels.join(", ")}
                            {row.sinkCount != null &&
                            row.sinkCount > row.sinkModels.length ? (
                              <span className="job-sheet__sink-count">
                                {" "}
                                ({row.sinkCount})
                              </span>
                            ) : null}
                          </span>
                        ) : row.sinkCount != null && row.sinkCount > 0 ? (
                          `${row.sinkCount} placed`
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="invoice-sheet__empty">
                      No areas defined yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/*
           * Job-wide sink summary. Always rendered (even when empty) so
           * the install crew has an obvious "did we bring the right
           * sinks?" checklist on the printed sheet — and so a missing
           * sink shows up as an explicit blank rather than being
           * silently absent from the document.
           */}
          <section className="job-sheet__sinks">
            <h4 className="invoice-sheet__party-label">
              Sink models{" "}
              {totalSinks > 0 ? (
                <span className="job-sheet__sink-count">
                  ({totalSinks} placed)
                </span>
              ) : null}
            </h4>
            {sinkModels.length > 0 ? (
              <ul className="job-sheet__chip-list">
                {sinkModels.map((s) => (
                  <li key={s} className="job-sheet__chip">
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="job-sheet__empty-line">
                No sinks placed in the layout.
              </p>
            )}
          </section>

          {areaRows.some((r) => (r.layoutPlan?.pieces?.length ?? 0) > 0) ? (
            <section className="job-sheet__previews">
              <h4 className="invoice-sheet__party-label">Layout previews</h4>
              <div className="job-sheet__preview-grid">
                {areaRows
                  .filter((r) => (r.layoutPlan?.pieces?.length ?? 0) > 0)
                  .map((r) => (
                    <figure key={r.area.id} className="job-sheet__preview">
                      <div className="job-sheet__preview-frame">
                        <JobSheetLayoutPreviewSvg
                          plan={r.layoutPlan}
                          label={`Layout preview for ${r.area.name}`}
                        />
                      </div>
                      <figcaption className="job-sheet__preview-caption">
                        {r.area.name}
                        {r.approved ? ` — ${describeProduct(r.approved)}` : ""}
                      </figcaption>
                    </figure>
                  ))}
              </div>
            </section>
          ) : null}

          {(job.notes?.trim() ||
            job.assumptions?.trim() ||
            job.activeJobNotes?.trim()) ? (
            <section className="job-sheet__notes">
              <h4 className="invoice-sheet__party-label">Notes</h4>
              {job.notes?.trim() ? (
                <div className="job-sheet__note-block">
                  <span className="job-sheet__note-label">Job notes</span>
                  <p>{job.notes.trim()}</p>
                </div>
              ) : null}
              {job.assumptions?.trim() ? (
                <div className="job-sheet__note-block">
                  <span className="job-sheet__note-label">Assumptions</span>
                  <p>{job.assumptions.trim()}</p>
                </div>
              ) : null}
              {job.activeJobNotes?.trim() ? (
                <div className="job-sheet__note-block">
                  <span className="job-sheet__note-label">Production notes</span>
                  <p>{job.activeJobNotes.trim()}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="job-sheet__signoff">
            <h4 className="invoice-sheet__party-label">Sign-off</h4>
            <div className="job-sheet__signoff-grid">
              <div>
                <span className="job-sheet__signoff-label">Installer</span>
                <span className="job-sheet__signoff-line" />
              </div>
              <div>
                <span className="job-sheet__signoff-label">Date</span>
                <span className="job-sheet__signoff-line" />
              </div>
              <div>
                <span className="job-sheet__signoff-label">Signature</span>
                <span className="job-sheet__signoff-line" />
              </div>
            </div>
          </section>

          <QuoteBrandingFooter text={company?.branding?.quoteFooterText ?? null} />
        </article>

        <div className="modal-actions no-print">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
