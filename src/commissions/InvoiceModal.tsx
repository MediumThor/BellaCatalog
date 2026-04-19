/**
 * InvoiceModal — surfaces a printable, single-page deposit invoice for a job
 * whose quote has been approved but the customer hasn't paid the deposit yet.
 *
 * The modal shows three things:
 *   1. A branded invoice "sheet" (company header + customer block + line items
 *      pulled from the approved Layout Studio selections + the deposit
 *      amount due). This is the only thing that prints — the modal chrome
 *      and action bar are tagged `no-print`.
 *   2. A "Print / Save as PDF" button that fires `window.print()`. The
 *      `body.invoice-printing` class hides everything else on the page so
 *      the invoice prints cleanly even though it's mounted inside a modal.
 *   3. A "Email customer" button (mailto:) and a "Copy invoice text"
 *      button so reps can drop a payment-request message into their inbox
 *      or a text without leaving the job page.
 *
 * Wired from `JobPaymentsPanel` whenever the job has an approved quote and
 * no deposit has been recorded yet (the same state in which "Record
 * deposit" is the next action).
 */
import { useEffect, useMemo, useState } from "react";
import type { CompanyDoc } from "../company/types";
import { QuoteBrandingHeader, QuoteBrandingFooter } from "../company/QuoteBranding";
import {
  customerDisplayName,
  type CustomerRecord,
  type JobRecord,
} from "../types/compareQuote";
import { formatMoney } from "../utils/priceHelpers";
import type { QuotedAreaSection } from "./JobPaymentsPanel";

type Props = {
  open: boolean;
  onClose: () => void;
  company: CompanyDoc | null;
  customer: CustomerRecord | null;
  job: JobRecord;
  quotedTotal: number;
  depositRequired: number;
  depositReceived: number;
  /** Same per-area sections JobPaymentsPanel uses for the Quoted materials list. */
  quotedMaterialsByArea?: QuotedAreaSection[];
  /**
   * `"deposit"` (default) renders the original "deposit due" invoice
   * shown after a quote is approved. `"final"` flips the totals so it
   * shows balance-due-after-deposit + the deposit on file as a credit
   * — used in the Active phase to bill the remaining balance once the
   * material has been installed (or just before).
   */
  mode?: "deposit" | "final";
  /** Total payments on file (deposit + progress + final + adjustments − refunds). Used by `mode="final"`. */
  paidTotal?: number;
  /**
   * Fired once per opening with the freshly built invoice number so
   * the parent can stamp it on the job (e.g. `finalInvoiceNumber`
   * + `finalInvoiceSentAt`). Optional — read-only previews skip it.
   */
  onInvoiceNumberGenerated?: (invoiceNumber: string) => void;
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
 * Stable per-job invoice number. We don't persist these (yet); the goal is
 * a recognizable identifier the customer can quote back, not a Stripe-grade
 * sequence. Format: INV-{shortJobId}-{yyyymmdd}.
 */
function buildInvoiceNumber(jobId: string, mode: "deposit" | "final"): string {
  const tail = jobId.slice(-6).toUpperCase();
  const suffix = mode === "final" ? "-FINAL" : "";
  return `INV-${tail}-${shortDateStamp()}${suffix}`;
}

interface InvoiceLineItem {
  areaName: string;
  productName: string;
  amount: number | null;
}

function buildLineItems(
  sections: QuotedAreaSection[] | undefined,
  job: JobRecord
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];
  if (sections?.length) {
    for (const section of sections) {
      const approved =
        section.approvedOption ??
        section.quoted.find((q) => q.isApproved)?.option ??
        null;
      if (!approved) continue;
      const customerTotal =
        section.quoted.find((q) => q.option.id === approved.id)?.customerTotal ??
        null;
      const productName = [approved.material, approved.productName]
        .filter(Boolean)
        .join(" — ") || approved.productName || "Selected material";
      items.push({
        areaName: section.area.name || "Area",
        productName,
        amount: customerTotal,
      });
    }
  }
  if (items.length === 0 && (job.quotedTotal ?? 0) > 0) {
    items.push({
      areaName: job.areaType || "Project",
      productName: job.name,
      amount: job.quotedTotal ?? null,
    });
  }
  return items;
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

function buildEmailBody(args: {
  companyName: string;
  customerName: string;
  invoiceNumber: string;
  amountDue: number;
  quotedTotal: number;
  jobLabel: string;
  mode: "deposit" | "final";
  depositReceived?: number;
}): string {
  const greeting = `Hi ${args.customerName.split(" ")[0] || "there"},`;
  if (args.mode === "final") {
    const lines = [
      greeting,
      "",
      `Thanks again for choosing ${args.companyName}! Your final invoice for ${args.jobLabel} is attached.`,
      "",
      `Invoice #: ${args.invoiceNumber}`,
      `Quoted total: ${formatMoney(args.quotedTotal)}`,
      `Deposit on file: ${formatMoney(args.depositReceived ?? 0)}`,
      `Balance due: ${formatMoney(args.amountDue)}`,
      "",
      "Please remit the remaining balance at your earliest convenience. Reply to this email if you have any questions.",
      "",
      `— ${args.companyName}`,
    ];
    return lines.join("\n");
  }
  const lines = [
    greeting,
    "",
    `Thanks again for choosing ${args.companyName}! Attached is your deposit invoice for ${args.jobLabel}.`,
    "",
    `Invoice #: ${args.invoiceNumber}`,
    `Quoted total: ${formatMoney(args.quotedTotal)}`,
    `Deposit due now: ${formatMoney(args.amountDue)}`,
    "",
    "Reply to this email with any questions, or let us know how you'd like to send the deposit and we'll get the project on the schedule.",
    "",
    `— ${args.companyName}`,
  ];
  return lines.join("\n");
}

export function InvoiceModal({
  open,
  onClose,
  company,
  customer,
  job,
  quotedTotal,
  depositRequired,
  depositReceived,
  quotedMaterialsByArea,
  mode = "deposit",
  paidTotal = 0,
  onInvoiceNumberGenerated,
}: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const depositDue = Math.max(0, depositRequired - depositReceived);
  const balanceAfterDeposit = Math.max(0, quotedTotal - depositDue);
  /**
   * Final-invoice math is "what's still owed after every payment we
   * already collected", not "what's owed after the required deposit".
   * `paidTotal` includes deposit + any progress/final payments + minus
   * refunds, mirroring `summarizePayments(...).total` in the panel.
   */
  const balanceDueFinal = Math.max(0, quotedTotal - paidTotal);
  const isFinalMode = mode === "final";
  const headlineLabel = isFinalMode ? "Balance due now" : "Deposit due now";
  const headlineAmount = isFinalMode ? balanceDueFinal : depositDue;

  const invoiceNumber = useMemo(
    () => buildInvoiceNumber(job.id, mode),
    [job.id, mode]
  );
  const issueDate = useMemo(() => todayLong(), []);
  const lineItems = useMemo(
    () => buildLineItems(quotedMaterialsByArea, job),
    [quotedMaterialsByArea, job]
  );

  const companyName = company?.name?.trim() || "Your Company";
  const customerName = customer ? customerDisplayName(customer) : job.contactName?.trim() || "Customer";
  const customerAddressLines = formatCustomerAddress(customer);
  const customerPhone = customer?.phone?.trim() || job.contactPhone?.trim() || null;
  const customerEmail = customer?.email?.trim() || null;

  const jobLabel = job.name?.trim() || job.areaType || "your project";

  /**
   * Tag the body during print so the global @media-print rules can hide
   * everything except `.invoice-print-root` (the invoice sheet itself).
   * Without this the modal backdrop and action buttons would show up on
   * the printed page.
   */
  /**
   * Notify the parent of the invoice number we just minted so it can
   * persist `finalInvoiceNumber` / `finalInvoiceSentAt` (or whatever
   * audit field it cares about). We fire on every open — re-opening
   * the modal on a different day generates a new invoice number, and
   * we want the latest one to win in the audit trail.
   */
  useEffect(() => {
    if (!open) return;
    onInvoiceNumberGenerated?.(invoiceNumber);
  }, [open, invoiceNumber, onInvoiceNumberGenerated]);

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
    document.title = `${invoiceNumber} — ${customerName}`;
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

  const emailBody = buildEmailBody({
    companyName,
    customerName,
    invoiceNumber,
    amountDue: headlineAmount,
    quotedTotal,
    jobLabel,
    mode,
    depositReceived,
  });

  const emailSubject = `${companyName} ${
    isFinalMode ? "final invoice" : "deposit invoice"
  } — ${invoiceNumber}`;
  const mailtoHref = customerEmail
    ? `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(
        emailSubject
      )}&body=${encodeURIComponent(emailBody)}`
    : `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${emailSubject}\n\n${emailBody}`);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  };

  return (
    <div
      className="modal-backdrop invoice-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Deposit invoice"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--wide invoice-modal-panel"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="invoice-modal__header no-print">
          <div>
            <h2 className="modal-title">
              {isFinalMode ? "Final invoice" : "Deposit invoice"}
            </h2>
            <p className="modal-sub">
              {isFinalMode
                ? "Print, save as PDF, or email this invoice to the customer to collect the remaining balance. Recording the final payment lets you mark the job Complete."
                : "Print, save as PDF, or email this invoice to the customer to collect the deposit. Recording the deposit will move the job to Active automatically."}
            </p>
          </div>
        </div>

        <article className="invoice-print-root invoice-sheet">
          <QuoteBrandingHeader
            companyName={companyName}
            logoUrl={company?.branding?.logoUrl ?? null}
            address={company?.address ?? null}
            headerMessage={company?.branding?.quoteHeaderText ?? null}
          />

          <header className="invoice-sheet__head">
            <div>
              <h3 className="invoice-sheet__title">Invoice</h3>
              <p className="invoice-sheet__sub">
                {isFinalMode ? "Final balance due" : "Deposit request"}
              </p>
            </div>
            <dl className="invoice-sheet__meta">
              <div>
                <dt>Invoice #</dt>
                <dd>{invoiceNumber}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{issueDate}</dd>
              </div>
              <div>
                <dt>Job</dt>
                <dd>{jobLabel}</dd>
              </div>
            </dl>
          </header>

          <section className="invoice-sheet__parties">
            <div>
              <h4 className="invoice-sheet__party-label">Bill to</h4>
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
            </div>
          </section>

          <section className="invoice-sheet__items">
            <table className="invoice-sheet__table">
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Description</th>
                  <th scope="col" className="invoice-sheet__amount-col">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineItems.length > 0 ? (
                  lineItems.map((item, i) => (
                    <tr key={i}>
                      <td>{item.areaName}</td>
                      <td>{item.productName}</td>
                      <td className="invoice-sheet__amount-col">
                        {item.amount != null ? formatMoney(item.amount) : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="invoice-sheet__empty">
                      Approved materials will appear here once a customer
                      selection is made.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="invoice-sheet__totals">
            <div className="invoice-sheet__totals-row">
              <span>Quoted total</span>
              <span>{formatMoney(quotedTotal)}</span>
            </div>
            {isFinalMode ? (
              paidTotal > 0 ? (
                <div className="invoice-sheet__totals-row">
                  <span>Payments received</span>
                  <span>−{formatMoney(paidTotal)}</span>
                </div>
              ) : null
            ) : depositReceived > 0 ? (
              <div className="invoice-sheet__totals-row">
                <span>Deposit received</span>
                <span>−{formatMoney(depositReceived)}</span>
              </div>
            ) : null}
            <div className="invoice-sheet__totals-row invoice-sheet__totals-row--due">
              <span>{headlineLabel}</span>
              <span>{formatMoney(headlineAmount)}</span>
            </div>
            {!isFinalMode ? (
              <div className="invoice-sheet__totals-row invoice-sheet__totals-row--muted">
                <span>Balance after deposit</span>
                <span>{formatMoney(balanceAfterDeposit)}</span>
              </div>
            ) : null}
          </section>

          <section className="invoice-sheet__notes">
            {isFinalMode ? (
              <p>
                Please remit <strong>{formatMoney(headlineAmount)}</strong> to
                close out the job. Thank you for your business — we
                appreciate the opportunity to work with you.
              </p>
            ) : (
              <p>
                Please remit <strong>{formatMoney(headlineAmount)}</strong> to
                reserve fabrication and installation. The remaining balance of{" "}
                <strong>{formatMoney(balanceAfterDeposit)}</strong> is due
                upon installation completion.
              </p>
            )}
          </section>

          <QuoteBrandingFooter text={company?.branding?.quoteFooterText ?? null} />
        </article>

        <div className="modal-actions no-print">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" onClick={handleCopy}>
            {copyState === "copied"
              ? "Copied!"
              : copyState === "error"
                ? "Copy failed"
                : "Copy invoice text"}
          </button>
          <a className="btn" href={mailtoHref}>
            Email customer
          </a>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}
